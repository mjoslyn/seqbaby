import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The contagion, rendered outside a browser, as drone.test.js renders the drone.
//
// What is pinned is each place the model used to part from the instrument:
// the saw-to-pulse morph keeping its fundamental, a rectifier with no DC in it,
// osc 1 frequency-modulating osc 2 (not the other way round), a filter
// envelope of its own, the sustain slope, filters that self-oscillate and stay
// bounded doing it, a gain ramped across the control block, a sync reset
// band-limited, chords gliding note to note, and a ceiling that leaves a
// single note alone.

const SR = 48000;
const Q = 128;

const SOURCE = (() => {
  const file = fs.readFileSync(new URL("../public/js/contagion.js", import.meta.url), "utf8");
  const m = file.match(/SOURCE = `([\s\S]*?)\n`;/);
  assert.ok(m, "contagion.js: no processor SOURCE template literal");
  return m[1];
})();
const PRELUDE = `
  globalThis.sampleRate = ${SR};
  globalThis.currentFrame = 0;
  globalThis.currentTime = 0;
  globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
`;
const Cls = new Function(`${PRELUDE}${SOURCE}\n return globalThis.__P;`)();
const fns = new Function(`${PRELUDE}${SOURCE}\n return { oscAt, saturate, ceil, resoK };`)();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// One oscillator into an open filter, no saturation, no envelope on the cutoff.
const CLEAN = { cutoff: 1, reso: 0, reso2: 0, satAmt: 0, envAmt: 0, lvl1: 1, lvl2: 0, attack: 0, sustain: 1 };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Render on a fresh processor. `notes` are [seconds, midi, duration] or
 * [seconds, midi, duration, glide]; `changes` are [seconds, {param: value}],
 * written when the render reaches them. Noise and start phases are seeded.
 */
function render({ secs = 1, set = {}, params = {}, notes = [[0.01, 57, 2]], changes = [], onBlock } = {}) {
  let s = 12345;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const saved = Math.random; Math.random = rnd;
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur, glide = 0] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: 1, glide });
  }
  const P = {};
  for (const [k, v] of Object.entries({ ...PARAM_DEFAULTS, ...params })) P[k] = Float32Array.of(v);
  const pending = changes.slice().sort((a, b) => a[0] - b[0]);
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    while (pending.length && pending[0][0] * SR <= b * Q) {
      for (const [k, v] of Object.entries(pending.shift()[1])) P[k] = Float32Array.of(v);
    }
    globalThis.currentFrame = b * Q;
    inst.process([], outs, P);
    L.set(outs[0][0].subarray(0, Math.min(Q, n - b * Q)), b * Q);
    R.set(outs[0][1].subarray(0, Math.min(Q, n - b * Q)), b * Q);
    onBlock?.(inst, b * Q);
  }
  Math.random = saved;
  return { L, R, inst };
}

const slice = (x, a, b) => x.subarray(Math.round(a * SR), Math.round(b * SR));
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const mean = (x) => x.reduce((a, v) => a + v, 0) / x.length;
/** Magnitude of one frequency in x. */
function mag(x, f) {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { const w = 2 * Math.PI * f * i / SR; re += x[i] * Math.cos(w); im += x[i] * Math.sin(w); }
  return Math.hypot(re, im) * 2 / x.length;
}
/** A harmonic of one cycle of oscAt, read off a 4096-point period. */
function oscHarm(shape, n, pw = 0.5) {
  const N = 4096;
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    const ph = i / N, y = fns.oscAt(ph, 1 / N, shape, pw);
    re += y * Math.cos(2 * Math.PI * n * ph); im += y * Math.sin(2 * Math.PI * n * ph);
  }
  return Math.hypot(re, im) * 2 / N;
}

test("contagion: the saw-to-pulse morph keeps its fundamental all the way across", () => {
  // The pulse used to be drawn upside down against the saw, so their odd
  // harmonics cancelled a third of the way in: at shape 0.778 the fundamental
  // measured 0.001, and the oscillator sounded an octave up.
  const saw = oscHarm(2 / 3, 1);
  for (let sh = 2 / 3; sh <= 1.0001; sh += 1 / 36) {
    const h1 = oscHarm(sh, 1);
    assert.ok(h1 >= saw * 0.99, `shape ${sh.toFixed(3)}: fundamental ${h1.toFixed(3)} under the saw's ${saw.toFixed(3)}`);
    assert.ok(h1 > oscHarm(sh, 2), `shape ${sh.toFixed(3)}: the 2nd harmonic is louder than the 1st`);
  }
  // and the pulse width still does what it says
  assert.ok(oscHarm(1, 2, 0.5) < 0.01, "a square has no even harmonics");
  assert.ok(oscHarm(1, 2, 0.25) > 0.2, "a quarter pulse does");
});

test("contagion: the rectifier is full wave with the DC taken out", () => {
  assert.equal(fns.saturate(0, 7, 1, new Float64Array(5), 0, 1 - 2 * Math.PI * 10 / SR), 0, "silence in is silence out");
  // A whole note through it, in parallel routing so nothing after it can hide DC.
  const { L } = render({ secs: 1, set: { sat: 7, route: 1 }, params: { ...CLEAN, satAmt: 1, shape: 0 } });
  const held = slice(L, 0.4, 0.9);
  assert.ok(Math.abs(mean(held)) < rms(held) * 0.02, `mean ${mean(held).toFixed(4)} against rms ${rms(held).toFixed(4)}`);
  // Full-wave rectifying a sine doubles its frequency.
  const f = hz(57);
  assert.ok(mag(held, 2 * f) > mag(held, f) * 2, "the rectified sine is not an octave up");
});

test("contagion: osc 1 frequency-modulates osc 2, not the other way round", () => {
  const base = { ...CLEAN, shape: 0, shape2: 0 };
  const run = (p) => slice(render({ params: { ...base, ...p } }).L, 0.3, 0.6);
  const same = (a, b) => a.every((v, i) => v === b[i]);
  // osc 1 alone: the FM knob changes nothing, it is the modulator
  assert.ok(same(run({ lvl1: 1, lvl2: 0, fm: 0 }), run({ lvl1: 1, lvl2: 0, fm: 0.8 })));
  // osc 2 alone: the FM knob changes it, it is the carrier
  assert.ok(!same(run({ lvl1: 0, lvl2: 1, fm: 0 }), run({ lvl1: 0, lvl2: 1, fm: 0.8 })));
});

test("contagion: osc 2 has a shape of its own", () => {
  const run = (p) => slice(render({ params: { ...CLEAN, lvl1: 0, lvl2: 1, ...p } }).L, 0.3, 0.6);
  const f = hz(57);
  const sine = run({ shape: 1, shape2: 0 }), saw = run({ shape: 0, shape2: 2 / 3 });
  assert.ok(mag(sine, 3 * f) < mag(sine, f) * 0.02, "osc 2 at shape2 0 is not a sine (osc 1's shape leaked in)");
  assert.ok(mag(saw, 3 * f) > mag(saw, f) * 0.2, "osc 2 at shape2 2/3 is not a saw");
});

test("contagion: the filter envelope is its own", () => {
  // A plucky filter on a sustained note: the amp holds, the filter falls.
  let amp = 0, fenv = 0;
  render({
    secs: 1,
    params: { ...CLEAN, sustain: 1, decay: 0.2, fattack: 0, fdecay: 0.2, fsustain: 0 },
    onBlock: (inst, at) => { if (at <= 0.8 * SR) { amp = inst.voices[0].amp; fenv = inst.voices[0].fenv; } },
  });
  assert.ok(amp > 0.99, `the amp envelope fell to ${amp}`);
  assert.ok(fenv < 0.01, `the filter envelope is still at ${fenv}`);
  // and the reverse: the amp plucks, the filter holds open
  render({
    secs: 1,
    params: { ...CLEAN, sustain: 0.3, decay: 0.2, fattack: 0, fsustain: 1 },
    onBlock: (inst, at) => { if (at <= 0.8 * SR) { amp = inst.voices[0].amp; fenv = inst.voices[0].fenv; } },
  });
  assert.ok(Math.abs(amp - 0.3) < 0.01, `the amp envelope is at ${amp}, not its sustain`);
  assert.ok(fenv > 0.99, `the filter envelope fell to ${fenv}`);
});

test("contagion: the sustain slope falls, rises, or holds", () => {
  const ampAt = (slope, t) => {
    let a = 0;
    render({ secs: t + 0.02, params: { ...CLEAN, sustain: 0.5, decay: 0, slope },
             onBlock: (inst, at) => { if (at <= t * SR) a = inst.voices[0].amp; } });
    return a;
  };
  assert.ok(Math.abs(ampAt(0, 1) - 0.5) < 1e-3, "slope 0 does not hold the sustain");
  assert.ok(ampAt(0.8, 1) < 0.2, "a positive slope does not fall away");
  assert.ok(ampAt(-0.8, 1) > 0.8, "a negative slope does not climb");
});

test("contagion: the top of the resonance self-oscillates, and stays bounded", () => {
  // Excite the filter, then take every oscillator away: below 0.9 the ringing
  // dies, at the top it carries on as a steady sine at the cutoff.
  const run = (reso, mode1 = 0) => render({
    secs: 1.5, set: { mode1, poles: 2 },
    params: { ...CLEAN, cutoff: 0.6, reso, shape: 2 / 3 },
    changes: [[0.3, { lvl1: 0 }]],
  }).L;
  const ringing = slice(run(0.85), 1.2, 1.5), osc = slice(run(1), 1.2, 1.5);
  assert.ok(rms(ringing) < 1e-4, `reso 0.85 still rings at ${rms(ringing)}`);
  assert.ok(rms(osc) > 0.05, `reso 1 does not self-oscillate (rms ${rms(osc)})`);
  assert.ok(Math.abs(rms(slice(run(1), 1.0, 1.25)) - rms(osc)) < rms(osc) * 0.1, "the oscillation is not steady");
  for (const mode of [0, 1, 2, 3]) {
    const x = run(1, mode);
    assert.ok(x.every(Number.isFinite), `mode ${mode}: not finite`);
    assert.ok(x.every(v => Math.abs(v) <= 1.5), `mode ${mode}: past the ceiling`);
  }
  // Filter 2 has its own resonance, and it self-oscillates too.
  const f2 = render({ secs: 1.5, set: { route: 1 }, params: { ...CLEAN, cutoff: 0.6, balance: 1, reso: 0, reso2: 1 },
                      changes: [[0.3, { lvl1: 0 }]] }).L;
  assert.ok(rms(slice(f2, 1.2, 1.5)) > 0.05, "filter 2 does not self-oscillate");
  // Below the self-oscillating tenth, the knob is the curve it always was.
  assert.equal(fns.resoK(0.5, 12, false), 1 / (0.7 + 0.125 * 12));
  assert.equal(fns.resoK(0.5, 12, true), 1 / Math.sqrt(0.7 + 0.125 * 12));
});

test("contagion: a fast attack is a ramp, not a staircase", () => {
  // The gain is worked out once per 16-sample control block. Stepped there, a
  // fast attack moved the output by up to a quarter of full scale at every
  // block boundary and by nothing in between (measured, 0.028 against
  // neighbours of 0.0006). Ramped, a boundary sample moves no further than the
  // samples either side of it.
  const { L } = render({ secs: 0.3, params: { ...CLEAN, shape: 0 }, notes: [[0.01, 33, 1]] });
  const d = (i) => Math.abs(L[i] - L[i - 1]);
  let worst = 0;
  for (let i = 0.01 * SR + 16; i < 0.03 * SR; i += 16) worst = Math.max(worst, d(i) - Math.max(d(i - 1), d(i + 1)));
  assert.ok(worst < 0.002, `a block boundary steps ${worst.toFixed(5)} past its neighbours`);
});

/** Power spectrum of x (length a power of two), Hann-windowed. */
function powerSpectrum(x) {
  const N = x.length, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(ang * k), sn = Math.sin(ang * k), a = i + k, b = a + len / 2;
      const vr = re[b] * c - im[b] * sn, vi = re[b] * sn + im[b] * c;
      re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
    }
  }
  return Array.from({ length: N / 2 }, (_, k) => re[k] * re[k] + im[k] * im[k]);
}

test("contagion: a sync reset is band-limited", () => {
  // osc 2 synced a fifth and a bit above osc 1, so the reset lands mid-ramp on
  // every cycle. Synced, the output repeats at osc 1's period, so everything
  // in it should be a harmonic of osc 1; what is not is aliasing. Measured:
  // -20dB with the reset snapped to the sample and uncorrected, -24.5dB with
  // the fractional restart alone, -32.6dB with the polyBLEP across it.
  const midi = 76, f = hz(midi), N = 16384;
  const { L } = render({ secs: 0.6, set: { sync: 1 }, notes: [[0.01, midi, 1]],
                         params: { ...CLEAN, lvl1: 0, lvl2: 1, shape2: 2 / 3, osc2semi: 7, osc2det: 0.3 } });
  const spec = powerSpectrum(L.subarray(0.2 * SR, 0.2 * SR + N));
  const bw = SR / N;
  let harm = 0, alias = 0;
  spec.forEach((p, k) => {
    const fr = k * bw;
    if (fr < f / 2) return;     // DC: a synced saw is not centred, and that is not aliasing
    const n = Math.round(fr / f);
    if (Math.abs(fr - n * f) < 4 * bw) harm += p; else alias += p;
  });
  const db = 10 * Math.log10(alias / harm);
  assert.ok(db < -30, `aliasing at ${db.toFixed(1)}dB`);
});

test("contagion: in a chord, each note glides from its own note of the chord before", () => {
  const C = [60, 64, 67], D = [62, 65, 69];
  const starts = [];
  render({
    secs: 0.6,
    notes: [...C.map(m => [0.01, m, 0.25, 0.2]), ...D.map(m => [0.3, m, 0.25, 0.2])],
    params: CLEAN,
    onBlock: (inst, at) => {
      if (at <= 0.3 * SR || starts.length) return;
      for (const m of D) starts.push(inst.voices.find(v => v.gate && v.note === m).freq);
    },
  });
  // One block in, each has moved a little from where it started: nearest to its own.
  starts.forEach((f, k) => {
    const nearest = C.reduce((a, m) => (Math.abs(hz(m) - f) < Math.abs(hz(a) - f) ? m : a));
    assert.equal(nearest, C[k], `note ${D[k]} glided from ${nearest}, not ${C[k]}`);
  });
});

test("contagion: the ceiling leaves a single note alone and holds a stack", () => {
  for (const x of [0, 0.3, -0.5, 0.8, -0.8]) assert.equal(fns.ceil(x), x);
  let prev = 0;
  for (let x = 0.8; x < 20; x += 0.01) {
    const y = fns.ceil(x);
    assert.ok(y >= prev && y < 1.5, `not monotonic and bounded at ${x}`);
    assert.equal(fns.ceil(-x), -y);
    prev = y;
  }
});
