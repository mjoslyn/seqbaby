// The arithmetic of a transition between the song playing and another one
// (transition.js): when it lands, how the tempo travels, how far the sweep has
// closed. No imports, so `node --test` runs it (test/transition.test.js).

export const TRANSITION_SHAPES = ["cut", "sweep", "drop", "fade", "stagger", "bridge"];
export const TRANSITION_BARS = [1, 2, 4, 8];
export const TRANSITION_TEMPOS = ["auto", "jump", "ramp"];
export const TRANSITION_WHENS = ["bar", "now"];

/** What an unset or hand-edited setting means. */
export function normalizeTransition(o = {}) {
  const when = TRANSITION_WHENS.includes(o.when) ? o.when : "bar";
  const shape = TRANSITION_SHAPES.includes(o.shape) ? o.shape : "cut";
  const bars = TRANSITION_BARS.includes(Number(o.bars)) ? Number(o.bars) : 2;
  const tempo = TRANSITION_TEMPOS.includes(o.tempo) ? o.tempo : "auto";
  return { when, shape, bars, tempo };
}

/**
 * How the tempo gets from `from` to `to`. A cut has no time to travel in, so
 * it jumps. Auto ramps a small difference (within RAMP_SPAN of the old tempo)
 * and jumps a half / double time pair (the beat already lines up) or a large
 * gap, where a glide is a tape slowing down rather than a mix.
 */
export const RAMP_SPAN = 0.15;
export function tempoMode(mode, from, to, shape) {
  if (!(from > 0) || !(to > 0) || from === to) return "none";
  // A cut has no time to travel in; a stagger brings the drums in first, and
  // the drums are the tempo, so it changes with them.
  // (A bridge travels like a sweep: it has its own bars to ramp across.)
  if (shape === "cut" || shape === "stagger") return "jump";
  if (mode === "jump" || mode === "ramp") return mode;
  const r = to / from;
  if (Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.03) return "jump";
  return Math.abs(r - 1) <= RAMP_SPAN ? "ramp" : "jump";
}

/**
 * Steps from now until the transition lands, on a bar line.
 *   bar, cut   the next bar line
 *   bar, sweep the bar line `bars` bars after the next one (the sweep runs
 *              across those whole bars)
 *   now, cut   0: lands at once
 *   now, sweep the bar line ending `bars` bars counted from here, the bar
 *              we are in counting as one only when at least half is left
 * `barTick` is where in its bar the next step falls (0 = on the bar line).
 * Returns `{ wait, run }`: steps before the sweep starts, then steps it runs.
 */
export function transitionSteps({ when, shape, bars }, barLen, barTick) {
  barLen = Math.max(1, barLen | 0);
  const pos = ((barTick % barLen) + barLen) % barLen;
  const toLine = pos === 0 ? 0 : barLen - pos;
  if (shape === "cut") {
    if (when === "now") return { wait: 0, run: 0 };
    return { wait: toLine, run: 0 };
  }
  if (when === "bar") return { wait: toLine, run: bars * barLen };
  let run = toLine + (bars - 1) * barLen;
  if (toLine === 0) run = bars * barLen;
  else if (toLine < barLen / 2) run += barLen;
  return { wait: 0, run };
}

/** The tempo `p` (0..1) of the way through a ramp. */
export function rampBpm(from, to, p) {
  const q = Math.min(1, Math.max(0, p));
  return from + (to - from) * q;
}

/**
 * Where the old song's sweep has got to `p` of the way through, in hertz: the
 * corner of a -36dB high shelf on each of its tracks, so a lowpass in effect.
 * Exponential in pitch, so it moves evenly to the ear, and slow at first
 * (p^1.6) so the first bar is a hint and the last one the dive.
 */
export const SWEEP_TOP = 20000;
export const SWEEP_BOTTOM = 400;
export function sweepHz(p) {
  const q = Math.min(1, Math.max(0, p));
  return SWEEP_TOP * Math.pow(SWEEP_BOTTOM / SWEEP_TOP, Math.pow(q, 1.6));
}

/** Steps the filter takes to open again after landing: a bar, or a half for a one-bar sweep. */
export function openSteps(bars, barLen) {
  return Math.max(1, bars <= 1 ? Math.round(barLen / 2) : barLen);
}

// ---- the groups a song is made of --------------------------------------------
//
// drop and stagger move a song a group at a time. A track's group is read off
// its serialized blob: a drum kit is drums; an engine or name that says bass,
// or a part written low (median under C3), is bass; a part with chords or
// stacked notes, or a pad / keys / chord name, is harmony; anything else is
// the lead. A bus is none of them: it carries what feeds it.

export const GROUPS = ["drums", "bass", "harmony", "lead"];

const BASS_RE = /\b(bass|sub|808|303|silverbox|subby)\b|dm:(bass|sub|silverbox)|bass-/;
const HARMONY_RE = /\b(pad|pads|chord|chords|keys|piano|organ|strings?|stab|stabs|harmony|comp)\b/;

function slotOf(track, slot) {
  const ps = track?.patterns || [];
  const p = ps[slot];
  if (p && (p.steps || []).some(Boolean)) return p;
  return ps.find(q => (q?.steps || []).some(Boolean)) || p || null;
}

/** "drums" | "bass" | "harmony" | "lead" | "bus" for a serialized track. */
export function trackGroup(track, slot = 0) {
  const ek = String(track?.engineKey || "");
  if (ek === "bus") return "bus";
  if (track?.isDrumKit) return "drums";
  const name = String(track?.name || "").toLowerCase();
  const words = `${ek} ${name}`.toLowerCase();
  if (BASS_RE.test(words)) return "bass";
  const p = slotOf(track, slot);
  let stacked = false;
  const notes = [];
  if (p) {
    (p.steps || []).forEach((on, i) => {
      if (!on) return;
      if (Number.isFinite(p.notes?.[i])) notes.push(p.notes[i]);
      const ch = p.chords?.[i];
      if (ch && ch !== "none") stacked = true;
      if (Array.isArray(p.extraNotes?.[i]) && p.extraNotes[i].length) stacked = true;
    });
  }
  if (notes.length) {
    const sorted = notes.slice().sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] < 48 && !stacked) return "bass";
  }
  if (stacked || HARMONY_RE.test(name)) return "harmony";
  return "lead";
}

/** Snap a step offset to the beat it is nearest. */
function snapBeat(o, beatLen) {
  const b = Math.max(1, beatLen | 0);
  return Math.round(o / b) * b;
}

/**
 * When each group arrives (stagger) or leaves (drop), in steps from the
 * transition's start, for a transition `bars` bars long.
 *   stagger  drums, bass, harmony, lead spread across the length: over 4
 *            bars one a bar, over 1 bar one a beat. The lead's arrival is
 *            where the new song is whole.
 *   drop     harmony + lead, then bass, then drums leave, the drums at the
 *            start of the last bar (the last beat of a one-bar drop), which
 *            is the near-silence before the hit at the end.
 * Returns `[{ group | groups, at }]`, in order.
 */
export function groupStages(shape, bars, barLen, beatLen, run = bars * barLen) {
  if (shape === "stagger") {
    return GROUPS.map((g, i) => ({ groups: [g], at: snapBeat((i * run) / 4, beatLen) }));
  }
  if (shape === "drop") {
    const silence = run >= 2 * barLen ? barLen : Math.max(1, beatLen);
    const region = run - silence;
    return [
      { groups: ["harmony", "lead"], at: snapBeat(region / 3, beatLen) },
      { groups: ["bass"], at: snapBeat((2 * region) / 3, beatLen) },
      { groups: ["drums"], at: region },
    ];
  }
  return [];
}

/** A fade's level `p` of the way down, as a gain: linear in dB to -36. */
export const FADE_FLOOR_DB = -36;
export function fadeGain(p) {
  const q = Math.min(1, Math.max(0, p));
  return Math.pow(10, (FADE_FLOOR_DB * q) / 20);
}

/** A track's identity across two songs: what mergeSet matches a live track by. */
export function trackKey(t) {
  return `${t?.engineKey}\u0000${t?.name}`;
}

/**
 * Two songs' tracks in one session: the new song's globals, the new tracks
 * `keepNew` keeps, then the old tracks `keepOld` keeps. Every cross-track
 * index (a send, a sidechain, a pad assignment) is renumbered into the mixed
 * list, or let go when the track it named is not in it. The old song's pads
 * stay, since its tracks are the ones the pads were made for.
 */
function mixSessions(oldS, newS, keepNew, keepOld) {
  const pick = [];
  (newS?.tracks || []).forEach((t, i) => { if (keepNew(t)) pick.push({ src: "new", i, t }); });
  (oldS?.tracks || []).forEach((t, i) => { if (keepOld(t)) pick.push({ src: "old", i, t }); });
  const at = { new: new Map(), old: new Map() };
  pick.forEach((p, k) => at[p.src].set(p.i, k));
  const remap = (src, idx) => (Number.isInteger(idx) && idx >= 0 && at[src].has(idx) ? at[src].get(idx) : -1);
  const tracks = pick.map(({ src, t }) => {
    const out = { ...t };
    if ("outIndex" in t) out.outIndex = remap(src, t.outIndex);
    if ("compSourceIndex" in t) {
      out.compSourceIndex = remap(src, t.compSourceIndex);
      if (out.compSourceIndex < 0 && t.comp) out.comp = { ...t.comp, source: "self" };
    }
    return out;
  });
  const pads = (oldS?.macroPads || []).map(pad => {
    const fix = (list) => (list || [])
      .map(a => ({ ...a, track: remap("old", a.track) }))
      .filter(a => a.track >= 0);
    return { ...pad, x: fix(pad.x), y: fix(pad.y) };
  });
  return { ...newS, tracks, macroPads: Array.isArray(oldS?.macroPads) ? pads : newS?.macroPads };
}

/**
 * The session a stagger plays part way through: the new song's tracks in the
 * groups that have arrived (and its buses, from the start), and the old
 * song's tracks in the groups that have not, so those go on playing untouched.
 */
export function compositeSession(oldS, newS, arrived) {
  const oldSlot = oldS?.activePattern ?? 0;
  const newSlot = newS?.activePattern ?? 0;
  return mixSessions(oldS, newS,
    t => { const g = trackGroup(t, newSlot); return g === "bus" || arrived.has(g); },
    t => { const g = trackGroup(t, oldSlot); return g === "bus" || !arrived.has(g); });
}

/**
 * Both songs at once, for a sweep or a fade: every track of the new song, and
 * the old song's tracks the new one does not have (a track in both switches to
 * its new part at once). The old ones are swept or faded out over the length
 * and gone at its end.
 */
export function overlapSession(oldS, newS) {
  const inNew = new Set((newS?.tracks || []).map(trackKey));
  return mixSessions(oldS, newS, () => true, t => !inNew.has(trackKey(t)));
}

// ---- bridge: a passage written for the join ----------------------------------
//
// A bridge is a passage that stands in for the NEW song's intro. For as long
// as that intro lasts, the new song's own tracks play their intro parts and
// the song that was playing plays an OUTRO over them: its tracks carried into
// the bridge and thinned away, so that by the bridge's last bar the old song
// has gone and the new one is all there. Then the new song carries on from the
// section after its intro.
//
// It is WRITTEN, into free pattern slots (`bridgeLayout`): a draft made here
// in code, at once (`codeBridge`), which is what plays when nothing better is
// ready, and which the compose model is handed to rewrite into a real
// transition (`bridgePrompt`, `bridgeSession`). Both are the same shape of
// session, so the engine plays either the same way: the bridge slots in
// order, each for its bars, then the landing.

/**
 * The roll's velocity on step `k` of a last bar `len` steps long, or 0 for a
 * rest: eighths for the first half, sixteenths after, rising throughout.
 */
export function rollVelocity(k, len) {
  len = Math.max(1, len | 0);
  if (k < 0 || k >= len) return 0;
  if (k < len / 2 && k % 2 !== 0) return 0;
  return Math.min(1, 0.45 + 0.55 * (k / len));
}

const KICK_RE = /kick|\bbd\b|siege|808-kick|909-kick/i;
const SNARE_RE = /snare|clap|\bsd\b|\bcp\b|lancet|rim/i;

/** Whether a drum track is the kick, by its engine and name. */
export function isKick(t) { return KICK_RE.test(`${t?.engineKey} ${t?.name}`); }
/** Whether a drum track is a snare or clap, by its engine and name. */
export function isSnare(t) { return SNARE_RE.test(`${t?.engineKey} ${t?.name}`); }

export const BANK = 32;

function slotUsed(s, k) {
  return (s?.tracks || []).some(t => (t.patterns?.[k]?.steps || []).some(Boolean));
}

/** The first empty slot after the last used, else the first empty one. -1 when full. */
export function freeSlot(s) {
  let last = -1;
  for (let k = 0; k < BANK; k++) if (slotUsed(s, k)) last = k;
  if (last + 1 < BANK && !slotUsed(s, last + 1)) return last + 1;
  for (let k = 0; k < BANK; k++) if (!slotUsed(s, k)) return k;
  return -1;
}

/** Sixteenths in a bar of `slot`'s meter (an unset slot follows slot 0's). */
export function barSteps(s, slot = 0) {
  const m = s?.patternMeters?.[slot] || s?.patternMeters?.[0] || { num: 4, den: 4 };
  const num = Math.max(1, Number(m.num) || 4), den = Math.max(1, Number(m.den) || 4);
  return Math.max(1, Math.round((num * 16) / den));
}

const hasNotes = (p) => (p?.steps || []).some(Boolean);
const playing = (s) => (s?.tracks || []).filter(t => t?.engineKey !== "bus");

/** The slot a song starts on: the one it was saved on when it has notes, else its first with any. */
function firstSlot(s, from) {
  const want = Number.isInteger(from) ? from : Number.isInteger(s?.activePattern) ? s.activePattern : 0;
  if (slotUsed(s, want)) return want;
  for (let k = 0; k < BANK; k++) if (slotUsed(s, k)) return k;
  return Math.max(0, Math.min(BANK - 1, want));
}

/** How many tracks play notes in slot `k`. */
function density(s, k) {
  return playing(s).filter(t => hasNotes(t.patterns?.[k])).length;
}

/** The most bars a bridge runs: an intro longer than this is only led into. */
export const BRIDGE_MAX_BARS = 16;
/** The longest pattern a bridge slot holds, in steps: what the compose tools can write. */
export const BRIDGE_SEG_STEPS = 64;

/**
 * The intro phase of a song, as it plays: its leading sections, each a slot
 * and the bars it plays for, and the slot the song carries on from after
 * them. In chain mode a section is a filled slot for its repeat count, and
 * the intro is the first section plus every section after it that is still
 * sparser than the song at its fullest (fewer tracks playing), which is what
 * an intro is. A song with one pattern, or one that does not chain, has that
 * pattern as its intro and carries on from it. `leadIn`: the intro is too
 * long to bridge whole, so the bridge is its first bars and the song starts
 * from the top after it.
 * @param {object} s a serialized session
 * @param {{start?: number, maxBars?: number}} [opts] `start`: the pattern to
 *   treat as the song's first (the review bar's `into`)
 * @returns {{sections: {slot: number, bars: number}[], bars: number, land: number, barLen: number, leadIn: boolean}}
 */
export function introPlan(s, { start, maxBars = BRIDGE_MAX_BARS } = {}) {
  const first = firstSlot(s, start);
  const barLen = barSteps(s, first);
  // One pass of a pattern, in bars, at the pace of the track that takes longest.
  const passBars = (k) => {
    let most = 1;
    for (const t of playing(s)) {
      const p = t.patterns?.[k];
      if (!hasNotes(p)) continue;
      most = Math.max(most, Math.ceil(p.steps.length / Math.max(0.0001, t.speed ?? 1) / barLen));
    }
    return most;
  };
  const chained = s?.patternMode === "chain";
  const order = [first];
  if (chained) {
    for (let off = 1; off < BANK; off++) {
      const k = (first + off) % BANK;
      if (slotUsed(s, k)) order.push(k);
    }
  }
  const barsOf = (k) => (chained ? Math.max(1, Number(s?.patternRepeats?.[k]) || 1) : passBars(k));
  const full = Math.max(1, ...order.map(k => density(s, k)));
  const sections = [];
  let bars = 0;
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const b = barsOf(k);
    if (i > 0 && (density(s, k) >= full || density(s, first) >= full)) break;   // the song proper
    if (i > 0 && barSteps(s, k) !== barLen) break;                             // one meter to a bridge
    if (bars + b > maxBars) break;
    sections.push({ slot: k, bars: b });
    bars += b;
  }
  if (!sections.length) {
    // The first section alone is longer than a bridge runs: lead into it.
    const b = Math.max(1, Math.min(8, maxBars, barsOf(first)));
    return { sections: [{ slot: first, bars: b }], bars: b, land: first, barLen, leadIn: true };
  }
  const next = order[sections.length];
  // No section after the intro (one pattern, or a song that does not chain):
  // the bridge leads in, and the song starts from the top after it.
  return { sections, bars, land: next ?? first, barLen, leadIn: next == null };
}

/** `n` slots with no notes in them on any track of `s`, after the last used one first. */
export function freeSlots(s, n) {
  let last = -1;
  for (let k = 0; k < BANK; k++) if (slotUsed(s, k)) last = k;
  const out = [];
  for (let k = last + 1; k < BANK && out.length < n; k++) out.push(k);
  for (let k = 0; k <= last && out.length < n; k++) if (!slotUsed(s, k)) out.push(k);
  return out;
}

/**
 * Where a bridge between two songs is written and how it plays: the new
 * song's intro (`introPlan`) cut into segments a pattern can hold, each given
 * a slot that is free in BOTH songs, and the slot to land on after the last.
 * Each segment lists the intro bars it stands for (`from`: the intro slot and
 * the bar of that section). Null when there is no free slot to write one in.
 * @returns {null | {segs: {slot: number, bars: number, from: {slot: number, bar: number}[]}[], bars: number, barLen: number, land: number, intro: object, oldSlot: number}}
 */
export function bridgeLayout(oldS, newS, { start } = {}) {
  const intro = introPlan(newS, { start });
  const barLen = intro.barLen;
  // every track in the bridge has to fit a segment at its own speed
  const speeds = [...playing(oldS), ...playing(newS)].map(t => Math.max(0.0001, Number(t.speed) || 1));
  const fastest = Math.max(1, ...speeds);
  const per = Math.max(1, Math.min(8, Math.floor(BRIDGE_SEG_STEPS / (barLen * fastest))));
  const flat = [];
  for (const sec of intro.sections) for (let b = 0; b < sec.bars; b++) flat.push({ slot: sec.slot, bar: b });
  const both = { tracks: [...(newS?.tracks || []), ...(oldS?.tracks || [])] };
  const want = Math.ceil(flat.length / per);
  const slots = freeSlots(both, want);
  if (!slots.length) return null;
  const segs = [];
  for (let i = 0; i < slots.length; i++) {
    const from = flat.slice(i * per, (i + 1) * per);
    if (from.length) segs.push({ slot: slots[i], bars: from.length, from });
  }
  const bars = segs.reduce((n, g) => n + g.bars, 0);
  // Out of slots part way: the bridge covers what fits, and the song then
  // starts from the top rather than from a place the bridge never reached.
  const short = bars < flat.length;
  return { segs, bars, barLen, land: short ? intro.sections[0].slot : intro.land, intro, oldSlot: firstSlot(oldS) };
}

function clone(v) {
  return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}

const STEP_DEFAULTS = {
  steps: 0, lengths: 0, notes: null, velocities: 0.5, chords: "", offsets: 0, arps: false, arpRates: 0.25,
  arpRanges: 1, arpDirs: "up", strums: 0, complexities: 0, ratchets: 1, sampleStarts: 0, sampleEnds: 1,
  sampleFadeIns: 0, sampleFadeOuts: 0, sampleLoopModes: "off", extraNotes: null, extraLengths: null,
};

/** An empty pattern `len` steps long, every per-step array present. */
export function blankPattern(len) {
  const out = {};
  for (const [k, v] of Object.entries(STEP_DEFAULTS)) out[k] = Array(len).fill(v);
  out.automation = {};
  out.soundLocked = false;
  out.sound = null;
  return out;
}

/**
 * A track's part across some bars, read as it would play: for each bar, the
 * pattern it is on then (`bars[i].slot`) from where that bar falls in it
 * (`bars[i].bar`), at the track's own speed. A bar with no pattern is rests.
 */
function partOver(t, bars, barLen) {
  const spb = Math.max(1, Math.round(barLen * Math.max(0.0001, Number(t.speed) || 1)));
  const out = blankPattern(bars.length * spb);
  const lanes = {};
  bars.forEach(({ slot, bar }, i) => {
    const p = t.patterns?.[slot];
    const L = p?.steps?.length || 0;
    if (!L) return;
    for (let j = 0; j < spb; j++) {
      const src = (bar * spb + j) % L, dst = i * spb + j;
      for (const k of Object.keys(STEP_DEFAULTS)) if (Array.isArray(p[k]) && src < p[k].length) out[k][dst] = clone(p[k][src]);
      for (const [lk, lane] of Object.entries(p.automation || {})) {
        if (!Array.isArray(lane?.values) || !lane.values.length) continue;
        lanes[lk] ??= { enabled: !!lane.enabled, values: Array(out.steps.length).fill(lane.values[0]) };
        lanes[lk].values[dst] = lane.values[src % lane.values.length];
      }
    }
    // a sound locked to the intro's pattern is the bridge's sound for it too
    if (i === 0 && p.soundLocked && p.sound) { out.soundLocked = true; out.sound = clone(p.sound); }
  });
  out.automation = lanes;
  // a note may not run past the part it is in
  for (let i = 0; i < out.steps.length; i++) if (out.steps[i] && out.lengths[i] > out.steps.length - i) out.lengths[i] = out.steps.length - i;
  return out;
}

/** Silence a part from step `from` (and cut a note that would ring past it). */
function restFrom(p, from, to = p.steps.length) {
  const off = typeof p.steps[0] === "boolean" ? false : 0;
  for (let i = Math.max(0, from); i < to; i++) p.steps[i] = off;
  for (let i = 0; i < from && i < p.steps.length; i++) {
    if (p.steps[i] && Number(p.lengths?.[i]) > from - i) p.lengths[i] = from - i;
  }
}

/** How far through a bridge each of the outgoing song's groups plays before it is gone. */
export const OUTRO = { lead: 0.25, harmony: 0.5, bass: 0.75 };

/**
 * The draft bridge, made in code from the two songs: the session the engine
 * plays when no written bridge is ready, and what the model is given to
 * rewrite. It holds the new song's tracks, then the outgoing song's own (a
 * track in both is the new song's), and in each bridge slot:
 *
 *   the new song's tracks    their intro, as it plays (`partOver`)
 *   the outgoing song's      the pattern it was on, as an outro: the lead
 *                            gone a quarter of the way through, the chords
 *                            at half, the bass at three quarters (the bass,
 *                            the kick and the snare resting in any bar the
 *                            new song plays its own), and the
 *                            drums through to the last bar, where the kick
 *                            drops and a snare rolls up into the landing
 *                            (unless the new song's own snare is playing it)
 *
 * Everything else in both songs is as it was, so the landing only has to take
 * the outgoing tracks and the bridge slots away again.
 */
export function codeBridge(oldS, newS, layout) {
  const base = overlapSession(oldS, newS);
  const newKeys = new Set((newS?.tracks || []).map(trackKey));
  const barLen = layout.barLen;
  const total = layout.bars;
  const newSlot = layout.intro.sections[0].slot;
  // which groups the new song plays in each bar of the bridge
  const flat = layout.segs.flatMap(g => g.from);
  const newGroupAt = flat.map(({ slot, bar }) => {
    const here = new Set();
    for (const t of playing(newS)) {
      const p = t.patterns?.[slot];
      const L = p?.steps?.length || 0;
      if (!L) continue;
      const spb = Math.max(1, Math.round(barLen * Math.max(0.0001, Number(t.speed) || 1)));
      let any = false;
      for (let j = 0; j < spb && !any; j++) any = !!p.steps[(bar * spb + j) % L];
      if (!any) continue;
      const g = trackGroup(t, newSlot);
      here.add(g === "drums" ? (isKick(t) ? "kick" : isSnare(t) ? "snare" : "drums") : g);
    }
    return here;
  });
  // a group's cut, in whole bars over four bars or more, in beats under that
  const beat = Math.max(1, Math.round(barLen / 4));
  const cutBar = (f) => (total >= 4 ? Math.max(1, Math.round(total * f)) : (Math.round((total * barLen * f) / beat) * beat) / barLen);

  let at = 0;                                    // bars of bridge before this segment
  const perSeg = layout.segs.map(g => { const a = at; at += g.bars; return a; });
  const tracks = base.tracks.map((t) => {
    if (t.engineKey === "bus") return t;
    const isNew = newKeys.has(trackKey(t));
    const patterns = (t.patterns || []).slice();
    const spb = Math.max(1, Math.round(barLen * Math.max(0.0001, Number(t.speed) || 1)));
    layout.segs.forEach((g, gi) => {
      while (patterns.length <= g.slot) patterns.push(null);
      if (isNew) { patterns[g.slot] = partOver(t, g.from, barLen); return; }
      // the outgoing song: its pattern carried on from where the bridge is
      const p = partOver(t, g.from.map((_, i) => ({ slot: layout.oldSlot, bar: perSeg[gi] + i })), barLen);
      const group = trackGroup(t, layout.oldSlot);
      const role = group === "drums" ? (isKick(t) ? "kick" : isSnare(t) ? "snare" : "drums") : group;
      for (let i = 0; i < g.bars; i++) {
        const b = perSeg[gi] + i;                // this bar of the whole bridge
        const last = b === total - 1;
        // the new song has this part now: never two kicks, snares or basslines
        let out = (role === "kick" || role === "snare" || role === "bass") && newGroupAt[b].has(role);
        if (role in OUTRO) {
          const cut = cutBar(OUTRO[role]);
          if (b >= cut) out = true;
          else if (!out && b + 1 > cut) restFrom(p, Math.round((cut - perSeg[gi]) * spb), (i + 1) * spb);
        }
        if (role === "kick" && last && total > 1) out = true;
        if (out) { restFrom(p, i * spb, (i + 1) * spb); continue; }
        if (role === "snare" && last && !newGroupAt[b].has("snare")) {
          // the roll, at the track's own pace: eighths, then sixteenths, rising
          const first = p.steps.findIndex(Boolean);
          const note = first >= 0 && Number.isFinite(p.notes[first]) ? p.notes[first] : 36;
          const on = typeof p.steps[0] === "boolean" ? true : 1, off = typeof p.steps[0] === "boolean" ? false : 0;
          for (let j = 0; j < spb; j++) {
            const v = rollVelocity(Math.floor((j * barLen) / spb), barLen);
            const k = i * spb + j;
            p.steps[k] = v ? on : off;
            if (!v) continue;
            p.notes[k] = note; p.lengths[k] = 1; p.velocities[k] = v; p.chords[k] = ""; p.ratchets[k] = 1;
          }
        }
      }
      patterns[g.slot] = p;
    });
    for (let k = 0; k < patterns.length; k++) if (!patterns[k]) patterns[k] = blankPattern(spb);
    return { ...t, patterns };
  });
  // The bridge slots count in the intro's meter, whatever those slots had.
  const out = { ...base, tracks };
  if (Array.isArray(newS?.patternMeters)) {
    const m = newS.patternMeters[newSlot] || newS.patternMeters[0] || { num: 4, den: 4 };
    const meters = newS.patternMeters.slice();
    for (const g of layout.segs) { while (meters.length <= g.slot) meters.push({ ...(meters[0] || m) }); meters[g.slot] = { num: m.num, den: m.den }; }
    out.patternMeters = meters;
  }
  // And each plays for its bars: the transition holds it there itself, but a
  // reader of the session (the compose tools' validator) is told the same.
  const reps = Array.isArray(newS?.patternRepeats) ? newS.patternRepeats.slice() : [];
  for (const g of layout.segs) { while (reps.length <= g.slot) reps.push(1); reps[g.slot] = g.bars; }
  out.patternRepeats = reps;
  return out;
}

/** Whether two layouts put the same bridge in the same slots, for the same intro. */
export function sameLayout(a, b) {
  // Not `oldSlot`: a bridge written while the old song was on one pattern is
  // still the bridge when its chain has moved to the next.
  return !!a && !!b && a.land === b.land && a.barLen === b.barLen
    && JSON.stringify(a.segs) === JSON.stringify(b.segs);
}

/** Whether a bridge session has any notes in its slots. */
export function bridgeHasNotes(s, layout) {
  return layout.segs.some(g => slotUsed(s, g.slot));
}

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keyOf = (s) => (s?.scale?.active ? `${NOTE[((s.scale.root ?? 0) % 12 + 12) % 12]} ${s.scale.mode}` : "no scale set");

/** A few lines saying what a song is, for a prompt. */
export function songSummary(s) {
  const slot = firstSlot(s);
  const tracks = playing(s).map(t => `${t.name || "track"} (${t.engineKey}, ${trackGroup(t, slot)})`);
  return `${s?.bpm ?? 120} bpm, ${keyOf(s)}; tracks: ${tracks.join(", ") || "none"}`;
}

/**
 * What the model is asked: to rewrite the draft bridge (`codeBridge`, the
 * session it is sent) into a real transition. Everything it needs to place
 * the work is here: which patterns are the bridge and how long each is, which
 * of the new song's patterns it stands in for, which tracks are the outgoing
 * song's, and where the song carries on.
 */
export function bridgePrompt(oldS, newS, layout) {
  const newKeys = new Set((newS?.tracks || []).map(trackKey));
  const outgoing = playing(oldS).filter(t => !newKeys.has(trackKey(t))).map(t => t.name || "track");
  const segs = layout.segs.map(g => `pattern ${g.slot + 1} (index ${g.slot}): ${g.bars} bar${g.bars > 1 ? "s" : ""}, ${g.bars * layout.barLen} steps at speed 1`).join("; then ");
  const intro = layout.intro.sections.map(x => `pattern ${x.slot + 1} for ${x.bars} bar${x.bars > 1 ? "s" : ""}`).join(", then ");
  const after = layout.intro.leadIn
    ? `the bridge leads into this song's start: pattern ${layout.land + 1} follows it from the top`
    : `this song then carries on from pattern ${layout.land + 1} (index ${layout.land}), the section after its intro`;
  return [
    "Write the BRIDGE between two songs: the passage where the song playing now gives way to this one.",
    `This session holds this song's own tracks and, after them, the tracks of the song playing now (the OUTGOING song): ${outgoing.join(", ") || "none of its own, every track is shared"}.`,
    `This song: ${songSummary(newS)}. The outgoing song: ${songSummary(oldS)}; it was on its pattern ${layout.oldSlot + 1}.`,
    `The bridge is ${layout.bars} bar${layout.bars > 1 ? "s" : ""} long, in ${segs}. It plays in that order and STANDS IN FOR this song's intro (${intro}); ${after}, on the downbeat.`,
    "A draft is already written in those bridge patterns: this song's tracks play their intro parts, and the outgoing tracks play what they were playing, simply cut off part way. Rewrite the draft into a real transition:",
    "- This song's intro works its way in across the bridge on its own tracks. Keep it recognisable, bring its parts in gradually where the draft has them all at once, and have all of it there by the last bar.",
    `- The outgoing tracks play the outgoing song's OUTRO over it: rewrite their parts so they hand over rather than stop. Simplify, thin, echo a motif, sit on a root or a pedal, in THIS song's key (${keyOf(newS)}) and at its tempo. They are gone by the end of the bridge.`,
    "- Never two kicks or two basslines at once: in any bar where this song's kick or bass plays, the outgoing one rests.",
    "- End with a fill or a lift into the downbeat that follows.",
    "The transition plays the bridge patterns itself, in order, then moves to the landing: leave the arrangement, the chain and every repeat count alone.",
    "Every part keeps exactly the length its bridge pattern has now. Change ONLY the bridge patterns: no other pattern, no sound, no tempo, scale or track name, and do not add or remove tracks or rename the song.",
  ].join("\n");
}

/**
 * The draft with the bridge slots taken from what the model handed back:
 * matched track for track (the model was told not to add, remove or rename
 * any), and only those slots, so a turn that also touched something else
 * changes nothing else. A part that came back the wrong length keeps the
 * draft's.
 */
export function bridgeSession(draft, result, layout) {
  const got = result?.tracks || [];
  const byKey = new Map();
  got.forEach((t) => { if (!byKey.has(trackKey(t))) byKey.set(trackKey(t), t); });
  const tracks = (draft?.tracks || []).map((t, i) => {
    const r = got[i] && trackKey(got[i]) === trackKey(t) ? got[i] : byKey.get(trackKey(t));
    if (!r || t.engineKey === "bus") return t;
    const patterns = (t.patterns || []).slice();
    for (const g of layout.segs) {
      const mine = patterns[g.slot], theirs = r.patterns?.[g.slot];
      if (!theirs?.steps || !mine?.steps || theirs.steps.length !== mine.steps.length) continue;
      patterns[g.slot] = theirs;
    }
    return { ...t, patterns };
  });
  return { ...draft, tracks };
}
