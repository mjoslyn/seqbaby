import assert from "node:assert/strict";
import test from "node:test";

import { guitarProcessorSource } from "../public/js/guitar.js";
import { GUITAR_TONE_NAMES, guitarTone } from "../public/js/engineData.js";

// The electric guitar, rendered outside a browser — reverb.js's trick: the
// processor is a source string evaluated against the globals a worklet scope
// provides, and guitar.js imports nothing that touches the DOM or Tone at load.
//
// What this pins is the set of things that were measured to be wrong when the
// instrument "sounded unnatural", so none of them can quietly come back:
// a decay that collapsed with pitch (E6 rang a twentieth of E2), an attack
// whose harmonic balance was a fresh random draw per note, velocity that made
// a note duller as it got louder, a pickup comb sitting at twice its position,
// and fold-back from the clippers 27dB under a hi-gain note. Plus the things
// a string model must simply get right: tuning, boundedness, and silence
// after the note is gone.

const SR = 48000;
const Q = 128;
const AMP = { clean: 0, tweed: 1, brit: 2, hi: 3, jazz: 4 };
const CAB = { "4x12": 0, "2x12": 1, "1x12": 2, "1x8": 3, di: 4 };
const PK = { single: 0, hum: 1, p90: 2 };
const SLIDER = { harm: "drive", timb: "tone", morph: "bloom", decay: "sustain" };

function makeProcessor() {
  const prelude = `
    globalThis.sampleRate = ${SR};
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = (n, c) => { globalThis.__P = c; };
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  const Cls = new Function(`${prelude}${guitarProcessorSource()}\n return globalThis.__P;`)();
  const inst = new Cls();
  const params = {};
  for (const d of Cls.parameterDescriptors) params[d.name] = Float32Array.of(d.defaultValue);
  return { inst, params, nid: 0 };
}

/** A rig: worklet params by name, plus amp / cab / pickup by their panel names. */
function rig(p = {}) {
  const g = makeProcessor();
  for (const [k, v] of Object.entries(p)) if (k in g.params) g.params[k][0] = v;
  g.inst.port.onmessage({ data: { type: "set", amp: AMP[p.amp ?? "clean"], cab: CAB[p.cab ?? "di"], pkupType: PK[p.pkupt ?? "hum"] } });
  return g;
}

/** A famous tone as a rig: every panel key and the four sliders. */
function tone(name, extra = {}) {
  const t = guitarTone(name);
  const p = { amp: t.gtamp, cab: t.gtcab, pkupt: t.gtpkupt };
  for (const [k, v] of Object.entries(t)) {
    const name = SLIDER[k] ?? (k.startsWith("gt") ? k.slice(2) : null);
    if (name && typeof v === "number") p[name] = v;
  }
  return rig({ ...p, ...extra });
}

function note(g, midi, when, dur, vel = 1) {
  g.inst.port.onmessage({ data: { type: "note", when, id: ++g.nid, note: midi, freq: 440 * Math.pow(2, (midi - 69) / 12), dur, vel, glide: 0 } });
}

function render(g, seconds) {
  const n = Math.ceil(seconds * SR / Q) * Q;
  const out = new Float32Array(n);
  const outs = [[new Float32Array(Q)]];
  for (let b = 0; b * Q < n; b++) {
    outs[0][0].fill(0);
    globalThis.currentFrame = b * Q;
    g.inst.process([], outs, g.params);
    out.set(outs[0][0], b * Q);
  }
  return out;
}

const rms = (a, from = 0, to = a.length) => {
  let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (a) => { let p = 0; for (const v of a) { const x = Math.abs(v); if (x > p) p = x; } return p; };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const sec = (t) => Math.round(t * SR);

/** Magnitude of one frequency over a window (Goertzel). */
function tone_at(a, f, from, to) {
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.hypot(s1 - s2 * Math.cos(w), s2 * Math.sin(w)) * 2 / (to - from);
}

/** Pitch in cents off f0, from the period that best autocorrelates. */
function centsOff(a, f0, from) {
  const P0 = SR / f0, W = Math.round(P0 * 4);
  const corr = (p) => { let s = 0; for (let i = from; i < from + W; i++) s += a[i] * a[i + p]; return s; };
  let best = -Infinity, bp = Math.round(P0);
  for (let p = Math.floor(P0 * 0.96); p <= Math.ceil(P0 * 1.04); p++) { const s = corr(p); if (s > best) { best = s; bp = p; } }
  const y1 = corr(bp - 1), y2 = corr(bp), y3 = corr(bp + 1);
  const d = 0.5 * (y1 - y3) / (y1 - 2 * y2 + y3);
  return 1200 * Math.log2(P0 / (bp + (Number.isFinite(d) ? d : 0)));
}

/** T60 in seconds: the slope of the rms envelope (20ms windows) from 5 to 35dB under its peak. */
function t60(a) {
  const W = sec(0.02), env = [];
  for (let i = 0; i + W <= a.length; i += W) env.push(db(rms(a, i, i + W)));
  const pk = Math.max(...env), ip = env.indexOf(pk);
  let i1 = -1, i2 = env.length - 1;
  for (let i = ip; i < env.length; i++) { if (i1 < 0 && env[i] <= pk - 5) i1 = i; if (env[i] <= pk - 35) { i2 = i; break; } }
  const slope = (env[i2] - env[i1]) / ((i2 - i1) * 0.02);
  return -60 / slope;
}

/** Hann-windowed power spectrum. */
function spectrum(a, from, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (a[from + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let s = 2; s <= N; s <<= 1) {
    const h = s >> 1, th = -2 * Math.PI / s;
    for (let k = 0; k < N; k += s) for (let j = 0; j < h; j++) {
      const wr = Math.cos(th * j), wi = Math.sin(th * j);
      const tr = wr * re[k + j + h] - wi * im[k + j + h], ti = wr * im[k + j + h] + wi * re[k + j + h];
      re[k + j + h] = re[k + j] - tr; im[k + j + h] = im[k + j] - ti; re[k + j] += tr; im[k + j] += ti;
    }
  }
  const pw = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
  return pw;
}

/** Energy off the harmonic series of f0, in dB relative to the total. */
function offHarmonicDb(a, from, f0) {
  const N = 32768, pw = spectrum(a, from, N);
  let harm = 0, tot = 0;
  for (let i = 1; i < pw.length; i++) {
    const f = i * SR / N; if (f < 100) continue;
    tot += pw[i];
    const k = Math.round(f / f0);
    if (k >= 1 && Math.abs(f - k * f0) < 25) harm += pw[i];
  }
  return 10 * Math.log10((tot - harm) / tot);
}

/** Brightness: energy above 1kHz against the total, in dB. */
function brightness(a, from) {
  const N = 8192, pw = spectrum(a, from, N);
  let hi = 0, tot = 0;
  for (let i = 1; i < pw.length; i++) { tot += pw[i]; if (i * SR / N >= 1000) hi += pw[i]; }
  return 10 * Math.log10(hi / tot);
}

test("tuning: within a cent across four octaves, stiff or not", () => {
  for (const stiff of [0, 0.25, 0.5]) {
    for (const midi of [40, 52, 64, 76, 88]) {
      const g = rig({ drive: 0, sustain: 0.8, stiff });
      note(g, midi, 0, 3);
      const a = render(g, 1.2);
      const off = centsOff(a, 440 * 2 ** ((midi - 69) / 12), sec(0.5));
      assert.ok(Math.abs(off) < 1.5, `midi ${midi} stiff ${stiff}: ${off.toFixed(2)} cents`);
    }
  }
});

test("decay is a time, not a count of periods: E6 rings at least half as long as E2", () => {
  // It was a per-lap gain: at the default sustain E2 rang 1.6s and E6 0.08s.
  for (const sustain of [0.4, 1]) {
    const T = {};
    for (const midi of [40, 64, 88]) {
      const g = rig({ drive: 0, sustain, bloom: 0 });
      note(g, midi, 0, 12);
      T[midi] = t60(render(g, 12));
    }
    assert.ok(T[88] > T[40] * 0.5, `sustain ${sustain}: E2 ${T[40].toFixed(2)}s, E6 ${T[88].toFixed(2)}s`);
    assert.ok(T[40] > T[88], `a high note still rings a little less: E2 ${T[40].toFixed(2)}s, E6 ${T[88].toFixed(2)}s`);
  }
});

test("the sustain slider is a T60 in seconds", () => {
  const at = (sustain) => { const g = rig({ drive: 0, sustain, bloom: 0 }); note(g, 52, 0, 12); return t60(render(g, 12)); };
  const s0 = at(0), s4 = at(0.4), s1 = at(1);
  assert.ok(s0 > 0.2 && s0 < 0.6, `sustain 0: ${s0.toFixed(2)}s`);
  assert.ok(s4 > 0.9 && s4 < 1.8, `sustain 0.4: ${s4.toFixed(2)}s`);
  assert.ok(s1 > 5, `sustain 1: ${s1.toFixed(2)}s`);
});

test("the attack is the same note twice, not a fresh roll of the dice", () => {
  // The noise burst made identical notes differ by 3dB in their first 100ms.
  const levels = [];
  for (let k = 0; k < 5; k++) { const g = rig({ drive: 0 }); note(g, 64, 0, 1); levels.push(db(rms(render(g, 0.3), 0, sec(0.1)))); }
  assert.ok(Math.max(...levels) - Math.min(...levels) < 0.3, `attack levels: ${levels.map(l => l.toFixed(2)).join(" ")}`);
});

test("harder is louder AND brighter", () => {
  // It came out duller as it got louder: the clean amp and the output safety
  // were clipping the burst.
  // Bloom off: the feedback is gated by the string's own level, so a loud
  // note takes more of the speaker's (lowpassed) air than a quiet one, which
  // is the one way a harder hit is legitimately rounder.
  const at = (vel) => { const g = rig({ drive: 0, tone: 1, sag: 0, amp: "jazz", bloom: 0 }); note(g, 52, 0, 2, vel); const a = render(g, 0.5); return { lvl: db(rms(a, 0, sec(0.3))), b: brightness(a, sec(0.01)) }; };
  const soft = at(0.3), hard = at(1);
  assert.ok(hard.lvl > soft.lvl + 8, `level: soft ${soft.lvl.toFixed(1)} hard ${hard.lvl.toFixed(1)}`);
  assert.ok(hard.b > soft.b + 2, `brightness: soft ${soft.b.toFixed(1)} hard ${hard.b.toFixed(1)}dB above 1kHz`);
});

test("drive 0 is clean: a single note stays under the first stage's knee on every amp", () => {
  // Measured as the crest the clipper would have flattened: a note's peak
  // against its own rms stays what the string produced (DI cab, clipping
  // would pull the peak down toward the rms).
  const ref = (() => { const g = rig({ drive: 0, amp: "jazz", sag: 0, mast: 0.2 }); note(g, 52, 0, 1); const a = render(g, 0.5); return db(peak(a)) - db(rms(a, 0, sec(0.3))); })();
  for (const amp of ["clean", "tweed", "brit", "hi", "jazz"]) {
    const g = rig({ drive: 0, amp, sag: 0, mast: 0.2 }); note(g, 52, 0, 1); const a = render(g, 0.5);
    const crest = db(peak(a)) - db(rms(a, 0, sec(0.3)));
    assert.ok(crest > ref - 2.5, `${amp}: crest ${crest.toFixed(1)}dB vs ${ref.toFixed(1)} unclipped`);
  }
});

test("a hard pluck starts sharp and settles", () => {
  const g = rig({ drive: 0, pnoise: 1, sustain: 0.8, stiff: 0 });
  note(g, 45, 0, 3, 1);
  const a = render(g, 1);
  const early = centsOff(a, 110, sec(0.005)), late = centsOff(a, 110, sec(0.4));
  assert.ok(early > 5 && early < 25, `early: ${early.toFixed(1)} cents`);
  assert.ok(Math.abs(late) < 1, `settled: ${late.toFixed(1)} cents`);
  const soft = rig({ drive: 0, pnoise: 0.2, sustain: 0.8, stiff: 0 });
  note(soft, 45, 0, 3, 0.4);
  assert.ok(centsOff(render(soft, 1), 110, sec(0.005)) < 2, "a soft touch barely bends");
});

test("the pickup's comb sits at its position: a pickup at 1/8 notches the 8th harmonic", () => {
  // It was at 2p, which put this notch on the 4th.
  const g = rig({ drive: 0, pkup: 0.125, pick: 0.3, sustain: 1, tone: 1, stiff: 0 });
  note(g, 45, 0, 3);
  const a = render(g, 1);
  const h = (n) => db(tone_at(a, 110 * n, sec(0.1), sec(0.6)));
  // The tap is an integer sample, so the notch lands near the 8th rather than
  // on it; what is asserted is a dip there and none at the 4th.
  const dip = (n) => (h(n - 1) + h(n + 1)) / 2 - h(n);
  assert.ok(dip(8) > 2, `a dip at the 8th: h7 ${h(7).toFixed(0)} h8 ${h(8).toFixed(0)} h9 ${h(9).toFixed(0)}`);
  assert.ok(dip(4) < 2, `none at the 4th: h3 ${h(3).toFixed(0)} h4 ${h(4).toFixed(0)} h5 ${h(5).toFixed(0)}`);
});

test("the oversampled amp keeps fold-back far under a hi-gain note", () => {
  // Without it this was -27dB: a fizz off the harmonic series. Measured -49.
  const g = rig({ amp: "hi", cab: "4x12", drive: 0.9, sustain: 1, bloom: 0, stiff: 0 });
  note(g, 69, 0, 3);
  const off = offHarmonicDb(render(g, 1.2), sec(0.3), 440);
  assert.ok(off < -45, `off-harmonic energy ${off.toFixed(1)}dB`);
});

test("a chord is a strum: six notes at one instant land one after another", () => {
  const g = rig({ drive: 0, sustain: 0.6 });
  for (const n of [40, 47, 52, 56, 59, 64]) note(g, n, 0, 1);
  const a = render(g, 0.2);
  // First sound within a millisecond, and the chord's full level only after
  // the last string has been reached (5 x 4ms).
  let first = -1; for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > 1e-4) { first = i; break; }
  assert.ok(first >= 0 && first < sec(0.001), `first sound at ${first}`);
  const early = rms(a, 0, sec(0.004)), full = rms(a, sec(0.02), sec(0.03));
  assert.ok(full > early * 1.5, `early ${early.toFixed(3)} full ${full.toFixed(3)}`);
});

test("bloom holds a note up without running away, and release still ends it", () => {
  const g = tone("singing lead");
  note(g, 52, 0, 4);
  const a = render(g, 7);
  const held = db(rms(a, sec(3), sec(4))), early = db(rms(a, sec(0.5), sec(1)));
  assert.ok(held > early - 6, `held note is sustained by the feedback: ${early.toFixed(1)} -> ${held.toFixed(1)}dB`);
  assert.ok(peak(a) <= 1, "bounded");
  assert.ok(db(rms(a, sec(6), sec(7))) < held - 20, `and it goes once released: ${db(rms(a, sec(6), sec(7))).toFixed(1)}dB`);
});

test("palm mute shortens and darkens", () => {
  const open = tone("brit stack"); note(open, 40, 0, 2);
  const muted = tone("brit stack", { mute: 0.8 }); note(muted, 40, 0, 2);
  const ao = render(open, 1), am = render(muted, 1);
  assert.ok(db(rms(am, sec(0.4), sec(0.6))) < db(rms(ao, sec(0.4), sec(0.6))) - 15, "muted note is gone where the open one still rings");
  assert.ok(brightness(am, sec(0.02)) < brightness(ao, sec(0.02)) - 2, "and it is darker");
});

test("every famous tone renders finite and bounded at every register", () => {
  for (const name of GUITAR_TONE_NAMES) {
    const g = tone(name);
    for (const n of [28, 40, 52, 64, 76, 88, 96]) note(g, n, 0, 1);
    const a = render(g, 1.5);
    for (const v of a) assert.ok(Number.isFinite(v), `${name}: non-finite sample`);
    assert.ok(peak(a) <= 1, `${name}: peak ${peak(a)}`);
  }
});

test("the famous tones land at comparable levels: no preset is 10dB off the pack", () => {
  // Over the chord's first 150ms: some tones are short by design (funk,
  // palm-muted chug) and a longer window would only measure that.
  const lv = GUITAR_TONE_NAMES.map((name) => { const g = tone(name); for (const n of [40, 47, 52, 56, 59, 64]) note(g, n, 0, 1.5); return db(rms(render(g, 0.3), 0, sec(0.15))); });
  const mid = lv.slice().sort((x, y) => x - y)[lv.length >> 1];
  for (let i = 0; i < lv.length; i++) assert.ok(Math.abs(lv[i] - mid) < 10, `${GUITAR_TONE_NAMES[i]}: ${lv[i].toFixed(1)}dB vs median ${mid.toFixed(1)}`);
});

test("a stopped note is silent: the string switches itself off", () => {
  const g = rig({ drive: 0, sustain: 0.2, bloom: 0 });
  note(g, 64, 0, 0.2);
  const a = render(g, 4);
  assert.ok(rms(a, sec(3), sec(4)) < 1e-5, `tail rms ${rms(a, sec(3), sec(4))}`);
  assert.ok(g.inst.voices.every(v => !v.active), "every string retired");
});
