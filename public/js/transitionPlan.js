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
  if (shape === "cut" || shape === "stagger" || shape === "bridge") return "jump";
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

// ---- bridge: a section written for the join ---------------------------------
//
// The model is asked for a bridge exactly `bars` bars long, written into a
// free pattern slot of the NEW song with the new song's tracks, leading out of
// the song playing now. The engine plays that slot for those bars, then the
// new song from where it starts. Only the bridge slot is taken from what the
// model hands back (and any track it added for the bridge), so a turn that
// also touched the song's other patterns or its sounds changes nothing else.

export const BANK = 32;

function slotUsed(s, k) {
  return (s?.tracks || []).some(t => (t.patterns?.[k]?.steps || []).some(Boolean));
}

/** The slot a bridge goes in: the first empty one after the last used, else the first empty one. -1 when full. */
export function freeSlot(s) {
  let last = -1;
  for (let k = 0; k < BANK; k++) if (slotUsed(s, k)) last = k;
  if (last + 1 < BANK && !slotUsed(s, last + 1)) return last + 1;
  for (let k = 0; k < BANK; k++) if (!slotUsed(s, k)) return k;
  return -1;
}

/** Sixteenths in a bar of `slot`'s meter (an unset slot follows slot 0's). */
export function barSteps(s, slot) {
  const m = s?.patternMeters?.[slot] || s?.patternMeters?.[0] || { num: 4, den: 4 };
  const num = Math.max(1, Number(m.num) || 4), den = Math.max(1, Number(m.den) || 4);
  return Math.max(1, Math.round((num * 16) / den));
}

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** A few lines saying what a song is, for a prompt. */
export function songSummary(s) {
  const slot = s?.activePattern ?? 0;
  const sc = s?.scale?.active ? `${NOTE[((s.scale.root ?? 0) % 12 + 12) % 12]} ${s.scale.mode}` : "no scale set";
  const tracks = (s?.tracks || [])
    .filter(t => t.engineKey !== "bus")
    .map(t => `${t.name || "track"} (${t.engineKey}, ${trackGroup(t, slot)})`);
  return `${s?.bpm ?? 120} bpm, ${sc}; tracks: ${tracks.join(", ") || "none"}`;
}

/** What the model is asked, for a bridge into `newS` from `oldS`. */
export function bridgePrompt(oldS, newS, slot, bars, startSlot) {
  const steps = bars * barSteps(newS, slot);
  return [
    `Write a bridge: a transition section exactly ${bars} bar${bars > 1 ? "s" : ""} long (${steps} steps at speed 1), in pattern ${slot + 1} (index ${slot}), which is empty.`,
    `It plays right after the song that is playing now and leads into this song's pattern ${startSlot + 1} (index ${startSlot}), which follows it on the downbeat.`,
    `The song playing now: ${songSummary(oldS)}.`,
    `This song (the one you are editing, where the bridge goes): ${songSummary(newS)}.`,
    "Use this song's tracks. Set every track you use to exactly that length in that pattern. Build toward the downbeat that follows (a fill, a riser, thinning or a build), and carry something over from the song playing now where it helps (its tempo feel, a rhythm, a note). Do not change any other pattern, any sound, the tempo or the scale, and do not rename the song.",
  ].join("\n");
}

/** `newS` with the bridge slot (and any track added for it) taken from `result`. */
export function bridgeSession(newS, result, slot) {
  const key = t => `${t.engineKey}\u0000${t.name}`;
  const fromResult = new Map();
  for (const t of result?.tracks || []) if (!fromResult.has(key(t))) fromResult.set(key(t), t);
  const tracks = (newS?.tracks || []).map(t => {
    const r = fromResult.get(key(t));
    fromResult.delete(key(t));
    if (!r?.patterns?.[slot]) return t;
    const patterns = (t.patterns || []).slice();
    patterns[slot] = r.patterns[slot];
    return { ...t, patterns };
  });
  // A track the model added for the bridge plays the bridge slot only.
  for (const r of fromResult.values()) {
    if (!r?.patterns?.[slot] || !(r.patterns[slot].steps || []).some(Boolean)) continue;
    const empty = (p) => ({ ...p, steps: (p.steps || []).map(() => false) });
    const patterns = (r.patterns || []).map((p, k) => (k === slot ? p : empty(p || {})));
    tracks.push({ ...r, patterns, outIndex: -1, compSourceIndex: -1 });
  }
  return { ...newS, tracks };
}

/** Whether a bridge session has anything in its slot. */
export function bridgeHasNotes(s, slot) {
  return slotUsed(s, slot);
}

// ---- a bridge with no wait: one made from the new song itself -------------
//
// The model's bridge is a compose turn of its own and takes as long as one.
// A press must not wait on it, so until it is written this one plays: the new
// song's start pattern carried across the bridge's bars, its drums kept, the
// kick out and a snare (or clap) rolling up through the last bar, the bass and
// the lead out, the chords carried. Built in code, instantly, from what the
// new song already has; the model's replaces it once it is ready.

const KICK_RE = /kick|\bbd\b|siege|808-kick|909-kick/i;
const SNARE_RE = /snare|clap|\bsd\b|\bcp\b|lancet|rim/i;

/** `len` steps of `p`, every per-step array tiled from its own length. */
function tilePattern(p, len) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (Array.isArray(v)) {
      const n = v.length || 1;
      out[k] = Array.from({ length: len }, (_, i) => (v.length ? clone(v[i % n]) : null));
    } else if (k === "automation" && v && typeof v === "object") {
      const lanes = {};
      for (const [lk, lane] of Object.entries(v)) {
        const vals = Array.isArray(lane?.values) && lane.values.length ? lane.values : [0];
        lanes[lk] = { ...lane, values: Array.from({ length: len }, (_, i) => vals[i % vals.length]) };
      }
      out[k] = lanes;
    } else {
      out[k] = clone(v);
    }
  }
  if (!Array.isArray(out.steps)) out.steps = Array(len).fill(false);
  return out;
}

function clone(v) {
  return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * The new song with a bridge written into `slot`, made from its `start`
 * pattern: `bars` bars of it, thinned and built up as above. A session in the
 * shape `bridgeSession` returns, so the engine plays it exactly as it would
 * the model's.
 */
export function codeBridge(newS, slot, bars, start = 0) {
  const len = Math.max(1, bars) * barSteps(newS, start);
  const bar = barSteps(newS, start);
  const lastBar = len - bar;
  const tracks = (newS?.tracks || []).map(t => {
    if (t.engineKey === "bus") return t;
    const src = t.patterns?.[start];
    if (!src) return t;
    const group = trackGroup(t, start);
    const p = tilePattern(src, len);
    const off = typeof p.steps[0] === "boolean" ? false : 0;
    const on = typeof p.steps[0] === "boolean" ? true : 1;
    const words = `${t.engineKey} ${t.name}`;
    const clear = (from, to) => { for (let i = from; i < to; i++) p.steps[i] = off; };
    if (group === "bass" || group === "lead") clear(0, len);
    else if (group === "drums" && KICK_RE.test(words)) clear(lastBar, len);
    else if (group === "drums" && SNARE_RE.test(words)) {
      const first = p.steps.findIndex(Boolean);
      const note = first >= 0 && Number.isFinite(p.notes?.[first]) ? p.notes[first] : 36;
      for (let i = lastBar; i < len; i++) {
        const k = i - lastBar;
        const hit = k < bar / 2 ? k % 2 === 0 : true;
        p.steps[i] = hit ? on : off;
        if (!hit) continue;
        if (p.notes) p.notes[i] = note;
        if (p.lengths) p.lengths[i] = 1;
        if (p.velocities) p.velocities[i] = Math.min(1, 0.45 + 0.55 * (k / bar));
        if (p.chords) p.chords[i] = null;
        if (p.ratchets) p.ratchets[i] = 1;
      }
    }
    const patterns = (t.patterns || []).slice();
    while (patterns.length <= slot) patterns.push(null);
    patterns[slot] = p;
    return { ...t, patterns };
  });
  const out = { ...newS, tracks };
  // Nothing left to play (no drums and no chords): the start pattern as it
  // is, rather than bars of silence.
  if (!slotUsed(out, slot)) {
    out.tracks = (newS?.tracks || []).map(t => {
      const src = t.patterns?.[start];
      if (!src || t.engineKey === "bus") return t;
      const patterns = (t.patterns || []).slice();
      while (patterns.length <= slot) patterns.push(null);
      patterns[slot] = tilePattern(src, len);
      return { ...t, patterns };
    });
  }
  return out;
}
