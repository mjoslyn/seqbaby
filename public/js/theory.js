import { NOTE_NAMES } from "./constants.js";
import { state } from "./state.js";

export const SCALES = {
  off:       null,
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  lydian:    [0, 2, 4, 6, 7, 9, 11],
  mixolydian:[0, 2, 4, 5, 7, 9, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic minor":  [0, 2, 3, 5, 7, 9, 11],
  pentatonic:       [0, 2, 4, 7, 9],
  "minor pentatonic":[0, 3, 5, 7, 10],
  blues:     [0, 3, 5, 6, 7, 10],
  // Exotic / world 12-TET subsets.
  "phrygian dominant": [0, 1, 4, 5, 7, 8, 10],  // Ahava Rabbah / Freygish
  "double harmonic":   [0, 1, 4, 5, 7, 8, 11],  // Byzantine / Arabic
  "hungarian minor":   [0, 2, 3, 6, 7, 8, 11],  // Gypsy minor
  "neapolitan minor":  [0, 1, 3, 5, 7, 8, 11],
  "persian":           [0, 1, 4, 5, 6, 8, 11],
  "enigmatic":         [0, 1, 4, 6, 8, 10, 11], // Verdi
  "hirajoshi":         [0, 2, 3, 7, 8],          // Japanese pentatonic
  "in sen":            [0, 1, 5, 7, 10],         // Japanese
  "iwato":             [0, 1, 5, 6, 10],         // Japanese
  "prometheus":        [0, 2, 4, 6, 9, 10],      // Scriabin
  "whole tone":        [0, 2, 4, 6, 8, 10],
  "octatonic h-w":     [0, 1, 3, 4, 6, 7, 9, 10],
  "octatonic w-h":     [0, 2, 3, 5, 6, 8, 9, 11],
  // Tuning systems (chromatic fills of the selected EDO).
  "12-tet":  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "24-tet":  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],
  // Turkish maqam Hüseyni: D, E½♭, F, G, A, B½♭, C — two quarter-flat inflections.
  "hüseyni": [0, 1.5, 3, 5, 7, 8.5, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// Chord list is grouped: none → basic triads → suspended → altered triads → 7ths → extensions.
// (Note: keys that parse as integers — e.g. "7" — get hoisted to the top by the JS engine,
// which breaks insertion order. Everything here starts with a letter so order is preserved.)
export const CHORD_TYPES = {
  "":     [0],
  "maj":  [0, 4, 7],
  "min":  [0, 3, 7],
  "sus2": [0, 2, 7],
  "sus4": [0, 5, 7],
  "dim":  [0, 3, 6],
  "aug":  [0, 4, 8],
  "maj7": [0, 4, 7, 11],
  "min7": [0, 3, 7, 10],
  "dom7": [0, 4, 7, 10],
  "m7b5": [0, 3, 6, 10],
  "add9": [0, 4, 7, 14],
};
// Accept legacy "7" value from previously-saved patterns.
export const CHORD_ALIASES = { "7": "dom7" };
export function canonicalChord(c) { return CHORD_ALIASES[c] || c; }

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
 */
export function chordNotes(rootMidi, chordType) {
  const tones = CHORD_TYPES[canonicalChord(chordType)] || [0];
  return tones.map(i => rootMidi + i);
}

/**
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

// ---- icons --------------------------------------------------------------

export function midiToName(m) {
  const raw = Number(m);
  if (!Number.isFinite(raw)) return "";
  // Microtonal pitches (quarter tones etc.) display with a cents offset against
  // the nearest semitone, e.g. "D2-50c" for D2 minus a quarter tone.
  const base = Math.round(raw);
  const cents = Math.round((raw - base) * 100);
  const name = NOTE_NAMES[((base % 12) + 12) % 12] + (Math.floor(base / 12) - 1);
  return cents === 0 ? name : `${name}${cents > 0 ? "+" : ""}${cents}c`;
}
export function nameToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1].toUpperCase()];
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return base + acc + (Number(m[3]) + 1) * 12;
}

// ---- sample buffer cache -----------------------------------------------

