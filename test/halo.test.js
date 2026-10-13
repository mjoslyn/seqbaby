import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  HALO_DEFAULTS, HALO_MODELS, HALO_MODEL_TIPS, HALO_NUM_CTLS, HALO_SEL_CTLS, HALO_TONE_NAMES, haloTone, haloFromUnit,
} from "../public/js/engineData.js";
import { haloProcessorSource } from "../public/js/halo.js";
import * as B from "../public/js/songBuilder.js";
import { readCode, realize, sessionToCode, voiceFor, writeTracks } from "../public/js/strudel.js";

// The halo, rendered outside a browser, as lancet.test.js renders the lancet.
//
// What is pinned is what halo.js claims: every model sounds, stays finite and
// under full scale at every corner of its knobs, rings and then stops, at
// about the same level as the others; the pitch follows the note, the tune
// and the size; the tone brightens and is read live; the decay is a length;
// choke mode makes the step's length the hat's and lets a hit cut the one
// before, while trig mode ignores both; the bloom swells; the width is
// mono-safe; velocity is a level; vary throws only when asked; a stop lets
// go; and the panel, the builder and the code drawer speak the same tables.

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
  return new Function(`${prelude}${haloProcessorSource()}\n return globalThis.__P;`)();
}
const Cls = processorClass();
const PARAM_DEFAULTS = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d.defaultValue]));
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Render on a fresh processor. `hits` are [seconds, midi, vel?, dur?];
 * `events` are [seconds, message] pairs posted when the render reaches them.
 * `params` may hold a function of the time for a knob that moves.
 */
function render({ secs = 2, model = "metal", choke = false, params = {}, hits = [[0.01, 36, 1, 0.1]], events = [] } = {}) {
  globalThis.currentFrame = 0;
  const inst = new Cls();
  inst.onMessage({ type: "set", model: HALO_MODELS.indexOf(model), choke });
  let id = 0;
  for (const [when, midi, vel = 1, dur = 0.1] of hits) inst.onMessage({ type: "note", when, id: ++id, freq: hz(midi), vel, dur });
  const pending = events.slice().sort((a, b) => a[0] - b[0]);
  const all = { ...PARAM_DEFAULTS, ...params };
  const P = {};
  for (const [k, v] of Object.entries(all)) P[k] = Float32Array.of(typeof v === "function" ? v(0) : v);
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const outs = [[new Float32Array(Q), new Float32Array(Q)]];
  let maxOn = 0;
  for (let b = 0; b * Q < n; b++) {
    globalThis.currentFrame = b * Q;
    for (const [k, v] of Object.entries(all)) if (typeof v === "function") P[k][0] = v(b * Q / SR);
    while (pending.length && pending[0][0] * SR <= b * Q) inst.onMessage(pending.shift()[1]);
    inst.process([], outs, P);
    maxOn = Math.max(maxOn, inst.voices.filter(v => v.on).length);
    const m = Math.min(Q, n - b * Q);
    L.set(outs[0][0].subarray(0, m), b * Q);
    R.set(outs[0][1].subarray(0, m), b * Q);
  }
  return { L, R, inst, maxOn };
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
/** The strongest frequency within 10% of `f`, at 0.5% steps. */
function strongestNear(a, f, t0, t1) {
  let best = -1, bf = 0;
  for (let r = 0.9; r <= 1.1001; r += 0.005) { const m = tone(a, f * r, t0, t1); if (m > best) { best = m; bf = f * r; } }
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
/** A preset as render() arguments. */
function presetArgs(name) {
  const t = haloTone(name);
  return {
    model: t.hlomodel, choke: t.hlochoke === "choke",
    params: { tone: t.harm, size: t.timb, spread: t.morph, decay: t.decay, tune: t.hlotune, dyn: t.hlodyn, stick: t.hlostick, bloom: t.hlobloom, width: t.hlowidth, vary: t.hlovary },
  };
}

test("halo: the tables agree with the processor and the markup", () => {
  const byName = Object.fromEntries(Cls.parameterDescriptors.map(d => [d.name, d]));
  for (const k of ["tone", "size", "spread", "decay"]) assert.ok(byName[k], `no param ${k}`);
  // The four track sliders' defaults are the track's own (soundDefaults.js).
  assert.deepEqual(["tone", "size", "spread", "decay"].map(k => byName[k].defaultValue), [0.5, 0.5, 0.5, 0.4]);
  for (const [k, lo, hi, def] of HALO_NUM_CTLS) {
    const d = byName[k];
    assert.ok(d, `no param ${k}`);
    assert.deepEqual([d.minValue, d.maxValue, d.defaultValue], [lo, hi, def], `${k}: range or default differs`);
    assert.equal(HALO_DEFAULTS[`hlo${k}`], def);
  }
  for (const m of HALO_MODELS) assert.ok(HALO_MODEL_TIPS[m].length > 40, `${m} has no tip`);
  assert.equal(haloFromUnit("tune", 0), -12);
  assert.equal(haloFromUnit("tune", 1), 12);
  for (const name of HALO_TONE_NAMES) {
    const t = haloTone(name);
    for (const k of Object.keys(HALO_DEFAULTS)) assert.ok(k in t, `${name}: ${k} missing`);
    for (const [k, , values] of HALO_SEL_CTLS) assert.ok(values.includes(t[`hlo${k}`]), `${name}: ${k} is ${t[`hlo${k}`]}`);
    for (const [k, lo, hi] of HALO_NUM_CTLS) assert.ok(t[`hlo${k}`] >= lo && t[`hlo${k}`] <= hi, `${name}: ${k} out of range`);
    for (const k of ["harm", "timb", "morph", "decay"]) assert.ok(t[k] >= 0 && t[k] <= 1, `${name}: ${k}`);
  }
  const src = fs.readFileSync(new URL("../app/studioMarkup.ts", import.meta.url), "utf8");
  const panel = src.match(/const HALO_PANEL = `([\s\S]*?)`;/)[1];
  for (const [k, lo, hi, def] of HALO_NUM_CTLS) {
    const m = panel.match(new RegExp(`class="p-hlo${k}" type="range" min="(-?[\\d.]+)" max="([\\d.]+)" step="[\\d.]+" value="([\\d.]+)"`));
    assert.ok(m, `no knob for ${k}`);
    assert.deepEqual(m.slice(1).map(Number), [lo, hi, def], `${k}: markup range or default differs`);
  }
  for (const [k, def, values] of HALO_SEL_CTLS) {
    const m = panel.match(new RegExp(`<select class="p-hlo${k}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(m, `no select for ${k}`);
    assert.deepEqual([...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]), values, `${k}: the options differ from the table`);
    assert.equal(m[1].match(/value="([^"]*)" selected/)?.[1], def, `${k}: the markup's default differs`);
  }
});

test("halo: every model sounds at every corner, finite, under full scale, and then stops", () => {
  const corners = [0, 1];
  for (const model of HALO_MODELS) {
    for (const t of corners) for (const s of corners) for (const sp of corners) {
      const { L, R } = render({ secs: 1.2, model, params: { tone: t, size: s, spread: sp, decay: 0.3, bloom: sp } });
      const what = `${model} tone ${t} size ${s} spread ${sp}`;
      assert.ok(finite(L) && finite(R), `${what}: not finite`);
      assert.ok(peak(L) < 1 && peak(R) < 1, `${what}: peak ${peak(L)}`);
      assert.ok(db(rms(L, 0.01, 0.06)) > -45, `${what}: silent at ${db(rms(L, 0.01, 0.06)).toFixed(1)}dB`);
      assert.ok(lastSound(L) < 1.1, `${what}: still ringing at ${lastSound(L).toFixed(2)}s`);
    }
    // A finished hit is digital silence, both sides, the width's tails included.
    const { L, R } = render({ secs: 2, model, params: { decay: 0.2 } });
    for (let i = Math.round(1.5 * SR); i < L.length; i++) { assert.equal(L[i], 0); assert.equal(R[i], 0); }
  }
});

test("halo: the model select changes the sound, not the level", () => {
  const lvl = HALO_MODELS.map(model => db(rms(render({ model, params: { vary: 0 } }).L, 0.012, 0.04)));
  const spread = Math.max(...lvl) - Math.min(...lvl);
  assert.ok(spread < 3, `models span ${spread.toFixed(1)}dB: ${lvl.map(x => x.toFixed(1)).join(" ")}`);
});

test("halo: the pitch follows the note, the tune and the size", () => {
  // The fm model's first carrier is 1180Hz at C2, size 0.5; at the bottom of
  // the spread its index is low enough that the carrier is the strongest thing
  // near it.
  const p = { spread: 0, decay: 0.7, vary: 0, stick: 0, tone: 0.2 };
  const at = (opts, want) => {
    const { L } = render({ model: "fm", secs: 0.5, ...opts, params: { ...p, ...opts.params } });
    const got = strongestNear(L, want, 0.05, 0.25);
    assert.ok(Math.abs(got / want - 1) < 0.006, `wanted ${want.toFixed(0)}Hz, the strongest was ${got.toFixed(0)}Hz`);
  };
  at({ hits: [[0.01, 36, 1]] }, 1180);
  at({ hits: [[0.01, 48, 1]] }, 2360);
  at({ hits: [[0.01, 31, 1]] }, 1180 * Math.pow(2, -5 / 12));
  at({ hits: [[0.01, 36, 1]], params: { tune: 7 } }, 1180 * Math.pow(2, 7 / 12));
  // Bigger is lower: size 1 an octave and a half down, size 0 as far up.
  at({ hits: [[0.01, 36, 1]], params: { size: 1 } }, 1180 / Math.pow(2, 1.5));
  at({ hits: [[0.01, 36, 1]], params: { size: 0 } }, 1180 * Math.pow(2, 1.5));
});

test("halo: the tone brightens every model, and is read live", () => {
  for (const model of HALO_MODELS) {
    const dark = highShare(render({ model, params: { tone: 0.1, vary: 0 } }).L, 6000, 0.012, 0.1);
    const bright = highShare(render({ model, params: { tone: 0.9, vary: 0 } }).L, 6000, 0.012, 0.1);
    assert.ok(bright > dark * 1.5, `${model}: tone 0.9 has ${(bright * 100).toFixed(0)}% over 6k, tone 0.1 ${(dark * 100).toFixed(0)}%`);
  }
  // A crash already ringing opens when the knob moves: the hit was struck dark.
  const p = { decay: 0.9, vary: 0 };
  const opened = render({ model: "modal", params: { ...p, tone: (t) => t < 0.5 ? 0.1 : 0.9 } }).L;
  const shut = render({ model: "modal", params: { ...p, tone: 0.1 } }).L;
  assert.ok(highShare(opened, 6000, 0.6, 0.9) > highShare(shut, 6000, 0.6, 0.9) * 1.5, "the tone was latched at the hit");
});

test("halo: the decay is a length, and trig mode ignores the step's", () => {
  for (const model of HALO_MODELS) {
    const ends = [0.1, 0.5, 0.8].map(decay => lastSound(render({ secs: 6, model, params: { decay, vary: 0 } }).L));
    assert.ok(ends[0] < ends[1] && ends[1] < ends[2], `${model}: ends at ${ends.map(e => e.toFixed(2)).join(" / ")}s`);
  }
  const a = render({ model: "metal", params: { decay: 0.6, vary: 0, stick: 0 }, hits: [[0.01, 36, 1, 0.02]] }).L;
  const b = render({ model: "metal", params: { decay: 0.6, vary: 0, stick: 0 }, hits: [[0.01, 36, 1, 1.5]] }).L;
  assert.deepEqual(a, b, "a trigger heard its step's length");
});

test("halo: choke mode cuts a hit when its step ends, and the next hit cuts the one before", () => {
  const p = { decay: 0.8, vary: 0 };
  // The step's length is how long the hat is open: closed and open from one track.
  const closed = render({ choke: true, params: p, hits: [[0.01, 36, 1, 0.05]] }).L;
  const open = render({ choke: true, params: p, hits: [[0.01, 36, 1, 0.4]] }).L;
  assert.ok(lastSound(closed) < 0.1, `a 50ms step rang to ${lastSound(closed).toFixed(3)}s`);
  assert.ok(lastSound(open) > 0.4 && lastSound(open) < 0.45, `a 400ms step rang to ${lastSound(open).toFixed(3)}s`);
  // A closed hat after an open one closes it: nothing of the first is left.
  const pair = render({ choke: true, params: p, hits: [[0.01, 36, 1, 2], [0.3, 36, 1, 0.05]] }).L;
  const alone = render({ choke: true, params: p, hits: [[0.3, 36, 1, 0.05]] }).L;
  let left = 0;
  for (let i = Math.round(0.34 * SR); i < pair.length; i++) left = Math.max(left, Math.abs(pair[i] - alone[i]));
  assert.ok(left < 1e-3, `the open hat is still there under the closed one: ${left.toFixed(4)}`);
  // In trig mode the same pair overlaps and the first rings on.
  const trig = render({ choke: false, params: p, hits: [[0.01, 36, 1, 2], [0.3, 36, 1, 0.05]] }).L;
  assert.ok(lastSound(trig) > 1, "trig mode choked");
  // A key let go closes a choked hat and leaves a trig one ringing.
  const key = (choke) => render({ choke, params: p, hits: [[0.01, 36, 1, 30]], events: [[0.2, { type: "release", when: 0.2 }]] }).L;
  assert.ok(lastSound(key(true)) < 0.25, "a key let go did not close the hat");
  assert.ok(lastSound(key(false)) > 1, "a key let go cut a crash");
});

test("halo: the bloom swells after the hit", () => {
  for (const model of ["metal", "modal"]) {
    const swell = (bloom) => {
      const { L } = render({ model, params: { decay: 0.85, bloom, stick: 0, vary: 0 } });
      return db(rms(L, 0.2, 0.35)) - db(rms(L, 0.012, 0.04));
    };
    assert.ok(swell(1) > swell(0) + 6, `${model}: bloom 1 ${swell(1).toFixed(1)}dB vs bloom 0 ${swell(0).toFixed(1)}dB`);
  }
  // At the top on the metal model it is a cymbal that rises: louder a fifth of
  // a second in than at the hit.
  const { L } = render({ model: "metal", params: { decay: 0.85, bloom: 1, stick: 0, vary: 0 } });
  assert.ok(rms(L, 0.2, 0.3) > rms(L, 0.012, 0.03), "the full bloom did not rise");
});

test("halo: the width is stereo and still sums to the mono cymbal", () => {
  for (const model of HALO_MODELS) {
    const mono = render({ model, params: { width: 0 } });
    for (let i = 0; i < mono.L.length; i++) assert.equal(mono.L[i], mono.R[i]);
    const wide = render({ model, params: { width: 1 } });
    // Below the ceiling's knee, L + R is the mono signal scaled by the width's
    // normalisation, sample for sample.
    const k = Math.sqrt(1 + 0.49) / 2;
    let worst = 0, lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < mono.L.length; i++) {
      if (Math.abs(wide.L[i]) < 0.7 && Math.abs(wide.R[i]) < 0.7 && Math.abs(mono.L[i]) < 0.7) {
        worst = Math.max(worst, Math.abs((wide.L[i] + wide.R[i]) * k - mono.L[i]));
      }
      lr += wide.L[i] * wide.R[i]; ll += wide.L[i] * wide.L[i]; rr += wide.R[i] * wide.R[i];
    }
    assert.ok(worst < 1e-5, `${model}: L + R is off the mono cymbal by ${worst}`);
    const corr = lr / Math.sqrt(ll * rr);
    assert.ok(corr < 0.7, `${model}: the sides correlate at ${corr.toFixed(2)}`);
  }
});

test("halo: velocity is a level, and vary throws only when asked", () => {
  const p = { vary: 0, stick: 0 };
  const full = render({ params: p, hits: [[0.01, 36, 1]] }).L;
  const soft = render({ params: p, hits: [[0.01, 36, 0.2]] }).L;
  const ratio = rms(soft, 0.012, 0.1) / rms(full, 0.012, 0.1);
  assert.ok(Math.abs(ratio - (1 - 0.6 * 0.8)) < 0.08, `velocity 0.2 played at ${ratio.toFixed(2)} of full`);
  // dyn 0: every hit the same.
  const a = render({ params: { ...p, dyn: 0 }, hits: [[0.01, 36, 1]] }).L;
  const b = render({ params: { ...p, dyn: 0 }, hits: [[0.01, 36, 0.2]] }).L;
  assert.deepEqual(a, b, "dyn 0 still heard velocity");
  // Two hits a second apart: identical without vary, different with it. The
  // same render twice is the same render either way.
  const two = (vary) => render({ secs: 1.6, params: { decay: 0.3, stick: 0, vary }, hits: [[0.01, 36, 1], [1.01, 36, 1]] }).L;
  const same = two(0);
  let diff = 0;
  for (let i = 0; i < 0.4 * SR; i++) diff = Math.max(diff, Math.abs(same[Math.round(0.01 * SR) + i] - same[Math.round(1.01 * SR) + i]));
  assert.ok(diff < 1e-6, `vary 0: two hits differ by ${diff}`);
  const varied = two(0.8);
  diff = 0;
  for (let i = 0; i < 0.4 * SR; i++) diff = Math.max(diff, Math.abs(varied[Math.round(0.01 * SR) + i] - varied[Math.round(1.01 * SR) + i]));
  assert.ok(diff > 0.01, "vary 0.8: two hits are the same");
  assert.deepEqual(two(0.8), varied, "the random stream is not seeded");
});

test("halo: a stop lets everything go, and a roll stays bounded", () => {
  const stopped = render({ model: "modal", params: { decay: 1 }, events: [[0.3, { type: "off", when: 0.3 }]] }).L;
  assert.ok(db(rms(stopped, 0.2, 0.3)) > -40, "nothing was sounding before the stop");
  assert.ok(lastSound(stopped) < 0.36, `still ringing after the stop: ${lastSound(stopped).toFixed(2)}s`);
  // Forty crashes 30ms apart: six ring at once, the oldest faded, never past
  // the slots, never past full scale.
  const hits = Array.from({ length: 40 }, (_, k) => [0.01 + k * 0.03, 36, 1]);
  const { L, maxOn } = render({ secs: 2, model: "modal", params: { decay: 0.9, bloom: 0.5 }, hits });
  assert.ok(finite(L));
  assert.ok(peak(L) < 1, `the roll peaked at ${peak(L)}`);
  assert.ok(maxOn <= 8, `${maxOn} voices on`);
});

test("halo: every cymbal plays at a sane level and under full scale", () => {
  for (const name of HALO_TONE_NAMES) {
    const { L, R } = render({ secs: 3, ...presetArgs(name), hits: [[0.01, 36, 1, 0.1]] });
    assert.ok(finite(L) && finite(R), `${name}: not finite`);
    assert.ok(peak(L) < 1 && peak(R) < 1, `${name}: peak ${peak(L)}`);
    let loud = -Infinity;
    for (let t = 0.01; t < 1; t += 0.05) loud = Math.max(loud, db(rms(L, t, t + 0.05)));
    assert.ok(loud > -30 && loud < -4, `${name}: loudest 50ms at ${loud.toFixed(1)}dBFS`);
  }
});

test("halo: the song builder, the MCP description and Strudel know it", () => {
  const song = B.newSong({ bpm: 124 });
  const { index: i } = B.addTrack(song, { engine: "halo", name: "hat" });
  assert.equal(song.tracks[i].engineKey, "dm:halo");
  assert.equal(song.tracks[i].isDrumKit, true, "a halo track is a drum kit");
  B.applyPreset(song, i, "pedal hat");
  assert.equal(song.tracks[i].params.hlochoke, "choke");
  assert.equal(song.tracks[i].params.hlomodel, "metal");
  B.setParams(song, i, { hlobloom: 0.4, hlomodel: "modal" });
  assert.throws(() => B.setParams(song, i, { hlomodel: "wood" }), /hlomodel/);
  assert.throws(() => B.setParams(song, i, { hlotune: 20 }), /hlotune/);
  const d = B.describeEngine("dm:halo");
  assert.equal(d.sliders.timb.label, "size");
  assert.ok(d.presets.some(p => p.name === "crash"));
  B.addLfo(song, i, { target: "halo_bloom", shape: "sine", amount: 0.2 });
  B.setAutomation(song, i, { target: "halo.width", values: [0, 0.5, 1, 0.5] });

  assert.equal(voiceFor("halo").engine, "dm:halo");
  assert.equal(voiceFor("halo").drum, true);
  const read = readCode(`hat: s("halo*8").knob("hlomodel", "fm").knob("hlochoke", "choke").knob("hlowidth", 0.8).knob("harm", 0.7)`);
  const out = B.newSong({ bpm: 124 });
  writeTracks(out, realize(read));
  const t = out.tracks.find(x => x.engineKey === "dm:halo");
  assert.ok(t, "no halo track from code");
  assert.equal(t.params.hlomodel, "fm");
  assert.equal(t.params.hlochoke, "choke");
  const code = sessionToCode(out, { native: true }).code;
  assert.match(code, /s\("halo/);
  const back = B.newSong({ bpm: 124 });
  writeTracks(back, realize(readCode(code)));
  const again = back.tracks.find(x => x.engineKey === "dm:halo");
  assert.ok(again, "the written code lost the halo");
  for (const k of [...Object.keys(HALO_DEFAULTS), "harm", "timb", "morph", "decay"]) {
    assert.equal(again.params[k], t.params[k], `${k} did not round-trip`);
  }
  // Portable code: a short halo is a hat, a long one a crash.
  assert.match(sessionToCode(out).code, /s\("hh/);
  B.setParams(out, out.tracks.indexOf(t), { decay: 0.9 });
  assert.match(sessionToCode(out).code, /s\("cr/);
});
