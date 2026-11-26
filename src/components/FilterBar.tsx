import { useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "../types";
import { languageFlag, languageName } from "../languages";
import { useMediaTypes } from "../mediaTypes";
import { EMPTY_FILTER, countBy, filterCount, toggleIn } from "../trackFilters";
import type { TrackFilter } from "../trackFilters";

/**
 * Botón «Filtros» con su panel. `simple`: solo idioma y energía (panel
 * principal, para los operarios); si no, todos (Librería).
 */
export function FilterBar({
  tracks,
  filter,
  onChange,
  simple = false,
  resultCount,
}: {
  tracks: Track[];
  filter: TrackFilter;
  onChange: (f: TrackFilter) => void;
  simple?: boolean;
  /** Canciones que quedan con los filtros (se muestra en el panel) */
  resultCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const n = filterCount(filter);
  const types = useMediaTypes();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const langs = useMemo(() => countBy(tracks, (t) => (t.language ?? "").trim().toLowerCase()), [tracks]);
  const energies = useMemo(() => new Map(countBy(tracks, (t) => String(t.energy ?? 0))), [tracks]);
  const genres = useMemo(() => countBy(tracks, (t) => t.genre.trim()).slice(0, 40), [tracks]);
  const set = (p: Partial<TrackFilter>) => onChange({ ...filter, ...p });

  return (
    <div className={`fbar ${simple ? "fbar-simple" : ""}`} ref={wrap}>
      <button
        type="button"
        className={`btn btn-sm fbar-btn ${n ? "fbar-btn-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={simple ? "Filtrar por idioma o energía" : "Filtros combinables"}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        {simple ? (n ? n : "") : `Filtros${n ? ` · ${n}` : ""}`}
      </button>
      {open && (
        <div className="fbar-pop" role="dialog" aria-label="Filtros">
          <div className="fbar-sec">
            <span className="fbar-label">Idioma</span>
            <div className="fbar-chips">
              {langs.map(([code, count]) => (
                <button
                  key={code || "none"}
                  type="button"
                  className={`fchip ${filter.langs.includes(code) ? "fchip-on" : ""}`}
                  onClick={() => set({ langs: toggleIn(filter.langs, code) })}
                  title={`${count} canciones`}
                >
                  {code ? `${languageFlag(code)} ${languageName(code)}` : "Sin idioma"}
                </button>
              ))}
            </div>
          </div>

          <div className="fbar-sec">
            <span className="fbar-label">Energía</span>
            <div className="fbar-chips">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className={`fchip fchip-energy ${filter.energies.includes(lvl) ? "fchip-on" : ""}`}
                  onClick={() => set({ energies: toggleIn(filter.energies, lvl) })}
                  title={`Energía ${lvl} · ${energies.get(String(lvl)) ?? 0} canciones`}
                >
                  {"●".repeat(lvl)}
                  <span className="off">{"●".repeat(5 - lvl)}</span>
                </button>
              ))}
              <button
                type="button"
                className={`fchip ${filter.energies.includes(0) ? "fchip-on" : ""}`}
                onClick={() => set({ energies: toggleIn(filter.energies, 0) })}
                title={`${energies.get("0") ?? 0} canciones`}
              >
                Sin energía
              </button>
            </div>
          </div>

          {!simple && (
            <>
              <div className="fbar-sec">
                <span className="fbar-label">Tipo de medio</span>
                <div className="fbar-chips">
                  {types.map((m) => (
                    <button
                      key={m.id || "music"}
                      type="button"
                      className={`fchip ${filter.types.includes(m.id) ? "fchip-on" : ""}`}
                      onClick={() => set({ types: toggleIn(filter.types, m.id) })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fbar-sec">
                <span className="fbar-label">Estilo</span>
                <div className="fbar-chips fbar-chips-scroll">
                  {genres.map(([g, count]) => (
                    <button
                      key={g || "none"}
                      type="button"
                      className={`fchip ${filter.genres.includes(g) ? "fchip-on" : ""}`}
                      onClick={() => set({ genres: toggleIn(filter.genres, g) })}
                      title={`${count} canciones`}
                    >
                      {g || "Sin estilo"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fbar-row">
                <label className="fbar-field">
                  <span className="fbar-label">Mood</span>
                  <input type="text" value={filter.mood} placeholder="p. ej. adoración" onChange={(e) => set({ mood: e.target.value })} />
                </label>
                <label className="fbar-field">
                  <span className="fbar-label">Calidad</span>
                  <select value={filter.quality} onChange={(e) => set({ quality: e.target.value as TrackFilter["quality"] })}>
                    <option value="">Cualquiera</option>
                    <option value="lossless">Sin pérdida (FLAC, WAV…)</option>
                    <option value="hires">Hi-Res</option>
                    <option value="lossy">Con pérdida (MP3, AAC…)</option>
                    <option value="low">Bitrate bajo (≤128 kbps)</option>
                  </select>
                </label>
                <label className="fbar-field">
                  <span className="fbar-label">Alta</span>
                  <select value={String(filter.addedDays)} onChange={(e) => set({ addedDays: Number(e.target.value) })}>
                    <option value="0">Cualquier fecha</option>
                    <option value="1">Últimas 24 h</option>
                    <option value="7">Últimos 7 días</option>
                    <option value="30">Últimos 30 días</option>
                    <option value="90">Últimos 90 días</option>
                  </select>
                </label>
                <label className="fbar-field">
                  <span className="fbar-label">Estado</span>
                  <select value={filter.status} onChange={(e) => set({ status: e.target.value as TrackFilter["status"] })}>
                    <option value="">Todas</option>
                    <option value="ok">Listas para emitir</option>
                    <option value="missing">Sin archivo</option>
                    <option value="pending">Audio pendiente</option>
                    <option value="disabled">Desactivadas</option>
                  </select>
                </label>
                <label className="fbar-field">
                  <span className="fbar-label">Enlaces</span>
                  <select value={filter.links ?? ""} onChange={(e) => set({ links: e.target.value as TrackFilter["links"] })}>
                    <option value="">Cualquiera</option>
                    <option value="none">Sin enlaces</option>
                    <option value="partial">Incompletos</option>
                    <option value="complete">Los 6</option>
                  </select>
                </label>
              </div>
            </>
          )}

          <div className="fbar-foot">
            {resultCount !== undefined && <span>{resultCount === 1 ? "1 canción" : `${resultCount} canciones`}</span>}
            <span className="spacer" />
            <button type="button" className="btn btn-sm" disabled={!n} onClick={() => onChange(EMPTY_FILTER)}>
              Quitar filtros
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
