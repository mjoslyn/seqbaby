// A naive reference for NeuralAmpModelerCore's generic WaveNet (A1 and A2),
// written line by line from NAM/wavenet/model.cpp (parse_config_json,
// Layer::Process, LayerArray::ProcessInner, WaveNet::process, Head), film.h,
// gating_activations.h, conv1d.cpp and dsp.cpp (the grouped weight orders).
// Whole signals, Float64, no blocks and no buffers: the thing nam.js's
// block-wise builder is held to in test/nam.test.js.

function fastTanh(x) {
  const ax = Math.abs(x), x2 = x * x;
  return (x * (2.45550750702956 + 2.45550750702956 * ax + (0.893229853513558 + 0.821226666969744 * ax) * x2))
    / (2.44506634652299 + (2.44506634652299 + x2) * Math.abs(x + 0.814642734961073 * x * ax));
}

/** activations.cpp: ActivationConfig::from_json + get_activation. Tanh is the fast one (the plugin enables it). */
function activation(j) {
  if (j == null || j === "") return null;
  const type = typeof j === "string" ? j : j.type;
  const o = typeof j === "string" ? {} : j;
  const ew = (f) => (m) => m.map((r) => r.map(f));
  switch (type) {
    case "Tanh": case "Fasttanh": return ew(fastTanh);
    case "Hardtanh": return ew((x) => Math.max(-1, Math.min(1, x)));
    case "ReLU": return ew((x) => Math.max(0, x));
    case "LeakyReLU": { const s = o.negative_slope ?? 0.01; return ew((x) => (x > 0 ? x : s * x)); }
    case "PReLU": {
      const sl = o.negative_slopes ?? [o.negative_slope ?? 0.01];
      // per channel: row index (a column-major buffer walked flat, pos % n)
      return (m) => m.map((r, c) => r.map((x) => (x > 0 ? x : sl[c % sl.length] * x)));
    }
    case "Sigmoid": return ew((x) => 1 / (1 + Math.exp(-x)));
    case "SiLU": return ew((x) => x / (1 + Math.exp(-x)));
    case "Hardswish": return ew((x) => x * Math.min(6, Math.max(0, x + 3)) / 6);
    case "Softsign": return ew((x) => x / (1 + Math.abs(x)));
    case "LeakyHardtanh": case "LeakyHardTanh": {
      const lo = o.min_val ?? -1, hi = o.max_val ?? 1, s0 = o.min_slope ?? 0.01, s1 = o.max_slope ?? 0.01;
      return ew((x) => (x < lo ? (x - lo) * s0 + lo : x > hi ? (x - hi) * s1 + hi : x));
    }
  }
  throw new Error("unknown activation " + type);
}

const zeros = (r, T) => Array.from({ length: r }, () => new Float64Array(T));

/** A weight reader in NAM's order. */
function reader(w) {
  let p = 0;
  return { take(n) { const a = w.slice(p, p + n); p += n; return a; }, get pos() { return p; } };
}

/** conv1d.cpp set_weights_ (g, i, j, k), then bias. Returns {W[k][o][i], b, K, dil}. */
function conv1d(rd, cin, cout, K, bias, dil, groups) {
  const op = cout / groups, ip = cin / groups;
  const W = Array.from({ length: K }, () => zeros(cout, cin));
  for (let g = 0; g < groups; g++) for (let i = 0; i < op; i++) for (let j = 0; j < ip; j++) for (let k = 0; k < K; k++)
    W[k][g * op + i][g * ip + j] = rd.take(1)[0];
  const b = bias ? rd.take(cout) : null;
  return { W, b, K, dil, cin, cout };
}
/** dsp.cpp Conv1x1 set_weights_ (g, i, j), then bias. */
function conv1x1(rd, cin, cout, bias, groups) {
  const c = conv1d(rd, cin, cout, 1, false, 1, groups);
  c.b = bias ? rd.take(cout) : null;
  return c;
}
/** A causal conv over a whole signal: out[o][t] = b[o] + sum_k W[k][o][i] in[i][t - dil (K-1-k)]. */
function runConv(c, inp, T) {
  const out = zeros(c.cout, T);
  for (let o = 0; o < c.cout; o++) for (let t = 0; t < T; t++) {
    let s = c.b ? c.b[o] : 0;
    for (let k = 0; k < c.K; k++) {
      const ti = t - c.dil * (c.K - 1 - k);
      if (ti < 0) continue;
      const row = c.W[k][o];
      for (let i = 0; i < c.cin; i++) s += row[i] * inp[i][ti];
    }
    out[o][t] = s;
  }
  return out;
}
function film(rd, cond, dim, p) {
  if (!p) return null;
  return { c: conv1x1(rd, cond, (p.shift ? 2 : 1) * dim, true, p.groups ?? 1), shift: p.shift, dim };
}
function runFilm(f, x, cond, T) {
  const ss = runConv(f.c, cond, T);
  return x.map((r, i) => r.map((v, t) => v * ss[i][t] + (f.shift ? ss[f.dim + i][t] : 0)));
}

/** parse_config_json, one layer array's params (with NAM's defaults). */
function parseArray(L) {
  const C = L.channels, B = L.bottleneck ?? C, n = L.dilations.length;
  const ks = L.kernel_sizes ?? Array(n).fill(L.kernel_size);
  const acts = Array.isArray(L.activation) ? L.activation : Array(n).fill(L.activation);
  let gm, sec;
  if (L.gating_mode != null) {
    gm = Array.isArray(L.gating_mode) ? L.gating_mode : Array(n).fill(L.gating_mode);
    sec = gm.map((m, i) => m === "none" ? null : (L.secondary_activation == null ? "Sigmoid" : (Array.isArray(L.secondary_activation) ? L.secondary_activation[i] : L.secondary_activation)));
  } else {
    gm = Array(n).fill(L.gated ? "gated" : "none");
    sec = gm.map((m) => (m === "none" ? null : "Sigmoid"));
  }
  const head = L.head ? { H: L.head.out_channels, K: L.head.kernel_size, bias: L.head.bias, dil: L.head.head_dilation ?? 1 } : { H: L.head_size, K: 1, bias: L.head_bias, dil: 1 };
  const fp = (k) => { const v = L[k]; if (v == null || v === false) return null; return v.active === false ? null : { shift: v.shift ?? true, groups: v.groups ?? 1 }; };
  return {
    Cin: L.input_size, Cc: L.condition_size, C, B, ks, d: L.dilations, acts, gm, sec, head,
    gi: L.groups_input ?? 1, gmx: L.groups_input_mixin ?? 1,
    l1: L.layer1x1 ? { on: L.layer1x1.active, g: L.layer1x1.groups } : { on: true, g: 1 },
    h1: L.head1x1 ? { on: L.head1x1.active, out: L.head1x1.out_channels, g: L.head1x1.groups } : { on: false },
    f: Object.fromEntries(["conv_pre_film", "conv_post_film", "input_mixin_pre_film", "input_mixin_post_film", "activation_pre_film", "activation_post_film", "layer1x1_post_film", "head1x1_post_film"].map((k) => [k, fp(k)])),
  };
}

/** Render a WaveNet .nam over input channels x (array of signals). Returns the output channels, over the whole input. */
export function refWaveNet(d, xs) {
  const cfg = d.config, T = xs[0].length;
  const rd = reader(d.weights);
  // condition_dsp: its own weights, run on the input
  const condIn = xs.map((r) => Float64Array.from(r));
  const cond = cfg.condition_dsp ? refWaveNet(cfg.condition_dsp, condIn) : condIn;
  const arrays = cfg.layers.map(parseArray);
  // weights, array by array, in set_weights_ order
  const built = arrays.map((P) => {
    const rech = conv1x1(rd, P.Cin, P.C, false, 1);
    const layers = P.d.map((dil, li) => {
      const Cz = P.gm[li] === "none" ? P.B : 2 * P.B;
      const L = {
        dil, Cz, act: activation(P.acts[li]), gm: P.gm[li], sec: activation(P.sec[li]),
        conv: conv1d(rd, P.C, Cz, P.ks[li], true, dil, P.gi),
        mix: conv1x1(rd, P.Cc, Cz, false, P.gmx),
      };
      L.l1 = P.l1.on ? conv1x1(rd, P.B, P.C, true, P.l1.g) : null;
      L.h1 = P.h1.on ? conv1x1(rd, P.B, P.h1.out, true, P.h1.g) : null;
      const f = P.f;
      L.cpre = film(rd, P.Cc, P.C, f.conv_pre_film);
      L.cpost = film(rd, P.Cc, Cz, f.conv_post_film);
      L.mpre = film(rd, P.Cc, P.Cc, f.input_mixin_pre_film);
      L.mpost = film(rd, P.Cc, Cz, f.input_mixin_post_film);
      L.apre = film(rd, P.Cc, Cz, f.activation_pre_film);
      L.apost = film(rd, P.Cc, P.B, f.activation_post_film);
      L.l1post = P.l1.on ? film(rd, P.Cc, P.C, f.layer1x1_post_film) : null;
      L.h1post = P.h1.on ? film(rd, P.Cc, P.h1.out, f.head1x1_post_film) : null;
      return L;
    });
    const hin = P.h1.on ? P.h1.out : P.B;
    const headConv = conv1d(rd, hin, P.head.H, P.head.K, P.head.bias, P.head.dil, 1);
    return { P, rech, layers, hin, headConv };
  });
  let post = null;
  if (cfg.head) {
    const h = cfg.head, n = h.kernel_sizes.length;
    let cin = arrays[arrays.length - 1].head.H;
    post = h.kernel_sizes.map((k, i) => { const cout = i + 1 === n ? h.out_channels : h.channels; const c = conv1d(rd, cin, cout, k, true, 1, 1); cin = cout; return c; });
    post.act = activation(h.activation);
  }
  const headScale = rd.take(1)[0];
  if (rd.pos !== d.weights.length) throw new Error(`reference read ${rd.pos} of ${d.weights.length} weights`);

  let layerIn = condIn, headPrev = null;
  for (const A of built) {
    const P = A.P;
    let cur = runConv(A.rech, layerIn, T);
    const headAcc = headPrev ? headPrev.map((r) => Float64Array.from(r)) : zeros(A.hin, T);
    for (const L of A.layers) {
      const B = P.B;
      const ci = L.cpre ? runFilm(L.cpre, cur, cond, T) : cur;
      let a = runConv(L.conv, ci, T);
      if (L.cpost) a = runFilm(L.cpost, a, cond, T);
      const mi = L.mpre ? runFilm(L.mpre, cond, cond, T) : cond;
      let m = runConv(L.mix, mi, T);
      if (L.mpost) m = runFilm(L.mpost, m, cond, T);
      let z = a.map((r, i) => r.map((v, t) => v + m[i][t]));
      if (L.apre) z = runFilm(L.apre, z, cond, T);
      let top;
      if (L.gm === "none") top = L.act(z);
      else {
        const pre = z.slice(0, B), act = L.act(pre.map((r) => Float64Array.from(r))), g = L.sec(z.slice(B).map((r) => Float64Array.from(r)));
        top = L.gm === "gated"
          ? act.map((r, i) => r.map((v, t) => v * g[i][t]))
          : act.map((r, i) => r.map((v, t) => g[i][t] * v + (1 - g[i][t]) * pre[i][t]));
      }
      if (L.apost) top = runFilm(L.apost, top, cond, T);
      let l1o = null;
      if (L.l1) { l1o = runConv(L.l1, top, T); if (L.l1post) l1o = runFilm(L.l1post, l1o, cond, T); }
      let ho;
      if (L.h1) { ho = runConv(L.h1, top, T); if (L.h1post) ho = runFilm(L.h1post, ho, cond, T); }
      else ho = top;
      for (let i = 0; i < A.hin; i++) for (let t = 0; t < T; t++) headAcc[i][t] += ho[i][t];
      cur = l1o ? cur.map((r, i) => r.map((v, t) => v + l1o[i][t])) : cur;
    }
    headPrev = runConv(A.headConv, headAcc, T);
    layerIn = cur;
  }
  if (post) {
    let h = headPrev.map((r) => r.map((v) => v * headScale));
    for (const c of post) { h = post.act(h); h = runConv(c, h, T); }
    return h;
  }
  return headPrev.map((r) => r.map((v) => v * headScale));
}
