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
    harm: "detuning between the two oscillators",
    timb: "pulse width of the square",
    morph: "the second wave's shape, sweeping triangle to saw",
    decay: PLAITS_LPG_DECAY },
  { // 1 waveshaping
    harm: "which waveshaping curve the oscillator is pushed through",
    timb: "wavefolder amount",
    morph: "asymmetry of the waveform",
    decay: PLAITS_LPG_DECAY },
  { // 2 fm
    harm: "frequency ratio between the two operators",
    timb: "modulation index: how hard operator 2 drives operator 1",
    morph: "feedback between the two operators",
    decay: PLAITS_LPG_DECAY },
  { // 3 grain
    harm: "ratio between the two formant frequencies",
    timb: "formant frequency the grains are shaped around",
    morph: "shape and width of the grain window",
    decay: PLAITS_LPG_DECAY },
  { // 4 additive
    harm: "how the energy is grouped across the harmonic series",
    timb: "sweeps the emphasised peak up and down that series",
    morph: "how wide the peak spreads",
    decay: PLAITS_LPG_DECAY },
  { // 5 wavetable
    harm: "which bank of wavetables is read",
    timb: "position along the wavetable map",
    morph: "position across the map's other axis",
    decay: PLAITS_LPG_DECAY },
  { // 6 chord
    harm: "which chord is played",
    timb: "the chord's inversion and spread",
    morph: "the waveform the four voices use",
    decay: PLAITS_LPG_DECAY },
  { // 7 speech
    harm: "the sound bank: formant filtering or a speech-synth mode",
    timb: "species: shifts the formants",
    morph: "which phoneme or word comes out",
    decay: PLAITS_LPG_DECAY },
  { // 8 swarm
    harm: "how far the swarm's voices scatter in pitch",
    timb: "density of the swarm",
    morph: "grain duration and envelope shape",
    decay: PLAITS_LPG_DECAY },
  { // 9 noise
    harm: "spacing between the two resonant peaks",
    timb: "where those peaks sit",
    morph: "how narrow they are",
    decay: PLAITS_LPG_DECAY },
  { // 10 particle
    harm: "how far each particle's pitch is randomised",
    timb: "particle density",
    morph: "resonance and ring of the filter each particle is fired through",
    decay: PLAITS_LPG_DECAY },
  { // 11 string
    harm: "inharmonicity: how stiff the string is",
    timb: "brightness of the excitation that plucks it",
    morph: "how long it rings",
    decay: PLAITS_LPG_DECAY },
  { // 12 modal
    harm: "the material's inharmonicity",
    timb: "brightness and grit of the strike",
    morph: "how long the resonator rings",
    decay: PLAITS_LPG_DECAY },
  { // 13 bass drum
    harm: "attack sharpness and overdrive",
    timb: "brightness: click against body",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 14 snare drum
    harm: "balance between the drum's tone and its noise",
    timb: "brightness: how much noise is filtered away",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 15 hi hat
    harm: "balance between the metallic cluster and plain noise",
    timb: "brightness of the filter that cluster runs through",
    morph: "decay, closed at the bottom and open at the top",
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
    harm: "speed and depth of the LFO sweeping the pulse width",
    timb: "the pulse wave's resting width",
    osc: {
      osc1: "level of the sawtooth, the main voice",
      osc2: "level of the pulse wave",
      osc3: "level of the triangle, the one the metalizer folds",
      osc4: "level of the sub oscillator, an octave below",
    },
    oscMod: {
      ultra: "ultrasaw: detuned copies stacked around the saw",
      fm: "audio-rate frequency modulation from the sub",
      metal: "metalizer: folds the triangle back into hard upper harmonics",
    },
  },
  "dm:ladder": {
    harm: "how far oscillator 2 sits off oscillator 1",
    decay: "how long a note falls away, and how much of the warming filter stage rides along",
    osc: {
      osc1: "level of oscillator 1 in the mixer",
      osc2: "level of oscillator 2, the detuned one",
      osc3: "level of oscillator 3, usually dropped an octave",
    },
  },
  "dm:drift": {
    harm: "speed and depth of the LFO sweeping the DCO's pulse width",
    timb: "the pulse's resting width",
    morph: "the chorus, wet and depth together",
    decay: "how long a note falls away, and the high-pass with it",
    osc: {
      osc1: "level of the main DCO",
      osc2: "level of the square sub, an octave below",
      osc3: "level of the noise source",
    },
  },
  "dm:tines": {
    harm: "the ratio between the tine and the tone bar",
    timb: "how hard the hammer hits",
    morph: "how much chorus is on the output",
    decay: "how long each note rings, and how long it takes to let go",
  },
  "dm:oracle": {
    harm: "detunes VCO2 against VCO1",
    timb: "crossfades VCO2 from saw to pulse",
    morph: "how much of the output runs through the overdrive stage",
    decay: "how long each note falls away, and its release with it",
    osc: {
      osc1: "level of VCO1",
      osc2: "level of VCO2, the detuned one",
      osc3: "level of the sub oscillator",
      osc4: "level of the noise source",
    },
  },
  "wt:akwf": {
    harm: "position across the table, morphing between frames",
    timb: "a lowpass on each voice, on top of the track filter",
    morph: "how far the stacked unison voices spread in pitch",
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
  // An equation oscillator into an MS-20 style filter, a reverse-capable
  // delay and a granular cloud, after the Grone. Polyphony lives in
  // the worklet (drone.js), so a held chord can fade under the next one.
  { key: "dm:drone",     label: "drone",           defaultNote: 36, poly: true, melodic: true },
  // A singing voice: a glottal pulse through five formants, consonants in
  // front of the vowel, a choir of up to eight per note (vox.js).
  { key: "dm:vox",       label: "vox",             defaultNote: 60, poly: true, melodic: true },
  // A snare synthesizer with seven models (lancet.js). One-shot percussion:
  // four hits sounding at once inside the worklet. C2, the note a drum kit's
  // blank steps get, is the pitch knob's middle.
  { key: "dm:lancet",      label: "lancet",            defaultNote: 36, poly: false, melodic: false },
  // The bass drum synth: a sine under a pitch envelope, a drive that folds
  // or clips after the amplitude envelope. One voice, a kick (siege.js). Not
  // melodic: its blank steps are C2, though it plays V/oct.
  { key: "dm:siege",       label: "siege",             defaultNote: 36, poly: false, melodic: false },
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

// Acoustic kits, rendered from three open sample libraries by
// scripts/make-drum-kits.mjs (which says which hit and which mics each file is)
// and served from the site itself, public/samples/<kit>/<part>.mp3. The same
// nine pieces in each, so a part can move between kits by changing the kit.
// Each library asks for its credit, and the sampler's source picker gives it.
export const KIT_SAMPLE_BASE = "/samples";
export const KIT_PARTS = [
  ["kick", "kick"], ["snare", "snare"], ["rim", "rim"], ["hihat", "hat"], ["openhat", "open hat"],
  ["tom1", "high tom"], ["tom2", "floor tom"], ["ride", "ride"], ["crash", "crash"],
];
export const ACOUSTIC_KITS = [
  {
    id: "salamander", label: "salamander", title: "Salamander Drumkit", author: "Alexander Holm",
    url: "https://archive.org/details/SalamanderDrumkit",
    license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
  {
    id: "virtuosity", label: "virtuosity", title: "Virtuosity Drums", author: "Versilian Studios",
    url: "https://github.com/sfzinstruments/virtuosity_drums",
    license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  {
    id: "drskit", label: "drs", title: "DRSKit", author: "DrumGizmo & DRSDrums",
    url: "https://drumgizmo.org/wiki/doku.php?id=kits:drskit",
    license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
];

// Bundled samples offered inside the sampler's source picker (id = key sans
// "smp:", used to build the load URL and stored as t.sampleSource.id). `kit`
// groups them in the picker. The acoustic kits never had `smp:` engine keys,
// so they are listed here and not in SAMPLE_ENGINES.
const kitOfId = (id) => id.split("/")[0];
export const BUNDLED_SAMPLES = [
  ...SAMPLE_ENGINES.map(e => {
    const id = e.key.replace(/^smp:/, "");
    return { id, label: e.label, kit: kitOfId(id) };
  }),
  ...ACOUSTIC_KITS.flatMap(k => KIT_PARTS.map(([part, name]) => ({
    id: `${k.id}/${part}`, label: `${k.label} ${name}`, kit: k.id,
  }))),
];
// The picker's heading over each kit.
export const SAMPLE_KIT_LABELS = {
  Techno: "techno", CR78: "cr78", breakbeat13: "breakbeat", "acoustic-kit": "live",
  R8: "r8", ...Object.fromEntries(ACOUSTIC_KITS.map(k => [k.id, k.title.toLowerCase()])),
};
const LOCAL_KITS = new Set(ACOUSTIC_KITS.map(k => k.id));
/** Where a bundled sample (`t.sampleSource.id`) is fetched from. */
export function bundledSampleUrl(id) {
  const s = String(id);
  return LOCAL_KITS.has(kitOfId(s)) ? `${KIT_SAMPLE_BASE}/${s}.mp3` : `${SAMPLE_BASE}/${s}.mp3`;
}

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
    case "dm:siege":       return { harm: "drive",    timb: "click",  morph: "depth",     decay: "decay" };
    case "dm:drone":     return { harm: "cutoff",   timb: "a0",     morph: "a1",        decay: "a2" };
    case "dm:vox":       return { harm: "vowel",    timb: "size",   morph: "breath",    decay: "release" };
    case "dm:lancet":      return { harm: "timbre",   timb: "color",  morph: "fx",        decay: "decay" };
    case "dm:tines":     return { harm: "tine",     timb: "bite",   morph: "chorus",    decay: "decay" };
    case "dm:oracle":    return { harm: "detune",   timb: "shape",  morph: "drive",     decay: "decay" };
    case "dm:granular":  return { harm: "grain",    timb: "dense",  morph: "pos",       decay: "spray" };
    case "wt:akwf":      return { harm: "wave",     timb: "warm",   morph: "detune",    decay: "decay" };
    case "dm:silverbox": return { harm: "cutoff",   timb: "reso",   morph: "env mod",   decay: "decay" };
    case "dm:contagion": return { harm: "cutoff",   timb: "reso",   morph: "shape 1",   decay: "decay" };
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
  "vosc2semi", "vosc2det", "vpw", "vshape2", "vpw2", "vfm", "vring",
  "vunidet", "vunispread",
  "vcut2", "vreso2", "vbal", "vsatamt", "venvamt",
  "vatk", "vsus", "vrel", "vslope",
  "vfatk", "vfdec", "vfsus", "vfrel", "vfslope",
];
export const CONTAGION_SEL_KEYS = ["vmode1", "vpoles", "vmode2", "vroute", "vsat", "vsubwave", "vsync", "vuni"];

export const CONTAGION_DEFAULTS = {
  vosc2semi: 0, vosc2det: 0.08, vpw: 0.5, vshape2: 0.5, vpw2: 0.5, vfm: 0, vring: 0,
  vunidet: 0.3, vunispread: 0.6,
  vcut2: 0, vreso2: 0.5, vbal: 0, vsatamt: 0.3, venvamt: 0.5,
  vatk: 0.02, vsus: 0.6, vrel: 0.25, vslope: 0,
  // The filter envelope starts where the amp envelope does (decay at the
  // track decay slider's default), which is how the two used to share one.
  vfatk: 0.02, vfdec: 0.4, vfsus: 0.6, vfrel: 0.25, vfslope: 0,
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
    d: "neck and bridge together, barely breaking up and chiming, picked over the neck",
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
    d: "neck humbucker with the guitar's tone knob rolled right down, into a cranked amp, dark and vocal",
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
    d: "a brit amp pushed into mush with the mids up, strings picked hard, loose and honking",
    drive: 0.8, tone: 0.55, bloom: 0.3, sustain: 0.45,
    p: { pick: 0.14, pnoise: 0.95, stiff: 0.45, pkup: 0.16, mute: 0.2,
         bass: 0.65, mid: 0.72, treb: 0.62, pres: 0.5, mast: 0.7, sag: 0.6,
         mic: 0.35, trem: 0, tremr: 0.4, sprg: 0.15,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "jazz box": {
    d: "neck humbucker, thumb rather than pick, tone rolled back into an amp that never breaks up, round and dark",
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
    d: "flatwounds on a precision with a foam mute under the bridge, tone rolled off into a small valve amp, all fundamental",
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
    d: "thumb against the frets, fresh roundwounds, mids scooped out and compressed hard, all the clank left in",
    drive: 0.3, tone: 0.95, comp: 0.75, sustain: 0.6,
    p: { pick: 0.04, attack: 0.85, stiff: 0.7, pkup: 0.06, mute: 0, fret: 0.85,
         grind: 0.1, xover: 0.5, sub: 0,
         bass: 0.72, lomid: 0.25, himid: 0.35, treb: 0.85, hpf: 0.25, mic: 0.7,
         amp: "di", cab: "4x10", pkupt: "mm", strs: "round" },
  },
  "dub": {
    d: "neck pickup, flatwounds, tone down and the palm resting on the strings, through a fifteen-inch speaker",
    drive: 0.5, tone: 0.06, comp: 0.6, sustain: 0.35,
    p: { pick: 0.3, attack: 0.15, stiff: 0.15, pkup: 0.34, mute: 0.6, fret: 0.05,
         grind: 0, xover: 0.4, sub: 0.2,
         bass: 0.85, lomid: 0.6, himid: 0.25, treb: 0.1, hpf: 0.05, mic: 0.2,
         amp: "flip", cab: "1x15", pkupt: "p", strs: "flat" },
  },
  "modern di": {
    d: "straight into the desk, both pickups, compressed flat and even and uncoloured",
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
    d: "a jazz bass on the bridge pickup with the mids up and just enough dirt to snarl, nasal and forward",
    drive: 0.6, tone: 0.8, comp: 0.4, sustain: 0.6,
    p: { pick: 0.07, attack: 0.55, stiff: 0.55, pkup: 0.05, mute: 0, fret: 0.35,
         grind: 0.4, xover: 0.45, sub: 0,
         bass: 0.45, lomid: 0.4, himid: 0.72, treb: 0.62, hpf: 0.28, mic: 0.55,
         amp: "svt", cab: "8x10", pkupt: "j", strs: "round" },
  },
  "octave sub": {
    d: "an octaver under the note with the top filtered off, half bass and half synth",
    drive: 0.3, tone: 0.3, comp: 0.65, sustain: 0.5,
    p: { pick: 0.2, attack: 0.3, stiff: 0.3, pkup: 0.2, mute: 0.15, fret: 0.1,
         grind: 0.12, xover: 0.55, sub: 0.85,
         bass: 0.7, lomid: 0.5, himid: 0.35, treb: 0.3, hpf: 0.08, mic: 0.35,
         amp: "di", cab: "1x15", pkupt: "mm", strs: "round" },
  },
  "pop punk": {
    d: "plectrum, roundwounds, the mids pulled out and the top wound up until every note is an attack, bright and fast",
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
    d: "a saw through the 3-pole ladder, squelching on top of a fundamental the filter never reaches",
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
    d: "driven hard through a fuzz, tone up and glue hard, saturated and dirty",
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
    d: "a very deep, very slow pitch fall onto the note, rectified so the octave above carries it",
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

// ---- drone (drone.js) -------------------------------------------------------
// The equation oscillator's sixteen formulas and the LFO's eight shapes, by
// name. The select stores the NAME, so a song reads `drneq: "octaves"` rather
// than an index into a list that could be reordered.
export const DRONE_EQUATIONS = [
  "sierpinski", "or", "xor", "fifths", "harmonics", "smear", "stairs", "octaves",
  "sweep", "pulse bits", "gates", "thirds", "arp", "fold", "split", "chaos",
];
export const DRONE_LFO_SHAPES = ["up", "down", "square", "tri", "sine", "sweep", "random", "slopes"];

/** Numeric panel controls: [short key, min, max, default, label]. */
export const DRONE_NUM_CTLS = [
  ["rate",    0, 1, 0.5,  "rate"],
  ["osc",     0, 1, 0.8,  "osc level"],
  ["noise",   0, 1, 0,    "noise"],
  ["atk",     0, 1, 0.3,  "attack"],
  ["rel",     0, 1, 0.5,  "release"],
  ["reso",    0, 1, 0.35, "reso"],
  ["drive",   0, 1, 0.2,  "drive"],
  ["mod1",    0, 1, 0.3,  "lfo to cutoff"],
  ["lrate",   0, 1, 0.25, "lfo rate"],
  ["ldly",    0, 1, 0,    "lfo to delay"],
  ["dtime",   0, 1, 0.45, "delay time"],
  ["dfbk",    0, 1, 0.45, "delay feedback"],
  ["dmix",    0, 1, 0.25, "delay mix"],
  ["cpos",    0, 1, 0.3,  "cloud position"],
  ["csize",   0, 1, 0.5,  "cloud size"],
  ["cpitch",  0, 1, 0.5,  "cloud pitch"],
  ["cdens",   0, 1, 0.5,  "cloud density"],
  ["ctex",    0, 1, 0.5,  "cloud texture"],
  ["cspread", 0, 1, 0.5,  "cloud spread"],
  ["cfbk",    0, 1, 0.3,  "cloud feedback"],
  ["cmix",    0, 1, 0.35, "cloud blend"],
];

/** Select controls: [short key, default, [values]]. */
export const DRONE_SEL_CTLS = [
  ["eq",     "octaves", DRONE_EQUATIONS],
  ["hold",   "latch",   ["latch", "gate"]],
  ["lshape", "tri",     DRONE_LFO_SHAPES],
  ["dir",    "forward", ["forward", "reverse"]],
  ["freeze", "off",     ["off", "on"]],
];

export const DRONE_MOD_KEYS = DRONE_NUM_CTLS.map(c => c[0]);
export const DRONE_NUM_KEYS = DRONE_MOD_KEYS.map(k => `drn${k}`);
export const DRONE_SEL_KEYS = DRONE_SEL_CTLS.map(c => `drn${c[0]}`);

export const DRONE_MOD_RANGE = Object.fromEntries(DRONE_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const DRONE_MOD_LABELS = Object.fromEntries(
  DRONE_NUM_CTLS.map(([k, , , , label]) => [k, `drone ${label}`]));

export const DRONE_DEFAULTS = {
  ...Object.fromEntries(DRONE_NUM_CTLS.map(c => [`drn${c[0]}`, c[3]])),
  ...Object.fromEntries(DRONE_SEL_CTLS.map(c => [`drn${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function droneFromUnit(k, u) {
  const [lo, hi] = DRONE_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the patches ----------------------------------------------------------
// Complete patches: every panel control plus the four track sliders (cutoff and
// the equation's A0 / A1 / A2), so nothing of the last one survives a load.
const DRONE_TONES = {
  "dark grone": {
    d: "the box's own sound: an xor equation through a resonant filter breathing on a slow triangle, into a wide cloud",
    cut: 0.42, a0: 0.3, a1: 0.55, a2: 0.7,
    p: { eq: "xor", hold: "latch", rate: 0.5, osc: 0.8, noise: 0.08, atk: 0.5, rel: 0.6,
         reso: 0.62, drive: 0.35, mod1: 0.35, lshape: "tri", lrate: 0.2, ldly: 0,
         dtime: 0.55, dfbk: 0.5, dmix: 0.3, dir: "forward",
         cpos: 0.35, csize: 0.62, cpitch: 0.5, cdens: 0.55, ctex: 0.62, cspread: 0.7, cfbk: 0.45, cmix: 0.45, freeze: "off" },
  },
  "cathedral": {
    d: "octave-stepping ramps under long grains pitched an octave up and fed back: a shimmer that never settles",
    cut: 0.58, a0: 0.1, a1: 0.9, a2: 0.8,
    p: { eq: "octaves", hold: "latch", rate: 0.5, osc: 0.75, noise: 0, atk: 0.7, rel: 0.8,
         reso: 0.2, drive: 0.1, mod1: 0.15, lshape: "sine", lrate: 0.1, ldly: 0,
         dtime: 0.7, dfbk: 0.55, dmix: 0.25, dir: "forward",
         cpos: 0.5, csize: 0.85, cpitch: 0.75, cdens: 0.7, ctex: 0.8, cspread: 0.9, cfbk: 0.6, cmix: 0.6, freeze: "off" },
  },
  "machine hum": {
    d: "an OR equation through a tight, resonant filter gated by a square LFO: a transformer in the next room",
    cut: 0.3, a0: 0.55, a1: 0.35, a2: 0.2,
    p: { eq: "or", hold: "latch", rate: 0.5, osc: 0.8, noise: 0.04, atk: 0.2, rel: 0.4,
         reso: 0.75, drive: 0.5, mod1: 0.2, lshape: "square", lrate: 0.45, ldly: 0,
         dtime: 0.2, dfbk: 0.3, dmix: 0.2, dir: "forward",
         cpos: 0.2, csize: 0.4, cpitch: 0.5, cdens: 0.5, ctex: 0.5, cspread: 0.4, cfbk: 0.2, cmix: 0.15, freeze: "off" },
  },
  "bit swarm": {
    d: "the chaos equation scattered into dense, short, hard-edged grains across the whole stereo field",
    cut: 0.7, a0: 0.7, a1: 0.3, a2: 0.45,
    p: { eq: "chaos", hold: "latch", rate: 0.5, osc: 0.7, noise: 0, atk: 0.3, rel: 0.5,
         reso: 0.3, drive: 0.2, mod1: 0.4, lshape: "random", lrate: 0.55, ldly: 0,
         dtime: 0.35, dfbk: 0.35, dmix: 0.15, dir: "forward",
         cpos: 0.25, csize: 0.2, cpitch: 0.5, cdens: 0.9, ctex: 0.2, cspread: 1, cfbk: 0.2, cmix: 0.6, freeze: "off" },
  },
  "reverse tide": {
    d: "fifths through the delay played backwards and fed back, the LFO bending its time",
    cut: 0.5, a0: 0.4, a1: 0.6, a2: 0.6,
    p: { eq: "fifths", hold: "latch", rate: 0.5, osc: 0.8, noise: 0, atk: 0.6, rel: 0.7,
         reso: 0.45, drive: 0.2, mod1: 0.25, lshape: "sine", lrate: 0.15, ldly: 0.2,
         dtime: 0.75, dfbk: 0.6, dmix: 0.55, dir: "reverse",
         cpos: 0.3, csize: 0.6, cpitch: 0.5, cdens: 0.5, ctex: 0.6, cspread: 0.6, cfbk: 0.3, cmix: 0.3, freeze: "off" },
  },
  "arp ghost": {
    d: "the melody-table equation spelling out root, ninth, third and fifth, with the filter wandering on random slopes",
    cut: 0.6, a0: 0.5, a1: 0.45, a2: 0.5,
    p: { eq: "arp", hold: "latch", rate: 0.5, osc: 0.75, noise: 0, atk: 0.25, rel: 0.6,
         reso: 0.5, drive: 0.25, mod1: 0.3, lshape: "slopes", lrate: 0.3, ldly: 0,
         dtime: 0.4, dfbk: 0.5, dmix: 0.35, dir: "forward",
         cpos: 0.4, csize: 0.55, cpitch: 0.5, cdens: 0.5, ctex: 0.55, cspread: 0.7, cfbk: 0.35, cmix: 0.4, freeze: "off" },
  },
  "subterranean": {
    d: "stairs an octave down, driven, with noise, the filter falling on a slow sweep and the cloud an octave under that",
    cut: 0.25, a0: 0.35, a1: 0.7, a2: 0.5,
    p: { eq: "stairs", hold: "latch", rate: 0.25, osc: 0.85, noise: 0.2, atk: 0.5, rel: 0.7,
         reso: 0.4, drive: 0.6, mod1: 0.45, lshape: "sweep", lrate: 0.15, ldly: 0,
         dtime: 0.6, dfbk: 0.4, dmix: 0.2, dir: "forward",
         cpos: 0.45, csize: 0.9, cpitch: 0.25, cdens: 0.45, ctex: 0.7, cspread: 0.5, cfbk: 0.3, cmix: 0.4, freeze: "off" },
  },
  "screamer": {
    d: "the gates equation into the filter at the edge of self-oscillation, driven, the cutoff climbing on a ramp",
    cut: 0.45, a0: 0.6, a1: 0.4, a2: 0.55,
    p: { eq: "gates", hold: "latch", rate: 0.5, osc: 0.75, noise: 0.05, atk: 0.15, rel: 0.4,
         reso: 0.95, drive: 0.8, mod1: 0.6, lshape: "up", lrate: 0.4, ldly: 0,
         dtime: 0.3, dfbk: 0.4, dmix: 0.2, dir: "forward",
         cpos: 0.2, csize: 0.45, cpitch: 0.5, cdens: 0.4, ctex: 0.5, cspread: 0.5, cfbk: 0.2, cmix: 0.2, freeze: "off" },
  },
  "glacier": {
    d: "harmonics smeared into second-long soft grains from far back in the buffer, fed back until the notes blur into one",
    cut: 0.5, a0: 0.2, a1: 0.8, a2: 0.75,
    p: { eq: "harmonics", hold: "latch", rate: 0.5, osc: 0.95, noise: 0.03, atk: 0.8, rel: 0.9,
         reso: 0.3, drive: 0.15, mod1: 0.2, lshape: "tri", lrate: 0.08, ldly: 0.1,
         dtime: 0.8, dfbk: 0.5, dmix: 0.3, dir: "forward",
         cpos: 0.9, csize: 1, cpitch: 0.5, cdens: 0.55, ctex: 0.9, cspread: 0.8, cfbk: 0.75, cmix: 0.7, freeze: "off" },
  },
};

export const DRONE_TONE_NAMES = Object.keys(DRONE_TONES);

/** One line saying what a patch is reaching for. @param {string} name */
export function droneToneDescription(name) { return DRONE_TONES[name]?.d ?? ""; }

/**
 * A patch as a complete set of track params -- every panel control plus the
 * four track sliders, so nothing of the last patch survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function droneTone(name) {
  const v = DRONE_TONES[name];
  if (!v) return null;
  const out = { ...DRONE_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`drn${k}`] = val;
  out.harm = v.cut; out.timb = v.a0; out.morph = v.a1; out.decay = v.a2;
  return out;
}

// ---- vox (vox.js) -----------------------------------------------------------
// A singing voice: a glottal pulse through a bank of five formants, with
// consonants in front of the vowel. What follows is the voice as DATA, so the
// song builder and the tests read the same tables the processor is built from.

// The vowels, in the order the vowel slider walks them: back and rounded to
// front and spread, so a sweep moves the tongue one way (u o a e i) instead of
// jumping about. Every lookup is by position on this line, 0..1.
export const VOX_VOWELS = ["u", "o", "a", "e", "i"];

// Five formants per vowel per voice type: [Hz x5], [dB x5], [bandwidth Hz x5].
// These are the classic singer tables (the ones Csound's FOF examples ship
// with, after Peterson & Barney and Sundberg's singer measurements): the
// soprano's and alto's formants sit higher than the tenor's and bass's, the
// tenor's and bass's 3rd-5th crowd together into the singer's formant. Read
// as character, not as a reproduction of anybody. The size slider walks
// soprano -> alto -> tenor -> bass.
export const VOX_FORMANTS = [
  { name: "soprano", v: {
    u: [[325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]],
    o: [[450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]],
    a: [[800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]],
    e: [[350, 2000, 2800, 3600, 4950], [0, -20, -15, -40, -56], [60, 100, 120, 150, 200]],
    i: [[270, 2140, 2950, 3900, 4950], [0, -12, -26, -26, -44], [60, 90, 100, 120, 120]],
  } },
  { name: "alto", v: {
    u: [[325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]],
    o: [[450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]],
    a: [[800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]],
    e: [[400, 1600, 2700, 3300, 4950], [0, -24, -30, -35, -60], [60, 80, 120, 150, 200]],
    i: [[350, 1700, 2700, 3700, 4950], [0, -20, -30, -36, -60], [50, 100, 120, 150, 200]],
  } },
  { name: "tenor", v: {
    u: [[350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]],
    o: [[400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]],
    a: [[650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]],
    e: [[400, 1700, 2600, 3200, 3580], [0, -14, -12, -14, -20], [70, 80, 100, 120, 120]],
    i: [[290, 1870, 2800, 3250, 3540], [0, -15, -18, -20, -30], [40, 90, 100, 120, 120]],
  } },
  { name: "bass", v: {
    u: [[350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]],
    o: [[400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]],
    a: [[600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]],
    e: [[400, 1620, 2400, 2800, 3100], [0, -12, -9, -12, -18], [40, 80, 100, 120, 120]],
    i: [[250, 1750, 2600, 3050, 3340], [0, -30, -16, -22, -28], [60, 90, 100, 120, 120]],
  } },
];

/**
 * The formants at a vowel position and a size, both 0..1: bilinear across the
 * vowel line and the four voice types. Pure, so the tests and the processor's
 * flattened table can be checked against it.
 * @returns {{f:number[], db:number[], bw:number[]}}
 */
export function voxFormantsAt(vowel, size) {
  const vp = Math.max(0, Math.min(1, vowel)) * (VOX_VOWELS.length - 1);
  const sp = Math.max(0, Math.min(1, size)) * (VOX_FORMANTS.length - 1);
  const v0 = Math.min(VOX_VOWELS.length - 2, Math.floor(vp)), vf = vp - v0;
  const s0 = Math.min(VOX_FORMANTS.length - 2, Math.floor(sp)), sf = sp - s0;
  const at = (s, v, k, i) => VOX_FORMANTS[s].v[VOX_VOWELS[v]][k][i];
  const mix = (k, i) =>
    (at(s0, v0, k, i) * (1 - vf) + at(s0, v0 + 1, k, i) * vf) * (1 - sf) +
    (at(s0 + 1, v0, k, i) * (1 - vf) + at(s0 + 1, v0 + 1, k, i) * vf) * sf;
  const out = { f: [], db: [], bw: [] };
  for (let i = 0; i < 5; i++) { out.f.push(mix(0, i)); out.db.push(mix(1, i)); out.bw.push(mix(2, i)); }
  return out;
}

// The consonants a note can start with. Each is a short script run from the
// moment the note begins, before the vowel:
//   fric   [ms, Hz, Q, level]  noise through a bandpass: the hiss of s, sh, f
//   burst  [ms, Hz, Q, level]  the release of a closure: the click of t, k, p
//   vot    ms                  voice onset time: when the vowel's voicing starts
//   pre    0..1                how much voicing there is before that (z, v, b)
//   asp    0..1                breath through the vowel's own formants until then
//                              (the h, and the puff after an unvoiced plosive)
//   locus  [F1, F2, F3]        where the formants start before gliding to the vowel
//   trans  ms                  how long that glide takes
//   mur    [ms, level, damp]   a murmur first: m, n, l, w, y, r are voiced at
//                              `level` on the locus formants, the upper ones
//                              scaled by `damp`, for `ms`, then glide out
// The voicing is pushed back by up to `vot`, so the vowel lands on the step
// and the consonant before it, the way a singer places a word (vox.js).
export const VOX_CONSONANTS = {
  none: {},
  h:  { vot: 70, asp: 0.9 },
  s:  { fric: [110, 6500, 1.8, 0.7],  vot: 110, locus: [350, 1700, 2600], trans: 40 },
  sh: { fric: [120, 3000, 2.2, 0.75], vot: 120, locus: [300, 1900, 2400], trans: 50 },
  f:  { fric: [90, 5000, 0.5, 0.35],  vot: 90,  locus: [300, 1000, 2400], trans: 40 },
  z:  { fric: [90, 6000, 1.8, 0.45],  vot: 90,  pre: 0.4,  locus: [300, 1700, 2600], trans: 40 },
  v:  { fric: [80, 4000, 0.5, 0.25],  vot: 80,  pre: 0.45, locus: [300, 1000, 2400], trans: 40 },
  p:  { burst: [10, 900, 0.8, 0.9],   vot: 45,  asp: 0.45, locus: [300, 800, 2200],  trans: 45 },
  t:  { burst: [10, 4200, 1.4, 0.9],  vot: 50,  asp: 0.45, locus: [300, 1800, 2700], trans: 45 },
  k:  { burst: [15, 2200, 2, 0.9],    vot: 55,  asp: 0.45, locus: [300, 1900, 2400], trans: 50 },
  b:  { burst: [8, 900, 0.8, 0.5],    vot: 10,  pre: 0.3,  locus: [250, 800, 2200],  trans: 40 },
  d:  { burst: [8, 4000, 1.4, 0.5],   vot: 10,  pre: 0.3,  locus: [250, 1800, 2700], trans: 40 },
  g:  { burst: [12, 2200, 2, 0.5],    vot: 12,  pre: 0.3,  locus: [250, 1900, 2400], trans: 45 },
  m:  { mur: [70, 0.55, 0.12], locus: [250, 1000, 2300], trans: 40, vot: 30 },
  n:  { mur: [65, 0.55, 0.12], locus: [250, 1600, 2600], trans: 40, vot: 30 },
  l:  { mur: [55, 0.8, 0.45],  locus: [360, 1050, 2800], trans: 45, vot: 25 },
  w:  { mur: [50, 0.85, 0.5],  locus: [300, 650, 2300],  trans: 60, vot: 25 },
  y:  { mur: [45, 0.85, 0.6],  locus: [280, 2200, 3000], trans: 60, vot: 25 },
  r:  { mur: [50, 0.85, 0.6],  locus: [400, 1100, 1650], trans: 60, vot: 25 },
};
export const VOX_CONSONANT_NAMES = Object.keys(VOX_CONSONANTS);

/** A consonant as the flat row the processor reads (vox.js: CONS_FIELDS). */
export const VOX_CONS_FIELDS = 18;
export function voxConsonantRow(name) {
  const c = VOX_CONSONANTS[name] ?? {};
  const fr = c.fric ?? [0, 1000, 1, 0], bu = c.burst ?? [0, 1000, 1, 0];
  const lo = c.locus ?? [0, 0, 0], mu = c.mur ?? [0, 1, 1];
  return [...fr, ...bu, c.vot ?? 0, c.pre ?? 0, c.asp ?? 0, ...lo, c.trans ?? 0, ...mu];
}

// Syllable sequences: every note sings the next syllable, chords on one step
// share one, and the phrase starts over when the transport stops. Spelled as
// a typed lyric is (voxSyllables): a consonant, a vowel or two, a consonant.
export const VOX_WORDS = {
  "off":        "",
  "doo wop":    "doo doo doo wop",
  "la la":      "la la la li",
  "ooh aah":    "u u a a",
  "na na":      "na na na ne",
  "shoo bee":   "shoo bee doo wop",
  "ba da":      "ba da ba di",
  "mama":       "ma ma mi a",
  "hey yeah":   "hey yea hey yea",
  "hallelujah": "ha le lu ya",
  "oh no":      "ow now ow now",
  "amen":       "a men",
  "hum":        "mmm",
};
export const VOX_WORD_NAMES = Object.keys(VOX_WORDS);

// Letters with no consonant of their own, read as the nearest one there is,
// so a lyric typed as ordinary spelling still comes out as something: `ch`
// and `j` lean on sh and d, a hard `c` / `q` is k, `x` is s, `th` is d.
const VOX_CONS_ALIASES = { ch: "sh", th: "d", ph: "f", wh: "w", c: "k", q: "k", j: "d", x: "s" };
// The longest syllable a lyric may have; the processor keeps 128.
export const VOX_MAX_SYLLABLES = 128;
// How long a typed lyric may be, in characters.
export const VOX_TEXT_MAX = 400;

/** How many numbers a syllable takes in the list the processor is sent. */
export const VOX_SYL_STRIDE = 4;

/**
 * Spell a phrase as syllables the processor can play:
 * [{cons, vowel, vowel2, coda}]. cons and coda are indices into
 * VOX_CONSONANT_NAMES (0 is none); vowel and vowel2 are positions on the vowel
 * line, vowel2 -1 when the vowel holds still, and vowel -2 for a hum: a
 * syllable with no vowel that is all its consonant (`mmm`, `nnn`).
 *
 * Syllables are split by spaces, commas or hyphens (`la-di-da`). Each one is:
 * - the consonant before (longest match first, so `sh` is not `s` + `h`,
 *   then the aliases above), only when something follows it;
 * - the vowel: the first vowel letter, and a second one straight after it is
 *   a glide to that vowel over the note (`ai` eye, `oi` boy, `au` now, `ei`
 *   day, `ou` go). A `y` or `w` straight after the vowel glides to i or u
 *   (`ay`, `ow`). `oo` is u and `ee` is i, as in English. No vowel letter at
 *   all: a `y` is an i, and otherwise the syllable is a hum when its
 *   consonant can be held (m, n, l, r, w, y) and an a when it can't;
 * - the consonant after (`sun`, `night`, `home`): the first one after the
 *   vowel, sung as the note ends. `h` there is silent (`ah`, `oh`). Anything
 *   past it is not sung: one consonant each side.
 * @param {string} text
 */
export function voxSyllables(text) {
  const names = VOX_CONSONANT_NAMES.filter(n => n !== "none");
  const heads = [...names, ...Object.keys(VOX_CONS_ALIASES)].sort((a, b) => b.length - a.length);
  const consOf = (h) => VOX_CONSONANT_NAMES.indexOf(VOX_CONS_ALIASES[h] ?? h);
  const pos = (i) => i / (VOX_VOWELS.length - 1);
  const isV = (ch) => VOX_VOWELS.includes(ch);
  const HELD = new Set(["m", "n", "l", "r", "w", "y"]);
  const out = [];
  const words = String(text || "").toLowerCase().replace(/[^a-z\s,-]/g, "").split(/[\s,-]+/);
  for (const word of words) {
    if (!word) continue;
    if (out.length >= VOX_MAX_SYLLABLES) break;
    const head = heads.find(n => word.startsWith(n) && word.length > n.length) ?? "";
    const rest = word.slice(head.length);
    const cons = head ? consOf(head) : 0;
    const iv = [...rest].findIndex(isV);
    if (iv < 0) {
      if (rest.includes("y")) { out.push({ cons, vowel: pos(4), vowel2: -1, coda: 0 }); continue; }
      // `mmm`: the whole word is one consonant, held
      const only = heads.find(n => word.startsWith(n)) ?? "";
      const c = only ? VOX_CONS_ALIASES[only] ?? only : "";
      if (HELD.has(c)) out.push({ cons: 0, vowel: -2, vowel2: -1, coda: VOX_CONSONANT_NAMES.indexOf(c) });
      else out.push({ cons, vowel: pos(2), vowel2: -1, coda: 0 });
      continue;
    }
    const v1 = rest[iv], n1 = rest[iv + 1] ?? "";
    let vowel = VOX_VOWELS.indexOf(v1), vowel2 = -1, k = iv + 1;
    if (n1 === v1) { if (v1 === "o") vowel = 0; else if (v1 === "e") vowel = 4; k++; }
    else if (isV(n1)) { vowel2 = VOX_VOWELS.indexOf(n1); k++; }
    else if (n1 === "y") { vowel2 = 4; k++; }
    else if (n1 === "w") { vowel2 = 0; k++; }
    while (k < rest.length && isV(rest[k])) k++;
    const tail = rest.slice(k);
    const ch = heads.find(n => tail.startsWith(n)) ?? "";
    const coda = ch && ch !== "h" ? consOf(ch) : 0;
    out.push({ cons, vowel: pos(vowel), vowel2: vowel2 < 0 ? -1 : pos(vowel2), coda });
  }
  return out;
}

/** Numeric panel controls: [short key, min, max, default, label]. */
export const VOX_NUM_CTLS = [
  ["atk",    0, 1, 0.15, "attack"],
  ["bright", 0, 1, 0.5,  "brightness"],
  ["focus",  0, 1, 0.5,  "formant focus"],
  ["vib",    0, 1, 0.3,  "vibrato depth"],
  ["vrate",  0, 1, 0.45, "vibrato rate"],
  ["vdelay", 0, 1, 0.3,  "vibrato delay"],
  ["drift",  0, 1, 0.25, "drift"],
  ["growl",  0, 1, 0,    "growl"],
  ["voices", 1, 8, 1,    "choir voices"],
  ["detune", 0, 1, 0.3,  "choir detune"],
  ["spread", 0, 1, 0.5,  "choir spread"],
  ["bite",   0, 1, 0.6,  "consonant level"],
];

/** Text controls: [short key, default, max length, label]. The lyric: typed
 *  syllables that, when there are any, are sung instead of the words select. */
export const VOX_TEXT_CTLS = [
  ["text", "", VOX_TEXT_MAX, "lyric"],
];

/** Select controls: [short key, default, [values]]. */
export const VOX_SEL_CTLS = [
  ["cons",  "none", VOX_CONSONANT_NAMES],
  ["words", "off",  VOX_WORD_NAMES],
  ["mode",  "poly", ["poly", "mono"]],
  // the lyric respelled from English before it is sung (voxPhonetic.js)
  ["phon",  "off",  ["off", "on"]],
];

export const VOX_MOD_KEYS = VOX_NUM_CTLS.map(c => c[0]);
export const VOX_NUM_KEYS = VOX_MOD_KEYS.map(k => `sng${k}`);
export const VOX_SEL_KEYS = VOX_SEL_CTLS.map(c => `sng${c[0]}`);
export const VOX_TEXT_KEYS = VOX_TEXT_CTLS.map(c => `sng${c[0]}`);

export const VOX_MOD_RANGE = Object.fromEntries(VOX_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const VOX_MOD_LABELS = Object.fromEntries(
  VOX_NUM_CTLS.map(([k, , , , label]) => [k, `vox ${label}`]));

export const VOX_DEFAULTS = {
  ...Object.fromEntries(VOX_NUM_CTLS.map(c => [`sng${c[0]}`, c[3]])),
  ...Object.fromEntries(VOX_SEL_CTLS.map(c => [`sng${c[0]}`, c[1]])),
  ...Object.fromEntries(VOX_TEXT_CTLS.map(c => [`sng${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function voxFromUnit(k, u) {
  const [lo, hi] = VOX_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the voices -------------------------------------------------------------
// Complete patches: every panel control plus the four track sliders (vowel,
// size, breath, release), so nothing of the last one survives a load.
const VOX_TONES = {
  "choir aah": {
    d: "six voices on an open a, spread wide, a little air and a slow vibrato",
    vowel: 0.5, size: 0.45, breath: 0.45, rel: 0.6,
    p: { atk: 0.45, bright: 0.45, focus: 0.5, vib: 0.25, vrate: 0.4, vdelay: 0.4, drift: 0.35, growl: 0,
         voices: 6, detune: 0.35, spread: 0.85, bite: 0.6, cons: "none", words: "off", mode: "poly" },
  },
  "angel ooh": {
    d: "a high, small choir on oo, breathy and soft, for pads over a chord",
    vowel: 0.05, size: 0.05, breath: 0.6, rel: 0.7,
    p: { atk: 0.55, bright: 0.3, focus: 0.55, vib: 0.2, vrate: 0.4, vdelay: 0.5, drift: 0.3, growl: 0,
         voices: 5, detune: 0.3, spread: 0.9, bite: 0.6, cons: "none", words: "off", mode: "poly" },
  },
  "basso": {
    d: "one deep voice on o, mono, sliding between notes, a wide slow vibrato",
    vowel: 0.25, size: 1, breath: 0.35, rel: 0.45,
    p: { atk: 0.2, bright: 0.45, focus: 0.6, vib: 0.4, vrate: 0.35, vdelay: 0.35, drift: 0.25, growl: 0.05,
         voices: 1, detune: 0.3, spread: 0.3, bite: 0.6, cons: "none", words: "off", mode: "mono" },
  },
  "soul lead": {
    d: "a bright mono lead that sings hey yeah, the vibrato blooming late, a little grit",
    vowel: 0.6, size: 0.55, breath: 0.4, rel: 0.35,
    p: { atk: 0.1, bright: 0.7, focus: 0.5, vib: 0.45, vrate: 0.5, vdelay: 0.45, drift: 0.3, growl: 0.15,
         voices: 1, detune: 0.3, spread: 0.3, bite: 0.65, cons: "none", words: "hey yeah", mode: "mono" },
  },
  "doo wop": {
    d: "three close voices singing doo doo doo wah, for backing a lead",
    vowel: 0.5, size: 0.6, breath: 0.4, rel: 0.3,
    p: { atk: 0.1, bright: 0.5, focus: 0.5, vib: 0.25, vrate: 0.45, vdelay: 0.3, drift: 0.3, growl: 0,
         voices: 3, detune: 0.25, spread: 0.6, bite: 0.7, cons: "none", words: "doo wop", mode: "poly" },
  },
  "la la": {
    d: "a light high voice on la la la li, close to the mic",
    vowel: 0.5, size: 0.15, breath: 0.45, rel: 0.25,
    p: { atk: 0.05, bright: 0.55, focus: 0.5, vib: 0.2, vrate: 0.5, vdelay: 0.3, drift: 0.2, growl: 0,
         voices: 1, detune: 0.3, spread: 0.3, bite: 0.7, cons: "none", words: "la la", mode: "mono" },
  },
  "robot choir": {
    d: "four voices with no vibrato and no drift, bright and exact, singing na na",
    vowel: 0.5, size: 0.5, breath: 0.15, rel: 0.25,
    p: { atk: 0.05, bright: 0.85, focus: 0.8, vib: 0, vrate: 0.45, vdelay: 0, drift: 0, growl: 0,
         voices: 4, detune: 0.1, spread: 0.6, bite: 0.8, cons: "none", words: "na na", mode: "poly" },
  },
  "monk chant": {
    d: "a low unison on a dark o, held steady, with throat in it",
    vowel: 0.22, size: 0.95, breath: 0.4, rel: 0.6,
    p: { atk: 0.4, bright: 0.35, focus: 0.75, vib: 0.05, vrate: 0.3, vdelay: 0.5, drift: 0.35, growl: 0.3,
         voices: 4, detune: 0.15, spread: 0.5, bite: 0.6, cons: "m", words: "off", mode: "poly" },
  },
  "whisper": {
    d: "all breath and no voice: the formants on noise, starting with an h",
    vowel: 0.5, size: 0.4, breath: 1, rel: 0.3,
    p: { atk: 0.15, bright: 0.5, focus: 0.5, vib: 0, vrate: 0.45, vdelay: 0.3, drift: 0, growl: 0,
         voices: 1, detune: 0.3, spread: 0.4, bite: 0.6, cons: "h", words: "off", mode: "poly" },
  },
  "hallelujah": {
    d: "a full choir singing ha-le-lu-ya, one syllable a note",
    vowel: 0.5, size: 0.5, breath: 0.4, rel: 0.5,
    p: { atk: 0.2, bright: 0.5, focus: 0.5, vib: 0.3, vrate: 0.45, vdelay: 0.35, drift: 0.35, growl: 0,
         voices: 6, detune: 0.3, spread: 0.85, bite: 0.65, cons: "none", words: "hallelujah", mode: "poly" },
  },
};

export const VOX_TONE_NAMES = Object.keys(VOX_TONES);

/** One line saying what a voice is reaching for. @param {string} name */
export function voxToneDescription(name) { return VOX_TONES[name]?.d ?? ""; }

/**
 * A voice as a complete set of track params -- every panel control plus the
 * four track sliders, so nothing of the last voice survives. Except the
 * lyric and its phonetic box: that is what the track sings, not how it
 * sounds, and trying voices on a line you have typed should not erase it.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function voxTone(name) {
  const v = VOX_TONES[name];
  if (!v) return null;
  const out = { ...VOX_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`sng${k}`] = val;
  for (const k of VOX_TEXT_KEYS) delete out[k];
  delete out.sngphon;   // how the lyric is read is the lyric's, too
  out.harm = v.vowel; out.timb = v.size; out.morph = v.breath; out.decay = v.rel;
  return out;
}

// ---- lancet (lancet.js) ---------------------------------------------------------
// A snare drum synthesizer with seven models: four knobs (DECAY, TIMBRE,
// COLOR, PITCH) and an FX amount whose meaning changes with the model, a
// velocity amount, and a randomizer that throws the knobs per hit. The sound
// as DATA, so the song builder and the tests read the same tables the panel is
// built from.

/** The seven models. The select stores the name. */
export const LANCET_MODELS = ["analog", "slap", "modal", "physical", "fm", "granular", "blend"];

/** What each model is, and what TIMBRE, COLOR and the FX amount do on it. */
export const LANCET_MODEL_TIPS = {
  analog:   "sine waves and noise, the early drum machines. timbre is the noise (level, brightness, length), color the pitch envelope and the balance of the two shells. fx: soft clipping into hard clipping",
  slap:     "sines through a waveshaper, with the emphasis on a bright, clipped noise. color is how much of the body is the shaped version, timbre the mix of body and noise. fx: a gentle soft clip",
  modal:    "additive: a fundamental and seven inharmonic partials at a drum head's own modes, plus processed noise. color is the partials' level against the fundamental, timbre the noise. fx: multiband distortion that leaves the lows alone",
  physical: "a noise exciter through resonant delay lines. timbre is the exciter's brightness and the lines' damping, color the body: from harmonic modes to a membrane's, and how much the lines blend. fx: a distortion that roughens it",
  fm:       "a sine carrier modulated by two oscillators and a noise source. timbre is the noise modulator's level and tone, a macro; color moves the modulator ratios through the inharmonic. fx: fold and clip, metallic",
  granular: "a plain snare under a cloud of grains from a source made per hit. timbre picks the material (rattle, chain, paper, coin, sand), color the grains' pitch, length and density together. fx: a compressor and presence",
  blend:    "layered records, synthesized. timbre crossfades four high layers (paper, splash, crack, brush), color blends three bodies (deep, wood, ring). fx: an old sampler, a slower clock and fewer bits",
};
export function lancetModelTip(name) { return LANCET_MODEL_TIPS[name] ?? ""; }

/** Numeric panel controls: [short key, min, max, default, label]. */
export const LANCET_NUM_CTLS = [
  ["tune",    -12, 12, 0,   "tune"],
  ["dyn",     0, 1, 0.7,    "velocity amount"],
  ["rdecay",  0, 1, 0,      "random decay"],
  ["rtimbre", 0, 1, 0,      "random timbre"],
  ["rcolor",  0, 1, 0,      "random color"],
  ["rpitch",  0, 1, 0,      "random pitch"],
  ["rfx",     0, 1, 0,      "random fx"],
  ["rlevel",  0, 1, 0,      "random level"],
  ["rmodel",  0, 1, 0,      "random model"],
];

/** Select controls: [short key, default, [values]]. */
export const LANCET_SEL_CTLS = [
  ["model", "analog", LANCET_MODELS],
];

export const LANCET_MOD_KEYS = LANCET_NUM_CTLS.map(c => c[0]);
export const LANCET_NUM_KEYS = LANCET_MOD_KEYS.map(k => `lnc${k}`);
export const LANCET_SEL_KEYS = LANCET_SEL_CTLS.map(c => `lnc${c[0]}`);

export const LANCET_MOD_RANGE = Object.fromEntries(LANCET_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const LANCET_MOD_LABELS = Object.fromEntries(
  LANCET_NUM_CTLS.map(([k, , , , label]) => [k, `lancet ${label}`]));

export const LANCET_DEFAULTS = {
  ...Object.fromEntries(LANCET_NUM_CTLS.map(c => [`lnc${c[0]}`, c[3]])),
  ...Object.fromEntries(LANCET_SEL_CTLS.map(c => [`lnc${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function lancetFromUnit(k, u) {
  const [lo, hi] = LANCET_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the strikes --------------------------------------------------------------
// Complete patches: the model, every panel control and the four track sliders
// (timbre, color, fx, decay), so nothing of the last one survives a load.
const LANCET_TONES = {
  "tight analog": {
    d: "a short, dry analog snare: two shells, a little noise, no fx",
    model: "analog", timbre: 0.4, color: 0.45, fx: 0, decay: 0.3,
    p: { tune: 0, dyn: 0.7 },
  },
  "fat analog": {
    d: "an analog snare with the noise up, a long drop in and a soft-clipped body",
    model: "analog", timbre: 0.7, color: 0.7, fx: 0.4, decay: 0.5,
    p: { tune: -2, dyn: 0.6 },
  },
  "slap crack": {
    d: "the slap model with the noise forward and the shaper half in: punch and presence",
    model: "slap", timbre: 0.65, color: 0.5, fx: 0.3, decay: 0.35,
    p: { tune: 0, dyn: 0.8 },
  },
  "wood modal": {
    d: "a modal snare with the partials up, a bright noise band and the top driven a little",
    model: "modal", timbre: 0.6, color: 0.65, fx: 0.35, decay: 0.45,
    p: { tune: 0, dyn: 0.7 },
  },
  "piccolo": {
    d: "a small, high, tight modal snare, the fundamental on its own",
    model: "modal", timbre: 0.75, color: 0.25, fx: 0.2, decay: 0.2,
    p: { tune: 7, dyn: 0.8 },
  },
  "tin head": {
    d: "the physical model dark and damped, a membrane body, the wires rattling",
    model: "physical", timbre: 0.35, color: 0.8, fx: 0.25, decay: 0.45,
    p: { tune: 0, dyn: 0.7 },
  },
  "fm clap": {
    d: "the fm model with the noise modulator up: a sharp digital clap",
    model: "fm", timbre: 0.85, color: 0.4, fx: 0.4, decay: 0.3,
    p: { tune: 3, dyn: 0.6 },
  },
  "metal fm": {
    d: "an fm snare on inharmonic ratios, folded: a struck pan",
    model: "fm", timbre: 0.4, color: 0.85, fx: 0.6, decay: 0.5,
    p: { tune: -3, dyn: 0.7 },
  },
  "coins on the head": {
    d: "the granular model reading a coin source, high short dense grains, compressed",
    model: "granular", timbre: 0.75, color: 0.75, fx: 0.5, decay: 0.45,
    p: { tune: 0, dyn: 0.7 },
  },
  "boom bap": {
    d: "the blend model: a paper crack over a deep body, through an old sampler",
    model: "blend", timbre: 0.2, color: 0.1, fx: 0.55, decay: 0.4,
    p: { tune: -2, dyn: 0.75 },
  },
  "dusty funk": {
    d: "the blend model with a brush layer over a ringing body, lightly crushed",
    model: "blend", timbre: 0.9, color: 0.85, fx: 0.35, decay: 0.5,
    p: { tune: 0, dyn: 0.75 },
  },
  "roll the dice": {
    d: "the analog model with the randomizer on everything, a different snare every hit",
    model: "analog", timbre: 0.5, color: 0.5, fx: 0.3, decay: 0.4,
    p: { tune: 0, dyn: 0.7, rdecay: 0.4, rtimbre: 0.5, rcolor: 0.5, rpitch: 0.3, rfx: 0.4, rlevel: 0.3, rmodel: 0.5 },
  },
};

export const LANCET_TONE_NAMES = Object.keys(LANCET_TONES);

/** One line saying what a strike is reaching for. @param {string} name */
export function lancetToneDescription(name) { return LANCET_TONES[name]?.d ?? ""; }

/**
 * A strike as a complete set of track params: the model, every panel control
 * and the four track sliders, so nothing of the last one survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function lancetTone(name) {
  const v = LANCET_TONES[name];
  if (!v) return null;
  const out = { ...LANCET_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`lnc${k}`] = val;
  out.lncmodel = v.model;
  out.harm = v.timbre; out.timb = v.color; out.morph = v.fx; out.decay = v.decay;
  return out;
}

// ---- siege (siege.js) -------------------------------------------------------------
// The bass drum synth's panel. The four track sliders are its four knobs
// (drive / click / depth / decay); the panel is the rest of the front plate:
// the tune, the velocity floor, and the four buttons. Keys are `siege` + short
// key -> `siege_<short>` / `siege.<short>`.

/** Numeric panel controls: [short key, min, max, default, label]. */
export const SIEGE_NUM_CTLS = [
  ["tune",  0, 1, 0.5, "tune"],
  ["floor", 0, 1, 0.5, "velocity floor"],
];

/** Select controls: [short key, default, [values]]. */
export const SIEGE_SEL_CTLS = [
  ["mode", "fold", ["fold", "clip"]],
  ["gate", "trig", ["trig", "gate"]],
  ["hpf",  "off",  ["off", "on"]],
  ["lock", "off",  ["off", "on"]],
];

export const SIEGE_MOD_KEYS = SIEGE_NUM_CTLS.map(c => c[0]);
export const SIEGE_NUM_KEYS = SIEGE_MOD_KEYS.map(k => `sge${k}`);
export const SIEGE_SEL_KEYS = SIEGE_SEL_CTLS.map(c => `sge${c[0]}`);

export const SIEGE_MOD_RANGE = Object.fromEntries(SIEGE_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const SIEGE_MOD_LABELS = Object.fromEntries(
  SIEGE_NUM_CTLS.map(([k, , , , label]) => [k, `siege ${label}`]));

export const SIEGE_DEFAULTS = {
  ...Object.fromEntries(SIEGE_NUM_CTLS.map(c => [`sge${c[0]}`, c[3]])),
  ...Object.fromEntries(SIEGE_SEL_CTLS.map(c => [`sge${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function siegeFromUnit(k, u) {
  const [lo, hi] = SIEGE_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the kicks ------------------------------------------------------------
// Complete kicks: every panel control plus the four track sliders, so nothing
// of the last one survives a load.
const SIEGE_TONES = {
  "808": {
    d: "a long, soft sub drum: a small sweep, a slow fall, no drive. The one to leave room for a bassline",
    drive: 0.08, click: 0.22, depth: 0.35, decay: 0.72,
    p: { mode: "fold", gate: "trig", hpf: "off", lock: "off", tune: 0.5, floor: 0.5 },
  },
  "909": {
    d: "the dance kick: a two-octave sweep over sixty milliseconds, a medium body, the fold just engaged",
    drive: 0.38, click: 0.55, depth: 0.68, decay: 0.42,
    p: { mode: "fold", gate: "trig", hpf: "on", lock: "off", tune: 0.5, floor: 0.5 },
  },
  "techno": {
    d: "the clipper wound up over a mid-length body, low cut on: the attack is a square and the tail a sub",
    drive: 0.75, click: 0.5, depth: 0.45, decay: 0.38,
    p: { mode: "clip", gate: "trig", hpf: "on", lock: "off", tune: 0.5, floor: 0.6 },
  },
  "rumble": {
    d: "a long decay through the folder at the top of its range: the tail is lifted into a rumble that fills the bar",
    drive: 0.9, click: 0.4, depth: 0.5, decay: 0.8,
    p: { mode: "fold", gate: "trig", hpf: "on", lock: "off", tune: 0.45, floor: 0.5 },
  },
  "tick": {
    d: "the pitch envelope at its fastest with the click wide open: a tick on the front of a short thump",
    drive: 0.2, click: 0.9, depth: 0.04, decay: 0.18,
    p: { mode: "fold", gate: "trig", hpf: "off", lock: "off", tune: 0.5, floor: 0.4 },
  },
  "gabber": {
    d: "everything up: the clipper at full, a fast deep sweep, tuned high. A square with a kick's shape",
    drive: 1, click: 0.7, depth: 0.58, decay: 0.3,
    p: { mode: "clip", gate: "trig", hpf: "on", lock: "off", tune: 0.6, floor: 0.7 },
  },
  "sub drum": {
    d: "no click at all, a long clean decay, tuned down: a sine you feel more than hear",
    drive: 0, click: 0, depth: 0.5, decay: 0.9,
    p: { mode: "fold", gate: "trig", hpf: "off", lock: "off", tune: 0.38, floor: 0.6 },
  },
  "hard trance": {
    d: "a tight body with a big sweep and the folder half in, low cut on and tuned a little up: punch over weight",
    drive: 0.58, click: 0.62, depth: 0.55, decay: 0.3,
    p: { mode: "fold", gate: "trig", hpf: "on", lock: "off", tune: 0.58, floor: 0.5 },
  },
  "bassline": {
    d: "gate mode: the body holds for the step and falls when it ends, a small click, the fold warm. Write notes and ties",
    drive: 0.42, click: 0.15, depth: 0.25, decay: 0.45,
    p: { mode: "fold", gate: "gate", hpf: "off", lock: "off", tune: 0.5, floor: 0.75 },
  },
};

export const SIEGE_TONE_NAMES = Object.keys(SIEGE_TONES);

/** One line saying what a kick is reaching for. @param {string} name */
export function siegeToneDescription(name) { return SIEGE_TONES[name]?.d ?? ""; }

/**
 * A kick as a complete set of track params -- every panel control plus the
 * four track sliders, so nothing of the last kick survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function siegeTone(name) {
  const v = SIEGE_TONES[name];
  if (!v) return null;
  const out = { ...SIEGE_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`sge${k}`] = val;
  out.harm = v.drive; out.timb = v.click; out.morph = v.depth; out.decay = v.decay;
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
