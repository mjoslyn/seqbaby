// Wavetable editor — build a multi-frame single-cycle wavetable for the wavetable
// synth (wt:akwf). Each frame is a WT_FRAME_LEN single cycle; the synth's "wave"
// knob morphs (crossfades) across frames. Edit a frame by drawing on the canvas,
// with additive harmonic sliders (kept in sync via DFT), or load a prebuilt shape
// / AKWF wave into it. Frames live on t.wavetable.frames and persist in sessions.

import { setStatus } from "./dom.js";
import { WAVETABLE_WAVES, WT_FRAME_LEN } from "./voices.js";
import { loadBuffer } from "./buffers.js";
import { state } from "./state.js";
import { ensureAudio } from "./transport.js";

const N = WT_FRAME_LEN;
const NHARM = 16;
const BASIC = ["sine", "saw", "square", "triangle"];

function basicWave(type) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const ph = i / N;
    switch (type) {
      case "sine":     out[i] = Math.sin(2 * Math.PI * ph); break;
      case "saw":      out[i] = 2 * ph - 1; break;
      case "square":   out[i] = ph < 0.5 ? 1 : -1; break;
      case "triangle": out[i] = 4 * Math.abs(ph - 0.5) - 1; break;
      default:         out[i] = 0;
    }
  }
  return out;
}

/** Peak-normalize to ±1 (leaves silence alone). */
function normalize(frame) {
  let peak = 0;
  for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]));
  if (peak < 1e-6) return frame;
  const g = 1 / peak;
  for (let i = 0; i < frame.length; i++) frame[i] *= g;
  return frame;
}

/** Additive: sum of sine harmonics with the given amplitudes → normalized frame. */
function additiveWave(harmonics) {
  const out = new Float32Array(N);
  for (let k = 0; k < harmonics.length; k++) {
    const amp = harmonics[k];
    if (!amp) continue;
    const w = 2 * Math.PI * (k + 1) / N;
    for (let i = 0; i < N; i++) out[i] += amp * Math.sin(w * i);
  }
  return normalize(out);
}

/** First `count` harmonic magnitudes of a frame (naive DFT) — for slider readout. */
function analyzeHarmonics(frame, count) {
  const mags = new Float32Array(count);
  for (let k = 1; k <= count; k++) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / N;
    for (let i = 0; i < N; i++) { re += frame[i] * Math.cos(w * i); im += frame[i] * Math.sin(w * i); }
    mags[k - 1] = Math.min(1, (2 * Math.sqrt(re * re + im * im)) / N);
  }
  return mags;
}

/** Resample an arbitrary-length single cycle (e.g. an AKWF buffer) to N samples. */
function resampleToN(data) {
  const out = new Float32Array(N);
  const L = data.length;
  for (let i = 0; i < N; i++) {
    const x = (i / N) * L;
    const i0 = Math.floor(x) % L, i1 = (i0 + 1) % L, frac = x - Math.floor(x);
    out[i] = data[i0] * (1 - frac) + data[i1] * frac;
  }
  return normalize(out);
}

function ensureFrames(t) {
  if (!t.wavetable || !Array.isArray(t.wavetable.frames) || !t.wavetable.frames.length) {
    // Seed a starter table so there's something to morph across.
    t.wavetable = { frames: BASIC.map(basicWave).map(f => Array.from(f)) };
  }
  // Ensure Float32Array-friendly numeric arrays of length N.
  t.wavetable.frames = t.wavetable.frames.map(f => {
    const a = Float32Array.from(f);
    return a.length === N ? a : resampleToN(a);
  });
  return t.wavetable.frames;
}

function pushToVoice(t) {
  if (t.voice?.type === "wavetable") t.voice.setWavetable(t.wavetable.frames.map(f => Array.from(f)));
}

export function openWavetableEditor(t) {
  if (t._wtModal) return;
  const frames = ensureFrames(t);
  let sel = 0;

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-wt__modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const prebuiltOpts = [...BASIC, ...WAVETABLE_WAVES.map(w => w.name)]
    .map(nm => `<option value="${nm}">${nm}</option>`).join("");
  modal.innerHTML = `
    <div class="sq-wt__head">
      <span class="sq-wt__title">wavetable</span>
      <span class="sq-wt__info"></span>
    </div>
    <div class="sq-wt__frames"></div>
    <div class="sq-wt__frames-ctl">
      <button type="button" class="sq-wt__add sq-btn--ghost">+ frame</button>
      <button type="button" class="sq-wt__dup sq-btn--ghost">duplicate</button>
      <button type="button" class="sq-wt__del sq-btn--ghost">remove</button>
      <label>load <select class="sq-wt__preset">${prebuiltOpts}</select></label>
      <button type="button" class="sq-wt__load sq-btn--ghost">→ frame</button>
      <button type="button" class="sq-wt__norm sq-btn--ghost">normalize</button>
      <button type="button" class="sq-wt__clear sq-btn--ghost">clear</button>
    </div>
    <canvas class="sq-wt__canvas" width="640" height="200"></canvas>
    <div class="sq-wt__harm"></div>
    <div class="sq-wt__hint">draw the frame · harmonic bars build it additively · the synth "wave" knob morphs across frames</div>
    <button type="button" class="sq-panel__modal-close">done</button>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const framesEl = modal.querySelector(".sq-wt__frames");
  const canvas = modal.querySelector(".sq-wt__canvas");
  const harmEl = modal.querySelector(".sq-wt__harm");
  const infoEl = modal.querySelector(".sq-wt__info");

  // ---- harmonic sliders ----
  const harmSliders = [];
  for (let k = 0; k < NHARM; k++) {
    const s = document.createElement("input");
    s.type = "range"; s.min = "0"; s.max = "1"; s.step = "0.01"; s.value = "0";
    s.className = "sq-wt__harm-bar"; s.title = `harmonic ${k + 1}`;
    s.addEventListener("input", () => {
      const harmonics = harmSliders.map(x => Number(x.value));
      frames[sel] = additiveWave(harmonics);
      drawFrame(); renderFrameStrip(); pushToVoice(t);
    });
    harmSliders.push(s);
    harmEl.appendChild(s);
  }
  const syncHarmSlidersFromFrame = () => {
    const mags = analyzeHarmonics(frames[sel], NHARM);
    harmSliders.forEach((s, k) => { if (s !== document.activeElement) s.value = String(mags[k]); });
  };

  // ---- main canvas draw ----
  const drawFrame = () => {
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, mid = h / 2;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#0e0f12"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#2a2d35"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, mid); c.lineTo(w, mid); c.stroke();
    const fr = frames[sel];
    c.strokeStyle = "#c2f04a"; c.lineWidth = 1.5; c.beginPath();
    for (let x = 0; x < w; x++) {
      const s = fr[Math.floor((x / w) * fr.length)] || 0;
      const y = mid - s * (mid - 4);
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
    infoEl.textContent = `${frames.length} frame${frames.length === 1 ? "" : "s"} · editing #${sel + 1}`;
  };

  let drawing = false, lastX = -1;
  const setSampleFromEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const yv = Math.max(-1, Math.min(1, ((canvas.height / 2) - (e.clientY - r.top)) / (canvas.height / 2 - 4)));
    const fr = frames[sel];
    const idx = Math.min(fr.length - 1, Math.floor(x * fr.length));
    // paint a small span, and interpolate across any gap since the last point
    if (lastX >= 0 && Math.abs(idx - lastX) > 1) {
      const a = Math.min(idx, lastX), b = Math.max(idx, lastX);
      for (let i = a; i <= b; i++) fr[i] = yv;
    } else fr[idx] = yv;
    lastX = idx;
    drawFrame();
  };
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); drawing = true; lastX = -1; setSampleFromEvent(e); });
  canvas.addEventListener("pointermove", (e) => { if (drawing) setSampleFromEvent(e); });
  const endDraw = (e) => {
    if (!drawing) return;
    drawing = false; lastX = -1;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    syncHarmSlidersFromFrame(); renderFrameStrip(); pushToVoice(t);
  };
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointercancel", endDraw);

  // ---- frame strip (thumbnails) ----
  function renderFrameStrip() {
    framesEl.replaceChildren();
    frames.forEach((fr, i) => {
      const cell = document.createElement("canvas");
      cell.width = 60; cell.height = 40; cell.className = "sq-wt__thumb" + (i === sel ? " is-sel" : "");
      const c = cell.getContext("2d");
      c.fillStyle = "#0e0f12"; c.fillRect(0, 0, 60, 40);
      c.strokeStyle = i === sel ? "#c2f04a" : "#6e7280"; c.lineWidth = 1; c.beginPath();
      for (let x = 0; x < 60; x++) { const s = fr[Math.floor((x / 60) * fr.length)] || 0; const y = 20 - s * 18; x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
      c.stroke();
      cell.addEventListener("click", () => { sel = i; drawFrame(); syncHarmSlidersFromFrame(); renderFrameStrip(); });
      framesEl.appendChild(cell);
    });
  }

  // ---- frame + edit controls ----
  modal.querySelector(".sq-wt__add").addEventListener("click", () => { frames.push(basicWave("sine")); sel = frames.length - 1; refresh(); pushToVoice(t); });
  modal.querySelector(".sq-wt__dup").addEventListener("click", () => { frames.splice(sel + 1, 0, Float32Array.from(frames[sel])); sel++; refresh(); pushToVoice(t); });
  modal.querySelector(".sq-wt__del").addEventListener("click", () => { if (frames.length > 1) { frames.splice(sel, 1); sel = Math.min(sel, frames.length - 1); refresh(); pushToVoice(t); } });
  modal.querySelector(".sq-wt__norm").addEventListener("click", () => { normalize(frames[sel]); refresh(); pushToVoice(t); });
  modal.querySelector(".sq-wt__clear").addEventListener("click", () => { frames[sel] = new Float32Array(N); refresh(); pushToVoice(t); });
  modal.querySelector(".sq-wt__load").addEventListener("click", async () => {
    const name = modal.querySelector(".sq-wt__preset").value;
    if (BASIC.includes(name)) { frames[sel] = basicWave(name); refresh(); pushToVoice(t); return; }
    try {
      await ensureAudio();
      const buf = await loadBuffer(state.audioCtx, `/wavetables/akwf/${name}.wav`);
      frames[sel] = resampleToN(buf.getChannelData(0));
      refresh(); pushToVoice(t);
    } catch (e) { console.warn("wt preset load", e); setStatus("couldn't load that wave", true); }
  });

  const refresh = () => { drawFrame(); syncHarmSlidersFromFrame(); renderFrameStrip(); };

  const close = () => {
    // persist as plain numeric arrays
    t.wavetable = { frames: frames.map(f => Array.from(f)) };
    pushToVoice(t);
    overlay.remove();
    document.removeEventListener("keydown", esc);
    t.el?.querySelector(".sq-track__wav")?.setAttribute("aria-pressed", "false");
    t._wtModal = null;
  };
  const esc = (e) => { if (e.key === "Escape") close(); };
  modal.querySelector(".sq-panel__modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  t._wtModal = { overlay, close };
  const fit = () => { const cw = Math.max(360, Math.min(880, (modal.clientWidth || 700) - 24)); if (canvas.width !== cw) canvas.width = cw; };
  fit(); refresh(); pushToVoice(t);
}
