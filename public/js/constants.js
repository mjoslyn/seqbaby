// No DOM, no Tone, no woscillators: this module is importable from Node, which
// is what lets songBuilder.js and the tests under test/ read the target tables.
// (`wosc` used to be read off window here; it lives in voices.js now.)
import {
  BASS_MOD_KEYS, BASS_MOD_LABELS, BASS_MOD_RANGE,
  HEXOP_MOD_KEYS, HEXOP_MOD_LABELS, HEXOP_MOD_RANGE,
  GUITAR_MOD_KEYS, GUITAR_MOD_LABELS, GUITAR_MOD_RANGE,
  SUB_MOD_KEYS, SUB_MOD_LABELS, SUB_MOD_RANGE,
} from "./engineData.js";
import { CHANCE_MOD_KEYS, CHANCE_MOD_LABELS } from "./chanceGen.js";
import { staticEngineByKey } from "./engineData.js";
import { EUCLID_MOD_KEYS, EUCLID_MOD_LABELS } from "./soundDefaults.js";
import { shaperPreampGain } from "./curves.js";

export const STEPS_PER_BAR = 16;

/**
 * The rest of a namespaced key, after its prefix. The engine prefixes are
 * spelled once here rather than counted into a `slice(n)` at each call site:
 * the emulator rename grew `virus_`/`dx7_` into `contagion_`/`hexop_` and the
 * hand-counted offsets stayed behind, which silently unhooked every contagion
 * and hexop panel control from its AudioParam.
 * @param {string} key @param {string} prefix @returns {string}
 */
export function afterPrefix(key, prefix) { return key.slice(prefix.length); }

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
  "crush_bits", "crush_rate",
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
  // Granular grain controls (setter-driven; each grain reads them as it's scheduled).
  "gran_speed", "gran_pitch", "gran_window", "gran_jitter", "gran_detune", "gran_pan",
  // Euclid's three counts (setter-driven; the generator reads them at step
  // time). Only on a track with live euclid running — see canModulate.
  "euclid_pulses", "euclid_steps", "euclid_rotate",
  // The chance generator's six — the ones the machine puts under CV (chance.js).
  // Setter-driven too, and only while it is the thing making the part.
  ...CHANCE_MOD_KEYS.map(k => `chance_${k}`),
  // Silverbox panel controls outside the four timbre sliders. Real AudioParams on
  // the worklet node, so these take the normal audio-rate path.
  "silverbox_accent", "silverbox_tune",
  // Contagion panel controls outside the four sliders — AudioParams too.
  "contagion_pw", "contagion_fm", "contagion_ring", "contagion_unidet",
  "contagion_cut2", "contagion_bal", "contagion_sat", "contagion_envamt",
  "contagion_osc2semi", "contagion_osc2det", "contagion_unispread",
  "contagion_atk", "contagion_sus", "contagion_rel",
  // Hexop: the globals, then every control of all six operators. Generated from
  // the one list in hexop.js — 56 keys is too many to keep in step by hand, and
  // the picker only ever shows them on a hexop track (see canModulate).
  ...HEXOP_MOD_KEYS.map(k => `hexop_${k}`),
  // Electric guitar: the rig's own controls — where the string is picked, which
  // pickup reads it, and every knob on the amp. Generated from the one list in
  // guitar.js, and only offered on a guitar track (see canModulate).
  ...GUITAR_MOD_KEYS.map(k => `gtr_${k}`),
  // Electric bass: the right hand, the parallel dirt, and the amp. Guitar only
  // in spirit — see canModulate for the gate.
  ...BASS_MOD_KEYS.map(k => `bas_${k}`),
  // Sub bass: the oscillator, the drop, the harmonics path and the output
  // stage. Sub only — see canModulate.
  ...SUB_MOD_KEYS.map(k => `sub_${k}`),
];
// How much each target swings per unit of depth:
//  - 0..1 unit params: amp = depth/2 (swings ±0.5)
//  - cutoff: depth*3000 Hz
//  - reson: depth*10 (Q units)
// Display labels for the mod picker — underscore keys show as "foo bar".
export const LFO_LABELS = {
  euclid_pulses: "euclid pulses", euclid_steps: "euclid cycle", euclid_rotate: "euclid rotate",
  ...Object.fromEntries(CHANCE_MOD_KEYS.map(k => [`chance_${k}`, CHANCE_MOD_LABELS[k]])),
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
  crush_bits: "bitcrush bits", crush_rate: "bitcrush rate",
  autowah_sens: "auto-wah sens", autowah_range: "auto-wah range",
  chorus_rate: "chorus rate", chorus_depth: "chorus depth",
  phaser_rate: "phaser rate", phaser_depth: "phaser depth",
  flanger_rate: "flanger rate", flanger_fbk: "flanger fbk",
  pitch_semi: "pitch semi",
  wt_scan_start: "wave scan start", wt_scan_range: "wave scan range",
  gran_speed: "grain speed", gran_pitch: "grain pitch",
  gran_window: "grain window", gran_jitter: "grain jitter",
  gran_detune: "grain detune", gran_pan: "grain pan",
  silverbox_accent: "silverbox accent", silverbox_tune: "silverbox tune",
  contagion_pw: "contagion pulse width", contagion_fm: "contagion fm",
  contagion_ring: "contagion ring mod", contagion_unidet: "contagion unison detune",
  contagion_cut2: "contagion cutoff 2", contagion_bal: "contagion filter balance",
  contagion_sat: "contagion saturation", contagion_envamt: "contagion env amount",
  contagion_osc2semi: "contagion osc2 semi", contagion_osc2det: "contagion osc2 detune",
  contagion_unispread: "contagion unison spread",
  contagion_atk: "contagion attack", contagion_sus: "contagion sustain", contagion_rel: "contagion release",
  delay_time: "delay time", delay_fbk: "delay fbk",
  reverb_decay: "reverb decay",
  ...Object.fromEntries(HEXOP_MOD_KEYS.map(k => [`hexop_${k}`, HEXOP_MOD_LABELS[k]])),
  ...Object.fromEntries(GUITAR_MOD_KEYS.map(k => [`gtr_${k}`, GUITAR_MOD_LABELS[k]])),
  ...Object.fromEntries(BASS_MOD_KEYS.map(k => [`bas_${k}`, BASS_MOD_LABELS[k]])),
  ...Object.fromEntries(SUB_MOD_KEYS.map(k => [`sub_${k}`, SUB_MOD_LABELS[k]])),
};
export const lfoLabel = (k) => LFO_LABELS[k] ?? k;
export const LFO_AMP_SCALE = {
  vol: 1, harm: 1, timb: 1, morph: 1, decay: 1,
  // cutoff and ring_freq are exponential (see cutoffToHz / applyRingMod's log
  // map): a fixed Hz swing summed onto the native AudioParam covers a
  // different fraction of the knob depending on where the base sits, so
  // depth 100% can't be made to hit the slider's ceiling from an arbitrary
  // base this way — these two are a known exception to the "depth 100% is
  // peak-to-peak of the full range" rule below.
  cutoff: 6000,   // Hz
  reson: 19.5,             // Q 0.5..20 (resonToQ) — full span, so depth 1 swings the whole knob
  fuzz: 1, delay: 1, verb: 1,
  vinyl: 1, cassette: 1, ringmod: 1, shaper: 1, crush: 1, autowah: 1, chorus: 1, phaser: 1, flanger: 1, pitch: 1,
  // fx sub-params (audio-rate AudioParam targets). Each is the control's own
  // full native-unit span (see applyFuzz / applyChorus / etc. in fxRack.js),
  // so depth 1 is peak-to-peak of the whole knob — same convention as the
  // 0..1 controls below, just in the AudioParam's own units.
  fuzz_drive: 30,         // gain 1..31 (drive path gain is 1+drive*30)
  fuzz_tone: 7800,        // Hz 200..8000 around the tone filter cutoff
  fuzz_level: 0.9,        // gain 0..0.9
  // vinylLP.frequency is 18000 - amount*(18000-(9000-warmth*7200)) — the
  // warmth→Hz slope scales with the vinyl amount knob too, so 7200 (its
  // slope at amount 1, full wet) only reaches the true floor/ceiling there;
  // at a lower amount the same depth covers proportionally less.
  vinyl_warmth: 7200,     // Hz, at amount 1 (see above)
  shaper_preamp: 6,       // swing on shaperPreamp.gain (unit gain ~0.25..8; curved like cutoff, see above)
  ring_freq: 1500,        // Hz (curved like cutoff, see above)
  crush_bits: 15,          // bits 1..16, full span
  crush_rate: 1,           // converter clock, on its own 0..1 knob
  chorus_rate: 4.9,        // Hz 0.1..5, full span
  phaser_rate: 3.95,       // Hz 0.05..4, full span
  flanger_rate: 3.95,      // Hz 0.05..4, full span
  flanger_fbk: 0.9,        // gain 0..0.9, full span
  delay_time: 0.95,        // seconds 0.05..1, full span
  delay_fbk: 0.95,         // gain 0..0.95, full span
  // fx sub-params modulated via setter LFO (0..1 swing around the user's base value)
  vinyl_wow: 1, cassette_flutter: 1, cassette_sat: 1,
  shaper_amt: 1,
  autowah_sens: 1, autowah_range: 1,
  phaser_depth: 1,
  chorus_depth: 1,
  pitch_semi: 1,
  reverb_decay: 1,
  // silverbox accent is a 0..1 knob; silverbox tune is in semitones, so depth 1 is a
  // half-semitone vibrato either side of wherever the tune slider sits.
  silverbox_accent: 1, silverbox_tune: 1,
  // All 0..1 knobs except cut2 and envamt, which are bipolar over the same span.
  contagion_pw: 1, contagion_fm: 1, contagion_ring: 1, contagion_unidet: 1,
  contagion_cut2: 2, contagion_bal: 1, contagion_sat: 1, contagion_envamt: 2,
  // osc2 semi is in semitones over ±24, so depth 1 swings an octave either way.
  contagion_osc2semi: 24,
  contagion_osc2det: 1, contagion_unispread: 1, contagion_atk: 1, contagion_sus: 1, contagion_rel: 1,
  // Granular grain controls — 0..1 swing around wherever the slider sits.
  gran_window: 1, gran_jitter: 1, gran_detune: 1, gran_pan: 1,
  // Hexop: each key swings its own control's full span, so an operator's ratio
  // (0..31) sweeps ratios and its level (0..1) sweeps level.
  ...Object.fromEntries(HEXOP_MOD_KEYS.map(k => {
    const [lo, hi] = HEXOP_MOD_RANGE[k];
    return [`hexop_${k}`, hi - lo];
  })),
  // Guitar: same again — the pick and pickup positions live in 0.02..0.5, every
  // amp control in 0..1, and each swings its own span.
  ...Object.fromEntries(GUITAR_MOD_KEYS.map(k => {
    const [lo, hi] = GUITAR_MOD_RANGE[k];
    return [`gtr_${k}`, hi - lo];
  })),
  ...Object.fromEntries(BASS_MOD_KEYS.map(k => {
    const [lo, hi] = BASS_MOD_RANGE[k];
    return [`bas_${k}`, hi - lo];
  })),
  ...Object.fromEntries(SUB_MOD_KEYS.map(k => {
    const [lo, hi] = SUB_MOD_RANGE[k];
    return [`sub_${k}`, hi - lo];
  })),
};

// ---- the three LFO targets whose knob is exponential, not linear ---------
//
// cutoff, ring_freq and shaper_preamp modulate a real AudioParam via
// cutoffToHz-style curves (signal.js / fxRack.js), so a fixed Hz/gain swing
// summed onto the native param covers a different fraction of the knob
// depending on where the base sits — see LFO_AMP_SCALE's comment on cutoff.
// These three are driven through the setter-LFO path instead (lfo.js): each
// frame, the target knob position is computed the same way every other
// setter key's is (base + depth-scaled shape), then converted through its
// own curve, and only the DIFFERENCE from the curve at the current base is
// summed onto the real AudioParam — so depth 100% reaches the knob's true
// ceiling/floor from wherever the base happens to sit, same as a linear
// control, traded for frame-rate (not audio-rate) resolution.
//
// Duplicated here rather than imported from signal.js / fxRack.js: this
// module has to stay importable from Node, and those two reach into Tone
// and the DOM at load time.
export const CURVED_LFO_KEYS = new Set(["cutoff", "ring_freq", "shaper_preamp"]);
export const CURVED_LFO_CURVES = {
  cutoff: {                // cutoffToHz (signal.js): 60..20000 Hz, log
    to: (u) => 60 * Math.pow(20000 / 60, u),
    from: (hz) => Math.log(Math.max(1e-6, hz) / 60) / Math.log(20000 / 60),
  },
  ring_freq: {              // applyRingMod (fxRack.js): 20..3000 Hz, log
    to: (u) => 20 * Math.pow(150, u),
    from: (hz) => Math.log(Math.max(1e-6, hz) / 20) / Math.log(150),
  },
  shaper_preamp: {          // shaperPreampGain (curves.js): ~0.25..8x gain
    to: shaperPreampGain,
    from: (g) => (g <= 1 ? (g - 0.25) / 1.5 : 0.5 + Math.log(Math.max(1e-6, g)) / Math.log(8) / 2),
  },
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

// ---- how long a synced lfo's cycle is ------------------------------------
//
// `cfg.div` is the cycle in BEATS (what rateFromSync divides the beat rate by),
// and these are the values the length knob offers. Ordered shortest first, so a
// rightward turn lengthens the cycle.
//
// Named directly in BEATS, which is the unit `div` already is — the label says
// what the knob is turning rather than a sixteenth-note count the reader has to
// convert back. (For the euclid shape the rate is the RING STEP rate rather than
// the cycle — see lfo.js — so "2 beats" there means each tap lasts two beats.)
//
// The knob is an index into this list rather than a continuous control: a cycle
// length is a menu of musical values, and quantising the drag to the list is
// what keeps it playable.
export const LFO_DIVS = [
  { div: 0.125, label: "1/8 beat" },
  { div: 0.25,  label: "1/4 beat" },
  { div: 0.5,   label: "1/2 beat" },
  { div: 1,     label: "1 beat" },
  { div: 2,     label: "2 beats" },
  { div: 4,     label: "4 beats" },
  { div: 8,     label: "8 beats" },
  { div: 16,    label: "16 beats" },
  { div: 32,    label: "32 beats" },
  { div: 64,    label: "64 beats" },
];

/** Nearest entry for a div in beats — a saved song (or an older one) can hold a
 *  value the list doesn't, and the knob has to land somewhere. Nearest in
 *  RATIO, not difference: these are musical divisions, so 3 belongs with 2, not
 *  with 4. */
export function lfoDivIndex(div) {
  const d = Number(div) > 0 ? Number(div) : 1;
  let best = 0, bestErr = Infinity;
  for (let i = 0; i < LFO_DIVS.length; i++) {
    const err = Math.abs(Math.log(LFO_DIVS[i].div / d));
    if (err < bestErr) { bestErr = err; best = i; }
  }
  return best;
}

/**
 * The name of a div in beats, for the readout beside the knob.
 *
 * A song saved before the list existed (or hand-edited) can hold a division
 * that isn't on it — and it goes on running at exactly that rate, because
 * nothing snaps a loaded value. So the readout says what it really is rather
 * than the nearest entry's name: the knob has to round, the label doesn't, and
 * a row reading "16 beats · 0.61 hz" when it is neither would be worse than
 * either. Touching the knob lands on the list and the two agree again.
 */
export function lfoDivLabel(div) {
  const near = LFO_DIVS[lfoDivIndex(div)];
  const d = Number(div) > 0 ? Number(div) : 1;
  if (Math.abs(near.div - d) < 1e-9) return near.label;
  return `${Number.isInteger(d) ? d : +d.toFixed(3)} beat${d === 1 ? "" : "s"}`;
}

// ---- note helpers ------------------------------------------------------

export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// Each stage's wet/amount control, in chain order: the one number that says
// whether the stage is doing anything. The rack wires a stage into the serial
// chain on it (fxRack.js, the chain rewiring), and the fx button on the track
// lights up on it (`refreshPanelBadges`, paramTargets.js) — one table, so the
// two can't disagree about what counts as "on".
export const FX_STAGE_LEVEL_KEY = {
  vinyl: "amount", cassette: "amount", fuzz: "amount",
  ringmod: "wet", shaper: "wet", crush: "wet", autowah: "wet", chorus: "wet",
  phaser: "wet", flanger: "wet", pitchshift: "wet", delay: "wet", reverb: "wet",
};
export const FX_STAGE_LABELS = {
  vinyl: "vinyl", cassette: "cassette", fuzz: "fuzz", ringmod: "ring mod",
  shaper: "shaper", crush: "crush", autowah: "auto-wah", chorus: "chorus",
  phaser: "phaser", flanger: "flanger", pitchshift: "pitch shift", delay: "delay",
  reverb: "reverb",
};
/** A stage's engagement level (0 = bypassed) read off a plain fx config. */
export function fxStageLevel(config, key) {
  const k = FX_STAGE_LEVEL_KEY[key];
  return k ? (config?.[key]?.[k] ?? 0) : 0;
}

// ---- automation targets -----------------------------------------------------
// The per-step lanes' namespace (automation.js applies them; the macro pads
// speak it too). Here rather than in automation.js because that module reaches
// for the live graph at import time, and this table is what songBuilder.js
// validates a lane against.
export const AUTOMATION_TARGETS = {
  // volume first
  "vol":           { label: "volume" },
  // voice / instrument params (per-engine availability via canAutomate)
  "harm":          { label: "harm" },
  "timb":          { label: "timbre" },
  "morph":         { label: "morph" },
  "decay":         { label: "decay" },
  "osc1":          { label: "osc 1" },
  "osc2":          { label: "osc 2" },
  "osc3":          { label: "osc 3" },
  "osc4":          { label: "osc 4" },
  "ultra":         { label: "ultra" },
  "fm":            { label: "fm" },
  "metal":         { label: "metal" },
  "noise":         { label: "noise" },
  // filter
  "cutoff":        { label: "filter cutoff" },
  "reson":         { label: "filter reson" },
  // fx wets / amounts
  // wavetable wave-scan window (wavetable engine only — see canAutomate)
  "wt.scan.start":      { label: "wave scan start" },
  "wt.scan.range":      { label: "wave scan range" },
  // euclid's three counts (only while live euclid is generating — see canAutomate)
  ...Object.fromEntries(EUCLID_MOD_KEYS.map(k => [`euclid.${k}`, { label: EUCLID_MOD_LABELS[k] }])),
  // the chance generator's six (only while the dice are generating — same gate)
  ...Object.fromEntries(CHANCE_MOD_KEYS.map(k => [`chance.${k}`, { label: CHANCE_MOD_LABELS[k] }])),
  // granular grain controls (granular engine only)
  "gran.speed":         { label: "grain speed" },
  "gran.pitch":         { label: "grain pitch" },
  "gran.window":        { label: "grain window" },
  "gran.jitter":        { label: "grain jitter" },
  "gran.detune":        { label: "grain detune" },
  "gran.pan":           { label: "grain pan" },
  // Silverbox panel controls outside the four sliders (silverbox engine only)
  "silverbox.accent":   { label: "silverbox accent" },
  "silverbox.tune":     { label: "silverbox tune" },
  "silverbox.wave":     { label: "silverbox wave" },
  // Contagion panel controls (contagion engine only)
  "contagion.pw":       { label: "contagion pulse width" },
  "contagion.fm":       { label: "contagion fm" },
  "contagion.ring":     { label: "contagion ring mod" },
  "contagion.unidet":   { label: "contagion unison detune" },
  "contagion.cut2":     { label: "contagion cutoff 2" },
  "contagion.bal":      { label: "contagion filter balance" },
  "contagion.sat":      { label: "contagion saturation" },
  "contagion.envamt":   { label: "contagion env amount" },
  "contagion.osc2semi": { label: "contagion osc2 semi" },
  "contagion.osc2det":  { label: "contagion osc2 detune" },
  "contagion.unispread": { label: "contagion unison spread" },
  "contagion.atk":      { label: "contagion attack" },
  "contagion.sus":      { label: "contagion sustain" },
  "contagion.rel":      { label: "contagion release" },
  // Hexop panel controls (hexop engine only) — globals, then all six operators.
  // Generated from the same list the LFO keys come from (hexop.js).
  ...Object.fromEntries(HEXOP_MOD_KEYS.map(k => [`hexop.${k}`, { label: HEXOP_MOD_LABELS[k] }])),
  // Electric guitar rig (guitar engine only) — string, pickup, amp, cab.
  ...Object.fromEntries(GUITAR_MOD_KEYS.map(k => [`gtr.${k}`, { label: GUITAR_MOD_LABELS[k] }])),
  // Electric bass rig (bass engine only).
  ...Object.fromEntries(BASS_MOD_KEYS.map(k => [`bas.${k}`, { label: BASS_MOD_LABELS[k] }])),
  // Subby (sub engine only) — oscillator, drop, harmonics, output.
  ...Object.fromEntries(SUB_MOD_KEYS.map(k => [`sub.${k}`, { label: SUB_MOD_LABELS[k] }])),
  // fx
  "fx.vinyl":           { label: "vinyl amt" },
  "fx.vinyl.warmth":    { label: "vinyl warmth" },
  "fx.vinyl.wow":       { label: "vinyl wow" },
  "fx.cassette":        { label: "cassette amt" },
  "fx.cassette.flutter":{ label: "cassette flutter" },
  "fx.cassette.sat":    { label: "cassette sat" },
  "fx.fuzz":            { label: "fuzz amt" },
  "fx.fuzz.drive":      { label: "fuzz drive" },
  "fx.fuzz.tone":       { label: "fuzz tone" },
  "fx.fuzz.level":      { label: "fuzz level" },
  "fx.ringmod":         { label: "ring mod wet" },
  "fx.ringmod.freq":    { label: "ring mod freq" },
  "fx.shaper":          { label: "wave shaper wet" },
  "fx.shaper.preamp":   { label: "wave shaper preamp" },
  "fx.shaper.amt":      { label: "wave shaper amt" },
  "fx.crush":           { label: "bitcrush wet" },
  "fx.crush.bits":      { label: "bitcrush bits" },
  "fx.crush.rate":      { label: "bitcrush rate" },
  "fx.autowah":         { label: "auto-wah wet" },
  "fx.autowah.sens":    { label: "auto-wah sens" },
  "fx.autowah.range":   { label: "auto-wah range" },
  "fx.chorus":          { label: "chorus wet" },
  "fx.chorus.rate":     { label: "chorus rate" },
  "fx.chorus.depth":    { label: "chorus depth" },
  "fx.phaser":          { label: "phaser wet" },
  "fx.phaser.rate":     { label: "phaser rate" },
  "fx.phaser.depth":    { label: "phaser depth" },
  "fx.flanger":         { label: "flanger wet" },
  "fx.flanger.rate":    { label: "flanger rate" },
  "fx.flanger.fbk":     { label: "flanger fbk" },
  "fx.pitchshift":      { label: "pitch shift wet" },
  "fx.pitchshift.semi": { label: "pitch semi" },
  "fx.delay":           { label: "delay wet" },
  "fx.delay.time":      { label: "delay time" },
  "fx.delay.fbk":       { label: "delay fbk" },
  "fx.reverb":          { label: "reverb wet" },
  "fx.reverb.decay":    { label: "reverb decay" },
};
export const AUTOMATION_KEYS = Object.keys(AUTOMATION_TARGETS);

export const VOICE_AUTO_KEYS = ["vol","harm","timb","morph","decay","osc1","osc2","osc3","osc4","ultra","fm","metal","noise"];

// ---- the gates, over an engine key ------------------------------------------
// canModulate / canAutomate / voiceAutoKeysForEngine (lfo.js, automation.js)
// take a track and hand its engine key and generator flags to these, so the
// same answer is available without a track -- which a song being written
// outside the browser does not have. `live` is { euclid, chance }: whether each
// generator is the thing making the part, which is what gates its keys.

export const TRACK_FX_LFO_KEYS = new Set([
  "fuzz","delay","verb","vinyl","cassette","ringmod","shaper","crush","autowah","chorus","phaser","flanger","pitch",
  "fuzz_drive","fuzz_tone","fuzz_level","vinyl_warmth","shaper_preamp","ring_freq","crush_bits","crush_rate",
  "chorus_rate","chorus_depth","phaser_rate","flanger_rate","flanger_fbk","delay_time","delay_fbk",
  // setter-driven (non-AudioParam) FX params
  "vinyl_wow","cassette_flutter","cassette_sat",
  "shaper_amt",
  "autowah_sens","autowah_range",
  "phaser_depth","pitch_semi","reverb_decay",
]);

// Engine-aware list of voice/instrument keys that can be automated. Broader
// than canModulate because automation can drive params via setParam even when
// there is no AudioParam behind them.
export function voiceAutoKeysForEngineKey(engineKey) {
  const t = { engineKey: String(engineKey || "") };
  const eng = staticEngineByKey(t.engineKey);
  if (!eng) return ["vol"];
  if (eng.type === "plaits") return ["vol", "harm", "timb", "morph", "decay"];
  switch (t.engineKey) {
    case "dm:silverbox":        return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:snarl": return ["vol", "harm", "timb", "osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal"];
    case "dm:ladder":       return ["vol", "harm", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:drift":       return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:guitar":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:bass":       return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:sub":       return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:tines":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:oracle":   return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"];
    case "dm:granular":   return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:contagion":      return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"];
    case "dm:hexop":        return ["vol", "harm", "timb", "morph", "decay"];
    case "wt:akwf":       return ["vol", "harm", "timb", "morph", "decay"];
  }
  // 808 / 909 voices: tune / tone / colour / decay all take effect on the next
  // hit, so per-step automation drives them even with no AudioParam to ramp.
  if (t.engineKey.startsWith("dm:808-") || t.engineKey.startsWith("dm:909-")) {
    const noColour = ["dm:808-chat", "dm:808-ohat", "dm:808-cowbell", "dm:909-chat", "dm:909-ohat"];
    return noColour.includes(t.engineKey)
      ? ["vol", "harm", "timb", "decay"]
      : ["vol", "harm", "timb", "morph", "decay"];
  }
  return ["vol"];
}

export function canAutomateKey(engineKey, key, live = {}) {
  const t = { engineKey: String(engineKey || "") };
  if (key === "cutoff" || key === "reson") return true;
  if (key.startsWith("wt.scan.")) return t.engineKey === "wt:akwf";
  if (key.startsWith("euclid.")) return !!live.euclid;
  if (key.startsWith("chance.")) return !!live.chance;
  if (key.startsWith("gran.")) return t.engineKey === "dm:granular";
  if (key.startsWith("silverbox.")) return t.engineKey === "dm:silverbox";
  if (key.startsWith("contagion.")) return t.engineKey === "dm:contagion";
  if (key.startsWith("hexop.")) return t.engineKey === "dm:hexop";
  if (key.startsWith("gtr.")) return t.engineKey === "dm:guitar";
  if (key.startsWith("bas.")) return t.engineKey === "dm:bass";
  if (key.startsWith("sub.")) return t.engineKey === "dm:sub";
  if (key.startsWith("fx.")) return true;
  if (VOICE_AUTO_KEYS.includes(key)) return voiceAutoKeysForEngineKey(t.engineKey).includes(key);
  return false;
}

export function canModulateKey(engineKey, key, live = {}) {
  const t = { engineKey: String(engineKey || "") };
  // Always-applicable: track-level fx + master vol + filter.
  if (key === "vol" || key === "cutoff" || key === "reson") return true;
  if (TRACK_FX_LFO_KEYS.has(key)) return true;
  // Wave-scan window — wavetable engine only.
  if (key === "wt_scan_start" || key === "wt_scan_range") return t.engineKey === "wt:akwf";
  // Euclid's counts — any engine, but only while the generator is the thing
  // making the rhythm. Modulating them with the pattern in charge would say
  // nothing at all.
  if (key.startsWith("euclid_")) return !!live.euclid;
  // The chance generator's six — likewise any engine, but only while the dice
  // are the thing making the part (chance.js).
  if (key.startsWith("chance_")) return !!live.chance;
  // Grain controls — granular engine only.
  if (key.startsWith("gran_")) return t.engineKey === "dm:granular";
  // Accent depth + tuning — silverbox only.
  if (key === "silverbox_accent" || key === "silverbox_tune") return t.engineKey === "dm:silverbox";
  // Contagion oscillator / filter-pair controls — contagion only.
  if (key.startsWith("contagion_")) return t.engineKey === "dm:contagion";
  // Hexop operator matrix + globals — hexop only.
  if (key.startsWith("hexop_")) return t.engineKey === "dm:hexop";
  // The guitar rig's string / pickup / amp / cab controls — guitar only.
  if (key.startsWith("gtr_")) return t.engineKey === "dm:guitar";
  // The bass rig's right hand, dirt and amp — bass only.
  if (key.startsWith("bas_")) return t.engineKey === "dm:bass";
  // Subby's oscillator, drop, harmonics and output stage — subby only.
  if (key.startsWith("sub_")) return t.engineKey === "dm:sub";
  const eng = staticEngineByKey(t.engineKey);
  if (!eng) return false;
  // Plaits exposes harm/timb/morph/decay as voice params.
  if (eng.type === "plaits") return ["harm", "timb", "morph", "decay"].includes(key);
  // Emulator builders expose specific AudioParams via getAudioParam — only list
  // the keys that are actually wired (see each builder above).
  switch (t.engineKey) {
    // The silverbox's four panel knobs are AudioParams on its worklet node.
    case "dm:silverbox":        return ["harm", "timb", "morph", "decay"].includes(key);
    // Real polyphony inside the worklet, so unlike the pooled emulators the
    // whole instrument follows the LFO, not just voice 0.
    case "dm:contagion":      return ["harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"].includes(key);
    // Same: one node, one set of params, so the LFO moves the whole instrument.
    // The oscillator-mix sliders aren't wired — a hexop's six operators have their
    // own levels in the panel, which are reachable under their own keys.
    case "dm:hexop":        return ["harm", "timb", "morph", "decay"].includes(key);
    // Six strings and one amp in one worklet node, so the same holds here: drive
    // and tone are AudioParams the whole instrument follows.
    case "dm:guitar":     return ["harm", "timb", "morph", "decay"].includes(key);
    case "dm:bass":       return ["harm", "timb", "morph", "decay"].includes(key);
    // One node, one voice, so the LFO moves the whole instrument. Putting one
    // on DRIVE is a wobble, because drive is what makes the note audible.
    case "dm:sub":   return ["harm", "timb", "morph", "decay"].includes(key);
    case "dm:snarl": return ["harm", "osc1", "osc2", "osc3", "osc4", "ultra", "fm"].includes(key);
    case "dm:ladder":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:drift":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:oracle":   return ["harm", "osc1", "osc2", "osc3", "osc4", "noise"].includes(key);
    // Tines has no per-voice AudioParam targets beyond vol+track fx; its
    // timbre params are still automatable via setParam (see canAutomate).
  }
  return false;
}
