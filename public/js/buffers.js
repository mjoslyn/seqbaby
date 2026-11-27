export const bufferCache = new Map();
export async function loadBuffer(ctx, url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`sample ${url}: ${r.status}`);
    return r.arrayBuffer();
  }).then(ab => ctx.decodeAudioData(ab));
  bufferCache.set(url, p);
  return p;
}

// ---- effects rack ------------------------------------------------------

// DBA Fuzz War-ish curve: asymmetric hard clip with unstable harmonic sputter.
export const PINGPONG_CACHE = new WeakMap();
export function getPingPongBuffer(buf, startFrac, endFrac) {
  if (!buf || endFrac <= startFrac) return null;
  let forBuf = PINGPONG_CACHE.get(buf);
  if (!forBuf) { forBuf = new Map(); PINGPONG_CACHE.set(buf, forBuf); }
  const key = `${startFrac.toFixed(4)}:${endFrac.toFixed(4)}`;
  const cached = forBuf.get(key);
  if (cached) return cached;
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const sIdx = Math.max(0, Math.floor(startFrac * n));
  const eIdx = Math.min(n, Math.ceil(endFrac * n));
  const segLen = Math.max(1, eIdx - sIdx);
  const out = new AudioBuffer({ length: segLen * 2, numberOfChannels: ch, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < segLen; i++) dst[i] = src[sIdx + i];              // forward
    for (let i = 0; i < segLen; i++) dst[segLen + i] = src[eIdx - 1 - i]; // reversed
  }
  forBuf.set(key, out);
  return out;
}

// Set up and start a BufferSource for a sample hit. Honors start/end offsets
// and three loop modes: "off" (one-shot), "loop" (region repeats), "pingpong"
// (region plays forward then reversed, repeatedly). Returns { src, stopTime }.
export function startSampleSource(ctx, buffer, rate, time, duration, opts) {
  const src = ctx.createBufferSource();
  src.playbackRate.value = rate;
  const startFrac = Math.max(0, Math.min(1, opts?.startOffset ?? 0));
  const endFrac   = Math.max(startFrac + 0.001, Math.min(1, opts?.endOffset ?? 1));
  const startSec  = startFrac * buffer.duration;
  const endSec    = endFrac   * buffer.duration;
  const playLenSource = endSec - startSec;
  const wallTime  = playLenSource / Math.max(0.01, rate);
  const loopMode  = opts?.loopMode || "off";
  let stopTime;
  if (loopMode === "pingpong") {
    src.buffer = getPingPongBuffer(buffer, startFrac, endFrac) || buffer;
    src.loop = true;
    stopTime = time + Math.max(0.1, duration);
    src.start(time);
  } else if (loopMode === "loop") {
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = startSec;
    src.loopEnd   = endSec;
    stopTime = time + Math.max(0.1, duration);
    src.start(time, startSec);
  } else {
    src.buffer = buffer;
    // One-shots gate to the note length so a short note actually stops the
    // sample. Drum-kit hits keep a 0.5s ring-out grace so a 16th-note step
    // doesn't chop a kick/snare tail. Either way, never play past the sample's
    // own end (wallTime).
    // opts.playMode says otherwise when the track's switch has been set:
    // "trigger" plays the whole region whatever the note's length, "gate"
    // stops with the note, a drum kit included.
    stopTime = oneShotStop(time, wallTime, duration, opts);
    src.start(time, startSec, playLenSource);
  }
  return { src, stopTime };
}

/** When a one-shot stops: the track's trigger / gate switch, or the old rule. */
export function oneShotStop(time, wallTime, duration, opts) {
  const mode = opts?.playMode;
  if (mode === "trigger") return time + wallTime;
  if (mode === "gate") return time + Math.min(wallTime, Math.max(0.02, duration));
  const gate = opts?.isDrumKit ? duration + 0.5 : duration;
  return time + Math.min(wallTime, Math.max(0.1, gate));
}

/** A sampler track's pitch select: "lock" (notes are ignored), "speed" (a
 *  note resamples it, so higher is shorter) or "shift" (a note changes the
 *  pitch and the length stays). `pitchLock` is the old checkbox and still the
 *  lock; "shift" rides in `sampleDefaults.pitch`. */
export function samplePitchMode(t) {
  if (t?.pitchLock !== false) return "lock";
  return t?.sampleDefaults?.pitch === "shift" ? "shift" : "speed";
}

// ---- pitch without speed -------------------------------------------------------------
//
// A note that transposes a sample by resampling also changes its length. The
// "shift" mode keeps the length: the sample is read as overlapping grains
// (SHIFT_GRAIN long, one every SHIFT_HOP, Hann windows that sum to one), each
// grain resampled by the pitch ratio while the place the grains are read FROM
// moves at the sample's own speed. Plain overlap-add puts each grain down
// wherever the clock says, out of phase with the one before it, which on a
// held tone is a flutter at the hop rate; so each grain's start is searched a
// few milliseconds either side for the place whose waveform best matches where
// the last grain has got to (WSOLA). Pure arithmetic over the sample data, so
// the tests run it.
export const SHIFT_GRAIN = 0.07;
export const SHIFT_HOP = 0.035;
const SHIFT_SEARCH = 0.012;

/**
 * @param {Float32Array} data  one channel of the sample
 * @param {{startSec:number, endSec:number, fit:number, ratio:number, loop?:boolean}} o
 *   fit: source seconds per second (the sample's own speed); ratio: the pitch
 * @returns {{next: () => ({t:number, pos:number, first:boolean} | null)}}
 *   t: seconds after the hit; pos: where in the sample the grain starts
 */
export function makeShiftPlanner(data, sr, o) {
  const { startSec, endSec, fit, ratio } = o;
  const span = Math.max(0.001, endSec - startSec);
  const rho = fit * ratio;                         // source seconds a grain eats per second
  const step = Math.max(1, Math.floor(sr / 11025)); // compare at about 11k
  const cmp = Math.min(0.03, (SHIFT_GRAIN - SHIFT_HOP) * rho);
  const cmpN = Math.max(8, Math.floor((cmp * sr) / step));
  let k = 0, prev = startSec;
  return {
    next() {
      const t = k * SHIFT_HOP;
      let target = startSec + fit * t;
      if (target >= endSec) {
        if (!o.loop) return null;
        target = startSec + ((target - startSec) % span);
      }
      let pos = target;
      if (k > 0) {
        const nat = Math.floor((prev + SHIFT_HOP * rho) * sr);   // where the last grain is now
        const lo = Math.max(Math.floor(startSec * sr), Math.floor((target - SHIFT_SEARCH) * sr));
        const hi = Math.min(Math.floor(endSec * sr) - cmpN * step - 1, Math.floor((target + SHIFT_SEARCH) * sr));
        if (nat >= 0 && nat + cmpN * step < data.length && hi > lo) {
          let best = -Infinity, at = Math.floor(target * sr);
          for (let c = lo; c <= hi; c += step) {
            let dot = 0, en = 1e-9;
            for (let i = 0, a = nat, b = c; i < cmpN; i++, a += step, b += step) { dot += data[a] * data[b]; en += data[b] * data[b]; }
            const score = dot / Math.sqrt(en);
            if (score > best) { best = score; at = c; }
          }
          pos = at / sr;
        }
      }
      prev = pos;
      return { t, pos, first: k++ === 0 };
    },
  };
}

// Shared envelope for sample-based voices: honors opts.fadeIn/fadeOut (seconds)
// with a 6ms click-guard floor and a cap at ~48% of the wall time per side.
export function applySampleFadeEnvelope(gainNode, time, stopTime, v, opts) {
  const CLICK = 0.006;
  const playLen = Math.max(CLICK * 2.1, stopTime - time);
  const cap = playLen * 0.48;
  const fadeIn  = Math.max(CLICK, Math.min(cap, Number(opts?.fadeIn)  || 0));
  const fadeOut = Math.max(CLICK, Math.min(cap, Number(opts?.fadeOut) || 0));
  const peakStart = time + fadeIn;
  const peakEnd   = Math.max(peakStart, stopTime - fadeOut);
  gainNode.gain.setValueAtTime(0, time);
  gainNode.gain.linearRampToValueAtTime(v, peakStart);
  gainNode.gain.setValueAtTime(v, peakEnd);
  gainNode.gain.linearRampToValueAtTime(0, stopTime);
}

/** A sampler track's trigger / gate switch as it stands: what was picked
 *  (`sampleDefaults.play`), else what an untouched track does, which is a
 *  drum kit ringing on (half a second past its step) and anything else
 *  stopping with its note. */
export function samplePlayMode(t) {
  const p = t?.sampleDefaults?.play;
  return p === "trigger" || p === "gate" ? p : (t?.isDrumKit ? "trigger" : "gate");
}

export function trimSilenceFromBuffer(buf, { threshold = 0.004, padMs = 8 } = {}) {
  if (!buf || !buf.length) return buf;
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const win = Math.max(1, Math.round(buf.sampleRate * 0.01));
  // Per-sample max-abs across channels (cheaper than true RMS, good enough for gating)
  const env = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > env[i]) env[i] = a;
    }
  }
  // Find first index where windowed peak >= threshold
  let first = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) if (env[j] > peak) peak = env[j];
    if (peak >= threshold) { first = i; break; }
    if (i === n - 1) return buf; // entirely silent — leave it alone
  }
  let last = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    let peak = 0;
    const start = Math.max(0, i - win);
    for (let j = start; j <= i; j++) if (env[j] > peak) peak = env[j];
    if (peak >= threshold) { last = i; break; }
  }
  const pad = Math.round(buf.sampleRate * padMs / 1000);
  const s = Math.max(0, first - pad);
  const e = Math.min(n, last + pad);
  const len = Math.max(1, e - s);
  if (s === 0 && e === n) return buf; // nothing to trim
  const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(s, e));
  }
  return out;
}

export function normalizeAudioBuffer(buf, opts = null) {
  if (opts?.trim) buf = trimSilenceFromBuffer(buf);
  if (!buf) return buf;
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0 || peak === 0) return buf;
  const rms = Math.sqrt(sumSq / count);
  const targetRms = 0.2;                           // -14 dBFS
  const rmsScale = rms > 0 ? targetRms / rms : 1;  // how much to bring up RMS
  const peakScale = 0.98 / peak;                   // don't exceed -0.18 dBFS peak
  const scale = Math.min(rmsScale, peakScale);
  const tailSamples = Math.min(buf.length, Math.round(buf.sampleRate * 0.005));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    if (scale !== 1) for (let i = 0; i < d.length; i++) d[i] *= scale;
    for (let i = 0; i < tailSamples; i++) {
      const j = d.length - tailSamples + i;
      d[j] *= 1 - (i / tailSamples);
    }
  }
  return buf;
}

