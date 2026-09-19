import assert from "node:assert/strict";
import test from "node:test";

import { reverbProcessorSource } from "../public/js/reverb.js";

// The reverb tank, rendered outside a browser.
//
// Everything this file asserts is a claim the rack makes to the rest of the
// app: that the decay knob is a number of seconds and not a vague sense of
// longer, that sweeping it does not also sweep the volume, that the two
// channels are not the same tail twice, and that a lossless feedback loop with
// coefficients pushed to the end of their range does not run away. None of it
// can be heard from a unit test, and all of it can be measured.
//
// reverb.js is importable from Node (no DOM, no Tone) precisely so this works:
// the processor is a source string, evaluated here against the two globals a
// worklet scope provides.

const SR = 48000;
const Q = 128;

function makeProcessor(sr = SR) {
  const prelude = `
    globalThis.sampleRate = ${sr};
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  const Cls = new Function(`${prelude}${reverbProcessorSource()}\n return globalThis.__P;`)();
  return new Cls();
}

/** Render `secs` of output, `feed(i)` giving the input sample at frame i. */
function render(inst, secs, feed, decay, sr = SR) {
  const n = Math.round(secs * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const params = { decay: Float32Array.of(decay) };
  for (let b = 0; b * Q < n; b++) {
    for (let i = 0; i < Q; i++) { const v = feed(b * Q + i); ins[0][0][i] = v; ins[0][1][i] = v; }
    outs[0][0].fill(0); outs[0][1].fill(0);
    globalThis.currentFrame = b * Q;
    inst.process(ins, outs, params);
    const off = b * Q;
    const take = Math.min(Q, n - off);
    L.set(outs[0][0].subarray(0, take), off);
    R.set(outs[0][1].subarray(0, take), off);
  }
  return { L, R };
}

/**
 * RT60 by Schroeder backward integration, read off the -5..-35dB slope and
 * extrapolated. Taking the slope rather than simply waiting for -60dB is what
 * keeps the number honest when the very end of the tail disappears into the
 * noise of whatever else is going on.
 */
function rt60(sig, sr = SR) {
  const e = new Float64Array(sig.length);
  let acc = 0;
  for (let i = sig.length - 1; i >= 0; i--) { acc += sig[i] * sig[i]; e[i] = acc; }
  if (e[0] <= 0) return NaN;
  const at = (target) => {
    for (let i = 0; i < e.length; i++) if (10 * Math.log10(e[i] / e[0]) <= target) return i / sr;
    return NaN;
  };
  const t5 = at(-5), t35 = at(-35);
  return (t35 - t5) * 2;
}

const rms = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length - from));
};
const peak = (a, from = 0) => {
  let m = 0;
  for (let i = from; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; }
  return m;
};
const allFinite = (a) => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };

function noiseBuf(n, amp = 0.25, seed = 1) {
  const b = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; b[i] = (s / 2147483648 - 1) * amp; }
  return b;
}

test("the decay knob is a number of seconds", () => {
  // The whole reason the tank replaced a convolution reverb is that its decay
  // is a coefficient. A coefficient that does not produce the tail it names
  // would be no better than the impulse response it saved.
  for (const d of [0.35, 0.5, 1, 2, 3, 5, 8]) {
    const inst = makeProcessor();
    const { L } = render(inst, Math.max(3, d * 2.4), (i) => (i === 0 ? 1 : 0), d);
    const t = rt60(L);
    assert.ok(Number.isFinite(t), `decay ${d}: no measurable tail`);
    const err = Math.abs(t / d - 1);
    assert.ok(err < 0.06, `decay ${d}s asked, RT60 ${t.toFixed(3)}s measured (${(err * 100).toFixed(0)}% out)`);
  }
});

test("the shortest decay runs a little long, and only a little", () => {
  // Below about 0.3s the long lines are damped so hard they barely contribute
  // and the short ones carry the tail, which makes it outlast the coefficients.
  // Pinned rather than fixed: 0.2s asking for 0.25s is not a knob anyone reads
  // with a stopwatch, and the alternative is line lengths that make every
  // longer setting sound like a smaller room.
  const inst = makeProcessor();
  const { L } = render(inst, 3, (i) => (i === 0 ? 1 : 0), 0.2);
  const t = rt60(L);
  assert.ok(t > 0.2 && t < 0.32, `RT60 ${t.toFixed(3)}s for a 0.2s decay`);
});

test("sweeping the decay does not sweep the volume", () => {
  // A tank holds more energy the longer it holds it, so left alone the decay
  // knob would be a loudness knob too — and every saved song's wet setting was
  // chosen against a convolution reverb that was normalized per impulse
  // response and did not do that.
  const input = noiseBuf(SR * 5);
  const ratios = [];
  for (const d of [0.2, 0.5, 1, 2, 3, 5, 8]) {
    const inst = makeProcessor();
    const { L } = render(inst, 5, (i) => input[i] || 0, d);
    ratios.push(rms(L, SR * 2) / rms(input, SR * 2));   // steady state, tank full
  }
  const lo = Math.min(...ratios), hi = Math.max(...ratios);
  assert.ok(20 * Math.log10(hi / lo) < 1, `wet level varies by ${(20 * Math.log10(hi / lo)).toFixed(2)}dB across the decay range`);
  // ...and a fully wet output sits at about the level of what went in.
  for (const r of ratios) assert.ok(r > 0.8 && r < 1.25, `wet/dry ratio ${r.toFixed(3)}`);
});

test("the two channels are not the same tail twice", () => {
  const input = noiseBuf(SR * 4);
  const inst = makeProcessor();
  const { L, R } = render(inst, 4, (i) => input[i] || 0, 3);
  let num = 0, dl = 0, dr = 0;
  for (let i = SR; i < L.length; i++) { num += L[i] * R[i]; dl += L[i] * L[i]; dr += R[i] * R[i]; }
  const corr = num / Math.sqrt(dl * dr);
  assert.ok(Math.abs(corr) < 0.15, `L/R correlation ${corr.toFixed(3)} — the width is the whole of a reverb's stereo`);
});

test("the same room whatever the sample rate", () => {
  // The line lengths are times, not sample counts, for exactly this.
  for (const sr of [44100, 48000, 96000]) {
    const inst = makeProcessor(sr);
    const { L } = render(inst, 6, (i) => (i === 0 ? 1 : 0), 2, sr);
    const t = rt60(L, sr);
    assert.ok(Math.abs(t / 2 - 1) < 0.06, `sr ${sr}: RT60 ${t.toFixed(3)}s for a 2s decay`);
  }
});

test("a lossless loop at the end of its range does not run away", () => {
  // The mixing matrix is orthonormal, so the only thing keeping the tank from
  // ringing forever is the decay coefficients being under one. Sixty seconds of
  // loud noise at the longest decay is the case that would find it.
  const inst = makeProcessor();
  const input = noiseBuf(SR * 60, 0.5, 7);
  const { L } = render(inst, 60, (i) => input[i] || 0, 8);
  assert.ok(allFinite(L), "output went non-finite");
  assert.ok(peak(L) < 4, `peak ${peak(L).toFixed(2)} — the tank is amplifying`);
  const early = rms(L, SR * 10) , late = rms(L.subarray(SR * 50));
  assert.ok(late < early * 1.2, `late rms ${late.toFixed(4)} vs early ${early.toFixed(4)} — still growing`);
});

test("the tank empties, and stays empty", () => {
  // It has to actually reach zero: a tail that never quite stops is a track
  // that never goes quiet, and the rack leaves the stage engaged for as long as
  // the wet knob is up rather than for as long as the track is playing.
  const inst = makeProcessor();
  const { L } = render(inst, 30, (i) => (i < SR / 10 ? Math.sin(i * 0.05) * 0.5 : 0), 2);
  assert.equal(rms(L.subarray(SR * 12)), 0);
});

test("a decay jump mid-tail is lost in the tail's own texture", () => {
  // The coefficients may step — changing how fast a signal is decaying is not a
  // discontinuity in it — but the level trim that moves with them may not, so
  // it is ramped. This is the case that would catch it: the knob thrown from
  // one end of its range to the other while the tail is loud.
  const inst = makeProcessor();
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const rec = [];
  const switchBlock = Math.round(0.4 * SR / Q);
  for (let b = 0; b < Math.round(3 * SR / Q); b++) {
    for (let i = 0; i < Q; i++) {
      const v = b < 60 ? Math.sin((b * Q + i) * 2 * Math.PI * 220 / SR) * 0.4 : 0;
      ins[0][0][i] = v; ins[0][1][i] = v;
    }
    outs[0][0].fill(0); outs[0][1].fill(0);
    inst.process(ins, outs, { decay: Float32Array.of(b < switchBlock ? 0.5 : 8) });
    for (let i = 0; i < Q; i++) rec.push(outs[0][0][i]);
  }
  const at = switchBlock * Q;
  const jump = (i) => Math.abs(rec[i] - rec[i - 1]);
  const near = [];
  for (let i = at - 400; i < at + 400; i++) near.push(jump(i));
  const biggestNearby = Math.max(...near);
  assert.ok(jump(at) <= biggestNearby, `the switch sample jumps ${jump(at).toExponential(2)}, more than anything within 400 samples of it (${biggestNearby.toExponential(2)})`);
});

test("silence in, silence out — an unfed tank invents nothing", () => {
  const inst = makeProcessor();
  const { L, R } = render(inst, 5, () => 0, 4);
  assert.equal(peak(L), 0);
  assert.equal(peak(R), 0);
});

test("a sound arriving after a long silence keeps its whole tail", () => {
  // The idle skip's failure mode, pinned. Signal sits in the predelay and
  // partway down the lines with the output still silent, so a skip that keyed
  // off silent output alone processed the one block carrying the sound and then
  // skipped every block after it — the tail simply never came out.
  const inst = makeProcessor();
  render(inst, 20, () => 0, 2);                       // go fully idle first
  const { L } = render(inst, 6, (i) => (i === 0 ? 1 : 0), 2);
  const t = rt60(L);
  assert.ok(Math.abs(t / 2 - 1) < 0.06, `RT60 ${t.toFixed(3)}s after idling — the tail was cut short`);
});

test("process() never retires the node", () => {
  // A processor that returns false is finished for good. A reverb that retired
  // itself during a quiet passage would be gone for the rest of the session,
  // so the idle path skips the tank and still asks to be called again.
  const inst = makeProcessor();
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const params = { decay: Float32Array.of(2) };
  for (let b = 0; b < Math.round(30 * SR / Q); b++) {
    assert.equal(inst.process(ins, outs, params), true, `retired at block ${b}`);
  }
  // ...and it still works afterwards.
  const { L } = render(inst, 3, (i) => (i === 0 ? 1 : 0), 2);
  assert.ok(peak(L) > 0.001, "went deaf after idling");
});
