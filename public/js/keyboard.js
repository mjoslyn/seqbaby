// Computer keyboard → notes. When state.kbdNotesOn is on, letter keys play the
// active track's voice, sustaining while held (note-on on keydown, note-off on
// keyup). Layout is Ableton-style: bottom row = white keys (a s d f g h j k l),
// top row = black keys (w e t y u o), z / x shift the octave.
//
// When a scale is active the WHITE keys map to the scale's degrees (root anchored
// near kbdBase) and the black keys play the accidental a semitone above the white
// key to their left. With no scale it's a plain chromatic piano.

import { state } from "./state.js";
import { SCALES, midiToScaleIndex, quantizeToScale, scaleIndexToMidi } from "./theory.js";
import { ensureAudio } from "./transport.js";

// Chromatic offset from the base note (state.kbdBase = the "a" key).
const KEY_SEMITONES = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15,
};
// Scale layout: white keys → scale-degree offsets; black keys → the accidental
// above the white key to their left.
const WHITE_DEGREE = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7, l: 8, p: 9 };
const BLACK_LEFT   = { w: "a", e: "s", t: "f", y: "g", u: "h", o: "k" };

const HELD_HIT_DUR = 1.5;      // fallback note length for voices without note-off

// key(lowercase) → { t, midi, usedNoteOn } for currently-held keys.
const held = new Map();

/** The track that receives keyboard notes: the active one, else the first. */
function targetTrack() {
  if (state.activeTrackId != null) {
    const t = state.tracks.find(x => x.id === state.activeTrackId);
    if (t) return t;
  }
  return state.tracks[0] || null;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Resolve a key to a MIDI note for the current mode (chromatic or scale).
function noteForKey(k) {
  const semi = KEY_SEMITONES[k];
  if (semi == null) return null;
  const intervals = state.scale.active ? SCALES[state.scale.mode] : null;
  if (!intervals) return clampNote(state.kbdBase + semi);
  const root = state.scale.root | 0;
  const baseIdx = midiToScaleIndex(quantizeToScale(state.kbdBase, root, intervals), root, intervals) ?? 0;
  if (WHITE_DEGREE[k] != null) return clampNote(scaleIndexToMidi(baseIdx + WHITE_DEGREE[k], root, intervals));
  const leftWhite = BLACK_LEFT[k];
  if (leftWhite != null) return clampNote(scaleIndexToMidi(baseIdx + WHITE_DEGREE[leftWhite], root, intervals) + 1);
  return clampNote(state.kbdBase + semi);
}
const clampNote = n => Math.max(0, Math.min(127, Math.round(n)));

// Mirror the transport's per-hit sample options so a sampler/granular voice plays
// its region / fades / slices; harmless (ignored) for the synth voices.
function hitOptsFor(t) {
  const sd = t.sampleDefaults || {};
  return {
    startOffset: sd.start ?? 0, endOffset: sd.end ?? 1,
    fadeIn: sd.fadeIn ?? 0, fadeOut: sd.fadeOut ?? 0, loopMode: sd.loopMode ?? "off",
    pitchBase: t.isDrumKit ? 36 : 60, isDrumKit: t.isDrumKit,
    sampleSpeedMode: t.sampleSpeedMode, pitchLocked: t.pitchLock !== false,
  };
}

async function pressNote(k, midi) {
  const t = targetTrack();
  if (!t) return;
  await ensureAudio();
  if (!t.voice || !held.has(k)) return;   // key may have been released during await
  const now = state.audioCtx.currentTime + 0.01;
  const opts = hitOptsFor(t);
  const rec = held.get(k);
  rec.t = t; rec.midi = midi;
  if (typeof t.voice.noteOn === "function") {
    rec.usedNoteOn = true;
    try { t.voice.noteOn(midi, now, 0.85, opts); } catch (e) { console.warn("kbd noteOn", e); }
  } else {
    rec.usedNoteOn = false;
    try { t.voice.hit(midi, now, HELD_HIT_DUR, 0.85, opts); } catch (e) { console.warn("kbd hit", e); }
  }
}

function releaseNote(k) {
  const rec = held.get(k);
  held.delete(k);
  if (!rec || !rec.usedNoteOn || !rec.t?.voice) return;
  const now = (state.audioCtx?.currentTime ?? 0) + 0.005;
  try { rec.t.voice.noteOff?.(rec.midi, now); } catch (e) { console.warn("kbd noteOff", e); }
}

function onKeyDown(e) {
  if (!state.kbdNotesOn || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === "z") { state.kbdBase = Math.max(0, state.kbdBase - 12); e.preventDefault(); return; }
  if (k === "x") { state.kbdBase = Math.min(108, state.kbdBase + 12); e.preventDefault(); return; }
  if (KEY_SEMITONES[k] == null || held.has(k)) return;
  const midi = noteForKey(k);
  if (midi == null) return;
  held.set(k, { t: null, midi, usedNoteOn: false });
  e.preventDefault();
  pressNote(k, midi);
}

function onKeyUp(e) { releaseNote((e.key || "").toLowerCase()); }

let _installed = false;
export function initComputerKeyboard() {
  if (_installed) return;
  _installed = true;
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", resetKbdKeys);
}

/** Release + forget all held keys — call when the feature is toggled off. */
export function resetKbdKeys() {
  for (const k of [...held.keys()]) releaseNote(k);
  held.clear();
}
