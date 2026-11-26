//! Enlaces de cada canción en las plataformas musicales (Spotify, Apple
//! Music, YouTube, YouTube Music, Tidal y Amazon Music).
//!
//! Búsqueda: primero la canción en Deezer (por ISRC o por título y artista) y
//! con su enlace, Odesli (song.link), que devuelve los de las demás
//! plataformas. Lo que falte: Apple por la búsqueda pública de iTunes, y
//! Spotify y YouTube por sus API si hay claves en Ajustes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::settings::PlatformApi;

/// Enlaces de una canción. En la nube se llama `links`, con estos nombres.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Links {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub spotify: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub apple_music: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub youtube: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub youtube_music: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub tidal: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub amazon_music: String,
}

impl Links {
    pub fn is_empty(&self) -> bool {
        self.spotify.is_empty()
            && self.apple_music.is_empty()
            && self.youtube.is_empty()
            && self.youtube_music.is_empty()
            && self.tidal.is_empty()
            && self.amazon_music.is_empty()
    }
    pub fn is_complete(&self) -> bool {
        !(self.spotify.is_empty()
            || self.apple_music.is_empty()
            || self.youtube.is_empty()
            || self.youtube_music.is_empty()
            || self.tidal.is_empty()
            || self.amazon_music.is_empty())
    }
    fn slots(&mut self) -> [(&'static str, &mut String); 6] {
        [
            ("spotify", &mut self.spotify),
            ("appleMusic", &mut self.apple_music),
            ("youtube", &mut self.youtube),
            ("youtubeMusic", &mut self.youtube_music),
            ("tidal", &mut self.tidal),
            ("amazonMusic", &mut self.amazon_music),
        ]
    }
    /// Normaliza y valida todos; el primero que no sea de su plataforma, error.
    pub fn cleaned(mut self) -> Result<Links, String> {
        for (p, v) in self.slots() {
            let raw = v.trim().to_string();
            *v = if raw.is_empty() {
                String::new()
            } else {
                clean_link(p, &raw).ok_or_else(|| format!("El enlace de {} no es válido: {raw}", platform_name(p)))?
            };
        }
        Ok(self)
    }
    /// Rellena solo lo que falte con lo de `other`.
    fn fill_from(&mut self, other: &Links) {
        let o = other.clone();
        let theirs = [o.spotify, o.apple_music, o.youtube, o.youtube_music, o.tidal, o.amazon_music];
        for ((_, mine), t) in self.slots().into_iter().zip(theirs) {
            if mine.is_empty() && !t.is_empty() {
                *mine = t;
            }
        }
    }
}

pub fn platform_name(p: &str) -> &'static str {
    match p {
        "spotify" => "Spotify",
        "appleMusic" => "Apple Music",
        "youtube" => "YouTube",
        "youtubeMusic" => "YouTube Music",
        "tidal" => "Tidal",
        "amazonMusic" => "Amazon Music",
        _ => "la plataforma",
    }
}

/// Enlace normalizado si es de esa plataforma (https, host correcto, sin
/// parámetros de seguimiento).
pub fn clean_link(platform: &str, raw: &str) -> Option<String> {
    let s = raw.trim();
    let rest = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://"))?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let (path_only, query) = path.split_once('?').unwrap_or((path, ""));
    let keep_q = |keys: &[&str]| -> String {
        let kept: Vec<&str> = query.split('&').filter(|kv| keys.iter().any(|k| kv.starts_with(&format!("{k}=")))).collect();
        if kept.is_empty() { String::new() } else { format!("?{}", kept.join("&")) }
    };
    let ok = match platform {
        "spotify" => host == "open.spotify.com" && path_only.contains("track/"),
        "appleMusic" => host == "music.apple.com" || host == "itunes.apple.com" || host == "geo.music.apple.com",
        "youtube" => (host == "youtube.com" || host == "m.youtube.com") && path_only == "watch" && query.contains("v=") || host == "youtu.be",
        "youtubeMusic" => host == "music.youtube.com" && path_only == "watch" && query.contains("v="),
        "tidal" => (host == "tidal.com" || host == "listen.tidal.com") && path_only.contains("track/"),
        "amazonMusic" => host.starts_with("music.amazon.") || host.starts_with("amazon.") && path_only.contains("music"),
        _ => false,
    };
    if !ok {
        return None;
    }
    let q = match platform {
        "youtube" | "youtubeMusic" => keep_q(&["v"]),
        "appleMusic" => keep_q(&["i"]),
        "amazonMusic" => keep_q(&["trackAsin"]),
        _ => String::new(),
    };
    Some(format!("https://{host}/{path_only}{q}"))
}

// ------------------------------------------------------------------ búsqueda

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).user_agent("OmniCaster").build()
}

fn get_json(ag: &ureq::Agent, url: &str, query: &[(&str, &str)], auth: Option<&str>) -> Result<Value, String> {
    let mut req = ag.get(url);
    for (k, v) in query {
        req = req.query(k, v);
    }
    if let Some(a) = auth {
        req = req.set("Authorization", a);
    }
    let body = req.call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Texto para comparar: minúsculas, sin acentos, sin lo que va entre paréntesis.
fn norm(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in s.to_lowercase().chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            'á' | 'à' | 'ä' | 'â' => out.push('a'),
            'é' | 'è' | 'ë' | 'ê' => out.push('e'),
            'í' | 'ì' | 'ï' | 'î' => out.push('i'),
            'ó' | 'ò' | 'ö' | 'ô' => out.push('o'),
            'ú' | 'ù' | 'ü' | 'û' => out.push('u'),
            'ñ' => out.push('n'),
            c if c.is_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

/// ¿Es la misma canción? (título igual y algún artista en común)
fn same_song(title: &str, artist: &str, t2: &str, a2: &str) -> bool {
    let (t1, t2) = (norm(title), norm(t2));
    if t1.is_empty() || t1 != t2 {
        return false;
    }
    let first = |a: &str| norm(a.split([',', '&', ';']).next().unwrap_or(a));
    let (a1, a2n) = (first(artist), norm(a2));
    a1.is_empty() || a2n.contains(&a1) || norm(artist).contains(&first(a2))
}

/// Enlace de la canción en Deezer: por ISRC o buscando título y artista.
fn deezer_link(ag: &ureq::Agent, isrc: &str, title: &str, artist: &str) -> Option<String> {
    if !isrc.is_empty() {
        if let Ok(v) = get_json(ag, &format!("https://api.deezer.com/track/isrc:{isrc}"), &[], None) {
            if let Some(l) = v.get("link").and_then(Value::as_str) {
                return Some(l.to_string());
            }
        }
    }
    let q = format!("artist:\"{}\" track:\"{}\"", artist.split(',').next().unwrap_or(artist).trim(), title.trim());
    let v = get_json(ag, "https://api.deezer.com/search", &[("q", &q), ("limit", "10")], None).ok()?;
    v.get("data")?.as_array()?.iter().find_map(|it| {
        let t = it.get("title").and_then(Value::as_str).unwrap_or("");
        let a = it.get("artist").and_then(|a| a.get("name")).and_then(Value::as_str).unwrap_or("");
        same_song(title, artist, t, a).then(|| it.get("link").and_then(Value::as_str).map(str::to_string)).flatten()
    })
}

/// Odesli admite 10 consultas por minuto sin clave: se espacian.
static ODESLI_LAST: Mutex<Option<Instant>> = Mutex::new(None);

fn odesli(ag: &ureq::Agent, url: &str) -> Option<Links> {
    {
        let mut last = ODESLI_LAST.lock().ok()?;
        if let Some(t) = *last {
            let wait = Duration::from_millis(6500).saturating_sub(t.elapsed());
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
        }
        *last = Some(Instant::now());
    }
    let v = get_json(ag, "https://api.song.link/v1-alpha.1/links", &[("url", url), ("userCountry", "ES")], None).ok()?;
    let by = v.get("linksByPlatform")?;
    let get = |k: &str, p: &str| by.get(k).and_then(|x| x.get("url")).and_then(Value::as_str).and_then(|u| clean_link(p, u)).unwrap_or_default();
    Some(Links {
        spotify: get("spotify", "spotify"),
        apple_music: get("appleMusic", "appleMusic"),
        youtube: get("youtube", "youtube"),
        youtube_music: get("youtubeMusic", "youtubeMusic"),
        tidal: get("tidal", "tidal"),
        amazon_music: get("amazonMusic", "amazonMusic"),
    })
}

/// Apple Music por la búsqueda pública de iTunes (sin clave).
fn itunes(ag: &ureq::Agent, title: &str, artist: &str) -> Option<String> {
    let term = format!("{} {}", artist.split(',').next().unwrap_or(artist).trim(), title.trim());
    let v = get_json(ag, "https://itunes.apple.com/search", &[("term", &term), ("entity", "song"), ("limit", "10"), ("country", "ES")], None).ok()?;
    v.get("results")?.as_array()?.iter().find_map(|it| {
        let t = it.get("trackName").and_then(Value::as_str).unwrap_or("");
        let a = it.get("artistName").and_then(Value::as_str).unwrap_or("");
        if !same_song(title, artist, t, a) {
            return None;
        }
        it.get("trackViewUrl").and_then(Value::as_str).and_then(|u| clean_link("appleMusic", u))
    })
}

/// Spotify por su API (credenciales de cliente en Ajustes).
fn spotify(ag: &ureq::Agent, api: &PlatformApi, isrc: &str, title: &str, artist: &str) -> Option<String> {
    if api.spotify_client_id.trim().is_empty() || api.spotify_client_secret.trim().is_empty() {
        return None;
    }
    use base64::Engine;
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", api.spotify_client_id.trim(), api.spotify_client_secret.trim()));
    let tok: Value = serde_json::from_str(&ag
        .post("https://accounts.spotify.com/api/token")
        .set("Authorization", &format!("Basic {basic}"))
        .send_form(&[("grant_type", "client_credentials")])
        .ok()?
        .into_string()
        .ok()?)
    .ok()?;
    let bearer = format!("Bearer {}", tok.get("access_token")?.as_str()?);
    let q = if isrc.is_empty() { format!("track:{} artist:{}", title.trim(), artist.split(',').next().unwrap_or(artist).trim()) } else { format!("isrc:{isrc}") };
    let v = get_json(ag, "https://api.spotify.com/v1/search", &[("q", &q), ("type", "track"), ("limit", "10")], Some(&bearer)).ok()?;
    v.get("tracks")?.get("items")?.as_array()?.iter().find_map(|it| {
        let t = it.get("name").and_then(Value::as_str).unwrap_or("");
        let a = it.get("artists").and_then(|a| a.get(0)).and_then(|a| a.get("name")).and_then(Value::as_str).unwrap_or("");
        if isrc.is_empty() && !same_song(title, artist, t, a) {
            return None;
        }
        it.get("external_urls").and_then(|u| u.get("spotify")).and_then(Value::as_str).and_then(|u| clean_link("spotify", u))
    })
}

/// YouTube por su API (clave en Ajustes): el vídeo oficial o el «- Topic».
fn youtube(ag: &ureq::Agent, api: &PlatformApi, title: &str, artist: &str) -> Option<String> {
    let key = api.youtube_api_key.trim();
    if key.is_empty() {
        return None;
    }
    let q = format!("{} - {}", artist.split(',').next().unwrap_or(artist).trim(), title.trim());
    let v = get_json(
        ag,
        "https://www.googleapis.com/youtube/v3/search",
        &[("part", "snippet"), ("type", "video"), ("videoCategoryId", "10"), ("maxResults", "5"), ("q", &q), ("key", key)],
        None,
    )
    .ok()?;
    v.get("items")?.as_array()?.iter().find_map(|it| {
        let t = it.get("snippet").and_then(|s| s.get("title")).and_then(Value::as_str).unwrap_or("");
        if !norm(t).contains(&norm(title)) {
            return None;
        }
        let id = it.get("id").and_then(|i| i.get("videoId")).and_then(Value::as_str)?;
        Some(id.to_string())
    })
}

/// Busca los enlaces que faltan. No guarda nada: lo decide quien llama.
pub fn lookup(api: &PlatformApi, isrc: &str, title: &str, artist: &str, have: &Links) -> Links {
    let ag = agent();
    let mut out = have.clone();
    if title.trim().is_empty() {
        return out;
    }
    if !out.is_complete() {
        if let Some(dz) = deezer_link(&ag, isrc, title, artist) {
            if let Some(l) = odesli(&ag, &dz) {
                out.fill_from(&l);
            }
        }
    }
    if out.apple_music.is_empty() {
        if let Some(u) = itunes(&ag, title, artist) {
            out.apple_music = u;
        }
    }
    if out.spotify.is_empty() {
        if let Some(u) = spotify(&ag, api, isrc, title, artist) {
            out.spotify = u;
        }
    }
    if out.youtube.is_empty() || out.youtube_music.is_empty() {
        if let Some(id) = youtube(&ag, api, title, artist) {
            if out.youtube.is_empty() {
                out.youtube = format!("https://youtube.com/watch?v={id}");
            }
            if out.youtube_music.is_empty() {
                out.youtube_music = format!("https://music.youtube.com/watch?v={id}");
            }
        }
    }
    // Con uno de los dos de YouTube, el otro sale del mismo vídeo.
    let vid = |u: &str| u.split("v=").nth(1).map(|v| v.split('&').next().unwrap_or(v).to_string());
    if out.youtube_music.is_empty() {
        if let Some(id) = vid(&out.youtube) {
            out.youtube_music = format!("https://music.youtube.com/watch?v={id}");
        }
    }
    if out.youtube.is_empty() {
        if let Some(id) = vid(&out.youtube_music) {
            out.youtube = format!("https://youtube.com/watch?v={id}");
        }
    }
    out
}

/// Busca los enlaces de una canción de la biblioteca (rellena solo lo vacío).
#[tauri::command]
pub async fn track_links_lookup(state: tauri::State<'_, crate::AppState>, id: String) -> Result<Links, String> {
    let dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = crate::library::read_library_internal(&dir).into_iter().find(|t| t.id == id).ok_or("Canción no encontrada")?;
        let api = crate::settings::read_settings(&dir).platform_api;
        Ok(lookup(&api, &t.isrc, &t.title, &t.artist, &t.links))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_validated_and_cleaned() {
        assert_eq!(clean_link("spotify", "https://open.spotify.com/track/abc?si=123").as_deref(), Some("https://open.spotify.com/track/abc"));
        assert_eq!(clean_link("youtube", "https://www.youtube.com/watch?v=xyz&list=1").as_deref(), Some("https://youtube.com/watch?v=xyz"));
        assert_eq!(clean_link("youtubeMusic", "https://music.youtube.com/watch?v=xyz&feature=share").as_deref(), Some("https://music.youtube.com/watch?v=xyz"));
        assert_eq!(clean_link("appleMusic", "https://music.apple.com/es/album/x/123?i=456&uo=4").as_deref(), Some("https://music.apple.com/es/album/x/123?i=456"));
        assert_eq!(clean_link("tidal", "https://tidal.com/browse/track/123").as_deref(), Some("https://tidal.com/browse/track/123"));
        assert!(clean_link("amazonMusic", "https://music.amazon.es/albums/B0?trackAsin=B1").is_some());
        assert_eq!(clean_link("spotify", "https://youtube.com/watch?v=x"), None);
        assert_eq!(clean_link("spotify", "open.spotify.com/track/abc"), None);
    }

    #[test]
    fn links_roundtrip_with_cloud_names() {
        let l = Links { spotify: "https://open.spotify.com/track/a".into(), apple_music: "https://music.apple.com/x".into(), ..Default::default() };
        let v = serde_json::to_value(&l).unwrap();
        assert_eq!(v["spotify"], "https://open.spotify.com/track/a");
        assert_eq!(v["appleMusic"], "https://music.apple.com/x");
        assert!(v.get("tidal").is_none());
        let back: Links = serde_json::from_value(v).unwrap();
        assert_eq!(back, l);
    }

    #[test]
    fn same_song_ignores_accents_and_brackets() {
        assert!(same_song("Creo (En Vivo)", "René González", "Creo", "Rene Gonzalez"));
        assert!(!same_song("Creo", "René González", "Creo en ti", "Rene Gonzalez"));
    }
}
