import { stepsPerBeatForMeter, transportMeter } from "./meter.js";
import { loopRange, state } from "./state.js";

export let _metroOsc = null;
export let _metroGain = null;
export function fireMetronome(time, accent) {
  if (!state.audioCtx) return;
  const ctx = state.audioCtx;
  if (!_metroGain) {
    _metroGain = ctx.createGain();
    _metroGain.gain.value = 0;
    _metroGain.connect(ctx.destination);
  }
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(accent ? 1760 : 1320, time);
  const g = ctx.createGain();
  // Full fill is full scale. The click goes straight to the output, past the
  // master limiter, and has to cut through a mix sitting at -2dB: the old fixed
  // blip (0.28 peak, 60ms) was easily buried under a full session. Squared so
  // the bottom of the fill is still a fine adjustment.
  const level = Math.max(0, Math.min(1, state.metronomeLevel ?? 0.7));
  const peak = (accent ? 1 : 0.6) * level * level;
  if (peak <= 0) return;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
  osc.connect(g).connect(_metroGain);
  _metroGain.gain.setValueAtTime(1, time);
  osc.start(time);
  osc.stop(time + 0.1);
}

// The beat indicator: a pill in the style of the pattern bar's repeat meter
// (`3 of 8` over a fill). The label is `beat.step`, with the repeat count
// after it while playing, over a fill of how far through the pattern the
// playhead is (the reference track's length, so non-4/4 and polymeter still
// read correctly). It was a ring of dots; the number is what was being read.
export function currentIndicatorSteps() {
  const n = state.tracks[0]?.length;
  return Math.max(2, Math.min(64, Number.isFinite(n) ? n : 16));
}
export function currentIndicatorMeter() {
  return transportMeter();
}
export function buildBeatIndicator() {
  const el = document.getElementById("beat-indicator");
  if (!el) return;
  const steps = currentIndicatorSteps();
  const meter = currentIndicatorMeter();
  const spb = stepsPerBeatForMeter(meter);
  const sig = `${steps}@${meter.num}/${meter.den}`;
  if (el.dataset.sig === sig) return;
  if (!el.querySelector(".sq-beat__label")) {
    // <i> the fill, <b> what is read over it: the beat, then the repeat count.
    el.innerHTML = '<i class="sq-beat__fill"></i><b><span class="sq-beat__label">1.1</span><span class="sq-beat__rep"></span></b>';
  }
  el.dataset.sig = sig;
  el.dataset.steps = String(steps);
  el.dataset.spb = String(spb);
}

/**
 * Which repeat the pattern is on, for the dial: read when a step is
 * SCHEDULED (the transport snapshots it with the tick), so the count turns
 * over with the bar being heard, not a lookahead before it.
 *
 *   chain mode, or a loop of patterns   `2/4`  the bar of the pattern's repeat count
 *   repeat mode                         `×3`   how many times the bar has come round
 *   arrange mode                        `12`   the ruler's bar
 *
 * Empty while stopped.
 * @param {number} barLen the bar's length in sixteenths
 */
export function repeatReadout(barLen) {
  if (!state.playing) return "";
  if (state.patternMode === "arrange") return String((state.arrBar ?? 0) + 1);
  if (state.patternMode === "chain" || loopRange()) {
    const need = Math.max(1, state.patternRepeats[state.activePattern] ?? 1);
    return `${Math.min(need, (state.chainBarCount ?? 0) + 1)}/${need}`;
  }
  const bars = Math.floor(Math.max(0, state.tick - (state._countOrigin ?? 0)) / Math.max(1, barLen));
  return `×${bars + 1}`;
}

/**
 * @param {number} tick
 * @param {string} [rep] the repeat readout for that tick (the transport's
 *   snapshot); left out, the pill clears it when stopped and keeps it otherwise
 */
export function paintBeatIndicator(tick, rep) {
  const el = document.getElementById("beat-indicator");
  if (!el) return;
  const wantSig = `${currentIndicatorSteps()}@${currentIndicatorMeter().num}/${currentIndicatorMeter().den}`;
  if (el.dataset.sig !== wantSig) buildBeatIndicator();
  const steps = Number(el.dataset.steps || 16);
  const spb = Number(el.dataset.spb || 4);
  const raw = tick == null ? 0 : tick - 1;
  const idx = ((raw % steps) + steps) % steps;
  const beat = Math.floor(idx / spb) + 1;     // 1..num
  const sub  = (idx % spb) + 1;               // 1..stepsPerBeat
  const text = `${beat}.${sub}`;
  const lbl = el.querySelector(".sq-beat__label");
  if (lbl && lbl.textContent !== text) lbl.textContent = text;
  // Empty while stopped: a fill is a playhead, and nothing is playing.
  const fill = el.querySelector(".sq-beat__fill");
  const w = state.playing && tick != null ? `${Math.round(((idx + 1) / steps) * 100)}%` : "0%";
  if (fill && fill.style.width !== w) fill.style.width = w;
  // The first step of a beat is lit, the bar's first more so.
  el.classList.toggle("is-beat", !!state.playing && tick != null && sub === 1);
  el.classList.toggle("is-bar", !!state.playing && tick != null && idx % (spb * currentIndicatorMeter().num) === 0);
  const repEl = el.querySelector(".sq-beat__rep");
  if (repEl) {
    const r = !state.playing ? "" : rep ?? repEl.textContent;
    if (repEl.textContent !== r) repEl.textContent = r;
    el.classList.toggle("has-rep", !!r);
  }
}
