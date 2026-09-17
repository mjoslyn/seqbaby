// Music theory as data: the scales, the chord types, and note names in and out
// of MIDI. No imports but constants.js (itself import-free of the DOM), on
// purpose -- theory.js reads the live session for applyScale and friends, which
// makes it unloadable outside a browser, and these tables are what
// songBuilder.js and the tests under test/ need. theory.js re-exports them.

import { NOTE_NAMES } from "./constants.js";

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

/**
 * Expand a chord type into absolute MIDI notes above a root.
 * @param {number} rootMidi @param {string} chordType @returns {number[]}
 */
export function chordNotes(rootMidi, chordType) {
  const tones = CHORD_TYPES[canonicalChord(chordType)] || [0];
  return tones.map(i => rootMidi + i);
}

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
