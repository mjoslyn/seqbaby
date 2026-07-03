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
  { key: "dm:303",       label: "303 acid bass", defaultNote: 36, poly: false, melodic: true },
  { key: "dm:poly-saw",  label: "poly saw",     defaultNote: 60, poly: true,  melodic: true },
  { key: "dm:fm-bell",   label: "fm bell",      defaultNote: 72, poly: true,  melodic: true },
  { key: "dm:pad",       label: "pad",          defaultNote: 60, poly: true,  melodic: true },
].map(e => ({ ...e, group: "drum / synth", type: "drum-synth", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const ANALOG_ENGINES = [
  { key: "dm:mini-brute", label: "mini brute",     defaultNote: 60, poly: true, melodic: true },
  { key: "dm:moog",       label: "moog",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:juno",       label: "juno 60",        defaultNote: 60, poly: true, melodic: true },
  { key: "dm:guitar",     label: "electric guitar", defaultNote: 52, poly: true, melodic: true },
  { key: "dm:bass",       label: "electric bass",   defaultNote: 40, poly: true, melodic: true },
  { key: "dm:rhodes",     label: "rhodes piano",    defaultNote: 60, poly: true, melodic: true },
  { key: "dm:prophet6",   label: "prophet 6",       defaultNote: 60, poly: true, melodic: true },
].map(e => ({ ...e, group: "Emulators", type: "drum-synth", poly: e.poly ?? false, melodic: e.melodic ?? false }));

export const SAMPLE_BASE = "https://tonejs.github.io/audio/drum-samples";
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
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, UPLOAD_ENGINE, ...savedPatchEntries(), ...SAMPLE_ENGINES, MIDI_ENGINE];
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
  return Object.keys(all).sort().map(name => ({
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
