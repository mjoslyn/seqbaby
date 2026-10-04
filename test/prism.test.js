import assert from "node:assert/strict";
import test from "node:test";

import { PRISM_MODES, prismProcessorSource, prismModeIndices, prismTimeSec } from "../public/js/prism.js";
import { defaultFxConfig } from "../public/js/soundDefaults.js";

// The prism console, rendered outside a browser, as reverb.test.js renders the
// tank: the processor is a source string evaluated against the globals a
// worklet scope provides. What is asserted is what the stage promises the rack
// and the panel: out of the circuit means out of the circuit, nothing makes a
// sound on its own, nothing runs away, and the knobs mean what they say.

const SR = 48000;
const Q = 128;
const KN = ["char", "move", "diff", "tex"];
const MODE_KEYS = ["charmode", "movemode", "diffmode", "texmode"];

function make(modes = [0, 0, 2, 2]) {
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  const Cls = new Function(`${prelude}${prismProcessorSource()}\n return globalThis.__P;`)();
  return new Cls({ processorOptions: { modes } });
}

const KNOBS = { char: 0, move: 0, diff: 0, tex: 0, tilt: 0.5, rate: 0.35, time: 0.4, sens: 0.5, drift: 0.2 };

/** Render `secs`, `feed(i)` the input at frame i, `at(b)` optional per-block hook. */
function render(p, secs, feed, knobs = {}, at) {
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const params = Object.fromEntries(Object.entries({ ...KNOBS, ...knobs }).map(([k, v]) => [k, Float32Array.of(v)]));
  for (let b = 0; b * Q < n; b++) {
    if (at) at(b * Q, p, params);
    for (let i = 0; i < Q; i++) { const v = feed(b * Q + i); ins[0][0][i] = v; ins[0][1][i] = v; }
    outs[0][0].fill(0); outs[0][1].fill(0);
    p.process(ins, outs, params);
    const take = Math.min(Q, n - b * Q);
    L.set(outs[0][0].subarray(0, take), b * Q);
    R.set(outs[0][1].subarray(0, take), b * Q);
  }
  return { L, R };
}

const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const peak = (a, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const db = (x) => 20 * Math.log10(x + 1e-12);
/** Magnitude of one frequency in a span (Goertzel), normalised to a sine's amplitude. */
function tone(a, hz, from, to) {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return 2 * Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (to - from);
}

const sine = (hz, amp = 0.3) => (i) => amp * Math.sin(2 * Math.PI * hz * i / SR);
// a 220Hz note every half second, decaying, for 2s
const notes = (i) => {
  if (i >= 2 * SR) return 0;
  const t = i / SR, ph = t % 0.5;
  return ph > 0.25 ? 0 : 0.3 * Math.exp(-ph * 8) * Math.sin(2 * Math.PI * 220 * t);
};

test("the modes the processor indexes are the ones the panel and the song builder offer", () => {
  assert.deepEqual(Object.keys(PRISM_MODES), MODE_KEYS);
  for (const k of MODE_KEYS) assert.equal(PRISM_MODES[k].length, 5);
  const d = defaultFxConfig().prism;
  assert.equal(d.wet, 0, "the stage ships off");
  assert.deepEqual(prismModeIndices(d), MODE_KEYS.map((k) => PRISM_MODES[k].indexOf(d[k])));
  assert.deepEqual(prismModeIndices({ charmode: "nonsense" }), [0, 0, 2, 2], "unknown names fall back");
});

test("with every module at 0 and the tilt flat, the console is a wire", () => {
  const { L, R } = render(make(), 0.5, notes);
  for (let i = 0; i < L.length; i++) {
    assert.ok(Math.abs(L[i] - notes(i)) < 1e-6, `L differs at ${i}`);
    assert.ok(Math.abs(R[i] - notes(i)) < 1e-6, `R differs at ${i}`);
  }
});

test("every character, at a little and at full, plays: finite, audible, under the ceiling", () => {
  const inDb = db(rms(Float32Array.from({ length: 2 * SR }, (_, i) => notes(i))));
  for (let m = 0; m < 4; m++) {
    for (let j = 0; j < 5; j++) {
      for (const amt of [0.3, 1]) {
        const modes = [0, 0, 2, 2]; modes[m] = j;
        const name = `${PRISM_MODES[MODE_KEYS[m]][j]} at ${amt}`;
        const { L, R } = render(make(modes), 2.5, notes, { [KN[m]]: amt });
        for (const ch of [L, R]) for (const v of ch) assert.ok(Number.isFinite(v), `${name}: not finite`);
        assert.ok(peak(L) <= 1.5 && peak(R) <= 1.5, `${name}: past the ceiling (${peak(L)})`);
        const outDb = db(rms(L, 0, 2 * SR));
        // swell fades every note in, so on decaying notes it is meant to be quieter
        const floor = PRISM_MODES[MODE_KEYS[m]][j] === "swell" ? 25 : 12;
        assert.ok(outDb > inDb - floor, `${name}: ${outDb.toFixed(1)}dB against ${inDb.toFixed(1)}dB in`);
        assert.ok(outDb < inDb + 10, `${name}: ${outDb.toFixed(1)}dB, too hot`);
      }
    }
  }
});

test("nothing makes a sound on its own: silence in is silence out, every character, all four at full", () => {
  for (let j = 0; j < 5; j++) {
    const { L, R } = render(make([j, j, j, j]), 1, () => 0, { char: 1, move: 1, diff: 1, tex: 1, drift: 1 });
    assert.equal(peak(L), 0, `mode ${j}: L`);
    assert.equal(peak(R), 0, `mode ${j}: R`);
  }
});

test("the noise a texture adds follows the signal down: no hiss, static or howl left after it stops", () => {
  const cases = [[3, 0, 2, 2, "char"], [2, 0, 2, 2, "char"], [0, 0, 2, 2, "tex", 2], [0, 0, 2, 4, "tex"], [0, 0, 2, 3, "tex"]];
  for (const [c, mv, d, t, knob] of cases) {
    const { L } = render(make([c, mv, d, t]), 4, notes, { [knob]: 1 });
    const tail = db(rms(L, 3.5 * SR));
    assert.ok(tail < -70, `modes ${[c, mv, d, t]}: ${tail.toFixed(1)}dB a second and a half after the input stopped`);
  }
});

test("no feedback runs away: every diffusion at full, all four modules at full, held for ten seconds", () => {
  for (let j = 0; j < 5; j++) {
    const { L } = render(make([3, 2, j, 0]), 10, sine(110, 0.5), { char: 1, move: 1, diff: 1, tex: 1, time: 1, drift: 1 });
    const late = rms(L, 8 * SR), early = rms(L, 2 * SR, 4 * SR);
    assert.ok(Number.isFinite(late) && late < 1.2, `diffusion ${j}: ${late}`);
    assert.ok(late < early * 2, `diffusion ${j} still growing: ${early} -> ${late}`);
  }
});

test("tilt is a see-saw: flat in the middle, darker to the left, brighter to the right", () => {
  const gain = (tilt, hz) => {
    const { L } = render(make(), 0.5, sine(hz), { tilt });
    return db(tone(L, hz, 0.25 * SR, 0.5 * SR) / 0.3);
  };
  assert.ok(Math.abs(gain(0.5, 100)) < 0.1 && Math.abs(gain(0.5, 8000)) < 0.1);
  const lo0 = gain(0, 100), hi0 = gain(0, 8000), lo1 = gain(1, 100), hi1 = gain(1, 8000);
  assert.ok(lo0 > 2.5 && hi0 < -4.5, `tilt 0: low ${lo0.toFixed(1)} high ${hi0.toFixed(1)}`);
  assert.ok(lo1 < -2.5 && hi1 > 4.5, `tilt 1: low ${lo1.toFixed(1)} high ${hi1.toFixed(1)}`);
});

test("space's tail is the length the time knob says", () => {
  // Schroeder backward integration of an impulse response, read off -5..-25dB
  const rt60 = (sig) => {
    const e = new Float64Array(sig.length);
    let acc = 0;
    for (let i = sig.length - 1; i >= 0; i--) { acc += sig[i] * sig[i]; e[i] = acc; }
    const at = (target) => { for (let i = 0; i < e.length; i++) if (10 * Math.log10(e[i] / e[0]) <= target) return i / SR; return NaN; };
    return (at(-25) - at(-5)) * 3;
  };
  for (const time of [0, 0.2, 0.5, 0.75, 1]) {
    const want = prismTimeSec(time, "space");
    const { L } = render(make([0, 0, 2, 2]), want * 1.6 + 0.5, (i) => (i === 0 ? 1 : 0), { diff: 1, time, drift: 0 });
    const got = rt60(L);
    assert.ok(got > want * 0.85 && got < want * 1.15, `time ${time}: asked ${want.toFixed(2)}s, got ${got.toFixed(2)}s`);
  }
});

test("pitch puts the harmony where the amount says: an octave down at the bottom, an octave up at the top", () => {
  // A two-head shifter restarts its read every window, so a shifted sine is a
  // comb of lines a window-rate apart around where it should be, not one line:
  // the energy is measured across ±8% of the target, in 2Hz bins.
  const band = (amt, hz) => {
    const { L } = render(make([0, 4, 2, 2]), 1, sine(220), { move: amt, drift: 0 });
    let e = 0;
    for (let f = Math.round(hz * 0.92); f <= hz * 1.08; f += 2) e += tone(L, f, 0.5 * SR, SR) ** 2;
    return Math.sqrt(e);
  };
  const dry = band(0.1, 220);
  for (const [amt, hz, name] of [[0.1, 110, "octave down"], [0.4, 220 * 2 ** (-5 / 12), "fourth down"], [0.75, 220 * 2 ** (7 / 12), "fifth up"], [1, 440, "octave up"]]) {
    const got = band(amt, hz);
    assert.ok(got > dry * 0.35, `${name}: ${got.toFixed(3)} against the dry ${dry.toFixed(3)}`);
  }
  assert.ok(band(1, 110) < dry * 0.1, "no octave down at the top");
});

test("switching a character mid-signal fades rather than steps", () => {
  // a 50Hz tone: the biggest honest sample-to-sample move is small, so a
  // swap without its fade (or a buffer read before it was cleared) shows up
  const p = make([0, 0, 0, 2]);
  const switchAt = Math.round(0.6 * SR / Q) * Q;
  const { L } = render(p, 1.2, sine(50, 0.4), { char: 0.6, diff: 0.6 }, (frame, proc) => {
    if (frame === switchAt) proc.port.onmessage({ data: { type: "modes", modes: [2, 0, 3, 2] } });
  });
  let before = 0, around = 0;
  for (let i = 1; i < L.length; i++) {
    const d = Math.abs(L[i] - L[i - 1]);
    if (i < switchAt) before = Math.max(before, d);
    else if (i < switchAt + 0.05 * SR) around = Math.max(around, d);
  }
  assert.ok(around < Math.max(0.05, before * 4), `step at the switch: ${around} (before ${before})`);
});

test("the idle skip waits out the longest buffer, then sleeps, then wakes on the next note", () => {
  const p = make([0, 0, 4, 2]);
  render(p, 0.3, sine(220), { diff: 1, time: 1 });
  // reverse at the longest slice: the tail is in the buffer for ~3s
  const { L } = render(p, 2.5, () => 0, { diff: 1, time: 1 });
  assert.ok(peak(L, 0.2 * SR) > 1e-3, "the reversed slice still plays out after the input stopped");
  assert.equal(p.sleeping, false);
  render(p, 6, () => 0, { diff: 1, time: 1 });
  assert.equal(p.sleeping, true, "asleep once the input and output have both been silent long enough");
  const { L: back } = render(p, 0.3, sine(220), { diff: 1, time: 1 });
  assert.equal(p.sleeping, false);
  assert.ok(peak(back) > 0.1, "awake again on the next note");
});
