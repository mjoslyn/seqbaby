import assert from "node:assert/strict";
import test from "node:test";

import {
  VOX_DEFAULTS, VOX_NUM_CTLS, VOX_SEL_CTLS, VOX_TONE_NAMES, VOX_CONSONANT_NAMES, VOX_WORDS,
  VOX_WORD_NAMES, voxTone, voxSyllables, voxFormantsAt,
} from "../public/js/engineData.js";
import { voxProcessorSource, voxSyllableList } from "../public/js/vox.js";

// The vox, rendered outside a browser, as drone.test.js renders the drone.
//
// What is pinned is what vox.js claims: a note is pitched at its note and
// sits at a sane level, the vowel slider moves the formants where the tables
// say (an i has its second formant high, a u low), breath at the top
// whispers, a consonant puts its hiss before the vowel and the vowel lands on
// the step, the words cycle one syllable a note and start over on a stop, the
// choir widens the stereo field, mono slides, and nothing is ever loud,
// non-finite, or left sounding.

const SR = 48000;
const Q = 128;

function processorClass() {
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  return new Function(`${prelude}${voxProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// A steady voice: no vibrato, no drift, no air.
const STEADY = { vib: 0, drift: 0, breath: 0, atk: 0 };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Render on a fresh processor. `notes` are [seconds, midi, dur, vel?];
 * `events` are [seconds, message] pairs posted when the render reaches them.
 */
function render({ secs = 1.5, set = {}, params = {}, notes = [[0.2, 60, 1]], events = [] } = {}) {
  let s = 12345;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const saved = Math.random; Math.random = rnd;
  globalThis.currentFrame = 0;
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur, vel = 1] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel, glide: 0 });
  }
  const pending = events.slice().sort((a, b) => a[0] - b[0]);
  const P = {};
  for (const [k, v] of Object.entries({ ...PARAM_DEFAULTS, ...params })) P[k] = Float32Array.of(v);
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    globalThis.currentFrame = b * Q;
    while (pending.length && pending[0][0] * SR <= b * Q) inst.onMessage(pending.shift()[1]);
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
/** The strongest harmonic of f0 in [lo, hi] Hz. */
function peakHarmonic(a, f0, lo, hi, t0, t1) {
  let best = 0, bestF = 0;
  for (let h = Math.ceil(lo / f0); h * f0 <= hi; h++) {
    const m = tone(a, h * f0, t0, t1);
    if (m > best) { best = m; bestF = h * f0; }
  }
  return bestF;
}
/** Energy in a band, from harmonics of f0 (voiced) — summed squares. */
function bandEnergy(a, f0, lo, hi, t0, t1) {
  let e = 0;
  for (let h = Math.ceil(lo / f0); h * f0 <= hi; h++) e += tone(a, h * f0, t0, t1) ** 2;
  return e;
}
/** How much of a stretch is harmonics of f0: their rms over the whole rms. */
function harmonicShare(a, f0, t0, t1) {
  let e = 0;
  for (let h = 1; h * f0 < 6000; h++) e += tone(a, h * f0, t0, t1) ** 2 / 2;
  return Math.sqrt(e) / rms(a, t0, t1);
}
/** Energy of a plain one-pole high-passed copy of a stretch: crude hiss meter. */
function hiss(a, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  let s = 0, prev = a[i0];
  for (let i = i0 + 1; i < i1; i++) { const d = a[i] - prev; prev = a[i]; s += d * d; }
  return Math.sqrt(s / (i1 - i0));
}

test("vox: the tables agree with the processor", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, lo, hi, def] of VOX_NUM_CTLS) {
    const d = Cls.parameterDescriptors.find(x => x.name === k);
    assert.ok(d, `${k} is not a processor parameter`);
    assert.deepEqual([d.minValue, d.maxValue, d.defaultValue], [lo, hi, def], `${k}: range or default differs`);
  }
  for (const k of ["vowel", "size", "breath", "rel"]) assert.ok(names.includes(k));
  // The four track sliders' defaults are the track's own (soundDefaults.js).
  assert.deepEqual([PARAM_DEFAULTS.vowel, PARAM_DEFAULTS.size, PARAM_DEFAULTS.breath, PARAM_DEFAULTS.rel], [0.5, 0.5, 0.5, 0.4]);
  for (const name of VOX_TONE_NAMES) {
    const t = voxTone(name);
    for (const k of Object.keys(VOX_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const [k, , values] of VOX_SEL_CTLS) assert.ok(values.includes(t[`sng${k}`]), `${name}: ${k} = ${t[`sng${k}`]}`);
    for (const [k, lo, hi] of VOX_NUM_CTLS) assert.ok(t[`sng${k}`] >= lo && t[`sng${k}`] <= hi, `${name}: ${k} out of range`);
  }
});

test("vox: every syllable of every phrase spells a known consonant and vowel", () => {
  for (const name of VOX_WORD_NAMES) {
    const syl = voxSyllables(VOX_WORDS[name]);
    if (name === "off") { assert.equal(syl.length, 0); continue; }
    assert.ok(syl.length > 0, name);
    for (const s of syl) {
      assert.ok(s.cons >= 0 && s.cons < VOX_CONSONANT_NAMES.length, `${name}: ${JSON.stringify(s)}`);
      assert.ok(s.vowel >= 0 && s.vowel <= 1);
    }
  }
  // sh is one consonant, not s then h; a bare vowel has none.
  assert.deepEqual(voxSyllables("shu a"), [
    { cons: VOX_CONSONANT_NAMES.indexOf("sh"), vowel: 0 },
    { cons: VOX_CONSONANT_NAMES.indexOf("none"), vowel: 0.5 },
  ]);
  assert.deepEqual(voxSyllableList("off"), []);
});

test("vox: a note is pitched at its note, at a sane level", () => {
  for (const midi of [43, 55, 60, 67, 79]) {
    const { L } = render({ notes: [[0.1, midi, 1.2]], params: { ...STEADY, vowel: 0.5 } });
    const f0 = hz(midi);
    // the fundamental is a harmonic peak: stronger than half a semitone off
    const on = tone(L, f0, 0.5, 1.2), off = tone(L, f0 * Math.pow(2, 0.5 / 12), 0.5, 1.2);
    assert.ok(on > off * 4, `midi ${midi}: fundamental ${db(on).toFixed(1)}dB vs off ${db(off).toFixed(1)}dB`);
    const lvl = db(rms(L, 0.5, 1.2));
    assert.ok(lvl > -26 && lvl < -6, `midi ${midi}: ${lvl.toFixed(1)}dBFS`);
  }
});

test("vox: the vowel moves the formants where the tables put them", () => {
  const f0 = hz(48);  // a low note, so the harmonics sample the envelope finely
  const at = (vowel) => render({ notes: [[0.05, 48, 1]], params: { ...STEADY, vowel, size: 2 / 3 } }).L;
  const u = at(0), a = at(0.5), i = at(1);
  // F1: highest on a, low on u and i
  const f1a = peakHarmonic(a, f0, 200, 1000, 0.4, 1);
  const f1i = peakHarmonic(i, f0, 150, 1000, 0.4, 1);
  const ta = voxFormantsAt(0.5, 2 / 3), ti = voxFormantsAt(1, 2 / 3);
  assert.ok(Math.abs(f1a - ta.f[0]) < 120, `a: F1 ${f1a} vs ${ta.f[0]}`);
  assert.ok(Math.abs(f1i - ti.f[0]) < 120, `i: F1 ${f1i} vs ${ti.f[0]}`);
  // F2: i is front (high), u is back (low)
  const f2i = peakHarmonic(i, f0, 1400, 2400, 0.4, 1);
  assert.ok(Math.abs(f2i - ti.f[1]) < 150, `i: F2 ${f2i} vs ${ti.f[1]}`);
  const hiBand = (x) => bandEnergy(x, f0, 1500, 2300, 0.4, 1) / bandEnergy(x, f0, 100, 1000, 0.4, 1);
  assert.ok(hiBand(i) > hiBand(u) * 10, `i vs u above 1.5k: ${db(hiBand(i)).toFixed(1)} vs ${db(hiBand(u)).toFixed(1)}dB`);
});

test("vox: brightness and size do what they say", () => {
  const f0 = hz(55);
  const br = (bright) => {
    const { L } = render({ notes: [[0.05, 55, 1]], params: { ...STEADY, sngbright: bright, bright } });
    return bandEnergy(L, f0, 2000, 5000, 0.4, 1) / bandEnergy(L, f0, 100, 1000, 0.4, 1);
  };
  assert.ok(br(1) > br(0) * 4, `bright ${db(br(1)).toFixed(1)} vs dark ${db(br(0)).toFixed(1)}dB`);
  // a bigger throat puts F1 of a lower
  const f1 = (size) => peakHarmonic(render({ notes: [[0.05, 48, 1]], params: { ...STEADY, vowel: 0.5, size } }).L, hz(48), 200, 1000, 0.4, 1);
  assert.ok(f1(0) > f1(1) + 100, `small ${f1(0)} vs big ${f1(1)}`);
});

test("vox: breath at the top whispers: no pitch left, still a vowel", () => {
  const f0 = hz(57);
  const voiced = render({ notes: [[0.05, 57, 1]], params: { ...STEADY, breath: 0 } }).L;
  const whisper = render({ notes: [[0.05, 57, 1]], params: { ...STEADY, breath: 1 } }).L;
  const pitchiness = (x) => tone(x, f0, 0.4, 1) / rms(x, 0.4, 1);
  assert.ok(pitchiness(voiced) > pitchiness(whisper) * 8, `voiced ${pitchiness(voiced).toFixed(2)} vs whisper ${pitchiness(whisper).toFixed(2)}`);
  assert.ok(db(rms(whisper, 0.4, 1)) > -45, `whisper is ${db(rms(whisper, 0.4, 1)).toFixed(1)}dB`);
});

test("vox: an s is a hiss before the step, and the vowel lands on the step", () => {
  const step = 0.5;
  const s = VOX_CONSONANT_NAMES.indexOf("s");
  const { L } = render({ secs: 1.2, set: { cons: s }, notes: [[step, 60, 0.5]], params: { ...STEADY, atk: 0 } });
  // hiss in the 100ms before the step, quiet before that
  const early = rms(L, 0.2, 0.35), before = rms(L, step - 0.09, step - 0.02);
  assert.ok(db(before) > db(early) + 30, `before the step ${db(before).toFixed(1)}dB vs well before ${db(early).toFixed(1)}dB`);
  assert.ok(hiss(L, step - 0.09, step - 0.02) / rms(L, step - 0.09, step - 0.02) > 0.8, "the s is high-frequency noise");
  // and the voice is there just after the step, not 100ms later: as much of
  // the sound is harmonics of the note as on a note with no consonant
  const plain = render({ secs: 1.2, notes: [[step, 60, 0.5]], params: { ...STEADY, atk: 0 } }).L;
  const f0 = hz(60);
  const voiced = (x) => harmonicShare(x, f0, step + 0.005, step + 0.045);
  assert.ok(voiced(L) > voiced(plain) * 0.75, `voicing after the step: ${voiced(L).toFixed(2)} vs ${voiced(plain).toFixed(2)}`);
  assert.ok(harmonicShare(L, f0, step - 0.09, step - 0.02) < voiced(plain) * 0.3, "no voicing under the s");
  // no consonant: nothing before the step at all
  assert.ok(db(rms(plain, step - 0.09, step - 0.01)) < -90);
});

test("vox: every consonant sounds, stays finite and under full scale", () => {
  for (let c = 0; c < VOX_CONSONANT_NAMES.length; c++) {
    const { L, R } = render({ secs: 0.8, set: { cons: c }, notes: [[0.2, 60, 0.4]], params: { bite: 1, atk: 0 } });
    let peak = 0;
    for (let i = 0; i < L.length; i++) {
      assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `${VOX_CONSONANT_NAMES[c]}: not finite`);
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    assert.ok(peak < 1, `${VOX_CONSONANT_NAMES[c]}: peak ${peak}`);
    assert.ok(db(rms(L, 0.3, 0.55)) > -35, `${VOX_CONSONANT_NAMES[c]}: the vowel after it is ${db(rms(L, 0.3, 0.55)).toFixed(1)}dB`);
  }
});

test("vox: words sing one syllable a note, and a stop starts them over", () => {
  // "shoo bee doo wah": sh is hiss, b and d are not. Measure the hiss in the
  // 80ms before each note.
  const syl = voxSyllableList("shoo bee");
  const notes = [0.3, 0.8, 1.3, 1.8, 2.3].map(t => [t, 60, 0.3]);
  const run = (events = []) => render({ secs: 2.7, set: { syl }, notes, events, params: { ...STEADY, atk: 0 } }).L;
  const L = run();
  const pre = notes.map(([t]) => hiss(L, t - 0.08, t - 0.01));
  // note 1 (sh) and note 5 (sh again, the phrase wrapped) hiss; 2, 3 and 4 don't.
  assert.ok(pre[0] > pre[1] * 5 && pre[0] > pre[2] * 5, `sh vs b/d: ${pre.map(x => db(x).toFixed(0))}`);
  assert.ok(pre[4] > pre[3] * 5, `the phrase wraps to sh: ${pre.map(x => db(x).toFixed(0))}`);
  // A chord on one step shares a syllable: two notes at once advance it once.
  const chord = render({ secs: 1.4, set: { syl }, notes: [[0.3, 60, 0.3], [0.3, 64, 0.3], [0.8, 60, 0.3]], params: { ...STEADY, atk: 0 } }).L;
  assert.ok(hiss(chord, 0.22, 0.29) > hiss(chord, 0.72, 0.79) * 5, "the chord sang sh together, then b");
});

test("vox: a stop restarts the words", () => {
  const syl = voxSyllableList("shoo bee");
  const inst = new Cls();
  globalThis.currentFrame = 0;
  inst.onMessage({ type: "set", syl });
  inst.onMessage({ type: "note", when: 0.1, id: 1, freq: 261, dur: 0.1, vel: 1, glide: 0 });
  inst.onMessage({ type: "note", when: 0.3, id: 2, freq: 261, dur: 0.1, vel: 1, glide: 0 });
  assert.equal(inst.sylIdx, 1);
  inst.onMessage({ type: "off", when: 0.5 });
  inst.onMessage({ type: "note", when: 0.6, id: 3, freq: 261, dur: 0.1, vel: 1, glide: 0 });
  assert.equal(inst.sylIdx, 0);
});

test("vox: the choir spreads across the stereo field, one voice doesn't", () => {
  const corr = (L, R) => {
    let lr = 0, ll = 0, rr = 0;
    for (let i = Math.round(0.4 * SR); i < SR; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
    return lr / Math.sqrt(ll * rr);
  };
  const solo = render({ notes: [[0.05, 60, 1]], params: { voices: 1 } });
  const choir = render({ notes: [[0.05, 60, 1]], params: { voices: 6, spread: 1, detune: 0.5 } });
  assert.ok(corr(solo.L, solo.R) > 0.999, `solo correlation ${corr(solo.L, solo.R)}`);
  assert.ok(corr(choir.L, choir.R) < 0.9, `choir correlation ${corr(choir.L, choir.R)}`);
  // and it is about as loud as one voice, not six times louder
  const d = db(rms(choir.L, 0.4, 1)) - db(rms(solo.L, 0.4, 1));
  assert.ok(Math.abs(d) < 6, `choir vs solo: ${d.toFixed(1)}dB`);
});

test("vox: mono slides from one note into the next", () => {
  const { L } = render({ secs: 1.6, set: { mono: 1, glide: 0.3 }, notes: [[0.1, 60, 0.6], [0.6, 67, 0.8]], params: { ...STEADY } });
  // 60ms after the second note it is between the two, not on either
  const mid = (t) => {
    let best = 0, bf = 0;
    for (let m = 59; m <= 68; m += 0.25) { const v = tone(L, hz(m), t, t + 0.06); if (v > best) { best = v; bf = m; } }
    return bf;
  };
  const during = mid(0.66);
  assert.ok(during > 60.5 && during < 66.5, `mid-slide at ${during}`);
  assert.ok(Math.abs(mid(1.2) - 67) < 0.3, `arrived at ${mid(1.2)}`);
});

test("vox: notes end, and nothing is left sounding", () => {
  const { L } = render({ secs: 3, notes: [[0.1, 60, 0.3]], params: { rel: 0.4 } });
  assert.ok(db(rms(L, 2.5, 3)) < -100, `${db(rms(L, 2.5, 3)).toFixed(1)}dB after release`);
});

test("vox: every preset sounds on a chord, finite and under full scale", () => {
  for (const name of VOX_TONE_NAMES) {
    const t = voxTone(name);
    const params = { vowel: t.harm, size: t.timb, breath: t.morph, rel: t.decay };
    for (const [k] of VOX_NUM_CTLS) params[k] = t[`sng${k}`];
    const set = { cons: VOX_CONSONANT_NAMES.indexOf(t.sngcons), syl: voxSyllableList(t.sngwords), mono: t.sngmode === "mono" };
    const { L, R } = render({ secs: 1.4, set, params, notes: [[0.2, 55, 1], [0.2, 59, 1], [0.2, 62, 1], [0.2, 67, 1]] });
    let peak = 0;
    for (let i = 0; i < L.length; i++) {
      assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `${name}: not finite`);
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    assert.ok(peak < 1, `${name}: peak ${peak}`);
    const lvl = db(rms(L, 0.8, 1.2));
    assert.ok(lvl > -32 && lvl < -3, `${name}: ${lvl.toFixed(1)}dBFS`);
  }
});

test("vox: the panel markup matches the tables", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const VOX_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of VOX_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-sng${k}" type="range" min="([\\d.]+)" max="([\\d.]+)" step="[\\d.]+" value="([\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of VOX_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-sng${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: options differ`);
    assert.ok(m[1].includes(`value="${def}" selected`), `${k}: default ${def} not selected`);
  }
});
