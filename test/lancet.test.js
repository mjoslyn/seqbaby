import assert from "node:assert/strict";
import test from "node:test";

import {
  LANCET_DEFAULTS, LANCET_MODELS, LANCET_MODEL_TIPS, LANCET_NUM_CTLS, LANCET_SEL_CTLS, LANCET_TONE_NAMES, lancetTone, lancetFromUnit,
} from "../public/js/engineData.js";
import { lancetProcessorSource } from "../public/js/lancet.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, voiceFor, writeTracks } from "../public/js/strudel.js";

// The lancet, rendered outside a browser, as vox.test.js renders the vox.
//
// What is pinned is what lancet.js claims: every one of the seven models
// sounds, stays finite and under full scale at every corner of its knobs,
// decays and then stops; the pitch follows the note; the decay knob is a
// length; timbre and color do, on each model, what lancet.js says they do; the fx stage is in the signal and off at zero; velocity is a
// level and a little more; the randomizer throws what it is told to and
// nothing else; a roll does not choke; and the panel, the builder and the
// code drawer all speak the same tables.

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
  return new Function(`${prelude}${lancetProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));

/** The body a note plays, as the builder posts it: C2 is 180Hz. */
const bodyHz = (midi) => 180 * Math.pow(2, (midi - 36) / 12);

/**
 * Render on a fresh processor. `hits` are [seconds, midi, vel?]; `events`
 * are [seconds, message] pairs posted when the render reaches them.
 */
function render({ secs = 2, model = "analog", params = {}, hits = [[0.05, 36, 1]], events = [] } = {}) {
  globalThis.currentFrame = 0;
  const inst = new Cls();
  inst.onMessage({ type: "set", model: LANCET_MODELS.indexOf(model) });
  let id = 0;
  for (const [when, midi, vel = 1] of hits) inst.onMessage({ type: "note", when, id: ++id, freq: bodyHz(midi), vel });
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
  return { L, R, inst };
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
function peak(a, t0 = 0, t1 = a.length / SR) {
  let p = 0;
  for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { const v = Math.abs(a[i]); if (v > p) p = v; }
  return p;
}
function rms(a, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / (i1 - i0));
}
/** Where the sound ends: the last sample over -60dB, in seconds. */
function lastSound(a) {
  for (let i = a.length - 1; i >= 0; i--) if (Math.abs(a[i]) > 1e-3) return i / SR;
  return 0;
}
function finite(a) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }
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
/** The strongest of a set of candidate frequencies in a stretch. */
function strongest(a, cands, t0, t1) {
  let best = -1, bf = 0;
  for (const f of cands) { const m = tone(a, f, t0, t1); if (m > best) { best = m; bf = f; } }
  return bf;
}
/** How much of a stretch's power sits above `hz`: a brightness meter. */
function highShare(a, hz, t0, t1) {
  const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  const c = 1 - Math.exp(-2 * Math.PI * hz / SR);
  let lp = 0, hi = 0, all = 0;
  for (let i = i0; i < i1; i++) { lp += c * (a[i] - lp); const h = a[i] - lp; hi += h * h; all += a[i] * a[i]; }
  return all > 0 ? hi / all : 0;
}

const GRID = [[0, 0], [0.5, 0.5], [1, 1], [0, 1], [1, 0]];

test("lancet: the tables agree with the processor", () => {
  const names = new Set(Cls.parameterDescriptors.map(d => d.name));
  for (const [k] of LANCET_NUM_CTLS) assert.ok(names.has(k), `no param ${k}`);
  for (const k of ["timbre", "color", "fx", "decay"]) assert.ok(names.has(k));
  for (const [k, lo, hi, def] of LANCET_NUM_CTLS) {
    const d = Cls.parameterDescriptors.find(x => x.name === k);
    assert.deepEqual([d.minValue, d.maxValue, d.defaultValue], [lo, hi, def], `${k}: range or default differs`);
    assert.equal(LANCET_DEFAULTS[`lnc${k}`], def);
  }
  assert.equal(LANCET_MODELS.length, 7);
  assert.deepEqual(LANCET_SEL_CTLS[0], ["model", "analog", LANCET_MODELS]);
  for (const m of LANCET_MODELS) assert.ok(LANCET_MODEL_TIPS[m].length > 40, `${m} has no tip`);
  assert.equal(lancetFromUnit("tune", 0), -12);
  assert.equal(lancetFromUnit("tune", 1), 12);
  assert.equal(lancetFromUnit("rdecay", 0.5), 0.5);
  for (const name of LANCET_TONE_NAMES) {
    const t = lancetTone(name);
    assert.ok(LANCET_MODELS.includes(t.lncmodel), `${name} names no model`);
    for (const [k, lo, hi] of LANCET_NUM_CTLS) assert.ok(t[`lnc${k}`] >= lo && t[`lnc${k}`] <= hi, `${name}: ${k} out of range`);
    for (const k of ["harm", "timb", "morph", "decay"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
  }
});

test("lancet: every model sounds at every corner, finite, under full scale, and then stops", () => {
  for (const model of LANCET_MODELS) {
    for (const [timbre, color] of GRID) {
      for (const fx of [0, 1]) {
        const { L, inst } = render({ model, params: { timbre, color, fx }, secs: 2.5 });
        const label = `${model} t${timbre} c${color} fx${fx}`;
        assert.ok(finite(L), `${label}: not finite`);
        const p = peak(L);
        assert.ok(p < 1, `${label}: over full scale (${p})`);
        assert.ok(db(p) > -14, `${label}: too quiet (${db(p).toFixed(1)}dB)`);
        assert.ok(lastSound(L) < 1.5, `${label}: still sounding at ${lastSound(L).toFixed(2)}s`);
        assert.ok(inst.voices.every(v => !v.on), `${label}: a voice is still on`);
      }
    }
  }
});

test("lancet: the model select changes the sound and not the level", () => {
  const levels = LANCET_MODELS.map(model => db(rms(render({ model, params: { fx: 0 } }).L, 0.05, 0.4)));
  const spread = Math.max(...levels) - Math.min(...levels);
  assert.ok(spread < 9, `models spread ${spread.toFixed(1)}dB: ${levels.map(l => l.toFixed(1)).join(" ")}`);
});

test("lancet: the pitch follows the note, two octaves either side of C2", () => {
  for (const midi of [24, 36, 48, 60]) {
    const f0 = bodyHz(midi);
    const { L } = render({ model: "analog", params: { timbre: 0, color: 0, fx: 0, decay: 0.7 }, hits: [[0.05, midi, 1]], secs: 1 });
    // after the pitch envelope, the body sits on its note
    const cands = [f0 / 2, f0 / Math.SQRT2, f0, f0 * Math.SQRT2, f0 * 2];
    assert.equal(strongest(L, cands, 0.12, 0.4), f0, `note ${midi}`);
  }
  // tune moves it a semitone a semitone
  const f0 = bodyHz(36);
  const up = render({ model: "analog", params: { timbre: 0, color: 0, fx: 0, decay: 0.7, tune: 7 }, secs: 1 }).L;
  const fifth = f0 * Math.pow(2, 7 / 12);
  assert.equal(strongest(up, [f0, fifth, f0 * 2], 0.12, 0.4), fifth);
});

test("lancet: decay is a length, on every model", () => {
  for (const model of LANCET_MODELS) {
    const short = lastSound(render({ model, params: { decay: 0, fx: 0 }, secs: 3 }).L);
    const mid = lastSound(render({ model, params: { decay: 0.4, fx: 0 }, secs: 3 }).L);
    const long = lastSound(render({ model, params: { decay: 1, fx: 0 }, secs: 3 }).L);
    assert.ok(short < mid && mid < long, `${model}: ${short.toFixed(2)} ${mid.toFixed(2)} ${long.toFixed(2)}`);
    assert.ok(short < 0.25, `${model}: shortest decay is ${short.toFixed(2)}s`);
    assert.ok(long > 1.2, `${model}: longest decay is ${long.toFixed(2)}s`);
  }
});

test("lancet: timbre is the noise on the analog, slap, modal and fm models: brighter and more of it", () => {
  for (const model of ["analog", "slap", "modal", "fm"]) {
    const dark = render({ model, params: { timbre: 0, fx: 0 } }).L;
    const bright = render({ model, params: { timbre: 1, fx: 0 } }).L;
    assert.ok(highShare(bright, 2500, 0.05, 0.3) > highShare(dark, 2500, 0.05, 0.3) * 1.5,
      `${model}: timbre 1 is not brighter than 0`);
  }
});

test("lancet: color is the pitch envelope and the shell balance on the analog model", () => {
  const f0 = bodyHz(36);
  const flat = render({ model: "analog", params: { color: 0, timbre: 0, fx: 0 } }).L;
  const dropped = render({ model: "analog", params: { color: 1, timbre: 0, fx: 0 } }).L;
  // with the envelope the first 10ms sit above the note; without, on it
  const above = [f0 * 1.5, f0 * 2];
  assert.ok(Math.max(...above.map(f => tone(dropped, f, 0.05, 0.075))) > Math.max(...above.map(f => tone(flat, f, 0.05, 0.075))) * 1.5);
  // the second shell comes up with color
  const second = (a) => tone(a, f0 * 1.83, 0.12, 0.3) / tone(a, f0, 0.12, 0.3);
  assert.ok(second(dropped) > second(flat) * 2, "the second shell does not come up with color");
});

test("lancet: color is the partials on the modal model, and the body on the physical", () => {
  const f0 = bodyHz(36);
  const partials = (a) => tone(a, f0 * 1.59, 0.1, 0.4) / tone(a, f0, 0.1, 0.4);
  const fund = render({ model: "modal", params: { color: 0, timbre: 0, fx: 0 } }).L;
  const rich = render({ model: "modal", params: { color: 1, timbre: 0, fx: 0 } }).L;
  assert.ok(partials(rich) > partials(fund) * 3, "the partials do not come up with color");
  // physical: harmonic modes at 0 (the second line at 2f), a membrane's at 1 (1.59f)
  const harm = render({ model: "physical", params: { color: 0, timbre: 0.5, fx: 0 } }).L;
  const memb = render({ model: "physical", params: { color: 1, timbre: 0.5, fx: 0 } }).L;
  // the fundamental's line rings on 2f whichever body it is, so the modes are
  // compared body against body, not against each other
  const at = (a, r) => tone(a, f0 * r, 0.08, 0.3);
  assert.ok(at(memb, 1.59) > at(harm, 1.59) * 2, "the membrane body has no more 1.59 mode than the harmonic one");
  assert.ok(at(harm, 2) > at(memb, 2) * 1.3, "the harmonic body has no more second harmonic than the membrane one");
});

test("lancet: color moves the fm model's modulators, and the granular model's grains", () => {
  const low = render({ model: "fm", params: { color: 0, timbre: 0.3, fx: 0 } }).L;
  const high = render({ model: "fm", params: { color: 1, timbre: 0.3, fx: 0 } }).L;
  assert.ok(highShare(high, 1500, 0.05, 0.2) > highShare(low, 1500, 0.05, 0.2) * 1.3, "higher ratios are not brighter");
  const sparse = render({ model: "granular", params: { color: 0, timbre: 0.5, fx: 0 } }).L;
  const dense = render({ model: "granular", params: { color: 1, timbre: 0.5, fx: 0 } }).L;
  assert.ok(highShare(dense, 3000, 0.05, 0.3) > highShare(sparse, 3000, 0.05, 0.3) * 1.3, "high dense grains are not brighter");
});

test("lancet: timbre picks the granular source and crossfades the blend's layers", () => {
  // a coin source (3) rings high; sand (4) is dull; the crossfade between is between
  const coin = highShare(render({ model: "granular", params: { timbre: 0.75, fx: 0 } }).L, 4000, 0.05, 0.3);
  const sand = highShare(render({ model: "granular", params: { timbre: 1, fx: 0 } }).L, 4000, 0.05, 0.3);
  const mid = highShare(render({ model: "granular", params: { timbre: 0.875, fx: 0 } }).L, 4000, 0.05, 0.3);
  assert.ok(coin > sand * 1.3, "coin is not brighter than sand");
  assert.ok(mid < coin && mid > sand, "the crossfade is not between its ends");
  const paper = highShare(render({ model: "blend", params: { timbre: 0, color: 0.5, fx: 0 } }).L, 3500, 0.05, 0.2);
  const splash = highShare(render({ model: "blend", params: { timbre: 1 / 3, color: 0.5, fx: 0 } }).L, 3500, 0.05, 0.2);
  assert.ok(splash > paper * 1.2, "the splash layer is not brighter than paper");
});

test("lancet: the fx stage is off at zero and in the signal above it, on every model", () => {
  for (const model of LANCET_MODELS) {
    const clean = render({ model, params: { fx: 0 } }).L;
    const faint = render({ model, params: { fx: 0.03 } }).L;
    const full = render({ model, params: { fx: 1 } }).L;
    // the bottom of the knob is nearly clean: a small amount barely changes it
    let d = 0, e = 0;
    for (let i = 0; i < clean.length; i++) { d += (clean[i] - faint[i]) ** 2; e += clean[i] ** 2; }
    assert.ok(d / e < 0.15, `${model}: fx 0.03 changes the signal by ${(d / e).toFixed(2)}`);
    let d2 = 0;
    for (let i = 0; i < clean.length; i++) d2 += (clean[i] - full[i]) ** 2;
    assert.ok(d2 / e > 0.1, `${model}: fx 1 barely changes the signal (${(d2 / e).toFixed(3)})`);
    assert.ok(peak(full) < 1 && finite(full), `${model}: fx 1 clips or is not finite`);
  }
  // the clipper and the sampler each make the hit denser, not louder: rms up, peak not
  for (const model of ["analog", "blend", "modal"]) {
    const clean = render({ model, params: { fx: 0 } }).L;
    const full = render({ model, params: { fx: 1 } }).L;
    assert.ok(rms(full, 0.05, 0.3) > rms(clean, 0.05, 0.3) * 1.15, `${model}: fx adds no density`);
    assert.ok(peak(full) < peak(clean) * 1.25, `${model}: fx is only louder`);
  }
});

test("lancet: velocity is a level, and a little more, by as much as dyn says", () => {
  const hard = render({ hits: [[0.05, 36, 1]], params: { dyn: 1, fx: 0 } }).L;
  const soft = render({ hits: [[0.05, 36, 0.3]], params: { dyn: 1, fx: 0 } }).L;
  const softNoDyn = render({ hits: [[0.05, 36, 0.3]], params: { dyn: 0, fx: 0 } }).L;
  assert.ok(db(peak(soft)) < db(peak(hard)) - 6, "a soft hit is not quieter");
  assert.ok(Math.abs(db(peak(softNoDyn)) - db(peak(hard))) < 1, "dyn 0 still follows velocity");
  // and duller: timbre is pushed down with the velocity
  assert.ok(highShare(soft, 2500, 0.05, 0.3) < highShare(hard, 2500, 0.05, 0.3), "a soft hit is not duller");
});

test("lancet: the randomizer throws what it is told to and nothing else", () => {
  const f0 = bodyHz(36);
  const hits = Array.from({ length: 8 }, (_, i) => [0.05 + i * 0.6, 36, 1]);
  const fund = (a, i) => strongest(a, [f0 / 2, f0 / 1.3348, f0, f0 * 1.3348, f0 * 2], 0.05 + i * 0.6 + 0.07, 0.05 + i * 0.6 + 0.3);
  const lvl = (a, i) => db(peak(a, 0.05 + i * 0.6, 0.05 + i * 0.6 + 0.5));
  // nothing random: the same note, the same level, eight times
  const plain = render({ hits, params: { timbre: 0, color: 0, fx: 0 }, secs: 5 }).L;
  for (let i = 0; i < 8; i++) {
    assert.equal(fund(plain, i), f0, `hit ${i} moved with nothing random`);
    assert.ok(Math.abs(lvl(plain, i) - lvl(plain, 0)) < 1, `hit ${i} changed level with nothing random`);
  }
  // pitch: the fundamental moves, the level does not
  const pitched = render({ hits, params: { timbre: 0, color: 0, fx: 0, rpitch: 1 }, secs: 5 }).L;
  assert.ok(new Set(Array.from({ length: 8 }, (_, i) => fund(pitched, i))).size > 1, "rpitch moved nothing");
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(lvl(pitched, i) - lvl(plain, 0)) < 3, `rpitch moved the level of hit ${i}`);
  // level: the level moves, the note does not
  const levelled = render({ hits, params: { timbre: 0, color: 0, fx: 0, rlevel: 1 }, secs: 5 }).L;
  const ls = Array.from({ length: 8 }, (_, i) => lvl(levelled, i));
  assert.ok(Math.max(...ls) - Math.min(...ls) > 4, "rlevel moved nothing");
  for (let i = 0; i < 8; i++) assert.equal(fund(levelled, i), f0, `rlevel moved the note of hit ${i}`);
  // model: hits land on different models (the physical and fm models have no second shell)
  const { inst } = render({ hits, params: { rmodel: 1 }, secs: 5 });
  // the chance is per hit, so the last four voices used hold a mix of models
  const models = new Set(inst.voices.map(v => v.model));
  assert.ok(models.size > 1, "rmodel picked one model eight times");
});

test("lancet: a roll does not choke, and a stop lets it go", () => {
  const hits = Array.from({ length: 24 }, (_, i) => [0.05 + i * 0.02, 36, 0.6 + (i % 3) * 0.2]);
  const { L, inst } = render({ hits, params: { decay: 0.6 }, secs: 3 });
  assert.ok(finite(L) && peak(L) < 1);
  assert.ok(rms(L, 0.1, 0.5) > rms(L, 0.05, 0.1) * 0.5, "the roll thins out");
  assert.ok(inst.voices.every(v => !v.on), "a voice is stuck after the roll");
  // a stop fades everything
  const stopped = render({ params: { decay: 1 }, events: [[0.3, { type: "off", when: 0.3 }]], secs: 1 }).L;
  assert.ok(peak(stopped, 0.1, 0.3) > 0.02, "nothing was sounding to stop");
  assert.equal(peak(stopped, 0.35, 1), 0, "a stop left something sounding");
});

test("lancet: every strike sounds, finite and under full scale", () => {
  for (const name of LANCET_TONE_NAMES) {
    const t = lancetTone(name);
    const params = { timbre: t.harm, color: t.timb, fx: t.morph, decay: t.decay };
    for (const [k] of LANCET_NUM_CTLS) params[k] = t[`lnc${k}`];
    const { L } = render({ model: t.lncmodel, params, hits: [[0.05, 36, 1], [0.3, 36, 0.5]], secs: 2 });
    assert.ok(finite(L), `${name}: not finite`);
    assert.ok(peak(L) < 1 && db(peak(L)) > -16, `${name}: level ${db(peak(L)).toFixed(1)}dB`);
  }
});

test("lancet: the panel markup matches the tables", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const LANCET_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of LANCET_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-lnc${k}" type="range" min="(-?[\\d.]+)" max="(-?[\\d.]+)" step="[\\d.]+" value="(-?[\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of LANCET_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-lnc${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    const opts = [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]);
    assert.deepEqual(opts, values, `${k}: options differ`);
    assert.ok(m[1].includes(`value="${def}" selected`), `${k}: default ${def} not selected`);
  }
  assert.ok(src.includes("${LANCET_PANEL}"), "the panel is not in the track template");
});

test("lancet: the song builder knows it as a drum, with its panel and its strikes", () => {
  const song = B.newSong();
  const { index } = B.addTrack(song, { engine: "lancet", name: "snare" });
  assert.equal(song.tracks[index].engineKey, "dm:lancet");
  assert.equal(song.tracks[index].isDrumKit, true);
  const plain = B.addTrack(song, { engine: "dm:lancet", name: "two" });
  assert.equal(song.tracks[plain.index].isDrumKit, true, "a lancet is a drum whatever it is called");
  B.setParams(song, index, { lncmodel: "fm", lnctune: -5, lncrpitch: 0.5 });
  assert.equal(song.tracks[index].params.lncmodel, "fm");
  assert.equal(song.tracks[index].params.lnctune, -5);
  assert.throws(() => B.setParams(song, index, { lncmodel: "sample" }), /lncmodel/);
  assert.throws(() => B.setParams(song, index, { lnctune: 13 }), /lnctune/);
  const d = B.describeEngine("dm:lancet");
  assert.equal(d.melodic, false);
  assert.equal(d.sliders.harm.label, "timbre");
  assert.equal(d.sliders.morph.label, "fx");
  assert.equal(d.presets.length, LANCET_TONE_NAMES.length);
  assert.ok(d.panel.select.some(s => s.key === "lncmodel" && s.values.length === 7));
  assert.ok(d.panel.numeric.some(c => c.key === "lnctune" && c.min === -12));
  assert.ok(d.lfoTargets.includes("lancet_tune") && d.automationTargets.includes("lancet.rpitch"));
  assert.ok(d.lfoTargets.includes("harm") && !d.lfoTargets.includes("vox_vib"));
  const r = B.applyPreset(song, index, "boom bap");
  assert.equal(r.preset, "boom bap");
  assert.equal(song.tracks[index].params.lncmodel, "blend");
  assert.equal(song.tracks[index].params.morph, 0.55);
});

test("lancet: Strudel reaches it by name and by bank, and a song round-trips", () => {
  assert.deepEqual(voiceFor("lancet"), { engine: "dm:lancet", drum: true, exact: true, native: true });
  assert.equal(voiceFor("sd", { bank: "lancet" }).engine, "dm:lancet");
  assert.equal(voiceFor("cp", { bank: "lancet" }).engine, "dm:lancet");
  assert.equal(voiceFor("bd", { bank: "lancet" }).engine, "dm:808-kick", "the lancet is a snare, the kick goes to the 808");
  const song = B.newSong();
  B.addTrack(song, { engine: "lancet", name: "snare" });
  B.setParams(song, 0, { lncmodel: "modal", lnctune: 3, morph: 0.8 });
  B.setSteps(song, 0, { steps: "....x.......x..." });
  const code = sessionToCode(song, { native: true });
  const src = typeof code === "string" ? code : code.code;
  // a drum is named inside the mini-notation, as the 808 voices are
  assert.match(src, /s\("[^"]*lancet[^"]*"\)/);
  assert.match(src, /\.knob\('lncmodel', 'modal'\)/);
  assert.match(src, /\.knob\('lnctune', 3\)/);
  const back = B.newSong();
  writeTracks(back, realize(readCode(src)));
  assert.equal(back.tracks[0].engineKey, "dm:lancet");
  assert.equal(back.tracks[0].params.lncmodel, "modal");
  assert.equal(back.tracks[0].params.lnctune, 3);
  assert.equal(back.tracks[0].params.morph, 0.8);
  assert.deepEqual(back.tracks[0].patterns[0].steps.slice(0, 16), song.tracks[0].patterns[0].steps.slice(0, 16));
  // the portable form is a snare any Strudel plays
  const portable = sessionToCode(song);
  assert.match(typeof portable === "string" ? portable : portable.code, /s\("[^"]*\bsd\b[^"]*"\)/);
});
