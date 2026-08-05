import { oscillatorTypes } from "./constants.js";
import { state } from "./state.js";
import { quantizeToScale, scaleIndexToMidi } from "./theory.js";


/** @typedef {import("./types.js").EngineEntry} EngineEntry */
export const PLAITS_DRUM_IDX = new Set([13, 14, 15]);

export function plaitsEntries() {
  return oscillatorTypes.map((label, i) => ({
    key: `plaits:${i}`,
    label: label.toLowerCase(),
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
  "the internal low-pass gate: how long each trigger rings, and how far the tone closes down as it falls away";
const PLAITS_DRUM_DECAY =
  "the low-pass gate's decay, on top of the model's own — pull it down for a tighter hit";
export const PLAITS_MACRO_TIPS = [
  { // 0 virtual analog
    harm: "detuning between the two oscillators — one fat tone at zero, a beating pair by the top",
    timb: "pulse width of the square, from a thin nasal pulse out to a hollow square",
    morph: "the second wave's shape, sweeping from triangle through saw with a widening notch",
    decay: PLAITS_LPG_DECAY },
  { // 1 waveshaping
    harm: "which waveshaping curve the oscillator is pushed through",
    timb: "wavefolder amount — the further up, the more times the wave folds back on itself and the more harmonics come out of it",
    morph: "asymmetry of the waveform, which is what brings the even harmonics in",
    decay: PLAITS_LPG_DECAY },
  { // 2 fm
    harm: "frequency ratio between the two operators. Whole-number ratios stay harmonic; everything in between goes bell-like and clangorous",
    timb: "modulation index — how hard operator 2 drives operator 1, so how bright and how wide the sidebands spread",
    morph: "feedback: below centre operator 2 modulates operator 1 harder, above it feeds back into itself — both ends head toward noise",
    decay: PLAITS_LPG_DECAY },
  { // 3 grain
    harm: "ratio between the two formant frequencies",
    timb: "formant frequency — the resonant peak the grains are shaped around, which is what makes this one sound vocal",
    morph: "shape and width of the grain window",
    decay: PLAITS_LPG_DECAY },
  { // 4 additive
    harm: "how the energy is grouped across the harmonic series",
    timb: "sweeps the emphasised peak up and down that series — the drawbar sweep",
    morph: "how wide the peak spreads, from something close to a sine out to a full stack",
    decay: PLAITS_LPG_DECAY },
  { // 5 wavetable
    harm: "which bank of wavetables is read",
    timb: "position along the wavetable map",
    morph: "position across the map's other axis. The two together pick the wave, and neither moves smoothly — that steppiness is the model",
    decay: PLAITS_LPG_DECAY },
  { // 6 chord
    harm: "which chord is played — this model sounds four voices at once and this picks the intervals",
    timb: "the chord's inversion and how far it spreads",
    morph: "the waveform those four voices use, from sine up through richer waves",
    decay: PLAITS_LPG_DECAY },
  { // 7 speech
    harm: "the sound bank: formant filtering at the bottom, then the vintage speech-synth modes and their word lists",
    timb: "species — shifts the formants, so the same phoneme reads as a different size of voice",
    morph: "which phoneme or word comes out",
    decay: PLAITS_LPG_DECAY },
  { // 8 swarm
    harm: "how far the swarm's voices scatter in pitch",
    timb: "density of the swarm — how many grains, how often",
    morph: "grain duration and envelope shape",
    decay: PLAITS_LPG_DECAY },
  { // 9 noise
    harm: "spacing between the two resonant peaks the noise is filtered through",
    timb: "where those peaks sit",
    morph: "how narrow they are — wide is a wash, narrow is a pitched whistle",
    decay: PLAITS_LPG_DECAY },
  { // 10 particle
    harm: "how far each particle's pitch is randomised",
    timb: "particle density, from occasional ticks to a continuous shower",
    morph: "resonance and ring of the filter each particle is fired through",
    decay: PLAITS_LPG_DECAY },
  { // 11 string
    harm: "inharmonicity — how stiff the string is, from a clean harmonic series to a dull, bell-like one",
    timb: "brightness of the excitation that plucks it",
    morph: "how long it rings",
    decay: PLAITS_LPG_DECAY },
  { // 12 modal
    harm: "the material's inharmonicity — the difference between a tube, a bar and a bell",
    timb: "brightness and grit of the strike",
    morph: "how long the resonator rings",
    decay: PLAITS_LPG_DECAY },
  { // 13 bass drum
    harm: "attack sharpness, and how hard the drum is overdriven",
    timb: "brightness — the balance of click against body",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 14 snare drum
    harm: "balance between the drum's tone and its noise",
    timb: "brightness — how much of the noise is filtered away",
    morph: "the drum's own decay",
    decay: PLAITS_DRUM_DECAY },
  { // 15 hi hat
    harm: "balance between the metallic cluster and plain noise",
    timb: "brightness of the filter that cluster runs through",
    morph: "decay — closed hat at the bottom, open at the top",
    decay: PLAITS_DRUM_DECAY },
];

// The same four sliders again, for the engines that aren't Plaits. Each entry is
// keyed by engine key, with `osc` for the oscillator-mix row and `oscMod` for
// the ultrasaw / FM / metalizer row where an engine uses them. Only the controls
// an engine actually shows need a line — updatePlaitsControlsVisibility hides
// the rest. (The 303, the Virus, the granular engine and the 808/909 voices keep
// their tips inline in params.js, next to the labels they go with.)
export const ENGINE_MACRO_TIPS = {
  "dm:mini-brute": {
    harm: "speed of the LFO sweeping the pulse wave's width, and its depth, on one control — at zero the pulse holds still",
    timb: "the pulse wave's resting width, from a thin nasal 10% out to a hollow square. The pwm rate slider sweeps around wherever this sits",
    osc: {
      osc1: "level of the sawtooth — the Brute's main voice",
      osc2: "level of the pulse wave, shaped by the two pw controls",
      osc3: "level of the triangle, which is what the metalizer folds",
      osc4: "level of the sub oscillator, an octave below",
    },
    oscMod: {
      ultra: "ultrasaw: detuned copies stacked around the saw, for width out of a single oscillator",
      fm: "audio-rate frequency modulation from the sub — clangorous and metallic as it climbs",
      metal: "metalizer: folds the triangle back on itself into hard upper harmonics",
    },
  },
  "dm:moog": {
    harm: "how far oscillator 2 sits off oscillator 1, 5 to 30 cents. The slow beat between them is most of why the stack sounds thick",
    decay: "one control doing two things: how long a note takes to fall away, and how much of the warming filter stage is mixed in as it does",
    osc: {
      osc1: "level of oscillator 1 in the mixer",
      osc2: "level of oscillator 2 — the detuned one",
      osc3: "level of oscillator 3, usually dropped an octave for weight",
    },
  },
  "dm:juno": {
    harm: "speed and depth of the LFO sweeping the DCO's pulse width — the Juno's built-in movement",
    timb: "the pulse's resting width, which that sweep moves around",
    morph: "the chorus, wet and depth together. It is what a Juno sounds like; almost nobody turns it off",
    decay: "how long a note falls away — and the high-pass with it, so the sound thins as it shortens",
    osc: {
      osc1: "level of the main DCO",
      osc2: "level of the square sub, an octave below",
      osc3: "level of the noise source",
    },
  },
  "dm:guitar": {
    harm: "how hard the pluck is pushed into the overdrive stage, from clean up into grit",
    timb: "damping of the string — low is a muted thud, high is a bright pick",
    morph: "how much chorus sits on the output",
    decay: "how long the string rings, from a short pluck to a long sustain",
  },
  "dm:bass": {
    harm: "how hard the string is driven — finger, then pick, then overdriven",
    timb: "damping: roughly where along the string it is plucked, dull to bright",
    morph: "how much energy the string keeps on each pass. Higher rings longer and harder",
    decay: "how long the note rings out",
  },
  "dm:rhodes": {
    harm: "the ratio between the tine and the tone bar — low is deep and hollow, high goes bell-like",
    timb: "how hard the hammer hits, so how much of that metallic attack comes through",
    morph: "how much chorus is on the output — the stereo shimmer",
    decay: "how long each note rings, and how long it takes to let go once released",
  },
  "dm:prophet6": {
    harm: "detunes VCO2 against VCO1 by up to 30 cents either way. Centre is unison; the ends beat",
    timb: "crossfades VCO2 from saw to pulse, sweeping the pulse width as it goes",
    morph: "how much of the output runs through the overdrive stage",
    decay: "how long each note falls away, and its release with it",
    osc: {
      osc1: "level of VCO1",
      osc2: "level of VCO2 — the detuned one the shape control sweeps",
      osc3: "level of the sub oscillator",
      osc4: "level of the noise source",
    },
  },
  "wt:akwf": {
    harm: "position across the table, morphing between the frames — the ones you drew in the editor, or the AKWF palette. Wave scan can sweep this on its own",
    timb: "a lowpass on each voice, on top of the track filter: dark at the bottom, fully open at the top",
    morph: "how far the stacked unison voices spread in pitch, up to ±30 cents. Zero is a single clean voice",
    decay: "how long each note takes to fall away, and its release",
  },
  "dm:virus": {
    osc: {
      osc1: "level of oscillator 1",
      osc2: "level of oscillator 2 — the one semi, detune and sync act on",
      osc3: "level of the sub oscillator, an octave under osc 1 (its shape is the sub select)",
      osc4: "level of the noise source. Squared, so the bottom of the slider stays usable",
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
  // Monophonic, like the machine — no makePolyPool wrapper (see tb303.js).
  { key: "dm:303",        label: "303",            defaultNote: 36, poly: false, melodic: true },
  // Polyphony lives inside the worklet rather than in makePolyPool (virus.js).
  { key: "dm:virus",      label: "virus",          defaultNote: 60, poly: true, melodic: true },
  // Six sine operators and 32 algorithms, 16-voice, also worklet-internal (dx7.js).
  { key: "dm:dx7",        label: "dx7",            defaultNote: 60, poly: true, melodic: true },
  { key: "dm:mini-brute", label: "mini brute",     defaultNote: 60, poly: true, melodic: true },
  { key: "dm:moog",       label: "moog",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:juno",       label: "juno 60",        defaultNote: 60, poly: true, melodic: true },
  { key: "dm:guitar",     label: "electric guitar", defaultNote: 52, poly: true, melodic: true },
  { key: "dm:bass",       label: "electric bass",   defaultNote: 40, poly: true, melodic: true },
  { key: "dm:rhodes",     label: "rhodes piano",    defaultNote: 60, poly: true, melodic: true },
  { key: "dm:prophet6",   label: "prophet 6",       defaultNote: 60, poly: true, melodic: true },
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

export const UPLOAD_ENGINE = {
  key: "upload", label: "upload a sample…", group: "user samples", type: "upload",
  defaultNote: 60, poly: true, melodic: true,
};

/**
 * Assemble the full engine catalog (plaits, drum/synth, emulators, samples,
 * custom, saved patches, midi). Rebuilt when saved patches change.
 * @returns {EngineEntry[]}
 */
export function buildEngineCatalog() {
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, ...TEXTURE_ENGINES, ...WAVETABLE_ENGINES, SAMPLER_ENGINE, ...savedPatchEntries(), MIDI_ENGINE];
}

export let ENGINES = [];
export const engineMap = new Map();
/**
 * Look up a catalog entry by its engine key.
 * @param {string} key @returns {EngineEntry|undefined}
 */
export function engineByKey(key) { return engineMap.get(key); }

// ---- saved patch storage -----------------------------------------------

export const PATCHES_KEY = "seqbaby.patches.v1";
export function loadPatches() {
  try { return JSON.parse(localStorage.getItem(PATCHES_KEY) || "{}"); }
  catch { return {}; }
}
export function storePatches(obj) {
  try { localStorage.setItem(PATCHES_KEY, JSON.stringify(obj)); } catch {}
}
export function savePatch(name, config) {
  const all = loadPatches();
  all[name] = config;
  storePatches(all);
  rebuildEngineCatalog();
  for (const t of state.tracks) refreshEngineSelect(t);
}
export function savedPatchEntries() {
  const all = loadPatches();
  return Object.keys(all).sort()
    // Full "track patches" (engine + params + fx) are applied to a track via the
    // per-track load button, not selected as a dropdown engine. Only legacy
    // custom-Tone patches remain selectable engines here.
    .filter(name => all[name]?._kind !== "track-patch")
    .map(name => ({
    key: `saved:${name}`,
    label: name,
    group: "saved patches",
    type: "saved",
    defaultNote: 60,
    poly: !!all[name]?.poly,
    melodic: true,
    config: all[name],
  }));
}
export function rebuildEngineCatalog() {
  ENGINES = buildEngineCatalog();
  engineMap.clear();
  for (const e of ENGINES) engineMap.set(e.key, e);
}
export function refreshEngineSelect(t) {
  if (!t.el) return;
  const sel = t.el.querySelector(".sq-track__engine");
  populateEngineSelect(sel);
  sel.value = t.engineKey;
}

export function populateEngineSelect(sel) {
  sel.replaceChildren();
  const groups = new Map();
  for (const e of ENGINES) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  for (const [group, entries] of groups) {
    const og = document.createElement("optgroup");
    og.label = group;
    for (const e of entries) {
      const opt = document.createElement("option");
      opt.value = e.key;
      opt.textContent = e.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

// ---- scales + chords ---------------------------------------------------

// Interval arrays are pitch-classes modulo 12. Integer values = 12-TET semitones;
// half-integer values (e.g. 1.5) = 24-TET quarter tones (50 cents above the lower
// semitone). The whole pitch path — quantizeToScale, scaleIndexToMidi, voice.hit
// — accepts fractional MIDI, so these intervals round-trip as real microtones.
