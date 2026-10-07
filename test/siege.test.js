import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SIEGE_DEFAULTS, SIEGE_NUM_CTLS, SIEGE_SEL_CTLS, SIEGE_TONE_NAMES, siegeTone } from "../public/js/engineData.js";
import { siegeProcessorSource } from "../public/js/siege.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, writeTracks } from "../public/js/strudel.js";

// The siege, rendered outside a browser, as drone.test.js renders the drone.
//
// What is pinned is what siege.js claims: the pitch lands on the note and tune
// moves it by octaves, the click starts the pitch above the note and depth
// decides how fast it falls, decay is the body's length, a trigger ignores
// the step's length and gate holds it, the two drives add harmonics without
// ever passing full scale and the fold lifts the tail, the low cut takes the
// infrasound, lock pins the tuning, velocity runs from the floor to full, a
// retrigger does not click, a stop lets the drum go, and a finished hit is
// digital silence.

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
  return new Function(`${prelude}${siegeProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
// A bare drum: no sweep, no drive.
const PLAIN = { click: 0, drive: 0 };

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Render on a fresh processor. `events` are [seconds, message] pairs, posted
 * when the render reaches them.
 */
function render({ secs = 1, set = {}, params = {}, notes = [[0.01, 36, 0.25, 1]], events = [] } = {}) {
  const inst = new Cls();
  inst.onMessage({ type: "set", ...set });
  let id = 0;
  for (const [when, midi, dur, vel] of notes) {
    inst.onMessage({ type: "note", when, id: ++id, note: midi, freq: hz(midi), dur, vel: vel ?? 1, glide: 0 });
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

/** The pitch of the first whole cycle after t0, from its two falling crossings. */
function firstCycleHz(a, t0) {
  const i0 = Math.round(t0 * SR);
  let f1 = -1;
  for (let i = i0 + 2; i < a.length; i++) {
    if (a[i - 1] > 0 && a[i] <= 0) { if (f1 < 0) f1 = i; else return SR / (i - f1); }
  }
  return 0;
}

test("siege: the tables agree with the processor and the markup", () => {
  const names = Cls.parameterDescriptors.map(d => d.name);
  for (const [k, , , def] of SIEGE_NUM_CTLS) {
    assert.ok(names.includes(k), `${k} is not a processor parameter`);
    assert.equal(PARAM_DEFAULTS[k], def, `${k}: the panel default and the processor default differ`);
  }
  // The four track sliders' defaults are the track's own (soundDefaults.js).
  assert.deepEqual([PARAM_DEFAULTS.drive, PARAM_DEFAULTS.click, PARAM_DEFAULTS.depth, PARAM_DEFAULTS.decay], [0.5, 0.5, 0.5, 0.4]);
  for (const name of SIEGE_TONE_NAMES) {
    const t = siegeTone(name);
    for (const k of Object.keys(SIEGE_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const [k, , values] of SIEGE_SEL_CTLS) assert.ok(values.includes(t[`sge${k}`]), `${name}: ${k} is ${t[`sge${k}`]}`);
    for (const k of ["harm", "timb", "morph", "decay"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
  }
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const SIEGE_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of SIEGE_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-sge${k}" type="range" min="([\\d.]+)" max="([\\d.]+)" step="[\\d.]+" value="([\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of SIEGE_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-sge${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: the options differ from the table`);
    const sel = m[1].match(/value="([^"]*)" selected/);
    assert.equal(sel?.[1], def, `${k}: the markup's default differs`);
  }
});

test("siege: the pitch lands on the note, and tune moves it an octave either way", () => {
  for (const midi of [31, 36, 43]) {
    const f = hz(midi);
    const { L } = render({ params: { ...PLAIN, decay: 0.8 }, notes: [[0, midi, 0.25, 1]] });
    const p = pitchOf(L, 0.1, 0.5);
    assert.ok(Math.abs(p / f - 1) < 0.01, `midi ${midi}: ${p.toFixed(2)}Hz for ${f.toFixed(2)}`);
    assert.ok(db(tone(L, f, 0.1, 0.5) / tone(L, 2 * f, 0.1, 0.5)) > 30, `midi ${midi}: a clean sine has an octave in it`);
  }
  const f = hz(36);
  const up = render({ params: { ...PLAIN, decay: 0.8, tune: 1 } }).L;
  const down = render({ params: { ...PLAIN, decay: 0.8, tune: 0 } }).L;
  assert.ok(Math.abs(pitchOf(up, 0.1, 0.5) / (2 * f) - 1) < 0.01, "tune 1 is not an octave up");
  assert.ok(Math.abs(pitchOf(down, 0.1, 0.5) / (f / 2) - 1) < 0.01, "tune 0 is not an octave down");
});

test("siege: the click starts the pitch above the note and depth decides how fast it falls", () => {
  const f = hz(36);
  // No click: the first cycles are already at the note.
  const none = render({ params: { ...PLAIN, decay: 0.8 } }).L;
  assert.ok(Math.abs(pitchOf(none, 0.012, 0.06) / f - 1) < 0.02, "click 0 still sweeps");
  // Half the knob is an octave and a half up at the start, at the note later.
  const half = render({ params: { drive: 0, click: 0.5, depth: 0.5, decay: 0.8 } }).L;
  assert.ok(firstCycleHz(half, 0.01) > 1.5 * f, `click 0.5 starts at ${firstCycleHz(half, 0.01).toFixed(0)}Hz`);
  assert.ok(firstCycleHz(none, 0.01) < 1.05 * f, `click 0 starts at ${firstCycleHz(none, 0.01).toFixed(0)}Hz`);
  assert.ok(Math.abs(pitchOf(half, 0.3, 0.6) / f - 1) < 0.01, "the sweep never landed on the note");
  // Depth: at the bottom the sweep is over inside a few ms, at the top it is
  // still well above the note 50ms in.
  const fast = render({ params: { drive: 0, click: 0.7, depth: 0, decay: 0.8 } }).L;
  const slow = render({ params: { drive: 0, click: 0.7, depth: 1, decay: 0.8 } }).L;
  assert.ok(Math.abs(pitchOf(fast, 0.03, 0.1) / f - 1) < 0.03, `depth 0 still sweeping at 30ms: ${pitchOf(fast, 0.03, 0.1).toFixed(0)}Hz`);
  assert.ok(pitchOf(slow, 0.05, 0.1) > 1.4 * f, `depth 1 already landed at 50ms: ${pitchOf(slow, 0.05, 0.1).toFixed(0)}Hz`);
});

test("siege: decay is the body's length, and a trigger ignores the step's length", () => {
  const short = render({ secs: 2, params: { ...PLAIN, decay: 0.2 } }).L;
  const long = render({ secs: 2, params: { ...PLAIN, decay: 0.9 } }).L;
  assert.ok(db(rms(short, 0.4, 0.5)) < db(rms(long, 0.4, 0.5)) - 20, "a longer decay is not louder later");
  assert.ok(db(rms(long, 1, 1.2)) > -30, `decay 0.9 gone by 1s: ${db(rms(long, 1, 1.2)).toFixed(1)}dB`);
  assert.ok(db(rms(short, 1, 1.2)) < -80, `decay 0.2 still ringing at 1s: ${db(rms(short, 1, 1.2)).toFixed(1)}dB`);
  // The step's length changes nothing in trig mode.
  const a = render({ params: { ...PLAIN, decay: 0.6 }, notes: [[0.01, 36, 0.02, 1]] }).L;
  const b = render({ params: { ...PLAIN, decay: 0.6 }, notes: [[0.01, 36, 0.9, 1]] }).L;
  assert.ok(Math.abs(db(rms(a, 0.3, 0.5)) - db(rms(b, 0.3, 0.5))) < 0.1, "a trigger heard its gate length");
});

test("siege: gate mode holds the body for the step and decays when it ends", () => {
  const p = { ...PLAIN, decay: 0.3 };
  const held = render({ secs: 1.5, set: { gate: true }, params: p, notes: [[0.01, 36, 0.8, 1]] }).L;
  const let_go = render({ secs: 1.5, set: { gate: true }, params: p, notes: [[0.01, 36, 0.1, 1]] }).L;
  assert.ok(db(rms(held, 0.6, 0.8)) > -6, `held note fell to ${db(rms(held, 0.6, 0.8)).toFixed(1)}dB`);
  assert.ok(db(rms(let_go, 0.6, 0.8)) < -40, `released note still at ${db(rms(let_go, 0.6, 0.8)).toFixed(1)}dB`);
  // Once the step ends it decays at the decay knob's rate: still there just
  // after, gone soon after that.
  assert.ok(db(rms(held, 0.82, 0.9)) > -30, "the release cut the note dead");
  assert.ok(db(rms(held, 1.3, 1.5)) < -60, "the release did not decay");
});

test("siege: both drives add harmonics, never pass full scale, and the fold lifts the tail", () => {
  const f = hz(36);
  const clean = render({ secs: 1.5, params: { ...PLAIN, decay: 0.7 } }).L;
  const fold = render({ secs: 1.5, set: { mode: false }, params: { click: 0, drive: 1, decay: 0.7 } }).L;
  const clip = render({ secs: 1.5, set: { mode: true }, params: { click: 0, drive: 1, decay: 0.7 } }).L;
  const third = (a) => db(tone(a, 3 * f, 0.02, 0.12) / tone(a, f, 0.02, 0.12));
  assert.ok(third(clean) < -40, `a clean kick has a third harmonic at ${third(clean).toFixed(1)}dB`);
  assert.ok(third(fold) > -15, `the fold's third harmonic is only ${third(fold).toFixed(1)}dB`);
  assert.ok(third(clip) > -15, `the clipper's third harmonic is only ${third(clip).toFixed(1)}dB`);
  for (const [name, a] of [["clean", clean], ["fold", fold], ["clip", clip]]) {
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${name}: not finite at ${i}`);
    assert.ok(peak(a) < 1, `${name}: peak ${peak(a)}`);
  }
  // The drive sits after the envelope: the tail, where the sine is small, is
  // only made louder, so a driven kick reads longer than a clean one.
  assert.ok(db(rms(fold, 1, 1.4)) > db(rms(clean, 1, 1.4)) + 10, "the fold did not lift the tail");
  assert.ok(db(rms(clip, 1, 1.4)) > db(rms(clean, 1, 1.4)) + 10, "the clipper did not lift the tail");
  // Every drive setting on both circuits stays finite and under full scale,
  // through the click's sweep too.
  for (const mode of [false, true]) {
    for (const drive of [0.25, 0.5, 0.75, 1]) {
      const a = render({ secs: 0.5, set: { mode }, params: { drive, click: 1, depth: 0.5, decay: 0.5 } }).L;
      for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]));
      assert.ok(peak(a) < 1, `mode ${mode} drive ${drive}: peak ${peak(a)}`);
    }
  }
});

test("siege: the low cut takes the infrasound and leaves a C1 alone", () => {
  // C0 is 16Hz, well under the 30Hz corner; C1 is 33Hz, just over it; C2 is
  // where a kick lives.
  const p = { ...PLAIN, decay: 0.8 };
  const cut = (midi) => {
    const off = render({ params: p, notes: [[0, midi, 0.25, 1]] }).L;
    const on = render({ set: { hpf: true }, params: p, notes: [[0, midi, 0.25, 1]] }).L;
    return db(tone(on, hz(midi), 0.1, 0.9) / tone(off, hz(midi), 0.1, 0.9));
  };
  assert.ok(cut(12) < -12, `16Hz only cut by ${cut(12).toFixed(1)}dB`);
  assert.ok(cut(24) > -3, `a C1 cut by ${(-cut(24)).toFixed(1)}dB`);
  assert.ok(cut(36) > -0.5, `a C2 cut by ${(-cut(36)).toFixed(1)}dB`);
});

test("siege: pitch lock keeps the tuning and lets a note pick only the octave", () => {
  const p = { ...PLAIN, decay: 0.8 };
  for (const [midi, want] of [[36, 36], [38, 36], [41, 36], [43, 48], [48, 48], [30, 36], [29, 24]]) {
    const { L } = render({ set: { lock: true }, params: p, notes: [[0, midi, 0.25, 1]] });
    const got = pitchOf(L, 0.1, 0.5);
    assert.ok(Math.abs(got / hz(want) - 1) < 0.01, `locked, midi ${midi} played ${got.toFixed(1)}Hz, wanted ${hz(want).toFixed(1)}`);
  }
  // With tune up a fifth the lock keeps that fifth.
  const { L } = render({ set: { lock: true }, params: { ...p, tune: 0.5 + 7 / 24 }, notes: [[0, 40, 0.25, 1]] });
  assert.ok(Math.abs(pitchOf(L, 0.1, 0.5) / hz(43) - 1) < 0.01, "lock lost the tuning");
});

test("siege: velocity runs the level from the floor to full", () => {
  const p = { ...PLAIN, decay: 0.8 };
  const full = render({ params: p, notes: [[0.01, 36, 0.25, 1]] }).L;
  const soft = render({ params: { ...p, floor: 0.5 }, notes: [[0.01, 36, 0.25, 0.2]] }).L;
  const flat = render({ params: { ...p, floor: 1 }, notes: [[0.01, 36, 0.25, 0.2]] }).L;
  const ratio = rms(soft, 0.1, 0.3) / rms(full, 0.1, 0.3);
  assert.ok(Math.abs(ratio - 0.6) < 0.02, `velocity 0.2 over a floor of 0.5 played at ${ratio.toFixed(3)} of full`);
  assert.ok(Math.abs(rms(flat, 0.1, 0.3) / rms(full, 0.1, 0.3) - 1) < 0.01, "floor 1 still heard velocity");
});

test("siege: a retrigger over a sounding note does not click", () => {
  // The worst sample-to-sample jump around the second hit, against the
  // steepest slope the sine itself has at that level.
  const p = { ...PLAIN, decay: 0.9 };
  const { L } = render({ secs: 0.6, params: p, notes: [[0.01, 36, 0.25, 1], [0.2, 36, 0.25, 1]] });
  const slope = 2 * Math.PI * hz(36) / SR * 0.85;
  let worst = 0;
  for (let i = Math.round(0.19 * SR); i < Math.round(0.22 * SR); i++) worst = Math.max(worst, Math.abs(L[i] - L[i - 1]));
  assert.ok(worst < slope * 6, `jump at the retrigger ${(worst / slope).toFixed(1)}x the sine's own slope`);
  // And the second hit is a whole hit: as loud as the first.
  assert.ok(Math.abs(db(rms(L, 0.25, 0.3)) - db(rms(L, 0.06, 0.11))) < 1);
});

test("siege: a stop lets the drum go, and a finished hit is digital silence", () => {
  const stopped = render({ params: { ...PLAIN, decay: 1 }, events: [[0.3, { type: "off", when: 0.3 }]] }).L;
  assert.ok(db(rms(stopped, 0.2, 0.3)) > -10, "the drum was not sounding before the stop");
  assert.ok(db(rms(stopped, 0.5, 1)) < -80, `still ringing after the stop: ${db(rms(stopped, 0.5, 1)).toFixed(1)}dB`);
  const { L } = render({ secs: 3, params: { ...PLAIN, decay: 0.2 } });
  for (let i = Math.round(2 * SR); i < L.length; i++) assert.equal(L[i], 0);
});

test("siege: every kick plays at a sane level and under full scale", () => {
  for (const name of SIEGE_TONE_NAMES) {
    const t = siegeTone(name);
    const set = { mode: t.sgemode === "clip", gate: t.sgegate === "gate", hpf: t.sgehpf === "on", lock: t.sgelock === "on" };
    const params = { drive: t.harm, click: t.timb, depth: t.morph, decay: t.decay, tune: t.sgetune, floor: t.sgefloor };
    const { L } = render({ secs: 1, set, params, notes: [[0.01, 36, 0.25, 1]] });
    for (let i = 0; i < L.length; i++) assert.ok(Number.isFinite(L[i]), `${name}: not finite`);
    assert.ok(peak(L) < 1, `${name}: peak ${peak(L)}`);
    const lvl = db(rms(L, 0.01, 0.1));
    assert.ok(lvl > -20 && lvl < 0, `${name}: ${lvl.toFixed(1)}dBFS at the attack`);
  }
});

test("siege: the song builder, the MCP description and Strudel know it", () => {
  const song = B.newSong({ bpm: 128 });
  const { index: i } = B.addTrack(song, { engine: "siege", name: "kick" });
  assert.equal(song.tracks[i].engineKey, "dm:siege");
  assert.equal(song.tracks[i].isDrumKit, true, "a siege track is a drum kit");
  B.applyPreset(song, i, "techno");
  assert.equal(song.tracks[i].params.sgemode, "clip");
  assert.equal(song.tracks[i].params.harm, 0.75);
  B.setParams(song, i, { sgetune: 0.6, sgegate: "gate" });
  assert.throws(() => B.setParams(song, i, { sgemode: "warm" }), /sgemode/);
  assert.throws(() => B.setParams(song, i, { sgetune: 2 }), /sgetune/);
  const d = B.describeEngine("dm:siege");
  assert.equal(d.sliders.timb.label, "click");
  assert.ok(d.presets.some(p => p.name === "909"));
  B.addLfo(song, i, { target: "siege_tune", shape: "sine", amount: 0.2 });
  B.setAutomation(song, i, { target: "siege.floor", values: [0, 0.5, 1, 0.5] });

  // Strudel: by name in, by name out, and every panel control round-trips.
  const read = readCode(`kick: s("siege*4").knob("sgetune", 0.6).knob("sgehpf", "on").knob("sgemode", "clip").knob("sgegate", "gate")`);
  const out = B.newSong({ bpm: 128 });
  writeTracks(out, realize(read));
  const t = out.tracks.find(x => x.engineKey === "dm:siege");
  assert.ok(t, "no siege track from code");
  assert.equal(t.params.sgemode, "clip");
  assert.equal(t.params.sgehpf, "on");
  assert.equal(t.params.sgetune, 0.6);
  const code = sessionToCode(out, { native: true }).code;
  assert.match(code, /\.s\("siege"\)/);
  const back = B.newSong({ bpm: 128 });
  writeTracks(back, realize(readCode(code)));
  const again = back.tracks.find(x => x.engineKey === "dm:siege");
  assert.ok(again, "the written code lost the siege");
  for (const k of ["sgemode", "sgegate", "sgehpf", "sgelock", "sgetune", "sgefloor", "harm", "timb", "morph", "decay"]) {
    assert.equal(again.params[k], t.params[k], `${k} did not round-trip`);
  }
});
