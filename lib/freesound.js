// Freesound (freesound.org): search for a sound and fetch its audio. Plain JS
// with no imports, since three things run it: the compose turn (a Durable
// Object, or node over stdio), the /api/sounds routes, and the tests, which
// hand in a fetch of their own.
//
// CC0 only. Freesound mixes CC0, CC BY and CC BY-NC; a song made here can be
// published, remixed and landed in somebody else's mix, so only sounds that
// need no credit and carry no terms are ever offered. The search asks for the
// licence AND every result's own licence is checked, so a filter the API
// stopped honouring would come back empty rather than open.
//
// The audio is the PREVIEW (an mp3 at about 128kbps): a token reads those,
// where the original file needs a person's own OAuth sign-in. Fine for a
// drum hit or a texture.

export const FREESOUND_API = "https://freesound.org/apiv2";
/** How long a sound may be, by what it is for. */
export const SOUND_MAX_SECONDS = { sampler: 10, granular: 30 };
/** The largest preview taken: a 30s mp3 is about half a megabyte. */
export const SOUND_MAX_BYTES = 900_000;
const FIELDS = "id,name,tags,duration,license,username,previews,url";

export class SoundError extends Error {
  constructor(message, status = 502) { super(message); this.name = "SoundError"; this.status = status; }
}

export const isCc0 = (license) => /publicdomain\/zero/i.test(String(license || ""));

/** A result as this app uses it, or null for one it will not offer. */
export function soundFromApi(r) {
  if (!r || typeof r !== "object" || !isCc0(r.license)) return null;
  const id = Number(r.id);
  const p = r.previews || {};
  const preview = p["preview-hq-mp3"] || p["preview-lq-mp3"] || null;
  if (!Number.isInteger(id) || id <= 0 || typeof preview !== "string" || !/^https:\/\//.test(preview)) return null;
  return {
    id,
    name: String(r.name || `sound ${id}`).replace(/\s+/g, " ").trim().slice(0, 80),
    seconds: Math.round((Number(r.duration) || 0) * 100) / 100,
    by: String(r.username || "").slice(0, 60),
    tags: (Array.isArray(r.tags) ? r.tags : []).slice(0, 8).map((t) => String(t).slice(0, 24)),
    license: "CC0",
    url: typeof r.url === "string" ? r.url : `https://freesound.org/s/${id}/`,
    preview,
  };
}

async function api(path, { key, fetch: f = fetch }) {
  if (!key) throw new SoundError("sound search is not set up here", 503);
  let res;
  try {
    res = await f(`${FREESOUND_API}${path}`, { headers: { Authorization: `Token ${key}` } });
  } catch {
    throw new SoundError("could not reach freesound");
  }
  if (res.status === 429) throw new SoundError("freesound's daily limit is used up, try again later", 429);
  if (res.status === 404) throw new SoundError("no such sound", 404);
  if (!res.ok) throw new SoundError(`freesound answered ${res.status}`);
  return res.json();
}

/**
 * Search. `maxSeconds` bounds the length (so a search for a kick is not
 * answered with a four minute field recording).
 * @returns {Promise<{count: number, sounds: object[]}>}
 */
export async function searchSounds({ key, query, maxSeconds = SOUND_MAX_SECONDS.sampler, limit = 12, fetch: f = fetch }) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) throw new SoundError("say what to search for", 400);
  const max = Math.min(Math.max(Number(maxSeconds) || SOUND_MAX_SECONDS.sampler, 0.2), SOUND_MAX_SECONDS.granular);
  const n = Math.min(Math.max(limit | 0, 1), 30);
  const params = new URLSearchParams({
    query: q,
    filter: `license:"Creative Commons 0" duration:[0.03 TO ${max}]`,
    fields: FIELDS,
    page_size: String(n),
  });
  const out = await api(`/search/text/?${params}`, { key, fetch: f });
  const sounds = (Array.isArray(out?.results) ? out.results : []).map(soundFromApi).filter(Boolean)
    .filter((s) => s.seconds <= max + 0.01);
  return { count: Number(out?.count) || sounds.length, sounds };
}

/** One sound's details, refused unless it is CC0 and short enough. */
export async function soundInfo({ key, id, maxSeconds = SOUND_MAX_SECONDS.granular, fetch: f = fetch }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new SoundError("a sound is named by its freesound id, a number", 400);
  const raw = await api(`/sounds/${n}/?fields=${FIELDS}`, { key, fetch: f });
  const s = soundFromApi(raw);
  if (!s) throw new SoundError(isCc0(raw?.license) ? "that sound has no preview to load" : "that sound is not CC0, so it is not offered here", 403);
  if (s.seconds > maxSeconds + 0.01) throw new SoundError(`that sound is ${s.seconds}s long; the limit here is ${maxSeconds}s`, 413);
  return s;
}

/** A sound and its audio: `{...info, mime, bytes: Uint8Array}`. */
export async function fetchSound({ key, id, maxSeconds = SOUND_MAX_SECONDS.granular, maxBytes = SOUND_MAX_BYTES, fetch: f = fetch }) {
  const s = await soundInfo({ key, id, maxSeconds, fetch: f });
  let res;
  try { res = await f(s.preview); } catch { throw new SoundError("could not download that sound"); }
  if (!res.ok) throw new SoundError(`could not download that sound (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new SoundError("that sound came back empty");
  if (bytes.length > maxBytes) throw new SoundError("that sound is too big to load here", 413);
  return { ...s, mime: "audio/mpeg", bytes };
}

/** Bytes as base64, the form a session carries a sample in. */
export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** What a track remembers about where its sample came from. */
export const soundSource = (s) => ({ kind: "upload", name: s.name, from: "freesound", soundId: s.id, by: s.by, license: s.license, url: s.url });
