export function makeFuzzCurve(drive) {
  const n = 2048;
  const curve = new Float32Array(n);
  const gain = 8 + drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y = Math.tanh(x * gain);
    if (x < 0) y = y * 0.88 + Math.sin(x * 3.1) * 0.08;       // asymmetry
    if (Math.abs(x) > 0.55) y += Math.sin(x * 22) * 0.08 * (Math.abs(x) - 0.55);  // spitting
    y = Math.max(-1, Math.min(1, y));
    curve[i] = y;
  }
  return curve;
}

// Triangle-wave folder (MiniBrute Metalizer): amount in 0..1. 0 = untouched, 1 = heavy fold.
export function makeMetalizerCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const fold = 1 + amount * 6; // fold depth (number of reflections at max)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Classic wave-folder: x * fold, then triangle-fold back into [-1, 1]
    let y = x * fold;
    while (y > 1)  y = 2 - y;
    while (y < -1) y = -2 - y;
    curve[i] = y;
  }
  return curve;
}

export function makeVinylCrackleBuffer(ctx, seconds) {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.06;
  const crackles = Math.floor(seconds * 22);
  for (let c = 0; c < crackles; c++) {
    const pos = Math.floor(Math.random() * (len - 40));
    const amp = 0.35 + Math.random() * 0.55;
    const width = 2 + Math.floor(Math.random() * 10);
    for (let j = 0; j < width; j++) {
      data[pos + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / 4);
    }
  }
  return buf;
}

// Tape hiss bed: pink-ish noise via a 1-pole lowpass on white noise.
export function makeTapeHissBuffer(ctx, seconds) {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    prev = prev * 0.85 + w * 0.15;
    data[i] = prev * 0.6;
  }
  return buf;
}

// Wave-shaper mode kernels. Each takes an already-driven input value x and
// returns the shaped output. `amount` deepens the effect via the pre-gain
// baked into makeShaperCurve.
export function shapeSample(mode, x) {
  switch (mode) {
    case "saturate":
      // gentle tanh saturation — smooth, musical, no hard edge
      return Math.tanh(x);
    case "softclip":
      // cubic soft-clip; ramps to ±1 with rounded shoulder
      if (x >= 1) return 1;
      if (x <= -1) return -1;
      return 1.5 * x - 0.5 * x * x * x;
    case "clip":
      // hard clip at ±1
      return Math.max(-1, Math.min(1, x));
    case "serge": {
      // Serge-style sine-folded triangle: smoother than a plain fold,
      // more harmonics than saturate
      let y = ((x + 1) % 4 + 4) % 4;
      if (y > 2) y = 4 - y;
      return Math.sin((y - 1) * Math.PI / 2);
    }
    case "fold": {
      // Triangle wave-folder: reflects past ±1 instead of clipping
      let y = ((x + 1) % 4 + 4) % 4;
      if (y > 2) y = 4 - y;
      return y - 1;
    }
    case "wrap": {
      // Sawtooth wrap: modulo around [-1, +1] — buzzy, aliased character
      const y = ((x + 1) % 2 + 2) % 2;
      return y - 1;
    }
  }
  return Math.tanh(x);
}

export const SHAPER_MODES = ["saturate", "softclip", "clip", "serge", "fold", "wrap"];

// Map a 0..1 preamp knob to a gain multiplier. 0.5 = unity (1x); below cuts
// the input (down to 0.25x at slider 0); above pushes harder into the curve
// (up to 8x at slider 1). Exponential so the upper half feels like a "drive".
export function shaperPreampGain(v) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  return x <= 0.5
    ? 0.25 + (x / 0.5) * 0.75       // 0.25x → 1x
    : Math.pow(8, (x - 0.5) / 0.5); // 1x → 8x
}

// Build a 4096-sample waveshaper curve for the given mode. `amount` (0..1) is
// the pre-curve drive (1..9x) so harder values push the signal further into
// the mode's nonlinearity.
export function makeShaperCurve(mode, amount) {
  const n = 4096;
  const c = new Float32Array(n);
  const drive = 1 + Math.max(0, Math.min(1, amount)) * 8;
  const m = SHAPER_MODES.includes(mode) ? mode : "fold";
  for (let i = 0; i < n; i++) {
    const x = ((i * 2) / (n - 1) - 1) * drive;
    c[i] = shapeSample(m, x);
  }
  return c;
}

// Soft tape-style saturation curve (tanh with variable drive).
export function makeCassetteSatCurve(drive) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + drive * 7;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  return c;
}

