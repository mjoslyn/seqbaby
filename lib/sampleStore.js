// Uploaded samples as stored files: what the upload route checks, how a file
// is named, the daily quota, and the one function that writes a sample.
//
// A sample is named by the SHA-256 of its bytes, computed HERE and never
// taken from the client. That is the whole defence against a poisoned name:
// if a client could say which hash its bytes were, it could put junk under
// the hash of a sample somebody else's song already names, and that song
// would play the junk. Computed here, the same bytes always land on the same
// name and different bytes never can, so a second upload of a file is a
// no-op rather than an overwrite.
//
// Pure except `storeSample`, which takes its database as an argument, so
// `node --test` runs all of it (test/sampleStore.test.js).
import { createHash } from "node:crypto";

export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;

export const SAMPLE_BUCKET = "samples";

export const HASH_RE = /^[0-9a-f]{64}$/;

const MB = 1024 * 1024;

/**
 * The daily limits, from the env with defaults: 50MB per address signed out,
 * 200MB per account signed in, 5GB across everyone.
 * @param {Record<string, string | undefined>} [env]
 */
export function quotaLimits(env = process.env) {
  const mb = (v, d) => {
    const n = Number(v);
    return Math.round((Number.isFinite(n) && n > 0 ? n : d) * MB);
  };
  return {
    ip: mb(env.SAMPLE_QUOTA_ANON_MB, 50),
    user: mb(env.SAMPLE_QUOTA_USER_MB, 200),
    global: mb(env.SAMPLE_QUOTA_GLOBAL_MB, 5120),
  };
}

/**
 * What a file is, read from its first bytes rather than from what the client
 * says it is -- a Content-Type header is the client's word, and the point of
 * this check is to keep the bucket from becoming a free host for anything
 * that is not audio. Null when it is not a format the studio can decode.
 * @param {Uint8Array} b
 * @returns {string | null} a MIME type
 */
export function sniffAudio(b) {
  if (!b || b.length < 12) return null;
  const ascii = (at, s) => {
    for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "FORM") && (ascii(8, "AIFF") || ascii(8, "AIFC"))) return "audio/aiff";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(4, "ftyp")) return "audio/mp4";
  if (ascii(0, "ID3")) return "audio/mpeg";
  if (b[0] === 0xff) {
    // ADTS AAC: sync, then layer bits 00. MPEG audio (mp3): sync, layer not 00.
    if ((b[1] & 0xf6) === 0xf0) return "audio/aac";
    if ((b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) !== 0) return "audio/mpeg";
  }
  return null;
}

/** @param {Uint8Array} bytes @returns {string} lowercase hex */
export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * An address as the quota counts it: salted, so the table never holds one.
 * @param {string} ip @param {string} salt
 */
export function hashIp(ip, salt) {
  return createHash("sha256").update(`${salt}\n${ip || "unknown"}`).digest("hex").slice(0, 32);
}

/** The client's address as Netlify reports it, else the proxy chain's first. */
export function clientIp(headers) {
  const nf = headers.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const fwd = headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

export class SampleError extends Error {
  /** @param {string} message @param {number} status @param {number} [retryAfter] */
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const isDuplicate = (err) =>
  !!err && (String(err.statusCode ?? err.status ?? "") === "409"
    || /exists|duplicate/i.test(String(err.message ?? err.error ?? "")));

/**
 * Put one file in the bucket under its hash, if it is not there already.
 * No quota: the route reserves before it calls this, and the backfill has
 * none. Returns whether it wrote anything.
 */
export async function putSampleObject(db, bytes, mime, hash) {
  const { error } = await db.storage.from(SAMPLE_BUCKET).upload(hash, bytes, {
    contentType: mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !isDuplicate(error)) throw new SampleError(`storage: ${error.message ?? error}`, 502);
  const { error: rowErr } = await db
    .from("samples")
    .upsert({ hash, mime, bytes: bytes.length }, { onConflict: "hash", ignoreDuplicates: true });
  if (rowErr) throw new SampleError(`samples row: ${rowErr.message}`, 502);
  return !error;
}

/**
 * Store one uploaded sample: check it, name it, count it against the quota,
 * write it. A file already stored costs nothing -- it is not counted and not
 * written again, whoever sends it.
 *
 * @param {{bytes: Uint8Array, ipHash: string, userId: string | null}} req
 * @param {{db: any, limits?: ReturnType<typeof quotaLimits>}} deps
 * @returns {Promise<{hash: string, mime: string, stored: boolean}>}
 */
export async function storeSample({ bytes, ipHash, userId }, { db, limits = quotaLimits() }) {
  if (!bytes || bytes.length === 0) throw new SampleError("empty file", 400);
  if (bytes.length > MAX_SAMPLE_BYTES) throw new SampleError(`samples are limited to ${MAX_SAMPLE_BYTES / MB}MB`, 413);
  const mime = sniffAudio(bytes);
  if (!mime) throw new SampleError("not an audio file this studio can play", 415);
  const hash = hashBytes(bytes);

  const { data: have, error: haveErr } = await db.from("samples").select("hash").eq("hash", hash).maybeSingle();
  if (haveErr) throw new SampleError(`samples lookup: ${haveErr.message}`, 502);
  if (have) return { hash, mime, stored: false };

  const { data: rows, error: rErr } = await db.rpc("reserve_sample_bytes", {
    p_ip_hash: ipHash,
    p_user_id: userId,
    p_bytes: bytes.length,
    p_ip_limit: limits.ip,
    p_user_limit: limits.user,
    p_global_limit: limits.global,
  });
  if (rErr) throw new SampleError(`quota: ${rErr.message}`, 502);
  const r = Array.isArray(rows) ? rows[0] : rows;
  if (!r?.granted) {
    throw new SampleError("daily sample upload limit reached", 429, Number(r?.retry_after) || 3600);
  }

  let wrote;
  try {
    wrote = await putSampleObject(db, bytes, mime, hash);
  } catch (e) {
    await db.from("sample_uploads").delete().eq("id", r.reservation_id);
    throw e;
  }
  // Someone else stored the same file between the lookup and the write: it
  // is there, and this upload added nothing, so it is not counted either.
  if (!wrote) await db.from("sample_uploads").delete().eq("id", r.reservation_id);
  return { hash, mime, stored: wrote };
}

// ---- inline samples in stored blobs ------------------------------------------

const b64ToBytes = (s) => new Uint8Array(Buffer.from(s, "base64"));

/**
 * The inline sample payloads in a stored session or track patch, rewritten as
 * references. `put(bytes, mime)` stores one and returns its hash; the same
 * payload appearing on several tracks is put once. A payload the upload route
 * would refuse (not audio it recognises, over the size cap) is left inline. Returns the new blob and
 * whether anything changed; never mutates the one it was given.
 *
 * @param {any} blob a session ({tracks: [...]}) or a track patch
 * @param {(bytes: Uint8Array, mime: string) => Promise<string>} put
 */
export async function externalizeSamples(blob, put) {
  if (!blob || typeof blob !== "object") return { blob, changed: false };
  const seen = new Map();
  const one = async (td) => {
    const payload = td?.uploadAudio || td?.elevenAudio;
    if (typeof payload !== "string" || !payload) return td;
    let ref = seen.get(payload);
    if (ref === undefined) {
      const bytes = b64ToBytes(payload);
      const mime = sniffAudio(bytes);
      // What the upload route would refuse stays inline: it still plays, as
      // it always has, and the bucket holds only what the route lets in.
      ref = mime && bytes.length <= MAX_SAMPLE_BYTES ? { hash: await put(bytes, mime), mime } : null;
      seen.set(payload, ref);
    }
    if (!ref) return td;
    const out = { ...td, uploadRef: { ...ref } };
    delete out.uploadAudio;
    delete out.uploadAudioMime;
    delete out.elevenAudio;
    delete out.elevenAudioMime;
    return out;
  };
  if (Array.isArray(blob.tracks)) {
    let changed = false;
    const tracks = [];
    for (const td of blob.tracks) {
      const next = await one(td);
      if (next !== td) changed = true;
      tracks.push(next);
    }
    return changed ? { blob: { ...blob, tracks }, changed } : { blob, changed };
  }
  const next = await one(blob);
  return { blob: next, changed: next !== blob };
}
