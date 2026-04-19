// seqbaby — Plaits / drum synth / sample / MIDI step sequencer

const { wosc, oscillatorTypes } = window.woscillators;

const STEPS_PER_BAR = 16;
const LFO_KEYS = ["vol", "harm", "timb", "morph", "decay", "cutoff", "reson", "fuzz", "delay", "verb"];
// How much each target swings per unit of depth:
//  - 0..1 unit params: amp = depth/2 (swings ±0.5)
//  - cutoff: depth*3000 Hz
//  - reson: depth*10 (Q units)
const LFO_AMP_SCALE = {
  vol: 1, harm: 1, timb: 1, morph: 1, decay: 1,
  cutoff: 6000,   // Hz
  reson: 15,
  fuzz: 1, delay: 1, verb: 1,
};

const STARTER_PROMPTS = [
  "dusty lo-fi hip-hop, vinyl crackle, head-nod tempo",
  "melodic minor techno, hypnotic pulse, 122 bpm",
  "ambient dub, distant echoes, slow chord swell",
  "acid house, squelchy 303 bassline, four on the floor",
  "broken beat, syncopated kicks, off-beat hats",
  "dark drum and bass, amen feel, sub bass pressure",
  "minimal clicky techno, spare and dry, ticking clock",
  "dub techno, long delay on hats, muted chord stabs",
  "trip-hop, filtered samples, smoky snare",
  "psychedelic krautrock, motorik drums, modal drone",
  "cold-wave synths, gated snare, haunted pad",
  "neo-noir downtempo, moody rhodes, brushy kit",
];
function pickStarterPrompt() {
  return STARTER_PROMPTS[Math.floor(Math.random() * STARTER_PROMPTS.length)];
}

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
  { key: "dm:mini-brute", label: "mini brute", defaultNote: 60, poly: true, melodic: true },
  { key: "dm:moog",       label: "moog",       defaultNote: 60, poly: true, melodic: true },
  { key: "dm:juno",       label: "juno 60",    defaultNote: 60, poly: true, melodic: true },
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

const CUSTOM_ENGINE = {
  key: "custom", label: "prompted tone.js patch", group: "custom", type: "custom",
  defaultNote: 60, poly: true, melodic: true,
};

const ELEVEN_ENGINE = {
  key: "eleven", label: "prompted eleven-labs sample", group: "eleven labs", type: "eleven",
  defaultNote: 60, poly: true, melodic: true,
};

const UPLOAD_ENGINE = {
  key: "upload", label: "upload a sample…", group: "user samples", type: "upload",
  defaultNote: 60, poly: true, melodic: true,
};

function buildEngineCatalog() {
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, ...ANALOG_ENGINES, CUSTOM_ENGINE, ELEVEN_ENGINE, UPLOAD_ENGINE, ...savedPatchEntries(), ...SAMPLE_ENGINES, MIDI_ENGINE];
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

function quantizeToScale(midi, rootPc, intervals) {
  if (!intervals) return midi;
  const target = Math.round(midi);
  let best = target;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d++) {
    const pc = ((target + d) % 12 + 12) % 12;
    const relative = ((pc - rootPc) % 12 + 12) % 12;
    if (intervals.includes(relative)) {
      if (Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = target + d;
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
  const pos = intervals.indexOf(pcDiff);
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

// ---- state --------------------------------------------------------------

const PATTERN_COUNT = 32;
const BAR_TICKS = 16;  // chain advance resolution

// ---- generation cancellation ------------------------------------------

let genController = null;
function startGen() {
  genController?.abort();
  genController = new AbortController();
  const btn = document.getElementById("gen-cancel");
  if (btn) btn.hidden = false;
  return genController.signal;
}
function endGen() {
  genController = null;
  const btn = document.getElementById("gen-cancel");
  if (btn) btn.hidden = true;
}
function cancelGen() {
  const c = genController;
  genController = null;
  c?.abort();
  const btn = document.getElementById("gen-cancel");
  if (btn) btn.hidden = true;
  setStatus("cancelled", true);
}
function isAbortError(err) {
  return err && (err.name === "AbortError" || err.code === 20 || /aborted/i.test(String(err.message)));
}
function currentSignal() { return genController?.signal; }

// ---- undo for generate actions -----------------------------------------
// Single-slot undo: every generate (master or per-track) snapshots the full
// session before running. Undo restores that snapshot. Both master and per-
// track undo buttons point at the same snapshot.
function pushUndoSnapshot(label) {
  try {
    state.undoSnapshot = { session: serializeSet(), label: String(label || "last generate") };
  } catch (err) {
    console.warn("undo snapshot failed", err);
    state.undoSnapshot = null;
  }
  refreshUndoUI();
}
function undoLastGenerate() {
  const snap = state.undoSnapshot;
  if (!snap) return;
  state.undoSnapshot = null;
  try {
    applySet(snap.session);
    setStatus(`undid: ${snap.label}`);
  } catch (err) {
    console.error(err);
    setStatus("undo failed — see console", true);
  }
  refreshUndoUI();
}
function refreshUndoUI() {
  const has = !!state.undoSnapshot;
  const m = document.getElementById("master-undo");
  if (m) {
    m.hidden = !has;
    if (has) m.title = `undo: ${state.undoSnapshot.label}`;
  }
  for (const t of state.tracks) {
    const b = t.el?.querySelector(".prompt-undo");
    if (b) b.hidden = !has;
  }
}

const state = {
  tracks: [],
  playing: false,
  tick: 0,
  repeatId: null,
  nextId: 1,
  undoSnapshot: null,
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
  }
  renderPatternGrid();
  // default instruments toggle: on for pattern 1, off for all others (user can still override)
  const instBtn = document.getElementById("gen-instruments");
  if (instBtn) instBtn.setAttribute("aria-pressed", String(idx === 0));
  const repInput = document.getElementById("pattern-repeats");
  if (repInput) repInput.value = state.patternRepeats[idx] ?? 1;
  state.chainBarCount = 0;
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
      })),
    })),
  };
}

async function onSaveSet() {
  const name = await showInputDialog({ title: "save set as", placeholder: "my-session" });
  if (!name || !name.trim()) return;
  const all = loadSetsMap();
  all[name.trim()] = serializeSet();
  storeSetsMap(all);
  setStatus(`saved set "${name.trim()}"`);
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
  const names = Object.keys(all).sort();
  if (!names.length) { setStatus("no saved sets", true); return; }
  const choice = await showSelectDialog({ title: "load set", options: names });
  if (!choice) return;
  if (choice.action === "delete") {
    delete all[choice.value];
    storeSetsMap(all);
    setStatus(`deleted "${choice.value}"`);
    return;
  }
  applySet(all[choice.value]);
}

function applySet(s) {
  if (!s) return;
  state.undoSnapshot = null;
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
  state.patternMode = s.patternMode === "chain" ? "chain" : "repeat";
  const modeBtn = document.getElementById("pattern-mode");
  modeBtn.textContent = state.patternMode;
  modeBtn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
  state.patternSwitchMode = s.patternSwitchMode === "finish" ? "finish" : "immediate";
  const switchBtn = document.getElementById("pattern-switch");
  if (switchBtn) {
    switchBtn.textContent = state.patternSwitchMode === "finish" ? "switch: finish" : "switch: now";
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
        t.patterns[i] = {
          steps: pad(p.steps, 0, t.length),
          lengths: pad(p.lengths, 0, t.length),
          notes: pad(p.notes, null, t.length),
          velocities: pad(p.velocities, 0.5, t.length),
          chords: pad(p.chords, "", t.length),
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
        t.fxRack.applyFuzz(t.fxConfig.fuzz);
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
  setStatus("set loaded");
}

function showSelectDialog({ title, options }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const opts = options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
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
  refreshVariateButton();
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
  const n = Math.round(Number(m));
  if (!Number.isFinite(n)) return "";
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
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
    fuzz:   { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
    crush:  { bits: 8, wet: 0 },
    delay:  { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb: { decay: 2, wet: 0 },
  };
}

class FXRack {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;

    // Using native Web Audio for the fuzz chain (simpler + predictable); Tone for delay/reverb
    this.input = ctx.createGain();
    this.dryBus = ctx.createGain();
    this.wetBus = ctx.createGain();
    this.fuzzDrive = ctx.createGain();
    this.fuzzShaper = ctx.createWaveShaper();
    this.fuzzShaper.oversample = "4x";
    this.fuzzFilter = ctx.createBiquadFilter();
    this.fuzzFilter.type = "lowpass";
    this.fuzzFilter.Q.value = 2.2;
    this.fuzzLevel = ctx.createGain();

    // dry path
    this.input.connect(this.dryBus);
    // wet path
    this.input.connect(this.fuzzDrive);
    this.fuzzDrive.connect(this.fuzzShaper);
    this.fuzzShaper.connect(this.fuzzFilter);
    this.fuzzFilter.connect(this.fuzzLevel);
    this.fuzzLevel.connect(this.wetBus);

    // merge
    this.postFuzz = ctx.createGain();
    this.dryBus.connect(this.postFuzz);
    this.wetBus.connect(this.postFuzz);

    // Tone effects chained after fuzz: crusher → delay → reverb
    this.crusher = new Tone.BitCrusher({
      bits: Math.max(1, Math.min(16, config.crush?.bits ?? 8)),
      wet: config.crush?.wet ?? 0,
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
    // Native → Tone: target the underlying AudioNode behind each Tone effect's input.
    const crusherIn = this.crusher.input?.input ?? this.crusher.input;
    this.postFuzz.connect(crusherIn);
    this.crusher.connect(this.delay);
    this.delay.connect(this.reverb);
    // Tone → native: Tone handles native destinations via connect()
    this.reverb.connect(this.output);
    this.output.connect(ctx.destination);

    this.applyFuzz(config.fuzz);
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
    try { this.dryBus.disconnect(); } catch {}
    try { this.wetBus.disconnect(); } catch {}
    try { this.fuzzDrive.disconnect(); } catch {}
    try { this.fuzzShaper.disconnect(); } catch {}
    try { this.fuzzFilter.disconnect(); } catch {}
    try { this.fuzzLevel.disconnect(); } catch {}
    try { this.postFuzz.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
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
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease("32n", time, vel), release: () => {} };
    }
    case "808-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.5, release: 0.3 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease("4n", time, vel), release: () => {} };
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
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease("32n", time, vel), release: () => {} };
    }
    case "909-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.6, release: 0.4 },
        harmonicity: 12, modulationIndex: 40, resonance: 7000, octaves: 1,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease("4n", time, vel), release: () => {} };
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
    return null;
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
    const rate = (this.baseRate || 1) * Math.pow(2, (midiNote - pitchBase) / 12);
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
    const rate = (this.baseRate || 1) * Math.pow(2, (midiNote - pitchBase) / 12);
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
  if (["vol","harm","timb","morph","decay"].includes(key)) {
    return t.voice?.getAudioParam(key) ?? null;
  }
  if (key === "cutoff") return t.filterNode?.frequency ?? null;
  if (key === "reson")  return t.filterNode?.Q ?? null;
  if (key === "fuzz")   return t.fxRack?.wetBus?.gain ?? null;
  if (key === "delay")  return t.fxRack?.delay?.wet ?? null;
  if (key === "verb")   return t.fxRack?.reverb?.wet ?? null;
  return null;
}

function syncLFO(t, key) {
  const cfg = t.lfoConfig[key];
  let lfo = t.lfos[key];
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
}

function retuneSyncedLFOs() {
  for (const t of state.tracks) {
    for (const k of LFO_KEYS) {
      if (t.lfoConfig[k].enabled && t.lfoConfig[k].sync) syncLFO(t, k);
    }
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
  const showTimbre = isPlaits || isMiniBrute || isMoog || isJuno;
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
      ? { harm: "pwm rate", timb: "pw",  morph: null,     decay: null }
      : isMoog
      ? { harm: "detune",   timb: null,  morph: null,     decay: "warm" }
      : isJuno
      ? { harm: "pwm rate", timb: "pw",  morph: "chorus", decay: "dec" }
      : { harm: "harm",     timb: "timb", morph: "morph", decay: "decay" };
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
    if (randBtn) randBtn.hidden = isMiniBrute || isMoog || isJuno;
  }
  // Per-oscillator volume sliders: only shown for the analog mono engines.
  const oscGroup = t.el.querySelector(".osc-mix-group");
  if (oscGroup) {
    const showOsc = isMiniBrute || isMoog || isJuno;
    oscGroup.hidden = !showOsc;
    if (showOsc) {
      const oscLabels = isMiniBrute
        ? { osc1: "saw",  osc2: "pulse", osc3: "tri",   osc4: "sub", hide4: false }
        : isJuno
        ? { osc1: "dco",  osc2: "sub",   osc3: "noise", osc4: "",    hide4: true }
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
  cfg.fuzz.amount = 0;
  cfg.delay.wet   = 0;
  cfg.reverb.wet  = 0;
  if (!cfg.crush) cfg.crush = { bits: 8, wet: 0 };
  cfg.crush.wet   = 0;
  if (t.fxRack) {
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
    t.fxRack.applyCrush(cfg.crush);
  }
  refreshFxPanelUI(t);
}

// For prompted sounds: start with a clean signal path so the user hears the designed
// patch as-is. Filter fully open with zero env depth, mod LFOs disabled, fx all dry.
// Controls remain accessible — just zeroed so they can be dialed in intentionally.
function resetProcessingForPromptedSound(t) {
  t.filter.cutoff = 1;
  t.filter.env = 0;
  if (t.filterNode) {
    try {
      t.filterNode.frequency.cancelScheduledValues(state.audioCtx.currentTime);
      t.filterNode.frequency.setValueAtTime(cutoffToHz(1), state.audioCtx.currentTime);
    } catch {}
  }
  for (const k of LFO_KEYS) t.lfoConfig[k].enabled = false;
  if (state.ready) syncAllLFOs(t);
  resetFxDry(t);
  const el = t.el;
  if (el) {
    const cut = el.querySelector(".p-cutoff"); if (cut) cut.value = 1;
    const envAmt = el.querySelector(".p-envamt"); if (envAmt) envAmt.value = 0;
    const modPanel = el.querySelector(".track-mod-panel");
    if (modPanel) renderModPanel(t, modPanel);
  }
}

function setEngineKey(t, newKey) {
  const same = t.engineKey === newKey;
  if (same) { updatePlaitsControlsVisibility(t); return; }
  const e = engineByKey(newKey);
  if (!e) return;
  t.engineKey = newKey;
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

function autoAccents(len) {
  const set = new Set();
  for (let i = 0; i < len; i += 4) set.add(i);
  return set;
}

// Guess whether a track is playing a drum kit based on engine type + name.
// Used only at creation time to seed isDrumKit; the user can flip the toggle after.
function guessIsDrumKit({ engineKey, name }) {
  const eng = engineByKey(engineKey);
  if (eng?.type === "sample") return true;
  const blob = `${engineKey || ""} ${eng?.label || ""} ${name || ""}`.toLowerCase();
  return /\b(kick|snare|hat|hi-?hat|clap|tom|perc|drum)\b/.test(blob);
}

function createTrack({ name, engineKey, length = totalSteps() }) {
  const len = Math.max(1, length);
  const t = {
    id: state.nextId++,
    name,
    engineKey,
    length: len,
    accents: autoAccents(len),
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
    swing: 0,
    sampleSpeedMode: "native",
    density: 0.5,
    speed: 1,
    trackTick: 0,
    repeatId: null,
    soundPromptText: "",
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

function resizeTrack(t, len) {
  len = Math.max(1, Math.min(128, len | 0));
  const pad = (arr, fill) => new Array(len).fill(fill).map((_, i) => arr[i] ?? fill);
  t.length = len;
  for (const p of t.patterns) {
    p.steps      = pad(p.steps, 0);
    p.lengths    = pad(p.lengths, 0);
    p.notes      = pad(p.notes, null);
    p.velocities = pad(p.velocities, 0.5);
    p.chords     = pad(p.chords, "");
    for (let i = 0; i < len; i++) {
      if (p.steps[i]) p.lengths[i] = Math.max(1, Math.min(p.lengths[i] || 1, len - i));
    }
  }
  aliasPattern(t, state.activePattern);
  t.accents = autoAccents(len);
  if (t.el) t.el.querySelector(".track-len").value = len;
  renderStepGrid(t);
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

function startNote(t, anchor) {
  clearRange(t, anchor, anchor, -1);
  t.steps[anchor] = 1;
  t.lengths[anchor] = 1;
  if (t.notes[anchor] == null) {
    // Drum-kit tracks default every new step to C2 regardless of scale. The
    // pitching baseline for their samples is also C2 so that's natural pitch.
    // Other tracks default to C3 (or scale root in octave 3 when a scale is set).
    if (t.isDrumKit) {
      t.notes[anchor] = 36; // C2
    } else {
      const base = state.scale.active ? 48 + (state.scale.root | 0) : 48;
      t.notes[anchor] = applyScale(base);
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

  node.querySelector(".track-name").addEventListener("input", e => { t.name = e.target.value; });
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
  node.querySelector(".track-sound").addEventListener("click", () => promptCustomSound(t));

  const saveBtn = node.querySelector(".track-save");
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
  const densityInput = node.querySelector(".track-density");
  if (densityInput) {
    densityInput.value = t.density ?? 0.5;
    densityInput.addEventListener("input", e => { t.density = Number(e.target.value); });
  }

  const lockInstBtn = node.querySelector(".track-lock-inst");
  const lockPatBtn  = node.querySelector(".track-lock-pat");
  const refreshLockUI = () => {
    lockInstBtn.setAttribute("aria-pressed", String(t.lockInstrument));
    lockPatBtn.setAttribute("aria-pressed", String(t.lockPattern));
    node.classList.toggle("lock-instrument", t.lockInstrument);
    node.classList.toggle("lock-pattern", t.lockPattern);
  };
  refreshLockUI();
  lockInstBtn.addEventListener("click", () => { t.lockInstrument = !t.lockInstrument; refreshLockUI(); });
  lockPatBtn.addEventListener("click",  () => { t.lockPattern    = !t.lockPattern;    refreshLockUI(); });

  const drumKitBtn = node.querySelector(".track-drumkit");
  if (drumKitBtn) {
    const refreshDrumKitUI = () => {
      drumKitBtn.setAttribute("aria-pressed", String(!!t.isDrumKit));
    };
    refreshDrumKitUI();
    drumKitBtn.addEventListener("click", () => {
      t.isDrumKit = !t.isDrumKit;
      refreshDrumKitUI();
      // Flipping drum-kit on retroactively conforms every step note to C2 so
      // existing tracks (e.g. a snare that came back from the planner at D2)
      // line up with the new default.
      if (t.isDrumKit) {
        for (const p of t.patterns) {
          for (let i = 0; i < p.notes.length; i++) {
            if (p.steps[i]) p.notes[i] = 36;
          }
        }
        renderStepGrid(t);
      }
    });
  }

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
  function bindPanelToggle(btnSel, panelSel) {
    const btn = node.querySelector(btnSel);
    const panel = node.querySelector(panelSel);
    btn.addEventListener("click", () => {
      const willOpen = panel.hidden;
      if (willOpen) closeOtherPanels(btnSel);
      panel.hidden = !willOpen;
      btn.setAttribute("aria-pressed", String(willOpen));
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
  const pToggle = node.querySelector(".prompt-pattern-toggle");
  const iToggle = node.querySelector(".prompt-inst-toggle");
  if (pToggle) pToggle.addEventListener("click", () => {
    const pressed = pToggle.getAttribute("aria-pressed") === "true";
    pToggle.setAttribute("aria-pressed", String(!pressed));
  });
  if (iToggle) iToggle.addEventListener("click", () => {
    iToggle.dataset.state = (iToggle.dataset.state || "off") === "off" ? "on" : "off";
  });
  const runTrackGen = () => {
    const regenPattern = !pToggle || pToggle.getAttribute("aria-pressed") === "true";
    const designSound = (iToggle?.dataset.state || "off") === "on";
    if (!regenPattern && !designSound) { setStatus("toggle pattern or instruments first"); return; }
    if (designSound) return promptTrackFull(t, { regenPattern });
    return promptTrack(t);
  };
  node.querySelector(".prompt-go").addEventListener("click", runTrackGen);
  node.querySelector(".prompt-input").addEventListener("keydown", e => {
    if (e.key === "Enter") runTrackGen();
  });
  const undoBtn = node.querySelector(".prompt-undo");
  if (undoBtn) {
    undoBtn.hidden = !state.undoSnapshot;
    undoBtn.addEventListener("click", undoLastGenerate);
  }

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
  if (fx.fuzz && typeof fx.fuzz === "object") {
    for (const k of ["amount","drive","tone","level"]) {
      const v = Number(fx.fuzz[k]);
      if (Number.isFinite(v)) cfg.fuzz[k] = Math.max(0, Math.min(1, v));
    }
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
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyCrush(cfg.crush || { bits: 8, wet: 0 });
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
  const q = s => panel.querySelector(s);
  q(".fx-fuzz-amount").value = cfg.fuzz.amount;
  q(".fx-fuzz-drive").value  = cfg.fuzz.drive;
  q(".fx-fuzz-tone").value   = cfg.fuzz.tone;
  q(".fx-fuzz-level").value  = cfg.fuzz.level;
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
  if (!fc.crush) fc.crush = { bits: 8, wet: 0 };
  q(".fx-fuzz-amount").value = fc.fuzz.amount;
  q(".fx-fuzz-drive").value  = fc.fuzz.drive;
  q(".fx-fuzz-tone").value   = fc.fuzz.tone;
  q(".fx-fuzz-level").value  = fc.fuzz.level;
  q(".fx-delay-time").value  = fc.delay.time;
  q(".fx-delay-fbk").value   = fc.delay.fbk;
  q(".fx-delay-wet").value   = fc.delay.wet;
  q(".fx-delay-sync").checked = !!fc.delay.sync;
  q(".fx-delay-div").value   = String(fc.delay.div);
  q(".fx-reverb-decay").value = fc.reverb.decay;
  q(".fx-reverb-wet").value   = fc.reverb.wet;
  { const b = q(".fx-crush-bits"); if (b) b.value = fc.crush.bits; }
  { const w = q(".fx-crush-wet");  if (w) w.value = fc.crush.wet; }

  const applyFuzz = () => {
    fc.fuzz.amount = Number(q(".fx-fuzz-amount").value);
    fc.fuzz.drive  = Number(q(".fx-fuzz-drive").value);
    fc.fuzz.tone   = Number(q(".fx-fuzz-tone").value);
    fc.fuzz.level  = Number(q(".fx-fuzz-level").value);
    t.fxRack?.applyFuzz(fc.fuzz);
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

  ["amount","drive","tone","level"].forEach(n => q(`.fx-fuzz-${n}`).addEventListener("input", applyFuzz));
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
  // Track-level glide + swing share the mod panel with per-param LFOs.
  const ctl = document.createElement("div");
  ctl.className = "mod-ctl-row";
  ctl.innerHTML = `
    <label class="mod-ctl"><span>glide</span><input class="track-glide" type="range" min="0" max="0.5" step="0.005" value="${t.glide ?? 0}" /></label>
    <label class="mod-ctl"><span>swing</span><input class="track-swing" type="range" min="0" max="0.75" step="0.01" value="${t.swing ?? 0}" /></label>
  `;
  panel.appendChild(ctl);
  const glideInput = ctl.querySelector(".track-glide");
  glideInput.addEventListener("input", e => {
    t.glide = Number(e.target.value);
    if (t.voice?.setGlide) t.voice.setGlide(t.glide);
  });
  const swingInput = ctl.querySelector(".track-swing");
  swingInput.addEventListener("input", e => { t.swing = Number(e.target.value); });
  for (const key of LFO_KEYS) {
    const row = tpl.content.firstElementChild.cloneNode(true);
    const cfg = t.lfoConfig[key];
    row.dataset.key = key;
    row.classList.toggle("active", cfg.enabled);
    row.querySelector(".lfo-target").textContent = key;

    const cb    = row.querySelector(".lfo-on");
    const shape = row.querySelector(".lfo-shape");
    const rate  = row.querySelector(".lfo-rate");
    const rateLbl  = row.querySelector(".lfo-rate-label");
    const depth = row.querySelector(".lfo-depth");
    const depthLbl = row.querySelector(".lfo-depth-label");
    const syncCb = row.querySelector(".lfo-sync");
    const divSel = row.querySelector(".lfo-div");
    const rateField = row.querySelector(".lfo-rate-field");

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

    panel.appendChild(row);
  }
}

function updatePatternCell(idx) {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;
  const cell = grid.children[idx];
  if (cell) cell.classList.toggle("filled", isPatternNonEmpty(idx));
  if (idx === state.activePattern) refreshVariateButton();
}

function refreshVariateButton() {
  const btn = document.getElementById("master-variate-go");
  if (!btn) return;
  btn.disabled = !isPatternNonEmpty(state.activePattern);
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

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    closeStepEditor();
    const idx = idxFromPoint(e.clientX, e.clientY);
    const existing = anchorCovering(t, idx);
    let anchor, wasOn = false;
    if (existing >= 0) { anchor = existing; wasOn = true; }
    else { anchor = idx; startNote(t, anchor); renderStepGrid(t); }
    try { grid.setPointerCapture(e.pointerId); } catch {}
    drag = { anchor, wasOn, startIdx: idx, lastIdx: idx, moved: false, pointerId: e.pointerId };
    e.preventDefault();
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
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
        </div>
        <div class="se-sample-fade">
          <label>fade in <input class="se-smp-fade-in" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-in-lbl">0 ms</span></label>
          <label>fade out <input class="se-smp-fade-out" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-out-lbl">0 ms</span></label>
        </div>
      </div>
    </div>
    <div class="se-actions">
      <button class="se-clear ghost">clear note</button>
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
    for (let m = lo; m < hi && m <= 95; m++) {
      if (!scaleIntervals) { visible.push(m); continue; }
      const pc = ((m % 12) + 12) % 12;
      const rel = ((pc - state.scale.root) % 12 + 12) % 12;
      if (scaleIntervals.includes(rel)) visible.push(m);
    }
    const ROWS = Math.max(1, Math.ceil(visible.length / COLS));
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const pc = ((m % 12) + 12) % 12;
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "se-pad";
      pad.dataset.note = String(m);
      if (scaleIntervals) {
        pad.classList.add("in-scale");
        if (pc === state.scale.root) pad.classList.add("root");
      }
      pad.title = midiToName(m);
      pad.textContent = `${PC_NAMES[pc]}${octaveOf(m)}`;
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
    let n = Math.max(24, Math.min(95, Math.round(v)));
    n = applyScale(n);
    noteInput.value = String(n);
    t.notes[idx] = n;
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
  el.querySelector(".se-clear").addEventListener("click", () => {
    t.notes[idx] = null;
    t.chords[idx] = "";
    renderStepGrid(t);
    closeStepEditor();
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
  }
}

// ---- transport ---------------------------------------------------------

async function ensureAudio() {
  if (state.ready) return;
  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
    Tone.setContext(state.audioCtx);
  }
  await Tone.start();
  // master bus so we can meter final output and add a one-stop master gain later
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

async function togglePlay() {
  const btn = document.getElementById("play");
  if (state.playing) {
    Tone.Transport.stop();
    if (state.repeatId !== null) { Tone.Transport.clear(state.repeatId); state.repeatId = null; }
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
  state.repeatId = Tone.Transport.scheduleRepeat((time) => {
    const baseStepDur = Tone.Time("16n").toSeconds();
    const anySolo = state.tracks.some(t => t.soloed);
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
        if (!t.steps[idx]) { slot++; continue; }
        const span = Math.max(1, t.lengths[idx] || 1);
        const duration = span * effDur;
        const swingOffset = (idx % 2 === 1) ? effDur * (t.swing ?? 0) : 0;
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

  Tone.Transport.start();
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

// Redesign this track's sound from its prompt input, then (optionally) regen its pattern.
// Mirrors the master generate flow's instruments toggle but scoped to one track.
async function promptTrackFull(t, { regenPattern = true } = {}) {
  const input = t.el.querySelector(".prompt-input");
  const prompt = input.value.trim();
  if (!prompt) { input.focus(); return; }
  pushUndoSnapshot(`track+sound: ${t.name}`);
  const btn = t.el.querySelector(".prompt-go");
  btn.disabled = true;
  const signal = startGen();
  try {
    const soundEngine = document.getElementById("gen-sound-engine")?.value === "eleven" ? "eleven" : "tone";
    setStatus(`designing ${soundEngine === "eleven" ? "eleven-labs " : ""}sound for "${t.name}"...`);
    await designSoundForTrack(t, prompt, soundEngine, signal);
    t.soundPromptText = prompt;
    if (regenPattern) {
      btn.disabled = false; // promptTrack re-disables it
      await promptTrack(t, { skipUndoSnapshot: true });
    } else {
      setStatus(`"${t.name}" sound ready`);
    }
  } catch (err) {
    if (isAbortError(err)) { setStatus("cancelled", true); }
    else { console.error(err); setStatus("generate failed — see console", true); }
  } finally {
    btn.disabled = false;
    endGen();
  }
}

async function promptTrack(t, opts = {}) {
  const input = t.el.querySelector(".prompt-input");
  const btn = t.el.querySelector(".prompt-go");
  const extra = opts.extra || {};
  const prompt = (extra.overridePrompt ?? input.value).trim();
  if (!prompt) { input.focus(); return; }
  if (!opts.skipUndoSnapshot) pushUndoSnapshot(`track: ${t.name}`);
  btn.disabled = true;
  setStatus(`generating "${t.name}"...`);
  try {
    const eng = engineByKey(t.engineKey);
    // Build sibling-track context so prompts referencing other tracks have something to react to.
    const siblings = state.tracks
      .filter(o => o !== t && o.steps && o.steps.some(s => s))
      .slice(0, 12)
      .map(o => ({
        name: o.name,
        engine: engineByKey(o.engineKey)?.label ?? o.engineKey,
        stepCount: o.length,
        steps: o.steps.slice(),
        notes: o.notes.slice(),
      }));
    const body = {
      prompt,
      role: trackRole(t),
      stepCount: t.length,
      accents: [...t.accents].sort((a, b) => a - b).map(i => i + 1),
      density: t.density ?? 0.5,
      scale: state.scale.active ? { root: state.scale.root, mode: state.scale.mode, rootName: NOTE_NAMES[state.scale.root] } : null,
      siblingTracks: siblings,
    };
    if (extra.seedPattern)     body.seedPattern     = extra.seedPattern;
    if (extra.variationIndex)  body.variationIndex  = extra.variationIndex;
    if (extra.variationCount)  body.variationCount  = extra.variationCount;
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: currentSignal(),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (opts.targetIdx !== undefined) {
      applyPatternTo(t, data, opts.targetIdx);
    } else {
      applyPattern(t, data);
      renderStepGrid(t);
    }
    setStatus(`"${t.name}" ready`);
  } catch (err) {
    if (isAbortError(err)) { setStatus("cancelled", true); }
    else { console.error(err); setStatus("generate failed — see console", true); }
  } finally {
    btn.disabled = false;
  }
}

function trackRole(t) {
  const eng = engineByKey(t.engineKey);
  if (!eng) return t.engineKey;
  if (eng.type === "plaits") {
    const isDrum = PLAITS_DRUM_IDX.has(eng.plaitsIdx);
    return `Mutable Instruments Plaits engine "${eng.label}" (${isDrum ? "percussive" : "melodic"})`;
  }
  if (eng.type === "drum-synth") {
    return `${eng.label}${eng.melodic ? " (melodic)" : " (percussive)"}`;
  }
  if (eng.type === "sample") return `drum sample "${eng.label}" (percussive)`;
  if (eng.type === "midi") return `external MIDI instrument on channel ${t.midi.channel}`;
  return eng.label;
}

function applyPatternTo(t, data, targetIdx) {
  if (targetIdx === state.activePattern) {
    applyPattern(t, data);
    renderStepGrid(t);
    return;
  }
  // Swap aliases to the target slot, apply, then swap back to active.
  const activeIdx = state.activePattern;
  aliasPattern(t, targetIdx);
  applyPattern(t, data);
  aliasPattern(t, activeIdx);
  updatePatternCell(targetIdx);
}

function applyFilterFromPrompt(t, filter) {
  if (!filter || typeof filter !== "object") return;
  const keys = ["cutoff","reson","env","attack","decay","sustain","release"];
  for (const k of keys) {
    const v = Number(filter[k]);
    if (Number.isFinite(v)) setFilter(t, k, Math.max(0, Math.min(1, v)));
  }
  if (t.el) {
    const map = {
      cutoff: ".p-cutoff", reson: ".p-reson", env: ".p-envamt",
      attack: ".p-envatk", decay: ".p-envdec", sustain: ".p-envsus", release: ".p-envrel",
    };
    for (const k of keys) {
      const el = t.el.querySelector(map[k]);
      if (el && Number.isFinite(t.filter[k])) el.value = t.filter[k];
    }
  }
}

function applyPattern(t, data) {
  if (data.filter) applyFilterFromPrompt(t, data.filter);
  if (typeof data.swing === "number" && Number.isFinite(data.swing)) {
    t.swing = Math.max(0, Math.min(0.75, data.swing));
    const input = t.el?.querySelector(".track-swing");
    if (input) input.value = t.swing;
  }
  const total = t.length;
  const steps = (data.steps || []).map(x => (x ? 1 : 0));
  const notes = (data.notes || []).map(n => {
    if (n == null) return null;
    if (typeof n === "number") return n;
    const m = nameToMidi(n);
    return m ?? null;
  });
  const lengths = (data.lengths || []).map(x => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  });
  const vels = (data.velocities || []).map(x => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  });
  const chords = (data.chords || []).map(c => {
    const k = canonicalChord(c);
    return (k && CHORD_TYPES[k]) ? k : "";
  });
  const offsets = (data.offsets || []).map(x => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(-0.5, Math.min(0.5, n)) : 0;
  });

  t.steps.fill(0); t.lengths.fill(0); t.notes.fill(null);
  t.velocities.fill(0.5); t.chords.fill("");
  if (t.offsets) t.offsets.fill(0); else t.offsets = new Array(total).fill(0);

  for (let i = 0; i < Math.min(total, steps.length); i++) {
    if (!steps[i]) continue;
    t.steps[i] = 1;
    // Drum-kit tracks force every step to C2 regardless of scale and regardless
    // of whatever pitch the planner returned.
    if (t.isDrumKit) t.notes[i] = 36;
    else t.notes[i] = notes[i] != null ? applyScale(notes[i]) : null;
    t.lengths[i] = Math.max(1, Math.min(lengths[i] || 1, total - i));
    t.velocities[i] = vels[i] ?? 0.5;
    t.chords[i] = chords[i] || "";
    t.offsets[i] = offsets[i] ?? 0;
  }
  for (let i = 0; i < total; i++) {
    if (!t.steps[i]) continue;
    const cap = maxLengthAt(t, i);
    t.lengths[i] = Math.min(t.lengths[i], cap);
  }
}

async function promptCustomSound(t) {
  const isEleven = engineByKey(t.engineKey)?.type === "eleven";
  const seed = t.soundPromptText || "";
  const result = await showSoundDesignDialog({
    trackName: t.name,
    engine: isEleven ? "eleven" : "tone",
    defaultValue: seed,
  });
  if (!result) return;
  t.soundPromptText = result.description;
  if (result.engine === "eleven") {
    t.elevenAudio = result.sound.audio;
    t.elevenAudioMime = result.sound.mime || "audio/mpeg";
    const bytes = Uint8Array.from(atob(result.sound.audio), c => c.charCodeAt(0));
    await ensureAudio();
    const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer), { trim: true });
    t.elevenBuffer = buffer;
    if (t.engineKey === "eleven" && t.voice?.type === "eleven") {
      t.voice.setBuffer(buffer);
    } else {
      setEngineKey(t, "eleven");
      if (t.el) t.el.querySelector(".track-engine").value = "eleven";
    }
    applySampleSpeed(t);
    resetProcessingForPromptedSound(t);
    setStatus(`"${t.name}" ← eleven-labs sample (${Math.round(buffer.duration * 1000)}ms)`);
    return;
  }
  // tone.js patch
  const cfg = result.sound;
  t.customConfig = cfg;
  if (t.engineKey === "custom" && t.voice?.type === "custom") {
    t.voice.applyConfig(cfg);
  } else {
    setEngineKey(t, "custom");
    if (t.el) t.el.querySelector(".track-engine").value = "custom";
  }
  resetProcessingForPromptedSound(t);
  t._refreshSaveEnabled?.();
  setStatus(`"${t.name}" → ${cfg.synth}${cfg.poly ? " (poly)" : ""}`);
  return;
  // legacy path (unreachable) — kept below for reference
  setStatus(`designing sound for "${t.name}"...`);
  try {
    const r = await fetch("/api/sound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: t.soundPromptText }),
      signal: currentSignal(),
    });
    if (!r.ok) throw new Error(await r.text());
    const config = await r.json();
    const fxSpec = config.fx;
    t.customConfig = config;
    if (t.engineKey === "custom" && t.voice?.type === "custom") {
      t.voice.applyConfig(config);
    } else {
      const prev = t.engineKey;
      t.engineKey = prev === "custom" ? "" : t.engineKey;
      setEngineKey(t, "custom");
      if (t.el) t.el.querySelector(".track-engine").value = "custom";
    }
    if (fxSpec) applyFxToTrack(t, fxSpec);
    t._refreshSaveEnabled?.();
    setStatus(`"${t.name}" → ${config.synth}${config.poly ? " (poly)" : ""}${fxSpec ? " + fx" : ""}`);
  } catch (err) {
    if (isAbortError(err)) { setStatus("cancelled", true); }
    else { console.error(err); setStatus("sound design failed — see console", true); }
  }
}

// Bulk sound designer used by the planner flow. `engine` is "tone" or "eleven".
async function designSoundForTrack(track, prompt, engine, signal) {
  if (engine === "eleven") {
    const r = await fetch("/api/eleven-sound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, duration: 2.0 }),
      signal,
    });
    if (!r.ok) throw new Error(await r.text());
    const { audio, mime } = await r.json();
    track.elevenAudio = audio;
    track.elevenAudioMime = mime || "audio/mpeg";
    const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    await ensureAudio();
    const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer), { trim: true });
    track.elevenBuffer = buffer;
    if (track.engineKey === "eleven" && track.voice?.type === "eleven") {
      track.voice.setBuffer(buffer);
    } else {
      setEngineKey(track, "eleven");
      if (track.el) track.el.querySelector(".track-engine").value = "eleven";
    }
    // Loop-style prompts (e.g. "seamless 2-bar drum loop") should BPM-sync;
    // one-shots / sustained tones should stay at native playback rate. We
    // detect "loop" in the prompt (but not "no loop") since the planner's
    // one-shot prompts intentionally contain the negation.
    const isLoopPrompt = /\bloop\b/i.test(prompt) && !/\bno\s+loop\b/i.test(prompt);
    track.sampleSpeedMode = isLoopPrompt ? "1xbpm" : "native";
    if (track.el) {
      const fitSel = track.el.querySelector(".sample-speed") || track.el.querySelector(".se-smp-fit");
      if (fitSel) fitSel.value = track.sampleSpeedMode;
    }
    applySampleSpeed(track);
    resetProcessingForPromptedSound(track);
    return;
  }
  // tone.js patch
  const r = await fetch("/api/sound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!r.ok) throw new Error(await r.text());
  const cfg = await r.json();
  track.customConfig = cfg;
  setEngineKey(track, "custom");
  if (track.el) track.el.querySelector(".track-engine").value = "custom";
  resetProcessingForPromptedSound(track);
}

// Sound-design dialog with preview + regenerate.
// Returns { description, sound, engine } on apply, or null on cancel.
function showSoundDesignDialog({ trackName, engine, defaultValue = "" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    const title = engine === "eleven"
      ? `describe the eleven-labs sound for "${trackName}" — one-shot, sustained tone, or loop?`
      : `describe the sound for "${trackName}"`;
    const placeholder = engine === "eleven"
      ? "single 808 kick one-shot, sub boom, tight decay, no loop, no pattern, one hit only"
      : "dark sub bass with soft distortion, resonant filter sweep, short reverb tail";
    overlay.innerHTML = `
      <div class="modal sound-dialog" role="dialog" aria-modal="true">
        <div class="modal-title">${esc(title)}</div>
        <textarea class="modal-input modal-multiline" rows="4" placeholder="${esc(placeholder)}">${esc(defaultValue)}</textarea>
        <div class="sound-dialog-status">type a description, then preview</div>
        <div class="modal-actions">
          <button class="modal-cancel ghost">cancel</button>
          <button class="sound-preview">preview</button>
          <button class="sound-regen ghost" disabled>regenerate</button>
          <button class="modal-ok" disabled>apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".modal-input");
    const statusEl = overlay.querySelector(".sound-dialog-status");
    const previewBtn = overlay.querySelector(".sound-preview");
    const regenBtn = overlay.querySelector(".sound-regen");
    const okBtn = overlay.querySelector(".modal-ok");
    const cancelBtn = overlay.querySelector(".modal-cancel");
    setTimeout(() => { input.focus(); try { input.select(); } catch {} }, 0);

    let currentSound = null;        // last generated sound object
    let currentDescription = "";    // what description was used to generate it
    let previewAbort = null;
    let activePreview = null;       // { dispose: () => void }

    const stopPreview = () => {
      if (activePreview) { try { activePreview.dispose(); } catch {} activePreview = null; }
    };

    const playPreviewEleven = async () => {
      if (!currentSound?.audio) return;
      stopPreview();
      await ensureAudio();
      const ctx = state.audioCtx;
      const bytes = Uint8Array.from(atob(currentSound.audio), c => c.charCodeAt(0));
      const buf = normalizeAudioBuffer(await ctx.decodeAudioData(bytes.buffer.slice(0)), { trim: true });
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(ctx.destination);
      src.start();
      activePreview = { dispose: () => { try { src.stop(); } catch {} try { src.disconnect(); } catch {} try { g.disconnect(); } catch {} } };
      src.onended = () => { if (activePreview) activePreview = null; };
      statusEl.textContent = `preview: ${Math.round(buf.duration * 1000)}ms`;
    };

    const playPreviewTone = async () => {
      if (!currentSound?.synth) return;
      stopPreview();
      await ensureAudio();
      try {
        const ToneClass = Tone[currentSound.synth];
        if (!ToneClass) throw new Error("unknown synth " + currentSound.synth);
        const synth = currentSound.poly
          ? new Tone.PolySynth(ToneClass, currentSound.options || {})
          : new ToneClass(currentSound.options || {});
        const effects = (currentSound.effects || [])
          .map(e => { try { return new (Tone[e.type])(e.options || {}); } catch { return null; } })
          .filter(Boolean);
        let last = synth;
        for (const fx of effects) { last.connect(fx); last = fx; }
        last.toDestination();
        const now = Tone.now();
        // arpeggiated preview so the user hears the envelope over time
        const notes = ["C3", "E3", "G3", "C4"];
        notes.forEach((n, i) => {
          try { synth.triggerAttackRelease(n, "8n", now + i * 0.22, 0.8); } catch {}
        });
        activePreview = {
          dispose: () => {
            try { synth.releaseAll?.(); } catch {}
            try { synth.dispose(); } catch {}
            effects.forEach(fx => { try { fx.dispose(); } catch {} });
          },
        };
        setTimeout(() => { if (activePreview) { stopPreview(); } }, 2800);
        statusEl.textContent = `preview: ${currentSound.synth}${currentSound.poly ? " (poly)" : ""}${effects.length ? ` + ${effects.length} fx` : ""}`;
      } catch (err) {
        console.warn(err);
        statusEl.textContent = `preview error: ${err.message}`;
      }
    };

    const playPreview = () => engine === "eleven" ? playPreviewEleven() : playPreviewTone();

    const generate = async () => {
      const desc = input.value.trim();
      if (!desc) { input.focus(); return; }
      currentDescription = desc;
      stopPreview();
      previewAbort?.abort();
      previewAbort = new AbortController();
      const sig = previewAbort.signal;
      statusEl.textContent = "generating…";
      previewBtn.disabled = true;
      regenBtn.disabled = true;
      okBtn.disabled = true;
      try {
        if (engine === "eleven") {
          const r = await fetch("/api/eleven-sound", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: desc, duration: 2.0 }),
            signal: sig,
          });
          if (!r.ok) throw new Error(await r.text());
          currentSound = await r.json();
        } else {
          const r = await fetch("/api/sound", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: desc }),
            signal: sig,
          });
          if (!r.ok) throw new Error(await r.text());
          currentSound = await r.json();
        }
        okBtn.disabled = false;
        regenBtn.disabled = false;
        previewBtn.disabled = false;
        await playPreview();
      } catch (err) {
        if (err?.name === "AbortError") { statusEl.textContent = "cancelled"; return; }
        console.error(err);
        statusEl.textContent = `error: ${String(err?.message ?? err).slice(0, 140)}`;
        previewBtn.disabled = false;
        regenBtn.disabled = !currentSound;
        okBtn.disabled = !currentSound;
      }
    };

    const close = (val) => {
      stopPreview();
      previewAbort?.abort();
      overlay.remove();
      resolve(val);
    };

    previewBtn.addEventListener("click", () => {
      const desc = input.value.trim();
      if (currentSound && desc === currentDescription) playPreview();
      else generate();
    });
    regenBtn.addEventListener("click", generate);
    okBtn.addEventListener("click", () => {
      close(currentSound ? { description: currentDescription, sound: currentSound, engine } : null);
    });
    cancelBtn.addEventListener("click", () => close(null));
    input.addEventListener("input", () => {
      // description changed after a generation — nudge user to regenerate
      if (currentSound && input.value.trim() !== currentDescription) {
        statusEl.textContent = "description changed — regenerate to hear the new one";
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
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

async function designElevenSound(t) {
  setStatus(`generating eleven-labs sample for "${t.name}"...`);
  try {
    const r = await fetch("/api/eleven-sound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: t.soundPromptText, duration: 2.0 }),
      signal: currentSignal(),
    });
    if (!r.ok) throw new Error(await r.text());
    const { audio, mime } = await r.json();
    // keep the raw mp3 so the sample survives save/export; decode for playback now
    t.elevenAudio = audio;            // base64-encoded mp3
    t.elevenAudioMime = mime || "audio/mpeg";
    const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    await ensureAudio();
    const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer), { trim: true });
    t.elevenBuffer = buffer;
    if (t.engineKey === "eleven" && t.voice?.type === "eleven") {
      t.voice.setBuffer(buffer);
    } else {
      setEngineKey(t, "eleven");
      if (t.el) t.el.querySelector(".track-engine").value = "eleven";
    }
    setStatus(`"${t.name}" ← eleven-labs sample (${Math.round(buffer.duration * 1000)}ms)`);
  } catch (err) {
    if (isAbortError(err)) { setStatus("cancelled", true); }
    else { console.error(err); setStatus("eleven-labs gen failed — see console", true); }
  }
}

async function promptAll() {
  for (const t of state.tracks) {
    const input = t.el.querySelector(".prompt-input");
    if (input.value.trim()) await promptTrack(t);
  }
}

async function promptFromMaster({ reshape = false, designSounds = false, regenPatterns = true, keepPatterns = false, bars = 1 } = {}) {
  const input = document.getElementById("master-prompt");
  const btn = document.getElementById("master-prompt-go");
  const master = input.value.trim();
  if (!master) { input.focus(); return; }
  pushUndoSnapshot(`master: ${master.slice(0, 40)}`);
  // Reshape normally removes a track (destroying all its patterns), so replaceable = both locks off.
  // keepPatterns mode updates tracks in place (patterns survive), so we only need instrument-unlocked.
  const empties = reshape
    ? (keepPatterns
        ? state.tracks.filter(t => !t.lockInstrument)
        : state.tracks.filter(t => !t.lockInstrument && !t.lockPattern))
    : state.tracks.filter(t => !t.lockPattern);
  if (empties.length === 0) {
    setStatus(reshape ? "nothing to reshape — all tracks are locked" : "all tracks are pattern-locked", true);
    return;
  }
  btn.disabled = true;
  setStatus(`planning ${empties.length} track${empties.length === 1 ? "" : "s"}${designSounds ? " + sounds" : ""}...`);
  const signal = startGen();
  try {
    const r = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: master,
        designSounds,
        allowReshape: reshape,
        bars,
        tracks: empties.map(t => ({
          name: t.name,
          engine: engineByKey(t.engineKey)?.label ?? t.engineKey,
          role: trackRole(t),
          stepCount: t.length,
          accents: [...t.accents].sort((a, b) => a - b).map(i => i + 1),
        })),
        keptTracks: state.tracks.filter(t => !empties.includes(t)).map(t => ({
          name: t.name,
          engine: engineByKey(t.engineKey)?.label ?? t.engineKey,
          locked: t.locked,
        })),
        availableEngines: ENGINES.map(e => ({ key: e.key, label: e.label, group: e.group, type: e.type })),
        scale: state.scale.active ? { root: state.scale.root, mode: state.scale.mode, rootName: NOTE_NAMES[state.scale.root] } : null,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (Number.isFinite(data.bpm)) {
      const bpm = Math.max(40, Math.min(240, Math.round(data.bpm)));
      document.getElementById("bpm").value = bpm;
      if (state.ready) Tone.Transport.bpm.value = bpm;
      retuneSyncedLFOs();
    }
    if (data.scale && data.scale.mode && SCALES[data.scale.mode]) {
      state.scale.mode = data.scale.mode;
      if (typeof data.scale.root === "number") state.scale.root = ((data.scale.root % 12) + 12) % 12;
      else if (typeof data.scale.rootName === "string") {
        const idx = NOTE_NAMES.findIndex(n => n.toLowerCase() === data.scale.rootName.toLowerCase());
        if (idx >= 0) state.scale.root = idx;
      }
      state.scale.active = true;
      syncScaleUI();
    }

    // reshape path — response contains full track specs
    if (Array.isArray(data.tracks)) {
      const specs = data.tracks.slice(0, 16);
      const newTracks = [];
      if (keepPatterns) {
        // Update existing tracks in place so all pattern data survives. Map spec[i] → empties[i].
        for (let i = 0; i < specs.length; i++) {
          const spec = specs[i];
          const track = empties[i];
          if (!track) {
            // Planner wants more tracks than we have unlocked — create fresh ones for the overflow.
            const wanted = typeof spec.engineKey === "string" && engineByKey(spec.engineKey) ? spec.engineKey : "plaits:0";
            const len = Math.max(1, Math.min(128, Number(spec.length) || bars * STEPS_PER_BAR));
            const t2 = createTrack({ name: String(spec.name || "track").slice(0, 40), engineKey: wanted, length: len });
            if (spec.prompt) t2.el.querySelector(".prompt-input").value = String(spec.prompt);
            if (spec.soundPrompt) t2.soundPromptText = String(spec.soundPrompt);
            if (spec.fx) applyFxToTrack(t2, spec.fx);
            newTracks.push({ track: t2, soundPrompt: spec.soundPrompt });
            continue;
          }
          // Update in place
          if (spec.name) { track.name = String(spec.name).slice(0, 40); track.el.querySelector(".track-name").value = track.name; }
          if (spec.engineKey && engineByKey(spec.engineKey) && spec.engineKey !== track.engineKey) {
            setEngineKey(track, spec.engineKey);
            track.el.querySelector(".track-engine").value = spec.engineKey;
          }
          if (spec.fx) applyFxToTrack(track, spec.fx);
          if (typeof spec.vol === "number" && Number.isFinite(spec.vol)) {
            const vol = Math.max(0, Math.min(1, spec.vol));
            setParam(track, "vol", vol);
            const volEl = track.el?.querySelector(".p-vol");
            if (volEl) volEl.value = vol;
          }
          if (spec.prompt) track.el.querySelector(".prompt-input").value = String(spec.prompt);
          if (spec.soundPrompt) track.soundPromptText = String(spec.soundPrompt);
          newTracks.push({ track, soundPrompt: spec.soundPrompt });
        }
      } else {
        // Replace: remove the unlocked tracks, create fresh ones per spec.
        for (const t of empties) removeTrack(t);
        for (const spec of specs) {
          const wanted = typeof spec.engineKey === "string" && engineByKey(spec.engineKey) ? spec.engineKey : "plaits:0";
          const len = Math.max(1, Math.min(128, Number(spec.length) || bars * STEPS_PER_BAR));
          const track = createTrack({
            name: String(spec.name || "track").slice(0, 40),
            engineKey: wanted,
            length: len,
          });
          if (spec.prompt) track.el.querySelector(".prompt-input").value = String(spec.prompt);
          if (spec.soundPrompt) track.soundPromptText = String(spec.soundPrompt);
          if (spec.fx) applyFxToTrack(track, spec.fx);
          if (typeof spec.vol === "number" && Number.isFinite(spec.vol)) {
            const vol = Math.max(0, Math.min(1, spec.vol));
            setParam(track, "vol", vol);
            track.el?.querySelector(".p-vol") && (track.el.querySelector(".p-vol").value = vol);
          }
          newTracks.push({ track, soundPrompt: spec.soundPrompt });
        }
      }
      if (designSounds) {
        const soundEngine = document.getElementById("gen-sound-engine")?.value === "eleven" ? "eleven" : "tone";
        setStatus(`designing ${newTracks.length} ${soundEngine === "eleven" ? "eleven-labs " : ""}sound${newTracks.length === 1 ? "" : "s"}...`);
        await Promise.all(newTracks.map(async ({ track, soundPrompt }) => {
          if (!soundPrompt) return;
          try {
            await designSoundForTrack(track, soundPrompt, soundEngine, signal);
          } catch (e) { console.warn("sound design failed for", track.name, e); }
        }));
      }
      if (regenPatterns) {
        for (const { track } of newTracks) await promptTrack(track);
      }
      setStatus("done");
      return;
    }

    // legacy path — server returned parallel prompts for each input track
    if (!Array.isArray(data.prompts) || data.prompts.length !== empties.length) {
      throw new Error("plan response shape mismatch");
    }
    empties.forEach((t, i) => {
      t.el.querySelector(".prompt-input").value = data.prompts[i];
    });
    if (designSounds && Array.isArray(data.soundPrompts) && data.soundPrompts.length === empties.length) {
      const soundEngine = document.getElementById("gen-sound-engine")?.value === "eleven" ? "eleven" : "tone";
      setStatus(`designing ${empties.length} ${soundEngine === "eleven" ? "eleven-labs " : ""}sound${empties.length === 1 ? "" : "s"}...`);
      await Promise.all(data.soundPrompts.map(async (sp, i) => {
        const t = empties[i];
        if (!t) return;
        t.soundPromptText = sp;
        try { await designSoundForTrack(t, sp, soundEngine, signal); }
        catch (e) { console.warn("sound design failed for", t.name, e); }
      }));
    }
    if (regenPatterns) {
      for (const t of empties) await promptTrack(t);
    }
    setStatus("done");
  } catch (err) {
    if (isAbortError(err)) { setStatus("cancelled", true); }
    else { console.error(err); setStatus("plan failed — see console", true); }
  } finally {
    btn.disabled = false;
    endGen();
  }
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
  on.addEventListener("change", () => { state.scale.active = on.checked; });
  root.addEventListener("change", () => { state.scale.root = Number(root.value); });
  mode.addEventListener("change", () => { state.scale.mode = mode.value; });
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
  // Near-linear response: bar width tracks peak so the red zone at 95% lights up
  // only when the signal is actually near full-scale. A mild pow keeps quiet signals visible.
  const pct = Math.min(100, Math.round(Math.pow(Math.max(0, Math.min(1, level)), 0.85) * 100));
  bar.style.width = pct + "%";
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
  rebuildEngineCatalog();
  requestAnimationFrame(meterTick);

  document.getElementById("play").addEventListener("click", togglePlay);
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
  document.getElementById("swing").addEventListener("input", e => {
    const v = Number(e.target.value);
    for (const t of state.tracks) {
      t.swing = v;
      const input = t.el?.querySelector(".track-swing");
      if (input) input.value = v;
    }
  });
  document.getElementById("add-track").addEventListener("click", () => {
    createTrack({ name: `track ${state.tracks.length + 1}`, engineKey: "plaits:0" });
  });
  // gen-pattern: 2-state aria-pressed toggle
  const pBtn = document.getElementById("gen-pattern");
  pBtn.addEventListener("click", () => {
    const pressed = pBtn.getAttribute("aria-pressed") === "true";
    pBtn.setAttribute("aria-pressed", String(!pressed));
  });
  // gen-instruments: 3-state cycle — off → on → all → off
  const iBtn = document.getElementById("gen-instruments");
  iBtn.addEventListener("click", () => {
    const states = ["off", "on", "all"];
    const cur = iBtn.dataset.state || "off";
    const next = states[(states.indexOf(cur) + 1) % states.length];
    iBtn.dataset.state = next;
    iBtn.textContent = next === "all" ? "instruments · all" : "instruments";
  });
  document.getElementById("gen-cancel").addEventListener("click", cancelGen);
  document.getElementById("master-undo")?.addEventListener("click", undoLastGenerate);
  document.getElementById("master-prompt-go").addEventListener("click", () => {
    const instState = document.getElementById("gen-instruments").dataset.state || "off";
    const patternOn = document.getElementById("gen-pattern").getAttribute("aria-pressed") === "true";
    const instrumentsOn = instState !== "off";
    if (!instrumentsOn && !patternOn) { setStatus("toggle pattern or instruments first"); return; }
    const bars = Math.max(1, Math.min(8, Number(document.getElementById("gen-bars")?.value) || 1));
    promptFromMaster({
      reshape: instrumentsOn,
      designSounds: instrumentsOn,
      regenPatterns: patternOn,
      keepPatterns: instState === "all",
      bars,
    });
  });

  document.getElementById("master-variate-go").addEventListener("click", async () => {
    const btn = document.getElementById("master-variate-go");
    const countInput = document.getElementById("gen-count");
    const count = Math.max(1, Math.min(4, Number(countInput?.value) || 1));
    pushUndoSnapshot(`variate ×${count}`);
    const seedIdx = state.activePattern;
    const seeds = new Map();
    for (const t of state.tracks) {
      const p = t.patterns[seedIdx];
      if (!p) continue;
      seeds.set(t.id, {
        steps: p.steps.slice(),
        lengths: p.lengths.slice(),
        notes: p.notes.slice(),
        velocities: p.velocities.slice(),
        chords: p.chords.slice(),
      });
    }
    btn.disabled = true;
    // Pick the next `count` empty pattern slots after the seed, skipping filled ones.
    const targetSlots = [];
    let cursor = seedIdx;
    while (targetSlots.length < count) {
      cursor = (cursor + 1) % PATTERN_COUNT;
      if (cursor === seedIdx) break;
      if (!isPatternNonEmpty(cursor)) targetSlots.push(cursor);
    }
    if (targetSlots.length === 0) {
      btn.disabled = false;
      setStatus("no empty pattern slots — delete or clear some first", true);
      return;
    }
    const signal = startGen();
    try {
      for (let i = 0; i < targetSlots.length; i++) {
        if (signal.aborted) break;
        const target = targetSlots[i];
        setStatus(`variation ${i + 1} of ${targetSlots.length} → pattern ${target + 1}...`);
        for (const t of state.tracks) {
          if (signal.aborted) break;
          if (t.lockPattern) continue;
          const seed = seeds.get(t.id);
          if (!seed || !seed.steps.some(s => s)) continue;
          const input = t.el.querySelector(".prompt-input");
          const basePrompt = input.value.trim() || `variation of the current pattern`;
          try {
            await promptTrack(t, {
              targetIdx: target,
              extra: {
                seedPattern: seed,
                variationIndex: i + 1,
                variationCount: targetSlots.length,
                overridePrompt: `${basePrompt} — subtle variation, keep key/mood, change rhythm/phrasing`,
              },
            });
          } catch (e) {
            if (isAbortError(e)) break;
            console.warn("variation failed", e);
          }
        }
      }
      if (!signal.aborted) {
        setStatus(`variated into ${targetSlots.length} pattern${targetSlots.length === 1 ? "" : "s"} (${targetSlots.map(i => i + 1).join(", ")})`);
      }
    } finally {
      btn.disabled = false;
      endGen();
    }
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
  renderPatternGrid();
  const mp = document.getElementById("master-prompt");
  const autogrow = () => {
    mp.style.height = "auto";
    mp.style.height = `${Math.min(180, mp.scrollHeight)}px`;
  };
  mp.addEventListener("input", autogrow);
  mp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("master-prompt-go").click();
    }
  });
  requestAnimationFrame(autogrow);

  initScaleUI();

  // starter kit
  createTrack({ name: "kick",   engineKey: "dm:808-kick" });
  createTrack({ name: "snare",  engineKey: "dm:808-snare" });
  createTrack({ name: "hat",    engineKey: "dm:909-chat" });
  createTrack({ name: "accent", engineKey: "plaits:12" });
  createTrack({ name: "bass",   engineKey: "dm:303" });
  createTrack({ name: "lead",   engineKey: "plaits:0" });

  // prime a starter vibe in the prompt box (user clicks "generate" to run it)
  document.getElementById("master-prompt").value = pickStarterPrompt();
  setStatus("ready");
  // if the URL carries ?s=<id>, pull that shared session
  loadShareFromUrl();
}

init();
