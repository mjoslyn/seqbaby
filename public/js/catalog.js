import { state } from "./state.js";
import { quantizeToScale, scaleIndexToMidi } from "./theory.js";


/** @typedef {import("./types.js").EngineEntry} EngineEntry */
import { ANALOG_ENGINES, BUS_ENGINE, DRUM_SYNTH_ENGINES, MIDI_ENGINE, SAMPLER_ENGINE, TEXTURE_ENGINES, WAVETABLE_ENGINES, plaitsEntries } from "./engineData.js";
// The engine tables are data and live in engineData.js (no imports, readable
// from Node); re-exported here so every existing import from catalog.js holds.
export {
  PLAITS_DRUM_IDX, PLAITS_MODELS, plaitsEntries, PLAITS_MACRO_TIPS, ENGINE_MACRO_TIPS,
  DRUM_SYNTH_ENGINES, ANALOG_ENGINES, TEXTURE_ENGINES, WAVETABLE_ENGINES,
  SAMPLE_BASE, SAMPLER_ENGINE, SAMPLE_ENGINES, BUNDLED_SAMPLES,
  GRANULAR_SAMPLE_BASE, GRANULAR_SAMPLE_CREDIT, GRANULAR_SAMPLES,
  MIDI_ENGINE, BUS_ENGINE, UPLOAD_ENGINE, STATIC_ENGINES, staticEngineByKey, engineSliderLabels,
} from "./engineData.js";

/**
 * Assemble the full engine catalog (plaits, drum/synth, emulators, samples,
 * custom, saved patches, midi). Rebuilt when saved patches change.
 * @returns {EngineEntry[]}
 */
export function buildEngineCatalog() {
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, ...TEXTURE_ENGINES, ...WAVETABLE_ENGINES, SAMPLER_ENGINE, ...savedPatchEntries(), MIDI_ENGINE, BUS_ENGINE];
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
