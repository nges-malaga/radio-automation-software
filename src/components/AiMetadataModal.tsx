import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { aiSuggestMetadata, updateTrack } from "../api";
import { languageFlag, languageName } from "../languages";
import type { AiSettings, AiSuggestion, Track, TrackPatch } from "../types";
import { Help } from "./Help";

interface Props {
  tracks: Track[];
  ai: AiSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (msg: string) => void;
  standalone?: boolean;
}

type RowStatus = "idle" | "running" | "done" | "error" | "skipped";

/** Lo que puede rellenar la IA; cada uno se activa o no. */
type Action = "language" | "genre" | "tags" | "energy" | "mood" | "themes";
const ACTIONS: { id: Action; label: string; hint: string }[] = [
  { id: "language", label: "Idioma", hint: "Idioma de la letra (ISO 639-1)" },
  { id: "genre", label: "Estilo", hint: "Género musical" },
  { id: "tags", label: "Etiquetas", hint: "Etiquetas descriptivas" },
  { id: "energy", label: "Energía (1–5)", hint: "La usa el AutoDJ para la curva de energía" },
  { id: "mood", label: "Mood", hint: "Carácter de la canción en 1–4 palabras" },
  { id: "themes", label: "Temas (lírica)", hint: "De qué habla la letra" },
];
const ALL_ON: Record<Action, boolean> = { language: true, genre: true, tags: true, energy: true, mood: true, themes: true };
const PREFS_KEY = "omnicaster.aiMeta.prefs";

/** ¿Tiene ya valor ese campo? */
function hasValue(t: Track, a: Action): boolean {
  switch (a) {
    case "language":
      return !!t.language?.trim();
    case "genre":
      return !!t.genre.trim();
    case "tags":
      return t.tags.length > 0;
    case "energy":
      return (t.energy ?? 0) > 0;
    case "mood":
      return !!t.mood?.trim();
    case "themes":
      return (t.themes ?? []).length > 0;
  }
}

function loadPrefs(): { actions: Record<Action, boolean>; skipDone: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { actions: { ...ALL_ON, ...(p.actions ?? {}) }, skipDone: p.skipDone !== false };
  } catch {
    return { actions: { ...ALL_ON }, skipDone: true };
  }
}

interface Row {
  track: Track;
  status: RowStatus;
  suggestion?: AiSuggestion;
  error?: string;
  applied?: boolean;
}

function mergeTags(existing: string[], suggested: string[]): string[] {
  const out = [...existing];
  for (const tag of suggested) {
    if (!out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/**
 * Revision manual de las propuestas de Ollama. Se pueden marcar canciones
 * sueltas o todas, analizarlas y aceptar solo las seleccionadas.
 */
export function AiMetadataModal({ tracks, ai, onClose, onSaved, showToast, standalone = false }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    tracks.map((track) => ({ track, status: "idle" })),
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Sustituir las etiquetas por las nuevas (si no, se añaden a las que ya hay) */
  const [replaceTags, setReplaceTags] = useState(true);
  /** Qué rellena la IA y si se omite lo que ya tiene valor (se recuerda) */
  const [prefs, setPrefs] = useState(loadPrefs);
  const { actions, skipDone } = prefs;
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento: solo para esta vez */
    }
  }, [prefs]);
  const activeActions = ACTIONS.filter((a) => actions[a.id]).map((a) => a.id);
  /** Campos que se rellenarán en esta canción (lo marcado, menos lo que ya tiene si se omite) */
  const fieldsFor = (t: Track) => activeActions.filter((a) => !(skipDone && hasValue(t, a)));

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.track.id)),
    [rows, selected],
  );
  const pendingSelected = selectedRows.filter((row) => row.suggestion && !row.applied);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.track.id)));
  };

  const runAnalysis = async (all: Row[]) => {
    if (all.length === 0) {
      setError("Selecciona al menos una canción.");
      return;
    }
    if (activeActions.length === 0) {
      setError("Marca al menos un campo a analizar.");
      return;
    }
    // Las que ya tienen todo lo marcado no se mandan a la IA.
    const targets = all.filter((r) => fieldsFor(r.track).length > 0);
    const skippedIds = new Set(all.filter((r) => fieldsFor(r.track).length === 0).map((r) => r.track.id));
    if (skippedIds.size > 0) {
      setRows((prev) => prev.map((row) => (skippedIds.has(row.track.id) ? { ...row, status: "skipped", error: undefined } : row)));
    }
    if (targets.length === 0) {
      setError("Todas las seleccionadas ya tienen esos campos. Desmarca «Omitir las ya analizadas» para volver a analizarlas.");
      return;
    }
    if ((ai.provider ?? "ollama") === "ollama" && (!ai.url.trim() || !ai.model.trim())) {
      setError("Configura la dirección y el modelo de Ollama en Ajustes > IA.");
      return;
    }
    setBusy(true);
    setError("");
    const styles = [
      ...new Set(
        rows
          .map((row) => row.track.genre.trim())
          .filter((style) => style.length > 0),
      ),
    ];
    for (const target of targets) {
      const id = target.track.id;
      setRows((prev) =>
        prev.map((row) =>
          row.track.id === id ? { ...row, status: "running", error: undefined } : row,
        ),
      );
      try {
        const suggestion = await aiSuggestMetadata(
          id,
          {
            ...ai,
            provider: ai.provider ?? "ollama",
            opencodePath: ai.opencodePath ?? "",
            cloudUrl: ai.cloudUrl ?? "",
            cloudKey: ai.cloudKey ?? "",
            cloudModel: ai.cloudModel ?? "",
          },
          styles,
        );
        setRows((prev) =>
          prev.map((row) =>
            row.track.id === id
              ? { ...row, status: "done", suggestion, error: undefined }
              : row,
          ),
        );
      } catch (e) {
        setRows((prev) =>
          prev.map((row) =>
            row.track.id === id ? { ...row, status: "error", error: String(e) } : row,
          ),
        );
      }
    }
    setBusy(false);
  };

  const accept = async () => {
    if (pendingSelected.length === 0) {
      setError("No hay sugerencias seleccionadas para aceptar.");
      return;
    }
    setBusy(true);
    setError("");
    let applied = 0;
    const failures: string[] = [];
    for (const row of pendingSelected) {
      const suggestion = row.suggestion;
      if (!suggestion) continue;
      // Solo los campos marcados (y, si se omiten las hechas, los que estaban vacíos)
      const want = new Set(fieldsFor(row.track));
      const patch: TrackPatch = {};
      if (want.has("language") && suggestion.language) patch.language = suggestion.language;
      if (want.has("genre") && suggestion.genre) patch.genre = suggestion.genre;
      if (want.has("tags")) {
        if (replaceTags) patch.tags = suggestion.tags;
        else if (suggestion.tags.length > 0) patch.tags = mergeTags(row.track.tags, suggestion.tags);
      }
      if (want.has("energy") && suggestion.energy && suggestion.energy > 0) patch.energy = suggestion.energy;
      if (want.has("mood") && suggestion.mood) patch.mood = suggestion.mood;
      if (want.has("themes") && suggestion.themes && suggestion.themes.length > 0) patch.themes = suggestion.themes;
      if (Object.keys(patch).length === 0) continue;
      try {
        await updateTrack(row.track.id, patch);
        applied += 1;
        setRows((prev) =>
          prev.map((item) =>
            item.track.id === row.track.id
              ? {
                  ...item,
                  applied: true,
                  track: {
                    ...item.track,
                    language: patch.language ?? item.track.language,
                    genre: patch.genre ?? item.track.genre,
                    tags: patch.tags ?? item.track.tags,
                    energy: patch.energy ?? item.track.energy,
                    mood: patch.mood ?? item.track.mood,
                    themes: patch.themes ?? item.track.themes,
                  },
                }
              : item,
          ),
        );
      } catch (e) {
        failures.push(`${row.track.title}: ${String(e)}`);
      }
    }
    if (applied > 0) {
      try {
        await onSaved();
      } catch (e) {
        failures.push(`No se pudo refrescar la biblioteca: ${String(e)}`);
      }
    }
    setBusy(false);
    if (failures.length > 0) {
      setError(failures.join(" · "));
      return;
    }
    if (applied === 0) {
      setError("No había cambios que aplicar.");
      return;
    }
    showToast(
      `${applied} canción${applied === 1 ? "" : "es"} actualizada${applied === 1 ? "" : "s"} con la IA`,
    );
    onClose();
  };

  // Minimizar: la ventana es una pastilla flotante para seguir trabajando
  // (solo en la ventana principal; en su ventana aparte lo hace la del sistema).
  const [minimized, setMinimized] = useState(false);
  const doneCount = rows.filter((r) => r.status === "done" || r.status === "error" || r.status === "skipped").length;
  const runningCount = rows.filter((r) => r.status === "running").length;
  // X de la ventana aparte: está trabajando? (lo mira AiWindow)
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__AI_BUSY__ = busy;
    return () => {
      (window as unknown as Record<string, unknown>).__AI_BUSY__ = false;
    };
  }, [busy]);

  if (minimized) {
    return (
      <button
        type="button"
        className="ai-mini"
        title="Volver a abrir el análisis"
        onClick={() => setMinimized(false)}
      >
        {busy ? (
          <>
            <span className="ai-mini-dot" />
            IA · {doneCount}/{rows.length}
          </>
        ) : (
          <>IA · {pendingSelected.length} lista{pendingSelected.length === 1 ? "" : "s"} para aceptar</>
        )}
      </button>
    );
  }

  // En su ventana aparte: minimizar/cerrar los hace la ventana del sistema,
  // y su X ya redirige aquí (AiWindow escucha ai://close).
  const minimizeToPill = () => {
    if (standalone) {
      void getCurrentWindow().minimize().catch(() => undefined);
      return;
    }
    setMinimized(true);
  };

  return (
    <div className={standalone ? "modal-backdrop ai-backdrop-window" : "modal-backdrop ai-backdrop-free"} onClick={(e) => { e.stopPropagation(); }}>
      {!standalone && busy && (doneCount < rows.length || runningCount > 0) && (
        <button
          type="button"
          className="ai-mini ai-mini-corner"
          title="Esconder y seguir trabajando"
          onClick={() => setMinimized(true)}
        >
          <span className="ai-mini-dot" />
          IA · {doneCount}/{rows.length}
        </button>
      )}
      <div
        className="modal ai-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Analizar metadatos con IA"
      >
        {/* En su ventana el título ya está en la cabecera de la ventana */}
        <div className="modal-head" style={standalone ? { display: "none" } : undefined}>
          <h3>Analizar metadatos con IA</h3>
          {/* En su ventana aparte los controles los pone su cabecera (WindowControls) */}
          {!standalone && (
            <>
              <button type="button" className="icon-btn" onClick={minimizeToPill} title="Esconder y seguir trabajando (queda en una pastilla abajo)">
                ▁
              </button>
              <button type="button" className="icon-btn" onClick={onClose} disabled={busy} title="Cerrar">
                ×
              </button>
            </>
          )}
        </div>
        <div className="modal-body">
          <Help>
            La IA propone los campos marcados (idioma, estilo, etiquetas, energía 1–5, mood y temas de la lírica) a
            partir de los metadatos y la letra de cada canción. Solo se guardan los campos marcados. La energía la usa el AutoDJ (energía del día) y el asistente.
            Revisa las propuestas y acepta solo las que quieras guardar. No se modifica nada hasta
            que pulses «Aceptar seleccionadas». Esta ventana se puede minimizar: el análisis
            sigue en segundo plano y al aceptar la biblioteca se refresca sola.
          </Help>

          <fieldset className="fieldset ai-actions">
            <legend>Campos a analizar</legend>
            <div className="ai-actions-list">
              {ACTIONS.map((a) => (
                <label key={a.id} className="check-field" title={a.hint}>
                  <input
                    type="checkbox"
                    checked={actions[a.id]}
                    disabled={busy}
                    onChange={(e) => setPrefs((p) => ({ ...p, actions: { ...p.actions, [a.id]: e.target.checked } }))}
                  />
                  {a.label}
                </label>
              ))}
            </div>
            <div className="ai-actions-list">
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={skipDone}
                  disabled={busy}
                  onChange={(e) => setPrefs((p) => ({ ...p, skipDone: e.target.checked }))}
                />
                Omitir las ya analizadas
                <Help>
                  No se vuelve a analizar ni a sobrescribir lo que ya tiene valor: de cada canción solo se rellenan los
                  campos marcados que estén vacíos, y las que ya los tienen todos se saltan sin consultar a la IA.
                  Desmárcalo para reanalizar y sustituir lo que haya.
                </Help>
              </label>
              {actions.tags && (
                <label className="check-field" title="Desmárcalo para conservar las etiquetas que ya tiene y solo añadir las nuevas">
                  <input type="checkbox" checked={replaceTags} disabled={busy} onChange={(e) => setReplaceTags(e.target.checked)} />
                  Sustituir etiquetas
                </label>
              )}
            </div>
          </fieldset>

          <div className="ai-toolbar">
            <label className="check-field">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={busy || rows.length === 0}
                onChange={toggleAll}
              />
              Seleccionar todo
            </label>
            <span className="hint">
              {selected.size} de {rows.length} seleccionada{rows.length === 1 ? "" : "s"}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || selected.size === 0}
              onClick={() => void runAnalysis(selectedRows)}
            >
              Analizar seleccionadas
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || rows.length === 0}
              onClick={() => {
                setSelected(new Set(rows.map((row) => row.track.id)));
                void runAnalysis(rows);
              }}
            >
              Analizar todas
            </button>
          </div>

          {error && <div className="form-error">{error}</div>}

          {rows.length === 0 ? (
            <p className="hint">No hay canciones que coincidan con los filtros actuales.</p>
          ) : (
            <div className="ai-list">
              {rows.map((row) => {
                const isSelected = selected.has(row.track.id);
                const suggestion = row.suggestion;
                return (
                  <div
                    key={row.track.id}
                    className={`ai-row ${isSelected ? "ai-row-on" : ""} ${
                      row.applied ? "ai-row-applied" : ""
                    }`}
                  >
                    <input
                      className="ai-row-check"
                      type="checkbox"
                      checked={isSelected}
                      disabled={busy}
                      onChange={() => toggle(row.track.id)}
                      aria-label={`Seleccionar ${row.track.title}`}
                    />
                    <div className="ai-row-track">
                      <strong>{row.track.title}</strong>
                      <span>
                        {row.track.artist}
                        {row.track.album ? ` · ${row.track.album}` : ""}
                      </span>
                      <span className="ai-row-current">
                        Ahora: {row.track.genre || "sin estilo"} ·{" "}
                        {row.track.language
                          ? `${languageFlag(row.track.language)} ${languageName(row.track.language)}`
                          : "sin idioma"}
                        {row.track.energy ? ` · energía ${row.track.energy}` : ""}
                      </span>
                    </div>
                    <div className="ai-row-proposal">
                      {row.status === "running" ? (
                        <span className="hint">Analizando…</span>
                      ) : row.status === "skipped" ? (
                        <span className="hint">Omitida: ya tiene los campos marcados</span>
                      ) : row.error ? (
                        <span className="form-error">{row.error}</span>
                      ) : suggestion ? (
                        <>
                          <div className="ai-suggestion-line">
                            {actions.genre && <span className="ai-badge">{suggestion.genre || "Sin estilo"}</span>}
                            {actions.language && (
                              <span className="ai-badge">
                                {suggestion.language
                                  ? `${languageFlag(suggestion.language)} ${languageName(suggestion.language)}`
                                  : "Idioma sin determinar"}
                              </span>
                            )}
                            <span className="ai-confidence">
                              {suggestion.confidence > 0
                                ? `${Math.round(suggestion.confidence * 100)}%`
                                : "sin confianza"}
                            </span>
                          </div>
                          {((actions.energy && suggestion.energy) ||
                            (actions.mood && suggestion.mood) ||
                            (actions.themes && (suggestion.themes ?? []).length > 0)) && (
                            <div className="ai-tags">
                              {actions.energy && suggestion.energy ? (
                                <span className="ai-badge" title="Energía: 1 muy tranquila · 5 muy enérgica">
                                  energía {suggestion.energy}
                                </span>
                              ) : null}
                              {actions.mood && suggestion.mood && <span className="ai-badge">{suggestion.mood}</span>}
                              {(actions.themes ? suggestion.themes ?? [] : []).map((th) => (
                                <span className="ai-badge ai-theme" key={`t-${th}`}>
                                  {th}
                                </span>
                              ))}
                            </div>
                          )}
                          {actions.tags && suggestion.tags.length > 0 && (
                            <div className="ai-tags">
                              {suggestion.tags.map((tag) => (
                                <span className="ai-badge" key={tag}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {suggestion.reason && (
                            <span className="ai-reason">{suggestion.reason}</span>
                          )}
                          {row.applied && <span className="ai-applied">Aplicado</span>}
                        </>
                      ) : (
                        <span className="hint">Sin analizar</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="edit-actions">
            <span className="hint">
              {pendingSelected.length} sugerencia{pendingSelected.length === 1 ? "" : "s"} lista
              {pendingSelected.length === 1 ? "" : "s"} para aceptar
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void accept()}
              disabled={busy || pendingSelected.length === 0}
            >
              {busy ? "Procesando…" : "Aceptar seleccionadas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
