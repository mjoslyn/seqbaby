// A naive, per-sample NAM reference, written straight from NeuralAmpModelerCore's
// semantics (whole histories, no blocks, no buffers sliding), for test/nam.test.js
// to hold nam.js's block-wise processor to.
function fastTanh(x) {
  const ax = Math.abs(x), x2 = x * x;
  return (x * (2.45550750702956 + 2.45550750702956 * ax + (0.893229853513558 + 0.821226666969744 * ax) * x2))
    / (2.44506634652299 + (2.44506634652299 + x2) * Math.abs(x + 0.814642734961073 * x * ax));
}
const sig = (x) => 0.5 * (fastTanh(x * 0.5) + 1);
const ACT = { Tanh: fastTanh, ReLU: (x) => Math.max(0, x), Hardtanh: (x) => Math.max(-1, Math.min(1, x)), LeakyReLU: (x) => (x < 0 ? 0.01 * x : x) };

/** Render x through the model described by a parsed .nam (WaveNet A1 or LSTM). Prewarms as nam.js does. */
export function refRender(d, x, prewarm = 0) {
  const input = new Float64Array(prewarm + x.length);
  input.set(x, prewarm);
  const w = d.weights; let p = 0;
  const take = (n) => { const a = w.slice(p, p + n); p += n; return a; };
  const T = input.length;
  if (d.architecture === "LSTM") {
    const { num_layers: NL, hidden_size: H } = d.config;
    const Ls = [];
    for (let l = 0; l < NL; l++) {
      const I = l === 0 ? 1 : H;
      Ls.push({ I, W: take(4 * H * (I + H)), b: take(4 * H), h: take(H), c: take(H) });
    }
    const hw = take(H), hb = take(1)[0];
    const y = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let xin = [input[t]];
      for (const L of Ls) {
        const xh = [...xin, ...L.h], g = [];
        for (let r = 0; r < 4 * H; r++) { let s = L.b[r]; for (let j = 0; j < xh.length; j++) s += L.W[r * xh.length + j] * xh[j]; g.push(s); }
        for (let i = 0; i < H; i++) L.c[i] = sig(g[H + i]) * L.c[i] + sig(g[i]) * fastTanh(g[2 * H + i]);
        L.h = L.h.map((_, i) => sig(g[3 * H + i]) * fastTanh(L.c[i]));
        xin = L.h;
      }
      let s = hb; for (let i = 0; i < H; i++) s += hw[i] * xin[i];
      y[t] = s;
    }
    return y.slice(prewarm);
  }
  const arrs = d.config.layers;
  const cond = [input];
  let layerIn = [input];             // channels x T
  let headIn = null;
  for (const A of arrs) {
    const C = A.channels, K = A.kernel_size, Cz = A.gated ? 2 * C : C, act = ACT[A.activation];
    const R = take(C * A.input_size);
    let cur = [];
    for (let i = 0; i < C; i++) { const r = new Float64Array(T); for (let j = 0; j < A.input_size; j++) for (let t = 0; t < T; t++) r[t] += R[i * A.input_size + j] * layerIn[j][t]; cur.push(r); }
    const head = headIn || Array.from({ length: C }, () => new Float64Array(T));
    for (const dl of A.dilations) {
      const cw = take(Cz * C * K), cb = take(Cz), mw = take(Cz), w1 = take(C * C), b1 = take(C);
      const z = [];
      for (let i = 0; i < Cz; i++) {
        const r = new Float64Array(T);
        for (let t = 0; t < T; t++) {
          let s = cb[i];
          for (let j = 0; j < C; j++) for (let k = 0; k < K; k++) { const ti = t - dl * (K - 1 - k); if (ti >= 0) s += cw[(i * C + j) * K + k] * cur[j][ti]; }
          s += mw[i] * cond[0][t];
          r[t] = s;
        }
        z.push(r);
      }
      const za = [];
      for (let i = 0; i < C; i++) za.push(z[i].map((v, t) => A.gated ? act(v) * sig(z[C + i][t]) : act(v)));
      for (let i = 0; i < C; i++) for (let t = 0; t < T; t++) head[i][t] += za[i][t];
      const nxt = [];
      for (let i = 0; i < C; i++) { const r = new Float64Array(T); for (let t = 0; t < T; t++) { let s = cur[i][t] + b1[i]; for (let j = 0; j < C; j++) s += w1[i * C + j] * za[j][t]; r[t] = s; } nxt.push(r); }
      cur = nxt;
    }
    const hw = take(A.head_size * C), hb = A.head_bias ? take(A.head_size) : null;
    const ho = [];
    for (let i = 0; i < A.head_size; i++) { const r = new Float64Array(T); for (let t = 0; t < T; t++) { let s = hb ? hb[i] : 0; for (let j = 0; j < C; j++) s += hw[i * C + j] * head[j][t]; r[t] = s; } ho.push(r); }
    headIn = ho; layerIn = cur;
  }
  const hs = take(1)[0];
  return headIn[0].map((v) => v * hs).slice(prewarm);
}
