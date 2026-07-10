// Computer keyboard → notes. Letter keys always play the active track's voice
// (except while a text field is focused), sustaining while held (note-on on
// keydown, note-off on keyup). Layout is Ableton-style: bottom row = white keys
// (a s d f g h j k l),
// top row = black keys (w e t y u o), z / x shift the octave.
//
// When a scale is active the WHITE keys map to the scale's degrees (root anchored
// near kbdBase) and the black keys play the accidental a semitone above the white
// key to their left. With no scale it's a plain chromatic piano.

import { currentBpm } from "./lfo.js";
import { invertChord, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { resizeTrack } from "./track.js";
import { SCALES, chordNotes, midiToScaleIndex, quantizeToScale, scaleIndexToMidi } from "./theory.js";
import { ensureAudio } from "./transport.js";

const KBD_REC_VEL = 0.85;
const CAPTURE_WINDOW_SEC = 32;   // rolling lookback buffer for "capture"
const CAPTURE_GAP_SEC = 1.5;     // silence gap that separates phrases

// Rolling buffer of recently-played notes { midi, time } for Ableton-style
// retroactive capture — always accumulating while the keyboard plays.
const captureBuffer = [];
function bufferForCapture(midi, time) {
  captureBuffer.push({ midi, time });
  const cutoff = time - CAPTURE_WINDOW_SEC;
  while (captureBuffer.length && captureBuffer[0].time < cutoff) captureBuffer.shift();
  if (captureBuffer.length > 4000) captureBuffer.splice(0, captureBuffer.length - 4000);
}

// Chromatic offset from the base note (state.kbdBase = the "a" key).
const KEY_SEMITONES = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15,
};
// Scale layout: white keys → scale-degree offsets; black keys → the accidental
// above the white key to their left.
const WHITE_DEGREE = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7, l: 8, p: 9 };
const BLACK_LEFT   = { w: "a", e: "s", t: "f", y: "g", u: "h", o: "k" };

// Desktop-only: mobile has no physical keyboard (and the kbd controls are hidden
// by CSS below the 768px breakpoint), so note keys are gated to desktop widths.
const _desktopMQ = typeof matchMedia === "function" ? matchMedia("(min-width: 769px)") : null;
export function isDesktopKeyboard() { return _desktopMQ ? _desktopMQ.matches : true; }

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

// True only for fields that actually consume typed letters, so a focused control
// swallows the keys. A range slider (or checkbox/button) keeps focus after you
// drag it but doesn't type — note keys should still play there without a re-click.
const TEXT_INPUT_TYPES = new Set([
  "text", "number", "search", "email", "password", "tel", "url",
  "date", "time", "datetime-local", "month", "week",
]);
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  // Only genuine text entry blocks note keys. A <select> keeps focus after you
  // pick a value, and its letter type-ahead would otherwise steal note keys (and
  // change the dropdown) — while the keyboard is on, note keys win instead.
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
  return false;
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

// The note/chord a keypress represents, for click-to-apply on a step. Chord mode
// → root + chord type + cpx; otherwise the currently-held notes as root + extras.
function kbdSelection(pressedMidi) {
  if (state.kbdChordType) {
    return { root: Math.round(pressedMidi), chord: state.kbdChordType, cpx: state.kbdChordCpx | 0, extras: null };
  }
  const notes = [...new Set([...held.values()].map(r => Math.round(r.midi)).filter(Number.isFinite))].sort((a, b) => a - b);
  const root = notes.length ? notes[0] : Math.round(pressedMidi);
  return { root, chord: "", cpx: 0, extras: notes.length > 1 ? notes.slice(1) : null };
}

// In chord mode each single key plays a whole chord (type + inversion); otherwise
// just the one note. Returns the actual tones to sound.
function tonesFor(midi) {
  if (state.kbdChordType) {
    let tones = chordNotes(midi, state.kbdChordType);
    if (state.kbdChordCpx) tones = invertChord(tones, state.kbdChordCpx | 0);
    return tones.map(clampNote);
  }
  return [midi];
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
  const tones = tonesFor(midi);
  rec.tones = tones;
  if (typeof t.voice.noteOn === "function") {
    rec.usedNoteOn = true;
    for (const n of tones) { try { t.voice.noteOn(n, now, 0.85, opts); } catch (e) { console.warn("kbd noteOn", e); } }
  } else {
    rec.usedNoteOn = false;
    for (const n of tones) { try { t.voice.hit(n, now, HELD_HIT_DUR, 0.85, opts); } catch (e) { console.warn("kbd hit", e); } }
  }
}

// Ableton-style Capture: quantize the last played phrase (the tail of the rolling
// buffer, after the most recent silence gap) into the active track's pattern,
// sizing the clip to the phrase (rounded up to whole bars). Notes on the same
// 16th step stack as root + polyphonic extras. Works whether or not playing.
export function captureSequence() {
  const t = targetTrack();
  if (!t) return { ok: false, msg: "no active track" };
  if (!captureBuffer.length) return { ok: false, msg: "nothing to capture — play some keys first" };
  // Isolate the last contiguous phrase (after any gap > CAPTURE_GAP_SEC).
  let start = 0;
  for (let i = captureBuffer.length - 1; i > 0; i--) {
    if (captureBuffer[i].time - captureBuffer[i - 1].time > CAPTURE_GAP_SEC) { start = i; break; }
  }
  const phrase = captureBuffer.slice(start);
  const bpm = currentBpm();
  const stepDur = (60 / bpm) / 4;          // one 16th-note step
  const t0 = phrase[0].time;
  const events = phrase.map(e => ({ midi: Math.round(e.midi), step: Math.max(0, Math.round((e.time - t0) / stepDur)) }));
  const maxStep = events.reduce((m, e) => Math.max(m, e.step), 0);
  const totalSteps = Math.min(128, Math.max(16, Math.ceil((maxStep + 1) / 16) * 16));
  // Size the clip, then clear it for a fresh capture.
  resizeTrack(t, totalSteps);
  for (let i = 0; i < totalSteps; i++) {
    t.steps[i] = 0; if (Array.isArray(t.lengths)) t.lengths[i] = 0;
    if (Array.isArray(t.notes)) t.notes[i] = null;
    if (Array.isArray(t.chords)) t.chords[i] = "";
    if (Array.isArray(t.complexities)) t.complexities[i] = 0;
    if (Array.isArray(t.extraNotes)) t.extraNotes[i] = null;
    if (Array.isArray(t.extraLengths)) t.extraLengths[i] = null;
  }
  // Group by step (wrap into length); root = lowest, rest → extras.
  const byStep = new Map();
  for (const ev of events) {
    const s = ev.step % totalSteps;
    if (!byStep.has(s)) byStep.set(s, new Set());
    byStep.get(s).add(ev.midi);
  }
  let noteCount = 0;
  for (const [s, set] of byStep) {
    const notes = [...set].sort((a, b) => a - b);
    t.steps[s] = 1;
    if (Array.isArray(t.lengths)) t.lengths[s] = 1;
    if (Array.isArray(t.notes)) t.notes[s] = notes[0];
    if (Array.isArray(t.velocities)) t.velocities[s] = KBD_REC_VEL;
    const extras = notes.slice(1);
    if (Array.isArray(t.extraNotes)) t.extraNotes[s] = extras.length ? extras : null;
    if (Array.isArray(t.extraLengths)) t.extraLengths[s] = extras.length ? extras.map(() => 1) : null;
    noteCount += notes.length;
  }
  if (!t.isDrumKit && byStep.size) t.lastEditedNote = t.notes[[...byStep.keys()].sort((a, b) => a - b)[0]];
  captureBuffer.length = 0;
  try { renderStepGrid(t); } catch {}
  return { ok: true, msg: `captured ${noteCount} note${noteCount === 1 ? "" : "s"} into ${totalSteps} steps on "${t.name}"` };
}

function releaseNote(k) {
  const rec = held.get(k);
  held.delete(k);
  if (!rec || !rec.usedNoteOn || !rec.t?.voice) return;
  const now = (state.audioCtx?.currentTime ?? 0) + 0.005;
  for (const n of (rec.tones || [])) { try { rec.t.voice.noteOff?.(n, now); } catch (e) { console.warn("kbd noteOff", e); } }
}

// Live-record onto the active track's currently-playing step (round-to-current-
// step quantize). In chord mode the pressed key writes root + chord type + cpx.
// Otherwise every held key is recorded as its own note — the lowest is the step's
// root, the rest go into the step's polyphonic extras (t.extraNotes).
function captureNote(pressedMidi) {
  if (!state.kbdRecord || !state.playing) return;
  const t = targetTrack();
  if (!t || !Array.isArray(t.steps)) return;
  const len = t.length || t.steps.length;
  if (!len) return;
  const idx = (((t.trackTick ?? 0) - 1) % len + len) % len;
  const noteLen = Array.isArray(t.lengths) ? Math.max(1, t.lengths[idx] || 1) : 1;
  t.steps[idx] = 1;
  if (Array.isArray(t.lengths)) t.lengths[idx] = noteLen;
  if (Array.isArray(t.velocities)) t.velocities[idx] = KBD_REC_VEL;
  if (Array.isArray(t.extraNotes))   t.extraNotes[idx]   = null;
  if (Array.isArray(t.extraLengths)) t.extraLengths[idx] = null;
  if (state.kbdChordType) {
    // chord mode: store root + chord type + inversion (the transport expands it)
    const root = Math.round(pressedMidi);
    if (Array.isArray(t.notes)) t.notes[idx] = root;
    if (Array.isArray(t.chords)) t.chords[idx] = state.kbdChordType;
    if (Array.isArray(t.complexities)) t.complexities[idx] = state.kbdChordCpx | 0;
    if (!t.isDrumKit) t.lastEditedNote = root;
  } else {
    const notes = [...new Set([...held.values()].map(r => Math.round(r.midi)).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!notes.length) return;
    const root = notes[0];
    const extras = notes.slice(1);
    if (Array.isArray(t.notes)) t.notes[idx] = root;
    if (Array.isArray(t.chords)) t.chords[idx] = "";
    if (Array.isArray(t.complexities)) t.complexities[idx] = 0;
    if (Array.isArray(t.extraNotes))   t.extraNotes[idx]   = extras.length ? extras : null;
    if (Array.isArray(t.extraLengths)) t.extraLengths[idx] = extras.length ? extras.map(() => noteLen) : null;
    if (!t.isDrumKit) t.lastEditedNote = root;
  }
  try { renderStepGrid(t); } catch {}
}

function onKeyDown(e) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!isDesktopKeyboard()) return;
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  // A <select> keeps focus after a pick, and its native letter type-ahead can
  // run as the keydown's default action — the note key then switches the
  // dropdown (e.g. the engine) instead of playing. preventDefault alone isn't
  // reliable across browsers for select type-ahead, so drop the focus first.
  if (e.target?.tagName === "SELECT" && (KEY_SEMITONES[k] != null || k === "z" || k === "x")) {
    e.target.blur();
  }
  if (k === "z") { state.kbdBase = Math.max(0, state.kbdBase - 12); e.preventDefault(); return; }
  if (k === "x") { state.kbdBase = Math.min(108, state.kbdBase + 12); e.preventDefault(); return; }
  if (KEY_SEMITONES[k] == null || held.has(k)) return;
  const midi = noteForKey(k);
  if (midi == null) return;
  held.set(k, { t: null, midi, tones: null, usedNoteOn: false });
  e.preventDefault();
  state.kbdLast = kbdSelection(midi);   // remember for click-to-apply on a step
  // Buffer for capture at press time (monotonic clock) — independent of whether
  // audio is unlocked, so Capture works like Ableton's retroactive capture.
  { const now = performance.now() / 1000; for (const n of tonesFor(midi)) bufferForCapture(n, now); }
  captureNote(midi);
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
  // Selects don't need to keep focus once a value is committed, and a focused
  // select turns the next note key into type-ahead (see onKeyDown). Blur on
  // change so the keyboard goes straight back to playing notes.
  document.addEventListener("change", (e) => {
    if (e.target?.tagName === "SELECT") e.target.blur();
  });
}

/** Release + forget all held keys — call when the feature is toggled off. */
export function resetKbdKeys() {
  for (const k of [...held.keys()]) releaseNote(k);
  held.clear();
  state.kbdLast = null;
}
