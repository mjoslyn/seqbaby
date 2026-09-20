// ---- jam sync: what changed in a session, on the wire -------------------
//
// A jam is several studios holding one song. Each of them edits its own copy
// and tells the others what it did; what goes on the wire is the subject of
// this file, and what goes is a DIFF, never the session.
//
// The alternative — broadcasting `serializeSet()` after every gesture — fails
// on size. A six-track, 32-pattern session is ~390KB before a single sample is
// in it, and a track's sample payload is base64 inside the same blob: sending
// that on every knob turn is a megabyte a second on a drag, through a
// broadcast channel with a payload cap. So a peer sends the difference
// between the session it last synced and the one it holds now, and the
// receiver lays that over its own copy. A knob turn is a few hundred bytes. A
// sample is sent once, when it arrives, and never again.
//
// The diff is a plain recursive one over the serialized session: per key for
// objects, per index for arrays of objects of the same length, and a whole
// replacement for anything else (a step lane is an array of numbers, and
// replacing 32 numbers is cheaper than describing which three moved). That
// shape is what makes concurrent edits compose: two peers turning knobs on
// different tracks send diffs touching different subtrees, and each applies
// the other's without a conflict to resolve. Two peers on the same knob is a
// race the later message wins, which for a jam is the right answer.
//
// **Two guards say when a diff cannot be trusted.** A diff is written against
// the session its sender held, and the receiver's copy is supposed to be the
// same session — but a track removed by one peer while another edits the one
// below it shifts every index, and the diff would land on the wrong track. So
// a patch carries the track count it was made from and the identity (engine +
// name) of every track it touches, and a receiver whose copy disagrees refuses
// it and asks the sender for the whole session instead (`ok: false`). A
// refused patch costs one full sync; a misapplied one would corrupt a track.
//
// Cutting a message into parts the transport will carry is not here: that is
// the wire's problem, and the wire is the shell's (lib/jamWire.js).
//
// No DOM, no Tone: `historyStore.js` is the only import, for `sameTree`, so
// `node --test` runs the whole of this (test/jamSync.test.js).

import { sameTree } from "./historyStore.js";

/** The patch format's version, so a peer on an older build refuses rather
 *  than misreads. */
export const JAM_PATCH_VERSION = 1;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The difference between two values, as a node the receiver can apply.
 *
 *   { set: v }               replace outright
 *   { obj: {k: node}, del }  a plain object, key by key; `del` lists keys gone
 *   { arr: {i: node} }       an array of objects of the same length, by index
 *   null                     no difference
 *
 * @returns {Object|null}
 */
export function diffValue(a, b) {
  if (a === b) return null;
  if (isPlainObject(a) && isPlainObject(b)) {
    const obj = {};
    const del = [];
    let any = false;
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { obj[k] = { set: b[k] }; any = true; continue; }
      const d = diffValue(a[k], b[k]);
      if (d) { obj[k] = d; any = true; }
    }
    for (const k of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) { del.push(k); any = true; }
    }
    if (!any) return null;
    const node = { obj };
    if (del.length) node.del = del;
    return node;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length > 0
      && b.every(isPlainObject) && a.every(isPlainObject)) {
    const arr = {};
    let any = false;
    for (let i = 0; i < b.length; i++) {
      const d = diffValue(a[i], b[i]);
      if (d) { arr[i] = d; any = true; }
    }
    return any ? { arr } : null;
  }
  return sameTree(a, b) ? null : { set: b };
}

/**
 * Apply a node from `diffValue` to a value. Copies along the path it touches
 * and shares everything else with `a`, which is never mutated — the caller's
 * base stays the base until it decides otherwise.
 */
export function patchValue(a, node) {
  if (!node) return a;
  if (Object.prototype.hasOwnProperty.call(node, "set")) return node.set;
  if (node.obj) {
    const out = isPlainObject(a) ? { ...a } : {};
    for (const k of node.del || []) delete out[k];
    for (const [k, sub] of Object.entries(node.obj)) out[k] = patchValue(out[k], sub);
    return out;
  }
  if (node.arr) {
    const out = Array.isArray(a) ? a.slice() : [];
    for (const [i, sub] of Object.entries(node.arr)) out[Number(i)] = patchValue(out[Number(i)], sub);
    return out;
  }
  return a;
}

/** A track's identity for the guard: what the studio shows down its left. */
const trackKey = (t) => [t?.engineKey ?? null, t?.name ?? null];

/** Which pattern you are looking at is the view, not the song: never sent. */
function stripView(s) {
  if (!s || !("activePattern" in s)) return s;
  const { activePattern, ...rest } = s;
  return rest;
}

/**
 * What a peer has to be told to bring its copy of `base` up to `next`.
 *
 * @param {Object} base the session the peers last agreed on (serializeSet)
 * @param {Object} next the session held now
 * @returns {Object|null} a patch, or null when nothing moved
 */
export function diffSession(base, next) {
  const a = stripView(base), b = stripView(next);
  const d = diffValue(a, b);
  if (!d) return null;
  const from = Array.isArray(a?.tracks) ? a.tracks.length : 0;
  const n = Array.isArray(b?.tracks) ? b.tracks.length : 0;
  // The identities of the base tracks this patch reaches into, so a receiver
  // whose list has shifted under it can tell.
  const keys = {};
  const tracksNode = d.obj?.tracks;
  if (tracksNode?.arr) {
    for (const i of Object.keys(tracksNode.arr)) keys[i] = trackKey(a.tracks[Number(i)]);
  }
  return { v: JAM_PATCH_VERSION, from, n, keys, d };
}

/**
 * Lay a patch over a session. Refuses, with the reason, when the session is
 * not the one the patch was written against; the caller then asks for the
 * whole thing.
 *
 * @param {Object} base the receiver's copy (serializeSet)
 * @param {Object} patch from diffSession
 * @returns {{ok: true, session: Object} | {ok: false, reason: string}}
 */
export function applySessionPatch(base, patch) {
  if (!patch || patch.v !== JAM_PATCH_VERSION) return { ok: false, reason: "patch format" };
  const a = stripView(base);
  const have = Array.isArray(a?.tracks) ? a.tracks.length : 0;
  if (have !== patch.from) return { ok: false, reason: `track count ${have}, patch expects ${patch.from}` };
  for (const [i, key] of Object.entries(patch.keys || {})) {
    if (!sameTree(trackKey(a.tracks[Number(i)]), key))
      return { ok: false, reason: `track ${Number(i) + 1} is not ${key[1]}` };
  }
  return { ok: true, session: patchValue(a, patch.d) };
}
