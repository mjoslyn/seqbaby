import { AUTOMATION_TARGETS } from "./automation.js";
import { normalizeAudioBuffer } from "./buffers.js";
import { PATTERN_COUNT } from "./constants.js";
import { showInputDialog, showSelectDialog } from "./dialogs.js";
import { setStatus } from "./dom.js";
import { ICON_CHAIN, ICON_FINISH, ICON_NOW, ICON_REPEAT } from "./icons.js";
import { applySampleSpeed, disposeLFOs, syncAllLFOs } from "./lfo.js";
import { guessIsDrumKit, parseMeter } from "./meter.js";
import { updatePlaitsControlsVisibility } from "./params.js";
import { renderPatternGrid } from "./patternBar.js";
import { refreshFxPanelUI, renderModPanel } from "./render.js";
import { syncScaleUI } from "./scaleUI.js";
import { applyCompressorConfig, ensureFxRack, refreshCompSourceDropdowns, routeVoiceToRack } from "./signal.js";
import { aliasPattern, state, syncMeterUI } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { createTrack, removeTrack } from "./track.js";
import { ensureAudio, requestMidiIfNeeded, silenceAllVoices } from "./transport.js";
import { buildVoiceForEngine } from "./voices.js";


/** @typedef {import("./types.js").AppState} AppState */
/** @typedef {import("./types.js").Track} Track */
export const SETS_KEY = "seqbaby.sets.v1";
export function loadSetsMap() { try { return JSON.parse(localStorage.getItem(SETS_KEY) || "{}"); } catch { return {}; } }
export function storeSetsMap(m) { try { localStorage.setItem(SETS_KEY, JSON.stringify(m)); } catch {} }

/**
 * Snapshot the whole session (transport, scale, patterns, tracks, sample
 * payloads) into a plain JSON-safe object for save / export / share.
 * @returns {Object}
 */
export function serializeSet() {
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
      eq: { ...t.eq },
      comp: { ...t.comp },
      fxConfig: JSON.parse(JSON.stringify(t.fxConfig)),
      midi: { ...t.midi },
      customConfig: t.customConfig ? JSON.parse(JSON.stringify(t.customConfig)) : null,
      wavetable: t.wavetable?.frames?.length ? { frames: t.wavetable.frames.map(f => Array.from(f, x => Math.round(x * 1e4) / 1e4)) } : null,
      sampleSource: t.sampleSource ? { ...t.sampleSource } : null,
      slices: Array.isArray(t.slices) ? t.slices.slice() : [],
      sliceOn: !!t.sliceOn,
      sliceBase: t.sliceBase ?? 60,
      slicePlayMode: t.slicePlayMode === "toend" ? "toend" : "region",
      uploadAudio: t.uploadAudio || null,
      uploadAudioMime: t.uploadAudioMime || null,
      uploadFileName: t.uploadFileName || null,
      soundPromptText: t.soundPromptText,
      promptText: t.promptText || "",
      sampleDefaults: t.sampleDefaults ? { ...t.sampleDefaults } : undefined,
      locked: t.locked, muted: t.muted, soloed: t.soloed,
      isDrumKit: !!t.isDrumKit,
      noteMode: t.noteMode === "trigger" ? "trigger" : "gate",
      glide: t.glide, speed: t.speed ?? 1, sampleSpeedMode: t.sampleSpeedMode ?? "native",
      pitchLock: t.pitchLock ?? true,
      lfoConfig: JSON.parse(JSON.stringify(t.lfoConfig)),
      patterns: t.patterns.map(p => ({
        steps: p.steps.slice(),
        lengths: p.lengths.slice(),
        notes: p.notes.slice(),
        velocities: p.velocities.slice(),
        chords: p.chords.slice(),
        offsets:         (p.offsets         ?? []).slice(),
        arps:            (p.arps            ?? []).slice(),
        arpRates:        (p.arpRates        ?? []).slice(),
        arpRanges:       (p.arpRanges       ?? []).slice(),
        arpDirs:         (p.arpDirs         ?? []).slice(),
        complexities:    (p.complexities    ?? []).slice(),
        ratchets:        (p.ratchets        ?? []).slice(),
        sampleStarts:    (p.sampleStarts    ?? []).slice(),
        sampleEnds:      (p.sampleEnds      ?? []).slice(),
        sampleFadeIns:   (p.sampleFadeIns   ?? []).slice(),
        sampleFadeOuts:  (p.sampleFadeOuts  ?? []).slice(),
        sampleLoopModes: (p.sampleLoopModes ?? []).slice(),
        extraNotes: (p.extraNotes ?? []).map(slot => Array.isArray(slot) ? slot.slice() : null),
        extraLengths: (p.extraLengths ?? []).map(slot => Array.isArray(slot) ? slot.slice() : null),
        automation: p.automation ? Object.fromEntries(
          Object.entries(p.automation)
            .filter(([k]) => AUTOMATION_TARGETS[k])
            .map(([k, lane]) => [k, { enabled: !!lane.enabled, values: (lane.values || []).slice() }])
        ) : {},
      })),
    })),
  };
}

export async function onSaveSet() {
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
export function formatSavedAt(iso) {
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
export function suggestSetName() {
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

export function shortToken() {
  return Math.random().toString(36).slice(2, 5);
}

export function onExportSet() {
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

export async function onShareSet() {
  const btn = document.getElementById("set-share");
  if (btn) btn.disabled = true;
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
    if (btn) btn.disabled = false;
  }
}

export async function loadShareFromUrl() {
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

export function onImportSet() {
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

export async function onLoadSet() {
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

/**
 * Rebuild the entire app from a serialized session: tracks, voices,
 * patterns, and transport state.
 * @param {Object} s  A snapshot from serializeSet.
 */
export function applySet(s) {
  if (!s) return;
  if (state.playing) {
    Tone.Transport.stop();
    if (state.repeatId !== null) { try { Tone.Transport.clear(state.repeatId); } catch {} state.repeatId = null; }
    silenceAllVoices();
    state.playing = false;
    const btn = document.getElementById("play");
    btn.textContent = "play";
    btn.classList.remove("is-playing");
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
    // Migrate legacy sample engines (upload / smp:* / eleven) onto the unified
    // sampler. eleven's separately-persisted audio folds into the upload buffer.
    let ek = td.engineKey || "plaits:0";
    let src = td.sampleSource || null;
    let uploadAudio = td.uploadAudio || null;
    let uploadMime  = td.uploadAudioMime || null;
    if (ek === "upload") {
      ek = "sampler"; src = src || { kind: "upload", name: td.uploadFileName || "sample" };
    } else if (ek === "eleven") {
      ek = "sampler"; src = src || { kind: "upload", name: td.uploadFileName || "sample" };
      if (!uploadAudio && td.elevenAudio) { uploadAudio = td.elevenAudio; uploadMime = td.elevenAudioMime || uploadMime; }
    } else if (ek.startsWith("smp:")) {
      const id = ek.slice(4); ek = "sampler"; src = src || { kind: "bundled", id, name: id };
    }
    const t = createTrack({ name: td.name || "track", engineKey: ek, length: td.length || 16 });
    Object.assign(t.params, td.params || {});
    Object.assign(t.filter, td.filter || {});
    if (td.eq)   Object.assign(t.eq,   td.eq);
    if (td.comp) Object.assign(t.comp, td.comp);
    Object.assign(t.fxConfig, td.fxConfig || {});
    Object.assign(t.midi, td.midi || {});
    t.customConfig = td.customConfig || null;
    t.wavetable = td.wavetable?.frames?.length ? { frames: td.wavetable.frames.map(f => Array.from(f)) } : null;
    t.sampleSource = src;
    t.uploadAudio = uploadAudio;
    t.uploadAudioMime = uploadMime;
    t.uploadFileName = td.uploadFileName || null;
    t.soundPromptText = td.soundPromptText || "";
    t.promptText = td.promptText || "";
    t.sampleDefaults = td.sampleDefaults
      ? { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off", ...td.sampleDefaults }
      : { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off" };
    t.slices = Array.isArray(td.slices) ? td.slices.slice() : [];
    t.sliceOn = !!td.sliceOn;
    t.sliceBase = td.sliceBase ?? 60;
    t.slicePlayMode = td.slicePlayMode === "toend" ? "toend" : "region";
    // decode any saved upload/eleven audio (async; the sampler picks it up).
    // Bundled sources need no decode — the SamplerVoice fetches by id when built.
    if (t.uploadAudio) {
      (async () => {
        try {
          const bytes = Uint8Array.from(atob(t.uploadAudio), c => c.charCodeAt(0));
          await ensureAudio();
          const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
          t.uploadBuffer = buffer;
          if (t.voice?.type === "sampler" || t.voice?.type === "granular") { t.voice.setBuffer(buffer); applySampleSpeed(t); }
        } catch (e) { console.warn("upload buffer decode failed", e); }
      })();
    }
    t.locked = !!td.locked;
    t.muted  = !!td.muted;
    t.soloed = !!td.soloed;
    t.isDrumKit = typeof td.isDrumKit === "boolean"
      ? td.isDrumKit
      : guessIsDrumKit({ engineKey: t.engineKey, name: t.name });
    t.noteMode = td.noteMode === "trigger" ? "trigger" : "gate";
    t.glide  = td.glide ?? 0;
    t.speed  = td.speed ?? 1;
    t.sampleSpeedMode = td.sampleSpeedMode ?? "native";
    t.pitchLock = td.pitchLock ?? true;
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
          offsets:         pad(p.offsets,         0,      n),
          arps:            pad(p.arps,            false,  n),
          arpRates:        pad(p.arpRates,        0.25,   n),
          arpRanges:       pad(p.arpRanges,       1,      n),
          arpDirs:         pad(p.arpDirs,         "up",   n),
          complexities:    pad(p.complexities,    0,      n),
          ratchets:        pad(p.ratchets,        1,      n),
          sampleStarts:    pad(p.sampleStarts,    0,      n),
          sampleEnds:      pad(p.sampleEnds,      1,      n),
          sampleFadeIns:   pad(p.sampleFadeIns,   0,      n),
          sampleFadeOuts:  pad(p.sampleFadeOuts,  0,      n),
          sampleLoopModes: pad(p.sampleLoopModes, "off",  n),
          extraNotes:      pad(p.extraNotes,      null,   n),
          extraLengths:    pad(p.extraLengths,    null,   n),
          automation,
        };
      }
    }
    aliasPattern(t, state.activePattern);
    if (t.el) {
      const q = s => t.el.querySelector(s);
      q(".sq-track__name").value = t.name;
      q(".sq-track__len").value = t.length;
      q(".sq-track__engine").value = t.engineKey;
      q(".sq-track__glide").value = t.glide;
      q(".p-vol").value = t.params.vol;
      q(".p-harm").value = t.params.harm;
      q(".p-timb").value = t.params.timb;
      q(".p-morph").value = t.params.morph;
      q(".p-decay").value = t.params.decay;
      for (const k of ["gspeed", "gwindow", "gjitter", "gdetune", "gpan", "gplay", "gloop", "gpattern", "grate"]) {
        const el = q(`.p-${k}`);
        if (el && t.params[k] != null) el.value = t.params[k];
      }
      const gsyncEl = q(".p-gsync");
      if (gsyncEl) gsyncEl.checked = !!t.params.gsync;
      q(".p-cutoff").value = t.filter.cutoff;
      q(".p-reson").value = t.filter.reson;
      q(".p-envamt").value = t.filter.env;
      q(".p-envatk").value = t.filter.attack;
      q(".p-envdec").value = t.filter.decay;
      q(".p-envsus").value = t.filter.sustain;
      q(".p-envrel").value = t.filter.release;
      q(".sq-track__lock")?.setAttribute("aria-pressed", String(t.locked));
      q(".sq-track__solo")?.setAttribute("aria-pressed", String(t.soloed));
      const nmBtn = q(".track-note-mode");
      if (nmBtn) {
        const isGate = t.noteMode !== "trigger";
        nmBtn.textContent = isGate ? "gate" : "trig";
        nmBtn.setAttribute("aria-pressed", String(isGate));
      }
      t.el.classList.toggle("is-muted", t.muted);
      t.el.classList.toggle("is-locked", t.locked);
      t.el.classList.toggle("is-soloed", t.soloed);
      refreshFxPanelUI(t);
      renderModPanel(t, t._modPanelEl || t.el.querySelector(".sq-track__mod-panel"));
      const eqPanel = t._eqPanelEl || t.el.querySelector(".sq-track__eq-panel");
      if (eqPanel) {
        eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
        eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
        eqPanel.querySelector(".p-eq-high").value = t.eq.high;
      }
      const compPanel = t._compPanelEl || t.el.querySelector(".sq-track__comp-panel");
      if (compPanel) {
        compPanel.querySelector(".comp-enabled").checked = !!t.comp.enabled;
        compPanel.querySelector(".comp-threshold").value = t.comp.threshold;
        compPanel.querySelector(".comp-ratio").value     = t.comp.ratio;
        compPanel.querySelector(".comp-attack").value    = t.comp.attack;
        compPanel.querySelector(".comp-release").value   = t.comp.release;
        compPanel.querySelector(".comp-knee").value      = t.comp.knee;
      }
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
      if (t.eqNode) {
        t.eqNode.setBand("low",  t.eq.low);
        t.eqNode.setBand("mid",  t.eq.mid);
        t.eqNode.setBand("high", t.eq.high);
      }
      applyCompressorConfig(t);
      syncAllLFOs(t);
    }
    updatePlaitsControlsVisibility(t);
    renderStepGrid(t);
  }
  // Re-populate comp-source dropdowns now that every track exists, so cross-
  // track sidechain selections from the saved set resolve to a real option.
  refreshCompSourceDropdowns();
  if (state.ready) for (const t of state.tracks) applyCompressorConfig(t);
  // MIDI access is lazy (only requested when a track uses a MIDI engine); a
  // loaded set may introduce the first MIDI track after audio init already ran.
  requestMidiIfNeeded();
  renderPatternGrid();
  syncMeterUI();
  setStatus("set loaded");
}

// ---- track patches -----------------------------------------------------
// A "patch" is a track's whole SOUND (engine + params + filter/eq/comp/fx/lfo +
// any embedded audio), independent of its pattern/steps and track-level state
// (name, mute/solo/lock, length). Serialize captures it; apply installs it onto
// any existing track, reusing the same voice/UI rebuild path as session load.

/** @param {Track} t */
export function serializeTrackPatch(t) {
  return {
    _kind: "track-patch",
    // A saved custom-Tone patch is stored as engineKey "custom" + customConfig.
    engineKey: t.engineKey.startsWith("saved:") ? "custom" : t.engineKey,
    params: { ...t.params },
    filter: { ...t.filter },
    eq: { ...t.eq },
    comp: { ...t.comp },
    fxConfig: JSON.parse(JSON.stringify(t.fxConfig)),
    lfoConfig: JSON.parse(JSON.stringify(t.lfoConfig)),
    customConfig: t.customConfig ? JSON.parse(JSON.stringify(t.customConfig)) : null,
    sampleSource: t.sampleSource ? { ...t.sampleSource } : null,
    slices: Array.isArray(t.slices) ? t.slices.slice() : [],
    sliceOn: !!t.sliceOn,
    sliceBase: t.sliceBase ?? 60,
    slicePlayMode: t.slicePlayMode === "toend" ? "toend" : "region",
    uploadAudio: t.uploadAudio || null,
    uploadAudioMime: t.uploadAudioMime || null,
    uploadFileName: t.uploadFileName || null,
    soundPromptText: t.soundPromptText || "",
    sampleDefaults: t.sampleDefaults ? { ...t.sampleDefaults } : undefined,
    isDrumKit: !!t.isDrumKit,
    noteMode: t.noteMode === "trigger" ? "trigger" : "gate",
    glide: t.glide ?? 0,
    speed: t.speed ?? 1,
    sampleSpeedMode: t.sampleSpeedMode ?? "native",
    pitchLock: t.pitchLock ?? true,
  };
}

/** @param {Track} t @param {any} patch */
export function applyTrackPatch(t, patch) {
  if (!patch) return;
  // Migrate legacy sample engines in saved patches onto the unified sampler.
  if (patch.engineKey) {
    let ek = patch.engineKey;
    if (ek === "upload" || ek === "eleven") { patch.sampleSource = patch.sampleSource || { kind: "upload", name: patch.uploadFileName || "sample" }; ek = "sampler"; }
    else if (ek.startsWith("smp:")) { patch.sampleSource = patch.sampleSource || { kind: "bundled", id: ek.slice(4), name: ek.slice(4) }; ek = "sampler"; }
    if (ek === "sampler" && !patch.uploadAudio && patch.elevenAudio) { patch.uploadAudio = patch.elevenAudio; patch.uploadAudioMime = patch.elevenAudioMime || patch.uploadAudioMime; }
    t.engineKey = ek;
  }
  if (patch.params)   Object.assign(t.params, patch.params);
  if (patch.filter)   Object.assign(t.filter, patch.filter);
  if (patch.eq)       Object.assign(t.eq, patch.eq);
  if (patch.comp)     Object.assign(t.comp, patch.comp);
  if (patch.fxConfig) Object.assign(t.fxConfig, patch.fxConfig);
  if (patch.lfoConfig) {
    for (const k of Object.keys(t.lfoConfig)) delete t.lfoConfig[k];
    Object.assign(t.lfoConfig, patch.lfoConfig);
  }
  t.customConfig     = patch.customConfig || null;
  t.sampleSource     = patch.sampleSource || null;
  t.uploadAudio      = patch.uploadAudio || null;
  t.uploadAudioMime  = patch.uploadAudioMime || null;
  t.uploadFileName   = patch.uploadFileName || null;
  t.soundPromptText  = patch.soundPromptText || "";
  if (patch.sampleDefaults) {
    t.sampleDefaults = { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off", ...patch.sampleDefaults };
  }
  t.slices = Array.isArray(patch.slices) ? patch.slices.slice() : [];
  t.sliceOn = !!patch.sliceOn;
  t.sliceBase = patch.sliceBase ?? 60;
  t.slicePlayMode = patch.slicePlayMode === "toend" ? "toend" : "region";
  t.isDrumKit        = !!patch.isDrumKit;
  t.noteMode         = patch.noteMode === "trigger" ? "trigger" : "gate";
  t.glide            = patch.glide ?? 0;
  t.speed            = patch.speed ?? 1;
  t.sampleSpeedMode  = patch.sampleSpeedMode ?? "native";
  t.pitchLock        = patch.pitchLock ?? true;

  // Decode embedded sample audio (async; the sampler picks it up when ready).
  if (t.uploadAudio) {
    (async () => {
      try {
        const bytes = Uint8Array.from(atob(t.uploadAudio), c => c.charCodeAt(0));
        await ensureAudio();
        const buffer = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(bytes.buffer));
        t.uploadBuffer = buffer;
        if (t.voice?.type === "sampler" || t.voice?.type === "granular") { t.voice.setBuffer(buffer); applySampleSpeed(t); }
      } catch (e) { console.warn("upload buffer decode failed", e); }
    })();
  } else t.uploadBuffer = null;

  if (t.el) {
    const q = s => t.el.querySelector(s);
    q(".sq-track__engine").value = t.engineKey;
    q(".p-vol").value    = t.params.vol;
    q(".p-harm").value   = t.params.harm;
    q(".p-timb").value   = t.params.timb;
    q(".p-morph").value  = t.params.morph;
    q(".p-decay").value  = t.params.decay;
    for (const k of ["gspeed", "gwindow", "gjitter", "gdetune", "gpan", "gplay", "gloop", "gpattern", "grate"]) {
      const el = q(`.p-${k}`);
      if (el && t.params[k] != null) el.value = t.params[k];
    }
    const gsyncEl2 = q(".p-gsync");
    if (gsyncEl2) gsyncEl2.checked = !!t.params.gsync;
    q(".p-cutoff").value = t.filter.cutoff;
    q(".p-reson").value  = t.filter.reson;
    q(".p-envamt").value = t.filter.env;
    q(".p-envatk").value = t.filter.attack;
    q(".p-envdec").value = t.filter.decay;
    q(".p-envsus").value = t.filter.sustain;
    q(".p-envrel").value = t.filter.release;
    const eqPanel = t._eqPanelEl || q(".sq-track__eq-panel");
    if (eqPanel) {
      eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
      eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
      eqPanel.querySelector(".p-eq-high").value = t.eq.high;
    }
    const compPanel = t._compPanelEl || q(".sq-track__comp-panel");
    if (compPanel) {
      compPanel.querySelector(".comp-enabled").checked = !!t.comp.enabled;
      compPanel.querySelector(".comp-threshold").value = t.comp.threshold;
      compPanel.querySelector(".comp-ratio").value     = t.comp.ratio;
      compPanel.querySelector(".comp-attack").value    = t.comp.attack;
      compPanel.querySelector(".comp-release").value   = t.comp.release;
      compPanel.querySelector(".comp-knee").value      = t.comp.knee;
    }
    const nmBtn = q(".track-note-mode");
    if (nmBtn) {
      const isGate = t.noteMode !== "trigger";
      nmBtn.textContent = isGate ? "gate" : "trig";
      nmBtn.setAttribute("aria-pressed", String(isGate));
    }
    refreshFxPanelUI(t);
    renderModPanel(t, t._modPanelEl || q(".sq-track__mod-panel"));
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
    if (t.eqNode) {
      t.eqNode.setBand("low",  t.eq.low);
      t.eqNode.setBand("mid",  t.eq.mid);
      t.eqNode.setBand("high", t.eq.high);
    }
    applyCompressorConfig(t);
    syncAllLFOs(t);
  }
  requestMidiIfNeeded();
  updatePlaitsControlsVisibility(t);
  renderStepGrid(t);
  t._refreshSaveEnabled?.();
}

