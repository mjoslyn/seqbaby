import { AUTOMATION_TARGETS } from "./automation.js";
import { paintBeatIndicator } from "./beat.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { activeMeter, autoAccents } from "./meter.js";
import { renderPatternGrid } from "./patternBar.js";
import { refreshAutIfOpen, refreshRollIfOpen } from "./pianoRoll.js";
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
  noteColors: false,  // diatonic pitch-class coloring on the roll + step grid
  currentSetName: null,  // last loaded/saved session name — drives version-bump suggestions
  audioCtx: null,
  ready: false,
  masterGain: null,
  masterLimiter: null,
  masterAnalyser: null,
  morphagene: null,          // MorphageneNode (master-bus granular tape processor)
  morphageneConfig: null,    // its control settings; init'd to defaultMorphageneConfig()
  morphageneStatusCb: null,  // reel-fill meter callback, attached when the node builds
  morphageneFxConfig: null,  // FXRack config for the morphagene wet path (defaultFxConfig shape)
  morphageneModConfig: null, // LFO modulation rack config (per MG_MOD_KEYS)
  morphageneAutomation: null,// global 16-step automation lanes keyed by param
  globalFx: null,            // master-bus FXRack (post-morphagene, pre-limiter)
  globalFxConfig: null,      // its FXRack config (defaultFxConfig shape)
  globalFxModConfig: null,   // its LFO modulation rack config
  globalFxAutomation: null,  // its global 16-step automation lanes
  midi: null,
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
  };
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
  if (idx === state.activePattern) { state.queuedPattern = null; renderPatternGrid(); return; }
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
export function switchPattern(idx) {
  if (idx < 0 || idx >= PATTERN_COUNT) return;
  state.activePattern = idx;
  state.queuedPattern = null;
  for (const t of state.tracks) {
    aliasPattern(t, idx);
    renderStepGrid(t);
    refreshRollIfOpen(t);
    refreshAutIfOpen(t);
  }
  renderPatternGrid();
  const repInput = document.getElementById("pattern-repeats");
  if (repInput) repInput.value = state.patternRepeats[idx] ?? 1;
  syncMeterUI();
  state.chainBarCount = 0;
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

