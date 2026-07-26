import { engineByKey } from "./catalog.js";
import { makeFuzzCurve, shaperPreampGain } from "./curves.js";
import { canModulate } from "./lfo.js";
import { setParam } from "./params.js";
import { cutoffToHz, resonToQ } from "./signal.js";


/** @typedef {import("./types.js").Track} Track */
export const AUTOMATION_TARGETS = {
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
  // wavetable wave-scan window (wavetable engine only — see canAutomate)
  "wt.scan.start":      { label: "wave scan start" },
  "wt.scan.range":      { label: "wave scan range" },
  // fx
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
export const AUTOMATION_KEYS = Object.keys(AUTOMATION_TARGETS);
export const VOICE_AUTO_KEYS = ["vol","harm","timb","morph","decay","osc1","osc2","osc3","osc4","ultra","fm","metal","noise"];

// Engine-aware list of voice/instrument keys that can be automated. Broader
// than canModulate because automation can drive params via setParam even when
// the voice doesn't expose an AudioParam (guitar/bass/rhodes timbre sliders).
export function voiceAutoKeysForEngine(t) {
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
    case "dm:granular":   return ["vol", "harm", "timb", "morph", "decay"];
    case "wt:akwf":       return ["vol", "harm", "timb", "morph", "decay"];
  }
  // 808 / 909 voices: tune / tone / colour / decay all take effect on the next
  // hit, so per-step automation drives them even with no AudioParam to ramp.
  if (t.engineKey.startsWith("dm:808-") || t.engineKey.startsWith("dm:909-")) {
    const noColour = ["dm:808-chat", "dm:808-ohat", "dm:808-cowbell", "dm:909-chat", "dm:909-ohat"];
    return noColour.includes(t.engineKey)
      ? ["vol", "harm", "timb", "decay"]
      : ["vol", "harm", "timb", "morph", "decay"];
  }
  return ["vol"];
}

export function canAutomate(t, key) {
  if (key === "cutoff" || key === "reson") return true;
  if (key.startsWith("wt.scan.")) return t.engineKey === "wt:akwf";
  if (key.startsWith("fx.")) return true;
  if (VOICE_AUTO_KEYS.includes(key)) return voiceAutoKeysForEngine(t).includes(key);
  return false;
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
  // Wave-scan window: no AudioParam behind it, so write the voice's live scan
  // object directly (the stored slider values stay untouched).
  if (key === "wt.scan.start" || key === "wt.scan.range") {
    const sc = t.voice?.scan;
    if (sc) sc[key === "wt.scan.start" ? "start" : "range"] = vv;
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
    applyAutomationAtStep(t, key, v, time, next, stepDur);
  }
}

// ---- track params / randomize ------------------------------------------

