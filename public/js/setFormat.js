// A recorded live set: the format, its check, and the arithmetic over it.
//
// No DOM, no Tone, and one import (sessionFormat.js, itself pure), for the
// reason sessionFormat.js gives: `node --test` exercises it, and the server
// checks a set with it before storing one (lib/data/sets.js).
//
// A set is a starting picture of the studio and a timeline of what was done
// to it while it played. The engine half (setRecorder.js) writes it and plays
// it back; this file is what the two sides agree on.
//
//   start    the song (serializeSet), every mix deck's song (serializeDeckB),
//            the mix's runtime (crossfader, which decks play...), the
//            performance state (which clip each track is on, stopped or not,
//            and every counter the transport keeps) and the open view.
//   events   [step, frac, kind, data], in order. `step` is the transport's
//            global tick the event was in place for: the one scheduled next
//            when it happened. `frac` is how far into that step's wall time
//            (0..1), so a knob turned through a step lands through it.
//
// The kinds:
//
//   perf   the performance state that moved since the step before: a clip
//          launched, a scene switched, a deck started, the crossfader moved.
//          Sampled at the top of every step rather than logged per action, so
//          every way of doing those things (a click, a queue landing on a bar
//          line, a fade, the window.seqbaby API) is caught without being told.
//   ctl    a control moved: {t: track ref, s: selector, i: index, v: value,
//          e: event type}, or {g: element id, ...} for one outside a track.
//          Knobs, selects, checkboxes, the LFO rows, the crossfader.
//   patch  the song changed (jamSync's diff): steps written, a lane drawn, a
//          track added. {d: deck id, or absent for the song, p: patch}
//   deck   a song loaded onto a deck: {id, title, clips, xf, session}
//   eject  a deck taken off: {id}
//   macro  a havoc pad moved: {pad, x, y, phase}

import { validateSet } from "./sessionFormat.js";

/** Bump when the MEANING of an existing field changes. */
export const SET_FORMAT = 1;

/** The event kinds this build plays back. Others are skipped, not refused. */
export const SET_EVENT_KINDS = ["perf", "ctl", "patch", "deck", "eject", "macro"];

/** At most this many events, and this many steps (about 9 hours at 120bpm). */
export const SET_MAX_EVENTS = 400_000;
export const SET_MAX_STEPS = 260_000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Check a recording before it is stored or played.
 * @param {any} rec
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateRecording(rec) {
  const errors = [];
  if (!isObj(rec)) return { ok: false, errors: ["not a recording"] };
  if (rec._set !== SET_FORMAT) {
    if (!Number.isInteger(rec._set) || rec._set < 1) errors.push("not a recorded set");
    else if (rec._set > SET_FORMAT) errors.push(`recorded by a newer seqbaby (set format ${rec._set})`);
  }
  const st = rec.start;
  if (!isObj(st)) errors.push("no starting point");
  else {
    const v = validateSet(st.session);
    if (!v.ok) errors.push(`the song it starts from: ${v.errors.join("; ")}`);
    if (st.decks != null && !Array.isArray(st.decks)) errors.push("decks is not a list");
    for (const [i, d] of (Array.isArray(st.decks) ? st.decks : []).entries()) {
      if (!isObj(d) || typeof d.id !== "string") { errors.push(`deck ${i} is not a deck`); continue; }
      const dv = validateSet(d.session);
      if (!dv.ok) errors.push(`deck ${d.id}: ${dv.errors.join("; ")}`);
    }
  }
  if (!Array.isArray(rec.events)) errors.push("events is not a list");
  else {
    if (rec.events.length > SET_MAX_EVENTS) errors.push(`too many events (${rec.events.length})`);
    let last = -1;
    for (let i = 0; i < rec.events.length && errors.length < 8; i++) {
      const e = rec.events[i];
      if (!Array.isArray(e) || e.length < 4) { errors.push(`event ${i} is not an event`); continue; }
      const [step, frac, kind] = e;
      if (!Number.isInteger(step) || step < 0) errors.push(`event ${i}: step ${JSON.stringify(step)}`);
      else if (step < last) errors.push(`event ${i} is out of order`);
      else last = step;
      if (!(typeof frac === "number" && frac >= 0 && frac <= 1)) errors.push(`event ${i}: frac ${JSON.stringify(frac)}`);
      if (typeof kind !== "string") errors.push(`event ${i}: kind`);
    }
  }
  const steps = rec.steps;
  if (!Number.isInteger(steps) || steps < 0 || steps > SET_MAX_STEPS) errors.push(`steps ${JSON.stringify(steps)}`);
  return { ok: errors.length === 0, errors };
}

/**
 * The few numbers a list or a card shows, read off a recording.
 * @returns {{seconds: number, steps: number, events: number, decks: number, bpm: number|null}}
 */
export function summarizeRecording(rec) {
  const decks = new Set((rec?.start?.decks || []).map((d) => d.id));
  for (const e of rec?.events || []) if (e[2] === "deck" && e[3]?.id) decks.add(e[3].id);
  const bpm = Number(rec?.bpm ?? rec?.start?.session?.bpm);
  return {
    seconds: Math.max(0, Number(rec?.seconds) || 0),
    steps: Math.max(0, rec?.steps | 0),
    events: Array.isArray(rec?.events) ? rec.events.length : 0,
    decks: decks.size,
    bpm: Number.isFinite(bpm) ? bpm : null,
  };
}

/** mm:ss (or h:mm:ss) for a number of seconds. */
export function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** The index of the first event at or after `step` (binary search). */
export function eventIndexAt(events, step) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid][0] < step) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Where on the wall clock each step of the recording fell, as a list of
 * [step, seconds] marks (the recorder writes one every bar and at every tempo
 * change). Linear between marks.
 */
export function secondsAtStep(marks, step) {
  if (!Array.isArray(marks) || !marks.length) return 0;
  let lo = 0, hi = marks.length - 1;
  if (step <= marks[0][0]) return marks[0][1];
  if (step >= marks[hi][0]) {
    if (hi === 0) return marks[0][1];
    const [s0, t0] = marks[hi - 1], [s1, t1] = marks[hi];
    const per = s1 > s0 ? (t1 - t0) / (s1 - s0) : 0;
    return t1 + (step - s1) * per;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (marks[mid][0] <= step) lo = mid; else hi = mid;
  }
  const [s0, t0] = marks[lo], [s1, t1] = marks[hi];
  return s1 > s0 ? t0 + ((step - s0) / (s1 - s0)) * (t1 - t0) : t0;
}

/** The step a number of seconds in falls on (the inverse of secondsAtStep). */
export function stepAtSeconds(marks, seconds) {
  if (!Array.isArray(marks) || !marks.length) return 0;
  if (seconds <= marks[0][1]) return marks[0][0];
  for (let i = 1; i < marks.length; i++) {
    const [s0, t0] = marks[i - 1], [s1, t1] = marks[i];
    if (seconds <= t1) return t1 > t0 ? Math.round(s0 + ((seconds - t0) / (t1 - t0)) * (s1 - s0)) : s1;
  }
  return marks[marks.length - 1][0];
}

// ---- the performance state, diffed ------------------------------------------
//
// What the recorder samples at the top of every step: plain objects of plain
// values, keyed so that a track or a deck reads the same in the recording and
// on the replaying engine. Only what moved is written.

/**
 * The fields of `next` that differ from `prev`, one level into `tracks` and
 * `decks` (both keyed objects) and `mix`. Null when nothing moved. A key
 * present in `prev` and gone from `next` is written as null.
 */
export function diffPerf(prev, next) {
  if (!prev) return next ? structured(next) : null;
  const out = {};
  let any = false;
  for (const k of Object.keys(next)) {
    if (k === "tracks" || k === "decks" || k === "mix") {
      const sub = diffKeyed(prev[k], next[k], k !== "mix");
      if (sub !== undefined) { out[k] = sub; any = true; }
    } else if (!same(prev[k], next[k])) { out[k] = structured(next[k]); any = true; }
  }
  for (const k of Object.keys(prev)) if (!(k in next)) { out[k] = null; any = true; }
  return any ? out : null;
}

function diffKeyed(a, b, nested) {
  if (b == null) return a == null ? undefined : null;
  if (a == null) return structured(b);
  const out = {};
  let any = false;
  for (const k of Object.keys(b)) {
    if (nested && isObj(b[k]) && isObj(a[k])) {
      const d = {};
      let moved = false;
      for (const f of Object.keys(b[k])) if (!same(a[k][f], b[k][f])) { d[f] = structured(b[k][f]); moved = true; }
      if (moved) { out[k] = d; any = true; }
    } else if (!same(a[k], b[k])) { out[k] = structured(b[k]); any = true; }
  }
  for (const k of Object.keys(a)) if (!(k in b)) { out[k] = null; any = true; }
  return any ? out : undefined;
}

/** Lay a diff from diffPerf over a state, returning the new state. */
export function applyPerf(prev, diff) {
  if (!diff) return prev;
  if (!prev) return structured(diff);
  const out = { ...prev };
  for (const k of Object.keys(diff)) {
    const v = diff[k];
    if (v === null) { delete out[k]; continue; }
    if ((k === "tracks" || k === "decks" || k === "mix") && isObj(v) && isObj(prev[k])) {
      const sub = { ...prev[k] };
      for (const kk of Object.keys(v)) {
        if (v[kk] === null) delete sub[kk];
        else if (k !== "mix" && isObj(v[kk]) && isObj(sub[kk])) sub[kk] = { ...sub[kk], ...v[kk] };
        else sub[kk] = structured(v[kk]);
      }
      out[k] = sub;
    } else out[k] = structured(v);
  }
  return out;
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function structured(v) {
  return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}
