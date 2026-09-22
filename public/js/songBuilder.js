// Writing a song without a browser.
//
// Everything in the studio edits a live session: the step grid writes into
// aliased pattern arrays, the panels write params and push them to a voice.
// None of that exists outside a tab -- and an agent, a script or a test that
// wants to write a song has nothing to press. What it CAN produce is the one
// thing the studio also reads: the serialized session (session.js, applySet).
//
// So this module builds that blob. It holds no state of its own: every function
// takes the song object and mutates it, and the object it makes is a session
// applySet will load -- validated by validateSet on the way out, and shaped so
// that what it leaves out, applySet defaults (createTrack fills every field the
// track object lacks from soundDefaults.js / engineData.js, so a sparse track
// here and a full one saved by the studio load to the same thing).
//
// No imports but the pure half of the engine (engineData.js, soundDefaults.js,
// constants.js, chanceGen.js, theoryData.js, sessionFormat.js), on purpose:
// this is what mcp/server.mjs runs under Node, and what test/songBuilder.test.js
// exercises. Validation here is against the SAME tables the engine reads --
// the engine keys, the panel controls and their ranges, the LFO targets, the
// automation lanes, the gates (canModulateKey / canAutomateKey) -- so a song
// this module accepts is one the studio can hold, and an engine control added
// to its list is a control this module knows the next time it runs.
//
// Conventions an agent needs, in one place:
//   - a track is addressed by its INDEX in song.tracks; a pattern by 0..31
//   - a step string spells a pattern: `x` a hit, `X` an accent, `o` a soft hit,
//     `.` or `-` a rest, `_` extends the hit before it by a step, a digit 1..9
//     a hit at that velocity in tenths; spaces and `|` are ignored. A string
//     shorter than the pattern tiles across it when it divides evenly
//   - notes are MIDI numbers or names ("C2", "F#3", "Bb1"); a step with no note
//     plays the engine's default (C2 on a drum kit, C4 on most synths)
//   - values are the slider's own units: 0..1 for nearly everything, the eq in
//     dB, the compressor in dB / ratio / seconds, an engine panel control in
//     the range its table gives
//   - cross-track references (a send to an fx bus, a sidechain source) are
//     track indices, as in the serialized format

import {
  BASS_NUM_CTLS, BASS_SEL_CTLS, BASS_TONE_NAMES, bassTone, bassToneDescription,
  BUNDLED_SAMPLES, CONTAGION_NUM_KEYS, CONTAGION_SEL_KEYS,
  GRANULAR_SAMPLES, GRAN_MOD_RANGE, GRAN_NUM_KEYS, GRAN_RATE_BEATS, GRAN_SEL_KEYS,
  GUITAR_NUM_CTLS, GUITAR_SEL_CTLS, GUITAR_TONE_NAMES, guitarTone, guitarToneDescription,
  HEXOP_MOD_RANGE, HEXOP_NUM_KEYS, HEXOP_OPS, HEXOP_PRESET_NAMES, hexopPreset,
  PLAITS_MACRO_TIPS, ENGINE_MACRO_TIPS,
  STATIC_ENGINES, staticEngineByKey, engineSliderLabels,
  SUB_NUM_CTLS, SUB_SEL_CTLS, SUB_TONE_NAMES, subTone, subToneDescription,
} from "./engineData.js";
import { EUCLID_DEFAULTS, FILTER_TYPES, defaultCompConfig, defaultEq, defaultFilter, defaultFxConfig, defaultTrackParams } from "./soundDefaults.js";
import {
  AUTOMATION_TARGETS, FX_STAGE_LEVEL_KEY, LFO_DIVS, LFO_KEYS, LFO_LABELS, PATTERN_COUNT, STEPS_PER_BAR,
  canAutomateKey, canModulateKey, lfoDivLabel, voiceAutoKeysForEngineKey,
} from "./constants.js";
import { CHANCE_DEFAULTS, CHANCE_NOTE_MAX, CHANCE_NOTE_MIN, CHANCE_NOTE_VALUES, cloneChance } from "./chanceGen.js";
import { CHORD_TYPES, SCALES, canonicalChord, midiToName, nameToMidi } from "./theoryData.js";
import { SET_VERSION, validateSet } from "./sessionFormat.js";

/** What every refusal in this module throws: a message an agent can act on. */
export class SongError extends Error {
  constructor(msg) { super(msg); this.name = "SongError"; }
}
const fail = (msg) => { throw new SongError(msg); };

// ---- small helpers ----------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function num(v, what, lo, hi) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (!isNum(n)) fail(`${what} must be a number, got ${JSON.stringify(v)}`);
  if (lo != null && n < lo || hi != null && n > hi) fail(`${what} must be between ${lo} and ${hi}, got ${n}`);
  return n;
}
function int(v, what, lo, hi) { return Math.round(num(v, what, lo, hi)); }
function oneOf(v, what, list) {
  const s = String(v);
  if (!list.map(String).includes(s)) fail(`${what} must be one of ${list.join(", ")}, got ${JSON.stringify(v)}`);
  return s;
}
/** A note as MIDI: a number, or a name like C2 / F#3 / Bb1. */
export function toMidi(v, what = "note") {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const m = nameToMidi(v);
    if (m != null) return m;
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n)) return n;
  }
  fail(`${what} must be a MIDI number or a note name like C2 or F#3, got ${JSON.stringify(v)}`);
}
const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** A pitch class 0..11 from a number or a name ("C", "Eb", "f#"). */
export function toPitchClass(v, what = "root") {
  if (isNum(v)) return ((Math.round(v) % 12) + 12) % 12;
  const m = /^([A-Ga-g])([#b]?)$/.exec(String(v).trim());
  if (!m) fail(`${what} must be 0..11 or a note name like C or Eb, got ${JSON.stringify(v)}`);
  return (NOTE_PC[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
}
const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// The same regex guessIsDrumKit (meter.js) uses; that module reads the live
// catalog, so it is spelled again here rather than imported.
const DRUM_RE = /\b(kick|snare|hat|hi-?hat|clap|tom|perc|drum)\b/;

// ---- engines ---------------------------------------------------------------

/**
 * Resolve what someone wrote to an engine entry: the key (`dm:808-kick`), the
 * label (`808 kick`, `silverbox`, `fm`), or `plaits:<model name>`.
 * @returns {import("./types.js").EngineEntry}
 */
export function resolveEngine(spec) {
  const s = String(spec ?? "").trim();
  if (!s) fail("engine is required (a key like dm:808-kick or a name like silverbox)");
  const byKey = staticEngineByKey(s);
  if (byKey) return byKey;
  const lower = s.toLowerCase();
  const byLabel = STATIC_ENGINES.find(e => e.label.toLowerCase() === lower);
  if (byLabel) return byLabel;
  const pl = /^plaits:(.+)$/.exec(lower);
  if (pl) {
    const hit = STATIC_ENGINES.find(e => e.type === "plaits" && e.label === pl[1].trim());
    if (hit) return hit;
  }
  const near = STATIC_ENGINES.filter(e => e.label.includes(lower) || e.key.includes(lower)).map(e => `${e.key} (${e.label})`);
  fail(`unknown engine ${JSON.stringify(spec)}${near.length ? `; did you mean ${near.slice(0, 6).join(", ")}` : ""}. list_engines has the whole catalog`);
}

/** The engine catalog as data an agent can read: key, label, group, what the
 *  four sliders do, and the presets it takes. */
export function describeEngines() {
  return STATIC_ENGINES.map(e => describeEngine(e.key));
}
export function describeEngine(engineKey) {
  const e = staticEngineByKey(engineKey) || resolveEngine(engineKey);
  const labels = engineSliderLabels(e.key);
  const tips = e.type === "plaits" ? (PLAITS_MACRO_TIPS[e.plaitsIdx] || {}) : (ENGINE_MACRO_TIPS[e.key] || {});
  const sliders = {};
  for (const k of ["harm", "timb", "morph", "decay"]) {
    if (labels[k] == null) continue;
    sliders[k] = { label: labels[k], tip: tips[k] || SLIDER_TIPS[e.key]?.[k] || null };
  }
  const panel = PANELS[e.key];
  return {
    key: e.key, label: e.label, group: e.group, type: e.type,
    poly: !!e.poly, melodic: !!e.melodic, defaultNote: e.defaultNote,
    sliders,
    oscMix: tips.osc || null,
    oscMod: tips.oscMod || null,
    panel: panel ? {
      numeric: panel.num.map(([k, lo, hi, d, label]) => ({ key: panel.prefix + k, label, min: lo, max: hi, default: d })),
      select: panel.sel.map(([k, d, vals]) => ({ key: panel.prefix + k, default: d, values: vals })),
    } : null,
    presets: panel?.tones ? panel.tones.map(n => ({ name: n, description: panel.describe?.(n) || "" })) : [],
    lfoTargets: LFO_KEYS.filter(k => canModulateKey(e.key, k, { euclid: true, chance: true })),
    automationTargets: Object.keys(AUTOMATION_TARGETS).filter(k => canAutomateKey(e.key, k, { euclid: true, chance: true })),
  };
}

// Tips for the engines whose slider descriptions live inline in params.js
// (next to the labels they go with) rather than in the tables. Summarised here
// so describeEngine has something to say for them.
const SLIDER_TIPS = {
  "dm:silverbox": { harm: "filter cutoff", timb: "filter resonance", morph: "how far the envelope opens the filter", decay: "envelope decay" },
  "dm:contagion": { harm: "cutoff for both filters", timb: "resonance, shared by both filters", morph: "oscillator shape, sine through triangle and saw to pulse", decay: "decay for both envelopes" },
  "dm:hexop": { harm: "master modulation index: brightness", timb: "feedback", morph: "modulator decay and release", decay: "carrier decay" },
  "dm:guitar": { harm: "amp drive (exponential, like a gain pot)", timb: "the tone knob on the guitar, a passive lowpass", morph: "bloom: speaker-to-string feedback, a threshold rather than a switch", decay: "sustain" },
  "dm:bass": { harm: "amp drive", timb: "tone", morph: "the rig compressor: threshold down and makeup up together", decay: "sustain" },
  "dm:sub": { harm: "drive into the parallel harmonics path: what makes a sub audible on a small speaker", timb: "lowpass on the harmonics path", morph: "oscillator shape, sine through triangle and saw to square", decay: "decay" },
  "dm:granular": { harm: "grain size", timb: "grain density", morph: "play position in the sample", decay: "spray: window, detune and jitter together" },
  "dm:808-kick": { harm: "tune", timb: "attack click", morph: "drive", decay: "decay" },
  "dm:909-kick": { harm: "tune", timb: "beater click", morph: "drive", decay: "decay" },
};

// The engine panels: what sits outside the four sliders, as [short key, min,
// max, default, label] for the numeric controls and [short key, default,
// values] for the selects, plus the presets. The guitar, bass, sub and hexop
// tables come straight from engineData.js; the contagion, granular, silverbox
// and ladder panels have no such table in the engine (their ranges live in the
// markup), so those are spelled here from app/studioMarkup.ts.
const PANELS = {
  "dm:guitar": { prefix: "gt", num: GUITAR_NUM_CTLS, sel: GUITAR_SEL_CTLS, tones: GUITAR_TONE_NAMES, tone: guitarTone, describe: guitarToneDescription },
  "dm:bass":   { prefix: "bs", num: BASS_NUM_CTLS, sel: BASS_SEL_CTLS, tones: BASS_TONE_NAMES, tone: bassTone, describe: bassToneDescription },
  "dm:sub":    { prefix: "sub", num: SUB_NUM_CTLS, sel: SUB_SEL_CTLS, tones: SUB_TONE_NAMES, tone: subTone, describe: subToneDescription },
  "dm:hexop": {
    prefix: "d",
    num: HEXOP_NUM_KEYS.map(k => { const s = k.slice(1); const [lo, hi] = HEXOP_MOD_RANGE[s]; return [s, lo, hi, null, hexopLabel(s)]; }),
    sel: [
      ["alg", "1", Array.from({ length: 32 }, (_, i) => String(i + 1))],
      ["lfow", "tri", ["tri", "sine", "sawdn", "sawup", "square", "sh"]],
      ["lfok", "on", ["on", "off"]],
      ...HEXOP_OPS.map(i => [`${i}fix`, "ratio", ["ratio", "fixed"]]),
    ],
    tones: HEXOP_PRESET_NAMES, tone: hexopPreset, describe: () => "",
  },
  "dm:contagion": {
    prefix: "v",
    num: CONTAGION_NUM_KEYS.map(k => {
      const s = k.slice(1);
      const r = { osc2semi: [-24, 24], cut2: [-1, 1], envamt: [-1, 1], pw: [0.02, 0.98] }[s] || [0, 1];
      return [s, r[0], r[1], null, `contagion ${s}`];
    }),
    sel: [
      ["mode1", "lp", ["lp", "hp", "bp", "bs"]], ["poles", "4", ["2", "4"]], ["mode2", "lp", ["lp", "hp", "bp", "bs"]],
      ["route", "ser", ["ser", "par", "split"]],
      ["sat", "soft", ["off", "light", "soft", "hard", "digital", "shaper", "rectify", "bits", "rate"]],
      ["subwave", "square", ["square", "triangle"]], ["sync", "off", ["off", "on"]], ["uni", "1", ["1", "2", "3", "4", "6", "8"]],
    ],
  },
  "dm:granular": {
    prefix: "",
    num: GRAN_NUM_KEYS.map(k => [k, GRAN_MOD_RANGE[k][0], GRAN_MOD_RANGE[k][1], null, `grain ${k.slice(1)}`]),
    sel: [
      ["gplay", "fixed", ["fixed", "moving"]], ["gloop", "fwd", ["none", "fwd", "bidir"]],
      ["gpattern", "none", ["none", "oct", "fifth"]], ["grate", "1/16", Object.keys(GRAN_RATE_BEATS)],
    ],
  },
  "dm:silverbox": {
    prefix: "sb",
    num: [["accent", 0, 1, 0.6, "accent depth"], ["tune", -50, 50, 0, "tune (cents)"]],
    sel: [["wave", "saw", ["saw", "square"]]],
  },
  "dm:ladder": {
    prefix: "",
    num: [["osc1range", -2, 2, 0, "osc 1 octave"], ["osc2range", -2, 2, 0, "osc 2 octave"], ["osc3range", -2, 2, -1, "osc 3 octave"],
          ["osc2freq", -7, 7, 0, "osc 2 semitones"], ["osc3freq", -7, 7, 0, "osc 3 semitones"]],
    sel: [["osc1wave", "sawtooth", ["triangle", "sawtooth", "square", "sine"]], ["osc2wave", "sawtooth", ["triangle", "sawtooth", "square", "sine"]],
          ["osc3wave", "triangle", ["triangle", "sawtooth", "square", "sine"]], ["noisetype", "white", ["white", "pink"]]],
  },
};
function hexopLabel(short) {
  const g = { ks: "key scale", vs: "velocity", peg: "pitch env", pegr: "pitch env rate", lfor: "lfo speed", lfod: "lfo delay", pmd: "pitch mod", amd: "amp mod" };
  if (g[short]) return `hexop ${g[short]}`;
  const c = { lvl: "level", rat: "ratio", fin: "fine", det: "detune", atk: "attack", dec: "decay", sus: "sustain", rel: "release" };
  return `hexop op${short[0]} ${c[short.slice(1)]}`;
}
// Which engine each panel prefix belongs to, for the "that key is another
// engine's" warning.
const PANEL_KEY_ENGINE = new Map();
for (const [engine, p] of Object.entries(PANELS)) {
  for (const c of p.num) PANEL_KEY_ENGINE.set(p.prefix + c[0], engine);
  for (const c of p.sel) PANEL_KEY_ENGINE.set(p.prefix + c[0], engine);
}
// The four sliders, the mix and the mod rows: the base params every engine has.
const BASE_PARAM_RANGE = {
  vol: [0, 1], harm: [0, 1], timb: [0, 1], morph: [0, 1], decay: [0, 1],
  osc1: [0, 1], osc2: [0, 1], osc3: [0, 1], osc4: [0, 1], ultra: [0, 1], fm: [0, 1], metal: [0, 1], noise: [0, 1],
};

// ---- the song ------------------------------------------------------------------

/**
 * A blank song: no tracks, 4/4, repeat mode. `scale` is `{ root, mode }` or
 * null for off.
 */
export function newSong({ bpm = 120, swing = 0, scale = null } = {}) {
  const song = {
    _version: SET_VERSION,
    bpm: 120, swing: 0,
    scale: { active: false, root: 0, mode: "minor" },
    activePattern: 0,
    patternMode: "repeat",
    patternSwitchMode: "immediate",
    patternMeters: Array.from({ length: PATTERN_COUNT }, () => ({ num: 4, den: 4 })),
    patternRepeats: Array.from({ length: PATTERN_COUNT }, () => 1),
    macroPads: [],
    tracks: [],
  };
  setTempo(song, { bpm, swing });
  if (scale) setScale(song, scale);
  return song;
}

/** Adopt an existing serialized session (a saved song, a share) for editing. */
export function fromBlob(data) {
  const check = validateSet(data);
  if (!check.ok) fail(`not a seqbaby session: ${check.errors.join("; ")}`);
  const song = JSON.parse(JSON.stringify(data));
  song._version = SET_VERSION;
  if (!Array.isArray(song.tracks)) song.tracks = [];
  song.tracks.forEach((t, i) => {
    if (!t.name) t.name = `track ${i + 1}`;
    if (!t.engineKey) t.engineKey = "plaits:0";
    if (!isNum(t.length)) t.length = STEPS_PER_BAR;
    if (!Array.isArray(t.patterns)) t.patterns = [];
    for (const k of ["params", "filter", "eq", "comp", "fxConfig", "lfoConfig"]) if (!t[k] || typeof t[k] !== "object") t[k] = {};
  });
  if (!Array.isArray(song.patternMeters)) song.patternMeters = Array.from({ length: PATTERN_COUNT }, () => ({ num: 4, den: 4 }));
  if (!Array.isArray(song.patternRepeats)) song.patternRepeats = Array.from({ length: PATTERN_COUNT }, () => 1);
  if (!Array.isArray(song.macroPads)) song.macroPads = [];
  if (!song.scale) song.scale = { active: false, root: 0, mode: "minor" };
  return song;
}

export function setTempo(song, { bpm, swing } = {}) {
  if (bpm != null) song.bpm = num(bpm, "bpm", 20, 300);
  if (swing != null) song.swing = num(swing, "swing", 0, 1);
  return { bpm: song.bpm, swing: song.swing };
}

/** `{ root: "C" | 0..11, mode: "minor" }`, or null / "off" to switch the scale off. */
export function setScale(song, scale) {
  if (scale == null || scale === "off" || scale === false) {
    song.scale = { ...song.scale, active: false };
    return song.scale;
  }
  const mode = String(scale.mode ?? scale.name ?? "minor").toLowerCase();
  if (!(mode in SCALES) || mode === "off") fail(`unknown scale mode ${JSON.stringify(scale.mode)}; one of ${Object.keys(SCALES).filter(k => k !== "off").join(", ")}`);
  song.scale = { active: true, root: toPitchClass(scale.root ?? 0), mode };
  return song.scale;
}
export const SCALE_NAMES = Object.keys(SCALES).filter(k => k !== "off");
export const CHORD_NAMES = Object.keys(CHORD_TYPES).filter(k => k);

// ---- tracks -----------------------------------------------------------------------

function trackAt(song, index) {
  const i = int(index, "track", 0, Math.max(0, song.tracks.length - 1));
  if (!song.tracks.length) fail("the song has no tracks yet; add_track first");
  return song.tracks[i];
}
function patternIndex(p) { return int(p ?? 0, "pattern", 0, PATTERN_COUNT - 1); }

/** A blank pattern with `len` steps -- the same fields as emptyPattern
 *  (state.js), which reads the live meter and so cannot be imported here.
 *  test/songBuilder.test.js checks the two lists agree. */
export function emptyPatternBlob(len) {
  const n = Math.max(1, len | 0);
  const fill = (v) => Array.from({ length: n }, () => v);
  return {
    steps: fill(0), lengths: fill(0), notes: fill(null), velocities: fill(0.5), chords: fill(""),
    offsets: fill(0), arps: fill(false), arpRates: fill(0.25), arpRanges: fill(1), arpDirs: fill("up"),
    complexities: fill(0), ratchets: fill(1),
    sampleStarts: fill(0), sampleEnds: fill(1), sampleFadeIns: fill(0), sampleFadeOuts: fill(0), sampleLoopModes: fill("off"),
    extraNotes: fill(null), extraLengths: fill(null),
    automation: {},
    soundLocked: false, sound: null,
  };
}
const PATTERN_ARRAYS = Object.keys(emptyPatternBlob(1)).filter(k => Array.isArray(emptyPatternBlob(1)[k]));

/** The pattern, made on first touch at the track's length. */
export function patternOf(t, p) {
  const i = patternIndex(p);
  if (!t.patterns[i]) t.patterns[i] = emptyPatternBlob(t.length);
  return t.patterns[i];
}
function patternLength(pat) { return pat.steps.length; }
function resizePattern(pat, n) {
  const fresh = emptyPatternBlob(n);
  for (const k of PATTERN_ARRAYS) {
    const src = Array.isArray(pat[k]) ? pat[k] : [];
    pat[k] = fresh[k].map((d, i) => i < src.length ? src[i] : d);
  }
  for (const lane of Object.values(pat.automation || {})) {
    const v = Array.isArray(lane.values) ? lane.values : [];
    lane.values = Array.from({ length: n }, (_, i) => i < v.length ? v[i] : 0.5);
  }
}

/**
 * Add a track. `engine` is a key or a name (see resolveEngine). A sampler
 * takes `sample` (a bundled sample id or label, e.g. "Techno/kick" or "techno
 * kick"); a granular track takes `texture` (a library texture id or label).
 * @returns {{ index: number, engine: string, name: string }}
 */
export function addTrack(song, { engine, name, length = STEPS_PER_BAR, sample, texture, drumKit } = {}) {
  const e = resolveEngine(engine);
  const len = int(length, "length", 1, 64);
  const t = {
    name: String(name || e.label).slice(0, 40),
    engineKey: e.key,
    length: len,
    params: {}, filter: {}, eq: {}, comp: {}, fxConfig: {}, lfoConfig: {},
    midi: { outputId: "", channel: 1 },
    sampleSource: null, granularSample: null,
    muted: false, soloed: false,
    outIndex: -1, compSourceIndex: -1,
    isDrumKit: false,
    glide: 0, speed: 1, sampleSpeedMode: "native", pitchLock: true, density: 0.5,
    euclid: null, chance: null,
    patterns: [],
  };
  if (e.key === "sampler") {
    if (sample == null) fail(`a sampler track needs \`sample\`: one of ${BUNDLED_SAMPLES.map(s => s.id).join(", ")}`);
    const s = findByIdOrLabel(BUNDLED_SAMPLES, sample, "sample");
    t.sampleSource = { kind: "bundled", id: s.id, name: s.label };
  } else if (sample != null) fail(`\`sample\` only applies to the sampler engine (this track is ${e.key})`);
  if (e.key === "dm:granular") {
    if (texture == null) fail(`a granular track needs \`texture\`: one of ${GRANULAR_SAMPLES.map(s => s.id).join(", ")}`);
    const s = findByIdOrLabel(GRANULAR_SAMPLES, texture, "texture");
    t.granularSample = { id: s.id, label: s.label };
  } else if (texture != null) fail(`\`texture\` only applies to the granular engine (this track is ${e.key})`);
  t.isDrumKit = drumKit != null ? !!drumKit
    : DRUM_RE.test(`${e.key} ${e.label} ${t.name} ${t.sampleSource?.id || ""}`.toLowerCase());
  song.tracks.push(t);
  return { index: song.tracks.length - 1, engine: e.key, name: t.name };
}
function findByIdOrLabel(list, spec, what) {
  const s = String(spec).trim().toLowerCase();
  const hit = list.find(x => x.id.toLowerCase() === s || x.label.toLowerCase() === s);
  if (!hit) fail(`unknown ${what} ${JSON.stringify(spec)}; one of ${list.map(x => x.id).join(", ")}`);
  return hit;
}

/** Remove a track; every index past it moves down, and the sends and
 *  sidechains that pointed at it go back to master / self. */
export function removeTrack(song, index) {
  const i = int(index, "track", 0, song.tracks.length - 1);
  song.tracks.splice(i, 1);
  const fix = (j) => j === i ? -1 : j > i ? j - 1 : j;
  for (const t of song.tracks) { t.outIndex = fix(t.outIndex ?? -1); t.compSourceIndex = fix(t.compSourceIndex ?? -1); }
  for (const pad of song.macroPads || []) for (const axis of ["x", "y"]) {
    pad[axis] = (pad[axis] || []).filter(a => a.track !== i).map(a => ({ ...a, track: fix(a.track) }));
  }
}

/**
 * Track-level settings. `out` is "master" or the index of an fx bus track;
 * `length` resizes every pattern; `speed` is the per-track tempo multiple.
 */
export function setTrack(song, index, opts = {}) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  if (opts.name != null) t.name = String(opts.name).slice(0, 40);
  if (opts.length != null) {
    t.length = int(opts.length, "length", 1, 64);
    for (const p of t.patterns) if (p) resizePattern(p, t.length);
  }
  if (opts.mute != null) t.muted = !!opts.mute;
  if (opts.solo != null) t.soloed = !!opts.solo;
  if (opts.glide != null) t.glide = num(opts.glide, "glide", 0, 0.5);
  if (opts.speed != null) t.speed = num(opts.speed, "speed", 0.0625, 8);
  if (opts.density != null) t.density = num(opts.density, "density", 0, 1);
  if (opts.drumKit != null) t.isDrumKit = !!opts.drumKit;
  if (opts.pitchLock != null) t.pitchLock = !!opts.pitchLock;
  if (opts.sampleSpeedMode != null) t.sampleSpeedMode = oneOf(opts.sampleSpeedMode, "sampleSpeedMode", ["native", "1xbpm"]);
  if (opts.out != null) {
    if (opts.out === "master" || opts.out === -1) t.outIndex = -1;
    else {
      const j = int(opts.out, "out", 0, song.tracks.length - 1);
      const bus = song.tracks[j];
      if (j === i) fail("a track cannot send to itself");
      if (bus.engineKey !== "bus") fail(`track ${j} (${bus.name}) is not an fx bus; add one with engine "bus"`);
      // Refuse a loop, as applySet would (wouldFeedback, signal.js).
      for (let k = j, hops = 0; k >= 0 && hops < song.tracks.length; hops++) {
        if (k === i) fail(`sending track ${i} to bus ${j} would feed back (bus ${j} already reaches track ${i})`);
        k = song.tracks[k].outIndex ?? -1;
      }
      t.outIndex = j;
    }
  }
  return summarizeTrack(song, i);
}

// ---- steps and notes -----------------------------------------------------------------

/**
 * Parse a step string into per-step hits. Returns `{ steps, velocities,
 * lengths }` at the string's own length; `_` ties extend the previous hit.
 */
export function parseSteps(str) {
  const chars = String(str).replace(/[\s|]/g, "").split("");
  const steps = [], velocities = [], lengths = [];
  let last = -1;
  for (const c of chars) {
    if (c === "_") {
      if (last < 0) fail("a step string cannot start with `_` (a tie needs a hit before it)");
      lengths[last] += 1; steps.push(0); velocities.push(0.5); lengths.push(0);
      continue;
    }
    let vel = null;
    if (c === "x") vel = 0.8; else if (c === "X") vel = 1; else if (c === "o") vel = 0.5;
    else if (/^[1-9]$/.test(c)) vel = Number(c) / 10;
    else if (c === "." || c === "-") vel = -1;
    else fail(`unknown step character ${JSON.stringify(c)}; use x X o . - _ or a digit 1-9`);
    if (vel < 0) { steps.push(0); velocities.push(0.5); lengths.push(0); }
    else { steps.push(1); velocities.push(vel); lengths.push(1); last = steps.length - 1; }
  }
  if (!steps.length) fail("the step string is empty");
  return { steps, velocities, lengths };
}

/**
 * Write a pattern's rhythm from a step string (or an array of 0/1). Steps the
 * string does not mention are cleared. Optional `notes` are assigned to the
 * hits in order (see setNotes); `velocity` scales every hit.
 */
export function setSteps(song, index, { pattern = 0, steps, notes, velocity } = {}) {
  const t = trackAt(song, index);
  const pat = patternOf(t, pattern);
  const n = patternLength(pat);
  let parsed;
  if (Array.isArray(steps)) parsed = { steps: steps.map(v => v ? 1 : 0), velocities: steps.map(() => 0.8), lengths: steps.map(v => v ? 1 : 0) };
  else if (typeof steps === "string") parsed = parseSteps(steps);
  else fail("steps must be a string like \"x..x..x.\" or an array of 0/1");
  const m = parsed.steps.length;
  if (m !== n) {
    if (m > n) fail(`the step string has ${m} steps but the pattern has ${n}; set the track length first`);
    if (n % m !== 0) fail(`the step string has ${m} steps, which does not divide the pattern's ${n}; write all ${n} or a length that tiles`);
  }
  for (let i = 0; i < n; i++) {
    const j = i % m;
    pat.steps[i] = parsed.steps[j];
    pat.velocities[i] = parsed.steps[j] ? Math.max(0.05, Math.min(1, parsed.velocities[j] * (velocity != null ? num(velocity, "velocity", 0, 1) : 1))) : 0.5;
    pat.lengths[i] = parsed.lengths[j];
  }
  if (notes != null) setNotes(song, index, { pattern, notes });
  return describePattern(t, patternIndex(pattern));
}

/**
 * Pitches for a pattern. `notes` is an array of MIDI numbers, note names or
 * null. Given one entry per step it is written per step; given fewer, the
 * entries go to the HITS in order, cycling. A single note (not an array)
 * goes to every hit. null leaves the engine's default.
 */
export function setNotes(song, index, { pattern = 0, notes } = {}) {
  const t = trackAt(song, index);
  const pat = patternOf(t, pattern);
  const n = patternLength(pat);
  const list = Array.isArray(notes) ? notes : [notes];
  if (!list.length) fail("notes is empty");
  const toVal = (v) => v == null || v === "-" || v === "." ? null : toMidi(v);
  if (list.length === n) {
    for (let i = 0; i < n; i++) pat.notes[i] = toVal(list[i]);
  } else {
    let k = 0;
    for (let i = 0; i < n; i++) if (pat.steps[i]) pat.notes[i] = toVal(list[k++ % list.length]);
  }
  return describePattern(t, patternIndex(pattern));
}

/**
 * One step in full. `on` switches it; `note`, `velocity` (0..1), `length` (in
 * steps), `chord` (a chord type: maj, min, min7 ...), `complexity` (chord
 * inversion 0..4), `ratchet` (1..8 retriggers), `offset` (-0.5..0.5 of a step),
 * `arp` + `arpRate` (beats per arp note) + `arpRange` (octaves 1..4) +
 * `arpDir` (up/down/updown/random), `extraNotes` (more pitches stacked on it).
 */
export function setStep(song, index, opts = {}) {
  const t = trackAt(song, index);
  const pat = patternOf(t, opts.pattern ?? 0);
  const n = patternLength(pat);
  const i = int(opts.step, "step", 0, n - 1);
  if (opts.on != null) { pat.steps[i] = opts.on ? 1 : 0; if (opts.on && !pat.lengths[i]) pat.lengths[i] = 1; }
  if (opts.note !== undefined) pat.notes[i] = opts.note == null ? null : toMidi(opts.note);
  if (opts.velocity != null) pat.velocities[i] = num(opts.velocity, "velocity", 0, 1);
  if (opts.length != null) pat.lengths[i] = int(opts.length, "length", 1, n);
  if (opts.chord != null) {
    const c = canonicalChord(String(opts.chord));
    if (c !== "" && !(c in CHORD_TYPES)) fail(`unknown chord ${JSON.stringify(opts.chord)}; one of ${CHORD_NAMES.join(", ")} or "" for none`);
    pat.chords[i] = c;
  }
  if (opts.complexity != null) pat.complexities[i] = int(opts.complexity, "complexity", 0, 4);
  if (opts.ratchet != null) pat.ratchets[i] = int(opts.ratchet, "ratchet", 1, 8);
  if (opts.offset != null) pat.offsets[i] = num(opts.offset, "offset", -0.5, 0.5);
  if (opts.arp != null) pat.arps[i] = !!opts.arp;
  if (opts.arpRate != null) pat.arpRates[i] = num(opts.arpRate, "arpRate", 0.0625, 4);
  if (opts.arpRange != null) pat.arpRanges[i] = int(opts.arpRange, "arpRange", 1, 4);
  if (opts.arpDir != null) pat.arpDirs[i] = oneOf(opts.arpDir, "arpDir", ["up", "down", "updown", "random"]);
  if (opts.extraNotes !== undefined) {
    pat.extraNotes[i] = opts.extraNotes == null ? null : [].concat(opts.extraNotes).map(v => toMidi(v, "extraNotes"));
    pat.extraLengths[i] = null;
  }
  return describeStep(pat, i);
}

export function clearPattern(song, index, pattern = 0) {
  const t = trackAt(song, index);
  t.patterns[patternIndex(pattern)] = emptyPatternBlob(t.length);
}
export function copyPattern(song, index, { from = 0, to } = {}) {
  const t = trackAt(song, index);
  const src = patternOf(t, from);
  t.patterns[patternIndex(to)] = JSON.parse(JSON.stringify(src));
}

// ---- sound --------------------------------------------------------------------------

/**
 * Set track params: the four sliders (harm timb morph decay), vol, the osc mix
 * (osc1..osc4), the mod row (ultra fm metal noise), or an engine panel control
 * (gtpick, bsgrind, subdrop, d3lvl, vcut2, gspeed, sbaccent ...). Each is
 * checked against its own range. Returns warnings for keys another engine
 * owns, which are stored but do nothing on this one.
 */
export function setParams(song, index, params = {}) {
  const t = trackAt(song, index);
  const warnings = [];
  const panel = PANELS[t.engineKey];
  const voiceKeys = voiceAutoKeysForEngineKey(t.engineKey);
  for (const [key, raw] of Object.entries(params)) {
    if (key in BASE_PARAM_RANGE) {
      const [lo, hi] = BASE_PARAM_RANGE[key];
      t.params[key] = num(raw, key, lo, hi);
      if (key !== "vol" && !voiceKeys.includes(key)) warnings.push(`${key} is not a control on ${t.engineKey} (its sliders: ${voiceKeys.filter(k => k !== "vol").join(", ") || "none"})`);
      continue;
    }
    const owner = PANEL_KEY_ENGINE.get(key);
    if (!owner) fail(`unknown param ${JSON.stringify(key)}; the sliders are ${Object.keys(BASE_PARAM_RANGE).join(", ")}, and ${t.engineKey}'s panel is ${panelKeys(t.engineKey).join(", ") || "empty"}`);
    const p = PANELS[owner];
    const short = key.slice(p.prefix.length);
    const numCtl = p.num.find(c => c[0] === short);
    const selCtl = p.sel.find(c => c[0] === short);
    if (numCtl) t.params[key] = num(raw, key, numCtl[1], numCtl[2]);
    else if (selCtl) t.params[key] = oneOf(raw, key, selCtl[2]);
    if (owner !== t.engineKey) warnings.push(`${key} belongs to ${owner}'s panel; this track is ${t.engineKey}, so it does nothing here`);
  }
  return { params: t.params, warnings };
}
function panelKeys(engineKey) {
  const p = PANELS[engineKey];
  return p ? [...p.num.map(c => p.prefix + c[0]), ...p.sel.map(c => p.prefix + c[0])] : [];
}

/** Load a preset: a hexop voice, or a guitar / bass / sub tone. It is a
 *  complete panel plus the four sliders, so nothing of the old sound stays. */
export function applyPreset(song, index, name) {
  const t = trackAt(song, index);
  const p = PANELS[t.engineKey];
  if (!p?.tones) fail(`${t.engineKey} has no presets (the engines with presets: ${Object.entries(PANELS).filter(([, v]) => v.tones).map(([k]) => k).join(", ")})`);
  const s = String(name).trim().toLowerCase();
  const hit = p.tones.find(n => n.toLowerCase() === s);
  if (!hit) fail(`unknown ${t.engineKey} preset ${JSON.stringify(name)}; one of ${p.tones.join(", ")}`);
  Object.assign(t.params, p.tone(hit));
  return { preset: hit, description: p.describe?.(hit) || "" };
}

/** The track filter: its shape (`type`, one of FILTER_TYPES — the four plain
 *  BiquadFilterNode shapes plus eight analog-modeled characters, lowpass by
 *  default) and its envelope, the rest 0..1: cutoff, reson, env (how far the
 *  envelope opens the filter), attack, decay, sustain, release. */
export function setFilter(song, index, f = {}) {
  const t = trackAt(song, index);
  const d = defaultFilter();
  for (const [k, v] of Object.entries(f)) {
    if (!(k in d)) fail(`unknown filter field ${JSON.stringify(k)}; one of ${Object.keys(d).join(", ")}`);
    t.filter[k] = k === "type" ? oneOf(v, "filter.type", FILTER_TYPES) : num(v, `filter.${k}`, 0, 1);
  }
  return { ...d, ...t.filter };
}
/** Three-band eq in dB, -18..18: low (shelf 250Hz), mid (peak 1.2kHz), high (shelf 5kHz). */
export function setEq(song, index, eq = {}) {
  const t = trackAt(song, index);
  const d = defaultEq();
  for (const [k, v] of Object.entries(eq)) {
    if (!(k in d)) fail(`unknown eq band ${JSON.stringify(k)}; one of low, mid, high`);
    t.eq[k] = num(v, `eq.${k}`, -18, 18);
  }
  return { ...d, ...t.eq };
}
/** The compressor. `source` is "self" or the index of the track to sidechain from. */
export function setComp(song, index, c = {}) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  const d = defaultCompConfig();
  const range = { threshold: [-60, 0], ratio: [1, 20], attack: [0, 1], release: [0.02, 2], knee: [0, 30] };
  for (const [k, v] of Object.entries(c)) {
    if (k === "enabled") t.comp.enabled = !!v;
    else if (k === "source") {
      if (v === "self" || v === -1 || v == null) t.compSourceIndex = -1;
      else { const j = int(v, "comp.source", 0, song.tracks.length - 1); if (j === i) fail("a track cannot sidechain from itself; use \"self\""); t.compSourceIndex = j; }
    }
    else if (k in range) t.comp[k] = num(v, `comp.${k}`, range[k][0], range[k][1]);
    else fail(`unknown comp field ${JSON.stringify(k)}; one of enabled, source, ${Object.keys(range).join(", ")}`);
  }
  if (Object.keys(c).some(k => k !== "enabled" && k !== "source") && c.enabled == null && !t.comp.enabled) t.comp.enabled = true;
  return { ...d, ...t.comp, source: t.compSourceIndex >= 0 ? t.compSourceIndex : "self" };
}

export const FX_STAGES = Object.keys(defaultFxConfig());
const FX_RANGE = {   // anything not listed is 0..1
  "crush.bits": [1, 16], "pitchshift.semitones": [-12, 12], "delay.time": [0.05, 1], "delay.fbk": [0, 0.95],
  "reverb.decay": [0.2, 8], "delay.div": [0, 2],
};
const FX_SELECT = { "shaper.mode": ["saturate", "softclip", "clip", "serge", "fold", "wrap"] };
/**
 * An fx rack stage. `stage` is one of FX_STAGES (vinyl, cassette, fuzz,
 * ringmod, shaper, crush, autowah, chorus, phaser, flanger, pitchshift, delay,
 * reverb, or amp); `settings` its controls. A stage is on when its wet /
 * amount is above zero. The whole stage is written, defaults filled in, since
 * the engine takes a stage config whole.
 */
export function setFx(song, index, stage, settings = {}) {
  const t = trackAt(song, index);
  const d = defaultFxConfig();
  const s = String(stage);
  if (!(s in d)) fail(`unknown fx stage ${JSON.stringify(stage)}; one of ${FX_STAGES.join(", ")}`);
  const cur = { ...d[s], ...(t.fxConfig[s] || {}) };
  for (const [k, v] of Object.entries(settings)) {
    const full = `${s}.${k}`;
    const alias = k === "amount" && !("amount" in d[s]) ? "wet" : k === "wet" && !("wet" in d[s]) ? "amount" : k;
    if (!(alias in d[s])) fail(`unknown ${s} control ${JSON.stringify(k)}; one of ${Object.keys(d[s]).join(", ")}`);
    if (alias === "sync") cur.sync = !!v;
    else if (FX_SELECT[full]) cur[alias] = oneOf(v, full, FX_SELECT[full]);
    else { const [lo, hi] = FX_RANGE[`${s}.${alias}`] || [0, 1]; cur[alias] = num(v, full, lo, hi); }
  }
  t.fxConfig[s] = cur;
  return cur;
}

// ---- modulation ---------------------------------------------------------------------

export const LFO_SHAPES = ["sine", "triangle", "sawtooth", "square", "randsq", "euclid"];
const LFO_DIV_BY_LABEL = new Map(LFO_DIVS.map(d => [d.label.replace("½", "1/2"), d.div]));
function lfoDiv(length) {
  if (isNum(length)) return num(length, "length (beats)", 0.0625, 64);
  const s = String(length).trim().toLowerCase().replace("½", "1/2");
  const m = /^(\d+(?:\.\d+)?|1\/2)\s*steps?$/.exec(s);
  if (m) return (m[1] === "1/2" ? 0.5 : Number(m[1])) / 4;
  const bars = /^(\d+(?:\.\d+)?)\s*bars?$/.exec(s);
  if (bars) return Number(bars[1]) * 4;
  const beats = /^(\d+(?:\.\d+)?)\s*beats?$/.exec(s);
  if (beats) return Number(beats[1]);
  if (LFO_DIV_BY_LABEL.has(s)) return LFO_DIV_BY_LABEL.get(s);
  fail(`length must be like "16 steps", "1 bar", "2 beats" or a number of beats; got ${JSON.stringify(length)}`);
}

/**
 * Put an LFO on a parameter. `target` is an LFO key (cutoff, reson, vol, harm,
 * delay, verb, fuzz_drive, gtr_pick, hexop_3lvl, euclid_rotate ...; the
 * engine's own list is in describeEngine). `amount` is the peak-to-peak depth
 * (0..1 of the target's range); `length` the cycle when synced ("4 steps",
 * "1 bar", "2 beats"); `rate` in Hz with `sync: false`. `bipolar` hangs the
 * swing either side of the slider (default for waveforms) or lifts from it
 * (default for euclid). `phase` is 0..1 turns. For the euclid shape, `euclid`
 * is { pulses, steps, rotate, decay }.
 */
export function addLfo(song, index, { target, shape = "sine", amount = 0.5, length = "4 steps", rate, sync, bipolar, phase, euclid } = {}) {
  const t = trackAt(song, index);
  const key = String(target || "");
  if (!LFO_KEYS.includes(key)) {
    const near = LFO_KEYS.filter(k => k.includes(key) || (LFO_LABELS[k] || "").includes(key)).slice(0, 8);
    fail(`unknown LFO target ${JSON.stringify(target)}${near.length ? `; did you mean ${near.join(", ")}` : ""}`);
  }
  const live = { euclid: !!t.euclid?.on, chance: !!t.chance?.on };
  if (!canModulateKey(t.engineKey, key, live)) {
    const why = key.startsWith("euclid_") ? " (turn the euclid generator on first)" : key.startsWith("chance_") ? " (turn the chance generator on first)" : "";
    fail(`${key} cannot be modulated on ${t.engineKey}${why}; this engine's targets: ${LFO_KEYS.filter(k => canModulateKey(t.engineKey, k, live)).join(", ")}`);
  }
  const cfg = {
    enabled: true,
    type: oneOf(shape, "shape", LFO_SHAPES),
    rate: rate != null ? num(rate, "rate (Hz)", 0.05, 20) : 1,
    depth: num(amount, "amount", 0, 1),
    sync: sync != null ? !!sync : rate == null,
    div: lfoDiv(length),
  };
  if (bipolar != null) cfg.bipolar = !!bipolar;
  if (phase != null) cfg.phase = num(phase, "phase", 0, 1);
  if (cfg.type === "euclid") {
    const e = euclid || {};
    cfg.esteps = int(e.steps ?? 8, "euclid.steps", 1, 64);
    cfg.epulses = int(e.pulses ?? 4, "euclid.pulses", 0, cfg.esteps);
    cfg.erotate = int(e.rotate ?? 0, "euclid.rotate", 0, Math.max(0, cfg.esteps - 1));
    cfg.edecay = num(e.decay ?? 0.4, "euclid.decay", 0, 1);
  }
  t.lfoConfig[key] = cfg;
  return { target: key, ...cfg, cycle: cfg.sync ? lfoDivLabel(cfg.div) : `${cfg.rate} Hz` };
}
export function removeLfo(song, index, target) {
  const t = trackAt(song, index);
  delete t.lfoConfig[String(target)];
}

/**
 * A per-step automation lane on a pattern. `target` is an automation key
 * (cutoff, reson, vol, fx.delay, fx.reverb.decay, gtr.pick, hexop.3lvl ...);
 * `values` one number 0..1 per step (a shorter list tiles). Lanes belong to
 * the pattern, so each pattern has its own.
 */
export function setAutomation(song, index, { pattern = 0, target, values } = {}) {
  const t = trackAt(song, index);
  const key = String(target || "");
  if (!AUTOMATION_TARGETS[key]) {
    const near = Object.keys(AUTOMATION_TARGETS).filter(k => k.includes(key)).slice(0, 8);
    fail(`unknown automation target ${JSON.stringify(target)}${near.length ? `; did you mean ${near.join(", ")}` : ""}`);
  }
  const live = { euclid: !!t.euclid?.on, chance: !!t.chance?.on };
  if (!canAutomateKey(t.engineKey, key, live)) fail(`${key} cannot be automated on ${t.engineKey}; this engine's lanes: ${Object.keys(AUTOMATION_TARGETS).filter(k => canAutomateKey(t.engineKey, k, live)).join(", ")}`);
  const pat = patternOf(t, pattern);
  const n = patternLength(pat);
  if (!Array.isArray(values) || !values.length) fail("values must be a non-empty array of numbers 0..1");
  if (values.length > n) fail(`${values.length} values for a ${n}-step pattern`);
  if (n % values.length !== 0) fail(`${values.length} values do not tile a ${n}-step pattern`);
  const vals = Array.from({ length: n }, (_, i) => num(values[i % values.length], `values[${i % values.length}]`, 0, 1));
  pat.automation[key] = { enabled: true, values: vals };
  return { target: key, values: vals };
}
export function removeAutomation(song, index, { pattern = 0, target } = {}) {
  const t = trackAt(song, index);
  const pat = patternOf(t, pattern);
  delete pat.automation[String(target)];
}

// ---- generators ---------------------------------------------------------------------

/**
 * The euclid generator: `pulses` hits over `steps`, rotated by `rotate`. With
 * `on` (the default) the track plays the ring live instead of its written
 * steps -- and pulses / steps / rotate become modulatable. Switching it on
 * switches the chance generator off: a track has one rhythm source.
 */
export function setEuclid(song, index, e = {}) {
  const t = trackAt(song, index);
  const cur = { ...EUCLID_DEFAULTS, steps: Math.min(EUCLID_DEFAULTS.steps, t.length), ...(t.euclid || {}) };
  const on = e.on != null ? !!e.on : true;
  const steps = int(e.steps ?? cur.steps, "steps", 1, t.length);
  const cfg = {
    on, steps,
    pulses: int(e.pulses ?? Math.min(cur.pulses, steps), "pulses", 0, steps),
    rotate: int(e.rotate ?? Math.min(cur.rotate, steps - 1), "rotate", 0, Math.max(0, steps - 1)),
    gate: e.gate != null ? oneOf(e.gate, "gate", ["short", "legato"]) : cur.gate,
    accent: e.accent != null ? !!e.accent : cur.accent,
  };
  t.euclid = cfg;
  if (on && t.chance?.on) t.chance.on = false;
  return { ...cfg, ring: euclidRing(cfg.pulses, cfg.steps, cfg.rotate) };
}

/** Bjorklund proper, as euclid.js: E(5,8) is x.xx.xx., not a rotation of it. */
export function euclidRing(pulses, steps, rotate = 0) {
  const n = Math.max(1, steps | 0), k = Math.max(0, Math.min(n, pulses | 0));
  let pattern;
  if (k === 0) pattern = Array(n).fill(0);
  else if (k === n) pattern = Array(n).fill(1);
  else {
    let a = Array.from({ length: k }, () => [1]), b = Array.from({ length: n - k }, () => [0]);
    while (b.length > 1) {
      const m = Math.min(a.length, b.length);
      const next = [];
      for (let i = 0; i < m; i++) next.push(a[i].concat(b[i]));
      const rest = a.length > m ? a.slice(m) : b.slice(m);
      a = next; b = rest;
    }
    pattern = a.concat(b).flat();
  }
  const r = ((rotate | 0) % n + n) % n;
  const out = pattern.slice(n - r).concat(pattern.slice(0, n - r));
  return out.map(v => v ? "x" : ".").join("");
}

/**
 * The chance generator, in the manner of a meloDICER: a part (rhythm AND
 * pitch) from probabilities. `note` is the base note value (an index into
 * noteValues, or a label like "1/8"); `variation` (-1..1) reaches shorter or
 * longer values; `legato` and `rest` 0..1; `pitches` twelve weights C..B, or
 * `scale: ["C", "Eb", "G"]` to weight those and zero the rest; `lo` / `hi`
 * the pitch range (MIDI 24..96); `first` / `last` the window in steps;
 * `rhythmSeed` / `melodySeed` the two dice. `on` (default true) makes it the
 * track's rhythm source and switches euclid off.
 */
export function setChance(song, index, c = {}) {
  const t = trackAt(song, index);
  const cur = cloneChance(t.chance) || { ...CHANCE_DEFAULTS, pcs: CHANCE_DEFAULTS.pcs.slice(), last: Math.min(15, t.length - 1) };
  const cfg = { ...cur };
  cfg.on = c.on != null ? !!c.on : true;
  if (c.note != null) {
    const labels = CHANCE_NOTE_VALUES.map(v => v.label.toLowerCase());
    const idx = isNum(c.note) ? int(c.note, "note", 0, labels.length - 1) : labels.indexOf(String(c.note).toLowerCase());
    if (idx < 0) fail(`note must be one of ${CHANCE_NOTE_VALUES.map(v => v.label).join(", ")} or an index 0..${labels.length - 1}`);
    cfg.note = idx;
  }
  if (c.variation != null) cfg.var = num(c.variation, "variation", -1, 1);
  if (c.legato != null) cfg.leg = num(c.legato, "legato", 0, 1);
  if (c.rest != null) cfg.rest = num(c.rest, "rest", 0, 1);
  if (c.pitches != null) {
    if (!Array.isArray(c.pitches) || c.pitches.length !== 12) fail("pitches must be twelve weights 0..1, C through B");
    cfg.pcs = c.pitches.map((v, i) => num(v, `pitches[${i}]`, 0, 1));
  }
  if (c.scale != null) {
    const pcs = Array(12).fill(0);
    const list = Array.isArray(c.scale) ? c.scale : [c.scale];
    for (const p of list) pcs[toPitchClass(p, "scale entry")] = 1;
    cfg.pcs = pcs;
  }
  if (cfg.pcs.every(v => v <= 0)) fail("every pitch weight is zero; the generator would have nothing to play");
  if (c.lo != null) cfg.lo = int(toMidi(c.lo, "lo"), "lo", CHANCE_NOTE_MIN, CHANCE_NOTE_MAX);
  if (c.hi != null) cfg.hi = int(toMidi(c.hi, "hi"), "hi", CHANCE_NOTE_MIN, CHANCE_NOTE_MAX);
  if (cfg.hi < cfg.lo) [cfg.lo, cfg.hi] = [cfg.hi, cfg.lo];
  if (c.first != null) cfg.first = int(c.first, "first", 0, t.length - 1);
  if (c.last != null) cfg.last = int(c.last, "last", 0, t.length - 1);
  if (cfg.last < cfg.first) [cfg.first, cfg.last] = [cfg.last, cfg.first];
  if (c.triplets != null) cfg.trips = !!c.triplets;
  if (c.thirtySeconds != null) cfg.x32 = !!c.thirtySeconds;
  if (c.rhythmSeed != null) cfg.rseed = int(c.rhythmSeed, "rhythmSeed", 1, 2 ** 31);
  if (c.melodySeed != null) cfg.mseed = int(c.melodySeed, "melodySeed", 1, 2 ** 31);
  if (c.rhythmFree != null) cfg.rfree = !!c.rhythmFree;
  if (c.melodyFree != null) cfg.mfree = !!c.melodyFree;
  t.chance = cfg;
  if (cfg.on && t.euclid?.on) t.euclid.on = false;
  return { ...cfg, noteValue: CHANCE_NOTE_VALUES[cfg.note].label };
}
export const CHANCE_NOTE_LABELS = CHANCE_NOTE_VALUES.map(v => v.label);

// ---- patterns as a song ------------------------------------------------------------------

/** How the 32 patterns play: `mode` repeat (loop one) or chain (play them in
 *  order); `repeats` bars per pattern in chain mode; `switchMode` immediate or
 *  finish (wait for the bar). `active` is the pattern the studio opens on. */
export function setArrangement(song, { mode, repeats, switchMode, active } = {}) {
  if (mode != null) song.patternMode = oneOf(mode, "mode", ["repeat", "chain"]);
  if (switchMode != null) song.patternSwitchMode = oneOf(switchMode, "switchMode", ["immediate", "finish"]);
  if (active != null) song.activePattern = patternIndex(active);
  if (repeats != null) {
    if (!Array.isArray(repeats)) fail("repeats must be an array of bar counts, one per pattern from the first");
    repeats.forEach((r, i) => { if (i < PATTERN_COUNT) song.patternRepeats[i] = int(r, `repeats[${i}]`, 1, 16); });
  }
  return { mode: song.patternMode, switchMode: song.patternSwitchMode, active: song.activePattern, repeats: song.patternRepeats };
}
/** A pattern's time signature, e.g. "7/8". Steps are sixteenths, so a bar of 7/8 is 14 steps. */
export function setMeter(song, pattern, meter) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(meter).trim());
  if (!m) fail(`meter must be like "4/4" or "7/8", got ${JSON.stringify(meter)}`);
  const numr = int(m[1], "meter numerator", 1, 32), den = int(m[2], "meter denominator", 1, 32);
  if (![1, 2, 4, 8, 16].includes(den)) fail("the meter's denominator must be 1, 2, 4, 8 or 16");
  song.patternMeters[patternIndex(pattern)] = { num: numr, den };
  return { steps: Math.round(numr * (16 / den)) };
}

// ---- reading it back ------------------------------------------------------------------

function describeStep(pat, i) {
  const out = { step: i, on: !!pat.steps[i] };
  if (!pat.steps[i]) return out;
  out.note = pat.notes[i] == null ? null : isNum(pat.notes[i]) ? midiToName(pat.notes[i]) : pat.notes[i];
  out.velocity = pat.velocities[i]; out.length = pat.lengths[i] || 1;
  if (pat.chords[i]) out.chord = pat.chords[i];
  if (pat.complexities[i]) out.complexity = pat.complexities[i];
  if (pat.ratchets[i] > 1) out.ratchet = pat.ratchets[i];
  if (pat.offsets[i]) out.offset = pat.offsets[i];
  if (pat.arps[i]) out.arp = { rate: pat.arpRates[i], range: pat.arpRanges[i], dir: pat.arpDirs[i] };
  if (pat.extraNotes[i]) out.extraNotes = pat.extraNotes[i].map(midiToName);
  return out;
}
/** A pattern as a step string plus its notes, the way a person would write it. */
export function describePattern(t, p) {
  const pat = t.patterns?.[p];
  if (!pat) return { pattern: p, empty: true };
  const n = patternLength(pat);
  let str = "", notes = [], anyNote = false;
  for (let i = 0; i < n; i++) {
    if (!pat.steps[i]) { str += "."; continue; }
    const v = pat.velocities[i];
    str += v >= 0.95 ? "X" : v <= 0.55 ? "o" : "x";
    // A hit held across rests reads back as the ties it was written with.
    let held = 0;
    while (held + 1 < (pat.lengths[i] || 1) && i + held + 1 < n && !pat.steps[i + held + 1]) { str += "_"; held++; }
    const nm = pat.notes[i] == null ? "-" : isNum(pat.notes[i]) ? midiToName(pat.notes[i]) : String(pat.notes[i]);
    if (nm !== "-") anyNote = true;
    notes.push(nm);
    i += held;
  }
  const lanes = Object.entries(pat.automation || {}).filter(([, l]) => l?.enabled).map(([k]) => k);
  const extras = [];
  for (let i = 0; i < n; i++) {
    if (!pat.steps[i]) continue;
    const d = describeStep(pat, i);
    if (d.chord || d.ratchet || d.arp || d.extraNotes || (d.length > 1) || d.offset || d.complexity) extras.push(d);
  }
  return { pattern: p, steps: str, hits: notes.length, ...(anyNote ? { notes } : {}), ...(extras.length ? { detail: extras } : {}), ...(lanes.length ? { automation: lanes } : {}), ...(pat.soundLocked ? { soundLocked: true } : {}) };
}
export function summarizeTrack(song, index) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  const d = defaultFxConfig();
  const fxOn = Object.keys(d).filter(s => s !== "amp" && (t.fxConfig[s]?.[FX_STAGE_LEVEL_KEY[s]] ?? 0) > 0)
    .map(s => `${s}=${t.fxConfig[s][FX_STAGE_LEVEL_KEY[s]]}`);
  const lfos = Object.entries(t.lfoConfig || {}).filter(([, c]) => c?.enabled).map(([k, c]) => `${k}:${c.type} ${c.depth} @ ${c.sync ? lfoDivLabel(c.div) : c.rate + "Hz"}`);
  const labels = engineSliderLabels(t.engineKey);
  const sliders = {};
  for (const k of ["harm", "timb", "morph", "decay"]) if (labels[k] != null && t.params[k] != null) sliders[labels[k]] = t.params[k];
  const params = Object.fromEntries(Object.entries(t.params).filter(([k]) => !(k in BASE_PARAM_RANGE)));
  const patterns = (t.patterns || []).map((p, pi) => p && p.steps.some(Boolean) ? describePattern(t, pi) : null).filter(Boolean);
  const out = {
    index: i, name: t.name, engine: t.engineKey, length: t.length,
    drumKit: !!t.isDrumKit,
    ...(t.sampleSource ? { sample: t.sampleSource.id } : {}), ...(t.granularSample ? { texture: t.granularSample.id } : {}),
    vol: t.params.vol ?? 0.8, sliders, ...(Object.keys(params).length ? { panel: params } : {}),
    ...(Object.keys(t.filter).length ? { filter: t.filter } : {}),
    ...(Object.keys(t.eq).length ? { eq: t.eq } : {}),
    ...(t.comp?.enabled ? { comp: { ...t.comp, source: t.compSourceIndex >= 0 ? t.compSourceIndex : "self" } } : {}),
    fx: fxOn, lfos,
    ...(t.euclid?.on ? { euclid: t.euclid } : {}), ...(t.chance?.on ? { chance: { note: CHANCE_NOTE_VALUES[t.chance.note]?.label, var: t.chance.var, leg: t.chance.leg, rest: t.chance.rest, lo: t.chance.lo, hi: t.chance.hi } } : {}),
    ...(t.muted ? { muted: true } : {}), ...(t.soloed ? { soloed: true } : {}),
    ...(t.glide ? { glide: t.glide } : {}), ...(t.speed !== 1 ? { speed: t.speed } : {}),
    out: (t.outIndex ?? -1) >= 0 ? t.outIndex : "master",
    patterns,
  };
  return out;
}
/** The whole song, compactly: what an agent reads back to see what it made. */
export function summarize(song) {
  const rootName = NAMES_SHARP[song.scale?.root ?? 0];
  return {
    bpm: song.bpm, swing: song.swing,
    scale: song.scale?.active ? `${rootName} ${song.scale.mode}` : "off",
    arrangement: { mode: song.patternMode, switchMode: song.patternSwitchMode, active: song.activePattern,
      repeats: song.patternMode === "chain" ? song.patternRepeats : undefined,
      meters: song.patternMeters.map((m, i) => (m.num !== 4 || m.den !== 4) ? `${i}: ${m.num}/${m.den}` : null).filter(Boolean) },
    tracks: song.tracks.map((_, i) => summarizeTrack(song, i)),
  };
}

/** validateSet plus what this module knows: dangling sends, empty songs. */
export function validate(song) {
  const check = validateSet(song);
  const warnings = [...check.warnings];
  const errors = [...check.errors];
  if (!song.tracks?.length) warnings.push("the song has no tracks");
  song.tracks?.forEach((t, i) => {
    if ((t.outIndex ?? -1) >= 0 && song.tracks[t.outIndex]?.engineKey !== "bus") errors.push(`track ${i} sends to track ${t.outIndex}, which is not an fx bus`);
    if (t.engineKey !== "bus" && !(t.patterns || []).some(p => p && p.steps?.some(Boolean)) && !t.euclid?.on && !t.chance?.on)
      warnings.push(`track ${i} (${t.name}) has no steps, no euclid and no chance: it will be silent`);
    if (t.engineKey === "bus" && !song.tracks.some(o => o.outIndex === i)) warnings.push(`bus ${i} (${t.name}) has nothing sent to it`);
  });
  return { ok: check.ok && errors.length === 0, version: check.version, errors, warnings };
}

/** The song as the JSON the studio loads: applySet(JSON.parse(text)), the
 *  import button, or POST /api/share { session }. */
export function toJSON(song) {
  const v = validate(song);
  if (!v.ok) fail(`the song does not validate: ${v.errors.join("; ")}`);
  return JSON.stringify(song);
}

// The lists an agent asks for, in one place for the MCP resources.
export const BUNDLED_SAMPLE_LIST = BUNDLED_SAMPLES;
export const TEXTURE_LIST = GRANULAR_SAMPLES;
export { LFO_KEYS, LFO_LABELS, AUTOMATION_TARGETS, PANELS as ENGINE_PANELS };
