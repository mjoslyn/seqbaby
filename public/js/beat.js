import { activeMeter, stepsPerBeatForMeter } from "./meter.js";
import { state } from "./state.js";

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
  const peak = accent ? 0.28 : 0.14;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(g).connect(_metroGain);
  _metroGain.gain.setValueAtTime(1, time);
  osc.start(time);
  osc.stop(time + 0.08);
}

// Circular beat indicator — N dots around a ring (N = reference track's length
// so non-4/4 / polymeter still reads correctly), every 4th is a strong-beat
// dot, with a "beat.sq-step" text readout in the center (always visible).
export function currentIndicatorSteps() {
  const n = state.tracks[0]?.length;
  return Math.max(2, Math.min(64, Number.isFinite(n) ? n : 16));
}
export function currentIndicatorMeter() {
  return activeMeter();
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
  svg.dataset.sig = sig;
  svg.dataset.steps = String(steps);
  svg.dataset.spb = String(spb);
}

export function paintBeatIndicator(tick) {
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
}

