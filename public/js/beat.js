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

// Circular beat indicator — N dots around a ring (N = reference track's length
// so non-4/4 / polymeter still reads correctly), every 4th is a strong-beat
// dot, with a "beat.sq-step" text readout in the center (always visible).
export function currentIndicatorSteps() {
  const n = state.tracks[0]?.length;
  return Math.max(2, Math.min(64, Number.isFinite(n) ? n : 16));
}
export function currentIndicatorMeter() {
  return transportMeter();
}
export function buildBeatIndicator() {
  const svg = document.getElementById("beat-indicator");
  if (!svg) return;
  const steps = currentIndicatorSteps();
  const meter = currentIndicatorMeter();
  const spb = stepsPerBeatForMeter(meter);
  const sig = `${steps}@${meter.num}/${meter.den}`;
  if (svg.dataset.sig === sig) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = "http://www.w3.org/2000/svg";
  const r = 16;
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(ang) * r;
    const cy = Math.sin(ang) * r;
    const strong = i % spb === 0;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", cx.toFixed(2));
    dot.setAttribute("cy", cy.toFixed(2));
    dot.setAttribute("r", strong ? "2.4" : "1.5");
    dot.classList.add("sq-beat__dot");
    if (strong) dot.classList.add("is-beat-strong");
    dot.dataset.idx = String(i);
    svg.appendChild(dot);
  }
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "0");
  label.setAttribute("y", "0");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.classList.add("sq-beat__label");
  label.textContent = "1.1";
  svg.appendChild(label);
  // Under it, which repeat the pattern is on (repeatReadout). The beat sits
  // a little higher while there is one to show (style.css, `has-rep`).
  const rep = document.createElementNS(ns, "text");
  rep.setAttribute("x", "0");
  rep.setAttribute("y", "7");
  rep.setAttribute("text-anchor", "middle");
  rep.setAttribute("dominant-baseline", "central");
  rep.classList.add("sq-beat__rep");
  svg.appendChild(rep);
  svg.dataset.sig = sig;
  svg.dataset.steps = String(steps);
  svg.dataset.spb = String(spb);
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
 *   snapshot); left out, the dial clears it when stopped and keeps it otherwise
 */
export function paintBeatIndicator(tick, rep) {
  const svg = document.getElementById("beat-indicator");
  if (!svg) return;
  const wantSig = `${currentIndicatorSteps()}@${currentIndicatorMeter().num}/${currentIndicatorMeter().den}`;
  if (svg.dataset.sig !== wantSig) buildBeatIndicator();
  const steps = Number(svg.dataset.steps || 16);
  const spb = Number(svg.dataset.spb || 4);
  const raw = tick == null ? 0 : tick - 1;
  const idx = ((raw % steps) + steps) % steps;
  const beat = Math.floor(idx / spb) + 1;     // 1..num
  const sub  = (idx % spb) + 1;               // 1..stepsPerBeat
  for (const dot of svg.querySelectorAll(".sq-beat__dot")) {
    dot.classList.toggle("is-now", Number(dot.dataset.idx) === idx);
  }
  const lbl = svg.querySelector(".sq-beat__label");
  if (lbl) lbl.textContent = `${beat}.${sub}`;
  const repEl = svg.querySelector(".sq-beat__rep");
  if (repEl) {
    const text = !state.playing ? "" : rep ?? repEl.textContent;
    if (repEl.textContent !== text) repEl.textContent = text;
    svg.classList.toggle("has-rep", !!text);
  }
}

