// Uploaded samples, lifted out of a session on its way into the database and
// put back on its way out (migration 0023). Pure, so node --test runs it.
//
// A track carries its sample as base64 in `uploadAudio` (`elevenAudio` on
// sessions older than the unified sampler). Stored, that string is replaced
// by "@sample:<sha-256>" and the payload kept once per song. The marker cannot
// be mistaken for a payload: base64 has no "@" and no ":".

import { createHash } from "node:crypto";

const KEYS = ["uploadAudio", "elevenAudio"];
const MARK = "@sample:";

const tracksOf = (data) => (Array.isArray(data?.tracks) ? data.tracks : []);

/** The session with every payload replaced by its marker (a shallow copy:
 *  the input is not touched), and the payloads by hash. */
export function extractSamples(data) {
  const samples = new Map();
  if (!tracksOf(data).length) return { data, samples };
  const tracks = data.tracks.map((t) => {
    if (!t || typeof t !== "object") return t;
    let out = t;
    for (const k of KEYS) {
      const v = t[k];
      if (typeof v !== "string" || !v || v.startsWith(MARK)) continue;
      const hash = createHash("sha256").update(v).digest("hex");
      samples.set(hash, v);
      if (out === t) out = { ...t };
      out[k] = MARK + hash;
    }
    return out;
  });
  return { data: { ...data, tracks }, samples };
}

/** The hashes a stored session refers to. */
export function sampleRefs(data) {
  const refs = new Set();
  for (const t of tracksOf(data))
    for (const k of KEYS)
      if (typeof t?.[k] === "string" && t[k].startsWith(MARK)) refs.add(t[k].slice(MARK.length));
  return [...refs];
}

/** The session with every marker replaced by its payload from `payloads`
 *  (hash -> base64). A marker with nothing behind it becomes null: a track
 *  with no sample loads, a track holding a marker as audio does not decode. */
export function restoreSamples(data, payloads) {
  if (!sampleRefs(data).length) return data;
  const tracks = data.tracks.map((t) => {
    if (!t || typeof t !== "object") return t;
    let out = t;
    for (const k of KEYS) {
      if (typeof t[k] !== "string" || !t[k].startsWith(MARK)) continue;
      if (out === t) out = { ...t };
      out[k] = payloads.get(t[k].slice(MARK.length)) ?? null;
    }
    return out;
  });
  return { ...data, tracks };
}
