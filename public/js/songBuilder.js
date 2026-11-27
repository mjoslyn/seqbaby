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
  ACOUSTIC_KITS, BUNDLED_SAMPLES, ENGINE_CHARACTER, engineCharacter, hexopPresetDescription, CONTAGION_NUM_KEYS, CONTAGION_SEL_KEYS,
  GRANULAR_SAMPLES, GRAN_MOD_RANGE, GRAN_NUM_KEYS, GRAN_RATE_BEATS, GRAN_SEL_KEYS,
  GUITAR_NUM_CTLS, GUITAR_SEL_CTLS, GUITAR_TONE_NAMES, guitarTone, guitarToneDescription,
  HEXOP_MOD_RANGE, HEXOP_NUM_KEYS, HEXOP_OPS, HEXOP_PRESET_NAMES, hexopPreset,
  PLAITS_MACRO_TIPS, ENGINE_MACRO_TIPS,
  STATIC_ENGINES, staticEngineByKey, engineSliderLabels,
  SUB_NUM_CTLS, SUB_SEL_CTLS, SUB_TONE_NAMES, subTone, subToneDescription,
  DRONE_NUM_CTLS, DRONE_SEL_CTLS, DRONE_TONE_NAMES, droneTone, droneToneDescription,
  VOX_NUM_CTLS, VOX_SEL_CTLS, VOX_TEXT_CTLS, VOX_TONE_NAMES, voxTone, voxToneDescription,
  LANCET_NUM_CTLS, LANCET_SEL_CTLS, LANCET_TONE_NAMES, lancetTone, lancetToneDescription,
  HALO_NUM_CTLS, HALO_SEL_CTLS, HALO_TONE_NAMES, haloTone, haloToneDescription,
  SIEGE_NUM_CTLS, SIEGE_SEL_CTLS, SIEGE_TONE_NAMES, siegeTone, siegeToneDescription,
  LADDER_NUM_CTLS, LADDER_SEL_CTLS, LADDER_OSC_NUM_CTLS, LADDER_OSC_SEL_CTLS, LADDER_TONE_NAMES, ladderTone, ladderToneDescription,
  ORACLE_NUM_CTLS, ORACLE_SEL_CTLS, ORACLE_TONE_NAMES, oracleTone, oracleToneDescription,
  BREATH_NUM_CTLS, BREATH_SEL_CTLS, BREATH_TONE_NAMES, breathTone, breathToneDescription,
} from "./engineData.js";
import { EQ_KEYS, EUCLID_DEFAULTS, FILTER_TYPES, PRISM_SELECTS, REPEAT_MODES, defaultCompConfig, defaultEq, eqRange, defaultFilter, defaultFxConfig, defaultTrackParams, MASTER_KEYS, MASTER_RANGE, masterIsNeutral, normalizeMaster } from "./soundDefaults.js";
import {
  AUTOMATION_TARGETS, FX_STAGE_LEVEL_KEY, LFO_DIVS, LFO_KEYS, LFO_LABELS, PATTERN_COUNT, PATTERN_MODES, STEPS_PER_BAR, fxStageLevel,
  canAutomateKey, canModulateKey, lfoDivLabel, voiceAutoKeysForEngineKey,
  FX_STAGE_KEYS, baseModKey, fxChainOrder, fxInstanceIds, fxStageOf, fxStageOfModKey, isFxInstanceId, splitFxInstanceKey,
} from "./constants.js";
import { CHANCE_DEFAULT_PCS, CHANCE_DEFAULTS, CHANCE_NOTE_MAX, CHANCE_NOTE_MIN, CHANCE_NOTE_VALUES, CHANCE_REPEAT_MAX, cloneChance } from "./chanceGen.js";
import { CHORD_TYPES, SCALES, canonicalChord, midiToName, nameToMidi } from "./theoryData.js";
import { SET_VERSION, validateSet } from "./sessionFormat.js";
import { isTrigCond } from "./trigCond.js";
import { arrangementBars, blocksEnd, checkBlock, describeBlocks, normalizeBlocks } from "./arrangement.js";

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
/**
 * A list of notes from what an agent sends. A model will sometimes hand over
 * a list written as a STRING -- the JSON of an array (`"[\"Db2\", \"Ab1\"]"`),
 * or names separated by spaces or commas (`"C2 Eb2 G2"`) -- and read whole,
 * that is one note name that does not exist. A single name stays a single
 * note. Anything else is passed through as it came.
 */
export function noteList(v) {
  if (typeof v !== "string") return v;
  const str = v.trim();
  if (str.startsWith("[")) {
    try { const a = JSON.parse(str); if (Array.isArray(a)) return a; } catch { /* not JSON: read below */ }
    const inner = str.replace(/^\[|\]$/g, "");
    return inner.split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/^["']|["']$/g, "")).map((x) => x === "null" ? null : x);
  }
  const parts = str.split(/[\s,]+/).filter(Boolean);
  return parts.length > 1 ? parts : v;
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
const DRUM_RE = /\b(kick|siege|snare|rim|(open)?hat|hi-?hat|clap|tom\d*|ride|crash|cymbal|perc|drum|lancet|halo)\b/;

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
    // What it sounds like, what it is for, and how it sounds played rather than
    // programmed (ENGINE_CHARACTER, engineData.js).
    character: engineCharacter(e.key),
    sliders,
    oscMix: tips.osc || null,
    oscMod: tips.oscMod || null,
    panel: panel ? {
      numeric: panel.num.map(([k, lo, hi, d, label, values]) => ({ key: panel.prefix + k, label, min: lo, max: hi, default: d, ...(values ? { values } : {}) })),
      select: panel.sel.map(([k, d, vals]) => ({ key: panel.prefix + k, default: d, values: vals })),
      ...(panel.text ? { text: panel.text.map(([k, d, max, label]) => ({ key: panel.prefix + k, label, default: d, maxLength: max })) } : {}),
    } : null,
    presets: panel?.tones ? panel.tones.map(n => ({ name: n, description: panel.describe?.(n) || "" })) : [],
    lfoTargets: LFO_KEYS.filter(k => canModulateKey(e.key, k, { euclid: true, chance: true })),
    automationTargets: Object.keys(AUTOMATION_TARGETS).filter(k => canAutomateKey(e.key, k, { euclid: true, chance: true })),
    // What `add_track`'s `sample` / `texture` take. Here as well as in the
    // seqbaby://samples resource, because the studio's compose panel has the
    // tools and not the resources.
    ...(e.type === "sampler" ? {
      samples: BUNDLED_SAMPLES.map(({ id, label, kit }) => ({ id, label, kit })),
      kits: ACOUSTIC_KITS.map(({ id, title, author, license }) => ({ id, title, author, license })),
    } : {}),
    ...(e.type === "granular" ? { textures: GRANULAR_SAMPLES.map(({ id, label }) => ({ id, label })) } : {}),
  };
}

// Tips for the engines whose slider descriptions live inline in params.js
// (next to the labels they go with) rather than in the tables. Summarised here
// so describeEngine has something to say for them.
const SLIDER_TIPS = {
  "dm:silverbox": { harm: "filter cutoff", timb: "filter resonance", morph: "how far the envelope opens the filter", decay: "envelope decay" },
  "dm:contagion": { harm: "cutoff for both filters", timb: "filter 1's resonance (filter 2's is reso2); the last tenth self-oscillates", morph: "osc 1's shape, sine through triangle and saw to pulse (osc 2's is shape2)", decay: "the amp envelope's decay (the filter envelope's is fdec)" },
  "dm:hexop": { harm: "master modulation index: brightness", timb: "feedback", morph: "modulator decay and release", decay: "carrier decay" },
  "dm:guitar": { harm: "amp drive (exponential, like a gain pot)", timb: "the tone knob on the guitar, a passive lowpass", morph: "bloom: speaker-to-string feedback, a threshold rather than a switch", decay: "sustain" },
  "dm:bass": { harm: "amp drive", timb: "tone", morph: "the rig compressor: threshold down and makeup up together", decay: "sustain" },
  "dm:sub": { harm: "drive into the parallel harmonics path: what makes a sub audible on a small speaker", timb: "lowpass on the harmonics path", morph: "oscillator shape, sine through triangle and saw to square", decay: "decay" },
  "dm:drone": { harm: "cutoff of the MS-20 style lowpass", timb: "A0: the equation's multiplier, 1..16. Changes how fast its slow terms run against the pitch, not the pitch", morph: "A1: the equation's first shift, 2..15", decay: "A2: the equation's second shift, 2..15" },
  "dm:vox": { harm: "the vowel: u, o, a, e, i across the slider (0, 0.25, 0.5, 0.75, 1). A lane on it sings a lyric", timb: "throat size: soprano (0), alto, tenor, bass (1)", morph: "breath: air in the voice; above 0.75 it fades to a whisper", decay: "release" },
  "dm:lancet": { harm: "timbre: on most models the noise (level, brightness, length); what it does per model is in lncmodel's tips", timb: "color: the pitch envelope and shell balance (analog), the shaper (slap), the partials (modal), the body (physical), the modulator ratios (fm), the grains (granular), the bodies (blend)", morph: "fx amount: each model's own stage, clean at 0 (clipping, multiband drive, a fold, a compressor, an old sampler)", decay: "how long the hit lasts, 60ms to 2.4s" },
  "dm:halo": { harm: "tone: a highpass and a lowpass rising together, dark to bright; read live, so a lane opens a ringing crash", timb: "size: every partial scaled together, an octave and a half either way. Small is a hat or a splash, big a crash or a gong", morph: "spread: the model's own character (hlomodel): the metal's ratios, the fm's index, the modes' spacing, the noise's bandwidth", decay: "how long it rings, 30ms to 9s. In choke mode (hlochoke) the step's length cuts it first" },
  "dm:siege": { harm: "drive, after the envelope: crushes the attack, lifts the tail. fold or clip is `sgemode`", timb: "click: how far above the note the pitch starts, up to six octaves", morph: "depth: how long the pitch takes to fall onto the note, 1ms to 250ms", decay: "how long the body rings, 50ms to 4s" },
  "dm:ladder": { harm: "the ladder filter's cutoff, 30Hz..20kHz; `ldrkbd` is how much it follows the keyboard", timb: "emphasis (resonance): the passband thins as it climbs, past ~0.75 the filter whistles on its own. Under 0.4 for a lead or bass that should not twang", morph: "amount of contour: how far the filter envelope (`ldrfatk` / `ldrfdec` / `ldrfsus`) opens the filter, up to five octaves. The sweep heard on each note is 5 x morph x (1 - ldrfsus) octaves: about one for a lead or bass, more only for a pluck", decay: "the loudness contour's decay, and the release while `ldrdecsw` is on" },
  "dm:breath": { harm: "the tone: where the harmonics start to fall away, 250Hz (0) to 8kHz (1). Velocity opens it further, by `brtdyn`", timb: "air: how much breath is heard beside the note. 0.2 a clean trumpet, 0.5 a sax, 0.9 a breathy flute", morph: "vibrato depth, coming in after `brtvdelay`. 0 none, 0.5 a player's, 1 wide", decay: "release: how long a note takes to stop after its step, 20ms (0) to 1.5s (1)" },
  "dm:oracle": { harm: "VCO 2's detune against VCO 1, 30 cents either way, 0.5 unison (the slop keeps even unison beating)", timb: "VCO 2's shape: 0 triangle, 0.5 saw, 1 pulse (its width is `orcpw2`; VCO 1's shape is `orcshape1`)", morph: "drive on the summed voices: a gain into a knee, so chords compress and tails clean up. 0 is a wire, 0.5 warm, 1 crushed", decay: "the envelope's decay to its sustain, 50ms to 2s; `orcatk` / `orcsus` / `orcrel` are the rest of it" },
  "dm:granular": { harm: "grain size", timb: "grain density", morph: "play position in the sample", decay: "spray: window, detune and jitter together" },
  "dm:808-kick": { harm: "tune", timb: "attack click", morph: "drive", decay: "decay" },
  "dm:909-kick": { harm: "tune", timb: "beater click", morph: "drive", decay: "decay" },
};

// The engine panels: what sits outside the four sliders, as [short key, min,
// max, default, label] for the numeric controls and [short key, default,
// values] for the selects, plus the presets. The guitar, bass, sub and hexop
// tables come straight from engineData.js; the contagion, granular, silverbox
// panels have no such table in the engine (their ranges live in the markup),
// so those are spelled here from app/studioMarkup.ts. The ladder's oscillator
// bank keeps its unprefixed keys, so its panel is the two lists joined under
// an empty prefix.
const PANELS = {
  "dm:guitar": { prefix: "gt", num: GUITAR_NUM_CTLS, sel: GUITAR_SEL_CTLS, tones: GUITAR_TONE_NAMES, tone: guitarTone, describe: guitarToneDescription },
  "dm:bass":   { prefix: "bs", num: BASS_NUM_CTLS, sel: BASS_SEL_CTLS, tones: BASS_TONE_NAMES, tone: bassTone, describe: bassToneDescription },
  "dm:sub":    { prefix: "sub", num: SUB_NUM_CTLS, sel: SUB_SEL_CTLS, tones: SUB_TONE_NAMES, tone: subTone, describe: subToneDescription },
  "dm:drone":  { prefix: "drn", num: DRONE_NUM_CTLS, sel: DRONE_SEL_CTLS, tones: DRONE_TONE_NAMES, tone: droneTone, describe: droneToneDescription },
  "dm:vox":    { prefix: "sng", num: VOX_NUM_CTLS, sel: VOX_SEL_CTLS, text: VOX_TEXT_CTLS, tones: VOX_TONE_NAMES, tone: voxTone, describe: voxToneDescription },
  "dm:lancet":   { prefix: "lnc", num: LANCET_NUM_CTLS, sel: LANCET_SEL_CTLS, tones: LANCET_TONE_NAMES, tone: lancetTone, describe: lancetToneDescription },
  "dm:halo":     { prefix: "hlo", num: HALO_NUM_CTLS, sel: HALO_SEL_CTLS, tones: HALO_TONE_NAMES, tone: haloTone, describe: haloToneDescription },
  "dm:siege":    { prefix: "sge", num: SIEGE_NUM_CTLS, sel: SIEGE_SEL_CTLS, tones: SIEGE_TONE_NAMES, tone: siegeTone, describe: siegeToneDescription },
  "dm:breath":   { prefix: "brt", num: BREATH_NUM_CTLS, sel: BREATH_SEL_CTLS, tones: BREATH_TONE_NAMES, tone: breathTone, describe: breathToneDescription },
  "dm:oracle":   { prefix: "orc", num: ORACLE_NUM_CTLS, sel: ORACLE_SEL_CTLS, tones: ORACLE_TONE_NAMES, tone: oracleTone, describe: oracleToneDescription },
  "dm:hexop": {
    prefix: "d",
    num: HEXOP_NUM_KEYS.map(k => { const s = k.slice(1); const [lo, hi] = HEXOP_MOD_RANGE[s]; return [s, lo, hi, null, hexopLabel(s)]; }),
    sel: [
      ["alg", "1", Array.from({ length: 32 }, (_, i) => String(i + 1))],
      ["lfow", "tri", ["tri", "sine", "sawdn", "sawup", "square", "sh"]],
      ["lfok", "on", ["on", "off"]],
      ...HEXOP_OPS.map(i => [`${i}fix`, "ratio", ["ratio", "fixed"]]),
    ],
    tones: HEXOP_PRESET_NAMES, tone: hexopPreset, describe: hexopPresetDescription,
  },
  "dm:contagion": {
    prefix: "v",
    num: CONTAGION_NUM_KEYS.map(k => {
      const s = k.slice(1);
      const r = { osc2semi: [-24, 24], cut2: [-1, 1], envamt: [-1, 1], pw: [0.02, 0.98], pw2: [0.02, 0.98],
                  slope: [-1, 1], fslope: [-1, 1] }[s] || [0, 1];
      return [s, r[0], r[1], null, `contagion ${s}`];
    }),
    sel: [
      ["mode1", "lp", ["lp", "hp", "bp", "bs"]], ["poles", "4", ["2", "4"]], ["mode2", "lp", ["lp", "hp", "bp", "bs"]],
      ["route", "ser", ["ser", "par", "split"]],
      ["sat", "soft", ["off", "light", "soft", "middle", "hard", "digital", "shaper", "rectify", "bits", "rate",
                       "ratefollow", "lowpass", "lowfollow", "highpass", "highfollow"]],
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
    num: [...LADDER_OSC_NUM_CTLS, ...LADDER_NUM_CTLS.map(([k, lo, hi, d, label]) => [`ldr${k}`, lo, hi, d, label])],
    sel: [...LADDER_OSC_SEL_CTLS, ...LADDER_SEL_CTLS.map(([k, d, vals]) => [`ldr${k}`, d, vals])],
    tones: LADDER_TONE_NAMES, tone: ladderTone, describe: ladderToneDescription,
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
  for (const c of p.text ?? []) PANEL_KEY_ENGINE.set(p.prefix + c[0], engine);
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
    t.arrangement = normalizeBlocks(t.arrangement);
  });
  song.patternMode = PATTERN_MODES.includes(song.patternMode) ? song.patternMode : "repeat";
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
    offsets: fill(0), arps: fill(false), arpRates: fill(0.25), arpRanges: fill(1), arpDirs: fill("up"), strums: fill(0),
    complexities: fill(0), ratchets: fill(1), probs: fill(1), conds: fill(""),
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
 * Either takes `upload` instead: audio of its own, `{name, audio (base64),
 * mime, source?}`, carried in the session as an uploaded sample is (the
 * compose turn's freesound tool fetches one and hands it in).
 * @returns {{ index: number, engine: string, name: string }}
 */
export function addTrack(song, { engine, name, length = STEPS_PER_BAR, sample, texture, upload, drumKit } = {}) {
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
    arrangement: [],
  };
  const up = upload == null ? null : uploadOf(upload);
  if (up && e.key !== "sampler" && e.key !== "dm:granular") fail(`\`upload\` only applies to the sampler and granular engines (this track is ${e.key})`);
  if (up) {
    if (sample != null || texture != null) fail("give `upload` or a bundled `sample` / `texture`, not both");
    t.uploadAudio = up.audio; t.uploadAudioMime = up.mime; t.uploadFileName = up.name;
    if (e.key === "sampler") t.sampleSource = { ...(up.source || {}), kind: "upload", name: up.name };
  } else if (e.key === "sampler") {
    if (sample == null) fail(`a sampler track needs \`sample\`: one of ${BUNDLED_SAMPLES.map(s => s.id).join(", ")}`);
    const s = findByIdOrLabel(BUNDLED_SAMPLES, sample, "sample");
    t.sampleSource = { kind: "bundled", id: s.id, name: s.label };
  } else if (sample != null) fail(`\`sample\` only applies to the sampler engine (this track is ${e.key})`);
  if (up) { /* its audio is its own */ }
  else if (e.key === "dm:granular") {
    if (texture == null) fail(`a granular track needs \`texture\`: one of ${GRANULAR_SAMPLES.map(s => s.id).join(", ")}`);
    const s = findByIdOrLabel(GRANULAR_SAMPLES, texture, "texture");
    t.granularSample = { id: s.id, label: s.label };
  } else if (texture != null) fail(`\`texture\` only applies to the granular engine (this track is ${e.key})`);
  t.isDrumKit = drumKit != null ? !!drumKit
    : DRUM_RE.test(`${e.key} ${e.label} ${t.name} ${t.sampleSource?.id || ""} ${up && e.key === "sampler" ? up.name : ""}`.toLowerCase());
  // The ladder's format marker: without it the loader reads the four sliders
  // as the old engine's (see migrateLadderFilter, sessionFormat.js).
  if (e.key === "dm:ladder") t.params.ldrv = 2;
  // The oracle's, likewise (migrateOracleModel).
  if (e.key === "dm:oracle") t.params.orcv = 2;
  song.tracks.push(t);
  return { index: song.tracks.length - 1, engine: e.key, name: t.name };
}
function uploadOf(u) {
  if (!u || typeof u !== "object") fail("`upload` is {name, audio, mime}");
  if (typeof u.audio !== "string" || u.audio.length < 16 || !/^[A-Za-z0-9+/]+=*$/.test(u.audio.slice(0, 64))) fail("`upload.audio` is the file as base64");
  return {
    name: String(u.name || "sample").slice(0, 80),
    audio: u.audio,
    mime: typeof u.mime === "string" && /^audio\//.test(u.mime) ? u.mime : "audio/mpeg",
    source: u.source && typeof u.source === "object" ? JSON.parse(JSON.stringify(u.source)) : null,
  };
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
  for (const t of song.tracks) {
    t.outIndex = fix(t.outIndex ?? -1); t.compSourceIndex = fix(t.compSourceIndex ?? -1);
    if (t.sends) {
      t.sends = t.sends.filter(s => s.busIndex !== i).map(s => ({ ...s, busIndex: fix(s.busIndex) }));
      if (!t.sends.length) delete t.sends;
    }
  }
  if (song.muteScenes) song.muteScenes = song.muteScenes.map(s => s ? s.filter(j => j !== i).map(fix) : null);
  for (const pad of song.macroPads || []) for (const axis of ["x", "y"]) {
    pad[axis] = (pad[axis] || []).filter(a => a.track !== i).map(a => ({ ...a, track: fix(a.track) }));
  }
}

/**
 * Track-level settings. `out` is "master" or the index of an fx bus track;
 * `length` resizes every pattern, or with `pattern` only that one (patterns
 * have lengths of their own); `speed` is the per-track tempo multiple.
 */
export function setTrack(song, index, opts = {}) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  if (opts.name != null) t.name = String(opts.name).slice(0, 40);
  if (opts.length != null) {
    const n = int(opts.length, "length", 1, 64);
    if (opts.pattern != null) {
      const k = patternIndex(opts.pattern);
      resizePattern(patternOf(t, k), n);
      // t.length is the active pattern's, as the studio keeps it
      if (k === (song.activePattern ?? 0)) t.length = n;
    } else {
      t.length = n;
      for (const p of t.patterns) if (p) resizePattern(p, n);
    }
  }
  if (opts.mute != null) t.muted = !!opts.mute;
  if (opts.solo != null) t.soloed = !!opts.solo;
  if (opts.glide != null) t.glide = num(opts.glide, "glide", 0, 0.5);
  if (opts.speed != null) t.speed = num(opts.speed, "speed", 0.0625, 8);
  if (opts.density != null) t.density = num(opts.density, "density", 0, 1);
  if (opts.drumKit != null) t.isDrumKit = !!opts.drumKit;
  if (opts.pitchLock != null) t.pitchLock = !!opts.pitchLock;
  if (opts.samplePlay != null) {
    if (t.engineKey !== "sampler") fail(`\`samplePlay\` only applies to a sampler track (this one is ${t.engineKey})`);
    if (opts.samplePlay !== "trigger" && opts.samplePlay !== "gate") fail('`samplePlay` is "trigger" (a note plays the whole sample) or "gate" (it stops when the step ends)');
    t.sampleDefaults = { ...(t.sampleDefaults || {}), play: opts.samplePlay };
  }
  if (opts.sampleSpeedMode != null) t.sampleSpeedMode = oneOf(opts.sampleSpeedMode, "sampleSpeedMode", ["native", "1xbpm"]);
  if (opts.out != null) {
    if (opts.out === "master" || opts.out === -1) t.outIndex = -1;
    else {
      const j = int(opts.out, "out", 0, song.tracks.length - 1);
      const bus = song.tracks[j];
      if (j === i) fail("a track cannot send to itself");
      if (bus.engineKey !== "bus") fail(`track ${j} (${bus.name}) is not an fx bus; add one with engine "bus"`);
      // Refuse a loop, as applySet would (wouldFeedback, signal.js).
      if (reaches(song, j, i)) fail(`sending track ${i} to bus ${j} would feed back (bus ${j} already reaches track ${i})`);
      t.outIndex = j;
    }
  }
  return summarizeTrack(song, i);
}

/** Whether track `from`'s signal reaches track `to`, by outputs and sends. */
function reaches(song, from, to) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const k = stack.pop();
    if (k === to) return true;
    if (k == null || k < 0 || seen.has(k) || !song.tracks[k]) continue;
    seen.add(k);
    stack.push(song.tracks[k].outIndex ?? -1);
    for (const s of song.tracks[k].sends || []) if (s.amt > 0) stack.push(s.busIndex);
  }
  return false;
}

/**
 * A send: `amount` (0..1) of a track copied into an fx bus, beside wherever
 * its output goes. The way to share one reverb or delay between tracks at
 * different amounts with the dry signal left alone (`setTrack`'s `out` moves
 * the whole track instead). 0 removes the send. The level is squared: 1 is
 * unity, 0.5 is 12dB down.
 */
export function setSend(song, index, bus, amount) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  const j = int(bus, "bus", 0, song.tracks.length - 1);
  const amt = num(amount, "amount", 0, 1);
  const b = song.tracks[j];
  if (j === i) fail("a track cannot send to itself");
  if (b.engineKey !== "bus") fail(`track ${j} (${b.name}) is not an fx bus; add one with engine "bus"`);
  const rest = (t.sends || []).filter(s => s.busIndex !== j);
  if (amt > 0) {
    if (t.outIndex === j) fail(`track ${i} already has its whole output on bus ${j}; a send there would add nothing`);
    if (reaches(song, j, i)) fail(`sending track ${i} to bus ${j} would feed back (bus ${j} already reaches track ${i})`);
    rest.push({ busIndex: j, amt });
  }
  if (rest.length) t.sends = rest; else delete t.sends;
  return summarizeTrack(song, i);
}

/**
 * The master chain, on the whole mix before the limiter: `low` / `mid` /
 * `high` in dB (-12..12: a shelf at 120Hz, a wide bell at 1kHz, a shelf at
 * 6kHz), `glue` 0..1 (bus compression) and `drive` 0..1 (saturation). All 0
 * is the bare sum of the tracks, and is not written to the song.
 */
export function setMaster(song, opts = {}) {
  const m = normalizeMaster(song.master);
  for (const k of MASTER_KEYS) {
    if (opts[k] == null) continue;
    const [lo, hi] = MASTER_RANGE[k];
    m[k] = num(opts[k], k, lo, hi);
  }
  for (const k of Object.keys(opts)) if (!MASTER_KEYS.includes(k)) fail(`unknown master setting ${JSON.stringify(k)}; one of ${MASTER_KEYS.join(", ")}`);
  if (masterIsNeutral(m)) delete song.master; else song.master = m;
  return { master: m };
}

/**
 * A mute scene: which tracks are muted when the studio's mute button `scene`
 * (0..3) is tapped. `tracks` is a list of track indices, or null to empty it.
 * A second tap in the studio puts back the mutes from before.
 */
export function setMuteScene(song, scene, tracks) {
  const k = int(scene, "scene", 0, 3);
  const list = Array.isArray(song.muteScenes) ? song.muteScenes.slice(0, 4) : [];
  while (list.length < 4) list.push(null);
  list[k] = tracks == null ? null
    : [...new Set((Array.isArray(tracks) ? tracks : [tracks]).map(j => int(j, "track", 0, song.tracks.length - 1)))];
  if (list.some(Boolean)) song.muteScenes = list; else delete song.muteScenes;
  return { muteScenes: song.muteScenes ?? [null, null, null, null] };
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
  notes = noteList(notes);
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
 * inversion 0..4), `ratchet` (1..8 retriggers), `prob` (0..1, how often the
 * step plays), `cond` (a trig condition: fill, !fill, first, !first, or a:b for
 * the a-th of every b passes of the pattern), `offset` (-0.5..0.5 of a step),
 * `arp` + `arpRate` (beats per arp note) + `arpRange` (octaves 1..4) +
 * `arpDir` (up/down/updown/random), `strum` (ms between the stack's notes,
 * -80..80: positive low to high, negative high to low), `extraNotes` (more
 * pitches stacked on it).
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
  if (opts.prob != null) pat.probs[i] = num(opts.prob, "prob", 0, 1);
  if (opts.cond != null) {
    const c = String(opts.cond).trim();
    if (!isTrigCond(c)) fail(`unknown cond ${JSON.stringify(opts.cond)}; "" (always), fill, !fill, first, !first, or a:b for the a-th of every b passes (1:2, 3:4 ... up to 8:8)`);
    pat.conds[i] = c;
  }
  if (opts.offset != null) pat.offsets[i] = num(opts.offset, "offset", -0.5, 0.5);
  if (opts.arp != null) pat.arps[i] = !!opts.arp;
  if (opts.arpRate != null) pat.arpRates[i] = num(opts.arpRate, "arpRate", 0.0625, 4);
  if (opts.arpRange != null) pat.arpRanges[i] = int(opts.arpRange, "arpRange", 1, 4);
  if (opts.arpDir != null) pat.arpDirs[i] = oneOf(opts.arpDir, "arpDir", ["up", "down", "updown", "random"]);
  if (opts.strum != null) {
    if (!Array.isArray(pat.strums)) pat.strums = Array.from({ length: n }, () => 0);
    pat.strums[i] = num(opts.strum, "strum", -80, 80);
  }
  if (opts.extraNotes !== undefined) {
    pat.extraNotes[i] = opts.extraNotes == null ? null : [].concat(noteList(opts.extraNotes)).map(v => toMidi(v, "extraNotes"));
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

/**
 * Copy pattern `from` onto pattern `to` on every track (or only `tracks`): a
 * whole section, since a pattern number is the same moment on every track.
 * This is how a song is built from its loop: copy, then vary each copy.
 */
export function copySection(song, { from = 0, to, tracks } = {}) {
  const src = patternIndex(from), dst = patternIndex(to);
  if (src === dst) fail("from and to are the same pattern");
  const which = tracks == null ? song.tracks.map((_, i) => i) : tracks.map(i => int(i, "track", 0, song.tracks.length - 1));
  for (const i of which) copyPattern(song, i, { from: src, to: dst });
  return { from: src, to: dst, tracks: which.length };
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
    const textCtl = p.text?.find(c => c[0] === short);
    if (numCtl) {
      const v = num(raw, key, numCtl[1], numCtl[2]);
      // a switch with numbered positions (the ladder's footages): only those
      if (numCtl[5] && !numCtl[5].includes(v)) fail(`${key} must be one of ${numCtl[5].join(", ")}, got ${JSON.stringify(raw)}`);
      t.params[key] = v;
    }
    else if (selCtl) t.params[key] = oneOf(raw, key, selCtl[2]);
    else if (textCtl) {
      if (raw != null && typeof raw !== "string") fail(`${key} is text, e.g. "la di da"`);
      const s = String(raw ?? "");
      if (s.length > textCtl[2]) fail(`${key} is ${s.length} characters; at most ${textCtl[2]}`);
      t.params[key] = s;
    }
    if (owner !== t.engineKey) warnings.push(`${key} belongs to ${owner}'s panel; this track is ${t.engineKey}, so it does nothing here`);
  }
  // gspeed's format marker, as the studio writes it (stampGranularParams):
  // without it the loader reads the value as the old 0..1 knob and doubles it.
  if (t.params.gspeed != null) t.params.gspeedV = 2;
  return { params: t.params, warnings };
}
function panelKeys(engineKey) {
  const p = PANELS[engineKey];
  return p ? [...p.num.map(c => p.prefix + c[0]), ...p.sel.map(c => p.prefix + c[0]), ...(p.text ?? []).map(c => p.prefix + c[0])] : [];
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
/** Five-band eq in dB, -18..18: low (shelf 250Hz), lomid (peak 600Hz),
 *  mid (peak 1.2kHz), himid (peak 3kHz), high (shelf 5kHz). Each band's
 *  frequency is `<band>Freq` (20..20000Hz) and a bell's width `<band>Q`
 *  (0.1..18), both optional. */
export function setEq(song, index, eq = {}) {
  const t = trackAt(song, index);
  const d = defaultEq();
  for (const [k, v] of Object.entries(eq)) {
    if (!EQ_KEYS.includes(k)) fail(`unknown eq key ${JSON.stringify(k)}; one of ${EQ_KEYS.join(", ")}`);
    const [lo, hi] = eqRange(k);
    t.eq[k] = num(v, `eq.${k}`, lo, hi);
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
const FX_SELECT = {
  "shaper.mode": ["saturate", "softclip", "clip", "serge", "fold", "wrap"],
  ...Object.fromEntries(Object.entries(PRISM_SELECTS).map(([k, v]) => [`prism.${k}`, v])),
  "repeat.mode": REPEAT_MODES,
};
/**
 * An fx rack stage. `stage` is one of FX_STAGES (gain, vinyl, cassette, fuzz,
 * ringmod, shaper, crush, autowah, chorus, phaser, flanger, pitchshift, repeat, prism, pan, delay,
 * reverb, or amp), or a COPY of one, "<stage>#<n>" with n from 2 ("delay#2"),
 * which is made if it is not there; `settings` its controls, or null to take a
 * copy off (with its LFOs and lanes). A stage is on when its level is off its
 * resting place (wet / amount above zero; gain and pan off centre). The whole
 * stage is written, defaults filled in, since the engine takes a stage config
 * whole.
 */
export function setFx(song, index, stage, settings = {}) {
  const t = trackAt(song, index);
  const d = defaultFxConfig();
  const id = String(stage);
  const copy = isFxInstanceId(id) && Number(id.split("#")[1]) >= 2;
  const s = copy ? fxStageOf(id) : id;
  if (!(s in d) || (id.includes("#") && !copy)) fail(`unknown fx stage ${JSON.stringify(stage)}; one of ${FX_STAGES.join(", ")}, or a copy of one as delay#2`);
  if (settings === null) {
    if (!copy) fail(`only a copy (delay#2) can be taken off; turn ${s}'s level down instead`);
    removeFxCopy(t, id);
    return null;
  }
  const cur = { ...d[s], ...(t.fxConfig[id] || {}) };
  for (const [k, v] of Object.entries(settings)) {
    const full = `${s}.${k}`;
    const alias = k === "amount" && !("amount" in d[s]) ? "wet" : k === "wet" && !("wet" in d[s]) ? "amount" : k;
    if (!(alias in d[s])) fail(`unknown ${s} control ${JSON.stringify(k)}; one of ${Object.keys(d[s]).join(", ")}`);
    if (alias === "sync") cur.sync = !!v;
    else if (FX_SELECT[full]) cur[alias] = oneOf(v, full, FX_SELECT[full]);
    else { const [lo, hi] = FX_RANGE[`${s}.${alias}`] || [0, 1]; cur[alias] = num(v, full, lo, hi); }
  }
  t.fxConfig[id] = cur;
  return cur;
}

function removeFxCopy(t, id) {
  delete t.fxConfig[id];
  if (Array.isArray(t.fxConfig.order)) t.fxConfig.order = t.fxConfig.order.filter(x => x !== id);
  for (const k of Object.keys(t.lfoConfig || {})) if (fxStageOfModKey(k) === id) delete t.lfoConfig[k];
  for (const p of t.patterns || []) for (const k of Object.keys(p?.automation || {})) if (fxStageOfModKey(k) === id) delete p.automation[k];
}

/**
 * The order a track's fx run in: stage names and copies ("delay#2"), first to
 * last. A stage left out runs after the ones named, in the default order
 * (gain, vinyl, ... reverb); null goes back to the default order.
 */
export function setFxChain(song, index, ids) {
  const t = trackAt(song, index);
  if (ids === null) { delete t.fxConfig.order; return fxChainOrder(t.fxConfig); }
  const list = typeof ids === "string" ? ids.trim().split(/[\s,>]+/).filter(Boolean) : ids;
  if (!Array.isArray(list)) fail("the chain is a list of stages, first to last");
  const seen = new Set();
  for (const id of list) {
    const ok = FX_STAGE_KEYS.includes(id) || (isFxInstanceId(id) && t.fxConfig[id]);
    if (!ok) fail(`${JSON.stringify(id)} is not a stage${isFxInstanceId(id) ? " this track has (setFx makes a copy first)" : ""}; one of ${[...FX_STAGE_KEYS, ...fxInstanceIds(t.fxConfig)].join(", ")}`);
    if (seen.has(id)) fail(`${id} is in the chain twice; a second ${fxStageOf(id)} is a copy, ${fxStageOf(id)}#2`);
    seen.add(id);
  }
  t.fxConfig.order = [...list];
  return fxChainOrder(t.fxConfig);
}

// ---- modulation ---------------------------------------------------------------------

export const LFO_SHAPES = ["sine", "triangle", "sawtooth", "square", "randsq", "euclid"];
const LFO_DIV_BY_LABEL = new Map(LFO_DIVS.map(d => [d.label, d.div]));
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
  if (!LFO_KEYS.includes(baseModKey(key))) {
    const near = LFO_KEYS.filter(k => k.includes(key) || (LFO_LABELS[k] || "").includes(key)).slice(0, 8);
    fail(`unknown LFO target ${JSON.stringify(target)}${near.length ? `; did you mean ${near.join(", ")}` : ""}`);
  }
  if (splitFxInstanceKey(key) && !t.fxConfig[fxStageOfModKey(key) || ""]) fail(`${key} is a copy's target, and this track has no ${fxStageOfModKey(key) || "such copy"} (setFx makes one)`);
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
  if (!AUTOMATION_TARGETS[baseModKey(key)]) {
    const near = Object.keys(AUTOMATION_TARGETS).filter(k => k.includes(key)).slice(0, 8);
    fail(`unknown automation target ${JSON.stringify(target)}${near.length ? `; did you mean ${near.join(", ")}` : ""}`);
  }
  if (splitFxInstanceKey(key) && !t.fxConfig[fxStageOfModKey(key) || ""]) fail(`${key} is a copy's lane, and this track has no ${fxStageOfModKey(key) || "such copy"} (setFx makes one)`);
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
  const cur = cloneChance(t.chance) || { ...CHANCE_DEFAULTS };
  // A song written here has no session scale to follow, so a track that was never
  // given pitches plays the default pentatonic, written out.
  if (!cur.pcs) cur.pcs = CHANCE_DEFAULT_PCS.slice();
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
  // An unset last is the whole track (chanceGen.js); only a written one can sit
  // before the first.
  if (cfg.last != null && cfg.last < cfg.first) [cfg.first, cfg.last] = [cfg.last, cfg.first];
  if (c.triplets != null) cfg.trips = !!c.triplets;
  if (c.thirtySeconds != null) cfg.x32 = !!c.thirtySeconds;
  if (c.rhythmSeed != null) cfg.rseed = int(c.rhythmSeed, "rhythmSeed", 1, 2 ** 31);
  if (c.melodySeed != null) cfg.mseed = int(c.melodySeed, "melodySeed", 1, 2 ** 31);
  // rhythmRepeat / melodyRepeat: how many passes of the window a throw is held
  // for before a new one (0 holds it for good). rhythmFree / melodyFree are the
  // flags they replaced: a new throw every pass, so true is 1.
  if (c.rhythmFree != null) cfg.rrep = c.rhythmFree ? 1 : 0;
  if (c.melodyFree != null) cfg.mrep = c.melodyFree ? 1 : 0;
  if (c.rhythmRepeat != null) cfg.rrep = int(c.rhythmRepeat, "rhythmRepeat", 0, CHANCE_REPEAT_MAX);
  if (c.melodyRepeat != null) cfg.mrep = int(c.melodyRepeat, "melodyRepeat", 0, CHANCE_REPEAT_MAX);
  t.chance = cfg;
  if (cfg.on && t.euclid?.on) t.euclid.on = false;
  return { ...cfg, noteValue: CHANCE_NOTE_VALUES[cfg.note].label };
}
export const CHANCE_NOTE_LABELS = CHANCE_NOTE_VALUES.map(v => v.label);

// ---- patterns as a song ------------------------------------------------------------------

/** How the 32 patterns play: `mode` repeat (loop one), chain (play them in
 *  order) or arrange (each track its own timeline of blocks, `setBlocks`);
 *  `repeats` bars per pattern in chain mode; `switchMode` immediate or finish
 *  (wait for the bar). `active` is the pattern the studio opens on. */
export function setArrangement(song, { mode, repeats, switchMode, active } = {}) {
  if (mode != null) song.patternMode = oneOf(mode, "mode", PATTERN_MODES);
  if (switchMode != null) song.patternSwitchMode = oneOf(switchMode, "switchMode", ["immediate", "finish"]);
  if (active != null) song.activePattern = patternIndex(active);
  if (repeats != null) {
    if (!Array.isArray(repeats)) fail("repeats must be an array of bar counts, one per pattern from the first");
    repeats.forEach((r, i) => { if (i < PATTERN_COUNT) song.patternRepeats[i] = int(r, `repeats[${i}]`, 1, 16); });
  }
  return { mode: song.patternMode, switchMode: song.patternSwitchMode, active: song.activePattern, repeats: song.patternRepeats };
}
/**
 * A track's arrangement: the timeline arrange mode plays for it, as blocks
 * `{ slot, start, bars }` — which pattern, the bar it starts on (0-based) and
 * how long it holds. Bars are the ruler's (pattern 0's meter). Blocks that
 * overlap resolve later-wins, as the studio's editor does; the result is
 * sorted. `[]` clears it. Replaces the track's whole arrangement.
 */
export function setBlocks(song, track, blocks) {
  const t = trackAt(song, track);
  if (!Array.isArray(blocks)) fail("blocks must be an array of { slot, start, bars }");
  blocks.forEach((b, i) => {
    const why = checkBlock(b);
    if (why) fail(`blocks[${i}]: ${why}`);
    if (b.slot >= PATTERN_COUNT) fail(`blocks[${i}]: slot must be 0..${PATTERN_COUNT - 1}`);
  });
  t.arrangement = normalizeBlocks(blocks);
  return { track: song.tracks.indexOf(t), blocks: t.arrangement, bars: blocksEnd(t.arrangement), plays: describeBlocks(t.arrangement) };
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
  if (pat.probs?.[i] != null && pat.probs[i] < 1) out.prob = pat.probs[i];
  if (pat.conds?.[i]) out.cond = pat.conds[i];
  if (pat.offsets[i]) out.offset = pat.offsets[i];
  if (pat.arps[i]) out.arp = { rate: pat.arpRates[i], range: pat.arpRanges[i], dir: pat.arpDirs[i] };
  if (pat.strums?.[i]) out.strum = pat.strums[i];
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
    if (d.chord || d.ratchet || d.arp || d.extraNotes || (d.length > 1) || d.offset || d.complexity || d.prob != null || d.cond) extras.push(d);
  }
  return { pattern: p, steps: str, hits: notes.length, ...(anyNote ? { notes } : {}), ...(extras.length ? { detail: extras } : {}), ...(lanes.length ? { automation: lanes } : {}), ...(pat.soundLocked ? { soundLocked: true } : {}) };
}
export function summarizeTrack(song, index) {
  const t = trackAt(song, index);
  const i = int(index, "track");
  const d = defaultFxConfig();
  const fxOn = fxChainOrder(t.fxConfig).filter(s => fxStageLevel(t.fxConfig, s) > 0)
    .map(s => `${s}=${t.fxConfig[s][FX_STAGE_LEVEL_KEY[fxStageOf(s)]]}`);
  const lfos = Object.entries(t.lfoConfig || {}).filter(([, c]) => c?.enabled).map(([k, c]) => `${k}:${c.type} ${c.depth} @ ${c.sync ? lfoDivLabel(c.div) : c.rate + "Hz"}`);
  const labels = engineSliderLabels(t.engineKey);
  const sliders = {};
  for (const k of ["harm", "timb", "morph", "decay"]) if (labels[k] != null && t.params[k] != null) sliders[labels[k]] = t.params[k];
  const params = Object.fromEntries(Object.entries(t.params).filter(([k]) => !(k in BASE_PARAM_RANGE)));
  const patterns = (t.patterns || []).map((p, pi) => p && p.steps.some(Boolean) ? describePattern(t, pi) : null).filter(Boolean);
  const out = {
    index: i, name: t.name, engine: t.engineKey, length: t.length,
    drumKit: !!t.isDrumKit,
    ...(t.sampleSource?.id ? { sample: t.sampleSource.id } : {}), ...(t.granularSample ? { texture: t.granularSample.id } : {}),
    ...(t.uploadAudio ? { sound: t.sampleSource?.soundId ? `freesound ${t.sampleSource.soundId}: ${t.sampleSource.name}` : (t.uploadFileName || t.sampleSource?.name || "an uploaded sample") } : {}),
    vol: t.params.vol ?? 0.8, sliders, ...(Object.keys(params).length ? { panel: params } : {}),
    ...(Object.keys(t.filter).length ? { filter: t.filter } : {}),
    ...(Object.keys(t.eq).length ? { eq: t.eq } : {}),
    ...(t.comp?.enabled ? { comp: { ...t.comp, source: t.compSourceIndex >= 0 ? t.compSourceIndex : "self" } } : {}),
    fx: fxOn, lfos,
    ...(t.euclid?.on ? { euclid: t.euclid } : {}), ...(t.chance?.on ? { chance: { note: CHANCE_NOTE_VALUES[t.chance.note]?.label, var: t.chance.var, leg: t.chance.leg, rest: t.chance.rest, lo: t.chance.lo, hi: t.chance.hi } } : {}),
    ...(t.muted ? { muted: true } : {}), ...(t.soloed ? { soloed: true } : {}),
    ...(t.glide ? { glide: t.glide } : {}), ...(t.speed !== 1 ? { speed: t.speed } : {}),
    out: (t.outIndex ?? -1) >= 0 ? t.outIndex : "master",
    ...(t.sends?.length ? { sends: t.sends.map(s => ({ bus: s.busIndex, amount: s.amt })) } : {}),
    patterns,
  };
  return out;
}
function slotHasSteps(song, p) {
  return song.tracks.some(t => t.engineKey !== "bus" && t.patterns?.[p]?.steps?.some(Boolean));
}
function stepsPerBar(song, p) {
  const m = song.patternMeters?.[p] || { num: 4, den: 4 };
  return Math.max(1, Math.round(m.num * (16 / m.den)));
}
/** How long slot `p` takes to play through once, in bars of its meter. */
function slotBars(song, p) {
  // a track at speed 0.5 takes twice as long to get through its steps
  const playing = song.tracks.filter(t => t.engineKey !== "bus" && t.patterns?.[p]?.steps?.some(Boolean));
  const longest = Math.max(0, ...playing.map(t => t.patterns[p].steps.length / (t.speed > 0 ? t.speed : 1)));
  return longest / stepsPerBar(song, p);
}
/**
 * What chain mode actually plays: the slots with a step on some track, in
 * order, each for its repeat count in bars. Empty slots are skipped and the
 * chain loops back to the first. In repeat mode, the active slot alone.
 */
export function songSections(song) {
  const slots = [];
  for (let p = 0; p < PATTERN_COUNT; p++) if (slotHasSteps(song, p)) slots.push(p);
  if (song.patternMode === "arrange") {
    // the longest track's timeline, as the song's sections
    const longest = (song.tracks || []).reduce((best, t) => (blocksEnd(t.arrangement || []) > blocksEnd(best?.arrangement || []) ? t : best), null);
    return (longest?.arrangement || []).map(b => ({ pattern: b.slot, bars: b.bars, start: b.start }));
  }
  if (song.patternMode !== "chain") return slots.includes(song.activePattern) ? [{ pattern: song.activePattern, bars: "loop" }] : [];
  return slots.map(p => ({ pattern: p, bars: Math.max(1, song.patternRepeats?.[p] ?? 1) }));
}

/** The whole song, compactly: what an agent reads back to see what it made. */
export function summarize(song) {
  const rootName = NAMES_SHARP[song.scale?.root ?? 0];
  return {
    bpm: song.bpm, swing: song.swing,
    scale: song.scale?.active ? `${rootName} ${song.scale.mode}` : "off",
    arrangement: { mode: song.patternMode, switchMode: song.patternSwitchMode, active: song.activePattern,
      repeats: song.patternMode === "chain" ? song.patternRepeats : undefined,
      bars: song.patternMode === "arrange" ? arrangementBars(song.tracks) : undefined,
      blocks: song.patternMode === "arrange"
        ? song.tracks.map((t, i) => ({ track: i, name: t.name, plays: describeBlocks(t.arrangement || []), blocks: t.arrangement || [] }))
        : undefined,
      meters: song.patternMeters.map((m, i) => (m.num !== 4 || m.den !== 4) ? `${i}: ${m.num}/${m.den}` : null).filter(Boolean),
      sections: songSections(song) },
    ...(song.master ? { master: song.master } : {}),
    ...(song.muteScenes?.some(Boolean) ? { muteScenes: song.muteScenes } : {}),
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
    for (const s of t.sends || []) {
      if (song.tracks[s.busIndex]?.engineKey !== "bus") errors.push(`track ${i} has a send to track ${s.busIndex}, which is not an fx bus`);
    }
    if (t.engineKey === "bus" && !song.tracks.some(o => o.outIndex === i || (o.sends || []).some(s => s.busIndex === i && s.amt > 0))) warnings.push(`bus ${i} (${t.name}) has nothing sent to it`);
  });
  if (song.patternMode === "chain" && song.tracks?.length) {
    const played = songSections(song);
    if (played.length < 2) warnings.push("chain mode with only one pattern holding steps: it plays as a loop (empty patterns are skipped)");
    for (const { pattern: p, bars } of played) {
      const need = slotBars(song, p);
      if (need > bars + 1e-9) warnings.push(`pattern ${p} is ${need} bars long but plays for ${bars}: the chain moves on before it finishes (repeats[${p}] = ${Math.ceil(need)} at least)`);
    }
  } else if (song.patternMode === "arrange" && song.tracks?.length) {
    if (!song.tracks.some(t => t.arrangement?.length)) warnings.push(`arrange mode with no blocks on any track: nothing plays (set_blocks)`);
    song.tracks.forEach((t, i) => {
      for (const b of t.arrangement || []) {
        if (t.engineKey !== "bus" && !t.patterns?.[b.slot]?.steps?.some(Boolean) && !t.euclid?.on && !t.chance?.on)
          warnings.push(`track ${i} (${t.name}) plays pattern ${b.slot} from bar ${b.start + 1}, which has no steps on it`);
      }
    });
  } else if (song.tracks?.length) {
    const used = [];
    for (let p = 0; p < PATTERN_COUNT; p++) if (slotHasSteps(song, p)) used.push(p);
    if (used.length > 1) warnings.push(`patterns ${used.join(", ")} hold steps but the arrangement is "repeat", so only pattern ${song.activePattern} plays: set_arrangement mode "chain" to play them in order, or "arrange" with set_blocks for a timeline per track`);
  }
  return { ok: check.ok && errors.length === 0, version: check.version, errors, warnings, production: productionNotes(song) };
}

/**
 * What will make the song sound programmed, like a video game or a computer
 * demo, rather than played and produced. Advice, never an error: chiptune
 * wants most of it. The agent cannot hear, so this is its ear for the habits
 * that give a sequenced song away (the compose guide's "a record, not a video
 * game").
 * @returns {string[]}
 */
// ---- the silverbox's squeal ----------------------------------------------------
//
// silverbox.js's own corner: 80Hz x 62.5^cutoff, pulled down a little by the
// resonance, swept up 4.2 octaves x env mod by the envelope (an accent adds
// more). With the resonance up, that corner is a whistle. Shared by the
// production check and the compose turn's polish pass (mcp/polish.mjs).
export const SILVERBOX_SAFE_HZ = 4000;
export const SILVERBOX_SAFE_RESO = 0.7;
export const SILVERBOX_MAX_RESO = 0.82;
export const SILVERBOX_TOP_NOTE = 72;   // C5
export const silverboxPeakHz = (harm, timb, morph) => 80 * Math.pow(62.5, harm) * (1 - 0.16 * timb) * Math.pow(2, 4.2 * morph);

/** The highest a track's cutoff, resonance and env mod get: the knobs, or a lane's top. */
export function silverboxWhistle(t) {
  const top = (key) => {
    let v = Number(t.params?.[key] ?? 0.5);
    for (const p of t.patterns || []) {
      const lane = p?.automation?.[key];
      if (lane?.enabled && Array.isArray(lane.values)) for (const x of lane.values) if (Number(x) > v) v = Number(x);
    }
    return Math.max(0, Math.min(1, v));
  };
  const harm = top("harm"), reso = top("timb"), morph = top("morph");
  const peakHz = silverboxPeakHz(harm, reso, morph);
  return { harm, reso: Math.round(reso * 100) / 100, morph, peakHz, harsh: reso > SILVERBOX_MAX_RESO || (reso >= SILVERBOX_SAFE_RESO && peakHz > SILVERBOX_SAFE_HZ) };
}

export function productionNotes(song) {
  const notes = [];
  const tracks = song.tracks || [];
  const playing = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.engineKey !== "bus");
  let anyOffset = false;
  let anySpace = false;
  const wetOf = (cfg) => Object.entries(cfg || {}).some(([k, v]) => /^(reverb|delay)(#\d+)?$/.test(k) && Number(v?.wet) > 0.02);
  for (const t of tracks) if (wetOf(t.fxConfig)) anySpace = true;
  for (const { t, i } of playing) {
    const label = `track ${i} (${t.name})`;
    const pats = (t.patterns || []).filter((p) => p?.steps?.some(Boolean));
    if (!pats.length) continue;
    const vels = new Set();
    const pitches = [];
    let hits = 0, short = 0, maxRun = 0;
    const lanes = new Set();
    for (const p of pats) {
      let run = 0;
      p.steps.forEach((on, s) => {
        if (p.offsets?.[s]) anyOffset = true;
        if (!on) { run = 0; return; }
        hits++;
        vels.add(Math.round((p.velocities?.[s] ?? 0.5) * 100));
        const n = p.notes?.[s];
        if (typeof n === "number") pitches.push(n);
        if ((p.lengths?.[s] || 1) <= 1) short++;
        // A held note counts as a run too: what matters is that nothing rests.
        run += Math.max(1, p.lengths?.[s] || 1);
        maxRun = Math.max(maxRun, run);
      });
      for (const [k, l] of Object.entries(p.automation || {})) if (l?.enabled) lanes.add(k);
    }
    const char = ENGINE_CHARACTER[t.engineKey];
    const melodic = !t.isDrumKit && char?.kind !== "drum";
    const kick = /kick|siege|plaits:13/.test(t.engineKey) || /\b(kick|bd)\b/i.test(t.name || "");
    if (hits >= 8 && vels.size === 1 && !kick) notes.push(`${label}: all ${hits} hits are the same velocity. Vary them: accents (X), ghosts (o), a few in between`);
    if (melodic && hits >= 8 && short === hits && !t.euclid?.on && !t.chance?.on) notes.push(`${label}: every note is one step long, which reads as blips unless the part is staccato on purpose. Tie some (_) so notes are held for their length`);
    if (melodic && maxRun >= 16 && hits >= 16) notes.push(`${label}: plays ${maxRun} steps without a rest. Unless it is a rolling ostinato, leave space at phrase ends`);
    const swept = lanes.has("cutoff") || t.lfoConfig?.cutoff?.enabled;
    const open = (t.filter?.cutoff ?? 1) >= 0.9 && !(Number(t.filter?.env) > 0);
    if (char?.kind === "raw" && open && !swept) notes.push(`${label}: ${t.engineKey} is a bare oscillator with the filter open and still. It sounds like a video game unless that is the point: close the filter with an envelope or a lane, add chorus or drive, or use ${t.engineKey === "dm:pad" ? "dm:oracle (warm pad, strings)" : "dm:oracle, dm:ladder or dm:contagion"}`);
    // A synth up in octave 5 and above, through an open-ish filter, is a beep:
    // where a lead or a pad on one of these reads as a toy. A bell or a
    // sample is not asked.
    if (melodic && (char?.kind === "analog" || char?.kind === "raw") && pitches.length >= 8) {
      const mid = [...pitches].sort((a, b) => a - b)[pitches.length >> 1];
      if (mid >= 75) notes.push(`${label}: its notes sit around ${midiToName(mid)}. A synth up there reads as a toy beep: an octave down (two for chords) is where a lead or a pad on ${t.engineKey} sings`);
    }
    // The acid box has no key tracking: its resonance whistles at the
    // filter's corner whatever the note, and the envelope sweeps that corner
    // up to four octaves. High resonance over a sweep that reaches several
    // kHz is a squeal that hurts at volume, and so is the line itself up in
    // octave 5.
    if (t.engineKey === "dm:silverbox" && hits) {
      const w = silverboxWhistle(t);
      if (w.harsh) notes.push(`${label}: resonance ${w.reso} with the filter sweeping up to about ${Math.round(w.peakHz / 100) / 10}kHz is a piercing whistle that hurts at volume. Keep the sweep's top under ${SILVERBOX_SAFE_HZ / 1000}kHz (lower env mod, morph, or cutoff, harm) or the resonance (timb) under ${SILVERBOX_SAFE_RESO}, lanes included`);
      const top = pitches.length ? Math.max(...pitches) : 0;
      if (top > SILVERBOX_TOP_NOTE) notes.push(`${label}: it reaches ${midiToName(top)}. The silverbox is a bass box: an acid lead sits between C2 and C4, and above ${midiToName(SILVERBOX_TOP_NOTE)} it is shrill. Take the line down an octave or two`);
    }
    if (t.engineKey === "plaits:12" && hits > 12) notes.push(`${label}: plaits:12 (modal) plays ${hits} notes. It is a bell or music-box colour, and as a melody it reads as a toy: dm:hexop (marimba, bell), inst:guitar-nylon or a real lead instead`);
  }
  notes.push(...mixNotes(song, playing), ...arrangementNotes(song, playing));
  if (playing.length >= 2 && !anySpace) notes.push("no track has reverb or delay: the parts are in no room together. Put a reverb (and a delay) on a bus and send the melodic parts to it");
  if (playing.length >= 2 && !anyOffset && !(Number(song.swing) > 0)) notes.push("nothing is off the grid and swing is 0: a little swing, or a few notes nudged (offsets) late or early, makes it feel played");
  return notes;
}

// ---- what a track is in the mix, by its engine and its name ---------------------------

/**
 * A track's role, for the checks below and the polish pass (mcp/polish.mjs):
 * kick, snare, hat, cymbal, perc, bass, sub, pad, keys, lead, vox, texture,
 * bus, or "part" when nothing says.
 * @returns {string}
 */
export function trackRole(t) {
  const key = String(t?.engineKey || "");
  const name = String(t?.name || "").toLowerCase();
  const sample = String(t?.sampleSource?.id || "").toLowerCase();
  const said = `${name} ${sample}`;
  if (key === "bus") return "bus";
  if (/kick|siege|plaits:13/.test(key) || /\b(kick|bd|bass ?drum)\b/.test(said)) return "kick";
  if (/snare|clap|lancet|plaits:14/.test(key) || /\b(snare|sd|clap|cp|rim)\b/.test(said)) return "snare";
  if (/ohat/.test(key) || /\b(open ?hat|openhat|oh|ride|crash|cymbal|china|splash|gong)\b/.test(said)) return "cymbal";
  if (/chat|halo|plaits:15/.test(key) || /\b(hats?|hh|hi-?hats?|hihat|shaker|tamb\w*)\b/.test(said)) return "hat";
  const char = ENGINE_CHARACTER[key];
  if (t?.isDrumKit || char?.kind === "drum" || /\b(perc\w*|tom\d?|conga|bongo|cowbell|clave|wood\w*)\b/.test(said)) return "perc";
  if (key === "dm:sub" || /\b(sub|808)\b/.test(name)) return "sub";
  if (key === "dm:bass" || key === "inst:bass-electric" || /bass/.test(name) || /\b(tuba|sousaphone)\b/.test(name)) return "bass";
  if (key === "dm:vox" || /\b(vox|vocal|voice|choir)\b/.test(name)) return "vox";
  if (key === "dm:drone" || key === "dm:granular" || /\b(drone|texture|noise|riser|sweep|fx|atmos\w*)\b/.test(name)) return "texture";
  if (/\b(pad|strings?)\b/.test(name) || key === "dm:pad") return "pad";
  if (/\b(chords?|keys|piano|organ|stabs?|rhodes|comp)\b/.test(name) || key === "dm:tines") return "keys";
  if (/\b(lead|melody|hook|arp|pluck|acid|riff|sax|trumpet|flute|clarinet|oboe|solo)\b/.test(name)) return "lead";
  return "part";
}

const LOW_ROLES = new Set(["bass", "sub"]);

/** What two parts do to each other, and what a small speaker will lose. */
function mixNotes(song, playing) {
  const notes = [];
  const kicks = playing.filter(({ t }) => trackRole(t) === "kick");
  const basses = playing.filter(({ t }) => LOW_ROLES.has(trackRole(t)));
  for (const { t: b, i: bi } of basses) {
    for (const { t: k, i: ki } of kicks) {
      if ((b.speed || 1) !== (k.speed || 1)) continue;
      if (b.comp?.enabled && b.compSourceIndex === ki) continue;
      let worst = null;
      for (let p = 0; p < PATTERN_COUNT; p++) {
        const kp = k.patterns?.[p], bp = b.patterns?.[p];
        if (!kp?.steps?.some(Boolean) || !bp?.steps?.some(Boolean)) continue;
        const n = Math.max(kp.steps.length, bp.steps.length);
        let kickHits = 0, both = 0;
        for (let s = 0; s < n; s++) {
          if (!kp.steps[s % kp.steps.length]) continue;
          kickHits++;
          if (bp.steps[s % bp.steps.length]) both++;
        }
        if (both >= 3 && both >= 0.75 * kickHits && (!worst || both > worst.both)) worst = { p, both, kickHits };
      }
      if (worst) notes.push(`track ${bi} (${b.name}) plays a note on ${worst.both} of the ${worst.kickHits} kicks in pattern ${worst.p} with no sidechain: the two fight for the low end. Duck it under the kick (set_comp source ${ki}), or move its notes off the kick`);
    }
  }
  for (const { t, i } of playing) {
    if (t.engineKey === "dm:sub" && typeof t.params?.harm === "number" && t.params.harm < 0.12)
      notes.push(`track ${i} (${t.name}): the sub has almost no drive (${t.params.harm}), so it is silent on a phone or a laptop. Raise the drive unless a pure sine is the point`);
  }
  // Notes the session scale will move: the studio snaps every written note to
  // the scale on its way out, so one outside it does not sound as written.
  const pcs = song.scale?.active ? SCALES[song.scale.mode] : null;
  if (pcs) {
    const ok = new Set(pcs.map((x) => (x + (song.scale.root || 0)) % 12));
    let out = 0, first = "";
    for (const { t, i } of playing) {
      if (t.isDrumKit || ENGINE_CHARACTER[t.engineKey]?.kind === "drum") continue;
      for (const p of t.patterns || []) {
        if (!p?.steps) continue;
        p.steps.forEach((on, s) => {
          if (!on) return;
          for (const n of [p.notes?.[s], ...(p.extraNotes?.[s] || [])]) {
            if (typeof n !== "number" || ok.has(((n % 12) + 12) % 12)) continue;
            out++;
            if (!first) first = `${midiToName(n)} on track ${i} (${t.name})`;
          }
        });
      }
    }
    if (out) notes.push(`${out} note${out === 1 ? " is" : "s are"} outside ${NAMES_SHARP[song.scale.root || 0]} ${song.scale.mode} (the first: ${first}). The studio snaps notes to the scale, so ${out === 1 ? "it" : "they"} will not sound as written: rewrite ${out === 1 ? "it" : "them"}, or set the scale the song is really in`);
  }
  return notes;
}

const patSig = (p) => (p?.steps?.some(Boolean) ? JSON.stringify([p.steps, p.notes, p.velocities, p.lengths, p.ratchets, p.extraNotes]) : "");

/** What a chained song needs to be an arrangement rather than a loop played N times. */
function arrangementNotes(song, playing) {
  const notes = [];
  if (song.patternMode !== "chain") return notes;
  const slots = [...new Set(songSections(song).map((s) => s.pattern))];
  if (slots.length < 2) return notes;
  const sigs = slots.map((p) => playing.map(({ t }) => patSig(t.patterns?.[p])).join("|"));
  if (new Set(sigs).size === 1) {
    notes.push(`patterns ${slots.join(", ")} are identical on every track: the song is one loop. Carve the sections apart (drop parts for an intro, strip the drums for a breakdown, add a part for the drop)`);
    return notes;
  }
  if (slots.length >= 3 && playing.length >= 3) {
    const sets = slots.map((p) => playing.filter(({ t }) => t.patterns?.[p]?.steps?.some(Boolean)).map(({ i }) => i).join(","));
    if (new Set(sets).size === 1) notes.push(`every section has the same ${playing.length} parts playing. An arrangement brings parts in and takes them out: an intro without the bass, a breakdown without the kick, the full set only at the peak`);
  }
  // A fill: some drum track's last bar differing from its first, in any section.
  const drums = playing.filter(({ t }) => ["kick", "snare", "hat", "cymbal", "perc"].includes(trackRole(t)));
  if (drums.length) {
    const fill = slots.some((p) => {
      const bar = stepsPerBar(song, p);
      return drums.some(({ t }) => {
        const pat = t.patterns?.[p];
        if (!pat?.steps?.some(Boolean) || pat.steps.length < bar * 2) return false;
        const at = pat.steps.length - bar;
        for (let s = 0; s < bar; s++) {
          if (!!pat.steps[s] !== !!pat.steps[at + s]) return true;
          if (pat.steps[s] && ((pat.ratchets?.[s] || 1) !== (pat.ratchets?.[at + s] || 1) || Math.abs((pat.velocities?.[s] ?? 0.5) - (pat.velocities?.[at + s] ?? 0.5)) > 0.2)) return true;
        }
        return false;
      });
    });
    if (!fill) notes.push("no section ends with a fill: every drum part repeats its first bar to the end. Make a section's drum patterns as long as the section (resize or x2), then change the last bar: a snare roll, a dropped kick, an open hat into the next section");
  }
  return notes;
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
