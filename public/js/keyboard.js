// Computer keyboard → notes. Letter keys always play the active track's voice
// (except while a text field is focused), sustaining while held (note-on on
// keydown, note-off on keyup). Layout is Ableton-style: bottom row = white keys
// (a s d f g h j k l),
// top row = black keys (w e t y u o), z / x shift the octave.
//
// When a scale is active the WHITE keys map to the scale's degrees (root anchored
// near kbdBase) and the black keys go inert — everything you can play is in key.
// With no scale it's a plain chromatic piano.

import { currentBpm } from "./lfo.js";
import { invertChord, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { applyKbdArpToStep, resizeTrack } from "./track.js";
import { CHORD_TYPES, SCALES, chordNotes, chordTypeForTones, diatonicChordNotes, midiToScaleIndex, quantizeToScale, scaleIndexToMidi } from "./theory.js";
import { ensureAudio, wakeMasterBus } from "./transport.js";

const KBD_REC_VEL = 0.85;
const CAPTURE_WINDOW_SEC = 32;   // rolling lookback buffer for "capture"
const CAPTURE_GAP_SEC = 1.5;     // silence gap that separates phrases

// Rolling buffer of recently-played notes { midi, time, dur, chord, cpx } for
// Ableton-style retroactive capture — always accumulating while the keyboard
// plays. `dur` is filled in on key release (null while the note is still held),
// so capture can reproduce how long each note was actually held. A chord-mode
// press buffers one entry carrying its chord type instead of one per tone.
const captureBuffer = [];
function bufferForCapture(midi, time, chord = "", cpx = 0) {
  const entry = { midi, time, dur: null, chord, cpx };
  captureBuffer.push(entry);
  const cutoff = time - CAPTURE_WINDOW_SEC;
  while (captureBuffer.length && captureBuffer[0].time < cutoff) captureBuffer.shift();
  if (captureBuffer.length > 4000) captureBuffer.splice(0, captureBuffer.length - 4000);
  return entry;
}
/** Same monotonic clock the buffer is stamped with (independent of the audio ctx). */
const captureNow = () => performance.now() / 1000;

// Chromatic offset from the base note (state.kbdBase = the "a" key).
const KEY_SEMITONES = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15,
};
// Scale layout: white keys → scale-degree offsets. Keys absent from this map
// (the black row: w e t y u o) are silent while a scale is active.
const WHITE_DEGREE = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7, l: 8, p: 9 };

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
// Returns null for a key that plays nothing — under a scale that's the black
// row, which has no accidentals to play once every degree lives on a white key.
function noteForKey(k) {
  const semi = KEY_SEMITONES[k];
  if (semi == null) return null;
  const intervals = state.scale.active ? SCALES[state.scale.mode] : null;
  if (!intervals) return clampNote(state.kbdBase + semi);
  const degree = WHITE_DEGREE[k];
  if (degree == null) return null;
  const root = state.scale.root | 0;
  const baseIdx = midiToScaleIndex(quantizeToScale(state.kbdBase, root, intervals), root, intervals) ?? 0;
  return clampNote(scaleIndexToMidi(baseIdx + degree, root, intervals));
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

// Whether keyboard chord mode is producing diatonic (scale-quantized) chords.
function scaleChordActive() {
  return !!(state.scale.active && SCALES[state.scale.mode] && state.kbdChordType);
}

// The arp controls only mean anything while chord mode is on (a single note has
// nothing to arpeggiate), so the group follows the chord picker, and its
// rate/range/direction follow the arp checkbox.
export function syncKbdArpUI() {
  const group = document.getElementById("kbd-arp");
  const opts = document.getElementById("kbd-arp-opts");
  if (!group || !opts) return;
  group.toggleAttribute("hidden", !state.kbdChordType);
  opts.toggleAttribute("hidden", !state.kbdArp);
  const on = document.getElementById("kbd-arp-on");
  if (on) on.checked = !!state.kbdArp;
}

// What chord mode writes to a step for a given root: root + chord type + cpx,
// exactly like the step editor's own chord settings, so the piano roll shows one
// labelled root note instead of a stack. Under a scale the chord is diatonic, so
// its quality is looked up from the tones (Dmin for ii of C major, etc.); a
// voicing that isn't one of CHORD_TYPES (stacked thirds in a pentatonic scale,
// say) falls back to explicit notes so it still reproduces exactly.
// Used by a keypress and by a plain step click alike (see startNote).
export function chordSelectionFor(rootMidi) {
  const root = clampNote(rootMidi);
  const cpx = state.kbdChordCpx | 0;
  if (!scaleChordActive()) {
    // "on" is the scale-mode picker's value and isn't a real chord type — if the
    // scale went off before the picker was resynced, fall back to a plain note.
    const chord = CHORD_TYPES[state.kbdChordType] ? state.kbdChordType : "";
    return { root, chord, cpx: chord ? cpx : 0, extras: null };
  }
  // A keypress is already in-scale; a step click's root (the track's last-used
  // note) may not be, and an off-scale root has no diatonic chord at all.
  const inScale = clampNote(quantizeToScale(root, state.scale.root, SCALES[state.scale.mode]));
  const base = diatonicChordNotes(inScale, 3).map(clampNote);
  const type = chordTypeForTones(base);
  if (type) return { root: inScale, chord: type, cpx, extras: null };
  const tones = tonesFor(inScale);
  return { root: tones[0], chord: "", cpx: 0, extras: tones.length > 1 ? tones.slice(1) : null };
}

// The note/chord a keypress represents, for click-to-apply on a step. Chord mode
// yields a chord config (above); otherwise every held key is its own note — the
// lowest is the root, the rest are polyphonic extras.
function kbdSelection(pressedMidi) {
  if (state.kbdChordType) return chordSelectionFor(pressedMidi);
  const notes = [...new Set([...held.values()].map(r => Math.round(r.midi)).filter(Number.isFinite))].sort((a, b) => a - b);
  const root = notes.length ? notes[0] : Math.round(pressedMidi);
  return { root, chord: "", cpx: 0, extras: notes.length > 1 ? notes.slice(1) : null };
}

// In chord mode each single key plays a whole chord; otherwise just the one note.
// Under an active scale the chord is built diatonically (stacked scale-thirds, so
// the quality follows the scale degree) instead of from a fixed chord type.
// Returns the actual tones to sound.
function tonesFor(midi) {
  if (scaleChordActive()) {
    let tones = diatonicChordNotes(midi, 3);
    if (state.kbdChordCpx) tones = invertChord(tones, state.kbdChordCpx | 0);
    return tones.map(clampNote);
  }
  if (state.kbdChordType) {
    let tones = chordNotes(midi, state.kbdChordType);
    if (state.kbdChordCpx) tones = invertChord(tones, state.kbdChordCpx | 0);
    return tones.map(clampNote);
  }
  return [midi];
}

// ---- live arpeggiator (held chord keys) ---------------------------------
// The transport arps a *step*; this arps what you're playing right now, firing
// one note at a time for as long as the key is held. Notes are scheduled ahead
// on the audio clock (a timer only decides *when to schedule*, never when a note
// sounds), so the rate stays steady even when the JS timer drifts.
const ARP_LOOKAHEAD = 0.12;   // seconds of notes queued ahead of the audio clock
const ARP_TICK_MS = 25;

/** Expand chord tones into the arp's note order — same shape as the transport's. */
function arpSequence(tones) {
  const range = Math.max(1, Math.min(4, Number(state.kbdArpRange) || 1));
  const expanded = [];
  for (let o = 0; o < range; o++) for (const n of tones) expanded.push(clampNote(n + o * 12));
  switch (state.kbdArpDir) {
    case "down": return expanded.slice().reverse();
    case "updown": {
      const seq = expanded.concat(expanded.slice(0, -1).reverse().slice(0, -1));
      return seq.length ? seq : expanded;
    }
    default: return expanded;   // "up", and "random" (which picks per note below)
  }
}

/** Start arpeggiating `tones` on the track until the key is released. */
function startLiveArp(rec, t, tones, startAt, opts) {
  const seq = arpSequence(tones);
  if (!seq.length) return false;
  const rateSec = Math.max(0.02, (Number(state.kbdArpRate) || 0.25) * (60 / currentBpm()));
  const random = state.kbdArpDir === "random";
  const arp = { seq, i: 0, next: startAt, rateSec, timer: null };
  const tick = () => {
    const ctx = state.audioCtx;
    if (!ctx || !t.voice) return;
    while (arp.next < ctx.currentTime + ARP_LOOKAHEAD) {
      const n = random ? seq[Math.floor(Math.random() * seq.length)] : seq[arp.i % seq.length];
      const at = Math.max(arp.next, ctx.currentTime + 0.002);
      try { t.voice.hit(n, at, rateSec * 0.92, 0.85, opts); } catch (e) { console.warn("kbd arp hit", e); }
      arp.i++;
      arp.next += rateSec;
    }
  };
  tick();                                   // first note immediately
  arp.timer = setInterval(tick, ARP_TICK_MS);
  rec.arp = arp;
  return true;
}

function stopLiveArp(rec) {
  if (!rec?.arp) return;
  clearInterval(rec.arp.timer);
  rec.arp = null;
}

async function pressNote(k, midi) {
  const t = targetTrack();
  if (!t) return;
  await ensureAudio();
  if (!t.voice || !held.has(k)) return;   // key may have been released during await
  // Stop leaves the master bus muted (see wakeMasterBus) — ask for it back, or
  // the note plays into a zeroed gain and you hear nothing.
  wakeMasterBus();
  const now = state.audioCtx.currentTime + 0.01;
  const opts = hitOptsFor(t);
  const rec = held.get(k);
  rec.t = t; rec.midi = midi;
  const tones = tonesFor(midi);
  rec.tones = tones;
  // Arp mode plays the chord one note at a time instead of as a block. It always
  // uses hit() (each arp note has its own length), so there's no note-off to send.
  if (state.kbdChordType && state.kbdArp && tones.length > 1) {
    rec.usedNoteOn = false;
    if (startLiveArp(rec, t, tones, now, opts)) return;
  }
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
// sizing the clip to the phrase (rounded up to whole bars). Note lengths come
// from how long each key was held, quantized to 16ths (minimum one step). Notes
// on the same 16th step stack as root + polyphonic extras. Works whether or not
// playing.
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
  const now = captureNow();
  const events = phrase.map(e => ({
    midi: Math.round(e.midi),
    step: Math.max(0, Math.round((e.time - t0) / stepDur)),
    // Still-held keys have no dur yet — measure them up to this moment.
    len: Math.max(1, Math.round((e.dur ?? Math.max(0, now - e.time)) / stepDur)),
    chord: e.chord || "",
    cpx: e.cpx | 0,
  }));
  // Size to where the last note *ends*, so a held tail isn't clipped away.
  const maxStep = events.reduce((m, e) => Math.max(m, e.step + e.len - 1), 0);
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
  // Group by step (wrap into length): midi → { len, chord, cpx }, longest wins
  // for a repeated note on the same step. Root = lowest, rest → extras.
  const byStep = new Map();
  for (const ev of events) {
    const s = ev.step % totalSteps;
    if (!byStep.has(s)) byStep.set(s, new Map());
    const at = byStep.get(s);
    const prev = at.get(ev.midi);
    at.set(ev.midi, {
      len: Math.max(prev?.len || 1, ev.len),
      chord: ev.chord || prev?.chord || "",
      cpx: ev.chord ? ev.cpx : (prev?.cpx | 0),
    });
  }
  let noteCount = 0;
  for (const [s, at] of byStep) {
    const notes = [...at.keys()].sort((a, b) => a - b);
    // Don't run past the clip. (A note that overlaps the *next* captured step is
    // also trimmed back to it — renderStepGrid enforces that, see maxLengthAt:
    // a track lane is monophonic in time, polyphony being chords + extras.)
    const lenOf = n => Math.max(1, Math.min(totalSteps - s, at.get(n)?.len || 1));
    const rootInfo = at.get(notes[0]);
    t.steps[s] = 1;
    if (Array.isArray(t.lengths)) t.lengths[s] = lenOf(notes[0]);
    if (Array.isArray(t.notes)) t.notes[s] = notes[0];
    if (Array.isArray(t.velocities)) t.velocities[s] = KBD_REC_VEL;
    // A chord-mode press restores as a chord config, so the roll shows one root.
    if (Array.isArray(t.chords)) t.chords[s] = rootInfo?.chord || "";
    if (Array.isArray(t.complexities)) t.complexities[s] = rootInfo?.chord ? (rootInfo.cpx | 0) : 0;
    applyKbdArpToStep(t, s, !!rootInfo?.chord);
    const extras = notes.slice(1);
    if (Array.isArray(t.extraNotes)) t.extraNotes[s] = extras.length ? extras : null;
    if (Array.isArray(t.extraLengths)) t.extraLengths[s] = extras.length ? extras.map(lenOf) : null;
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
  stopLiveArp(rec);
  if (rec?.capture) {
    const now = captureNow();
    for (const e of rec.capture) e.dur = Math.max(0, now - e.time);
  }
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
    // chord mode: store root + chord type + inversion (the transport expands it),
    // so the step reads as one chord rather than a stack of notes
    const sel = chordPressSelection(pressedMidi);
    if (Array.isArray(t.notes)) t.notes[idx] = sel.root;
    if (Array.isArray(t.chords)) t.chords[idx] = sel.chord;
    if (Array.isArray(t.complexities)) t.complexities[idx] = sel.cpx;
    if (Array.isArray(t.extraNotes))   t.extraNotes[idx]   = sel.extras;
    if (Array.isArray(t.extraLengths)) t.extraLengths[idx] = sel.extras ? sel.extras.map(() => noteLen) : null;
    applyKbdArpToStep(t, idx, !!sel.chord);
    if (!t.isDrumKit) t.lastEditedNote = sel.root;
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
  if (k === "z") { state.kbdBase = Math.max(0, state.kbdBase - 12); updateKbdOctaveLabel(); e.preventDefault(); return; }
  if (k === "x") { state.kbdBase = Math.min(108, state.kbdBase + 12); updateKbdOctaveLabel(); e.preventDefault(); return; }
  if (KEY_SEMITONES[k] == null || held.has(k)) return;
  const midi = noteForKey(k);
  // Inert note key (the black row under a scale) — still swallow it, so it can't
  // reach a focused control as type-ahead.
  if (midi == null) { e.preventDefault(); return; }
  held.set(k, { t: null, midi, tones: null, usedNoteOn: false, arp: null });
  e.preventDefault();
  state.kbdLast = kbdSelection(midi);   // remember for click-to-apply on a step
  // Buffer for capture at press time (monotonic clock) — independent of whether
  // audio is unlocked, so Capture works like Ableton's retroactive capture. The
  // entries are kept on the held record so the release can stamp their length.
  {
    const now = captureNow();
    const sel = state.kbdLast;
    held.get(k).capture = sel.chord
      ? [bufferForCapture(sel.root, now, sel.chord, sel.cpx)]   // one chord, not one entry per tone
      : tonesFor(midi).map(n => bufferForCapture(n, now));
  }
  captureNote(midi);
  pressNote(k, midi);
}

function onKeyUp(e) { releaseNote((e.key || "").toLowerCase()); }

const _OCT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Update the top-bar readout of the keyboard's current base octave (z/x shifts). */
export function updateKbdOctaveLabel() {
  const el = document.getElementById("kbd-octave");
  if (!el) return;
  const b = Math.round(state.kbdBase);
  el.textContent = _OCT_NAMES[((b % 12) + 12) % 12] + (Math.floor(b / 12) - 1);
}

let _installed = false;
export function initComputerKeyboard() {
  if (_installed) return;
  _installed = true;
  updateKbdOctaveLabel();
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
