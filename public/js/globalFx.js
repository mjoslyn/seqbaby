// Master (global) FX rack: a full FXRack on the master bus, with its own LFO
// modulation and step automation. The track FX infrastructure resolves every
// fx target purely from `fxRack` (getModTarget / applyAutomationAtStep), so a
// lightweight proxy `{ fxRack }` lets us reuse all of it — no re-derivation of
// the per-effect param mappings.

import { AUTOMATION_KEYS, runAutomationForStep } from "./automation.js";
import { LFO_AMP_SCALE } from "./constants.js";
import { defaultFxConfig } from "./fxRack.js";
import { SETTER_LFO_KEYS, TRACK_FX_LFO_KEYS, applySetterLfoValue, effectiveRate, evalLfoShape, getModTarget, setterLfoBase } from "./lfo.js";
import { state } from "./state.js";

// Derived lazily (inside functions) to avoid a circular-import TDZ: this module
// and lfo.js/automation.js form an import cycle, so TRACK_FX_LFO_KEYS /
// AUTOMATION_KEYS may not be initialized yet at this module's top-level eval.
export function globalFxModKeys() { return [...TRACK_FX_LFO_KEYS]; }
export function globalFxAutoKeys() { return AUTOMATION_KEYS.filter(k => k.startsWith("fx.")); }
export const GLOBAL_FX_AUTO_STEPS = 16;

export function defaultGlobalFxConfig() { return defaultFxConfig(); }

export function defaultGlobalFxModConfig() {
  const cfg = {};
  for (const k of globalFxModKeys()) cfg[k] = { enabled: false, type: "sine", rate: 1, depth: 0.5, sync: true, div: 1 };
  return cfg;
}

// Track-like proxy so lfo.js / automation.js helpers can operate on the master rack.
function fxProxy() { return { fxRack: state.globalFx, voice: null, filterNode: null }; }

// ---- LFO modulation rack ----------------------------------------------

/** @type {Record<string, any>} */
const _lfos = {};
const _setterPhase = {};
let _rafId = null;

export function syncGlobalFxLFO(key) {
  const cfg = state.globalFxModConfig?.[key];

  // Setter-driven params (no AudioParam handle) are polled in a RAF loop.
  if (SETTER_LFO_KEYS.has(key)) {
    if (!cfg?.enabled || !state.globalFx) { delete _setterPhase[key]; return; }
    if (_setterPhase[key] == null) _setterPhase[key] = 0;
    startGlobalFxSetterLoop();
    return;
  }

  let lfo = _lfos[key];
  if (!cfg || !cfg.enabled || !state.globalFx || !state.ready) {
    if (lfo) { try { lfo.stop(); } catch {} try { lfo.disconnect(); } catch {} try { lfo.dispose(); } catch {} _lfos[key] = null; }
    return;
  }
  const param = getModTarget(fxProxy(), key);
  if (!param) return;
  const amp = (cfg.depth / 2) * (LFO_AMP_SCALE[key] ?? 1);
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

export function syncAllGlobalFxLFOs() { for (const k of globalFxModKeys()) syncGlobalFxLFO(k); }

export function disposeGlobalFxLFOs() {
  for (const k in _lfos) {
    const lfo = _lfos[k];
    if (lfo) { try { lfo.stop(); } catch {} try { lfo.disconnect(); } catch {} try { lfo.dispose(); } catch {} }
    _lfos[k] = null;
  }
  for (const k in _setterPhase) delete _setterPhase[k];
}

function startGlobalFxSetterLoop() {
  if (_rafId != null) return;
  let last = state.audioCtx?.currentTime ?? 0;
  const tick = () => {
    const now = state.audioCtx?.currentTime ?? 0;
    const dt = Math.max(0, Math.min(0.1, now - last));
    last = now;
    let any = false;
    if (state.globalFx) {
      const proxy = fxProxy();
      for (const key of SETTER_LFO_KEYS) {
        const cfg = state.globalFxModConfig?.[key];
        if (!cfg?.enabled) continue;
        any = true;
        const hz = effectiveRate(cfg);
        const phase = (_setterPhase[key] ?? 0) + dt * hz;
        _setterPhase[key] = phase;
        const shape = evalLfoShape(cfg.type || "sine", phase);
        const base = setterLfoBase(proxy, key);
        applySetterLfoValue(proxy, key, base + shape * (cfg.depth ?? 0) * 0.5);
      }
    }
    _rafId = any ? requestAnimationFrame(tick) : null;
  };
  _rafId = requestAnimationFrame(tick);
}

// ---- step automation ---------------------------------------------------

/** Apply the master fx automation lanes for the global step `tick`. Reuses the
 *  track automation applier via the fxRack proxy (fx.* keys only touch fxRack). */
export function applyGlobalFxAutomation(tick, time, stepDur) {
  if (!state.globalFx || !state.globalFxAutomation) return;
  runAutomationForStep({ fxRack: state.globalFx, automation: state.globalFxAutomation }, tick, time, stepDur);
}
