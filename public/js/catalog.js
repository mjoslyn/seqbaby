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

// ---- saved patches: the account's patch bay ----------------------------
//
// Patches live in the signed-in account (`patches`, migration 0018), not in
// this browser. The engine holds the list in memory and reaches the account
// through a backend the shell hands it (`setPatchBackend`, from
// app/PatchBay.tsx); with none -- signed out, or before the list arrives --
// there are no saved patches and saving asks you to sign in.
//
// A track patch's config is fetched when it is loaded, never with the list: a
// sampler patch carries its sample as base64. A legacy custom-Tone patch is
// small and is an ENGINE (`saved:<name>`), built synchronously, so the list
// carries its config.

/** @type {Map<string, {engineKey: string|null, kind: string|null, config?: any}>} */
const patches = new Map();
/** @type {{fetch(name: string): Promise<any>, save(name: string, config: any): Promise<void>, remove(name: string): Promise<void>} | null} */
let backend = null;

/** The shell's handle on the account, and the account's patch list. */
export function setPatchBackend(next, list) {
  backend = next;
  setPatchList(list ?? []);
}
/** Replace the list (the shell re-reads it when the tab comes back into view). */
export function setPatchList(list) {
  const known = new Map(patches);
  patches.clear();
  for (const p of list) {
    // A config already fetched survives a re-read of the list.
    const config = p.config ?? known.get(p.name)?.config;
    patches.set(p.name, { engineKey: p.engineKey ?? null, kind: p.kind ?? null, config });
  }
  refreshPatches();
}
export function canSavePatches() { return !!backend; }
/** name -> { engineKey, kind }, for the picker. */
export function listPatches() {
  return [...patches.entries()].map(([name, p]) => ({ name, engineKey: p.engineKey, kind: p.kind }));
}
/** A patch's whole config, from the account the first time it is asked for. */
export async function getPatchConfig(name) {
  const p = patches.get(name);
  if (!p) return null;
  if (p.config === undefined && backend) p.config = await backend.fetch(name);
  return p.config ?? null;
}
/** Save into the account. Throws without a backend or when the save fails. */
export async function savePatch(name, config) {
  if (!backend) throw new Error("sign in to save patches");
  await backend.save(name, config);
  patches.set(name, { engineKey: config?.engineKey ?? null, kind: config?._kind ?? null, config });
  refreshPatches();
}
export async function deletePatch(name) {
  if (!backend) throw new Error("sign in to delete patches");
  await backend.remove(name);
  patches.delete(name);
  refreshPatches();
}
/** Redraw what reads the list: the `saved:` engines in every dropdown. */
export function refreshPatches() {
  rebuildEngineCatalog();
  for (const t of state.tracks) refreshEngineSelect(t);
}
export function savedPatchEntries() {
  return [...patches.keys()].sort()
    // Full "track patches" (engine + params + fx) are applied to a track via the
    // per-track load button, not selected as a dropdown engine. Only legacy
    // custom-Tone patches remain selectable engines here.
    .filter(name => patches.get(name).kind !== "track-patch" && patches.get(name).config)
    .map(name => ({
    key: `saved:${name}`,
    label: name,
    group: "saved patches",
    type: "saved",
    defaultNote: 60,
    poly: !!patches.get(name).config?.poly,
    melodic: true,
    config: patches.get(name).config,
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
