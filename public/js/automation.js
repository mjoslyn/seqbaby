import { engineByKey } from "./catalog.js";
import { makeFuzzCurve, shaperPreampGain } from "./curves.js";
import { BASS_MOD_KEYS, BASS_MOD_LABELS, bassFromUnit } from "./bass.js";
import { HEXOP_MOD_KEYS, HEXOP_MOD_LABELS, hexopFromUnit } from "./hexop.js";
import { GUITAR_MOD_KEYS, GUITAR_MOD_LABELS, guitarFromUnit } from "./guitar.js";
import { EUCLID_MOD_KEYS, EUCLID_MOD_LABELS, euclidFromUnit, setEuclidLive } from "./euclid.js";
import { canModulate } from "./lfo.js";
import { setParam } from "./params.js";
import { cutoffToHz, resonToQ } from "./signal.js";
import { granFromUnit } from "./voices.js";


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
  // euclid's three counts (only while live euclid is generating — see canAutomate)
  ...Object.fromEntries(EUCLID_MOD_KEYS.map(k => [`euclid.${k}`, { label: EUCLID_MOD_LABELS[k] }])),
  // granular grain controls (granular engine only)
  "gran.speed":         { label: "grain speed" },
  "gran.pitch":         { label: "grain pitch" },
  "gran.window":        { label: "grain window" },
  "gran.jitter":        { label: "grain jitter" },
  "gran.detune":        { label: "grain detune" },
  "gran.pan":           { label: "grain pan" },
  // Silverbox panel controls outside the four sliders (silverbox engine only)
  "silverbox.accent":   { label: "silverbox accent" },
  "silverbox.tune":     { label: "silverbox tune" },
  "silverbox.wave":     { label: "silverbox wave" },
  // Contagion panel controls (contagion engine only)
  "contagion.pw":       { label: "contagion pulse width" },
  "contagion.fm":       { label: "contagion fm" },
  "contagion.ring":     { label: "contagion ring mod" },
  "contagion.unidet":   { label: "contagion unison detune" },
  "contagion.cut2":     { label: "contagion cutoff 2" },
  "contagion.bal":      { label: "contagion filter balance" },
  "contagion.sat":      { label: "contagion saturation" },
  "contagion.envamt":   { label: "contagion env amount" },
  "contagion.osc2semi": { label: "contagion osc2 semi" },
  "contagion.osc2det":  { label: "contagion osc2 detune" },
  "contagion.unispread": { label: "contagion unison spread" },
  "contagion.atk":      { label: "contagion attack" },
  "contagion.sus":      { label: "contagion sustain" },
  "contagion.rel":      { label: "contagion release" },
  // Hexop panel controls (hexop engine only) — globals, then all six operators.
  // Generated from the same list the LFO keys come from (hexop.js).
  ...Object.fromEntries(HEXOP_MOD_KEYS.map(k => [`hexop.${k}`, { label: HEXOP_MOD_LABELS[k] }])),
  // Electric guitar rig (guitar engine only) — string, pickup, amp, cab.
  ...Object.fromEntries(GUITAR_MOD_KEYS.map(k => [`gtr.${k}`, { label: GUITAR_MOD_LABELS[k] }])),
  // Electric bass rig (bass engine only).
  ...Object.fromEntries(BASS_MOD_KEYS.map(k => [`bas.${k}`, { label: BASS_MOD_LABELS[k] }])),
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
// the voice doesn't expose an AudioParam (guitar/bass/tines timbre sliders).
export function voiceAutoKeysForEngine(t) {
  const eng = engineByKey(t.engineKey);
  if (!eng) return ["vol"];
  if (eng.type === "plaits") return ["vol", "harm", "timb", "morph", "decay"];
  switch (t.engineKey) {
    case "dm:silverbox":        return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:snarl": return ["vol", "harm", "timb", "osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal"];
    case "dm:ladder":       return ["vol", "harm", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:drift":       return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "noise"];
    case "dm:guitar":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:bass":       return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:tines":     return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:oracle":   return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"];
    case "dm:granular":   return ["vol", "harm", "timb", "morph", "decay"];
    case "dm:contagion":      return ["vol", "harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"];
    case "dm:hexop":        return ["vol", "harm", "timb", "morph", "decay"];
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
  if (key.startsWith("euclid.")) return !!t.euclid?.on;
  if (key.startsWith("gran.")) return t.engineKey === "dm:granular";
  if (key.startsWith("silverbox.")) return t.engineKey === "dm:silverbox";
  if (key.startsWith("contagion.")) return t.engineKey === "dm:contagion";
  if (key.startsWith("hexop.")) return t.engineKey === "dm:hexop";
  if (key.startsWith("gtr.")) return t.engineKey === "dm:guitar";
  if (key.startsWith("bas.")) return t.engineKey === "dm:bass";
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
    const which = key.slice(6);
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
    const which = key.slice(4);
    ramp(t.voice?.getAudioParam?.("d" + which), hexopFromUnit(which, vv), hexopFromUnit(which, vn));
    return;
  }
  // The guitar rig, same again: every knob on it is an AudioParam, and each
  // lane spans that knob's own range — a pick-position lane sweeps 0.02..0.5
  // (bridge to twelfth fret), not 0..1.
  if (key.startsWith("gtr.")) {
    const which = key.slice(4);
    ramp(t.voice?.getAudioParam?.("gt" + which), guitarFromUnit(which, vv), guitarFromUnit(which, vn));
    return;
  }
  if (key.startsWith("bas.")) {
    const which = key.slice(4);
    ramp(t.voice?.getAudioParam?.("bs" + which), bassFromUnit(which, vv), bassFromUnit(which, vn));
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
    // Remember the segment this step just scheduled, so the knob behind the
    // lane can show where it is being moved to (modMotion.js). Recorded here
    // rather than inside applyAutomationAtStep because a macro pad calls that
    // too, and a pad moves the real knob — it has nothing to shadow.
    (t._autoLive || (t._autoLive = {}))[key] = { from: v, to: next, t0: time, t1: time + stepDur };
    applyAutomationAtStep(t, key, v, time, next, stepDur);
  }
}

// ---- track params / randomize ------------------------------------------

