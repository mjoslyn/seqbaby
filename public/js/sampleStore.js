// Uploaded samples, stored as files when a song is saved or shared.
//
// A sample a person loads lives on the track as base64 (`t.uploadAudio`) for
// as long as it is only in this tab: the undo stack, a jam and the local
// session list all carry it inline, exactly as before. It is uploaded only
// when the song LEAVES the tab -- a save to the account, a share link, a
// saved patch -- by `storeSamples`, and what that writes is a reference,
// `uploadRef: {hash, mime}`, where the payload was. The server names the file
// by the SHA-256 of its bytes (lib/sampleStore.js), so the same sample saved
// from ten versions, a remix and a share is one file.
//
// Why only then, and why the tab keeps the inline copy: a sample picked and
// thrown away a minute later is never uploaded at all, and nothing the tab
// already does changes shape. `serializeSet()` writes what it always wrote;
// only `serializeSet({ stored: true })`, which the save and share paths ask
// for, swaps a stored sample for its reference. So an upload finishing is not
// an edit: it makes no undo step, sends a jam nothing, and rebuilds no voice.
//
// A song loaded with a reference has no inline copy (`t.uploadRef` only) and
// fetches the file by hash from `/api/sample/<hash>`, a redirect to wherever
// the server keeps it. With no storage on this deploy, or the quota spent,
// the upload is refused and the sample simply stays inline, which is where
// every sample was before any of this.
import { setStatus } from "./dom.js";
import { state } from "./state.js";

/** @typedef {import("./types.js").Track} Track */

const ENDPOINT = "/api/sample";
const HASH_RE = /^[0-9a-f]{64}$/;

/** Where a stored sample is fetched from. */
export const sampleUrl = (hash) => `${ENDPOINT}/${hash}`;

/** A reference the loader can use: a hash that names a stored file. */
export function isStoredRef(ref) {
  return !!ref && typeof ref === "object" && HASH_RE.test(String(ref.hash));
}

/**
 * The reference a track's INLINE sample was stored under, if it was. The
 * record remembers which payload it is for (`of`), so picking another file
 * makes it stale by itself, whoever forgets to clear it.
 * @param {Track} t
 */
export function storedRefFor(t) {
  const s = t?._storedRef;
  return s && t.uploadAudio && s.of === t.uploadAudio ? { hash: s.hash, mime: s.mime } : null;
}

/**
 * A track's sample fields as a session writes them. Default: what the tab
 * holds (inline when it has the bytes). `stored`: a stored sample as its
 * reference instead.
 * @param {Track} t @param {boolean} [stored]
 */
export function sampleFields(t, stored = false) {
  if (t.uploadAudio) {
    const ref = stored ? storedRefFor(t) : null;
    return ref
      ? { uploadAudio: null, uploadAudioMime: null, uploadRef: ref }
      : { uploadAudio: t.uploadAudio, uploadAudioMime: t.uploadAudioMime || null, uploadRef: null };
  }
  return {
    uploadAudio: null,
    uploadAudioMime: null,
    uploadRef: isStoredRef(t.uploadRef) ? { hash: t.uploadRef.hash, mime: t.uploadRef.mime || null } : null,
  };
}

/**
 * Take a serialized track's (or patch's) sample fields onto a track. Inline
 * wins when a blob somehow carries both, and then the reference is kept as
 * the record that the bytes are already stored.
 * @param {Track} t @param {any} td
 */
export function readSampleFields(t, td) {
  t.uploadAudio = td?.uploadAudio || null;
  t.uploadAudioMime = td?.uploadAudioMime || null;
  const ref = isStoredRef(td?.uploadRef) ? { hash: td.uploadRef.hash, mime: td.uploadRef.mime || null } : null;
  t.uploadRef = t.uploadAudio ? null : ref;
  t._storedRef = t.uploadAudio && ref ? { ...ref, of: t.uploadAudio } : null;
}

/** Forget a track's uploaded sample (another source was picked). */
export function clearUploadedSample(t) {
  t.uploadAudio = null;
  t.uploadRef = null;
  t._storedRef = null;
}

// ---- fetching a stored sample -------------------------------------------------

/** hash -> Promise<ArrayBuffer>, the raw file, for the life of the page. */
const bytesCache = new Map();

function fetchSampleBytes(hash) {
  let p = bytesCache.get(hash);
  if (!p) {
    p = fetch(sampleUrl(hash)).then((r) => {
      if (!r.ok) throw new Error(`sample ${hash.slice(0, 12)}: ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytesCache.delete(hash));   // a failure is not remembered
    bytesCache.set(hash, p);
  }
  return p;
}

/**
 * Decode a stored sample. A fresh AudioBuffer every call: the caller
 * normalizes it in place, and two tracks sharing one file must not normalize
 * each other's.
 * @param {BaseAudioContext} ctx @param {{hash: string}} ref
 */
export async function decodeStoredSample(ctx, ref) {
  const ab = await fetchSampleBytes(ref.hash);
  return ctx.decodeAudioData(ab.slice(0));   // decoding detaches its input
}

/** A stored sample as base64, for an export that has to stand on its own. */
export async function storedSampleBase64(hash) {
  return bytesToBase64(new Uint8Array(await fetchSampleBytes(hash)));
}

// ---- storing --------------------------------------------------------------------

let unavailable = false;   // this deploy has no storage: stop asking
let blockedUntil = 0;      // the quota said no: not before this (ms)
/** base64 payload -> Promise<{hash, mime} | null>, one upload per payload. */
const inflight = new Map();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function upload(payload, mime) {
  if (unavailable || Date.now() < blockedUntil) return null;
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": mime || "application/octet-stream" },
    body: base64ToBytes(payload),
  });
  if (r.ok) {
    const out = await r.json();
    return isStoredRef(out) ? { hash: out.hash, mime: out.mime || mime || null } : null;
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 503 || r.status === 404 || r.status === 405) {
    unavailable = true;   // no storage here: the song keeps its samples inline
  } else if (r.status === 429) {
    const secs = Number(body.retryAfter || r.headers.get("retry-after")) || 3600;
    blockedUntil = Date.now() + secs * 1000;
    setStatus(`sample upload limit reached: samples stay in the song until ${clock(blockedUntil)}`, true);
  } else {
    setStatus(`sample not stored (${body.error || r.status}): it stays in the song`, true);
  }
  return null;
}

function uploadOnce(payload, mime) {
  let p = inflight.get(payload);
  if (!p) {
    p = upload(payload, mime).catch((e) => { console.warn("[seqbaby] sample upload failed", e); return null; });
    inflight.set(payload, p);
    p.then(() => inflight.delete(payload));
  }
  return p;
}

/**
 * Upload every inline sample in `tracks` that is not stored yet, so a
 * `serializeSet({ stored: true })` after it writes references. Resolves once
 * they are done or `timeoutMs` has passed, whichever is first: a save is not
 * held hostage by a slow connection, and an upload still running then is used
 * by the next save. Never throws; a sample that could not be stored is simply
 * written inline.
 * @param {Track[]} [tracks] @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{stored: number, inline: number}>}
 */
export async function storeSamples(tracks = state.tracks, { timeoutMs = 30000 } = {}) {
  const todo = tracks.filter((t) => t?.uploadAudio && !storedRefFor(t));
  // Nothing to ask for, or no point asking: the sample stays inline, and the
  // quota message already on screen stays there.
  if (!todo.length || unavailable || Date.now() < blockedUntil) return { stored: 0, inline: todo.length };
  setStatus(todo.length === 1 ? "storing sample…" : `storing ${todo.length} samples…`);
  const work = Promise.all(todo.map(async (t) => {
    const payload = t.uploadAudio;
    const ref = await uploadOnce(payload, t.uploadAudioMime);
    // Only if the track still holds the payload that was sent: a file picked
    // while this was uploading is a different sample.
    if (ref && t.uploadAudio === payload) t._storedRef = { ...ref, of: payload };
  }));
  let timer;
  await Promise.race([work, new Promise((res) => { timer = setTimeout(res, timeoutMs); })]);
  clearTimeout(timer);
  const inline = todo.filter((t) => t.uploadAudio && !storedRefFor(t)).length;
  return { stored: todo.length - inline, inline };
}

/**
 * A serialized session or patch with every stored sample written back
 * inline, for a file that has to play without this site: the export button.
 * Tracks that already carry their bytes are left alone.
 */
export async function inlineStoredSamples(blob) {
  const one = async (td) => {
    if (!td || td.uploadAudio || !isStoredRef(td.uploadRef)) return td;
    try {
      return { ...td, uploadAudio: await storedSampleBase64(td.uploadRef.hash), uploadAudioMime: td.uploadRef.mime || null, uploadRef: null };
    } catch (e) {
      console.warn("[seqbaby] could not inline a stored sample", e);
      return td;   // the reference still plays wherever this site is reachable
    }
  };
  if (Array.isArray(blob?.tracks)) return { ...blob, tracks: await Promise.all(blob.tracks.map(one)) };
  return one(blob);
}
