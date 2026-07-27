import { setStatus } from "./dom.js";
import { patternMeter, stepsPerBeatForMeter } from "./meter.js";
import { setParam } from "./params.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, midiToScaleIndex, quantizeToScale, scaleIndexToMidi } from "./theory.js";
import { lastUsedNote, maxLengthAt } from "./track.js";


/** @typedef {import("./types.js").Track} Track */
export const RAND_KEYS = ["harm", "timb", "morph", "decay"];
export function randomizeTimbre(t) {
  for (const k of RAND_KEYS) {
    const v = Math.random();
    setParam(t, k, v);
    const input = t.el.querySelector(`.p-${k}`);
    if (input) input.value = String(v);
  }
}

// Pick a weighted note length capped at cap (in sixteenth-note steps). Drum
// hits skew very short; melodic notes get more sustained variation.
export function pickRandomNoteLength(cap, drum) {
  const r = Math.random();
  let len;
  if (drum) {
    if      (r < 0.82) len = 1;
    else if (r < 0.95) len = 2;
    else               len = 3;
  } else {
    if      (r < 0.55) len = 1;
    else if (r < 0.80) len = 2;
    else if (r < 0.92) len = 3;
    else if (r < 0.98) len = 4;
    else               len = 6;
  }
  return Math.max(1, Math.min(len, cap | 0));
}

// Replace the active pattern with a random melody. Drum-kit tracks get a
// random rhythm pinned to C2; melodic tracks walk a random scale-aware path
// around lastUsedNote(). Strong beats are weighted slightly heavier so the
// phrasing reads as musical rather than uniformly noisy.
/**
 * Fill a track's active pattern with a scale-aware random melody.
 * @param {Track} t
 */
export function randomizeMelody(t) {
  const len = t.length;
  t.steps.fill(0);
  t.lengths.fill(0);
  t.notes.fill(null);
  t.velocities.fill(0.7);
  t.chords.fill("");
  t.offsets?.fill(0);
  if (t.arps)         t.arps.fill(false);
  if (t.ratchets)     t.ratchets.fill(1);
  if (t.complexities) t.complexities.fill(0);

  const meter = patternMeter(t._patternIdx ?? state.activePattern);
  const spb = stepsPerBeatForMeter(meter);

  // How full the roll comes out: the level on the track's dice button (drag it
  // up/down). Downbeats stay weighted heavier, but proportionally, so a level of
  // 0 really is empty and 1 really is every step.
  const density = Math.max(0, Math.min(1, t.density ?? 0.5));
  const onBeatP = Math.min(0.98, density * 1.5);

  if (t.isDrumKit) {
    // Rhythmic: downbeat-biased, all notes pinned to C2.
    let i = 0;
    while (i < len) {
      const onBeat = (i % spb) === 0;
      const p = onBeat ? onBeatP : density;
      if (Math.random() > p) { i++; continue; }
      const dur = pickRandomNoteLength(maxLengthAt(t, i), /*drum*/ true);
      t.steps[i] = 1;
      t.lengths[i] = dur;
      t.notes[i] = 36;
      t.velocities[i] = onBeat ? 0.75 + Math.random() * 0.25 : 0.5 + Math.random() * 0.35;
      i += dur;
    }
    renderStepGrid(t);
    setStatus(`"${t.name}" — random pattern`);
    return;
  }

  // Melodic walk. Step size mostly ±1..3 scale degrees with occasional
  // octave leaps; clamp to MIDI 36..84 by folding wrapped notes back inward.
  // Always constrain to the selected scale (root + mode), even when the
  // global scale-quantize toggle is off — the dice is a deliberate musical
  // act and should follow the chosen key.
  const intervals = SCALES[state.scale.mode] || SCALES.minor;
  const rootPc = state.scale.root | 0;
  let current = lastUsedNote(t);
  // Snap the starting note onto the selected scale so the walk begins
  // in-key even if state.scale.active is false or the prior note was chromatic.
  current = quantizeToScale(current, rootPc, intervals);

  let i = 0;
  while (i < len) {
    const onBeat = (i % spb) === 0;
    const p = onBeat ? onBeatP : density;
    if (Math.random() > p) { i++; continue; }

    if (i > 0) {
      const bigJump = Math.random() < 0.08;
      const stepSize = bigJump
        ? (Math.random() < 0.5 ? -7 : 7)
        : Math.round((Math.random() * 2 - 1) * 3);
      const idx = midiToScaleIndex(current, rootPc, intervals);
      if (idx != null) current = scaleIndexToMidi(idx + stepSize, rootPc, intervals);
      else             current = quantizeToScale(current + stepSize, rootPc, intervals);
    }
    // Octave-fold back into a sensible range while staying on scale.
    while (current < 36) current += 12;
    while (current > 84) current -= 12;

    const dur = pickRandomNoteLength(maxLengthAt(t, i), /*drum*/ false);
    t.steps[i] = 1;
    t.lengths[i] = dur;
    t.notes[i] = current;
    t.velocities[i] = onBeat ? 0.7 + Math.random() * 0.3 : 0.5 + Math.random() * 0.35;
    i += dur;
  }

  t.lastEditedNote = current;
  renderStepGrid(t);
  setStatus(`"${t.name}" — random melody`);
}

// ---- track model --------------------------------------------------------

