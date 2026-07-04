// Morphagene modulation: an LFO rack and step-automation lanes targeting the
// master granular processor. Self-contained (does not touch the per-track LFO
// plumbing) — the Morphagene's worklet params are real AudioParams, so LFOs
// connect straight to them and step automation schedules ramps on them.

import { effectiveRate } from "./lfo.js";
import { state } from "./state.js";

// ---- shared param maps -------------------------------------------------

/** UI key -> worklet AudioParam name. */
const PARAM = { speed: "variSpeed", organize: "organize", gene: "geneSize", slide: "slide", morph: "morph", sos: "sos" };

// ---- LFO rack ----------------------------------------------------------

export const MG_MOD_KEYS = ["speed", "organize", "gene", "slide", "morph", "sos"];
export const MG_MOD_LABEL = { speed: "speed", organize: "organize", gene: "gene", slide: "slide", morph: "morph", sos: "sos" };
// LFO amplitude per target: the 0..1 params swing ±0.5 at full depth; speed
// (−2..2) swings wider.
const MG_LFO_AMP = { speed: 2, organize: 1, gene: 1, slide: 1, morph: 1, sos: 1 };

export function defaultMorphageneModConfig() {
  const cfg = {};
  for (const k of MG_MOD_KEYS) cfg[k] = { enabled: false, type: "sine", rate: 1, depth: 0.5, sync: true, div: 1 };
  return cfg;
}

/** @type {Record<string, any>} */
const _lfos = {};

/** Build / update / tear down the LFO for one target key. */
export function syncMorphageneLFO(key) {
  const cfg = state.morphageneModConfig?.[key];
  const mg = state.morphagene;
  let lfo = _lfos[key];
  if (!cfg || !cfg.enabled || !mg || !state.ready) {
    if (lfo) { try { lfo.stop(); } catch {} try { lfo.disconnect(); } catch {} try { lfo.dispose(); } catch {} _lfos[key] = null; }
    return;
  }
  const param = mg.node.parameters.get(PARAM[key]);
  if (!param) return;
  const amp = (cfg.depth / 2) * (MG_LFO_AMP[key] ?? 1);
  const hz = effectiveRate(cfg);
  if (!lfo) {
    lfo = new Tone.LFO({ frequency: hz, min: -amp, max: amp, type: cfg.type });
    lfo.start();
    lfo.connect(param);
    _lfos[key] = lfo;
  } else {
    lfo.frequency.value = hz;
    lfo.min = -amp;
    lfo.max = amp;
    lfo.type = cfg.type;
  }
}

export function syncAllMorphageneLFOs() { for (const k of MG_MOD_KEYS) syncMorphageneLFO(k); }

export function disposeMorphageneLFOs() {
  for (const k of MG_MOD_KEYS) {
    const lfo = _lfos[k];
    if (lfo) { try { lfo.stop(); } catch {} try { lfo.disconnect(); } catch {} try { lfo.dispose(); } catch {} }
    _lfos[k] = null;
  }
}

// ---- step automation lanes --------------------------------------------

export const MG_AUTO_KEYS = ["speed", "organize", "gene", "slide", "morph", "sos", "mix"];
export const MG_AUTO_LABEL = { speed: "speed", organize: "organize", gene: "gene", slide: "slide", morph: "morph", sos: "sos", mix: "mix" };
export const MG_AUTO_STEPS = 16;   // one bar of 16th notes; loops globally
const AUTO_PARAM = { ...PARAM, mix: "mix" };

/** Map a 0..1 lane value to the param's physical range. */
function autoPhys(key, v) {
  const x = Math.max(0, Math.min(1, v));
  if (key === "speed") return -2 + x * 4;   // 0 -> -2, 0.5 -> stop, 1 -> +2
  return x;                                   // organize/gene/slide/morph/sos/mix are 0..1
}

/** Apply every enabled lane for the global step `tick` at audio `time`. */
export function applyMorphageneAutomation(tick, time, stepDur) {
  const auto = state.morphageneAutomation;
  const mg = state.morphagene;
  if (!auto || !mg) return;
  for (const key in auto) {
    const lane = auto[key];
    if (!lane || !lane.enabled || !lane.values || !lane.values.length) continue;
    const len = lane.values.length;
    const v = lane.values[tick % len];
    if (v == null) continue;
    mg.automate(AUTO_PARAM[key] || key, autoPhys(key, v), time, stepDur);
  }
}
