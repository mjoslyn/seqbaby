// The engines as DATA: which ones exist, what their controls are, what the
// four track sliders mean on each, and the famous tones. No imports, on
// purpose, and nothing here touches the DOM, Tone or a worklet -- this is the
// half of the engine modules that a Node process can read.
//
// It exists so that a song can be written WITHOUT a browser: songBuilder.js
// (and the MCP server in mcp/ on top of it) validates engine keys, panel
// parameters and presets against these tables, and the tests under test/ pin
// them. The engine modules themselves import their own tables from here and
// re-export them, so every existing `import { GUITAR_DEFAULTS } from
// "./guitar.js"` still works and the "one list, three namespaces" story in each
// of them is unchanged -- the list just lives one file over.
//
// Where a table lives is the only thing that moved. The comments on each block
// are the engine module's own.

// ---- plaits ---------------------------------------------------------------
// The sixteen Plaits models, in woscillators' order (its own list is
// `window.woscillators.oscillatorTypes`, which is the same sixteen, capitalised;
// catalog.js used to read it from there). The index is the engine key:
// `plaits:0` is virtual analog, `plaits:13` the bass drum.
export const PLAITS_MODELS = [
  "virtual analog", "waveshaping", "fm", "grain", "additive", "wavetable",
  "chord", "speech", "swarm", "noise", "particle", "string", "modal",
  "bass drum", "snare drum", "hi hat",
];
export const PLAITS_DRUM_IDX = new Set([13, 14, 15]);

export function plaitsEntries() {
  return PLAITS_MODELS.map((label, i) => ({
    key: `plaits:${i}`,
    label,
    group: "plaits",
    type: "plaits",
    plaitsIdx: i,
    defaultNote: i === 13 ? 36 : i === 14 ? 60 : i === 15 ? 72 : 60,
    poly: false,
  }));
}



// What harm / timb / morph do in each Plaits model, by model index. The four
// sliders are one set of controls wired to sixteen different synths, and unlike
// the emulators (which relabel them) Plaits keeps the hardware's generic names —
// so the explanation has to live somewhere. updatePlaitsControlsVisibility hangs
// these on the fields as tooltips, and the right-click parameter menu reads them
// from there.
const PLAITS_LPG_DECAY =
  "the internal low-pass gate: how long each trigger rings, and how far the tone closes as it falls away";
const PLAITS_DRUM_DECAY =
  "the low-pass gate's decay, on top of the model's own. Pull it down for a tighter hit";
export const PLAITS_MACRO_TIPS = [
  { // 0 virtual analog
    harm: "detuning between the two oscillators. One fat tone at zero, a beating pair at the top",
    timb: "pulse width of the square, from thin and nasal out to hollow",
    morph: "the second wave's shape, sweeping triangle to saw with a widening notch",
    decay: PLAITS_LPG_DECAY },
  { // 1 waveshaping
    harm: "which waveshaping curve the oscillator is pushed through",
    timb: "wavefolder amount. The further up, the more times the wave folds back on itself and the more harmonics come out",
    morph: "asymmetry of the waveform, which brings the even harmonics in",
    decay: PLAITS_LPG_DECAY },
  { // 2 fm
    harm: "frequency ratio between the two operators. Whole numbers stay harmonic, everything in between goes bell-like",
    timb: "modulation index: how hard operator 2 drives operator 1, so how bright the tone is and how wide the sidebands spread",
    morph: "feedback. Below centre operator 2 modulates operator 1 harder, above it feeds back into itself. Both ends head toward noise",
    decay: PLAITS_LPG_DECAY },
  { // 3 grain
    harm: "ratio between the two formant frequencies",
    timb: "formant frequency: the resonant peak the grains are shaped around",
    morph: "shape and width of the grain window",
    decay: PLAITS_LPG_DECAY },
  { // 4 additive
    harm: "how the energy is grouped across the harmonic series",
    timb: "sweeps the emphasised peak up and down that series, like drawbars",
    morph: "how wide the peak spreads, from close to a sine out to a full stack",
    decay: PLAITS_LPG_DECAY },
  { // 5 wavetable
    harm: "which bank of wavetables is read",
    timb: "position along the wavetable map",
    morph: "position across the map's other axis. The two together pick the wave, and neither moves smoothly",
    decay: PLAITS_LPG_DECAY },
  { // 6 chord
    harm: "which chord is played. The model sounds four voices at once and this picks the intervals",
    timb: "the chord's inversion and how far it spreads",
    morph: "the waveform those four voices use, from sine up through richer ones",
    decay: PLAITS_LPG_DECAY },
  { // 7 speech
    harm: "the sound bank: formant filtering at the bottom, then the vintage speech-synth modes and their word lists",
    timb: "species: shifts the formants, so the same phoneme reads as a different size of voice",
    morph: "which phoneme or word comes out",
    decay: PLAITS_LPG_DECAY },
  { // 8 swarm
    harm: "how far the swarm's voices scatter in pitch",
    timb: "density of the swarm: how many grains, how often",
    morph: "grain duration and envelope shape",
    decay: PLAITS_LPG_DECAY },
  { // 9 noise
    harm: "spacing between the two resonant peaks the noise is filtered through",
    timb: "where those peaks sit",
    morph: "how narrow they are. Wide is a wash, narrow is a pitched whistle",
    decay: PLAITS_LPG_DECAY },
  { // 10 particle
    harm: "how far each particle's pitch is randomised",
    timb: "particle density, from occasional ticks to a continuous shower",
    morph: "resonance and ring of the filter each particle is fired through",
    decay: PLAITS_LPG_DECAY },
  { // 11 string
    harm: "inharmonicity: how stiff the string is, from a clean harmonic series to a dull, bell-like one",
    timb: "brightness of the excitation that plucks it",
    morph: "how long it rings",
    decay: PLAITS_LPG_DECAY },
  { // 12 modal
    harm: "the material's inharmonicity: the difference between a tube, a bar and a bell",
    timb: "brightness and grit of the strike",
    morph: "how long the resonator rings",
    decay: PLAITS_LPG_DECAY },
  { // 13 bass drum
    harm: "attack sharpness, and how hard the drum is overdriven",
    timb: "brightness: the balance of click against body",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 14 snare drum
    harm: "balance between the drum's tone and its noise",
    timb: "brightness: how much of the noise is filtered away",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 15 hi hat
    harm: "balance between the metallic cluster and plain noise",
    timb: "brightness of the filter that cluster runs through",
    morph: "decay. Closed hat at the bottom, open at the top",
    decay: PLAITS_DRUM_DECAY },
];

// The same four sliders again, for the engines that aren't Plaits. Each entry is
// keyed by engine key, with `osc` for the oscillator-mix row and `oscMod` for
// the ultrasaw / FM / metalizer row where an engine uses them. Only the controls
// an engine actually shows need a line — updatePlaitsControlsVisibility hides
// the rest. (The silverbox, the contagion, the hexop, the guitar, the granular engine and
// the 808/909 voices keep their tips inline in params.js, next to the labels
// they go with.)
export const ENGINE_MACRO_TIPS = {
  "dm:snarl": {
    harm: "speed and depth of the LFO sweeping the pulse width, on one control. At zero the pulse holds still",
    timb: "the pulse wave's resting width, from a thin nasal 10% out to a hollow square. The pwm rate slider sweeps around wherever this sits",
    osc: {
      osc1: "level of the sawtooth, the main voice",
      osc2: "level of the pulse wave, shaped by the two pw controls",
      osc3: "level of the triangle, the one the metalizer folds",
      osc4: "level of the sub oscillator, an octave below",
    },
    oscMod: {
      ultra: "ultrasaw: detuned copies stacked around the saw",
      fm: "audio-rate frequency modulation from the sub. Clangorous and metallic as it climbs",
      metal: "metalizer: folds the triangle back on itself into hard upper harmonics",
    },
  },
  "dm:ladder": {
    harm: "how far oscillator 2 sits off oscillator 1, 5 to 30 cents",
    decay: "two things at once: how long a note takes to fall away, and how much of the warming filter stage is mixed in as it does",
    osc: {
      osc1: "level of oscillator 1 in the mixer",
      osc2: "level of oscillator 2, the detuned one",
      osc3: "level of oscillator 3, usually dropped an octave",
    },
  },
  "dm:drift": {
    harm: "speed and depth of the LFO sweeping the DCO's pulse width",
    timb: "the pulse's resting width, which that sweep moves around",
    morph: "the chorus, wet and depth together",
    decay: "how long a note falls away, and the high-pass with it, so the sound thins as it shortens",
    osc: {
      osc1: "level of the main DCO",
      osc2: "level of the square sub, an octave below",
      osc3: "level of the noise source",
    },
  },
  "dm:tines": {
    harm: "the ratio between the tine and the tone bar. Low is deep and hollow, high goes bell-like",
    timb: "how hard the hammer hits, so how much metallic attack comes through",
    morph: "how much chorus is on the output",
    decay: "how long each note rings, and how long it takes to let go once released",
  },
  "dm:oracle": {
    harm: "detunes VCO2 against VCO1 by up to 30 cents either way. Centre is unison, the ends beat",
    timb: "crossfades VCO2 from saw to pulse, sweeping the pulse width as it goes",
    morph: "how much of the output runs through the overdrive stage",
    decay: "how long each note falls away, and its release with it",
    osc: {
      osc1: "level of VCO1",
      osc2: "level of VCO2, the detuned one the shape control sweeps",
      osc3: "level of the sub oscillator",
      osc4: "level of the noise source",
    },
  },
  "wt:akwf": {
    harm: "position across the table, morphing between the frames in the editor or the AKWF palette. Wave scan can sweep this on its own",
    timb: "a lowpass on each voice, on top of the track filter. Dark at the bottom, wide open at the top",
    morph: "how far the stacked unison voices spread in pitch, up to ±30 cents. Zero is one clean voice",
    decay: "how long each note takes to fall away, and its release",
  },
  "dm:contagion": {
    osc: {
      osc1: "level of oscillator 1",
      osc2: "level of oscillator 2, the one semi, detune and sync act on",
      osc3: "level of the sub oscillator, an octave under osc 1. Its shape is the sub select",
      osc4: "level of the noise source",
    },
  },
};

export const DRUM_SYNTH_ENGINES = [
  { key: "dm:808-kick",  label: "808 kick",     defaultNote: 36 },
  { key: "dm:808-snare", label: "808 snare",    defaultNote: 60 },
  { key: "dm:808-chat",  label: "808 closed hat", defaultNote: 72 },
  { key: "dm:808-ohat",  label: "808 open hat",   defaultNote: 72 },
  { key: "dm:808-clap",  label: "808 clap",     defaultNote: 60 },
  { key: "dm:808-cowbell", label: "808 cowbell", defaultNote: 72 },
  { key: "dm:909-kick",  label: "909 kick",     defaultNote: 36 },
  { key: "dm:909-snare", label: "909 snare",    defaultNote: 60 },
  { key: "dm:909-chat",  label: "909 closed hat", defaultNote: 72 },
  { key: "dm:909-ohat",  label: "909 open hat",   defaultNote: 72 },
  { key: "dm:909-clap",  label: "909 clap",     defaultNote: 60 },
  { key: "dm:poly-saw",  label: "poly saw",     defaultNote: 60, poly: true,  melodic: true },
  { key: "dm:fm-bell",   label: "fm bell",      defaultNote: 72, poly: true,  melodic: true },
  { key: "dm:pad",       label: "pad",          defaultNote: 60, poly: true,  melodic: true },
].map(e => ({ ...e, group: "drum / synth", type: "drum-synth", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const ANALOG_ENGINES = [
  // Monophonic, like the machine — no makePolyPool wrapper (see silverbox.js).
  { key: "dm:silverbox", label: "silverbox",       defaultNote: 36, poly: false, melodic: true },
  // Polyphony lives inside the worklet rather than in makePolyPool (contagion.js).
  { key: "dm:contagion", label: "contagion",       defaultNote: 60, poly: true, melodic: true },
  // Six sine operators and 32 algorithms, 16-voice, also worklet-internal (hexop.js).
  { key: "dm:hexop",     label: "hexop",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:snarl",     label: "snarl",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:ladder",    label: "ladder",          defaultNote: 60, poly: true, melodic: true },
  { key: "dm:drift",     label: "drift",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:guitar",    label: "electric guitar", defaultNote: 52, poly: true, melodic: true },
  { key: "dm:bass",      label: "electric bass",   defaultNote: 40, poly: true, melodic: true },
  // Monophonic on purpose: two notes at 40Hz beat against each other at a rate
  // you feel as lumpiness rather than hear as harmony. Worklet-internal, one
  // voice (subbass.js).
  { key: "dm:sub",       label: "subby",           defaultNote: 28, poly: false, melodic: true },
  { key: "dm:tines",     label: "tines",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:oracle",    label: "oracle",          defaultNote: 60, poly: true, melodic: true },
].map(e => ({ ...e, group: "Emulators", type: "drum-synth", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const TEXTURE_ENGINES = [
  { key: "dm:granular", label: "granular sampler", defaultNote: 60, poly: true, melodic: true },
].map(e => ({ ...e, group: "texture", type: "granular", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const WAVETABLE_ENGINES = [
  { key: "wt:akwf", label: "wavetable", defaultNote: 60, poly: true, melodic: true },
].map(e => ({ ...e, group: "wavetable", type: "wavetable", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const SAMPLE_BASE = "https://tonejs.github.io/audio/drum-samples";
// The one unified sampler engine. Absorbs the old `upload` + per-sample `smp:*`
// engines: a sampler track loads either a user file or one of the bundled
// samples (see BUNDLED_SAMPLES) via its source picker. The legacy `eleven`
// engine is gone — old sessions migrate to a sampler upload on load.
export const SAMPLER_ENGINE = {
  key: "sampler", label: "sampler", group: "sampler", type: "sampler",
  defaultNote: 60, poly: true, melodic: true,
};
export const SAMPLE_ENGINES = [
  { key: "smp:Techno/kick",   label: "techno kick" },
  { key: "smp:Techno/snare",  label: "techno snare" },
  { key: "smp:Techno/hihat",  label: "techno hat" },
  { key: "smp:Techno/tom1",   label: "techno tom" },
  { key: "smp:CR78/kick",     label: "cr78 kick" },
  { key: "smp:CR78/snare",    label: "cr78 snare" },
  { key: "smp:CR78/hihat",    label: "cr78 hat" },
  { key: "smp:breakbeat13/kick",  label: "break kick" },
  { key: "smp:breakbeat13/snare", label: "break snare" },
  { key: "smp:breakbeat13/hihat", label: "break hat" },
  { key: "smp:acoustic-kit/kick", label: "live kick" },
  { key: "smp:acoustic-kit/snare",label: "live snare" },
  { key: "smp:acoustic-kit/hihat",label: "live hat" },
  { key: "smp:R8/kick",   label: "r8 kick" },
  { key: "smp:R8/snare",  label: "r8 snare" },
  { key: "smp:R8/hihat",  label: "r8 hat" },
].map(e => ({ ...e, group: "sample", type: "sample", defaultNote: 60, poly: true }));

// Bundled samples offered inside the sampler's source picker (id = key sans
// "smp:", used to build the load URL and stored as t.sampleSource.id).
export const BUNDLED_SAMPLES = SAMPLE_ENGINES.map(e => ({ id: e.key.replace(/^smp:/, ""), label: e.label }));

// Texture library for the granular engine. Sustained, evolving material — what
// granular synthesis actually wants — from the Lemondrop Pack (GPL-3.0, by
// callimero). Served from jsDelivr rather than committed: the pack is ~105 MB
// and jsDelivr sends `access-control-allow-origin: *`, so decodeAudioData can
// read it the same way the bundled drum kits stream from tonejs.github.io.
export const GRANULAR_SAMPLE_BASE = "https://cdn.jsdelivr.net/gh/callimero/Lemondrop_Pack@main/Samples";
export const GRANULAR_SAMPLE_CREDIT = {
  title: "Lemondrop Pack",
  author: "callimero",
  url: "https://github.com/callimero/Lemondrop_Pack",
  license: "GPL-3.0",
};
export const GRANULAR_SAMPLES = [
  { id: "Reface/Reface_AmbPad",        label: "ambient pad" },
  { id: "Reface/Reface_Ambience",      label: "ambience" },
  { id: "Reface/Reface_AmbientGrain",  label: "ambient grain" },
  { id: "Reface/Reface_BassPad",       label: "bass pad" },
  { id: "Reface/Reface_Choir",         label: "choir" },
  { id: "Reface/HardSadPad",           label: "sad pad" },
  { id: "Reface/Reface_ClickAmbience", label: "click ambience" },
  { id: "Reface/Reface_LeadRev",       label: "reverse lead" },
  { id: "Microfreak/Aeonoium",         label: "aeonium drone" },
  { id: "Microfreak/BeckonForth",      label: "beckon drone" },
  { id: "Microfreak/HarmoXtrins",      label: "harmonic strings" },
  { id: "Microfreak/SleepyTines",      label: "sleepy tines" },
  { id: "Microfreak/Wohane",           label: "wohane" },
  { id: "Microfreak/PsyPhase",         label: "psy phase" },
];

export const MIDI_ENGINE = {
  key: "midi", label: "midi out", group: "midi", type: "midi",
  defaultNote: 60, poly: true,
};

// An fx bus: a track with no instrument in it. Other tracks send their output
// here instead of to the master, and this track's filter / eq / comp / fx rack,
// its mod matrix and its automation lanes then shape all of them at once —
// which is a thing neither the mod matrix nor the lanes could do before, since
// both belong to a single track. Building it as an engine rather than a fourth
// kind of node is what makes all of that come for free: the summing gain is the
// only part that is new, and everything downstream of it is the ordinary
// per-track chain (see BusVoice in voices.js, routeTrackOutput in signal.js).
export const BUS_ENGINE = {
  key: "bus", label: "fx bus", group: "bus", type: "bus",
  defaultNote: 60, poly: true,
};

export const UPLOAD_ENGINE = {
  key: "upload", label: "upload a sample…", group: "user samples", type: "upload",
  defaultNote: 60, poly: true, melodic: true,
};


// Every engine that exists without a browser -- everything in the catalog but
// the saved patches, which live in localStorage. catalog.js builds the live
// list from these plus those; this is the list a Node process can ask.
export const STATIC_ENGINES = [
  ...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, ...TEXTURE_ENGINES,
  ...WAVETABLE_ENGINES, SAMPLER_ENGINE, MIDI_ENGINE, BUS_ENGINE,
];
const STATIC_ENGINE_MAP = new Map(STATIC_ENGINES.map(e => [e.key, e]));
/** The catalog entry for an engine key, or undefined. Saved patches
 *  (`saved:<name>`) are not here -- see catalog.js's engineByKey. */
export function staticEngineByKey(key) { return STATIC_ENGINE_MAP.get(key); }

// ---- what the four track sliders mean --------------------------------------
// harm / timb / morph / decay are one set of controls wired to every engine, and
// the analog engines relabel them so the intent shows. null hides the field
// (the control isn't used by that engine). params.js
// (updatePlaitsControlsVisibility) reads this; so does the song builder, which
// is why it is data here rather than a chain of ternaries there.
/** @returns {{harm:string|null, timb:string|null, morph:string|null, decay:string|null}} */
export function engineSliderLabels(engineKey) {
  const k = String(engineKey || "");
  switch (k) {
    case "dm:snarl":     return { harm: "pwm rate", timb: "pw",     morph: null,        decay: null };
    case "dm:ladder":    return { harm: "detune",   timb: null,     morph: null,        decay: "warm" };
    case "dm:drift":     return { harm: "pwm rate", timb: "pw",     morph: "chorus",    decay: "dec" };
    case "dm:guitar":    return { harm: "drive",    timb: "tone",   morph: "bloom",     decay: "sustain" };
    case "dm:bass":      return { harm: "drive",    timb: "tone",   morph: "comp",      decay: "sustain" };
    case "dm:sub":       return { harm: "drive",    timb: "tone",   morph: "shape",     decay: "decay" };
    case "dm:tines":     return { harm: "tine",     timb: "bite",   morph: "chorus",    decay: "decay" };
    case "dm:oracle":    return { harm: "detune",   timb: "shape",  morph: "drive",     decay: "decay" };
    case "dm:granular":  return { harm: "grain",    timb: "dense",  morph: "pos",       decay: "spray" };
    case "wt:akwf":      return { harm: "wave",     timb: "warm",   morph: "detune",    decay: "decay" };
    case "dm:silverbox": return { harm: "cutoff",   timb: "reso",   morph: "env mod",   decay: "decay" };
    case "dm:contagion": return { harm: "cutoff",   timb: "reso",   morph: "shape",     decay: "decay" };
    case "dm:hexop":     return { harm: "bright",   timb: "fbk",    morph: "mod dec",   decay: "decay" };
    case "dm:808-kick":  return { harm: "tune",     timb: "tone",   morph: "drive",     decay: "decay" };
    case "dm:808-snare": return { harm: "tune",     timb: "tone",   morph: "snappy",    decay: "decay" };
    case "dm:808-clap":  return { harm: "tune",     timb: "tone",   morph: "spread",    decay: "decay" };
    case "dm:808-chat": case "dm:808-ohat": case "dm:808-cowbell":
                         return { harm: "tune",     timb: "tone",   morph: null,        decay: "decay" };
    case "dm:909-kick":  return { harm: "tune",     timb: "attack", morph: "drive",     decay: "decay" };
    case "dm:909-snare": return { harm: "tune",     timb: "tone",   morph: "snappy",    decay: "decay" };
    case "dm:909-clap":  return { harm: "tune",     timb: "tone",   morph: "spread",    decay: "decay" };
    case "dm:909-chat": case "dm:909-ohat":
                         return { harm: "tune",     timb: "tone",   morph: null,        decay: "decay" };
  }
  return { harm: "harm", timb: "timb", morph: "morph", decay: "decay" };
}


// ---- contagion (contagion.js) ----------------------------------------------

// Panel controls, in UI order. render.js / session.js walk these lists so the
// wiring stays in one place (same convention as GRAN_NUM_KEYS).
export const CONTAGION_NUM_KEYS = [
  "vosc2semi", "vosc2det", "vpw", "vfm", "vring",
  "vunidet", "vunispread",
  "vcut2", "vbal", "vsatamt", "venvamt",
  "vatk", "vsus", "vrel",
];
export const CONTAGION_SEL_KEYS = ["vmode1", "vpoles", "vmode2", "vroute", "vsat", "vsubwave", "vsync", "vuni"];

export const CONTAGION_DEFAULTS = {
  vosc2semi: 0, vosc2det: 0.08, vpw: 0.5, vfm: 0, vring: 0,
  vunidet: 0.3, vunispread: 0.6,
  vcut2: 0, vbal: 0, vsatamt: 0.3, venvamt: 0.5,
  vatk: 0.02, vsus: 0.6, vrel: 0.25,
  vmode1: "lp", vpoles: "4", vmode2: "lp", vroute: "ser", vsat: "soft",
  vsubwave: "square", vsync: "off", vuni: "1",
};

// ---- hexop (hexop.js) --------------------------------------------------------
// ---- panel wiring -------------------------------------------------------
// Every control is `d` + a short key, and the same short key spells its LFO
// target (`hexop_<short>`) and its automation lane (`hexop.<short>`) — so the three
// namespaces are one list rather than three, and adding a control is one line.

/** Per-operator controls, in panel column order. */
export const HEXOP_OP_CTLS = ["lvl", "rat", "fin", "det", "atk", "dec", "sus", "rel"];
export const HEXOP_OPS = [1, 2, 3, 4, 5, 6];

/** Global (non-per-operator) numeric controls, in panel order. */
export const HEXOP_GLOBAL_CTLS = ["ks", "vs", "peg", "pegr", "lfor", "lfod", "pmd", "amd"];

/** Short keys — what follows `hexop_` / `hexop.`; prefix with "d" for the param. */
export const HEXOP_MOD_KEYS = [
  ...HEXOP_GLOBAL_CTLS,
  ...HEXOP_OPS.flatMap(i => HEXOP_OP_CTLS.map(c => `${i}${c}`)),
];

/** Track param keys — what render.js / session.js / the voice walk. */
export const HEXOP_NUM_KEYS = HEXOP_MOD_KEYS.map(k => `d${k}`);
export const HEXOP_SEL_KEYS = ["dalg", "dlfow", "dlfok", ...HEXOP_OPS.map(i => `d${i}fix`)];

const OP_CTL_LABEL = {
  lvl: "level", rat: "ratio", fin: "fine", det: "detune",
  atk: "attack", dec: "decay", sus: "sustain", rel: "release",
};
const GLOBAL_LABEL = {
  ks: "hexop key scale", vs: "hexop velocity", peg: "hexop pitch env", pegr: "hexop pitch env rate",
  lfor: "hexop lfo speed", lfod: "hexop lfo delay", pmd: "hexop pitch mod", amd: "hexop amp mod",
};

/** Picker labels for the mod / automation menus. */
export const HEXOP_MOD_LABELS = Object.fromEntries(HEXOP_MOD_KEYS.map(k => [
  k,
  GLOBAL_LABEL[k] ?? `hexop op${k[0]} ${OP_CTL_LABEL[k.slice(1)]}`,
]));

/** [min, max] per short key. Modulation and automation both map through this,
 *  so a lane spans the slider's own range rather than a hardcoded 0..1. Keys
 *  not listed are plain 0..1 — kept in the table anyway so there's one path. */
const CTL_RANGE = { rat: [0, 31], det: [-7, 7], fin: [0, 0.99] };
export const HEXOP_MOD_RANGE = Object.fromEntries(HEXOP_MOD_KEYS.map(k => {
  if (k === "peg") return [k, [-1, 1]];                     // bipolar pitch env
  if (GLOBAL_LABEL[k]) return [k, [0, 1]];
  return [k, CTL_RANGE[k.slice(1)] ?? [0, 1]];              // per-operator
}));

/** 0..1 → the parameter's own units (automation lanes, and the mod base). */
export function hexopFromUnit(short, u) {
  const [lo, hi] = HEXOP_MOD_RANGE[short] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// An init voice: one carrier, one modulator at a musical level, everything else
// silent. It is what the machine powers up with, and the honest starting point
// for programming — the presets below are where the sounds are.
export const HEXOP_DEFAULTS = (() => {
  const d = {
    dalg: "1", dlfow: "tri", dlfok: "on",
    dks: 0.35, dvs: 0.5, dpeg: 0, dpegr: 0.3,
    dlfor: 0.35, dlfod: 0, dpmd: 0, damd: 0,
  };
  for (const i of HEXOP_OPS) {
    d[`d${i}lvl`] = i === 1 ? 1 : i === 2 ? 0.72 : 0;
    d[`d${i}rat`] = 1;
    d[`d${i}fin`] = 0;
    d[`d${i}det`] = 0;
    d[`d${i}atk`] = 0.01;
    d[`d${i}dec`] = 0.45;
    d[`d${i}sus`] = i === 1 ? 0.8 : 0.4;
    d[`d${i}rel`] = 0.3;
    d[`d${i}fix`] = "ratio";
  }
  return d;
})();

// Voices in the spirit of the machine's own — not its ROM patches, which are
// 155-byte sysex blobs of controls this panel doesn't have. Each one is a
// complete set of panel values, so loading it leaves nothing of the last.
const op = (lvl, rat, fin, atk, dec, sus, rel, det = 0, fix = "ratio") =>
  ({ lvl, rat, fin, atk, dec, sus, rel, det, fix });

const PRESET_VOICES = {
  "init": { alg: 1, bright: 0.5, fb: 0.25, ks: 0.35, vs: 0.5, ops: [
    op(1, 1, 0, 0.01, 0.45, 0.8, 0.3), op(0.72, 1, 0, 0.01, 0.45, 0.4, 0.3),
    op(0, 1, 0, 0.01, 0.45, 0.4, 0.3), op(0, 1, 0, 0.01, 0.45, 0.4, 0.3),
    op(0, 1, 0, 0.01, 0.45, 0.4, 0.3), op(0, 1, 0, 0.01, 0.45, 0.4, 0.3)] },

  // Three carrier/modulator pairs. The bark is op 2 at a high ratio decaying
  // fast under a carrier that doesn't — the tine hitting the tone bar.
  "e.piano": { alg: 5, bright: 0.52, fb: 0.12, ks: 0.55, vs: 0.85, ops: [
    op(1,    1,  0,    0.005, 0.42, 0.28, 0.25),
    op(0.78, 14, 0,    0.005, 0.16, 0,    0.2),
    op(0.86, 1,  0,    0.005, 0.5,  0.34, 0.28),
    op(0.6,  1,  0,    0.005, 0.34, 0.1,  0.22),
    op(0.5,  1,  0,    0.02,  0.62, 0.5,  0.35, 3),
    op(0.42, 2,  0.01, 0.02,  0.4,  0.2,  0.3, -3)] },

  // One carrier, everything else stacked into it, feedback wound up for grit.
  "bass": { alg: 16, bright: 0.46, fb: 0.5, ks: 0.2, vs: 0.6, ops: [
    op(1,    1, 0,    0.002, 0.32, 0.18, 0.16),
    op(0.62, 1, 0,    0.002, 0.24, 0.06, 0.14),
    op(0.4,  2, 0,    0.002, 0.2,  0,    0.14),
    op(0.55, 1, 0,    0.002, 0.26, 0.1,  0.16),
    op(0.34, 0, 0,    0.002, 0.3,  0.14, 0.16),
    op(0.3,  3, 0.02, 0.002, 0.18, 0,    0.14)] },

  // Inharmonic ratios and a long tail — the sound that put the hexop on every
  // record of 1984. Nothing here is a whole number but the carriers.
  "bell": { alg: 5, bright: 0.6, fb: 0.05, ks: 0.5, vs: 0.7, ops: [
    op(1,    1, 0,    0.002, 0.78, 0, 0.72),
    op(0.7,  3, 0.5,  0.002, 0.6,  0, 0.5),
    op(0.72, 2, 0,    0.002, 0.72, 0, 0.66),
    op(0.62, 7, 0.13, 0.002, 0.5,  0, 0.44),
    op(0.5,  1, 0.02, 0.002, 0.82, 0, 0.76, 4),
    op(0.55, 11, 0.4, 0.002, 0.42, 0, 0.4, -4)] },

  // Slow attack on the modulators, so the spectrum opens after the note does.
  "brass": { alg: 18, bright: 0.55, fb: 0.35, ks: 0.3, vs: 0.65, ops: [
    op(1,    1, 0,    0.12, 0.5, 0.75, 0.3),
    op(0.62, 1, 0,    0.3,  0.5, 0.6,  0.3),
    op(0.5,  1, 0.01, 0.34, 0.5, 0.55, 0.3, 3),
    op(0.45, 2, 0,    0.26, 0.5, 0.5,  0.3),
    op(0.5,  1, 0,    0.2,  0.5, 0.6,  0.3),
    op(0.34, 1, 0.02, 0.3,  0.5, 0.45, 0.3, -3)] },

  // Everything decays, nothing sustains, and the modulator goes first.
  "marimba": { alg: 5, bright: 0.5, fb: 0.08, ks: 0.6, vs: 0.8, ops: [
    op(1,    1, 0, 0.002, 0.4,  0, 0.3),
    op(0.66, 7, 0, 0.002, 0.14, 0, 0.12),
    op(0.55, 1, 0, 0.002, 0.34, 0, 0.28),
    op(0.5,  4, 0, 0.002, 0.1,  0, 0.1),
    op(0.34, 1, 0, 0.002, 0.46, 0, 0.36, 5),
    op(0.4,  3, 0, 0.002, 0.08, 0, 0.1)] },

  // Algorithm 32 is six carriers and no modulation at all — which is to say it
  // is a drawbar organ, if you tune the operators in octaves and fifths.
  "organ": { alg: 32, bright: 0.5, fb: 0.15, ks: 0.1, vs: 0.3, ops: [
    op(1,    1, 0, 0.006, 0.3, 1,    0.1),
    op(0.86, 2, 0, 0.006, 0.3, 1,    0.1),
    op(0.66, 3, 0, 0.006, 0.3, 0.95, 0.1),
    op(0.6,  4, 0, 0.006, 0.3, 0.95, 0.1),
    op(0.5,  6, 0, 0.006, 0.3, 0.9,  0.1),
    op(0.46, 8, 0, 0.006, 0.3, 0.9,  0.1)] },

  // The three-operator feedback loop of algorithm 4, detuned, opening slowly.
  "pad": { alg: 4, bright: 0.44, fb: 0.3, ks: 0.4, vs: 0.4, ops: [
    op(1,    1, 0,    0.3,  0.6, 0.85, 0.7, 3),
    op(0.5,  1, 0.01, 0.4,  0.6, 0.7,  0.6),
    op(0.42, 2, 0,    0.45, 0.6, 0.6,  0.6),
    op(0.9,  1, 0,    0.34, 0.6, 0.85, 0.7, -3),
    op(0.46, 3, 0.01, 0.4,  0.6, 0.65, 0.6),
    op(0.38, 1, 0.02, 0.5,  0.6, 0.6,  0.6)] },
};

/**
 * A preset as a complete set of track params (every panel control, so nothing
 * of the previous voice survives). The four track sliders come with it —
 * brightness and feedback are as much part of an FM voice as the operators.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function hexopPreset(name) {
  const v = PRESET_VOICES[name];
  if (!v) return null;
  const p = { ...HEXOP_DEFAULTS, dalg: String(v.alg) };
  if (v.ks != null) p.dks = v.ks;
  if (v.vs != null) p.dvs = v.vs;
  v.ops.forEach((o, idx) => {
    const i = idx + 1;
    p[`d${i}lvl`] = o.lvl; p[`d${i}rat`] = o.rat; p[`d${i}fin`] = o.fin;
    p[`d${i}det`] = o.det; p[`d${i}atk`] = o.atk; p[`d${i}dec`] = o.dec;
    p[`d${i}sus`] = o.sus; p[`d${i}rel`] = o.rel; p[`d${i}fix`] = o.fix;
  });
  // The four track sliders come with the voice — brightness and feedback are as
  // much a part of an FM patch as the operators, and the two decay macros have
  // to land back at neutral or the last preset's timing bleeds into this one.
  p.harm = v.bright;
  p.timb = v.fb;
  p.morph = v.modDec ?? 0.5;
  p.decay = v.dec ?? 0.5;
  return p;
}

export const HEXOP_PRESET_NAMES = Object.keys(PRESET_VOICES);

// A one-line diagram per algorithm for the dropdown: "1←2 3←4←5←6" reads as
// "operator 2 modulates 1, and 6 through 4 stack into 3", which is the only
// thing about an algorithm anyone needs at picking time.
export const HEXOP_ALG_LABELS = [
  "1←2 3←4←5←6", "1←2 3←4←5←6", "1←2←3 4←5←6", "1←2←3 4←5←6",
  "1←2 3←4 5←6", "1←2 3←4 5←6", "1←2 3←4+5←6", "1←2 3←4+5←6",
  "1←2 3←4+5←6", "1←2←3 4←5+6", "1←2←3 4←5+6", "1←2 3←4+5+6",
  "1←2 3←4+5+6", "1←2 3←4←5+6", "1←2 3←4←5+6", "1←2+3←4+5←6",
  "1←2+3←4+5←6", "1←2+3+4←5←6", "1←2←3 4←6 5←6", "1←3 2←3 4←5+6",
  "1←3 2←3 4←6 5←6", "1←2 3←6 4←6 5←6", "1 2←3 4←6 5←6", "1 2 3←6 4←6 5←6",
  "1 2 3 4←6 5←6", "1 2←3 4←5+6", "1 2←3 4←5+6", "1←2 3←4←5 6",
  "1 2 3←4 5←6", "1 2 3←4←5 6", "1 2 3 4 5←6", "1 2 3 4 5 6",
];

/**
 * Which operators you actually hear in this algorithm — the carriers. Read back
 * out of the diagram rather than kept as a second table: a carrier is exactly
 * an operator with no arrow pointing into it, which is what the leading number
 * of each group in the label means.
 * @param {number} alg 1-based algorithm number @returns {number[]}
 */
export function hexopCarriers(alg) {
  const d = HEXOP_ALG_LABELS[Math.max(0, Math.min(31, (alg | 0) - 1))] || "";
  return d.split(" ").map(g => Number(g.split("←")[0])).filter(Boolean);
}

// Which operator carries the feedback loop, per algorithm — the panel says so,
// because "feedback" means nothing until you know where it is wired.
export const HEXOP_ALG_FEEDBACK = [
  "6", "2", "6", "6→4", "6", "6→5", "6", "4", "2", "3", "6", "2",
  "6", "6", "2", "6", "2", "3", "6", "3", "3", "6", "6", "6",
  "6", "6", "3", "5", "6", "5", "6", "6",
];

// ---- electric guitar (guitar.js) ---------------------------------------------
// ---- the panel ----------------------------------------------------------
// One list, three namespaces — the same trick the hexop panel uses. Every control
// is `gt` + a short key, and that short key spells its LFO target (`gtr_<short>`)
// and its automation lane (`gtr.<short>`), so `gtbass` / `gtr_bass` / `gtr.bass`
// are one control. constants.js, automation.js and paramTargets.js map over
// GUITAR_MOD_KEYS rather than listing them.

/** Numeric panel controls: [short key, min, max, default, label]. */
export const GUITAR_NUM_CTLS = [
  ["pick",   0.02, 0.5, 0.28, "pick pos"],
  ["pnoise", 0,    1,   0.5,  "pick"],
  ["stiff",  0,    1,   0.25, "stiff"],
  ["pkup",   0.02, 0.5, 0.12, "pkup pos"],
  ["mute",   0,    1,   0,    "palm"],
  ["bass",   0,    1,   0.5,  "bass"],
  ["mid",    0,    1,   0.5,  "mid"],
  ["treb",   0,    1,   0.5,  "treble"],
  ["pres",   0,    1,   0.4,  "presence"],
  ["mast",   0,    1,   0.5,  "master"],
  ["sag",    0,    1,   0.3,  "sag"],
  ["mic",    0,    1,   0.35, "mic"],
  ["trem",   0,    1,   0,    "trem"],
  ["tremr",  0,    1,   0.4,  "trem rate"],
  ["sprg",   0,    1,   0,    "spring"],
];

/** Select controls: [short key, default, [values]]. */
export const GUITAR_SEL_CTLS = [
  ["amp",   "brit",   ["clean", "tweed", "brit", "hi", "jazz"]],
  ["cab",   "4x12",   ["4x12", "2x12", "1x12", "1x8", "di"]],
  ["pkupt", "hum",    ["single", "hum", "p90"]],
  ["tremw", "sine",   ["sine", "square"]],
];

export const GUITAR_MOD_KEYS = GUITAR_NUM_CTLS.map(c => c[0]);
export const GUITAR_NUM_KEYS = GUITAR_MOD_KEYS.map(k => `gt${k}`);
export const GUITAR_SEL_KEYS = GUITAR_SEL_CTLS.map(c => `gt${c[0]}`);

/** Each control's own span, so a lane or an LFO covers the slider, not 0..1. */
export const GUITAR_MOD_RANGE = Object.fromEntries(GUITAR_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const GUITAR_MOD_LABELS = Object.fromEntries(
  GUITAR_NUM_CTLS.map(([k, , , , label]) => [k, `guitar ${label}`]));

export const GUITAR_DEFAULTS = {
  ...Object.fromEntries(GUITAR_NUM_CTLS.map(c => [`gt${c[0]}`, c[3]])),
  ...Object.fromEntries(GUITAR_SEL_CTLS.map(c => [`gt${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function guitarFromUnit(k, u) {
  const [lo, hi] = GUITAR_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- famous tones -------------------------------------------------------
// A guitar sound is a rig, not a patch: the pickup, where you pick, the amp,
// how hard it is driven, the cab, and what is bouncing back off the speaker.
// Each of these is a complete set of all of that plus the four track sliders,
// so loading one leaves nothing of the last behind.
//
// They are named for what they sound like rather than for who played them —
// but the line under each says what it is reaching for, because that is the
// only useful thing to know at picking time.
const GUITAR_TONES = {
  "surf twang": {
    d: "bridge single coil, a clean blackface combo, deep amp tremolo and a tank full of spring",
    drive: 0.18, tone: 0.86, bloom: 0.1, sustain: 0.42,
    p: { pick: 0.1, pnoise: 0.85, stiff: 0.3, pkup: 0.06, mute: 0.1,
         bass: 0.5, mid: 0.35, treb: 0.78, pres: 0.55, mast: 0.4, sag: 0.25,
         mic: 0.6, trem: 0.7, tremr: 0.55, sprg: 0.85,
         amp: "clean", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "funk clean": {
    d: "bridge single coil into a clean amp with the mids pulled out, picked hard and short",
    drive: 0.22, tone: 0.8, bloom: 0.05, sustain: 0.18,
    p: { pick: 0.08, pnoise: 0.9, stiff: 0.35, pkup: 0.05, mute: 0.3,
         bass: 0.35, mid: 0.3, treb: 0.75, pres: 0.6, mast: 0.45, sag: 0.2,
         mic: 0.65, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "clean", cab: "1x12", pkupt: "single", tremw: "sine" },
  },
  "jangle": {
    d: "neck and bridge together, barely breaking up, picked over the neck. Chiming and clean",
    drive: 0.34, tone: 0.72, bloom: 0.12, sustain: 0.55,
    p: { pick: 0.32, pnoise: 0.55, stiff: 0.2, pkup: 0.2, mute: 0,
         bass: 0.45, mid: 0.55, treb: 0.68, pres: 0.5, mast: 0.5, sag: 0.35,
         mic: 0.5, trem: 0, tremr: 0.4, sprg: 0.25,
         amp: "tweed", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "chime": {
    d: "a brit combo sitting right on the edge of breaking up, bright and glassy",
    drive: 0.42, tone: 0.82, bloom: 0.18, sustain: 0.68,
    p: { pick: 0.22, pnoise: 0.6, stiff: 0.22, pkup: 0.14, mute: 0,
         bass: 0.42, mid: 0.5, treb: 0.72, pres: 0.65, mast: 0.55, sag: 0.4,
         mic: 0.55, trem: 0, tremr: 0.4, sprg: 0.2,
         amp: "brit", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "country twang": {
    d: "bridge pickup, picked by the bridge, clean and compressed with a fast decay",
    drive: 0.26, tone: 0.9, bloom: 0.05, sustain: 0.3,
    p: { pick: 0.05, pnoise: 1, stiff: 0.4, pkup: 0.04, mute: 0.25,
         bass: 0.4, mid: 0.45, treb: 0.82, pres: 0.7, mast: 0.5, sag: 0.45,
         mic: 0.7, trem: 0, tremr: 0.4, sprg: 0.35,
         amp: "tweed", cab: "1x12", pkupt: "single", tremw: "sine" },
  },
  "blues burn": {
    d: "a small tweed amp with everything on ten: it sags, it compresses, and it blooms on a held note",
    drive: 0.72, tone: 0.6, bloom: 0.5, sustain: 0.72,
    p: { pick: 0.24, pnoise: 0.55, stiff: 0.28, pkup: 0.24, mute: 0,
         bass: 0.55, mid: 0.68, treb: 0.55, pres: 0.45, mast: 0.85, sag: 0.8,
         mic: 0.45, trem: 0, tremr: 0.4, sprg: 0.3,
         amp: "tweed", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "brit stack": {
    d: "bridge humbucker into a cranked plexi and a 4x12, mostly power amp rather than preamp",
    drive: 0.68, tone: 0.68, bloom: 0.42, sustain: 0.66,
    p: { pick: 0.16, pnoise: 0.7, stiff: 0.3, pkup: 0.09, mute: 0.12,
         bass: 0.5, mid: 0.7, treb: 0.6, pres: 0.6, mast: 0.9, sag: 0.55,
         mic: 0.5, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "rolled off": {
    d: "neck humbucker with the guitar's tone knob rolled right down, into a cranked amp. Dark, vocal, no pick attack at all",
    drive: 0.74, tone: 0.12, bloom: 0.55, sustain: 0.8,
    p: { pick: 0.42, pnoise: 0.25, stiff: 0.18, pkup: 0.36, mute: 0,
         bass: 0.6, mid: 0.72, treb: 0.5, pres: 0.35, mast: 0.85, sag: 0.6,
         mic: 0.35, trem: 0, tremr: 0.4, sprg: 0.15,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "fuzz lead": {
    d: "hard clipping, a woolly top end and enough bloom that held notes climb into feedback",
    drive: 0.95, tone: 0.5, bloom: 0.78, sustain: 0.85,
    p: { pick: 0.3, pnoise: 0.5, stiff: 0.35, pkup: 0.3, mute: 0,
         bass: 0.62, mid: 0.62, treb: 0.55, pres: 0.5, mast: 0.8, sag: 0.7,
         mic: 0.4, trem: 0, tremr: 0.4, sprg: 0.2,
         amp: "brit", cab: "4x12", pkupt: "single", tremw: "sine" },
  },
  "singing lead": {
    d: "moderate gain, huge string decay and the speaker feeding the string back hard enough that notes never stop",
    drive: 0.7, tone: 0.62, bloom: 0.88, sustain: 0.95,
    p: { pick: 0.36, pnoise: 0.35, stiff: 0.15, pkup: 0.34, mute: 0,
         bass: 0.5, mid: 0.75, treb: 0.58, pres: 0.55, mast: 0.75, sag: 0.5,
         mic: 0.4, trem: 0, tremr: 0.4, sprg: 0.25,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "scooped metal": {
    d: "hi-gain with the mids taken out and the low end cut tight, palm muted",
    drive: 0.88, tone: 0.72, bloom: 0.2, sustain: 0.5,
    p: { pick: 0.06, pnoise: 0.9, stiff: 0.4, pkup: 0.05, mute: 0.55,
         bass: 0.7, mid: 0.12, treb: 0.78, pres: 0.75, mast: 0.6, sag: 0.15,
         mic: 0.6, trem: 0, tremr: 0.4, sprg: 0,
         amp: "hi", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "djent chug": {
    d: "hard palm mute, mids back in, and a low cut that leaves only the attack",
    drive: 0.82, tone: 0.78, bloom: 0.15, sustain: 0.35,
    p: { pick: 0.04, pnoise: 1, stiff: 0.5, pkup: 0.04, mute: 0.78,
         bass: 0.55, mid: 0.45, treb: 0.8, pres: 0.8, mast: 0.5, sag: 0.1,
         mic: 0.7, trem: 0, tremr: 0.4, sprg: 0,
         amp: "hi", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "grunge": {
    d: "a brit amp pushed into mush with the mids up and the strings picked hard. Loose and honking",
    drive: 0.8, tone: 0.55, bloom: 0.3, sustain: 0.45,
    p: { pick: 0.14, pnoise: 0.95, stiff: 0.45, pkup: 0.16, mute: 0.2,
         bass: 0.65, mid: 0.72, treb: 0.62, pres: 0.5, mast: 0.7, sag: 0.6,
         mic: 0.35, trem: 0, tremr: 0.4, sprg: 0.15,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "jazz box": {
    d: "neck humbucker, thumb rather than pick, tone rolled back and an amp that never breaks up. Round and dark",
    drive: 0.12, tone: 0.24, bloom: 0.05, sustain: 0.5,
    p: { pick: 0.46, pnoise: 0.12, stiff: 0.12, pkup: 0.4, mute: 0,
         bass: 0.6, mid: 0.6, treb: 0.35, pres: 0.15, mast: 0.4, sag: 0.2,
         mic: 0.25, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "jazz", cab: "1x12", pkupt: "hum", tremw: "sine" },
  },
};

export const GUITAR_TONE_NAMES = Object.keys(GUITAR_TONES);

/** One line saying what a tone is reaching for. @param {string} name */
export function guitarToneDescription(name) { return GUITAR_TONES[name]?.d ?? ""; }

/**
 * A famous tone as a complete set of track params — every panel control plus
 * the four track sliders, because on a guitar the drive and the sustain are as
 * much a part of the sound as the amp is.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function guitarTone(name) {
  const v = GUITAR_TONES[name];
  if (!v) return null;
  const out = { ...GUITAR_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`gt${k}`] = val;
  out.harm = v.drive; out.timb = v.tone; out.morph = v.bloom; out.decay = v.sustain;
  return out;
}

// ---- electric bass (bass.js) ---------------------------------------------------
// ---- the panel ----------------------------------------------------------
// One list, three namespaces, as in hexop.js and guitar.js: every control is `bs`
// + a short key, and that short key spells its LFO target (`bas_<short>`) and
// its automation lane (`bas.<short>`).

/** Numeric panel controls: [short key, min, max, default, label]. */
export const BASS_NUM_CTLS = [
  ["pick",   0.02, 0.5, 0.14, "pluck pos"],
  ["attack", 0,    1,   0.4,  "hand"],
  ["stiff",  0,    1,   0.45, "stiff"],
  ["pkup",   0.02, 0.5, 0.1,  "pkup pos"],
  ["mute",   0,    1,   0,    "palm"],
  ["fret",   0,    1,   0.25, "fret"],
  ["grind",  0,    1,   0,    "grind"],
  ["xover",  0,    1,   0.4,  "xover"],
  ["sub",    0,    1,   0,    "sub"],
  ["bass",   0,    1,   0.5,  "bass"],
  ["lomid",  0,    1,   0.5,  "lo mid"],
  ["himid",  0,    1,   0.5,  "hi mid"],
  ["treb",   0,    1,   0.5,  "treble"],
  ["hpf",    0,    1,   0.15, "low cut"],
  ["mic",    0,    1,   0.4,  "mic"],
];

/** Select controls: [short key, default, [values]]. */
export const BASS_SEL_CTLS = [
  ["amp",   "svt",   ["di", "flip", "svt", "gk"]],
  ["cab",   "8x10",  ["8x10", "4x10", "1x15", "2x12", "di"]],
  ["pkupt", "p",     ["j", "p", "mm"]],
  ["strs",  "round", ["round", "flat"]],
];

export const BASS_MOD_KEYS = BASS_NUM_CTLS.map(c => c[0]);
export const BASS_NUM_KEYS = BASS_MOD_KEYS.map(k => `bs${k}`);
export const BASS_SEL_KEYS = BASS_SEL_CTLS.map(c => `bs${c[0]}`);

export const BASS_MOD_RANGE = Object.fromEntries(BASS_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const BASS_MOD_LABELS = Object.fromEntries(
  BASS_NUM_CTLS.map(([k, , , , label]) => [k, `bass ${label}`]));

export const BASS_DEFAULTS = {
  ...Object.fromEntries(BASS_NUM_CTLS.map(c => [`bs${c[0]}`, c[3]])),
  ...Object.fromEntries(BASS_SEL_CTLS.map(c => [`bs${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function bassFromUnit(k, u) {
  const [lo, hi] = BASS_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- famous tones -------------------------------------------------------
// The rig, end to end: which bass, wound with what, played with what, into
// which amp and how compressed. Named for what they sound like; the line under
// each says what it is reaching for.
const BASS_TONES = {
  "motown": {
    d: "flatwounds on a precision with a foam mute under the bridge, tone rolled off, into a small valve amp. All fundamental and nothing above it",
    drive: 0.66, tone: 0.14, comp: 0.55, sustain: 0.5,
    p: { pick: 0.22, attack: 0.2, stiff: 0.2, pkup: 0.16, mute: 0.4, fret: 0.1,
         grind: 0, xover: 0.4, sub: 0,
         bass: 0.62, lomid: 0.6, himid: 0.4, treb: 0.25, hpf: 0.1, mic: 0.3,
         amp: "flip", cab: "1x15", pkupt: "p", strs: "flat" },
  },
  "svt fingers": {
    d: "fingers on a precision into a big valve stack and an eight-by-ten, pushed just far enough to growl on the hard notes",
    drive: 0.55, tone: 0.6, comp: 0.4, sustain: 0.55,
    p: { pick: 0.16, attack: 0.4, stiff: 0.45, pkup: 0.1, mute: 0, fret: 0.25,
         grind: 0.18, xover: 0.45, sub: 0,
         bass: 0.58, lomid: 0.55, himid: 0.5, treb: 0.5, hpf: 0.2, mic: 0.45,
         amp: "svt", cab: "8x10", pkupt: "p", strs: "round" },
  },
  "pick grind": {
    d: "a plectrum by the bridge, roundwounds, and a solid-state amp with all the mids in",
    drive: 0.72, tone: 0.85, comp: 0.35, sustain: 0.45,
    p: { pick: 0.05, attack: 1, stiff: 0.6, pkup: 0.05, mute: 0.1, fret: 0.4,
         grind: 0.6, xover: 0.35, sub: 0,
         bass: 0.5, lomid: 0.45, himid: 0.7, treb: 0.7, hpf: 0.3, mic: 0.6,
         amp: "gk", cab: "4x10", pkupt: "j", strs: "round" },
  },
  "slap funk": {
    d: "thumb against the frets and fingers pulling the strings off them: fresh roundwounds, the mids scooped out, compressed hard, and all the clank left in",
    drive: 0.3, tone: 0.95, comp: 0.75, sustain: 0.6,
    p: { pick: 0.04, attack: 0.85, stiff: 0.7, pkup: 0.06, mute: 0, fret: 0.85,
         grind: 0.1, xover: 0.5, sub: 0,
         bass: 0.72, lomid: 0.25, himid: 0.35, treb: 0.85, hpf: 0.25, mic: 0.7,
         amp: "di", cab: "4x10", pkupt: "mm", strs: "round" },
  },
  "dub": {
    d: "neck pickup, flatwounds, tone all the way down and the palm resting on the strings. A fifteen-inch speaker and almost nothing above 200Hz",
    drive: 0.5, tone: 0.06, comp: 0.6, sustain: 0.35,
    p: { pick: 0.3, attack: 0.15, stiff: 0.15, pkup: 0.34, mute: 0.6, fret: 0.05,
         grind: 0, xover: 0.4, sub: 0.2,
         bass: 0.85, lomid: 0.6, himid: 0.25, treb: 0.1, hpf: 0.05, mic: 0.2,
         amp: "flip", cab: "1x15", pkupt: "p", strs: "flat" },
  },
  "modern di": {
    d: "straight into the desk, both pickups, compressed flat and even. Uncoloured",
    drive: 0.2, tone: 0.75, comp: 0.7, sustain: 0.55,
    p: { pick: 0.14, attack: 0.45, stiff: 0.4, pkup: 0.14, mute: 0, fret: 0.2,
         grind: 0.06, xover: 0.5, sub: 0,
         bass: 0.55, lomid: 0.45, himid: 0.5, treb: 0.6, hpf: 0.3, mic: 0.5,
         amp: "di", cab: "di", pkupt: "j", strs: "round" },
  },
  "walking jazz": {
    d: "flatwounds by the neck, tone well back, short notes and a woody thump",
    drive: 0.6, tone: 0.22, comp: 0.5, sustain: 0.25,
    p: { pick: 0.36, attack: 0.18, stiff: 0.18, pkup: 0.4, mute: 0.25, fret: 0.15,
         grind: 0, xover: 0.4, sub: 0,
         bass: 0.6, lomid: 0.58, himid: 0.38, treb: 0.28, hpf: 0.12, mic: 0.3,
         amp: "flip", cab: "1x15", pkupt: "p", strs: "flat" },
  },
  "growl": {
    d: "a jazz bass on the bridge pickup with the mids up and just enough dirt to snarl. Nasal and forward",
    drive: 0.6, tone: 0.8, comp: 0.4, sustain: 0.6,
    p: { pick: 0.07, attack: 0.55, stiff: 0.55, pkup: 0.05, mute: 0, fret: 0.35,
         grind: 0.4, xover: 0.45, sub: 0,
         bass: 0.45, lomid: 0.4, himid: 0.72, treb: 0.62, hpf: 0.28, mic: 0.55,
         amp: "svt", cab: "8x10", pkupt: "j", strs: "round" },
  },
  "octave sub": {
    d: "an octaver under the note and the top filtered off it. Half bass, half synth",
    drive: 0.3, tone: 0.3, comp: 0.65, sustain: 0.5,
    p: { pick: 0.2, attack: 0.3, stiff: 0.3, pkup: 0.2, mute: 0.15, fret: 0.1,
         grind: 0.12, xover: 0.55, sub: 0.85,
         bass: 0.7, lomid: 0.5, himid: 0.35, treb: 0.3, hpf: 0.08, mic: 0.35,
         amp: "di", cab: "1x15", pkupt: "mm", strs: "round" },
  },
  "pop punk": {
    d: "plectrum, roundwounds, the mids pulled out and the top wound up until every note is an attack. Bright and fast",
    drive: 0.65, tone: 0.9, comp: 0.55, sustain: 0.3,
    p: { pick: 0.06, attack: 1, stiff: 0.6, pkup: 0.07, mute: 0.2, fret: 0.5,
         grind: 0.45, xover: 0.4, sub: 0,
         bass: 0.68, lomid: 0.3, himid: 0.5, treb: 0.82, hpf: 0.35, mic: 0.65,
         amp: "gk", cab: "4x10", pkupt: "p", strs: "round" },
  },
};

export const BASS_TONE_NAMES = Object.keys(BASS_TONES);

/** One line saying what a tone is reaching for. @param {string} name */
export function bassToneDescription(name) { return BASS_TONES[name]?.d ?? ""; }

/**
 * A famous tone as a complete set of track params — every panel control plus
 * the four track sliders, so nothing of the last rig survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function bassTone(name) {
  const v = BASS_TONES[name];
  if (!v) return null;
  const out = { ...BASS_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`bs${k}`] = val;
  out.harm = v.drive; out.timb = v.tone; out.morph = v.comp; out.decay = v.sustain;
  return out;
}

// ---- subby (subbass.js) ----------------------------------------------------
// ---- the panel ----------------------------------------------------------

/** Numeric panel controls: [short key, min, max, default, label]. */
export const SUB_NUM_CTLS = [
  ["oct",    0, 1, 0,    "sub oct"],
  ["detune", 0, 1, 0,    "detune"],
  ["phase",  0, 1, 0,    "phase"],
  ["drift",  0, 1, 0.06, "drift"],
  ["drop",   0, 1, 0.15, "drop"],
  ["droptm", 0, 1, 0.2,  "drop time"],
  ["atk",    0, 1, 0.02, "attack"],
  ["rel",    0, 1, 0.15, "release"],
  ["click",  0, 1, 0.2,  "click"],
  ["xover",  0, 1, 0.3,  "xover"],
  ["edge",   0, 1, 0.35, "edge"],
  ["reso",   0, 1, 0,    "reso"],
  ["rcut",   0, 1, 0.5,  "reso cutoff"],
  ["renv",   0, 1, 0.55, "reso env"],
  ["rdec",   0, 1, 0.35, "reso decay"],
  ["racc",   0, 1, 0.35, "reso accent"],
  ["hpf",    0, 1, 0.1,  "low cut"],
  ["glue",   0, 1, 0.35, "glue"],
  ["ceil",   0, 1, 0.85, "ceiling"],
];

/** Select controls: [short key, default, [values]]. */
export const SUB_SEL_CTLS = [
  ["stack",  "1",    ["1", "2", "3"]],
  ["sat",    "tube", ["tube", "fold", "fuzz", "rect"]],
  ["glidem", "always", ["always", "legato"]],
];

export const SUB_MOD_KEYS = SUB_NUM_CTLS.map(c => c[0]);
export const SUB_NUM_KEYS = SUB_MOD_KEYS.map(k => `sub${k}`);
export const SUB_SEL_KEYS = SUB_SEL_CTLS.map(c => `sub${c[0]}`);

export const SUB_MOD_RANGE = Object.fromEntries(SUB_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const SUB_MOD_LABELS = Object.fromEntries(
  SUB_NUM_CTLS.map(([k, , , , label]) => [k, `subby ${label}`]));

export const SUB_DEFAULTS = {
  ...Object.fromEntries(SUB_NUM_CTLS.map(c => [`sub${c[0]}`, c[3]])),
  ...Object.fromEntries(SUB_SEL_CTLS.map(c => [`sub${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function subFromUnit(k, u) {
  const [lo, hi] = SUB_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the tones ----------------------------------------------------------
// Sub-bass is a small number of very well-established sounds, and the useful
// thing an instrument can do is put you inside one of them in a click. Each is
// a complete patch: every panel control plus the four track sliders.
const SUB_TONES = {
  "808": {
    d: "a sine with a short pitch drop for the beater, a decay that rings over the bar, and just enough drive to carry on a small speaker",
    drive: 0.52, tone: 0.42, shape: 0, decay: 0.62,
    p: { oct: 0, detune: 0, phase: 0.25, drift: 0.04, drop: 0.22, droptm: 0.16,
         atk: 0.01, rel: 0.12, click: 0.22, xover: 0.34, edge: 0.4,
         hpf: 0.08, glue: 0.3, ceil: 0.85, stack: "1", sat: "tube", glidem: "legato" },
  },
  "distorted 808": {
    d: "the same 808 driven until the harmonics are louder than the fundamental, so it still reads as bass on a laptop",
    drive: 0.82, tone: 0.62, shape: 0.08, decay: 0.6,
    p: { oct: 0, detune: 0, phase: 0.25, drift: 0.05, drop: 0.2, droptm: 0.14,
         atk: 0.01, rel: 0.1, click: 0.3, xover: 0.4, edge: 0.55,
         hpf: 0.14, glue: 0.5, ceil: 0.8, stack: "1", sat: "tube", glidem: "legato" },
  },
  "pure sine": {
    d: "no harmonics at all: a pure sine, inaudible on anything small",
    drive: 0, tone: 0.3, shape: 0, decay: 0.45,
    p: { oct: 0, detune: 0, phase: 0.25, drift: 0, drop: 0, droptm: 0.2,
         atk: 0.05, rel: 0.2, click: 0, xover: 0.3, edge: 0,
         hpf: 0.06, glue: 0.15, ceil: 0.9, stack: "1", sat: "tube", glidem: "always" },
  },
  "reese": {
    d: "three detuned oscillators beating against each other and then folded, with a notch sweeping through",
    drive: 0.6, tone: 0.7, shape: 0.75, decay: 0.75,
    p: { oct: 0.3, detune: 0.55, phase: 0, drift: 0.12, drop: 0, droptm: 0.2,
         atk: 0.06, rel: 0.25, click: 0, xover: 0.28, edge: 0.2,
         hpf: 0.12, glue: 0.45, ceil: 0.82, stack: "3", sat: "fold", glidem: "always" },
  },
  "acid": {
    d: "a saw through the 3-pole ladder, squelching on top of a fundamental the filter never reaches. High velocities stack the accents into a climb",
    drive: 0.66, tone: 0.72, shape: 0.66, decay: 0.35,
    p: { oct: 0, detune: 0, phase: 0.25, drift: 0.05, drop: 0, droptm: 0.2,
         atk: 0.01, rel: 0.1, click: 0.06, xover: 0.22, edge: 0.3,
         reso: 0.72, rcut: 0.3, renv: 0.62, rdec: 0.3, racc: 0.6,
         hpf: 0.12, glue: 0.4, ceil: 0.84, stack: "1", sat: "tube", glidem: "legato" },
  },
  "dub": {
    d: "slow in, slow out, an octave underneath and nothing above 200Hz",
    drive: 0.14, tone: 0.18, shape: 0.12, decay: 0.7,
    p: { oct: 0.55, detune: 0.08, phase: 0, drift: 0.14, drop: 0, droptm: 0.2,
         atk: 0.22, rel: 0.4, click: 0, xover: 0.2, edge: 0.15,
         hpf: 0.02, glue: 0.5, ceil: 0.88, stack: "2", sat: "tube", glidem: "always" },
  },
  "drill slide": {
    d: "808 with the glide on legato, so tied notes slide into each other and separate ones do not",
    drive: 0.58, tone: 0.5, shape: 0, decay: 0.55,
    p: { oct: 0, detune: 0, phase: 0.25, drift: 0.05, drop: 0.12, droptm: 0.1,
         atk: 0.01, rel: 0.08, click: 0.18, xover: 0.36, edge: 0.45,
         hpf: 0.1, glue: 0.38, ceil: 0.84, stack: "1", sat: "tube", glidem: "legato" },
  },
  "memphis": {
    d: "driven hard through a fuzz, tone up, glue hard. Saturated and dirty",
    drive: 0.9, tone: 0.78, shape: 0.3, decay: 0.5,
    p: { oct: 0.15, detune: 0, phase: 0.25, drift: 0.2, drop: 0.18, droptm: 0.2,
         atk: 0.01, rel: 0.12, click: 0.35, xover: 0.3, edge: 0.7,
         hpf: 0.16, glue: 0.65, ceil: 0.72, stack: "1", sat: "fuzz", glidem: "legato" },
  },
  "house sub": {
    d: "short and tight: a clean fundamental with just enough top to be findable",
    drive: 0.38, tone: 0.45, shape: 0.35, decay: 0.2,
    p: { oct: 0.1, detune: 0, phase: 0.25, drift: 0.03, drop: 0.05, droptm: 0.08,
         atk: 0.02, rel: 0.06, click: 0.08, xover: 0.32, edge: 0.25,
         hpf: 0.18, glue: 0.3, ceil: 0.88, stack: "1", sat: "tube", glidem: "always" },
  },
  "growl": {
    d: "folded hard and wide open on top: the harmonics carry the note and the sub sits underneath to be felt",
    drive: 0.95, tone: 0.9, shape: 0.6, decay: 0.7,
    p: { oct: 0.4, detune: 0.3, phase: 0, drift: 0.1, drop: 0, droptm: 0.2,
         atk: 0.04, rel: 0.2, click: 0, xover: 0.42, edge: 0.6,
         hpf: 0.14, glue: 0.55, ceil: 0.78, stack: "2", sat: "fold", glidem: "always" },
  },
  "cinematic drop": {
    d: "a very deep, very slow pitch fall onto the note, rectified so the octave above carries it. Needs a long step",
    drive: 0.5, tone: 0.35, shape: 0.05, decay: 0.85,
    p: { oct: 0.5, detune: 0.12, phase: 0.25, drift: 0.08, drop: 0.75, droptm: 0.62,
         atk: 0.03, rel: 0.5, click: 0.1, xover: 0.24, edge: 0.3,
         hpf: 0.04, glue: 0.6, ceil: 0.9, stack: "2", sat: "rect", glidem: "always" },
  },
};

export const SUB_TONE_NAMES = Object.keys(SUB_TONES);

/** One line saying what a tone is reaching for. @param {string} name */
export function subToneDescription(name) { return SUB_TONES[name]?.d ?? ""; }

/**
 * A tone as a complete set of track params — every panel control plus the four
 * track sliders, so nothing of the last patch survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function subTone(name) {
  const v = SUB_TONES[name];
  if (!v) return null;
  const out = { ...SUB_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`sub${k}`] = val;
  out.harm = v.drive; out.timb = v.tone; out.morph = v.shape; out.decay = v.decay;
  return out;
}

// ---- granular (voices.js) ---------------------------------------------------
// Musical division → beats (quarter note = 1 beat) for beat-synced grain rate.
export const GRAN_RATE_BEATS = {
  "1/64": 1 / 16, "1/32t": 1 / 12, "1/32": 1 / 8, "1/16t": 1 / 6, "1/16": 1 / 4,
  "1/8t": 1 / 3, "1/8": 1 / 2, "1/4t": 2 / 3, "1/4": 1, "1/2t": 4 / 3, "1/2": 2,
  "1bar": 4, "2bar": 8, "4bar": 16, "8bar": 32,
};

// gspeed is the play-head rate as a plain multiplier (1 = the sample's own
// speed). Sessions written before it went bipolar stored 0..1 for 0..2× —
// migrateGranularParams() converts those on load.
export const GRAN_DEFAULTS = {
  gplay: "fixed", gspeed: 1, gpitch: 0, gloop: "fwd", gwindow: 0.15, gjitter: 0.1,
  gdetune: 0, gpan: 0.3, gpattern: "none", gsync: false, grate: "1/16",
};

// Speed and pitch are signed, but automation lanes and the mod matrix both
// speak 0..1, so they convert through here — a lane sweeping 0→1 covers exactly
// the same ground as dragging the slider end to end.
// The rest of the grain controls are 0..1 sliders already, but they go through
// the same conversion so every mod/automation path is one code path.
export const GRAN_MOD_RANGE = {
  gspeed: [-2, 2], gpitch: [-24, 24],
  gwindow: [0, 1], gjitter: [0, 1], gdetune: [0, 1], gpan: [0, 1],
};
/** 0..1 → the param's own units. @param {string} key @param {number} v */
export function granFromUnit(key, v) {
  const [lo, hi] = GRAN_MOD_RANGE[key];
  return lo + Math.max(0, Math.min(1, Number(v) || 0)) * (hi - lo);
}
/** The param's own units → 0..1. @param {string} key @param {number} x */
export function granToUnit(key, x) {
  const [lo, hi] = GRAN_MOD_RANGE[key];
  return Math.max(0, Math.min(1, ((Number(x) || 0) - lo) / (hi - lo)));
}

// Granular params the track group / WAV modal drive, in UI order. The lists in
// render.js, session.js and stepEditor.js walk these.
export const GRAN_NUM_KEYS = ["gspeed", "gpitch", "gwindow", "gjitter", "gdetune", "gpan"];
export const GRAN_SEL_KEYS = ["gplay", "gloop", "gpattern", "grate"];
