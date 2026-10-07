import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ORACLE_DEFAULTS, ORACLE_NUM_CTLS, ORACLE_SEL_CTLS, ORACLE_TONE_NAMES, oracleTone,
} from "../public/js/engineData.js";
import { oracleProcessorSource } from "../public/js/oracle.js";
import { migrateTrackNames } from "../public/js/sessionFormat.js";
import { defaultTrackParams } from "../public/js/soundDefaults.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, writeTracks } from "../public/js/strudel.js";

// The oracle, rendered outside a browser, as ladder.test.js renders the ladder.
//
// What is pinned is what oracle.js claims: both VCOs land on the note and the
// detune moves VCO 2 by what it says; the shape knob is a triangle, a saw and
// a pulse, band-limited (the pulse was the thresholded saw that aliased at
// -19dB); the oscillators are free-running, so a note is never the same
// twice and two VCOs at unison never sum to twice one; the slop puts each
// voice card a few cents off; the sub is an octave under, the noise is
// noise; the drive is a wire at zero, adds harmonics without changing the
// level, and puts even harmonics on a triangle; the envelope's four stages;
// a chord; the chorus is a knob; a stop lets go and a finished note is
// digital silence; the patches, the markup, the builder, Strudel and the
// migration of a song from before the model.

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
  return new Function(`${prelude}${oracleProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// One VCO, a saw, no slop, no drive, no chorus, no sub, no noise: the bare oscillator.
const CLEAN = { osc1: 0.5, osc2: 0, osc3: 0, osc4: 0, slop: 0, drive: 0, chorus: 0, shape1: 0.5, atk: 0, sus: 1 };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Render on a fresh processor. `events` are [seconds, message] pairs. */
function render({ secs = 1, set = {}, params = {}, notes = [[0.01, 57, 0.5, 1]], events = [] } = {}) {
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur, vel, glide] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: vel ?? 1, glide: glide ?? 0 });
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
  return { L, R, inst };
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
function rms(a, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / (i1 - i0));
}
function peak(a, t0 = 0, t1 = a.length / SR) {
  let p = 0;
  for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) p = Math.max(p, Math.abs(a[i]));
  return p;
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
/** The pitch over [t0, t1), from the rising zero crossings. */
function pitchOf(a, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  let first = -1, last = -1, n = 0;
  for (let i = i0 + 1; i < i1; i++) {
    if (a[i - 1] <= 0 && a[i] > 0) { if (first < 0) first = i; last = i; n++; }
  }
  return n > 1 ? (n - 1) * SR / (last - first) : 0;
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);
/** Hann-windowed magnitude spectrum of 2^k samples from t0, radix-2. */
function spectrum(a, t0, N) {
  const i0 = Math.round(t0 * SR);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = a[i0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const x = i + j, y = x + len / 2;
        const tr = re[y] * cr - im[y] * ci, ti = re[y] * ci + im[y] * cr;
        re[y] = re[x] - tr; im[y] = im[x] - ti; re[x] += tr; im[x] += ti;
        const n = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = n;
      }
    }
  }
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
/** The loudest bin under 20kHz off the harmonic series of f0, in dB under the
 *  loudest harmonic. Under 20kHz: the last 4kHz up to Nyquist is the 2x
 *  decimator's own rolloff letting a little of the image through, which is
 *  not aliasing and not audible. */
function aliasFloor(a, f0, t0 = 0.3, N = 32768) {
  const m = spectrum(a, t0, N), binHz = SR / N;
  const harm = new Set();
  let hs = 0;
  for (let k = 1; k * f0 < SR / 2; k++) {
    const b = Math.round(k * f0 / binHz);
    for (let d = -3; d <= 3; d++) harm.add(b + d);
    hs = Math.max(hs, m[b]);
  }
  let worst = 0;
  const top = Math.floor(20000 / binHz);
  for (let b = 20; b < top; b++) if (!harm.has(b) && m[b] > worst) worst = m[b];
  return db(worst / hs);
}
/** Energy above `split` Hz against energy below, in dB. */
function tilt(a, split, t0 = 0.3, N = 16384) {
  const m = spectrum(a, t0, N), binHz = SR / N;
  let lo = 0, hi = 0;
  for (let b = 2; b < N / 2; b++) (b * binHz > split ? (hi += m[b] * m[b]) : (lo += m[b] * m[b]));
  return db(Math.sqrt(hi) / Math.sqrt(lo));
}

test("oracle: the tables agree with the processor and the markup", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, , , def] of ORACLE_NUM_CTLS) {
    assert.ok(names.includes(k), `${k} is not a processor parameter`);
    assert.equal(PARAM_DEFAULTS[k], def, `${k}: the panel default and the processor default differ`);
  }
  const D = defaultTrackParams();
  assert.deepEqual([PARAM_DEFAULTS.detune, PARAM_DEFAULTS.shape2, PARAM_DEFAULTS.drive, PARAM_DEFAULTS.decay], [D.harm, D.timb, D.morph, D.decay]);
  assert.deepEqual([PARAM_DEFAULTS.osc1, PARAM_DEFAULTS.osc2, PARAM_DEFAULTS.osc3, PARAM_DEFAULTS.osc4], [D.osc1, D.osc2, D.osc3, D.osc4]);
  for (const k of Object.keys(ORACLE_DEFAULTS)) assert.equal(D[k], ORACLE_DEFAULTS[k], `${k}: the track default differs`);
  assert.equal(D.orcv, 2, "a new track carries the format marker");
  for (const name of ORACLE_TONE_NAMES) {
    const t = oracleTone(name);
    for (const k of Object.keys(ORACLE_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const k of ["harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
    for (const [k, lo, hi] of ORACLE_NUM_CTLS) assert.ok(t[`orc${k}`] >= lo && t[`orc${k}`] <= hi, `${name}: ${k}`);
  }
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const ORACLE_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of ORACLE_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-orc${k}" type="range" min="(-?[\\d.]+)" max="(-?[\\d.]+)" step="[\\d.]+" value="(-?[\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of ORACLE_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-orc${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: the options differ from the table`);
    assert.ok(opts.includes(def));
  }
  assert.ok(panel.includes('class="sq-oracle__tone"'), "the patch dropdown");
  assert.ok(src.includes("${ORACLE_PANEL}"), "the panel is in the track template");
});

test("oracle: both VCOs land on the note, and the detune moves VCO 2 by 30 cents", () => {
  for (const midi of [36, 48, 57, 69, 81]) {
    const { L } = render({ params: CLEAN, notes: [[0.01, midi, 0.8, 1]] });
    const c = cents(pitchOf(L, 0.2, 0.7), hz(midi));
    assert.ok(Math.abs(c) < 2, `VCO 1 at ${midi}: ${c.toFixed(1)} cents off`);
  }
  const vco2 = (detune) => {
    const { L } = render({ params: { ...CLEAN, osc1: 0, osc2: 0.5, shape2: 0.5, detune } });
    return cents(pitchOf(L, 0.2, 0.5), hz(57));
  };
  assert.ok(Math.abs(vco2(0.5)) < 2, `unison: ${vco2(0.5).toFixed(1)} cents`);
  assert.ok(Math.abs(vco2(1) - 30) < 3, `full up: ${vco2(1).toFixed(1)} cents`);
  assert.ok(Math.abs(vco2(0) + 30) < 3, `full down: ${vco2(0).toFixed(1)} cents`);
  // The sub is a square an octave under VCO 1.
  const { L: sub } = render({ params: { ...CLEAN, osc1: 0, osc3: 0.5 } });
  const cs = cents(pitchOf(sub, 0.2, 0.5), hz(45));
  assert.ok(Math.abs(cs) < 2, `sub: ${cs.toFixed(1)} cents off an octave under`);
  const f = hz(45);
  assert.ok(db(tone(sub, 2 * f, 0.2, 0.5) / tone(sub, f, 0.2, 0.5)) < -30, "a square has no 2nd harmonic");
  assert.ok(Math.abs(db(tone(sub, 3 * f, 0.2, 0.5) / tone(sub, f, 0.2, 0.5)) + 9.5) < 1.5, "and a 3rd a third as loud");
});

test("oracle: the shape knob is a triangle, a saw and a pulse, band-limited", () => {
  const f = hz(57);
  const h = (params) => {
    const { L } = render({ params: { ...CLEAN, ...params } });
    const h1 = tone(L, f, 0.2, 0.6);
    return [2, 3, 4].map(k => db(tone(L, k * f, 0.2, 0.6) / h1));
  };
  // VCO 1 through its own shape knob.
  const tri = h({ shape1: 0 });
  assert.ok(tri[0] < -35 && tri[2] < -35, `triangle has no even harmonics: ${tri.map(x => x.toFixed(1))}`);
  assert.ok(Math.abs(tri[1] + 19.1) < 1.5, `triangle's 3rd at -19dB: ${tri[1].toFixed(1)}`);
  const saw = h({ shape1: 0.5 });
  assert.ok(Math.abs(saw[0] + 6) < 1 && Math.abs(saw[1] + 9.5) < 1 && Math.abs(saw[2] + 12) < 1, `saw's 1/n series: ${saw.map(x => x.toFixed(1))}`);
  const sq = h({ shape1: 1, pw1: 0 });
  assert.ok(sq[0] < -35 && sq[2] < -35, `square has no even harmonics: ${sq.map(x => x.toFixed(1))}`);
  const narrow = h({ shape1: 1, pw1: 1 });
  assert.ok(narrow[0] > -3, `a narrow pulse has its 2nd harmonic: ${narrow[0].toFixed(1)}`);
  // VCO 2 through the shape slider, the same three.
  const tri2 = h({ osc1: 0, osc2: 0.5, shape2: 0 });
  assert.ok(tri2[0] < -35, "VCO 2 triangle");
  const sq2 = h({ osc1: 0, osc2: 0.5, shape2: 1, pw2: 0 });
  assert.ok(sq2[0] < -35, "VCO 2 square");
  // The halfway points are a mix, so the knob is continuous.
  const mid = h({ shape1: 0.75, pw1: 0 });
  assert.ok(mid[0] < saw[0] - 3 && mid[0] > -30, `saw-to-square mix: 2nd at ${mid[0].toFixed(1)}`);
  // Band-limited: the pulse at E5 used to alias at -19dB.
  for (const [label, params] of [["pulse", { shape1: 1, pw1: 0.3 }], ["saw", { shape1: 0.5 }], ["triangle", { shape1: 0 }]]) {
    const { L } = render({ secs: 1.2, params: { ...CLEAN, ...params }, notes: [[0.01, 76, 1.1, 1]] });
    const floor = aliasFloor(L, hz(76));
    assert.ok(floor < -40, `${label} at E5: worst alias ${floor.toFixed(1)}dB`);
  }
});

test("oracle: the oscillators are free-running and the voice cards are not copies", () => {
  // A note is never the same twice: the phases are not reset.
  const a = render({ params: CLEAN }).L, b = render({ params: CLEAN }).L;
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  assert.ok(!same, "two renders of one note came out sample-identical");
  // Two VCOs at unison sum like two oscillators, not like one louder one: the
  // phase-locked version measured 2.00x every time. Over many notes the sum
  // averages the uncorrelated 1.41x, and it is never pinned at 2.
  const one = rms(render({ params: CLEAN }).L, 0.2, 0.5);
  const ratios = [];
  for (let i = 0; i < 12; i++) ratios.push(rms(render({ params: { ...CLEAN, osc2: 0.5, shape2: 0.5 } }).L, 0.2, 0.5) / one);
  const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  assert.ok(mean > 1.1 && mean < 1.75, `sum/one averages ${mean.toFixed(2)} (phase-locked would be 2.00)`);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > 0.2, "the ratio moves note to note");
  // Slop: at zero every card is in tune; at full each VCO sits up to 12 cents
  // off (plus a 5 cent wander), by a calibration drawn once per card, and
  // the six cards are not the same.
  const { L: one1, inst } = render({ params: { ...CLEAN, slop: 1 }, notes: [[0.01, 57, 0.8, 1]] });
  const cal = inst.voices.map(v => v.cal[0]);
  assert.ok(cal.every(c => c >= -1 && c <= 1) && new Set(cal.map(c => c.toFixed(3))).size === 6, `six different calibrations: ${cal.map(c => c.toFixed(2))}`);
  const off = cents(pitchOf(one1, 0.3, 0.7), hz(57));
  assert.ok(Math.abs(off - cal[0] * 12) < 6 && Math.abs(off) < 18, `card 0 at full slop: ${off.toFixed(1)} cents, calibration ${(cal[0] * 12).toFixed(1)}`);
  const { L: none } = render({ params: { ...CLEAN, slop: 0 }, notes: [[0.01, 57, 0.8, 1]] });
  assert.ok(Math.abs(cents(pitchOf(none, 0.3, 0.7), hz(57))) < 1.5, "no slop is in tune");
});

test("oracle: the noise is noise, squared from the slider", () => {
  const { L } = render({ params: { ...CLEAN, osc1: 0, osc4: 1 } });
  assert.ok(rms(L, 0.2, 0.5) > 0.05, "noise at full is audible");
  assert.ok(tilt(L, 5000) > -6, "and broadband");
  const half = rms(render({ params: { ...CLEAN, osc1: 0, osc4: 0.5 } }).L, 0.2, 0.5);
  assert.ok(Math.abs(db(half / rms(L, 0.2, 0.5)) + 12) < 1.5, `half the slider is a quarter the level: ${db(half / rms(L, 0.2, 0.5)).toFixed(1)}dB`);
});

test("oracle: the drive is a wire at zero, adds harmonics without moving the level, and bites a chord", () => {
  // One note at the default mixer: the level holds across the whole knob.
  const lvl = (drive) => rms(render({ params: { slop: 0, chorus: 0, atk: 0, sus: 1, drive } }).L, 0.2, 0.5);
  const l0 = lvl(0), l5 = lvl(0.5), l1 = lvl(1);
  assert.ok(Math.abs(db(l5 / l0)) < 3 && Math.abs(db(l1 / l0)) < 3, `level: 0 ${db(l0).toFixed(1)} / 0.5 ${db(l5).toFixed(1)} / 1 ${db(l1).toFixed(1)}dBFS`);
  // A triangle has no even harmonics; the drive puts a 2nd on it, and the
  // top of the knob is far brighter than the bottom.
  const f = hz(57);
  const tri = (drive) => render({ params: { ...CLEAN, shape1: 0, osc1: 0.55, drive } }).L;
  const t0 = tri(0), t1 = tri(1);
  const h2 = (a) => db(tone(a, 2 * f, 0.2, 0.6) / tone(a, f, 0.2, 0.6));
  assert.ok(h2(t0) < -35, `clean triangle's 2nd: ${h2(t0).toFixed(1)}dB`);
  assert.ok(h2(t1) > -25, `driven triangle's 2nd: ${h2(t1).toFixed(1)}dB`);
  // Harmonics 2..8 against the fundamental: a triangle's slopes are gentle,
  // so through a gain of 25 it is a square with slewed edges, dirtier in the
  // low harmonics rather than hissing up top.
  const thd = (a) => { let e = 0; for (let k = 2; k <= 8; k++) e += tone(a, k * f, 0.2, 0.6) ** 2; return db(Math.sqrt(e) / tone(a, f, 0.2, 0.6)); };
  assert.ok(thd(t1) > thd(t0) + 5, `dirtier: ${thd(t0).toFixed(1)} -> ${thd(t1).toFixed(1)}dB`);
  // At zero the stage is a wire: a single note is below the knee, so its
  // harmonic series is exactly the oscillator's.
  const { L: clean } = render({ params: { ...CLEAN, osc1: 0.55 } });
  const h3 = db(tone(clean, 3 * f, 0.2, 0.6) / tone(clean, f, 0.2, 0.6));
  assert.ok(Math.abs(h3 + 9.5) < 1, `a saw's 3rd through the wire: ${h3.toFixed(1)}dB`);
  assert.ok(peak(clean, 0.2, 0.6) < 0.75, "under the knee");
  // Driven, the drive aliases under -50dB: it is oversampled.
  const { L: drv } = render({ secs: 1.2, params: { ...CLEAN, osc1: 0.55, drive: 1 }, notes: [[0.01, 76, 1.1, 1]] });
  assert.ok(aliasFloor(drv, hz(76)) < -45, `driven alias floor ${aliasFloor(drv, hz(76)).toFixed(1)}dB`);
  // The drive is on the SUM: a chord compresses where one note does not.
  const chord = (drive) => rms(render({ params: { slop: 0, chorus: 0, atk: 0, sus: 1, drive }, notes: [[0.01, 48, 0.5, 1], [0.01, 52, 0.5, 1], [0.01, 55, 0.5, 1], [0.01, 60, 0.5, 1]] }).L, 0.2, 0.5);
  const gainOne = db(l1 / l0), gainChord = db(chord(1) / chord(0));
  assert.ok(gainChord < gainOne - 3, `a chord through the drive gains ${gainChord.toFixed(1)}dB where a note gains ${gainOne.toFixed(1)}`);
  // Nothing ever passes full scale.
  for (const drive of [0, 0.5, 1]) {
    const { L } = render({ params: { slop: 0.5, chorus: 1, atk: 0, sus: 1, drive, osc1: 1, osc2: 1, osc3: 1, osc4: 1 }, notes: [[0.01, 36, 0.5, 1], [0.01, 43, 0.5, 1], [0.01, 48, 0.5, 1], [0.01, 52, 0.5, 1], [0.01, 55, 0.5, 1], [0.01, 60, 0.5, 1]] });
    assert.ok(peak(L) <= 1, `drive ${drive}: peak ${peak(L).toFixed(3)}`);
  }
});

test("oracle: attack, decay, sustain and release", () => {
  const env = (a, t) => rms(a, t, t + 0.01);
  // Attack: at the bottom a note is up within 3ms; halfway up the knob is 100ms.
  const fast = render({ params: { ...CLEAN, atk: 0 } }).L;
  assert.ok(env(fast, 0.015) > 0.8 * env(fast, 0.2), "a 1ms attack is up at once");
  const slow = render({ params: { ...CLEAN, atk: 0.5 } }).L;
  assert.ok(env(slow, 0.04) < 0.6 * env(slow, 0.3), "a 100ms attack is still rising at 30ms");
  assert.ok(env(slow, 0.2) > 0.9 * env(slow, 0.3), "and up by 200ms");
  // Decay to the sustain: the slider's 50ms at 0, 2s at 1. The peak is read
  // off a note with no decay to fall to, since a 50ms decay is under way
  // before the attack's first cycles are over.
  const full = render({ params: { ...CLEAN, decay: 0, sus: 1 } }).L;
  const sus = render({ params: { ...CLEAN, decay: 0, sus: 0.25 } }).L;
  const ratio = env(sus, 0.3) / env(full, 0.3);
  assert.ok(Math.abs(ratio - 0.25) < 0.05, `sustain a quarter of the peak: ${ratio.toFixed(2)}`);
  const long = render({ params: { ...CLEAN, decay: 1, sus: 0 } }).L;
  assert.ok(env(long, 0.4) > 0.3 * env(long, 0.012), "a 2s decay is still most of the way up at 400ms");
  // Release: the step ends at 0.5s. 10ms at the bottom of the knob, seconds further up.
  const short = render({ secs: 1, params: { ...CLEAN, rel: 0 }, notes: [[0.01, 57, 0.49, 1]] }).L;
  assert.ok(env(short, 0.55) < 0.01 * env(short, 0.3), "a 10ms release is gone 50ms later");
  const tail = render({ secs: 2.5, params: { ...CLEAN, rel: 0.68 }, notes: [[0.01, 57, 0.49, 1]] }).L;
  assert.ok(env(tail, 0.8) > 0.1 * env(tail, 0.3), "a 1s release still sounds 300ms later");
  assert.ok(env(tail, 2.4) < 0.01 * env(tail, 0.3), "and is gone by 2s");
});

test("oracle: a chord, voice stealing, a stop, and silence after", () => {
  const notes = [[0.01, 48, 0.6, 1], [0.01, 52, 0.6, 1], [0.01, 55, 0.6, 1]];
  const { L } = render({ params: CLEAN, notes });
  for (const m of [48, 52, 55]) {
    const lvl = db(tone(L, hz(m), 0.2, 0.5) / tone(L, hz(48), 0.2, 0.5));
    assert.ok(lvl > -6, `chord tone ${m}: ${lvl.toFixed(1)}dB`);
  }
  // Eight notes into six voices: bounded, and the last two still sound.
  const eight = Array.from({ length: 8 }, (_, i) => [0.01 + i * 0.02, 48 + i * 2, 0.6, 1]);
  const { L: stolen } = render({ params: CLEAN, notes: eight });
  assert.ok(peak(stolen) < 1 && Number.isFinite(rms(stolen, 0.2, 0.5)));
  assert.ok(db(tone(stolen, hz(62), 0.3, 0.6) / tone(stolen, hz(58), 0.3, 0.6)) > -6, "the last note arrived");
  // A stop lets everything go under the release, and then it is silence.
  const { L: stopped } = render({ secs: 1.5, params: { ...CLEAN, rel: 0.3 }, notes: [[0.01, 57, 5, 1], [0.01, 64, 5, 1]], events: [[0.5, { type: "off", when: 0.5 }]] });
  assert.ok(rms(stopped, 0.3, 0.45) > 0.05, "sounding before the stop");
  assert.ok(rms(stopped, 0.9, 1.0) < 1e-4, "gone after it");
  let zeros = true;
  for (let i = Math.round(1.3 * SR); i < stopped.length; i++) if (stopped[i] !== 0) { zeros = false; break; }
  assert.ok(zeros, "a finished voice is digital silence");
});

test("oracle: the chorus is a knob, stereo when on", () => {
  const { L, R } = render({ params: { ...CLEAN, chorus: 0 } });
  let same = true;
  for (let i = 0; i < L.length; i++) if (L[i] !== R[i]) { same = false; break; }
  assert.ok(same, "chorus off is mono");
  const on = render({ params: { ...CLEAN, chorus: 0.5 } });
  let diff = 0;
  for (let i = Math.round(0.2 * SR); i < Math.round(0.5 * SR); i++) diff += (on.L[i] - on.R[i]) ** 2;
  assert.ok(Math.sqrt(diff / (0.3 * SR)) > 0.01, "chorus on is stereo");
  assert.ok(Math.abs(db(rms(on.L, 0.2, 0.5) / rms(L, 0.2, 0.5))) < 3, "and about the same level");
  assert.ok(peak(on.L) < 1 && peak(on.R) < 1);
});

test("oracle: every patch plays at a sane level", () => {
  for (const name of ORACLE_TONE_NAMES) {
    const t = oracleTone(name);
    const params = { detune: t.harm, shape2: t.timb, drive: t.morph, decay: t.decay, osc1: t.osc1, osc2: t.osc2, osc3: t.osc3, osc4: t.osc4 };
    for (const [k] of ORACLE_NUM_CTLS) params[k] = t[`orc${k}`];
    const { L, R } = render({ secs: 1.2, params, notes: [[0.01, 48, 0.8, 1], [0.01, 55, 0.8, 1], [0.01, 60, 0.8, 1]] });
    assert.ok(peak(L) < 1 && peak(R) < 1, `${name}: over full scale`);
    assert.ok(Number.isFinite(rms(L, 0, 1.2)), `${name}: not finite`);
    const lvl = db(rms(L, 0.5, 0.8));
    assert.ok(lvl > -30 && lvl < -6, `${name}: ${lvl.toFixed(1)}dBFS`);
  }
});

test("oracle: the song builder, the MCP description and Strudel know it", () => {
  const song = B.newSong({ bpm: 120 });
  const { index: i } = B.addTrack(song, { engine: "oracle", name: "keys" });
  assert.equal(song.tracks[i].engineKey, "dm:oracle");
  assert.equal(song.tracks[i].params.orcv, 2, "the builder stamps the format marker");
  B.applyPreset(song, i, "strings");
  assert.equal(song.tracks[i].params.orcchorus, 0.6);
  assert.equal(song.tracks[i].params.osc3, 0);
  B.setParams(song, i, { orcslop: 0.6, orcshape1: 1, orcpw1: 0.3, osc4: 0.2 });
  assert.throws(() => B.setParams(song, i, { orcslop: 2 }), /orcslop/);
  assert.throws(() => B.setParams(song, i, { orcwidth: 0.5 }), /orcwidth/);
  const d = B.describeEngine("dm:oracle");
  assert.equal(d.sliders.harm.label, "detune");
  assert.equal(d.sliders.timb.label, "shape");
  assert.ok(d.presets.some(p => p.name === "poly brass"));
  assert.ok(d.panel.numeric.some(c => c.key === "orcslop"));
  B.addLfo(song, i, { target: "oracle_chorus", shape: "sine", amount: 0.2 });
  B.addLfo(song, i, { target: "timb", shape: "sine", amount: 0.2 });
  B.addLfo(song, i, { target: "morph", shape: "sine", amount: 0.2 });
  B.setAutomation(song, i, { target: "oracle.slop", values: [0, 0.5, 1, 0.5] });
  B.setAutomation(song, i, { target: "harm", values: [0, 0.5, 1, 0.5] });
  assert.throws(() => B.addLfo(song, i, { target: "ladder_drift", shape: "sine", amount: 0.2 }));

  // Strudel: by name in, by name out, and every control round-trips.
  const read = readCode(`keys: s("oracle*4").knob("orcslop", 0.4).knob("orcshape1", 1).knob("orcpw2", 0.25).knob("orcrel", 0.9).knob("osc3", 0.5)`);
  const out = B.newSong({ bpm: 120 });
  writeTracks(out, realize(read));
  const t = out.tracks.find(x => x.engineKey === "dm:oracle");
  assert.ok(t, "no oracle track from code");
  assert.equal(t.params.orcslop, 0.4);
  assert.equal(t.params.orcshape1, 1);
  assert.equal(t.params.orcv, 2);
  const code = sessionToCode(out, { native: true }).code;
  assert.match(code, /\.s\("oracle"\)/);
  assert.doesNotMatch(code, /orcv/, "the format marker is not a knob");
  const back = B.newSong({ bpm: 120 });
  writeTracks(back, realize(readCode(code)));
  const again = back.tracks.find(x => x.engineKey === "dm:oracle");
  assert.ok(again, "the written code lost the oracle");
  for (const k of ["orcslop", "orcshape1", "orcpw2", "orcrel", "osc3", "harm", "timb", "morph", "decay"]) {
    assert.equal(again.params[k], t.params[k], `${k} did not round-trip`);
  }
});

test("oracle: a song from before the model keeps what it played", () => {
  // timb was a saw-to-pulse crossfade and is now triangle / saw / pulse, so
  // the old knob is folded onto the top half; morph was a parallel blend that
  // did nothing audible at its default and is now a drive, so the default
  // maps to none; the release followed the decay slider; no slop.
  const old = { harm: 0.6, timb: 0, morph: 0.5, decay: 0.4, osc1: 0.55 };
  const td = migrateTrackNames({
    engineKey: "dm:prophet6",
    params: { ...old },
    baseSound: { params: { ...old, timb: 1, morph: 1 } },
    patterns: [{ sound: { params: { ...old, timb: 0.5, decay: 1 } } }],
  });
  assert.equal(td.engineKey, "dm:oracle");
  assert.equal(td.params.orcv, 2);
  assert.equal(td.params.harm, 0.6, "the detune keeps its meaning");
  assert.equal(td.params.timb, 0.5, "the old saw is the new saw");
  assert.equal(td.params.morph, 0, "the old default drive was none");
  assert.equal(td.params.decay, 0.4, "the decay keeps its meaning");
  assert.equal(td.params.orcslop, 0);
  assert.ok(Math.abs(td.params.orcrel - Math.log(1.1 / 0.01) / Math.log(1000)) < 1e-9, `the release the old decay implied: ${td.params.orcrel}`);
  assert.equal(td.baseSound.params.timb, 1, "the old pulse is the new pulse");
  assert.equal(td.baseSound.params.morph, 0.5, "full old drive is half the new knob");
  assert.equal(td.patterns[0].sound.params.timb, 0.75, "the old blend sits between");
  assert.ok(Math.abs(td.patterns[0].sound.params.orcrel - Math.log(2.6 / 0.01) / Math.log(1000)) < 1e-9);
  // A sound that carries the marker is left exactly alone, and the migration is idempotent.
  const now = migrateTrackNames({ engineKey: "dm:oracle", params: { timb: 0.3, morph: 0.6, orcv: 2 } });
  assert.deepEqual(now.params, { timb: 0.3, morph: 0.6, orcv: 2 });
  const twice = migrateTrackNames(JSON.parse(JSON.stringify(td)));
  assert.deepEqual(twice.params, td.params);
  // Only the oracle: the same keys on another engine mean nothing to it.
  const other = migrateTrackNames({ engineKey: "dm:drift", params: { timb: 0, morph: 0.5 } });
  assert.deepEqual(other.params, { timb: 0, morph: 0.5 });
  // A session the builder writes today loads as it was written.
  const song = B.newSong({ bpm: 120 });
  const { index: i } = B.addTrack(song, { engine: "oracle", name: "keys" });
  B.setParams(song, i, { timb: 0.2, morph: 0.9 });
  const loaded = migrateTrackNames(JSON.parse(JSON.stringify(song.tracks[i])));
  assert.equal(loaded.params.timb, 0.2);
  assert.equal(loaded.params.morph, 0.9);
});
