import assert from "node:assert/strict";
import test from "node:test";

import {
  REPEAT_KNOBS, REPEAT_MODES, repeatGridLabel, repeatModeIndex, repeatOffsetLabel, repeatOffsetSteps,
  repeatProcessorSource,
} from "../public/js/repeat.js";
import { REPEAT_GATE, REPEAT_GRID, REPEAT_GRID_LABELS, REPEAT_INTERVAL, defaultFxConfig } from "../public/js/soundDefaults.js";

// The repeat stage, rendered outside a browser the way prism.test.js renders
// the console, with the transport's step clock posted to it the way
// transport.js posts it: each step's audio time, its tick and its length, a
// little ahead of time.

const SR = 48000;
const Q = 128;
const BPM = 120;
const STEP = 60 / BPM / 4;          // 0.125s
const SPS = Math.round(STEP * SR);  // 6000 samples a step

function make(mode = 0) {
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  const Cls = new Function(`${prelude}${repeatProcessorSource()}\n return globalThis.__P;`)();
  return new Cls({ processorOptions: { mode } });
}

const D = defaultFxConfig().repeat;
const KNOBS = Object.fromEntries(REPEAT_KNOBS.map((k) => [k, D[k]]));
const knob = (list, value) => list.indexOf(value) / (list.length - 1);
const send = (p, data) => p.port.onmessage({ data });

/**
 * Render `secs`. `clock` is [from, to) seconds the transport is playing (step 0
 * at `from`), or null for a stopped transport.
 */
function render(p, secs, feed, knobs = {}, { clock = [0, Infinity], at } = {}) {
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const ins = [[new Float32Array(Q), new Float32Array(Q)]];
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  const params = Object.fromEntries(Object.entries({ ...KNOBS, ...knobs }).map(([k, v]) => [k, Float32Array.of(v)]));
  let posted = 0;
  for (let b = 0; b * Q < n; b++) {
    const now = b * Q / SR;
    if (at) at(now, p, params);
    if (clock) {
      // 100ms of lookahead, as Tone schedules
      for (;;) {
        const t = clock[0] + posted * STEP;
        if (t > now + 0.1 || t >= clock[1]) break;
        send(p, { type: "clock", time: t, step: posted, stepDur: STEP });
        posted++;
      }
    }
    for (let i = 0; i < Q; i++) { const v = feed(b * Q + i); ins[0][0][i] = v; ins[0][1][i] = -v; }
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
function tone(a, hz, from, to) {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return 2 * Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (to - from);
}

// A 1kHz tone whose level says which step it is in: step s has amplitude
// level(s). 6000 samples a step is a whole number of cycles, so a repeated
// step is phase-continuous and its level is all that tells it apart.
const level = (s) => 0.02 * ((s % 16) + 1);
const stepped = (i) => level(Math.floor(i / SPS)) * Math.sin(2 * Math.PI * 1000 * i / SR);
/** The level heard in the middle of step s (away from the 2ms edges). */
const heard = (L, s) => rms(L, s * SPS + 600, (s + 1) * SPS - 600) * Math.SQRT2;

test("the tables the knobs pick from agree with the panel and the defaults", () => {
  assert.deepEqual(REPEAT_MODES, ["repeat", "slice"]);
  assert.equal(REPEAT_GRID.length, REPEAT_GRID_LABELS.length);
  assert.equal(D.wet, 0, "the stage ships off");
  assert.equal(D.mode, "repeat");
  assert.equal(repeatGridLabel(D.grid), "1/16");
  assert.equal(REPEAT_INTERVAL[Math.round(D.interval * (REPEAT_INTERVAL.length - 1))], 16);
  assert.equal(REPEAT_GATE[Math.round(D.gate * (REPEAT_GATE.length - 1))], 4);
  assert.equal(repeatOffsetSteps(D.offset, D.interval), 12, "the last beat of the bar");
  assert.equal(repeatOffsetLabel(0, D.interval), "on the 1");
  assert.equal(repeatModeIndex({ mode: "slice" }), 1);
  assert.equal(repeatModeIndex({ mode: "nonsense" }), 0, "unknown names fall back");
});

test("with the transport stopped it is a wire, and with chance at 0 too", () => {
  for (const [clock, knobs] of [[null, { chance: 1 }], [[0, Infinity], { chance: 0 }]]) {
    const { L, R } = render(make(), 2.5, stepped, knobs, { clock });
    for (let i = 0; i < L.length; i++) {
      assert.ok(Math.abs(L[i] - stepped(i)) < 1e-6, `L differs at ${i}`);
      assert.ok(Math.abs(R[i] + stepped(i)) < 1e-6, `R differs at ${i}`);
    }
  }
});

test("repeat: on the offset step it captures a grid's worth and repeats it for the gate", () => {
  // every bar, step 12, a 1/16 repeated for 4 steps: steps 12..15 all sound like step 12
  const { L, R } = render(make(), 4.5, stepped, { chance: 1 });
  for (const bar of [0, 1]) {
    const b = bar * 16;
    for (let s = b; s < b + 12; s++) assert.ok(Math.abs(heard(L, s) - level(s)) < 0.002, `step ${s} should be live`);
    for (let s = b + 12; s < b + 16; s++) {
      assert.ok(Math.abs(heard(L, s) - level(12)) < 0.002, `step ${s}: ${heard(L, s).toFixed(4)}, wanted step 12's ${level(12)}`);
      assert.ok(Math.abs(heard(R, s) - level(12)) < 0.002, `R step ${s}`);
    }
  }
  assert.ok(Math.abs(heard(L, 32) - level(32)) < 0.002, "and back to the input after the gate");
});

test("repeat: a grid longer than a step repeats the whole of it", () => {
  // a 1/8 (two steps) from step 8, gated for 8 steps: 8 9 8 9 8 9 8 9
  const { L } = render(make(), 2.2, stepped, {
    chance: 1, offset: 0.5, grid: knob(REPEAT_GRID, 2), gate: knob(REPEAT_GATE, 8),
  });
  for (let s = 8; s < 16; s++) {
    const want = level(8 + (s % 2));
    assert.ok(Math.abs(heard(L, s) - want) < 0.002, `step ${s}: ${heard(L, s).toFixed(4)} wanted ${want}`);
  }
});

test("repeat: decay lowers each repeat, pitch drops each one", () => {
  const { L } = render(make(), 2.2, stepped, { chance: 1, decay: 1 });
  const g = 1 - 0.7;
  for (let k = 1; k < 4; k++) {
    const want = level(12) * Math.pow(g, k);
    assert.ok(Math.abs(heard(L, 12 + k) - want) < 0.002, `repeat ${k}: ${heard(L, 12 + k).toFixed(4)} wanted ${want.toFixed(4)}`);
  }
  // 12 semitones down per repeat: the first repeat is at 500Hz, the second 250
  const p = render(make(), 2.2, stepped, { chance: 1, pitch: 0.25 }).L;
  const from = 13 * SPS + 600, to = 14 * SPS - 600;
  assert.ok(tone(p, 500, from, to) > 5 * tone(p, 1000, from, to), "first repeat an octave down");
  assert.ok(tone(p, 250, 14 * SPS + 600, 15 * SPS - 600) > 5 * tone(p, 1000, 14 * SPS + 600, 15 * SPS - 600), "second two octaves down");
});

test("repeat: pitch above the middle rises each repeat, looping the slice rather than reading past it", () => {
  // +12 per repeat: the first repeat at 2000Hz, the second 4000
  const p = render(make(), 2.2, stepped, { chance: 1, pitch: 0.75 }).L;
  const from = 13 * SPS + 600, to = 14 * SPS - 600;
  assert.ok(tone(p, 2000, from, to) > 5 * tone(p, 1000, from, to), "first repeat an octave up");
  assert.ok(tone(p, 4000, 14 * SPS + 600, 15 * SPS - 600) > 5 * tone(p, 1000, 14 * SPS + 600, 15 * SPS - 600), "second two octaves up");
  // the slice was a quiet step; reading on past it would have played louder ones
  assert.ok(heard(p, 13) < level(12) * 1.2, `first repeat ${heard(p, 13).toFixed(4)} stays the captured step's level`);
});

test("the chance is a hash of the step: the same song makes the same repeats, and about as many as asked", () => {
  const a = render(make(), 16.5, stepped, { chance: 0.5, interval: knob(REPEAT_INTERVAL, 4), offset: 0 }).L;
  const b = render(make(), 16.5, stepped, { chance: 0.5, interval: knob(REPEAT_INTERVAL, 4), offset: 0 }).L;
  assert.deepEqual(a, b);
  // 32 chances in 128 steps: a repeat shows as the step after a beat sounding like the beat
  let fired = 0;
  for (let beat = 0; beat < 32; beat++) {
    const s = beat * 4;
    if (Math.abs(heard(a, s + 1) - level(s)) < 0.002) fired++;
  }
  assert.ok(fired >= 8 && fired <= 24, `${fired} of 32`);
});

test("slice: every swapped step is a different step from the bar before", () => {
  const { L } = render(make(1), 4.5, stepped, { chance: 1, gate: knob(REPEAT_GATE, 1) });
  const levels = Array.from({ length: 16 }, (_, s) => level(s));
  let swapped = 0;
  for (let s = 16; s < 32; s++) {
    const h = heard(L, s);
    const match = levels.findIndex((v) => Math.abs(v - h) < 0.002);
    assert.ok(match >= 0, `step ${s}: ${h.toFixed(4)} is no step's level`);
    if (match !== s % 16) swapped++;
  }
  assert.equal(swapped, 16, "chance 1 swaps every slice, never for itself");
});

test("slice: vary plays slices backwards, and reverse of a tone is the same tone", () => {
  const { L } = render(make(1), 4.5, stepped, { chance: 1, vary: 1, gate: knob(REPEAT_GATE, 1) });
  for (let s = 16; s < 32; s++) assert.ok(tone(L, 1000, s * SPS + 600, (s + 1) * SPS - 600) > 0.015);
  // an envelope that rises through every step comes out falling
  const ramp = (i) => ((i % SPS) / SPS) * Math.sin(2 * Math.PI * 1000 * i / SR);
  const r = render(make(1), 4.5, ramp, { chance: 1, vary: 1, gate: knob(REPEAT_GATE, 1) }).L;
  const s = 20;
  assert.ok(rms(r, s * SPS + 300, s * SPS + 1500) > 3 * rms(r, (s + 1) * SPS - 1500, (s + 1) * SPS - 300));
});

test("slice: decay chops each swapped slice short", () => {
  const { L } = render(make(1), 4.5, stepped, { chance: 1, decay: 1, gate: knob(REPEAT_GATE, 1) });
  for (let s = 16; s < 32; s++) {
    assert.ok(rms(L, s * SPS + 100, s * SPS + 400) > 0.005, `step ${s} starts`);
    assert.ok(peak(L, s * SPS + 1200, (s + 1) * SPS - 100) < 1e-6, `step ${s} is cut`);
  }
});

test("when the transport stops the stage lets go", () => {
  // playing for 1.6s (to step 12, mid-repeat), then no more clock
  const { L } = render(make(), 3, stepped, { chance: 1, gate: knob(REPEAT_GATE, 32) }, { clock: [0, 1.6] });
  const s = Math.round(2.3 * SR);
  for (let i = s; i < s + SPS; i++) assert.ok(Math.abs(L[i] - stepped(i)) < 1e-6, `${i}`);
});

test("a mode switch fades out and carries on, and the edges never click", () => {
  const sw = (now, p) => { if (Math.abs(now - 1.65) < 0.5 / SR * Q) send(p, { type: "mode", mode: 1 }); };
  const { L } = render(make(), 4, (i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / SR), { chance: 1, grid: knob(REPEAT_GRID, 2 / 3) }, { at: sw });
  let jump = 0;
  for (let i = 1; i < L.length; i++) jump = Math.max(jump, Math.abs(L[i] - L[i - 1]));
  // a 220Hz sine at 0.5 moves 0.0144 a sample; a fade over 2ms adds at most 0.5/96
  assert.ok(jump < 0.03, `largest step between samples ${jump}`);
  for (const v of L) assert.ok(Number.isFinite(v));
});

test("silence in is silence out", () => {
  for (const mode of [0, 1]) {
    const { L, R } = render(make(mode), 3, () => 0, { chance: 1, pitch: 1, vary: 1 });
    assert.equal(peak(L), 0); assert.equal(peak(R), 0);
  }
});
