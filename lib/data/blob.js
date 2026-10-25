// What lives in R2 (the BLOBS binding) rather than D1.
//
// D1 caps a row at 2MB. Most of what this app stores is far under that -- a
// six-track, 32-pattern session is ~400KB -- but an uploaded sample is
// megabytes of base64, and a song with a long automation-heavy arrangement or
// a sampler patch could cross the line. So:
//
//   samples      always in R2, once per song: songs/<songId>/samples/<sha256>
//                (the session keeps "@sample:<sha256>" in their place, see
//                app/songs/sampleStore.js). Was the song_samples table.
//   big values   a JSON value over INLINE_MAX goes to R2 under a key named by
//                its hash, and the column holds {"$r2": "<key>"}. Read back
//                transparently by unpackJson. Small ones stay in the row.
//
// Everything of a song's sits under songs/<id>/ and everything of a patch's
// under patches/<id>/, so deleting one is a prefix delete (dropPrefix).

import { createHash } from "node:crypto";
import { restoreSamples, sampleRefs } from "../../app/songs/sampleStore.js";

/** Characters of JSON kept in the row; anything longer goes to R2. Well under
 *  D1's 2MB, leaving the rest of the row its room. */
export const INLINE_MAX = 1_000_000;

const sha = (s) => createHash("sha256").update(s).digest("hex");

export const songPrefix = (songId) => `songs/${songId}/`;
export const patchPrefix = (patchId) => `patches/${patchId}/`;
const sampleKey = (songId, hash) => `${songPrefix(songId)}samples/${hash}`;

/**
 * The text a JSON column should hold for `value`: the JSON itself, or a
 * pointer to where it was put in R2 when it is too big for the row.
 * @param {any} blobs R2 bucket
 * @param {string} prefix songPrefix(id) or patchPrefix(id)
 */
export async function packJson(blobs, prefix, value) {
  const text = JSON.stringify(value ?? null);
  if (text.length <= INLINE_MAX) return text;
  const key = `${prefix}big/${sha(text)}.json`;
  if (!(await blobs.head(key))) await blobs.put(key, text);
  return JSON.stringify({ $r2: key });
}

/** The value a JSON column holds, fetched from R2 if it was put there. */
export async function unpackJson(blobs, text) {
  if (text == null) return null;
  const v = typeof text === "string" ? JSON.parse(text) : text;
  if (v && typeof v === "object" && !Array.isArray(v) && typeof v.$r2 === "string" && Object.keys(v).length === 1) {
    const obj = await blobs.get(v.$r2);
    if (!obj) throw new Error("stored data is missing");
    return JSON.parse(await obj.text());
  }
  return v;
}

/** Store the samples this song does not have yet. Only the missing ones are
 *  written: they are megabytes each, and a save usually adds none. */
export async function putSamples(blobs, songId, samples) {
  for (const [hash, payload] of samples) {
    const key = sampleKey(songId, hash);
    if (await blobs.head(key)) continue;
    await blobs.put(key, payload);
  }
}

/** A stored session with its samples put back. Never throws: a sample that
 *  cannot be read is a track without one. */
export async function withSamples(blobs, songId, data) {
  const refs = sampleRefs(data);
  if (!refs.length) return data;
  const payloads = new Map();
  await Promise.all(
    refs.map(async (hash) => {
      try {
        const obj = await blobs.get(sampleKey(songId, hash));
        if (obj) payloads.set(hash, await obj.text());
      } catch {
        /* a track without its sample */
      }
    }),
  );
  return restoreSamples(data, payloads);
}

/** Copy another song's samples under a new song (a remix gets its own). */
export async function copySamples(blobs, fromSongId, toSongId, data) {
  const refs = sampleRefs(data);
  for (const hash of refs) {
    const obj = await blobs.get(sampleKey(fromSongId, hash));
    if (obj) await blobs.put(sampleKey(toSongId, hash), await obj.text());
  }
}

/** Delete everything under a prefix: a song's or a patch's R2 objects. */
export async function dropPrefix(blobs, prefix) {
  let cursor;
  do {
    const page = await blobs.list({ prefix, cursor });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await blobs.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
