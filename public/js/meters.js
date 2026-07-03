import { state } from "./state.js";

export const _meterTmp = new Uint8Array(1024);
export function samplePeak(analyser) {
  const n = Math.min(analyser.fftSize, _meterTmp.length);
  analyser.getByteTimeDomainData(_meterTmp);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(_meterTmp[i] - 128);
    if (v > peak) peak = v;
  }
  return peak / 128;                 // 0..1
}
export function paintMeter(el, level) {
  if (!el) return;
  let bar = el._bar;
  if (!bar || !bar.isConnected) { bar = el._bar = el.querySelector(".sq-meter__bar"); }
  if (!bar) return;
  const clamped = Math.max(0, Math.min(1, level));
  // Near-linear response with a mild pow so quiet signals stay visible. The bar
  // is green until the source is clipping (peak >= 0.995), then flashes red.
  const pct = Math.round(Math.pow(clamped, 0.85) * 100);
  // Skip redundant style writes — when the value is unchanged (e.g. a silent,
  // stopped track) this avoids forcing layout every frame, which matters on
  // mobile where dozens of meters would otherwise reflow continuously.
  if (bar._lastPct !== pct) { bar.style.width = pct + "%"; bar._lastPct = pct; }
  const clip = level >= 0.995;
  if (bar._lastClip !== clip) { bar.classList.toggle("is-clip", clip); bar._lastClip = clip; }
}
// Meter repaints are throttled to ~30 Hz. rAF fires at the display refresh rate
// (up to 120 Hz on recent phones); sampling every analyser and touching the DOM
// that often is pure main-thread load that competes with Tone's scheduler and
// helps push playback off the grid. 30 Hz is plenty for a level meter.
export const METER_INTERVAL_MS = 1000 / 30;
export let _meterLastPaint = -Infinity;
export let _masterMeterEl = null;
export function meterTick(ts) {
  requestAnimationFrame(meterTick);
  const now = ts ?? performance.now();
  if (now - _meterLastPaint < METER_INTERVAL_MS) return;
  _meterLastPaint = now;
  if (state.masterAnalyser) {
    if (!_masterMeterEl || !_masterMeterEl.isConnected) _masterMeterEl = document.querySelector(".sq-meter--master");
    paintMeter(_masterMeterEl, samplePeak(state.masterAnalyser));
  }
  for (const t of state.tracks) {
    if (!t.meterAnalyser || !t.el) continue;
    let mEl = t._meterEl;
    if (!mEl || !mEl.isConnected) { mEl = t._meterEl = t.el.querySelector(".sq-track__meter"); }
    paintMeter(mEl, samplePeak(t.meterAnalyser));
  }
}

