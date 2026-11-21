import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  BREATH_DEFAULTS, BREATH_KINDS, BREATH_KIND_TIPS, BREATH_MOD_KEYS, BREATH_NUM_CTLS, BREATH_SEL_CTLS,
  BREATH_TONE_NAMES, breathF1, breathF1Hz, breathF2, breathF2Hz, breathTone,
} from "../public/js/engineData.js";
import { breathProcessorSource } from "../public/js/breath.js";
import { canAutomateKey, canModulateKey } from "../public/js/constants.js";
import { defaultTrackParams } from "../public/js/soundDefaults.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, voiceFor, writeTracks } from "../public/js/strudel.js";

// The breath draws its players' phases, their tuning, the drift and the air
// from Math.random. Seeded, so a measurement is the same every run.
let seed = 0x5eed;
Math.random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

// The breath, rendered outside a browser, as oracle.test.js renders the oracle.
//
// What is pinned is what breath.js claims: the pitch is the note; nothing
// aliases; blowing harder is brighter, most of all on lips; a cylinder has no
// even harmonics low down; the body's formants stay put while the note moves;
// a jet is near a sine when soft and leans on its octave when overblown; the
// air is noise beside the note and can be turned off; the attack, the
// tongue, the swell and the release; vibrato after its delay; the scoop and
// the fall; a slur carries the breath across; a section is wide and no
// louder; growl, flutter and the mute; a chord, a stop and silence; every
// instrument; the tables, the markup, the builder and Strudel.

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
  return new Function(`${prelude}${breathProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// One steady player: no vibrato, no drift, no scoop, no air, no tongue, no
// body. What is left is the exciter's own spectrum on the note.
const BARE = { vib: 0, drift: 0, scoop: 0, air: 0, tongue: 0, res: 0, players: 1, swell: 0.5, growl: 0, flutter: 0 };
const KIND = Object.fromEntries(BREATH_KINDS.map((k, i) => [k, i]));

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Render on a fresh processor. Notes are [when, midi, dur, vel, legato]. */
function render({ secs = 1, set = {}, params = {}, notes = [[0.01, 60, 0.6, 1]], events = [] } = {}) {
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur, vel, legato] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: vel ?? 1, glide: 0, legato: !!legato });
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
/** The frequency near f where the spectrum peaks over [t0, t1), by search. */
function peakNear(a, f, t0, t1, cents = 60) {
  let best = f, bestM = 0;
  for (let c = -cents; c <= cents; c += 0.5) {
    const g = f * Math.pow(2, c / 1200), m = tone(a, g, t0, t1);
    if (m > bestM) { bestM = m; best = g; }
  }
  return best;
}
const centsOff = (f, ref) => 1200 * Math.log2(f / ref);
/** Harmonic n's level against the fundamental, in dB. */
const harm = (a, f, n, t0 = 0.3, t1 = 0.55) => db(tone(a, n * f, t0, t1) / tone(a, f, t0, t1));
/** The fundamental's own frequency over a short window, from rising zero
 *  crossings of the signal low-passed to it. */
function pitchOf(a, f, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  const k = Math.exp(-2 * Math.PI * f * 1.3 / SR);
  let y1 = 0, y2 = 0, prev = 0, first = -1, last = -1, n = 0;
  for (let i = Math.max(0, i0 - 2000); i < i1; i++) {
    y1 = a[i] * (1 - k) + y1 * k; y2 = y1 * (1 - k) + y2 * k;
    if (i > i0 && prev <= 0 && y2 > 0) {
      const x = i - 1 + (-prev) / (y2 - prev);
      if (first < 0) first = x; else { last = x; n++; }
    }
    prev = y2;
  }
  return n > 0 ? n * SR / (last - first) : 0;
}

test("breath: the tables agree with the processor and the markup", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, lo, hi, def] of BREATH_NUM_CTLS) {
    const d = Cls.parameterDescriptors.find(x => x.name === k);
    assert.ok(d, `${k} is not a processor parameter`);
    assert.deepEqual([d.minValue, d.maxValue, d.defaultValue], [lo, hi, def], `${k}: range or default differs`);
  }
  assert.equal(names.length, BREATH_NUM_CTLS.length + 4, "a processor parameter with no control");
  const D = defaultTrackParams();
  assert.deepEqual([PARAM_DEFAULTS.tone, PARAM_DEFAULTS.air, PARAM_DEFAULTS.vib, PARAM_DEFAULTS.rel], [D.harm, D.timb, D.morph, D.decay]);
  for (const k of Object.keys(BREATH_DEFAULTS)) assert.equal(D[k], BREATH_DEFAULTS[k], `${k}: the track default differs`);
  assert.deepEqual(Object.keys(BREATH_KIND_TIPS), BREATH_KINDS);
  for (const name of BREATH_TONE_NAMES) {
    const t = breathTone(name);
    for (const k of Object.keys(BREATH_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const k of ["harm", "timb", "morph", "decay"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
    for (const [k, lo, hi] of BREATH_NUM_CTLS) assert.ok(t[`brt${k}`] >= lo && t[`brt${k}`] <= hi, `${name}: ${k}`);
    assert.ok(BREATH_KINDS.includes(t.brtkind), `${name}: kind`);
    assert.equal(t.brtmode, "poly");
  }
  // the formant knobs and their Hz are each other's inverse
  assert.ok(Math.abs(breathF1Hz(breathF1(650)) - 650) < 2);
  assert.ok(Math.abs(breathF2Hz(breathF2(2700)) - 2700) < 6);
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const BREATH_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of BREATH_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-brt${k}" type="range" min="(-?[\\d.]+)" max="(-?[\\d.]+)" step="[\\d.]+" value="(-?[\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of BREATH_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-brt${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: the options differ from the table`);
    assert.ok(opts.includes(def));
  }
  assert.ok(panel.includes('class="sq-breath__tone"'), "the instrument dropdown");
  assert.ok(src.includes("${BREATH_PANEL}"), "the panel is in the track template");
  const assets = fs.readFileSync(new URL("../app/engineAssets.ts", import.meta.url), "utf8");
  assert.ok(assets.includes('"breath.js"'), "breath.js is not preloaded");
});

test("breath: the pitch is the note, to the cent, on every exciter", () => {
  for (const kind of BREATH_KINDS) {
    for (const midi of [31, 43, 57, 69, 81, 93]) {
      const { L } = render({ secs: 0.9, set: { kind: KIND[kind] }, params: BARE, notes: [[0.01, midi, 0.85, 0.9]] });
      const f = hz(midi);
      const got = peakNear(L, f, 0.3, 0.8, 20);
      assert.ok(Math.abs(centsOff(got, f)) <= 1, `${kind} ${midi}: ${centsOff(got, f).toFixed(2)} cents`);
    }
  }
});

test("breath: nothing aliases, however high the note", () => {
  // C7 and up at full blow: the harmonics stop short of half the sample
  // rate, and nothing lands between them.
  for (const midi of [96, 103, 108]) {
    const f = hz(midi);
    const { L } = render({ secs: 0.6, set: { kind: KIND.lips }, params: { ...BARE, tone: 1, dyn: 1, edge: 1 }, notes: [[0.01, midi, 0.55, 1]] });
    const ref = tone(L, f, 0.2, 0.5);
    for (const r of [0.5, 1.5, 2.5, 3.37, 4.5]) {
      if (r * f > SR / 2 - 200) continue;
      assert.ok(db(tone(L, r * f, 0.2, 0.5) / ref) < -80, `${midi}: something at ${r}x the note`);
    }
    for (const x of L) assert.ok(Number.isFinite(x));
  }
});

test("breath: blowing harder is brighter, and furthest on lips", () => {
  const f = hz(57);
  const bright = (kind, vel) => {
    const { L } = render({ secs: 0.7, set: { kind: KIND[kind] }, params: { ...BARE, dyn: 1 }, notes: [[0.01, 57, 0.65, vel]] });
    // the harmonics from 1.5kHz up against the fundamental
    let hi = 0;
    for (let n = 7; n <= 30; n++) hi += tone(L, n * f, 0.3, 0.6) ** 2;
    return db(Math.sqrt(hi) / tone(L, f, 0.3, 0.6));
  };
  const span = {};
  for (const kind of BREATH_KINDS) {
    const soft = bright(kind, 0.2), hard = bright(kind, 1);
    span[kind] = hard - soft;
    assert.ok(span[kind] > 10, `${kind}: ${span[kind].toFixed(1)}dB between a soft note and a hard one`);
  }
  assert.ok(span.lips > span.reed + 3, `lips ${span.lips.toFixed(1)} against reed ${span.reed.toFixed(1)}`);
  // and with dyn at zero velocity is only a level
  const flat = (vel) => {
    const { L } = render({ secs: 0.7, set: { kind: KIND.lips }, params: { ...BARE, dyn: 0 }, notes: [[0.01, 57, 0.65, vel]] });
    return [harm(L, f, 6), db(rms(L, 0.3, 0.6))];
  };
  const [hs, ls] = flat(0.2), [hh, lh] = flat(1);
  assert.ok(Math.abs(hh - hs) < 0.5, `dyn 0: the spectrum moved ${(hh - hs).toFixed(2)}dB`);
  assert.ok(lh - ls > 6, "velocity is still a level");
});

test("breath: the tone slider is the break, and the edge the weight above the fundamental", () => {
  const f = hz(57);
  const at = (params) => harm(render({ secs: 0.7, params: { ...BARE, ...params } }).L.subarray(0), hz(60), 8);
  assert.ok(at({ tone: 0.8 }) - at({ tone: 0.2 }) > 20, "the tone slider did not open the top");
  const h2 = (edge) => harm(render({ secs: 0.7, params: { ...BARE, tone: 1, edge }, notes: [[0.01, 57, 0.65, 1]] }).L, f, 2);
  assert.ok(h2(0.9) - h2(0.1) > 6, "the edge did not lift the second harmonic");
});

test("breath: a cylinder has no even harmonics low down, a cone has them all", () => {
  const f = hz(50);                                   // D3, 147Hz: harmonics 2..10 are under 1.5kHz
  const of = (bore) => render({ secs: 0.7, params: { ...BARE, bore, tone: 0.7 }, notes: [[0.01, 50, 0.65, 1]] }).L;
  const cyl = of(0), cone = of(1);
  for (const n of [2, 4, 6]) {
    const odd = (tone(cyl, (n - 1) * f, 0.3, 0.6) + tone(cyl, (n + 1) * f, 0.3, 0.6)) / 2;
    assert.ok(db(tone(cyl, n * f, 0.3, 0.6) / odd) < -14, `cylinder: harmonic ${n} is there`);
    const oddC = (tone(cone, (n - 1) * f, 0.3, 0.6) + tone(cone, (n + 1) * f, 0.3, 0.6)) / 2;
    assert.ok(db(tone(cone, n * f, 0.3, 0.6) / oddC) > -8, `cone: harmonic ${n} is missing`);
  }
  // above the cutoff a cylinder's even harmonics come back
  const n = 20;                                       // 2.9kHz
  const odd = (tone(cyl, (n - 1) * f, 0.3, 0.6) + tone(cyl, (n + 1) * f, 0.3, 0.6)) / 2;
  assert.ok(db(tone(cyl, n * f, 0.3, 0.6) / odd) > -8, "cylinder: no even harmonics up high either");
});

test("breath: the formants stay where they are while the note moves", () => {
  // A peak at 1.2kHz, deep. Whatever the note, the harmonic nearest it is
  // lifted against the same note with no body.
  const params = { ...BARE, tone: 0.9, f1: breathF1(1200), f2: breathF2(5000), res: 1 };
  for (const midi of [45, 52, 57, 64]) {
    const f = hz(midi), n = Math.round(1200 / f);
    const withBody = render({ secs: 0.7, params, notes: [[0.01, midi, 0.65, 1]] }).L;
    const without = render({ secs: 0.7, params: { ...params, res: 0 }, notes: [[0.01, midi, 0.65, 1]] }).L;
    const lift = harm(withBody, f, n) - harm(without, f, n);
    assert.ok(lift > 9, `${midi}: harmonic ${n} lifted ${lift.toFixed(1)}dB`);
    // and one two octaves under the peak is not
    const low = Math.max(2, Math.round(300 / f));
    assert.ok(harm(withBody, f, low) - harm(without, f, low) < lift - 6, `${midi}: the peak is not a peak`);
  }
  // moving the knob moves the peak
  const f = hz(45);
  // (read as the lift over the same note with no body, since each harmonic
  // of a note also sits a few dB off the curve by itself)
  const flat = render({ secs: 0.7, params: { ...params, res: 0 }, notes: [[0.01, 45, 0.65, 1]] }).L;
  const loudest = (f1) => {
    const a = render({ secs: 0.7, params: { ...params, f1: breathF1(f1) }, notes: [[0.01, 45, 0.65, 1]] }).L;
    let best = -Infinity, bestN = 0;
    for (let n = 2; n <= 30; n++) { const m = harm(a, f, n) - harm(flat, f, n); if (m > best) { best = m; bestN = n; } }
    return bestN * f;
  };
  assert.ok(Math.abs(loudest(600) - 600) < 130, `a 600Hz formant peaked at ${loudest(600).toFixed(0)}Hz`);
  assert.ok(Math.abs(loudest(1500) - 1500) < 250, `a 1.5kHz formant peaked at ${loudest(1500).toFixed(0)}Hz`);
});

test("breath: a jet is near a sine when soft, and leans on its octave when overblown", () => {
  const f = hz(72);
  const of = (vel, extra = {}) => render({ secs: 0.7, set: { kind: KIND.jet }, params: { ...BARE, ...extra }, notes: [[0.01, 72, 0.65, vel]] }).L;
  const soft = of(0.15);
  assert.ok(harm(soft, f, 2) < -18, `soft: the second harmonic is ${harm(soft, f, 2).toFixed(1)}dB`);
  assert.ok(harm(soft, f, 3) < -35);
  // blown past full (the tongue's overshoot held by a swell), the weight moves up
  const hard = of(1, { swell: 1, tone: 0.7 });
  const early = harm(hard, f, 2, 0.1, 0.2), late = harm(hard, f, 2, 0.5, 0.64);
  assert.ok(late > early + 3, `overblown: the octave went from ${early.toFixed(1)} to ${late.toFixed(1)}dB`);
  // the chiff: the upper modes speak first
  const chiff = of(0.8, { tongue: 1, atk: 0.3 });
  const quiet = of(0.8, { tongue: 0, atk: 0.3 });
  const at = (a) => db(tone(a, 2 * f, 0.012, 0.045) / tone(a, f, 0.012, 0.045));
  assert.ok(at(chiff) > at(quiet) + 4, "no chiff on the octave");
});

test("breath: the air is noise beside the note, and it can be turned off", () => {
  const f = hz(60);
  // between the harmonics, around 1.2kHz
  const between = (a) => {
    let s = 0, c = 0;
    for (let n = 3.25; n < 9; n += 0.25) { if (n % 1 === 0) continue; s += tone(a, n * f, 0.3, 0.6) ** 2; c++; }
    return db(Math.sqrt(s / c) / tone(a, f, 0.3, 0.6));
  };
  for (const kind of BREATH_KINDS) {
    const none = render({ secs: 0.7, set: { kind: KIND[kind] }, params: { ...BARE, air: 0 } }).L;
    const some = render({ secs: 0.7, set: { kind: KIND[kind] }, params: { ...BARE, air: 0.5 } }).L;
    const lots = render({ secs: 0.7, set: { kind: KIND[kind] }, params: { ...BARE, air: 1 } }).L;
    assert.ok(between(none) < -90, `${kind}: air at zero left ${between(none).toFixed(0)}dB`);
    assert.ok(between(some) > -70 && between(some) < -25, `${kind}: half air is ${between(some).toFixed(0)}dB`);
    assert.ok(between(lots) > between(some) + 8, `${kind}: more air is not more air`);
    // the note is still the loud part
    assert.ok(db(rms(lots, 0.3, 0.6)) - db(rms(none, 0.3, 0.6)) < 4, `${kind}: the air is louder than the note`);
  }
  // a soft note is the breathier one
  const soft = render({ secs: 0.7, params: { ...BARE, air: 0.6 }, notes: [[0.01, 60, 0.65, 0.2]] }).L;
  const hard = render({ secs: 0.7, params: { ...BARE, air: 0.6 }, notes: [[0.01, 60, 0.65, 1]] }).L;
  assert.ok(between(soft) > between(hard) + 1.5, `a soft note is not breathier (${(between(soft) - between(hard)).toFixed(1)}dB)`);
  // a jet's air rings at the note: more of it near the fundamental than far away
  const jet = render({ secs: 1.2, set: { kind: KIND.jet }, params: { ...BARE, air: 1 }, notes: [[0.01, 60, 1.15, 0.5]] }).L;
  const near = (tone(jet, f * 1.03, 0.3, 1.1) + tone(jet, f * 0.97, 0.3, 1.1)) / 2;
  const far = (tone(jet, f * 1.45, 0.3, 1.1) + tone(jet, f * 1.55, 0.3, 1.1)) / 2;
  assert.ok(db(near / far) > 6, `the tube does not ring in the air (${db(near / far).toFixed(1)}dB)`);
});

test("breath: the attack, the tongue, the swell and the release", () => {
  const lvl = (a, t) => rms(a, t, t + 0.01);
  // attack: the knob is a time
  const fast = render({ secs: 0.6, params: { ...BARE, atk: 0 } }).L;
  const slow = render({ secs: 0.6, params: { ...BARE, atk: 0.8 } }).L;
  const full = lvl(fast, 0.4);
  assert.ok(lvl(fast, 0.02) > 0.5 * full, "a fast attack is not there in 10ms");
  assert.ok(lvl(slow, 0.02) < 0.15 * lvl(slow, 0.4), "a slow attack is there in 10ms");
  assert.ok(lvl(slow, 0.3) > 0.7 * lvl(slow, 0.5), "a slow attack never arrives");
  // tongue: the pressure overshoots, then settles
  const ta = render({ secs: 0.6, params: { ...BARE, tongue: 1, atk: 0.1 } }).L;
  const ha = render({ secs: 0.6, params: { ...BARE, tongue: 0, atk: 0.1 } }).L;
  assert.ok(db(peak(ta, 0.01, 0.06) / peak(ta, 0.35, 0.5)) > 1.5, "tongued: no overshoot");
  assert.ok(db(peak(ha, 0.01, 0.06) / peak(ha, 0.35, 0.5)) < 0.5, "untongued: an overshoot");
  // swell: a held note falls away, holds, or grows
  const held = (swell) => { const a = render({ secs: 2.2, params: { ...BARE, swell }, notes: [[0.01, 60, 2.1, 0.8]] }).L; return db(rms(a, 1.8, 2.0) / rms(a, 0.1, 0.2)); };
  assert.ok(held(0) < -5, `swell 0 fell ${held(0).toFixed(1)}dB`);
  assert.ok(Math.abs(held(0.5)) < 0.7, `swell 0.5 moved ${held(0.5).toFixed(1)}dB`);
  assert.ok(held(1) > 2, `swell 1 grew ${held(1).toFixed(1)}dB`);
  // release: the decay slider is a time, and what follows is digital silence
  const short = render({ secs: 1.2, params: { ...BARE, rel: 0 }, notes: [[0.01, 60, 0.3, 1]] }).L;
  const long = render({ secs: 3, params: { ...BARE, rel: 1 }, notes: [[0.01, 60, 0.3, 1]] }).L;
  assert.ok(db(rms(short, 0.34, 0.36) / rms(short, 0.2, 0.3)) < -30, "the shortest release is still there after 30ms");
  assert.ok(db(rms(long, 0.6, 0.65) / rms(long, 0.2, 0.3)) > -20, "the longest release is gone in 300ms");
  assert.equal(peak(short, 0.8, 1.2), 0, "a finished note is not digital silence");
  assert.equal(peak(long, 2.6, 3), 0, "a long release never ends");
});

test("breath: vibrato comes in after its delay, in pitch for a reed and in breath for a jet", () => {
  const f = hz(69);
  const wobble = (a, t0, t1) => {
    let lo = Infinity, hi = -Infinity;
    for (let t = t0; t + 0.03 <= t1; t += 0.01) { const p = pitchOf(a, f, t, t + 0.03); lo = Math.min(lo, p); hi = Math.max(hi, p); }
    return centsOff(hi, lo);
  };
  const params = { ...BARE, vib: 1, vdelay: 0.5, vrate: 0.5 };
  const reed = render({ secs: 2.2, params, notes: [[0.01, 69, 2.1, 0.8]] }).L;
  assert.ok(wobble(reed, 0.15, 0.55) < 6, `vibrato before its delay: ${wobble(reed, 0.15, 0.55).toFixed(1)} cents`);
  const w = wobble(reed, 1.4, 2.0);
  assert.ok(w > 70 && w < 130, `a reed's full vibrato is ${w.toFixed(0)} cents across`);
  const none = render({ secs: 2.2, params: { ...params, vib: 0 }, notes: [[0.01, 69, 2.1, 0.8]] }).L;
  assert.ok(wobble(none, 1.4, 2.0) < 2, "vibrato at zero is not none");
  // a flute's is narrower in pitch and wider in level
  const jet = render({ secs: 2.2, set: { kind: KIND.jet }, params, notes: [[0.01, 69, 2.1, 0.6]] }).L;
  assert.ok(wobble(jet, 1.4, 2.0) < w * 0.6, "a jet's vibrato is as wide in pitch as a reed's");
  const swing = (a) => { let lo = Infinity, hi = 0; for (let t = 1.4; t < 2.0; t += 0.01) { const r = rms(a, t, t + 0.02); lo = Math.min(lo, r); hi = Math.max(hi, r); } return db(hi / lo); };
  assert.ok(swing(jet) > swing(reed) + 2, `a jet's vibrato is not in the breath (${swing(jet).toFixed(1)} against ${swing(reed).toFixed(1)}dB)`);
});

test("breath: a scoop up into the note, and a fall off the end of it", () => {
  const f = hz(64);
  const scooped = render({ secs: 0.8, params: { ...BARE, scoop: 1, atk: 0 }, notes: [[0.01, 64, 0.7, 1]] }).L;
  const early = centsOff(pitchOf(scooped, f * 0.9, 0.012, 0.045), f);
  assert.ok(early < -80, `the scoop starts ${early.toFixed(0)} cents under`);
  assert.ok(Math.abs(centsOff(peakNear(scooped, f, 0.5, 0.7, 20), f)) <= 1.5, "the scoop never arrives");
  const plain = render({ secs: 0.8, params: { ...BARE, scoop: 0, atk: 0 }, notes: [[0.01, 64, 0.7, 1]] }).L;
  assert.ok(Math.abs(centsOff(pitchOf(plain, f, 0.012, 0.045), f)) < 8, "no scoop, and the note starts off pitch");
  // the fall: the pitch drops as the note is let go, and the release is long enough to hear it
  const fall = render({ secs: 1.2, params: { ...BARE, fall: 1, rel: 0.4 }, notes: [[0.01, 64, 0.4, 1]] }).L;
  const during = centsOff(pitchOf(fall, f * 0.8, 0.5, 0.56), f);
  assert.ok(during < -250, `the fall is ${during.toFixed(0)} cents down 100ms after the note ends`);
  assert.ok(db(rms(fall, 0.5, 0.56) / rms(fall, 0.25, 0.35)) > -30, "the fall is not audible");
  const noFall = render({ secs: 1.2, params: { ...BARE, fall: 0, rel: 0.4 }, notes: [[0.01, 64, 0.4, 1]] }).L;
  assert.ok(Math.abs(centsOff(pitchOf(noFall, f, 0.41, 0.45), f)) < 6, "no fall, and the pitch moved");
});

test("breath: a slur carries the breath across, a tongued note starts again", () => {
  const params = { ...BARE, tongue: 0.8, atk: 0.3, rel: 0.1 };
  const dip = (a) => { let lo = Infinity; for (let t = 0.36; t < 0.46; t += 0.002) lo = Math.min(lo, rms(a, t, t + 0.006)); return db(lo / rms(a, 0.25, 0.35)); };
  const slurred = render({ secs: 0.9, params, notes: [[0.01, 60, 0.39, 0.9], [0.4, 64, 0.4, 0.9, true]] });
  const tongued = render({ secs: 0.9, params, notes: [[0.01, 60, 0.39, 0.9], [0.4, 64, 0.4, 0.9, false]] });
  assert.ok(dip(slurred.L) > -2.5, `a slur dipped ${dip(slurred.L).toFixed(1)}dB`);
  // one voice carried on, and it landed on the new note
  assert.equal(slurred.inst.voices.filter(v => v.claimed >= 0).length, 1, "a slur took a second voice");
  assert.equal(tongued.inst.voices.filter(v => v.claimed >= 0).length, 2, "a tongued note reused the voice");
  assert.ok(Math.abs(centsOff(peakNear(slurred.L, hz(64), 0.55, 0.78, 20), hz(64))) <= 1, "the slur did not arrive");
  // a tied chord slurs note for note
  const chord = render({ secs: 0.9, params, notes: [[0.01, 60, 0.39, 0.9], [0.01, 64, 0.39, 0.9], [0.4, 62, 0.4, 0.9, true], [0.4, 65, 0.4, 0.9, true]] });
  assert.equal(chord.inst.voices.filter(v => v.claimed >= 0).length, 2, "a tied chord did not slur voice for voice");
  // mono: one voice whatever is played, the last note wins
  const mono = render({ secs: 0.9, set: { mono: true }, params, notes: [[0.01, 60, 0.6, 0.9], [0.2, 67, 0.5, 0.9]] });
  assert.equal(mono.inst.voices.filter(v => v.claimed >= 0).length, 1, "mono used two voices");
  assert.ok(Math.abs(centsOff(peakNear(mono.L, hz(67), 0.4, 0.65, 20), hz(67))) <= 1, "mono: the last note did not win");
  assert.ok(db(tone(mono.L, hz(60), 0.45, 0.65) / tone(mono.L, hz(67), 0.45, 0.65)) < -40, "mono: the first note is still sounding");
});

test("breath: a section is wide, a few cents apart, and no louder", () => {
  const params = { ...BARE, drift: 0.3 };
  const one = render({ secs: 1.2, params: { ...params, players: 1 }, notes: [[0.01, 60, 1.1, 0.9]] });
  const four = render({ secs: 1.2, params: { ...params, players: 4, detune: 0.6, spread: 1 }, notes: [[0.01, 60, 1.1, 0.9]] });
  const mid = render({ secs: 1.2, params: { ...params, players: 4, detune: 0.6, spread: 0 }, notes: [[0.01, 60, 1.1, 0.9]] });
  const diff = (r) => { let s = 0; for (let i = 0; i < r.L.length; i++) s += (r.L[i] - r.R[i]) ** 2; return Math.sqrt(s / r.L.length); };
  assert.equal(diff(one), 0, "one player is not in the middle");
  assert.ok(diff(mid) < 1e-6, "no spread, and the section is not in the middle");
  assert.ok(diff(four) > 0.3 * rms(four.L, 0.3, 1), "a spread section is mono");
  const d = db(rms(four.L, 0.3, 1.1) / rms(one.L, 0.3, 1.1));
  assert.ok(Math.abs(d) < 3, `four players are ${d.toFixed(1)}dB against one`);
  // the players are not copies: a few cents apart, they beat
  const beat = (r) => { let lo = Infinity, hi = 0; for (let t = 0.3; t < 1.05; t += 0.025) { const x = tone(r.L, hz(60), t, t + 0.05); lo = Math.min(lo, x); hi = Math.max(hi, x); } return db(hi / lo); };
  assert.ok(beat(one) < 1, `one player beats ${beat(one).toFixed(2)}dB`);
  assert.ok(beat(mid) > 2, `four players in perfect tune (${beat(mid).toFixed(2)}dB)`);
});

test("breath: growl, flutter and the mute", () => {
  const env = (a, f0) => {
    // the level, 2ms at a time, and how much of it moves at f0
    const hop = Math.round(0.002 * SR), n = Math.floor((0.9 - 0.3) * SR / hop);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) e[i] = rms(a, 0.3 + i * hop / SR, 0.3 + (i + 1) * hop / SR);
    let mean = 0; for (const x of e) mean += x; mean /= n;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const ph = 2 * Math.PI * f0 * i * hop / SR; re += (e[i] - mean) * Math.cos(ph); im += (e[i] - mean) * Math.sin(ph); }
    return 2 * Math.hypot(re, im) / n / mean;
  };
  const note = [[0.01, 72, 0.95, 0.9]];
  const plain = render({ secs: 1, params: BARE, notes: note }).L;
  const flut = render({ secs: 1, params: { ...BARE, flutter: 1 }, notes: note }).L;
  assert.ok(env(flut, 24) > 0.25, `flutter moves the level ${env(flut, 24).toFixed(2)} at 24Hz`);
  assert.ok(env(plain, 24) < 0.02, "a plain note flutters");
  const growl = render({ secs: 1, params: { ...BARE, growl: 1 }, notes: note }).L;
  let g = 0; for (let f0 = 60; f0 <= 100; f0 += 4) g = Math.max(g, env(growl, f0));
  assert.ok(g > 0.1, `growl moves the level ${g.toFixed(2)} near 80Hz`);
  // the mute: the lows go, and the level with them
  const f = hz(55);
  const open = render({ secs: 0.7, set: { kind: KIND.lips }, params: { ...BARE, tone: 0.7 }, notes: [[0.01, 55, 0.65, 1]] }).L;
  const muted = render({ secs: 0.7, set: { kind: KIND.lips }, params: { ...BARE, tone: 0.7, mute: 1 }, notes: [[0.01, 55, 0.65, 1]] }).L;
  const balance = (a) => db(tone(a, 9 * f, 0.3, 0.6) / tone(a, f, 0.3, 0.6));
  assert.ok(balance(muted) - balance(open) > 15, `the mute moved the balance ${(balance(muted) - balance(open)).toFixed(1)}dB`);
  assert.ok(db(rms(muted, 0.3, 0.6) / rms(open, 0.3, 0.6)) < -3, "a muted horn is as loud as an open one");
});

test("breath: a chord, more notes than voices, a stop, and silence after", () => {
  const notes = [48, 52, 55, 59, 62, 65, 69, 72].map((m, i) => [0.01 + i * 0.02, m, 0.8, 1]);
  const { L, R, inst } = render({ secs: 1.6, params: { players: 4 }, notes, events: [[0.6, { type: "off", when: 0.6 }]] });
  for (let i = 0; i < L.length; i++) assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]));
  assert.ok(peak(L) <= 1 && peak(R) <= 1, "over full scale");
  assert.ok(rms(L, 0.3, 0.55) > 0.1, "the chord is not there");
  assert.equal(peak(L, 1.3, 1.6), 0, "a stop did not let go");
  assert.ok(inst.voices.every(v => v.stage === 0));
  // a note queued past the stop does not start
  const late = render({ secs: 1, notes: [[0.5, 60, 0.3, 1]], events: [[0.1, { type: "off", when: 0.1 }]] });
  assert.equal(peak(late.L), 0, "a note started after the stop that came before it");
});

test("breath: every instrument plays, in tune, at a sane level, and ends", () => {
  const low = /tuba|bari|low brass|bassoon|bass clar/;
  for (const name of BREATH_TONE_NAMES) {
    const t = breathTone(name);
    const params = { tone: t.harm, air: t.timb, vib: t.morph, rel: t.decay };
    for (const k of BREATH_MOD_KEYS) params[k] = t[`brt${k}`];
    const midi = low.test(name) ? 43 : name === "piccolo" ? 84 : 62;
    const { L, R } = render({ secs: 3.2, set: { kind: KIND[t.brtkind] }, params, notes: [[0.01, midi, 1, 0.8]] });
    for (let i = 0; i < L.length; i += 7) assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), name);
    const lvl = db(Math.hypot(rms(L, 0.4, 0.9), rms(R, 0.4, 0.9)) / Math.SQRT2);
    assert.ok(lvl > -24 && lvl < -10, `${name}: ${lvl.toFixed(1)}dBFS`);
    assert.ok(peak(L) < 0.95 && peak(R) < 0.95, `${name}: peaks at ${peak(L).toFixed(2)}`);
    assert.equal(peak(L, 2.8, 3.2), 0, `${name}: still sounding two seconds after the note`);
    // the fundamental's region holds the note (a section is spread round it)
    const f = hz(midi);
    assert.ok(Math.abs(centsOff(peakNear(L, f, 0.5, 0.95, 40), f)) < 25, `${name}: out of tune`);
  }
});

test("breath: the song builder, the MCP description and Strudel know it", () => {
  const song = B.newSong({ bpm: 120 });
  const { index: i } = B.addTrack(song, { engine: "breath", name: "horn" });
  assert.equal(song.tracks[i].engineKey, "dm:breath");
  B.applyPreset(song, i, "tuba");
  assert.equal(song.tracks[i].params.brtkind, "lips");
  assert.equal(song.tracks[i].params.brtf1, breathF1(230));
  B.setParams(song, i, { brtgrowl: 0.4, brtplayers: 3, brtkind: "reed", brtmode: "mono" });
  assert.throws(() => B.setParams(song, i, { brtplayers: 9 }), /brtplayers/);
  assert.throws(() => B.setParams(song, i, { brtkind: "strings" }), /brtkind/);
  assert.throws(() => B.setParams(song, i, { brtreed: 0.5 }), /brtreed/);
  const d = B.describeEngine("dm:breath");
  assert.deepEqual([d.sliders.harm.label, d.sliders.timb.label, d.sliders.morph.label, d.sliders.decay.label], ["tone", "air", "vibrato", "release"]);
  for (const name of ["alto sax", "trumpet", "flute", "tuba"]) assert.ok(d.presets.some(p => p.name === name), name);
  assert.ok(d.panel.numeric.some(c => c.key === "brtscoop"));
  B.addLfo(song, i, { target: "breath_growl", shape: "sine", amount: 0.2 });
  B.addLfo(song, i, { target: "harm", shape: "sine", amount: 0.2 });
  B.setAutomation(song, i, { target: "breath.fall", values: [0, 0, 0, 1] });
  B.setAutomation(song, i, { target: "timb", values: [0, 0.5, 1, 0.5] });
  assert.throws(() => B.addLfo(song, i, { target: "oracle_slop", shape: "sine", amount: 0.2 }));
  assert.ok(canModulateKey("dm:breath", "breath_mute") && !canModulateKey("dm:oracle", "breath_mute"));
  assert.ok(canAutomateKey("dm:breath", "breath.players") && !canAutomateKey("dm:vox", "breath.players"));
  assert.equal(B.trackRole({ engineKey: "dm:breath", name: "tuba" }), "bass");
  assert.equal(B.trackRole({ engineKey: "dm:breath", name: "tenor sax" }), "lead");

  // Strudel: a wind's name is the breath with that instrument loaded
  for (const [sound, preset] of [["gm_trumpet", "trumpet"], ["gm_muted_trumpet", "muted trumpet"], ["gm_tuba", "tuba"],
    ["gm_alto_sax", "alto sax"], ["gm_baritone_sax", "bari sax"], ["sax", "alto sax"], ["gm_flute", "flute"],
    ["gm_pan_flute", "pan flute"], ["gm_bassoon", "bassoon"], ["gm_clarinet", "clarinet"], ["gm_french_horn", "french horn"],
    ["gm_brass_section", "brass section"], ["gm_trombone", "trombone"], ["gm_oboe", "oboe"]]) {
    const v = voiceFor(sound);
    assert.deepEqual([v.engine, v.preset], ["dm:breath", preset], sound);
    assert.ok(BREATH_TONE_NAMES.includes(preset));
  }
  assert.equal(voiceFor("gm_electric_bass_finger").engine, "dm:bass", "a bass is still a bass");
  const fromGm = B.newSong({ bpm: 120 });
  writeTracks(fromGm, realize(readCode(`horn: note("c3 e3 g3 c4").s("gm_tuba")`)));
  const tuba = fromGm.tracks.find(x => x.engineKey === "dm:breath");
  assert.ok(tuba, "no breath track from a wind's name");
  assert.equal(tuba.params.brtf1, breathF1(230), "the tuba was not loaded");
  // the portable export names the family, and it reads back as the breath
  const portable = sessionToCode(fromGm).code;
  assert.match(portable, /gm_trumpet/);

  // by name in, by name out, and every control round-trips
  const read = readCode(`sax: note("c4 e4 g4 b4").s("breath").preset("tenor sax").knob("brtgrowl", 0.4).knob("brtplayers", 2).knob("brtkind", "lips").knob("brtfall", 0.3)`);
  const out = B.newSong({ bpm: 120 });
  writeTracks(out, realize(read));
  const t = out.tracks.find(x => x.engineKey === "dm:breath");
  assert.ok(t, "no breath track from code");
  assert.equal(t.params.brtgrowl, 0.4);
  assert.equal(t.params.brtf1, breathF1(480));
  const D0 = defaultTrackParams();
  const code = sessionToCode(out, { native: true }).code;
  assert.match(code, /\.s\("breath"\)/);
  const back = B.newSong({ bpm: 120 });
  writeTracks(back, realize(readCode(code)));
  const again = back.tracks.find(x => x.engineKey === "dm:breath");
  assert.ok(again, "the written code lost the breath");
  for (const k of ["brtgrowl", "brtplayers", "brtkind", "brtfall", "brtf1", "brtf2", "brtedge", "harm", "timb", "morph", "decay"]) {
    // a sparse song leaves a default unwritten
    assert.equal(again.params[k] ?? D0[k], t.params[k] ?? D0[k], `${k} did not round-trip`);
  }
});
