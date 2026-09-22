// ---- Analog filter models ----------------------------------------------
// Eight character options on the filter control, alongside the plain
// lowpass/highpass/bandpass/notch (native BiquadFilterNode, unchanged — see
// signal.js). These are modeled after the classic analog filter topologies,
// not a saturator bolted onto a biquad: what makes a Moog-style ladder sound
// like one is a saturator INSIDE its feedback path, costing the ladder
// passband level as resonance climbs — a biquad-plus-waveshaper
// approximation can match the slope but not that behavior.
//
// One AudioWorklet, one `model` index (postMessage-set, like the silverbox's
// `wave` switch and the contagion's `mode1`/`mode2` — a discrete choice, not
// an AudioParam, since it isn't something an LFO or a lane sweeps). Two DSP
// families inside it:
//
//   ladder (fat, crisp, squelch, edge, poly) — a feedback ladder: N one-pole
//   TPT stages with a saturator INSIDE the feedback path, the same structure
//   as silverbox.js's VCF (silverbox's own filter is reused near-verbatim for
//   `squelch`, since the description given for it — "18dB/oct-ish diode
//   ladder, the squelchy acid sound" — IS the silverbox filter). A feedback
//   ladder is what makes a resonant line lose bass as resonance climbs: the
//   saturator inside the loop costs passband level, same as silverbox's own
//   "the passband loses level as resonance goes up" and for the same reason.
//   A post-filter saturator (what a biquad-plus-waveshaper approximation
//   would be) does not do this at all, so it was never on the table once the
//   fidelity level was chosen.
//
//   svf (velvet, scream, growl) — the same topology-preserving state-variable
//   filter as contagion.js's `svf()`, cascaded to 4-pole the same way
//   (sqrt(Q) split across two stages so the peaks don't multiply). An SVF's
//   resonance doesn't cost bass the way a ladder's does — that is a real,
//   documented difference between the two topologies, not a simplification —
//   which is part of why the smoother, gentler characters (Oberheim SEM) sit
//   here rather than in the ladder family.
//
// Each model exposes only the same two knobs every filter already has (cut,
// reson) — no new UI, per the fidelity level chosen. What differs per model:
// pole count (slope), the feedback saturation curve, how much of the
// resonant passband loss is compensated, and — for the two SVF characters
// described as aggressive — an input drive that grows with resonance, so
// "screamy at high resonance" is literally what happens as the knob turns
// up, not a fixed amount of grit sitting on top.
//
// These are stylistic distinctions reasoned from the circuits' documented
// behavior (feedback-saturated ladder vs. linear-resonance SVF, diode vs.
// transistor vs. chip-ladder saturation character), not measurements against
// real hardware — there is no real unit here to measure against. Honest
// character, not a claimed reproduction.

import { ANALOG_FILTER_TYPES } from "./soundDefaults.js";

/** model key -> the worklet's numeric index (see MODELS in the processor source). */
const MODEL_INDEX = Object.fromEntries(ANALOG_FILTER_TYPES.map((k, i) => [k, i]));

const FILTER_MODELS_PROCESSOR_SOURCE = `
// Per-model constants: [family(0=ladder,1=svf), stages/poles, drive, satCurve, makeup, preDrive]
// satCurve: 0 tanh, 1 soft (light algebraic), 2 diode (silverbox's asymmetric clip),
//           3 edgy (harder algebraic knee), 4 hard (aggressive, for self-oscillation), 5 grit (mild asymmetric fold)
const MODELS = [
  [0, 4, 4.4, 0, 0.20, 0],   // fat     — Moog-style 24dB ladder: warm tanh, strong bass loss
  [0, 4, 3.4, 1, 0.60, 0],   // crisp   — 24dB ladder: light saturation, less bass loss, brighter
  [0, 3, 7.2, 2, 0.35, 0],   // squelch — silverbox's own 18dB diode ladder
  [0, 4, 4.6, 3, 0.30, 0],   // edge    — 24dB ladder: close to fat, a harder/brighter knee
  [0, 4, 2.6, 1, 0.75, 0],   // poly    — 24dB ladder: cleanest, least bass loss (chip ladder)
  [1, 2, 1.1, 1, 0,    0],   // velvet  — 12dB SVF, gentle
  [1, 2, 1.6, 4, 0,    2.4], // scream  — 12dB SVF, aggressive pre-drive that grows with resonance
  [1, 4, 1.3, 5, 0,    0.8], // growl   — 24dB SVF (2 stages), grittier
];

function sat(x, curve) {
  switch (curve) {
    case 0: return Math.tanh(x);
    case 1: return x / (1 + 0.15 * Math.abs(x));
    case 2: return x >= 0 ? x / (1 + 0.6 * x) : x / (1 - 1.1 * x);
    case 3: return x / (1 + 0.35 * Math.abs(x));
    case 4: return Math.tanh(x * 2.2);
    case 5: return x >= 0 ? Math.tanh(x * 1.4) : Math.tanh(x * 1.1) * 0.9;
    default: return x;
  }
}

// Topology-preserving SVF, one structure for all four responses — identical
// to contagion.js's svf(), lowpass output only (see the module comment on
// why these models don't expose a shape control).
function svfLP(v0, s, o, a1, a2, a3) {
  const ic1 = s[o], ic2 = s[o + 1];
  const v3 = v0 - ic2;
  const v1 = a1 * ic1 + a2 * v3;
  const v2 = ic2 + a2 * ic1 + a3 * v3;
  s[o] = 2 * v1 - ic1;
  s[o + 1] = 2 * v2 - ic2;
  return v2;
}

class AnalogFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Hz and Q directly — signal.js writes the same cutoffToHz/resonToQ
      // values here it writes to a native BiquadFilterNode, so fireFilterEnv,
      // the LFO and the automation lane need not know which kind of node they
      // are driving.
      { name: "frequency", defaultValue: 1000, minValue: 20, maxValue: 20000, automationRate: "a-rate" },
      { name: "resonance", defaultValue: 0.7, minValue: 0, maxValue: 40, automationRate: "a-rate" },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.model = 2;               // squelch by default; buildAnalogFilterNode sets the real one
    this.alive = true;
    // Ladder state: up to 4 one-pole stages, per channel. SVF state: 2 stages
    // (ic1, ic2) x up to 2 cascaded sections, per channel. Sized lazily to the
    // channel count actually seen, same as crusher.js's per-channel arrays.
    this.ls = [];   // ladder stage state, per channel: Float64Array(4)
    this.lfb = [];  // ladder feedback tap, per channel
    this.ss = [];   // svf state, per channel: Float64Array(4) = [ic1a, ic2a, ic1b, ic2b]
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === "model") this.model = Math.max(0, Math.min(MODELS.length - 1, m.model | 0));
      else if (m.type === "dispose") this.alive = false;
    };
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const inp = inputs[0], out = outputs[0];
    const n = out[0] ? out[0].length : 0;
    if (!inp || inp.length === 0) { for (const c of out) c.fill(0); return true; }
    const chans = out.length;
    while (this.ls.length < chans) {
      this.ls.push(new Float64Array(4));
      this.lfb.push(0);
      this.ss.push(new Float64Array(4));
    }

    const [family, poleCount, drive, curve, makeup, preDrive] = MODELS[this.model];
    const freqA = params.frequency, resA = params.resonance;
    const sr = this.sr, nyq = sr * 0.49;

    for (let i = 0; i < n; i++) {
      let fc = freqA.length > 1 ? freqA[i] : freqA[0];
      if (fc > nyq) fc = nyq; else if (fc < 20) fc = 20;
      const q = resA.length > 1 ? resA[i] : resA[0];
      // Both families read a 0..1-ish "how resonant" amount, derived from the
      // Q units signal.js writes (0.5..20, see resonToQ) — same reasoning as
      // silverbox reading a 0..1 resonance knob directly.
      const resAmt = Math.max(0, Math.min(1, (q - 0.5) / 19.5));
      const g = Math.tan(Math.PI * fc / sr);

      // Coefficients computed once per sample, shared by every channel —
      // mirrors contagion.js's per-voice (not per-channel) coefficient calc.
      let ladderG, k, mk, a1, a2, a3;
      if (family === 0) {
        ladderG = g / (1 + g);
        k = drive * resAmt;
        mk = Math.pow(1 + k, makeup);
      } else {
        // Same qT/kq shape as contagion's svf(): cubed so the slider's lower
        // half stays musical, sqrt-split across a 4-pole cascade so the two
        // stages' peaks don't multiply into double the resonance.
        const qT = 0.7 + resAmt * resAmt * resAmt * 12;
        const kq = 1 / (poleCount === 4 ? Math.sqrt(qT) : qT);
        a1 = 1 / (1 + g * (g + kq));
        a2 = g * a1;
        a3 = g * a2;
      }

      for (let c = 0; c < chans; c++) {
        const ch = inp[c] || inp[0];
        let x = ch ? ch[i] : 0;

        if (family === 0) {
          // ---- feedback ladder (fat / crisp / squelch / edge / poly) ------
          const s = this.ls[c];
          const f = this.lfb[c];
          const fed = x - k * sat(f, curve);
          let y = fed / (1 + 0.25 * Math.abs(fed));   // input stage clips too
          for (let st = 0; st < poleCount; st++) {
            const v = (y - s[st]) * ladderG;
            const yo = v + s[st];
            s[st] = yo + v;
            y = yo;
          }
          this.lfb[c] = y;
          // Partial makeup only — a feedback ladder losing passband under
          // resonance IS the effect (silverbox's own reasoning); the makeup
          // constant above says how much of that loss each model claws back.
          out[c][i] = Math.tanh(y * mk);
        } else {
          // ---- state-variable (velvet / scream / growl) -------------------
          // An input drive that grows with resonance — "aggressive/screamy at
          // high resonance" is a function of the knob, not a fixed amount.
          if (preDrive > 0) x = sat(x * (1 + preDrive * (0.3 + 0.7 * resAmt)), curve) / (1 + preDrive * 0.3);
          const s = this.ss[c];
          let y = svfLP(x, s, 0, a1, a2, a3);
          if (poleCount === 4) y = svfLP(y, s, 2, a1, a2, a3);
          if (curve === 5) y = sat(y, curve) * 0.4 + y * 0.6;  // growl: a touch of grit
          out[c][i] = y;
        }
      }
    }
    return true;
  }
}

registerProcessor("sq-analog-filter", AnalogFilterProcessor);
`;

/** The processor source, for test/filterModels.test.js — same reason
 *  reverb.js exposes reverbProcessorSource(): evaluated against the two
 *  worklet globals a test stubs, so the filter math is measured without a
 *  browser. */
export function filterModelsProcessorSource() { return FILTER_MODELS_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/** Register the processor on a context. Single-flight per context, same
 *  contract as the other worklets: a failed attempt clears the slot so the
 *  next call retries. */
export function loadFilterModelsWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([FILTER_MODELS_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function filterModelsReady(ctx) { return !!ctx && _ready.has(ctx); }

/**
 * Build one of the 8 analog filter models as an insert node: one input, one
 * output, `.frequency` and `.Q` glued on as the same AudioParams a
 * BiquadFilterNode exposes under those names, so every existing call site
 * (fireFilterEnv, setFilter's cutoff/reson branches, the LFO, the automation
 * lane) treats it exactly like the native filter it stands in for. Only the
 * `type`/model switch itself needs to know the difference — see
 * signal.js's ensureFilter/setFilter.
 * @param {BaseAudioContext} ctx @param {string} model one of ANALOG_FILTER_TYPES
 * @param {number} freqHz @param {number} Qval
 * @returns {AudioWorkletNode|null} null when the worklet isn't registered yet
 */
export function buildAnalogFilterNode(ctx, model, freqHz, Qval) {
  if (!filterModelsReady(ctx)) { loadFilterModelsWorklet(ctx).catch(() => {}); return null; }
  let node;
  try {
    node = new AudioWorkletNode(ctx, "sq-analog-filter", { numberOfInputs: 1, numberOfOutputs: 1 });
  } catch (e) {
    console.warn("analog filter worklet node failed", e);
    return null;
  }
  node.frequency = node.parameters.get("frequency");
  node.Q = node.parameters.get("resonance");
  if (Number.isFinite(freqHz)) node.frequency.value = freqHz;
  if (Number.isFinite(Qval)) node.Q.value = Qval;
  setAnalogFilterModel(node, model);
  return node;
}

/** Switch an existing analog filter node to a different model — a message,
 *  not a rebuild, the same way silverbox's `wave` and contagion's `mode1` /
 *  `route` / `satCurve` switch live without tearing the node down. */
export function setAnalogFilterModel(node, model) {
  const idx = MODEL_INDEX[model];
  if (idx == null) return;
  try { node.port.postMessage({ type: "model", model: idx }); } catch {}
}

/** Dispose an analog filter node — same contract as the other worklets'
 *  dispose: tell the processor to stop (so `process()` can return false and
 *  the node can be reclaimed) before disconnecting it. */
export function disposeAnalogFilterNode(node) {
  if (!node) return;
  try { node.port.postMessage({ type: "dispose" }); } catch {}
  try { node.disconnect(); } catch {}
}

export { ANALOG_FILTER_TYPES };
