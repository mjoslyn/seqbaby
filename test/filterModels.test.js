import assert from "node:assert/strict";
import test from "node:test";

import { filterModelsProcessorSource } from "../public/js/filterModels.js";
import { ANALOG_FILTER_TYPES } from "../public/js/soundDefaults.js";

// The eight analog filter characters, rendered outside a browser — same
// reason reverb.js is testable this way: the processor is a source string,
// evaluated here against the two globals a worklet scope provides.
//
// What this pins: that the eight names actually reach eight different
// behaviors (not an ordering mixup between ANALOG_FILTER_TYPES and the
// processor's own MODELS table), that the ladder family loses passband
// under resonance the way a real feedback ladder does and the SVF family
// does not, that a ladder self-oscillates from silence at high resonance,
// and that nothing goes non-finite across the model x resonance range.

const SR = 48000;
const Q = 128;

function makeProcessor() {
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  const Cls = new Function(`${prelude}${filterModelsProcessorSource()}\n return globalThis.__P;`)();
  return new Cls();
}

function setModel(inst, name) {
  const idx = ANALOG_FILTER_TYPES.indexOf(name);
  assert.ok(idx >= 0, `unknown model ${name}`);
  inst.port.onmessage({ data: { type: "model", model: idx } });
}

/** Render `n` mono samples, `feed(i)` giving the input sample at frame i. */
function render(inst, n, feed, freqHz, Qval) {
  const out = new Float32Array(n);
  const outs = [[new Float32Array(Q)]];
  const ins = [[new Float32Array(Q)]];
  const params = { frequency: Float32Array.of(freqHz), resonance: Float32Array.of(Qval) };
  for (let b = 0; b * Q < n; b++) {
    for (let i = 0; i < Q; i++) ins[0][0][i] = feed(b * Q + i);
    outs[0][0].fill(0);
    globalThis.currentFrame = b * Q;
    inst.process(ins, outs, params);
    const off = b * Q;
    const take = Math.min(Q, n - off);
    out.set(outs[0][0].subarray(0, take), off);
  }
  return out;
}

const rms = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length - from));
};
const allFinite = (a) => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };

/** Steady-state RMS response to a sine at `toneHz`, filter cutoff at
 *  `cutoffHz`. Settles for 30ms, measures the next 40ms. */
function toneResponse(model, toneHz, cutoffHz, Qval) {
  const inst = makeProcessor();
  setModel(inst, model);
  const settle = Math.round(0.03 * SR);
  const measure = Math.round(0.04 * SR);
  const n = settle + measure;
  const sig = render(inst, n, (i) => Math.sin(2 * Math.PI * toneHz * i / SR) * 0.3, cutoffHz, Qval);
  return rms(sig, settle);
}

test("all 8 names reach 8 different sounds", () => {
  // A copy-paste ordering mixup between ANALOG_FILTER_TYPES and the
  // processor's own MODELS table would have two names sound identical, or
  // one name silently play another's model.
  const seen = [];
  for (const name of ANALOG_FILTER_TYPES) {
    const inst = makeProcessor();
    setModel(inst, name);
    const sig = render(inst, Math.round(0.08 * SR), (i) => Math.sin(2 * Math.PI * 800 * i / SR) * 0.3, 1200, 8);
    assert.ok(allFinite(sig), `${name}: non-finite output`);
    seen.push({ name, r: rms(sig, sig.length - Math.round(0.03 * SR)) });
  }
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const diff = Math.abs(seen[i].r - seen[j].r) / Math.max(1e-9, seen[i].r);
      assert.ok(diff > 0.005, `${seen[i].name} and ${seen[j].name} measured the same (${seen[i].r} vs ${seen[j].r})`);
    }
  }
});

test("every model is a lowpass: a tone below cutoff passes more than one well above it", () => {
  for (const name of ANALOG_FILTER_TYPES) {
    const low = toneResponse(name, 200, 2000, 4);
    const high = toneResponse(name, 8000, 2000, 4);
    assert.ok(low > high * 1.5, `${name}: 200Hz (${low.toFixed(4)}) should clear 8kHz (${high.toFixed(4)}) through a 2kHz lowpass`);
  }
});

test("resonance raises the response near cutoff", () => {
  for (const name of ANALOG_FILTER_TYPES) {
    const lowQ = toneResponse(name, 1000, 1000, 1);
    const hiQ = toneResponse(name, 1000, 1000, 15);
    assert.ok(hiQ > lowQ * 1.1, `${name}: resonant peak at cutoff didn't rise (Q1 ${lowQ.toFixed(4)}, Q15 ${hiQ.toFixed(4)})`);
  }
});

test("the ladder family loses bass as resonance climbs; the SVF family doesn't", () => {
  // The whole reason these are two DSP families rather than one: a feedback
  // ladder's saturator costs passband level as resonance rises (silverbox's
  // own documented behavior); a state-variable filter's doesn't.
  const LADDER = ["fat", "crisp", "squelch", "edge", "poly"];
  const SVF = ["velvet", "scream", "growl"];
  const subHz = 150, cutoffHz = 2000;
  for (const name of LADDER) {
    const lowQ = toneResponse(name, subHz, cutoffHz, 1);
    const hiQ = toneResponse(name, subHz, cutoffHz, 15);
    assert.ok(hiQ < lowQ * 0.9, `${name} (ladder): bass at ${subHz}Hz should thin under resonance (Q1 ${lowQ.toFixed(4)}, Q15 ${hiQ.toFixed(4)})`);
  }
  for (const name of SVF) {
    const lowQ = toneResponse(name, subHz, cutoffHz, 1);
    const hiQ = toneResponse(name, subHz, cutoffHz, 15);
    const ratio = hiQ / Math.max(1e-9, lowQ);
    assert.ok(ratio > 0.85, `${name} (svf): bass at ${subHz}Hz shouldn't thin under resonance the way a ladder's does (ratio ${ratio.toFixed(3)})`);
  }
});

test("a ladder self-oscillates from silence at high resonance", () => {
  // The signature of a real feedback ladder: past a resonance threshold it
  // rings on its own with nothing feeding it. squelch is silverbox's own
  // filter, so this also pins that the reused k/diode-clip math still self-
  // oscillates the way silverbox's does.
  for (const name of ["fat", "squelch"]) {
    const inst = makeProcessor();
    setModel(inst, name);
    const n = Math.round(0.25 * SR);
    // A single-sample kick to break the all-zero fixed point, then silence.
    const sig = render(inst, n, (i) => (i === 0 ? 0.5 : 0), 1000, 20);
    const tail = rms(sig, n - Math.round(0.05 * SR));
    assert.ok(tail > 0.01, `${name}: expected sustained self-oscillation from a single kick, measured ${tail.toFixed(5)} RMS in the tail`);
  }
});

test("stereo channels don't cross-talk", () => {
  const inst = makeProcessor();
  setModel(inst, "fat");
  const n = Math.round(0.05 * SR);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const params = { frequency: Float32Array.of(2000), resonance: Float32Array.of(6) };
  for (let b = 0; b * Q < n; b++) {
    for (let i = 0; i < Q; i++) {
      ins[0][0][i] = Math.sin(2 * Math.PI * 300 * (b * Q + i) / SR) * 0.3;
      ins[0][1][i] = 0;   // silent right channel
    }
    outs[0][0].fill(0); outs[0][1].fill(0);
    globalThis.currentFrame = b * Q;
    inst.process(ins, outs, params);
    const off = b * Q, take = Math.min(Q, n - off);
    outL.set(outs[0][0].subarray(0, take), off);
    outR.set(outs[0][1].subarray(0, take), off);
  }
  assert.ok(rms(outL, n - Q) > 0.02, "left (driven) channel should have signal");
  assert.ok(rms(outR, n - Q) < 1e-6, "right (silent) channel should stay silent — a shared filter state would leak the left signal in");
});

test("nothing goes non-finite across the model x resonance range", () => {
  const burst = (i) => (i < 8 ? 0.9 : (i % 37 === 0 ? -0.9 : 0));
  for (const name of ANALOG_FILTER_TYPES) {
    for (const q of [0.5, 4, 10, 20, 40]) {
      const inst = makeProcessor();
      setModel(inst, name);
      const sig = render(inst, Math.round(0.1 * SR), burst, 500, q);
      assert.ok(allFinite(sig), `${name} @ Q${q}: non-finite output`);
    }
  }
});
