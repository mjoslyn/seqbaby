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

import { BASS_DEFAULTS, CONTAGION_DEFAULTS, GUITAR_DEFAULTS, HEXOP_DEFAULTS, SUB_DEFAULTS } from "./engineData.js";

/** The rack's stages, in chain order, and each one's controls at rest. */
export function defaultFxConfig() {
  return {
    // Rack input drive + output level. 0.5 = unity on both.
    amp:        { preamp: 0.5, level: 0.5 },
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
    delay:      { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb:     { decay: 2, wet: 0 },
  };
}

/** A track's params: the four track sliders, the osc mix, the osc mods, the
 *  ladder's osc bank, the silverbox panel, and every emulator panel's defaults
 *  spread over the top (each engine's own list, from engineData.js). One flat
 *  object -- which is why the panels use distinct key prefixes. */
export function defaultTrackParams() {
  return {
      vol: 0.8, harm: 0.5, timb: 0.5, morph: 0.5, decay: 0.4,
      osc1: 0.55, osc2: 0.45, osc3: 0.35, osc4: 0.4,
      ultra: 0.35, fm: 0, metal: 0,
      // Ladder osc-bank params
      osc1wave: "sawtooth", osc2wave: "sawtooth", osc3wave: "triangle",
      osc1range: 0, osc2range: 0, osc3range: -1,
      osc2freq: 0, osc3freq: 0,
      noise: 0, noisetype: "white",
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
  fat:     { label: "fat",     description: "warm 24dB/oct ladder — the passband thins as resonance climbs, same as any feedback ladder" },
  crisp:   { label: "crisp",   description: "clean, bright 24dB/oct ladder — loses less bass under resonance than the warmer ladders" },
  squelch: { label: "squelch", description: "an 18dB/oct diode ladder (silverbox's own filter) — squelchy and thin at high resonance, the acid sound" },
  edge:    { label: "edge",    description: "24dB/oct ladder close to fat, with a harder, brighter edge to the saturation" },
  poly:    { label: "poly",    description: "clean, chip-precise 24dB/oct ladder — the classic polysynth sound, least bass loss of the ladder family" },
  velvet:  { label: "velvet",  description: "smooth, gentle 12dB/oct state-variable filter — resonance doesn't cost bass the way a ladder's does" },
  scream:  { label: "scream",  description: "12dB/oct state-variable filter driven hard on the way in — aggressive and screamy as resonance climbs" },
  growl:   { label: "growl",   description: "24dB/oct state-variable filter (two cascaded stages) — gritty and aggressive" },
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
