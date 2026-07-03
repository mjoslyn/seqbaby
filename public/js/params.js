import { engineByKey } from "./catalog.js";
import { applySampleSpeed, disposeLFOs, syncAllLFOs } from "./lfo.js";
import { redetectDrumKit } from "./meter.js";
import { refreshFxPanelUI, updateMidiUI } from "./render.js";
import { ensureFxRack, routeVoiceToRack } from "./signal.js";
import { state } from "./state.js";
import { buildVoiceForEngine } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Set a track synth param and push it to the live voice.
 * @param {Track} t @param {string} key @param {number} val
 */
export function setParam(t, key, val) {
  t.params[key] = val;
  t.voice?.setParam(key, val);
}

export function updatePlaitsControlsVisibility(t) {
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
  const group = t._timbreGroupEl || t.el.querySelector(".timbre-group");
  if (group) {
    group.hidden = !showTimbre;
    group.style.removeProperty("display");
  }
  const modPanel = t._modPanelEl || t.el.querySelector(".track-mod-panel");
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
  const oscGroup = t._oscMixGroupEl || t.el.querySelector(".osc-mix-group");
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
  const modGroup = t._oscModGroupEl || t.el.querySelector(".osc-mod-group");
  if (modGroup) modGroup.hidden = !isMiniBrute;
  // Moog osc-bank group (per-osc range + waveform + osc2/3 freq + noise).
  const moogGroup = t._moogOscGroupEl || t.el.querySelector(".moog-osc-group");
  if (moogGroup) moogGroup.hidden = !isMoog;
}

// Force all fx wet levels to 0 (100% dry) — used when switching a track to the
// eleven-labs engine so user-applied fx don't stack on baked-in sample ambience.
export function resetFxDry(t) {
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

/**
 * Switch a track's engine, rebuilding the voice in place when possible and
 * relabeling the synth controls for the new engine.
 * @param {Track} t @param {string} newKey
 */
export function setEngineKey(t, newKey) {
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

