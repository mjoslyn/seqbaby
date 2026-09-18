import { AUTOMATION_TARGETS, VOICE_AUTO_KEYS, afterPrefix as after, canAutomateKey, voiceAutoKeysForEngineKey } from "./constants.js";
import { makeFuzzCurve, shaperPreampGain } from "./curves.js";
import { bassFromUnit, guitarFromUnit, hexopFromUnit, subFromUnit } from "./engineData.js";
import { euclidFromUnit, setEuclidLive } from "./euclid.js";
import { setChanceLive } from "./chance.js";
import { chanceFromUnit } from "./chanceGen.js";
import { canModulate } from "./lfo.js";
import { setParam } from "./params.js";
import { cutoffToHz, resonToQ } from "./signal.js";
import { granFromUnit } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */

// The target table, the voice-key list and the two gates are pure and live in
// constants.js (readable from Node); re-exported here, and the two functions
// below hand the track's engine and its live generator flags to them.
export { AUTOMATION_TARGETS, AUTOMATION_KEYS, VOICE_AUTO_KEYS } from "./constants.js";

// Engine-aware list of voice/instrument keys that can be automated. Broader
// than canModulate because automation can drive params via setParam even when
// the voice doesn't expose an AudioParam (guitar/bass/tines timbre sliders).
export function voiceAutoKeysForEngine(t) {
  return voiceAutoKeysForEngineKey(t.engineKey);
}
export function canAutomate(t, key) {
  return canAutomateKey(t.engineKey, key, { euclid: !!t.euclid?.on, chance: !!t.chance?.on });
}

// Schedule a value change at `time`, linearly ramping to `vNext` over `stepDur`
// for targets backed by an AudioParam/Signal. For params that require a
// rebuild (waveshaper curve, IR, integer quantization) the change stays
// stepwise at `time`.
export function applyAutomationAtStep(t, key, v, time, vNext, stepDur) {
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
    // fallback for voices without AudioParam (guitar/bass/tines timbre, snarl metal, etc.)
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
  // Euclid: the lane drives the generator's live override, never the stored
  // knob, and the transport reads it a few lines further down the same step —
  // so a lane on `rotate` turns the ring in time rather than rewriting the
  // pattern. No ramp: these are counts.
  if (key.startsWith("euclid.")) {
    const k = key.slice(7);
    setEuclidLive(t, k, euclidFromUnit(t, k, vv));
    return;
  }
  // Chance: the same arrangement. A lane on `rest` thins the part out over the
  // bar, and one on `lo`/`hi` walks the register — without touching a knob, and
  // without writing a note anywhere. No ramp: these are the odds a throw is
  // built from, read once when it is built.
  if (key.startsWith("chance.")) {
    const k = key.slice(7);
    setChanceLive(t, k, chanceFromUnit(k, vv));
    return;
  }
  // Wave-scan window: no AudioParam behind it, so write the voice's live scan
  // object directly (the stored slider values stay untouched).
  if (key === "wt.scan.start" || key === "wt.scan.range") {
    const sc = t.voice?.scan;
    if (sc) sc[key === "wt.scan.start" ? "start" : "range"] = vv;
    return;
  }
  // Granular: same idea — the lane drives the live voice across the slider's
  // full range and the stored slider value is left alone. The step's grains are
  // scheduled right after this, so they pick the new value up. No ramp: a grain
  // cloud reads these once when it's scheduled, not per sample.
  if (key.startsWith("gran.")) {
    const p = "g" + key.slice(5);          // gran.window → gwindow
    try { t.voice?.setParam?.(p, granFromUnit(p, vv)); } catch {}
    return;
  }
  // silverbox accent / tune are real AudioParams on the worklet node, so they ramp
  // like any other. Tune's lane spans the tune slider's own range, ±50 cents.
  if (key === "silverbox.accent" || key === "silverbox.tune") {
    const tune = key === "silverbox.tune";
    const map = tune ? (u) => u - 0.5 : (u) => u;
    ramp(t.voice?.getAudioParam?.(tune ? "sbtune" : "sbaccent"), map(vv), map(vn));
    return;
  }
  // Waveform is a switch, not a value — flip at the halfway point. Written to
  // the live voice only, so the track's own select stays where the user left it.
  if (key === "silverbox.wave") {
    try { t.voice?.setParam?.("sbwave", vv >= 0.5 ? "square" : "saw"); } catch {}
    return;
  }
  // Contagion panel controls are all AudioParams on its worklet node, so they ramp
  // like any other. cut2 and envamt are bipolar; the lane spans their full range.
  if (key.startsWith("contagion.")) {
    const which = after(key, "contagion.");
    // Most are 0..1; cut2 / env amount are bipolar, and osc2 semi is in
    // semitones — each lane spans the slider's own range.
    const map = which === "osc2semi" ? (u) => u * 48 - 24
              : (which === "cut2" || which === "envamt") ? (u) => u * 2 - 1
              : (u) => u;
    // `sat` is the saturation amount, which the voice calls `vsatamt` (`vsat`
    // is the curve select beside it) — see getModTarget for the same aliasing.
    ramp(t.voice?.getAudioParam?.("v" + (which === "sat" ? "satamt" : which)), map(vv), map(vn));
    return;
  }
  // Hexop panel controls are AudioParams on its worklet node too. Each lane spans
  // the control's own range — a ratio lane sweeps 0..31, a detune lane ±7 — so
  // a step's value means the same thing here as on the slider it came from.
  if (key.startsWith("hexop.")) {
    const which = after(key, "hexop.");
    ramp(t.voice?.getAudioParam?.("d" + which), hexopFromUnit(which, vv), hexopFromUnit(which, vn));
    return;
  }
  // The guitar rig, same again: every knob on it is an AudioParam, and each
  // lane spans that knob's own range — a pick-position lane sweeps 0.02..0.5
  // (bridge to twelfth fret), not 0..1.
  if (key.startsWith("gtr.")) {
    const which = after(key, "gtr.");
    ramp(t.voice?.getAudioParam?.("gt" + which), guitarFromUnit(which, vv), guitarFromUnit(which, vn));
    return;
  }
  if (key.startsWith("bas.")) {
    const which = after(key, "bas.");
    ramp(t.voice?.getAudioParam?.("bs" + which), bassFromUnit(which, vv), bassFromUnit(which, vn));
    return;
  }
  // Subby, same again. Every one of its numeric controls is 0..1, so the
  // mapping is the identity — it goes through subFromUnit anyway so there is
  // one code path if a range is ever widened.
  if (key.startsWith("sub.")) {
    const which = after(key, "sub.");
    ramp(t.voice?.getAudioParam?.("sub" + which), subFromUnit(which, vv), subFromUnit(which, vn));
    return;
  }
  const rack = t.fxRack;
  if (!rack || !key.startsWith("fx.")) return;

  switch (key) {
    // ── top-level wet/amt targets (crossfade fx: ramp both dry+wet) ──
    case "fx.vinyl":
      // applyVinyl also moves the tone/warble with the amount; the ramps then
      // smooth the gains across the step.
      rack.applyVinyl({ amount: vv });
      ramp(rack.vinylWetBus?.gain, vv, vn);
      ramp(rack.vinylDryBus?.gain, 1 - vv, 1 - vn);
      ramp(rack.vinylNoiseGain?.gain, vv * vv * 0.12, vn * vn * 0.12);
      return;
    case "fx.cassette":
      rack.applyCassette({ amount: vv });
      ramp(rack.cassetteWetBus?.gain, vv, vn);
      ramp(rack.cassetteDryBus?.gain, 1 - vv, 1 - vn);
      ramp(rack.cassetteHissGain?.gain, vv * vv * 0.09, vn * vn * 0.09);
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
    case "fx.crush":
      rack.config.crush.wet = vv;
      ramp(rack.crushWetBus?.gain, vv, vn);
      ramp(rack.crushDryBus?.gain, 1 - vv, 1 - vn);
      return;
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
    case "fx.crush.rate":
      rack.config.crush.rate = vv;
      ramp(rack.crushRateParam, vv, vn);
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
/**
 * Apply every enabled automation lane for one step at hit time.
 * @param {Track} t @param {number} stepIdx @param {number} time @param {number} stepDur
 */
export function runAutomationForStep(t, stepIdx, time, stepDur) {
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
    // Remember the segment this step just scheduled, so the knob behind the
    // lane can show where it is being moved to (modMotion.js). Recorded here
    // rather than inside applyAutomationAtStep because a macro pad calls that
    // too, and a pad moves the real knob — it has nothing to shadow.
    (t._autoLive || (t._autoLive = {}))[key] = { from: v, to: next, t0: time, t1: time + stepDur };
    applyAutomationAtStep(t, key, v, time, next, stepDur);
  }
}

// ---- track params / randomize ------------------------------------------

