export const { wosc, oscillatorTypes } = window.woscillators;

export const STEPS_PER_BAR = 16;

// Coarse mobile/touch detection — used to widen the transport lookahead and
// throttle meter painting where the main thread is more easily starved.
export const LFO_KEYS = [
  // Volume + instrument params first so they lead the picker.
  "vol",
  "harm", "timb", "morph", "decay",
  "osc1", "osc2", "osc3", "osc4", "ultra", "fm", "noise",
  // Filter
  "cutoff", "reson",
  // FX wets/amts (short keys preserved for backward compat).
  "fuzz", "delay", "verb",
  "vinyl", "cassette", "ringmod", "shaper", "crush", "autowah", "chorus", "phaser", "flanger", "pitch",
  // FX sub-params with AudioParam / Signal targets (audio-rate modable).
  "fuzz_drive", "fuzz_tone", "fuzz_level",
  "vinyl_warmth",
  "shaper_preamp",
  "ring_freq",
  "crush_bits",
  "chorus_rate", "chorus_depth",
  "phaser_rate",
  "flanger_rate", "flanger_fbk",
  "delay_time", "delay_fbk",
  // FX sub-params modulated via setter-driven LFO (no AudioParam target).
  "vinyl_wow",
  "cassette_flutter", "cassette_sat",
  "shaper_amt",
  "autowah_sens", "autowah_range",
  "phaser_depth",
  "pitch_semi",
  "reverb_decay",
  // Wavetable wave-scan window (setter-driven too — the scan config isn't an AudioParam).
  "wt_scan_start", "wt_scan_range",
  // Granular play-head speed + grain pitch (setter-driven; read per grain).
  "gran_speed", "gran_pitch",
  // TB-303 panel controls outside the four timbre sliders. Real AudioParams on
  // the worklet node, so these take the normal audio-rate path.
  "tb303_accent", "tb303_tune",
  // Access Virus panel controls outside the four sliders — AudioParams too.
  "virus_pw", "virus_fm", "virus_ring", "virus_unidet", "virus_cut2", "virus_bal", "virus_sat", "virus_envamt",
];
// How much each target swings per unit of depth:
//  - 0..1 unit params: amp = depth/2 (swings ±0.5)
//  - cutoff: depth*3000 Hz
//  - reson: depth*10 (Q units)
// Display labels for the mod picker — underscore keys show as "foo bar".
export const LFO_LABELS = {
  vol: "volume", cutoff: "filter cutoff", reson: "filter reson",
  fuzz: "fuzz amt", delay: "delay wet", verb: "reverb wet",
  vinyl: "vinyl amt", cassette: "cassette amt", ringmod: "ring mod wet",
  shaper: "wave folder wet", shaper_amt: "wave folder amt",
  crush: "bitcrush wet", autowah: "auto-wah wet", chorus: "chorus wet",
  phaser: "phaser wet", flanger: "flanger wet", pitch: "pitch shift wet",
  fuzz_drive: "fuzz drive", fuzz_tone: "fuzz tone", fuzz_level: "fuzz level",
  vinyl_warmth: "vinyl warmth", vinyl_wow: "vinyl wow",
  shaper_preamp: "wave shaper preamp",
  cassette_flutter: "cassette flutter", cassette_sat: "cassette sat",
  ring_freq: "ring mod freq",
  crush_bits: "bitcrush bits",
  autowah_sens: "auto-wah sens", autowah_range: "auto-wah range",
  chorus_rate: "chorus rate", chorus_depth: "chorus depth",
  phaser_rate: "phaser rate", phaser_depth: "phaser depth",
  flanger_rate: "flanger rate", flanger_fbk: "flanger fbk",
  pitch_semi: "pitch semi",
  wt_scan_start: "wave scan start", wt_scan_range: "wave scan range",
  gran_speed: "grain speed", gran_pitch: "grain pitch",
  tb303_accent: "303 accent", tb303_tune: "303 tune",
  virus_pw: "virus pulse width", virus_fm: "virus fm", virus_ring: "virus ring mod",
  virus_unidet: "virus unison detune", virus_cut2: "virus cutoff 2", virus_bal: "virus filter balance",
  virus_sat: "virus saturation", virus_envamt: "virus env amount",
  delay_time: "delay time", delay_fbk: "delay fbk",
  reverb_decay: "reverb decay",
};
export const lfoLabel = (k) => LFO_LABELS[k] ?? k;
export const LFO_AMP_SCALE = {
  vol: 1, harm: 1, timb: 1, morph: 1, decay: 1,
  cutoff: 6000,   // Hz
  reson: 15,
  fuzz: 1, delay: 1, verb: 1,
  vinyl: 1, cassette: 1, ringmod: 1, shaper: 1, crush: 1, autowah: 1, chorus: 1, phaser: 1, flanger: 1, pitch: 1,
  // fx sub-params (audio-rate AudioParam targets)
  fuzz_drive: 30,         // +/- 15 on the gain unit (drive path gain is 1+drive*30)
  fuzz_tone: 4000,        // Hz around tone filter cutoff (200..8000)
  fuzz_level: 1,
  vinyl_warmth: 5000,     // Hz around lowpass freq
  shaper_preamp: 6,       // swing on shaperPreamp.gain (unit gain ~0.25..8)
  ring_freq: 1500,        // Hz
  crush_bits: 8,           // bits swing (1..16)
  chorus_rate: 4,          // Hz
  phaser_rate: 3,          // Hz
  flanger_rate: 3,         // Hz
  flanger_fbk: 0.8,
  delay_time: 0.3,         // seconds
  delay_fbk: 0.8,
  // fx sub-params modulated via setter LFO (0..1 swing around the user's base value)
  vinyl_wow: 1, cassette_flutter: 1, cassette_sat: 1,
  shaper_amt: 1,
  autowah_sens: 1, autowah_range: 1,
  phaser_depth: 1,
  chorus_depth: 1,
  pitch_semi: 1,
  reverb_decay: 1,
  // 303 accent is a 0..1 knob; 303 tune is in semitones, so depth 1 is a
  // half-semitone vibrato either side of wherever the tune slider sits.
  tb303_accent: 1, tb303_tune: 1,
  // All 0..1 knobs except cut2 and envamt, which are bipolar over the same span.
  virus_pw: 1, virus_fm: 1, virus_ring: 1, virus_unidet: 1,
  virus_cut2: 2, virus_bal: 1, virus_sat: 1, virus_envamt: 2,
};

// Non-blocking prompt dialog (browser prompt() halts the transport scheduler)
export const PATTERN_COUNT = 32;
export const BAR_TICKS = 16;  // chain advance resolution

// Simple sine-blip metronome — accent the downbeat (step 0 of every bar).
export const RATE_MIN = 0.05, RATE_MAX = 20;
export function sliderToRate(v) { return RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, v); }
export function rateToSlider(hz) {
  return Math.log(Math.max(RATE_MIN, hz) / RATE_MIN) / Math.log(RATE_MAX / RATE_MIN);
}

// ---- note helpers ------------------------------------------------------

export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
