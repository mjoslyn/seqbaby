// ---- NAM: a Neural Amp Modeler capture as a rack stage ------------------------
// Plays a .nam file (https://www.neuralampmodeler.com, the open format the NAM
// plugin uses): a neural network trained on a real amp or pedal,
// run sample by sample on the track's signal.
//
//   in ─ input gain ─┬─▶ MODEL (WaveNet / LSTM / Linear) ─▶ normalize ─▶ gate ─▶ tone ─▶ output ─▶ out
//                    └─▶ gate detector ──────────────────────────────────┘
//
// - **The file is the user's.** Captures belong to whoever made them, so none
//   ship here: the row's `load` reads a .nam from disk. What is kept is not
//   the JSON (a standard model is 400KB of decimal floats) but the config and
//   the weights as base64 float32 (`packNamModel`), about 75KB, in
//   `fxConfig.nam.model`, so a save, undo, a patch and a jam carry it with
//   nothing of their own.
// - **Every WaveNet NAM writes, A1 and A2**, LSTM, and Linear. A
//   SlimmableContainer (a lite and a full model in one file) and a
//   slimmable WaveNet play at full size. A2 is NAM's generic WaveNet
//   (NAM/wavenet/model.cpp): a kernel size, an activation and a gating mode
//   (none, gated, blended) per layer, a bottleneck, grouped convolutions, an
//   optional layer 1x1 and head 1x1, FiLM at any of its eight places, a head
//   rechannel with its own kernel size and dilation, a post-stack head, and a
//   condition model run in front (its weights stored before the model's own).
//   A1 is the special case, and a song saved with the old A1 spec reads the
//   same (`normWN`). Only mono in and out.
// - **Weights are read in the order NeuralAmpModelerCore writes them**
//   (conv1d.cpp / dsp.cpp / lstm.cpp / wavenet/model.cpp): per layer array
//   the rechannel; per layer the dilated conv (group, out, in, tap) and its
//   bias, the condition mix-in, the layer 1x1, the head 1x1, then the FiLMs
//   in their order; the head rechannel; the post-stack head; the last weight
//   is the head scale. Grouped weights are laid out as the dense
//   block-diagonal matrices they are. Every count is checked against the
//   config before anything is kept (`wnCount`).
// - **Tanh is the fast tanh** the NAM plugin runs (it enables it at start),
//   so a model sounds as it does there.
// - **The WaveNet runs in WebAssembly SIMD** (scripts/nam-kernel.wat, built
//   into namKernel.js): the matrix-times-block loops four frames at a time,
//   inside the worklet, not a Worker (a Worker would put a thread hop and its
//   latency between every block). Measured in Node at 48kHz, a standard A1
//   model takes about 8% of a core and a full A2 about 10%, against 130-160%
//   in plain JS. Where SIMD is missing the same builder runs the same loops
//   in plain JS over the same memory (`jsKernel`). Each convolution's input
//   history lives in one buffer with the current block written after it and
//   slid back when it fills.
// - **Run at the model's own rate.** A capture is trained at 48kHz (the file
//   says); at another context rate the input is resampled to it and back
//   (cubic, `RateBridge`), or the whole response would move with the rate.
// - **Normalize** (on by default) uses the file's own loudness to bring the
//   capture to -18dB, as the plugin's "normalize output" does, so swapping a
//   quiet clean capture for a hot fuzz does not jump 20dB.
// - The processor posts what it loaded (`info`) or why it could not.
//
// Runs as an AudioWorklet (a model is state that runs per sample), registered
// from a Blob URL like the other worklets here.

export { NAM_KNOBS, NAM_KNOB_LABELS } from "./soundDefaults.js";
import { NAM_CABS, NAM_NODE_KNOBS, defaultFxConfig } from "./soundDefaults.js";
import { NAM_KERNEL_B64 } from "./namKernel.js";
export { NAM_KERNEL_B64 };

// ---- the WaveNet spec, shared by the packer and the builders ------------------
// These two are plain functions written into the processor's source too
// (Function.prototype.toString), so there is one copy: no backticks, no
// dollar-brace, nothing from outside them.

/** A WaveNet spec as the builder reads it. A song saved before A2 holds the A1 shape ({ arrays: [{ cin, cc, h, c, k, d, act, slope, gated, hb }] }); this reads both. */
function normWN(cfg) {
  if (cfg && cfg.v === 2) return cfg;
  const arrays = cfg.arrays.map(function (s) {
    const n = s.d.length;
    const a = s.act === 8 ? { code: 8, p: [-1, 1, s.slope, s.slope] } : { code: s.act | 0, p: [s.slope] };
    const fill = function (v) { const o = []; for (let i = 0; i < n; i++) o.push(v); return o; };
    return {
      cin: s.cin, cc: s.cc, c: s.c, b: s.c, ks: fill(s.k), d: s.d, acts: fill(a),
      gm: fill(s.gated ? 1 : 0), sec: fill(s.gated ? { code: 4, p: [] } : null), gi: 1, gx: 1,
      l1: { on: true, g: 1 }, h1: { on: false, out: 0, g: 1 }, f: {}, h: s.h, hk: 1, hd: 1, hb: !!s.hb,
    };
  });
  return { v: 2, arrays: arrays, head: null, cond: null };
}

/** How many weights a WaveNet of this spec has, in NeuralAmpModelerCore's set_weights_ order. */
function wnCount(cfg0) {
  const cfg = normWN(cfg0);
  let n = cfg.cond ? cfg.cond.n : 0;
  const film = function (p, cc, dim) { if (!p) return 0; const o = (p.s ? 2 : 1) * dim; return o * (cc / p.g) + o; };
  for (const s of cfg.arrays) {
    const C = s.c, B = s.b, cc = s.cc, f = s.f || {};
    n += C * s.cin;
    for (let i = 0; i < s.d.length; i++) {
      const Cz = s.gm[i] ? 2 * B : B;
      n += Cz * (C / s.gi) * s.ks[i] + Cz + Cz * (cc / s.gx);
      if (s.l1.on) n += C * (B / s.l1.g) + C;
      if (s.h1.on) n += s.h1.out * (B / s.h1.g) + s.h1.out;
      n += film(f.cpre, cc, C) + film(f.cpost, cc, Cz) + film(f.mpre, cc, cc) + film(f.mpost, cc, Cz)
        + film(f.apre, cc, Cz) + film(f.apost, cc, B)
        + (s.l1.on ? film(f.l1p, cc, C) : 0) + (s.h1.on ? film(f.h1p, cc, s.h1.out) : 0);
    }
    const hin = s.h1.on ? s.h1.out : B;
    n += s.h * hin * s.hk + (s.hb ? s.h : 0);
  }
  if (cfg.head) {
    let cin = cfg.arrays[cfg.arrays.length - 1].h;
    for (let i = 0; i < cfg.head.ks.length; i++) {
      const cout = i + 1 === cfg.head.ks.length ? cfg.head.out : cfg.head.ch;
      n += cout * cin * cfg.head.ks[i] + cout;
      cin = cout;
    }
  }
  return n + 1;
}

const NAM_TABLES =
  "const KNOB_DEFAULTS = " + JSON.stringify(NAM_NODE_KNOBS.map((k) => [k, defaultFxConfig().nam[k]])) + ";\n" +
  "const NAM_KERNEL_B64 = " + JSON.stringify(NAM_KERNEL_B64) + ";\n";

// Shared between the processor and Node (the tests render it): the model
// builders. Plain functions, no backticks or dollar-brace (see CLAUDE.md).
const NAM_CORE_SOURCE = String(normWN) + "\n" + String(wnCount) + "\n" + `
const MAXN = 128;
function fastTanh(x) {
  const ax = x < 0 ? -x : x, x2 = x * x;
  const d = x + 0.814642734961073 * x * ax;
  return (x * (2.45550750702956 + 2.45550750702956 * ax + (0.893229853513558 + 0.821226666969744 * ax) * x2))
    / (2.44506634652299 + (2.44506634652299 + x2) * (d < 0 ? -d : d));
}
function fastSigmoid(x) { return 0.5 * (fastTanh(x * 0.5) + 1); }

// Activation specs are { code, p }: 0 tanh (fast), 1 hardtanh, 2 relu,
// 3 leaky relu (p[0] its slope), 4 sigmoid, 5 silu, 6 hardswish, 7 softsign,
// 8 leaky hardtanh (p: min, max, min slope, max slope), 9 prelu (p: a slope
// per channel, cycled). rows x MAXN floats from start; a row is a channel.
function actRows(f, start, rows, a) {
  const n = rows * MAXN, e = start + n, p = a.p || [];
  switch (a.code) {
    case 0: for (let i = start; i < e; i++) f[i] = fastTanh(f[i]); break;
    case 1: for (let i = start; i < e; i++) { const v = f[i]; f[i] = v < -1 ? -1 : (v > 1 ? 1 : v); } break;
    case 2: for (let i = start; i < e; i++) if (f[i] < 0) f[i] = 0; break;
    case 3: { const s = p[0]; for (let i = start; i < e; i++) if (f[i] < 0) f[i] *= s; break; }
    case 4: for (let i = start; i < e; i++) f[i] = 1 / (1 + Math.exp(-f[i])); break;
    case 5: for (let i = start; i < e; i++) { const v = f[i]; f[i] = v / (1 + Math.exp(-v)); } break;
    case 6: for (let i = start; i < e; i++) { const v = f[i]; const r = v + 3; f[i] = v * (r < 0 ? 0 : (r > 6 ? 6 : r)) / 6; } break;
    case 7: for (let i = start; i < e; i++) { const v = f[i]; f[i] = v / (1 + (v < 0 ? -v : v)); } break;
    case 8: { const lo = p[0], hi = p[1], s0 = p[2], s1 = p[3];
      for (let i = start; i < e; i++) { const v = f[i]; f[i] = v < lo ? (v - lo) * s0 + lo : (v > hi ? (v - hi) * s1 + hi : v); } break; }
    case 9: for (let r = 0; r < rows; r++) { const s = p[r % p.length], o = start + r * MAXN;
      for (let i = o; i < o + MAXN; i++) if (f[i] < 0) f[i] *= s; } break;
  }
}

// The kernel's four loops (scripts/nam-kernel.wat) in plain JS, over the same
// memory layout, for where WebAssembly SIMD is missing. Pointers in bytes.
function jsKernel(f) {
  return {
    mmacc(dst, ds, src, ss, W, rows, cols, n) {
      const w0 = W >> 2;
      for (let i = 0; i < rows; i++) {
        const d0 = (dst + i * ds) >> 2, wr = w0 + i * cols;
        for (let j = 0; j < cols; j++) {
          const wv = f[wr + j];
          if (wv === 0) continue;
          const s0 = (src + j * ss) >> 2;
          for (let t = 0; t < n; t++) f[d0 + t] += wv * f[s0 + t];
        }
      }
    },
    setb(dst, ds, src, ss, bias, rows, n) {
      for (let i = 0; i < rows; i++) {
        const d0 = (dst + i * ds) >> 2, bv = bias ? f[(bias >> 2) + i] : 0;
        if (src) { const s0 = (src + i * ss) >> 2; for (let t = 0; t < n; t++) f[d0 + t] = f[s0 + t] + bv; }
        else for (let t = 0; t < n; t++) f[d0 + t] = bv;
      }
    },
    tanh(p, count) { const s = p >> 2; for (let i = s; i < s + count; i++) f[i] = fastTanh(f[i]); },
    vadd(d, s, count) { const a = d >> 2, b = s >> 2; for (let i = 0; i < count; i++) f[a + i] += f[b + i]; },
  };
}

// NAM's WaveNet, A1 and A2 (NAM/wavenet/model.cpp): per layer array a
// rechannel, then per layer an optional FiLM, the dilated conv (its own kernel
// size, grouped or not), the condition mix-in, the activation (plain, gated
// or blended, an activation of its own per layer), the optional layer 1x1 and
// head 1x1, FiLMs at any of eight places, then the head rechannel (a causal
// conv of its own kernel size); an optional post-stack head; an optional
// condition model in front. Every weight, buffer and block lives in one
// memory, the kernel's (WebAssembly SIMD) or a plain Float32Array; grouped
// weights are laid out as the dense block-diagonal matrices they are.
function buildWaveNet(cfg0, w, mod) {
  const cfg = normWN(cfg0);
  const MB = MAXN * 4;
  let top = 64;
  const al = (bytes) => { const a = top; top += (bytes + 15) & ~15; return a; };
  let wi = 0;
  let condModel = null;
  if (cfg.cond) {
    condModel = buildModel(cfg.cond.arch, cfg.cond.cfg, w.subarray(0, cfg.cond.n), mod);
    wi = cfg.cond.n;
  }
  const take = (n) => {
    if (wi + n > w.length) throw new Error("the capture has fewer weights than its config needs");
    const a = w.subarray(wi, wi + n); wi += n; return a;
  };
  const copies = [];
  const put = (arr) => { const ptr = al(arr.length * 4); copies.push([ptr, arr]); return ptr; };
  // conv1d.cpp's order: group, out, in, tap. One dense (cout x cin) matrix per tap.
  function convW(cin, cout, K, groups) {
    const op = cout / groups, ip = cin / groups;
    const raw = take(cout * ip * K);
    const mats = [];
    for (let k = 0; k < K; k++) mats.push(new Float32Array(cout * cin));
    let q = 0;
    for (let g = 0; g < groups; g++) for (let i = 0; i < op; i++) for (let j = 0; j < ip; j++) for (let k = 0; k < K; k++)
      mats[k][(g * op + i) * cin + g * ip + j] = raw[q++];
    return mats.map(put);
  }
  function c1(cin, cout, bias, groups) {
    const W = convW(cin, cout, 1, groups)[0];
    return { W, b: bias ? put(take(cout)) : 0, cin, cout };
  }
  function hist(rows, look) {
    const bufLen = look + 4096, rowF = bufLen + 4;
    return { ptr: al(rows * rowF * 4), rows, look, bufLen, rowF, p: look };
  }
  function film(cc, dim, p) {
    if (!p) return null;
    const c = c1(cc, (p.s ? 2 : 1) * dim, true, p.g);
    return { c, s: !!p.s, dim, ss: al(c.cout * MB) };
  }
  const xin = al(MB);
  let condRows = 1, cond = xin;
  if (condModel) { condRows = condModel.outRows || 1; cond = al(condRows * MB); }
  let maxZ = 0;
  const arrays = cfg.arrays.map((s) => {
    const C = s.c, B = s.b, Cc = s.cc;
    const rech = c1(s.cin, C, false, 1);
    const hin = s.h1.on ? s.h1.out : B;
    const layers = s.d.map((d, li) => {
      const K = s.ks[li], gm = s.gm[li], Cz = gm ? 2 * B : B;
      if (Cz > maxZ) maxZ = Cz;
      const conv = convW(C, Cz, K, s.gi);
      const cb = put(take(Cz));
      const mix = c1(Cc, Cz, false, s.gx);
      const l1 = s.l1.on ? c1(B, C, true, s.l1.g) : null;
      const h1 = s.h1.on ? c1(B, s.h1.out, true, s.h1.g) : null;
      const f = s.f;
      const ly = {
        d, K, Cz, gm, act: s.acts[li], sec: s.sec[li], conv, cb, mix, l1, h1,
        cpre: film(Cc, C, f.cpre), cpost: film(Cc, Cz, f.cpost), mpre: film(Cc, Cc, f.mpre), mpost: film(Cc, Cz, f.mpost),
        apre: film(Cc, Cz, f.apre), apost: film(Cc, B, f.apost),
        l1p: l1 ? film(Cc, C, f.l1p) : null, h1p: h1 ? film(Cc, s.h1.out, f.h1p) : null,
        hist: hist(C, d * (K - 1)), z: al(Cz * MB), out: al(C * MB),
      };
      if (ly.mpre) ly.mi = al(Cc * MB);
      if (ly.mpost) ly.mb = al(Cz * MB);
      if (l1 && ly.l1p) ly.lo = al(C * MB);
      if (h1) ly.ho = al(s.h1.out * MB);
      return ly;
    });
    const hw = convW(hin, s.h, s.hk, 1);
    const hb = s.hb ? put(take(s.h)) : 0;
    let rf = 0;
    for (const ly of layers) rf += ly.d * (ly.K - 1);
    rf += s.hd * (s.hk - 1);
    return { C, B, Cc, cin: s.cin, H: s.h, hk: s.hk, hd: s.hd, hin, rech, layers, hw, hb,
      x0: al(C * MB), acc: al(hin * MB), hh: hist(hin, s.hd * (s.hk - 1)), hout: al(s.h * MB), rf };
  });
  let post = null;
  if (cfg.head) {
    const h = cfg.head, n = h.ks.length;
    let cin = arrays[arrays.length - 1].H;
    post = h.ks.map((k, i) => {
      const cout = i + 1 === n ? h.out : h.ch;
      const W = convW(cin, cout, k, 1), b = put(take(cout));
      const c = { W, b, cin, cout, K: k, tb: al(cin * MB), hh: hist(cin, k - 1), out: al(cout * MB) };
      cin = cout;
      return c;
    });
    post.act = h.act;
  }
  const headScale = take(1)[0];
  if (wi !== w.length) throw new Error("the capture has more weights than its config needs");
  const scr = al(Math.max(1, maxZ) * MB);
  let k, f;
  if (mod) {
    const inst = new WebAssembly.Instance(mod, {});
    const mem = inst.exports.mem;
    const need = Math.ceil(top / 65536) - mem.buffer.byteLength / 65536;
    if (need > 0) mem.grow(need);
    f = new Float32Array(mem.buffer);
    k = inst.exports;
  } else {
    f = new Float32Array(Math.ceil(top / 4) + 4);
    k = jsKernel(f);
  }
  for (const [ptr, arr] of copies) f.set(arr, ptr >> 2);
  const mmacc = k.mmacc, setb = k.setb, vadd = k.vadd, ktanh = k.tanh;
  const act = (ptr, rows, a) => { if (a.code === 0 && mod) ktanh(ptr, rows * MAXN); else actRows(f, ptr >> 2, rows, a); };
  // where a history's current block goes, sliding the history back when full
  function at(H, n) {
    if (H.p + n > H.bufLen) {
      for (let r = 0; r < H.rows; r++) { const o = (H.ptr >> 2) + r * H.rowF; f.copyWithin(o, o + H.p - H.look, o + H.p); }
      H.p = H.look;
    }
    return H.ptr + H.p * 4;
  }
  // x (dim rows) times the scale the condition gives, plus its shift, into dst
  function filmTo(F, src, ss, dst, ds, n) {
    setb(F.ss, MB, 0, 0, F.c.b, F.c.cout, n);
    mmacc(F.ss, MB, cond, MB, F.c.W, F.c.cout, F.c.cin, n);
    const sc = F.ss >> 2, dim = F.dim;
    for (let i = 0; i < dim; i++) {
      const s0 = (src + i * ss) >> 2, d0 = (dst + i * ds) >> 2, a = sc + i * MAXN, b = sc + (dim + i) * MAXN;
      if (F.s) for (let t = 0; t < n; t++) f[d0 + t] = f[s0 + t] * f[a + t] + f[b + t];
      else for (let t = 0; t < n; t++) f[d0 + t] = f[s0 + t] * f[a + t];
    }
  }
  function runArray(A, inp, prevHead, n) {
    const C = A.C, B = A.B, Cc = A.Cc;
    setb(A.x0, MB, 0, 0, 0, C, n);
    mmacc(A.x0, MB, inp, MB, A.rech.W, C, A.cin, n);
    if (prevHead) setb(A.acc, MB, prevHead, MB, 0, A.hin, n);
    else setb(A.acc, MB, 0, 0, 0, A.hin, MAXN);
    let x = A.x0;
    for (const ly of A.layers) {
      const H = ly.hist, hp = at(H, n), hs = H.rowF * 4, z = ly.z, Cz = ly.Cz, K = ly.K, d = ly.d;
      if (ly.cpre) filmTo(ly.cpre, x, MB, hp, hs, n);
      else setb(hp, hs, x, MB, 0, C, n);
      setb(z, MB, 0, 0, ly.cb, Cz, n);
      for (let kk = 0; kk < K; kk++) mmacc(z, MB, hp - d * (K - 1 - kk) * 4, hs, ly.conv[kk], Cz, C, n);
      H.p += n;
      if (ly.cpost) filmTo(ly.cpost, z, MB, z, MB, n);
      let ci = cond;
      if (ly.mpre) { filmTo(ly.mpre, cond, MB, ly.mi, MB, n); ci = ly.mi; }
      if (ly.mpost) {
        setb(ly.mb, MB, 0, 0, 0, Cz, n);
        mmacc(ly.mb, MB, ci, MB, ly.mix.W, Cz, Cc, n);
        filmTo(ly.mpost, ly.mb, MB, ly.mb, MB, n);
        vadd(z, ly.mb, Cz * MAXN);
      } else mmacc(z, MB, ci, MB, ly.mix.W, Cz, Cc, n);
      if (ly.apre) filmTo(ly.apre, z, MB, z, MB, n);
      if (ly.gm === 0) act(z, B, ly.act);
      else {
        const bot = z + B * MB;
        if (ly.gm === 2) setb(scr, MB, z, MB, 0, B, MAXN);
        act(z, B, ly.act);
        act(bot, B, ly.sec);
        const t0 = z >> 2, b0 = bot >> 2, p0 = scr >> 2, cnt = B * MAXN;
        if (ly.gm === 1) for (let i = 0; i < cnt; i++) f[t0 + i] *= f[b0 + i];
        else for (let i = 0; i < cnt; i++) { const g = f[b0 + i]; f[t0 + i] = g * f[t0 + i] + (1 - g) * f[p0 + i]; }
      }
      if (ly.apost) filmTo(ly.apost, z, MB, z, MB, n);
      if (ly.h1) {
        setb(ly.ho, MB, 0, 0, ly.h1.b, ly.h1.cout, n);
        mmacc(ly.ho, MB, z, MB, ly.h1.W, ly.h1.cout, B, n);
        if (ly.h1p) filmTo(ly.h1p, ly.ho, MB, ly.ho, MB, n);
        vadd(A.acc, ly.ho, ly.h1.cout * MAXN);
      } else vadd(A.acc, z, B * MAXN);
      if (ly.l1) {
        if (ly.l1p) {
          setb(ly.lo, MB, 0, 0, ly.l1.b, C, n);
          mmacc(ly.lo, MB, z, MB, ly.l1.W, C, B, n);
          filmTo(ly.l1p, ly.lo, MB, ly.lo, MB, n);
          setb(ly.out, MB, x, MB, 0, C, n);
          vadd(ly.out, ly.lo, C * MAXN);
        } else {
          setb(ly.out, MB, x, MB, ly.l1.b, C, n);
          mmacc(ly.out, MB, z, MB, ly.l1.W, C, B, n);
        }
        x = ly.out;
      }
    }
    const HH = A.hh, hp = at(HH, n), hs = HH.rowF * 4;
    setb(hp, hs, A.acc, MB, 0, A.hin, n);
    setb(A.hout, MB, 0, 0, A.hb, A.H, n);
    for (let kk = 0; kk < A.hk; kk++) mmacc(A.hout, MB, hp - A.hd * (A.hk - 1 - kk) * 4, hs, A.hw[kk], A.H, A.hin, n);
    HH.p += n;
    return x;
  }
  const condY = condModel && !condModel.outRows ? new Float32Array(MAXN) : null;
  let rf = 1 + (condModel ? condModel.rf || 0 : 0);
  for (const A of arrays) rf += A.rf;
  if (post) for (const c of post) rf += c.K - 1;
  const last = arrays[arrays.length - 1];
  function runAll(x, n) {
    f.set(x.subarray(0, n), xin >> 2);
    if (condModel) {
      if (condModel.outRows) {
        const o = condModel.runOut(x, n);
        for (let r = 0; r < condRows; r++) f.set(o.f.subarray(o.ptr + r * MAXN, o.ptr + r * MAXN + n), (cond >> 2) + r * MAXN);
      } else {
        condModel.run(x, condY, n);
        f.set(condY.subarray(0, n), cond >> 2);
      }
    }
    let inp = xin, ph = 0;
    for (const A of arrays) { inp = runArray(A, inp, ph, n); ph = A.hout; }
    if (!post) return { ptr: last.hout, scale: headScale, rows: last.H };
    let src = last.hout, sc = headScale;
    for (const c of post) {
      setb(c.tb, MB, src, MB, 0, c.cin, n);
      if (sc !== 1) { const o = c.tb >> 2; for (let r = 0; r < c.cin; r++) for (let t = 0; t < n; t++) f[o + r * MAXN + t] *= sc; }
      sc = 1;
      act(c.tb, c.cin, post.act);
      const hp = at(c.hh, n), hs = c.hh.rowF * 4;
      setb(hp, hs, c.tb, MB, 0, c.cin, n);
      setb(c.out, MB, 0, 0, c.b, c.cout, n);
      for (let kk = 0; kk < c.K; kk++) mmacc(c.out, MB, hp - (c.K - 1 - kk) * 4, hs, c.W[kk], c.cout, c.cin, n);
      c.hh.p += n;
      src = c.out;
    }
    return { ptr: src, scale: 1, rows: post[post.length - 1].cout };
  }
  const outRows = post ? post[post.length - 1].cout : last.H;
  return {
    rf, wasm: !!mod, outRows,
    run(x, y, n) {
      const r = runAll(x, n), o = r.ptr >> 2, s = r.scale;
      for (let t = 0; t < n; t++) y[t] = s * f[o + t];
    },
    // every output channel, for a model that is another's condition
    runOut(x, n) {
      const r = runAll(x, n), o = r.ptr >> 2;
      if (r.scale !== 1) for (let i = 0; i < r.rows * MAXN; i++) f[o + i] *= r.scale;
      return { f, ptr: o };
    },
  };
}

function buildLSTM(cfg, w) {
  const Hs = cfg.hidden, layers = [];
  let p = 0;
  for (let l = 0; l < cfg.layers; l++) {
    const I = l === 0 ? cfg.input : Hs, cols = I + Hs;
    const W = w.slice(p, p + 4 * Hs * cols); p += 4 * Hs * cols;
    const b = w.slice(p, p + 4 * Hs); p += 4 * Hs;
    const xh = new Float32Array(cols);
    for (let i = 0; i < Hs; i++) xh[I + i] = w[p + i];
    p += Hs;
    const c = w.slice(p, p + Hs); p += Hs;
    layers.push({ I, cols, W, b, xh, c, g: new Float32Array(4 * Hs) });
  }
  const hw = w.slice(p, p + Hs); p += Hs;
  const hbias = w[p];
  return {
    rf: 0,
    run(x, y, n) {
      for (let t = 0; t < n; t++) {
        let inp = null, inOff = 0;
        for (let l = 0; l < layers.length; l++) {
          const Ly = layers[l], xh = Ly.xh, I = Ly.I, cols = Ly.cols, W = Ly.W, g = Ly.g, c = Ly.c;
          if (l === 0) xh[0] = x[t]; else for (let i = 0; i < I; i++) xh[i] = inp[inOff + i];
          for (let r = 0; r < 4 * Hs; r++) {
            let s = Ly.b[r];
            const ro = r * cols;
            for (let j = 0; j < cols; j++) s += W[ro + j] * xh[j];
            g[r] = s;
          }
          for (let i = 0; i < Hs; i++) {
            c[i] = fastSigmoid(g[i + Hs]) * c[i] + fastSigmoid(g[i]) * fastTanh(g[i + 2 * Hs]);
          }
          for (let i = 0; i < Hs; i++) xh[I + i] = fastSigmoid(g[i + 3 * Hs]) * fastTanh(c[i]);
          inp = xh; inOff = I;
        }
        const last = layers[layers.length - 1];
        let s = hbias;
        for (let i = 0; i < Hs; i++) s += hw[i] * last.xh[last.I + i];
        y[t] = s;
      }
    },
  };
}

function buildLinear(cfg, w) {
  const rf = cfg.rf;
  const taps = w.slice(0, rf);   // taps[d] multiplies x[n - d]
  const bias = cfg.bias ? w[rf] : 0;
  const N = 1 << Math.ceil(Math.log2(rf + 1));
  const ring = new Float32Array(N);
  let wp = 0;
  return {
    rf,
    run(x, y, n) {
      for (let t = 0; t < n; t++) {
        ring[wp] = x[t];
        let s = bias;
        for (let d = 0; d < rf; d++) s += taps[d] * ring[(wp - d) & (N - 1)];
        y[t] = s;
        wp = (wp + 1) & (N - 1);
      }
    },
  };
}

function buildModel(arch, cfg, w, mod) {
  if (arch === "WaveNet") return buildWaveNet(cfg, w, mod);
  if (arch === "LSTM") return buildLSTM(cfg, w);
  if (arch === "Linear") return buildLinear(cfg, w);
  throw new Error("unsupported architecture " + arch);
}
// Settle a model on silence, as the plugin does on load: a WaveNet for its
// receptive field, an LSTM for half a second.
function prewarm(m, arch, sr) {
  const n = arch === "LSTM" ? Math.round(0.5 * (sr || 48000)) : (m.rf || 1);
  const x = new Float32Array(MAXN), y = new Float32Array(MAXN);
  for (let done = 0; done < n; done += MAXN) m.run(x, y, MAXN);
}
`;

const NAM_PROCESSOR_SOURCE = NAM_TABLES + NAM_CORE_SOURCE + `
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function dbGain(db) { return Math.pow(10, db / 20); }
// A worklet scope has no atob.
const B64 = new Uint8Array(128);
{ const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; for (let i = 0; i < 64; i++) B64[a.charCodeAt(i)] = i; }
function b64Bytes(s) {
  let n = s.length; while (n && s[n - 1] === "=") n--;
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const a = B64[s.charCodeAt(i)], b = B64[s.charCodeAt(i + 1)], c = B64[s.charCodeAt(i + 2)] | 0, d = B64[s.charCodeAt(i + 3)] | 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
function b64ToF32(s) { const u = b64Bytes(s); return new Float32Array(u.buffer, 0, u.length >> 2); }
// The SIMD kernel, compiled once per scope; null where SIMD is not there.
let KERNEL = undefined;
function kernel() {
  if (KERNEL !== undefined) return KERNEL;
  try { KERNEL = new WebAssembly.Module(b64Bytes(NAM_KERNEL_B64)); } catch (e) { KERNEL = null; }
  return KERNEL;
}
// RBJ biquad, direct form 1, coefficients set per block.
function shelfCoefs(o, type, f, db, q, sr) {
  const A = Math.pow(10, db / 40), w0 = 2 * Math.PI * f / sr, cs = Math.cos(w0), sn = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 0) {        // low shelf
    const al = sn / 2 * Math.sqrt(2), s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) - (A - 1) * cs + s); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s);
    a0 = (A + 1) + (A - 1) * cs + s; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s;
  } else if (type === 2) { // high shelf
    const al = sn / 2 * Math.sqrt(2), s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s);
    a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s;
  } else {                 // peak
    const al = sn / (2 * q);
    b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
  }
  o.b0 = b0 / a0; o.b1 = b1 / a0; o.b2 = b2 / a0; o.a1 = a1 / a0; o.a2 = a2 / a0;
}
function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0, db: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
  return y;
}

// The host rate to the model's and back. Each side keeps the last four input
// samples and reads at a fractional position with Catmull-Rom; a 4-sample
// latency at most, and a cut above about 20kHz only from the cubic's own roll-off.
class RateBridge {
  constructor(ratio) {
    this.r = ratio;              // model samples per host sample
    this.inHist = new Float32Array(4); this.inPh = 0;
    this.outHist = new Float32Array(4); this.outPh = 0;
    this.mIn = new Float32Array(MAXN * 4); this.mOut = new Float32Array(MAXN * 4);
    this.queue = new Float32Array(MAXN * 4); this.qn = 0;
  }
}
function cr(y0, y1, y2, y3, f) {
  return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
}

class NamProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return KNOB_DEFAULTS.map(function (kd) {
      return { name: kd[0], defaultValue: kd[1], minValue: 0, maxValue: 1, automationRate: "k-rate" };
    });
  }
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.norm = o.norm !== false;
    this.model = null; this.arch = ""; this.loud = null; this.modelSr = 0;
    this.pending = null;
    this.fade = 1;
    this.x = new Float32Array(MAXN); this.y = new Float32Array(MAXN);
    this.env = 0; this.gateG = 1; this.hold = 0;
    this.bass = bq(); this.mid = bq(); this.treb = bq();
    this.eqKey = "";
    this.dcx = 0; this.dcy = 0;
    this.bridge = null;
    this.alive = true;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }
  onMessage(m) {
    if (!m) return;
    if (m.type === "dispose") { this.alive = false; return; }
    if (m.type === "norm") { this.norm = !!m.on; return; }
    if (m.type === "model") {
      if (!m.model) { this.pending = { none: true }; return; }
      try {
        const mm = m.model;
        const w = b64ToF32(mm.w);
        if (w.length !== mm.n) throw new Error("the capture's weights are cut short");
        const model = buildModel(mm.arch, mm.cfg, w, kernel());
        const msr = mm.sr || 48000;
        prewarm(model, mm.arch, msr);
        this.pending = { model, arch: mm.arch, loud: typeof mm.loud === "number" ? mm.loud : null, sr: msr };
        this.port.postMessage({ type: "info", ok: true, name: mm.name, arch: mm.arch, sr: msr, hostSr: sampleRate, simd: !!model.wasm });
      } catch (err) {
        this.port.postMessage({ type: "info", ok: false, error: String((err && err.message) || err) });
      }
    }
  }
  swapIn() {
    const p = this.pending; this.pending = null;
    if (p.none) { this.model = null; this.arch = ""; this.loud = null; this.bridge = null; return; }
    this.model = p.model; this.arch = p.arch; this.loud = p.loud; this.modelSr = p.sr;
    this.bridge = Math.abs(p.sr - sampleRate) > 1 ? new RateBridge(p.sr / sampleRate) : null;
  }
  // The model over one block of host-rate samples (x in, y out, in place ok).
  runModel(x, y, n) {
    const B = this.bridge;
    if (!B) { this.model.run(x, y, n); return; }
    // host -> model rate
    const r = B.r, mIn = B.mIn, h = B.inHist;
    let m = 0;
    for (let t = 0; t < n; t++) {
      h[0] = h[1]; h[1] = h[2]; h[2] = h[3]; h[3] = x[t];
      while (B.inPh < 1) { mIn[m++] = cr(h[0], h[1], h[2], h[3], B.inPh); B.inPh += 1 / r; }
      B.inPh -= 1;
    }
    // run in chunks of MAXN
    const mOut = B.mOut;
    for (let s = 0; s < m; s += MAXN) {
      const k = Math.min(MAXN, m - s);
      this.model.run(mIn.subarray(s, s + k), mOut.subarray(s, s + k), k);
    }
    // model -> host rate, through a small queue
    const q = B.queue, oh = B.outHist;
    for (let i = 0; i < m; i++) q[B.qn++] = mOut[i];
    let qi = 0;
    for (let t = 0; t < n; t++) {
      while (B.outPh >= 1 && qi < B.qn) {
        oh[0] = oh[1]; oh[1] = oh[2]; oh[2] = oh[3]; oh[3] = q[qi++];
        B.outPh -= 1;
      }
      y[t] = cr(oh[0], oh[1], oh[2], oh[3], B.outPh);
      B.outPh += r;
    }
    q.copyWithin(0, qi, B.qn); B.qn -= qi;
  }
  process(inputs, outputs, params) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0] || [];
    const iL = inp[0], iR = inp[1] || iL;
    if (!iL) { oL.fill(0); if (oR !== oL) oR.fill(0); return this.alive; }
    if (!this.model && !this.pending) {
      oL.set(iL); if (oR !== oL) oR.set(iR);
      return this.alive;
    }
    const inG = dbGain((params.input[0] - 0.5) * 48);
    const outG = dbGain((params.output[0] - 0.5) * 48);
    const gv = params.gate[0];
    const thr = gv <= 0 ? 0 : dbGain(-100 + gv * 80);
    const eqKey = params.bass[0] + "," + params.mid[0] + "," + params.treble[0];
    if (eqKey !== this.eqKey) {
      this.eqKey = eqKey;
      shelfCoefs(this.bass, 0, 150, (params.bass[0] - 0.5) * 24, 0.7, sampleRate);
      shelfCoefs(this.mid, 1, 600, (params.mid[0] - 0.5) * 24, 0.7, sampleRate);
      shelfCoefs(this.treb, 2, 2500, (params.treble[0] - 0.5) * 24, 0.7, sampleRate);
    }
    const x = this.x, y = this.y;
    for (let t = 0; t < n; t++) x[t] = 0.5 * (iL[t] + iR[t]) * inG;
    if (this.model) this.runModel(x, y, n); else y.fill(0);
    const ng = this.norm && this.loud != null ? dbGain(-18 - this.loud) : 1;
    const relEnv = Math.exp(-1 / (0.02 * sampleRate));
    const gAtk = 1 - Math.exp(-1 / (0.001 * sampleRate)), gRel = 1 - Math.exp(-1 / (0.06 * sampleRate));
    const holdN = 0.03 * sampleRate;
    const fstep = 1 / (0.01 * sampleRate);
    const dcR = 1 - 2 * Math.PI * 10 / sampleRate;
    for (let t = 0; t < n; t++) {
      // gate, keyed on the input
      if (thr > 0) {
        const a = x[t] < 0 ? -x[t] : x[t];
        this.env = a > this.env ? a : this.env * relEnv;
        if (this.env > thr) this.hold = holdN; else if (this.hold > 0) this.hold--;
        const tgt = this.hold > 0 ? 1 : 0;
        this.gateG += (tgt - this.gateG) * (tgt > this.gateG ? gAtk : gRel);
      } else this.gateG = 1;
      let v = y[t] * ng * this.gateG;
      // DC block
      const dc = v - this.dcx + dcR * this.dcy; this.dcx = v; this.dcy = dc; v = dc;
      v = bqRun(this.treb, bqRun(this.mid, bqRun(this.bass, v)));
      // model swaps fade out, swap, fade in
      if (this.pending) { this.fade -= fstep; if (this.fade <= 0) { this.fade = 0; this.swapIn(); } }
      else if (this.fade < 1) this.fade = Math.min(1, this.fade + fstep);
      v *= outG * this.fade;
      if (!(v === v) || v > 8 || v < -8) v = v > 0 ? 8 : (v < 0 ? -8 : 0);
      oL[t] = v;
      if (oR !== oL) oR[t] = v;
    }
    return this.alive;
  }
}
registerProcessor("sq-nam", NamProcessor);
`;

// ---- the file, read and packed (main thread, and Node) ----------------------

export class NamError extends Error {}

const ACTIVATIONS = { Tanh: 0, Fasttanh: 0, Hardtanh: 1, ReLU: 2, LeakyReLU: 3, Sigmoid: 4, SiLU: 5, Hardswish: 6, Softsign: 7, LeakyHardtanh: 8, LeakyHardTanh: 8, PReLU: 9 };
const num = (v, d) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);

/** activations.cpp's ActivationConfig::from_json, as { code, p }. */
function actOf(a) {
  const name = typeof a === "string" ? a : a?.type;
  if (!(name in ACTIVATIONS)) throw new NamError(`unknown activation ${JSON.stringify(name)}`);
  const code = ACTIVATIONS[name], o = a && typeof a === "object" ? a : {};
  if (code === 3) return { code, p: [num(o.negative_slope, 0.01)] };
  if (code === 8) return { code, p: [num(o.min_val, -1), num(o.max_val, 1), num(o.min_slope, 0.01), num(o.max_slope, 0.01)] };
  if (code === 9) {
    const sl = Array.isArray(o.negative_slopes) && o.negative_slopes.length ? o.negative_slopes.map((v) => num(v, 0.01)) : [num(o.negative_slope, 0.01)];
    return { code, p: sl };
  }
  return { code, p: [] };
}

const posInt = (v) => Number.isInteger(v) && v > 0;
const FILMS = [["cpre", "conv_pre_film"], ["cpost", "conv_post_film"], ["mpre", "input_mixin_pre_film"], ["mpost", "input_mixin_post_film"],
  ["apre", "activation_pre_film"], ["apost", "activation_post_film"], ["l1p", "layer1x1_post_film"], ["h1p", "head1x1_post_film"]];

/** How many channels a packed model hands on (a condition model's output). */
function outRowsOf(arch, cfg) {
  if (arch !== "WaveNet") return 1;
  const s = normWN(cfg);
  return s.head ? s.head.out : s.arrays[s.arrays.length - 1].h;
}

/** One layer array of a WaveNet config, read as model.cpp's parse_config_json reads it. */
function arraySpec(L, i, condRows) {
  const where = `layer array ${i + 1}`;
  const C = L.channels, B = L.bottleneck ?? C;
  const d = L.dilations;
  if (!posInt(C) || !posInt(B) || !Array.isArray(d) || !d.length || !d.every(posInt)) throw new NamError(`the WaveNet's ${where} is missing a size`);
  const n = d.length;
  if (L.kernel_size != null && L.kernel_sizes != null) throw new NamError(`the WaveNet's ${where} gives two kernel sizes`);
  const ks = L.kernel_sizes != null ? L.kernel_sizes : Array(n).fill(L.kernel_size);
  if (!Array.isArray(ks) || ks.length !== n || !ks.every(posInt)) throw new NamError(`the WaveNet's ${where} has no kernel size for every layer`);
  const acts = (Array.isArray(L.activation) ? L.activation : Array(n).fill(L.activation ?? "Tanh")).map(actOf);
  if (acts.length !== n) throw new NamError(`the WaveNet's ${where} has no activation for every layer`);
  const MODES = { none: 0, gated: 1, blended: 2 };
  let gm, sec;
  if (L.gating_mode != null) {
    const raw = Array.isArray(L.gating_mode) ? L.gating_mode : Array(n).fill(L.gating_mode);
    if (raw.length !== n || raw.some((m) => !(m in MODES))) throw new NamError(`the WaveNet's ${where} has a gating mode seqbaby doesn't know`);
    gm = raw.map((m) => MODES[m]);
    const sa = L.secondary_activation;
    sec = gm.map((m, li) => (m === 0 ? null : actOf(sa == null || sa === "" ? "Sigmoid" : (Array.isArray(sa) ? (sa[li] ?? "Sigmoid") : sa))));
  } else {
    gm = Array(n).fill(L.gated ? 1 : 0);
    sec = gm.map((m) => (m ? actOf("Sigmoid") : null));
  }
  let h, hk = 1, hd = 1, hb;
  if (L.head && typeof L.head === "object") {
    h = L.head.out_channels; hk = L.head.kernel_size; hd = L.head.head_dilation ?? 1; hb = !!L.head.bias;
  } else { h = L.head_size; hb = !!L.head_bias; }
  if (!posInt(h) || !posInt(hk) || !posInt(hd)) throw new NamError(`the WaveNet's ${where} has no readable head`);
  const gi = L.groups_input ?? 1, gx = L.groups_input_mixin ?? 1;
  const l1 = L.layer1x1 ? { on: !!L.layer1x1.active, g: L.layer1x1.groups ?? 1 } : { on: true, g: 1 };
  const h1 = L.head1x1 && L.head1x1.active ? { on: true, out: L.head1x1.out_channels, g: L.head1x1.groups ?? 1 } : { on: false, out: 0, g: 1 };
  if (!l1.on && B !== C) throw new NamError(`the WaveNet's ${where} has no layer 1x1 but a bottleneck`);
  if (h1.on && !posInt(h1.out)) throw new NamError(`the WaveNet's ${where} has a head 1x1 with no size`);
  const f = {};
  for (const [k, key] of FILMS) {
    const v = L[key];
    if (v == null || v === false || (typeof v === "object" && v.active === false)) continue;
    f[k] = { s: typeof v === "object" ? v.shift !== false : true, g: (typeof v === "object" && v.groups) || 1 };
  }
  if (f.l1p && !l1.on) throw new NamError(`the WaveNet's ${where} has a FiLM after a layer 1x1 it doesn't have`);
  if (f.h1p && !h1.on) throw new NamError(`the WaveNet's ${where} has a FiLM after a head 1x1 it doesn't have`);
  const cc = L.condition_size ?? 1, cin = L.input_size;
  if (!posInt(cc) || !posInt(cin)) throw new NamError(`the WaveNet's ${where} is missing a size`);
  if (cc !== condRows) throw new NamError(`the WaveNet's ${where} expects a condition of ${cc} channels and gets ${condRows}`);
  const divides = (a, g) => posInt(g) && a % g === 0;
  const Cz = (m) => (m ? 2 * B : B);
  const filmDim = (k, m) => ({ cpre: C, cpost: Cz(m), mpre: cc, mpost: Cz(m), apre: Cz(m), apost: B, l1p: C, h1p: h1.out })[k];
  const ok = divides(C, gi) && gm.every((m) => divides(Cz(m), gi)) && divides(cc, gx) && gm.every((m) => divides(Cz(m), gx))
    && (!l1.on || (divides(B, l1.g) && divides(C, l1.g))) && (!h1.on || (divides(B, h1.g) && divides(h1.out, h1.g)))
    && Object.entries(f).every(([k, p]) => divides(cc, p.g) && gm.every((m) => divides((p.s ? 2 : 1) * filmDim(k, m), p.g)));
  if (!ok) throw new NamError(`the WaveNet's ${where} has groups that don't divide its channels`);
  return { cin, cc, c: C, b: B, ks, d, acts, gm, sec, gi, gx, l1, h1, f, h, hk, hd, hb };
}

/** A WaveNet config as the builder's spec, or a NamError naming what is wrong with it. */
function waveNetSpec(config, sr, depth, top) {
  if ((config.in_channels ?? 1) !== 1) throw new NamError("only mono captures are read");
  let cond = null, condW = null, condRows = 1;
  if (config.condition_dsp) {
    if (depth >= 3) throw new NamError("the capture's condition models nest too deep");
    const sub = packCore(config.condition_dsp, depth + 1);
    if (sub.sr !== sr) throw new NamError("the capture's condition model runs at another sample rate");
    condRows = outRowsOf(sub.arch, sub.cfg);
    cond = { arch: sub.arch, cfg: sub.cfg, n: sub.w.length };
    condW = sub.w;
  }
  const layers = config.layers;
  if (!Array.isArray(layers) || !layers.length) throw new NamError("the WaveNet has no layers");
  const arrays = layers.map((L, i) => arraySpec(L, i, condRows));
  if (arrays[0].cin !== 1) throw new NamError("only mono captures are read");
  for (let a = 1; a < arrays.length; a++) {
    const p = arrays[a - 1], s = arrays[a];
    if (s.cin !== p.c) throw new NamError("the WaveNet's layer arrays do not chain (input size)");
    if ((s.h1.on ? s.h1.out : s.b) !== p.h) throw new NamError("the WaveNet's layer arrays do not chain (head size)");
  }
  let head = null;
  if (config.head != null) {
    const hj = config.head;
    const ks = hj.kernel_sizes;
    if (!posInt(hj.out_channels) || !posInt(hj.channels ?? 1) || !Array.isArray(ks) || !ks.length || !ks.every(posInt)) throw new NamError("the WaveNet's head is missing a size");
    if (hj.in_channels != null && hj.in_channels !== arrays[arrays.length - 1].h) throw new NamError("the WaveNet's head does not fit its last layer array");
    head = { ch: hj.channels, out: hj.out_channels, ks, act: actOf(hj.activation) };
  }
  const spec = { v: 2, arrays, head, cond };
  if (top && outRowsOf("WaveNet", spec) !== 1) throw new NamError("only mono captures are read");
  return { spec, condW };
}

/** How many weights a model of this shape has (a WaveNet's own and its condition model's). */
export function namWeightCount(arch, cfg) {
  if (arch === "WaveNet") return wnCount(cfg);
  if (arch === "LSTM") {
    let n = 0;
    for (let l = 0; l < cfg.layers; l++) {
      const I = l === 0 ? cfg.input : cfg.hidden;
      n += 4 * cfg.hidden * (I + cfg.hidden) + 4 * cfg.hidden + 2 * cfg.hidden;
    }
    return n + cfg.hidden + 1;
  }
  if (arch === "Linear") return cfg.rf + (cfg.bias ? 1 : 0);
  return -1;
}

/** A parsed .nam's spec: { arch, cfg, condW, sr, meta, want } (want: how many weights its own `weights` must hold). */
function specOf(d, depth = 0, top = depth === 0) {
  if (!d || typeof d !== "object") throw new NamError("not a .nam file");
  if (d.architecture === "SlimmableContainer" && Array.isArray(d.config?.submodels) && d.config.submodels.length) {
    const subs = [...d.config.submodels].sort((a, b) => (b.max_value ?? 0) - (a.max_value ?? 0));
    return specOf(subs[0].model, depth, top);
  }
  const arch = d.architecture;
  const c = d.config || {};
  const sr = Number(d.sample_rate) > 0 ? Number(d.sample_rate) : 48000;
  let cfg, condW = null;
  if (arch === "WaveNet") ({ spec: cfg, condW } = waveNetSpec(c, sr, depth, top));
  else if (arch === "LSTM") {
    cfg = { layers: c.num_layers | 0, input: c.input_size | 0, hidden: c.hidden_size | 0 };
    if (!(cfg.layers > 0 && cfg.input === 1 && cfg.hidden > 0)) throw new NamError("the LSTM's sizes are not readable");
  } else if (arch === "Linear") {
    cfg = { rf: c.receptive_field | 0, bias: !!c.bias };
    if (!(cfg.rf > 0)) throw new NamError("the Linear model has no receptive field");
  } else throw new NamError(`seqbaby doesn't run ${arch ? `the ${arch} architecture` : "this file"} (it reads WaveNet, LSTM and Linear)`);
  const want = namWeightCount(arch, cfg) - (condW ? condW.length : 0);
  return { arch, cfg, condW, sr, meta: d.metadata || {}, want, weights: d.weights };
}

/** How many weights a parsed .nam's own `weights` must hold (its condition model's are its own). */
export function namWeightsWanted(d) { return specOf(d, 0, false).want; }

/** A parsed .nam as { arch, cfg, w (Float32Array, a condition model's weights first), sr, meta }. */
function packCore(d, depth = 0) {
  const { arch, cfg, condW, sr, meta, want, weights } = specOf(d, depth);
  if (!Array.isArray(weights)) throw new NamError("the file has no weights");
  if (weights.length !== want) throw new NamError(`the file has ${weights.length} weights where its config needs ${want}: a NAM format seqbaby doesn't read`);
  let f = Float32Array.from(weights, Number);
  if (f.some((v) => !Number.isFinite(v))) throw new NamError("the weights are not all numbers");
  if (condW) { const all = new Float32Array(condW.length + f.length); all.set(condW); all.set(f, condW.length); f = all; }
  return { arch, cfg, w: f, sr, meta };
}

function f32ToB64(f) {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}
function b64ToF32(s) {
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const out = new Float32Array(bin.length >> 2);
  const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < out.length * 4; i++) u8[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A .nam file (text or parsed) as what fxConfig.nam.model keeps:
 * `{ name, arch, cfg, sr, loud, n, w }`, w the weights as base64 float32.
 * Throws NamError with a reason a person can read.
 */
export function packNamModel(file, name = "") {
  let d = file;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch { throw new NamError("not a .nam file (it isn't JSON)"); }
  }
  const { arch, cfg, w: f, sr, meta } = packCore(d);
  const label = String(name || meta.name || [meta.gear_make, meta.gear_model].filter(Boolean).join(" ") || "capture").replace(/\.nam$/i, "").slice(0, 80);
  const loud = Number.isFinite(Number(meta.loudness)) && meta.loudness !== null ? Number(meta.loudness) : null;
  return { name: label, arch, cfg, sr, loud, n: f.length, w: f32ToB64(f) };
}

/** A packed model's weights, as Float32Array. */
export function unpackNamWeights(model) { return b64ToF32(model.w); }

/** A packed model's one-line description for the row. */
export function namModelLabel(m) {
  if (!m) return "no capture loaded";
  let size = m.arch;
  if (m.arch === "WaveNet" && m.cfg) {
    const cfg = normWN(m.cfg), A = cfg.arrays, c = A[0]?.c;
    // anything the A1 trainer never wrote makes it an A2 (NAM's A2-Full is 8 channels, A2-Lite 3)
    const a2 = !!(cfg.cond || cfg.head) || A.some((s) => s.b !== s.c || s.hk !== 1 || s.gi !== 1 || s.gx !== 1 || !s.l1.on || s.l1.g !== 1 || s.h1.on
      || Object.keys(s.f || {}).length || s.gm.some((g) => g === 2) || s.ks.some((k) => k !== s.ks[0]) || s.acts.some((a) => a.code !== s.acts[0].code));
    size = a2 ? `WaveNet A2${({ 8: " full", 3: " lite" })[c] || ""}` : `WaveNet ${({ 16: "standard", 12: "lite", 8: "feather", 4: "nano" })[c] || `${c}-channel`}`;
  }
  return `${m.name} · ${size}`;
}

/** The input / output knobs as dB, the middle 0. */
export function namGainLabel(v) {
  const db = Math.round((Math.min(1, Math.max(0, Number(v) || 0)) - 0.5) * 48 * 10) / 10;
  return db === 0 ? "0 dB" : `${db > 0 ? "+" : "−"}${Math.abs(db)} dB`;
}
export function namToneLabel(v) {
  const db = Math.round((Math.min(1, Math.max(0, Number(v) || 0)) - 0.5) * 24 * 10) / 10;
  return db === 0 ? "0 dB" : `${db > 0 ? "+" : "−"}${Math.abs(db)} dB`;
}
/** The mic knob: the middle leaves the cab as it is; down is the cone's edge, up its centre. */
export function namMicLabel(v) {
  const x = Math.round((Math.min(1, Math.max(0, Number(v) || 0)) - 0.5) * 200);
  return x === 0 ? "as is" : x < 0 ? `edge ${-x}%` : `centre ${x}%`;
}
export function namCabMixLabel(v) { return `${Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100)}% cab`; }
/** What the mic knob does to the sound, for the rack and the tests: a lowpass corner and a presence bell. */
export const NAM_MIC = { lpBase: 1500, lpSpan: 27000, presF: 3200, presQ: 0.9, presDb: 12 };
export function namMicCurve(v) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  return { lp: NAM_MIC.lpBase + NAM_MIC.lpSpan * x, presDb: (x - 0.5) * NAM_MIC.presDb };
}
export function namGateLabel(v) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  return x <= 0 ? "off" : `${Math.round(-100 + x * 80)} dB`;
}

// ---- the cab --------------------------------------------------------------------
// The speaker after the capture is a convolution (a ConvolverNode in the
// rack), from an impulse response: either a built-in cab, made here from the
// same filters the guitar's and bass's own cabs are (guitar.js, bass.js, at
// their default mic position), or a .wav someone loaded (`packNamIR`).

const MIC = 0.35;
// Guitar cabs (guitar.js CABS) and bass cabs (bass.js CABS), the same numbers.
const CAB_DEFS = {
  "4x12": { g: 1, hp: 85,  lp: 4200, pf: 2400, pg: 5,   nf: 1150, ng: -4, rf: 110, rg: 3.5, bf: 1700, bg: -2.5 },
  "2x12": { g: 1, hp: 95,  lp: 4700, pf: 2700, pg: 4.5, nf: 1050, ng: -3, rf: 120, rg: 3,   bf: 1900, bg: -2 },
  "1x12": { g: 1, hp: 105, lp: 5100, pf: 3000, pg: 4,   nf: 950,  ng: -3, rf: 135, rg: 2.5, bf: 2100, bg: -2 },
  "1x8":  { g: 1, hp: 190, lp: 5800, pf: 3400, pg: 3.5, nf: 850,  ng: -2, rf: 240, rg: 2,   bf: 2400, bg: -1.5 },
  b8x10:  { g: 0, hp: 45,  lp: 3800, pf: 1800, pg: 3,   nf: 520,  ng: -2 },
  b4x10:  { g: 0, hp: 55,  lp: 4600, pf: 2200, pg: 3.5, nf: 460,  ng: -2 },
  b1x15:  { g: 0, hp: 38,  lp: 2500, pf: 850,  pg: 3,   nf: 1600, ng: -3 },
  b2x12:  { g: 0, hp: 50,  lp: 3400, pf: 1500, pg: 3,   nf: 700,  ng: -2 },
};
export const NAM_CAB_LABELS = {
  off: "off", "4x12": "4x12", "2x12": "2x12", "1x12": "1x12", "1x8": "1x8",
  b8x10: "bass 8x10", b4x10: "bass 4x10", b1x15: "bass 1x15", b2x12: "bass 2x12", file: "IR file",
};
const CAB_SECONDS = 0.1;          // a built-in cab's response is long gone by then
const IR_MAX_SECONDS = 0.5;       // a loaded one is cut to this

function biquad(type, sr, f, q, db = 0) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.47) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, db / 40);
  let b;
  if (type === "lp") b = [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al];
  else if (type === "hp") b = [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
  else b = [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
  return { b0: b[0] / b[3], b1: b[1] / b[3], b2: b[2] / b[3], a1: b[4] / b[3], a2: b[5] / b[3] };
}
function runBiquad(f, x) {
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = f.b0 * v + z1;
    z1 = f.b1 * v - f.a1 * y + z2; z2 = f.b2 * v - f.a2 * y; x[i] = y;
  }
}
/**
 * Scale an impulse response so its power gain, averaged over the band an amp
 * lives in (80Hz..6kHz, 24 points spaced in octaves), is unity: switching a
 * cab in changes the tone, not the level. (Unit energy, white noise in and
 * out, measured 4-5dB louder on a real capture, which is all low end.)
 */
const BAND = Array.from({ length: 24 }, (_, i) => 80 * Math.pow(6000 / 80, i / 23));
function unitEnergy(h, sr = 48000) {
  let p = 0;
  for (const f of BAND) {
    const w = 2 * Math.PI * f / sr;
    let re = 0, im = 0;
    for (let i = 0; i < h.length; i++) { re += h[i] * Math.cos(w * i); im -= h[i] * Math.sin(w * i); }
    p += re * re + im * im;
  }
  p /= BAND.length;
  const g = p > 0 ? 1 / Math.sqrt(p) : 0;
  for (let i = 0; i < h.length; i++) h[i] *= g;
  return h;
}

/** A built-in cab's impulse response at a rate, or null for off / file / unknown. */
export function namCabImpulse(cab, sr) {
  const C = CAB_DEFS[cab];
  if (!C || !(sr > 0)) return null;
  const h = new Float32Array(Math.round(CAB_SECONDS * sr));
  h[0] = 1;
  const chain = C.g
    ? [biquad("hp", sr, C.hp, 0.72), biquad("pk", sr, C.rf, 1.6, C.rg), biquad("pk", sr, C.pf, 1.3, C.pg * (0.4 + MIC)),
       biquad("pk", sr, C.bf, 2.5, C.bg), biquad("lp", sr, C.lp * (0.62 + MIC * 0.8), 0.54),
       biquad("lp", sr, C.lp * (0.62 + MIC * 0.8), 1.31), biquad("pk", sr, C.nf, 1.1, C.ng)]
    : [biquad("hp", sr, C.hp, 0.72), biquad("pk", sr, C.pf, 1.2, C.pg * (0.4 + MIC)),
       biquad("lp", sr, C.lp * (0.6 + MIC * 0.85), 0.9), biquad("pk", sr, C.nf, 1.1, C.ng)];
  for (const f of chain) runBiquad(f, h);
  return unitEnergy(h, sr);
}

/**
 * A decoded impulse response (an AudioBuffer, or {sampleRate, channels:
 * Float32Array[]}) as what fxConfig.nam.ir keeps: mono, the silent tail cut,
 * at most half a second, faded out, as base64 float32 `{ name, sr, n, w, ir }`.
 */
export function packNamIR(buf, name = "") {
  const sr = buf?.sampleRate;
  const chans = buf?.channels ?? (buf?.numberOfChannels ? Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)) : null);
  if (!(sr > 0) || !chans?.length || !chans[0].length) throw new NamError("that isn't an impulse response (no audio in it)");
  const len = chans[0].length;
  const mono = new Float32Array(len);
  for (const c of chans) for (let i = 0; i < len; i++) mono[i] += c[i] / chans.length;
  let pk = 0;
  for (const v of mono) pk = Math.max(pk, Math.abs(v));
  if (pk <= 0) throw new NamError("the impulse response is silent");
  let end = len;
  while (end > 1 && Math.abs(mono[end - 1]) < pk * 1e-4) end--;
  end = Math.min(end, Math.round(IR_MAX_SECONDS * sr));
  const h = mono.slice(0, Math.max(end, 1));
  const fade = Math.min(h.length >> 2, Math.round(0.005 * sr));
  for (let i = 0; i < fade; i++) h[h.length - 1 - i] *= i / fade;
  unitEnergy(h, sr);
  const label = String(name || "impulse response").replace(/\.wav$/i, "").slice(0, 80);
  return { name: label, sr, n: h.length, w: f32ToB64(h), ir: true };
}

/** A packed IR at a rate (linear interpolation: a cab's response has little up where it would alias). */
export function namIRAt(ir, sr) {
  const h = b64ToF32(ir.w);
  if (!(sr > 0) || Math.abs(ir.sr - sr) < 0.5) return h;
  const r = ir.sr / sr, n = Math.max(1, Math.floor(h.length / r));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * r, j = Math.floor(p), f = p - j;
    out[i] = (h[j] ?? 0) + ((h[j + 1] ?? 0) - (h[j] ?? 0)) * f;
  }
  return unitEnergy(out, sr);
}

/** The impulse response a config asks for, at a rate, with a key that changes only when it does; null for none. */
export function namCabFor(cfg, sr) {
  const cab = NAM_CABS.includes(cfg?.cab) ? cfg.cab : "off";
  if (cab === "off") return null;
  if (cab === "file") {
    const ir = cfg.ir;
    if (!ir || typeof ir.w !== "string") return null;
    return { key: `file:${ir.name}:${ir.n}:${ir.w.slice(0, 40)}:${ir.w.slice(-40)}:${sr}`, h: () => namIRAt(ir, sr) };
  }
  return { key: `${cab}:${sr}`, h: () => namCabImpulse(cab, sr) };
}

// ---- the worklet --------------------------------------------------------------

const _loads = new WeakMap();
const _ready = new WeakSet();

export function loadNamWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([NAM_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}
export function namReady(ctx) { return !!ctx && _ready.has(ctx); }

/** The node, or null when the worklet isn't registered (the stage passes through). */
export function buildNamNode(ctx, config) {
  if (!namReady(ctx)) { loadNamWorklet(ctx).catch(() => {}); return null; }
  try {
    return new AudioWorkletNode(ctx, "sq-nam", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { norm: config?.norm !== "off" },
    });
  } catch (e) {
    console.warn("nam worklet node failed", e);
    return null;
  }
}

/** For the tests: the processor, and the model builders alone. */
export function namProcessorSource() { return NAM_PROCESSOR_SOURCE; }
export function namCoreSource() { return NAM_CORE_SOURCE; }
