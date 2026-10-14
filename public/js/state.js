import { AUTOMATION_TARGETS } from "./automation.js";
import { paintBeatIndicator } from "./beat.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { activeMeter, autoAccents } from "./meter.js";
import { renderPatternGrid } from "./patternBar.js";
import { refreshParamIndicators } from "./paramTargets.js";
import { flushPatternSound, recallPatternSound, refreshAllPatternLockUI, refreshPatternSoundUI } from "./patternSound.js";
import { refreshAutIfOpen } from "./pianoRoll.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, midiToScaleIndex, scaleIndexToMidi } from "./theory.js";


/** @typedef {import("./types.js").Track} Track */
/** @typedef {import("./types.js").Pattern} Pattern */
/** @typedef {import("./types.js").PatternIndex} PatternIndex */
export function findPriorNote(t, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (t.steps[i] && typeof t.notes[i] === "number") return t.notes[i];
  }
  for (let i = t.length - 1; i > idx; i--) {
    if (t.steps[i] && typeof t.notes[i] === "number") return t.notes[i];
  }
  return null;
}

export function applyStepsFromPrior(t, idx, steps) {
  const prior = findPriorNote(t, idx);
  if (prior == null) return null;
  if (!state.scale.active) return prior + steps;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return prior + steps;
  const priorIdx = midiToScaleIndex(prior, state.scale.root, intervals);
  if (priorIdx == null) return prior + steps;
  return scaleIndexToMidi(priorIdx + steps, state.scale.root, intervals);
}

export const state = {
  tracks: [],
  playing: false,
  tick: 0,
  repeatId: null,
  nextId: 1,
  metronome: false,
  metronomeLevel: 0.7,  // the metronome button's fill: click volume, 0..1 (drag the button up/down)
  noteColors: false,  // diatonic pitch-class coloring on the roll + step grid
  currentSetName: null,  // last loaded/saved session name — drives version-bump suggestions
  songName: null,  // the open song's name as the shell shows it ("cold squelch v4"), via setSongName
  audioCtx: null,
  ready: false,
  masterGain: null,
  masterLimiter: null,
  masterAnalyser: null,
  midi: null,
  // Computer-keyboard-as-notes: when on, letter keys play the active track's
  // voice (chromatic piano layout, z/x shift octave). activeTrackId is the track
  // that receives them (last clicked; defaults to the first track).
  kbdNotesOn: true,     // keyboard is always active (only blocked while a text field is focused)
  kbdRecord: false,     // capture keyboard notes into the active track's steps while playing
  kbdBase: 60,          // MIDI note of the "q" key (C4); shifted by z/x
  kbdChordType: "",     // chord mode: "" = single notes, else each key plays this chord type
  kbdChordCpx: 0,       // chord inversion / voicing level (0..4), same as a step's complexity
  // Arp settings for chords played from the keyboard — written onto the steps a
  // chord lands on (record / capture / click-to-apply), same fields the step
  // editor's arp row edits. Only meaningful while chord mode is on.
  kbdArp: false,
  kbdArpRate: 0.25,     // beats per note
  kbdArpRange: 1,       // octaves spanned
  kbdArpDir: "up",      // up | down | updown | random
  kbdStrum: 0,          // ms between a keyboard chord's notes: + low to high, - high to low, 0 a block chord
  kbdLast: null,        // last note/chord played on the keyboard {root,chord,cpx,extras} — applied when a step is clicked
  kbdCursor: 0,
  vimMode: null,        // vim.js: null (off) | "normal" | "insert" | "play" | "visual" | "command"
  vimSel: null,         // vim.js's visual selection on the active track: {from, to} step indices         // step input's cursor (record armed, transport stopped), wrapped to each track's length
  activeTrackId: null,
  scale: { active: false, root: 0, mode: "minor" },
  activePattern: 0,
  patternMode: "repeat",
  patternSwitchMode: "immediate", // "immediate" | "finish" — finish waits until bar boundary before switching
  queuedPattern: null,
  patternMeta: Array(32).fill(null).map(() => ({ regenPattern: true, regenInstrument: true })),
  patternRepeats: Array(32).fill(1),
  patternMeters: Array(32).fill(null).map(() => ({ num: 4, den: 4 })),
  // Slots 1..31 follow pattern 1's meter until the user sets one explicitly; pattern 1
  // is always the source. Any true flag means "user customized — do not inherit from #1".
  patternMeterCustomized: Array(32).fill(false),
  chainBarCount: 0,
  // Sixteenths into the current bar, whose length is the active pattern's
  // meter (transport.js). Chain mode and a queued switch act on its wrap.
  barTick: 0,
  // The arrangement (arrangement.js, clips.js): the ruler bar the transport is
  // on in arrange mode, wrapped at the arrangement's end; whether clip launches
  // are being recorded into the tracks' timelines, and the bar they write.
  // `_arrOrigin` is the global tick that was ruler bar 0, so a view can map the
  // tick being heard (`_nowTick`, written by the transport at the audible time)
  // to a position on the ruler. `view` is which of the three views is open
  // (views.js); none of these are saved.
  arrBar: 0,
  arrStartBar: 0,       // the ruler bar a play press starts the arrangement from (the view's marker)
  arrLoop: null,        // a section of the ruler, {start, end} in bars (end exclusive), drawn on the ruler
  arrLoopOn: false,     // whether arrange mode loops that section instead of the whole arrangement
  patLoop: null,        // the loop: a range of pattern slots, {start, end} (end exclusive), that repeat mode plays round
  _loopMode: "repeat",  // the last repeat / chain mode, which the clip view's play returns to
  _arrJump: null,       // a bar to jump to at the next bar line while the arrangement plays
  _viewSwitched: false, // a view opened while playing: the mode follows it at the next bar line (transport.js)
  arrRecord: false,
  arrRecBar: 0,
  arrRecStart: null,    // the first bar the take holds, or null before anything is written
  _arrOrigin: 0,
  _arrPrevOrigin: 0,    // the origin before the last jump or wrap, for ticks heard before it (`_arrOriginAt`)
  _arrOriginAt: 0,
  _nowTick: 0,
  view: "groove",
  // XY macro pads (macro.js). Global and cross-track by design, and deliberately
  // outside the p-lock snapshot — a performance macro that rearranged itself at
  // every pattern switch would be unplayable.
  /** @type {import("./types.js").MacroPad[]} */
  macroPads: [],
};

/**
 * Build a blank pattern with `len` per-step slots across every lane.
 * @param {number} len @returns {Pattern}
 */
export function emptyPattern(len) {
  return {
    steps: new Array(len).fill(0),
    lengths: new Array(len).fill(0),
    notes: new Array(len).fill(null),
    velocities: new Array(len).fill(0.5),
    chords: new Array(len).fill(""),
    offsets: new Array(len).fill(0),   // micro-timing offset in step fractions (-0.5..+0.5)
    arps: new Array(len).fill(false),           // arpeggiate the chord across the step's duration
    arpRates:  new Array(len).fill(0.25),       // beats per arp note
    arpRanges: new Array(len).fill(1),          // octave range
    arpDirs:   new Array(len).fill("up"),       // up / down / updown / random
    strums:    new Array(len).fill(0),          // ms between a chord's notes: + low to high, - high to low, 0 together
    complexities: new Array(len).fill(0),       // chord inversion / voicing level
    ratchets: new Array(len).fill(1),           // retrigger the single note N times across the step
    sampleStarts: new Array(len).fill(0),       // sample-engine start offset (0..1 of buffer)
    sampleEnds:   new Array(len).fill(1),       // sample-engine end offset   (0..1 of buffer)
    sampleFadeIns:  new Array(len).fill(0),     // sample fade-in time in seconds (0 = click-guard)
    sampleFadeOuts: new Array(len).fill(0),     // sample fade-out time in seconds
    sampleLoopModes: new Array(len).fill("off"),// "off" | "loop" | "pingpong"
    // Extra notes stacked on the anchor (polyphony per step). Each slot is
    // null or an Array<MIDI>. The anchor's pitch (notes[i]) is always the
    // root; entries here are additional pitches triggered alongside it.
    extraNotes: new Array(len).fill(null),
    // Per-extra lengths, parallel to extraNotes. Each slot is null or an
    // Array<number> with the same length as the matching extraNotes entry.
    // null falls back to the anchor's length. Capped at the anchor length.
    extraLengths: new Array(len).fill(null),
    // Per-step automation lanes, keyed by AUTOMATION_TARGETS key. Each lane:
    //   { enabled: bool, values: number[] }   — values normalized 0..1 per step
    automation: {},
    // p-lock: whether this track's sound is locked to this pattern, and the
    // sound itself if so — see patternSound.js. Unlocked patterns share the
    // track's `baseSound` instead, which is the normal case.
    soundLocked: false,
    sound: null,
  };
}

/**
 * Deep-copy a pattern — every per-step array by value, automation lanes rebuilt,
 * so the clone shares nothing with the source. THE one place a pattern is
 * copied: duplicating a pattern and duplicating a track both go through here, so
 * a new per-step field can't be added to emptyPattern and forgotten by one of
 * them (arps, ratchets, chord inversions, per-step sample regions and the piano
 * roll's stacked notes were all silently dropped when this was open-coded).
 * Fields the source lacks keep the fresh pattern's defaults, which is how a save
 * written before a field existed gets healed on copy.
 * @param {Pattern} src @returns {Pattern}
 */
export function clonePattern(src) {
  const out = emptyPattern(src?.steps?.length ?? 0);
  for (const key of Object.keys(out)) {
    const v = src?.[key];
    if (!Array.isArray(v)) continue;              // automation, and anything missing
    const dst = out[key];
    const n = Math.min(dst.length, v.length);     // a legacy pattern can be short
    for (let i = 0; i < n; i++) dst[i] = v[i];
  }
  // These hold nested arrays; the copy above would have shared them by reference.
  out.extraNotes   = out.extraNotes.map(s => Array.isArray(s) ? s.slice() : null);
  out.extraLengths = out.extraLengths.map(s => Array.isArray(s) ? s.slice() : null);
  for (const [key, lane] of Object.entries(src?.automation || {})) {
    out.automation[key] = { enabled: !!lane.enabled, values: (lane.values || []).slice() };
  }
  // A locked pattern's sound travels with it, so a duplicate is locked too and
  // carries the sound — deep, or the copy would share the original's fx and
  // mod config by reference.
  out.soundLocked = !!src?.soundLocked;
  out.sound = src?.sound ? JSON.parse(JSON.stringify(src.sound)) : null;
  return out;
}

/**
 * The slot a track is on: what it plays AND what its step grid edits (one
 * thing, the alias below). `state.activePattern` is the SCENE — the slot the
 * pattern bar highlights and `switchPattern` puts every track on — and the two
 * agree until a clip is launched on one track (clips.js). Every reader that
 * means "this track's pattern" asks this, never `state.activePattern`.
 * @param {Track} t @returns {PatternIndex}
 */
export function trackSlot(t) {
  return t?._patternIdx ?? state.activePattern;
}

/**
 * Rebind a track's step arrays to reference patterns[idx] directly so UI
 * mutations flow straight into that pattern.
 * @param {Track} t @param {PatternIndex} idx
 */
export function aliasPattern(t, idx) {
  const p = t.patterns[idx];
  t.steps = p.steps;
  t.lengths = p.lengths;
  t.notes = p.notes;
  t.velocities = p.velocities;
  t.chords = p.chords;
  t.offsets      = p.offsets      ?? (p.offsets      = new Array(p.steps.length).fill(0));
  t.arps         = p.arps         ?? (p.arps         = new Array(p.steps.length).fill(false));
  t.arpRates     = p.arpRates     ?? (p.arpRates     = new Array(p.steps.length).fill(0.25));
  t.arpRanges    = p.arpRanges    ?? (p.arpRanges    = new Array(p.steps.length).fill(1));
  t.arpDirs      = p.arpDirs      ?? (p.arpDirs      = new Array(p.steps.length).fill("up"));
  t.strums       = p.strums       ?? (p.strums       = new Array(p.steps.length).fill(0));
  t.complexities = p.complexities ?? (p.complexities = new Array(p.steps.length).fill(0));
  t.ratchets     = p.ratchets     ?? (p.ratchets     = new Array(p.steps.length).fill(1));
  t.sampleStarts = p.sampleStarts ?? (p.sampleStarts = new Array(p.steps.length).fill(0));
  t.sampleEnds   = p.sampleEnds   ?? (p.sampleEnds   = new Array(p.steps.length).fill(1));
  t.sampleFadeIns  = p.sampleFadeIns  ?? (p.sampleFadeIns  = new Array(p.steps.length).fill(0));
  t.sampleFadeOuts = p.sampleFadeOuts ?? (p.sampleFadeOuts = new Array(p.steps.length).fill(0));
  t.sampleLoopModes = p.sampleLoopModes ?? (p.sampleLoopModes = new Array(p.steps.length).fill("off"));
  t.extraNotes = p.extraNotes ?? (p.extraNotes = new Array(p.steps.length).fill(null));
  t.extraLengths = p.extraLengths ?? (p.extraLengths = new Array(p.steps.length).fill(null));
  t.automation = p.automation ?? (p.automation = {});
  // Patterns can have independent lengths; meter is pattern-global (state.patternMeters).
  // Mirror the active pattern's length into t.length / t.accents so every transport
  // / UI path reading them stays correct.
  t.length = p.steps.length;
  t.accents = autoAccents(t.length, state.patternMeters[idx]);
  if (t.el) {
    const lenEl = t.el.querySelector(".sq-track__len");
    if (lenEl) lenEl.value = t.length;
  }
  t._patternIdx = idx;
}

// Rotate a chord up by `level` positions: each rotation moves the lowest note up an octave.
export function invertChord(notes, level) {
  if (!level || notes.length < 2) return notes;
  const n = notes.length;
  const k = ((level % n) + n) % n;
  const out = notes.slice();
  for (let i = 0; i < k; i++) {
    const first = out.shift();
    out.push(first + 12);
  }
  return out;
}

export function isPatternNonEmpty(idx) {
  for (const t of state.tracks) {
    const p = t.patterns?.[idx];
    if (!p) continue;
    for (let i = 0; i < p.steps.length; i++) { if (p.steps[i]) return true; }
  }
  return false;
}

/**
 * The pattern the transport goes to after `fromIdx`: the next slot of the loop
 * range in repeat mode (`loopRange`, wrapping, every slot in it empty or not:
 * the range is what was asked for), else chain mode's next non-empty pattern.
 */
export function nextChainPattern(fromIdx) {
  const r = loopRange();
  if (r) return fromIdx >= r.start && fromIdx + 1 < r.end ? fromIdx + 1 : r.start;
  return findNextNonEmptyPattern(fromIdx);
}

/**
 * The patterns repeat mode goes round, when it goes round more than one:
 * `state.patLoop` (drawn across the piano view's headers) in repeat mode,
 * with the scene inside it. Repeat is LOOP in every view, chain plays
 * through every pattern, so the two modes mean the same thing on the pattern
 * bar, the clip view's toggle and the piano view's loop button. A scene
 * outside the range (picked by hand) just repeats.
 */
export function loopRange() {
  const r = state.patLoop;
  if (state.patternMode !== "repeat" || !r || r.end - r.start < 2) return null;
  return state.activePattern >= r.start && state.activePattern < r.end ? r : null;
}

/** Whether slot `i` is in the loop going round (for the slots' marks). */
export function inLoop(i) {
  const r = loopRange();
  return !!r && i >= r.start && i < r.end;
}

export function findNextNonEmptyPattern(fromIdx) {
  for (let off = 1; off <= PATTERN_COUNT; off++) {
    const idx = (fromIdx + off) % PATTERN_COUNT;
    if (isPatternNonEmpty(idx)) return idx;
  }
  return -1;
}

// When switch mode is "finish" and the transport is running, defer the switch
// until the end of the current bar; otherwise swap immediately.
export function requestPatternSwitch(idx) {
  if (idx < 0 || idx >= PATTERN_COUNT) return;
  // Already the scene, and every track on it: nothing to switch. A track a
  // clip put on another slot is brought back by the switch below.
  if (idx === state.activePattern && state.tracks.every(t => trackSlot(t) === idx && !t._clipOff)) {
    state.queuedPattern = null; renderPatternGrid(); return;
  }
  if (state.patternSwitchMode === "finish" && state.playing) {
    state.queuedPattern = idx;
    renderPatternGrid();
    setStatus(`pattern ${idx + 1} queued`);
    return;
  }
  switchPattern(idx);
}

/**
 * Make pattern `idx` active: re-alias every track and re-render.
 * @param {PatternIndex} idx
 */
export function switchPattern(idx, { deferUi = false } = {}) {
  if (idx < 0 || idx >= PATTERN_COUNT) return;
  // p-lock: the sound of the pattern being left goes back to whichever store
  // owns it, and the one being entered is recalled. Chain mode lands here on a
  // bar boundary mid-transport, which is why the recall diffs rather than
  // re-applying everything (see patternSound.js).
  // Each track is flushed at ITS slot: a launched clip (clips.js) can have put
  // one off the scene, and flushing it at the scene's index would write its
  // live sound into a pattern it never played.
  for (const t of state.tracks) {
    const was = trackSlot(t);
    if (was !== idx) flushPatternSound(t, was);
  }
  state.activePattern = idx;
  state.queuedPattern = null;
  for (const t of state.tracks) {
    // A scene launch is every track together: a clip waiting for the bar is
    // overridden, a stopped track plays again.
    t._queuedSlot = null;
    t._clipOff = false;
    aliasPattern(t, idx);
    if (recallPatternSound(t, idx)) t._soundUiStale = true;
  }
  state.chainBarCount = 0;
  // Everything the sequencer needs is done: the next step reads the new
  // pattern's arrays and hears its sound. The rest is the picture of it.
  // A click paints it now, as it always did. The TRANSPORT asks for
  // `deferUi`: chain mode and a queued switch land here inside the scheduler
  // callback on the bar line, and re-rendering six step grids, the roll, the
  // lane panel, the mod panel and the pattern bar there measured 11ms on an
  // empty session and 23ms on a full one (more with panels open), spent out
  // of the same lookahead the notes are scheduled in. So that paint goes to
  // its own task, straight after the callback returns — a timer rather than
  // requestAnimationFrame, which stops in a background or occluded window
  // while the transport keeps running (the reason scheduleAtAudible uses a
  // timer too). And one TRACK per task, not the whole paint in one: Tone's
  // clock ticks off a worker message, which can only run between tasks, so a
  // single paint task held the scheduler for as long as it took. On a slow
  // machine with a full session that was longer than the lookahead, and the
  // first steps of the new bar played late: a stutter on the 1, in chain mode
  // or after a queued switch. Coalesced, so two switches paint once.
  if (deferUi) {
    patternUiQueue = state.tracks.slice();
    if (patternUiTimer === null) patternUiTimer = setTimeout(paintPatternUIStep, 0);
  } else {
    paintPatternUI();
  }
}

let patternUiTimer = null;
/** @type {Track[]|null} tracks still to repaint after a deferred switch */
let patternUiQueue = null;
/**
 * One track's pattern repaint, on the same one-track-per-task queue a
 * deferred switch uses: a clip launched on a bar line (clips.js) or an
 * arrangement block switching in paints the way a chain switch does, and a
 * whole-session switch landing meanwhile simply replaces the queue.
 * @param {Track} t
 */
export function queueTrackPaint(t) {
  patternUiQueue ??= [];
  if (!patternUiQueue.includes(t)) patternUiQueue.push(t);
  if (patternUiTimer === null) patternUiTimer = setTimeout(paintPatternUIStep, 0);
}
/** One track's pattern repaint, now (a click), the bar included. */
export function paintTrackPatternUINow(t) {
  paintTrackPatternUI(t);
  paintPatternBarUI();
}
/** Everything a pattern switch repaints, now. patternBar.js's move needs it. */
export function repaintPatternUI() { paintPatternUI(); }
function paintPatternUI() {
  if (patternUiTimer !== null) { clearTimeout(patternUiTimer); patternUiTimer = null; }
  patternUiQueue = null;
  for (const t of state.tracks) paintTrackPatternUI(t);
  paintPatternBarUI();
}
function paintPatternUIStep() {
  patternUiTimer = null;
  const t = patternUiQueue?.shift();
  if (t) {
    if (state.tracks.includes(t)) paintTrackPatternUI(t);   // not removed meanwhile
    patternUiTimer = setTimeout(paintPatternUIStep, 0);
    return;
  }
  patternUiQueue = null;
  paintPatternBarUI();
}
function paintTrackPatternUI(t) {
  if (t._soundUiStale) { t._soundUiStale = false; refreshPatternSoundUI(t); }
  renderStepGrid(t);           // also refreshes the roll, if open
  refreshAutIfOpen(t);
  refreshParamIndicators(t);   // automation lanes belong to the pattern
  paintTrackSlotBadge(t);      // off the scene, or stopped (clips.js)
}

/**
 * The slot badge on a track's head in the groove view: shown only while the
 * track is off the scene or stopped, since with no clip launched it would say
 * what the pattern bar already says on every track. A click puts the track
 * back on the scene.
 * @param {Track} t
 */
export function paintTrackSlotBadge(t) {
  const el = t?.el?.querySelector(".sq-track__slot");
  if (!el) return;
  const slot = trackSlot(t);
  const off = !!t._clipOff;
  const show = off || slot !== state.activePattern;
  el.hidden = !show;
  if (!show) return;
  el.textContent = off ? "off" : `p${slot + 1}`;
  el.classList.toggle("is-off", off);
  el.title = off
    ? `no clip playing on this track. Click to play pattern ${state.activePattern + 1} with the others`
    : `this track is on pattern ${slot + 1} while the others are on ${state.activePattern + 1}. Click to bring it back`;
}

function paintPatternBarUI() {
  // The p-lock button's state belongs to the pattern, so it changes under you.
  refreshAllPatternLockUI();
  renderPatternGrid();
  syncRepeatsUI();
  syncMeterUI();
  // The clip and arrangement views draw which slot each track is on
  // (clipView.js, arrangeView.js); a switch is what moves it.
  window.dispatchEvent(new CustomEvent("seqbaby:clips"));
}

/** Write the active pattern's repeat count back into the rep field. */
export function syncRepeatsUI() {
  const repInput = document.getElementById("pattern-repeats");
  if (repInput) repInput.value = state.patternRepeats[state.activePattern] ?? 1;
}

export function syncMeterUI() {
  const sel = document.getElementById("pattern-meter");
  if (sel) {
    const m = activeMeter();
    sel.value = `${m.num}/${m.den}`;
  }
  paintBeatIndicator(state.tick);
}

// ---- session save/load -------------------------------------------------

