import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  LADDER_DEFAULTS, LADDER_NUM_CTLS, LADDER_OSC_NUM_CTLS, LADDER_OSC_SEL_CTLS, LADDER_RANGES, LADDER_SEL_CTLS,
  LADDER_TONE_NAMES, LADDER_WAVES, ladderTone,
} from "../public/js/engineData.js";
import { ladderProcessorSource } from "../public/js/ladder.js";
import { migrateTrackNames } from "../public/js/sessionFormat.js";
import { defaultTrackParams } from "../public/js/soundDefaults.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, writeTracks } from "../public/js/strudel.js";

// The ladder, rendered outside a browser, as siege.test.js renders the siege.
//
// What is pinned is what ladder.js claims: every oscillator lands on the note
// and the ranges and tuning knobs move it as they say; the six waves are what
// they are; the cutoff is a 24dB lowpass that follows the keyboard by the
// switch; the emphasis costs passband and whistles past three quarters of the
// knob, in tune at full tracking; the mixer overloads the input stage; the two
// contours and the decay switch; mono is low-note priority and single
// trigger; poly plays a chord; the wheel carries osc 3 or noise to the
// oscillators and the filter; drift is a few cents and zero is none; a stop
// lets go and a finished note is digital silence; the patches, the markup,
// the builder, Strudel and the migration of a song from before the model.

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
  return new Function(`${prelude}${ladderProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// One saw, the filter open, no emphasis, no contour, no drift: the bare oscillator.
const CLEAN = { osc2: 0, osc3: 0, emphasis: 0, contour: 0, drift: 0, cutoff: 1 };
const W = Object.fromEntries(LADDER_WAVES.map((w, i) => [w, i]));

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Render on a fresh processor. `events` are [seconds, message] pairs. */
function render({ secs = 1, set = {}, params = {}, notes = [[0.01, 48, 0.5, 1]], events = [] } = {}) {
  const inst = new Cls();
  inst.onMessage({ type: "set", kbd: "off", ...set });
  let id = 0;
  for (const [when, midi, dur, vel, glide] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: vel ?? 1, glide: glide ?? 0 });
  }
  const pending = events.slice().sort((a, b) => a[0] - b[0]);
  const P = {};
  for (const [k, v] of Object.entries({ ...PARAM_DEFAULTS, ...params })) P[k] = Float32Array.of(v);
  const n = Math.round(secs * SR);
  const L = new Float32Array(n);
  const outs = [[new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    while (pending.length && pending[0][0] * SR <= b * Q) inst.onMessage(pending.shift()[1]);
    globalThis.currentFrame = b * Q;
    inst.process([], outs, P);
    L.set(outs[0][0].subarray(0, Math.min(Q, n - b * Q)), b * Q);
  }
  return { L, inst };
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
const fcOf = (cut) => 30 * Math.pow(2, cut * 9.4);

test("ladder: the tables agree with the processor and the markup", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, , , def] of LADDER_NUM_CTLS) {
    assert.ok(names.includes(k), `${k} is not a processor parameter`);
    assert.equal(PARAM_DEFAULTS[k], def, `${k}: the panel default and the processor default differ`);
  }
  // The four track sliders' and the mixer's defaults are the track's own.
  const D = defaultTrackParams();
  assert.deepEqual([PARAM_DEFAULTS.cutoff, PARAM_DEFAULTS.emphasis, PARAM_DEFAULTS.contour, PARAM_DEFAULTS.decay], [D.harm, D.timb, D.morph, D.decay]);
  assert.deepEqual([PARAM_DEFAULTS.osc1, PARAM_DEFAULTS.osc2, PARAM_DEFAULTS.osc3, PARAM_DEFAULTS.noise], [D.osc1, D.osc2, D.osc3, D.noise]);
  for (const k of Object.keys(LADDER_DEFAULTS)) assert.equal(D[k], LADDER_DEFAULTS[k], `${k}: the track default differs`);
  assert.equal(D.ldrv, 2, "a new track carries the format marker");
  for (const name of LADDER_TONE_NAMES) {
    const t = ladderTone(name);
    for (const k of Object.keys(LADDER_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const [k] of [...LADDER_OSC_NUM_CTLS, ...LADDER_OSC_SEL_CTLS]) assert.ok(k in t, `${name}: ${k} missing`);
    for (const [k, , values] of LADDER_SEL_CTLS) assert.ok(values.includes(t[`ldr${k}`]), `${name}: ${k} is ${t[`ldr${k}`]}`);
    for (const [k, , values] of LADDER_OSC_SEL_CTLS) assert.ok(values.includes(t[k]), `${name}: ${k} is ${t[k]}`);
    for (const [k, lo, hi] of LADDER_OSC_NUM_CTLS) assert.ok(t[k] >= lo && t[k] <= hi, `${name}: ${k}`);
    for (const k of ["harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "noise"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
  }
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const LADDER_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of [...LADDER_NUM_CTLS.map(c => [`ldr${c[0]}`, c[1], c[2], c[3]]), ...LADDER_OSC_NUM_CTLS.filter(c => /freq$/.test(c[0]))]) {
    const m = panel.match(new RegExp(`class="p-${k}" type="range" min="(-?[\\d.]+)" max="(-?[\\d.]+)" step="[\\d.]+" value="(-?[\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of [...LADDER_SEL_CTLS.map(c => [`ldr${c[0]}`, c[1], c[2]]), ...LADDER_OSC_SEL_CTLS]) {
    const m = panel.match(new RegExp(`<select class="p-${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: the options differ from the table`);
    const sel = m[1].match(/value="([^"]*)" selected/);
    assert.equal(sel?.[1], def, `${k}: the markup's default differs`);
  }
  for (const [k, , , def] of LADDER_OSC_NUM_CTLS.filter(c => /range$/.test(c[0]))) {
    const m = panel.match(new RegExp(`<select class="p-${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="(-?\d+)"/g)].map(x => Number(x[1]));
    assert.deepEqual(opts, LADDER_RANGES, `${k}: the ranges differ from the table`);
    assert.equal(Number(m[1].match(/value="(-?\d+)" selected/)?.[1]), def, `${k}: the markup's default differs`);
  }
});

test("ladder: every oscillator lands on the note, and the ranges and tuning knobs move it as they say", () => {
  for (const midi of [36, 48, 60, 72]) {
    const { L } = render({ params: CLEAN, notes: [[0.01, midi, 0.5, 1]] });
    assert.ok(Math.abs(cents(pitchOf(L, 0.2, 0.5), hz(midi))) < 2, `${midi}: ${pitchOf(L, 0.2, 0.5)}`);
  }
  // Osc 2 and osc 3 alone, through their ranges and tuning knobs.
  const f = hz(48);
  let r = render({ set: { ranges: [0, 1, 0] }, params: { ...CLEAN, osc1: 0, osc2: 0.55, osc2freq: 7 } });
  assert.ok(Math.abs(cents(pitchOf(r.L, 0.2, 0.5), f * 2 * Math.pow(2, 7 / 12))) < 2, "osc 2 at 4' + 7 semitones");
  r = render({ set: { ranges: [0, 0, -2] }, params: { ...CLEAN, osc1: 0, osc3: 0.55, osc3freq: -7 } });
  assert.ok(Math.abs(cents(pitchOf(r.L, 0.2, 0.5), f / 4 / Math.pow(2, 7 / 12))) < 2, "osc 3 at 32' - 7 semitones");
  // A fraction of a semitone is a detune, which is what the knob is for.
  r = render({ params: { ...CLEAN, osc1: 0, osc2: 0.55, osc2freq: 0.1 } });
  assert.ok(Math.abs(cents(pitchOf(r.L, 0.2, 0.5), f) - 10) < 2, `osc 2 + 0.1 semitone: ${cents(pitchOf(r.L, 0.2, 0.5), f)} cents`);
  // Tune moves everything a semitone either way.
  r = render({ params: { ...CLEAN, tune: 1 } });
  assert.ok(Math.abs(cents(pitchOf(r.L, 0.2, 0.5), f) - 100) < 2, "tune +1");
  // Osc 3 off the keyboard sits at A440 (times its range and knob) whatever the note.
  r = render({ set: { osc3kbd: false, ranges: [0, 0, 0] }, params: { ...CLEAN, osc1: 0, osc3: 0.55 }, notes: [[0.01, 40, 0.5, 1]] });
  assert.ok(Math.abs(cents(pitchOf(r.L, 0.2, 0.5), 440)) < 2, `osc 3 kbd off: ${pitchOf(r.L, 0.2, 0.5)}`);
  // LO is seven octaves under 8'.
  r = render({ set: { osc3kbd: false, ranges: [0, 0, -7], waves: [W.sawtooth, W.sawtooth, W.square] }, params: { ...CLEAN, osc1: 0, osc3: 1 }, secs: 2, notes: [[0.01, 60, 1.9, 1]] });
  let edges = 0;
  for (let i = Math.round(0.5 * SR) + 1; i < Math.round(1.5 * SR); i++) if (r.L[i - 1] <= 0 && r.L[i] > 0) edges++;
  assert.ok(edges >= 3 && edges <= 4, `osc 3 in LO at A440: ${edges} cycles a second, want ${(440 / 128).toFixed(2)}`);
});

test("ladder: the six waves are what they are", () => {
  const f = hz(48);
  const h = (L, n) => db(tone(L, n * f, 0.2, 0.5));
  for (const w of LADDER_WAVES) {
    const { L } = render({ set: { waves: [W[w], W[w], W[w]] }, params: CLEAN });
    assert.ok(L.every(Number.isFinite), `${w}: not finite`);
    assert.ok(Math.abs(cents(pitchOf(L, 0.2, 0.5), f)) < 2, `${w}: pitch`);
    const lvl = db(rms(L, 0.2, 0.5));
    assert.ok(lvl > -20 && lvl < -8, `${w}: ${lvl.toFixed(1)}dBFS`);
  }
  let { L } = render({ set: { waves: [W.sawtooth, 0, 0] }, params: CLEAN });
  assert.ok(Math.abs((h(L, 1) - h(L, 2)) - 6) < 1.5, `a saw's 2nd harmonic is 6dB under: ${(h(L, 1) - h(L, 2)).toFixed(1)}`);
  ({ L } = render({ set: { waves: [W.square, 0, 0] }, params: CLEAN }));
  assert.ok(h(L, 1) - h(L, 2) > 30, `a square has no 2nd harmonic: ${(h(L, 1) - h(L, 2)).toFixed(1)}`);
  assert.ok(Math.abs((h(L, 1) - h(L, 3)) - 9.5) < 1.5, `a square's 3rd is 9.5dB under: ${(h(L, 1) - h(L, 3)).toFixed(1)}`);
  ({ L } = render({ set: { waves: [W.triangle, 0, 0] }, params: CLEAN }));
  assert.ok(h(L, 1) - h(L, 3) > 17 && h(L, 1) - h(L, 2) > 30, "a triangle: odd harmonics only, the 3rd 19dB under");
  // The pulses have even harmonics, the narrow one more of them relative to its fundamental.
  const wide = render({ set: { waves: [W.pulse, 0, 0] }, params: CLEAN }).L;
  const narrow = render({ set: { waves: [W.narrow, 0, 0] }, params: CLEAN }).L;
  assert.ok(h(wide, 1) - h(wide, 2) < 12, "the wide pulse has a 2nd harmonic");
  assert.ok((h(narrow, 1) - h(narrow, 2)) < (h(wide, 1) - h(wide, 2)), "the narrow pulse is thinner still");
  // The shark sits between the triangle and the saw.
  const shark = render({ set: { waves: [W.shark, 0, 0] }, params: CLEAN }).L;
  const tri = render({ set: { waves: [W.triangle, 0, 0] }, params: CLEAN }).L;
  const saw = render({ set: { waves: [W.sawtooth, 0, 0] }, params: CLEAN }).L;
  const ev = (a) => h(a, 2) - h(a, 1);
  assert.ok(ev(shark) > ev(tri) + 10 && ev(shark) < ev(saw) - 1, `shark even content: tri ${ev(tri).toFixed(1)} shark ${ev(shark).toFixed(1)} saw ${ev(saw).toFixed(1)}`);
});

test("ladder: the cutoff is a 24dB lowpass, and keyboard tracking follows the switch", () => {
  const f = hz(48);
  const h8 = (L) => db(tone(L, 8 * f, 0.2, 0.5)), h1 = (L) => db(tone(L, f, 0.2, 0.5));
  const open = render({ params: CLEAN }).L;
  const half = render({ params: { ...CLEAN, cutoff: 0.5 } }).L;      // fc 780Hz: the 8th harmonic (1046Hz) is above it
  const low = render({ params: { ...CLEAN, cutoff: 0.3 } }).L;       // fc 212Hz
  assert.ok(Math.abs(h1(open) - h1(half)) < 1, "the fundamental under the cutoff is untouched");
  assert.ok(h8(open) - h8(half) > 10, `the 8th harmonic above the cutoff falls: ${(h8(open) - h8(half)).toFixed(1)}dB`);
  // 24dB/oct: two octaves above a 212Hz corner, the 8th (1046Hz, 2.3 octaves up) is ~55dB down.
  assert.ok(h8(open) - h8(low) > 45, `24dB/oct: ${(h8(open) - h8(low)).toFixed(1)}dB`);
  // Tracking: at full, a note an octave up keeps the same spectrum relative to its own fundamental.
  const bright = (L, f0) => db(tone(L, 6 * f0, 0.2, 0.5)) - db(tone(L, f0, 0.2, 0.5));
  for (const [kbd, want] of [["off", 0], ["full", 1]]) {
    const lo = render({ set: { kbd }, params: { ...CLEAN, cutoff: 0.45 }, notes: [[0.01, 48, 0.5, 1]] }).L;
    const hi = render({ set: { kbd }, params: { ...CLEAN, cutoff: 0.45 }, notes: [[0.01, 60, 0.5, 1]] }).L;
    const diff = bright(hi, hz(60)) - bright(lo, hz(48));
    if (want) assert.ok(Math.abs(diff) < 3, `full tracking keeps the colour across an octave: ${diff.toFixed(1)}dB`);
    else assert.ok(diff < -8, `no tracking: the high note is duller by ${(-diff).toFixed(1)}dB`);
  }
  // A third sits between.
  const lo3 = render({ set: { kbd: "1/3" }, params: { ...CLEAN, cutoff: 0.45 }, notes: [[0.01, 48, 0.5, 1]] }).L;
  const hi3 = render({ set: { kbd: "1/3" }, params: { ...CLEAN, cutoff: 0.45 }, notes: [[0.01, 60, 0.5, 1]] }).L;
  const d3 = bright(hi3, hz(60)) - bright(lo3, hz(48));
  assert.ok(d3 < -3 && d3 > -14, `a third of the keyboard: ${d3.toFixed(1)}dB`);
});

test("ladder: emphasis costs passband and whistles past three quarters of the knob, in tune at full tracking", () => {
  const f = hz(48);
  const h1 = (e) => db(tone(render({ params: { ...CLEAN, cutoff: 0.5, emphasis: e } }).L, f, 0.2, 0.5));
  const flat = h1(0), mid = h1(0.5), top = h1(1);
  assert.ok(flat - mid > 5 && flat - mid < 12, `half emphasis thins the passband: ${(flat - mid).toFixed(1)}dB`);
  assert.ok(flat - top > 10 && flat - top < 16, `full emphasis thins it more: ${(flat - top).toFixed(1)}dB`);
  // Every oscillator off: nothing below 0.7, a whistle at the cutoff from 0.75.
  const alone = (e, cut = 0.5, kbd = "off", midi = 60) =>
    render({ set: { kbd }, params: { ...CLEAN, osc1: 0, cutoff: cut, emphasis: e }, notes: [[0.01, midi, 1.4, 1]], secs: 1.5 }).L;
  assert.ok(db(rms(alone(0.7), 1, 1.4)) < -60, `no whistle at 0.7: ${db(rms(alone(0.7), 1, 1.4)).toFixed(1)}`);
  const w = alone(0.8);
  assert.ok(db(rms(w, 1, 1.4)) > -24, `a whistle at 0.8: ${db(rms(w, 1, 1.4)).toFixed(1)}`);
  assert.ok(Math.abs(cents(pitchOf(w, 1, 1.4), fcOf(0.5))) < 60, `at the cutoff: ${pitchOf(w, 1, 1.4).toFixed(0)} vs ${fcOf(0.5).toFixed(0)}`);
  assert.ok(peak(w) < 0.6, `bounded by the loop's own tanh: ${peak(w)}`);
  // At full tracking the whistle plays the keyboard: an octave up is an octave up.
  const a = pitchOf(alone(0.9, 0.5, "full", 48), 1, 1.4), b = pitchOf(alone(0.9, 0.5, "full", 60), 1, 1.4);
  assert.ok(Math.abs(cents(b, a) - 1200) < 25, `an octave of keyboard is an octave of whistle: ${cents(b, a).toFixed(0)} cents`);
});

test("ladder: the mixer overloads the input stage", () => {
  // One sine at a modest level is a sine; three oscillators up full are not.
  const f = hz(48);
  const thd = (L) => db(tone(L, 3 * f, 0.2, 0.5)) - db(tone(L, f, 0.2, 0.5));
  const quiet = render({ set: { waves: [W.sine, W.sine, W.sine] }, params: { ...CLEAN, osc1: 0.3 } }).L;
  const one = render({ set: { waves: [W.sine, W.sine, W.sine] }, params: { ...CLEAN, osc1: 0.55 } }).L;
  const full = render({ set: { waves: [W.sine, W.sine, W.sine] }, params: { ...CLEAN, osc1: 1, osc2: 1, osc3: 1, osc2freq: 0, osc3freq: 0 } }).L;
  assert.ok(thd(quiet) < -40, `a sine at 0.3 is clean: ${thd(quiet).toFixed(1)}`);
  assert.ok(thd(one) < -30, `one oscillator at its default is near clean: ${thd(one).toFixed(1)}`);
  // The machine's overload is warm, not a fuzz: a dozen dB more third harmonic, never a square.
  assert.ok(thd(full) > thd(one) + 10 && thd(full) > -24, `three up full drive the pair: ${thd(full).toFixed(1)} vs ${thd(one).toFixed(1)}`);
  assert.ok(peak(full) < 1, "and the output never passes full scale");
});

test("ladder: the contours, the amount, and the decay switch", () => {
  const f = hz(48);
  // The filter contour opens the filter and lets it close: bright early, dark late.
  const sw = render({ params: { ...CLEAN, cutoff: 0.25, contour: 1, fdec: 0.4, fsus: 0 } }).L;
  const early = db(tone(sw, 8 * f, 0.02, 0.07)), late = db(tone(sw, 8 * f, 0.4, 0.5));
  assert.ok(early - late > 25, `the contour sweeps: ${(early - late).toFixed(1)}dB`);
  const none = render({ params: { ...CLEAN, cutoff: 0.25, contour: 0, fdec: 0.4, fsus: 0 } }).L;
  assert.ok(Math.abs(db(tone(none, 8 * f, 0.02, 0.07)) - db(tone(none, 8 * f, 0.4, 0.5))) < 3, "no amount, no sweep");
  // Sustain holds the filter where it says.
  const held = render({ params: { ...CLEAN, cutoff: 0.25, contour: 1, fdec: 0.2, fsus: 1 } }).L;
  assert.ok(db(tone(held, 8 * f, 0.4, 0.5)) > late + 25, "full filter sustain keeps it open");
  // The loudness contour: a slow attack, a decay toward the sustain.
  const slow = render({ params: { ...CLEAN, atk: 0.5 } }).L;    // 100ms
  assert.ok(db(rms(slow, 0.02, 0.04)) < db(rms(slow, 0.1, 0.13)) - 8, "a 100ms attack is still climbing at 20ms");
  const fast = render({ params: { ...CLEAN, atk: 0 } }).L;      // 1ms
  assert.ok(Math.abs(db(rms(fast, 0.02, 0.04)) - db(rms(fast, 0.1, 0.13))) < 2, "a 1ms attack is there at once");
  const dec = render({ params: { ...CLEAN, decay: 0.4, sus: 0.2 } }).L;    // 125ms toward 0.2
  assert.ok(db(rms(dec, 0.45, 0.5)) < db(rms(dec, 0.012, 0.03)) - 8, "the decay falls toward the sustain");
  const flat = render({ params: { ...CLEAN, decay: 0.4, sus: 1 } }).L;
  assert.ok(Math.abs(db(rms(flat, 0.45, 0.5)) - db(rms(flat, 0.012, 0.03))) < 1.5, "full sustain: nothing to fall to");
  // The decay switch: off, the note stops a few ms after the step; on, it releases at its decay time.
  const off = render({ set: { decsw: false }, params: { ...CLEAN, decay: 0.8 }, notes: [[0.01, 48, 0.3, 1]] }).L;
  const on = render({ set: { decsw: true }, params: { ...CLEAN, decay: 0.8 }, notes: [[0.01, 48, 0.3, 1]] }).L;
  assert.ok(db(rms(off, 0.35, 0.4)) < -55, `switch off: gone 50ms after the step: ${db(rms(off, 0.35, 0.4)).toFixed(1)}`);
  assert.ok(db(rms(on, 0.35, 0.4)) > -20 && db(rms(on, 0.9, 1)) > -30, "switch on: still falling a second later");
});

test("ladder: mono is low-note priority and single trigger; poly plays the chord", () => {
  const f48 = hz(48), f52 = hz(52);
  // A higher note arriving while a lower one is held is ignored until the lower lets go.
  let { L } = render({ set: { mono: true }, params: CLEAN, notes: [[0.01, 48, 0.6, 1], [0.2, 52, 0.6, 1]] });
  assert.ok(Math.abs(cents(pitchOf(L, 0.3, 0.5), f48)) < 2, "the low note holds");
  assert.ok(Math.abs(cents(pitchOf(L, 0.65, 0.8), f52)) < 2, "the higher one takes over when the low one lifts");
  // A lower note arriving takes over, and the contour is not retriggered.
  ({ L } = render({ set: { mono: true }, params: { ...CLEAN, atk: 0.5 }, notes: [[0.01, 52, 1, 1], [0.3, 48, 0.5, 1]] }));
  assert.ok(Math.abs(cents(pitchOf(L, 0.4, 0.5), f48)) < 2, "the lower note wins");
  assert.ok(Math.abs(db(rms(L, 0.27, 0.3)) - db(rms(L, 0.31, 0.34))) < 1.5, "single trigger: no dip, no restart of the slow attack");
  // Glide between them, when the track has one.
  ({ L } = render({ set: { mono: true, glide: 0.2 }, params: CLEAN, notes: [[0.01, 60, 1, 1], [0.3, 48, 0.6, 1]] }));
  const mid = pitchOf(L, 0.35, 0.4);
  assert.ok(mid < hz(60) - 20 && mid > f48 + 20, `gliding at 50ms in: ${mid.toFixed(1)}`);
  assert.ok(Math.abs(cents(pitchOf(L, 0.8, 0.9), f48)) < 5, "and arrives");
  // Poly: three notes at once all sound.
  ({ L } = render({ params: CLEAN, notes: [[0.01, 48, 0.5, 1], [0.01, 52, 0.5, 1], [0.01, 55, 0.5, 1]] }));
  for (const m of [48, 52, 55]) assert.ok(db(tone(L, hz(m), 0.2, 0.5)) > -30, `${m} sounds in the chord`);
  // Mono plays one of the three: the lowest.
  ({ L } = render({ set: { mono: true }, params: CLEAN, notes: [[0.01, 55, 0.5, 1], [0.01, 48, 0.5, 1], [0.01, 52, 0.5, 1]] }));
  assert.ok(Math.abs(cents(pitchOf(L, 0.2, 0.5), f48)) < 2, "the lowest of a chord");
  assert.ok(db(tone(L, hz(55), 0.2, 0.5)) < db(tone(L, f48, 0.2, 0.5)) - 20, "and only it");
  // A seventh voice steals one: still finite, still a chord.
  ({ L } = render({ params: CLEAN, notes: [48, 50, 52, 53, 55, 57, 59].map(m => [0.01, m, 0.5, 1]) }));
  assert.ok(L.every(Number.isFinite) && peak(L) < 1);
});

test("ladder: the wheel carries osc 3 or noise to the oscillators and the filter", () => {
  const f = hz(60);
  const span = (L) => { let mn = Infinity, mx = 0; for (let t = 0.3; t < 1.8; t += 0.05) { const p = pitchOf(L, t, t + 0.05); mn = Math.min(mn, p); mx = Math.max(mx, p); } return [mn, mx]; };
  const lo = { osc3kbd: false, ranges: [0, 0, -7] };
  let [mn, mx] = span(render({ set: { ...lo, oscmod: true }, params: { ...CLEAN, mod: 0.5 }, secs: 2, notes: [[0.01, 60, 1.9, 1]] }).L);
  assert.ok(cents(mx, f) > 150 && cents(mx, f) < 260 && cents(mn, f) < -150, `half a wheel is about ±2.5 semitones of vibrato: ${cents(mn, f).toFixed(0)}..${cents(mx, f).toFixed(0)}`);
  [mn, mx] = span(render({ set: { ...lo, oscmod: false }, params: { ...CLEAN, mod: 0.5 }, secs: 2, notes: [[0.01, 60, 1.9, 1]] }).L);
  assert.ok(cents(mx, mn) < 5, "the switch off, nothing moves");
  // The filter: a shut filter opened by the wheel is louder on the top of the LFO than off it.
  const fm = render({ set: { ...lo, filtmod: true }, params: { ...CLEAN, cutoff: 0.2, mod: 1 }, secs: 2, notes: [[0.01, 60, 1.9, 1]] }).L;
  let loud = 0, soft = Infinity;
  for (let t = 0.3; t < 1.8; t += 0.03) { const v = rms(fm, t, t + 0.03); loud = Math.max(loud, v); soft = Math.min(soft, v); }
  assert.ok(db(loud) - db(soft) > 10, `the filter breathes with the wheel: ${(db(loud) - db(soft)).toFixed(1)}dB`);
  // Noise as the source: a random wobble, not a hiss on the pitch.
  const nz = render({ set: { oscmod: true }, params: { ...CLEAN, mod: 0.3, modmix: 1 }, secs: 2, notes: [[0.01, 60, 1.9, 1]] }).L;
  [mn, mx] = span(nz);
  assert.ok(cents(mx, mn) > 20 && cents(mx, mn) < 400, `the noise wobbles the pitch: ${cents(mx, mn).toFixed(0)} cents`);
  assert.ok(nz.every(Number.isFinite));
});

test("ladder: drift is a few cents at the top and none at zero", () => {
  const f = hz(60);
  const walk = (d) => { const { L } = render({ params: { ...CLEAN, drift: d }, secs: 4, notes: [[0.01, 60, 3.9, 1]] }); let mn = Infinity, mx = 0; for (let t = 0.3; t < 3.8; t += 0.1) { const p = pitchOf(L, t, t + 0.1); mn = Math.min(mn, p); mx = Math.max(mx, p); } return [cents(mn, f), cents(mx, f)]; };
  const [lo0, hi0] = walk(0);
  assert.ok(Math.abs(lo0) < 0.5 && Math.abs(hi0) < 0.5, `drift 0 is dead on: ${lo0.toFixed(2)}..${hi0.toFixed(2)}`);
  const [lo1, hi1] = walk(1);
  assert.ok(hi1 - lo1 > 1.5 && Math.abs(lo1) < 12 && Math.abs(hi1) < 12, `drift 1 wanders a few cents: ${lo1.toFixed(1)}..${hi1.toFixed(1)}`);
});

test("ladder: a stop lets go, and a finished note is digital silence", () => {
  const { L: stopped } = render({ params: CLEAN, notes: [[0.01, 48, 2, 1]], events: [[0.5, { type: "off", when: 0.5 }]] });
  assert.ok(db(rms(stopped, 0.7, 0.9)) < -60, `still ringing after the stop: ${db(rms(stopped, 0.7, 0.9)).toFixed(1)}dB`);
  const { L } = render({ params: { ...CLEAN, decay: 0.2 }, notes: [[0.01, 48, 0.3, 1]], secs: 2 });
  for (let i = Math.round(1.5 * SR); i < L.length; i++) assert.equal(L[i], 0);
  // Velocity is a level.
  const soft = render({ params: CLEAN, notes: [[0.01, 48, 0.5, 0.2]] }).L;
  const hard = render({ params: CLEAN, notes: [[0.01, 48, 0.5, 1]] }).L;
  assert.ok(db(rms(hard, 0.2, 0.5)) - db(rms(soft, 0.2, 0.5)) > 4);
});

test("ladder: every patch plays at a sane level and under full scale", () => {
  const w = (name) => W[name] ?? W.sawtooth;
  for (const name of LADDER_TONE_NAMES) {
    const t = ladderTone(name);
    const set = {
      waves: [w(t.osc1wave), w(t.osc2wave), w(t.osc3wave)], ranges: [t.osc1range, t.osc2range, t.osc3range],
      kbd: t.ldrkbd, osc3kbd: t.ldrosc3kbd === "on", oscmod: t.ldroscmod === "on", filtmod: t.ldrfiltmod === "on",
      decsw: t.ldrdecsw === "on", mono: t.ldrmode === "mono", pink: t.noisetype === "pink",
    };
    const params = { cutoff: t.harm, emphasis: t.timb, contour: t.morph, decay: t.decay, osc1: t.osc1, osc2: t.osc2, osc3: t.osc3, noise: t.noise,
                     osc2freq: t.osc2freq, osc3freq: t.osc3freq };
    for (const [k] of LADDER_NUM_CTLS) params[k] = t[`ldr${k}`];
    const { L } = render({ secs: 1.5, set, params, notes: [[0.01, 48, 1, 1]] });
    assert.ok(L.every(Number.isFinite), `${name}: not finite`);
    assert.ok(peak(L) < 1, `${name}: peak ${peak(L)}`);
    // Over the first third of the note: a percussive patch has rightly gone by the end of it.
    const lvl = db(rms(L, 0.05, 0.35));
    assert.ok(lvl > -30 && lvl < -6, `${name}: ${lvl.toFixed(1)}dBFS`);
  }
});

test("ladder: the song builder, the MCP description and Strudel know it", () => {
  const song = B.newSong({ bpm: 120 });
  const { index: i } = B.addTrack(song, { engine: "ladder", name: "bass" });
  assert.equal(song.tracks[i].engineKey, "dm:ladder");
  assert.equal(song.tracks[i].params.ldrv, 2, "the builder stamps the format marker");
  B.applyPreset(song, i, "model d bass");
  assert.equal(song.tracks[i].params.ldrmode, "mono");
  assert.equal(song.tracks[i].params.osc1range, -1);
  B.setParams(song, i, { ldrfdec: 0.6, ldrkbd: "full", osc2freq: 0.12, osc3range: -7, osc1wave: "shark" });
  assert.throws(() => B.setParams(song, i, { ldrkbd: "half" }), /ldrkbd/);
  assert.throws(() => B.setParams(song, i, { ldrtune: 2 }), /ldrtune/);
  assert.throws(() => B.setParams(song, i, { osc1wave: "warm" }), /osc1wave/);
  const d = B.describeEngine("dm:ladder");
  assert.equal(d.sliders.harm.label, "cutoff");
  assert.equal(d.sliders.timb.label, "emph");
  assert.ok(d.presets.some(p => p.name === "whistle"));
  assert.ok(d.panel.numeric.some(c => c.key === "ldrfdec") && d.panel.select.some(c => c.key === "osc1wave"));
  B.addLfo(song, i, { target: "ladder_fdec", shape: "sine", amount: 0.2 });
  B.addLfo(song, i, { target: "timb", shape: "sine", amount: 0.2 });
  B.setAutomation(song, i, { target: "ladder.mod", values: [0, 0.5, 1, 0.5] });
  B.setAutomation(song, i, { target: "morph", values: [0, 0.5, 1, 0.5] });
  assert.throws(() => B.addLfo(song, i, { target: "siege_tune", shape: "sine", amount: 0.2 }));

  // Strudel: by name in, by name out, and every control round-trips.
  const read = readCode(`bass: s("ladder*4").knob("ldrmode", "mono").knob("ldrkbd", "2/3").knob("osc2freq", 0.1).knob("osc1wave", "pulse").knob("osc3range", -7).knob("ldrfdec", 0.6)`);
  const out = B.newSong({ bpm: 120 });
  writeTracks(out, realize(read));
  const t = out.tracks.find(x => x.engineKey === "dm:ladder");
  assert.ok(t, "no ladder track from code");
  assert.equal(t.params.ldrmode, "mono");
  assert.equal(t.params.osc1wave, "pulse");
  assert.equal(t.params.osc3range, -7);
  assert.equal(t.params.ldrv, 2);
  const code = sessionToCode(out, { native: true }).code;
  assert.match(code, /\.s\("ladder"\)/);
  assert.doesNotMatch(code, /ldrv/, "the format marker is not a knob");
  const back = B.newSong({ bpm: 120 });
  writeTracks(back, realize(readCode(code)));
  const again = back.tracks.find(x => x.engineKey === "dm:ladder");
  assert.ok(again, "the written code lost the ladder");
  for (const k of ["ldrmode", "ldrkbd", "ldrfdec", "osc2freq", "osc1wave", "osc3range", "harm", "timb", "morph", "decay"]) {
    assert.equal(again.params[k], t.params[k], `${k} did not round-trip`);
  }
});

test("ladder: a song from before the model keeps what it played", () => {
  // The four sliders meant detune / warmth; now they are the filter. A sound
  // with no marker gets the filter open, no emphasis, no contour, no drift,
  // and the old detune folded into osc 2's own knob.
  const old = { harm: 0.6, timb: 0.5, morph: 0.5, decay: 0.4, osc2freq: 0, osc1: 0.55 };
  const td = migrateTrackNames({
    engineKey: "dm:moog",
    params: { ...old },
    baseSound: { params: { ...old, harm: 0 } },
    patterns: [{ sound: { params: { ...old, osc2freq: 7 } } }],
  });
  assert.equal(td.engineKey, "dm:ladder");
  assert.equal(td.params.harm, 1);
  assert.equal(td.params.timb, 0);
  assert.equal(td.params.morph, 0);
  assert.equal(td.params.decay, 0.4, "the decay keeps its meaning");
  assert.equal(td.params.ldrdrift, 0);
  assert.equal(td.params.ldrv, 2);
  assert.ok(Math.abs(td.params.osc2freq - 0.2) < 1e-9, `5 + 25 × 0.6 cents: ${td.params.osc2freq}`);
  assert.ok(Math.abs(td.baseSound.params.osc2freq - 0.05) < 1e-9, "the shared sound, from its own harm");
  assert.equal(td.patterns[0].sound.params.osc2freq, 7, "clamped to the knob");
  assert.equal(td.patterns[0].sound.params.harm, 1);
  // A sound that carries the marker is left exactly alone, and the migration is idempotent.
  const now = migrateTrackNames({ engineKey: "dm:ladder", params: { harm: 0.3, timb: 0.6, osc2freq: 0.1, ldrv: 2 } });
  assert.deepEqual(now.params, { harm: 0.3, timb: 0.6, osc2freq: 0.1, ldrv: 2 });
  const twice = migrateTrackNames(JSON.parse(JSON.stringify(td)));
  assert.deepEqual(twice.params, td.params);
  // And only the ladder: the same keys on another engine mean nothing to it.
  const other = migrateTrackNames({ engineKey: "dm:snarl", params: { harm: 0.6, osc2freq: 0 } });
  assert.deepEqual(other.params, { harm: 0.6, osc2freq: 0 });
  // A session the builder writes today loads as it was written.
  const song = B.newSong({ bpm: 120 });
  const { index: i } = B.addTrack(song, { engine: "ladder", name: "bass" });
  B.setParams(song, i, { harm: 0.3 });
  const loaded = migrateTrackNames(JSON.parse(JSON.stringify(song.tracks[i])));
  assert.equal(loaded.params.harm, 0.3);
});
