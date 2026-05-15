// seqbaby — Plaits / drum synth / sample / MIDI step sequencer

const { wosc, oscillatorTypes } = window.woscillators;

const STEPS_PER_BAR = 16;
const LFO_KEYS = [
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
];
// How much each target swings per unit of depth:
//  - 0..1 unit params: amp = depth/2 (swings ±0.5)
//  - cutoff: depth*3000 Hz
//  - reson: depth*10 (Q units)
// Display labels for the mod picker — underscore keys show as "foo bar".
const LFO_LABELS = {
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
  delay_time: "delay time", delay_fbk: "delay fbk",
  reverb_decay: "reverb decay",
};
const lfoLabel = (k) => LFO_LABELS[k] ?? k;
const LFO_AMP_SCALE = {
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
};

// Non-blocking prompt dialog (browser prompt() halts the transport scheduler)
function showInputDialog({ title, defaultValue = "", placeholder = "", multiline = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    const field = multiline
      ? `<textarea class="modal-input modal-multiline" rows="5" placeholder="${esc(placeholder)}">${esc(defaultValue)}</textarea>`
      : `<input class="modal-input" type="text" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />`;
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">${esc(title)}</div>
        ${field}
        <div class="modal-actions">
          <button class="modal-cancel ghost">cancel</button>
          <button class="modal-ok">ok</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".modal-input");
    setTimeout(() => { input.focus(); if (input.select) input.select(); }, 0);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector(".modal-ok").addEventListener("click", () => close(input.value));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    input.addEventListener("keydown", (e) => {
      // single-line: Enter submits. multiline: Cmd/Ctrl+Enter submits, plain Enter adds newline.
      if (!multiline && e.key === "Enter") { e.preventDefault(); close(input.value); }
      if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(input.value); }
      if (e.key === "Escape") close(null);
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

// Modal: pick one of the user's saved patches. Returns patch name or null.
function showSavedPatchPicker() {
  return new Promise((resolve) => {
    const all = loadPatches();
    const names = Object.keys(all).sort();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const rows = names.length
      ? names.map(n => `<li class="patch-row"><button class="patch-load" data-name="${esc(n)}">${esc(n)}</button><button class="patch-del ghost" data-name="${esc(n)}" title="delete">×</button></li>`).join("")
      : `<li class="patch-empty">no saved patches yet — design a sound and click save.</li>`;
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">load saved patch</div>
        <ul class="patch-list">${rows}</ul>
        <div class="modal-actions">
          <button class="modal-cancel ghost">cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelectorAll(".patch-load").forEach(btn => {
      btn.addEventListener("click", () => close(btn.dataset.name));
    });
    overlay.querySelectorAll(".patch-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.name;
        const map = loadPatches();
        delete map[name];
        storePatches(map);
        rebuildEngineCatalog();
        for (const t of state.tracks) refreshEngineSelect(t);
        btn.closest(".patch-row")?.remove();
      });
    });
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") { close(null); document.removeEventListener("keydown", esc2); }
    });
  });
}

// ---- engine catalog ----------------------------------------------------

const PLAITS_DRUM_IDX = new Set([13, 14, 15]);

function plaitsEntries() {
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

const DRUM_SYNTH_ENGINES = [
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

const ANALOG_ENGINES = [
  { key: "dm:mini-brute", label: "mini brute",     defaultNote: 60, poly: true, melodic: true },
  { key: "dm:moog",       label: "moog",           defaultNote: 60, poly: true, melodic: true },
  { key: "dm:juno",       label: "juno 60",        defaultNote: 60, poly: true, melodic: true },
  { key: "dm:guitar",     label: "electric guitar", defaultNote: 52, poly: true, melodic: true },
  { key: "dm:bass",       label: "electric bass",   defaultNote: 40, poly: true, melodic: true },
  { key: "dm:rhodes",     label: "rhodes piano",    defaultNote: 60, poly: true, melodic: true },
  { key: "dm:prophet6",   label: "prophet 6",       defaultNote: 60, poly: true, melodic: true },
].map(e => ({ ...e, group: "Emulators", type: "drum-synth", poly: e.poly ?? false, melodic: e.melodic ?? false }));

const SAMPLE_BASE = "https://tonejs.github.io/audio/drum-samples";
const SAMPLE_ENGINES = [
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

const MIDI_ENGINE = {
  key: "midi", label: "midi out", group: "midi", type: "midi",
  defaultNote: 60, poly: true,
};

const UPLOAD_ENGINE = {
  key: "upload", label: "upload a sample…", group: "user samples", type: "upload",
  defaultNote: 60, poly: true, melodic: true,
};

function buildEngineCatalog() {
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, UPLOAD_ENGINE, ...savedPatchEntries(), ...SAMPLE_ENGINES, MIDI_ENGINE];
}

let ENGINES = [];
const engineMap = new Map();
function engineByKey(key) { return engineMap.get(key); }

// ---- saved patch storage -----------------------------------------------

const PATCHES_KEY = "seqbaby.patches.v1";
function loadPatches() {
  try { return JSON.parse(localStorage.getItem(PATCHES_KEY) || "{}"); }
  catch { return {}; }
}
function storePatches(obj) {
  try { localStorage.setItem(PATCHES_KEY, JSON.stringify(obj)); } catch {}
}
function savePatch(name, config) {
  const all = loadPatches();
  all[name] = config;
  storePatches(all);
  rebuildEngineCatalog();
  for (const t of state.tracks) refreshEngineSelect(t);
}
function savedPatchEntries() {
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
function rebuildEngineCatalog() {
  ENGINES = buildEngineCatalog();
  engineMap.clear();
  for (const e of ENGINES) engineMap.set(e.key, e);
}
function refreshEngineSelect(t) {
  if (!t.el) return;
  const sel = t.el.querySelector(".track-engine");
  populateEngineSelect(sel);
  sel.value = t.engineKey;
}

function populateEngineSelect(sel) {
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
const SCALES = {
  off:       null,
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  lydian:    [0, 2, 4, 6, 7, 9, 11],
  mixolydian:[0, 2, 4, 5, 7, 9, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic minor":  [0, 2, 3, 5, 7, 9, 11],
  pentatonic:       [0, 2, 4, 7, 9],
  "minor pentatonic":[0, 3, 5, 7, 10],
  blues:     [0, 3, 5, 6, 7, 10],
  // Exotic / world 12-TET subsets.
  "phrygian dominant": [0, 1, 4, 5, 7, 8, 10],  // Ahava Rabbah / Freygish
  "double harmonic":   [0, 1, 4, 5, 7, 8, 11],  // Byzantine / Arabic
  "hungarian minor":   [0, 2, 3, 6, 7, 8, 11],  // Gypsy minor
  "neapolitan minor":  [0, 1, 3, 5, 7, 8, 11],
  "persian":           [0, 1, 4, 5, 6, 8, 11],
  "enigmatic":         [0, 1, 4, 6, 8, 10, 11], // Verdi
  "hirajoshi":         [0, 2, 3, 7, 8],          // Japanese pentatonic
  "in sen":            [0, 1, 5, 7, 10],         // Japanese
  "iwato":             [0, 1, 5, 6, 10],         // Japanese
  "prometheus":        [0, 2, 4, 6, 9, 10],      // Scriabin
  "whole tone":        [0, 2, 4, 6, 8, 10],
  "octatonic h-w":     [0, 1, 3, 4, 6, 7, 9, 10],
  "octatonic w-h":     [0, 2, 3, 5, 6, 8, 9, 11],
  // Tuning systems (chromatic fills of the selected EDO).
  "12-tet":  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "24-tet":  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5],
  // Turkish maqam Hüseyni: D, E½♭, F, G, A, B½♭, C — two quarter-flat inflections.
  "hüseyni": [0, 1.5, 3, 5, 7, 8.5, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// Chord list is grouped: none → basic triads → suspended → altered triads → 7ths → extensions.
// (Note: keys that parse as integers — e.g. "7" — get hoisted to the top by the JS engine,
// which breaks insertion order. Everything here starts with a letter so order is preserved.)
const CHORD_TYPES = {
  "":     [0],
  "maj":  [0, 4, 7],
  "min":  [0, 3, 7],
  "sus2": [0, 2, 7],
  "sus4": [0, 5, 7],
  "dim":  [0, 3, 6],
  "aug":  [0, 4, 8],
  "maj7": [0, 4, 7, 11],
  "min7": [0, 3, 7, 10],
  "dom7": [0, 4, 7, 10],
  "m7b5": [0, 3, 6, 10],
  "add9": [0, 4, 7, 14],
};
// Accept legacy "7" value from previously-saved patterns.
const CHORD_ALIASES = { "7": "dom7" };
function canonicalChord(c) { return CHORD_ALIASES[c] || c; }

// Snap a MIDI value to the nearest pitch allowed by `intervals` (pc set, mod 12).
// Interval step is auto-detected: 0.5 when any interval is non-integer (24-EDO /
// Hüseyni), 1 otherwise (12-EDO). Returns fractional MIDI for microtonal scales.
function quantizeToScale(midi, rootPc, intervals) {
  if (!intervals) return midi;
  const step = intervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const EPS = 1e-6;
  const target = Math.round(midi / step) * step;
  let best = target;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d += step) {
    const candidate = target + d;
    const relative = ((candidate - rootPc) % 12 + 12) % 12;
    if (intervals.some(i => Math.abs(i - relative) < EPS)) {
      if (Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = candidate;
      }
    }
  }
  return best;
}

function applyScale(midi) {
  if (!state.scale.active) return midi;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return midi;
  return quantizeToScale(midi, state.scale.root, intervals);
}

function midiToScaleIndex(midi, rootPc, intervals) {
  const q = quantizeToScale(midi, rootPc, intervals);
  const pcDiff = ((q - rootPc) % 12 + 12) % 12;
  const EPS = 1e-6;
  const pos = intervals.findIndex(i => Math.abs(i - pcDiff) < EPS);
  if (pos < 0) return null;
  const octave = Math.floor((q - rootPc) / 12);
  return octave * intervals.length + pos;
}

function scaleIndexToMidi(idx, rootPc, intervals) {
  const N = intervals.length;
  const octave = Math.floor(idx / N);
  let pos = idx % N;
  if (pos < 0) pos += N;
  return rootPc + octave * 12 + intervals[pos];
}

function findPriorNote(t, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (t.steps[i] && typeof t.notes[i] === "number") return t.notes[i];
  }
  for (let i = t.length - 1; i > idx; i--) {
    if (t.steps[i] && typeof t.notes[i] === "number") return t.notes[i];
  }
  return null;
}

function applyStepsFromPrior(t, idx, steps) {
  const prior = findPriorNote(t, idx);
  if (prior == null) return null;
  if (!state.scale.active) return prior + steps;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return prior + steps;
  const priorIdx = midiToScaleIndex(prior, state.scale.root, intervals);
  if (priorIdx == null) return prior + steps;
  return scaleIndexToMidi(priorIdx + steps, state.scale.root, intervals);
}

function chordNotes(rootMidi, chordType) {
  const tones = CHORD_TYPES[canonicalChord(chordType)] || [0];
  return tones.map(i => rootMidi + i);
}

// Diatonic note coloring: each chromatic pitch class gets a fixed hue
// (30° per semitone) so the same note always reads the same color regardless
// of key — C red, D yellow, F# cyan, A purple, etc. Gated by the palette
// toggle (state.noteColors); returns null when off so callers fall back to
// the accent color.
function noteColor(midi) {
  if (!state.noteColors) return null;
  if (midi == null || !Number.isFinite(midi)) return null;
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return `hsl(${pc * 30} 72% 56%)`;
}

// Does every tone of chordKey (rooted at rootMidi) fall on the active scale?
// Returns true when no scale is active.
function chordFitsScale(rootMidi, chordKey) {
  if (!state.scale.active) return true;
  const intervals = SCALES[state.scale.mode];
  if (!intervals) return true;
  const tones = CHORD_TYPES[canonicalChord(chordKey)];
  if (!tones) return false;
  for (const st of tones) {
    const pc = ((rootMidi + st) % 12 + 12) % 12;
    const rel = ((pc - state.scale.root) % 12 + 12) % 12;
    if (!intervals.includes(rel)) return false;
  }
  return true;
}

// ---- icons --------------------------------------------------------------

const ICON_REPEAT = `<svg class="btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a4 4 0 0 1 4-4h4"/><polyline points="10 4 12 6 10 8"/><path d="M12 6a4 4 0 0 1-4 4H4"/><polyline points="6 12 4 10 6 8"/></svg>`;
const ICON_CHAIN  = `<svg class="btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h10"/><polyline points="9 4 13 8 9 12"/></svg>`;
const ICON_NOW    = `<svg class="btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 1.5 3.5 9h3.5l-1 5.5L13.5 7H10l1-5.5z"/></svg>`;
const ICON_FINISH = `<svg class="btn-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="8" height="2" rx="0.5"/><rect x="4" y="12" width="8" height="2" rx="0.5"/><path d="M5 4c0 2.5 3 3.2 3 4s-3 1.5-3 4"/><path d="M11 4c0 2.5-3 3.2-3 4s3 1.5 3 4"/></svg>`;
const ICON_LOCKED   = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>`;
const ICON_UNLOCKED = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 5.4-1.8"/></svg>`;
const ICON_SAVE     = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 2v4h6V2"/><rect x="5" y="9" width="6" height="5"/></svg>`;
const ICON_LOAD     = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4a1 1 0 0 1 1-1h3l2 2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z"/></svg>`;
// Classic metronome — trapezoidal body + pendulum swung slightly right.
const ICON_METRONOME = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 14h6l-1-11H6z"/><line x1="10.6" y1="3.2" x2="5.4" y2="13.5"/><circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none"/></svg>`;
// Painter's palette with four colored dots — paints when "on", greys when "off"
// (CSS handles the desaturation via aria-pressed).
const ICON_PALETTE = `<svg class="btn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5c-3.6 0-6.5 2.7-6.5 6S4.4 13.5 8 13.5c.9 0 1.5-.5 1.5-1.2 0-.5-.3-.9-.3-1.4 0-.7.6-1.2 1.3-1.2h1c2 0 3.5-1.4 3.5-3.3 0-2.7-3-4.9-7-4.9z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="5.2" r="1.05" fill="hsl(0 72% 56%)"/><circle cx="9.5" cy="3.8" r="1.05" fill="hsl(60 72% 56%)"/><circle cx="11.9" cy="6.6" r="1.05" fill="hsl(180 72% 56%)"/><circle cx="4.6" cy="9.2" r="1.05" fill="hsl(270 72% 56%)"/></svg>`;
// Download — arrow into a tray.
const ICON_DOWNLOAD = `<svg class="btn-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8"/><polyline points="5 7 8 10 11 7"/><path d="M2.5 13h11"/></svg>`;

// ---- state --------------------------------------------------------------

const PATTERN_COUNT = 32;
const BAR_TICKS = 16;  // chain advance resolution

// Simple sine-blip metronome — accent the downbeat (step 0 of every bar).
let _metroOsc = null;
let _metroGain = null;
function fireMetronome(time, accent) {
  if (!state.audioCtx) return;
  const ctx = state.audioCtx;
  if (!_metroGain) {
    _metroGain = ctx.createGain();
    _metroGain.gain.value = 0;
    _metroGain.connect(ctx.destination);
  }
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(accent ? 1760 : 1320, time);
  const g = ctx.createGain();
  const peak = accent ? 0.28 : 0.14;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(g).connect(_metroGain);
  _metroGain.gain.setValueAtTime(1, time);
  osc.start(time);
  osc.stop(time + 0.08);
}

// Circular beat indicator — N dots around a ring (N = reference track's length
// so non-4/4 / polymeter still reads correctly), every 4th is a strong-beat
// dot, with a "beat.step" text readout in the center (always visible).
function currentIndicatorSteps() {
  const n = state.tracks[0]?.length;
  return Math.max(2, Math.min(64, Number.isFinite(n) ? n : 16));
}
function currentIndicatorMeter() {
  return activeMeter();
}
function buildBeatIndicator() {
  const svg = document.getElementById("beat-indicator");
  if (!svg) return;
  const steps = currentIndicatorSteps();
  const meter = currentIndicatorMeter();
  const spb = stepsPerBeatForMeter(meter);
  const sig = `${steps}@${meter.num}/${meter.den}`;
  if (svg.dataset.sig === sig) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = "http://www.w3.org/2000/svg";
  const r = 16;
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(ang) * r;
    const cy = Math.sin(ang) * r;
    const strong = i % spb === 0;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", cx.toFixed(2));
    dot.setAttribute("cy", cy.toFixed(2));
    dot.setAttribute("r", strong ? "2.4" : "1.5");
    dot.classList.add("beat-dot");
    if (strong) dot.classList.add("beat-strong");
    dot.dataset.idx = String(i);
    svg.appendChild(dot);
  }
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "0");
  label.setAttribute("y", "0");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.classList.add("beat-label");
  label.textContent = "1.1";
  svg.appendChild(label);
  svg.dataset.sig = sig;
  svg.dataset.steps = String(steps);
  svg.dataset.spb = String(spb);
}

function paintBeatIndicator(tick) {
  const svg = document.getElementById("beat-indicator");
  if (!svg) return;
  const wantSig = `${currentIndicatorSteps()}@${currentIndicatorMeter().num}/${currentIndicatorMeter().den}`;
  if (svg.dataset.sig !== wantSig) buildBeatIndicator();
  const steps = Number(svg.dataset.steps || 16);
  const spb = Number(svg.dataset.spb || 4);
  const raw = tick == null ? 0 : tick - 1;
  const idx = ((raw % steps) + steps) % steps;
  const beat = Math.floor(idx / spb) + 1;     // 1..num
  const sub  = (idx % spb) + 1;               // 1..stepsPerBeat
  for (const dot of svg.querySelectorAll(".beat-dot")) {
    dot.classList.toggle("now", Number(dot.dataset.idx) === idx);
  }
  const lbl = svg.querySelector(".beat-label");
  if (lbl) lbl.textContent = `${beat}.${sub}`;
}

const state = {
  tracks: [],
  playing: false,
  tick: 0,
  repeatId: null,
  nextId: 1,
  metronome: false,
  noteColors: false,  // diatonic pitch-class coloring on the roll + step grid
  currentSetName: null,  // last loaded/saved session name — drives version-bump suggestions
  audioCtx: null,
  ready: false,
  masterGain: null,
  masterAnalyser: null,
  midi: null,
  scale: { active: false, root: 0, mode: "minor" },
  activePattern: 0,
  patternMode: "repeat",
  patternSwitchMode: "immediate", // "immediate" | "finish" — finish waits until bar boundary before switching
  queuedPattern: null,
  patternMeta: Array(32).fill(null).map(() => ({ regenPattern: true, regenInstrument: true })),
  patternRepeats: Array(32).fill(1),
  patternMeters: Array(32).fill(null).map(() => ({ num: 4, den: 4 })),
  // Slots 1..31 follow pattern 1's meter until the user sets one explicitly; pattern 1
  // is always the source. Any true flag means "user customized — do not inherit from #1".
  patternMeterCustomized: Array(32).fill(false),
  chainBarCount: 0,
};

function emptyPattern(len) {
  return {
    steps: new Array(len).fill(0),
    lengths: new Array(len).fill(0),
    notes: new Array(len).fill(null),
    velocities: new Array(len).fill(0.5),
    chords: new Array(len).fill(""),
    offsets: new Array(len).fill(0),   // micro-timing offset in step fractions (-0.5..+0.5)
    arps: new Array(len).fill(false),           // arpeggiate the chord across the step's duration
    arpRates:  new Array(len).fill(0.25),       // beats per arp note
    arpRanges: new Array(len).fill(1),          // octave range
    arpDirs:   new Array(len).fill("up"),       // up / down / updown / random
    complexities: new Array(len).fill(0),       // chord inversion / voicing level
    ratchets: new Array(len).fill(1),           // retrigger the single note N times across the step
    sampleStarts: new Array(len).fill(0),       // sample-engine start offset (0..1 of buffer)
    sampleEnds:   new Array(len).fill(1),       // sample-engine end offset   (0..1 of buffer)
    sampleFadeIns:  new Array(len).fill(0),     // sample fade-in time in seconds (0 = click-guard)
    sampleFadeOuts: new Array(len).fill(0),     // sample fade-out time in seconds
    sampleLoopModes: new Array(len).fill("off"),// "off" | "loop" | "pingpong"
    // Per-step automation lanes, keyed by AUTOMATION_TARGETS key. Each lane:
    //   { enabled: bool, values: number[] }   — values normalized 0..1 per step
    automation: {},
  };
}

function aliasPattern(t, idx) {
  const p = t.patterns[idx];
  t.steps = p.steps;
  t.lengths = p.lengths;
  t.notes = p.notes;
  t.velocities = p.velocities;
  t.chords = p.chords;
  t.offsets      = p.offsets      ?? (p.offsets      = new Array(p.steps.length).fill(0));
  t.arps         = p.arps         ?? (p.arps         = new Array(p.steps.length).fill(false));
  t.arpRates     = p.arpRates     ?? (p.arpRates     = new Array(p.steps.length).fill(0.25));
  t.arpRanges    = p.arpRanges    ?? (p.arpRanges    = new Array(p.steps.length).fill(1));
  t.arpDirs      = p.arpDirs      ?? (p.arpDirs      = new Array(p.steps.length).fill("up"));
  t.complexities = p.complexities ?? (p.complexities = new Array(p.steps.length).fill(0));
  t.ratchets     = p.ratchets     ?? (p.ratchets     = new Array(p.steps.length).fill(1));
  t.sampleStarts = p.sampleStarts ?? (p.sampleStarts = new Array(p.steps.length).fill(0));
  t.sampleEnds   = p.sampleEnds   ?? (p.sampleEnds   = new Array(p.steps.length).fill(1));
  t.sampleFadeIns  = p.sampleFadeIns  ?? (p.sampleFadeIns  = new Array(p.steps.length).fill(0));
  t.sampleFadeOuts = p.sampleFadeOuts ?? (p.sampleFadeOuts = new Array(p.steps.length).fill(0));
  t.sampleLoopModes = p.sampleLoopModes ?? (p.sampleLoopModes = new Array(p.steps.length).fill("off"));
  t.automation = p.automation ?? (p.automation = {});
  // Patterns can have independent lengths; meter is pattern-global (state.patternMeters).
  // Mirror the active pattern's length into t.length / t.accents so every transport
  // / UI path reading them stays correct.
  t.length = p.steps.length;
  t.accents = autoAccents(t.length, state.patternMeters[idx]);
  if (t.el) {
    const lenEl = t.el.querySelector(".track-len");
    if (lenEl) lenEl.value = t.length;
  }
  t._patternIdx = idx;
}

// Rotate a chord up by `level` positions: each rotation moves the lowest note up an octave.
function invertChord(notes, level) {
  if (!level || notes.length < 2) return notes;
  const n = notes.length;
  const k = ((level % n) + n) % n;
  const out = notes.slice();
  for (let i = 0; i < k; i++) {
    const first = out.shift();
    out.push(first + 12);
  }
  return out;
}

function isPatternNonEmpty(idx) {
  for (const t of state.tracks) {
    const p = t.patterns?.[idx];
    if (!p) continue;
    for (let i = 0; i < p.steps.length; i++) { if (p.steps[i]) return true; }
  }
  return false;
}

function findNextNonEmptyPattern(fromIdx) {
  for (let off = 1; off <= PATTERN_COUNT; off++) {
    const idx = (fromIdx + off) % PATTERN_COUNT;
    if (isPatternNonEmpty(idx)) return idx;
  }
  return -1;
}

// When switch mode is "finish" and the transport is running, defer the switch
// until the end of the current bar; otherwise swap immediately.
function requestPatternSwitch(idx) {
  if (idx < 0 || idx >= PATTERN_COUNT) return;
  if (idx === state.activePattern) { state.queuedPattern = null; renderPatternGrid(); return; }
  if (state.patternSwitchMode === "finish" && state.playing) {
    state.queuedPattern = idx;
    renderPatternGrid();
    setStatus(`pattern ${idx + 1} queued`);
    return;
  }
  switchPattern(idx);
}

function switchPattern(idx) {
  if (idx < 0 || idx >= PATTERN_COUNT) return;
  state.activePattern = idx;
  state.queuedPattern = null;
  for (const t of state.tracks) {
    aliasPattern(t, idx);
    renderStepGrid(t);
    refreshRollIfOpen(t);
    refreshAutIfOpen(t);
  }
  renderPatternGrid();
  const repInput = document.getElementById("pattern-repeats");
  if (repInput) repInput.value = state.patternRepeats[idx] ?? 1;
  syncMeterUI();
  state.chainBarCount = 0;
}

function syncMeterUI() {
  const sel = document.getElementById("pattern-meter");
  if (sel) {
    const m = activeMeter();
    sel.value = `${m.num}/${m.den}`;
  }
  paintBeatIndicator(state.tick);
}

// ---- session save/load -------------------------------------------------

const SETS_KEY = "seqbaby.sets.v1";
function loadSetsMap() { try { return JSON.parse(localStorage.getItem(SETS_KEY) || "{}"); } catch { return {}; } }
function storeSetsMap(m) { try { localStorage.setItem(SETS_KEY, JSON.stringify(m)); } catch {} }

function serializeSet() {
  return {
    bpm: Number(document.getElementById("bpm").value),
    swing: Number(document.getElementById("swing").value),
    scale: { ...state.scale },
    activePattern: state.activePattern,
    patternMode: state.patternMode,
    patternSwitchMode: state.patternSwitchMode,
    patternMeters: state.patternMeters.map(m => ({ num: m.num, den: m.den })),
    tracks: state.tracks.map(t => ({
      name: t.name,
      engineKey: t.engineKey,
      length: t.length,
      params: { ...t.params },
      filter: { ...t.filter },
      fxConfig: JSON.parse(JSON.stringify(t.fxConfig)),
      midi: { ...t.midi },
      customConfig: t.customConfig ? JSON.parse(JSON.stringify(t.customConfig)) : null,
      elevenAudio: t.elevenAudio || null,
      elevenAudioMime: t.elevenAudioMime || null,
      uploadAudio: t.uploadAudio || null,
      uploadAudioMime: t.uploadAudioMime || null,
      uploadFileName: t.uploadFileName || null,
      soundPromptText: t.soundPromptText,
      promptText: t.promptText || "",
      sampleDefaults: t.sampleDefaults ? { ...t.sampleDefaults } : undefined,
      locked: t.locked, muted: t.muted, soloed: t.soloed,
      isDrumKit: !!t.isDrumKit,
      glide: t.glide, speed: t.speed ?? 1, sampleSpeedMode: t.sampleSpeedMode ?? "native",
      lfoConfig: JSON.parse(JSON.stringify(t.lfoConfig)),
      patterns: t.patterns.map(p => ({
        steps: p.steps.slice(),
        lengths: p.lengths.slice(),
        notes: p.notes.slice(),
        velocities: p.velocities.slice(),
        chords: p.chords.slice(),
        automation: p.automation ? Object.fromEntries(
          Object.entries(p.automation)
            .filter(([k]) => AUTOMATION_TARGETS[k])
            .map(([k, lane]) => [k, { enabled: !!lane.enabled, values: (lane.values || []).slice() }])
        ) : {},
      })),
    })),
  };
}

async function onSaveSet() {
  const suggested = suggestSetName();
  const name = await showInputDialog({ title: "save session as", defaultValue: suggested, placeholder: "my-session" });
  if (!name || !name.trim()) return;
  const finalName = name.trim();
  const all = loadSetsMap();
  const data = serializeSet();
  data._savedAt = new Date().toISOString();
  all[finalName] = data;
  storeSetsMap(all);
  state.currentSetName = finalName;  // bump the version basis for the next save
  setStatus(`saved set "${finalName}"`);
}

// MM/DD/YYYY date string for the load-session chooser; returns null if the
// timestamp is missing or unparseable.
function formatSavedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Suggest the next save name. If a session is already loaded/saved under some
// name, bump its "vN" suffix (or append "v2"); look at every existing saved
// set with the same stem so successive saves stay on the highest free version.
// Fresh sessions get a random kenning + 3-char token.
function suggestSetName() {
  const cur = state.currentSetName;
  if (cur && cur.trim()) {
    const baseM = cur.match(/^(.*?)\s*v(\d+)\s*$/i);
    const stem = (baseM ? baseM[1] : cur).trim();
    let highest = baseM ? parseInt(baseM[2], 10) : 1;
    if (stem) {
      const all = loadSetsMap();
      const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${esc}\\s*v(\\d+)\\s*$`, "i");
      for (const n of Object.keys(all)) {
        const m = n.match(re);
        if (m) {
          const v = parseInt(m[1], 10);
          if (v > highest) highest = v;
        }
      }
      return `${stem} v${highest + 1}`;
    }
  }
  const FALLBACK = ["midnight-bloom", "hollow-signal", "copper-ritual", "vapor-drift", "salt-echo", "ash-current", "dusk-thread", "neon-hymn", "glass-tide", "bone-glyph"];
  return FALLBACK[Math.floor(Math.random() * FALLBACK.length)] + "-" + shortToken();
}

function shortToken() {
  return Math.random().toString(36).slice(2, 5);
}

function onExportSet() {
  try {
    const data = serializeSet();
    data._version = 1;
    data._exportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `seqbaby-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("exported session");
  } catch (err) {
    console.error(err);
    setStatus("export failed — see console", true);
  }
}

async function onShareSet() {
  const btn = document.getElementById("set-share");
  btn.disabled = true;
  setStatus("packing session…");
  try {
    const r = await fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: serializeSet() }),
    });
    if (!r.ok) throw new Error(await r.text());
    const { id } = await r.json();
    const url = `${location.origin}${location.pathname}?s=${encodeURIComponent(id)}`;
    try { await navigator.clipboard.writeText(url); setStatus(`link copied: ${url}`); }
    catch { setStatus(`share link: ${url}`); prompt("share link", url); }
  } catch (err) {
    console.error(err);
    setStatus("share failed — see console", true);
  } finally {
    btn.disabled = false;
  }
}

async function loadShareFromUrl() {
  const qs = new URLSearchParams(location.search);
  const id = qs.get("s");
  if (!id) return;
  setStatus(`loading shared session ${id}…`);
  try {
    const r = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(await r.text());
    const { session } = await r.json();
    if (!session) throw new Error("empty session");
    applySet(session);
    setStatus(`loaded shared session ${id}`);
    // Clear the query so subsequent reloads don't keep reapplying it.
    try { history.replaceState({}, "", location.origin + location.pathname); } catch {}
  } catch (err) {
    console.error(err);
    setStatus(`couldn't load share "${id}"`, true);
  }
}

function onImportSet() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.style.display = "none";
  document.body.appendChild(inp);
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) { inp.remove(); return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      applySet(data);
      setStatus(`imported ${file.name}`);
    } catch (err) {
      console.error(err);
      setStatus("import failed — see console", true);
    } finally {
      inp.remove();
    }
  });
  inp.click();
}

async function onLoadSet() {
  const all = loadSetsMap();
  const names = Object.keys(all);
  if (!names.length) { setStatus("no saved sessions", true); return; }
  // Sort newest-first by _savedAt; sessions saved before timestamps existed
  // (no _savedAt) sink to the bottom, then alpha-sorted among themselves.
  names.sort((a, b) => {
    const ta = Date.parse(all[a]?._savedAt ?? "");
    const tb = Date.parse(all[b]?._savedAt ?? "");
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    if (vb !== va) return vb - va;
    return a.localeCompare(b);
  });
  const options = names.map(name => {
    const dt = formatSavedAt(all[name]?._savedAt);
    return { value: name, label: dt ? `${name} — ${dt}` : name };
  });
  const choice = await showSelectDialog({ title: "load session", options });
  if (!choice) return;
  if (choice.action === "delete") {
    delete all[choice.value];
    storeSetsMap(all);
    setStatus(`deleted "${choice.value}"`);
    return;
  }
  // Stamp the basis BEFORE applySet so a throw in apply can't leave us with
  // a loaded session that doesn't bump its version on the next save.
  state.currentSetName = choice.value;
  applySet(all[choice.value]);
}

function applySet(s) {
  if (!s) return;
  if (state.playing) {
    Tone.Transport.stop();
    if (state.repeatId !== null) { try { Tone.Transport.clear(state.repeatId); } catch {} state.repeatId = null; }
    silenceAllVoices();
    state.playing = false;
    const btn = document.getElementById("play");
    btn.textContent = "play";
    btn.classList.remove("playing");
    state.tick = 0;
  }
  for (const t of [...state.tracks]) removeTrack(t);
  if (Number.isFinite(s.bpm))   document.getElementById("bpm").value = s.bpm;
  if (Number.isFinite(s.swing)) document.getElementById("swing").value = s.swing;
  if (s.scale) { Object.assign(state.scale, s.scale); syncScaleUI(); }
  state.activePattern = Math.max(0, Math.min(PATTERN_COUNT - 1, s.activePattern ?? 0));
  // Hoist pattern meters: prefer the new global array; otherwise salvage the
  // first track's per-pattern meter from legacy saves.
  const legacyMeters = Array.isArray(s.tracks?.[0]?.patterns)
    ? s.tracks[0].patterns.map(p => p?.meter && parseMeter(`${p.meter.num}/${p.meter.den}`)).map(m => m || { num: 4, den: 4 })
    : [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const src = (s.patternMeters && s.patternMeters[i]) || legacyMeters[i];
    const parsed = src ? parseMeter(`${src.num}/${src.den}`) : null;
    state.patternMeters[i] = parsed || { num: 4, den: 4 };
  }
  // Derive customization: any slot whose meter differs from pattern 1's is treated
  // as user-customized (so later edits to #1 don't clobber it).
  {
    const m0 = state.patternMeters[0];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const mi = state.patternMeters[i];
      state.patternMeterCustomized[i] = i !== 0 && (mi.num !== m0.num || mi.den !== m0.den);
    }
  }
  state.patternMode = s.patternMode === "chain" ? "chain" : "repeat";
  const modeBtn = document.getElementById("pattern-mode");
  modeBtn.innerHTML = state.patternMode === "chain" ? ICON_CHAIN : ICON_REPEAT;
  modeBtn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
  state.patternSwitchMode = s.patternSwitchMode === "finish" ? "finish" : "immediate";
  const switchBtn = document.getElementById("pattern-switch");
  if (switchBtn) {
    switchBtn.innerHTML = state.patternSwitchMode === "finish" ? ICON_FINISH : ICON_NOW;
    switchBtn.setAttribute("aria-pressed", String(state.patternSwitchMode === "finish"));
  }
  for (const td of s.tracks || []) {
    const t = createTrack({ name: td.name || "track", engineKey: td.engineKey || "plaits:0", length: td.length || 16 });
    Object.assign(t.params, td.params || {});
    Object.assign(t.filter, td.filter || {});
    Object.assign(t.fxConfig, td.fxConfig || {});
    Object.assign(t.midi, td.midi || {});
    t.customConfig = td.customConfig || null;
    t.elevenAudio = td.elevenAudio || null;
    t.elevenAudioMime = td.elevenAudioMime || null;
    t.uploadAudio = td.uploadAudio || null;
    t.uploadAudioMime = td.uploadAudioMime || null;
    t.uploadFileName = td.uploadFileName || null;
    t.soundPromptText = td.soundPromptText || "";
    t.promptText = td.promptText || "";
    t.sampleDefaults = td.sampleDefaults
      ? { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off", ...td.sampleDefaults }
      : { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off" };
    // decode any saved sample buffers (async; once done the voice picks it up)
    if (t.elevenAudio) {
      (async () => {
        try {
          const bytes = Uint8Array.from(atob(t.elevenAudio), c => c.charCodeAt(0));
          await ensureAudio();
          const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer), { trim: true });
          t.elevenBuffer = buffer;
          if (t.voice?.type === "eleven") { t.voice.setBuffer(buffer); applySampleSpeed(t); }
        } catch (e) { console.warn("eleven buffer decode failed", e); }
      })();
    }
    if (t.uploadAudio) {
      (async () => {
        try {
          const bytes = Uint8Array.from(atob(t.uploadAudio), c => c.charCodeAt(0));
          await ensureAudio();
          const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
          t.uploadBuffer = buffer;
          if (t.voice?.type === "upload") { t.voice.setBuffer(buffer); applySampleSpeed(t); }
        } catch (e) { console.warn("upload buffer decode failed", e); }
      })();
    }
    t.locked = !!td.locked;
    t.muted  = !!td.muted;
    t.soloed = !!td.soloed;
    t.isDrumKit = typeof td.isDrumKit === "boolean"
      ? td.isDrumKit
      : guessIsDrumKit({ engineKey: t.engineKey, name: t.name });
    t.glide  = td.glide ?? 0;
    t.speed  = td.speed ?? 1;
    t.sampleSpeedMode = td.sampleSpeedMode ?? "native";
    Object.assign(t.lfoConfig, td.lfoConfig || {});
    if (Array.isArray(td.patterns)) {
      const pad = (arr, fill, n) => { const out = (arr || []).slice(0, n); while (out.length < n) out.push(fill); return out; };
      for (let i = 0; i < Math.min(PATTERN_COUNT, td.patterns.length); i++) {
        const p = td.patterns[i];
        if (!p) continue;
        // Per-pattern length: prefer the saved pattern's own step array length;
        // falls back to t.length for older saves that didn't vary per pattern.
        const n = Math.max(1, Array.isArray(p.steps) ? p.steps.length : t.length);
        const automation = {};
        if (p.automation && typeof p.automation === "object") {
          for (const [k, lane] of Object.entries(p.automation)) {
            if (!AUTOMATION_TARGETS[k] || !lane) continue;
            automation[k] = {
              enabled: !!lane.enabled,
              values: pad(Array.isArray(lane.values) ? lane.values : [], 0.5, n),
            };
          }
        }
        t.patterns[i] = {
          steps: pad(p.steps, 0, n),
          lengths: pad(p.lengths, 0, n),
          notes: pad(p.notes, null, n),
          velocities: pad(p.velocities, 0.5, n),
          chords: pad(p.chords, "", n),
          automation,
        };
      }
    }
    aliasPattern(t, state.activePattern);
    if (t.el) {
      const q = s => t.el.querySelector(s);
      q(".track-name").value = t.name;
      q(".track-len").value = t.length;
      q(".track-engine").value = t.engineKey;
      q(".track-glide").value = t.glide;
      q(".p-vol").value = t.params.vol;
      q(".p-harm").value = t.params.harm;
      q(".p-timb").value = t.params.timb;
      q(".p-morph").value = t.params.morph;
      q(".p-decay").value = t.params.decay;
      q(".p-cutoff").value = t.filter.cutoff;
      q(".p-reson").value = t.filter.reson;
      q(".p-envamt").value = t.filter.env;
      q(".p-envatk").value = t.filter.attack;
      q(".p-envdec").value = t.filter.decay;
      q(".p-envsus").value = t.filter.sustain;
      q(".p-envrel").value = t.filter.release;
      q(".track-lock")?.setAttribute("aria-pressed", String(t.locked));
      q(".track-solo")?.setAttribute("aria-pressed", String(t.soloed));
      t.el.classList.toggle("muted", t.muted);
      t.el.classList.toggle("locked", t.locked);
      t.el.classList.toggle("soloed", t.soloed);
      refreshFxPanelUI(t);
      renderModPanel(t, t.el.querySelector(".track-mod-panel"));
    }
    if (state.ready) {
      disposeLFOs(t);
      if (t.voice) t.voice.dispose();
      ensureFxRack(t);
      if (t.fxRack) {
        if (t.fxConfig.vinyl)      t.fxRack.applyVinyl(t.fxConfig.vinyl);
        if (t.fxConfig.cassette)   t.fxRack.applyCassette(t.fxConfig.cassette);
        t.fxRack.applyFuzz(t.fxConfig.fuzz);
        if (t.fxConfig.ringmod)    t.fxRack.applyRingMod(t.fxConfig.ringmod);
        if (t.fxConfig.shaper)     t.fxRack.applyWaveShaper(t.fxConfig.shaper);
        if (t.fxConfig.crush)      t.fxRack.applyCrush(t.fxConfig.crush);
        if (t.fxConfig.autowah)    t.fxRack.applyAutoWah(t.fxConfig.autowah);
        if (t.fxConfig.chorus)     t.fxRack.applyChorus(t.fxConfig.chorus);
        if (t.fxConfig.phaser)     t.fxRack.applyPhaser(t.fxConfig.phaser);
        if (t.fxConfig.flanger)    t.fxRack.applyFlanger(t.fxConfig.flanger);
        if (t.fxConfig.pitchshift) t.fxRack.applyPitchShift(t.fxConfig.pitchshift);
        t.fxRack.applyDelay(t.fxConfig.delay);
        t.fxRack.applyReverb(t.fxConfig.reverb);
      }
      t.voice = buildVoiceForEngine(state.audioCtx, t.engineKey, t.params, t);
      if (t.voice.type === "midi") {
        t.voice.setChannel(t.midi.channel);
        const out = state.midi?.outputs.get(t.midi.outputId);
        if (out) t.voice.setOutput(out);
      }
      if (t.voice.setGlide) t.voice.setGlide(t.glide);
      routeVoiceToRack(t);
      syncAllLFOs(t);
    }
    updatePlaitsControlsVisibility(t);
    renderStepGrid(t);
  }
  renderPatternGrid();
  syncMeterUI();
  setStatus("set loaded");
}

function showSelectDialog({ title, options }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // Options may be plain strings or `{label, value}` objects.
    const opts = options.map(o => {
      const value = typeof o === "string" ? o : o.value;
      const label = typeof o === "string" ? o : (o.label ?? o.value);
      return `<option value="${esc(value)}">${esc(label)}</option>`;
    }).join("");
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">${esc(title)}</div>
        <select class="modal-input" size="8" style="min-height:140px">${opts}</select>
        <div class="modal-actions">
          <button class="modal-cancel ghost">cancel</button>
          <button class="modal-delete ghost danger">delete</button>
          <button class="modal-ok">load</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const sel = overlay.querySelector(".modal-input");
    setTimeout(() => sel.focus(), 0);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector(".modal-ok").addEventListener("click", () => close({ action: "load", value: sel.value }));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.querySelector(".modal-delete").addEventListener("click", () => close({ action: "delete", value: sel.value }));
    sel.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); close({ action: "load", value: sel.value }); }
      if (e.key === "Escape") close(null);
    });
    sel.addEventListener("dblclick", () => close({ action: "load", value: sel.value }));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(null); });
  });
}

function copyPattern(from, to) {
  if (from === to) return;
  for (const t of state.tracks) {
    const src = t.patterns?.[from];
    if (!src) continue;
    t.patterns[to] = {
      steps: src.steps.slice(),
      lengths: src.lengths.slice(),
      notes: src.notes.slice(),
      velocities: src.velocities.slice(),
      chords: src.chords.slice(),
    };
  }
  // Meter + customization travel with the duped pattern so it keeps its
  // time signature and stays independent from pattern 1's meter.
  const srcMeter = state.patternMeters[from];
  if (srcMeter) state.patternMeters[to] = { num: srcMeter.num, den: srcMeter.den };
  if (to !== 0) state.patternMeterCustomized[to] = !!state.patternMeterCustomized[from]
    || (srcMeter && (srcMeter.num !== state.patternMeters[0].num || srcMeter.den !== state.patternMeters[0].den));
  if (state.activePattern === to) {
    for (const t of state.tracks) {
      aliasPattern(t, to);
      renderStepGrid(t);
    }
  }
  renderPatternGrid();
  setStatus(`copied pattern ${from + 1} → ${to + 1}`);
}

function renderPatternGrid() {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;
  grid.replaceChildren();
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const cell = document.createElement("button");
    cell.className = "pattern-cell";
    if (isPatternNonEmpty(i)) cell.classList.add("filled");
    if (i === state.activePattern) cell.classList.add("active");
    if (i === state.queuedPattern) cell.classList.add("queued");
    cell.textContent = String(i + 1);
    cell.title = `pattern ${i + 1} — drag to copy`;
    cell.draggable = true;
    cell.dataset.patternIdx = String(i);
    cell.addEventListener("click", () => requestPatternSwitch(i));
    cell.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/pattern-idx", String(i));
      e.dataTransfer.effectAllowed = "copy";
    });
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const from = Number(e.dataTransfer.getData("text/pattern-idx"));
      if (Number.isFinite(from)) copyPattern(from, i);
    });
    grid.appendChild(cell);
  }
}

// ---- rate helpers (LFO) ------------------------------------------------

const RATE_MIN = 0.05, RATE_MAX = 20;
function sliderToRate(v) { return RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, v); }
function rateToSlider(hz) {
  return Math.log(Math.max(RATE_MIN, hz) / RATE_MIN) / Math.log(RATE_MAX / RATE_MIN);
}

// ---- note helpers ------------------------------------------------------

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function midiToName(m) {
  const raw = Number(m);
  if (!Number.isFinite(raw)) return "";
  // Microtonal pitches (quarter tones etc.) display with a cents offset against
  // the nearest semitone, e.g. "D2-50c" for D2 minus a quarter tone.
  const base = Math.round(raw);
  const cents = Math.round((raw - base) * 100);
  const name = NOTE_NAMES[((base % 12) + 12) % 12] + (Math.floor(base / 12) - 1);
  return cents === 0 ? name : `${name}${cents > 0 ? "+" : ""}${cents}c`;
}
function nameToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1].toUpperCase()];
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return base + acc + (Number(m[3]) + 1) * 12;
}

// ---- sample buffer cache -----------------------------------------------

const bufferCache = new Map();
async function loadBuffer(ctx, url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`sample ${url}: ${r.status}`);
    return r.arrayBuffer();
  }).then(ab => ctx.decodeAudioData(ab));
  bufferCache.set(url, p);
  return p;
}

// ---- effects rack ------------------------------------------------------

// DBA Fuzz War-ish curve: asymmetric hard clip with unstable harmonic sputter.
function makeFuzzCurve(drive) {
  const n = 2048;
  const curve = new Float32Array(n);
  const gain = 8 + drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y = Math.tanh(x * gain);
    if (x < 0) y = y * 0.88 + Math.sin(x * 3.1) * 0.08;       // asymmetry
    if (Math.abs(x) > 0.55) y += Math.sin(x * 22) * 0.08 * (Math.abs(x) - 0.55);  // spitting
    y = Math.max(-1, Math.min(1, y));
    curve[i] = y;
  }
  return curve;
}

// Triangle-wave folder (MiniBrute Metalizer): amount in 0..1. 0 = untouched, 1 = heavy fold.
function makeMetalizerCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const fold = 1 + amount * 6; // fold depth (number of reflections at max)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Classic wave-folder: x * fold, then triangle-fold back into [-1, 1]
    let y = x * fold;
    while (y > 1)  y = 2 - y;
    while (y < -1) y = -2 - y;
    curve[i] = y;
  }
  return curve;
}

function defaultFxConfig() {
  return {
    vinyl:      { amount: 0, warmth: 0.4, wow: 0.3 },
    cassette:   { amount: 0, flutter: 0.3, sat: 0.4 },
    fuzz:       { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
    ringmod:    { wet: 0, freq: 0.35 },           // freq is 0..1, log-mapped to ~20..3000 Hz
    shaper:     { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" },  // wave shaper: wet/dry + input preamp + curve drive + mode
    crush:      { bits: 8, wet: 0 },
    autowah:    { wet: 0, sens: 0.5, range: 0.5 },
    chorus:     { wet: 0, rate: 0.5, depth: 0.5 },
    phaser:     { wet: 0, rate: 0.3, depth: 0.5 },
    flanger:    { wet: 0, rate: 0.3, fbk: 0.5 },
    pitchshift: { wet: 0, semitones: 0 },
    delay:      { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb:     { decay: 2, wet: 0 },
  };
}

// SP-404 "vinyl sim" crackle bed: base hiss with sparse impulsive crackles sprinkled in.
function makeVinylCrackleBuffer(ctx, seconds) {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.06;
  const crackles = Math.floor(seconds * 22);
  for (let c = 0; c < crackles; c++) {
    const pos = Math.floor(Math.random() * (len - 40));
    const amp = 0.35 + Math.random() * 0.55;
    const width = 2 + Math.floor(Math.random() * 10);
    for (let j = 0; j < width; j++) {
      data[pos + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / 4);
    }
  }
  return buf;
}

// Tape hiss bed: pink-ish noise via a 1-pole lowpass on white noise.
function makeTapeHissBuffer(ctx, seconds) {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    prev = prev * 0.85 + w * 0.15;
    data[i] = prev * 0.6;
  }
  return buf;
}

// Wave-shaper mode kernels. Each takes an already-driven input value x and
// returns the shaped output. `amount` deepens the effect via the pre-gain
// baked into makeShaperCurve.
function shapeSample(mode, x) {
  switch (mode) {
    case "saturate":
      // gentle tanh saturation — smooth, musical, no hard edge
      return Math.tanh(x);
    case "softclip":
      // cubic soft-clip; ramps to ±1 with rounded shoulder
      if (x >= 1) return 1;
      if (x <= -1) return -1;
      return 1.5 * x - 0.5 * x * x * x;
    case "clip":
      // hard clip at ±1
      return Math.max(-1, Math.min(1, x));
    case "serge": {
      // Serge-style sine-folded triangle: smoother than a plain fold,
      // more harmonics than saturate
      let y = ((x + 1) % 4 + 4) % 4;
      if (y > 2) y = 4 - y;
      return Math.sin((y - 1) * Math.PI / 2);
    }
    case "fold": {
      // Triangle wave-folder: reflects past ±1 instead of clipping
      let y = ((x + 1) % 4 + 4) % 4;
      if (y > 2) y = 4 - y;
      return y - 1;
    }
    case "wrap": {
      // Sawtooth wrap: modulo around [-1, +1] — buzzy, aliased character
      const y = ((x + 1) % 2 + 2) % 2;
      return y - 1;
    }
  }
  return Math.tanh(x);
}

const SHAPER_MODES = ["saturate", "softclip", "clip", "serge", "fold", "wrap"];

// Map a 0..1 preamp knob to a gain multiplier. 0.5 = unity (1x); below cuts
// the input (down to 0.25x at slider 0); above pushes harder into the curve
// (up to 8x at slider 1). Exponential so the upper half feels like a "drive".
function shaperPreampGain(v) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  return x <= 0.5
    ? 0.25 + (x / 0.5) * 0.75       // 0.25x → 1x
    : Math.pow(8, (x - 0.5) / 0.5); // 1x → 8x
}

// Build a 4096-sample waveshaper curve for the given mode. `amount` (0..1) is
// the pre-curve drive (1..9x) so harder values push the signal further into
// the mode's nonlinearity.
function makeShaperCurve(mode, amount) {
  const n = 4096;
  const c = new Float32Array(n);
  const drive = 1 + Math.max(0, Math.min(1, amount)) * 8;
  const m = SHAPER_MODES.includes(mode) ? mode : "fold";
  for (let i = 0; i < n; i++) {
    const x = ((i * 2) / (n - 1) - 1) * drive;
    c[i] = shapeSample(m, x);
  }
  return c;
}

// Soft tape-style saturation curve (tanh with variable drive).
function makeCassetteSatCurve(drive) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + drive * 7;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  return c;
}

class FXRack {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    // Make sure legacy configs (pre-SP-404 fx) don't crash.
    if (!config.vinyl)      config.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
    if (!config.cassette)   config.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
    if (!config.chorus)     config.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
    if (!config.crush)      config.crush      = { bits: 8, wet: 0 };
    if (!config.ringmod)    config.ringmod    = { wet: 0, freq: 0.35 };
    if (!config.autowah)    config.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
    if (!config.phaser)     config.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
    if (!config.flanger)    config.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
    if (!config.pitchshift) config.pitchshift = { wet: 0, semitones: 0 };

    this.input = ctx.createGain();

    // ── vinyl sim stage (parallel wet/dry + crackle bed) ──
    // wet path: lowpass (warmth) → wow (LFO-modulated delay)
    this.vinylDryBus = ctx.createGain();
    this.vinylWetBus = ctx.createGain();
    this.vinylSum    = ctx.createGain();
    this.vinylLP = ctx.createBiquadFilter();
    this.vinylLP.type = "lowpass";
    this.vinylLP.Q.value = 0.7;
    this.vinylWowDelay = ctx.createDelay(0.05);
    this.vinylWowDelay.delayTime.value = 0.005;
    this.vinylWowLFO = new Tone.LFO({ frequency: 0.45, min: 0.003, max: 0.007, type: "sine" }).start();
    this.vinylWowLFO.connect(this.vinylWowDelay.delayTime);
    // crackle noise bed (level scales with vinyl amount)
    this.vinylNoiseSrc = ctx.createBufferSource();
    this.vinylNoiseSrc.buffer = makeVinylCrackleBuffer(ctx, 4);
    this.vinylNoiseSrc.loop = true;
    this.vinylNoiseGain = ctx.createGain();
    this.vinylNoiseGain.gain.value = 0;
    this.input.connect(this.vinylDryBus);
    this.input.connect(this.vinylLP);
    this.vinylLP.connect(this.vinylWowDelay);
    this.vinylWowDelay.connect(this.vinylWetBus);
    this.vinylNoiseSrc.connect(this.vinylNoiseGain);
    this.vinylNoiseGain.connect(this.vinylSum);
    this.vinylDryBus.connect(this.vinylSum);
    this.vinylWetBus.connect(this.vinylSum);
    try { this.vinylNoiseSrc.start(); } catch {}

    // ── cassette stage (parallel wet/dry + flutter + sat + hiss) ──
    this.cassetteDryBus = ctx.createGain();
    this.cassetteWetBus = ctx.createGain();
    this.cassetteSum    = ctx.createGain();
    // tape bandwidth: gentle HPF + LPF sandwich
    this.cassetteHP = ctx.createBiquadFilter();
    this.cassetteHP.type = "highpass";
    this.cassetteHP.frequency.value = 60;
    this.cassetteLP = ctx.createBiquadFilter();
    this.cassetteLP.type = "lowpass";
    this.cassetteLP.frequency.value = 9500;
    // flutter: short LFO-modulated delay
    this.cassetteFlutter = ctx.createDelay(0.03);
    this.cassetteFlutter.delayTime.value = 0.003;
    this.cassetteFlutterLFO = new Tone.LFO({ frequency: 5.2, min: 0.002, max: 0.004, type: "sine" }).start();
    this.cassetteFlutterLFO.connect(this.cassetteFlutter.delayTime);
    // saturation
    this.cassetteSat = ctx.createWaveShaper();
    this.cassetteSat.oversample = "2x";
    // hiss (gain scales with cassette amount)
    this.cassetteHissSrc = ctx.createBufferSource();
    this.cassetteHissSrc.buffer = makeTapeHissBuffer(ctx, 4);
    this.cassetteHissSrc.loop = true;
    this.cassetteHissGain = ctx.createGain();
    this.cassetteHissGain.gain.value = 0;
    this.vinylSum.connect(this.cassetteDryBus);
    this.vinylSum.connect(this.cassetteHP);
    this.cassetteHP.connect(this.cassetteFlutter);
    this.cassetteFlutter.connect(this.cassetteSat);
    this.cassetteSat.connect(this.cassetteLP);
    this.cassetteLP.connect(this.cassetteWetBus);
    this.cassetteHissSrc.connect(this.cassetteHissGain);
    this.cassetteHissGain.connect(this.cassetteSum);
    this.cassetteDryBus.connect(this.cassetteSum);
    this.cassetteWetBus.connect(this.cassetteSum);
    try { this.cassetteHissSrc.start(); } catch {}

    // ── fuzz stage (DBA-style parallel wet/dry) ──
    this.dryBus = ctx.createGain();
    this.wetBus = ctx.createGain();
    this.fuzzDrive = ctx.createGain();
    this.fuzzShaper = ctx.createWaveShaper();
    this.fuzzShaper.oversample = "4x";
    this.fuzzFilter = ctx.createBiquadFilter();
    this.fuzzFilter.type = "lowpass";
    this.fuzzFilter.Q.value = 2.2;
    this.fuzzLevel = ctx.createGain();
    this.cassetteSum.connect(this.dryBus);
    this.cassetteSum.connect(this.fuzzDrive);
    this.fuzzDrive.connect(this.fuzzShaper);
    this.fuzzShaper.connect(this.fuzzFilter);
    this.fuzzFilter.connect(this.fuzzLevel);
    this.fuzzLevel.connect(this.wetBus);
    this.postFuzz = ctx.createGain();
    this.dryBus.connect(this.postFuzz);
    this.wetBus.connect(this.postFuzz);

    // ── ring mod stage (native: carrier-modulated gain, parallel wet/dry) ──
    // Standard trick: set gain.value = 0, connect carrier osc to gain.gain → output = input * carrier.
    this.ringDry = ctx.createGain();
    this.ringWet = ctx.createGain();
    this.ringSum = ctx.createGain();
    this.ringMult = ctx.createGain();
    this.ringMult.gain.value = 0;
    this.ringCarrier = ctx.createOscillator();
    this.ringCarrier.type = "sine";
    this.ringCarrier.frequency.value = 220;
    this.ringCarrier.connect(this.ringMult.gain);
    this.postFuzz.connect(this.ringDry);
    this.postFuzz.connect(this.ringMult);
    this.ringMult.connect(this.ringWet);
    this.ringDry.connect(this.ringSum);
    this.ringWet.connect(this.ringSum);
    try { this.ringCarrier.start(); } catch {}

    // ── wave shaper (native waveshaper, parallel wet/dry crossfade) ──
    // Mode picks the nonlinearity (saturate / softclip / clip / serge / fold /
    // wrap); amount is the drive baked into the curve; preamp is a clean
    // input boost (0..1 → 0.25x..8x) BEFORE the curve, controllable
    // independently. Sits between ring mod and crusher.
    if (!config.shaper) config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
    if (!config.shaper.mode) config.shaper.mode = "fold";
    if (config.shaper.preamp == null) config.shaper.preamp = 0.5;
    this.shaperDryBus = ctx.createGain();
    this.shaperWetBus = ctx.createGain();
    this.shaperSum    = ctx.createGain();
    this.shaperPreamp = ctx.createGain();
    this.shaperPreamp.gain.value = shaperPreampGain(config.shaper.preamp);
    this.shaperNode   = ctx.createWaveShaper();
    this.shaperNode.curve = makeShaperCurve(config.shaper.mode, config.shaper.amount ?? 0.5);
    this.shaperNode.oversample = "2x";
    this.shaperPost = ctx.createGain();
    this.shaperPost.gain.value = 0.85;  // small trim — the curve outputs already clamp to ±1
    this.ringSum.connect(this.shaperDryBus);
    this.ringSum.connect(this.shaperPreamp);
    this.shaperPreamp.connect(this.shaperNode);
    this.shaperNode.connect(this.shaperPost);
    this.shaperPost.connect(this.shaperWetBus);
    this.shaperDryBus.connect(this.shaperSum);
    this.shaperWetBus.connect(this.shaperSum);
    this.shaperDryBus.gain.value = 1 - (config.shaper.wet ?? 0);
    this.shaperWetBus.gain.value = config.shaper.wet ?? 0;

    // ── Tone stages: crusher → autowah → chorus → phaser → flanger → pitchshift → delay → reverb ──
    this.crusher = new Tone.BitCrusher({
      bits: Math.max(1, Math.min(16, config.crush?.bits ?? 8)),
      wet: config.crush?.wet ?? 0,
    });
    this.autowah = new Tone.AutoWah({
      baseFrequency: 100,
      octaves: 1 + (config.autowah.range ?? 0.5) * 4,
      sensitivity: -10 - (config.autowah.sens ?? 0.5) * 30,
      Q: 2,
      gain: 2,
      wet: config.autowah.wet ?? 0,
    });
    this.chorus = new Tone.Chorus({
      frequency: 0.5 + (config.chorus.rate ?? 0.5) * 4.5,
      delayTime: 3.2,
      depth: config.chorus.depth ?? 0.5,
      feedback: 0,
      wet: config.chorus.wet ?? 0,
      spread: 180,
    }).start();
    this.phaser = new Tone.Phaser({
      frequency: 0.05 + (config.phaser.rate ?? 0.3) * 3.95,
      octaves: 1 + (config.phaser.depth ?? 0.5) * 5,
      baseFrequency: 350,
      Q: 10,
      wet: config.phaser.wet ?? 0,
    });

    // flanger: native short feedback-delay + LFO-modulated delay time
    this.flangerIn = ctx.createGain();
    this.flangerDry = ctx.createGain();
    this.flangerWet = ctx.createGain();
    this.flangerSum = ctx.createGain();
    this.flangerDelayNode = ctx.createDelay(0.02);
    this.flangerDelayNode.delayTime.value = 0.003;
    this.flangerFeedback = ctx.createGain();
    this.flangerFeedback.gain.value = 0.5;
    this.flangerLFO = new Tone.LFO({
      frequency: 0.05 + (config.flanger.rate ?? 0.3) * 3.95,
      min: 0.0005,
      max: 0.005,
      type: "sine",
    }).start();
    this.flangerLFO.connect(this.flangerDelayNode.delayTime);
    this.flangerIn.connect(this.flangerDry);
    this.flangerIn.connect(this.flangerDelayNode);
    this.flangerDelayNode.connect(this.flangerFeedback);
    this.flangerFeedback.connect(this.flangerDelayNode);
    this.flangerDelayNode.connect(this.flangerWet);
    this.flangerDry.connect(this.flangerSum);
    this.flangerWet.connect(this.flangerSum);

    this.pitchshift = new Tone.PitchShift({
      pitch: config.pitchshift.semitones ?? 0,
      windowSize: 0.1,
      delayTime: 0,
      feedback: 0,
      wet: config.pitchshift.wet ?? 0,
    });

    this.delay = new Tone.FeedbackDelay({
      delayTime: config.delay.time,
      feedback: config.delay.fbk,
      wet: config.delay.wet,
      maxDelay: 2,
    });
    this.reverb = new Tone.Reverb({ decay: config.reverb.decay, wet: config.reverb.wet, preDelay: 0.02 });
    this.reverb.generate().catch(() => {});

    this.output = ctx.createGain();
    // Native GainNode.connect() in Tone.js 15 rejects Tone wrappers — unwrap to
    // the underlying native input node before connecting from a native source.
    const toneIn = (node) => node.input?.input ?? node.input ?? node;
    this.shaperSum.connect(toneIn(this.crusher));
    this.crusher.connect(this.autowah);
    this.autowah.connect(this.chorus);
    this.chorus.connect(this.phaser);
    this.phaser.connect(this.flangerIn);
    this.flangerSum.connect(toneIn(this.pitchshift));
    this.pitchshift.connect(this.delay);
    this.delay.connect(this.reverb);
    this.reverb.connect(this.output);
    this.output.connect(ctx.destination);

    this.applyVinyl(config.vinyl);
    this.applyCassette(config.cassette);
    this.applyFuzz(config.fuzz);
    this.applyRingMod(config.ringmod);
    this.applyWaveShaper(config.shaper);
    this.applyAutoWah(config.autowah);
    this.applyChorus(config.chorus);
    this.applyPhaser(config.phaser);
    this.applyFlanger(config.flanger);
    this.applyPitchShift(config.pitchshift);
  }

  applyVinyl({ amount, warmth, wow }) {
    if (amount !== undefined) {
      this.config.vinyl.amount = amount;
      this.vinylDryBus.gain.value = 1 - amount;
      this.vinylWetBus.gain.value = amount;
      this.vinylNoiseGain.gain.value = amount * 0.45;
    }
    if (warmth !== undefined) {
      this.config.vinyl.warmth = warmth;
      // warmth 0 → 9 kHz (bright), warmth 1 → 1.8 kHz (dull)
      this.vinylLP.frequency.value = 9000 - warmth * 7200;
    }
    if (wow !== undefined) {
      this.config.vinyl.wow = wow;
      const base = 0.005;
      const span = 0.0008 + wow * 0.006; // up to ±6 ms
      this.vinylWowLFO.min = base - span;
      this.vinylWowLFO.max = base + span;
    }
  }

  applyCassette({ amount, flutter, sat }) {
    if (amount !== undefined) {
      this.config.cassette.amount = amount;
      this.cassetteDryBus.gain.value = 1 - amount;
      this.cassetteWetBus.gain.value = amount;
      this.cassetteHissGain.gain.value = amount * 0.18;
    }
    if (flutter !== undefined) {
      this.config.cassette.flutter = flutter;
      const base = 0.003;
      const span = 0.0004 + flutter * 0.004;
      this.cassetteFlutterLFO.min = base - span;
      this.cassetteFlutterLFO.max = base + span;
    }
    if (sat !== undefined) {
      this.config.cassette.sat = sat;
      this.cassetteSat.curve = makeCassetteSatCurve(sat);
    }
  }

  applyChorus({ wet, rate, depth }) {
    if (wet !== undefined) {
      this.config.chorus.wet = wet;
      try { this.chorus.wet.value = wet; } catch {}
    }
    if (rate !== undefined) {
      this.config.chorus.rate = rate;
      try { this.chorus.frequency.value = 0.1 + rate * 4.9; } catch {}
    }
    if (depth !== undefined) {
      this.config.chorus.depth = depth;
      try { this.chorus.depth = depth; } catch {}
    }
  }

  applyRingMod({ wet, freq }) {
    if (wet !== undefined) {
      this.config.ringmod.wet = wet;
      this.ringDry.gain.value = 1 - wet;
      this.ringWet.gain.value = wet;
    }
    if (freq !== undefined) {
      this.config.ringmod.freq = freq;
      // log map slider 0..1 → 20..3000 Hz
      const hz = 20 * Math.pow(150, Math.max(0, Math.min(1, freq)));
      try { this.ringCarrier.frequency.value = hz; } catch {}
    }
  }

  applyWaveShaper({ wet, preamp, amount, mode }) {
    if (!this.config.shaper) this.config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
    if (wet !== undefined) {
      this.config.shaper.wet = wet;
      this.shaperDryBus.gain.value = 1 - wet;
      this.shaperWetBus.gain.value = wet;
    }
    if (preamp !== undefined) {
      this.config.shaper.preamp = preamp;
      try { this.shaperPreamp.gain.value = shaperPreampGain(preamp); } catch {}
    }
    if (amount !== undefined) this.config.shaper.amount = amount;
    if (mode !== undefined && SHAPER_MODES.includes(mode)) this.config.shaper.mode = mode;
    if (amount !== undefined || mode !== undefined) {
      try {
        this.shaperNode.curve = makeShaperCurve(this.config.shaper.mode, this.config.shaper.amount);
      } catch {}
    }
  }

  applyAutoWah({ wet, sens, range }) {
    if (wet !== undefined) {
      this.config.autowah.wet = wet;
      try { this.autowah.wet.value = wet; } catch {}
    }
    if (sens !== undefined) {
      this.config.autowah.sens = sens;
      // higher slider = more sensitive (more negative dB threshold)
      try { this.autowah.sensitivity = -10 - sens * 30; } catch {}
    }
    if (range !== undefined) {
      this.config.autowah.range = range;
      try { this.autowah.octaves = 1 + range * 4; } catch {}
    }
  }

  applyPhaser({ wet, rate, depth }) {
    if (wet !== undefined) {
      this.config.phaser.wet = wet;
      try { this.phaser.wet.value = wet; } catch {}
    }
    if (rate !== undefined) {
      this.config.phaser.rate = rate;
      try { this.phaser.frequency.value = 0.05 + rate * 3.95; } catch {}
    }
    if (depth !== undefined) {
      this.config.phaser.depth = depth;
      try { this.phaser.octaves = 1 + depth * 5; } catch {}
    }
  }

  applyFlanger({ wet, rate, fbk }) {
    if (wet !== undefined) {
      this.config.flanger.wet = wet;
      this.flangerDry.gain.value = 1 - wet;
      this.flangerWet.gain.value = wet;
    }
    if (rate !== undefined) {
      this.config.flanger.rate = rate;
      try { this.flangerLFO.frequency.value = 0.05 + rate * 3.95; } catch {}
    }
    if (fbk !== undefined) {
      this.config.flanger.fbk = fbk;
      this.flangerFeedback.gain.value = Math.max(0, Math.min(0.9, fbk * 0.9));
    }
  }

  applyPitchShift({ wet, semitones }) {
    if (wet !== undefined) {
      this.config.pitchshift.wet = wet;
      try { this.pitchshift.wet.value = wet; } catch {}
    }
    if (semitones !== undefined) {
      this.config.pitchshift.semitones = semitones;
      try { this.pitchshift.pitch = semitones; } catch {}
    }
  }

  applyFuzz({ amount, drive, tone, level }) {
    if (amount !== undefined) {
      this.config.fuzz.amount = amount;
      this.dryBus.gain.value = 1 - amount;
      this.wetBus.gain.value = amount;
    }
    if (drive !== undefined) {
      this.config.fuzz.drive = drive;
      this.fuzzDrive.gain.value = 1 + drive * 30;
      this.fuzzShaper.curve = makeFuzzCurve(drive);
    }
    if (tone !== undefined) {
      this.config.fuzz.tone = tone;
      this.fuzzFilter.frequency.value = 200 + tone * 7800;
    }
    if (level !== undefined) {
      this.config.fuzz.level = level;
      this.fuzzLevel.gain.value = level * 0.9;
    }
  }
  applyCrush({ bits, wet }) {
    if (!this.config.crush) this.config.crush = { bits: 8, wet: 0 };
    if (bits !== undefined) {
      const b = Math.max(1, Math.min(16, Math.round(bits)));
      this.config.crush.bits = b;
      try { this.crusher.bits.value = b; } catch { try { this.crusher.set({ bits: b }); } catch {} }
    }
    if (wet !== undefined) {
      this.config.crush.wet = wet;
      try { this.crusher.wet.value = wet; } catch {}
    }
  }
  applyDelay({ time, fbk, wet, sync, div }) {
    if (sync !== undefined) this.config.delay.sync = sync;
    if (div !== undefined) this.config.delay.div = div;
    if (time !== undefined && !this.config.delay.sync) this.config.delay.time = time;
    if (fbk !== undefined)  { this.config.delay.fbk = fbk; this.delay.feedback.value = fbk; }
    if (wet !== undefined)  { this.config.delay.wet = wet; this.delay.wet.value = wet; }
    // recompute effective delay time
    const secPerBeat = 60 / currentBpm();
    const eff = this.config.delay.sync
      ? secPerBeat * this.config.delay.div
      : this.config.delay.time;
    this.delay.delayTime.value = Math.max(0.02, Math.min(2, eff));
  }
  applyReverb({ decay, wet }) {
    if (decay !== undefined) {
      this.config.reverb.decay = decay;
      this.reverb.decay = decay;
      this.reverb.generate().catch(() => {});
    }
    if (wet !== undefined) { this.config.reverb.wet = wet; this.reverb.wet.value = wet; }
  }
  dispose() {
    try { this.input.disconnect(); } catch {}
    try { this.vinylDryBus.disconnect(); } catch {}
    try { this.vinylWetBus.disconnect(); } catch {}
    try { this.vinylLP.disconnect(); } catch {}
    try { this.vinylWowDelay.disconnect(); } catch {}
    try { this.vinylSum.disconnect(); } catch {}
    try { this.vinylNoiseSrc.stop(); } catch {}
    try { this.vinylNoiseSrc.disconnect(); } catch {}
    try { this.vinylNoiseGain.disconnect(); } catch {}
    try { this.vinylWowLFO.stop(); } catch {}
    try { this.vinylWowLFO.dispose(); } catch {}
    try { this.cassetteDryBus.disconnect(); } catch {}
    try { this.cassetteWetBus.disconnect(); } catch {}
    try { this.cassetteHP.disconnect(); } catch {}
    try { this.cassetteFlutter.disconnect(); } catch {}
    try { this.cassetteSat.disconnect(); } catch {}
    try { this.cassetteLP.disconnect(); } catch {}
    try { this.cassetteSum.disconnect(); } catch {}
    try { this.cassetteHissSrc.stop(); } catch {}
    try { this.cassetteHissSrc.disconnect(); } catch {}
    try { this.cassetteHissGain.disconnect(); } catch {}
    try { this.cassetteFlutterLFO.stop(); } catch {}
    try { this.cassetteFlutterLFO.dispose(); } catch {}
    try { this.dryBus.disconnect(); } catch {}
    try { this.wetBus.disconnect(); } catch {}
    try { this.fuzzDrive.disconnect(); } catch {}
    try { this.fuzzShaper.disconnect(); } catch {}
    try { this.fuzzFilter.disconnect(); } catch {}
    try { this.fuzzLevel.disconnect(); } catch {}
    try { this.postFuzz.disconnect(); } catch {}
    try { this.ringDry.disconnect(); } catch {}
    try { this.ringWet.disconnect(); } catch {}
    try { this.ringMult.disconnect(); } catch {}
    try { this.ringSum.disconnect(); } catch {}
    try { this.ringCarrier.stop(); } catch {}
    try { this.ringCarrier.disconnect(); } catch {}
    try { this.shaperDryBus.disconnect(); } catch {}
    try { this.shaperWetBus.disconnect(); } catch {}
    try { this.shaperSum.disconnect(); } catch {}
    try { this.shaperPreamp.disconnect(); } catch {}
    try { this.shaperNode.disconnect(); } catch {}
    try { this.shaperPost.disconnect(); } catch {}
    try { this.flangerIn.disconnect(); } catch {}
    try { this.flangerDry.disconnect(); } catch {}
    try { this.flangerWet.disconnect(); } catch {}
    try { this.flangerDelayNode.disconnect(); } catch {}
    try { this.flangerFeedback.disconnect(); } catch {}
    try { this.flangerSum.disconnect(); } catch {}
    try { this.flangerLFO.stop(); } catch {}
    try { this.flangerLFO.dispose(); } catch {}
    try { this.output.disconnect(); } catch {}
    try { this.autowah.dispose(); } catch {}
    try { this.chorus.dispose(); } catch {}
    try { this.phaser.dispose(); } catch {}
    try { this.pitchshift.dispose(); } catch {}
    try { this.delay.dispose(); } catch {}
    try { this.reverb.dispose(); } catch {}
    try { this.crusher.dispose(); } catch {}
  }
}

// ---- voices -------------------------------------------------------------

// Voice interface:
//   type: "plaits" | "drum-synth" | "sample" | "midi"
//   poly: bool — whether to trigger all chord tones
//   hit(midiNote, time, duration, velocity)
//   setParam(key, val)        // vol/harm/timb/morph/decay
//   getAudioParam(key)        // for LFO modulation, may return null
//   setEngine(engineKey)      // in-place if possible, else caller recreates
//   canInPlaceChange(newKey)  // can swap to this key without rebuild
//   silence(now)              // stop any currently-sounding note
//   dispose()

class PlaitsVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "plaits";
    this.poly = true;                 // fan-out across a voice pool for chords
    this.glide = 0;
    this.setKey(key);
    this.poolSize = 4;
    this.pool = [];
    this.voiceIdx = 0;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    for (let i = 0; i < this.poolSize; i++) {
      const node = wosc.createOscillator();
      node.modTriggerPatchedAudioParameter.value = 1;
      node.modLevelPatchedAudioParameter.value  = 1;
      node.modLevelAudioParameter.value = 0;
      node.engineAudioParameter.value = this.plaitsIdx;
      node.volumeAudioParameter.value = params.vol;
      node.harmonicsAudioParameter.value = params.harm;
      node.timbreAudioParameter.value = params.timb;
      node.morphAudioParameter.value = params.morph;
      node.decayAudioParameter.value = params.decay;
      node.noteAudioParameter.value = 60;
      node.connect(this.output);
      node.start();
      this.pool.push({ node, lastNote: null });
    }
    this.output.connect(ctx.destination);
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  setKey(key) {
    this.key = key;
    this.plaitsIdx = Number(key.split(":")[1]);
  }
  canInPlaceChange(newKey) { return newKey.startsWith("plaits:"); }
  setEngine(key) {
    this.setKey(key);
    for (const v of this.pool) v.node.engineAudioParameter.value = this.plaitsIdx;
  }
  _paramName(key) {
    return {
      vol: "volumeAudioParameter", harm: "harmonicsAudioParameter",
      timb: "timbreAudioParameter", morph: "morphAudioParameter", decay: "decayAudioParameter",
    }[key];
  }
  setParam(key, val) {
    const name = this._paramName(key);
    if (!name) return;
    for (const v of this.pool) v.node[name].value = val;
  }
  getAudioParam(key) {
    // For LFO modulation: route to all pool voices by returning the first voice's param.
    // (LFO.connect only targets one param; chord tones on other pool voices won't pick up
    // the modulation. For true poly mod, a per-voice LFO bus would be needed.)
    if (key === "vol") return this.output.gain;
    const name = this._paramName(key);
    return name ? this.pool[0].node[name] : null;
  }
  hit(midiNote, time, duration, velocity = 1) {
    const v = this.pool[this.voiceIdx];
    this.voiceIdx = (this.voiceIdx + 1) % this.poolSize;
    const gateOff = Math.max(time + 0.002, time + duration - 0.004);
    const vel = Math.max(0, Math.min(1, velocity));
    const noteParam = v.node.noteAudioParameter;
    if (this.glide > 0 && v.lastNote != null && v.lastNote !== midiNote) {
      noteParam.cancelScheduledValues(time);
      noteParam.setValueAtTime(v.lastNote, time);
      noteParam.linearRampToValueAtTime(midiNote, time + this.glide);
    } else {
      noteParam.setValueAtTime(midiNote, time);
    }
    v.lastNote = midiNote;
    v.node.modLevelAudioParameter.setValueAtTime(vel, time);
    v.node.modTriggerAudioParameter.setValueAtTime(0, time);
    v.node.modTriggerAudioParameter.setValueAtTime(1, time + 0.001);
    v.node.modTriggerAudioParameter.setValueAtTime(0, gateOff);
    v.node.modLevelAudioParameter.setTargetAtTime(0, gateOff, 0.25);
  }
  setGlide(seconds) { this.glide = Math.max(0, Number(seconds) || 0); }
  silence(now) {
    for (const v of this.pool) {
      try {
        v.node.modTriggerAudioParameter.cancelScheduledValues(now);
        v.node.modTriggerAudioParameter.setValueAtTime(0, now);
        v.node.modLevelAudioParameter.cancelScheduledValues(now);
        v.node.modLevelAudioParameter.setValueAtTime(0, now);
      } catch {}
    }
  }
  dispose() {
    for (const v of this.pool) {
      try { v.node.stop(); } catch {}
      try { v.node.dispose(); } catch {}
    }
    try { this.output.disconnect(); } catch {}
  }
}

// Wrap a mono voice-builder in a round-robin pool so chord tones don't stomp
// each other. Each voice in the pool is an independent copy of the same build;
// trigger routes successive hits across voices.
function makePolyPool(size, buildOne) {
  const voices = [];
  const nodes = [];
  for (let i = 0; i < size; i++) {
    const v = buildOne();
    voices.push(v);
    nodes.push(...v.nodes);
  }
  let idx = 0;
  return {
    nodes,
    trigger: (note, time, dur, vel) => {
      const v = voices[idx];
      idx = (idx + 1) % size;
      v.trigger(note, time, dur, vel);
    },
    release: (time) => voices.forEach(v => v.release?.(time)),
    setGlide: (g) => voices.forEach(v => v.setGlide?.(g)),
    setParam: (k, val) => voices.forEach(v => v.setParam?.(k, val)),
    // LFO modulation targets only the first pool voice — identical limitation
    // as PlaitsVoice's voice pool (documented in CLAUDE.md).
    getAudioParam: (k) => voices[0].getAudioParam?.(k) ?? null,
  };
}

function buildDrumSynthNode(kind, output) {
  switch (kind) {
    case "808-kick": {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 10,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 1.4, attackCurve: "exponential" },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.08, dur), time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "808-snare": {
      const noise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(output);
      const tone = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(output);
      return {
        nodes: [noise, tone],
        trigger: (note, time, dur, vel) => {
          noise.triggerAttackRelease(0.12, time, vel);
          tone.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.08, time, vel * 0.6);
        },
        release: () => {},
      };
    }
    case "808-chat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "32n", time, vel), release: () => {} };
    }
    case "808-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.5, release: 0.3 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "4n", time, vel), release: () => {} };
    }
    case "808-clap": {
      const noise = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.28, sustain: 0 } }).connect(output);
      return { nodes: [noise], trigger: (n, time, dur, vel) => noise.triggerAttackRelease(0.3, time, vel), release: () => {} };
    }
    case "808-cowbell": {
      const a = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 } }).connect(output);
      const b = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 } }).connect(output);
      return {
        nodes: [a, b],
        trigger: (n, time, dur, vel) => {
          a.triggerAttackRelease(560, 0.2, time, vel * 0.6);
          b.triggerAttackRelease(845, 0.2, time, vel * 0.6);
        },
        release: () => {},
      };
    }
    case "909-kick": {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.04, octaves: 6,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.5 },
      });
      const dist = new Tone.Distortion({ distortion: 0.2, wet: 0.35 });
      s.connect(dist); dist.connect(output);
      return {
        nodes: [s, dist],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.2, time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "909-snare": {
      const noise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(output);
      const body = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(output);
      return {
        nodes: [noise, body],
        trigger: (note, time, dur, vel) => {
          noise.triggerAttackRelease(0.08, time, vel);
          body.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.06, time, vel * 0.7);
        },
        release: () => {},
      };
    }
    case "909-chat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.04, release: 0.01 },
        harmonicity: 12, modulationIndex: 40, resonance: 7000, octaves: 1,
      }).connect(output);
      // Tone 15's MetalSynth.triggerAttackRelease signature is (note, duration,
      // time, velocity) — the old (duration, time, velocity) call passed "32n"
      // as the note, which made the synth fall over silently.
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "32n", time, vel), release: () => {} };
    }
    case "909-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.6, release: 0.4 },
        harmonicity: 12, modulationIndex: 40, resonance: 7000, octaves: 1,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "4n", time, vel), release: () => {} };
    }
    case "909-clap": {
      const noise = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(output);
      return { nodes: [noise], trigger: (n, time, dur, vel) => noise.triggerAttackRelease(0.18, time, vel), release: () => {} };
    }
    case "303": {
      const s = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.1 },
        filter: { Q: 8, rolloff: -24, type: "lowpass" },
        filterEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.3, baseFrequency: 80, octaves: 4.5, exponent: 2 },
      });
      const dist = new Tone.Distortion({ distortion: 0.2, wet: 0.25 });
      s.connect(dist); dist.connect(output);
      return {
        nodes: [s, dist],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "poly-saw": {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.4 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "fm-bell": {
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3, modulationIndex: 12,
        envelope: { attack: 0.001, decay: 0.6, sustain: 0.1, release: 1.2 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "pad": {
      const s = new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 1.4 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(dur, 0.3), time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "mini-brute": return makePolyPool(4, () => buildMiniBruteVoice(output));
    case "moog":       return makePolyPool(4, () => buildMoogVoice(output));
    case "juno":       return makePolyPool(6, () => buildJunoVoice(output));
    case "guitar":     return makePolyPool(6, () => buildGuitarVoice(output));
    case "bass":       return makePolyPool(4, () => buildBassVoice(output));
    case "rhodes":     return makePolyPool(6, () => buildRhodesVoice(output));
    case "prophet6":   return makePolyPool(6, () => buildProphet6Voice(output));
  }
  throw new Error("unknown drum-synth kind: " + kind);
}

// ---- mini-brute builder -------------------------------------------------
// One voice instance — see makePolyPool for the 4-voice pool used by the
// public engine entry. Oscillators: saw + detuned-saw (ultrasaw) + PWM pulse +
// metalized triangle + sub sine. All summed through a "brute factor" soft-clip
// and an amp envelope. The track-level filter + filter env provide the sweep.
function buildMiniBruteVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const saw   = new Tone.Oscillator({ type: "sawtooth" }).start();
  const sawD  = new Tone.Oscillator({ type: "sawtooth", detune: 10 }).start();
  const pulse = new Tone.PulseOscillator({ width: 0 }).start();
  const tri   = new Tone.Oscillator({ type: "triangle" }).start();
  const sub   = new Tone.Oscillator({ type: "sine" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.connect(saw.frequency);
  freqSig.connect(sawD.frequency);
  freqSig.connect(pulse.frequency);
  freqSig.connect(tri.frequency);
  freqSig.chain(subMul, sub.frequency);

  let pwBaseVal = 0.5;
  let pwDepth   = 0;
  const pwmLfo = new Tone.LFO({ frequency: 0, min: 0.5, max: 0.5, type: "sine" }).start();
  pwmLfo.connect(pulse.width);
  const updatePW = () => {
    pwmLfo.min = Math.max(0.05, pwBaseVal - pwDepth * 0.4);
    pwmLfo.max = Math.min(0.95, pwBaseVal + pwDepth * 0.4);
  };

  const metal = new Tone.WaveShaper(makeMetalizerCurve(0), 2048);
  tri.connect(metal);

  const ultra = new Tone.Gain(0.35);
  sawD.connect(ultra);

  const fmOsc   = new Tone.Oscillator({ type: "sine" }).start();
  const fmMul   = new Tone.Multiply(2);
  freqSig.chain(fmMul, fmOsc.frequency);
  const fmDepth = new Tone.Gain(0);
  fmOsc.connect(fmDepth);
  fmDepth.connect(saw.detune);
  fmDepth.connect(sawD.detune);
  fmDepth.connect(pulse.detune);
  fmDepth.connect(tri.detune);

  const mixSaw   = new Tone.Gain(0.55);
  const mixPulse = new Tone.Gain(0.35);
  const mixTri   = new Tone.Gain(0.2);
  const mixSub   = new Tone.Gain(0.4);
  saw.connect(mixSaw);
  ultra.connect(mixSaw);
  pulse.connect(mixPulse);
  metal.connect(mixTri);
  sub.connect(mixSub);

  const brute = new Tone.Distortion({ distortion: 0.22, oversample: "2x", wet: 0.55 });
  const amp   = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.3 });
  const trim  = new Tone.Gain(0.38);
  mixSaw.connect(brute);
  mixPulse.connect(brute);
  mixTri.connect(brute);
  mixSub.connect(amp);
  brute.connect(amp);
  amp.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.015;
  const setMBParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")         mixSaw.gain.value   = v;
    else if (key === "osc2")    mixPulse.gain.value = v;
    else if (key === "osc3")    mixTri.gain.value   = v;
    else if (key === "osc4")    mixSub.gain.value   = v;
    else if (key === "harm")    { pwmLfo.frequency.value = v * 8; pwDepth = v; updatePW(); }
    else if (key === "timb")    { pwBaseVal = 0.1 + v * 0.8; updatePW(); }
    else if (key === "metal")   metal.curve = makeMetalizerCurve(v);
    else if (key === "ultra")   ultra.gain.value = v;
    else if (key === "fm")      fmDepth.gain.value = v * 1800;
  };
  return {
    nodes: [saw, sawD, pulse, tri, sub, subMul, freqSig, pwmLfo, fmOsc, fmMul, fmDepth, metal, ultra, mixSaw, mixPulse, mixTri, mixSub, brute, amp, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setMBParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1": return mixSaw.gain;
        case "osc2": return mixPulse.gain;
        case "osc3": return mixTri.gain;
        case "osc4": return mixSub.gain;
        case "ultra": return ultra.gain;
        case "fm":    return fmDepth.gain;
        case "harm":  return pwmLfo.frequency;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- moog builder -------------------------------------------------------
// Minimoog-style voice: three oscillators each with independent waveform,
// range, and fine frequency; plus a white/pink noise source. Summed through
// a Chebyshev warmth + EQ3 shelf + amp envelope.
function buildMoogVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const osc1 = new Tone.Oscillator({ type: "sawtooth", detune: 0 }).start();
  const osc2 = new Tone.Oscillator({ type: "sawtooth", detune: 5 }).start();
  const osc3 = new Tone.Oscillator({ type: "triangle", detune: -7 }).start();
  const mul1 = new Tone.Multiply(1);
  const mul2 = new Tone.Multiply(1);
  const mul3 = new Tone.Multiply(0.5);
  freqSig.chain(mul1, osc1.frequency);
  freqSig.chain(mul2, osc2.frequency);
  freqSig.chain(mul3, osc3.frequency);

  const mix1 = new Tone.Gain(0.55);
  const mix2 = new Tone.Gain(0.45);
  const mix3 = new Tone.Gain(0.35);
  osc1.connect(mix1);
  osc2.connect(mix2);
  osc3.connect(mix3);

  let noise = new Tone.Noise({ type: "white" }).start();
  const mixNoise = new Tone.Gain(0);
  noise.connect(mixNoise);

  const warm = new Tone.Chebyshev({ order: 3, wet: 0.35 });
  const shelf = new Tone.EQ3({ low: 1, mid: 0.5, high: -3 });
  const amp = new Tone.AmplitudeEnvelope({ attack: 0.006, decay: 0.22, sustain: 0.75, release: 0.45 });
  const trim = new Tone.Gain(0.34);
  mix1.connect(warm);
  mix2.connect(warm);
  mix3.connect(warm);
  mixNoise.connect(warm);
  warm.connect(shelf);
  shelf.connect(amp);
  amp.connect(trim);
  trim.connect(output);

  const osc2SemiBase = { range: 0, freq: 0 };
  const osc3SemiBase = { range: -1, freq: 0 };
  const osc1Range = { n: 0 };
  const updateMul = () => {
    mul1.factor.value = Math.pow(2, osc1Range.n / 12);
    mul2.factor.value = Math.pow(2, (osc2SemiBase.range * 12 + osc2SemiBase.freq) / 12);
    mul3.factor.value = Math.pow(2, (osc3SemiBase.range * 12 + osc3SemiBase.freq) / 12);
  };
  updateMul();

  let lastFreq = 110;
  let glideSec = 0.02;
  const setMoogParam = (key, val) => {
    if (key === "osc1")         mix1.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "osc2")    mix2.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "osc3")    mix3.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "harm")    osc2.detune.value = 5 + (Number(val) || 0) * 25;
    else if (key === "decay") {
      amp.decay = 0.05 + (Number(val) || 0) * 1.5;
      warm.wet.value = 0.15 + (Number(val) || 0) * 0.55;
    }
    else if (key === "osc1wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc1.type = val; }
    else if (key === "osc2wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc2.type = val; }
    else if (key === "osc3wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc3.type = val; }
    else if (key === "osc1range") { osc1Range.n = Number(val) * 12; updateMul(); }
    else if (key === "osc2range") { osc2SemiBase.range = Number(val) || 0; updateMul(); }
    else if (key === "osc3range") { osc3SemiBase.range = Number(val) || 0; updateMul(); }
    else if (key === "osc2freq")  { osc2SemiBase.freq  = Number(val) || 0; updateMul(); }
    else if (key === "osc3freq")  { osc3SemiBase.freq  = Number(val) || 0; updateMul(); }
    else if (key === "noise")     mixNoise.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "noisetype") {
      if (val === "white" || val === "pink") {
        try { noise.stop(); } catch {}
        try { noise.disconnect(); } catch {}
        try { noise.dispose(); } catch {}
        noise = new Tone.Noise({ type: val }).start();
        noise.connect(mixNoise);
      }
    }
  };
  return {
    nodes: [osc1, osc2, osc3, mul1, mul2, mul3, freqSig, mix1, mix2, mix3, mixNoise, warm, shelf, amp, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setMoogParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mix1.gain;
        case "osc2":  return mix2.gain;
        case "osc3":  return mix3.gain;
        case "noise": return mixNoise.gain;
        case "harm":  return osc2.detune;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- juno 60 builder ----------------------------------------------------
// Roland Juno-60-style voice. Single DCO (pulse with LFO-driven PWM) + a sub
// square one octave below + a noise source, into HPF → soft-saturation → amp
// envelope → chorus (the iconic Juno chorus). Track-level filter + filter env
// provide the VCF sweep.
function buildJunoVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const dco  = new Tone.PulseOscillator({ width: 0 }).start();       // width driven by LFO below
  const sub  = new Tone.Oscillator({ type: "square" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.connect(dco.frequency);
  freqSig.chain(subMul, sub.frequency);

  // PWM LFO — min=max sits at base when depth = 0
  let pwBaseVal = 0.5;
  let pwDepth   = 0;
  const pwmLfo = new Tone.LFO({ frequency: 0, min: 0.5, max: 0.5, type: "sine" }).start();
  pwmLfo.connect(dco.width);
  const updatePW = () => {
    pwmLfo.min = Math.max(0.05, pwBaseVal - pwDepth * 0.4);
    pwmLfo.max = Math.min(0.95, pwBaseVal + pwDepth * 0.4);
  };

  let noise = new Tone.Noise({ type: "white" }).start();
  const mixNoise = new Tone.Gain(0);
  noise.connect(mixNoise);

  const mixDco = new Tone.Gain(0.55);
  const mixSub = new Tone.Gain(0.4);
  dco.connect(mixDco);
  sub.connect(mixSub);

  const hpf = new Tone.Filter({ type: "highpass", frequency: 60, rolloff: -12 });
  const amp = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.25, sustain: 0.75, release: 0.35 });
  // Classic Juno stereo chorus — baked in since it defines the character.
  const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.35, feedback: 0, wet: 0.6, spread: 180 }).start();
  const trim = new Tone.Gain(0.4);
  mixDco.connect(hpf);
  mixSub.connect(hpf);
  mixNoise.connect(hpf);
  hpf.connect(amp);
  amp.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.015;
  const setJunoParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")         mixDco.gain.value   = v;                         // DCO level
    else if (key === "osc2")    mixSub.gain.value   = v;                         // sub level
    else if (key === "osc3")    mixNoise.gain.value = v;                         // noise level
    else if (key === "harm")    { pwmLfo.frequency.value = v * 8; pwDepth = v; updatePW(); }  // PWM rate + depth
    else if (key === "timb")    { pwBaseVal = 0.1 + v * 0.8; updatePW(); }        // pulse width
    else if (key === "morph")   { chorus.wet.value = v; chorus.depth = 0.2 + v * 0.6; }  // chorus intensity
    else if (key === "decay") {                                                   // amp decay + HPF freq
      amp.decay = 0.05 + v * 1.5;
      hpf.frequency.value = 30 + v * 180;
    }
    else if (key === "noisetype") {
      if (val === "white" || val === "pink") {
        try { noise.stop(); } catch {}
        try { noise.disconnect(); } catch {}
        try { noise.dispose(); } catch {}
        noise = new Tone.Noise({ type: val }).start();
        noise.connect(mixNoise);
      }
    }
  };
  return {
    nodes: [dco, sub, subMul, freqSig, pwmLfo, mixDco, mixSub, mixNoise, hpf, amp, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setJunoParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mixDco.gain;
        case "osc2":  return mixSub.gain;
        case "osc3":  return mixNoise.gain;   // juno's osc3 slot is the noise mix
        case "noise": return mixNoise.gain;
        case "harm":  return pwmLfo.frequency;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- electric guitar builder --------------------------------------------
// Karplus-Strong plucked-string voice (Tone.PluckSynth) into a drive+tone shaping
// chain. Track-level filter + filter env can still sweep on top. Per-step
// velocity maps to pick intensity (brighter = harder pick) via dampening.
function buildGuitarVoice(output) {
  const pluck = new Tone.PluckSynth({
    attackNoise: 1,
    dampening: 4200,
    resonance: 0.92,
    release: 0.8,
  });
  // Drive stage — moderate distortion by default; controlled by the "dist" param.
  const drive = new Tone.Distortion({ distortion: 0.22, oversample: "2x", wet: 0.55 });
  // Tone shaping — boost mids + slight high roll for a rounded electric-guitar feel.
  const eq = new Tone.EQ3({ low: -2, mid: 2, high: -1 });
  // A little body + space via short reverb and a dash of chorus for chorus-pedal vibe.
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 2.5, depth: 0.25, wet: 0.25 }).start();
  const trim = new Tone.Gain(0.9);
  pluck.connect(drive);
  drive.connect(eq);
  eq.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.005;   // guitars don't really glide, but allow a tiny ramp
  const setGuitarParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm") {                                         // drive amount
      drive.distortion = 0.05 + v * 0.65;
      drive.wet.value = 0.15 + v * 0.7;
    }
    else if (key === "timb") pluck.dampening = 500 + v * 6500;     // brightness (Hz)
    else if (key === "morph") chorus.wet.value = v;                // chorus wet
    else if (key === "decay") pluck.release = 0.15 + v * 3.2;      // string sustain
  };
  return {
    nodes: [pluck, drive, eq, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setGuitarParam,
    trigger: (note, time, dur, vel) => {
      try {
        // Harder velocity → brighter pick. Tone's PluckSynth has no velocity arg
        // so we modulate output + dampening per hit.
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        trim.gain.setValueAtTime(0.9 * v * 1.4, time);
        pluck.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.05, dur), time);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { pluck.triggerRelease?.(); } catch {} },
  };
}

// ---- electric bass builder ---------------------------------------------
// Tuned for low-register Karplus-Strong: darker pluck, longer resonance, mild
// tube-ish drive, gentle high-shelf roll-off and a low-end boost. No chorus —
// electric bass usually lives bone-dry.
function buildBassVoice(output) {
  const pluck = new Tone.PluckSynth({
    attackNoise: 0.6,        // softer attack than guitar — fingers, not a pick
    dampening: 2200,         // darker — bass sits below the fundamental guitar range
    resonance: 0.97,         // longer string ring
    release: 1.4,
  });
  const drive = new Tone.Distortion({ distortion: 0.12, oversample: "2x", wet: 0.4 });
  const eq = new Tone.EQ3({ low: 3, mid: 1, high: -4 });   // bass lift + upper cut
  const compGain = new Tone.Gain(1.5);                       // post-EQ makeup gain
  const trim = new Tone.Gain(1.8);
  pluck.connect(drive);
  drive.connect(eq);
  eq.connect(compGain);
  compGain.connect(trim);
  trim.connect(output);

  let lastFreq = 80;
  let glideSec = 0.005;
  const setBassParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm") {                           // drive amount (finger → pick → overdriven)
      drive.distortion = 0.03 + v * 0.55;
      drive.wet.value = 0.2 + v * 0.6;
    }
    else if (key === "timb")  pluck.dampening = 400 + v * 4000;    // brightness / pick position
    else if (key === "morph") pluck.resonance = 0.85 + v * 0.14;   // string resonance
    else if (key === "decay") pluck.release = 0.25 + v * 3.5;      // sustain
  };
  return {
    nodes: [pluck, drive, eq, compGain, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setBassParam,
    trigger: (note, time, dur, vel) => {
      try {
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        // Harder attack → fuller output; softer → more finger-style dynamic.
        trim.gain.setValueAtTime(1.8 * (0.7 + v * 0.5), time);
        pluck.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.05, dur), time);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { pluck.triggerRelease?.(); } catch {} },
  };
}

// ---- rhodes piano builder ----------------------------------------------
// Rhodes electric piano — FM synthesis (modulator into sine carrier) is the
// classic DX7 "full tines" recipe. Harmonicity 3 + high modulation index +
// sharp modulation-envelope decay gives the bell-like attack; amp env long
// release carries the warm tail. Chorus adds the signature Rhodes warble.
function buildRhodesVoice(output) {
  const synth = new Tone.FMSynth({
    harmonicity: 3,
    modulationIndex: 14,
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.6 },
    modulation: { type: "sine" },
    modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.6 },
  });
  const chorus = new Tone.Chorus({ frequency: 1.2, delayTime: 2.8, depth: 0.4, wet: 0.3 }).start();
  const trim = new Tone.Gain(0.8);
  synth.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 261.63;
  let glideSec = 0.002;
  const setRhodesParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm")      synth.harmonicity.value = 0.5 + v * 5;        // tine color (bell ↔ deep)
    else if (key === "timb") synth.modulationIndex.value = 2 + v * 28;     // brightness / bite
    else if (key === "morph") chorus.wet.value = v;                        // chorus wet
    else if (key === "decay") {                                            // amp env decay + release
      synth.envelope.decay  = 0.1 + v * 3.5;
      synth.envelope.release = 0.3 + v * 4;
      synth.modulationEnvelope.decay = 0.1 + v * 1.2;
    }
  };
  return {
    nodes: [synth, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setRhodesParam,
    trigger: (note, time, dur, vel) => {
      try {
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        // Softer keys = less modulation bite, harder keys = bright tine spank.
        // Modulate the mod index briefly during attack for velocity-sensitivity.
        const bright = 6 + v * 20;
        synth.modulationIndex.cancelScheduledValues(time);
        synth.modulationIndex.setValueAtTime(bright, time);
        synth.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.08, dur), time, v);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { synth.triggerRelease?.(); } catch {} },
  };
}

// ---- prophet 6 builder --------------------------------------------------
// Two VCOs (saw + saw/pulse morph) with cent-level detune for the classic
// "fat" unison, a square sub at -1 oct, noise, an analog-style drive stage,
// amp envelope, and a touch of chorus — the baked-in character of the P6's
// stereo effects block. Filter + filter-env come from the track's own chain.
function buildProphet6Voice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 220 });

  // VCO 1 — saw (the workhorse)
  const vco1 = new Tone.Oscillator({ type: "sawtooth", frequency: 220 }).start();
  freqSig.connect(vco1.frequency);

  // VCO 2 — saw/pulse crossfade controlled by `timb`; detuned by `harm`
  const vco2Saw   = new Tone.Oscillator({ type: "sawtooth", frequency: 220 }).start();
  const vco2Pulse = new Tone.PulseOscillator({ width: 0.5, frequency: 220 }).start();
  freqSig.connect(vco2Saw.frequency);
  freqSig.connect(vco2Pulse.frequency);

  // Sub — square at -1 octave
  const sub    = new Tone.Oscillator({ type: "square" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.chain(subMul, sub.frequency);

  // Noise
  const noise = new Tone.Noise({ type: "white" }).start();

  // Mixers
  const mixVco1   = new Tone.Gain(0.6);
  const mixVco2   = new Tone.Gain(0.5);
  const mixSub    = new Tone.Gain(0.25);
  const mixNoise  = new Tone.Gain(0);

  // VCO 2 shape crossfade (saw↔pulse)
  const vco2SawGain   = new Tone.Gain(1);
  const vco2PulseGain = new Tone.Gain(0);
  const vco2Sum       = new Tone.Gain(1);
  vco2Saw.connect(vco2SawGain);
  vco2Pulse.connect(vco2PulseGain);
  vco2SawGain.connect(vco2Sum);
  vco2PulseGain.connect(vco2Sum);
  vco2Sum.connect(mixVco2);

  vco1.connect(mixVco1);
  sub.connect(mixSub);
  noise.connect(mixNoise);

  // Summing bus → drive → amp envelope → chorus
  const preDrive = new Tone.Gain(1);
  mixVco1.connect(preDrive);
  mixVco2.connect(preDrive);
  mixSub.connect(preDrive);
  mixNoise.connect(preDrive);

  // Drive stage — wet controlled by `morph`; distortion kept at 0.5 so turning
  // morph up crossfades to a fixed-character saturation instead of ramping
  // harshness without limit.
  const drive = new Tone.Distortion({ distortion: 0.5, wet: 0 });
  preDrive.connect(drive);

  const amp = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.35, sustain: 0.7, release: 0.45 });
  drive.connect(amp);

  const chorus = new Tone.Chorus({ frequency: 0.45, delayTime: 2.8, depth: 0.3, feedback: 0, wet: 0.22, spread: 180 }).start();
  amp.connect(chorus);

  const trim = new Tone.Gain(0.5);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 220;
  let glideSec = 0.005;
  const setP6Param = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")       mixVco1.gain.value  = v;
    else if (key === "osc2")  mixVco2.gain.value  = v;
    else if (key === "osc3")  mixSub.gain.value   = v;
    else if (key === "osc4")  mixNoise.gain.value = v;
    else if (key === "noise") mixNoise.gain.value = v;
    else if (key === "harm") {
      // detune VCO2 ±30 cents; 0.5 = unison, extremes = fat chorus-y width
      const cents = (v - 0.5) * 60;
      vco2Saw.detune.value   = cents;
      vco2Pulse.detune.value = cents;
    }
    else if (key === "timb") {
      // saw↔pulse crossfade via equal-power; also sweep pulse width
      vco2SawGain.gain.value   = Math.cos(v * Math.PI / 2);
      vco2PulseGain.gain.value = Math.sin(v * Math.PI / 2);
      vco2Pulse.width.value    = 0.1 + v * 0.8;
    }
    else if (key === "morph") {
      drive.wet.value = v;
    }
    else if (key === "decay") {
      amp.decay   = 0.05 + v * 2;
      amp.release = 0.1  + v * 2.5;
    }
  };

  return {
    nodes: [vco1, vco2Saw, vco2Pulse, sub, noise, freqSig, subMul,
            mixVco1, mixVco2, mixSub, mixNoise,
            vco2SawGain, vco2PulseGain, vco2Sum,
            preDrive, drive, amp, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setP6Param,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mixVco1.gain;
        case "osc2":  return mixVco2.gain;
        case "osc3":  return mixSub.gain;
        case "osc4":  return mixNoise.gain;
        case "noise": return mixNoise.gain;
        case "harm":  return vco2Saw.detune;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.05, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

class DrumSynthVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "drum-synth";
    const e = engineByKey(key);
    this.poly = !!e?.poly;
    this.key = key;
    this.glide = 0;
    this.output = new Tone.Gain(params.vol).toDestination();
    this.kind = key.split(":")[1];
    this.params = { ...params };
    this.built = buildDrumSynthNode(this.kind, this.output);
    this._applyParams();
  }
  _applyParams() {
    if (!this.built.setParam) return;
    for (const k of ["harm", "timb", "morph", "decay",
                     "osc1", "osc2", "osc3", "osc4",
                     "ultra", "fm", "metal",
                     "osc1wave", "osc2wave", "osc3wave",
                     "osc1range", "osc2range", "osc3range",
                     "osc2freq", "osc3freq", "noise", "noisetype"]) {
      if (this.params?.[k] != null) this.built.setParam(k, this.params[k]);
    }
  }
  getOutputNode() { return this.output.output ?? this.output.input; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  setGlide(seconds) {
    this.glide = Math.max(0, Number(seconds) || 0);
    // Tone.MonoSynth has a portamento property
    for (const n of this.built.nodes) {
      if (n instanceof Tone.MonoSynth) n.portamento = this.glide;
    }
    // Custom voices (e.g. mini-brute) can opt in via built.setGlide
    this.built.setGlide?.(this.glide);
  }
  canInPlaceChange(newKey) { return false; }
  setEngine(key) {
    this.rebuild(key);
  }
  rebuild(key) {
    for (const n of this.built.nodes) { try { n.dispose(); } catch {} }
    this.kind = key.split(":")[1];
    this.key = key;
    const e = engineByKey(key);
    this.poly = !!e?.poly;
    this.built = buildDrumSynthNode(this.kind, this.output);
    this._applyParams();
  }
  setParam(key, val) {
    if (key === "vol") this.output.gain.value = val;
    else {
      if (!this.params) this.params = {};
      this.params[key] = val;
      this.built.setParam?.(key, val);
    }
  }
  getAudioParam(key) {
    if (key === "vol") return this.output.gain;
    return this.built?.getAudioParam?.(key) ?? null;
  }
  hit(midiNote, time, duration, velocity = 1) {
    try { this.built.trigger(midiNote, time, duration, Math.max(0, Math.min(1, velocity))); }
    catch (e) { console.warn("drum-synth trigger", e); }
  }
  silence(now) {
    try { this.built.release?.(now); } catch {}
  }
  dispose() {
    for (const n of this.built.nodes) { try { n.dispose(); } catch {} }
    try { this.output.dispose(); } catch {}
  }
}

// Build a ping-pong buffer from a sub-region of an input buffer: [forward | reversed].
// Caches per (buffer, startFrac, endFrac) so step-loop playback doesn't rebuild it each hit.
const PINGPONG_CACHE = new WeakMap();
function getPingPongBuffer(buf, startFrac, endFrac) {
  if (!buf || endFrac <= startFrac) return null;
  let forBuf = PINGPONG_CACHE.get(buf);
  if (!forBuf) { forBuf = new Map(); PINGPONG_CACHE.set(buf, forBuf); }
  const key = `${startFrac.toFixed(4)}:${endFrac.toFixed(4)}`;
  const cached = forBuf.get(key);
  if (cached) return cached;
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const sIdx = Math.max(0, Math.floor(startFrac * n));
  const eIdx = Math.min(n, Math.ceil(endFrac * n));
  const segLen = Math.max(1, eIdx - sIdx);
  const out = new AudioBuffer({ length: segLen * 2, numberOfChannels: ch, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < segLen; i++) dst[i] = src[sIdx + i];              // forward
    for (let i = 0; i < segLen; i++) dst[segLen + i] = src[eIdx - 1 - i]; // reversed
  }
  forBuf.set(key, out);
  return out;
}

// Set up and start a BufferSource for a sample hit. Honors start/end offsets
// and three loop modes: "off" (one-shot), "loop" (region repeats), "pingpong"
// (region plays forward then reversed, repeatedly). Returns { src, stopTime }.
function startSampleSource(ctx, buffer, rate, time, duration, opts) {
  const src = ctx.createBufferSource();
  src.playbackRate.value = rate;
  const startFrac = Math.max(0, Math.min(1, opts?.startOffset ?? 0));
  const endFrac   = Math.max(startFrac + 0.001, Math.min(1, opts?.endOffset ?? 1));
  const startSec  = startFrac * buffer.duration;
  const endSec    = endFrac   * buffer.duration;
  const playLenSource = endSec - startSec;
  const wallTime  = playLenSource / Math.max(0.01, rate);
  const loopMode  = opts?.loopMode || "off";
  let stopTime;
  if (loopMode === "pingpong") {
    src.buffer = getPingPongBuffer(buffer, startFrac, endFrac) || buffer;
    src.loop = true;
    stopTime = time + Math.max(0.1, duration);
    src.start(time);
  } else if (loopMode === "loop") {
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = startSec;
    src.loopEnd   = endSec;
    stopTime = time + Math.max(0.1, duration);
    src.start(time, startSec);
  } else {
    src.buffer = buffer;
    stopTime = time + Math.min(wallTime, Math.max(0.1, duration + 0.5));
    src.start(time, startSec, playLenSource);
  }
  return { src, stopTime };
}

// Shared envelope for sample-based voices: honors opts.fadeIn/fadeOut (seconds)
// with a 6ms click-guard floor and a cap at ~48% of the wall time per side.
function applySampleFadeEnvelope(gainNode, time, stopTime, v, opts) {
  const CLICK = 0.006;
  const playLen = Math.max(CLICK * 2.1, stopTime - time);
  const cap = playLen * 0.48;
  const fadeIn  = Math.max(CLICK, Math.min(cap, Number(opts?.fadeIn)  || 0));
  const fadeOut = Math.max(CLICK, Math.min(cap, Number(opts?.fadeOut) || 0));
  const peakStart = time + fadeIn;
  const peakEnd   = Math.max(peakStart, stopTime - fadeOut);
  gainNode.gain.setValueAtTime(0, time);
  gainNode.gain.linearRampToValueAtTime(v, peakStart);
  gainNode.gain.setValueAtTime(v, peakEnd);
  gainNode.gain.linearRampToValueAtTime(0, stopTime);
}

class SampleVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "sample";
    this.poly = true;
    this.key = key;
    this.output = ctx.createGain();
    this.output.gain.value = params.vol;
    this.output.connect(ctx.destination);
    this.active = new Set();
    this.buffer = null;
    this.load(key);
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  load(key) {
    const id = key.replace(/^smp:/, "");
    const url = `${SAMPLE_BASE}/${id}.mp3`;
    loadBuffer(this.ctx, url).then(buf => {
      if (this.key === key) this.buffer = buf;
    }).catch(err => console.warn("sample load", err));
  }
  canInPlaceChange(newKey) { return newKey.startsWith("smp:"); }
  setEngine(key) {
    this.key = key;
    this.buffer = null;
    this.load(key);
  }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1, opts = null) {
    if (!this.buffer) return;
    // Pitching is relative to opts.pitchBase (MIDI note that = 1.0x playback).
    // Drum-kit tracks pass 36 (C2); other tracks default to 60 (C4).
    const pitchBase = Number.isFinite(opts?.pitchBase) ? opts.pitchBase : 60;
    const rate = Math.pow(2, (midiNote - pitchBase) / 12);
    const { src, stopTime } = startSampleSource(this.ctx, this.buffer, rate, time, duration, opts);
    const g = this.ctx.createGain();
    applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), opts);
    src.connect(g).connect(this.output);
    src.stop(stopTime + 0.01);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }
  silence(now) {
    for (const s of this.active) {
      try { s.stop(now); } catch {}
    }
    this.active.clear();
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.output.disconnect(); } catch {}
  }
}

class CustomToneVoice {
  constructor(ctx, key, params, config) {
    this.ctx = ctx;
    this.type = "custom";
    this.key = key;
    this.config = config;
    this.poly = !!config?.poly;
    this.output = new Tone.Gain(params.vol).toDestination();
    this.build();
  }
  getOutputNode() { return this.output.output ?? this.output.input; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  build() {
    const cfg = this.config;
    if (!cfg) { this.synth = null; this.effectNodes = []; return; }
    try {
      const ToneClass = Tone[cfg.synth];
      if (!ToneClass) throw new Error("no Tone class " + cfg.synth);
      const opts = cfg.options || {};
      const effects = (cfg.effects || []).map(e => {
        const EffectClass = Tone[e.type];
        if (!EffectClass) return null;
        try { return new EffectClass(e.options || {}); } catch { return null; }
      }).filter(Boolean);
      const synth = cfg.poly
        ? new Tone.PolySynth(ToneClass, opts)
        : new ToneClass(opts);
      // chain: synth -> effects... -> output
      let last = synth;
      for (const fx of effects) {
        last.connect(fx);
        last = fx;
      }
      last.connect(this.output);
      this.synth = synth;
      this.effectNodes = effects;
    } catch (err) {
      console.warn("custom voice build failed:", err);
      this.synth = null;
      this.effectNodes = [];
    }
  }
  canInPlaceChange(newKey) { return newKey === "custom"; }
  setEngine(key) { this.key = key; }
  applyConfig(newConfig) {
    this.teardown();
    this.config = newConfig;
    this.poly = !!newConfig?.poly;
    this.build();
  }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.synth) return;
    try {
      this.synth.triggerAttackRelease(
        Tone.Frequency(midiNote, "midi"),
        Math.max(0.02, duration),
        time,
        Math.max(0, Math.min(1, velocity))
      );
    } catch (e) { console.warn("custom hit", e); }
  }
  silence() {
    try { this.synth?.releaseAll?.(); } catch {}
    try { this.synth?.triggerRelease?.(); } catch {}
  }
  teardown() {
    for (const fx of this.effectNodes || []) { try { fx.dispose(); } catch {} }
    try { this.synth?.dispose(); } catch {}
    this.synth = null;
    this.effectNodes = [];
  }
  dispose() {
    this.teardown();
    try { this.output.dispose(); } catch {}
  }
}

// Loudness-normalize an AudioBuffer in place using an RMS target, capped at a safe peak
// so transients don't clip. Target is -14 dBFS RMS (≈0.2), matching typical loud-but-not-
// crushed sample levels. Tapers the last ~5ms to zero to kill end-of-sample clicks.
// Return a new AudioBuffer with leading + trailing silence trimmed.
// Uses a short (~10ms) sliding-window RMS to find the first/last above-threshold
// region; preserves a small pad on each side so transients aren't clipped.
function trimSilenceFromBuffer(buf, { threshold = 0.004, padMs = 8 } = {}) {
  if (!buf || !buf.length) return buf;
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const win = Math.max(1, Math.round(buf.sampleRate * 0.01));
  // Per-sample max-abs across channels (cheaper than true RMS, good enough for gating)
  const env = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > env[i]) env[i] = a;
    }
  }
  // Find first index where windowed peak >= threshold
  let first = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) if (env[j] > peak) peak = env[j];
    if (peak >= threshold) { first = i; break; }
    if (i === n - 1) return buf; // entirely silent — leave it alone
  }
  let last = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    let peak = 0;
    const start = Math.max(0, i - win);
    for (let j = start; j <= i; j++) if (env[j] > peak) peak = env[j];
    if (peak >= threshold) { last = i; break; }
  }
  const pad = Math.round(buf.sampleRate * padMs / 1000);
  const s = Math.max(0, first - pad);
  const e = Math.min(n, last + pad);
  const len = Math.max(1, e - s);
  if (s === 0 && e === n) return buf; // nothing to trim
  const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(s, e));
  }
  return out;
}

function normalizeAudioBuffer(buf, opts = null) {
  if (opts?.trim) buf = trimSilenceFromBuffer(buf);
  if (!buf) return buf;
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0 || peak === 0) return buf;
  const rms = Math.sqrt(sumSq / count);
  const targetRms = 0.2;                           // -14 dBFS
  const rmsScale = rms > 0 ? targetRms / rms : 1;  // how much to bring up RMS
  const peakScale = 0.98 / peak;                   // don't exceed -0.18 dBFS peak
  const scale = Math.min(rmsScale, peakScale);
  const tailSamples = Math.min(buf.length, Math.round(buf.sampleRate * 0.005));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    if (scale !== 1) for (let i = 0; i < d.length; i++) d[i] *= scale;
    for (let i = 0; i < tailSamples; i++) {
      const j = d.length - tailSamples + i;
      d[j] *= 1 - (i / tailSamples);
    }
  }
  return buf;
}

class ElevenVoice {
  constructor(ctx, key, params, track) {
    this.ctx = ctx;
    this.type = "eleven";
    this.poly = true;
    this.key = key;
    // Fixed headroom boost so generated samples match the loudness of the synth engines.
    // The user's vol slider still scales the final output on top.
    this.boost = ctx.createGain();
    this.boost.gain.value = 2.5;  // ≈ +8 dB
    this.output = ctx.createGain();
    this.output.gain.value = params.vol;
    this.boost.connect(this.output);
    this.output.connect(ctx.destination);
    this.buffer = track?.elevenBuffer ?? null;
    this.active = new Set();
    this.baseRate = 1;
  }
  setBaseRate(rate) { this.baseRate = Math.max(0.01, Number(rate) || 1); }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  canInPlaceChange(newKey) { return newKey === "eleven"; }
  setEngine() {}
  setBuffer(buf) { this.buffer = buf; }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1, opts = null) {
    if (!this.buffer) return;
    const pitchBase = Number.isFinite(opts?.pitchBase) ? opts.pitchBase : 60;
    const rate = (this.baseRate || 1) * sliceFitFactor(opts) * Math.pow(2, (midiNote - pitchBase) / 12);
    const { src, stopTime } = startSampleSource(this.ctx, this.buffer, rate, time, duration, opts);
    const g = this.ctx.createGain();
    applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), opts);
    src.connect(g).connect(this.boost);
    src.stop(stopTime + 0.01);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }
  silence(now) {
    for (const s of this.active) { try { s.stop(now); } catch {} }
    this.active.clear();
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.boost.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

class UploadVoice {
  constructor(ctx, key, params, track) {
    this.ctx = ctx;
    this.type = "upload";
    this.poly = true;
    this.key = key;
    this.boost = ctx.createGain();
    this.boost.gain.value = 1;                    // raw level, user-provided samples are usually already hot
    this.output = ctx.createGain();
    this.output.gain.value = params.vol;
    this.boost.connect(this.output);
    this.output.connect(ctx.destination);
    this.buffer = track?.uploadBuffer ?? null;
    this.active = new Set();
    this.baseRate = 1;
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  canInPlaceChange(newKey) { return newKey === "upload"; }
  setEngine() {}
  setBuffer(buf) { this.buffer = buf; }
  setBaseRate(rate) { this.baseRate = Math.max(0.01, Number(rate) || 1); }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1, opts = null) {
    if (!this.buffer) return;
    const pitchBase = Number.isFinite(opts?.pitchBase) ? opts.pitchBase : 60;
    const rate = (this.baseRate || 1) * sliceFitFactor(opts) * Math.pow(2, (midiNote - pitchBase) / 12);
    const { src, stopTime } = startSampleSource(this.ctx, this.buffer, rate, time, duration, opts);
    const g = this.ctx.createGain();
    applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), opts);
    src.connect(g).connect(this.boost);
    src.stop(stopTime + 0.01);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }
  silence(now) {
    for (const s of this.active) { try { s.stop(now); } catch {} }
    this.active.clear();
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.boost.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

class MidiVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "midi";
    this.poly = true;
    this.key = key;
    this.output = null;
    this.channel = 0;
    this.pending = [];
  }
  canInPlaceChange() { return true; }
  setEngine() {}
  setParam() {}
  getAudioParam() { return null; }
  getOutputNode() { return null; }
  setDestination() {}
  setOutput(out) { this.output = out; }
  setChannel(ch) { this.channel = Math.max(0, Math.min(15, (ch | 0) - 1)); }
  _audioTimeToPerf(time) {
    return performance.now() + (time - this.ctx.currentTime) * 1000;
  }
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.output) return;
    // MIDI is integer-noted; microtonal pitches round to the nearest semitone here.
    // Real microtonal MIDI output would need per-note pitch-bend or MPE.
    const n = Math.max(0, Math.min(127, Math.round(midiNote)));
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const onMs = this._audioTimeToPerf(time);
    const offMs = this._audioTimeToPerf(time + Math.max(0.02, duration - 0.01));
    try {
      this.output.send([0x90 | this.channel, n, v], onMs);
      this.output.send([0x80 | this.channel, n, 0], offMs);
    } catch (e) { console.warn("midi send", e); }
  }
  silence() {
    if (!this.output) return;
    try { this.output.send([0xB0 | this.channel, 123, 0]); } catch {}
  }
  dispose() { this.silence(); }
}

function buildVoiceForEngine(ctx, key, params, track) {
  const e = engineByKey(key);
  if (!e) throw new Error("no such engine: " + key);
  switch (e.type) {
    case "plaits":     return new PlaitsVoice(ctx, key, params);
    case "drum-synth": return new DrumSynthVoice(ctx, key, params);
    case "sample":     return new SampleVoice(ctx, key, params);
    case "midi":       return new MidiVoice(ctx, key, params);
    case "custom":     return new CustomToneVoice(ctx, key, params, track?.customConfig ?? null);
    case "saved":      return new CustomToneVoice(ctx, key, params, e.config);
    case "eleven":     return new ElevenVoice(ctx, key, params, track);
    case "upload":     return new UploadVoice(ctx, key, params, track);
  }
  throw new Error("unknown engine type: " + e.type);
}

// ---- LFOs ---------------------------------------------------------------

function defaultLFOConfig() {
  const cfg = {};
  for (const k of LFO_KEYS) {
    cfg[k] = { enabled: false, type: "sine", rate: 1.0, depth: 0.5, sync: true, div: 1 };
  }
  return cfg;
}

function currentBpm() { return Number(document.getElementById("bpm").value || 120); }

// Compute the base playback rate for a sample buffer so its natural length fits the
// selected bar-count at the current BPM. Returns 1 for "native" (no time-sync).
function computeSampleBaseRate(buffer, mode, bpm) {
  if (!buffer || mode === "native" || !mode) return 1;
  const barSec = (60 / bpm) * 4;  // one 4/4 bar at BPM
  const targets = { "2xbpm": 0.5, "1xbpm": 1, "1/2bpm": 2, "1/4bpm": 4 };
  const bars = targets[mode];
  if (!bars) return 1;
  return buffer.duration / (bars * barSec);
}

// Per-hit correction so the TRIMMED slice fits the selected bars, not the full
// buffer. baseRate is computed from the full buffer duration; if a step only
// plays 25% of the buffer, the slice would otherwise finish in 25% of a bar.
// Multiplying the rate by the slice span makes the slice fill the bar.
// Returns 1 when mode is "native" (no time-sync) or when the whole buffer plays.
function sliceFitFactor(opts) {
  const mode = opts?.sampleSpeedMode;
  if (!mode || mode === "native") return 1;
  const start = Math.max(0, Math.min(1, opts?.startOffset ?? 0));
  const end   = Math.max(0, Math.min(1, opts?.endOffset ?? 1));
  const span = Math.max(0.001, end - start);
  return span;
}

function applySampleSpeed(t) {
  const type = t.voice?.type;
  if (type !== "eleven" && type !== "upload") return;
  const buf = t.voice.buffer;
  const rate = computeSampleBaseRate(buf, t.sampleSpeedMode, currentBpm());
  if (t.voice.setBaseRate) t.voice.setBaseRate(rate);
}
function rateFromSync(divBeats) { return currentBpm() / 60 / divBeats; }
function effectiveRate(cfg) { return cfg.sync ? rateFromSync(cfg.div) : cfg.rate; }

function getModTarget(t, key) {
  if (["vol","harm","timb","morph","decay","osc1","osc2","osc3","osc4","ultra","fm","noise"].includes(key)) {
    return t.voice?.getAudioParam(key) ?? null;
  }
  if (key === "cutoff") return t.filterNode?.frequency ?? null;
  if (key === "reson")  return t.filterNode?.Q ?? null;
  const rack = t.fxRack;
  if (!rack) return null;
  // FX wet/amt targets (LFO adds on top of dry — crossfade fx still get movement).
  switch (key) {
    case "fuzz":         return rack.wetBus?.gain ?? null;
    case "delay":        return rack.delay?.wet ?? null;
    case "verb":         return rack.reverb?.wet ?? null;
    case "vinyl":        return rack.vinylWetBus?.gain ?? null;
    case "cassette":     return rack.cassetteWetBus?.gain ?? null;
    case "ringmod":      return rack.ringWet?.gain ?? null;
    case "shaper":       return rack.shaperWetBus?.gain ?? null;
    case "shaper_preamp":return rack.shaperPreamp?.gain ?? null;
    case "crush":        return rack.crusher?.wet ?? null;
    case "autowah":      return rack.autowah?.wet ?? null;
    case "chorus":       return rack.chorus?.wet ?? null;
    case "phaser":       return rack.phaser?.wet ?? null;
    case "flanger":      return rack.flangerWet?.gain ?? null;
    case "pitch":        return rack.pitchshift?.wet ?? null;
    // sub-params
    case "fuzz_drive":   return rack.fuzzDrive?.gain ?? null;
    case "fuzz_tone":    return rack.fuzzFilter?.frequency ?? null;
    case "fuzz_level":   return rack.fuzzLevel?.gain ?? null;
    case "vinyl_warmth": return rack.vinylLP?.frequency ?? null;
    case "ring_freq":    return rack.ringCarrier?.frequency ?? null;
    case "crush_bits":   return rack.crusher?.bits ?? null;
    case "chorus_rate":  return rack.chorus?.frequency ?? null;
    case "chorus_depth": return rack.chorus?.depth ?? null;  // may not be Signal — returns null if so
    case "phaser_rate":  return rack.phaser?.frequency ?? null;
    case "flanger_rate": return rack.flangerLFO?.frequency ?? null;
    case "flanger_fbk":  return rack.flangerFeedback?.gain ?? null;
    case "delay_time":   return rack.delay?.delayTime ?? null;
    case "delay_fbk":    return rack.delay?.feedback ?? null;
  }
  return null;
}

const TRACK_FX_LFO_KEYS = new Set([
  "fuzz","delay","verb","vinyl","cassette","ringmod","shaper","crush","autowah","chorus","phaser","flanger","pitch",
  "fuzz_drive","fuzz_tone","fuzz_level","vinyl_warmth","shaper_preamp","ring_freq","crush_bits",
  "chorus_rate","chorus_depth","phaser_rate","flanger_rate","flanger_fbk","delay_time","delay_fbk",
  // setter-driven (non-AudioParam) FX params
  "vinyl_wow","cassette_flutter","cassette_sat",
  "shaper_amt",
  "autowah_sens","autowah_range",
  "phaser_depth","pitch_semi","reverb_decay",
]);

// FX params with no AudioParam / Signal handle — driven by a JS-side LFO that
// polls in a RAF loop and applies values through the corresponding setter.
const SETTER_LFO_KEYS = new Set([
  "vinyl_wow","cassette_flutter","cassette_sat",
  "shaper_amt",
  "autowah_sens","autowah_range",
  "phaser_depth","chorus_depth","pitch_semi","reverb_decay",
]);

// Read the user's current 0..1 base value for a setter LFO target so the LFO
// swings AROUND that value instead of overwriting it.
function setterLfoBase(t, key) {
  const c = t.fxRack?.config;
  if (!c) return 0.5;
  switch (key) {
    case "vinyl_wow":        return c.vinyl?.wow ?? 0.3;
    case "cassette_flutter": return c.cassette?.flutter ?? 0.3;
    case "cassette_sat":     return c.cassette?.sat ?? 0.4;
    case "shaper_amt":       return c.shaper?.amount ?? 0.5;
    case "autowah_sens":     return c.autowah?.sens ?? 0.5;
    case "autowah_range":    return c.autowah?.range ?? 0.5;
    case "phaser_depth":     return c.phaser?.depth ?? 0.5;
    case "chorus_depth":     return c.chorus?.depth ?? 0.5;
    case "pitch_semi":       return (((c.pitchshift?.semitones ?? 0) + 12) / 24);
    case "reverb_decay":     return Math.max(0, Math.min(1, ((c.reverb?.decay ?? 2) - 0.2) / 7.8));
  }
  return 0.5;
}

// Apply a 0..1 LFO value to a setter-only FX target. Pokes the audio graph
// directly WITHOUT updating rack.config — the user's slider value remains the
// stored base, and the slider's onInput keeps writing config on user moves.
function applySetterLfoValue(t, key, v) {
  const rack = t.fxRack;
  if (!rack) return;
  v = Math.max(0, Math.min(1, v));
  switch (key) {
    case "vinyl_wow": {
      const base = 0.005, span = 0.0008 + v * 0.006;
      try { rack.vinylWowLFO.min = base - span; rack.vinylWowLFO.max = base + span; } catch {}
      return;
    }
    case "cassette_flutter": {
      const base = 0.003, span = 0.0004 + v * 0.004;
      try { rack.cassetteFlutterLFO.min = base - span; rack.cassetteFlutterLFO.max = base + span; } catch {}
      return;
    }
    case "cassette_sat":
      try { rack.cassetteSat.curve = makeCassetteSatCurve(v); } catch {}
      return;
    case "shaper_amt":
      try {
        const mode = rack.config?.shaper?.mode ?? "fold";
        rack.shaperNode.curve = makeShaperCurve(mode, v);
      } catch {}
      return;
    case "autowah_sens":
      try { rack.autowah.sensitivity = -10 - v * 30; } catch {}
      return;
    case "autowah_range":
      try { rack.autowah.octaves = 1 + v * 4; } catch {}
      return;
    case "phaser_depth":
      try { rack.phaser.octaves = 1 + v * 5; } catch {}
      return;
    case "chorus_depth":
      try { rack.chorus.depth = v; } catch {}
      return;
    case "pitch_semi":
      // Don't round — Tone.PitchShift.pitch accepts fractional semitones, and
      // rounding eats every modulation narrower than ±0.5 semitone (which is
      // exactly the range a vibrato-style mod wants to live in).
      try { rack.pitchshift.pitch = v * 24 - 12; } catch {}
      return;
    case "reverb_decay": {
      // IR rebuild is heavy — only regenerate on perceptible change.
      const decay = 0.2 + v * 7.8;
      const cur = rack._lfoReverbDecay ?? rack.config?.reverb?.decay ?? decay;
      if (Math.abs(decay - cur) > 0.3) {
        rack._lfoReverbDecay = decay;
        try { rack.reverb.decay = decay; rack.reverb.generate().catch(() => {}); } catch {}
      }
      return;
    }
  }
}

function evalLfoShape(type, phase) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case "sine":     return Math.sin(2 * Math.PI * p);
    case "triangle": return p < 0.5 ? (p * 4 - 1) : (3 - p * 4);
    case "sawtooth": return p * 2 - 1;
    case "square":   return p < 0.5 ? 1 : -1;
  }
  return 0;
}

// One RAF loop drives every active setter LFO across every track.
let _setterLfoRafId = null;
function startSetterLfoLoopIfNeeded() {
  if (_setterLfoRafId != null) return;
  let lastT = (state.audioCtx?.currentTime ?? performance.now() / 1000);
  const tick = () => {
    const now = state.audioCtx?.currentTime ?? performance.now() / 1000;
    const dt = Math.max(0, Math.min(0.1, now - lastT));
    lastT = now;
    let anyActive = false;
    for (const t of state.tracks) {
      if (!t.fxRack || !t._setterLfoPhase) continue;
      for (const key of SETTER_LFO_KEYS) {
        const cfg = t.lfoConfig[key];
        if (!cfg?.enabled) continue;
        anyActive = true;
        const hz = effectiveRate(cfg);
        const phase = (t._setterLfoPhase[key] ?? 0) + dt * hz;
        t._setterLfoPhase[key] = phase;
        const shape = evalLfoShape(cfg.type || "sine", phase);
        const base = setterLfoBase(t, key);
        applySetterLfoValue(t, key, base + shape * (cfg.depth ?? 0) * 0.5);
      }
    }
    _setterLfoRafId = anyActive ? requestAnimationFrame(tick) : null;
  };
  _setterLfoRafId = requestAnimationFrame(tick);
}

// Which modulation keys make sense for the current engine? Voice-independent
// so the picker hides irrelevant entries even before audio is initialized.
function canModulate(t, key) {
  // Always-applicable: track-level fx + master vol + filter.
  if (key === "vol" || key === "cutoff" || key === "reson") return true;
  if (TRACK_FX_LFO_KEYS.has(key)) return true;
  const eng = engineByKey(t.engineKey);
  if (!eng) return false;
  // Plaits exposes harm/timb/morph/decay as voice params.
  if (eng.type === "plaits") return ["harm", "timb", "morph", "decay"].includes(key);
  // Emulator builders expose specific AudioParams via getAudioParam — only list
  // the keys that are actually wired (see each builder above).
  switch (t.engineKey) {
    case "dm:mini-brute": return ["harm", "osc1", "osc2", "osc3", "osc4", "ultra", "fm"].includes(key);
    case "dm:moog":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:juno":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:prophet6":   return ["harm", "osc1", "osc2", "osc3", "osc4", "noise"].includes(key);
    // Guitar/bass/rhodes have no per-voice AudioParam targets beyond vol+track fx;
    // their timbre params are still automatable via setParam (see canAutomate).
  }
  return false;
}

function syncLFO(t, key) {
  const cfg = t.lfoConfig[key];
  let lfo = t.lfos[key];

  // ── setter-driven LFO path (FX params without an AudioParam target) ──
  if (SETTER_LFO_KEYS.has(key)) {
    if (lfo) {
      try { lfo.stop(); } catch {}
      try { lfo.disconnect(); } catch {}
      try { lfo.dispose(); } catch {}
      t.lfos[key] = null;
    }
    if (!cfg.enabled) {
      if (t._setterLfoPhase && t._setterLfoPhase[key] != null) {
        delete t._setterLfoPhase[key];
        // restore base value to the audio graph so the param stops where the slider sits
        if (t.fxRack) applySetterLfoValue(t, key, setterLfoBase(t, key));
      }
      return;
    }
    if (!t._setterLfoPhase) t._setterLfoPhase = {};
    if (t._setterLfoPhase[key] == null) t._setterLfoPhase[key] = 0;
    startSetterLfoLoopIfNeeded();
    return;
  }

  if (!cfg.enabled) {
    if (lfo) {
      try { lfo.stop(); } catch {}
      try { lfo.disconnect(); } catch {}
      try { lfo.dispose(); } catch {}
      t.lfos[key] = null;
    }
    return;
  }
  if (!state.ready) return;
  const param = getModTarget(t, key);
  if (!param) return;
  const amp = (cfg.depth / 2) * (LFO_AMP_SCALE[key] ?? 1);
  const hz = effectiveRate(cfg);
  if (!lfo) {
    lfo = new Tone.LFO({ frequency: hz, min: -amp, max: amp, type: cfg.type });
    lfo.start();
    lfo.connect(param);
    t.lfos[key] = lfo;
  } else {
    lfo.frequency.value = hz;
    lfo.min = -amp;
    lfo.max = amp;
    lfo.type = cfg.type;
  }
}

function syncAllLFOs(t) {
  for (const k of LFO_KEYS) syncLFO(t, k);
}

function disposeLFOs(t) {
  for (const k of LFO_KEYS) {
    const lfo = t.lfos[k];
    if (!lfo) continue;
    try { lfo.stop(); } catch {}
    try { lfo.disconnect(); } catch {}
    try { lfo.dispose(); } catch {}
    t.lfos[k] = null;
  }
  if (t._setterLfoPhase) t._setterLfoPhase = {};
}

function retuneSyncedLFOs() {
  for (const t of state.tracks) {
    for (const k of LFO_KEYS) {
      if (t.lfoConfig[k].enabled && t.lfoConfig[k].sync) syncLFO(t, k);
    }
  }
}

// ---- per-step automation -----------------------------------------------
// Lanes live on the pattern (t.patterns[i].automation[key] = { enabled, values })
// and are aliased to t.automation by aliasPattern(). Lane values are normalized
// 0..1 per step; applyAutomationAtStep maps that to the target's physical range.

const AUTOMATION_TARGETS = {
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
const AUTOMATION_KEYS = Object.keys(AUTOMATION_TARGETS);
const VOICE_AUTO_KEYS = ["vol","harm","timb","morph","decay","osc1","osc2","osc3","osc4","ultra","fm","metal","noise"];

// Engine-aware list of voice/instrument keys that can be automated. Broader
// than canModulate because automation can drive params via setParam even when
// the voice doesn't expose an AudioParam (guitar/bass/rhodes timbre sliders).
function voiceAutoKeysForEngine(t) {
  const eng = engineByKey(t.engineKey);
  if (!eng) return ["vol"];
  if (eng.type === "plaits") return ["vol", "harm", "timb", "morph", "decay"];
  switch (t.engineKey) {
    case "dm:mini-brute": return ["vol", "harm", "timb", "osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal"];
    case "dm:moog":       return ["vol", "harm", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:juno":       return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:guitar":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:bass":       return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:rhodes":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:prophet6":   return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"];
  }
  return ["vol"];
}

function canAutomate(t, key) {
  if (key === "cutoff" || key === "reson") return true;
  if (key.startsWith("fx.")) return true;
  if (VOICE_AUTO_KEYS.includes(key)) return voiceAutoKeysForEngine(t).includes(key);
  return false;
}

// Schedule a value change at `time`, linearly ramping to `vNext` over `stepDur`
// for targets backed by an AudioParam/Signal. For params that require a
// rebuild (waveshaper curve, IR, integer quantization) the change stays
// stepwise at `time`.
function applyAutomationAtStep(t, key, v, time, vNext, stepDur) {
  const vv = Math.max(0, Math.min(1, Number(v) || 0));
  const vn = vNext == null ? vv : Math.max(0, Math.min(1, Number(vNext) || 0));
  const sdur = Math.max(0.005, Number(stepDur) || 0.02);
  const endT = time + sdur;

  // Helper: cancel any in-flight automation at or after `time`, pin the current
  // segment start, and ramp to the next step's physical value by the end.
  const ramp = (param, physFrom, physTo) => {
    if (!param) return;
    try {
      param.cancelScheduledValues(time);
      param.setValueAtTime(physFrom, time);
      param.linearRampToValueAtTime(physTo, endT);
    } catch {
      try { param.value = physTo; } catch {}
    }
  };

  if (VOICE_AUTO_KEYS.includes(key)) {
    const param = t.voice?.getAudioParam?.(key);
    if (param && param.linearRampToValueAtTime) {
      ramp(param, vv, vn);
      return;
    }
    // fallback for voices without AudioParam (guitar/bass/rhodes timbre, mini-brute metal, etc.)
    try { t.voice?.setParam?.(key, vv); } catch {}
    if (t.params) t.params[key] = vv;
    return;
  }
  if (key === "cutoff") {
    t.filter.cutoff = vv;
    ramp(t.filterNode?.frequency, cutoffToHz(vv), cutoffToHz(vn));
    return;
  }
  if (key === "reson") {
    t.filter.reson = vv;
    ramp(t.filterNode?.Q, resonToQ(vv), resonToQ(vn));
    return;
  }
  const rack = t.fxRack;
  if (!rack || !key.startsWith("fx.")) return;

  switch (key) {
    // ── top-level wet/amt targets (crossfade fx: ramp both dry+wet) ──
    case "fx.vinyl":
      rack.config.vinyl.amount = vv;
      ramp(rack.vinylWetBus?.gain, vv, vn);
      ramp(rack.vinylDryBus?.gain, 1 - vv, 1 - vn);
      ramp(rack.vinylNoiseGain?.gain, vv * 0.45, vn * 0.45);
      return;
    case "fx.cassette":
      rack.config.cassette.amount = vv;
      ramp(rack.cassetteWetBus?.gain, vv, vn);
      ramp(rack.cassetteDryBus?.gain, 1 - vv, 1 - vn);
      ramp(rack.cassetteHissGain?.gain, vv * 0.18, vn * 0.18);
      return;
    case "fx.fuzz":
      rack.config.fuzz.amount = vv;
      ramp(rack.wetBus?.gain, vv, vn);
      ramp(rack.dryBus?.gain, 1 - vv, 1 - vn);
      return;
    case "fx.ringmod":
      rack.config.ringmod.wet = vv;
      ramp(rack.ringWet?.gain, vv, vn);
      ramp(rack.ringDry?.gain, 1 - vv, 1 - vn);
      return;
    case "fx.shaper":
      if (!rack.config.shaper) rack.config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
      rack.config.shaper.wet = vv;
      ramp(rack.shaperWetBus?.gain, vv, vn);
      ramp(rack.shaperDryBus?.gain, 1 - vv, 1 - vn);
      return;
    case "fx.shaper.preamp":
      if (!rack.config.shaper) rack.config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
      rack.config.shaper.preamp = vv;
      ramp(rack.shaperPreamp?.gain, shaperPreampGain(vv), shaperPreampGain(vn));
      return;
    case "fx.flanger":
      rack.config.flanger.wet = vv;
      ramp(rack.flangerWet?.gain, vv, vn);
      ramp(rack.flangerDry?.gain, 1 - vv, 1 - vn);
      return;
    case "fx.crush":      rack.config.crush.wet = vv;      ramp(rack.crusher?.wet, vv, vn); return;
    case "fx.autowah":    rack.config.autowah.wet = vv;    ramp(rack.autowah?.wet, vv, vn); return;
    case "fx.chorus":     rack.config.chorus.wet = vv;     ramp(rack.chorus?.wet, vv, vn); return;
    case "fx.phaser":     rack.config.phaser.wet = vv;     ramp(rack.phaser?.wet, vv, vn); return;
    case "fx.pitchshift": rack.config.pitchshift.wet = vv; ramp(rack.pitchshift?.wet, vv, vn); return;
    case "fx.delay":      rack.config.delay.wet = vv;      ramp(rack.delay?.wet, vv, vn); return;
    case "fx.reverb":     rack.config.reverb.wet = vv;     ramp(rack.reverb?.wet, vv, vn); return;

    // ── sub-params with AudioParam/Signal targets — ramp directly ──
    case "fx.fuzz.drive":
      rack.config.fuzz.drive = vv;
      ramp(rack.fuzzDrive?.gain, 1 + vv * 30, 1 + vn * 30);
      // waveshaper curve rebuilds at step boundaries; mid-ramp keeps prior curve.
      try { rack.fuzzShaper.curve = makeFuzzCurve(vv); } catch {}
      return;
    case "fx.fuzz.tone":
      rack.config.fuzz.tone = vv;
      ramp(rack.fuzzFilter?.frequency, 200 + vv * 7800, 200 + vn * 7800);
      return;
    case "fx.fuzz.level":
      rack.config.fuzz.level = vv;
      ramp(rack.fuzzLevel?.gain, vv * 0.9, vn * 0.9);
      return;
    case "fx.vinyl.warmth":
      rack.config.vinyl.warmth = vv;
      ramp(rack.vinylLP?.frequency, 9000 - vv * 7200, 9000 - vn * 7200);
      return;
    case "fx.ringmod.freq":
      rack.config.ringmod.freq = vv;
      ramp(rack.ringCarrier?.frequency, 20 * Math.pow(150, vv), 20 * Math.pow(150, vn));
      return;
    case "fx.chorus.rate":
      rack.config.chorus.rate = vv;
      ramp(rack.chorus?.frequency, 0.1 + vv * 4.9, 0.1 + vn * 4.9);
      return;
    case "fx.phaser.rate":
      rack.config.phaser.rate = vv;
      ramp(rack.phaser?.frequency, 0.05 + vv * 3.95, 0.05 + vn * 3.95);
      return;
    case "fx.flanger.rate":
      rack.config.flanger.rate = vv;
      ramp(rack.flangerLFO?.frequency, 0.05 + vv * 3.95, 0.05 + vn * 3.95);
      return;
    case "fx.flanger.fbk":
      rack.config.flanger.fbk = vv;
      ramp(rack.flangerFeedback?.gain, vv * 0.9, vn * 0.9);
      return;
    case "fx.delay.time":
      rack.config.delay.time = 0.05 + vv * 0.95;
      rack.config.delay.sync = false;
      ramp(rack.delay?.delayTime, 0.05 + vv * 0.95, 0.05 + vn * 0.95);
      return;
    case "fx.delay.fbk":
      rack.config.delay.fbk = vv * 0.95;
      ramp(rack.delay?.feedback, vv * 0.95, vn * 0.95);
      return;

    // ── stepwise-only: integer-quantized or IR/curve-rebuild targets ──
    case "fx.vinyl.wow":        try { rack.applyVinyl({ wow: vv }); } catch {} return;
    case "fx.cassette.flutter": try { rack.applyCassette({ flutter: vv }); } catch {} return;
    case "fx.cassette.sat":     try { rack.applyCassette({ sat: vv }); } catch {} return;
    case "fx.shaper.amt":       try { rack.applyWaveShaper({ amount: vv }); } catch {} return;
    case "fx.crush.bits":       try { rack.applyCrush({ bits: 1 + vv * 15 }); } catch {} return;
    case "fx.autowah.sens":     try { rack.applyAutoWah({ sens: vv }); } catch {} return;
    case "fx.autowah.range":    try { rack.applyAutoWah({ range: vv }); } catch {} return;
    case "fx.chorus.depth":     try { rack.applyChorus({ depth: vv }); } catch {} return;
    case "fx.phaser.depth":     try { rack.applyPhaser({ depth: vv }); } catch {} return;
    case "fx.pitchshift.semi":  try { rack.applyPitchShift({ semitones: Math.round(vv * 24 - 12) }); } catch {} return;
    case "fx.reverb.decay": {
      const decay = 0.2 + vv * 7.8;
      const cur = rack.config?.reverb?.decay ?? decay;
      if (Math.abs(decay - cur) > 0.15) { try { rack.applyReverb({ decay }); } catch {} }
      return;
    }
  }
}

// Apply every enabled lane at the given audio time, smoothing from the current
// step's value to the next step's value over `stepDur` seconds.
function runAutomationForStep(t, stepIdx, time, stepDur) {
  const auto = t.automation;
  if (!auto) return;
  for (const key in auto) {
    const lane = auto[key];
    if (!lane || !lane.enabled) continue;
    const values = lane.values;
    if (!values || values.length === 0) continue;
    const len = values.length;
    const v = values[stepIdx % len];
    if (v == null) continue;
    const next = values[(stepIdx + 1) % len];
    applyAutomationAtStep(t, key, v, time, next, stepDur);
  }
}

// ---- track params / randomize ------------------------------------------

function setParam(t, key, val) {
  t.params[key] = val;
  t.voice?.setParam(key, val);
}

function updatePlaitsControlsVisibility(t) {
  if (!t.el) return;
  const eng = engineByKey(t.engineKey);
  const engineType = eng?.type;
  const isPlaits = engineType === "plaits";
  // The analog mono engines (mini-brute, moog) reuse the harm/timb/morph/decay
  // sliders for their own params, so keep the timbre group visible for them too.
  const isMiniBrute = t.engineKey === "dm:mini-brute";
  const isMoog      = t.engineKey === "dm:moog";
  const isJuno      = t.engineKey === "dm:juno";
  const isGuitar    = t.engineKey === "dm:guitar";
  const isBass      = t.engineKey === "dm:bass";
  const isRhodes    = t.engineKey === "dm:rhodes";
  const isProphet6  = t.engineKey === "dm:prophet6";
  const showTimbre = isPlaits || isMiniBrute || isMoog || isJuno || isGuitar || isBass || isRhodes || isProphet6;
  const group = t.el.querySelector(".timbre-group");
  if (group) {
    group.hidden = !showTimbre;
    group.style.removeProperty("display");
  }
  const modPanel = t.el.querySelector(".track-mod-panel");
  if (modPanel) {
    for (const key of ["harm", "timb", "morph", "decay"]) {
      const row = modPanel.querySelector(`.lfo-row[data-key="${key}"]`);
      if (row) {
        row.hidden = !showTimbre;
        row.style.removeProperty("display");
      }
    }
  }
  // Relabel the timbre sliders for each analog engine so the control intent is
  // visible. null = hide the field (control isn't used by this engine).
  if (group) {
    const labels = isMiniBrute
      ? { harm: "pwm rate", timb: "pw",     morph: null,        decay: null }
      : isMoog
      ? { harm: "detune",   timb: null,     morph: null,        decay: "warm" }
      : isJuno
      ? { harm: "pwm rate", timb: "pw",     morph: "chorus",    decay: "dec" }
      : isGuitar
      ? { harm: "drive",    timb: "bright", morph: "chorus",    decay: "sustain" }
      : isBass
      ? { harm: "drive",    timb: "tone",   morph: "resonance", decay: "sustain" }
      : isRhodes
      ? { harm: "tine",     timb: "bite",   morph: "chorus",    decay: "decay" }
      : isProphet6
      ? { harm: "detune",   timb: "shape",  morph: "drive",     decay: "decay" }
      : { harm: "harm",     timb: "timb",    morph: "morph",    decay: "decay" };
    for (const key of Object.keys(labels)) {
      const field = group.querySelector(`.p-${key}`)?.closest(".field");
      if (!field) continue;
      if (labels[key] == null) {
        field.hidden = true;
      } else {
        field.hidden = false;
        const lbl = field.querySelector("label");
        if (lbl) lbl.textContent = labels[key];
      }
    }
    // Randomize button only makes sense for Plaits' generic harm/timb/morph/decay —
    // hide it for the analog engines where those sliders do engine-specific things.
    const randBtn = group.querySelector(".track-rand");
    if (randBtn) randBtn.hidden = isMiniBrute || isMoog || isJuno || isGuitar || isBass || isRhodes || isProphet6;
  }
  // Per-oscillator volume sliders: only shown for the analog mono engines.
  const oscGroup = t.el.querySelector(".osc-mix-group");
  if (oscGroup) {
    const showOsc = isMiniBrute || isMoog || isJuno || isProphet6;
    oscGroup.hidden = !showOsc;
    if (showOsc) {
      const oscLabels = isMiniBrute
        ? { osc1: "saw",  osc2: "pulse", osc3: "tri",   osc4: "sub", hide4: false }
        : isJuno
        ? { osc1: "dco",  osc2: "sub",   osc3: "noise", osc4: "",    hide4: true }
        : isProphet6
        ? { osc1: "vco1", osc2: "vco2",  osc3: "sub",   osc4: "noise", hide4: false }
        : { osc1: "osc1", osc2: "osc2",  osc3: "osc3",  osc4: "",    hide4: true };
      for (const k of ["osc1", "osc2", "osc3", "osc4"]) {
        const field = oscGroup.querySelector(`.p-${k}`)?.closest(".field");
        if (!field) continue;
        if (k === "osc4" && oscLabels.hide4) { field.hidden = true; continue; }
        field.hidden = false;
        const lbl = field.querySelector("label");
        if (lbl) lbl.textContent = oscLabels[k];
      }
    }
  }
  // Oscillator-modifier group (ultrasaw / FM / metalizer): mini-brute only for now.
  const modGroup = t.el.querySelector(".osc-mod-group");
  if (modGroup) modGroup.hidden = !isMiniBrute;
  // Moog osc-bank group (per-osc range + waveform + osc2/3 freq + noise).
  const moogGroup = t.el.querySelector(".moog-osc-group");
  if (moogGroup) moogGroup.hidden = !isMoog;
}

// Force all fx wet levels to 0 (100% dry) — used when switching a track to the
// eleven-labs engine so user-applied fx don't stack on baked-in sample ambience.
function resetFxDry(t) {
  const cfg = t.fxConfig;
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  if (!cfg.shaper)     cfg.shaper     = { wet: 0, amount: 0.5 };
  cfg.vinyl.amount      = 0;
  cfg.cassette.amount   = 0;
  cfg.fuzz.amount       = 0;
  cfg.ringmod.wet       = 0;
  cfg.shaper.wet        = 0;
  cfg.autowah.wet       = 0;
  cfg.chorus.wet        = 0;
  cfg.phaser.wet        = 0;
  cfg.flanger.wet       = 0;
  cfg.pitchshift.wet    = 0;
  cfg.delay.wet         = 0;
  cfg.reverb.wet        = 0;
  if (!cfg.crush) cfg.crush = { bits: 8, wet: 0 };
  cfg.crush.wet = 0;
  if (t.fxRack) {
    t.fxRack.applyVinyl(cfg.vinyl);
    t.fxRack.applyCassette(cfg.cassette);
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyRingMod(cfg.ringmod);
    t.fxRack.applyWaveShaper(cfg.shaper);
    t.fxRack.applyAutoWah(cfg.autowah);
    t.fxRack.applyChorus(cfg.chorus);
    t.fxRack.applyPhaser(cfg.phaser);
    t.fxRack.applyFlanger(cfg.flanger);
    t.fxRack.applyPitchShift(cfg.pitchshift);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
    t.fxRack.applyCrush(cfg.crush);
  }
  refreshFxPanelUI(t);
}

function setEngineKey(t, newKey) {
  const same = t.engineKey === newKey;
  if (same) { updatePlaitsControlsVisibility(t); return; }
  const e = engineByKey(newKey);
  if (!e) return;
  t.engineKey = newKey;
  redetectDrumKit(t);
  // Saved patches live on the track as customConfig
  if (e.type === "saved") {
    t.customConfig = e.config;
  }
  if (!t.voice) { updateMidiUI(t); updatePlaitsControlsVisibility(t); return; }
  if (t.voice.canInPlaceChange(newKey) && t.voice.type === e.type) {
    t.voice.setEngine(newKey);
  } else {
    disposeLFOs(t);
    t.voice.dispose();
    ensureFxRack(t);
    t.voice = buildVoiceForEngine(state.audioCtx, newKey, t.params, t);
    if (t.voice.type === "midi") {
      t.voice.setChannel(t.midi.channel);
      const out = state.midi?.outputs.get(t.midi.outputId);
      if (out) t.voice.setOutput(out);
    }
    if (t.voice.setGlide) t.voice.setGlide(t.glide);
    routeVoiceToRack(t);
    applySampleSpeed(t);
    syncAllLFOs(t);
  }
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
  if (engineByKey(newKey)?.type === "eleven") resetFxDry(t);
  t._refreshSaveEnabled?.();
}

const RAND_KEYS = ["harm", "timb", "morph", "decay"];
function randomizeTimbre(t) {
  for (const k of RAND_KEYS) {
    const v = Math.random();
    setParam(t, k, v);
    const input = t.el.querySelector(`.p-${k}`);
    if (input) input.value = String(v);
  }
}

// ---- track model --------------------------------------------------------

function totalSteps() { return STEPS_PER_BAR; }

// Strong-beat accent positions for a pattern. Each "beat" in an N/D meter is
// 16/D sixteenth-note steps apart (e.g. 4/4 → every 4, 7/8 → every 2, 6/8 → 2).
function autoAccents(len, meter) {
  const set = new Set();
  const stepsPerBeat = stepsPerBeatForMeter(meter);
  for (let i = 0; i < len; i += stepsPerBeat) set.add(i);
  return set;
}
function stepsPerBeatForMeter(meter) {
  const den = Number(meter?.den) || 4;
  return Math.max(1, Math.round(16 / den));
}
function stepsPerBarForMeter(meter) {
  const num = Math.max(1, Math.round(Number(meter?.num) || 4));
  return num * stepsPerBeatForMeter(meter);
}
function activeMeter() {
  return state.patternMeters[state.activePattern] || { num: 4, den: 4 };
}
function patternMeter(idx) {
  return state.patternMeters[idx] || { num: 4, den: 4 };
}
const COMMON_METERS = ["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "5/4", "7/4", "5/8", "7/8"];
function parseMeter(str) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(str || ""));
  if (!m) return null;
  const num = Math.max(1, Math.min(32, Number(m[1])));
  const den = Math.max(1, Math.min(32, Number(m[2])));
  if (![1, 2, 4, 8, 16, 32].includes(den)) return null;
  return { num, den };
}

// Guess whether a track is playing a drum kit based on engine type + name.
// Used at track creation and re-run on engine/name change via redetectDrumKit.
function guessIsDrumKit({ engineKey, name }) {
  const eng = engineByKey(engineKey);
  if (eng?.type === "sample") return true;
  const blob = `${engineKey || ""} ${eng?.label || ""} ${name || ""}`.toLowerCase();
  return /\b(kick|snare|hat|hi-?hat|clap|tom|perc|drum)\b/.test(blob);
}

// Recompute t.isDrumKit from current engineKey + name. Existing step notes are
// left untouched — only future blank steps + sample pitch baseline follow the
// new flag. Call this whenever engine or track name changes.
function redetectDrumKit(t) {
  t.isDrumKit = guessIsDrumKit({ engineKey: t.engineKey, name: t.name });
}

function createTrack({ name, engineKey, length = totalSteps() }) {
  const len = Math.max(1, length);
  const t = {
    id: state.nextId++,
    name,
    engineKey,
    length: len,
    accents: autoAccents(len, { num: 4, den: 4 }),
    // steps/lengths/notes/velocities/chords are aliased to t.patterns[activePattern].*
    steps:      null,
    lengths:    null,
    notes:      null,
    velocities: null,
    chords:     null,
    muted: false,
    soloed: false,
    lockInstrument: false,
    lockPattern: false,
    isDrumKit: guessIsDrumKit({ engineKey, name }),
    glide: 0,
    sampleSpeedMode: "native",
    density: 0.5,
    speed: 1,
    trackTick: 0,
    repeatId: null,
    soundPromptText: "",
    promptText: "",
    sampleDefaults: { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off" },
    params: {
      vol: 0.8, harm: 0.5, timb: 0.5, morph: 0.5, decay: 0.4,
      osc1: 0.55, osc2: 0.45, osc3: 0.35, osc4: 0.4,
      ultra: 0.35, fm: 0, metal: 0,
      // Moog osc-bank params
      osc1wave: "sawtooth", osc2wave: "sawtooth", osc3wave: "triangle",
      osc1range: 0, osc2range: 0, osc3range: -1,
      osc2freq: 0, osc3freq: 0,
      noise: 0, noisetype: "white",
    },
    filter: { cutoff: 1, reson: 0, env: 0, attack: 0, decay: 0.25, sustain: 0.4, release: 0.3 },
    filterNode: null,
    eq: { low: 0, mid: 0, high: 0 },
    eqNode: null,
    comp: defaultCompConfig(),
    compNode: null,
    patterns: null,   // set below
    _patternIdx: 0,
    lfoConfig: defaultLFOConfig(),
    lfos: { vol: null, harm: null, timb: null, morph: null, decay: null },
    voice: null,
    midi: { outputId: "", channel: 1 },
    customConfig: null,
    fxConfig: defaultFxConfig(),
    fxRack: null,
    el: null,
  };
  t.patterns = Array(PATTERN_COUNT).fill(null).map(() => emptyPattern(len));
  aliasPattern(t, state.activePattern);
  state.tracks.push(t);
  renderTrack(t);
  refreshCompSourceDropdowns();
  if (state.ready) {
    ensureFxRack(t);
    t.voice = buildVoiceForEngine(state.audioCtx, engineKey, t.params, t);
    if (t.voice.type === "midi") {
      t.voice.setChannel(t.midi.channel);
      const out = state.midi?.outputs.get(t.midi.outputId);
      if (out) t.voice.setOutput(out);
    }
    routeVoiceToRack(t);
  }
  return t;
}

// Deep-clone a track's state onto a new track placed after it in DOM +
// state order. Mirrors the per-track apply logic in applySet: createTrack +
// field fill + audio rebuild. Audio-node refs / DOM handles aren't copied —
// they're freshly built. Sample buffers (eleven / upload) are shared since
// they're immutable decoded AudioBuffers.
function duplicateTrack(src) {
  const baseName = (src.name || "track").replace(/\s+copy(\s+\d+)?$/i, "").trim() || "track";
  const existing = new Set(state.tracks.map(x => x.name));
  let name = `${baseName} copy`;
  for (let i = 2; existing.has(name); i++) name = `${baseName} copy ${i}`;

  const dup = createTrack({ name, engineKey: src.engineKey, length: src.length });

  Object.assign(dup.params, src.params);
  Object.assign(dup.filter, src.filter);
  Object.assign(dup.eq, src.eq);
  Object.assign(dup.midi, src.midi);
  dup.fxConfig = JSON.parse(JSON.stringify(src.fxConfig));
  dup.comp = JSON.parse(JSON.stringify(src.comp));
  dup.customConfig = src.customConfig ? JSON.parse(JSON.stringify(src.customConfig)) : null;
  dup.elevenAudio = src.elevenAudio || null;
  dup.elevenAudioMime = src.elevenAudioMime || null;
  dup.elevenBuffer = src.elevenBuffer || null;
  dup.uploadAudio = src.uploadAudio || null;
  dup.uploadAudioMime = src.uploadAudioMime || null;
  dup.uploadFileName = src.uploadFileName || null;
  dup.uploadBuffer = src.uploadBuffer || null;
  dup.soundPromptText = src.soundPromptText || "";
  dup.promptText = src.promptText || "";
  dup.sampleDefaults = src.sampleDefaults ? { ...src.sampleDefaults } : dup.sampleDefaults;
  dup.muted = !!src.muted;
  dup.soloed = !!src.soloed;
  dup.lockInstrument = !!src.lockInstrument;
  dup.lockPattern = !!src.lockPattern;
  dup.isDrumKit = !!src.isDrumKit;
  dup.glide = src.glide ?? 0;
  dup.speed = src.speed ?? 1;
  dup.density = src.density ?? 0.5;
  dup.sampleSpeedMode = src.sampleSpeedMode ?? "native";
  for (const k of Object.keys(dup.lfoConfig)) {
    if (src.lfoConfig?.[k]) dup.lfoConfig[k] = { ...src.lfoConfig[k] };
  }
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const sp = src.patterns[i];
    if (!sp) continue;
    const automation = {};
    for (const [key, lane] of Object.entries(sp.automation || {})) {
      automation[key] = { enabled: !!lane.enabled, values: (lane.values || []).slice() };
    }
    dup.patterns[i] = {
      steps: sp.steps.slice(),
      lengths: sp.lengths.slice(),
      notes: sp.notes.slice(),
      velocities: sp.velocities.slice(),
      chords: sp.chords.slice(),
      offsets: (sp.offsets || []).slice(),
      arps: (sp.arps || []).slice(),
      arpRates: (sp.arpRates || []).slice(),
      arpRanges: (sp.arpRanges || []).slice(),
      arpDirs: (sp.arpDirs || []).slice(),
      complexities: (sp.complexities || []).slice(),
      ratchets: (sp.ratchets || []).slice(),
      sampleStarts: (sp.sampleStarts || []).slice(),
      sampleEnds: (sp.sampleEnds || []).slice(),
      sampleFadeIns: (sp.sampleFadeIns || []).slice(),
      sampleFadeOuts: (sp.sampleFadeOuts || []).slice(),
      sampleLoopModes: (sp.sampleLoopModes || []).slice(),
      automation,
    };
  }
  aliasPattern(dup, state.activePattern);

  if (dup.el) {
    const q = sel => dup.el.querySelector(sel);
    q(".track-name").value = dup.name;
    q(".track-len").value = dup.length;
    q(".track-engine").value = dup.engineKey;
    const spd = q(".track-speed"); if (spd) spd.value = String(dup.speed);
    q(".p-vol").value = dup.params.vol;
    q(".p-harm").value = dup.params.harm;
    q(".p-timb").value = dup.params.timb;
    q(".p-morph").value = dup.params.morph;
    q(".p-decay").value = dup.params.decay;
    q(".p-cutoff").value = dup.filter.cutoff;
    q(".p-reson").value = dup.filter.reson;
    q(".p-envamt").value = dup.filter.env;
    q(".p-envatk").value = dup.filter.attack;
    q(".p-envdec").value = dup.filter.decay;
    q(".p-envsus").value = dup.filter.sustain;
    q(".p-envrel").value = dup.filter.release;
    dup.el.classList.toggle("muted", dup.muted);
    dup.el.classList.toggle("soloed", dup.soloed);
    q(".track-solo")?.setAttribute("aria-pressed", String(dup.soloed));
    refreshFxPanelUI(dup);
    renderModPanel(dup, dup.el.querySelector(".track-mod-panel"));
  }

  // Move the duplicate right after the source in DOM + state order.
  const srcIdx = state.tracks.indexOf(src);
  if (srcIdx >= 0 && srcIdx < state.tracks.length - 1) {
    state.tracks.pop();
    state.tracks.splice(srcIdx + 1, 0, dup);
    src.el.parentNode.insertBefore(dup.el, src.el.nextSibling);
  }

  if (state.ready) {
    disposeLFOs(dup);
    if (dup.voice) dup.voice.dispose();
    ensureFxRack(dup);
    if (dup.fxRack) {
      if (dup.fxConfig.vinyl)      dup.fxRack.applyVinyl(dup.fxConfig.vinyl);
      if (dup.fxConfig.cassette)   dup.fxRack.applyCassette(dup.fxConfig.cassette);
      dup.fxRack.applyFuzz(dup.fxConfig.fuzz);
      if (dup.fxConfig.ringmod)    dup.fxRack.applyRingMod(dup.fxConfig.ringmod);
      if (dup.fxConfig.crush)      dup.fxRack.applyCrush(dup.fxConfig.crush);
      if (dup.fxConfig.autowah)    dup.fxRack.applyAutoWah(dup.fxConfig.autowah);
      if (dup.fxConfig.chorus)     dup.fxRack.applyChorus(dup.fxConfig.chorus);
      if (dup.fxConfig.phaser)     dup.fxRack.applyPhaser(dup.fxConfig.phaser);
      if (dup.fxConfig.flanger)    dup.fxRack.applyFlanger(dup.fxConfig.flanger);
      if (dup.fxConfig.pitchshift) dup.fxRack.applyPitchShift(dup.fxConfig.pitchshift);
      dup.fxRack.applyDelay(dup.fxConfig.delay);
      dup.fxRack.applyReverb(dup.fxConfig.reverb);
    }
    dup.voice = buildVoiceForEngine(state.audioCtx, dup.engineKey, dup.params, dup);
    if (dup.voice.type === "midi") {
      dup.voice.setChannel(dup.midi.channel);
      const out = state.midi?.outputs.get(dup.midi.outputId);
      if (out) dup.voice.setOutput(out);
    }
    if (dup.voice.setGlide) dup.voice.setGlide(dup.glide);
    routeVoiceToRack(dup);
    applySampleSpeed(dup);
    syncAllLFOs(dup);
  }
  refreshCompSourceDropdowns();
  updatePlaitsControlsVisibility(dup);
  renderStepGrid(dup);
  return dup;
}

function removeTrack(t) {
  disposeLFOs(t);
  if (t.voice) t.voice.dispose();
  if (t.fxRack) t.fxRack.dispose();
  if (t.compNode) t.compNode.dispose();
  t.el.remove();
  state.tracks = state.tracks.filter(x => x !== t);
  refreshCompSourceDropdowns();
  // if any remaining track was sidechained to the removed one, reset it to self
  for (const x of state.tracks) {
    if (x.comp.source && x.comp.source !== "self" && !state.tracks.find(y => String(y.id) === String(x.comp.source))) {
      x.comp.source = "self";
      applyCompressorConfig(x);
      const sel = x.el?.querySelector(".comp-source");
      if (sel) sel.value = "self";
    }
  }
}

function ensureFxRack(t) {
  if (!state.audioCtx || t.fxRack) return;
  t.fxRack = new FXRack(state.audioCtx, t.fxConfig);
  // Reroute the fx rack away from ctx.destination onto the master bus,
  // and tap the post-fx signal for the per-track level meter.
  try { t.fxRack.output.disconnect(); } catch {}
  const masterDest = state.masterGain || state.audioCtx.destination;
  t.fxRack.output.connect(masterDest);
  if (!t.meterAnalyser) {
    t.meterAnalyser = state.audioCtx.createAnalyser();
    t.meterAnalyser.fftSize = 512;
    t.meterAnalyser.smoothingTimeConstant = 0.15;
  }
  t.fxRack.output.connect(t.meterAnalyser);
}

// cutoff slider [0,1] → freq 60-20000 Hz (log)
function cutoffToHz(v) { return 60 * Math.pow(20000 / 60, Math.max(0, Math.min(1, v))); }
// reson slider [0,1] → Q 0.5-20
function resonToQ(v) { return 0.5 + Math.max(0, Math.min(1, v)) * 19.5; }

function ensureFilter(t) {
  if (!state.audioCtx || t.filterNode) return;
  const ctx = state.audioCtx;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoffToHz(t.filter.cutoff);
  f.Q.value = resonToQ(t.filter.reson);
  t.filterNode = f;
}

class EQChain {
  constructor(ctx, cfg) {
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 250;
    this.low.gain.value = cfg.low ?? 0;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.8;
    this.mid.gain.value = cfg.mid ?? 0;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 5000;
    this.high.gain.value = cfg.high ?? 0;
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.input = this.low;
    this.output = this.high;
  }
  setBand(name, db) {
    if (this[name]) this[name].gain.value = db;
  }
}

function ensureEQ(t) {
  if (!state.audioCtx || t.eqNode) return;
  t.eqNode = new EQChain(state.audioCtx, t.eq);
}

// Per-track compressor with two modes:
//   - "self": native DynamicsCompressorNode inline on the track's signal
//   - "<trackId>": envelope-follower ducking driven by another track's output
class TrackCompressor {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = { ...config };
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypass = ctx.createGain();
    this.bypass.gain.value = 1;
    this.input.connect(this.bypass);
    this.bypass.connect(this.output);
    this._mode = "off";
    this._nativeComp = null;
    this._duckGain = null;
    this._analyser = null;
    this._rafId = null;
    this._sideSource = null;
    this._currentDuck = 1;
  }
  _teardown() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    try { this.input.disconnect(); } catch {}
    try { this.bypass.disconnect(); } catch {}
    if (this._nativeComp) { try { this._nativeComp.disconnect(); } catch {} this._nativeComp = null; }
    if (this._duckGain)   { try { this._duckGain.disconnect();   } catch {} this._duckGain = null; }
    if (this._analyser && this._sideSource) {
      try { this._sideSource.disconnect(this._analyser); } catch {}
    }
    if (this._analyser) { try { this._analyser.disconnect(); } catch {} this._analyser = null; }
    this._sideSource = null;
  }
  configure({ enabled, sourceNode, threshold, ratio, attack, release, knee }) {
    if (threshold != null) this.config.threshold = threshold;
    if (ratio != null)     this.config.ratio = ratio;
    if (attack != null)    this.config.attack = attack;
    if (release != null)   this.config.release = release;
    if (knee != null)      this.config.knee = knee;
    this._teardown();
    this.input = this.input;   // preserve reference (recreate connections below)
    if (!enabled) {
      // straight passthrough: input → output
      this.bypass = this.ctx.createGain();
      this.input.connect(this.bypass);
      this.bypass.connect(this.output);
      this._mode = "off";
      return;
    }
    if (!sourceNode) {
      // self-compression with native node
      const c = this.ctx.createDynamicsCompressor();
      c.threshold.value = this.config.threshold ?? -20;
      c.ratio.value     = this.config.ratio ?? 4;
      c.attack.value    = this.config.attack ?? 0.01;
      c.release.value   = this.config.release ?? 0.2;
      c.knee.value      = this.config.knee ?? 6;
      this.input.connect(c);
      c.connect(this.output);
      this._nativeComp = c;
      this._mode = "self";
      return;
    }
    // external sidechain: tap source audio into analyser, run envelope follower,
    // apply gain reduction to a ducking gain on our signal path.
    const a = this.ctx.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.0;
    try { sourceNode.connect(a); } catch {}
    this._analyser = a;
    this._sideSource = sourceNode;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    this.input.connect(g);
    g.connect(this.output);
    this._duckGain = g;
    this._mode = "sidechain";
    this._tickSidechain();
  }
  _tickSidechain = () => {
    if (!this._analyser || !this._duckGain) return;
    const buf = new Float32Array(this._analyser.fftSize);
    this._analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    const thr = this.config.threshold ?? -20;
    const ratio = Math.max(1, this.config.ratio ?? 4);
    const over = db - thr;
    const reducedDb = over > 0 ? over - over / ratio : 0;
    const target = Math.pow(10, -reducedDb / 20);
    const tc = target < this._currentDuck
      ? Math.max(0.001, this.config.attack ?? 0.01)
      : Math.max(0.01, this.config.release ?? 0.2);
    try { this._duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, tc); } catch {}
    this._currentDuck = target;
    this._rafId = requestAnimationFrame(this._tickSidechain);
  };
  dispose() {
    this._teardown();
    try { this.output.disconnect(); } catch {}
  }
}

function defaultCompConfig() {
  return { enabled: false, source: "self", threshold: -20, ratio: 4, attack: 0.01, release: 0.2, knee: 6 };
}

function ensureCompressor(t) {
  if (!state.audioCtx || t.compNode) return;
  t.compNode = new TrackCompressor(state.audioCtx, t.comp);
  applyCompressorConfig(t);
}

function applyCompressorConfig(t) {
  if (!t.compNode) return;
  let sourceNode = null;
  if (t.comp.enabled && t.comp.source && t.comp.source !== "self") {
    const src = state.tracks.find(x => String(x.id) === String(t.comp.source));
    if (src?.voice?.getOutputNode) sourceNode = src.voice.getOutputNode();
  }
  t.compNode.configure({
    enabled: t.comp.enabled,
    sourceNode,
    threshold: t.comp.threshold,
    ratio: t.comp.ratio,
    attack: t.comp.attack,
    release: t.comp.release,
    knee: t.comp.knee,
  });
}

function setEQ(t, band, db) {
  t.eq[band] = db;
  if (t.eqNode) t.eqNode.setBand(band, db);
}

function routeVoiceToRack(t) {
  if (!t.voice || !t.fxRack) return;
  ensureFilter(t);
  ensureEQ(t);
  ensureCompressor(t);
  const dest = t.fxRack.input;
  const eqIn    = t.eqNode?.input;
  const eqOut   = t.eqNode?.output;
  const compIn  = t.compNode?.input;
  const compOut = t.compNode?.output;
  // clear existing wiring
  if (t.filterNode) try { t.filterNode.disconnect(); } catch {}
  if (eqOut)        try { eqOut.disconnect(); } catch {}
  if (compOut)      try { compOut.disconnect(); } catch {}
  // build chain: voice → filter? → eq? → comp? → fxRack.input
  const nodes = [];
  if (t.filterNode) nodes.push({ in: t.filterNode, out: t.filterNode });
  if (t.eqNode)     nodes.push({ in: eqIn, out: eqOut });
  if (t.compNode)   nodes.push({ in: compIn, out: compOut });
  for (let i = 0; i < nodes.length - 1; i++) {
    try { nodes[i].out.connect(nodes[i + 1].in); } catch {}
  }
  const last = nodes[nodes.length - 1];
  if (last) {
    try { last.out.connect(dest); } catch {}
  }
  const firstIn = nodes[0]?.in || dest;
  if (t.voice.setDestination) t.voice.setDestination(firstIn);
}

function fireFilterEnv(t, time, duration) {
  const f = t.filterNode;
  if (!f) return;
  const base = Math.max(40, cutoffToHz(t.filter.cutoff));   // user-set cutoff is the OPEN point
  f.Q.value = resonToQ(t.filter.reson);
  const env = t.filter.env;
  if (env <= 0.001) {
    f.frequency.cancelScheduledValues(time);
    f.frequency.setValueAtTime(base, time);
    return;
  }
  // env closes the filter down from base; at env=1 that's -6 octaves below cutoff
  const closed = Math.max(40, base * Math.pow(0.5, env * 6));
  // sustain level = linear (log-space) interpolation between closed and base
  const susLevel = Math.max(40, Math.min(20000,
    closed * Math.pow(base / closed, Math.max(0, Math.min(1, t.filter.sustain)))
  ));
  const atk = 0.001 + t.filter.attack * 0.5;     // 1ms – 500ms
  const dec = 0.005 + t.filter.decay   * 0.8;    // 5ms – 800ms
  const rel = 0.01  + t.filter.release * 2;      // 10ms – 2s
  const atkEnd = time + atk;
  const decEnd = atkEnd + dec;
  const sustainEnd = Math.max(decEnd + 0.005, time + Math.max(0.05, duration));
  const relEnd = sustainEnd + rel;
  f.frequency.cancelScheduledValues(time);
  f.frequency.setValueAtTime(closed, time);
  f.frequency.exponentialRampToValueAtTime(base, atkEnd);
  f.frequency.exponentialRampToValueAtTime(susLevel, decEnd);
  f.frequency.setValueAtTime(susLevel, sustainEnd);
  f.frequency.exponentialRampToValueAtTime(closed, relEnd);
}

function setFilter(t, key, val) {
  t.filter[key] = val;
  if (!t.filterNode) return;
  if (key === "cutoff") {
    // bump base between hits; active envelope automation will continue until next hit schedules new values
    t.filterNode.frequency.cancelScheduledValues(state.audioCtx.currentTime);
    t.filterNode.frequency.setValueAtTime(cutoffToHz(val), state.audioCtx.currentTime);
  }
  if (key === "reson") t.filterNode.Q.value = resonToQ(val);
}

// Resize just one pattern's step arrays. Each pattern can have an independent
// length. `t.length` mirrors the currently-aliased pattern's length so the rest
// of the codebase stays aware of "current pattern's steps" via t.length.
function resizePattern(t, patIdx, len) {
  len = Math.max(1, Math.min(128, len | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const pad = (arr, fill) => new Array(len).fill(fill).map((_, i) => arr?.[i] ?? fill);
  p.steps       = pad(p.steps, 0);
  p.lengths     = pad(p.lengths, 0);
  p.notes       = pad(p.notes, null);
  p.velocities  = pad(p.velocities, 0.5);
  p.chords      = pad(p.chords, "");
  p.offsets     = pad(p.offsets, 0);
  p.arps        = pad(p.arps, false);
  p.arpRates    = pad(p.arpRates, 0.25);
  p.arpRanges   = pad(p.arpRanges, 1);
  p.arpDirs     = pad(p.arpDirs, "up");
  p.complexities= pad(p.complexities, 0);
  p.ratchets    = pad(p.ratchets, 1);
  p.sampleStarts    = pad(p.sampleStarts, 0);
  p.sampleEnds      = pad(p.sampleEnds, 1);
  p.sampleFadeIns   = pad(p.sampleFadeIns, 0);
  p.sampleFadeOuts  = pad(p.sampleFadeOuts, 0);
  p.sampleLoopModes = pad(p.sampleLoopModes, "off");
  // Resize automation lanes to match new pattern length.
  if (p.automation) {
    for (const key in p.automation) {
      const lane = p.automation[key];
      if (lane && Array.isArray(lane.values)) {
        lane.values = pad(lane.values, 0.5);
      }
    }
  }
  for (let i = 0; i < len; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, len - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = len;
    t.accents = autoAccents(len, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".track-len").value = len;
    renderStepGrid(t);
    refreshAutIfOpen(t);
  }
  renderPatternGrid();
}

// resizeTrack now resizes only the active pattern (per-pattern lengths).
function resizeTrack(t, len) {
  resizePattern(t, t._patternIdx ?? state.activePattern, len);
}

// Shrink a pattern by slicing every per-step array down to `newLen`. Notes
// that started before newLen but extended past it get clamped. Mirror of
// extendPatternByDuplicate. Clamps to [1, 128].
function truncatePattern(t, patIdx, newLen) {
  newLen = Math.max(1, Math.min(128, newLen | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const oldLen = p.steps.length;
  if (newLen >= oldLen) return;
  const KEYS = [
    "steps","lengths","notes","velocities","chords","offsets",
    "arps","arpRates","arpRanges","arpDirs","complexities","ratchets",
    "sampleStarts","sampleEnds","sampleFadeIns","sampleFadeOuts","sampleLoopModes",
  ];
  for (const k of KEYS) if (Array.isArray(p[k])) p[k] = p[k].slice(0, newLen);
  if (p.automation) {
    for (const lane of Object.values(p.automation)) {
      if (lane && Array.isArray(lane.values)) lane.values = lane.values.slice(0, newLen);
    }
  }
  for (let i = 0; i < newLen; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, newLen - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = newLen;
    t.accents = autoAccents(newLen, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".track-len").value = newLen;
    renderStepGrid(t);
    refreshAutIfOpen(t);
    refreshRollIfOpen(t);
  }
  renderPatternGrid();
}

// Extend a pattern's length while duplicating existing content into the new
// space. Two source modes:
//   "tile"    — `i % oldLen` wraps from index 0; right for x2 / x4 where the
//               whole pattern should repeat as a loop.
//   "lastBar" — the new region copies the LAST `barLen` steps of the old
//               pattern; right for +1 where the user wants another copy of
//               "what just played" rather than the start.
// Clamps to [1, 128].
function extendPatternByDuplicate(t, patIdx, newLen, opts = {}) {
  const sourceMode = opts.sourceMode === "lastBar" ? "lastBar" : "tile";
  const barLen = Math.max(1, opts.barLen | 0 || stepsPerBarForMeter(patternMeter(patIdx)));
  newLen = Math.max(1, Math.min(128, newLen | 0));
  const p = t.patterns[patIdx];
  if (!p) return;
  const oldLen = p.steps.length;
  if (newLen <= oldLen) return;
  const FILL = {
    steps: 0, lengths: 0, notes: null, velocities: 0.5, chords: "",
    offsets: 0, arps: false, arpRates: 0.25, arpRanges: 1, arpDirs: "up",
    complexities: 0, ratchets: 1,
    sampleStarts: 0, sampleEnds: 1, sampleFadeIns: 0, sampleFadeOuts: 0,
    sampleLoopModes: "off",
  };
  // For "lastBar" mode the source window starts `barLen` steps before the
  // boundary. Falls back to "tile" if there isn't a full bar to copy.
  const lastBarStart = Math.max(0, oldLen - Math.min(barLen, oldLen));
  const sourceLen    = Math.min(barLen, oldLen);
  const srcFor = (i) => {
    if (i < oldLen) return i;
    if (sourceMode === "lastBar" && sourceLen > 0) {
      return lastBarStart + ((i - oldLen) % sourceLen);
    }
    return i % oldLen;
  };
  for (const [key, fill] of Object.entries(FILL)) {
    const arr = p[key];
    if (!Array.isArray(arr)) continue;
    const next = new Array(newLen);
    for (let i = 0; i < newLen; i++) {
      next[i] = arr[srcFor(i)] ?? fill;
    }
    p[key] = next;
  }
  if (p.automation) {
    for (const lane of Object.values(p.automation)) {
      if (!lane || !Array.isArray(lane.values)) continue;
      const next = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        next[i] = lane.values[srcFor(i)] ?? 0.5;
      }
      lane.values = next;
    }
  }
  for (let i = 0; i < newLen; i++) {
    if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, newLen - i));
  }
  if ((t._patternIdx ?? state.activePattern) === patIdx) {
    aliasPattern(t, patIdx);
    t.length = newLen;
    t.accents = autoAccents(newLen, patternMeter(patIdx));
    if (t.el) t.el.querySelector(".track-len").value = newLen;
    renderStepGrid(t);
    refreshAutIfOpen(t);
    refreshRollIfOpen(t);
  }
  renderPatternGrid();
}


function resizeAllTracks() {
  const len = totalSteps();
  state.tracks.forEach(t => resizeTrack(t, len));
}

function clearRange(t, from, to, keep) {
  for (let i = Math.max(0, from); i <= Math.min(t.steps.length - 1, to); i++) {
    if (!t.steps[i] || i === keep) continue;
    t.steps[i] = 0;
    t.lengths[i] = 0;
    t.notes[i] = null;
    t.velocities[i] = 0.5;
    t.chords[i] = "";
  }
}

function maxLengthAt(t, anchor) {
  const total = t.steps.length;
  const ROW = 16;
  const rowEnd = Math.min(total, (Math.floor(anchor / ROW) + 1) * ROW);
  let cap = rowEnd - anchor;
  for (let j = anchor + 1; j < rowEnd; j++) {
    if (t.steps[j]) { cap = Math.min(cap, j - anchor); break; }
  }
  return Math.max(1, cap);
}

function anchorCovering(t, idx) {
  for (let i = idx; i >= 0; i--) {
    if (t.steps[i]) {
      const len = Math.max(1, t.lengths[i] || 1);
      if (i + len > idx) return i;
      return -1;
    }
  }
  return -1;
}

// What pitch should a fresh note take? Prefer the last note the user
// explicitly placed or moved on this track; fall back to the highest-index
// existing triggered note in the active pattern; finally, scale root in
// octave 3 for empty patterns. Drum-kit tracks always return C2 (their
// per-step pitch is decoupled from key).
function lastUsedNote(t) {
  if (t.isDrumKit) return 36;
  if (t.lastEditedNote != null && Number.isFinite(t.lastEditedNote)) return t.lastEditedNote;
  if (t.steps && t.notes) {
    for (let i = t.length - 1; i >= 0; i--) {
      if (t.steps[i] && t.notes[i] != null) return t.notes[i];
    }
  }
  return 48 + (state.scale.root | 0);
}

function startNote(t, anchor) {
  clearRange(t, anchor, anchor, -1);
  t.steps[anchor] = 1;
  t.lengths[anchor] = 1;
  if (t.notes[anchor] == null) {
    // Drum-kit tracks pin to C2; melodic tracks default to whatever pitch the
    // user last placed/moved, so adding several steps in a row keeps them on
    // the same note unless they explicitly drag to change it.
    t.notes[anchor] = lastUsedNote(t);
    if (!t.isDrumKit) t.lastEditedNote = t.notes[anchor];
  }
  applySampleDefaultsToStep(t, anchor);
}

// Shift every step's note on every pattern by `semis` semitones (±12 for
// octaves). Clamps to MIDI 24..95. Works for any track, including drum kits.
// Redraws the active pattern's grid.
function shiftTrackOctave(t, semis) {
  let touched = 0;
  for (const p of t.patterns) {
    if (!p) continue;
    for (let i = 0; i < p.notes.length; i++) {
      const n = p.notes[i];
      if (n == null) continue;
      const next = Math.max(24, Math.min(95, n + semis));
      if (next !== n) { p.notes[i] = next; touched++; }
    }
  }
  renderStepGrid(t);
  if (touched) setStatus(`"${t.name}" shifted ${semis > 0 ? "+" : "−"}1 octave (${touched} note${touched === 1 ? "" : "s"})`);
}

// Seed a step's sample-settings (start/end/fades/loop) from the track default.
function applySampleDefaultsToStep(t, idx) {
  const d = t.sampleDefaults;
  if (!d) return;
  if (!t.sampleStarts) t.sampleStarts = new Array(t.length).fill(0);
  if (!t.sampleEnds)   t.sampleEnds   = new Array(t.length).fill(1);
  if (!t.sampleFadeIns)  t.sampleFadeIns  = new Array(t.length).fill(0);
  if (!t.sampleFadeOuts) t.sampleFadeOuts = new Array(t.length).fill(0);
  if (!t.sampleLoopModes) t.sampleLoopModes = new Array(t.length).fill("off");
  t.sampleStarts[idx]   = d.start ?? 0;
  t.sampleEnds[idx]     = d.end ?? 1;
  t.sampleFadeIns[idx]  = d.fadeIn ?? 0;
  t.sampleFadeOuts[idx] = d.fadeOut ?? 0;
  t.sampleLoopModes[idx] = d.loopMode || "off";
}

// Overwrite every active step's sample settings across every pattern on the track.
function applySampleSettingsToAllSteps(t, settings) {
  const { start, end, fadeIn, fadeOut, loopMode } = settings;
  for (const p of t.patterns) {
    if (!p) continue;
    const n = p.steps.length;
    if (!p.sampleStarts)    p.sampleStarts    = new Array(n).fill(0);
    if (!p.sampleEnds)      p.sampleEnds      = new Array(n).fill(1);
    if (!p.sampleFadeIns)   p.sampleFadeIns   = new Array(n).fill(0);
    if (!p.sampleFadeOuts)  p.sampleFadeOuts  = new Array(n).fill(0);
    if (!p.sampleLoopModes) p.sampleLoopModes = new Array(n).fill("off");
    for (let i = 0; i < n; i++) {
      if (!p.steps[i]) continue;
      p.sampleStarts[i]   = start;
      p.sampleEnds[i]     = end;
      p.sampleFadeIns[i]  = fadeIn;
      p.sampleFadeOuts[i] = fadeOut;
      p.sampleLoopModes[i] = loopMode;
    }
  }
}

function extendNote(t, anchor, toIdx) {
  if (toIdx < anchor) toIdx = anchor;
  const desired = toIdx - anchor + 1;
  clearRange(t, anchor + 1, anchor + desired - 1, anchor);
  const cap = maxLengthAt(t, anchor);
  t.lengths[anchor] = Math.min(desired, cap);
}

function removeNote(t, anchor) {
  t.steps[anchor] = 0;
  t.lengths[anchor] = 0;
  t.notes[anchor] = null;
  t.velocities[anchor] = 0.5;
  t.chords[anchor] = "";
}

// ---- rendering ---------------------------------------------------------

function renderTrack(t) {
  const tpl = document.getElementById("track-template");
  const node = tpl.content.firstElementChild.cloneNode(true);
  t.el = node;
  node.dataset.trackId = String(t.id);

  const engineSel = node.querySelector(".track-engine");
  populateEngineSelect(engineSel);
  engineSel.value = t.engineKey;

  node.querySelector(".track-name").value = t.name;
  node.querySelector(".track-len").value = t.length;
  node.querySelector(".p-vol").value = t.params.vol;
  node.querySelector(".p-harm").value = t.params.harm;
  node.querySelector(".p-timb").value = t.params.timb;
  node.querySelector(".p-morph").value = t.params.morph;
  node.querySelector(".p-decay").value = t.params.decay;
  for (const k of ["osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal",
                   "osc1range", "osc2range", "osc3range",
                   "osc1wave",  "osc2wave",  "osc3wave",
                   "osc2freq",  "osc3freq",  "noise", "noisetype"]) {
    const el = node.querySelector(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
  node.querySelector(".p-cutoff").value = t.filter.cutoff;
  node.querySelector(".p-reson").value  = t.filter.reson;
  node.querySelector(".p-envamt").value = t.filter.env;
  node.querySelector(".p-envatk").value = t.filter.attack;
  node.querySelector(".p-envrel").value = t.filter.release;

  node.querySelector(".track-name").addEventListener("input", e => {
    t.name = e.target.value;
    redetectDrumKit(t);
  });
  node.querySelector(".track-len").addEventListener("change", e => {
    const n = Math.max(1, Math.min(128, Number(e.target.value) || 1));
    resizeTrack(t, n);
  });
  engineSel.addEventListener("change", e => {
    const val = e.target.value;
    if (val === "upload") {
      // intercept — open file picker; only commit the engine change if a file is chosen
      const prev = t.engineKey;
      pickAudioFileForTrack(t).then(ok => {
        if (!ok) engineSel.value = prev;
      });
      return;
    }
    setEngineKey(t, val);
  });

  node.querySelector(".p-vol").addEventListener("input", e => setParam(t, "vol", Number(e.target.value)));
  node.querySelector(".p-harm").addEventListener("input", e => setParam(t, "harm", Number(e.target.value)));
  node.querySelector(".p-timb").addEventListener("input", e => setParam(t, "timb", Number(e.target.value)));
  node.querySelector(".p-morph").addEventListener("input", e => setParam(t, "morph", Number(e.target.value)));
  node.querySelector(".p-decay").addEventListener("input", e => setParam(t, "decay", Number(e.target.value)));
  for (const k of ["osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal",
                   "osc2freq", "osc3freq", "noise"]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of ["osc1range", "osc2range", "osc3range"]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of ["osc1wave", "osc2wave", "osc3wave", "noisetype"]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, e.target.value));
  }
  node.querySelector(".p-cutoff").addEventListener("input", e => setFilter(t, "cutoff", Number(e.target.value)));
  node.querySelector(".p-reson").addEventListener("input",  e => setFilter(t, "reson",  Number(e.target.value)));
  node.querySelector(".p-envamt").addEventListener("input", e => setFilter(t, "env",     Number(e.target.value)));
  node.querySelector(".p-envatk").addEventListener("input", e => setFilter(t, "attack",  Number(e.target.value)));
  node.querySelector(".p-envrel").addEventListener("input", e => setFilter(t, "release", Number(e.target.value)));

  node.querySelector(".track-rand").addEventListener("click", () => randomizeTimbre(t));

  const saveBtn = node.querySelector(".track-save");
  saveBtn.innerHTML = ICON_SAVE;
  const refreshSaveEnabled = () => {
    saveBtn.disabled = !t.customConfig || (t.engineKey !== "custom" && !t.engineKey.startsWith("saved:"));
  };
  refreshSaveEnabled();
  saveBtn.addEventListener("click", async () => {
    if (!t.customConfig) return;
    const suggested = t.soundPromptText ? t.soundPromptText.split(/[.,;]/)[0].slice(0, 40) : t.name;
    const name = await showInputDialog({
      title: "save patch as",
      defaultValue: suggested,
      placeholder: "my-patch-name",
    });
    if (!name || !name.trim()) return;
    savePatch(name.trim(), t.customConfig);
    setStatus(`saved patch "${name.trim()}"`);
  });

  const loadPatchBtn = node.querySelector(".track-load-patch");
  if (loadPatchBtn) {
    loadPatchBtn.innerHTML = ICON_LOAD;
    loadPatchBtn.addEventListener("click", async () => {
      const name = await showSavedPatchPicker();
      if (!name) return;
      setEngineKey(t, `saved:${name}`);
      if (node.querySelector(".track-engine")) node.querySelector(".track-engine").value = `saved:${name}`;
      setStatus(`loaded patch "${name}"`);
    });
  }
  // glide + swing are wired in renderModPanel (they live in the mod panel row now).
  const speedSel = node.querySelector(".track-speed");
  if (speedSel) {
    speedSel.value = String(t.speed ?? 1);
    speedSel.addEventListener("change", e => {
      t.speed = Number(e.target.value) || 1;
      t.speedAccum = 0;
    });
  }
  // density slider is rendered inside the mod panel alongside glide + swing

  const lockInstBtn = node.querySelector(".track-lock-inst");
  const lockPatBtn  = node.querySelector(".track-lock-pat");
  const refreshLockUI = () => {
    lockInstBtn.setAttribute("aria-pressed", String(t.lockInstrument));
    lockPatBtn.setAttribute("aria-pressed", String(t.lockPattern));
    lockInstBtn.innerHTML = t.lockInstrument ? ICON_LOCKED : ICON_UNLOCKED;
    lockPatBtn.innerHTML  = t.lockPattern    ? ICON_LOCKED : ICON_UNLOCKED;
    node.classList.toggle("lock-instrument", t.lockInstrument);
    node.classList.toggle("lock-pattern", t.lockPattern);
  };
  refreshLockUI();
  lockInstBtn.addEventListener("click", () => { t.lockInstrument = !t.lockInstrument; refreshLockUI(); });
  lockPatBtn.addEventListener("click",  () => { t.lockPattern    = !t.lockPattern;    refreshLockUI(); });

  const octDownBtn = node.querySelector(".track-oct-down");
  const octUpBtn   = node.querySelector(".track-oct-up");
  if (octDownBtn) octDownBtn.addEventListener("click", () => shiftTrackOctave(t, -12));
  if (octUpBtn)   octUpBtn.addEventListener("click",   () => shiftTrackOctave(t, +12));
  const semiDownBtn = node.querySelector(".track-semi-down");
  const semiUpBtn   = node.querySelector(".track-semi-up");
  if (semiDownBtn) semiDownBtn.addEventListener("click", () => shiftTrackOctave(t, -1));
  if (semiUpBtn)   semiUpBtn.addEventListener("click",   () => shiftTrackOctave(t, +1));

  node.querySelector(".track-len-plus1")?.addEventListener("click", () => {
    const spb = stepsPerBarForMeter(patternMeter(state.activePattern));
    resizePattern(t, state.activePattern, t.length + spb);
  });
  node.querySelector(".track-len-2x")?.addEventListener("click", () => {
    extendPatternByDuplicate(t, state.activePattern, t.length * 2);
  });
  node.querySelector(".track-len-4x")?.addEventListener("click", () => {
    extendPatternByDuplicate(t, state.activePattern, t.length * 4);
  });
  node.querySelector(".track-len-half")?.addEventListener("click", () => {
    truncatePattern(t, state.activePattern, Math.max(1, Math.floor(t.length / 2)));
  });
  node.querySelector(".track-len-quarter")?.addEventListener("click", () => {
    truncatePattern(t, state.activePattern, Math.max(1, Math.floor(t.length / 4)));
  });

  const soloBtn = node.querySelector(".track-solo");
  soloBtn.addEventListener("click", () => {
    t.soloed = !t.soloed;
    soloBtn.setAttribute("aria-pressed", String(t.soloed));
    node.classList.toggle("soloed", t.soloed);
  });

  engineSel.addEventListener("change", () => refreshSaveEnabled());
  // also update save button when customConfig is assigned later — keep a ref on track
  t._refreshSaveEnabled = refreshSaveEnabled;

  const panelPairs = [
    { btnSel: ".track-mod",    panelSel: ".track-mod-panel" },
    { btnSel: ".track-aut",    panelSel: ".track-aut-panel" },
    { btnSel: ".track-roll",   panelSel: ".track-roll-panel" },
    { btnSel: ".track-filter", panelSel: ".track-filter-panel" },
    { btnSel: ".track-env",    panelSel: ".track-env-panel" },
    { btnSel: ".track-fx",     panelSel: ".track-fx-panel" },
    { btnSel: ".track-eq",     panelSel: ".track-eq-panel" },
    { btnSel: ".track-comp",   panelSel: ".track-comp-panel" },
  ];
  function closeOtherPanels(keepBtnSel) {
    for (const p of panelPairs) {
      if (p.btnSel === keepBtnSel) continue;
      const b = node.querySelector(p.btnSel);
      const pn = node.querySelector(p.panelSel);
      if (b && pn) { pn.hidden = true; b.setAttribute("aria-pressed", "false"); }
    }
  }
  function bindPanelToggle(btnSel, panelSel, onOpen) {
    const btn = node.querySelector(btnSel);
    const panel = node.querySelector(panelSel);
    btn.addEventListener("click", () => {
      const willOpen = panel.hidden;
      if (willOpen) closeOtherPanels(btnSel);
      panel.hidden = !willOpen;
      btn.setAttribute("aria-pressed", String(willOpen));
      if (willOpen && onOpen) onOpen();
    });
  }

  renderModPanel(t, node.querySelector(".track-mod-panel"));
  wireFxPanel(t, node.querySelector(".track-fx-panel"));
  const eqPanel = node.querySelector(".track-eq-panel");
  eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
  eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
  eqPanel.querySelector(".p-eq-high").value = t.eq.high;
  eqPanel.querySelector(".p-eq-low").addEventListener("input",  e => setEQ(t, "low",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-mid").addEventListener("input",  e => setEQ(t, "mid",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-high").addEventListener("input", e => setEQ(t, "high", Number(e.target.value)));
  bindPanelToggle(".track-mod",    ".track-mod-panel");
  bindPanelToggle(".track-aut",    ".track-aut-panel",
    () => renderAutomationPanel(t, node.querySelector(".track-aut-panel")));
  bindPanelToggle(".track-roll",   ".track-roll-panel", () => {
    // Re-center the roll on whichever 2-octave window holds the most notes
    // from the active pattern. Skip if the pattern is empty so a user who
    // paged oct +/- on an empty track keeps their position.
    if (t.steps.some(s => s)) t.rollViewOct = bestRollViewOct(t);
    renderRollPanel(t, node.querySelector(".track-roll-panel"));
  });
  bindPanelToggle(".track-filter", ".track-filter-panel");
  bindPanelToggle(".track-env",    ".track-env-panel");
  bindPanelToggle(".track-fx",     ".track-fx-panel");
  bindPanelToggle(".track-eq",     ".track-eq-panel");
  bindPanelToggle(".track-comp",   ".track-comp-panel");
  wireCompPanel(t, node.querySelector(".track-comp-panel"));

  node.querySelector(".track-mute").addEventListener("click", () => {
    t.muted = !t.muted;
    node.classList.toggle("muted", t.muted);
  });
  node.querySelector(".track-clear").addEventListener("click", () => {
    t.steps.fill(0);
    t.lengths.fill(0);
    t.notes.fill(null);
    t.velocities.fill(0.5);
    t.chords.fill("");
    renderStepGrid(t);
  });
  node.querySelector(".track-remove").addEventListener("click", () => removeTrack(t));
  const dupBtn = node.querySelector(".track-dup");
  if (dupBtn) dupBtn.addEventListener("click", () => duplicateTrack(t));

  // midi-specific controls
  const midiSel = node.querySelector(".midi-out");
  const midiCh = node.querySelector(".midi-ch");
  midiSel.addEventListener("change", () => {
    t.midi.outputId = midiSel.value;
    if (t.voice?.type === "midi") {
      const out = state.midi?.outputs.get(midiSel.value) || null;
      t.voice.setOutput(out);
    }
  });
  midiCh.addEventListener("change", () => {
    const ch = Math.max(1, Math.min(16, Number(midiCh.value) || 1));
    midiCh.value = ch;
    t.midi.channel = ch;
    if (t.voice?.type === "midi") t.voice.setChannel(ch);
  });

  attachGridInteraction(t, node.querySelector(".steps"));
  renderStepGrid(t);
  document.getElementById("tracks").appendChild(node);
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
}

function updateMidiUI(t) {
  const row = t.el?.querySelector(".track-midi");
  if (!row) return;
  const isMidi = engineByKey(t.engineKey)?.type === "midi";
  row.hidden = !isMidi;
  if (!isMidi) return;
  const sel = row.querySelector(".midi-out");
  const cur = t.midi.outputId || "";
  sel.replaceChildren();
  const none = document.createElement("option");
  none.value = ""; none.textContent = "— no device —";
  sel.appendChild(none);
  if (state.midi) {
    for (const [id, out] of state.midi.outputs) {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = out.name || id;
      sel.appendChild(opt);
    }
  }
  sel.value = cur;
  row.querySelector(".midi-ch").value = t.midi.channel;
}

function refreshCompSourceDropdowns() {
  for (const t of state.tracks) {
    const sel = t.el?.querySelector(".comp-source");
    if (!sel) continue;
    const cur = t.comp.source || "self";
    sel.replaceChildren();
    const optSelf = document.createElement("option");
    optSelf.value = "self"; optSelf.textContent = "self";
    sel.appendChild(optSelf);
    for (const other of state.tracks) {
      if (other === t) continue;
      const opt = document.createElement("option");
      opt.value = String(other.id);
      opt.textContent = other.name || `track ${other.id}`;
      sel.appendChild(opt);
    }
    sel.value = cur;
  }
}

function wireCompPanel(t, panel) {
  const q = s => panel.querySelector(s);
  const en = q(".comp-enabled");
  const src = q(".comp-source");
  const thr = q(".comp-threshold");
  const ratio = q(".comp-ratio");
  const atk = q(".comp-attack");
  const rel = q(".comp-release");
  const knee = q(".comp-knee");
  en.checked = !!t.comp.enabled;
  thr.value = t.comp.threshold;
  ratio.value = t.comp.ratio;
  atk.value = t.comp.attack;
  rel.value = t.comp.release;
  knee.value = t.comp.knee;
  const apply = () => {
    t.comp.enabled   = en.checked;
    t.comp.source    = src.value || "self";
    t.comp.threshold = Number(thr.value);
    t.comp.ratio     = Number(ratio.value);
    t.comp.attack    = Number(atk.value);
    t.comp.release   = Number(rel.value);
    t.comp.knee      = Number(knee.value);
    applyCompressorConfig(t);
  };
  en.addEventListener("change", apply);
  src.addEventListener("change", apply);
  for (const c of [thr, ratio, atk, rel, knee]) c.addEventListener("input", apply);
}

function applyFxToTrack(t, fx) {
  if (!fx || typeof fx !== "object") return;
  const cfg = t.fxConfig;
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  const readUnit = (group, keys) => {
    if (!fx[group] || typeof fx[group] !== "object") return;
    for (const k of keys) {
      const v = Number(fx[group][k]);
      if (Number.isFinite(v)) cfg[group][k] = Math.max(0, Math.min(1, v));
    }
  };
  readUnit("vinyl",    ["amount","warmth","wow"]);
  readUnit("cassette", ["amount","flutter","sat"]);
  readUnit("fuzz",     ["amount","drive","tone","level"]);
  readUnit("ringmod",  ["wet","freq"]);
  readUnit("autowah",  ["wet","sens","range"]);
  readUnit("chorus",   ["wet","rate","depth"]);
  readUnit("phaser",   ["wet","rate","depth"]);
  readUnit("flanger",  ["wet","rate","fbk"]);
  if (fx.pitchshift && typeof fx.pitchshift === "object") {
    const w = Number(fx.pitchshift.wet);       if (Number.isFinite(w)) cfg.pitchshift.wet       = Math.max(0, Math.min(1, w));
    const s = Number(fx.pitchshift.semitones); if (Number.isFinite(s)) cfg.pitchshift.semitones = Math.max(-24, Math.min(24, Math.round(s)));
  }
  if (fx.delay && typeof fx.delay === "object") {
    if (typeof fx.delay.sync === "boolean") cfg.delay.sync = fx.delay.sync;
    const div = Number(fx.delay.div);  if (Number.isFinite(div)) cfg.delay.div  = div;
    const time = Number(fx.delay.time);if (Number.isFinite(time)) cfg.delay.time = Math.max(0.02, Math.min(2, time));
    const fbk = Number(fx.delay.fbk);  if (Number.isFinite(fbk))  cfg.delay.fbk  = Math.max(0, Math.min(0.95, fbk));
    const wet = Number(fx.delay.wet);  if (Number.isFinite(wet))  cfg.delay.wet  = Math.max(0, Math.min(1, wet));
  }
  if (fx.reverb && typeof fx.reverb === "object") {
    const decay = Number(fx.reverb.decay); if (Number.isFinite(decay)) cfg.reverb.decay = Math.max(0.2, Math.min(10, decay));
    const wet   = Number(fx.reverb.wet);   if (Number.isFinite(wet))   cfg.reverb.wet   = Math.max(0, Math.min(1, wet));
  }
  if (fx.crush && typeof fx.crush === "object") {
    if (!cfg.crush) cfg.crush = { bits: 8, wet: 0 };
    const bits = Number(fx.crush.bits); if (Number.isFinite(bits)) cfg.crush.bits = Math.max(1, Math.min(16, Math.round(bits)));
    const wet  = Number(fx.crush.wet);  if (Number.isFinite(wet))  cfg.crush.wet  = Math.max(0, Math.min(1, wet));
  }
  if (t.fxRack) {
    t.fxRack.applyVinyl(cfg.vinyl);
    t.fxRack.applyCassette(cfg.cassette);
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyRingMod(cfg.ringmod);
    t.fxRack.applyWaveShaper(cfg.shaper || { wet: 0, amount: 0.5 });
    t.fxRack.applyCrush(cfg.crush || { bits: 8, wet: 0 });
    t.fxRack.applyAutoWah(cfg.autowah);
    t.fxRack.applyChorus(cfg.chorus);
    t.fxRack.applyPhaser(cfg.phaser);
    t.fxRack.applyFlanger(cfg.flanger);
    t.fxRack.applyPitchShift(cfg.pitchshift);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
  }
  refreshFxPanelUI(t);
}

function refreshFxPanelUI(t) {
  if (!t.el) return;
  const panel = t.el.querySelector(".track-fx-panel");
  if (!panel) return;
  const cfg = t.fxConfig;
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  if (!cfg.shaper)     cfg.shaper     = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
  if (!cfg.shaper.mode) cfg.shaper.mode = "fold";
  if (cfg.shaper.preamp == null) cfg.shaper.preamp = 0.5;
  const q = s => panel.querySelector(s);
  const set = (sel, v) => { const el = q(sel); if (el != null && v != null) el.value = v; };
  set(".fx-vinyl-amount",    cfg.vinyl.amount);
  set(".fx-vinyl-warmth",    cfg.vinyl.warmth);
  set(".fx-vinyl-wow",       cfg.vinyl.wow);
  set(".fx-cassette-amount", cfg.cassette.amount);
  set(".fx-cassette-flutter",cfg.cassette.flutter);
  set(".fx-cassette-sat",    cfg.cassette.sat);
  q(".fx-fuzz-amount").value = cfg.fuzz.amount;
  q(".fx-fuzz-drive").value  = cfg.fuzz.drive;
  q(".fx-fuzz-tone").value   = cfg.fuzz.tone;
  q(".fx-fuzz-level").value  = cfg.fuzz.level;
  set(".fx-ringmod-wet",      cfg.ringmod.wet);
  set(".fx-ringmod-freq",     cfg.ringmod.freq);
  set(".fx-shaper-wet",       cfg.shaper.wet);
  set(".fx-shaper-preamp",    cfg.shaper.preamp);
  set(".fx-shaper-amt",       cfg.shaper.amount);
  set(".fx-shaper-mode",      cfg.shaper.mode);
  set(".fx-autowah-wet",      cfg.autowah.wet);
  set(".fx-autowah-sens",     cfg.autowah.sens);
  set(".fx-autowah-range",    cfg.autowah.range);
  set(".fx-chorus-wet",       cfg.chorus.wet);
  set(".fx-chorus-rate",      cfg.chorus.rate);
  set(".fx-chorus-depth",     cfg.chorus.depth);
  set(".fx-phaser-wet",       cfg.phaser.wet);
  set(".fx-phaser-rate",      cfg.phaser.rate);
  set(".fx-phaser-depth",     cfg.phaser.depth);
  set(".fx-flanger-wet",      cfg.flanger.wet);
  set(".fx-flanger-rate",     cfg.flanger.rate);
  set(".fx-flanger-fbk",      cfg.flanger.fbk);
  set(".fx-pitchshift-wet",   cfg.pitchshift.wet);
  set(".fx-pitchshift-semi",  cfg.pitchshift.semitones);
  q(".fx-delay-time").value  = cfg.delay.time;
  q(".fx-delay-fbk").value   = cfg.delay.fbk;
  q(".fx-delay-wet").value   = cfg.delay.wet;
  q(".fx-delay-sync").checked = !!cfg.delay.sync;
  q(".fx-delay-div").value   = String(cfg.delay.div);
  q(".fx-reverb-decay").value = cfg.reverb.decay;
  q(".fx-reverb-wet").value   = cfg.reverb.wet;
  if (cfg.crush) {
    const b = q(".fx-crush-bits"); if (b) b.value = cfg.crush.bits;
    const w = q(".fx-crush-wet");  if (w) w.value = cfg.crush.wet;
  }
}

function wireFxPanel(t, panel) {
  const q = (sel) => panel.querySelector(sel);
  const fc = t.fxConfig;
  if (!fc.crush)      fc.crush      = { bits: 8, wet: 0 };
  if (!fc.vinyl)      fc.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!fc.cassette)   fc.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!fc.chorus)     fc.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!fc.ringmod)    fc.ringmod    = { wet: 0, freq: 0.35 };
  if (!fc.autowah)    fc.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!fc.phaser)     fc.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!fc.flanger)    fc.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!fc.pitchshift) fc.pitchshift = { wet: 0, semitones: 0 };
  if (!fc.shaper)     fc.shaper     = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
  if (!fc.shaper.mode) fc.shaper.mode = "fold";
  if (fc.shaper.preamp == null) fc.shaper.preamp = 0.5;
  const set = (sel, v) => { const el = q(sel); if (el != null && v != null) el.value = v; };
  set(".fx-vinyl-amount",    fc.vinyl.amount);
  set(".fx-vinyl-warmth",    fc.vinyl.warmth);
  set(".fx-vinyl-wow",       fc.vinyl.wow);
  set(".fx-cassette-amount", fc.cassette.amount);
  set(".fx-cassette-flutter",fc.cassette.flutter);
  set(".fx-cassette-sat",    fc.cassette.sat);
  q(".fx-fuzz-amount").value = fc.fuzz.amount;
  q(".fx-fuzz-drive").value  = fc.fuzz.drive;
  q(".fx-fuzz-tone").value   = fc.fuzz.tone;
  q(".fx-fuzz-level").value  = fc.fuzz.level;
  set(".fx-ringmod-wet",      fc.ringmod.wet);
  set(".fx-ringmod-freq",     fc.ringmod.freq);
  set(".fx-shaper-wet",       fc.shaper.wet);
  set(".fx-shaper-preamp",    fc.shaper.preamp);
  set(".fx-shaper-amt",       fc.shaper.amount);
  set(".fx-shaper-mode",      fc.shaper.mode);
  set(".fx-autowah-wet",      fc.autowah.wet);
  set(".fx-autowah-sens",     fc.autowah.sens);
  set(".fx-autowah-range",    fc.autowah.range);
  set(".fx-chorus-wet",       fc.chorus.wet);
  set(".fx-chorus-rate",      fc.chorus.rate);
  set(".fx-chorus-depth",     fc.chorus.depth);
  set(".fx-phaser-wet",       fc.phaser.wet);
  set(".fx-phaser-rate",      fc.phaser.rate);
  set(".fx-phaser-depth",     fc.phaser.depth);
  set(".fx-flanger-wet",      fc.flanger.wet);
  set(".fx-flanger-rate",     fc.flanger.rate);
  set(".fx-flanger-fbk",      fc.flanger.fbk);
  set(".fx-pitchshift-wet",   fc.pitchshift.wet);
  set(".fx-pitchshift-semi",  fc.pitchshift.semitones);
  q(".fx-delay-time").value  = fc.delay.time;
  q(".fx-delay-fbk").value   = fc.delay.fbk;
  q(".fx-delay-wet").value   = fc.delay.wet;
  q(".fx-delay-sync").checked = !!fc.delay.sync;
  q(".fx-delay-div").value   = String(fc.delay.div);
  q(".fx-reverb-decay").value = fc.reverb.decay;
  q(".fx-reverb-wet").value   = fc.reverb.wet;
  { const b = q(".fx-crush-bits"); if (b) b.value = fc.crush.bits; }
  { const w = q(".fx-crush-wet");  if (w) w.value = fc.crush.wet; }

  const applyVinyl = () => {
    fc.vinyl.amount = Number(q(".fx-vinyl-amount").value);
    fc.vinyl.warmth = Number(q(".fx-vinyl-warmth").value);
    fc.vinyl.wow    = Number(q(".fx-vinyl-wow").value);
    t.fxRack?.applyVinyl(fc.vinyl);
  };
  const applyCassette = () => {
    fc.cassette.amount  = Number(q(".fx-cassette-amount").value);
    fc.cassette.flutter = Number(q(".fx-cassette-flutter").value);
    fc.cassette.sat     = Number(q(".fx-cassette-sat").value);
    t.fxRack?.applyCassette(fc.cassette);
  };
  const applyFuzz = () => {
    fc.fuzz.amount = Number(q(".fx-fuzz-amount").value);
    fc.fuzz.drive  = Number(q(".fx-fuzz-drive").value);
    fc.fuzz.tone   = Number(q(".fx-fuzz-tone").value);
    fc.fuzz.level  = Number(q(".fx-fuzz-level").value);
    t.fxRack?.applyFuzz(fc.fuzz);
  };
  const applyRingMod = () => {
    fc.ringmod.wet  = Number(q(".fx-ringmod-wet").value);
    fc.ringmod.freq = Number(q(".fx-ringmod-freq").value);
    t.fxRack?.applyRingMod(fc.ringmod);
  };
  const applyWaveShaper = () => {
    fc.shaper.wet    = Number(q(".fx-shaper-wet").value);
    fc.shaper.preamp = Number(q(".fx-shaper-preamp").value);
    fc.shaper.amount = Number(q(".fx-shaper-amt").value);
    const ms = q(".fx-shaper-mode");
    if (ms) fc.shaper.mode = ms.value;
    t.fxRack?.applyWaveShaper(fc.shaper);
  };
  const applyAutoWah = () => {
    fc.autowah.wet   = Number(q(".fx-autowah-wet").value);
    fc.autowah.sens  = Number(q(".fx-autowah-sens").value);
    fc.autowah.range = Number(q(".fx-autowah-range").value);
    t.fxRack?.applyAutoWah(fc.autowah);
  };
  const applyChorus = () => {
    fc.chorus.wet   = Number(q(".fx-chorus-wet").value);
    fc.chorus.rate  = Number(q(".fx-chorus-rate").value);
    fc.chorus.depth = Number(q(".fx-chorus-depth").value);
    t.fxRack?.applyChorus(fc.chorus);
  };
  const applyPhaser = () => {
    fc.phaser.wet   = Number(q(".fx-phaser-wet").value);
    fc.phaser.rate  = Number(q(".fx-phaser-rate").value);
    fc.phaser.depth = Number(q(".fx-phaser-depth").value);
    t.fxRack?.applyPhaser(fc.phaser);
  };
  const applyFlanger = () => {
    fc.flanger.wet  = Number(q(".fx-flanger-wet").value);
    fc.flanger.rate = Number(q(".fx-flanger-rate").value);
    fc.flanger.fbk  = Number(q(".fx-flanger-fbk").value);
    t.fxRack?.applyFlanger(fc.flanger);
  };
  const applyPitchShift = () => {
    fc.pitchshift.wet       = Number(q(".fx-pitchshift-wet").value);
    fc.pitchshift.semitones = Number(q(".fx-pitchshift-semi").value);
    t.fxRack?.applyPitchShift(fc.pitchshift);
  };
  const applyDelay = () => {
    fc.delay.time = Number(q(".fx-delay-time").value);
    fc.delay.fbk  = Number(q(".fx-delay-fbk").value);
    fc.delay.wet  = Number(q(".fx-delay-wet").value);
    fc.delay.sync = !!q(".fx-delay-sync").checked;
    fc.delay.div  = Number(q(".fx-delay-div").value);
    t.fxRack?.applyDelay(fc.delay);
  };
  const applyReverb = () => {
    fc.reverb.decay = Number(q(".fx-reverb-decay").value);
    fc.reverb.wet   = Number(q(".fx-reverb-wet").value);
    t.fxRack?.applyReverb(fc.reverb);
  };

  const applyCrush = () => {
    const b = q(".fx-crush-bits"); const w = q(".fx-crush-wet");
    if (b) fc.crush.bits = Number(b.value);
    if (w) fc.crush.wet  = Number(w.value);
    t.fxRack?.applyCrush(fc.crush);
  };

  ["amount","warmth","wow"].forEach(n => q(`.fx-vinyl-${n}`)?.addEventListener("input", applyVinyl));
  ["amount","flutter","sat"].forEach(n => q(`.fx-cassette-${n}`)?.addEventListener("input", applyCassette));
  ["amount","drive","tone","level"].forEach(n => q(`.fx-fuzz-${n}`).addEventListener("input", applyFuzz));
  ["wet","freq"].forEach(n => q(`.fx-ringmod-${n}`)?.addEventListener("input", applyRingMod));
  ["wet","amt","preamp"].forEach(n => q(`.fx-shaper-${n}`)?.addEventListener("input", applyWaveShaper));
  q(".fx-shaper-mode")?.addEventListener("change", applyWaveShaper);
  ["wet","sens","range"].forEach(n => q(`.fx-autowah-${n}`)?.addEventListener("input", applyAutoWah));
  ["wet","rate","depth"].forEach(n => q(`.fx-chorus-${n}`)?.addEventListener("input", applyChorus));
  ["wet","rate","depth"].forEach(n => q(`.fx-phaser-${n}`)?.addEventListener("input", applyPhaser));
  ["wet","rate","fbk"].forEach(n => q(`.fx-flanger-${n}`)?.addEventListener("input", applyFlanger));
  ["wet","semi"].forEach(n => q(`.fx-pitchshift-${n}`)?.addEventListener("input", applyPitchShift));
  ["time","fbk","wet"].forEach(n => q(`.fx-delay-${n}`).addEventListener("input", applyDelay));
  q(".fx-delay-sync").addEventListener("change", applyDelay);
  q(".fx-delay-div").addEventListener("change", applyDelay);
  q(".fx-reverb-decay").addEventListener("input", applyReverb);
  q(".fx-reverb-wet").addEventListener("input", applyReverb);
  { const b = q(".fx-crush-bits"); if (b) b.addEventListener("input", applyCrush); }
  { const w = q(".fx-crush-wet");  if (w) w.addEventListener("input", applyCrush); }
}

function renderModPanel(t, panel) {
  const tpl = document.getElementById("lfo-row-template");
  panel.replaceChildren();
  // Track-level glide — shared strip at top of mod panel. Swing is master-only now.
  const ctl = document.createElement("div");
  ctl.className = "mod-ctl-row";
  ctl.innerHTML = `
    <label class="mod-ctl"><span>glide</span><input class="track-glide" type="range" min="0" max="0.5" step="0.005" value="${t.glide ?? 0}" /></label>
  `;
  panel.appendChild(ctl);
  ctl.querySelector(".track-glide").addEventListener("input", e => {
    t.glide = Number(e.target.value);
    if (t.voice?.setGlide) t.voice.setGlide(t.glide);
  });

  // Container for the per-param LFO rows (added one at a time via the picker below).
  const rowsContainer = document.createElement("div");
  rowsContainer.className = "mod-rows";
  panel.appendChild(rowsContainer);

  const addRow = (key) => {
    const cfg = t.lfoConfig[key];
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.dataset.key = key;
    row.classList.add("active");
    row.querySelector(".lfo-target").textContent = lfoLabel(key);

    const cb    = row.querySelector(".lfo-on");
    const shape = row.querySelector(".lfo-shape");
    const rate  = row.querySelector(".lfo-rate");
    const rateLbl  = row.querySelector(".lfo-rate-label");
    const depth = row.querySelector(".lfo-depth");
    const depthLbl = row.querySelector(".lfo-depth-label");
    const syncCb = row.querySelector(".lfo-sync");
    const divSel = row.querySelector(".lfo-div");
    const rateField = row.querySelector(".lfo-rate-field");
    const removeBtn = row.querySelector(".lfo-remove");

    cb.checked   = cfg.enabled;
    shape.value  = cfg.type;
    rate.value   = rateToSlider(cfg.rate);
    depth.value  = cfg.depth;
    depthLbl.textContent = cfg.depth.toFixed(2);
    syncCb.checked = cfg.sync;
    divSel.value = String(cfg.div);
    rateField.dataset.mode = cfg.sync ? "sync" : "hz";

    const refreshLbl = () => {
      if (cfg.sync) {
        const opt = divSel.options[divSel.selectedIndex];
        rateLbl.textContent = `${opt ? opt.textContent : cfg.div} · ${rateFromSync(cfg.div).toFixed(2)} hz`;
      } else {
        rateLbl.textContent = `${cfg.rate.toFixed(2)} hz`;
      }
    };
    refreshLbl();

    cb.addEventListener("change", () => { cfg.enabled = cb.checked; row.classList.toggle("active", cfg.enabled); syncLFO(t, key); });
    shape.addEventListener("change", () => { cfg.type = shape.value; syncLFO(t, key); });
    rate.addEventListener("input", () => { cfg.rate = sliderToRate(Number(rate.value)); refreshLbl(); syncLFO(t, key); });
    depth.addEventListener("input", () => { cfg.depth = Number(depth.value); depthLbl.textContent = cfg.depth.toFixed(2); syncLFO(t, key); });
    syncCb.addEventListener("change", () => { cfg.sync = syncCb.checked; rateField.dataset.mode = cfg.sync ? "sync" : "hz"; refreshLbl(); syncLFO(t, key); });
    divSel.addEventListener("change", () => { cfg.div = Number(divSel.value); refreshLbl(); syncLFO(t, key); });
    if (removeBtn) removeBtn.addEventListener("click", () => {
      cfg.enabled = false;
      syncLFO(t, key);
      row.remove();
      refreshAdderOptions();
    });

    rowsContainer.appendChild(row);
  };

  // Picker row: a "+ add" button that expands into a select of the remaining
  // modulation targets; picking one enables the LFO and drops a fresh row in.
  const adder = document.createElement("div");
  adder.className = "mod-add-row";
  adder.innerHTML = `
    <button class="mod-add-btn ghost" type="button">+ add modulation</button>
    <select class="mod-add-select" hidden></select>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".mod-add-btn");
  const addSel = adder.querySelector(".mod-add-select");
  const refreshAdderOptions = () => {
    // Only show mods that actually apply to the current engine.
    const available = LFO_KEYS.filter(k => !t.lfoConfig[k]?.enabled && canModulate(t, k));
    if (available.length === 0) {
      addBtn.disabled = true;
      addSel.hidden = true;
      addBtn.textContent = "(all modulations active)";
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "+ add modulation";
      addSel.innerHTML = available.map(k => `<option value="${k}">${lfoLabel(k)}</option>`).join("");
    }
  };
  addBtn.addEventListener("click", () => {
    refreshAdderOptions();
    if (addBtn.disabled) return;
    addSel.hidden = false;
    addSel.focus();
  });
  addSel.addEventListener("change", () => {
    const key = addSel.value;
    if (!key || !t.lfoConfig[key]) { addSel.hidden = true; return; }
    t.lfoConfig[key].enabled = true;
    syncLFO(t, key);
    addRow(key);
    addSel.hidden = true;
    refreshAdderOptions();
  });

  // Pre-populate rows for any LFO that's already enabled on this track.
  for (const key of LFO_KEYS) {
    if (t.lfoConfig[key]?.enabled) addRow(key);
  }
  refreshAdderOptions();
}

// Render per-step automation lanes for the track's active pattern. Re-run on
// pattern switch so the grids reflect the active pattern's lanes.
function renderAutomationPanel(t, panel) {
  panel.replaceChildren();
  if (!t.automation) t.automation = {};
  const enabledKeys = Object.keys(t.automation).filter(k => AUTOMATION_TARGETS[k]);

  const rows = document.createElement("div");
  rows.className = "aut-rows";
  panel.appendChild(rows);

  const emptyMsg = document.createElement("div");
  emptyMsg.className = "aut-empty";
  emptyMsg.textContent = "no automation — pick a target below to add a lane";
  panel.appendChild(emptyMsg);

  const adder = document.createElement("div");
  adder.className = "aut-add-row";
  adder.innerHTML = `
    <button class="aut-add-btn ghost" type="button">+ add automation</button>
    <select class="aut-add-select" hidden></select>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".aut-add-btn");
  const addSel = adder.querySelector(".aut-add-select");

  const refreshAdder = () => {
    const avail = AUTOMATION_KEYS.filter(k => !t.automation[k] && canAutomate(t, k));
    if (avail.length === 0) {
      addBtn.disabled = true;
      addSel.hidden = true;
      addBtn.textContent = "(all targets automated)";
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "+ add automation";
      addSel.innerHTML = avail.map(k => `<option value="${k}">${AUTOMATION_TARGETS[k].label}</option>`).join("");
    }
    emptyMsg.hidden = Object.keys(t.automation).length > 0;
  };

  const ensureLane = (key) => {
    if (!t.automation[key]) {
      t.automation[key] = { enabled: true, values: new Array(t.length).fill(0.5) };
    }
    // Resize values if pattern length has changed since the lane was created.
    const vals = t.automation[key].values;
    if (vals.length !== t.length) {
      const out = new Array(t.length).fill(0.5);
      for (let i = 0; i < Math.min(vals.length, t.length); i++) out[i] = vals[i];
      t.automation[key].values = out;
    }
  };

  const drawRow = (key) => {
    ensureLane(key);
    const lane = t.automation[key];
    const row = document.createElement("div");
    row.className = "aut-lane" + (lane.enabled ? " active" : "");
    row.dataset.key = key;
    row.innerHTML = `
      <span class="aut-label">${AUTOMATION_TARGETS[key].label}</span>
      <input type="checkbox" class="aut-enable" ${lane.enabled ? "checked" : ""} title="enable lane" />
      <div class="aut-grid"></div>
      <button class="aut-clear ghost" type="button" title="reset to 0.5">clear</button>
      <button class="aut-remove" type="button" title="remove lane">×</button>
    `;
    rows.appendChild(row);

    const grid = row.querySelector(".aut-grid");
    for (let i = 0; i < t.length; i++) {
      const cell = document.createElement("div");
      cell.className = "aut-step";
      cell.dataset.idx = i;
      cell.style.setProperty("--v", String(lane.values[i] ?? 0));
      grid.appendChild(cell);
    }

    const setFromPointer = (ev) => {
      const rect = grid.getBoundingClientRect();
      const cols = t.length;
      const relX = Math.max(0, Math.min(rect.width - 1, ev.clientX - rect.left));
      const relY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const idx = Math.max(0, Math.min(cols - 1, Math.floor((relX / rect.width) * cols)));
      const v = 1 - (relY / rect.height);
      lane.values[idx] = Math.max(0, Math.min(1, v));
      const cell = grid.children[idx];
      if (cell) cell.style.setProperty("--v", String(lane.values[idx]));
    };

    let dragging = false;
    grid.addEventListener("pointerdown", (ev) => {
      dragging = true;
      try { grid.setPointerCapture(ev.pointerId); } catch {}
      setFromPointer(ev);
      ev.preventDefault();
    });
    grid.addEventListener("pointermove", (ev) => { if (dragging) setFromPointer(ev); });
    grid.addEventListener("pointerup", (ev) => {
      dragging = false;
      try { grid.releasePointerCapture(ev.pointerId); } catch {}
    });
    grid.addEventListener("pointercancel", () => { dragging = false; });

    row.querySelector(".aut-enable").addEventListener("change", (ev) => {
      lane.enabled = !!ev.target.checked;
      row.classList.toggle("active", lane.enabled);
    });
    row.querySelector(".aut-clear").addEventListener("click", () => {
      for (let i = 0; i < lane.values.length; i++) lane.values[i] = 0.5;
      for (let i = 0; i < grid.children.length; i++) grid.children[i].style.setProperty("--v", "0.5");
    });
    row.querySelector(".aut-remove").addEventListener("click", () => {
      delete t.automation[key];
      row.remove();
      refreshAdder();
    });
  };

  for (const key of enabledKeys) drawRow(key);
  refreshAdder();

  addBtn.addEventListener("click", () => {
    refreshAdder();
    if (addBtn.disabled) return;
    addSel.hidden = false;
    addSel.focus();
  });
  addSel.addEventListener("change", () => {
    const key = addSel.value;
    if (!key) { addSel.hidden = true; return; }
    drawRow(key);
    addSel.hidden = true;
    refreshAdder();
  });
}

function updatePatternCell(idx) {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;
  const cell = grid.children[idx];
  if (cell) cell.classList.toggle("filled", isPatternNonEmpty(idx));
}

function renderStepGrid(t) {
  const grid = t.el.querySelector(".steps");
  const total = t.length;
  const cols = Math.min(16, total);
  grid.style.setProperty("--count", String(cols));
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.replaceChildren();
  updatePatternCell(t._patternIdx);
  let i = 0;
  while (i < total) {
    if (t.steps[i]) {
      const cap = maxLengthAt(t, i);
      const span = Math.max(1, Math.min(t.lengths[i] || 1, cap));
      t.lengths[i] = span;
      grid.appendChild(makeCell(t, i, span, true));
      i += span;
    } else {
      grid.appendChild(makeCell(t, i, 1, false));
      i += 1;
    }
  }
  refreshRollIfOpen(t);
}

// Piano roll panel: a pitches × steps grid per track. Clicking a cell places
// (or moves) a note at that pitch on that step; clicking an already-active cell
// clears the step; double-clicking an active cell sets velocity to full. Shows
// scale pitches only when a scale is active and "all notes" is off; chromatic
// otherwise. Viewport spans ROLL_VIEW_OCTS octaves starting at t.rollViewOct.
const ROLL_VIEW_OCTS = 2;
const ROLL_MIN_OCT = 1;
const ROLL_MAX_OCT = 6;

// Pick the starting octave whose ROLL_VIEW_OCTS-tall window contains the most
// triggered notes in the track's active pattern. Used the first time the roll
// is opened (and whenever rollViewOct is reset). Once the user pages oct +/-
// manually, their choice is preserved.
function bestRollViewOct(t) {
  const counts = new Map();
  for (let i = 0; i < t.length; i++) {
    if (!t.steps[i] || t.notes[i] == null) continue;
    // seqbaby octave naming: C4 = MIDI 60 → octave 4 = floor(60/12) - 1
    const oct = Math.floor(t.notes[i] / 12) - 1;
    counts.set(oct, (counts.get(oct) || 0) + 1);
  }
  if (counts.size === 0) return 3;
  let bestStart = 3, bestCount = -1;
  for (let start = ROLL_MIN_OCT; start + ROLL_VIEW_OCTS - 1 <= ROLL_MAX_OCT; start++) {
    let c = 0;
    for (let o = start; o < start + ROLL_VIEW_OCTS; o++) c += counts.get(o) || 0;
    if (c > bestCount) { bestCount = c; bestStart = start; }
  }
  return bestStart;
}
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function refreshRollIfOpen(t) {
  const panel = t.el?.querySelector(".track-roll-panel");
  if (!panel || panel.hidden) return;
  // A full re-render replaces the grid element, which kills any pointer capture
  // held by an in-progress drag on the roll. Skip while a drag is live — the
  // drag handlers paint their own updates via paintColumn.
  if (panel._rollDragActive) return;
  renderRollPanel(t, panel);
}

function refreshAutIfOpen(t) {
  const panel = t.el?.querySelector(".track-aut-panel");
  if (!panel || panel.hidden) return;
  renderAutomationPanel(t, panel);
}

function renderRollPanel(t, panel) {
  panel.replaceChildren();
  if (t.rollViewOct == null) t.rollViewOct = bestRollViewOct(t);
  if (t.rollShowAll == null) t.rollShowAll = false;
  const scaleIntervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const chromaticView = !scaleIntervals || t.rollShowAll;
  const EPS = 1e-6;

  // Header: title + all-notes toggle + octave pager + range readout.
  const head = document.createElement("div");
  head.className = "roll-head";
  const title = document.createElement("span");
  title.className = "roll-title";
  title.textContent = "piano roll";
  head.appendChild(title);
  if (scaleIntervals) {
    const toggle = document.createElement("label");
    toggle.innerHTML = `<input type="checkbox" class="roll-show-all" ${t.rollShowAll ? "checked" : ""}/><span>all notes</span>`;
    toggle.querySelector(".roll-show-all").addEventListener("change", (e) => {
      t.rollShowAll = e.target.checked;
      renderRollPanel(t, panel);
    });
    head.appendChild(toggle);
  }
  const octBtns = document.createElement("span");
  octBtns.className = "roll-oct-btns";
  octBtns.innerHTML = `<button class="ghost" data-d="-1">oct −</button><button class="ghost" data-d="1">oct +</button>`;
  octBtns.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const d = Number(b.dataset.d);
    const next = t.rollViewOct + d;
    if (next < ROLL_MIN_OCT || next + ROLL_VIEW_OCTS - 1 > ROLL_MAX_OCT) return;
    t.rollViewOct = next;
    renderRollPanel(t, panel);
  }));
  head.appendChild(octBtns);
  const range = document.createElement("span");
  range.className = "roll-range";
  range.textContent = `C${t.rollViewOct}–B${t.rollViewOct + ROLL_VIEW_OCTS - 1}`;
  head.appendChild(range);
  panel.appendChild(head);

  // Visible pitches (high → low so the grid reads like a keyboard).
  // C<n> in seqbaby's convention is MIDI (n+1)*12 (so C4 = 60, C3 = 48).
  // Microtonal scales (24-TET, Hüseyni, …) carry half-integer intervals; step
  // the row iteration by 0.5 so quarter tones show up as their own rows.
  const lo = (t.rollViewOct + 1) * 12;
  const hi = lo + ROLL_VIEW_OCTS * 12;                      // exclusive
  const rowStep = scaleIntervals && scaleIntervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const pitches = [];
  for (let m = hi - rowStep; m >= lo - EPS; m -= rowStep) {
    if (chromaticView) { pitches.push(m); continue; }
    const rel = ((m - state.scale.root) % 12 + 12) % 12;
    if (scaleIntervals.some(i => Math.abs(i - rel) < EPS)) pitches.push(m);
  }

  const grid = document.createElement("div");
  grid.className = "roll-grid";
  const steps = t.length;
  for (const m of pitches) {
    const basePc = ((Math.round(m) % 12) + 12) % 12;
    const isMicrotonal = Math.abs(m - Math.round(m)) > EPS;
    const isBlack = !isMicrotonal && BLACK_KEYS.has(basePc);
    const isRoot = scaleIntervals && !isMicrotonal && basePc === state.scale.root;

    const label = document.createElement("div");
    label.className = "roll-label" + (isBlack ? " black" : "") + (isRoot ? " root" : "") + (isMicrotonal ? " micro" : "");
    label.textContent = midiToName(m);
    // Diatonic pitch-class color: same hue as the corresponding note cells.
    if (!isMicrotonal) {
      const labCol = noteColor(m);
      if (labCol) label.style.setProperty("--note-color", labCol);
    }
    grid.appendChild(label);

    const cells = document.createElement("div");
    cells.className = "roll-cells";
    cells.style.gridTemplateColumns = `repeat(${steps}, minmax(0, 1fr))`;
    // Row-level pitch color — feeds the hover tint and any other per-row paint.
    if (!isMicrotonal) {
      const rowCol = noteColor(m);
      if (rowCol) cells.style.setProperty("--row-color", rowCol);
    }
    for (let i = 0; i < steps; i++) {
      const cell = document.createElement("div");
      cell.className = "roll-cell" + (isBlack ? " row-black" : "") + (isMicrotonal ? " row-micro" : "");
      if (i % 4 === 0) cell.classList.add("beat");
      cell.dataset.step = String(i);
      cell.dataset.note = String(m);
      // Mark the anchor and any "held" continuation columns. A multi-step note
      // lives on t.lengths[anchor]; the columns after the anchor have steps[i]=0
      // but still belong to the note visually. Fractional MIDI compares via EPS.
      // `note-joins-next` is set on every cell except the note's last column so
      // the CSS can square adjoining corners + bridge the 1px grid gap, making
      // a multi-step note read as one continuous bar.
      const anchor = anchorCovering(t, i);
      if (anchor >= 0 && Math.abs(t.notes[anchor] - m) < EPS) {
        const len = Math.max(1, t.lengths[anchor] || 1);
        cell.classList.add("on");
        if (anchor !== i) cell.classList.add("held");
        if (i < anchor + len - 1) cell.classList.add("note-joins-next");
        const col = noteColor(t.notes[anchor]);
        if (col) cell.style.setProperty("--note-color", col);
      }
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
  }
  panel.appendChild(grid);

  // Velocity lane — built first so paintColumn() can reference velCells below.
  const velLane = document.createElement("div");
  velLane.className = "roll-vel-lane";
  const velSpacer = document.createElement("div");
  velSpacer.className = "roll-vel-spacer";
  velSpacer.textContent = "vel";
  velLane.appendChild(velSpacer);
  const velCells = document.createElement("div");
  velCells.className = "roll-vel-cells";
  velCells.style.gridTemplateColumns = `repeat(${steps}, minmax(0, 1fr))`;
  for (let i = 0; i < steps; i++) {
    const cell = document.createElement("div");
    cell.className = "roll-vel-cell";
    if (i % 4 === 0) cell.classList.add("beat");
    cell.dataset.step = String(i);
    const bar = document.createElement("div");
    bar.className = "roll-vel-bar";
    if (t.steps[i]) {
      cell.classList.add("on");
      bar.style.height = `${Math.round((t.velocities[i] ?? 0.5) * 100)}%`;
    }
    cell.appendChild(bar);
    velCells.appendChild(cell);
  }
  velLane.appendChild(velCells);
  panel.appendChild(velLane);

  // In-place cell updater. We mutate the DOM instead of re-rendering the whole
  // panel on every drag tick — re-rendering destroys the grid element that
  // holds the active pointer capture, which kills the drag. Fractional MIDI
  // (microtonal pitches) compares via EPS to avoid floating-point misses.
  const paintColumn = (step) => {
    const anchor = anchorCovering(t, step);
    const coverNote = anchor >= 0 ? t.notes[anchor] : null;
    const noteEnd = anchor >= 0 ? anchor + Math.max(1, t.lengths[anchor] || 1) - 1 : -1;
    const coverCol = anchor >= 0 ? noteColor(coverNote) : null;
    grid.querySelectorAll(`.roll-cell[data-step="${step}"]`).forEach(c => {
      const note = Number(c.dataset.note);
      const on = anchor >= 0 && Math.abs(coverNote - note) < EPS;
      c.classList.toggle("on", on);
      c.classList.toggle("held", on && anchor !== step);
      c.classList.toggle("note-joins-next", on && step < noteEnd);
      if (on && coverCol) c.style.setProperty("--note-color", coverCol);
      else c.style.removeProperty("--note-color");
    });
    const vcell = velCells.querySelector(`.roll-vel-cell[data-step="${step}"]`);
    if (vcell) {
      vcell.classList.toggle("on", t.steps[step] === 1);
      const bar = vcell.querySelector(".roll-vel-bar");
      if (bar) bar.style.height = t.steps[step] ? `${Math.round((t.velocities[step] ?? 0.5) * 100)}%` : "0";
    }
  };
  const paintRange = (a, b) => {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(steps - 1, Math.max(a, b));
    for (let i = lo; i <= hi; i++) paintColumn(i);
  };

  // Gestures on the roll grid:
  //   empty cell down + drag right        → create note, drag extends length
  //   note's right-edge cell + drag right → resize (grow); drag left → shrink
  //   note's any-other cell + drag        → move (step + pitch follow pointer)
  //   length-1 cell (anchor==tail) + drag → mode picked on first move:
  //                                          horizontal right → resize, else move
  //   click on note (no drag), same pitch → remove the whole note (legacy)
  //   click on note (no drag), diff pitch → re-pitch to clicked row, keep length
  //   two clicks in < 400 ms              → activate + velocity to full
  const PER_STEP_KEYS = [
    "lengths","notes","velocities","chords","offsets",
    "arps","arpRates","arpRanges","arpDirs","complexities","ratchets",
    "sampleStarts","sampleEnds","sampleFadeIns","sampleFadeOuts","sampleLoopModes",
  ];
  const snapStep = (idx) => {
    const out = {};
    for (const k of PER_STEP_KEYS) if (Array.isArray(t[k])) out[k] = t[k][idx];
    return out;
  };
  const writeStep = (idx, snap, noteOverride) => {
    t.steps[idx] = 1;
    for (const k of PER_STEP_KEYS) {
      if (!Array.isArray(t[k])) continue;
      if (k === "notes" && noteOverride != null) { t[k][idx] = noteOverride; continue; }
      if (snap[k] !== undefined) t[k][idx] = snap[k];
    }
  };
  // Wipe [from,to] inclusive and truncate any prior note whose tail reaches into it.
  const eraseSpan = (from, to) => {
    if (from > 0) {
      const cov = anchorCovering(t, from);
      if (cov >= 0 && cov < from) t.lengths[cov] = from - cov;
    }
    for (let i = Math.max(0, from); i <= Math.min(t.length - 1, to); i++) {
      t.steps[i] = 0; t.lengths[i] = 0; t.notes[i] = null;
      t.velocities[i] = 0.5; t.chords[i] = "";
    }
  };

  let drag = null;
  let lastRollClickTime = 0;
  let lastRollClickKey = "";
  const ROLL_DBLCLICK_MS = 400;
  const cellFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.(".roll-cell") || null;
  };
  // Wrap a single-click mutation in the drag-active flag so renderStepGrid's
  // refreshRollIfOpen doesn't nuke the grid we just painted locally.
  const localMutate = (fn) => {
    panel._rollDragActive = true;
    try { fn(); }
    finally { panel._rollDragActive = false; }
  };
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest?.(".roll-cell");
    if (!cell || e.button !== 0) return;
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);
    const key = `${step}:${note}`;
    const now = performance.now();
    if (now - lastRollClickTime < ROLL_DBLCLICK_MS && key === lastRollClickKey) {
      // manual double-click: activate + full velocity
      localMutate(() => {
        const anchor = anchorCovering(t, step);
        const target = anchor >= 0 ? anchor : step;
        if (!t.steps[target]) startNote(t, target);
        t.notes[target] = note;
        if (!t.isDrumKit) t.lastEditedNote = note;
        t.velocities[target] = 1;
        paintRange(target, target + Math.max(1, t.lengths[target] || 1) - 1);
        renderStepGrid(t);
      });
      lastRollClickTime = 0;
      lastRollClickKey = "";
      drag = null;
      e.preventDefault();
      return;
    }
    lastRollClickTime = now;
    lastRollClickKey = key;

    const existing = anchorCovering(t, step);
    if (existing >= 0) {
      // Grab the note. Mode resolves on first pointermove for ambiguous (length-1) cases.
      const len = Math.max(1, t.lengths[existing] || 1);
      const isRightEdge = step === existing + len - 1;
      const samePitch = Math.abs(t.notes[existing] - note) < EPS;
      drag = {
        mode: isRightEdge ? (len === 1 ? "ambiguous" : "resize") : "move",
        anchor: existing,
        origLen: len,
        origSnap: snapStep(existing),
        startStep: step,
        startNote: note,
        curAnchor: existing,
        curNote: t.notes[existing],
        samePitch,
        moved: false,
        pointerId: e.pointerId,
      };
      panel._rollDragActive = true;
      try { grid.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      return;
    }
    // empty cell → start a fresh note with anchor here; drag extends it
    startNote(t, step);
    t.notes[step] = note;
    if (!t.isDrumKit) t.lastEditedNote = note;
    drag = { mode: "create", anchor: step, lastEnd: step, moved: false, pointerId: e.pointerId };
    panel._rollDragActive = true;
    try { grid.setPointerCapture(e.pointerId); } catch {}
    paintColumn(step);
    renderStepGrid(t);
    e.preventDefault();
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell || !grid.contains(cell)) return;
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);

    if (drag.mode === "ambiguous") {
      if (step === drag.startStep && Math.abs(note - drag.startNote) < EPS) return;
      drag.mode = (step > drag.startStep) ? "resize" : "move";
    }

    if (drag.mode === "create") {
      if (step === drag.lastEnd) return;
      const newEnd = Math.max(drag.anchor, step);
      extendNote(t, drag.anchor, newEnd);
      paintRange(drag.anchor, Math.max(drag.lastEnd, newEnd));
      drag.lastEnd = newEnd;
      drag.moved = true;
      renderStepGrid(t);
      return;
    }

    if (drag.mode === "resize") {
      const newEnd = Math.max(drag.anchor, step);
      const prevLen = Math.max(1, t.lengths[drag.anchor] || 1);
      const desired = newEnd - drag.anchor + 1;
      if (desired === prevLen) return;
      extendNote(t, drag.anchor, newEnd);
      const newLen = Math.max(1, t.lengths[drag.anchor] || 1);
      paintRange(drag.anchor, drag.anchor + Math.max(prevLen, newLen) - 1);
      drag.moved = true;
      renderStepGrid(t);
      return;
    }

    // ── move ──
    const stepDelta = step - drag.startStep;
    const noteDelta = note - drag.startNote;
    const len = drag.origLen;
    const newAnchor = Math.max(0, Math.min(t.length - len, drag.anchor + stepDelta));
    const newNote = (drag.origSnap.notes ?? drag.curNote) + noteDelta;
    if (newAnchor === drag.curAnchor && Math.abs(newNote - drag.curNote) < EPS) return;

    // Compute paint range BEFORE mutation so we cover any truncated neighbour's old tail.
    let paintLo = Math.min(drag.curAnchor, newAnchor);
    let paintHi = Math.max(drag.curAnchor + len - 1, newAnchor + len - 1);
    if (newAnchor > 0) {
      const cov = anchorCovering(t, newAnchor);
      if (cov >= 0 && cov < newAnchor && cov !== drag.curAnchor) {
        const cLen = Math.max(1, t.lengths[cov] || 1);
        paintHi = Math.max(paintHi, cov + cLen - 1);
      }
    }

    eraseSpan(drag.curAnchor, drag.curAnchor + len - 1);
    eraseSpan(newAnchor, newAnchor + len - 1);
    writeStep(newAnchor, drag.origSnap, newNote);
    // Restore length (snap may have come from a single index — explicit set is clearer).
    t.lengths[newAnchor] = len;
    if (!t.isDrumKit) t.lastEditedNote = newNote;

    paintRange(paintLo, paintHi);
    drag.curAnchor = newAnchor;
    drag.curNote = newNote;
    drag.moved = true;
    renderStepGrid(t);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    try { grid.releasePointerCapture(e.pointerId); } catch {}
    // Click on existing note without drag — preserve legacy click semantics.
    if (!drag.moved && (drag.mode === "move" || drag.mode === "resize" || drag.mode === "ambiguous")) {
      localMutate(() => {
        const a = drag.anchor;
        const len = drag.origLen;
        if (drag.samePitch) {
          removeNote(t, a);
        } else {
          t.notes[a] = drag.startNote;
          if (!t.isDrumKit) t.lastEditedNote = drag.startNote;
        }
        paintRange(a, a + len - 1);
        renderStepGrid(t);
      });
    }
    drag = null;
    panel._rollDragActive = false;
  };
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  let vdrag = null;
  const updateVelFromPoint = (cell, clientY) => {
    const step = Number(cell.dataset.step);
    if (!t.steps[step]) return;
    const r = cell.getBoundingClientRect();
    const v = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    t.velocities[step] = Math.max(0.05, Math.min(1, v));
    cell.querySelector(".roll-vel-bar").style.height = `${Math.round(t.velocities[step] * 100)}%`;
  };
  velCells.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".roll-vel-cell.on");
    if (!cell || e.button !== 0) return;
    vdrag = { pointerId: e.pointerId };
    panel._rollDragActive = true;
    try { velCells.setPointerCapture(e.pointerId); } catch {}
    updateVelFromPoint(cell, e.clientY);
    renderStepGrid(t);
    e.preventDefault();
  });
  velCells.addEventListener("pointermove", (e) => {
    if (!vdrag || e.pointerId !== vdrag.pointerId) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".roll-vel-cell.on");
    if (!cell || !velCells.contains(cell)) return;
    updateVelFromPoint(cell, e.clientY);
    renderStepGrid(t);
  });
  const endVDrag = (e) => {
    if (!vdrag || e.pointerId !== vdrag.pointerId) return;
    try { velCells.releasePointerCapture(e.pointerId); } catch {}
    vdrag = null;
    panel._rollDragActive = false;
  };
  velCells.addEventListener("pointerup", endVDrag);
  velCells.addEventListener("pointercancel", endVDrag);
}

function makeCell(t, idx, span, on) {
  const cell = document.createElement("div");
  cell.className = "step";
  cell.dataset.idx = String(idx);
  cell.dataset.span = String(span);
  if (on) {
    cell.classList.add("on");
    const vel = t.velocities[idx] ?? 0.5;
    cell.style.setProperty("--vel", String(vel));
    if (t.notes[idx] != null) {
      const col = noteColor(t.notes[idx]);
      if (col) cell.style.setProperty("--note-color", col);
    }
  }
  if (span > 1) cell.classList.add("held");
  if (span > 1) cell.style.gridColumn = `span ${span}`;
  if (idx % 4 === 0) cell.classList.add("beat");
  if (t.accents.has(idx)) cell.classList.add("accent");
  if (on && t.notes[idx] != null) {
    const label = document.createElement("span");
    label.className = "step-note";
    const chord = t.chords[idx];
    label.textContent = chord ? `${midiToName(t.notes[idx])}${chord}` : midiToName(t.notes[idx]);
    cell.appendChild(label);
  }
  return cell;
}

function attachGridInteraction(t, grid) {
  let drag = null;
  const idxFromPoint = (x, y) => {
    const r = grid.getBoundingClientRect();
    const total = t.length;
    if (r.width <= 0 || r.height <= 0) return 0;
    const cols = Math.min(16, total);
    const rows = Math.max(1, Math.ceil(total / 16));
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((x - r.left) / r.width) * cols)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((y - r.top) / r.height) * rows)));
    return Math.max(0, Math.min(total - 1, row * 16 + col));
  };

  // Manual double-click detection — renderStepGrid() rebuilds step cells on
  // every pointerdown, so the browser's native dblclick (which requires the
  // same element for both clicks) never fires. Track time+index between clicks.
  let lastClickTime = 0;
  let lastClickIdx = -1;
  const DBLCLICK_MS = 400;

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    closeStepEditor();
    const idx = idxFromPoint(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastClickTime < DBLCLICK_MS && idx === lastClickIdx) {
      // Double-click: ensure the step is on at `idx` and bump velocity to full.
      // The preceding single click may have just toggled it off via endDrag;
      // re-activate as needed.
      const anchor = anchorCovering(t, idx);
      const target = anchor >= 0 ? anchor : idx;
      if (!t.steps[target]) startNote(t, target);
      t.velocities[target] = 1;
      renderStepGrid(t);
      drag = null;
      lastClickTime = 0;
      lastClickIdx = -1;
      e.preventDefault();
      return;
    }
    lastClickTime = now;
    lastClickIdx = idx;

    const existing = anchorCovering(t, idx);
    let anchor, wasOn = false;
    if (existing >= 0) { anchor = existing; wasOn = true; }
    else { anchor = idx; startNote(t, anchor); renderStepGrid(t); }
    try { grid.setPointerCapture(e.pointerId); } catch {}
    drag = {
      anchor, wasOn, startIdx: idx, lastIdx: idx, moved: false, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      startNote: t.notes[anchor] ?? 60,
      pitchMode: false,
    };
    e.preventDefault();
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Enter pitch mode once the drag is clearly more vertical than horizontal.
    if (!drag.pitchMode && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      drag.pitchMode = true;
    }
    if (drag.pitchMode) {
      let target;
      if (state.scale.active && SCALES[state.scale.mode]) {
        // 22 px per scale degree — roomy enough to hold a pitch steady.
        const intervals = SCALES[state.scale.mode];
        const startIdx = midiToScaleIndex(drag.startNote, state.scale.root, intervals);
        const steps = Math.round(-dy / 22);
        target = (startIdx != null)
          ? scaleIndexToMidi(startIdx + steps, state.scale.root, intervals)
          : applyScale(drag.startNote + steps);
      } else {
        // 18 px per semitone in chromatic mode.
        const semis = Math.round(-dy / 18);
        target = drag.startNote + semis;
      }
      target = Math.max(24, Math.min(95, target));
      if (t.notes[drag.anchor] !== target) {
        t.notes[drag.anchor] = target;
        if (!t.isDrumKit) t.lastEditedNote = target;
        renderStepGrid(t);
      }
      drag.moved = true;   // prevent endDrag from treating this as a click-to-toggle-off
      return;
    }
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx !== drag.startIdx) drag.moved = true;
    if (idx === drag.lastIdx) return;
    drag.lastIdx = idx;
    if (idx >= drag.anchor) { extendNote(t, drag.anchor, idx); renderStepGrid(t); }
  });
  grid.addEventListener("contextmenu", (e) => {
    const idx = idxFromPoint(e.clientX, e.clientY);
    const anchor = anchorCovering(t, idx);
    if (anchor < 0) return;
    e.preventDefault();
    const cell = grid.querySelector(`.step[data-idx="${anchor}"]`);
    openStepEditor(t, anchor, cell || grid);
  });

  grid.addEventListener("dblclick", (e) => {
    // Two clicks in the same cell normally toggle on→off; nudge it back on and
    // crank velocity to full so a double-click slams the step to 100%.
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx < 0 || idx >= t.length) return;
    e.preventDefault();
    if (!t.steps[idx]) startNote(t, idx);
    if (!t.velocities) t.velocities = new Array(t.length).fill(0.5);
    const anchor = anchorCovering(t, idx);
    const target = anchor >= 0 ? anchor : idx;
    t.velocities[target] = 1;
    renderStepGrid(t);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && drag.wasOn) { removeNote(t, drag.anchor); renderStepGrid(t); }
    try { grid.releasePointerCapture(e.pointerId); } catch {}
    drag = null;
  };
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);
}

// ---- step editor popover ------------------------------------------------

let stepEditor = null;
function closeStepEditor() {
  if (!stepEditor) return;
  document.removeEventListener("keydown", stepEditor.escHandler);
  (stepEditor.overlay || stepEditor.el).remove();
  stepEditor = null;
}

function openStepEditor(t, idx, anchorEl) {
  closeStepEditor();
  const eng = engineByKey(t.engineKey);
  const defaultNote = t.notes[idx] ?? eng?.defaultNote ?? 60;
  const el = document.createElement("div");
  el.className = "step-editor";
  const chordOptions = `<option value="">none</option>`;
  el.innerHTML = `
    <div class="se-title">step ${idx + 1}</div>
    <div class="se-field se-note-field">
      <label>note</label>
      <div class="se-note-header">
        <span class="se-note-label"></span>
        <div class="se-oct-pager">
          <button class="se-oct-down" type="button" title="lower octaves">oct −</button>
          <span class="se-oct-range"></span>
          <button class="se-oct-up" type="button" title="higher octaves">oct +</button>
        </div>
      </div>
      <div class="se-keyboard" tabindex="0"></div>
      <input class="se-note" type="hidden" value="${Math.max(24, Math.min(95, defaultNote))}" />
    </div>
    <div class="se-field se-chord-field">
      <label>chord</label>
      <select class="se-chord">${chordOptions}</select>
      <label class="se-arp-wrap"><input class="se-arp" type="checkbox" /> arp</label>
      <span class="se-chord-label"></span>
    </div>
    <div class="se-field se-ratchet-row">
      <label>ratchet</label>
      <input class="se-ratchet" type="range" min="1" max="8" step="1" value="${(t.ratchets && t.ratchets[idx]) || 1}" />
      <span class="se-ratchet-label"></span>
    </div>
    <div class="se-field se-cpx-row">
      <label>cpx</label>
      <select class="se-cpx">
        <option value="0">root</option>
        <option value="1">1st inv</option>
        <option value="2">2nd inv</option>
        <option value="3">3rd inv</option>
        <option value="4">drop-oct</option>
      </select>
    </div>
    <div class="se-field se-arp-row" hidden>
      <label>arp</label>
      <div class="se-arp-selects">
        <select class="se-arp-rate" title="arp rate (beats per note)">
          <option value="1">1/4</option>
          <option value="0.5">1/8</option>
          <option value="0.333">1/8t</option>
          <option value="0.25" selected>1/16</option>
          <option value="0.167">1/16t</option>
          <option value="0.125">1/32</option>
        </select>
        <select class="se-arp-range" title="octaves spanned">
          <option value="1" selected>1 oct</option>
          <option value="2">2 oct</option>
          <option value="3">3 oct</option>
          <option value="4">4 oct</option>
        </select>
        <select class="se-arp-dir" title="arp direction">
          <option value="up" selected>up</option>
          <option value="down">down</option>
          <option value="updown">up-down</option>
          <option value="random">random</option>
        </select>
      </div>
    </div>
    <div class="se-field">
      <label>vel</label>
      <input class="se-vel" type="range" min="0" max="1" step="0.01" value="${t.velocities[idx] ?? 0.5}" />
      <span class="se-vel-label"></span>
    </div>
    <div class="se-field">
      <label>offset</label>
      <input class="se-offset" type="range" min="-0.5" max="0.5" step="0.01" value="${t.offsets?.[idx] ?? 0}" />
      <span class="se-offset-label"></span>
    </div>
    <div class="se-field se-sample-row" hidden>
      <label>sample</label>
      <div class="se-sample-ctl">
        <canvas class="se-waveform" width="440" height="72"></canvas>
        <div class="se-sample-meta">
          <span class="se-smp-info">—</span>
          <label>fit
            <select class="se-smp-fit">
              <option value="native" selected>native</option>
              <option value="2xbpm">2× bpm</option>
              <option value="1xbpm">1× bpm</option>
              <option value="1/2bpm">1/2 bpm</option>
              <option value="1/4bpm">1/4 bpm</option>
            </select>
          </label>
          <label>snap
            <select class="se-smp-snap">
              <option value="free" selected>free</option>
              <option value="1">1 beat</option>
              <option value="0.5">1/8</option>
              <option value="0.25">1/16</option>
              <option value="0.125">1/32</option>
            </select>
          </label>
          <label>loop
            <select class="se-smp-loop">
              <option value="off" selected>off</option>
              <option value="loop">loop</option>
              <option value="pingpong">ping-pong</option>
            </select>
          </label>
          <button class="se-preview" type="button">preview</button>
          <button class="se-apply-all ghost" type="button" title="apply these sample settings to every step on this track and use as the default for new steps">apply to all</button>
        </div>
        <div class="se-sample-fade">
          <label>fade in <input class="se-smp-fade-in" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-in-lbl">0 ms</span></label>
          <label>fade out <input class="se-smp-fade-out" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-out-lbl">0 ms</span></label>
        </div>
      </div>
    </div>
    <div class="se-actions">
      <button class="se-close">done</button>
    </div>
  `;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.appendChild(el);
  document.body.appendChild(overlay);

  const noteInput = el.querySelector(".se-note");
  const noteLbl = el.querySelector(".se-note-label");
  const velInput = el.querySelector(".se-vel");
  const velLbl = el.querySelector(".se-vel-label");
  const chordSel = el.querySelector(".se-chord");
  const chordLbl = el.querySelector(".se-chord-label");
  const arpBox   = el.querySelector(".se-arp");
  const cpxInput = el.querySelector(".se-cpx");
  cpxInput.value = String(Math.max(0, Math.min(4, (t.complexities && t.complexities[idx]) || 0)));
  const offsetInput = el.querySelector(".se-offset");
  const offsetLbl = el.querySelector(".se-offset-label");
  const rebuildChords = () => {
    const root = Number(noteInput.value) || 60;
    const prev = chordSel.value || t.chords?.[idx] || "";
    const opts = [`<option value="">none</option>`];
    for (const key of Object.keys(CHORD_TYPES)) {
      if (!key) continue;
      if (!chordFitsScale(root, key)) continue;
      opts.push(`<option value="${key}">${key}</option>`);
    }
    chordSel.innerHTML = opts.join("");
    const stillThere = Array.from(chordSel.options).some(o => o.value === prev);
    if (stillThere) chordSel.value = prev;
    else {
      chordSel.value = "";
      if (t.chords) t.chords[idx] = "";
    }
  };
  rebuildChords();
  arpBox.checked = !!(t.arps && t.arps[idx]);
  const arpRow   = el.querySelector(".se-arp-row");
  const arpRate  = el.querySelector(".se-arp-rate");
  const arpRange = el.querySelector(".se-arp-range");
  const arpDir   = el.querySelector(".se-arp-dir");
  arpRate.value  = String(t.arpRates?.[idx]  ?? 0.25);
  arpRange.value = String(t.arpRanges?.[idx] ?? 1);
  arpDir.value   = String(t.arpDirs?.[idx]   ?? "up");
  const arpWrap = el.querySelector(".se-arp-wrap");
  const cpxRow  = el.querySelector(".se-cpx-row");
  const ratchetRow = el.querySelector(".se-ratchet-row");
  const ratchetInput = el.querySelector(".se-ratchet");
  const ratchetLbl = el.querySelector(".se-ratchet-label");
  const syncChordOptsVisibility = () => {
    const hasChord = !!chordSel.value;
    if (arpWrap)     arpWrap.hidden = !hasChord;
    if (cpxRow)      cpxRow.hidden = !hasChord;
    if (chordLbl)    chordLbl.hidden = !hasChord;
    if (ratchetRow)  ratchetRow.hidden = hasChord;
  };
  ratchetInput.value = (t.ratchets && t.ratchets[idx]) || 1;
  ratchetLbl.textContent = `×${ratchetInput.value}`;
  ratchetInput.addEventListener("input", () => {
    if (!t.ratchets) t.ratchets = new Array(t.length).fill(1);
    const v = Math.max(1, Math.min(8, Math.round(Number(ratchetInput.value) || 1)));
    t.ratchets[idx] = v;
    ratchetLbl.textContent = `×${v}`;
  });
  const syncArpRowVisibility = () => { arpRow.hidden = !(chordSel.value && arpBox.checked); };
  syncChordOptsVisibility();
  syncArpRowVisibility();

  // Build Launchpad-style pad grid (bottom-left = lowest, top-right = highest).
  // Only 3 octaves are visible at a time — use the pager (oct +/−) to shift the window.
  // When a scale is active, only in-scale notes are shown and columns = scale length.
  const kb = el.querySelector(".se-keyboard");
  const octDownBtn  = el.querySelector(".se-oct-down");
  const octUpBtn    = el.querySelector(".se-oct-up");
  const octRangeLbl = el.querySelector(".se-oct-range");
  const scaleIntervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const PC_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  // Microtonal scales (Hüseyni, 24-TET) carry half-integer intervals; step the pad
  // by 0.5 semitones so quarter tones appear as clickable pads.
  const EPS = 1e-6;
  const scaleStep = scaleIntervals && scaleIntervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const VIEW_OCTS = 3;
  const MIN_OCT = 1, MAX_OCT = 6;
  const octaveOf = (m) => Math.floor(m / 12) - 1;
  let viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, octaveOf(defaultNote) - 1));
  const COLS = scaleIntervals ? scaleIntervals.length : 12;
  kb.style.gridTemplateColumns = `repeat(${COLS}, var(--se-pad-size))`;

  const renderPads = () => {
    kb.replaceChildren();
    const lo = 24 + (viewOctStart - 1) * 12;
    const hi = lo + VIEW_OCTS * 12;
    const visible = [];
    for (let m = lo; m < hi && m <= 95; m += scaleStep) {
      if (!scaleIntervals) { visible.push(m); continue; }
      const rel = ((m - state.scale.root) % 12 + 12) % 12;
      if (scaleIntervals.some(i => Math.abs(i - rel) < EPS)) visible.push(m);
    }
    const ROWS = Math.max(1, Math.ceil(visible.length / COLS));
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const basePc = ((Math.round(m) % 12) + 12) % 12;
      const isMicrotonal = m !== Math.round(m);
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "se-pad";
      pad.dataset.note = String(m);
      if (scaleIntervals) {
        pad.classList.add("in-scale");
        if (!isMicrotonal && basePc === state.scale.root) pad.classList.add("root");
      }
      pad.title = midiToName(m);
      pad.textContent = isMicrotonal
        ? midiToName(m)
        : `${PC_NAMES[basePc]}${octaveOf(m)}`;
      pad.style.gridRow = String(ROWS - Math.floor(i / COLS));
      pad.style.gridColumn = String((i % COLS) + 1);
      kb.appendChild(pad);
    }
    // re-apply selected highlight if the current note is in view
    const cur = Number(noteInput.value);
    const active = kb.querySelector(`.se-pad[data-note="${cur}"]`);
    if (active) active.classList.add("selected");
    if (octRangeLbl) octRangeLbl.textContent = `oct ${viewOctStart}–${viewOctStart + VIEW_OCTS - 1}`;
    if (octDownBtn) octDownBtn.disabled = viewOctStart <= MIN_OCT;
    if (octUpBtn)   octUpBtn.disabled   = viewOctStart + VIEW_OCTS - 1 >= MAX_OCT;
  };
  renderPads();
  if (octDownBtn) octDownBtn.addEventListener("click", () => {
    if (viewOctStart > MIN_OCT) { viewOctStart--; renderPads(); }
  });
  if (octUpBtn) octUpBtn.addEventListener("click", () => {
    if (viewOctStart + VIEW_OCTS - 1 < MAX_OCT) { viewOctStart++; renderPads(); }
  });
  const setNote = (v, { render = true } = {}) => {
    // Preserve fractional MIDI here — microtonal scales yield quarter-tone notes
    // that applyScale will snap to the nearest scale pitch.
    let n = Math.max(24, Math.min(95, Number(v)));
    n = applyScale(n);
    noteInput.value = String(n);
    t.notes[idx] = n;
    if (!t.isDrumKit) t.lastEditedNote = n;
    const nOct = octaveOf(n);
    if (nOct < viewOctStart || nOct > viewOctStart + VIEW_OCTS - 1) {
      viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, nOct - 1));
      renderPads();
    } else {
      kb.querySelectorAll(".se-pad.selected").forEach(k => k.classList.remove("selected"));
      const active = kb.querySelector(`.se-pad[data-note="${n}"]`);
      if (active) active.classList.add("selected");
    }
    rebuildChords();
    syncChordOptsVisibility();
    syncArpRowVisibility();
    if (render) { refresh(); renderStepGrid(t); }
  };
  kb.addEventListener("click", (e) => {
    const k = e.target.closest(".se-pad");
    if (!k) return;
    setNote(Number(k.dataset.note));
  });

  const refresh = () => {
    const n = Number(noteInput.value);
    noteLbl.textContent = `${midiToName(n)} (${n})`;
    velLbl.textContent = Number(velInput.value).toFixed(2);
    const ch = chordSel.value;
    let chordLbls = "single";
    if (ch) {
      const base = chordNotes(Number(noteInput.value), ch);
      const cpx = Math.max(0, Math.min(base.length - 1, Number(cpxInput.value) || 0));
      const voiced = invertChord(base, cpx);
      chordLbls = (arpBox.checked ? "arp: " : "") + voiced.map(midiToName).join(arpBox.checked ? " → " : " · ");
    }
    chordLbl.textContent = chordLbls;
    const off = Number(offsetInput.value);
    offsetLbl.textContent = `${off >= 0 ? "+" : ""}${off.toFixed(2)}`;
    arpBox.disabled = !ch;
    cpxInput.disabled = !ch;
    const cur = Number(noteInput.value);
    kb.querySelectorAll(".se-pad.selected").forEach(k => k.classList.remove("selected"));
    const sel = kb.querySelector(`.se-pad[data-note="${cur}"]`);
    if (sel) sel.classList.add("selected");
  };
  refresh();

  offsetInput.addEventListener("input", () => {
    if (!t.offsets) t.offsets = new Array(t.length).fill(0);
    t.offsets[idx] = Number(offsetInput.value);
    refresh();
  });

  // sample-engine specific row: waveform with draggable start/end handles + preview
  const sampleRow = el.querySelector(".se-sample-row");
  const engineType = engineByKey(t.engineKey)?.type;
  const isSampleEngine = engineType === "eleven" || engineType === "upload" || engineType === "sample";
  sampleRow.hidden = !isSampleEngine;
  if (isSampleEngine) {
    const canvas = sampleRow.querySelector(".se-waveform");
    const infoEl = sampleRow.querySelector(".se-smp-info");
    const snapSel = sampleRow.querySelector(".se-smp-snap");
    const fitSel  = sampleRow.querySelector(".se-smp-fit");
    const prev    = sampleRow.querySelector(".se-preview");
    const applyAllBtn = sampleRow.querySelector(".se-apply-all");
    if (fitSel) {
      fitSel.value = t.sampleSpeedMode || "native";
      fitSel.addEventListener("change", () => {
        t.sampleSpeedMode = fitSel.value || "native";
        applySampleSpeed(t);
      });
    }
    if (!t.sampleStarts) t.sampleStarts = new Array(t.length).fill(0);
    if (!t.sampleEnds)   t.sampleEnds   = new Array(t.length).fill(1);
    if (!t.sampleFadeIns)  t.sampleFadeIns  = new Array(t.length).fill(0);
    if (!t.sampleFadeOuts) t.sampleFadeOuts = new Array(t.length).fill(0);
    if (!t.sampleLoopModes) t.sampleLoopModes = new Array(t.length).fill("off");

    const loopSel = sampleRow.querySelector(".se-smp-loop");
    if (loopSel) {
      loopSel.value = t.sampleLoopModes[idx] || "off";
      loopSel.addEventListener("change", () => {
        const v = loopSel.value;
        t.sampleLoopModes[idx] = (v === "loop" || v === "pingpong") ? v : "off";
      });
    }

    const fadeInInput  = sampleRow.querySelector(".se-smp-fade-in");
    const fadeOutInput = sampleRow.querySelector(".se-smp-fade-out");
    const fadeInLbl    = sampleRow.querySelector(".se-smp-fade-in-lbl");
    const fadeOutLbl   = sampleRow.querySelector(".se-smp-fade-out-lbl");
    const fmtFade = (sec) => sec < 1 ? `${Math.round(sec * 1000)} ms` : `${sec.toFixed(2)} s`;
    if (fadeInInput) {
      fadeInInput.value = String(t.sampleFadeIns[idx] ?? 0);
      fadeInLbl.textContent = fmtFade(Number(fadeInInput.value));
      fadeInInput.addEventListener("input", () => {
        const v = Math.max(0, Math.min(2, Number(fadeInInput.value) || 0));
        t.sampleFadeIns[idx] = v;
        fadeInLbl.textContent = fmtFade(v);
      });
    }
    if (fadeOutInput) {
      fadeOutInput.value = String(t.sampleFadeOuts[idx] ?? 0);
      fadeOutLbl.textContent = fmtFade(Number(fadeOutInput.value));
      fadeOutInput.addEventListener("input", () => {
        const v = Math.max(0, Math.min(2, Number(fadeOutInput.value) || 0));
        t.sampleFadeOuts[idx] = v;
        fadeOutLbl.textContent = fmtFade(v);
      });
    }

    const snapFrac = () => {
      if (snapSel.value === "free") return 0;
      const beats = Number(snapSel.value) || 0;
      if (!beats) return 0;
      const buf = t.voice?.buffer;
      if (!buf || !buf.duration) return 0;
      const stepSec = (60 / currentBpm()) * beats;
      return stepSec / buf.duration;
    };
    const snapTo = (frac) => {
      const s = snapFrac();
      if (!s) return frac;
      return Math.round(frac / s) * s;
    };

    const drawWave = () => {
      const ctx2d = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);
      ctx2d.fillStyle = "#0e0f12";
      ctx2d.fillRect(0, 0, w, h);
      const buf = t.voice?.buffer;
      if (buf) {
        const data = buf.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / w));
        ctx2d.strokeStyle = "#6e7280";
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        for (let x = 0; x < w; x++) {
          let mn = 1, mx = -1;
          const s = x * step;
          const e = Math.min(data.length, s + step);
          for (let i = s; i < e; i++) {
            const v = data[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          ctx2d.moveTo(x + 0.5, h / 2 - mn * h / 2);
          ctx2d.lineTo(x + 0.5, h / 2 - mx * h / 2);
        }
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = "#8a8c93";
        ctx2d.font = "11px ui-monospace, monospace";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText("no sample loaded", w / 2, h / 2);
      }
      // Dim outside selection
      const sFrac = t.sampleStarts[idx] ?? 0;
      const eFrac = t.sampleEnds[idx] ?? 1;
      const sx = Math.round(sFrac * w);
      const ex = Math.round(eFrac * w);
      ctx2d.fillStyle = "rgba(10,12,16,0.65)";
      ctx2d.fillRect(0, 0, sx, h);
      ctx2d.fillRect(ex, 0, w - ex, h);
      // Handles
      ctx2d.strokeStyle = "#c2f04a";
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(sx + 1, 0); ctx2d.lineTo(sx + 1, h);
      ctx2d.stroke();
      ctx2d.fillStyle = "#c2f04a";
      ctx2d.beginPath();
      ctx2d.moveTo(sx + 1, 0); ctx2d.lineTo(sx + 9, 0); ctx2d.lineTo(sx + 1, 8); ctx2d.closePath();
      ctx2d.fill();

      ctx2d.strokeStyle = "#ff6fa3";
      ctx2d.beginPath();
      ctx2d.moveTo(ex - 1, 0); ctx2d.lineTo(ex - 1, h);
      ctx2d.stroke();
      ctx2d.fillStyle = "#ff6fa3";
      ctx2d.beginPath();
      ctx2d.moveTo(ex - 1, 0); ctx2d.lineTo(ex - 9, 0); ctx2d.lineTo(ex - 1, 8); ctx2d.closePath();
      ctx2d.fill();

      if (buf) {
        const startMs = Math.round(sFrac * buf.duration * 1000);
        const endMs   = Math.round(eFrac * buf.duration * 1000);
        infoEl.textContent = `${(buf.duration).toFixed(2)}s · [${startMs} — ${endMs}] ms`;
      } else {
        infoEl.textContent = "no sample";
      }
    };

    drawWave();

    // pointer-drag editing: grab nearest handle
    let dragging = null; // "start" | "end" | null
    const fracFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, x));
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const f = fracFromEvent(e);
      const ds = Math.abs(f - (t.sampleStarts[idx] ?? 0));
      const de = Math.abs(f - (t.sampleEnds[idx] ?? 1));
      dragging = ds <= de ? "start" : "end";
      applyDrag(f);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      applyDrag(fracFromEvent(e));
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    function applyDrag(frac) {
      let snapped = snapTo(frac);
      if (dragging === "start") {
        const maxStart = (t.sampleEnds[idx] ?? 1) - 0.01;
        t.sampleStarts[idx] = Math.max(0, Math.min(maxStart, snapped));
      } else if (dragging === "end") {
        const minEnd = (t.sampleStarts[idx] ?? 0) + 0.01;
        t.sampleEnds[idx] = Math.max(minEnd, Math.min(1, snapped));
      }
      drawWave();
    }
    snapSel.addEventListener("change", drawWave);

    prev.addEventListener("click", async () => {
      if (!t.voice || !t.voice.buffer) { setStatus("no sample loaded yet", true); return; }
      await ensureAudio();
      const when = state.audioCtx.currentTime + 0.02;
      const note = Number(noteInput.value) || 60;
      const vel  = Number(velInput.value) || 0.8;
      try {
        t.voice.hit(note, when, t.voice.buffer.duration, vel, {
          startOffset: t.sampleStarts[idx],
          endOffset:   t.sampleEnds[idx],
          fadeIn:      t.sampleFadeIns?.[idx]  ?? 0,
          fadeOut:     t.sampleFadeOuts?.[idx] ?? 0,
          loopMode:    t.sampleLoopModes?.[idx] ?? "off",
          pitchBase:   t.isDrumKit ? 36 : 60,
        });
      } catch (err) { console.warn(err); }
    });

    if (applyAllBtn) {
      applyAllBtn.addEventListener("click", () => {
        const settings = {
          start: t.sampleStarts[idx] ?? 0,
          end: t.sampleEnds[idx] ?? 1,
          fadeIn: t.sampleFadeIns?.[idx] ?? 0,
          fadeOut: t.sampleFadeOuts?.[idx] ?? 0,
          loopMode: t.sampleLoopModes?.[idx] ?? "off",
        };
        applySampleSettingsToAllSteps(t, settings);
        t.sampleDefaults = { ...settings };
        // Re-alias the active pattern so t.sampleStarts etc. point at the fresh arrays,
        // then redraw the waveform + step grid to reflect the propagated values.
        aliasPattern(t, t._patternIdx ?? state.activePattern);
        renderStepGrid(t);
        setStatus(`applied sample settings to all steps on "${t.name}"`);
      });
    }
  }

  velInput.addEventListener("input", () => {
    t.velocities[idx] = Number(velInput.value);
    refresh();
    const cell = t.el.querySelector(`.step[data-idx="${idx}"]`);
    if (cell) cell.style.setProperty("--vel", String(t.velocities[idx]));
  });
  chordSel.addEventListener("change", () => {
    t.chords[idx] = chordSel.value;
    refresh();
    renderStepGrid(t);
  });
  arpBox.addEventListener("change", () => {
    if (!t.arps) t.arps = new Array(t.length).fill(false);
    t.arps[idx] = arpBox.checked;
    syncArpRowVisibility();
    refresh();
  });
  chordSel.addEventListener("change", () => {
    // clearing the chord also clears arp state so it doesn't "ghost" between chord selections
    if (!chordSel.value) {
      arpBox.checked = false;
      if (!t.arps) t.arps = new Array(t.length).fill(false);
      t.arps[idx] = false;
    }
    syncChordOptsVisibility();
    syncArpRowVisibility();
  });
  arpRate.addEventListener("change",  () => { if (!t.arpRates)  t.arpRates  = new Array(t.length).fill(0.25); t.arpRates[idx]  = Number(arpRate.value); });
  arpRange.addEventListener("change", () => { if (!t.arpRanges) t.arpRanges = new Array(t.length).fill(1);    t.arpRanges[idx] = Number(arpRange.value); });
  arpDir.addEventListener("change",   () => { if (!t.arpDirs)   t.arpDirs   = new Array(t.length).fill("up"); t.arpDirs[idx]   = arpDir.value; });
  cpxInput.addEventListener("input", () => {
    if (!t.complexities) t.complexities = new Array(t.length).fill(0);
    t.complexities[idx] = Math.max(0, Math.min(4, Number(cpxInput.value) || 0));
    refresh();
  });
  el.querySelector(".se-close").addEventListener("click", closeStepEditor);

  const escHandler = (e) => { if (e.key === "Escape") closeStepEditor(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStepEditor(); });
  document.addEventListener("keydown", escHandler);
  stepEditor = { overlay, el, escHandler };
}

function paintNowIndicator() {
  for (const t of state.tracks) {
    const tk = t.trackTick ?? 0;
    const idx = ((tk - 1) % t.length + t.length) % t.length;
    const cells = t.el.querySelectorAll(".step");
    cells.forEach(c => {
      const start = Number(c.dataset.idx);
      const span = Number(c.dataset.span) || 1;
      c.classList.toggle("now", tk > 0 && idx >= start && idx < start + span);
    });
    // Piano roll: highlight the column for the current step, if the roll is open.
    const rollPanel = t.el.querySelector(".track-roll-panel");
    if (rollPanel && !rollPanel.hidden) {
      rollPanel.querySelectorAll(".roll-cell.now, .roll-vel-cell.now")
        .forEach(c => c.classList.remove("now"));
      if (tk > 0) {
        rollPanel.querySelectorAll(`.roll-cell[data-step="${idx}"], .roll-vel-cell[data-step="${idx}"]`)
          .forEach(c => c.classList.add("now"));
      }
    }
  }
}

// ---- transport ---------------------------------------------------------

async function ensureAudio() {
  if (state.ready) return;
  // state.audioCtx + Tone.setContext are wired up at init() time so Tone.Transport
  // latches onto our context from first access.
  await Tone.start();
  if (!state.masterGain) {
    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = 1;
    state.masterGain.connect(state.audioCtx.destination);
    state.masterAnalyser = state.audioCtx.createAnalyser();
    state.masterAnalyser.fftSize = 1024;
    state.masterAnalyser.smoothingTimeConstant = 0.25;
    state.masterGain.connect(state.masterAnalyser);
  }
  await wosc.loadOscillator(state.audioCtx);
  await ensureMidi().catch(() => null);
  for (const t of state.tracks) {
    try { ensureFxRack(t); } catch (e) { console.warn("fx rack init failed for", t.name, e); }
    if (!t.voice) {
      try {
        t.voice = buildVoiceForEngine(state.audioCtx, t.engineKey, t.params, t);
        if (t.voice.type === "midi") {
          t.voice.setChannel(t.midi.channel);
          const out = state.midi?.outputs.get(t.midi.outputId);
          if (out) t.voice.setOutput(out);
        }
        if (t.voice.setGlide) t.voice.setGlide(t.glide);
      } catch (e) { console.error("voice init failed for", t.name, e); }
    }
    try { routeVoiceToRack(t); } catch (e) { console.warn("route failed for", t.name, e); }
  }
  state.ready = true;
  for (const t of state.tracks) { try { syncAllLFOs(t); } catch (e) { console.warn("lfo sync failed", e); } }
}

async function ensureMidi() {
  if (state.midi || !navigator.requestMIDIAccess) return state.midi;
  state.midi = await navigator.requestMIDIAccess({ sysex: false });
  const refresh = () => {
    for (const t of state.tracks) if (engineByKey(t.engineKey)?.type === "midi") updateMidiUI(t);
  };
  state.midi.addEventListener("statechange", refresh);
  refresh();
  return state.midi;
}

function silenceAllVoices() {
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of state.tracks) {
    try { t.voice?.silence(now); } catch {}
  }
}

// ---- audio bounce (WAV / WebM) ----------------------------------------
// Render the current pattern(s) by capturing live playback via a
// MediaStreamDestinationNode + MediaRecorder. Optional post-decode to 16-bit
// PCM WAV.
async function bounceAudio({ bars = 1, format = "wav", chainWhole = false, filename = null, fileStem = "bounce" } = {}) {
  await ensureAudio();
  const ctx = state.audioCtx;
  const recDest = ctx.createMediaStreamDestination();
  state.masterGain.connect(recDest);
  // Silent render: temporarily disconnect masterGain from ctx.destination so the
  // user doesn't hear the bounce; the recorder still gets the signal via recDest.
  try { state.masterGain.disconnect(ctx.destination); } catch {}
  const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
  const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported?.(m)) || "";
  const rec = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  // Reset transport to the top of pattern 1 and start fresh.
  if (state.playing) await togglePlay();
  if (state.activePattern !== 0) switchPattern(0);

  const bpm = currentBpm();
  const durSec = bars * 4 * (60 / bpm);

  const prevMode = state.patternMode;
  if (chainWhole) {
    state.patternMode = "chain";
    const modeBtn = document.getElementById("pattern-mode");
    if (modeBtn) {
      modeBtn.setAttribute("aria-pressed", "true");
      try { modeBtn.innerHTML = ICON_CHAIN; } catch {}
    }
  }

  // Progress dialog — ticks once per animation frame until total elapsed matches
  // the render duration + tail. Auto-closes when the render completes.
  const totalSec = durSec + 0.4;
  const progress = openBounceProgressDialog({ totalSec, bars, format });

  rec.start();
  await togglePlay();                    // start playback
  // wait for the requested duration + a small tail so reverbs + releases finish
  await new Promise(r => setTimeout(r, totalSec * 1000));
  if (state.playing) await togglePlay(); // stop
  rec.stop();
  await stopped;
  try { state.masterGain.disconnect(recDest); } catch {}
  try { state.masterGain.connect(ctx.destination); } catch {}

  if (chainWhole) {
    state.patternMode = prevMode;
    const modeBtn = document.getElementById("pattern-mode");
    if (modeBtn) {
      modeBtn.setAttribute("aria-pressed", String(prevMode === "chain"));
      try { modeBtn.innerHTML = prevMode === "chain" ? ICON_CHAIN : ICON_REPEAT; } catch {}
    }
  }

  progress.setStatus("encoding…");
  const raw = new Blob(chunks, { type: mime || "audio/webm" });
  let out, ext;
  if (format === "wav") {
    try {
      const buf = await ctx.decodeAudioData(await raw.arrayBuffer());
      out = audioBufferToWav(buf);
      ext = "wav";
    } catch (err) {
      console.warn("wav encode failed, falling back to raw recording:", err);
      out = raw;
      ext = mime.includes("mp4") ? "mp4" : "webm";
    }
  } else {
    out = raw;
    ext = mime.includes("mp4") ? "mp4" : "webm";
  }
  progress.close();
  const stem = (filename && filename.trim()) || `seqbaby-${fileStem}-${Date.now()}`;
  const finalName = /\.(wav|webm|mp4)$/i.test(stem) ? stem : `${stem}.${ext}`;
  downloadBlob(out, finalName);
}

// A non-interactive modal that shows a progress bar + label while a bounce is
// running. Returns { setStatus(text), close() }. Drives the bar via rAF so it
// reads the wall-clock elapsed time rather than audio-thread state.
function openBounceProgressDialog({ totalSec, bars, format }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-title">rendering audio</div>
      <div class="bounce-progress-label">${bars} bar${bars === 1 ? "" : "s"} → ${format}</div>
      <div class="bounce-progress-bar"><div class="bounce-progress-fill"></div></div>
      <div class="bounce-progress-status">capturing…</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const fill = overlay.querySelector(".bounce-progress-fill");
  const statusEl = overlay.querySelector(".bounce-progress-status");
  const startedAt = performance.now();
  let closed = false;
  const tick = () => {
    if (closed) return;
    const elapsed = (performance.now() - startedAt) / 1000;
    const pct = Math.max(0, Math.min(100, (elapsed / totalSec) * 100));
    fill.style.width = pct.toFixed(1) + "%";
    if (pct < 100) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    setStatus: (msg) => { statusEl.textContent = msg; fill.style.width = "100%"; },
    close: () => { closed = true; overlay.remove(); },
  };
}

// Total bars across every non-empty pattern (respecting per-pattern repeat counts).
function trackTotalBars() {
  let bars = 0;
  for (let i = 0; i < PATTERN_COUNT; i++) {
    if (!isPatternNonEmpty(i)) continue;
    bars += Math.max(1, state.patternRepeats?.[i] ?? 1);
  }
  return Math.max(1, bars);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Encode a mono/stereo AudioBuffer to a 16-bit PCM WAV blob.
function audioBufferToWav(buffer) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const blockAlign = ch * 2;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, dataSize, true);
  const channels = [];
  for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

function showBounceDialog({ mode = "pattern" } = {}) {
  const isTrack = mode === "track";
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const bars = isTrack ? trackTotalBars() : Math.max(1, Math.ceil((state.tracks[0]?.length ?? 16) / 16));
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const suggested = suggestBounceFilename(mode);
    const note = isTrack
      ? `chains through every non-empty pattern (${bars} bar${bars === 1 ? "" : "s"}) at ${currentBpm()} bpm.`
      : `captures the current pattern (${bars} bar${bars === 1 ? "" : "s"}) at ${currentBpm()} bpm.`;
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">${isTrack ? "download session as audio" : "download pattern as audio"}</div>
        <div class="bounce-opts">
          <label>file name <input class="b-name" type="text" value="${esc(suggested)}" /></label>
        </div>
        <div class="bounce-note">${note}</div>
        <div class="modal-actions">
          <button class="modal-cancel ghost">cancel</button>
          <button class="modal-ok">${isTrack ? "download session" : "download pattern"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const nameInput = overlay.querySelector(".b-name");
    setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch {} }, 0);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector(".modal-ok").addEventListener("click", () => {
      const filename = (nameInput.value || suggested).trim();
      close({ bars, format: "wav", filename });
    });
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

// Match the session-save button's suggested name exactly.
function suggestBounceFilename() {
  return suggestSetName();
}

async function togglePlay() {
  const btn = document.getElementById("play");
  if (state.playing) {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    if (state.repeatId !== null) { Tone.Transport.clear(state.repeatId); state.repeatId = null; }
    // Fast master-gain cut. Tone synth triggerAttackRelease calls issued by the
    // last few scheduleRepeat callbacks live inside Tone's ~100 ms lookahead and
    // are already queued as native Web Audio events — stopping the Transport
    // doesn't unschedule them. Ramping master to 0 for a beat makes them inaudible
    // so stop actually stops. togglePlay restores the gain on the next start.
    if (state.masterGain && state.audioCtx) {
      const now = state.audioCtx.currentTime;
      const g = state.masterGain.gain;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.02);
      } catch {}
    }
    silenceAllVoices();
    state.playing = false;
    btn.textContent = "play";
    btn.classList.remove("playing");
    state.tick = 0;
    for (const t of state.tracks) { t.trackTick = 0; t.speedAccum = 0; }
    paintNowIndicator();
    setStatus("stopped");
    return;
  }
  setStatus("unlocking audio...");
  try {
    await ensureAudio();
  } catch (err) {
    console.error("ensureAudio failed:", err);
    setStatus("audio init failed — see console", true);
    return;
  }
  Tone.Transport.bpm.value = Number(document.getElementById("bpm").value);
  // Per-track swing is applied manually in the transport loop; keep Tone's global swing disabled.
  Tone.Transport.swing = 0;
  Tone.Transport.swingSubdivision = "16n";

  if (state.repeatId !== null) Tone.Transport.clear(state.repeatId);
  state.tick = 0;
  for (const t of state.tracks) { t.trackTick = 0; t.speedAccum = 0; }
  // Restore master gain — the stop branch ramps it to 0 to kill the lookahead-
  // queued tail of Tone synth events that Transport.stop() can't unschedule.
  if (state.masterGain && state.audioCtx) {
    const now = state.audioCtx.currentTime;
    const g = state.masterGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + 0.02);
    } catch {}
  }
  state.repeatId = Tone.Transport.scheduleRepeat((time) => {
    const baseStepDur = Tone.Time("16n").toSeconds();
    const anySolo = state.tracks.some(t => t.soloed);
    const masterSwing = Number(document.getElementById("swing")?.value) || 0;
    for (const t of state.tracks) {
      if (!t.voice) continue;
      if (anySolo ? !t.soloed : t.muted) continue;
      const speed = Math.max(0.0001, t.speed ?? 1);
      const effDur = baseStepDur / speed;
      t.speedAccum = (t.speedAccum ?? 0) + speed;
      let slot = 0; // sub-tick offset (for speed > 1, multiple steps per global tick)
      while (t.speedAccum >= 1) {
        t.speedAccum -= 1;
        const idx = (t.trackTick ?? 0) % t.length;
        t.trackTick = (t.trackTick ?? 0) + 1;
        // Automation runs every step regardless of whether a note fires.
        const autoTime = Math.max(state.audioCtx.currentTime + 0.002, time + slot * effDur);
        runAutomationForStep(t, idx, autoTime, effDur);
        if (!t.steps[idx]) { slot++; continue; }
        const span = Math.max(1, t.lengths[idx] || 1);
        const duration = span * effDur;
        const swingOffset = (idx % 2 === 1) ? effDur * masterSwing : 0;
        const microOffset = (t.offsets?.[idx] ?? 0) * effDur;
        const hitTime = Math.max(state.audioCtx.currentTime + 0.002,
          time + slot * effDur + swingOffset + microOffset);
        const root = noteForStep(t, idx);
        const vel = t.velocities[idx] ?? 0.5;
        const chord = t.chords[idx] || "";
        const arp = !!(t.arps && t.arps[idx]);
        const cpx = (t.complexities && t.complexities[idx]) || 0;
        let notes = chord ? chordNotes(root, chord) : [root];
        if (chord && cpx) notes = invertChord(notes, cpx);
        const list = (t.voice.poly && !arp) ? notes : (arp ? notes : [notes[0]]);
        // Sample-based voices play longer than the step; extend the envelope sustain
        // so the ADSR actually shapes the whole sample, not just the first few ms.
        const sampleDur = (t.voice.buffer && ["sample","eleven","upload"].includes(t.voice.type))
          ? (t.voice.buffer.duration || 0)
          : 0;
        const envDur = Math.max(duration, sampleDur);
        try { fireFilterEnv(t, hitTime, envDur); } catch (e) { console.warn(e); }
        if (arp && notes.length > 1) {
          // classic arpeggiator: rate (beats per note) × range (octaves) × direction
          const rateBeats = t.arpRates?.[idx] ?? 0.25;
          const rateSec = Math.max(0.02, rateBeats * (60 / currentBpm()));
          const range = Math.max(1, Math.min(4, t.arpRanges?.[idx] ?? 1));
          const dir = t.arpDirs?.[idx] ?? "up";
          let expanded = [];
          for (let o = 0; o < range; o++) for (const n of notes) expanded.push(n + o * 12);
          let seq;
          if (dir === "down") seq = expanded.slice().reverse();
          else if (dir === "updown") {
            seq = expanded.concat(expanded.slice(0, -1).reverse().slice(0, -1));
            if (seq.length === 0) seq = expanded;
          } else if (dir === "random") {
            seq = expanded.slice();
            for (let k = seq.length - 1; k > 0; k--) {
              const j = Math.floor(Math.random() * (k + 1));
              [seq[k], seq[j]] = [seq[j], seq[k]];
            }
          } else seq = expanded;
          const count = Math.max(1, Math.floor(duration / rateSec));
          for (let k = 0; k < count; k++) {
            const n = seq[k % seq.length];
            try { t.voice.hit(n, hitTime + k * rateSec, rateSec * 0.92, vel); } catch (e) { console.warn(e); }
          }
        } else {
          const sampleOpts = (t.voice.type === "eleven" || t.voice.type === "upload" || t.voice.type === "sample")
            ? {
                startOffset: t.sampleStarts?.[idx] ?? 0,
                endOffset:   t.sampleEnds?.[idx]   ?? 1,
                fadeIn:      t.sampleFadeIns?.[idx]  ?? 0,
                fadeOut:     t.sampleFadeOuts?.[idx] ?? 0,
                loopMode:    t.sampleLoopModes?.[idx] ?? "off",
                pitchBase:   t.isDrumKit ? 36 : 60,
                // Propagate the time-sync mode so the voice can re-fit the rate
                // to the trimmed slice (1× bpm should fit a bar whether the
                // user plays the whole buffer or a quarter of it).
                sampleSpeedMode: t.sampleSpeedMode,
              }
            : null;
          const ratchet = Math.max(1, Math.min(8, Math.round(t.ratchets?.[idx] ?? 1)));
          if (ratchet > 1 && !chord) {
            // retrigger the single note N times evenly across the step
            const sub = duration / ratchet;
            for (let r = 0; r < ratchet; r++) {
              for (const n of list) {
                try { t.voice.hit(n, hitTime + r * sub, sub * 0.92, vel, sampleOpts); } catch (e) { console.warn(e); }
              }
            }
          } else {
            for (const n of list) {
              try { t.voice.hit(n, hitTime, duration, vel, sampleOpts); } catch (e) { console.warn(e); }
            }
          }
        }
        slot++;
      }
    }
    Tone.Draw.schedule(paintNowIndicator, time);
    Tone.Draw.schedule(() => paintBeatIndicator(state.tick), time);
    if (state.metronome && state.tick % 4 === 0) fireMetronome(time, state.tick % 16 === 0);
    state.tick++;
    // manual pattern queue: when switch-mode is "finish" and the user queued a
    // different pattern, commit at the next bar boundary.
    if (state.patternSwitchMode === "finish" && state.queuedPattern !== null && state.tick % BAR_TICKS === 0) {
      const next = state.queuedPattern;
      Tone.Draw.schedule(() => switchPattern(next), time);
    }
    // pattern chaining: advance at bar boundaries when chain mode is on, respecting per-pattern repeats
    if (state.patternMode === "chain" && state.tick % BAR_TICKS === 0) {
      state.chainBarCount++;
      const needed = Math.max(1, state.patternRepeats[state.activePattern] ?? 1);
      if (state.chainBarCount >= needed) {
        state.chainBarCount = 0;
        const next = findNextNonEmptyPattern(state.activePattern);
        if (next >= 0 && next !== state.activePattern) {
          Tone.Draw.schedule(() => switchPattern(next), time);
        }
      }
    }
  }, "16n");

  // Start in 100 ms with offset 0. The +0.1 lookahead keeps the first "16n"
  // callbacks from landing at `time < currentTime` on cold start (context drifted
  // forward during ensureAudio) — the Math.max clamp above would otherwise pile
  // their hits onto the same instant, making the first bar unplayable. The
  // explicit offset 0 is the canonical way to rewind, avoiding the stop/cancel/
  // position dance which in Tone 15 can leave the first events unscheduled.
  Tone.Transport.start("+0.1", 0);
  state.playing = true;
  btn.textContent = "stop";
  btn.classList.add("playing");
  setStatus("playing");
}

function noteForStep(t, idx) {
  const raw = t.notes[idx];
  let n;
  if (typeof raw === "number" && Number.isFinite(raw)) n = raw;
  else if (typeof raw === "string") { const m = nameToMidi(raw); n = m != null ? m : (engineByKey(t.engineKey)?.defaultNote ?? 60); }
  else n = engineByKey(t.engineKey)?.defaultNote ?? 60;
  return applyScale(n);
}

// ---- prompting ---------------------------------------------------------

function setStatus(msg, isErr = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
}

async function pickAudioFileForTrack(t) {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac";
    inp.style.display = "none";
    document.body.appendChild(inp);
    let resolved = false;
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      inp.remove();
      if (!file) { if (!resolved) resolve(false); resolved = true; return; }
      try {
        setStatus(`loading "${file.name}"...`);
        const arrayBuf = await file.arrayBuffer();
        await ensureAudio();
        // decodeAudioData mutates the buffer, so keep a copy for persistence
        const persistBytes = arrayBufferToBase64(arrayBuf.slice(0));
        const audioBuf = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(arrayBuf));
        t.uploadBuffer = audioBuf;
        t.uploadAudio = persistBytes;
        t.uploadAudioMime = file.type || "audio/wav";
        t.uploadFileName = file.name;
        t.soundPromptText = file.name;
        if (t.engineKey === "upload" && t.voice?.type === "upload") {
          t.voice.setBuffer(audioBuf);
        } else {
          setEngineKey(t, "upload");
          if (t.el) t.el.querySelector(".track-engine").value = "upload";
        }
        applySampleSpeed(t);
        setStatus(`"${t.name}" ← ${file.name} (${Math.round(audioBuf.duration * 1000)}ms)`);
        resolve(true);
      } catch (err) {
        console.error(err);
        setStatus(`failed to load "${file.name}"`, true);
        resolve(false);
      }
    }, { once: true });
    // if user cancels the picker there's no "cancel" event; fall back to a short timeout
    window.addEventListener("focus", () => {
      setTimeout(() => { if (!resolved && !inp.files?.length) { resolved = true; inp.remove(); resolve(false); } }, 300);
    }, { once: true });
    inp.click();
  });
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---- scale UI ----------------------------------------------------------

function syncScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  on.checked = state.scale.active;
  root.value = String(state.scale.root);
  mode.value = state.scale.mode;
}

function initScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  // populate roots
  root.replaceChildren();
  NOTE_NAMES.forEach((n, i) => {
    const opt = document.createElement("option");
    opt.value = String(i); opt.textContent = n;
    root.appendChild(opt);
  });
  // populate modes
  mode.replaceChildren();
  Object.keys(SCALES).filter(m => m !== "off").forEach(m => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    mode.appendChild(opt);
  });
  syncScaleUI();
  // Scale changes affect both the open piano-roll panels (visible pitch rows)
  // and the step-grid note coloring on every track — re-render both.
  const refreshOnScaleChange = () => {
    for (const t of state.tracks) {
      refreshRollIfOpen(t);
      renderStepGrid(t);
    }
  };
  on.addEventListener("change", () => { state.scale.active = on.checked; refreshOnScaleChange(); });
  root.addEventListener("change", () => { state.scale.root = Number(root.value); refreshOnScaleChange(); });
  mode.addEventListener("change", () => { state.scale.mode = mode.value; refreshOnScaleChange(); });

  // Palette toggle — diatonic pitch-class coloring on/off.
  const palBtn = document.getElementById("note-colors");
  if (palBtn) {
    palBtn.innerHTML = ICON_PALETTE;
    palBtn.setAttribute("aria-pressed", String(state.noteColors));
    palBtn.addEventListener("click", () => {
      state.noteColors = !state.noteColors;
      palBtn.setAttribute("aria-pressed", String(state.noteColors));
      refreshOnScaleChange();
    });
  }
}

// ---- init --------------------------------------------------------------

// ---- level meters -------------------------------------------------------

const _meterTmp = new Uint8Array(1024);
function samplePeak(analyser) {
  const n = Math.min(analyser.fftSize, _meterTmp.length);
  analyser.getByteTimeDomainData(_meterTmp);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(_meterTmp[i] - 128);
    if (v > peak) peak = v;
  }
  return peak / 128;                 // 0..1
}
function paintMeter(el, level) {
  if (!el) return;
  const bar = el.querySelector(".meter-bar");
  if (!bar) return;
  const clamped = Math.max(0, Math.min(1, level));
  // Near-linear response with a mild pow so quiet signals stay visible. The bar
  // is green until the source is clipping (peak >= 0.995), then flashes red.
  const pct = Math.round(Math.pow(clamped, 0.85) * 100);
  bar.style.width = pct + "%";
  bar.classList.toggle("clip", level >= 0.995);
}
function meterTick() {
  if (state.masterAnalyser) {
    paintMeter(document.querySelector(".master-meter"), samplePeak(state.masterAnalyser));
  }
  for (const t of state.tracks) {
    if (!t.meterAnalyser || !t.el) continue;
    paintMeter(t.el.querySelector(".track-meter"), samplePeak(t.meterAnalyser));
  }
  requestAnimationFrame(meterTick);
}

function init() {
  // Create the AudioContext and bind Tone to it BEFORE anything reads
  // Tone.Transport. Tone.Transport's internal Clock latches onto the context's
  // time at first access; if we defer this to the play-click handler, Tone's
  // default context has already been ticking for several seconds and the clock
  // stays anchored there, so Transport.start("+0.1") resolves to "default-ctx
  // time + 0.1", which is several seconds in the future against our fresh
  // AudioContext. Diagnostics confirmed: drift == time from page load to click.
  // Creating the context here is fine — it starts suspended and Tone.start()
  // resumes it inside the user gesture.
  state.audioCtx = new AudioContext({ latencyHint: "interactive" });
  Tone.setContext(state.audioCtx);
  rebuildEngineCatalog();
  requestAnimationFrame(meterTick);

  document.getElementById("play").addEventListener("click", togglePlay);
  buildBeatIndicator();
  paintBeatIndicator(1);
  const metroBtn = document.getElementById("metronome");
  if (metroBtn) {
    metroBtn.innerHTML = ICON_METRONOME;
    metroBtn.addEventListener("click", () => {
      state.metronome = !state.metronome;
      metroBtn.setAttribute("aria-pressed", String(state.metronome));
    });
  }
  const runBounce = async (btnId, mode) => {
    const opts = await showBounceDialog({ mode });
    if (!opts) return;
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "rendering…";
    setStatus(`rendering ${opts.bars} bar${opts.bars === 1 ? "" : "s"} to ${opts.format}…`);
    try {
      await bounceAudio({
        bars: opts.bars,
        format: opts.format,
        chainWhole: mode === "track",
        fileStem: mode === "track" ? "session" : "pattern",
        filename: opts.filename,
      });
      setStatus(`render ready — downloaded`);
    } catch (err) {
      console.error(err);
      setStatus(`render failed — see console`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
  document.getElementById("bounce-audio")?.addEventListener("click", () => runBounce("bounce-audio", "pattern"));
  document.getElementById("bounce-track")?.addEventListener("click", () => runBounce("bounce-track", "track"));
  for (const btn of document.querySelectorAll(".dl-btn .dl-icon")) btn.innerHTML = ICON_DOWNLOAD;
  document.getElementById("bpm").addEventListener("input", e => {
    if (state.ready) Tone.Transport.bpm.value = Number(e.target.value);
    retuneSyncedLFOs();
    for (const t of state.tracks) {
      if (t.fxRack && t.fxConfig.delay.sync) t.fxRack.applyDelay({});
      applySampleSpeed(t);
    }
    for (const t of state.tracks) {
      for (const key of LFO_KEYS) {
        if (!t.lfoConfig[key].sync) continue;
        const row = t.el.querySelector(`.lfo-row[data-key="${key}"]`);
        if (!row) continue;
        const lbl = row.querySelector(".lfo-rate-label");
        const divSel = row.querySelector(".lfo-div");
        const opt = divSel.options[divSel.selectedIndex];
        lbl.textContent = `${opt ? opt.textContent : t.lfoConfig[key].div} · ${rateFromSync(t.lfoConfig[key].div).toFixed(2)} hz`;
      }
    }
  });
  // Master swing — read live by the transport loop each callback; no per-track
  // swing state to mirror anymore.
  document.getElementById("swing").addEventListener("input", () => {});
  document.getElementById("add-track").addEventListener("click", () => {
    createTrack({ name: `track ${state.tracks.length + 1}`, engineKey: "plaits:0" });
  });

  const modeBtn = document.getElementById("pattern-mode");
  const syncModeLabel = () => {
    modeBtn.innerHTML = state.patternMode === "chain" ? ICON_CHAIN : ICON_REPEAT;
    modeBtn.title = state.patternMode === "chain"
      ? "chain: advance through non-empty patterns (click to switch to repeat)"
      : "repeat: loop current pattern (click to switch to chain)";
    modeBtn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
  };
  syncModeLabel();
  modeBtn.addEventListener("click", () => {
    state.patternMode = state.patternMode === "chain" ? "repeat" : "chain";
    syncModeLabel();
  });
  const switchBtn = document.getElementById("pattern-switch");
  if (switchBtn) {
    const syncSwitchLabel = () => {
      switchBtn.innerHTML = state.patternSwitchMode === "finish" ? ICON_FINISH : ICON_NOW;
      switchBtn.title = state.patternSwitchMode === "finish"
        ? "switch: finish — wait for the current bar to end before switching"
        : "switch: now — switch patterns immediately";
      switchBtn.setAttribute("aria-pressed", String(state.patternSwitchMode === "finish"));
    };
    syncSwitchLabel();
    switchBtn.addEventListener("click", () => {
      state.patternSwitchMode = state.patternSwitchMode === "finish" ? "immediate" : "finish";
      syncSwitchLabel();
      // Flipping back to immediate commits any currently queued switch right away.
      if (state.patternSwitchMode === "immediate" && state.queuedPattern !== null) {
        switchPattern(state.queuedPattern);
      }
    });
  }
  document.getElementById("set-save").addEventListener("click", onSaveSet);
  document.getElementById("set-load").addEventListener("click", onLoadSet);
  document.getElementById("set-export").addEventListener("click", onExportSet);
  document.getElementById("set-import").addEventListener("click", onImportSet);
  document.getElementById("set-share").addEventListener("click", onShareSet);
  document.getElementById("pattern-dup").addEventListener("click", () => {
    const next = (state.activePattern + 1) % PATTERN_COUNT;
    copyPattern(state.activePattern, next);
    switchPattern(next);
  });
  document.getElementById("pattern-repeats").addEventListener("change", e => {
    const v = Math.max(1, Math.min(16, Number(e.target.value) || 1));
    e.target.value = v;
    state.patternRepeats[state.activePattern] = v;
  });
  const meterSel = document.getElementById("pattern-meter");
  if (meterSel) {
    meterSel.addEventListener("change", () => {
      const m = parseMeter(meterSel.value);
      if (!m) return;
      const patIdx = state.activePattern;
      const prev = state.patternMeters[patIdx] || { num: 4, den: 4 };
      state.patternMeters[patIdx] = m;
      if (patIdx === 0) {
        // Pattern 1 is the source: sync the meter (only) into every slot that
        // hasn't been explicitly customized. Their step counts stay put.
        for (let i = 1; i < PATTERN_COUNT; i++) {
          if (!state.patternMeterCustomized[i]) state.patternMeters[i] = { num: m.num, den: m.den };
        }
      } else {
        // User set a non-#1 pattern's meter explicitly — lock it off from #1.
        state.patternMeterCustomized[patIdx] = true;
      }
      // Resize every track on the active pattern to preserve its bar count under
      // the new meter (e.g. 1 bar of 4/4 = 16 steps → 1 bar of 7/8 = 14). Tracks
      // that already match just get their accents + step grid refreshed.
      const oldSpb = stepsPerBarForMeter(prev);
      const newSpb = stepsPerBarForMeter(m);
      for (const t of state.tracks) {
        const bars = Math.max(1, Math.round((t.length || newSpb) / oldSpb));
        const newLen = Math.max(1, Math.min(128, bars * newSpb));
        if (newLen !== t.length) {
          resizePattern(t, patIdx, newLen);
        } else {
          t.accents = autoAccents(t.length, m);
          renderStepGrid(t);
        }
      }
      paintBeatIndicator(state.tick);
    });
  }
  renderPatternGrid();

  initScaleUI();

  // starter kit
  createTrack({ name: "kick",   engineKey: "dm:808-kick" });
  createTrack({ name: "snare",  engineKey: "dm:808-snare" });
  createTrack({ name: "hat",    engineKey: "dm:909-chat" });
  createTrack({ name: "accent", engineKey: "plaits:12" });
  createTrack({ name: "bass",   engineKey: "dm:303" });
  createTrack({ name: "lead",   engineKey: "plaits:0" });

  setStatus("ready");
  // if the URL carries ?s=<id>, pull that shared session
  loadShareFromUrl();
  // Close the AudioContext on page hide. Chrome reuses its audio process across
  // tab reloads; a leaked AudioContext from the previous page leaves the worklet
  // graph and clock in a degraded state, which surfaces as "first play is delayed
  // and out of sync after a refresh — only a full browser restart clears it".
  window.addEventListener("pagehide", () => {
    try { Tone.Transport.stop(); } catch {}
    try { state.audioCtx?.close(); } catch {}
  });
}

init();
