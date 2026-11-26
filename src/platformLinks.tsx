import type { TrackLinks } from "./types";
import { openExternal } from "./api";

export type PlatformKey = keyof TrackLinks;

/** Plataformas con enlace, en el orden de «Escuchar en». */
export const PLATFORMS: { key: PlatformKey; name: string; placeholder: string; color: string; host: RegExp }[] = [
  { key: "spotify", name: "Spotify", placeholder: "https://open.spotify.com/track/…", color: "#1db954", host: /^https?:\/\/open\.spotify\.com\/.*track\//i },
  { key: "appleMusic", name: "Apple Music", placeholder: "https://music.apple.com/…", color: "#fa2d48", host: /^https?:\/\/(geo\.)?(music|itunes)\.apple\.com\//i },
  { key: "youtube", name: "YouTube", placeholder: "https://youtube.com/watch?v=…", color: "#ff0033", host: /^https?:\/\/((www|m)\.)?youtube\.com\/watch\?.*v=|^https?:\/\/youtu\.be\//i },
  { key: "youtubeMusic", name: "YouTube Music", placeholder: "https://music.youtube.com/watch?v=…", color: "#ff0033", host: /^https?:\/\/music\.youtube\.com\/watch\?.*v=/i },
  { key: "tidal", name: "Tidal", placeholder: "https://tidal.com/browse/track/…", color: "#e6e6e6", host: /^https?:\/\/(listen\.)?tidal\.com\/.*track\//i },
  { key: "amazonMusic", name: "Amazon Music", placeholder: "https://music.amazon.es/…", color: "#25d1da", host: /^https?:\/\/(music\.)?amazon\.[a-z.]+\//i },
];

export const linkOk = (key: PlatformKey, v: string) => !v.trim() || (PLATFORMS.find((p) => p.key === key)?.host.test(v.trim()) ?? false);

export const linksCount = (l?: TrackLinks) => PLATFORMS.filter((p) => !!l?.[p.key]).length;

/** Iconos sencillos (monocromos, se tiñen con currentColor). */
export function PlatformIcon({ k, size = 16 }: { k: PlatformKey; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;
  switch (k) {
    case "spotify":
      return (
        <svg {...p}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9Zm1.2-2.7a.8.8 0 0 1-1 .3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.4.4.2.5.7.2 1Zm.1-2.8C14.7 9 9.4 8.8 6.4 9.7a.9.9 0 1 1-.5-1.8c3.5-1 9.3-.8 13 1.4a.9.9 0 0 1-1 1.6Z" />
        </svg>
      );
    case "appleMusic":
      return (
        <svg {...p}>
          <path d="M17 3.5v10.3a3 3 0 1 1-1.6-2.7V7.3l-6.6 1.5v7a3 3 0 1 1-1.6-2.7V6.7c0-.5.3-.9.8-1l8-1.8c.5-.1 1 .2 1 .6Z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...p}>
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
        </svg>
      );
    case "youtubeMusic":
      return (
        <svg {...p}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 15.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm-1.8-8.2v5.4L14.8 12l-4.6-2.7Z" />
        </svg>
      );
    case "tidal":
      return (
        <svg {...p}>
          <path d="m4 9 4-4 4 4-4 4-4-4Zm8 0 4-4 4 4-4 4-4-4Zm-4 4 4-4 4 4-4 4-4-4Z" />
        </svg>
      );
    case "amazonMusic":
      return (
        <svg {...p}>
          <path d="M3 8.5h2.2v1c.5-.7 1.2-1.2 2.2-1.2s1.7.4 2 1.3c.6-.8 1.4-1.3 2.4-1.3 1.5 0 2.4.9 2.4 2.7V15H14v-3.7c0-1-.4-1.4-1.1-1.4-.8 0-1.3.6-1.3 1.6V15H9.4v-3.7c0-1-.4-1.4-1.1-1.4-.8 0-1.3.6-1.3 1.6V15H4.8L3 8.5Zm1.2 9c4.8 2.4 10.6 2.4 15.4-.2.4-.2.7.2.4.5-4.3 3-11.5 3.1-16.3.1-.3-.2 0-.6.5-.4Zm16.4-.9c.6-.1 1.8-.1 2 .2.2.3-.1 1.7-.8 2.4-.1.1-.3 0-.2-.1.2-.6.6-1.8.4-2.1-.2-.3-1.2-.2-1.4-.2-.2 0-.2-.1 0-.2Z" />
        </svg>
      );
  }
}

/** Fila de iconos con enlace (para el detalle de la canción). */
export function PlatformLinksRow({ links }: { links?: TrackLinks }) {
  const have = PLATFORMS.filter((p) => links?.[p.key]);
  if (!have.length) return <span>—</span>;
  return (
    <span className="plinks">
      {have.map((p) => (
        <button
          key={p.key}
          type="button"
          className="plink"
          title={`${p.name}: ${links![p.key]}`}
          style={{ color: p.color }}
          onClick={() => void openExternal(links![p.key]!).catch(() => undefined)}
        >
          <PlatformIcon k={p.key} />
        </button>
      ))}
    </span>
  );
}
