/**
 * The chance generator proper — the dice, the note-value ladder and the walk
 * that turns a set of odds into a part.
 *
 * No imports, deliberately, and for the two reasons `sessionFormat.js` has
 * none. The first is that `constants.js` needs the mod-key tables at the top of
 * the module graph, and every other engine module touches the DOM or Tone at
 * import time. The second is the better one: the generator is a pure function
 * from a settings object to a list of notes, so `node --test` can exercise it
 * outside a browser — which for the one part of this app whose output is
 * *random* is worth a great deal. A generator you cannot assert on is a
 * generator you cannot tell from a broken one.
 *
 * chance.js is the track-and-DOM half: live modulation, the panel, writing the
 * pattern. Everything here is arithmetic.
 *
 * See chance.js for what the machine this models does with each control.
 */

/**
 * @typedef {Object} ChanceConfig
 * @property {boolean} on     Live mode: the transport generates instead of reading steps.
 * @property {number} note    Index into CHANCE_NOTE_VALUES — the base note length.
 * @property {number} var     −1..1. Below zero brings in longer values, above it shorter; 0 is off.
 * @property {number} leg     0..1 probability a note ties to the one before instead of gating.
 * @property {number} rest    0..1 probability a note becomes a rest.
 * @property {number[]} pcs   Twelve 0..1 probabilities, C first.
 * @property {number} lo      Lowest playable note, MIDI.
 * @property {number} hi      Highest playable note, MIDI.
 * @property {number} first   First step of the generated window.
 * @property {number} last    Last step of the generated window.
 * @property {boolean} trips  Let variation reach the triplet values.
 * @property {boolean} x32    Let variation reach 1/32 notes.
 * @property {number} rseed   The rhythm section's current throw.
 * @property {number} mseed   The melody section's current throw.
 * @property {boolean} rfree  Rhythm in realtime-mode: a new throw every pass.
 * @property {boolean} mfree  Melody in realtime-mode.
 */

/**
 * The note-value ladder, longest first — the machine's own eight, in the order
 * its edit-parameter table prints them.
 *
 * `span` is how many sixteenth steps the value occupies on the grid and `hits`
 * how many notes are played inside it, which is what makes the triplets and the
 * 1/32s expressible at all: seqbaby's transport runs on sixteenths, so a 1/8
 * triplet is not a step length but three notes evenly across a quarter — which
 * is exactly the step ratchet the transport already has. A 1/32 is one step
 * ratcheted twice, a 1/8T four steps ratcheted three times, a 1/4T eight.
 */
export const CHANCE_NOTE_VALUES = [
  { label: "1/1",  span: 16, hits: 1 },
  { label: "1/2",  span: 8,  hits: 1 },
  { label: "1/4",  span: 4,  hits: 1 },
  { label: "1/4T", span: 8,  hits: 3 },
  { label: "1/8",  span: 2,  hits: 1 },
  { label: "1/8T", span: 4,  hits: 3 },
  { label: "1/16", span: 1,  hits: 1 },
  { label: "1/32", span: 1,  hits: 2 },
];
/** Which ladder entries are triplets / 1/32s — the two families `trips` and
 *  `x32` switch in and out of variation's reach. */
const TRIPLET_IDX = new Set([3, 5]);
const X32_IDX = new Set([7]);

/** The lowest and highest note the range knobs reach, and the widest span
 *  between them — five octaves, as on the machine. */
export const CHANCE_NOTE_MIN = 24, CHANCE_NOTE_MAX = 96, CHANCE_SPAN_MAX = 60;

/** @type {ChanceConfig} */
export const CHANCE_DEFAULTS = {
  on: false,
  note: 4, var: 0, leg: 0, rest: 0,
  // A minor pentatonic on C, so the first throw is already music rather than a
  // chromatic scramble — and so the panel never arrives in the all-zero state,
  // which has nothing it can play.
  pcs: [1, 0, 0, 0.7, 0, 0.6, 0, 0.9, 0, 0, 0.5, 0],
  lo: 48, hi: 72,
  first: 0, last: 15,
  trips: false, x32: false,
  rseed: 1, mseed: 1,
  rfree: false, mfree: false,
};

/**
 * The six modulatable controls, in every namespace they answer to:
 * `p-chn<key>` / `chance_<key>` / `chance.<key>`, as in hexop.js.
 *
 * Six and not eighteen: these are precisely the ones the hardware puts under
 * control voltage (CV IN 2 doubles the four rhythm knobs, CV IN 1 the two range
 * faders). The twelve semitone probabilities, the window and the dice are knobs
 * and buttons only — which is also what keeps one generator from adding a
 * seventh of the app's mod targets on its own.
 */
export const CHANCE_MOD_KEYS = ["note", "var", "leg", "rest", "lo", "hi"];
export const CHANCE_MOD_LABELS = {
  note: "chance note value", var: "chance variation", leg: "chance legato",
  rest: "chance rest", lo: "chance range low", hi: "chance range high",
};
/**
 * Each control's span. A constant table, unlike euclid's — none of these six is
 * bounded by the track's length, so nothing here is a function of a track.
 */
export const CHANCE_MOD_RANGE = {
  note: [0, CHANCE_NOTE_VALUES.length - 1], var: [-1, 1], leg: [0, 1], rest: [0, 1],
  lo: [CHANCE_NOTE_MIN, CHANCE_NOTE_MAX], hi: [CHANCE_NOTE_MIN, CHANCE_NOTE_MAX],
};
/** The ones that are counts rather than amounts, so a modulated value rounds. */
export const CHANCE_MOD_INT = new Set(["note", "lo", "hi"]);

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

// ---- the dice ------------------------------------------------------------

/**
 * 0..1 for one decision. `seed` is the throw, `n` the step it is being made at
 * and `stream` which decision it is — so length, rest, tie and pitch are
 * independent sequences off one throw, and turning one knob cannot reshuffle
 * another's answers.
 *
 * Mixed in the same shape as the random square LFO's hash (lfo.js), for the same
 * reason: several code paths have to agree on the answer from the step index
 * alone, with nothing shared between them and nothing extra in the saved song.
 * @param {number} seed @param {number} n @param {number} stream @returns {number}
 */
export function roll(seed, n, stream) {
  let h = ((seed | 0) ^ Math.imul((n | 0) + 1, 0x9e3779b1) ^ Math.imul(stream | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const S_LEN = 1, S_DIST = 2, S_REST = 3, S_TIE = 4, S_PITCH = 5;

/** A fresh throw. Never 0 — a zero seed is indistinguishable from an unset one. */
export function newThrow() {
  return ((Math.random() * 0xffffffff) >>> 0) || 1;
}

/** How the two sections' throws move on in realtime-mode: one number per pass,
 *  mixed into the seed, so the pass count is the only state realtime-mode needs. */
const passSeed = (seed, pass, salt) => ((seed | 0) ^ Math.imul((pass | 0) + 1, salt)) >>> 0;

// ---- settings ------------------------------------------------------------

/**
 * A settings object copied deep enough to be independent — `pcs` is an array, so
 * a spread alone would share it between a track and its duplicate.
 * @param {ChanceConfig|null|undefined} c
 */
export function cloneChance(c) {
  if (!c) return null;
  return { ...c, pcs: Array.isArray(c.pcs) ? c.pcs.slice() : CHANCE_DEFAULTS.pcs.slice() };
}

/**
 * A stored settings object filled in and clamped — defaults for anything absent,
 * and the two one-sided bounds the machine has: the range cannot run backwards
 * or span more than five octaves, and the last step cannot precede the first.
 * The track's length is the only thing from outside, and it can shrink
 * underneath a window (the length buttons).
 * @param {Partial<ChanceConfig>|null|undefined} src @param {number} len
 * @returns {ChanceConfig}
 */
export function normalizeChance(src, len) {
  const n = Math.max(1, len | 0);
  const s = src || {};
  const first = clampInt(s.first ?? 0, 0, n - 1);
  const lo = clampInt(s.lo ?? CHANCE_DEFAULTS.lo, CHANCE_NOTE_MIN, CHANCE_NOTE_MAX);
  return {
    on: !!s.on,
    note: clampInt(s.note ?? CHANCE_DEFAULTS.note, 0, CHANCE_NOTE_VALUES.length - 1),
    var: clampNum(s.var ?? 0, -1, 1),
    leg: clampNum(s.leg ?? 0, 0, 1),
    rest: clampNum(s.rest ?? 0, 0, 1),
    pcs: Array.from({ length: 12 }, (_, i) =>
      clampNum(Array.isArray(s.pcs) ? s.pcs[i] : CHANCE_DEFAULTS.pcs[i], 0, 1)),
    lo,
    hi: clampInt(s.hi ?? CHANCE_DEFAULTS.hi, lo, Math.min(CHANCE_NOTE_MAX, lo + CHANCE_SPAN_MAX)),
    first,
    last: clampInt(s.last ?? n - 1, first, n - 1),
    trips: !!s.trips,
    x32: !!s.x32,
    rseed: (s.rseed | 0) || 1,
    mseed: (s.mseed | 0) || 1,
    rfree: !!s.rfree,
    mfree: !!s.mfree,
  };
}

/** The generated window's length in steps. @param {ChanceConfig} c */
export function chanceWindow(c) {
  return Math.max(1, (c.last | 0) - (c.first | 0) + 1);
}

/** A 0..1 modulation value in a control's own units. */
export function chanceFromUnit(key, u) {
  const [lo, hi] = CHANCE_MOD_RANGE[key] || [0, 1];
  const v = lo + Math.max(0, Math.min(1, u)) * (hi - lo);
  return CHANCE_MOD_INT.has(key) ? clampInt(v, lo, hi) : clampNum(v, lo, hi);
}

/** A control's value back to the 0..1 an LFO swings around. */
export function chanceToUnit(key, v) {
  const [lo, hi] = CHANCE_MOD_RANGE[key] || [0, 1];
  return hi > lo ? Math.max(0, Math.min(1, (Number(v) - lo) / (hi - lo))) : 0;
}

// ---- the draws -----------------------------------------------------------

/**
 * Which ladder entries variation is allowed to reach. The base NOTE VALUE is
 * always chosen from all eight — the machine is explicit that switching the
 * triplets off restricts variation and not the knob.
 * @param {ChanceConfig} c @returns {number[]} ladder indices, longest first
 */
function ladderFor(c) {
  const out = [];
  for (let i = 0; i < CHANCE_NOTE_VALUES.length; i++) {
    if (TRIPLET_IDX.has(i) && !c.trips) continue;
    if (X32_IDX.has(i) && !c.x32) continue;
    out.push(i);
  }
  return out;
}

/**
 * The note value for a note starting at window position `p`: the base one, or —
 * with probability |var| — one that many places longer (var below zero) or
 * shorter (above it) along the ladder.
 *
 * |var| does double duty, as it does under the knob: it is both how often
 * another value turns up and how far from the base it strays.
 * @param {ChanceConfig} c @param {number[]} lad @param {number} p @param {number} seed
 */
function drawValue(c, lad, p, seed) {
  const base = CHANCE_NOTE_VALUES[c.note];
  const amt = Math.abs(c.var);
  if (amt < 1e-3 || !lad.length) return base;
  if (roll(seed, p, S_LEN) >= amt) return base;
  // Where the base sits among the values variation may use. It need not be one
  // of them (a 1/8T base with triplets switched off), so take the nearest.
  let at = 0;
  for (let i = 1; i < lad.length; i++) {
    if (Math.abs(lad[i] - c.note) < Math.abs(lad[at] - c.note)) at = i;
  }
  // Longer values are earlier in the ladder, so variation turned left (var < 0)
  // walks towards the front.
  const reach = 1 + Math.floor(amt * 2.999);
  const dist = 1 + Math.floor(roll(seed, p, S_DIST) * reach);
  const to = Math.max(0, Math.min(lad.length - 1, at + (c.var < 0 ? -dist : dist)));
  return CHANCE_NOTE_VALUES[lad[to]];
}

/**
 * The notes the semitone probabilities and the range make available, and the
 * weight of each. One entry per playable MIDI note, weighted by its pitch
 * class's fader — so raising one fader adds that note in every octave of the
 * range at once, which is what makes twelve faders a scale rather than twelve
 * notes.
 *
 * A pitch class raised but out of range contributes nothing, exactly as the
 * manual says it should.
 * @param {ChanceConfig} c
 */
export function chanceCandidates(c) {
  const notes = [], weights = [];
  let total = 0;
  for (let n = c.lo; n <= c.hi; n++) {
    const w = c.pcs[((n % 12) + 12) % 12];
    if (w <= 0) continue;
    notes.push(n); weights.push(w); total += w;
  }
  return { notes, weights, total };
}

/**
 * Pick a note. A weighted draw over the candidates, so a fader at 50% against
 * one at 100% turns up half as often — and a single raised fader is certain
 * whatever height it sits at, exactly as the manual promises.
 *
 * With every fader down there is nothing to choose from. Rather than fall silent
 * (the rhythm is still there, and a silent generator reads as a broken one) the
 * range's low note plays, and the panel says why.
 */
function drawNote(cand, c, p, seed) {
  if (!cand.total) return c.lo;
  let r = roll(seed, p, S_PITCH) * cand.total;
  for (let i = 0; i < cand.notes.length; i++) {
    r -= cand.weights[i];
    if (r <= 0) return cand.notes[i];
  }
  return cand.notes[cand.notes.length - 1];
}

// ---- the walk ------------------------------------------------------------

/**
 * One throw, as one entry per step of the window: `{span, hits, vel, note}`
 * where a note starts, null everywhere else — both the rests and the steps a
 * note already sounding covers.
 *
 * This walk IS the generator, and it is what separates it from euclid's: the
 * rhythm is a chain of note values laid end to end from the window's first step
 * — draw a length, decide what happens over that length, advance — rather than a
 * yes/no per step. A rest empties a slot, a tie hands the slot to the note
 * before it, and anything else is a note of its own. That is why the part has
 * phrasing instead of holes.
 *
 * @param {ChanceConfig} c
 * @param {Object} [opts]
 * @param {number} [opts.spb]   Steps per beat, for where the accents fall.
 * @param {number} [opts.rpass] Which pass of the window, for realtime rhythm.
 * @param {number} [opts.mpass] Which pass, for realtime melody.
 * @returns {({span: number, hits: number, vel: number, note: number}|null)[]}
 */
export function buildChancePlan(c, opts = {}) {
  const spb = Math.max(1, opts.spb || 4);
  const win = chanceWindow(c);
  const lad = ladderFor(c);
  const cand = chanceCandidates(c);
  // Realtime-mode moves the throw on every pass; dice-mode holds it, which is
  // the whole point of the dice.
  const rseed = c.rfree ? passSeed(c.rseed, opts.rpass || 0, 0x27d4eb2d) : c.rseed;
  const mseed = c.mfree ? passSeed(c.mseed, opts.mpass || 0, 0x165667b1) : c.mseed;

  const plan = new Array(win).fill(null);
  let prev = -1;                       // window position of the last note placed
  let p = 0;
  while (p < win) {
    const val = drawValue(c, lad, p, rseed);
    // A value that would run off the end of the window is cut to what is left:
    // the window loops, so no note crosses its seam.
    const span = Math.max(1, Math.min(val.span, win - p));
    // A cut value loses its ratchet with its length. The triplets and the 1/32s
    // are a span AND a number of strikes inside it, so a 1/4T squeezed from
    // eight steps into six would play three notes across a dotted quarter —
    // which is not a triplet, it is a wrong note value wearing a triplet's name.
    // Cut, it is a plain note of whatever room was left.
    const hits = span === val.span ? val.hits : 1;
    if (roll(rseed, p, S_REST) < c.rest) {
      // A rest. Nothing sounds, and the note before it has already ended.
      prev = -1;
    } else if (prev >= 0 && roll(rseed, p, S_TIE) < c.leg) {
      // A tie: the pitch would change with no new gate, so the note before is
      // held across this slot instead. That is legato at one pitch — a tie — and
      // it is what legato at the far right means: a single held note.
      plan[prev].span += span;
    } else {
      plan[p] = {
        span,
        hits,
        note: drawNote(cand, c, p, mseed),
        // On the beat is louder, as everywhere else in the app that generates a
        // rhythm. The window can start anywhere, so beats are counted from the
        // track's step rather than the window's position.
        vel: ((c.first + p) % spb) === 0 ? 0.95 : 0.68,
      };
      prev = p;
    }
    p += span;
  }
  return plan;
}
