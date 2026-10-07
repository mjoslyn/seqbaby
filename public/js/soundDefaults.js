// A track's sound at rest: the parameters, the filter, the eq, the compressor
// and the fx rack as they are before anyone touches them, plus the euclid
// generator's. No imports but engineData.js (which has none), on purpose --
// this is the half of the track chain a Node process can read, and it is what
// lets songBuilder.js (and the MCP server on top of it) know what a field means
// when a song leaves it out. applySet fills absent fields from these same
// functions, via createTrack, so a sparse song and a full one load the same.
//
// The engine modules that owned these (fxRack.js, signal.js, track.js,
// euclid.js) import and re-export them, so nothing else in the engine changed.

import { BASS_DEFAULTS, CONTAGION_DEFAULTS, DRONE_DEFAULTS, GUITAR_DEFAULTS, HEXOP_DEFAULTS, LADDER_DEFAULTS, LANCET_DEFAULTS, SIEGE_DEFAULTS, SUB_DEFAULTS, VOX_DEFAULTS } from "./engineData.js";

/** The rack's stages, in chain order, and each one's controls at rest. */
export function defaultFxConfig() {
  return {
    // Rack input drive + output level. 0.5 = unity on both.
    amp:        { preamp: 0.5, level: 0.5 },
    // A clean gain, placeable anywhere in the chain: 0.5 is unity, below fades
    // down, above drives what comes after it, to +18dB. What amp's drive was
    // when it sat in front of every stage (see migrateAmpDrive).
    gain:       { drive: 0.5 },
    // Stereo position: 0 hard left, 0.5 centre, 1 hard right.
    pan:        { pos: 0.5 },
    vinyl:      { amount: 0, warmth: 0.4, wow: 0.3 },
    cassette:   { amount: 0, flutter: 0.3, sat: 0.4 },
    fuzz:       { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
    ringmod:    { wet: 0, freq: 0.35 },           // freq is 0..1, log-mapped to ~20..3000 Hz
    shaper:     { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" },  // wave shaper: wet/dry + input preamp + curve drive + mode
    crush:      { bits: 8, rate: 1, wet: 0 },   // rate is the converter clock, 0..1 log-mapped to 250Hz..48kHz; 1 = no decimation
    autowah:    { wet: 0, sens: 0.5, range: 0.5 },
    chorus:     { wet: 0, rate: 0.5, depth: 0.5 },
    phaser:     { wet: 0, rate: 0.3, depth: 0.5 },
    flanger:    { wet: 0, rate: 0.3, fbk: 0.5 },
    pitchshift: { wet: 0, semitones: 0 },
    // Beat repeat / slicer (repeat.js), clocked by the transport. The discrete
    // knobs (interval, offset, gate, grid) are 0..1 positions on the lists
    // below, so an LFO or a lane can sweep them; `wet` is the mix and the
    // switch. At rest: on the last beat of every bar, half the time, repeat a
    // sixteenth for a beat.
    repeat:     { wet: 0, mode: "repeat", chance: 0.5, interval: 0.5, offset: 0.75,
                  gate: 0.33, grid: 0.33, vary: 0, pitch: 0.5, decay: 0, pitchV: 2 },
    // A four-module console in one stage (prism.js): character, movement,
    // diffusion, texture, each a choice of five and an amount, then a tilt eq.
    // `wet` is the mix around the whole of it, and what switches it on.
    prism:      { wet: 0, char: 0.25, charmode: "drive", move: 0.3, movemode: "doubler",
                  diff: 0.35, diffmode: "space", tex: 0.25, texmode: "cassette",
                  tilt: 0.5, rate: 0.35, time: 0.4, sens: 0.5, drift: 0.2 },
    delay:      { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb:     { decay: 2, wet: 0 },
  };
}

/** The repeat stage's two characters, in the order the processor indexes them:
 *  `repeat` captures a slice where it triggers and repeats it, `slice` swaps
 *  the playing slice for one from the window before. */
export const REPEAT_MODES = ["repeat", "slice"];
/** Its knobs, every one 0..1 and an AudioParam: `fx-repeat-<k>` the control,
 *  `repeat_<k>` the LFO, `fx.repeat.<k>` the lane. */
export const REPEAT_KNOBS = ["chance", "interval", "offset", "gate", "grid", "vary", "pitch", "decay"];
export const REPEAT_KNOB_LABELS = {
  chance: "repeat chance", interval: "repeat interval", offset: "repeat offset", gate: "repeat gate",
  grid: "repeat grid", vary: "repeat vary", pitch: "repeat pitch", decay: "repeat decay",
};
/** What the discrete knobs pick from, in sixteenth-note steps. A knob at v
 *  picks entry round(v * (length - 1)). */
export const REPEAT_GRID = [0.25, 0.5, 2 / 3, 1, 4 / 3, 2, 8 / 3, 4, 8, 16];
export const REPEAT_GRID_LABELS = ["1/64", "1/32", "1/16t", "1/16", "1/8t", "1/8", "1/4t", "1/4", "1/2", "1 bar"];
export const REPEAT_INTERVAL = [4, 8, 16, 32, 64];
export const REPEAT_GATE = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** The prism's four modules (prism.js): each one's characters, in the order
 *  the processor indexes them. */
export const PRISM_MODES = {
  charmode: ["drive", "sweeten", "fuzz", "howl", "swell"],
  movemode: ["doubler", "vibrato", "phaser", "tremolo", "pitch"],
  diffmode: ["cascade", "reels", "space", "collage", "reverse"],
  texmode:  ["filter", "squash", "cassette", "broken", "interference"],
};
/** Its knobs, every one 0..1 and an AudioParam: one list, three namespaces —
 *  `fx-prism-<k>` the control, `prism_<k>` the LFO, `fx.prism.<k>` the lane. */
export const PRISM_KNOBS = ["char", "move", "diff", "tex", "tilt", "rate", "time", "sens", "drift"];
export const PRISM_KNOB_LABELS = {
  char: "prism character", move: "prism movement", diff: "prism diffusion", tex: "prism texture",
  tilt: "prism tilt", rate: "prism rate", time: "prism time", sens: "prism sens", drift: "prism drift",
};

/** A track's params: the four track sliders, the osc mix, the osc mods, the
 *  ladder's osc bank, the silverbox panel, and every emulator panel's defaults
 *  spread over the top (each engine's own list, from engineData.js). One flat
 *  object -- which is why the panels use distinct key prefixes. */
export function defaultTrackParams() {
  return {
      vol: 0.8, harm: 0.5, timb: 0.5, morph: 0.5, decay: 0.4,
      osc1: 0.55, osc2: 0.45, osc3: 0.35, osc4: 0.4,
      ultra: 0.35, fm: 0, metal: 0,
      // Ladder osc-bank params (the machine's waves and ranges, ladder.js)
      osc1wave: "sawtooth", osc2wave: "sawtooth", osc3wave: "triangle",
      osc1range: 0, osc2range: 0, osc3range: -1,
      osc2freq: 0, osc3freq: 0,
      noise: 0, noisetype: "white",
      // The rest of the ladder's panel, and `ldrv`: the ladder's format
      // marker. A sound without it was written when the four sliders meant
      // detune / warmth, and migrateLadderFilter (sessionFormat.js) rewrites
      // it on the way in. gspeedV's trick, for the same reason.
      ...LADDER_DEFAULTS, ldrv: 2,
      // Silverbox panel controls that don't fit the four timbre sliders
      sbwave: "saw", sbaccent: 0.6, sbtune: 0,
      // Contagion panel (see contagion.js)
      ...CONTAGION_DEFAULTS,
      // Hexop operator matrix + globals (see hexop.js)
      ...HEXOP_DEFAULTS,
      // Electric guitar: string, pickup, amp, cab (see guitar.js)
      ...GUITAR_DEFAULTS,
      // Electric bass: the same chain again, wound differently (see bass.js)
      ...BASS_DEFAULTS,
      // Sub bass: the oscillator, the drop, and the harmonics that make a
      // 40Hz note audible on something small (see subbass.js)
      ...SUB_DEFAULTS,
      // Drone: the equation oscillator, its filter, LFO, delay and cloud
      // (see drone.js)
      ...DRONE_DEFAULTS,
      // Vox: the glottis, the choir, the consonants and the words (see vox.js)
      ...VOX_DEFAULTS,
      // Lancet: the model, the tune, the velocity amount, the randomizer (see lancet.js)
      ...LANCET_DEFAULTS,
      // Siege: the bass drum synth's tune, floor and four buttons (see siege.js)
      ...SIEGE_DEFAULTS,
  };
}

// The filter's plain shapes: native BiquadFilterNode types, unchanged in
// character since the control first grew beyond a fixed lowpass.
export const GENERIC_FILTER_TYPES = ["lowpass", "highpass", "bandpass", "notch"];

// The filter's eight circuit-modeled characters (filterModels.js — an
// AudioWorklet, not a biquad). Two families: a feedback-saturated ladder
// (fat/crisp/squelch/edge/poly), whose resonance costs passband level the
// way a real ladder's does, and a state-variable filter (velvet/scream/
// growl), which doesn't lose bass under resonance the way a ladder does —
// that split is real circuit behavior, not a naming choice. `squelch` reuses
// silverbox's own diode ladder. See filterModels.js for what differs between
// them (pole count, saturation curve, how much of the resonant bass loss is
// compensated) — these are reasoned stylistic differences, not measurements
// against real hardware.
export const ANALOG_FILTER_TYPES = ["fat", "crisp", "squelch", "edge", "poly", "velvet", "scream", "growl"];

export const ANALOG_FILTER_INFO = {
  fat:     { label: "fat",     description: "warm 24dB/oct ladder that thins in the passband as resonance climbs" },
  crisp:   { label: "crisp",   description: "clean, bright 24dB/oct ladder with less bass loss under resonance" },
  squelch: { label: "squelch", description: "an 18dB/oct diode ladder (silverbox's own filter), the acid sound" },
  edge:    { label: "edge",    description: "24dB/oct ladder close to fat, with a harder, brighter saturation" },
  poly:    { label: "poly",    description: "clean, chip-precise 24dB/oct ladder, the classic polysynth sound" },
  velvet:  { label: "velvet",  description: "smooth, gentle 12dB/oct state-variable filter that costs no bass to resonance" },
  scream:  { label: "scream",  description: "12dB/oct state-variable filter driven hard on the way in" },
  growl:   { label: "growl",   description: "24dB/oct state-variable filter, gritty and aggressive" },
};

// The filter's shapes: the plain biquad shapes plus the eight modeled
// characters. A song written before `type` existed has none, and
// `createTrack` fills it from this default, so it plays exactly as it did —
// lowpass only.
export const FILTER_TYPES = [...GENERIC_FILTER_TYPES, ...ANALOG_FILTER_TYPES];

export function defaultFilter() {
  return { type: "lowpass", cutoff: 1, reson: 0, env: 0, attack: 0, decay: 0.25, sustain: 0.4, release: 0.3 };
}

export function defaultEq() { return { low: 0, lomid: 0, mid: 0, himid: 0, high: 0 }; }

export function defaultCompConfig() {
  return { enabled: false, source: "self", threshold: -20, ratio: 4, attack: 0.01, release: 0.2, knee: 6 };
}

/** @type {EuclidConfig} */
export const EUCLID_DEFAULTS = { on: false, pulses: 4, steps: 16, rotate: 0, gate: "short", accent: true };

/** The three modulatable controls, in every namespace they answer to. */
export const EUCLID_MOD_KEYS = ["pulses", "steps", "rotate"];
export const EUCLID_MOD_LABELS = {
  pulses: "euclid pulses", steps: "euclid cycle", rotate: "euclid rotate",
};
