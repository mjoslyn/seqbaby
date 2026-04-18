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

function buildEngineCatalog() {
  return [...plaitsEntries(), ...DRUM_SYNTH_ENGINES, CUSTOM_ENGINE, ELEVEN_ENGINE, ...savedPatchEntries(), ...SAMPLE_ENGINES, MIDI_ENGINE];
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

const state = {
  tracks: [],
  playing: false,
  tick: 0,
  repeatId: null,
  nextId: 1,
  audioCtx: null,
  ready: false,
  midi: null,
  scale: { active: false, root: 0, mode: "minor" },
  activePattern: 0,
  patternMode: "repeat",
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
    velocities: new Array(len).fill(1),
    chords: new Array(len).fill(""),
    offsets: new Array(len).fill(0),   // micro-timing offset in step fractions (-0.5..+0.5)
    arps: new Array(len).fill(false),           // arpeggiate the chord across the step's duration
    arpRates:  new Array(len).fill(0.25),       // beats per arp note
    arpRanges: new Array(len).fill(1),          // octave range
    arpDirs:   new Array(len).fill("up"),       // up / down / updown / random
    complexities: new Array(len).fill(0),       // chord inversion / voicing level
    ratchets: new Array(len).fill(1),           // retrigger the single note N times across the step
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
      soundPromptText: t.soundPromptText,
      locked: t.locked, muted: t.muted, soloed: t.soloed,
      glide: t.glide, speed: t.speed ?? 1,
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
  for (const td of s.tracks || []) {
    const t = createTrack({ name: td.name || "track", engineKey: td.engineKey || "plaits:0", length: td.length || 16 });
    Object.assign(t.params, td.params || {});
    Object.assign(t.filter, td.filter || {});
    Object.assign(t.fxConfig, td.fxConfig || {});
    Object.assign(t.midi, td.midi || {});
    t.customConfig = td.customConfig || null;
    t.elevenAudio = td.elevenAudio || null;
    t.elevenAudioMime = td.elevenAudioMime || null;
    t.soundPromptText = td.soundPromptText || "";
    // decode the saved eleven-labs sample (async; once done the voice picks it up)
    if (t.elevenAudio) {
      (async () => {
        try {
          const bytes = Uint8Array.from(atob(t.elevenAudio), c => c.charCodeAt(0));
          await ensureAudio();
          const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
          t.elevenBuffer = buffer;
          if (t.voice?.type === "eleven") t.voice.setBuffer(buffer);
        } catch (e) { console.warn("eleven buffer decode failed", e); }
      })();
    }
    t.locked = !!td.locked;
    t.muted  = !!td.muted;
    t.soloed = !!td.soloed;
    t.glide  = td.glide ?? 0;
    t.speed  = td.speed ?? 1;
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
          velocities: pad(p.velocities, 1, t.length),
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
    cell.addEventListener("click", () => switchPattern(i));
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

function defaultFxConfig() {
  return {
    fuzz:   { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
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

    // Tone effects chained after fuzz
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
    const delayIn = this.delay.input?.input ?? this.delay.input;
    this.postFuzz.connect(delayIn);
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
  }
  throw new Error("unknown drum-synth kind: " + kind);
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
    this.built = buildDrumSynthNode(this.kind, this.output);
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
  }
  setParam(key, val) {
    if (key === "vol") this.output.gain.value = val;
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
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = Math.pow(2, (midiNote - 60) / 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0, Math.min(1, velocity)), time);
    src.connect(g).connect(this.output);
    src.start(time);
    src.stop(time + Math.max(0.1, duration + 0.5));
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

// Peak-normalize an AudioBuffer in place and taper the last ~5ms to zero so the sample
// doesn't click at its natural end. ElevenLabs output is typically -12…-18 dB and often
// cuts abruptly.
function normalizeAudioBuffer(buf) {
  if (!buf) return buf;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  const scale = (peak === 0 || peak >= 0.95) ? 1 : 0.98 / peak;
  const tailSamples = Math.min(buf.length, Math.round(buf.sampleRate * 0.005));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    if (scale !== 1) for (let i = 0; i < d.length; i++) d[i] *= scale;
    // linear taper over the last tailSamples
    for (let i = 0; i < tailSamples; i++) {
      const j = d.length - tailSamples + i;
      const fade = 1 - (i / tailSamples);
      d[j] *= fade;
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
    this.output = ctx.createGain();
    this.output.gain.value = params.vol;
    this.output.connect(ctx.destination);
    this.buffer = track?.elevenBuffer ?? null;
    this.active = new Set();
  }
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
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = Math.pow(2, (midiNote - 60) / 12);
    const g = this.ctx.createGain();
    const v = Math.max(0, Math.min(1, velocity));
    const fade = 0.006;   // 6ms attack/release fade to avoid clicks at sample edges
    const stopTime = time + Math.max(0.1, duration + 0.5);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(v, time + fade);
    g.gain.setValueAtTime(v, Math.max(time + fade, stopTime - fade));
    g.gain.linearRampToValueAtTime(0, stopTime);
    src.connect(g).connect(this.output);
    src.start(time);
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
  const isPlaits = engineByKey(t.engineKey)?.type === "plaits";
  const group = t.el.querySelector(".timbre-group");
  if (group) group.style.display = isPlaits ? "" : "none";
}

// Force all fx wet levels to 0 (100% dry) — used when switching a track to the
// eleven-labs engine so user-applied fx don't stack on baked-in sample ambience.
function resetFxDry(t) {
  const cfg = t.fxConfig;
  cfg.fuzz.amount = 0;
  cfg.delay.wet   = 0;
  cfg.reverb.wet  = 0;
  if (t.fxRack) {
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
  }
  refreshFxPanelUI(t);
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
  if (!t.voice) { updateMidiUI(t); return; }
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
    glide: 0,
    swing: 0,
    density: 0.5,
    speed: 1,
    trackTick: 0,
    repeatId: null,
    soundPromptText: "",
    params: { vol: 0.8, harm: 0.5, timb: 0.5, morph: 0.5, decay: 0.4 },
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
    p.velocities = pad(p.velocities, 1);
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
    t.velocities[i] = 1;
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
  t.velocities[anchor] = 1;
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
  engineSel.addEventListener("change", e => setEngineKey(t, e.target.value));

  node.querySelector(".p-vol").addEventListener("input", e => setParam(t, "vol", Number(e.target.value)));
  node.querySelector(".p-harm").addEventListener("input", e => setParam(t, "harm", Number(e.target.value)));
  node.querySelector(".p-timb").addEventListener("input", e => setParam(t, "timb", Number(e.target.value)));
  node.querySelector(".p-morph").addEventListener("input", e => setParam(t, "morph", Number(e.target.value)));
  node.querySelector(".p-decay").addEventListener("input", e => setParam(t, "decay", Number(e.target.value)));
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
  node.querySelector(".track-glide").value = t.glide ?? 0;
  node.querySelector(".track-glide").addEventListener("input", e => {
    t.glide = Number(e.target.value);
    if (t.voice?.setGlide) t.voice.setGlide(t.glide);
  });
  const swingInput = node.querySelector(".track-swing");
  if (swingInput) {
    swingInput.value = t.swing ?? 0;
    swingInput.addEventListener("input", e => { t.swing = Number(e.target.value); });
  }
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
    t.velocities.fill(1);
    t.chords.fill("");
    renderStepGrid(t);
  });
  node.querySelector(".track-remove").addEventListener("click", () => removeTrack(t));
  node.querySelector(".prompt-go").addEventListener("click", () => promptTrack(t));
  node.querySelector(".prompt-input").addEventListener("keydown", e => {
    if (e.key === "Enter") promptTrack(t);
  });

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
  if (t.fxRack) {
    t.fxRack.applyFuzz(cfg.fuzz);
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
}

function wireFxPanel(t, panel) {
  const q = (sel) => panel.querySelector(sel);
  const fc = t.fxConfig;
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

  ["amount","drive","tone","level"].forEach(n => q(`.fx-fuzz-${n}`).addEventListener("input", applyFuzz));
  ["time","fbk","wet"].forEach(n => q(`.fx-delay-${n}`).addEventListener("input", applyDelay));
  q(".fx-delay-sync").addEventListener("change", applyDelay);
  q(".fx-delay-div").addEventListener("change", applyDelay);
  q(".fx-reverb-decay").addEventListener("input", applyReverb);
  q(".fx-reverb-wet").addEventListener("input", applyReverb);
}

function renderModPanel(t, panel) {
  const tpl = document.getElementById("lfo-row-template");
  panel.replaceChildren();
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
    const vel = t.velocities[idx] ?? 1;
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
  document.removeEventListener("pointerdown", stepEditor.outsideHandler, true);
  document.removeEventListener("keydown", stepEditor.escHandler);
  stepEditor.el.remove();
  stepEditor = null;
}

function openStepEditor(t, idx, anchorEl) {
  closeStepEditor();
  const eng = engineByKey(t.engineKey);
  const defaultNote = t.notes[idx] ?? eng?.defaultNote ?? 60;
  const el = document.createElement("div");
  el.className = "step-editor";
  const chordOptions = Object.keys(CHORD_TYPES).map(c => `<option value="${c}">${c || "none"}</option>`).join("");
  el.innerHTML = `
    <div class="se-title">step ${idx + 1}</div>
    <div class="se-field">
      <label title="steps from the prior note (scale steps when scale on, semitones otherwise)">Δ prior</label>
      <input class="se-rel" type="number" min="-12" max="12" step="1" value="0" />
      <span class="se-rel-label"></span>
    </div>
    <div class="se-field">
      <label>note</label>
      <input class="se-note" type="range" min="24" max="95" step="1" value="${Math.max(24, Math.min(95, defaultNote))}" />
      <span class="se-note-label"></span>
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
      <input class="se-vel" type="range" min="0" max="1" step="0.01" value="${t.velocities[idx] ?? 1}" />
      <span class="se-vel-label"></span>
    </div>
    <div class="se-field">
      <label>offset</label>
      <input class="se-offset" type="range" min="-0.5" max="0.5" step="0.01" value="${t.offsets?.[idx] ?? 0}" />
      <span class="se-offset-label"></span>
    </div>
    <div class="se-actions">
      <button class="se-clear ghost">clear note</button>
      <button class="se-close">done</button>
    </div>
  `;
  document.body.appendChild(el);

  const rect = anchorEl.getBoundingClientRect();
  el.style.position = "absolute";
  const topY = rect.bottom + window.scrollY + 6;
  const leftX = Math.min(rect.left + window.scrollX,
    window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 12);
  el.style.top = `${topY}px`;
  el.style.left = `${Math.max(12, leftX)}px`;

  const noteInput = el.querySelector(".se-note");
  const noteLbl = el.querySelector(".se-note-label");
  const velInput = el.querySelector(".se-vel");
  const velLbl = el.querySelector(".se-vel-label");
  const chordSel = el.querySelector(".se-chord");
  const chordLbl = el.querySelector(".se-chord-label");
  const arpBox   = el.querySelector(".se-arp");
  const cpxInput = el.querySelector(".se-cpx");
  cpxInput.value = String(Math.max(0, Math.min(4, (t.complexities && t.complexities[idx]) || 0)));
  const relInput = el.querySelector(".se-rel");
  const relLbl   = el.querySelector(".se-rel-label");
  const offsetInput = el.querySelector(".se-offset");
  const offsetLbl = el.querySelector(".se-offset-label");
  chordSel.value = t.chords[idx] || "";
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
  };
  refresh();

  offsetInput.addEventListener("input", () => {
    if (!t.offsets) t.offsets = new Array(t.length).fill(0);
    t.offsets[idx] = Number(offsetInput.value);
    refresh();
  });

  noteInput.addEventListener("input", () => {
    let v = Number(noteInput.value);
    v = applyScale(v);
    noteInput.value = v;
    t.notes[idx] = v;
    refresh();
    renderStepGrid(t);
  });
  relInput.addEventListener("change", () => {
    const steps = Math.max(-12, Math.min(12, Number(relInput.value) || 0));
    relInput.value = steps;
    if (steps === 0) { relLbl.textContent = ""; return; }
    const n = applyStepsFromPrior(t, idx, steps);
    if (n == null) { relLbl.textContent = "(no prior note)"; return; }
    const clamped = Math.max(24, Math.min(95, n));
    t.notes[idx] = clamped;
    noteInput.value = clamped;
    relLbl.textContent = `→ ${midiToName(clamped)}`;
    refresh();
    renderStepGrid(t);
  });
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

  const outsideHandler = (e) => { if (!el.contains(e.target)) closeStepEditor(); };
  const escHandler = (e) => { if (e.key === "Escape") closeStepEditor(); };
  document.addEventListener("pointerdown", outsideHandler, true);
  document.addEventListener("keydown", escHandler);
  stepEditor = { el, outsideHandler, escHandler };
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
        const vel = t.velocities[idx] ?? 1;
        const chord = t.chords[idx] || "";
        const arp = !!(t.arps && t.arps[idx]);
        const cpx = (t.complexities && t.complexities[idx]) || 0;
        let notes = chord ? chordNotes(root, chord) : [root];
        if (chord && cpx) notes = invertChord(notes, cpx);
        const list = (t.voice.poly && !arp) ? notes : (arp ? notes : [notes[0]]);
        try { fireFilterEnv(t, hitTime, duration); } catch (e) { console.warn(e); }
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
          const ratchet = Math.max(1, Math.min(8, Math.round(t.ratchets?.[idx] ?? 1)));
          if (ratchet > 1 && !chord) {
            // retrigger the single note N times evenly across the step
            const sub = duration / ratchet;
            for (let r = 0; r < ratchet; r++) {
              for (const n of list) {
                try { t.voice.hit(n, hitTime + r * sub, sub * 0.92, vel); } catch (e) { console.warn(e); }
              }
            }
          } else {
            for (const n of list) {
              try { t.voice.hit(n, hitTime, duration, vel); } catch (e) { console.warn(e); }
            }
          }
        }
        slot++;
      }
    }
    Tone.Draw.schedule(paintNowIndicator, time);
    state.tick++;
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

async function promptTrack(t, opts = {}) {
  const input = t.el.querySelector(".prompt-input");
  const btn = t.el.querySelector(".prompt-go");
  const extra = opts.extra || {};
  const prompt = (extra.overridePrompt ?? input.value).trim();
  if (!prompt) { input.focus(); return; }
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
  t.velocities.fill(1); t.chords.fill("");
  if (t.offsets) t.offsets.fill(0); else t.offsets = new Array(total).fill(0);

  for (let i = 0; i < Math.min(total, steps.length); i++) {
    if (!steps[i]) continue;
    t.steps[i] = 1;
    t.notes[i] = notes[i] != null ? applyScale(notes[i]) : null;
    t.lengths[i] = Math.max(1, Math.min(lengths[i] || 1, total - i));
    t.velocities[i] = vels[i] ?? 1;
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
  const description = await showInputDialog({
    title: isEleven
      ? `describe the eleven-labs sound for "${t.name}"`
      : `describe the sound for "${t.name}"`,
    defaultValue: seed,
    placeholder: isEleven
      ? "deep sub bass hit, tight decay, vinyl noise tail"
      : "dark sub bass with soft distortion, resonant filter sweep, short reverb tail",
    multiline: true,
  });
  if (!description || !description.trim()) return;
  t.soundPromptText = description.trim();
  if (isEleven) return designElevenSound(t);
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
    const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
    track.elevenBuffer = buffer;
    if (track.engineKey === "eleven" && track.voice?.type === "eleven") {
      track.voice.setBuffer(buffer);
    } else {
      setEngineKey(track, "eleven");
      if (track.el) track.el.querySelector(".track-engine").value = "eleven";
    }
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
  if (cfg.fx) applyFxToTrack(track, cfg.fx);
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
    const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
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

function init() {
  rebuildEngineCatalog();

  document.getElementById("play").addEventListener("click", togglePlay);
  document.getElementById("bpm").addEventListener("input", e => {
    if (state.ready) Tone.Transport.bpm.value = Number(e.target.value);
    retuneSyncedLFOs();
    for (const t of state.tracks) {
      if (t.fxRack && t.fxConfig.delay.sync) t.fxRack.applyDelay({});
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
  modeBtn.addEventListener("click", () => {
    state.patternMode = state.patternMode === "chain" ? "repeat" : "chain";
    modeBtn.textContent = state.patternMode;
    modeBtn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
  });
  document.getElementById("set-save").addEventListener("click", onSaveSet);
  document.getElementById("set-load").addEventListener("click", onLoadSet);
  document.getElementById("set-export").addEventListener("click", onExportSet);
  document.getElementById("set-import").addEventListener("click", onImportSet);
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
}

init();
