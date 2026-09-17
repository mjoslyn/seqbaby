import { state } from "./state.js";
// The scales, the chord types and the note names are data in theoryData.js
// (no imports but constants.js, readable from Node); re-exported so the imports
// elsewhere hold. applyScale and the rest, which read the live session, stay.
import { CHORD_TYPES, SCALES, canonicalChord, chordNotes, midiToName, nameToMidi } from "./theoryData.js";
export { SCALES, CHORD_TYPES, CHORD_ALIASES, canonicalChord, chordNotes, midiToName, nameToMidi } from "./theoryData.js";

// Snap a MIDI value to the nearest pitch allowed by `intervals` (pc set, mod 12).
// Interval step is auto-detected: 0.5 when any interval is non-integer (24-EDO /
// Hüseyni), 1 otherwise (12-EDO). Returns fractional MIDI for microtonal scales.
/**
 * Snap a MIDI note to the nearest pitch in a scale.
 * @param {number} midi @param {number} rootPc @param {number[]} intervals @returns {number}
 */
export function quantizeToScale(midi, rootPc, intervals) {
  if (!intervals) return midi;
  const step = intervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const EPS = 1e-6;
  const target = Math.round(midi / step) * step;
  let best = target;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d += step) {
    const candidate = target + d;
    const relative = ((candidate - rootPc) % 12 + 12) % 12;
    if (intervals.some(i => Math.abs(i - relative) < EPS)) {
      if (Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = candidate;
      }
    }
  }
  return best;
}

export function applyScale(midi) {
  if (!state.scale.active) return midi;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return midi;
  return quantizeToScale(midi, state.scale.root, intervals);
}

export function midiToScaleIndex(midi, rootPc, intervals) {
  const q = quantizeToScale(midi, rootPc, intervals);
  const pcDiff = ((q - rootPc) % 12 + 12) % 12;
  const EPS = 1e-6;
  const pos = intervals.findIndex(i => Math.abs(i - pcDiff) < EPS);
  if (pos < 0) return null;
  const octave = Math.floor((q - rootPc) / 12);
  return octave * intervals.length + pos;
}

export function scaleIndexToMidi(idx, rootPc, intervals) {
  const N = intervals.length;
  const octave = Math.floor(idx / N);
  let pos = idx % N;
  if (pos < 0) pos += N;
  return rootPc + octave * 12 + intervals[pos];
}

/**
 * Expand a chord type into absolute MIDI notes above a root.
 * @param {number} rootMidi @param {string} chordType @returns {number[]}
 *//**
 * The CHORD_TYPES key whose intervals match `tones` (measured from the lowest
 * tone), or "" when the voicing isn't one of them. Lets a chord that was *played*
 * be stored the way the step editor stores one — root + chord type — instead of
 * a stack of explicit notes, so the piano roll shows a single labelled root.
 * @param {number[]} tones @returns {string}
 */
export function chordTypeForTones(tones) {
  if (!Array.isArray(tones) || tones.length < 2) return "";
  const sorted = tones.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return "";
  const rel = sorted.map(n => n - sorted[0]);
  const EPS = 1e-6;
  for (const [key, ivs] of Object.entries(CHORD_TYPES)) {
    if (!key || ivs.length !== rel.length) continue;
    if (ivs.every((v, i) => Math.abs(v - rel[i]) < EPS)) return key;
  }
  return "";
}

/**
 * Build a diatonic chord by stacking scale-thirds from a root, entirely within
 * the active scale — so the quality (maj/min/dim…) follows the scale degree
 * automatically. Used for keyboard chord mode while a scale is on.
 * @param {number} rootMidi @param {number} count notes to stack (3 = triad) @returns {number[]}
 */
export function diatonicChordNotes(rootMidi, count = 3) {
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return [rootMidi];
  const rootPc = state.scale.root;
  const idx = midiToScaleIndex(rootMidi, rootPc, intervals);
  if (idx == null) return [rootMidi];
  const out = [];
  for (let i = 0; i < count; i++) out.push(scaleIndexToMidi(idx + i * 2, rootPc, intervals));
  return out;
}

// Diatonic note coloring: each chromatic pitch class gets a fixed hue
// (30° per semitone) so the same note always reads the same color regardless
// of key — C red, D yellow, F# cyan, A purple, etc. Gated by the palette
// toggle (state.noteColors); returns null when off so callers fall back to
// the accent color.
export function noteColor(midi) {
  if (!state.noteColors) return null;
  if (midi == null || !Number.isFinite(midi)) return null;
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return `hsl(${pc * 30} 72% 56%)`;
}

// Does every tone of chordKey (rooted at rootMidi) fall on the active scale?
// Returns true when no scale is active.
export function chordFitsScale(rootMidi, chordKey) {
  if (!state.scale.active) return true;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return true;
  const tones = CHORD_TYPES[canonicalChord(chordKey)];
  if (!tones) return false;
  for (const st of tones) {
    const pc = ((rootMidi + st) % 12 + 12) % 12;
    const rel = ((pc - state.scale.root) % 12 + 12) % 12;
    if (!intervals.includes(rel)) return false;
  }
  return true;
}

// ---- icons --------------------------------------------------------------// ---- sample buffer cache -----------------------------------------------

