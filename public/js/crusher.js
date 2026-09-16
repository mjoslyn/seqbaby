// ---- Bitcrusher ------------------------------------------------------------
// A model of a cheap converter, not a rounding function. What makes a sampler
// sound like a sampler is not the word length on its own — it is the whole
// path a signal takes through a converter that is too slow and too short:
//
//   in ──▶ S/H clock (rate) ──▶ quantiser (bits, clips at full scale) ──▶ out
//              ▲                        no reconstruction filter
//              └── one clock, both channels, free of the host's rate
//
// - **The sample rate is the bigger half of the sound.** Quantisation alone is
//   a noise floor: at 8 bits it is -48dBFS of hash under the signal, which on a
//   drum loop is barely there. What everyone actually means by "crushed" is the
//   aliasing — decimate to 8kHz and a 3kHz harmonic folds back to 5kHz, off the
//   harmonic series and out of tune with everything. Tone.BitCrusher (what this
//   replaced) has no rate control at all, so the effect could only ever add
//   hiss.
// - **The clock is free-running and fractional.** The hold period is almost
//   never a whole number of host samples, so the tick is tracked as a phase
//   accumulator and the input is read by linear interpolation at the instant
//   the clock actually fires. Snapping ticks to host samples instead quantises
//   the rate itself (at 48k you can only have 48000/n Hz — 24k, 16k, 12k, and
//   nothing in between up top) and puts jitter sidebands around everything,
//   which is what you hear as a "gritty" rate knob on a naive implementation.
// - **A converter clips at full scale.** Past +FS there are no codes left, so
//   the value stops; it does not wrap and it does not sail through. This is why
//   the rack's input drive into a crushed track reads as hard clipping rather
//   than as more hiss.
// - **The levels are laid out as two's complement**: 2^bits codes, mid-tread,
//   running from -1 to 1 - step. Negative full scale is one code further from
//   zero than positive, exactly as on a converter, and zero is a code — so
//   digital silence stays silent instead of dithering around the bottom bit.
// - **There is no anti-alias filter on the way in and no reconstruction filter
//   on the way out**, deliberately. Both are what a good converter has and what
//   the machines this models did not; putting either one in removes the effect.
//   The zero-order hold's own sinc rolloff is there because the steps are real.
//
// Runs as an AudioWorklet because a sample-and-hold has state: a WaveShaper is
// memoryless, so it can quantise but can never hold a value across samples.
// Registered from a Blob URL like the other worklets here, so the source
// travels with the module graph.

// The processor source. Lives here as a string; keep it free of backticks and
// ${ so the template literal stays intact (see CLAUDE.md's gotchas).
const CRUSHER_PROCESSOR_SOURCE = `
class CrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Word length. Integer on a converter, so it is rounded here; k-rate is
      // plenty for a control whose smallest move is a whole bit.
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      // Converter clock, 0..1 mapped exponentially to RATE_MIN..RATE_MAX Hz.
      // a-rate: sweeping the clock is half of what this effect is for, and a
      // block-rate sweep steps audibly.
      { name: "rate", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "a-rate" },
    ];
  }

  constructor(options) {
    super();
    const o = options && options.processorOptions ? options.processorOptions : {};
    this.rmin = o.rateMin || 250;
    this.rmax = o.rateMax || 48000;
    this.span = Math.log(this.rmax / this.rmin);
    this.phase = 0;      // converter clock phase, 0..1 of a hold period
    this.lastRate = -1;  // cache: the exp mapping only recomputes when the knob moves
    this.ratio = 1;      // clock period in host samples, inverted (1 = every sample)
    this.prev = [];      // last host sample per channel, for the interpolated read
    this.held = [];      // what the converter is holding, per channel
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data && e.data.type === "dispose") this.alive = false; };
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    const inp = inputs[0];
    const n = out[0] ? out[0].length : 0;
    const chans = out.length;
    if (!inp || inp.length === 0) {
      // Nothing feeding us: hold nothing, and do not leave the last held value
      // parked on the output as DC.
      for (let c = 0; c < chans; c++) out[c].fill(0);
      this.held.length = 0;
      this.prev.length = 0;
      return true;
    }
    while (this.prev.length < chans) { this.prev.push(0); this.held.push(0); }

    // Word length -> code size. 2^bits codes over -1..+1, mid-tread, so code 0
    // is exactly zero. Positive full scale is one code short of +1 (two's
    // complement has one more code below zero than above it).
    const bits = Math.round(Math.min(16, Math.max(1, params.bits[0])));
    const step = Math.pow(2, 1 - bits);
    const posFS = 1 - step;
    const inv = 1 / step;

    const rateP = params.rate;
    const rateConst = rateP.length === 1;

    for (let i = 0; i < n; i++) {
      const rv = rateConst ? rateP[0] : rateP[i];
      if (rv !== this.lastRate) {
        this.lastRate = rv;
        const hz = this.rmin * Math.exp(this.span * Math.min(1, Math.max(0, rv)));
        // Never faster than the host: one hold per sample is already the most
        // resolution there is, and past that the phase accumulator would want
        // to fire twice in a sample.
        this.ratio = Math.min(1, hz / sampleRate);
      }
      const ratio = this.ratio;
      const before = this.phase;
      this.phase += ratio;
      if (this.phase >= 1) {
        // The clock fired between the previous host sample and this one. Read
        // the input where it actually fired rather than rounding to this
        // sample: that fraction is the difference between a clock that can sit
        // anywhere and one stuck on host-rate/n.
        const frac = ratio > 0 ? Math.min(1, (1 - before) / ratio) : 1;
        this.phase -= 1;
        for (let c = 0; c < chans; c++) {
          const ch = inp[c] || inp[0];
          const cur = ch ? ch[i] : 0;
          let s = this.prev[c] + (cur - this.prev[c]) * frac;
          // Converter overload: there are no codes past full scale.
          if (s > posFS) s = posFS; else if (s < -1) s = -1;
          this.held[c] = step * Math.floor(s * inv + 0.5);
        }
      }
      for (let c = 0; c < chans; c++) {
        const ch = inp[c] || inp[0];
        this.prev[c] = ch ? ch[i] : 0;
        out[c][i] = this.held[c];
      }
    }
    return true;
  }
}
registerProcessor("sq-crusher", CrusherProcessor);
`;

// The converter clock's range, in Hz. Fixed rather than a fraction of the host
// rate, because a converter's clock is a number of hertz and a song should not
// change character between a 44.1k machine and a 48k one. Anything at or above
// the host rate is one hold per host sample, which is no decimation at all —
// so the very top of the knob is "off" on every machine, a touch earlier on
// 44.1k.
export const CRUSH_RATE_MIN = 250;
export const CRUSH_RATE_MAX = 48000;

/** Knob 0..1 → converter clock in Hz (exponential, ~7.6 octaves). */
export function crushRateHz(v) {
  const x = Math.min(1, Math.max(0, Number(v) ?? 1));
  return CRUSH_RATE_MIN * Math.pow(CRUSH_RATE_MAX / CRUSH_RATE_MIN, x);
}

/** What the knob reads out: a clock speed, and "off" once it passes the host. */
export function crushRateLabel(v, sampleRate) {
  const hz = crushRateHz(v);
  const sr = sampleRate || 48000;
  if (hz >= sr) return "off";
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz < 10000 ? 2 : 1)}k` : `${Math.round(hz)}Hz`;
}

const _loads = new WeakMap();
const _ready = new WeakSet();

/** Register the processor on a context. Single-flight per context. */
export function loadCrusherWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([CRUSHER_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function crusherReady(ctx) { return !!ctx && _ready.has(ctx); }

/**
 * The crusher node, or null when the worklet isn't registered — the caller
 * falls back rather than leaving the stage silent.
 */
export function buildCrusherNode(ctx) {
  if (!crusherReady(ctx)) { loadCrusherWorklet(ctx).catch(() => {}); return null; }
  try {
    return new AudioWorkletNode(ctx, "sq-crusher", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { rateMin: CRUSH_RATE_MIN, rateMax: CRUSH_RATE_MAX },
    });
  } catch (e) {
    console.warn("crusher worklet node failed", e);
    return null;
  }
}
