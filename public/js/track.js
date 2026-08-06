import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { DX7_DEFAULTS } from "./dx7.js";
import { BASS_DEFAULTS } from "./bass.js";
import { defaultFxConfig } from "./fxRack.js";
import { GUITAR_DEFAULTS } from "./guitar.js";
import { chordSelectionFor } from "./keyboard.js";
import { applySampleSpeed, defaultLFOConfig, disposeLFOs, syncAllLFOs } from "./lfo.js";
import { autoAccents, guessIsDrumKit, patternMeter, stepsPerBarForMeter, totalSteps } from "./meter.js";
import { updatePlaitsControlsVisibility } from "./params.js";
import { renderPatternGrid } from "./patternBar.js";
import { refreshAutIfOpen, refreshRollIfOpen } from "./pianoRoll.js";
import { paintDiceDensity, refreshFxPanelUI, renderModPanel, renderTrack } from "./render.js";
import { applySet } from "./session.js";
import { applyCompressorConfig, defaultCompConfig, ensureFxRack, refreshCompSourceDropdowns, routeVoiceToRack } from "./signal.js";
import { aliasPattern, clonePattern, emptyPattern, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, midiToScaleIndex, scaleIndexToMidi } from "./theory.js";
import { requestMidiIfNeeded } from "./transport.js";
import { VIRUS_DEFAULTS } from "./virus.js";
import { buildVoiceForEngine } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Create a track with a fresh 32-pattern bank and default params.
 * @param {{ name:string, engineKey:string, length?:number }} opts
 * @returns {Track}
 */
export function createTrack({ name, engineKey, length = totalSteps() }) {
  const len = Math.max(1, length);
  const t = {
    id: state.nextId++,
    name,
    engineKey,
    length: len,
    accents: autoAccents(len, { num: 4, den: 4 }),
    // steps/lengths/notes/velocities/chords are aliased to t.patterns[activePattern].*
    steps:      null,
    lengths:    null,
    notes:      null,
    velocities: null,
    chords:     null,
    muted: false,
    soloed: false,
    isDrumKit: guessIsDrumKit({ engineKey, name }),
    glide: 0,
    sampleSpeedMode: "native",
    // When on, sample voices ignore the step's note pitch and play at their
    // fit/natural rate — keeps bpm-fitted loops locked to the grid. Off lets
    // the note transpose the sample (classic melodic sampler behavior).
    pitchLock: true,
    density: 0.5,
    speed: 1,
    // A track added mid-play joins on the step everyone else is on, not at 0.
    // At 1x the per-track counter advances once per 16n, so it tracks state.tick.
    trackTick: state.playing ? state.tick : 0,
    repeatId: null,
    soundPromptText: "",
    promptText: "",
    // Track-level sample settings (the sampler's region / fades / loop). Edited
    // in the "sample" modal; the transport reads these for every hit. (Formerly
    // per-step; now one setting for the whole track.)
    sampleDefaults: { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off" },
    // Note-triggered slicer. slices = 0..1 slice START positions (sorted).
    // sliceOn routes notes to slices; sliceBase = MIDI note of slice 0;
    // slicePlayMode "region" (to next marker) | "toend" (marker → sample end).
    slices: [],
    sliceOn: false,
    sliceBase: 60,
    slicePlayMode: "region",
    sliceSensitivity: 0.5,
    params: {
      vol: 0.8, harm: 0.5, timb: 0.5, morph: 0.5, decay: 0.4,
      osc1: 0.55, osc2: 0.45, osc3: 0.35, osc4: 0.4,
      ultra: 0.35, fm: 0, metal: 0,
      // Moog osc-bank params
      osc1wave: "sawtooth", osc2wave: "sawtooth", osc3wave: "triangle",
      osc1range: 0, osc2range: 0, osc3range: -1,
      osc2freq: 0, osc3freq: 0,
      noise: 0, noisetype: "white",
      // TB-303 panel controls that don't fit the four timbre sliders
      wave303: "saw", accent303: 0.6, tune303: 0,
      // Access Virus panel (see virus.js)
      ...VIRUS_DEFAULTS,
      // DX7 operator matrix + globals (see dx7.js)
      ...DX7_DEFAULTS,
      // Electric guitar: string, pickup, amp, cab (see guitar.js)
      ...GUITAR_DEFAULTS,
      // Electric bass: the same chain again, wound differently (see bass.js)
      ...BASS_DEFAULTS,
    },
    // The sound every unlocked pattern shares; a p-locked pattern keeps its
    // own on the pattern instead (patternSound.js). Filled on the first flush.
    baseSound: null,
    filter: { cutoff: 1, reson: 0, env: 0, attack: 0, decay: 0.25, sustain: 0.4, release: 0.3 },
    filterNode: null,
    eq: { low: 0, mid: 0, high: 0 },
    eqNode: null,
    comp: defaultCompConfig(),
    compNode: null,
    patterns: null,   // set below
    _patternIdx: 0,
    lfoConfig: defaultLFOConfig(),
    lfos: { vol: null, harm: null, timb: null, morph: null, decay: null },
    voice: null,
    midi: { outputId: "", channel: 1 },
    customConfig: null,
    fxConfig: defaultFxConfig(),
    fxRack: null,
    el: null,
  };
  t.patterns = Array(PATTERN_COUNT).fill(null).map(() => emptyPattern(len));
  aliasPattern(t, state.activePattern);
  state.tracks.push(t);
  renderTrack(t);
  refreshCompSourceDropdowns();
  if (state.ready) {
    ensureFxRack(t);
    t.voice = buildVoiceForEngine(state.audioCtx, engineKey, t.params, t);
    if (t.voice.type === "midi") {
      t.voice.setChannel(t.midi.channel);
      const out = state.midi?.outputs.get(t.midi.outputId);
      if (out) t.voice.setOutput(out);
      requestMidiIfNeeded(); // MIDI access is lazy; this may be the first MIDI track
    }
    routeVoiceToRack(t);
  }
  return t;
}

// Deep-clone a track's state onto a new track placed after it in DOM +
// state order. Mirrors the per-track apply logic in applySet: createTrack +
// field fill + audio rebuild. Audio-node refs / DOM handles aren't copied —
// they're freshly built. Sample buffers (eleven / upload) are shared since
// they're immutable decoded AudioBuffers.
/**
 * Deep-clone a track (patterns, params, fx, sample payload) with a new id.
 * @param {Track} src @returns {Track}
 */
export function duplicateTrack(src) {
  const baseName = (src.name || "track").replace(/\s+copy(\s+\d+)?$/i, "").trim() || "track";
  const existing = new Set(state.tracks.map(x => x.name));
  let name = `${baseName} copy`;
  for (let i = 2; existing.has(name); i++) name = `${baseName} copy ${i}`;

  const dup = createTrack({ name, engineKey: src.engineKey, length: src.length });

  Object.assign(dup.params, src.params);
  Object.assign(dup.filter, src.filter);
  Object.assign(dup.eq, src.eq);
  Object.assign(dup.midi, src.midi);
  dup.fxConfig = JSON.parse(JSON.stringify(src.fxConfig));
  dup.comp = JSON.parse(JSON.stringify(src.comp));
  dup.customConfig = src.customConfig ? JSON.parse(JSON.stringify(src.customConfig)) : null;
  dup.sampleSource = src.sampleSource ? { ...src.sampleSource } : null;
  dup.uploadAudio = src.uploadAudio || null;
  dup.uploadAudioMime = src.uploadAudioMime || null;
  dup.uploadFileName = src.uploadFileName || null;
  dup.uploadBuffer = src.uploadBuffer || null;
  dup.soundPromptText = src.soundPromptText || "";
  dup.promptText = src.promptText || "";
  dup.sampleDefaults = src.sampleDefaults ? { ...src.sampleDefaults } : dup.sampleDefaults;
  dup.slices = Array.isArray(src.slices) ? src.slices.slice() : [];
  dup.sliceOn = !!src.sliceOn;
  dup.sliceBase = src.sliceBase ?? 60;
  dup.slicePlayMode = src.slicePlayMode === "toend" ? "toend" : "region";
  dup.sliceSensitivity = src.sliceSensitivity ?? 0.5;
  dup.muted = !!src.muted;
  dup.soloed = !!src.soloed;
  dup.isDrumKit = !!src.isDrumKit;
  dup.glide = src.glide ?? 0;
  dup.speed = src.speed ?? 1;
  // Land the copy on the step its source is on. trackTick is the per-track step
  // counter the transport reads; createTrack starts it at 0, so duplicating
  // mid-play would drop the copy in at step 0 while the original is mid-pattern
  // — the two run out of phase, audibly and in the playhead. speedAccum is the
  // sub-step remainder for tracks that aren't at 1× and has to travel with it.
  dup.trackTick = src.trackTick ?? 0;
  dup.speedAccum = src.speedAccum ?? 0;
  dup.density = src.density ?? 0.5;
  dup.sampleSpeedMode = src.sampleSpeedMode ?? "native";
  dup.pitchLock = src.pitchLock ?? true;
  for (const k of Object.keys(dup.lfoConfig)) {
    if (src.lfoConfig?.[k]) dup.lfoConfig[k] = { ...src.lfoConfig[k] };
  }
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const sp = src.patterns[i];
    if (!sp) continue;
    dup.patterns[i] = clonePattern(sp);
  }
  aliasPattern(dup, state.activePattern);

  if (dup.el) {
    const q = sel => dup.el.querySelector(sel);
    q(".sq-track__name").value = dup.name;
    q(".sq-track__len").value = dup.length;
    q(".sq-track__engine").value = dup.engineKey;
    const spd = q(".sq-track__speed"); if (spd) spd.value = String(dup.speed);
    q(".p-vol").value = dup.params.vol;
    q(".p-harm").value = dup.params.harm;
    q(".p-timb").value = dup.params.timb;
    q(".p-morph").value = dup.params.morph;
    q(".p-decay").value = dup.params.decay;
    q(".p-cutoff").value = dup.filter.cutoff;
    q(".p-reson").value = dup.filter.reson;
    q(".p-envamt").value = dup.filter.env;
    q(".p-envatk").value = dup.filter.attack;
    q(".p-envdec").value = dup.filter.decay;
    q(".p-envsus").value = dup.filter.sustain;
    q(".p-envrel").value = dup.filter.release;
    dup.el.classList.toggle("is-muted", dup.muted);
    dup.el.classList.toggle("is-soloed", dup.soloed);
    q(".sq-track__solo")?.setAttribute("aria-pressed", String(dup.soloed));
    refreshFxPanelUI(dup);
    renderModPanel(dup, dup._modPanelEl || dup.el.querySelector(".sq-track__mod-panel"));
  }

  // Move the duplicate right after the source in DOM + state order.
  const srcIdx = state.tracks.indexOf(src);
  if (srcIdx >= 0 && srcIdx < state.tracks.length - 1) {
    state.tracks.pop();
    state.tracks.splice(srcIdx + 1, 0, dup);
    src.el.parentNode.insertBefore(dup.el, src.el.nextSibling);
  }

  if (state.ready) {
    disposeLFOs(dup);
    if (dup.voice) dup.voice.dispose();
    ensureFxRack(dup);
    if (dup.fxRack) {
      if (dup.fxConfig.vinyl)      dup.fxRack.applyVinyl(dup.fxConfig.vinyl);
      if (dup.fxConfig.cassette)   dup.fxRack.applyCassette(dup.fxConfig.cassette);
      dup.fxRack.applyFuzz(dup.fxConfig.fuzz);
      if (dup.fxConfig.ringmod)    dup.fxRack.applyRingMod(dup.fxConfig.ringmod);
      if (dup.fxConfig.crush)      dup.fxRack.applyCrush(dup.fxConfig.crush);
      if (dup.fxConfig.autowah)    dup.fxRack.applyAutoWah(dup.fxConfig.autowah);
      if (dup.fxConfig.chorus)     dup.fxRack.applyChorus(dup.fxConfig.chorus);
      if (dup.fxConfig.phaser)     dup.fxRack.applyPhaser(dup.fxConfig.phaser);
      if (dup.fxConfig.flanger)    dup.fxRack.applyFlanger(dup.fxConfig.flanger);
      if (dup.fxConfig.pitchshift) dup.fxRack.applyPitchShift(dup.fxConfig.pitchshift);
      dup.fxRack.applyDelay(dup.fxConfig.delay);
      dup.fxRack.applyReverb(dup.fxConfig.reverb);
    }
    dup.voice = buildVoiceForEngine(state.audioCtx, dup.engineKey, dup.params, dup);
    if (dup.voice.type === "midi") {
      dup.voice.setChannel(dup.midi.channel);
      const out = state.midi?.outputs.get(dup.midi.outputId);
      if (out) dup.voice.setOutput(out);
    }
    if (dup.voice.setGlide) dup.voice.setGlide(dup.glide);
    routeVoiceToRack(dup);
    applySampleSpeed(dup);
    syncAllLFOs(dup);
  }
  refreshCompSourceDropdowns();
  updatePlaitsControlsVisibility(dup);
  paintDiceDensity(dup);          // density is copied after the row is rendered
  renderStepGrid(dup);
  return dup;
}

export function removeTrack(t) {
  if (t._trackMenuModal) t._trackMenuModal.close();
  disposeLFOs(t);
  if (t.voice) t.voice.dispose();
  if (t.fxRack) t.fxRack.dispose();
  if (t.compNode) t.compNode.dispose();
  t.el.remove();
  state.tracks = state.tracks.filter(x => x !== t);
  refreshCompSourceDropdowns();
  // if any remaining track was sidechained to the removed one, reset it to self
  for (const x of state.tracks) {
    if (x.comp.source && x.comp.source !== "self" && !state.tracks.find(y => String(y.id) === String(x.comp.source))) {
      x.comp.source = "self";
      applyCompressorConfig(x);
      const sel = x.el?.querySelector(".sq-comp__source");
      if (sel) sel.value = "self";
    }
  }
}

export function resizePattern(t, patIdx, len) {
  len = Math.max(1, Math.min(128, len | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const pad = (arr, fill) => new Array(len).fill(fill).map((_, i) => arr?.[i] ?? fill);
  p.steps       = pad(p.steps, 0);
  p.lengths     = pad(p.lengths, 0);
  p.notes       = pad(p.notes, null);
  p.velocities  = pad(p.velocities, 0.5);
  p.chords      = pad(p.chords, "");
  p.offsets     = pad(p.offsets, 0);
  p.arps        = pad(p.arps, false);
  p.arpRates    = pad(p.arpRates, 0.25);
  p.arpRanges   = pad(p.arpRanges, 1);
  p.arpDirs     = pad(p.arpDirs, "up");
  p.complexities= pad(p.complexities, 0);
  p.ratchets    = pad(p.ratchets, 1);
  p.sampleStarts    = pad(p.sampleStarts, 0);
  p.sampleEnds      = pad(p.sampleEnds, 1);
  p.sampleFadeIns   = pad(p.sampleFadeIns, 0);
  p.sampleFadeOuts  = pad(p.sampleFadeOuts, 0);
  p.sampleLoopModes = pad(p.sampleLoopModes, "off");
  p.extraNotes = pad(p.extraNotes, null);
  p.extraLengths = pad(p.extraLengths, null);
  // Resize automation lanes to match new pattern length.
  if (p.automation) {
    for (const key in p.automation) {
      const lane = p.automation[key];
      if (lane && Array.isArray(lane.values)) {
        lane.values = pad(lane.values, 0.5);
      }
    }
  }
  for (let i = 0; i < len; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, len - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = len;
    t.accents = autoAccents(len, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".sq-track__len").value = len;
    renderStepGrid(t);
    refreshAutIfOpen(t);
  }
  renderPatternGrid();
}

// resizeTrack now resizes only the active pattern (per-pattern lengths).
export function resizeTrack(t, len) {
  resizePattern(t, t._patternIdx ?? state.activePattern, len);
}

// Shrink a pattern by slicing every per-step array down to `newLen`. Notes
// that started before newLen but extended past it get clamped. Mirror of
// extendPatternByDuplicate. Clamps to [1, 128].
export function truncatePattern(t, patIdx, newLen) {
  newLen = Math.max(1, Math.min(128, newLen | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const oldLen = p.steps.length;
  if (newLen >= oldLen) return;
  const KEYS = [
    "steps","lengths","notes","velocities","chords","offsets",
    "arps","arpRates","arpRanges","arpDirs","complexities","ratchets",
    "sampleStarts","sampleEnds","sampleFadeIns","sampleFadeOuts","sampleLoopModes",
    "extraNotes","extraLengths",
  ];
  for (const k of KEYS) if (Array.isArray(p[k])) p[k] = p[k].slice(0, newLen);
  if (p.automation) {
    for (const lane of Object.values(p.automation)) {
      if (lane && Array.isArray(lane.values)) lane.values = lane.values.slice(0, newLen);
    }
  }
  for (let i = 0; i < newLen; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, newLen - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = newLen;
    t.accents = autoAccents(newLen, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".sq-track__len").value = newLen;
    renderStepGrid(t);
    refreshAutIfOpen(t);
    refreshRollIfOpen(t);
  }
  renderPatternGrid();
}

// Extend a pattern's length while duplicating existing content into the new
// space. Two source modes:
//   "tile"    — `i % oldLen` wraps from index 0; right for x2 / x4 where the
//               whole pattern should repeat as a loop.
//   "lastBar" — the new region copies the LAST `barLen` steps of the old
//               pattern; right for +1 where the user wants another copy of
//               "what just played" rather than the start.
// Clamps to [1, 128].
export function extendPatternByDuplicate(t, patIdx, newLen, opts = {}) {
  const sourceMode = opts.sourceMode === "lastBar" ? "lastBar" : "tile";
  const barLen = Math.max(1, opts.barLen | 0 || stepsPerBarForMeter(patternMeter(patIdx)));
  newLen = Math.max(1, Math.min(128, newLen | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const oldLen = p.steps.length;
  if (newLen <= oldLen) return;
  const FILL = {
    steps: 0, lengths: 0, notes: null, velocities: 0.5, chords: "",
    offsets: 0, arps: false, arpRates: 0.25, arpRanges: 1, arpDirs: "up",
    complexities: 0, ratchets: 1,
    sampleStarts: 0, sampleEnds: 1, sampleFadeIns: 0, sampleFadeOuts: 0,
    sampleLoopModes: "off",
    extraNotes: null,
    extraLengths: null,
  };
  // For "lastBar" mode the source window starts `barLen` steps before the
  // boundary. Falls back to "tile" if there isn't a full bar to copy.
  const lastBarStart = Math.max(0, oldLen - Math.min(barLen, oldLen));
  const sourceLen    = Math.min(barLen, oldLen);
  const srcFor = (i) => {
    if (i < oldLen) return i;
    if (sourceMode === "lastBar" && sourceLen > 0) {
      return lastBarStart + ((i - oldLen) % sourceLen);
    }
    return i % oldLen;
  };
  for (const [key, fill] of Object.entries(FILL)) {
    const arr = p[key];
    if (!Array.isArray(arr)) continue;
    const next = new Array(newLen);
    for (let i = 0; i < newLen; i++) {
      next[i] = arr[srcFor(i)] ?? fill;
    }
    p[key] = next;
  }
  if (p.automation) {
    for (const lane of Object.values(p.automation)) {
      if (!lane || !Array.isArray(lane.values)) continue;
      const next = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        next[i] = lane.values[srcFor(i)] ?? 0.5;
      }
      lane.values = next;
    }
  }
  for (let i = 0; i < newLen; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, newLen - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = newLen;
    t.accents = autoAccents(newLen, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".sq-track__len").value = newLen;
    renderStepGrid(t);
    refreshAutIfOpen(t);
    refreshRollIfOpen(t);
  }
  renderPatternGrid();
}


export function resizeAllTracks() {
  const len = totalSteps();
  state.tracks.forEach(t => resizeTrack(t, len));
}

export function clearRange(t, from, to, keep) {
  for (let i = Math.max(0, from); i <= Math.min(t.steps.length - 1, to); i++) {
    if (!t.steps[i] || i === keep) continue;
    t.steps[i] = 0;
    t.lengths[i] = 0;
    t.notes[i] = null;
    t.velocities[i] = 0.5;
    t.chords[i] = "";
    if (t.extraNotes) t.extraNotes[i] = null;
    if (t.extraLengths) t.extraLengths[i] = null;
  }
}

export function maxLengthAt(t, anchor) {
  const total = t.steps.length;
  // A note can extend to the next active step, or to the end of the track —
  // including across bar rows (the step grid renders a cross-row held note as
  // per-row chunks). Only the track length (and the next note) bound it.
  let cap = total - anchor;
  for (let j = anchor + 1; j < total; j++) {
    if (t.steps[j]) { cap = Math.min(cap, j - anchor); break; }
  }
  return Math.max(1, cap);
}

export function anchorCovering(t, idx) {
  for (let i = idx; i >= 0; i--) {
    if (t.steps[i]) {
      const len = Math.max(1, t.lengths[i] || 1);
      if (i + len > idx) return i;
      return -1;
    }
  }
  return -1;
}

// What pitch should a fresh note take? Prefer the last note the user
// explicitly placed or moved on this track; fall back to the highest-index
// existing triggered note in the active pattern; finally an engine-appropriate
// root for empty patterns. Sampler tracks anchor to the slice root (sliceBase,
// set to the sample's natural octave on load) so the first note plays the sample
// naturally / triggers slice 0. Drum-kit tracks return C2.
export function lastUsedNote(t) {
  const isSampler = t.engineKey === "sampler";
  if (t.lastEditedNote != null && Number.isFinite(t.lastEditedNote)) return t.lastEditedNote;
  if (t.steps && t.notes) {
    for (let i = t.length - 1; i >= 0; i--) {
      if (t.steps[i] && t.notes[i] != null) return t.notes[i];
    }
  }
  if (isSampler) return t.sliceBase ?? (t.isDrumKit ? 36 : 60);
  if (t.isDrumKit) return 36;
  return 48 + (state.scale.root | 0);
}

/**
 * Stamp the keyboard's arp settings onto a step that just received a chord from
 * the keyboard (record / capture / click-to-apply). `hasChord` gates it because
 * there's nothing to arpeggiate on a single note. Clears the flag otherwise, so
 * arp state doesn't ghost onto a step that's being rewritten without one.
 */
export function applyKbdArpToStep(t, idx, hasChord) {
  if (!Array.isArray(t.arps)) return;
  const on = !!(hasChord && state.kbdChordType && state.kbdArp);
  t.arps[idx] = on;
  if (!on) return;
  if (Array.isArray(t.arpRates))  t.arpRates[idx]  = Number(state.kbdArpRate) || 0.25;
  if (Array.isArray(t.arpRanges)) t.arpRanges[idx] = Math.max(1, Math.min(4, Number(state.kbdArpRange) || 1));
  if (Array.isArray(t.arpDirs))   t.arpDirs[idx]   = state.kbdArpDir || "up";
}

/**
 * Turn on the step at `anchor`. `noteHint` is the pitch the caller already knows
 * the step will take (the piano roll clicks a specific row), so chord mode can
 * build its chord on that root rather than guessing.
 */
export function startNote(t, anchor, noteHint = null) {
  clearRange(t, anchor, anchor, -1);
  t.steps[anchor] = 1;
  t.lengths[anchor] = 1;
  if (t.notes[anchor] == null) {
    // If the keyboard is active and a note/chord was just played, paint that onto
    // the new step (root + chord type + inversion + polyphonic extras). Otherwise
    // drum-kit tracks pin to C2 and melodic tracks reuse the last placed pitch.
    const kbd = state.kbdNotesOn ? state.kbdLast : null;
    // Chord mode is a mode, not a memory of the last keypress: while it's on, a
    // plain step click gets the chord (and the keyboard's arp settings, via
    // applyKbdArpToStep below) built on whatever root the step would have taken.
    // Drum kits sit chord mode out entirely — chord mode is a global toggle and
    // a chord on a kit is just the same sample fired at three pitches, so the
    // step keeps its root and nothing else (also for a chord already sitting in
    // kbdLast from a keypress, and for the diatonic fallback's explicit tones).
    let sel = (state.kbdChordType && !t.isDrumKit)
      ? chordSelectionFor(noteHint ?? kbd?.root ?? lastUsedNote(t))
      : kbd;
    if (sel && t.isDrumKit && (sel.chord || state.kbdChordType)) {
      sel = { root: sel.root, chord: "", cpx: 0, extras: null };
    }
    if (sel) {
      t.notes[anchor] = sel.root;
      if (Array.isArray(t.chords)) t.chords[anchor] = sel.chord || "";
      if (Array.isArray(t.complexities)) t.complexities[anchor] = sel.cpx | 0;
      const extras = sel.extras && sel.extras.length ? sel.extras.slice() : null;
      if (Array.isArray(t.extraNotes)) t.extraNotes[anchor] = extras;
      if (Array.isArray(t.extraLengths)) t.extraLengths[anchor] = extras ? extras.map(() => 1) : null;
      applyKbdArpToStep(t, anchor, !!sel.chord);
      if (!t.isDrumKit) t.lastEditedNote = sel.root;
    } else {
      t.notes[anchor] = lastUsedNote(t);
      if (!t.isDrumKit) t.lastEditedNote = t.notes[anchor];
    }
  }
  applySampleDefaultsToStep(t, anchor);
}

// Bump every active step's pitch up by one note. Scale-aware: in scale mode
// it's a scale-degree; chromatic mode is +1 semitone. Drum kits also walk up
// (no semantic reason to skip; user can always undo by editing).
export function applyRollPitchUp(t) {
  const intervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const root = state.scale.root;
  for (let i = 0; i < t.length; i++) {
    if (!t.steps[i] || t.notes[i] == null) continue;
    const p = t.notes[i];
    let next = p + 1;
    if (intervals) {
      const idx = midiToScaleIndex(p, root, intervals);
      if (idx != null) next = scaleIndexToMidi(idx + 1, root, intervals);
    }
    t.notes[i] = Math.max(0, Math.min(127, next));
    if (!t.isDrumKit) t.lastEditedNote = t.notes[i];
  }
}

// Shift every step's note on every pattern by `semis` semitones (±12 for
// octaves). Clamps to MIDI 24..95. Works for any track, including drum kits.
// Redraws the active pattern's grid.
export function shiftTrackOctave(t, semis) {
  let touched = 0;
  for (const p of t.patterns) {
    if (!p) continue;
    for (let i = 0; i < p.notes.length; i++) {
      const n = p.notes[i];
      if (n == null) continue;
      const next = Math.max(24, Math.min(95, n + semis));
      if (next !== n) { p.notes[i] = next; touched++; }
    }
  }
  renderStepGrid(t);
  if (touched) setStatus(`"${t.name}" shifted ${semis > 0 ? "+" : "−"}1 octave (${touched} note${touched === 1 ? "" : "s"})`);
}

// Seed a step's sample-settings (start/end/fades/loop) from the track default.
export function applySampleDefaultsToStep(t, idx) {
  const d = t.sampleDefaults;
  if (!d) return;
  if (!t.sampleStarts) t.sampleStarts = new Array(t.length).fill(0);
  if (!t.sampleEnds)   t.sampleEnds   = new Array(t.length).fill(1);
  if (!t.sampleFadeIns)  t.sampleFadeIns  = new Array(t.length).fill(0);
  if (!t.sampleFadeOuts) t.sampleFadeOuts = new Array(t.length).fill(0);
  if (!t.sampleLoopModes) t.sampleLoopModes = new Array(t.length).fill("off");
  t.sampleStarts[idx]   = d.start ?? 0;
  t.sampleEnds[idx]     = d.end ?? 1;
  t.sampleFadeIns[idx]  = d.fadeIn ?? 0;
  t.sampleFadeOuts[idx] = d.fadeOut ?? 0;
  t.sampleLoopModes[idx] = d.loopMode || "off";
}

// Overwrite every active step's sample settings across every pattern on the track.
export function applySampleSettingsToAllSteps(t, settings) {
  const { start, end, fadeIn, fadeOut, loopMode } = settings;
  for (const p of t.patterns) {
    if (!p) continue;
    const n = p.steps.length;
    if (!p.sampleStarts)    p.sampleStarts    = new Array(n).fill(0);
    if (!p.sampleEnds)      p.sampleEnds      = new Array(n).fill(1);
    if (!p.sampleFadeIns)   p.sampleFadeIns   = new Array(n).fill(0);
    if (!p.sampleFadeOuts)  p.sampleFadeOuts  = new Array(n).fill(0);
    if (!p.sampleLoopModes) p.sampleLoopModes = new Array(n).fill("off");
    for (let i = 0; i < n; i++) {
      if (!p.steps[i]) continue;
      p.sampleStarts[i]   = start;
      p.sampleEnds[i]     = end;
      p.sampleFadeIns[i]  = fadeIn;
      p.sampleFadeOuts[i] = fadeOut;
      p.sampleLoopModes[i] = loopMode;
    }
  }
}

export function extendNote(t, anchor, toIdx) {
  if (toIdx < anchor) toIdx = anchor;
  const desired = toIdx - anchor + 1;
  clearRange(t, anchor + 1, anchor + desired - 1, anchor);
  const cap = maxLengthAt(t, anchor);
  t.lengths[anchor] = Math.min(desired, cap);
}

export function removeNote(t, anchor) {
  t.steps[anchor] = 0;
  t.lengths[anchor] = 0;
  t.notes[anchor] = null;
  t.velocities[anchor] = 0.5;
  t.chords[anchor] = "";
  if (t.extraNotes) t.extraNotes[anchor] = null;
  if (t.extraLengths) t.extraLengths[anchor] = null;
}

// ---- rendering ---------------------------------------------------------

