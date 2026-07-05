import { AUTOMATION_KEYS, AUTOMATION_TARGETS, canAutomate } from "./automation.js";
import { engineByKey, loadPatches, populateEngineSelect, savePatch } from "./catalog.js";
import { applyTrackPatch, serializeTrackPatch } from "./session.js";
import { LFO_KEYS, lfoLabel, rateToSlider, sliderToRate } from "./constants.js";
import { showInputDialog, showSavedPatchPicker } from "./dialogs.js";
import { setStatus } from "./dom.js";
import { randomizeMelody, randomizeTimbre } from "./generate.js";
import { ICON_DICE, ICON_LOAD, ICON_SAVE } from "./icons.js";
import { canModulate, currentBpm, rateFromSync, syncLFO } from "./lfo.js";
import { pickAudioFileForTrack } from "./main.js";
import { defaultFxConfig } from "./fxRack.js";
import { GLOBAL_FX_AUTO_STEPS, defaultGlobalFxConfig, defaultGlobalFxModConfig, globalFxAutoKeys, globalFxModKeys, syncGlobalFxLFO } from "./globalFx.js";
import { defaultMorphageneConfig } from "./morphagene.js";
import { MG_AUTO_KEYS, MG_AUTO_LABEL, MG_AUTO_STEPS, MG_MOD_KEYS, MG_MOD_LABEL, defaultMorphageneModConfig, syncMorphageneLFO } from "./morphageneMod.js";
import { patternMeter, redetectDrumKit, stepsPerBarForMeter } from "./meter.js";
import { setEngineKey, setParam, updatePlaitsControlsVisibility } from "./params.js";
import { bestRollViewOct } from "./pianoRoll.js";
import { applyCompressorConfig, setEQ, setFilter } from "./signal.js";
import { state } from "./state.js";
import { openAutAsModal, openCompAsModal, openEnvAsModal, openEqAsModal, openFilterAsModal, openFxAsModal, openModAsModal, openRollAsModal, openTrackMenu } from "./stepEditor.js";
import { attachGridInteraction, renderStepGrid } from "./stepGrid.js";
import { duplicateTrack, extendPatternByDuplicate, removeTrack, resizePattern, resizeTrack, shiftTrackOctave, truncatePattern } from "./track.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Build (or rebuild) a track's full DOM: head controls, synth row, step
 * grid, and the collapsible filter/env/fx/eq/comp/mod panels.
 * @param {Track} t
 */
export function renderTrack(t) {
  const tpl = document.getElementById("track-template");
  const node = tpl.content.firstElementChild.cloneNode(true);
  t.el = node;
  node.dataset.trackId = String(t.id);

  const engineSel = node.querySelector(".sq-track__engine");
  populateEngineSelect(engineSel);
  engineSel.value = t.engineKey;

  node.querySelector(".sq-track__name").value = t.name;
  node.querySelector(".sq-track__len").value = t.length;
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

  node.querySelector(".sq-track__name").addEventListener("input", e => {
    t.name = e.target.value;
    redetectDrumKit(t);
  });
  node.querySelector(".sq-track__len").addEventListener("change", e => {
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

  const saveBtn = node.querySelector(".sq-track__save");
  saveBtn.innerHTML = ICON_SAVE;
  // Any track's sound can be saved as a patch now (engine + params + fx + audio).
  const refreshSaveEnabled = () => { saveBtn.disabled = false; };
  refreshSaveEnabled();
  saveBtn.addEventListener("click", async () => {
    const suggested = t.soundPromptText ? t.soundPromptText.split(/[.,;]/)[0].slice(0, 40) : t.name;
    const name = await showInputDialog({
      title: "save patch as",
      defaultValue: suggested,
      placeholder: "my-patch-name",
    });
    if (!name || !name.trim()) return;
    savePatch(name.trim(), serializeTrackPatch(t));
    setStatus(`saved patch "${name.trim()}"`);
  });

  const loadPatchBtn = node.querySelector(".sq-track__load-patch");
  if (loadPatchBtn) {
    loadPatchBtn.innerHTML = ICON_LOAD;
    loadPatchBtn.addEventListener("click", async () => {
      const name = await showSavedPatchPicker();
      if (!name) return;
      const patch = loadPatches()[name];
      if (!patch) return;
      if (patch._kind === "track-patch") {
        applyTrackPatch(t, patch);
      } else {
        // legacy custom-Tone patch: load it as a saved engine
        setEngineKey(t, `saved:${name}`);
        if (node.querySelector(".sq-track__engine")) node.querySelector(".sq-track__engine").value = `saved:${name}`;
      }
      setStatus(`loaded patch "${name}"`);
    });
  }
  // glide + swing are wired in renderModPanel (they live in the mod panel row now).
  const speedSel = node.querySelector(".sq-track__speed");
  if (speedSel) {
    speedSel.value = String(t.speed ?? 1);
    speedSel.addEventListener("change", e => {
      t.speed = Number(e.target.value) || 1;
      t.speedAccum = 0;
    });
  }
  // density slider is rendered inside the mod panel alongside glide + swing

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

  const soloBtn = node.querySelector(".sq-track__solo");
  soloBtn.addEventListener("click", () => {
    t.soloed = !t.soloed;
    soloBtn.setAttribute("aria-pressed", String(t.soloed));
    node.classList.toggle("is-soloed", t.soloed);
  });

  const noteModeBtn = node.querySelector(".track-note-mode");
  const refreshNoteModeBtn = () => {
    const isGate = (t.noteMode ?? "gate") === "gate";
    noteModeBtn.textContent = isGate ? "gate" : "trig";
    noteModeBtn.setAttribute("aria-pressed", String(isGate));
  };
  refreshNoteModeBtn();
  noteModeBtn.addEventListener("click", () => {
    t.noteMode = ((t.noteMode ?? "gate") === "gate") ? "trigger" : "gate";
    refreshNoteModeBtn();
  });

  engineSel.addEventListener("change", () => refreshSaveEnabled());
  // also update save button when customConfig is assigned later — keep a ref on track
  t._refreshSaveEnabled = refreshSaveEnabled;

  const panelModals = [
    { btnSel: ".sq-track__mod",    modalKey: "_modModal" },
    { btnSel: ".track-aut",    modalKey: "_autModal" },
    { btnSel: ".sq-track__roll",   modalKey: "_rollModal" },
    { btnSel: ".sq-track__filter", modalKey: "_filterModal" },
    { btnSel: ".sq-track__env",    modalKey: "_envModal" },
    { btnSel: ".sq-track__fx",     modalKey: "_fxModal" },
    { btnSel: ".sq-track__eq",     modalKey: "_eqModal" },
    { btnSel: ".sq-track__comp",   modalKey: "_compModal" },
  ];
  function closeOtherPanels(keepBtnSel) {
    for (const p of panelModals) {
      if (p.btnSel === keepBtnSel) continue;
      if (t[p.modalKey]) t[p.modalKey].close();
    }
  }

  // Stash stable refs to every collapsible panel — once opened as a modal the
  // panel is reparented out of the track, so t.el.querySelector(...) would
  // miss it. All panels open as a centered modal overlay.
  t._modPanelEl    = node.querySelector(".sq-track__mod-panel");
  t._autPanelEl    = node.querySelector(".sq-track__aut-panel");
  t._rollPanelEl   = node.querySelector(".sq-track__roll-panel");
  t._filterPanelEl = node.querySelector(".sq-track__filter-panel");
  t._envPanelEl    = node.querySelector(".sq-track__env-panel");
  t._fxPanelEl     = node.querySelector(".sq-track__fx-panel");
  t._eqPanelEl     = node.querySelector(".sq-track__eq-panel");
  t._compPanelEl   = node.querySelector(".sq-track__comp-panel");
  t._modModal    = null;
  t._autModal    = null;
  t._rollModal   = null;
  t._filterModal = null;
  t._envModal    = null;
  t._fxModal     = null;
  t._eqModal     = null;
  t._compModal   = null;

  // Same idea for the synth-row sub-groups — they're reparented into the
  // track-menu-modal on mobile, so updatePlaitsControlsVisibility queries
  // these stashed refs instead of t.el.querySelector.
  t._timbreGroupEl  = node.querySelector(".sq-param-group--timbre");
  t._oscMixGroupEl  = node.querySelector(".sq-param-group--osc-mix");
  t._oscModGroupEl  = node.querySelector(".sq-param-group--osc-mod");
  t._moogOscGroupEl = node.querySelector(".sq-param-group--moog");

  renderModPanel(t, t._modPanelEl);
  wireFxPanel(t, t._fxPanelEl);
  const eqPanel = t._eqPanelEl;
  eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
  eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
  eqPanel.querySelector(".p-eq-high").value = t.eq.high;
  eqPanel.querySelector(".p-eq-low").addEventListener("input",  e => setEQ(t, "low",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-mid").addEventListener("input",  e => setEQ(t, "mid",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-high").addEventListener("input", e => setEQ(t, "high", Number(e.target.value)));

  const bindModalOpen = (btnSel, openFn, modalKey, beforeOpen) => {
    const btn = node.querySelector(btnSel);
    btn.addEventListener("click", () => {
      if (t[modalKey]) { t[modalKey].close(); return; }
      closeOtherPanels(btnSel);
      if (beforeOpen) beforeOpen();
      openFn(t);
      btn.setAttribute("aria-pressed", "true");
    });
  };
  bindModalOpen(".sq-track__mod",    openModAsModal,    "_modModal");
  bindModalOpen(".track-aut",    openAutAsModal,    "_autModal");
  bindModalOpen(".sq-track__roll",   openRollAsModal,   "_rollModal", () => {
    if (t.steps.some(s => s)) t.rollViewOct = bestRollViewOct(t);
  });
  bindModalOpen(".sq-track__filter", openFilterAsModal, "_filterModal");
  bindModalOpen(".sq-track__env",    openEnvAsModal,    "_envModal");
  bindModalOpen(".sq-track__fx",     openFxAsModal,     "_fxModal");
  bindModalOpen(".sq-track__eq",     openEqAsModal,     "_eqModal");
  bindModalOpen(".sq-track__comp",   openCompAsModal,   "_compModal");
  wireCompPanel(t, t._compPanelEl);

  node.querySelector(".sq-track__mute").addEventListener("click", () => {
    t.muted = !t.muted;
    node.classList.toggle("is-muted", t.muted);
  });
  node.querySelector(".sq-track__clear").addEventListener("click", () => {
    t.steps.fill(0);
    t.lengths.fill(0);
    t.notes.fill(null);
    t.velocities.fill(0.5);
    t.chords.fill("");
    renderStepGrid(t);
  });
  const diceBtn = node.querySelector(".track-dice");
  if (diceBtn) {
    diceBtn.innerHTML = ICON_DICE;
    diceBtn.addEventListener("click", () => randomizeMelody(t));
  }
  node.querySelector(".sq-track__remove").addEventListener("click", () => removeTrack(t));
  const dupBtn = node.querySelector(".sq-track__dup");
  if (dupBtn) dupBtn.addEventListener("click", () => duplicateTrack(t));

  // mobile: "more" toggle button opens a modal hosting the hidden track-head
  // extras (save/load patch, len-extend, oct/semi, synth params, dup, remove).
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sq-track__more sq-btn--ghost sq-mobile-only";
  moreBtn.setAttribute("aria-pressed", "false");
  moreBtn.setAttribute("aria-label", "show more track controls");
  moreBtn.title = "more";
  moreBtn.textContent = "…";
  moreBtn.addEventListener("click", () => {
    if (t._trackMenuModal) { t._trackMenuModal.close(); return; }
    openTrackMenu(t);
  });
  const panelGrp = node.querySelector(".sq-panel__btn-group");
  if (panelGrp) panelGrp.before(moreBtn);
  t._trackMoreBtn = moreBtn;
  t._trackMenuModal = null;

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

  attachGridInteraction(t, node.querySelector(".sq-steps"));
  renderStepGrid(t);
  document.getElementById("tracks").appendChild(node);
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
}

export function updateMidiUI(t) {
  const row = t.el?.querySelector(".sq-track__midi");
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

export function wireCompPanel(t, panel) {
  const q = s => panel.querySelector(s);
  const en = q(".comp-enabled");
  const src = q(".sq-comp__source");
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

export function applyFxToTrack(t, fx) {
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

export function refreshFxPanelUI(t) {
  if (!t.el) return;
  const panel = t._fxPanelEl || t.el.querySelector(".sq-track__fx-panel");
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

export function wireFxPanel(t, panel) {
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

// ---- morphagene (global master tape processor) -------------------------

// Main tape controls: selector, config key, wrapper setter, default, formatter.
// Shared by wireMorphagenePanel (readouts + reset) and refreshMorphagenePanelUI.
const fmt2 = v => Number(v).toFixed(2);
// Organize is a stepped splice selector: with >1 splice show which splice is
// active (matching the worklet's floor(organize*splices)); with one splice it's
// a continuous scan position.
const spliceIndex = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v * n - 1e-9)));
const fmtOrganize = v => {
  const n = state.morphageneConfig?.splices || 1;
  if (n <= 1) return fmt2(v);
  return `${spliceIndex(v, n) + 1}/${n}`;
};
// Hardware Organize is stepped: snap to the center of the selected splice band
// so it detents onto each splice. Continuous (scan) when there's one splice.
const snapOrganize = raw => {
  const n = state.morphageneConfig?.splices || 1;
  if (n <= 1) return raw;
  return (spliceIndex(raw, n) + 0.5) / n;
};
const MORPH_CTRLS = [
  { sel: ".morph-varispeed", key: "variSpeed", set: "setVariSpeed", def: 1,   fmt: v => Math.abs(v) < 0.02 ? "stop" : fmt2(v) },
  { sel: ".morph-organize",  key: "organize",  set: "setOrganize",  def: 0,   fmt: fmtOrganize, snap: snapOrganize },
  { sel: ".morph-genesize",  key: "geneSize",  set: "setGeneSize",  def: 0,   fmt: fmt2 },
  { sel: ".morph-slide",     key: "slide",     set: "setSlide",     def: 0,   fmt: fmt2 },
  { sel: ".morph-morph",     key: "morph",     set: "setMorph",     def: 0.2, fmt: fmt2 },
  { sel: ".morph-sos",       key: "sos",       set: "setSos",       def: 0,   fmt: fmt2 },
  { sel: ".morph-mix",       key: "mix",       set: "setMix",       def: 0,   fmt: fmt2 },
];

/** Ensure each control label has a value readout and refresh its text. */
function paintMorphReadouts(panel) {
  const cfg = state.morphageneConfig;
  for (const c of MORPH_CTRLS) {
    const el = panel.querySelector(c.sel);
    if (!el) continue;
    const label = el.closest(".sq-morph__ctl");
    let val = label?.querySelector(".sq-morph__val");
    if (label && !val) { val = document.createElement("span"); val.className = "sq-morph__val"; label.appendChild(val); }
    if (val) val.textContent = c.fmt(cfg?.[c.key] ?? el.value);
  }
}

/** Push state.morphageneConfig into the panel controls (config -> DOM). */
export function refreshMorphagenePanelUI() {
  const panel = document.getElementById("morph-panel");
  if (!panel) return;
  const cfg = state.morphageneConfig || (state.morphageneConfig = defaultMorphageneConfig());
  const set = (sel, v) => { const el = panel.querySelector(sel); if (el != null && v != null) el.value = v; };
  set(".morph-varispeed", cfg.variSpeed);
  set(".morph-organize",  cfg.organize);
  set(".morph-genesize",  cfg.geneSize);
  set(".morph-slide",     cfg.slide);
  set(".morph-morph",     cfg.morph);
  set(".morph-sos",       cfg.sos);
  set(".morph-mix",       cfg.mix);
  set(".morph-splices",   cfg.splices);
  const sync = panel.querySelector(".morph-sync");
  if (sync) sync.checked = !!cfg.sync;
  set(".morph-div", String(cfg.div ?? 4));
  syncMorphSyncEnabled(panel, !!cfg.sync);
  paintMorphReadouts(panel);
  panel.querySelector(".morph-freeze")?.setAttribute("aria-pressed", String(!!cfg.frozen));
  panel.querySelector(".morph-record")?.setAttribute("aria-pressed", "false");
}

/** The record-length division only matters while sync is on. */
function syncMorphSyncEnabled(panel, on) {
  const div = panel.querySelector(".morph-div");
  if (div) div.disabled = !on;
}

/**
 * Push the tempo-locked reel/record length to the worklet (seconds =
 * beats/bpm*60), or 0 for a free ring buffer. Call on sync/div change, bpm
 * change, node build, and session load.
 */
export function refreshMorphageneSync() {
  const cfg = state.morphageneConfig;
  if (!cfg) return;
  const seconds = cfg.sync ? (60 / currentBpm()) * Number(cfg.div || 4) : 0;
  state.morphagene?.setLoopLen(seconds);
}

/**
 * Wire the singular master morphagene panel once at init. Mirrors wireFxPanel:
 * DOM input -> state.morphageneConfig -> state.morphagene?.setX (guarded so it
 * works before audio init; the node picks the config up via applyAll on build).
 */
export function wireMorphagenePanel() {
  const panel = document.getElementById("morph-panel");
  if (!panel) return;
  const cfg = state.morphageneConfig || (state.morphageneConfig = defaultMorphageneConfig());
  const q = sel => panel.querySelector(sel);
  refreshMorphagenePanelUI();

  // Each slider: live readout + write-through, with double-click-the-name reset.
  // Controls with a `snap` quantize the slider (e.g. organize detents to splices).
  for (const c of MORPH_CTRLS) {
    const el = q(c.sel);
    if (!el) continue;
    const label = el.closest(".sq-morph__ctl");
    const name = label?.querySelector("span");
    const apply = (v) => { cfg[c.key] = v; state.morphagene?.[c.set](v); paintMorphReadouts(panel); };
    el.addEventListener("input", () => {
      let v = Number(el.value);
      if (c.snap) { v = c.snap(v); el.value = v; }
      apply(v);
    });
    name?.addEventListener("dblclick", () => { el.value = c.def; apply(c.def); });
  }
  paintMorphReadouts(panel);

  const organize = q(".morph-organize");
  const splices = q(".morph-splices");
  const applySplices = (n) => {
    n = Math.max(1, Math.min(16, n | 0));
    cfg.splices = n; splices.value = n;
    state.morphagene?.setSplices(n);
    // Re-snap organize onto a splice center for the new count.
    if (organize) {
      const v = snapOrganize(Number(organize.value));
      organize.value = v; cfg.organize = v; state.morphagene?.setOrganize(v);
    }
    paintMorphReadouts(panel);  // organize readout is splice-count dependent
  };
  splices?.addEventListener("change", () => applySplices(Number(splices.value)));
  splices?.closest(".sq-morph__ctl")?.querySelector("span")
    ?.addEventListener("dblclick", () => applySplices(1));

  const sync = q(".morph-sync");
  sync?.addEventListener("change", () => {
    cfg.sync = sync.checked;
    syncMorphSyncEnabled(panel, cfg.sync);
    refreshMorphageneSync();
  });
  const div = q(".morph-div");
  div?.addEventListener("change", () => {
    cfg.div = Number(div.value);
    refreshMorphageneSync();
  });

  const freeze = q(".morph-freeze");
  freeze?.addEventListener("click", () => {
    cfg.frozen = !cfg.frozen;
    freeze.setAttribute("aria-pressed", String(cfg.frozen));
    state.morphagene?.setFreeze(cfg.frozen);
  });

  const rec = q(".morph-record");
  rec?.addEventListener("click", () => {
    const on = rec.getAttribute("aria-pressed") !== "true";
    rec.setAttribute("aria-pressed", String(on));
    if (on) {
      cfg.frozen = false;
      freeze?.setAttribute("aria-pressed", "false");
      state.morphagene?.setFreeze(false);
      state.morphagene?.captureStart();
    } else {
      state.morphagene?.captureStop();
      cfg.frozen = true;
      freeze?.setAttribute("aria-pressed", "true");
    }
  });

  // Reel-fill meter, fed by the worklet's throttled status messages. The node
  // may not exist until first play, so register the callback on state for
  // ensureAudio to attach when it builds the MorphageneNode.
  const bar = q(".sq-morph__reel-bar");
  if (bar) {
    state.morphageneStatusCb = d => { bar.style.width = `${Math.round((d.filled || 0) * 100)}%`; };
    if (state.morphagene) state.morphagene.onStatus = state.morphageneStatusCb;
  }

  // fx / mod / aut sub-panels and their tab toggles.
  wireMorphageneFxPanel();
  renderMorphageneModPanel();
  renderMorphageneAutPanel();
  const tab = (btnSel, panelId) => {
    const btn = q(btnSel);
    const p = document.getElementById(panelId);
    btn?.addEventListener("click", () => {
      const show = p.hidden;
      p.hidden = !show;
      btn.setAttribute("aria-pressed", String(show));
    });
  };
  tab(".morph-fx-toggle", "morph-fx-panel");
  tab(".morph-mod-toggle", "morph-mod-panel");
  tab(".morph-aut-toggle", "morph-aut-panel");
}

// ---- morphagene fx rack (wet path) — reuse the track fx panel + wiring -----

function morphFxTarget(fxNode) {
  return {
    fxConfig: state.morphageneFxConfig,
    get fxRack() { return state.morphagene?.fxRack; },
    el: fxNode,
    _fxPanelEl: fxNode,
  };
}

/** Clone the track fx-panel markup into the morph fx container and wire it. */
export function wireMorphageneFxPanel() {
  const host = document.getElementById("morph-fx-panel");
  if (!host || host._wired) return;
  if (!state.morphageneFxConfig) state.morphageneFxConfig = defaultFxConfig();
  const tpl = document.getElementById("track-template");
  const fxNode = tpl?.content.querySelector(".sq-track__fx-panel")?.cloneNode(true);
  if (!fxNode) return;
  fxNode.hidden = false;
  fxNode.classList.add("sq-morph__fx");
  host.replaceChildren(fxNode);
  host._fxNode = fxNode;
  wireFxPanel(morphFxTarget(fxNode), fxNode);
  host._wired = true;
}

/** Re-apply the whole morphagene fx config to its rack + sliders (session load). */
export function applyMorphageneFx() {
  const host = document.getElementById("morph-fx-panel");
  if (!host?._fxNode || !state.morphageneFxConfig) return;
  applyFxToTrack(morphFxTarget(host._fxNode), state.morphageneFxConfig);
}

// ---- generic mod / aut rack builders (shared by morphagene + master fx) --

/** Build an LFO modulation rack UI into `panel`. opts: {cfg, keys, labelOf, syncFn} */
function renderModRack(panel, { cfg, keys, labelOf, syncFn }) {
  const tpl = document.getElementById("lfo-row-template");
  panel.replaceChildren();

  const rows = document.createElement("div");
  rows.className = "sq-mod__rows";
  panel.appendChild(rows);

  const adder = document.createElement("div");
  adder.className = "sq-mod__add-row";
  adder.innerHTML = `
    <button class="sq-mod__add-btn sq-btn--ghost" type="button">+ add modulation</button>
    <select class="sq-mod__add-select" hidden></select>`;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-mod__add-btn");
  const addSel = adder.querySelector(".sq-mod__add-select");

  const refreshAdder = () => {
    const avail = keys.filter(k => !cfg[k]?.enabled);
    if (!avail.length) { addBtn.disabled = true; addSel.hidden = true; addBtn.textContent = "(all modulations active)"; }
    else {
      addBtn.disabled = false; addBtn.textContent = "+ add modulation";
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + avail.map(k => `<option value="${k}">${labelOf(k)}</option>`).join("");
    }
  };

  const addRow = (key) => {
    const c = cfg[key];
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.dataset.key = key;
    row.classList.add("is-active");
    row.querySelector(".sq-lfo__target").textContent = labelOf(key);
    const cb = row.querySelector(".lfo-on");
    const shape = row.querySelector(".sq-lfo__shape");
    const rate = row.querySelector(".sq-lfo__rate");
    const rateLbl = row.querySelector(".sq-lfo__rate-label");
    const depth = row.querySelector(".lfo-depth");
    const depthLbl = row.querySelector(".sq-lfo__depth-label");
    const syncCb = row.querySelector(".lfo-sync");
    const divSel = row.querySelector(".sq-lfo__div");
    const rateField = row.querySelector(".sq-lfo__rate-field");
    const removeBtn = row.querySelector(".sq-lfo__remove");
    cb.checked = c.enabled;
    shape.value = c.type;
    rate.value = rateToSlider(c.rate);
    depth.value = c.depth;
    depthLbl.textContent = c.depth.toFixed(2);
    syncCb.checked = c.sync;
    divSel.value = String(c.div);
    rateField.dataset.mode = c.sync ? "sync" : "hz";
    const refreshLbl = () => {
      if (c.sync) { const o = divSel.options[divSel.selectedIndex]; rateLbl.textContent = `${o ? o.textContent : c.div} · ${rateFromSync(c.div).toFixed(2)} hz`; }
      else rateLbl.textContent = `${c.rate.toFixed(2)} hz`;
    };
    refreshLbl();
    cb.addEventListener("change", () => { c.enabled = cb.checked; row.classList.toggle("is-active", c.enabled); syncFn(key); });
    shape.addEventListener("change", () => { c.type = shape.value; syncFn(key); });
    rate.addEventListener("input", () => { c.rate = sliderToRate(Number(rate.value)); refreshLbl(); syncFn(key); });
    depth.addEventListener("input", () => { c.depth = Number(depth.value); depthLbl.textContent = c.depth.toFixed(2); syncFn(key); });
    syncCb.addEventListener("change", () => { c.sync = syncCb.checked; rateField.dataset.mode = c.sync ? "sync" : "hz"; refreshLbl(); syncFn(key); });
    divSel.addEventListener("change", () => { c.div = Number(divSel.value); refreshLbl(); syncFn(key); });
    removeBtn?.addEventListener("click", () => { c.enabled = false; syncFn(key); row.remove(); refreshAdder(); });
    rows.appendChild(row);
  };

  addBtn.addEventListener("click", () => { if (addSel.hidden) addSel.hidden = false; });
  addSel.addEventListener("change", () => {
    const key = addSel.value;
    if (!key) return;
    cfg[key].enabled = true;
    addRow(key);
    syncFn(key);
    addSel.hidden = true;
    refreshAdder();
  });

  for (const k of keys) if (cfg[k]?.enabled) addRow(k);
  refreshAdder();
}

/** Build a step-automation lane rack UI into `panel`. opts: {auto, keys, labelOf, steps} */
function renderAutRack(panel, { auto, keys, labelOf, steps }) {
  panel.replaceChildren();

  const rows = document.createElement("div");
  rows.className = "aut-rows";
  panel.appendChild(rows);

  const emptyMsg = document.createElement("div");
  emptyMsg.className = "sq-aut__empty";
  emptyMsg.textContent = `no automation — pick a target below (loops every bar · ${steps} steps)`;
  panel.appendChild(emptyMsg);

  const adder = document.createElement("div");
  adder.className = "sq-aut__add-row";
  adder.innerHTML = `
    <button class="sq-aut__add-btn sq-btn--ghost" type="button">+ add automation</button>
    <select class="sq-aut__add-select" hidden></select>`;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-aut__add-btn");
  const addSel = adder.querySelector(".sq-aut__add-select");

  const refreshAdder = () => {
    const avail = keys.filter(k => !auto[k]);
    if (!avail.length) { addBtn.disabled = true; addSel.hidden = true; addBtn.textContent = "(all targets automated)"; }
    else {
      addBtn.disabled = false; addBtn.textContent = "+ add automation";
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + avail.map(k => `<option value="${k}">${labelOf(k)}</option>`).join("");
    }
    emptyMsg.hidden = Object.keys(auto).length > 0;
  };

  const drawRow = (key) => {
    if (!auto[key]) auto[key] = { enabled: true, values: new Array(steps).fill(0.5) };
    const lane = auto[key];
    if (lane.values.length !== steps) {
      const o = new Array(steps).fill(0.5);
      for (let i = 0; i < Math.min(lane.values.length, steps); i++) o[i] = lane.values[i];
      lane.values = o;
    }
    const row = document.createElement("div");
    row.className = "sq-aut__lane" + (lane.enabled ? " is-active" : "");
    row.dataset.key = key;
    row.innerHTML = `
      <span class="sq-aut__label">${labelOf(key)}</span>
      <input type="checkbox" class="sq-aut__enable" ${lane.enabled ? "checked" : ""} title="enable lane" />
      <div class="sq-aut__grid"></div>
      <button class="sq-aut__clear sq-btn--ghost" type="button" title="reset to 0.5">clear</button>
      <button class="sq-aut__remove" type="button" title="remove lane">×</button>`;
    rows.appendChild(row);
    const grid = row.querySelector(".sq-aut__grid");
    for (let i = 0; i < steps; i++) {
      const cell = document.createElement("div");
      cell.className = "sq-aut__step";
      cell.dataset.idx = i;
      cell.style.setProperty("--v", String(lane.values[i] ?? 0));
      grid.appendChild(cell);
    }
    const setFromPointer = (ev) => {
      const rect = grid.getBoundingClientRect();
      const relX = Math.max(0, Math.min(rect.width - 1, ev.clientX - rect.left));
      const relY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const idx = Math.max(0, Math.min(steps - 1, Math.floor((relX / rect.width) * steps)));
      lane.values[idx] = Math.max(0, Math.min(1, 1 - (relY / rect.height)));
      grid.children[idx]?.style.setProperty("--v", String(lane.values[idx]));
    };
    let dragging = false;
    grid.addEventListener("pointerdown", (ev) => { dragging = true; try { grid.setPointerCapture(ev.pointerId); } catch {} setFromPointer(ev); ev.preventDefault(); });
    grid.addEventListener("pointermove", (ev) => { if (dragging) setFromPointer(ev); });
    grid.addEventListener("pointerup", (ev) => { dragging = false; try { grid.releasePointerCapture(ev.pointerId); } catch {} });
    grid.addEventListener("pointercancel", () => { dragging = false; });
    row.querySelector(".sq-aut__enable").addEventListener("change", (ev) => { lane.enabled = !!ev.target.checked; row.classList.toggle("is-active", lane.enabled); });
    row.querySelector(".sq-aut__clear").addEventListener("click", () => {
      for (let i = 0; i < lane.values.length; i++) lane.values[i] = 0.5;
      for (let i = 0; i < grid.children.length; i++) grid.children[i].style.setProperty("--v", "0.5");
    });
    row.querySelector(".sq-aut__remove").addEventListener("click", () => { delete auto[key]; row.remove(); refreshAdder(); });
  };

  addBtn.addEventListener("click", () => { if (addSel.hidden) addSel.hidden = false; });
  addSel.addEventListener("change", () => { const key = addSel.value; if (!key) return; drawRow(key); addSel.hidden = true; refreshAdder(); });

  for (const key of Object.keys(auto)) if (keys.includes(key)) drawRow(key);
  refreshAdder();
}

// ---- morphagene mod / aut (thin wrappers over the generic racks) --------

export function renderMorphageneModPanel() {
  const panel = document.getElementById("morph-mod-panel");
  if (!panel) return;
  if (!state.morphageneModConfig) state.morphageneModConfig = defaultMorphageneModConfig();
  renderModRack(panel, { cfg: state.morphageneModConfig, keys: MG_MOD_KEYS, labelOf: k => MG_MOD_LABEL[k], syncFn: syncMorphageneLFO });
}

export function renderMorphageneAutPanel() {
  const panel = document.getElementById("morph-aut-panel");
  if (!panel) return;
  if (!state.morphageneAutomation) state.morphageneAutomation = {};
  renderAutRack(panel, { auto: state.morphageneAutomation, keys: MG_AUTO_KEYS, labelOf: k => MG_AUTO_LABEL[k], steps: MG_AUTO_STEPS });
}

// ---- master (global) fx rack: fx panel + mod + aut ----------------------

function globalFxTarget(fxNode) {
  return {
    fxConfig: state.globalFxConfig,
    get fxRack() { return state.globalFx; },
    el: fxNode,
    _fxPanelEl: fxNode,
  };
}

/** Clone the track fx-panel markup into the master-fx container and wire it. */
export function wireGlobalFxPanel() {
  const host = document.getElementById("globalfx-fx-panel");
  if (!host || host._wired) return;
  if (!state.globalFxConfig) state.globalFxConfig = defaultGlobalFxConfig();
  const tpl = document.getElementById("track-template");
  const fxNode = tpl?.content.querySelector(".sq-track__fx-panel")?.cloneNode(true);
  if (!fxNode) return;
  fxNode.hidden = false;
  fxNode.classList.add("sq-morph__fx");
  host.replaceChildren(fxNode);
  host._fxNode = fxNode;
  wireFxPanel(globalFxTarget(fxNode), fxNode);
  host._wired = true;
}

/** Re-apply the whole master fx config to its rack + sliders (session load). */
export function applyGlobalFxUI() {
  const host = document.getElementById("globalfx-fx-panel");
  if (!host?._fxNode || !state.globalFxConfig) return;
  applyFxToTrack(globalFxTarget(host._fxNode), state.globalFxConfig);
}

export function renderGlobalFxModPanel() {
  const panel = document.getElementById("globalfx-mod-panel");
  if (!panel) return;
  if (!state.globalFxModConfig) state.globalFxModConfig = defaultGlobalFxModConfig();
  renderModRack(panel, { cfg: state.globalFxModConfig, keys: globalFxModKeys(), labelOf: lfoLabel, syncFn: syncGlobalFxLFO });
}

export function renderGlobalFxAutPanel() {
  const panel = document.getElementById("globalfx-aut-panel");
  if (!panel) return;
  if (!state.globalFxAutomation) state.globalFxAutomation = {};
  renderAutRack(panel, { auto: state.globalFxAutomation, keys: globalFxAutoKeys(), labelOf: k => AUTOMATION_TARGETS[k]?.label || k, steps: GLOBAL_FX_AUTO_STEPS });
}

/** Wire the master fx panel: fx/mod/aut sub-panels + tab toggles. */
export function wireGlobalFxPanels() {
  const panel = document.getElementById("globalfx-panel");
  if (!panel) return;
  wireGlobalFxPanel();
  renderGlobalFxModPanel();
  renderGlobalFxAutPanel();
  const tab = (btnSel, panelId) => {
    const btn = panel.querySelector(btnSel);
    const p = document.getElementById(panelId);
    btn?.addEventListener("click", () => {
      const show = p.hidden;
      p.hidden = !show;
      btn.setAttribute("aria-pressed", String(show));
    });
  };
  tab(".gfx-fx-toggle", "globalfx-fx-panel");
  tab(".gfx-mod-toggle", "globalfx-mod-panel");
  tab(".gfx-aut-toggle", "globalfx-aut-panel");
}

export function renderModPanel(t, panel) {
  const tpl = document.getElementById("lfo-row-template");
  panel.replaceChildren();
  // Track-level glide — shared strip at top of mod panel. Swing is master-only now.
  const ctl = document.createElement("div");
  ctl.className = "sq-mod__ctl-row";
  ctl.innerHTML = `
    <label class="sq-mod__ctl"><span>glide</span><input class="sq-track__glide" type="range" min="0" max="0.5" step="0.005" value="${t.glide ?? 0}" /></label>
  `;
  panel.appendChild(ctl);
  ctl.querySelector(".sq-track__glide").addEventListener("input", e => {
    t.glide = Number(e.target.value);
    if (t.voice?.setGlide) t.voice.setGlide(t.glide);
  });

  // Container for the per-param LFO rows (added one at a time via the picker below).
  const rowsContainer = document.createElement("div");
  rowsContainer.className = "sq-mod__rows";
  panel.appendChild(rowsContainer);

  const addRow = (key) => {
    const cfg = t.lfoConfig[key];
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.dataset.key = key;
    row.classList.add("is-active");
    row.querySelector(".sq-lfo__target").textContent = lfoLabel(key);

    const cb    = row.querySelector(".lfo-on");
    const shape = row.querySelector(".sq-lfo__shape");
    const rate  = row.querySelector(".sq-lfo__rate");
    const rateLbl  = row.querySelector(".sq-lfo__rate-label");
    const depth = row.querySelector(".lfo-depth");
    const depthLbl = row.querySelector(".sq-lfo__depth-label");
    const syncCb = row.querySelector(".lfo-sync");
    const divSel = row.querySelector(".sq-lfo__div");
    const rateField = row.querySelector(".sq-lfo__rate-field");
    const removeBtn = row.querySelector(".sq-lfo__remove");

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

    cb.addEventListener("change", () => { cfg.enabled = cb.checked; row.classList.toggle("is-active", cfg.enabled); syncLFO(t, key); });
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
  adder.className = "sq-mod__add-row";
  adder.innerHTML = `
    <button class="sq-mod__add-btn sq-btn--ghost" type="button">+ add modulation</button>
    <select class="sq-mod__add-select" hidden></select>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-mod__add-btn");
  const addSel = adder.querySelector(".sq-mod__add-select");
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
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + available.map(k => `<option value="${k}">${lfoLabel(k)}</option>`).join("");
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
export function renderAutomationPanel(t, panel) {
  panel.replaceChildren();
  if (!t.automation) t.automation = {};
  const enabledKeys = Object.keys(t.automation).filter(k => AUTOMATION_TARGETS[k]);

  const rows = document.createElement("div");
  rows.className = "aut-rows";
  panel.appendChild(rows);

  const emptyMsg = document.createElement("div");
  emptyMsg.className = "sq-aut__empty";
  emptyMsg.textContent = "no automation — pick a target below to add a lane";
  panel.appendChild(emptyMsg);

  const adder = document.createElement("div");
  adder.className = "sq-aut__add-row";
  adder.innerHTML = `
    <button class="sq-aut__add-btn sq-btn--ghost" type="button">+ add automation</button>
    <select class="sq-aut__add-select" hidden></select>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-aut__add-btn");
  const addSel = adder.querySelector(".sq-aut__add-select");

  const refreshAdder = () => {
    const avail = AUTOMATION_KEYS.filter(k => !t.automation[k] && canAutomate(t, k));
    if (avail.length === 0) {
      addBtn.disabled = true;
      addSel.hidden = true;
      addBtn.textContent = "(all targets automated)";
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "+ add automation";
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + avail.map(k => `<option value="${k}">${AUTOMATION_TARGETS[k].label}</option>`).join("");
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
    row.className = "sq-aut__lane" + (lane.enabled ? " active" : "");
    row.dataset.key = key;
    row.innerHTML = `
      <span class="sq-aut__label">${AUTOMATION_TARGETS[key].label}</span>
      <input type="checkbox" class="sq-aut__enable" ${lane.enabled ? "checked" : ""} title="enable lane" />
      <div class="sq-aut__grid"></div>
      <button class="sq-aut__clear sq-btn--ghost" type="button" title="reset to 0.5">clear</button>
      <button class="sq-aut__remove" type="button" title="remove lane">×</button>
    `;
    rows.appendChild(row);

    const grid = row.querySelector(".sq-aut__grid");
    for (let i = 0; i < t.length; i++) {
      const cell = document.createElement("div");
      cell.className = "sq-aut__step";
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

    row.querySelector(".sq-aut__enable").addEventListener("change", (ev) => {
      lane.enabled = !!ev.target.checked;
      row.classList.toggle("is-active", lane.enabled);
    });
    row.querySelector(".sq-aut__clear").addEventListener("click", () => {
      for (let i = 0; i < lane.values.length; i++) lane.values[i] = 0.5;
      for (let i = 0; i < grid.children.length; i++) grid.children[i].style.setProperty("--v", "0.5");
    });
    row.querySelector(".sq-aut__remove").addEventListener("click", () => {
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

