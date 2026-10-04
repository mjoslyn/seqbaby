import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The electric bass's string, rendered outside a browser.
//
// bass.js reaches for the DOM and Tone at load, so, as workletQueue.test.js
// does, the processor source is read as TEXT and evaluated against the globals
// a worklet scope provides. What is pinned here is what the file claims about
// the string and what was found wrong with it when it was measured: a bass
// note whose fundamental was 15dB under its 3rd harmonic, an attack that was a
// quarter of a second of noise, every partial of a low E decaying at one rate,
// and partials that were dead harmonic on an instrument named for its clank.
// None of that can be heard from a test, and all of it can be measured.

const SR = 48000;
const Q = 128;

function processorClass() {
  const file = fs.readFileSync(new URL("../public/js/bass.js", import.meta.url), "utf8");
  const m = file.match(/SOURCE = `([\s\S]*?)\n`;/);
  assert.ok(m, "bass.js: no processor SOURCE template literal");
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

const DEFAULTS = {
  drive: 0.5, tone: 0.5, comp: 0.5, sustain: 0.4,
  pick: 0.14, attack: 0.4, stiff: 0.45, pkup: 0.1, mute: 0, fret: 0.25,
  grind: 0, xover: 0.4, sub: 0, bass: 0.5, lomid: 0.5, himid: 0.5, treb: 0.5, hpf: 0.15, mic: 0.4,
};
// The DI chain, so what is measured is the string and the pickup, not the amp.
const CLEAN = { set: { amp: 0, cab: 4 }, params: { drive: 0, comp: 0, tone: 1 } };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Render one note on a fresh processor. Noise is seeded so a run is a run. */
function render(midi, { secs = 1.4, vel = 1, set = {}, params = {}, tapString = false } = {}) {
  let s = 12345;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const saved = Math.random; Math.random = rnd;
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  inst.onMessage({ type: "note", when: 0.01, id: 1, note: midi, freq: hz(midi), dur: secs - 0.1, vel, glide: 0 });
  const P = {};
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...params })) P[k] = Float32Array.of(v);
  const n = Math.round(secs * SR);
  const out = new Float32Array(n);
  const outs = [[new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    outs[0][0].fill(0);
    globalThis.currentFrame = b * Q;
    inst.process([], outs, P);
    out.set(outs[0][0].subarray(0, Math.min(Q, n - b * Q)), b * Q);
  }
  Math.random = saved;
  return { out, inst };
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

/** Hann-windowed Goertzel magnitude at f over [i0, i1). */
function tone(a, f, i0, i1) {
  const n = i1 - i0, w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    s0 = a[i0 + i] * win + c * s1 - s2; s2 = s1; s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
  return Math.sqrt(re * re + im * im) * 2 / n;
}
/** The loudest frequency within tol of fc over [i0, i1). */
function peakNear(a, fc, tol, i0, i1) {
  let best = fc, bm = 0;
  for (let g = fc * (1 - tol); g <= fc * (1 + tol); g += fc * 0.0001) {
    const m = tone(a, g, i0, i1);
    if (m > bm) { bm = m; best = g; }
  }
  return { freq: best, level: bm };
}
const at = (t) => Math.round(t * SR);

test("bass: a note plays in tune", () => {
  for (const midi of [28, 33, 38, 43, 50]) {
    const { out } = render(midi, CLEAN);
    const p = peakNear(out, hz(midi), 0.02, at(0.3), at(1.2));
    const cents = 1200 * Math.log2(p.freq / hz(midi));
    assert.ok(Math.abs(cents) < 2, `note ${midi}: ${cents.toFixed(1)} cents off`);
  }
});

test("bass: the fundamental of a low note is within a few dB of its strongest partial", () => {
  // It used to sit 13-17dB under the 2nd and 3rd harmonics, because the loop
  // was filled with flat noise where a plucked string's spectrum falls as 1/n.
  // The 2nd harmonic may still lead by a little: the pick and pickup combs
  // both favour it on a low string, and they do on the instrument too.
  for (const midi of [28, 33, 38]) {
    const { out } = render(midi, CLEAN);
    const f = hz(midi);
    const lv = (n) => db(peakNear(out, f * n, 0.012, at(0.05), at(0.45)).level);
    const h1 = lv(1);
    for (const n of [2, 3, 4]) assert.ok(h1 >= lv(n) - 6, `note ${midi}: h${n} ${lv(n).toFixed(0)}dB over h1 ${h1.toFixed(0)}dB`);
  }
});

test("bass: the attack is a waveform, not a burst of noise", () => {
  // Zero crossings in the first period of the raw string. Noise excitation
  // gave 178 in a 24ms period (7kHz hash) and took ten periods to settle; a
  // pulse gives the handful a bass waveform has.
  const file = fs.readFileSync(new URL("../public/js/bass.js", import.meta.url), "utf8");
  const tapped = file.replace("// ---- pickup, then the tone pot ----", "if (this.__tap) this.__tap.push(mono);\n // ---- pickup, then the tone pot ----");
  assert.notEqual(tapped, file, "the pickup marker comment moved; retarget the tap");
  const m = tapped.match(/SOURCE = `([\s\S]*?)\n`;/);
  const T = new Function(`globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };${m[1]}\n return globalThis.__P;`)();
  const inst = new T();
  const tap = []; inst.__tap = tap;
  inst.onMessage({ type: "note", when: 0, id: 1, note: 28, freq: hz(28), dur: 1, vel: 1, glide: 0 });
  const P = {}; for (const [k, v] of Object.entries(DEFAULTS)) P[k] = Float32Array.of(v);
  const outs = [[new Float32Array(Q)]];
  for (let b = 0; b * Q < at(0.3); b++) { globalThis.currentFrame = b * Q; inst.process([], outs, P); }
  const L = Math.round(SR / hz(28));
  const zc = (i0) => { let z = 0; for (let i = i0 + 1; i < i0 + L; i++) if ((tap[i] >= 0) !== (tap[i - 1] >= 0)) z++; return z; };
  assert.ok(zc(2) <= 12, `first period has ${zc(2)} zero crossings`);
  assert.ok(zc(2 + 5 * L) <= 12, `sixth period has ${zc(2 + 5 * L)} zero crossings`);
});

test("bass: a low note's upper partials die before its fundamental", () => {
  // One loss coefficient per trip gave E1's 20th partial the same 10dB/s as
  // its fundamental. The losses are in time now: h12 of E1 (~500Hz) must go at
  // least twice as fast as h1, and partials near 850Hz must decay at roughly
  // the same rate whichever note they belong to.
  const slope = (out, f, n, t0, t1) => {
    const pts = [];
    for (let t = t0; t + 0.1 <= t1; t += 0.1) pts.push([t, db(peakNear(out, f * n * (1 + 0.0007 * n * n), 0.012, at(t), at(t + 0.1)).level)]);
    const k = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    return (k * sxy - sx * sy) / (k * sxx - sx * sx);
  };
  const e1 = render(28, CLEAN).out, a2 = render(45, CLEAN).out;
  const e1h1 = slope(e1, hz(28), 1, 0.15, 1.2), e1h12 = slope(e1, hz(28), 12, 0.1, 0.6);
  assert.ok(e1h1 < -8 && e1h1 > -40, `E1 fundamental decays at ${e1h1.toFixed(0)}dB/s`);
  assert.ok(e1h12 < 2 * e1h1, `E1 h12 at ${e1h12.toFixed(0)}dB/s is not 2x the fundamental's ${e1h1.toFixed(0)}`);
  const e1h20 = slope(e1, hz(28), 20, 0.05, 0.4);   // 824Hz
  const a2h8 = slope(a2, hz(45), 8, 0.05, 0.4);     // 880Hz
  assert.ok(Math.abs(e1h20 - a2h8) < Math.max(30, 0.5 * Math.abs(a2h8)),
    `~850Hz decays at ${e1h20.toFixed(0)}dB/s on E1 but ${a2h8.toFixed(0)}dB/s on A2`);
});

test("bass: the partials of a roundwound run sharp, and flats less so", () => {
  // Solved from the loop's phase response rather than read off a spectrum: the
  // tuned coefficients are taken from a sounding string and the resonances
  // of the loop they describe are found exactly.
  const NAP = 8;
  const resonance = (ln, damp, f, n) => {
    const ap = (c, w) => Math.atan2(-Math.sin(w), c + Math.cos(w)) - Math.atan2(-c * Math.sin(w), 1 + c * Math.cos(w));
    const phase = (w) => -w * ln.len + ap(ln.eta, w) + NAP * ap(ln.c, w) - Math.atan2((1 - damp) * Math.sin(w), 1 - (1 - damp) * Math.cos(w));
    let lo = 0.9 * n * 2 * Math.PI * f / SR, hi = 1.35 * n * 2 * Math.PI * f / SR;
    for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (phase(m) > -2 * Math.PI * n) lo = m; else hi = m; }
    return 1200 * Math.log2(0.5 * (lo + hi) * SR / (2 * Math.PI) / (n * f));
  };
  const stretch = (midi, flats, n) => {
    const { inst } = render(midi, { secs: 0.05, set: { flats } });
    const v = inst.voices[0];
    assert.ok(v.active, "the note should be sounding");
    return resonance(v.a, v.damp, hz(midi), n);
  };
  // Within a few cents of n*f0*sqrt(1 + B*n*n) for B ~ 2.9e-4 at the default.
  const want = (n) => 1200 * Math.log2(Math.sqrt(1 + 2.9e-4 * n * n));
  for (const n of [4, 8, 10, 12]) {
    const got = stretch(28, 0, n);
    assert.ok(Math.abs(got - want(n)) < 4, `E1 partial ${n}: ${got.toFixed(0)} cents sharp, law says ${want(n).toFixed(0)}`);
  }
  assert.ok(stretch(28, 0, 1) < 1, "the fundamental itself stays in tune");
  assert.ok(stretch(28, 1, 10) < stretch(28, 0, 10) * 0.85, "flats stretch less");
  assert.ok(stretch(43, 0, 10) < stretch(28, 0, 10), "a higher, thinner string stretches less");
});

test("bass: the string carries no DC and the note ends", () => {
  const { out } = render(28, { ...CLEAN, secs: 2.5 });
  let mean = 0; for (let i = at(0.3); i < at(1.3); i++) mean += out[i];
  mean /= at(1.0);
  let rms = 0; for (let i = at(0.3); i < at(1.3); i++) rms += out[i] * out[i];
  rms = Math.sqrt(rms / at(1.0));
  assert.ok(Math.abs(mean) < rms * 0.02, `DC ${mean.toExponential(2)} against rms ${rms.toExponential(2)}`);
  let tail = 0; for (let i = at(2.3); i < at(2.5); i++) tail = Math.max(tail, Math.abs(out[i]));
  let body = 0; for (let i = at(0.05); i < at(0.3); i++) body = Math.max(body, Math.abs(out[i]));
  assert.ok(db(tail) < db(body) - 25, `release: tail ${db(tail).toFixed(0)}dB against body ${db(body).toFixed(0)}dB`);
});

test("bass: playing harder is louder and brighter", () => {
  const soft = render(33, { ...CLEAN, vel: 0.3 }).out, hard = render(33, { ...CLEAN, vel: 1 }).out;
  const level = (a) => { let s = 0; for (let i = at(0.02); i < at(0.3); i++) s += a[i] * a[i]; return db(Math.sqrt(s / at(0.28))); };
  assert.ok(level(hard) > level(soft) + 3, `hard ${level(hard).toFixed(1)}dB, soft ${level(soft).toFixed(1)}dB`);
  const top = (a) => { let e = 0; for (let f = 1000; f < 4000; f += 25) { const m = tone(a, f, at(0.012), at(0.1)); e += m * m; } return db(Math.sqrt(e)); };
  const ratio = (a) => top(a) - level(a);
  assert.ok(ratio(hard) > ratio(soft) + 2, `top relative to level: hard ${ratio(hard).toFixed(1)}dB, soft ${ratio(soft).toFixed(1)}dB`);
});
