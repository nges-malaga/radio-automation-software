import type { Track } from "./types";

/**
 * Filtros combinables de canciones. Los usa la Librería (todos) y el
 * explorador del panel principal (solo idioma y energía, de forma discreta).
 */
export interface TrackFilter {
  /** Idiomas (ISO 639-1); "" = sin idioma */
  langs: string[];
  /** Niveles de energía 1–5; 0 = sin energía */
  energies: number[];
  /** Tipos de medio ("" = música) */
  types: string[];
  /** Estilos (texto exacto; "" = sin estilo) */
  genres: string[];
  /** Mood que contenga este texto */
  mood: string;
  quality: "" | "lossless" | "hires" | "lossy" | "low";
  /** Entradas en los últimos N días (0 = cualquiera) */
  addedDays: number;
  status: "" | "ok" | "missing" | "pending" | "disabled";
}

export const EMPTY_FILTER: TrackFilter = {
  langs: [],
  energies: [],
  types: [],
  genres: [],
  mood: "",
  quality: "",
  addedDays: 0,
  status: "",
};

const LOSSLESS = new Set(["flac", "wav", "aif", "aiff", "alac", "ape", "wv"]);
const LOSSY = new Set(["mp3", "wma", "mp2", "aac", "m4a", "ogg", "opus"]);

/** Calidad de audio: sin pérdida (y si es Hi-Res), con pérdida o bitrate bajo. */
export function qualityTier(t: Track): "" | "lossless" | "hires" | "lossy" | "low" {
  let fmt = (t.format ?? "").toLowerCase();
  if ((fmt === "m4a" || fmt === "mp4") && ((t.audioKbps ?? 0) > 320 || (t.audioBits ?? 0) > 0)) fmt = "alac";
  if (LOSSLESS.has(fmt)) return (t.audioRate ?? 0) > 48000 || (t.audioBits ?? 0) > 16 ? "hires" : "lossless";
  if (LOSSY.has(fmt)) {
    const k = t.audioKbps ?? 0;
    return k > 0 && k <= 128 ? "low" : "lossy";
  }
  return "";
}

/** Nº de filtros puestos (para el contador del botón). */
export function filterCount(f: TrackFilter): number {
  return (
    (f.langs.length ? 1 : 0) +
    (f.energies.length ? 1 : 0) +
    (f.types.length ? 1 : 0) +
    (f.genres.length ? 1 : 0) +
    (f.mood.trim() ? 1 : 0) +
    (f.quality ? 1 : 0) +
    (f.addedDays ? 1 : 0) +
    (f.status ? 1 : 0)
  );
}

export function matchFilter(t: Track, f: TrackFilter, nowSecs = Date.now() / 1000): boolean {
  if (f.langs.length && !f.langs.includes((t.language ?? "").trim().toLowerCase())) return false;
  if (f.energies.length && !f.energies.includes(t.energy ?? 0)) return false;
  if (f.types.length && !f.types.includes(t.mediaType ?? "")) return false;
  if (f.genres.length && !f.genres.includes(t.genre.trim())) return false;
  if (f.mood.trim() && !(t.mood ?? "").toLowerCase().includes(f.mood.trim().toLowerCase())) return false;
  if (f.quality) {
    const q = qualityTier(t);
    // «Sin pérdida» incluye Hi-Res; «Con pérdida», también las de bitrate bajo.
    const ok =
      f.quality === "lossless" ? q === "lossless" || q === "hires" : f.quality === "lossy" ? q === "lossy" || q === "low" : q === f.quality;
    if (!ok) return false;
  }
  if (f.addedDays && !((t.addedAt ?? 0) > 0 && nowSecs - (t.addedAt ?? 0) <= f.addedDays * 86_400)) return false;
  if (f.status) {
    const pending = t.missing && !t.file.trim();
    const missing = t.missing && !!t.file.trim();
    const ok =
      f.status === "disabled" ? !!t.disabled : f.status === "pending" ? pending : f.status === "missing" ? missing : !t.missing && !t.disabled;
    if (!ok) return false;
  }
  return true;
}

/** Valores presentes en la biblioteca, con cuántas canciones tienen cada uno. */
export function countBy(tracks: Track[], key: (t: Track) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const t of tracks) {
    const k = key(t);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
