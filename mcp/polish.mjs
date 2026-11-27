// The mix and feel pass: what a compose turn's song gets in CODE, after the
// model has stopped writing.
//
// Three things a model does badly from a description and a function does the
// same way every time: a level per part by its role, dynamics on a part
// written at one velocity, and hats a hair off the grid. Each only fills in
// what the turn left unset, on what the turn itself wrote:
//
//   levels      tracks the turn ADDED, whose volume it never set
//   velocities  patterns the turn wrote where every hit is the same velocity
//   nudges      hat and percussion patterns the turn wrote with nothing off
//               the grid
//
// So a level the model chose, an accent pattern it spelled, and anything in
// the song before the turn are never touched, and running it twice changes
// nothing the second time (a shaped part is no longer flat, a nudged one no
// longer on the grid, a set level no longer unset).
//
// Every number is a hash of (track, pattern, step), chanceGen.js's bargain:
// the same song polishes the same way, with no seed to carry.
//
// Plain JS, no DOM: the compose job's Durable Object and `node --test` run it.

import { SILVERBOX_MAX_RESO, SILVERBOX_SAFE_HZ, SILVERBOX_TOP_NOTE, silverboxPeakHz, silverboxWhistle, trackRole } from "../public/js/songBuilder.js";

/** A level per role, 0..1 on the track's fader. Unity-ish for what carries
 *  the song, well under it for what fills the top. */
export const ROLE_LEVEL = {
  kick: 0.86, sub: 0.8, bass: 0.76, snare: 0.74, vox: 0.7, lead: 0.68,
  part: 0.66, keys: 0.58, perc: 0.55, hat: 0.5, pad: 0.5, cymbal: 0.46, texture: 0.42,
};

// Velocities that mean something other than loudness, which a shaped part
// must stay on the same side of: a dead / ghost note on the guitar and bass
// (at or under 0.1) and the accent on the silverbox and subby (above 0.6).
const GHOST = 0.1;
const ACCENT = 0.6;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  // Murmur3's finalizer: an FNV hash's low bits follow its input's low bits.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** -1..1, fixed for (track, pattern, step, which). */
const wobble = (t, p, s, which) => hash(`${t.engineKey}|${t.name}|${p}|${s}|${which}`) * 2 - 1;

const trackKey = (t) => `${t?.engineKey}\n${t?.name}`;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** A request that wants the machine left on: no feel pass. */
const MECHANICAL_RE = /\b(chip ?tune|8[- ]?bit|bitpop|mechanical|robotic|quanti[sz]ed|rigid|on the grid|no swing|straight sixteenths|kraftwerk)\b/i;
export const wantsMechanical = (message) => MECHANICAL_RE.test(String(message || ""));

/**
 * Which of the song's tracks and patterns this turn wrote, against the session
 * it was handed. Tracks are matched by engine + name, in order, as the merge
 * that will write them matches them.
 */
function turnsWork(song, before) {
  const pool = new Map();
  for (const t of before?.tracks || []) {
    const k = trackKey(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(t);
  }
  return (song.tracks || []).map((t) => {
    const was = pool.get(trackKey(t))?.shift() || null;
    const wrote = (t.patterns || []).map((p, i) => !!p?.steps?.some(Boolean) && JSON.stringify(p) !== JSON.stringify(was?.patterns?.[i] ?? null));
    return { t, added: !was, wrote };
  });
}

function shapeVelocities(t, p, slot, role) {
  const on = [];
  p.steps.forEach((x, s) => { if (x) on.push(s); });
  if (on.length < 4) return false;
  const vels = on.map((s) => p.velocities?.[s] ?? 0.5);
  if (new Set(vels.map((v) => Math.round(v * 100))).size !== 1) return false;
  const base = vels[0];
  if (base <= GHOST) return false;
  const timeKeeper = role === "hat" || role === "cymbal" || role === "perc";
  // A backbeat is two hits a bar at one level, and should be.
  if (role === "snare" && on.length <= (p.steps.length / 16) * 4) return false;
  for (const s of on) {
    // the beat, the eighth between, the sixteenths between those
    const place = s % 4 === 0 ? 0 : s % 2 === 0 ? 1 : 2;
    const fall = timeKeeper ? [0, 0.12, 0.24][place] : role === "snare" ? [0, 0.04, 0.08][place] : [0, 0.05, 0.1][place];
    let v = base - fall + wobble(t, slot, s, "vel") * (timeKeeper ? 0.03 : 0.04);
    v = Math.min(base, Math.max(0.18, v));
    if (base > ACCENT) v = Math.max(ACCENT + 0.03, v);
    p.velocities[s] = round(v, 2);
  }
  return true;
}

function nudgeOffbeats(t, p, slot) {
  if ((p.offsets || []).some(Boolean)) return false;
  if (!Array.isArray(p.offsets)) p.offsets = p.steps.map(() => 0);
  let any = false;
  p.steps.forEach((on, s) => {
    // The sixteenths between the eighths, a touch late: at most a twelfth of
    // a step (10ms at 120bpm), which is felt rather than heard.
    if (!on || s % 2 === 0) return;
    p.offsets[s] = round((1 + Math.round((wobble(t, slot, s, "nudge") + 1) / 2)) / 24, 4);
    any = true;
  });
  return any;
}

/**
 * The one thing the pass takes DOWN instead of filling in: a silverbox that
 * would hurt. Its resonance whistles at the filter's corner (no key
 * tracking), so high resonance over a sweep reaching several kHz is a
 * squeal, and a line up in octave 5 is shrill on top of it. On a silverbox
 * this turn added or wrote: the resonance is capped, the env mod (then the
 * cutoff) pulled back until the sweep tops out where it is safe, and the
 * patterns it wrote come down by octaves until the top note is in range.
 */
function tameSilverbox(t, wrote) {
  const did = [];
  const floor2 = (v) => Math.floor(v * 100) / 100;   // down, never up: rounding up lands back over the line
  const P = t.params || (t.params = {});
  const capLane = (key, max) => {
    for (const p of t.patterns || []) {
      const lane = p?.automation?.[key];
      if (lane?.enabled && Array.isArray(lane.values)) lane.values = lane.values.map((v) => (Number(v) > max ? max : v));
    }
  };
  let w = silverboxWhistle(t);
  if (w.reso > SILVERBOX_MAX_RESO) {
    if (Number(P.timb ?? 0.5) > SILVERBOX_MAX_RESO) P.timb = SILVERBOX_MAX_RESO;
    capLane("timb", SILVERBOX_MAX_RESO);
    did.push(`resonance to ${SILVERBOX_MAX_RESO}`);
    w = silverboxWhistle(t);
  }
  if (w.harsh) {
    // the env mod that puts the sweep's top on the safe line, then the cutoff
    const base = silverboxPeakHz(w.harm, w.reso, 0);
    const morph = Math.max(0.15, Math.min(1, Math.log2(SILVERBOX_SAFE_HZ / base) / 4.2));
    if (morph < w.morph) {
      if (Number(P.morph ?? 0.5) > morph) P.morph = floor2(morph);
      capLane("morph", floor2(morph));
    }
    w = silverboxWhistle(t);
    if (w.harsh) {
      const harm = Math.max(0, Math.log(SILVERBOX_SAFE_HZ / (80 * (1 - 0.16 * w.reso) * Math.pow(2, 4.2 * w.morph))) / Math.log(62.5));
      if (Number(P.harm ?? 0.5) > harm) P.harm = floor2(harm);
      capLane("harm", floor2(harm));
    }
    did.push("filter sweep under 4kHz");
  }
  const pats = (t.patterns || []).filter((p, i) => wrote[i]);
  const topOf = () => Math.max(0, ...pats.flatMap((p) => p.steps.flatMap((on, s) => (on ? [p.notes?.[s], ...(p.extraNotes?.[s] || [])] : [])).filter((n) => typeof n === "number")));
  let down = 0;
  while (topOf() > SILVERBOX_TOP_NOTE && down < 4) {
    for (const p of pats) {
      p.notes = (p.notes || []).map((n) => (typeof n === "number" ? n - 12 : n));
      if (Array.isArray(p.extraNotes)) p.extraNotes = p.extraNotes.map((x) => (Array.isArray(x) ? x.map((n) => (typeof n === "number" ? n - 12 : n)) : x));
    }
    down++;
  }
  if (down) did.push(`${down} octave${down === 1 ? "" : "s"} down`);
  return did;
}

/**
 * Polish `song` in place.
 * @param {object} song the turn's song (songBuilder's)
 * @param {object | null} before the session the turn was handed
 * @param {{ feel?: boolean }} [opts] `feel: false` leaves velocities and timing alone
 * @returns {string[]} what it did, one line each; empty when nothing wanted doing
 */
export function polishSong(song, before, { feel = true } = {}) {
  const done = [];
  const levels = [], shaped = [], nudged = [], tamed = [];
  for (const { t, added, wrote } of turnsWork(song, before)) {
    const role = trackRole(t);
    if (role === "bus") continue;
    if (added && t.params && t.params.vol == null && ROLE_LEVEL[role] != null) {
      t.params.vol = ROLE_LEVEL[role];
      levels.push(`${t.name} ${ROLE_LEVEL[role]}`);
    }
    if (t.engineKey === "dm:silverbox" && (added || wrote.some(Boolean))) {
      const did = tameSilverbox(t, wrote);
      if (did.length) tamed.push(`${t.name} (${did.join(", ")})`);
    }
    if (!feel || role === "kick" || t.euclid?.on || t.chance?.on) continue;
    let didShape = false, didNudge = false;
    (t.patterns || []).forEach((p, slot) => {
      if (!wrote[slot]) return;
      if (shapeVelocities(t, p, slot, role)) didShape = true;
      if ((role === "hat" || role === "perc") && nudgeOffbeats(t, p, slot)) didNudge = true;
    });
    if (didShape) shaped.push(t.name);
    if (didNudge) nudged.push(t.name);
  }
  if (tamed.length) done.push(`a silverbox that would have squealed, taken down: ${tamed.join(", ")}`);
  if (levels.length) done.push(`levels by role: ${levels.join(", ")}`);
  if (shaped.length) done.push(`dynamics on parts written at one velocity: ${shaped.join(", ")}`);
  if (nudged.length) done.push(`offbeats a touch late: ${nudged.join(", ")}`);
  return done;
}
