// The NAM stage (public/js/nam.js): reading a .nam, the model builders against
// a naive reference (test/namRef.mjs, written straight from
// NeuralAmpModelerCore's semantics), the SIMD kernel against plain JS, and
// the processor in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAM_KERNEL_B64, NamError, namWeightsWanted, namMicCurve, namMicLabel, namCabFor, namCabImpulse, namIRAt, packNamIR, namCoreSource, namModelLabel, namProcessorSource, namWeightCount, packNamModel, unpackNamWeights } from "../public/js/nam.js";
import { defaultFxConfig, NAM_KNOBS, NAM_NODE_KNOBS } from "../public/js/soundDefaults.js";
import { AUTOMATION_TARGETS, FX_STAGE_KEYS, LFO_KEYS } from "../public/js/constants.js";
import * as sb from "../public/js/songBuilder.js";
import { refRender } from "./namRef.mjs";
import { refWaveNet } from "./namRefA2.mjs";

const core = new Function(namCoreSource() + "; return { buildModel, prewarm };")();
const KERNEL = new WebAssembly.Module(Buffer.from(NAM_KERNEL_B64, "base64"));

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }

/** A .nam the trainer could have written: an A1 WaveNet of the given shape, seeded weights. */
function waveNetFile({ c0 = 4, c1 = 3, k = 3, d0 = [1, 2, 4, 8], d1 = [1, 2, 4], act = "Tanh", gated = false, seed = 1 } = {}) {
  const layers = [
    { input_size: 1, condition_size: 1, head_size: c1, channels: c0, kernel_size: k, dilations: d0, activation: act, gated, head_bias: false },
    { input_size: c0, condition_size: 1, head_size: 1, channels: c1, kernel_size: k, dilations: d1, activation: act, gated, head_bias: true },
  ];
  const spec = { arrays: layers.map((L) => ({ cin: L.input_size, cc: 1, h: L.head_size, c: L.channels, k, d: L.dilations, gated, hb: L.head_bias })) };
  const r = rng(seed), n = namWeightCount("WaveNet", spec);
  const weights = Array.from({ length: n }, () => r() * 0.9);
  weights[n - 1] = 0.5;
  return { version: "0.5.4", architecture: "WaveNet", config: { layers, head: null, head_scale: 0.02 }, weights, sample_rate: 48000, metadata: { name: "test amp", loudness: -20 } };
}
function lstmFile({ layers = 2, hidden = 4, seed = 3 } = {}) {
  const r = rng(seed), n = namWeightCount("LSTM", { layers, input: 1, hidden });
  return { version: "0.5.4", architecture: "LSTM", config: { num_layers: layers, input_size: 1, hidden_size: hidden }, weights: Array.from({ length: n }, () => r()), sample_rate: 48000, metadata: {} };
}
function signal(n) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin(i * 0.05) + 0.25 * Math.sin(i * 0.37 + 1); return x; }

/** Run a packed model through the builders, in uneven chunks, after the prewarm. */
function render(m, x, kernel) {
  const model = core.buildModel(m.arch, m.cfg, unpackNamWeights(m), kernel);
  core.prewarm(model, m.arch, m.sr);
  const y = new Float32Array(x.length);
  const sizes = [128, 37, 128, 5, 101, 64, 3];
  for (let s = 0, i = 0; s < x.length; i++) { const k = Math.min(sizes[i % sizes.length], x.length - s); model.run(x.subarray(s, s + k), y.subarray(s, s + k), k); s += k; }
  return { y, model };
}
const prewarmOf = (m, model) => m.arch === "LSTM" ? Math.ceil(0.5 * m.sr / 128) * 128 : Math.ceil(model.rf / 128) * 128;
const maxErr = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e = Math.max(e, Math.abs(a[i] - b[i])); return e; };

test("packs a WaveNet: config, weights as base64 float32, loudness, a name", () => {
  const f = waveNetFile();
  const m = packNamModel(JSON.stringify(f), "Plexi.nam");
  assert.equal(m.arch, "WaveNet");
  assert.equal(m.name, "Plexi");
  assert.equal(m.loud, -20);
  assert.equal(m.n, f.weights.length);
  const w = unpackNamWeights(m);
  assert.equal(w.length, f.weights.length);
  assert.ok(Math.abs(w[10] - f.weights[10]) < 1e-6);
  assert.match(namModelLabel(m), /Plexi · WaveNet/);
});

test("refuses what it cannot run, saying why", () => {
  assert.throws(() => packNamModel("nope"), NamError);
  const short = waveNetFile(); short.weights.pop();
  assert.throws(() => packNamModel(short), /weights where its config needs/);
  const stereo = waveNetFile(); stereo.config.in_channels = 2;
  assert.throws(() => packNamModel(stereo), /mono/);
  const out2 = waveNetFile(); out2.config.layers[1].head_size = 2;
  assert.throws(() => packNamModel(out2), /mono/);
  const two = waveNetFile(); two.config.layers[0].kernel_sizes = [3, 3, 3, 3];
  assert.throws(() => packNamModel(two), /two kernel sizes/);
  const gm = waveNetFile(); gm.config.layers[0].gating_mode = "sideways";
  assert.throws(() => packNamModel(gm), /gating mode/);
  const grp = waveNetFile(); grp.config.layers[0].groups_input = 3;
  assert.throws(() => packNamModel(grp), /groups/);
  const nol1 = waveNetFile(); Object.assign(nol1.config.layers[0], { bottleneck: 2, layer1x1: { active: false, groups: 1 } });
  assert.throws(() => packNamModel(nol1), /bottleneck/);
  assert.throws(() => packNamModel({ architecture: "ConvNet", config: {}, weights: [] }), /ConvNet/);
});

test("a slimmable container plays its largest submodel", () => {
  const big = waveNetFile({ c0: 4 }), small = waveNetFile({ c0: 2, seed: 9 });
  const m = packNamModel({ architecture: "SlimmableContainer", config: { submodels: [{ max_value: 0.5, model: small }, { max_value: 1, model: big }] } });
  assert.equal(m.cfg.arrays[0].c, 4);
});

for (const [name, opts] of [
  ["tanh", {}],
  ["gated", { gated: true, seed: 5 }],
  ["relu, kernel 2", { act: "ReLU", k: 2, seed: 6 }],
  ["standard-sized", { c0: 16, c1: 8, d0: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512], d1: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512], seed: 7 }],
]) {
  test(`WaveNet (${name}) matches the reference, plain JS and SIMD`, () => {
    const f = waveNetFile(opts);
    // keep the standard-sized model's activations in range
    if (opts.c0 === 16) for (let i = 0; i < f.weights.length - 1; i++) f.weights[i] *= 0.25;
    const m = packNamModel(f);
    const x = signal(3000);
    const js = render(m, x, null), wa = render(m, x, KERNEL);
    const ref = refRender(f, x, prewarmOf(m, js.model));
    const peak = Math.max(...ref.map(Math.abs));
    assert.ok(peak > 1e-3, "the model makes sound");
    assert.ok(maxErr(js.y, ref) < 1e-4 * Math.max(1, peak), `js ${maxErr(js.y, ref)}`);
    assert.ok(maxErr(wa.y, ref) < 1e-4 * Math.max(1, peak), `simd ${maxErr(wa.y, ref)}`);
    assert.equal(wa.model.wasm, true);
  });
}

/** Seeded weights for a WaveNet config (a condition model's first, recursively). */
function withWeights(d, seed, scale = 0.5) {
  if (d.config.condition_dsp) withWeights(d.config.condition_dsp, seed + 100, scale);
  const r = rng(seed);
  d.weights = Array.from({ length: namWeightsWanted(d) }, () => r() * 2 * scale);
  d.weights[d.weights.length - 1] = 0.5;
  return d;
}
const filmOff = { active: false, shift: true, groups: 1 };
/** NAM's released A2 shape (its A2.nam): a kernel size and an activation per layer, a 16-tap head. */
function a2File(ch = 4, seed = 11) {
  const ks = [6, 6, 3, 6, 15, 6], d = [1, 3, 7, 1, 13, 41];
  const L = {
    input_size: 1, condition_size: 1, head: { out_channels: 1, kernel_size: 16, bias: true }, channels: ch, bottleneck: ch,
    kernel_sizes: ks, dilations: d, activation: d.map(() => ({ type: "LeakyReLU", negative_slope: 0.01 })),
    head1x1: { active: false, out_channels: 1, groups: 1 }, layer1x1: { active: true, groups: 1 }, groups_input: 1, groups_input_mixin: 1,
    gating_mode: d.map(() => "none"), secondary_activation: d.map(() => null), slimmable: null,
  };
  for (const k of ["conv_pre_film", "conv_post_film", "input_mixin_pre_film", "input_mixin_post_film", "activation_pre_film", "activation_post_film", "layer1x1_post_film", "head1x1_post_film"]) L[k] = filmOff;
  return withWeights({ version: "0.7.0", architecture: "WaveNet", config: { layers: [L], head: null, head_scale: 0.01 }, sample_rate: 48000, metadata: { loudness: -24 } }, seed);
}
/** Every A2 feature at once: a condition model, bottlenecks, groups, gated / blended / plain layers, per-layer activations, a head 1x1, all eight FiLMs, a dilated head, a post-stack head. */
function a2Everything(seed = 21) {
  const cond = {
    version: "0.7.0", architecture: "WaveNet", sample_rate: 48000,
    config: { layers: [{ input_size: 1, condition_size: 1, head_size: 6, channels: 3, kernel_size: 2, dilations: [1, 2], activation: "Tanh", gated: false, head_bias: true }], head: null, head_scale: 0.7 },
  };
  const a0 = {
    input_size: 1, condition_size: 6, channels: 4, bottleneck: 6, kernel_sizes: [3, 2, 4], dilations: [1, 2, 5],
    activation: [{ type: "PReLU", negative_slopes: [0.1, 0.2, 0.05, 0.3, 0.15, 0.25] }, { type: "LeakyHardtanh", min_val: -0.5, max_val: 0.8, min_slope: 0.1, max_slope: 0.05 }, "SiLU"],
    gating_mode: ["gated", "blended", "none"], secondary_activation: ["Sigmoid", { type: "Hardswish" }, null],
    groups_input: 2, groups_input_mixin: 3, layer1x1: { active: true, groups: 2 }, head1x1: { active: true, out_channels: 4, groups: 2 },
    conv_pre_film: { active: true, shift: true, groups: 2 }, conv_post_film: { active: true, shift: true, groups: 3 },
    input_mixin_pre_film: { active: true, shift: false, groups: 2 }, input_mixin_post_film: { active: true, shift: true, groups: 2 },
    activation_pre_film: { active: true, shift: true, groups: 1 }, activation_post_film: { active: true, shift: false, groups: 3 },
    layer1x1_post_film: { active: true, shift: true, groups: 2 }, head1x1_post_film: { active: true, shift: false, groups: 2 },
    head: { out_channels: 3, kernel_size: 3, bias: true, head_dilation: 2 },
  };
  const a1 = { input_size: 4, condition_size: 6, channels: 3, bottleneck: 3, kernel_size: 2, dilations: [1, 3], activation: "Softsign", gated: false, layer1x1: { active: false, groups: 1 }, head_size: 2, head_bias: false };
  return withWeights({
    version: "0.7.0", architecture: "WaveNet", sample_rate: 48000,
    config: { condition_dsp: cond, layers: [a0, a1], head: { channels: 3, out_channels: 1, kernel_sizes: [3, 1], activation: "Tanh" }, head_scale: 0.3 },
  }, seed, 1.2);
}
function holdToRef(f, label) {
  const m = packNamModel(f);
  const x = signal(2500);
  for (const k of [null, KERNEL]) {
    const { y, model } = render(m, x, k);
    const pre = prewarmOf(m, model);
    const inp = new Float64Array(pre + x.length); inp.set(x, pre);
    const ref = refWaveNet(f.architecture === "SlimmableContainer" ? f.config.submodels.at(-1).model : f, [inp])[0].slice(pre);
    const peak = Math.max(...ref.map(Math.abs));
    // what the input does to the output, not a DC level it rides on: a test a
    // wrong weight order can pass is no test
    const mean = ref.reduce((a, b) => a + b, 0) / ref.length;
    const sd = Math.sqrt(ref.reduce((a, b) => a + (b - mean) ** 2, 0) / ref.length);
    assert.ok(sd > 0.02 * Math.max(1e-3, peak), `${label} follows its input (sd ${sd} of ${peak})`);
    assert.ok(maxErr(y, ref) < 2e-5 * Math.max(1, peak), `${label} ${k ? "simd" : "js"}: ${maxErr(y, ref)} of ${peak}`);
    assert.equal(model.wasm, !!k);
  }
  return m;
}

test("A2 (NAM's released shape) matches NAM's generic WaveNet, plain JS and SIMD", () => {
  const m = holdToRef(a2File(), "A2");
  assert.equal(m.cfg.v, 2);
  assert.deepEqual(m.cfg.arrays[0].ks, [6, 6, 3, 6, 15, 6]);
  // as NAM ships it: a slimmable container, lite and full
  const box = { version: "0.7.0", architecture: "SlimmableContainer", config: { submodels: [{ max_value: 0.5, model: a2File(3, 12) }, { max_value: 1, model: a2File(8, 13) }] } };
  assert.equal(holdToRef(box, "A2 full").cfg.arrays[0].c, 8);
});

test("A2 with every feature (FiLM, groups, gating, a head 1x1, a post-stack head, a condition model) matches", () => {
  const f = a2Everything();
  const m = holdToRef(f, "everything");
  assert.equal(m.cfg.cond.arch, "WaveNet");
  assert.equal(m.n, f.weights.length + f.config.condition_dsp.weights.length);
});

test("a song saved before A2 (the A1 spec) still builds, and the same", () => {
  const f = waveNetFile({ gated: true, seed: 5 });
  const m = packNamModel(f);
  const old = { arrays: f.config.layers.map((L) => ({ cin: L.input_size, cc: 1, h: L.head_size, c: L.channels, k: L.kernel_size, d: L.dilations, act: 0, slope: 0.01, gated: true, hb: L.head_bias })) };
  const x = signal(1000);
  const a = render(m, x, KERNEL).y, b = render({ ...m, cfg: old }, x, KERNEL).y;
  assert.equal(maxErr(a, b), 0);
});

test("LSTM matches the reference", () => {
  const f = lstmFile();
  const m = packNamModel(f);
  const x = signal(2000);
  const { y, model } = render(m, x, null);
  const ref = refRender(f, x, prewarmOf(m, model));
  assert.ok(maxErr(y, ref) < 1e-5);
});

test("Linear is an FIR with the first weight on the newest sample", () => {
  const m = packNamModel({ architecture: "Linear", config: { receptive_field: 3, bias: true }, weights: [1, 0.5, 0.25, 0.1], sample_rate: 48000 });
  const x = new Float32Array(6); x[0] = 1;
  const model = core.buildModel(m.arch, m.cfg, unpackNamWeights(m));
  const y = new Float32Array(6);
  model.run(x, y, 6);
  assert.deepEqual([...y].map((v) => +v.toFixed(3)), [1.1, 0.6, 0.35, 0.1, 0.1, 0.1]);
});

/** The processor in Node: an AudioWorkletProcessor stand-in and one block at a time. */
function makeProcessor(sr = 48000, opts = {}) {
  const posted = [];
  const scope = {
    sampleRate: sr,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (n, c) => { scope.cls = c; },
    WebAssembly,
  };
  new Function(...Object.keys(scope), namProcessorSource())(...Object.values(scope));
  const p = new scope.cls({ processorOptions: opts });
  const params = Object.fromEntries(NAM_NODE_KNOBS.map((k) => [k, [defaultFxConfig().nam[k]]]));
  const run = (x) => {
    const out = new Float32Array(x.length);
    for (let s = 0; s < x.length; s += 128) {
      const iL = new Float32Array(128); iL.set(x.subarray(s, s + 128)); const o = new Float32Array(128);
      p.process([[iL, iL]], [[o, o]], params);
      out.set(o.subarray(0, Math.min(128, x.length - s)), s);
    }
    return out;
  };
  return { p, posted, params, run, send: (m) => p.port.onmessage({ data: m }) };
}

test("the processor: a wire with no capture, the capture once loaded, faded in", () => {
  const { send, run, posted } = makeProcessor(48000, { norm: false });
  const x = signal(48000 * 0.1);
  assert.deepEqual(run(x.subarray(0, 256)), x.subarray(0, 256));
  const f = waveNetFile();
  send({ type: "model", model: packNamModel(f) });
  assert.equal(posted.at(-1).ok, true);
  assert.equal(posted.at(-1).simd, true);
  const y = run(x);
  const tail = y.subarray(2400);
  assert.ok(tail.some((v) => Math.abs(v) > 1e-3), "the capture is heard");
  assert.ok(tail.every((v) => Number.isFinite(v)));
});

test("the processor resamples at another rate and still sounds", () => {
  const { send, run, posted } = makeProcessor(44100, { norm: false });
  send({ type: "model", model: packNamModel(waveNetFile()) });
  assert.equal(posted.at(-1).hostSr, 44100);
  const y = run(signal(44100 * 0.2));
  const tail = y.subarray(4000);
  assert.ok(tail.some((v) => Math.abs(v) > 1e-3) && tail.every(Number.isFinite));
});

test("the processor reports a bad capture rather than throwing", () => {
  const { send, posted } = makeProcessor();
  const m = packNamModel(waveNetFile());
  send({ type: "model", model: { ...m, w: m.w.slice(0, 40) } });
  assert.equal(posted.at(-1).ok, false);
});

test("the stage is wired into every namespace", () => {
  assert.ok(FX_STAGE_KEYS.includes("nam"));
  assert.ok(LFO_KEYS.includes("nam") && NAM_KNOBS.every((k) => LFO_KEYS.includes(`nam_${k}`)));
  assert.ok(AUTOMATION_TARGETS["fx.nam"] && NAM_KNOBS.every((k) => AUTOMATION_TARGETS[`fx.nam.${k}`]));
});

test("the song builder sets the knobs and refuses a capture", () => {
  const s = sb.newSong();
  const { index } = sb.addTrack(s, { engine: "dm:guitar" });
  const c = sb.setFx(s, index, "nam", { wet: 1, input: 0.7, norm: "off" });
  assert.equal(c.input, 0.7);
  assert.equal(c.model, null);
  assert.throws(() => sb.setFx(s, index, "nam", { model: {} }), /\.nam file/);
  assert.throws(() => sb.setFx(s, index, "nam", { norm: "maybe" }), /norm must be one of/);
});

/** Magnitude of an impulse response at a frequency, in dB. */
function respDb(h, f, sr) {
  let re = 0, im = 0;
  for (let i = 0; i < h.length; i++) { re += h[i] * Math.cos(2 * Math.PI * f * i / sr); im -= h[i] * Math.sin(2 * Math.PI * f * i / sr); }
  return 20 * Math.log10(Math.hypot(re, im));
}

/** Mean power gain over the amp's band, as nam.js normalizes it. */
function bandPower(h, sr) {
  let p = 0, n = 0;
  for (let i = 0; i < 24; i++) { const f = 80 * Math.pow(6000 / 80, i / 23); p += Math.pow(10, respDb(h, f, sr) / 10); n++; }
  return p / n;
}

test("a built-in cab is a speaker: unity over the amp's band, a presence peak, the top and the bottom gone", () => {
  for (const cab of ["4x12", "2x12", "1x12", "1x8", "b8x10", "b4x10", "b1x15", "b2x12"]) {
    const h = namCabImpulse(cab, 48000);
    const e = bandPower(h, 48000);
    assert.ok(Math.abs(e - 1) < 1e-3, `${cab} band power ${e}`);
    assert.ok(Math.abs(h.at(-1)) < 1e-6, `${cab} has rung out`);
  }
  const g = namCabImpulse("4x12", 48000);
  assert.ok(respDb(g, 2400, 48000) - respDb(g, 10000, 48000) > 20, "4x12 falls off above 5kHz");
  assert.ok(respDb(g, 2400, 48000) - respDb(g, 40, 48000) > 10, "4x12 has no deep bass");
  const b = namCabImpulse("b8x10", 48000);
  const tilt = (h) => respDb(h, 40, 48000) - respDb(h, 2000, 48000);
  assert.ok(tilt(b) > tilt(g) + 3, "a bass cab keeps more bottom than a guitar cab");
  assert.equal(namCabImpulse("off", 48000), null);
  assert.equal(namCabImpulse("file", 48000), null);
});

test("an IR file is packed mono, its silent tail cut, at unit energy, and resampled", () => {
  const sr = 44100, n = sr; // one second, mostly silence
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < 2000; i++) { L[i] = Math.exp(-i / 200) * Math.sin(i * 0.3); R[i] = L[i] * 0.5; }
  const ir = packNamIR({ sampleRate: sr, channels: [L, R] }, "greenback.wav");
  assert.equal(ir.name, "greenback");
  assert.ok(ir.n < 2100 && ir.n > 1000, `cut to ${ir.n}`);
  const h48 = namIRAt(ir, 48000);
  assert.ok(Math.abs(h48.length - Math.floor(ir.n * 48000 / sr)) <= 1);
  assert.ok(Math.abs(bandPower(h48, 48000) - 1) < 1e-3);
  assert.throws(() => packNamIR({ sampleRate: sr, channels: [new Float32Array(10)] }), NamError);
  const long = new Float32Array(sr * 2).fill(0.01);
  assert.ok(packNamIR({ sampleRate: sr, channels: [long] }).n <= sr * 0.5);
});

test("the cab a config asks for, and a key that moves only when it does", () => {
  assert.equal(namCabFor({ cab: "off" }, 48000), null);
  assert.equal(namCabFor({ cab: "file", ir: null }, 48000), null);
  const a = namCabFor({ cab: "4x12" }, 48000), b = namCabFor({ cab: "4x12" }, 44100);
  assert.notEqual(a.key, b.key);
  assert.equal(a.h().length, 4800);
  const L = new Float32Array(500); L[0] = 1; L[3] = 0.5;
  const ir = packNamIR({ sampleRate: 48000, channels: [L] }, "x");
  const f = namCabFor({ cab: "file", ir }, 48000);
  assert.match(f.key, /^file:x:/);
  assert.equal(f.h().length, ir.n);
});

test("the song builder picks a built-in cab and refuses an IR", () => {
  const s = sb.newSong();
  const { index } = sb.addTrack(s, { engine: "dm:guitar" });
  assert.equal(sb.setFx(s, index, "nam", { cab: "4x12" }).cab, "4x12");
  assert.throws(() => sb.setFx(s, index, "nam", { cab: "file" }), /cab must be one of/);
  assert.throws(() => sb.setFx(s, index, "nam", { ir: {} }), /impulse response/);
});

test("mic position: the middle leaves the cab alone, the edge darker, the centre brighter", () => {
  const mid = namMicCurve(0.5), edge = namMicCurve(0), centre = namMicCurve(1);
  assert.equal(mid.presDb, 0);
  assert.ok(mid.lp >= 15000, "the middle's lowpass is above the band");
  assert.ok(edge.lp <= 2000 && edge.presDb < 0);
  assert.ok(centre.lp > mid.lp && centre.presDb > 0);
  assert.equal(namMicLabel(0.5), "as is");
  assert.equal(namMicLabel(0.2), "edge 60%");
  assert.equal(defaultFxConfig().nam.mic, 0.5);
  assert.equal(defaultFxConfig().nam.cabmix, 1);
  const s = sb.newSong();
  const { index } = sb.addTrack(s, { engine: "dm:guitar" });
  const c = sb.setFx(s, index, "nam", { cab: "1x12", mic: 0.3, cabmix: 0.8 });
  assert.equal(c.mic, 0.3);
  sb.addLfo(s, index, { target: "nam_mic", amount: 0.3 });
});

test("a capture on the nam stage plays a guitar or bass as a DI, and gives the amp back", async () => {
  const { namOwnsRig, syncNamRig } = await import("../public/js/namRig.js");
  const model = { name: "x", arch: "WaveNet" };
  const calls = [];
  const t = { id: 1, engineKey: "dm:guitar", fxConfig: { nam: { wet: 1, model } }, voice: { _rigDi: false, setRigBypass(on) { this._rigDi = on; calls.push(on); } } };
  assert.equal(namOwnsRig(t), true);
  syncNamRig(t); syncNamRig(t);
  assert.deepEqual(calls, [true], "told once");
  t.fxConfig.nam.wet = 0; syncNamRig(t);
  assert.deepEqual(calls, [true, false], "wet at zero: the stage is out of the chain");
  t.fxConfig.nam = { wet: 1, model: null };
  assert.equal(namOwnsRig(t), false, "no capture: the stage passes its input");
  t.fxConfig["nam#2"] = { wet: 0.5, model };
  assert.equal(namOwnsRig(t), true, "a copy counts");
  assert.equal(namOwnsRig({ ...t, engineKey: "dm:bass" }), true);
  assert.equal(namOwnsRig({ ...t, engineKey: "dm:silverbox" }), false, "only an instrument with an amp of its own");
});
