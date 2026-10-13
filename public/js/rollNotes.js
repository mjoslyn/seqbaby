/**
 * A pattern's notes as a free list, and back: what the piano view
 * (pianoView.js) edits. **No imports**, for chanceGen.js's reason: pure
 * functions over plain arrays, so `node --test` runs them
 * (`test/rollNotes.test.js`).
 *
 * The pattern stores notes per STEP: a step that is on is an anchor with a
 * root (`notes`, `lengths`, `velocities`, the chord and every other per-step
 * field) and stacked extras (`extraNotes` / `extraLengths`, never longer than
 * the root). An anchor's length runs at most to the next anchor. A piano roll
 * wants a list of notes, each with a start, a length and a pitch, moved
 * about freely; `readNotes` flattens the steps into one and `writeNotes`
 * folds a list back into the steps, under the step model's rules:
 *
 * - Notes starting on one step share it: the root is the note carrying a
 *   chord if one does, else the longest (ties: the note that was the root
 *   before, then the lowest), and the rest become extras, clamped to its
 *   length.
 * - A step's per-step fields (chord, arp, ratchet, nudge, sample region ...)
 *   travel with its ROOT, from the step it was read from (`src`), so moving
 *   a note moves everything written on it. A note made fresh gets the
 *   pattern's blank values.
 * - The velocity is per step, so a stack takes its root's.
 * - An anchor is cut at the next anchor: a long note under a later one ends
 *   where the later one starts, as it does in the step grid.
 */

/** Every per-step array a note's step carries (the pattern's own list). */
export const NOTE_STEP_KEYS = [
  "lengths", "notes", "velocities", "chords", "offsets",
  "arps", "arpRates", "arpRanges", "arpDirs", "strums", "complexities", "ratchets",
  "sampleStarts", "sampleEnds", "sampleFadeIns", "sampleFadeOuts", "sampleLoopModes",
  "extraNotes", "extraLengths",
];

/** The value an empty step holds in each array (state.js's emptyPattern). */
export const BLANK_STEP = {
  steps: 0, lengths: 0, notes: null, velocities: 0.5, chords: "", offsets: 0,
  arps: false, arpRates: 0.25, arpRanges: 1, arpDirs: "up", strums: 0, complexities: 0, ratchets: 1,
  sampleStarts: 0, sampleEnds: 1, sampleFadeIns: 0, sampleFadeOuts: 0, sampleLoopModes: "off",
  extraNotes: null, extraLengths: null,
};

const EPS = 1e-6;

/**
 * @typedef {{start: number, len: number, pitch: number, vel: number,
 *   root: boolean, src: number|null, chord: string, cpx?: number}} RollNote
 * `chord` is a chord type the root plays (theoryData.js's CHORD_TYPES) and
 * `cpx` its inversion; both are the step's, so only a root carries them.
 */

/**
 * The notes a pattern plays, roots and extras alike, in step order.
 * @param {Record<string, any[]>} p  a pattern, or a track aliased to one
 * @param {number} [len]  steps to read (the pattern's own length by default)
 * @returns {RollNote[]}
 */
export function readNotes(p, len = p?.steps?.length ?? 0) {
  const out = [];
  if (!p?.steps) return out;
  const n = Math.min(len, p.steps.length);
  for (let i = 0; i < n; i++) {
    if (!p.steps[i] || p.notes?.[i] == null) continue;
    const rootLen = Math.max(1, Math.min(n - i, p.lengths?.[i] || 1));
    const vel = Number.isFinite(p.velocities?.[i]) ? p.velocities[i] : 0.5;
    out.push({ start: i, len: rootLen, pitch: p.notes[i], vel, root: true, src: i, chord: p.chords?.[i] || "", cpx: p.complexities?.[i] || 0 });
    const extras = p.extraNotes?.[i];
    const eLens = p.extraLengths?.[i];
    if (!Array.isArray(extras)) continue;
    extras.forEach((m, e) => {
      if (m == null) return;
      const l = Math.max(1, Math.min(rootLen, (Array.isArray(eLens) ? eLens[e] : null) ?? rootLen));
      out.push({ start: i, len: l, pitch: m, vel, root: false, src: i, chord: "" });
    });
  }
  return out;
}

/**
 * Fold a list of notes back into the pattern's step arrays, IN PLACE (a
 * track's arrays are aliases of its pattern's, so they must be the same
 * arrays afterwards). Notes outside `[0, len)` are dropped or cut; two notes
 * of one pitch on one step are one note, the longer.
 * @param {Record<string, any[]>} p
 * @param {Array<Partial<RollNote> & {start: number, len: number, pitch: number}>} notes
 * @param {number} [len]
 * @returns {RollNote[]} the notes as written (readNotes of the result)
 */
export function writeNotes(p, notes, len = p.steps.length) {
  // What each source step carried, taken before anything is cleared.
  const snaps = new Map();
  for (const nt of notes) {
    const s = nt.src;
    if (s == null || snaps.has(s) || s < 0 || s >= p.steps.length) continue;
    const snap = {};
    for (const k of NOTE_STEP_KEYS) if (Array.isArray(p[k])) snap[k] = p[k][s];
    snaps.set(s, snap);
  }
  for (let i = 0; i < len; i++) {
    for (const k of ["steps", ...NOTE_STEP_KEYS]) if (Array.isArray(p[k])) p[k][i] = BLANK_STEP[k];
  }

  // Group by start, one note per pitch per step (the longer one).
  /** @type {Map<number, Map<number, any>>} */
  const groups = new Map();
  for (const raw of notes) {
    const start = Math.round(raw.start);
    if (!(start >= 0 && start < len) || !Number.isFinite(raw.pitch)) continue;
    const nt = { ...raw, start, len: Math.max(1, Math.min(len - start, Math.round(raw.len) || 1)) };
    let g = groups.get(start);
    if (!g) groups.set(start, (g = new Map()));
    const key = Math.round(nt.pitch / EPS);
    const had = g.get(key);
    if (!had || nt.len > had.len || (nt.len === had.len && nt.root && !had.root)) g.set(key, nt);
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);
  starts.forEach((start, gi) => {
    const group = [...groups.get(start).values()];
    group.sort((a, b) =>
      (b.chord ? 1 : 0) - (a.chord ? 1 : 0) || b.len - a.len || (b.root ? 1 : 0) - (a.root ? 1 : 0) || a.pitch - b.pitch);
    const root = group[0];
    const next = gi + 1 < starts.length ? starts[gi + 1] : len;
    const rootLen = Math.max(1, Math.min(root.len, next - start));
    const snap = snaps.get(root.src) ?? group.map((g) => snaps.get(g.src)).find(Boolean) ?? null;
    if (snap) for (const k of NOTE_STEP_KEYS) if (Array.isArray(p[k]) && snap[k] !== undefined) {
      p[k][start] = Array.isArray(snap[k]) ? snap[k].slice() : snap[k];
    }
    p.steps[start] = 1;
    p.notes[start] = root.pitch;
    p.lengths[start] = rootLen;
    if (Array.isArray(p.velocities)) {
      const v = Number(root.vel);
      p.velocities[start] = Number.isFinite(v) ? Math.max(0.05, Math.min(1, v)) : (snap?.velocities ?? 0.5);
    }
    if (Array.isArray(p.chords)) p.chords[start] = root.chord || "";
    if (Array.isArray(p.complexities) && root.cpx != null) p.complexities[start] = root.chord ? root.cpx | 0 : 0;
    const extras = group.slice(1);
    if (Array.isArray(p.extraNotes)) p.extraNotes[start] = extras.length ? extras.map((e) => e.pitch) : null;
    if (Array.isArray(p.extraLengths)) p.extraLengths[start] = extras.length ? extras.map((e) => Math.min(rootLen, e.len)) : null;
  });
  return readNotes(p, len);
}

/**
 * The notes sounding at a step (for the keys to light under the playhead).
 * @param {RollNote[]} notes @param {number} step @returns {number[]} pitches
 */
export function pitchesAt(notes, step) {
  const out = [];
  for (const n of notes) if (step >= n.start && step < n.start + n.len) out.push(n.pitch);
  return out;
}
