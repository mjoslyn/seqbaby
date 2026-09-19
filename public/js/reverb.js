// ---- Reverb ----------------------------------------------------------------
// A feedback delay network, because the thing it replaced could not have its
// decay changed.
//
//   in ─ dc ─ predelay ─ 4 allpass diffusers ─┬─▶ 8 delay lines ─┬─▶ L
//                                             │   damp · decay   │
//                                             │   Hadamard mix   ├─▶ R
//                                             └──────────────────┘
//
// - **The decay is a coefficient, and that is the whole point.** A convolution
//   reverb's decay IS its impulse response, so Tone.Reverb (what this replaced)
//   had to render `decay` seconds of noise through an OfflineAudioContext and
//   re-partition the convolver's FFT every time the knob moved — reached from
//   an automation lane every step and a setter LFO every frame, that measured
//   at 16ms in the transport callback and 180ms main-thread frames, and needed
//   a throttle (one render per rack per 400ms, one in flight for the whole app,
//   changes under 12% dropped) that made the knob laggy and quantised to hide
//   it. Here a tail length is eight pow() calls when it moves and nothing at
//   all when it does not, so decay is a real AudioParam, swept sample-block by
//   sample-block with no render, no throttle and no lag.
// - **The lengths are times, not sample counts**, rounded up to primes at
//   construction: the same room at 44.1k and at 48k, and no two lines sharing a
//   period, so the tank's modes spread instead of piling onto each other.
// - **The decay gain is per line, and it has to be.** A line of L samples needs
//   g = 10^(-3L/(T·sr)) to lose 60dB in T seconds, so the short lines are
//   damped harder than the long ones. One gain for all eight would give eight
//   different decay times and a tail that changes colour as the short ones drop
//   out.
// - **The mixing matrix is an 8-point Hadamard**, applied as a butterfly: 24
//   adds and a scale rather than 64 multiplies. It is orthonormal, which is
//   what makes the energy the lines lose exactly the energy the coefficients
//   asked them to lose — with a matrix that is not, the decay gains mean
//   nothing and the tank either dies early or runs away.
// - **The read heads wander.** Without it the tank is a bank of fixed
//   resonators and a long tail rings on a chord of its own modes; a fraction
//   of a millisecond of wander at well under a hertz smears them. The rates are
//   mutually prime-ish so the eight never line up.
// - **Damping is one pole per line, inside the loop.** Its DC gain is 1, so it
//   does not touch the decay the coefficients ask for — it only makes the top
//   die first, which is what a room does and what stops a long tail sounding
//   like a spring.
// - **The wet/dry crossfade is NOT here.** It stays a Tone.CrossFade in the
//   rack, so `wet` is the same equal-power Tone.Param an LFO connected to
//   before and every song's reverb balance is unchanged.
//
// Registered from a Blob URL like the other worklets, so the source travels
// with the module graph. If registration fails the rack falls back to
// Tone.Reverb with its throttle, which is exactly what this stage used to be.

// The processor source. Lives here as a string; keep it free of backticks and
// ${ so the template literal stays intact (see CLAUDE.md's gotchas).
const REVERB_PROCESSOR_SOURCE = `
// The tank's dimensions, in seconds. Spread over 21..68ms: shorter and the
// tank sounds like a small box whatever the decay says, longer and the early
// tail is a stutter of discrete repeats rather than a wash.
const LINE_S = [0.0211, 0.0259, 0.0313, 0.0369, 0.0431, 0.0503, 0.0587, 0.0679];
// Input diffusion. Short, because these smear the input rather than reverberate
// it — past about 15ms they stop sounding like diffusion and start sounding
// like more delay lines.
const DIFF_S = [0.0048, 0.0036, 0.0127, 0.0093];
const DIFF_G = [0.75, 0.75, 0.625, 0.625];
const NL = 8;
const PREDELAY_S = 0.02;
const MOD_S = 0.0009;                                        // read-head wander
const MOD_HZ = [0.71, 0.53, 0.89, 0.61, 0.47, 0.83, 0.67, 0.97];
const DAMP_HZ = 7200;
// Silence, in and out, before the tank may be skipped. Comfortably past the
// longest path through it (predelay + longest line, about 90ms), so by the time
// this elapses there is provably nothing inside to lose.
const IDLE_S = 0.5;

// The damping filter sits INSIDE the loop, so although its DC gain is 1 it
// still takes the top off a little further round every lap, and the broadband
// tail dies about 12% sooner than the coefficients alone would have it.
// Measured across 0.35..8s the shortfall is flat, so the coefficients are
// computed for a target this much longer and the knob then reads true. (Below
// about 0.3s it stops holding: the long lines are damped so hard they barely
// contribute and the short ones carry the tail, which makes it run slightly
// long. 0.2s asking for 0.24s is not a knob anyone reads with a stopwatch.)
const DECAY_COMP = 1.14;
// A tank holds more energy the longer it holds it, so without this a decay
// sweep would also be a volume sweep — a full 6dB across the knob. The
// convolution reverb this replaces was normalized per impulse response and did
// not do that, and every saved song's wet setting was chosen against it.
// The exponent is measured, not derived: the ideal-delay-line model says
// amplitude should go as sqrt(decay), and the damping flattens it to nearly a
// fifth of that. OUT_BASE then puts a fully wet output at the level of what
// went in, at the default 2s decay.
const LEVEL_EXP = 0.19;
const OUT_BASE = 0.396;
const LEVEL_REF = 2;

// A sine table for the wander LFOs: eight Math.sin calls a sample is 384k a
// second to move eight read heads by half a millisecond.
const LUTN = 2048;
const SIN = new Float32Array(LUTN + 1);
for (let i = 0; i <= LUTN; i++) SIN[i] = Math.sin(2 * Math.PI * i / LUTN);
function lutSin(p) {
  const x = (p - Math.floor(p)) * LUTN;
  const i = x | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (x - i);
}

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}
function primeAtLeast(n) { let p = Math.max(3, n | 0); while (!isPrime(p)) p++; return p; }

class ReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // RT60 in seconds. k-rate: a tail length is not a waveform, and the
      // coefficients are recomputed only when the value actually moves.
      { name: "decay", defaultValue: 2, minValue: 0.1, maxValue: 12, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.alive = true;

    this.modN = Math.max(1, Math.round(MOD_S * sr));
    this.len = new Int32Array(NL);
    this.buf = [];
    this.wIdx = new Int32Array(NL);
    this.lp = new Float64Array(NL);
    this.g = new Float64Array(NL);
    this.mph = new Float64Array(NL);
    this.minc = new Float64Array(NL);
    this.t = new Float64Array(NL);
    for (let k = 0; k < NL; k++) {
      this.len[k] = primeAtLeast(Math.round(LINE_S[k] * sr));
      this.buf.push(new Float32Array(this.len[k] + this.modN + 4));
      this.minc[k] = MOD_HZ[k] / sr;
      this.mph[k] = k / NL;                 // spread, so they never start together
    }

    this.dBuf = [];
    this.dIdx = new Int32Array(4);
    for (let k = 0; k < 4; k++) this.dBuf.push(new Float32Array(primeAtLeast(Math.round(DIFF_S[k] * sr))));

    this.pdN = Math.max(1, Math.round(PREDELAY_S * sr));
    this.pd = new Float32Array(this.pdN);
    this.pdW = 0;

    // One pole, expressed so its DC gain is exactly 1 (see the file header).
    this.dampA = 1 - Math.exp(-2 * Math.PI * Math.min(DAMP_HZ, sr * 0.45) / sr);
    this.dcX = 0; this.dcY = 0;

    this.lastDecay = -1;
    this.setDecay(2);
    // The level trim moves with the decay, so a swept decay would step the
    // output every control block. Ramped per sample instead, over about 3ms —
    // the coefficients themselves need no such thing, since changing a decay
    // RATE is not a discontinuity in the signal, only in how fast it is going.
    this.outGCur = this.outG;
    this.outGA = 1 - Math.exp(-1 / (0.003 * sr));

    // Consecutive samples with nothing going in AND nothing coming out. Only
    // ever used to skip the tank when there is nothing in it to lose — never to
    // end the node. A processor that returns false is finished for good, and a
    // reverb that retired itself during a quiet passage would be gone for the
    // rest of the session.
    //
    // It has to count silent INPUT as well as silent output, and that is the
    // whole of why the threshold exists: a sample can be sitting in the
    // predelay or partway down a line with the output still silent, so output
    // alone does not mean the tank is empty. The longest path through it is the
    // predelay plus the longest line, about 90ms, and the threshold is well
    // past that. Counting output alone swallowed the tail of every sound that
    // arrived after a pause: the block carrying it was processed, the next one
    // had no input, the output had not caught up yet, and the tank was skipped
    // from there on.
    this.quiet = 0;
    this.port.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === "dispose") this.alive = false;
      else if (e.data.type === "clear") this.clear();
    };
  }

  // The only thing a decay change costs: eight pow() calls. A line of L samples
  // must lose 60dB in T seconds, so it keeps 10^(-3L/(T*sr)) of itself each
  // time round.
  setDecay(seconds) {
    const asked = Math.max(0.05, Math.min(60, seconds || 0.05));
    this.outG = OUT_BASE * Math.pow(LEVEL_REF / asked, LEVEL_EXP);
    const t = asked * DECAY_COMP;
    for (let k = 0; k < NL; k++) {
      let g = Math.pow(10, (-3 * this.len[k]) / (t * this.sr));
      // Never at or past unity: the matrix is lossless, so a line that keeps
      // all of itself is a tank that never stops.
      if (g > 0.9995) g = 0.9995;
      this.g[k] = g;
    }
  }

  clear() {
    for (let k = 0; k < NL; k++) { this.buf[k].fill(0); this.lp[k] = 0; }
    for (let k = 0; k < 4; k++) this.dBuf[k].fill(0);
    this.pd.fill(0);
    this.dcX = 0; this.dcY = 0;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const outL = out[0];
    const outR = out[1] || out[0];
    const n = outL.length;

    const inp = inputs[0];
    const inL = inp && inp.length > 0 ? inp[0] : null;
    const inR = inp && inp.length > 1 ? inp[1] : inL;

    const want = params.decay[0];
    if (want !== this.lastDecay) { this.setDecay(want); this.lastDecay = want; }

    const t = this.t, g = this.g, lp = this.lp, dampA = this.dampA;
    const modN = this.modN, pdN = this.pdN, pd = this.pd;

    // Idle skip: nothing coming in, and nothing left of what did. Eight delay
    // lines of silence is still eight delay lines, and a rack keeps its reverb
    // engaged for as long as the wet knob is up, not for as long as the track
    // is playing. The tank can only be quiet by having decayed, so there is
    // nothing in it to lose.
    let inMax = 0;
    if (inL) for (let i = 0; i < n; i++) { const a = inL[i] < 0 ? -inL[i] : inL[i]; if (a > inMax) inMax = a; }
    if (inR && inR !== inL) for (let i = 0; i < n; i++) { const a = inR[i] < 0 ? -inR[i] : inR[i]; if (a > inMax) inMax = a; }
    if (inMax > 0) this.quiet = 0;
    else if (this.quiet > this.sr * IDLE_S) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    let loud = 0;

    for (let i = 0; i < n; i++) {
      let x = inL ? inL[i] : 0;
      if (inR && inR !== inL) x = (x + inR[i]) * 0.5;

      // A tank recirculates whatever it is handed, and DC in a tank is a slowly
      // decaying offset on everything downstream of it.
      const hp = x - this.dcX + 0.9995 * this.dcY;
      this.dcX = x; this.dcY = hp;
      x = hp;

      // Pre-delay: write here, read the same slot, which is pdN samples old.
      pd[this.pdW] = x;
      this.pdW = this.pdW + 1 >= pdN ? 0 : this.pdW + 1;
      let s = pd[this.pdW];

      // Input diffusion. The canonical Schroeder allpass: v = x + g*v[n-D],
      // out = v[n-D] - g*v, which is (-g + z^-D) / (1 - g*z^-D) and so is flat.
      for (let k = 0; k < 4; k++) {
        const b = this.dBuf[k], idx = this.dIdx[k], dg = DIFF_G[k];
        const vd = b[idx];
        const v = s + dg * vd;
        b[idx] = v;
        s = vd - dg * v;
        this.dIdx[k] = idx + 1 >= b.length ? 0 : idx + 1;
      }

      // ---- the tank ----
      for (let k = 0; k < NL; k++) {
        const b = this.buf[k], bn = b.length;
        this.mph[k] += this.minc[k];
        if (this.mph[k] >= 1) this.mph[k] -= 1;
        // 0 .. modN of wander, so the read never passes the write.
        const d = this.len[k] + (0.5 + 0.5 * lutSin(this.mph[k])) * modN;
        let rp = this.wIdx[k] - d;
        while (rp < 0) rp += bn;
        const i0 = rp | 0;
        const i1 = i0 + 1 >= bn ? 0 : i0 + 1;
        const dv = b[i0] + (b[i1] - b[i0]) * (rp - i0);
        const y = lp[k] + (dv - lp[k]) * dampA;
        lp[k] = y;
        t[k] = y;
      }

      // Taps before the mix, on two orthogonal sign patterns out of the same
      // Hadamard: L and R are then decorrelated rather than the same tail
      // twice, which is the whole of a reverb's width.
      const l = t[0] + t[1] + t[2] + t[3] - t[4] - t[5] - t[6] - t[7];
      const r = t[0] + t[1] - t[2] - t[3] + t[4] + t[5] - t[6] - t[7];

      for (let k = 0; k < NL; k++) t[k] *= g[k];

      // 8-point Hadamard as a butterfly: 24 adds where the matrix is 64
      // multiplies, and orthonormal once scaled by 1/sqrt(8).
      let a0 = t[0] + t[1], a1 = t[0] - t[1], a2 = t[2] + t[3], a3 = t[2] - t[3];
      let a4 = t[4] + t[5], a5 = t[4] - t[5], a6 = t[6] + t[7], a7 = t[6] - t[7];
      let b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3;
      let b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
      const H = 0.3535533905932738;
      t[0] = (b0 + b4) * H; t[1] = (b1 + b5) * H; t[2] = (b2 + b6) * H; t[3] = (b3 + b7) * H;
      t[4] = (b0 - b4) * H; t[5] = (b1 - b5) * H; t[6] = (b2 - b6) * H; t[7] = (b3 - b7) * H;

      for (let k = 0; k < NL; k++) {
        const b = this.buf[k];
        b[this.wIdx[k]] = s + t[k];
        this.wIdx[k] = this.wIdx[k] + 1 >= b.length ? 0 : this.wIdx[k] + 1;
      }

      this.outGCur += (this.outG - this.outGCur) * this.outGA;
      const og = this.outGCur;
      const ol = l * og, or = r * og;
      outL[i] = ol;
      outR[i] = or;
      const m = ol > 0 ? ol : -ol;
      if (m > loud) loud = m;
    }

    if (loud > 1e-7 || inMax > 0) this.quiet = 0; else this.quiet += n;
    return true;
  }
}
registerProcessor("sq-reverb", ReverbProcessor);
`;

const _loads = new WeakMap();
const _ready = new WeakSet();

/** Register the processor on a context. Single-flight per context. */
export function loadReverbWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([REVERB_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function reverbReady(ctx) { return !!ctx && _ready.has(ctx); }

/**
 * The reverb node, or null when the worklet isn't registered — the caller falls
 * back to Tone.Reverb rather than leaving the stage dry.
 */
export function buildReverbNode(ctx) {
  if (!reverbReady(ctx)) { loadReverbWorklet(ctx).catch(() => {}); return null; }
  try {
    return new AudioWorkletNode(ctx, "sq-reverb", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
  } catch (e) {
    console.warn("reverb worklet node failed", e);
    return null;
  }
}

/** The processor source, for the tests (which run it outside a browser). */
export function reverbProcessorSource() { return REVERB_PROCESSOR_SOURCE; }
