import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DRONE_DEFAULTS, DRONE_EQUATIONS, DRONE_LFO_SHAPES, DRONE_NUM_CTLS, DRONE_TONE_NAMES, droneTone } from "../public/js/engineData.js";

// The drone, rendered outside a browser, as bass.test.js renders the bass.
//
// What is pinned is what drone.js claims: every equation is pitched at the
// note and none of them is silent or runs away, the rate knob moves the pitch
// by octaves, latch holds a note past its step until a later one arrives,
// a stop lets latched notes go, freeze keeps the cloud sounding with nothing
// playing, and an idle drone goes quiet and stays that way.

const SR = 48000;
const Q = 128;

function processorClass() {
  const file = fs.readFileSync(new URL("../public/js/drone.js", import.meta.url), "utf8");
  const m = file.match(/SOURCE = `([\s\S]*?)\n`;/);
  assert.ok(m, "drone.js: no processor SOURCE template literal");
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  return new Function(`${prelude}${m[1]}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// The dry voice: no delay, no cloud, filter wide open and flat.
const DRY = { cut: 1, reso: 0, drive: 0, dmix: 0, cmix: 0, mod1: 0, atk: 0 };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Render on a fresh processor. `events` are [seconds, message] pairs, posted
 * when the render reaches them. Noise is seeded so a run is a run.
 */
function render({ secs = 2, set = {}, params = {}, notes = [[0.01, 48, 1]], events = [] } = {}) {
  let s = 12345;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const saved = Math.random; Math.random = rnd;
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: 1, glide: 0 });
  }
  const pending = events.slice().sort((a, b) => a[0] - b[0]);
  const P = {};
  for (const [k, v] of Object.entries({ ...PARAM_DEFAULTS, ...params })) P[k] = Float32Array.of(v);
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    while (pending.length && pending[0][0] * SR <= b * Q) inst.onMessage(pending.shift()[1]);
    globalThis.currentFrame = b * Q;
    inst.process([], outs, P);
    const m = Math.min(Q, n - b * Q);
    L.set(outs[0][0].subarray(0, m), b * Q);
    R.set(outs[0][1].subarray(0, m), b * Q);
  }
  Math.random = saved;
  return { L, R, inst };
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
function rms(a, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / (i1 - i0));
}
/** Hann-windowed Goertzel magnitude at f over [t0, t1). */
function tone(a, f, t0, t1) {
  const i0 = Math.round(t0 * SR), n = Math.round(t1 * SR) - i0;
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    const s0 = a[i0 + i] * win + c * s1 - s2; s2 = s1; s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
  return Math.sqrt(re * re + im * im) * 2 / n;
}

test("drone: the tables agree with the processor", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, , , def] of DRONE_NUM_CTLS) {
    assert.ok(names.includes(k), `${k} is not a processor parameter`);
    assert.equal(PARAM_DEFAULTS[k], def, `${k}: the panel default and the processor default differ`);
  }
  assert.equal(DRONE_EQUATIONS.length, 16);
  assert.equal(DRONE_LFO_SHAPES.length, 8);
  // The four track sliders' defaults are the track's own (soundDefaults.js).
  assert.deepEqual([PARAM_DEFAULTS.cut, PARAM_DEFAULTS.a0, PARAM_DEFAULTS.a1, PARAM_DEFAULTS.a2], [0.5, 0.5, 0.5, 0.4]);
  for (const name of DRONE_TONE_NAMES) {
    const t = droneTone(name);
    for (const k of Object.keys(DRONE_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    assert.ok(DRONE_EQUATIONS.includes(t.drneq), `${name}: unknown equation ${t.drneq}`);
    assert.ok(DRONE_LFO_SHAPES.includes(t.drnlshape), `${name}: unknown lfo shape ${t.drnlshape}`);
  }
});

test("drone: every equation sounds, stays finite and stays under full scale, at every patch", () => {
  for (let eq = 0; eq < 16; eq++) {
    for (const params of [{}, { a0: 0.05, a1: 0.95, a2: 0.1 }, { a0: 0.95, a1: 0.05, a2: 0.95, reso: 1, drive: 1, cut: 0.7 }]) {
      const { L, R } = render({ secs: 1.2, set: { eq }, params });
      let peak = 0;
      for (let i = 0; i < L.length; i++) {
        assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `eq ${eq}: not finite at ${i}`);
        peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      }
      assert.ok(peak < 1, `eq ${eq} ${JSON.stringify(params)}: peak ${peak}`);
      assert.ok(db(rms(L, 0.4, 1.2)) > -45, `eq ${eq} ${JSON.stringify(params)}: ${db(rms(L, 0.4, 1.2)).toFixed(1)}dB`);
    }
  }
  // Everything at once: four notes, every level and feedback at the top.
  const all = render({ secs: 3, params: { reso: 1, drive: 1, cut: 1, dfbk: 1, dmix: 1, cfbk: 1, cmix: 1, noise: 1, osc: 1 },
    notes: [[0.01, 48, 1], [0.01, 55, 1], [0.01, 60, 1], [0.01, 64, 1]] });
  for (const x of all.L) assert.ok(Number.isFinite(x) && Math.abs(x) < 1);
});

test("drone: the note is the sample rate, and the rate knob moves it in octaves", () => {
  // Octaves with A0 at 1 and A1 at its top: a plain 8-bit ramp at the note
  // until the slow term first ticks over, a third of a second in.
  // The slow term ticks over 9638 counts in (where the counter starts), which
  // is sooner the higher the note, so the window ends there. A ramp has every
  // harmonic and nothing between them: compare the note with 3/4 and 3/2 of it.
  const p = { ...DRY, a0: 0, a1: 1 };
  const until = (f) => Math.min(0.3, 0.9 * 9638 / (256 * f));
  for (const midi of [45, 52, 57]) {
    const f = hz(midi), t1 = until(f);
    const { L } = render({ secs: 0.3, set: { eq: 7 }, params: p, notes: [[0, midi, 1]] });
    const at = tone(L, f, 0.02, t1);
    assert.ok(db(at / tone(L, f * 1.5, 0.02, t1)) > 20, `midi ${midi}: energy at 3/2 of the note`);
    assert.ok(db(at / tone(L, f * 0.75, 0.02, t1)) > 20, `midi ${midi}: energy at 3/4 of the note`);
  }
  const f = hz(48), t1 = until(2 * f);
  const up = render({ secs: 0.3, set: { eq: 7 }, params: { ...p, rate: 0.75 }, notes: [[0, 48, 1]] }).L;
  assert.ok(db(tone(up, 2 * f, 0.02, t1) / tone(up, f, 0.02, t1)) > 20, "rate 0.75 is not an octave up");
});

test("drone: latch holds a note past its step until a later note arrives", () => {
  const p = { ...DRY, rel: 0 };
  const latched = render({ secs: 1.5, params: p, notes: [[0.01, 48, 0.1]] }).L;
  const gated = render({ secs: 1.5, set: { latch: false }, params: p, notes: [[0.01, 48, 0.1]] }).L;
  assert.ok(db(rms(latched, 1, 1.5)) > -40, "a latched note let go when its step ended");
  assert.ok(db(rms(gated, 1, 1.5)) < -90, "a gated note kept sounding");

  // A second note at a later instant releases the first; a chord holds both.
  const f1 = hz(48), f2 = hz(55);
  const two = render({ secs: 2, set: { eq: 7 }, params: { ...p, a0: 0, a1: 1 }, notes: [[0.01, 48, 0.1], [1, 55, 0.1]] });
  assert.equal([...two.inst.vOn].filter(Boolean).length, 1, "the first note was not released");
  assert.ok(db(tone(two.L, f2, 1.2, 1.5) / tone(two.L, f1, 1.2, 1.5)) > 20);
  const chord = render({ secs: 1, params: p, notes: [[0.01, 48, 0.1], [0.01, 55, 0.1], [0.01, 60, 0.1]] });
  assert.equal([...chord.inst.vOn].filter(Boolean).length, 3, "a chord did not stay held");
});

test("drone: a stop lets latched notes go", () => {
  const { L, inst } = render({ secs: 1.5, params: { ...DRY, rel: 0 }, notes: [[0.01, 48, 0.1]],
    events: [[0.5, { type: "off", when: 0.5 }]] });
  assert.equal([...inst.vOn].filter(Boolean).length, 0);
  assert.ok(db(rms(L, 1, 1.5)) < -90);
});

test("drone: with glide, a latched note slides into the next instead of crossfading", () => {
  const p = { ...DRY, rel: 0.6 };
  const notes = [[0.01, 48, 0.1], [0.8, 55, 0.1]];
  const plain = render({ secs: 1, params: p, notes }).inst;
  const glided = render({ secs: 1, set: { glide: 0.15 }, params: p, notes }).inst;
  const sounding = (inst) => [...inst.vEnv].filter(e => e > 1e-4).length;
  assert.equal(sounding(plain), 2, "without glide the old note should be fading under the new one");
  assert.equal(sounding(glided), 1, "with glide one voice should have slid");
});

test("drone: freeze keeps the cloud sounding with nothing playing", () => {
  const p = { ...DRY, rel: 0, cmix: 1, cfbk: 0, cpos: 0.2, csize: 0.6, cdens: 0.7 };
  const notes = [[0.01, 48, 1]];
  const set = { latch: false };
  const free = render({ secs: 4, set, params: p, notes }).L;
  const frozen = render({ secs: 4, set, params: p, notes, events: [[1, { type: "set", freeze: true }]] }).L;
  assert.ok(db(rms(free, 3, 4)) < -80, `unfrozen cloud still at ${db(rms(free, 3, 4)).toFixed(1)}dB`);
  assert.ok(db(rms(frozen, 3, 4)) > -40, `frozen cloud only at ${db(rms(frozen, 3, 4)).toFixed(1)}dB`);
});

test("drone: an idle drone goes to digital silence and stays there", () => {
  const { L } = render({ secs: 14, set: { latch: false }, params: { rel: 0 }, notes: [[0.01, 48, 0.5]] });
  for (let i = Math.round(12 * SR); i < L.length; i++) assert.equal(L[i], 0);
});
