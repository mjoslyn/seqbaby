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
    stopTime = time + Math.min(wallTime, Math.max(0.1, duration + 0.5));
    src.start(time, startSec, playLenSource);
  }
  return { src, stopTime };
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

