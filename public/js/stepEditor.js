import { BUNDLED_SAMPLES, GRANULAR_SAMPLES, GRANULAR_SAMPLE_BASE, SAMPLE_BASE, engineByKey } from "./catalog.js";
import { loadBuffer } from "./buffers.js";
import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import { applySampleSpeed, currentBpm } from "./lfo.js";
import { renderRollPanel } from "./pianoRoll.js";
import { updateGranularSpeedEnabled } from "./params.js";
import { renderAutomationPanel } from "./render.js";
import { invertChord, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { CHORD_TYPES, SCALES, applyScale, chordFitsScale, chordNotes, midiToName } from "./theory.js";
import { ensureAudio } from "./transport.js";
import { GRAN_DEFAULTS, GRAN_NUM_KEYS, GRAN_SEL_KEYS } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
export let stepEditor = null;
// Host a track panel inside a centered modal overlay. The panel is physically
// moved into the modal so existing render + event wiring keeps working
// unchanged; on close it slots back into the track via a placeholder anchor,
// so DOM order is preserved. Used by the piano roll, mod, and aut panels.
export function openPanelAsModal(t, opts) {
  const { panel, modalClass, btnSel, modalKey, afterMount } = opts;
  if (!panel || t[modalKey]) return;
  const anchor = document.createComment("panel-anchor");
  panel.replaceWith(anchor);

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-panel__modal " + modalClass;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  panel.hidden = false;
  modal.appendChild(panel);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sq-panel__modal-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!t[modalKey]) return;
    anchor.replaceWith(panel);
    panel.hidden = true;
    overlay.remove();
    const btn = t.el?.querySelector(btnSel);
    if (btn) btn.setAttribute("aria-pressed", "false");
    document.removeEventListener("keydown", escHandler);
    t[modalKey] = null;
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);
  t[modalKey] = { overlay, close };
  if (afterMount) afterMount();
}

export function openRollAsModal(t) {
  openPanelAsModal(t, {
    panel: t._rollPanelEl,
    modalClass: "roll-modal",
    btnSel: ".sq-track__roll",
    modalKey: "_rollModal",
    afterMount: () => renderRollPanel(t, t._rollPanelEl),
  });
}

export function openModAsModal(t) {
  openPanelAsModal(t, {
    panel: t._modPanelEl,
    modalClass: "mod-modal",
    btnSel: ".sq-track__mod",
    modalKey: "_modModal",
  });
}

export function openAutAsModal(t) {
  openPanelAsModal(t, {
    panel: t._autPanelEl,
    modalClass: "aut-modal",
    btnSel: ".track-aut",
    modalKey: "_autModal",
    afterMount: () => renderAutomationPanel(t, t._autPanelEl),
  });
}

export function openFilterAsModal(t) {
  openPanelAsModal(t, {
    panel: t._filterPanelEl,
    modalClass: "filter-modal",
    btnSel: ".sq-track__filter",
    modalKey: "_filterModal",
  });
}

export function openEnvAsModal(t) {
  openPanelAsModal(t, {
    panel: t._envPanelEl,
    modalClass: "env-modal",
    btnSel: ".sq-track__env",
    modalKey: "_envModal",
  });
}

export function openFxAsModal(t) {
  openPanelAsModal(t, {
    panel: t._fxPanelEl,
    modalClass: "fx-modal",
    btnSel: ".sq-track__fx",
    modalKey: "_fxModal",
  });
}

export function openEqAsModal(t) {
  openPanelAsModal(t, {
    panel: t._eqPanelEl,
    modalClass: "eq-modal",
    btnSel: ".sq-track__eq",
    modalKey: "_eqModal",
  });
}

export function openCompAsModal(t) {
  openPanelAsModal(t, {
    panel: t._compPanelEl,
    modalClass: "comp-modal",
    btnSel: ".sq-track__comp",
    modalKey: "_compModal",
  });
}

// Granular WAV viewer — a self-contained modal (not a moved panel) that draws
// the sample waveform, the play head + window band, and live white bars for the
// grains playing right now (the nanobox lemondrop's signature grain graph). The
// rAF loop lives only while the modal is open and "animate" is on, so nothing
// runs in the background. `t.gWavAnimate` persists the toggle across opens.
export function openGranularWavModal(t) {
  if (t._gWavModal) return;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-gwav__modal";
  modal.dataset.trackId = String(t.id);   // lets the right-click param menu find the track
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="sq-gwav__head">
      <span class="sq-gwav__title">granular · <select class="sq-gwav__file" title="switch the sample this track granulates"></select></span>
      <label class="sq-gwav__anim"><input type="checkbox" class="sq-gwav__anim-cb" /> animate</label>
    </div>
    <canvas class="sq-gwav__canvas" width="640" height="200"></canvas>
    <div class="sq-gwav__info"></div>
    <div class="sq-gwav__hint">drag the window\u2019s middle to move it, its edges to resize \u00b7 click elsewhere to jump there</div>
    <div class="sq-gwav__ctl">
      <div class="sq-gwav__ctl-row">
        <label title="grain length. Short grains rattle and buzz; long ones overlap into a smooth wash">grain <input type="range" class="gw-harm" min="0" max="1" step="0.01" /></label>
        <label title="grains per second, 8 to 90. Ignored while sync is on — rate takes over">dense <input type="range" class="gw-timb" min="0" max="1" step="0.01" /></label>
        <label title="play position in the sample. Dragging the window in the wave editor sets this too">pos <input type="range" class="gw-morph" min="0" max="1" step="0.01" /></label>
        <label title="diffusion macro: widens the window, loosens the jitter and adds detune, all at once. Leave it at zero if you want a tight, in-tune cloud">spray <input type="range" class="gw-decay" min="0" max="1" step="0.01" /></label>
      </div>
      <div class="sq-gwav__ctl-row">
        <label title="fixed = every grain reads from one spot; moving = the play head scans through the sample">play <select class="gw-gplay"><option value="fixed">fixed</option><option value="moving">moving</option></select></label>
        <label title="how fast the play head travels through the sample, when play is set to moving. 1 = the sample's own speed, 0 = frozen, negative = backwards, up to 2x either way. Pitch is unaffected">speed <input type="range" class="gw-gspeed" min="-2" max="2" step="0.01" /></label>
        <label title="transposes every grain, in semitones, up or down two octaves. Independent of speed — the sample still plays through in the same time">pitch <input type="range" class="gw-gpitch" min="-24" max="24" step="1" /></label>
        <label title="what the moving play head does at the end of the sample: stop, wrap to the start, or bounce back">loop <select class="gw-gloop"><option value="none">none</option><option value="fwd">fwd</option><option value="bidir">bidir</option></select></label>
      </div>
      <div class="sq-gwav__ctl-row">
        <label title="how far each grain may stray from the play head — the band drawn across the waveform. Narrow reads one instant over and over; at 100% the band is the whole sample, so grains come from anywhere in it">window <input type="range" class="gw-gwindow" min="0" max="1" step="0.01" /></label>
        <label title="randomises when each grain fires. At zero the grain train is perfectly regular and hums a tone at the grain rate; raise it to break that up into texture">jitter <input type="range" class="gw-gjitter" min="0" max="1" step="0.01" /></label>
        <label title="random pitch per grain, up to a semitone either way — thickens a cloud into a chorus">detune <input type="range" class="gw-gdetune" min="0" max="1" step="0.01" /></label>
        <label title="random stereo placement per grain — widens the cloud without touching its tone">pan <input type="range" class="gw-gpan" min="0" max="1" step="0.01" /></label>
      </div>
      <div class="sq-gwav__ctl-row">
        <label title="sprinkles octave or fifth jumps across the grains, for a harmonised cloud rather than a flat one">pattern <select class="gw-gpattern"><option value="none">none</option><option value="oct">octaves</option><option value="fifth">fifths</option></select></label>
        <label class="gw-sync-wrap" title="lock the grain rate to the tempo instead of the dense slider — rhythmic granulation rather than a wash"><input type="checkbox" class="gw-gsync" /> sync</label>
        <label title="grain rate as a division of the tempo, used while sync is on (dense does nothing then)">rate <select class="gw-grate">
          <option value="1/64">1/64</option><option value="1/32t">1/32T</option><option value="1/32">1/32</option>
          <option value="1/16t">1/16T</option><option value="1/16">1/16</option><option value="1/8t">1/8T</option>
          <option value="1/8">1/8</option><option value="1/4t">1/4T</option><option value="1/4">1/4</option>
          <option value="1/2t">1/2T</option><option value="1/2">1/2</option><option value="1bar">1 bar</option>
          <option value="2bar">2 bar</option><option value="4bar">4 bar</option><option value="8bar">8 bar</option>
        </select></label>
      </div>
    </div>
    <button type="button" class="sq-panel__modal-close">done</button>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);

  const canvas = modal.querySelector(".sq-gwav__canvas");
  const animCb = modal.querySelector(".sq-gwav__anim-cb");
  const infoEl = modal.querySelector(".sq-gwav__info");
  // Sample picker: the texture library, plus the track's own file when it has
  // one (a loaded file has no library id, so it gets its own entry rather than
  // showing whichever texture happens to be first).
  const fileSel = modal.querySelector(".sq-gwav__file");
  const rebuildFileOptions = () => {
    fileSel.replaceChildren();
    if (!t.granularSample) {
      const own = document.createElement("option");
      own.value = "";
      own.textContent = t.uploadFileName || "sample";
      fileSel.appendChild(own);
    }
    for (const s of GRANULAR_SAMPLES) {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.label;
      fileSel.appendChild(o);
    }
    fileSel.value = t.granularSample?.id ?? "";
  };
  rebuildFileOptions();
  fileSel.addEventListener("change", async () => {
    const id = fileSel.value;
    if (!id) return;
    const label = GRANULAR_SAMPLES.find(s => s.id === id)?.label || id;
    setStatus(`loading "${label}"…`);
    try {
      const buf = await loadBuffer(state.audioCtx, `${GRANULAR_SAMPLE_BASE}/${id}.wav`);
      if (!t._gWavModal) return;                 // modal closed while it loaded
      t.uploadBuffer = buf;
      t.uploadAudio = null;                      // streamed, nothing to persist
      t.uploadFileName = label;
      t.soundPromptText = label;
      t.granularSample = { id, label };
      if (t.voice?.type === "granular") t.voice.setBuffer(buf);
      rebuildFileOptions();
      draw();                                    // recomputes peaks for the new buffer
      setStatus(`"${t.name}" ← ${label} (${Math.round(buf.duration * 1000)}ms)`);
    } catch (e) {
      console.warn("granular texture load", e);
      setStatus(`failed to load "${label}"`, true);
      rebuildFileOptions();
    }
  });
  animCb.checked = t.gWavAnimate !== false;

  let raf = 0;
  let peaks = null, peaksFor = null, peaksW = 0;
  const computePeaks = (buf, w) => {
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const arr = new Float32Array(w * 2);
    for (let x = 0; x < w; x++) {
      let mn = 1, mx = -1;
      const s = x * step, e = Math.min(data.length, s + step);
      for (let i = s; i < e; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      arr[x * 2] = mn; arr[x * 2 + 1] = mx;
    }
    return arr;
  };

  const draw = () => {
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, mid = h / 2;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#0e0f12"; c.fillRect(0, 0, w, h);
    const buf = t.voice?.buffer;
    if (!buf) {
      c.fillStyle = "#8a8c93"; c.font = "12px ui-monospace, monospace";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("no sample loaded", w / 2, mid);
      infoEl.textContent = "no sample";
      return;
    }
    if (peaksFor !== buf || peaksW !== w) { peaks = computePeaks(buf, w); peaksFor = buf; peaksW = w; }
    // waveform (lemondrop yellow)
    c.strokeStyle = "#c2f04a"; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < w; x++) {
      c.moveTo(x + 0.5, mid - peaks[x * 2] * mid);
      c.lineTo(x + 0.5, mid - peaks[x * 2 + 1] * mid);
    }
    c.stroke();
    const vf = t.voice?.vizFrame ? t.voice.vizFrame() : { head: t.params.morph ?? 0, windowFrac: 0, grains: [] };
    // Window band around the play head. Grain positions wrap around the sample,
    // so the band does too — draw the copies either side, which is what makes a
    // 100% window read as the whole waveform wherever the head sits.
    if (vf.windowFrac > 0) {
      const cx = vf.head * w, half = vf.windowFrac * w;
      c.fillStyle = "rgba(194,240,74,0.12)";
      for (const dx of [-w, 0, w]) c.fillRect(cx - half + dx, 0, half * 2, h);
    }
    // live grain bars (white)
    if (animCb.checked && vf.grains.length) {
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1; c.beginPath();
      for (const p of vf.grains) { const gx = p * w; c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, h); }
      c.stroke();
    }
    // play head
    const hx = vf.head * w;
    c.strokeStyle = "#ff6fa3"; c.lineWidth = 2; c.beginPath();
    c.moveTo(hx, 0); c.lineTo(hx, h); c.stroke();
    const mode = (t.params.gplay === "moving") ? "moving" : "fixed";
    infoEl.textContent = `${buf.duration.toFixed(2)}s · ${mode} · grains ${vf.grains.length}`;
    // The macro sliders can be moved from outside this modal — per-step
    // automation drives all four — so re-read them on each paint. Never touch
    // the one under the pointer, and only write on a change so dragging one
    // doesn't fight the repaint.
    for (const k of ["harm", "timb", "morph", "decay"]) {
      const el = modal.querySelector(".gw-" + k);
      if (!el || el === document.activeElement) continue;
      const v = String(t.params[k] ?? 0.5);
      if (el.value !== v) el.value = v;
    }
  };

  const loop = () => { draw(); raf = requestAnimationFrame(loop); };
  const startLoop = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const stopLoop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const fit = () => {
    const cw = Math.max(320, Math.min(900, (modal.clientWidth || 660) - 24));
    if (canvas.width !== cw) canvas.width = cw;
  };

  // Granular controls live in the visualizer too — same params as the track's
  // granular group. Writing a param updates the voice, keeps the track group's
  // control in sync, and redraws so the window band / play head react at once.
  const setP = (k, v) => {
    t.params[k] = v; t.voice?.setParam(k, v);
    const gEl = t.el?.querySelector(".p-" + k);
    if (gEl) { if (gEl.type === "checkbox") gEl.checked = !!v; else gEl.value = v; }
    const mEl = modal.querySelector(".gw-" + k);
    if (mEl && mEl !== document.activeElement) { if (mEl.type === "checkbox") mEl.checked = !!v; else mEl.value = v; }
    if (k === "gplay") updateGranularSpeedEnabled(t);      // speed is moving-only
    draw();
  };
  const gp = t.params;
  const gq = s => modal.querySelector(s);
  for (const k of [...GRAN_NUM_KEYS, ...GRAN_SEL_KEYS]) gq(".gw-" + k).value = gp[k] ?? GRAN_DEFAULTS[k];
  gq(".gw-gsync").checked  = gp.gsync    ?? GRAN_DEFAULTS.gsync;
  // The four track macros live here too: grain size, density, play position and
  // spray. setP() writes through to both this modal and the track's own slider,
  // so dragging the window (which sets pos) moves the pos slider with it.
  for (const [cls, key] of [["harm", "harm"], ["timb", "timb"], ["morph", "morph"], ["decay", "decay"]]) {
    gq(".gw-" + cls).value = gp[key] ?? 0.5;
  }
  for (const k of ["harm", "timb", "morph", "decay"]) {
    gq(".gw-" + k).addEventListener("input", e => setP(k, Number(e.target.value)));
  }
  for (const k of GRAN_NUM_KEYS) gq(".gw-" + k).addEventListener("input", e => setP(k, Number(e.target.value)));
  for (const k of GRAN_SEL_KEYS) gq(".gw-" + k).addEventListener("change", e => setP(k, e.target.value));
  gq(".gw-gsync").addEventListener("change", e => setP("gsync", e.target.checked));

  // The grain window is dragged like a note in the piano roll: grab its middle to
  // slide the whole window along the sample, grab an edge to resize from that
  // side while the other stays put. Clicking outside it moves the window there.
  // (Window width is stored as gwindow; vizFrame reports the band it draws as a
  // half-width in 0..1 of the sample, so setHalf inverts _windowFrac().)
  const EDGE_PX = 7;
  const fracFromEvent = e => { const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const bandNow = () => {
    const vf = t.voice?.vizFrame ? t.voice.vizFrame() : null;
    return { head: vf ? vf.head : (t.params.morph ?? 0), half: vf ? vf.windowFrac : 0 };
  };
  const setHalf = (half) => {
    const spray = Math.max(0, Math.min(1, Number(t.params.decay) || 0));
    setP("gwindow", Math.max(0, Math.min(1, half * 2 - spray * 0.5)));
  };
  const zoneAt = (x) => {
    const { head, half } = bandNow();
    const r = canvas.getBoundingClientRect();
    const edge = EDGE_PX / Math.max(1, r.width);
    if (half > 0.002) {
      if (Math.abs(x - (head - half)) <= edge) return "left";
      if (Math.abs(x - (head + half)) <= edge) return "right";
      if (x > head - half && x < head + half) return "move";
    }
    return "outside";
  };
  let winDrag = null;
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    const x = fracFromEvent(e);
    const zone = zoneAt(x);
    const { head, half } = bandNow();
    if (zone === "outside") {
      // Jump the window here, then let the same drag carry it (grabbed centrally).
      setP("morph", x);
      winDrag = { zone: "move", grabOffset: 0, left: x - half, right: x + half };
    } else if (zone === "move") {
      winDrag = { zone: "move", grabOffset: x - head, left: head - half, right: head + half };
    } else {
      winDrag = { zone, grabOffset: 0, left: head - half, right: head + half };
    }
  });
  canvas.addEventListener("pointermove", e => {
    const x = fracFromEvent(e);
    if (!winDrag) {                       // hover: advertise what a drag would do
      const z = zoneAt(x);
      canvas.style.cursor = z === "left" || z === "right" ? "ew-resize" : z === "move" ? "move" : "pointer";
      return;
    }
    if (winDrag.zone === "move") {
      setP("morph", Math.max(0, Math.min(1, x - winDrag.grabOffset)));
      return;
    }
    // Resize: the grabbed edge follows the pointer, the opposite one stays put.
    const anchor = winDrag.zone === "left" ? winDrag.right : winDrag.left;
    const moving = winDrag.zone === "left" ? Math.min(x, anchor - 0.002) : Math.max(x, anchor + 0.002);
    const lo = Math.min(anchor, moving), hi = Math.max(anchor, moving);
    setHalf((hi - lo) / 2);
    setP("morph", Math.max(0, Math.min(1, (lo + hi) / 2)));
  });
  const endWinDrag = e => { if (winDrag) { winDrag = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} } };
  canvas.addEventListener("pointerup", endWinDrag);
  canvas.addEventListener("pointercancel", endWinDrag);
  canvas.style.cursor = "pointer";

  animCb.addEventListener("change", () => {
    t.gWavAnimate = animCb.checked;
    if (animCb.checked) { draw(); startLoop(); } else { stopLoop(); draw(); }
  });

  const close = () => {
    stopLoop();
    overlay.remove();
    document.removeEventListener("keydown", esc);
    t._gWavModal = null;
  };
  const esc = (e) => { if (e.key === "Escape") close(); };
  modal.querySelector(".sq-panel__modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  t._gWavModal = { overlay, close };
  updateGranularSpeedEnabled(t);   // now that the modal is findable from the track
  fit();
  draw();                        // paint one frame immediately (before any rAF)
  if (animCb.checked) startLoop();
}

// Draw a mono waveform (background + min/max peaks) into a canvas. Returns true
// if a buffer was drawn, false (placeholder text) if none. Shared by the sample
// + slice modals.
function drawWaveformBase(c, cv, buffer, color = "#6e7280") {
  const w = cv.width, h = cv.height, mid = h / 2;
  c.clearRect(0, 0, w, h);
  c.fillStyle = "#0e0f12"; c.fillRect(0, 0, w, h);
  if (!buffer) {
    c.fillStyle = "#8a8c93"; c.font = "12px ui-monospace, monospace";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("no sample loaded", w / 2, mid);
    return false;
  }
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
  for (let x = 0; x < w; x++) {
    let mn = 1, mx = -1;
    const s = x * step, e = Math.min(data.length, s + step);
    for (let i = s; i < e; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    c.moveTo(x + 0.5, mid - mn * mid); c.lineTo(x + 0.5, mid - mx * mid);
  }
  c.stroke();
  return true;
}

// Onset detection for the slicer's "detect transients": short-time RMS energy →
// positive flux → adaptive-threshold peak-pick with a min spacing. Returns sorted
// 0..1 slice-start fractions within [region.start, region.end], first = start.
// `sensitivity` 0..1 (default 0.5): higher = more slices (lower flux threshold +
// tighter min spacing), lower = only the strongest transients.
function detectTransients(buffer, region, maxSlices = 32, sensitivity = 0.5) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const startI = Math.floor((region.start ?? 0) * data.length);
  const endI = Math.floor((region.end ?? 1) * data.length);
  const win = Math.max(256, Math.floor(sr * 0.01));   // ~10 ms
  const hop = Math.max(128, Math.floor(win / 2));
  const frames = [];
  for (let i = startI; i < endI; i += hop) {
    let e = 0; const end = Math.min(endI, i + win);
    for (let j = i; j < end; j++) e += data[j] * data[j];
    frames.push({ i, e: Math.sqrt(e / Math.max(1, end - i)) });
  }
  const flux = frames.map((f, k) => (k === 0 ? 0 : Math.max(0, f.e - frames[k - 1].e)));
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const peak = Math.max(1e-9, ...flux);
  const s = Math.max(0, Math.min(1, sensitivity));
  const thr = mean + (peak - mean) * (0.5 - s * 0.45);   // s=0.5 → 0.275 (≈ old 0.25)
  const gapMs = 0.09 - s * 0.07;                          // 90 ms (low) … 20 ms (high)
  const minGap = Math.max(1, Math.floor((sr * gapMs) / hop));
  const onsets = [];
  let last = -minGap;
  for (let k = 1; k < flux.length - 1; k++) {
    if (flux[k] >= thr && flux[k] >= flux[k - 1] && flux[k] >= flux[k + 1] && (k - last) >= minGap) {
      onsets.push(frames[k].i / data.length);
      last = k;
    }
  }
  let slices = onsets;
  const rs = region.start ?? 0;
  // Flux can't fire on frame 0 (nothing to diff against), so a sample that
  // starts right on a hit needs region.start prepended as slice 0. But if the
  // lead-in is quiet, prepending it makes a silent first slice that plays
  // nothing — in that case the first detected onset IS slice 0. Gate on the
  // energy at the region start.
  const peakE = Math.max(1e-9, ...frames.map(f => f.e));
  const startEnergetic = frames.length && frames[0].e >= peakE * 0.15;
  if (!slices.length) slices = [rs];
  else if (startEnergetic && slices[0] > rs + 0.001) slices = [rs, ...slices];
  slices = slices.map(x => Math.max(0, Math.min(1, x))).sort((a, b) => a - b);
  return slices.slice(0, maxSlices);
}

// Track-level sampler editor — one view combining the sample region (start/end +
// fades + loop + fit + pitch-lock) AND the note-triggered slicer (markers,
// equal-N / transient auto-slice, base note, region/to-end, per-slice pads). On
// the shared waveform: drag the green/pink handles to set the region, click to
// add a slice, drag a marker to move it, double-click to remove. Edits
// t.sampleDefaults + the track slicer fields.
export function openSampleEditorModal(t) {
  if (t._sampleModal) return;
  const sd = t.sampleDefaults || (t.sampleDefaults = { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off" });
  if (!Array.isArray(t.slices)) t.slices = [];
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-samp__modal";
  modal.dataset.trackId = String(t.id);   // lets the right-click param menu find the track
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="sq-samp__head">
      <span class="sq-samp__title">sample · <select class="sq-samp__file" title="switch this track's sample"></select></span>
      <span class="sq-samp__info"></span>
    </div>
    <canvas class="sq-samp__canvas" width="640" height="150"></canvas>
    <div class="sq-samp__row">
      <label>snap <select class="sq-samp__snap">
        <option value="free" selected>free</option><option value="1">1 beat</option><option value="0.5">1/8</option><option value="0.25">1/16</option><option value="0.125">1/32</option>
      </select></label>
      <label>fit <select class="sq-samp__fit">
        <option value="native">native</option><option value="2xbpm">2× bpm</option><option value="1xbpm">1× bpm</option><option value="1/2bpm">1/2 bpm</option><option value="1/4bpm">1/4 bpm</option>
      </select></label>
      <label class="sq-samp__pl"><input type="checkbox" class="sq-samp__pitchlock" /> pitch lock</label>
      <label>loop <select class="sq-samp__loop">
        <option value="off">off</option><option value="loop">loop</option><option value="pingpong">ping-pong</option>
      </select></label>
      <button type="button" class="sq-samp__preview sq-btn--ghost">preview</button>
    </div>
    <div class="sq-samp__row">
      <label>fade in <input type="range" class="sq-samp__fadein" min="0" max="2" step="0.01" /> <span class="sq-samp__fadein-lbl"></span></label>
      <label>fade out <input type="range" class="sq-samp__fadeout" min="0" max="2" step="0.01" /> <span class="sq-samp__fadeout-lbl"></span></label>
    </div>
    <div class="sq-samp__row sq-samp__slice-row">
      <label class="sq-slice__on"><input type="checkbox" class="sq-slice__on-cb" /> slice mode</label>
      <label>equal <select class="sq-slice__n"><option>2</option><option>4</option><option selected>8</option><option>16</option><option>32</option></select></label>
      <button type="button" class="sq-slice__make sq-btn--ghost">make</button>
      <button type="button" class="sq-slice__detect sq-btn--ghost">detect</button>
      <label>sens <input type="range" class="sq-slice__sens" min="0" max="1" step="0.01" /></label>
      <button type="button" class="sq-slice__clear sq-btn--ghost">clear</button>
      <label>base <input type="number" class="sq-slice__base" min="0" max="127" /> <span class="sq-slice__base-name"></span></label>
      <label>play <select class="sq-slice__mode"><option value="region">region</option><option value="toend">to end</option></select></label>
    </div>
    <div class="sq-slice__pads"></div>
    <div class="sq-slice__hint">green/pink handles = region · click = add slice · drag = move · double-click = remove</div>
    <button type="button" class="sq-panel__modal-close">done</button>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);

  const canvas = modal.querySelector(".sq-samp__canvas");
  const infoEl = modal.querySelector(".sq-samp__info");
  // Sample picker, same idea as the granular editor's: the bundled kits, plus
  // the track's own file when it has one. Switching here swaps the buffer in
  // place — the region, fades and slices belong to the old sample, so they're
  // reset rather than silently re-applied to different audio.
  const fileSel = modal.querySelector(".sq-samp__file");
  const rebuildFileOptions = () => {
    fileSel.replaceChildren();
    if (t.sampleSource?.kind !== "bundled") {
      const own = document.createElement("option");
      own.value = "";
      own.textContent = t.uploadFileName || t.sampleSource?.name || "sample";
      fileSel.appendChild(own);
    }
    for (const b of BUNDLED_SAMPLES) {
      const o = document.createElement("option");
      o.value = b.id; o.textContent = b.label;
      fileSel.appendChild(o);
    }
    fileSel.value = t.sampleSource?.kind === "bundled" ? (t.sampleSource.id ?? "") : "";
  };
  rebuildFileOptions();
  fileSel.addEventListener("change", async () => {
    const id = fileSel.value;
    if (!id) return;
    const label = BUNDLED_SAMPLES.find(b => b.id === id)?.label || id;
    setStatus(`loading "${label}"…`);
    try {
      const buf = await loadBuffer(state.audioCtx, `${SAMPLE_BASE}/${id}.mp3`);
      if (!t._sampleModal) return;                  // modal closed while it loaded
      t.sampleSource = { kind: "bundled", id, name: label };
      t.uploadBuffer = buf;
      t.uploadAudio = null;                         // bundled: fetched by id, not stored
      t.uploadFileName = label;
      t.soundPromptText = label;
      if (t.voice?.type === "sampler") t.voice.setBuffer(buf);
      t.slices = [];                                // markers belonged to the old audio
      sd.start = 0; sd.end = 1;
      applySampleSpeed(t);
      rebuildFileOptions();
      renderPads();
      draw();                                       // repaints from the new buffer
      setStatus(`"${t.name}" ← ${label} (${Math.round(buf.duration * 1000)}ms)`);
    } catch (e) {
      console.warn("bundled sample load", e);
      setStatus(`failed to load "${label}"`, true);
      rebuildFileOptions();
    }
  });
  const snapSel = modal.querySelector(".sq-samp__snap");
  const fitSel = modal.querySelector(".sq-samp__fit");
  const loopSel = modal.querySelector(".sq-samp__loop");
  const plCb = modal.querySelector(".sq-samp__pitchlock");
  const fiI = modal.querySelector(".sq-samp__fadein"), foI = modal.querySelector(".sq-samp__fadeout");
  const fiL = modal.querySelector(".sq-samp__fadein-lbl"), foL = modal.querySelector(".sq-samp__fadeout-lbl");
  const onCb = modal.querySelector(".sq-slice__on-cb");
  const nSel = modal.querySelector(".sq-slice__n");
  const baseIn = modal.querySelector(".sq-slice__base");
  const baseName = modal.querySelector(".sq-slice__base-name");
  const modeSel = modal.querySelector(".sq-slice__mode");
  const sensIn = modal.querySelector(".sq-slice__sens");
  const pads = modal.querySelector(".sq-slice__pads");
  fitSel.value = t.sampleSpeedMode || "native";
  loopSel.value = sd.loopMode || "off";
  plCb.checked = t.pitchLock !== false;
  fiI.value = String(sd.fadeIn ?? 0); foI.value = String(sd.fadeOut ?? 0);
  onCb.checked = !!t.sliceOn;
  baseIn.value = String(t.sliceBase ?? 60);
  modeSel.value = t.slicePlayMode === "toend" ? "toend" : "region";
  sensIn.value = String(t.sliceSensitivity ?? 0.5);
  const fmtFade = s => s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
  fiL.textContent = fmtFade(Number(fiI.value)); foL.textContent = fmtFade(Number(foI.value));
  const setBaseName = () => { baseName.textContent = midiToName(t.sliceBase ?? 60); };
  setBaseName();

  const snapFrac = () => {
    if (snapSel.value === "free") return 0;
    const beats = Number(snapSel.value) || 0; const buf = t.voice?.buffer;
    if (!beats || !buf?.duration) return 0;
    return ((60 / currentBpm()) * beats) / buf.duration;
  };
  const snapTo = f => { const s = snapFrac(); return s ? Math.round(f / s) * s : f; };

  const draw = () => {
    const c = canvas.getContext("2d"); const w = canvas.width, h = canvas.height;
    const buf = t.voice?.buffer;
    const ok = drawWaveformBase(c, canvas, buf, "#6e7280");
    const sx = Math.round((sd.start ?? 0) * w), ex = Math.round((sd.end ?? 1) * w);
    c.fillStyle = "rgba(10,12,16,0.6)"; c.fillRect(0, 0, sx, h); c.fillRect(ex, 0, w - ex, h);
    // slice markers (cyan), then the region handles (green start / pink end) on top
    c.strokeStyle = "#5ad1ff"; c.lineWidth = 1.5;
    for (const s of t.slices) { const x = Math.round(s * w) + 0.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    c.strokeStyle = "#c2f04a"; c.lineWidth = 2; c.beginPath(); c.moveTo(sx + 1, 0); c.lineTo(sx + 1, h); c.stroke();
    c.strokeStyle = "#ff6fa3"; c.beginPath(); c.moveTo(ex - 1, 0); c.lineTo(ex - 1, h); c.stroke();
    const base = t.sliceBase ?? 60;
    infoEl.textContent = (ok && buf)
      ? `${buf.duration.toFixed(2)}s · [${Math.round((sd.start ?? 0) * buf.duration * 1000)}—${Math.round((sd.end ?? 1) * buf.duration * 1000)}]ms · ${t.slices.length} slices${t.slices.length ? " " + midiToName(base) + "–" + midiToName(base + t.slices.length - 1) : ""}`
      : "no sample";
  };

  const renderPads = () => {
    pads.replaceChildren();
    const base = t.sliceBase ?? 60;
    t.slices.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sq-slice__pad sq-btn--ghost";
      b.textContent = midiToName(base + i);
      b.addEventListener("click", () => previewSlice(i));
      pads.appendChild(b);
    });
  };
  const previewSlice = async (i) => {
    if (!t.voice?.buffer) { setStatus("no sample loaded yet", true); return; }
    await ensureAudio();
    const wasOn = t.sliceOn; t.sliceOn = true;   // force a slice hit regardless of the toggle
    try { t.voice.hit((t.sliceBase ?? 60) + i, state.audioCtx.currentTime + 0.02, 1, 0.85, {}); }
    catch (e) { console.warn(e); }
    t.sliceOn = wasOn;
  };

  const fracFromEvent = e => { const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const nearestMarker = f => {
    let best = -1, bd = Infinity;
    t.slices.forEach((s, i) => { const d = Math.abs(s - f); if (d < bd) { bd = d; best = i; } });
    return { idx: best, distPx: bd * canvas.width };
  };
  // One shared canvas: region handles win when closest within 8px, else a nearby
  // slice marker (6px) drags, else a click drops a new slice marker.
  let drag = null;   // { type: "region", which } | { type: "slice", idx }
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    const f = fracFromEvent(e), w = canvas.width;
    const startPx = Math.abs(f - (sd.start ?? 0)) * w;
    const endPx = Math.abs(f - (sd.end ?? 1)) * w;
    const nm = nearestMarker(f);
    if (startPx <= 8 && startPx <= endPx && startPx <= nm.distPx) drag = { type: "region", which: "start" };
    else if (endPx <= 8 && endPx <= nm.distPx) drag = { type: "region", which: "end" };
    else if (nm.idx >= 0 && nm.distPx <= 6) drag = { type: "slice", idx: nm.idx };
    else { const v = snapTo(f); t.slices.push(v); t.slices.sort((a, b) => a - b); drag = { type: "slice", idx: t.slices.indexOf(v) }; renderPads(); }
    applyDrag(f);
  });
  canvas.addEventListener("pointermove", e => { if (drag) applyDrag(fracFromEvent(e)); });
  const endDrag = e => { if (drag) { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} } };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", e => {
    const nm = nearestMarker(fracFromEvent(e));
    if (nm.idx >= 0 && nm.distPx <= 8) { t.slices.splice(nm.idx, 1); renderPads(); draw(); }
  });
  function applyDrag(f) {
    if (!drag) return;
    if (drag.type === "region") {
      const s = snapTo(f);
      if (drag.which === "start") sd.start = Math.max(0, Math.min((sd.end ?? 1) - 0.01, s));
      else sd.end = Math.max((sd.start ?? 0) + 0.01, Math.min(1, s));
    } else {
      const v = snapTo(f);
      t.slices[drag.idx] = v;
      t.slices.sort((a, b) => a - b);
      drag.idx = t.slices.indexOf(v);
    }
    draw();
  }

  snapSel.addEventListener("change", draw);
  fitSel.addEventListener("change", () => { t.sampleSpeedMode = fitSel.value || "native"; applySampleSpeed(t); });
  plCb.addEventListener("change", () => { t.pitchLock = plCb.checked; });
  loopSel.addEventListener("change", () => { sd.loopMode = loopSel.value; });
  fiI.addEventListener("input", () => { const v = Math.max(0, Math.min(2, Number(fiI.value) || 0)); sd.fadeIn = v; fiL.textContent = fmtFade(v); });
  foI.addEventListener("input", () => { const v = Math.max(0, Math.min(2, Number(foI.value) || 0)); sd.fadeOut = v; foL.textContent = fmtFade(v); });
  onCb.addEventListener("change", () => { t.sliceOn = onCb.checked; });
  modeSel.addEventListener("change", () => { t.slicePlayMode = modeSel.value === "toend" ? "toend" : "region"; });
  baseIn.addEventListener("input", () => { t.sliceBase = Math.max(0, Math.min(127, Number(baseIn.value) || 60)); setBaseName(); renderPads(); draw(); });
  modal.querySelector(".sq-slice__make").addEventListener("click", () => {
    const n = Number(nSel.value) || 8; const a = sd.start ?? 0, b = sd.end ?? 1;
    t.slices = Array.from({ length: n }, (_, i) => a + (i / n) * (b - a));
    renderPads(); draw();
  });
  const runDetect = () => {
    const buf = t.voice?.buffer; if (!buf) { setStatus("no sample loaded yet", true); return; }
    t.slices = detectTransients(buf, { start: sd.start ?? 0, end: sd.end ?? 1 }, 32, t.sliceSensitivity ?? 0.5);
    renderPads(); draw();
    setStatus(`detected ${t.slices.length} slices`);
  };
  modal.querySelector(".sq-slice__detect").addEventListener("click", runDetect);
  // Live re-detect while dragging the sensitivity slider, but only once markers
  // already came from a detect pass (don't clobber hand-placed/equal-N slices).
  sensIn.addEventListener("input", () => {
    t.sliceSensitivity = Math.max(0, Math.min(1, Number(sensIn.value)));
    if (t.slices?.length) runDetect();
  });
  modal.querySelector(".sq-slice__clear").addEventListener("click", () => { t.slices = []; renderPads(); draw(); });
  modal.querySelector(".sq-samp__preview").addEventListener("click", async () => {
    if (!t.voice?.buffer) { setStatus("no sample loaded yet", true); return; }
    await ensureAudio();
    const wasSlice = t.sliceOn; t.sliceOn = false;   // audition the plain region
    try {
      t.voice.hit(t.isDrumKit ? 36 : 60, state.audioCtx.currentTime + 0.02, t.voice.buffer.duration, 0.85, {
        startOffset: sd.start, endOffset: sd.end, fadeIn: sd.fadeIn, fadeOut: sd.fadeOut, loopMode: sd.loopMode,
        pitchBase: t.isDrumKit ? 36 : 60, isDrumKit: t.isDrumKit, sampleSpeedMode: t.sampleSpeedMode, pitchLocked: t.pitchLock !== false,
      });
    } catch (e) { console.warn(e); }
    t.sliceOn = wasSlice;
  });

  const fit = () => { const cw = Math.max(360, Math.min(880, (modal.clientWidth || 700) - 24)); if (canvas.width !== cw) canvas.width = cw; };
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); t._sampleModal = null; };
  const esc = e => { if (e.key === "Escape") close(); };
  modal.querySelector(".sq-panel__modal-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);
  t._sampleModal = { overlay, close };
  fit(); renderPads(); draw();
}

// Mobile track menu: physically move the "extras" nodes out of the
// track-head into a centered modal so the user can reach the rarely-used
// controls (panel buttons, save/load patch, len resize, oct/semi shift,
// dup, remove) without horizontal scrolling. The synth params (harm/timb/
// morph/etc.) stay inline in the head — they're the primary sound controls
// on mobile. Restored to their original DOM positions on close so the
// desktop layout is unaffected.
export function openTrackMenu(t) {
  if (t._trackMenuModal) return;
  const head = t.el?.querySelector(".sq-track__head");
  if (!head) return;

  // captured entries remember their real parent — the panel buttons live
  // inside .sq-panel__btn-group, everything else is a direct head child.
  // Restoring in capture order (= DOM order per parent) rebuilds each
  // parent correctly even when every anchor sibling moved out too.
  const captured = [];
  const capture = (root, sel) => {
    const n = root.querySelector(sel);
    if (n) captured.push({ node: n, parent: n.parentNode, nextSibling: n.nextSibling });
    return n;
  };

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-track__menu-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  // section label + horizontal row helpers — pure chrome, discarded on close
  const addLabel = (text) => {
    const h = document.createElement("div");
    h.className = "sq-track__menu-label";
    h.textContent = text;
    modal.appendChild(h);
  };
  const addRow = (nodes) => {
    const r = document.createElement("div");
    r.className = "sq-track__menu-row";
    for (const n of nodes) if (n) r.appendChild(n);
    modal.appendChild(r);
  };
  // icon-only buttons get a visible text label while hosted in the modal;
  // the spans are stripped in close() before the nodes go back to the head
  const withLabel = (btn, text) => {
    if (!btn) return btn;
    const span = document.createElement("span");
    span.className = "sq-menu-btn-label";
    span.textContent = text;
    btn.appendChild(span);
    return btn;
  };

  const title = document.createElement("div");
  title.className = "sq-track__menu-title";
  const nameEl = document.createElement("span");
  nameEl.textContent = t.name?.trim() || "track";
  const engEl = document.createElement("span");
  engEl.className = "sq-track__menu-engine";
  engEl.textContent = engineByKey(t.engineKey)?.label ?? "";
  title.append(nameEl, engEl);
  modal.appendChild(title);

  // sound-shaping panels first — the most-used controls in here
  addLabel("sound");
  const panelWrap = document.createElement("div");
  panelWrap.className = "sq-track__menu-panels";
  for (const sel of [
    ".sq-track__filter", ".sq-track__env", ".sq-track__fx", ".sq-track__eq",
    ".sq-track__comp", ".sq-track__mod", ".track-aut",
  ]) {
    const n = capture(head, sel);
    if (n) panelWrap.appendChild(n);
  }
  modal.appendChild(panelWrap);

  const lenExtend = capture(head, ".sq-track__len-extend");
  if (lenExtend) { addLabel("length"); modal.appendChild(lenExtend); }

  const oct = capture(head, ".sq-track__oct");
  if (oct) { addLabel("pitch"); modal.appendChild(oct); }

  const speedField = head.querySelector(".sq-track__speed")?.closest(".sq-field");
  if (speedField) {
    captured.push({ node: speedField, parent: speedField.parentNode, nextSibling: speedField.nextSibling });
    addLabel("speed");
    modal.appendChild(speedField);
  }

  // The send. Hidden in the head while there is no bus to send to, and the
  // menu keeps that — an empty "routing" section would say nothing.
  const outField = head.querySelector(".sq-track__out-field");
  if (outField && !outField.hidden) {
    captured.push({ node: outField, parent: outField.parentNode, nextSibling: outField.nextSibling });
    addLabel("routing");
    modal.appendChild(outField);
  }

  const saveBtn = capture(head, ".sq-track__save");
  const loadBtn = capture(head, ".sq-track__load-patch");
  if (saveBtn || loadBtn) {
    addLabel("patch");
    addRow([withLabel(saveBtn, "save"), withLabel(loadBtn, "load")]);
  }

  const dupBtn = capture(head, ".sq-track__dup");
  const removeBtn = capture(head, ".sq-track__remove");
  if (dupBtn || removeBtn) {
    addLabel("track");
    addRow([dupBtn, removeBtn]);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sq-track__menu-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!t._trackMenuModal) return;
    // strip the modal-only text labels before the buttons go home
    for (const span of modal.querySelectorAll(".sq-menu-btn-label")) span.remove();
    for (const { node, parent, nextSibling } of captured) {
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(node, nextSibling);
      } else {
        parent.appendChild(node);
      }
    }
    overlay.remove();
    document.removeEventListener("keydown", escHandler);
    t._trackMenuModal = null;
    if (t._trackMoreBtn) t._trackMoreBtn.setAttribute("aria-pressed", "false");
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);
  t._trackMenuModal = { overlay, close };
  if (t._trackMoreBtn) t._trackMoreBtn.setAttribute("aria-pressed", "true");
}

// Mobile pattern menu: physically move every pattern-bar child (except the
// Share + Menu buttons) into a modal. On close, return them in original
// order so the desktop pattern bar is unchanged. Children retain their
// event listeners because we only re-parent, never re-create.
export function closeStepEditor() {
  if (!stepEditor) return;
  document.removeEventListener("keydown", stepEditor.escHandler);
  (stepEditor.overlay || stepEditor.el).remove();
  stepEditor = null;
}

/**
 * Open the per-step editor modal (note pad, chord/arp, ratchet/vel/offset,
 * and the sample row for sample engines).
 * @param {Track} t @param {number} idx @param {HTMLElement} anchorEl
 */
export function openStepEditor(t, idx, anchorEl) {
  closeStepEditor();
  const eng = engineByKey(t.engineKey);
  const defaultNote = t.notes[idx] ?? eng?.defaultNote ?? 60;
  const el = document.createElement("div");
  el.className = "sq-step-editor";
  const chordOptions = `<option value="">none</option>`;
  el.innerHTML = `
    <div class="sq-se__title">step ${idx + 1}</div>
    <div class="sq-se__field sq-se__note-field">
      <label>note</label>
      <div class="sq-se__note-header">
        <span class="sq-se__note-label"></span>
        <div class="sq-se__oct-pager">
          <button class="se-oct-down" type="button" title="lower octaves">oct −</button>
          <span class="sq-se__oct-range"></span>
          <button class="se-oct-up" type="button" title="higher octaves">oct +</button>
        </div>
      </div>
      <div class="sq-se__keyboard" tabindex="0"></div>
      <input class="se-note" type="hidden" value="${Math.max(24, Math.min(95, defaultNote))}" />
    </div>
    <div class="sq-se__field sq-se__chord-field">
      <label>chord</label>
      <select class="se-chord">${chordOptions}</select>
      <label class="sq-se__arp-wrap"><input class="se-arp" type="checkbox" /> arp</label>
      <span class="sq-se__chord-label"></span>
    </div>
    <div class="sq-se__field se-ratchet-row">
      <label>ratchet</label>
      <input class="se-ratchet" type="range" min="1" max="8" step="1" value="${(t.ratchets && t.ratchets[idx]) || 1}" />
      <span class="se-ratchet-label"></span>
    </div>
    <div class="sq-se__field sq-se__cpx-row">
      <label>cpx</label>
      <select class="se-cpx">
        <option value="0">root</option>
        <option value="1">1st inv</option>
        <option value="2">2nd inv</option>
        <option value="3">3rd inv</option>
        <option value="4">drop-oct</option>
      </select>
    </div>
    <div class="sq-se__field sq-se__arp-row" hidden>
      <label>arp</label>
      <div class="sq-se__arp-selects">
        <select class="se-arp-rate" title="arp rate (beats per note)">
          <option value="1">1/4</option>
          <option value="0.5">1/8</option>
          <option value="0.333">1/8t</option>
          <option value="0.25" selected>1/16</option>
          <option value="0.167">1/16t</option>
          <option value="0.125">1/32</option>
        </select>
        <select class="se-arp-range" title="octaves spanned">
          <option value="1" selected>1 oct</option>
          <option value="2">2 oct</option>
          <option value="3">3 oct</option>
          <option value="4">4 oct</option>
        </select>
        <select class="se-arp-dir" title="arp direction">
          <option value="up" selected>up</option>
          <option value="down">down</option>
          <option value="updown">up-down</option>
          <option value="random">random</option>
        </select>
      </div>
    </div>
    <div class="sq-se__field">
      <label>vel</label>
      <input class="se-vel" type="range" min="0" max="1" step="0.01" value="${t.velocities[idx] ?? 0.5}" />
      <span class="sq-se__vel-label"></span>
    </div>
    <div class="sq-se__field">
      <label>offset</label>
      <input class="se-offset" type="range" min="-0.5" max="0.5" step="0.01" value="${t.offsets?.[idx] ?? 0}" />
      <span class="se-offset-label"></span>
    </div>
    <div class="sq-se__field sq-se__sample-row" hidden>
      <label>sample</label>
      <div class="sq-se__sample-ctl">
        <canvas class="sq-se__waveform" width="440" height="72"></canvas>
        <div class="sq-se__sample-meta">
          <span class="sq-se__smp-info">—</span>
          <label>fit
            <select class="sq-se__smp-fit">
              <option value="native" selected>native</option>
              <option value="2xbpm">2× bpm</option>
              <option value="1xbpm">1× bpm</option>
              <option value="1/2bpm">1/2 bpm</option>
              <option value="1/4bpm">1/4 bpm</option>
            </select>
          </label>
          <label>snap
            <select class="sq-se__smp-snap">
              <option value="free" selected>free</option>
              <option value="1">1 beat</option>
              <option value="0.5">1/8</option>
              <option value="0.25">1/16</option>
              <option value="0.125">1/32</option>
            </select>
          </label>
          <label>loop
            <select class="se-smp-loop">
              <option value="off" selected>off</option>
              <option value="loop">loop</option>
              <option value="pingpong">ping-pong</option>
            </select>
          </label>
          <label class="sq-se__smp-pitchlock" title="Ignore the step note and play the sample at its fit/natural rate — keeps bpm-fitted loops on the grid. Uncheck to let notes transpose the sample.">
            <input class="se-smp-pitchlock" type="checkbox" /> pitch lock
          </label>
          <button class="sq-se__preview" type="button">preview</button>
          <button class="se-apply-all sq-btn--ghost" type="button" title="apply these sample settings to every step on this track and use as the default for new steps">apply to all</button>
        </div>
        <div class="sq-se__sample-fade">
          <label>fade in <input class="se-smp-fade-in" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-in-lbl">0 ms</span></label>
          <label>fade out <input class="se-smp-fade-out" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-out-lbl">0 ms</span></label>
        </div>
      </div>
    </div>
    <div class="sq-se__actions">
      <button class="sq-se__close">done</button>
    </div>
  `;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  overlay.appendChild(el);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);

  const noteInput = el.querySelector(".se-note");
  const noteLbl = el.querySelector(".sq-se__note-label");
  const velInput = el.querySelector(".se-vel");
  const velLbl = el.querySelector(".sq-se__vel-label");
  const chordSel = el.querySelector(".se-chord");
  const chordLbl = el.querySelector(".sq-se__chord-label");
  const arpBox   = el.querySelector(".se-arp");
  const cpxInput = el.querySelector(".se-cpx");
  cpxInput.value = String(Math.max(0, Math.min(4, (t.complexities && t.complexities[idx]) || 0)));
  const offsetInput = el.querySelector(".se-offset");
  const offsetLbl = el.querySelector(".se-offset-label");
  const rebuildChords = () => {
    const root = Number(noteInput.value) || 60;
    const prev = chordSel.value || t.chords?.[idx] || "";
    const opts = [`<option value="">none</option>`];
    for (const key of Object.keys(CHORD_TYPES)) {
      if (!key) continue;
      if (!chordFitsScale(root, key)) continue;
      opts.push(`<option value="${key}">${key}</option>`);
    }
    chordSel.innerHTML = opts.join("");
    const stillThere = Array.from(chordSel.options).some(o => o.value === prev);
    if (stillThere) chordSel.value = prev;
    else {
      chordSel.value = "";
      if (t.chords) t.chords[idx] = "";
    }
  };
  rebuildChords();
  arpBox.checked = !!(t.arps && t.arps[idx]);
  const arpRow   = el.querySelector(".sq-se__arp-row");
  const arpRate  = el.querySelector(".se-arp-rate");
  const arpRange = el.querySelector(".se-arp-range");
  const arpDir   = el.querySelector(".se-arp-dir");
  arpRate.value  = String(t.arpRates?.[idx]  ?? 0.25);
  arpRange.value = String(t.arpRanges?.[idx] ?? 1);
  arpDir.value   = String(t.arpDirs?.[idx]   ?? "up");
  const arpWrap = el.querySelector(".sq-se__arp-wrap");
  const cpxRow  = el.querySelector(".sq-se__cpx-row");
  const ratchetRow = el.querySelector(".se-ratchet-row");
  const ratchetInput = el.querySelector(".se-ratchet");
  const ratchetLbl = el.querySelector(".se-ratchet-label");
  const syncChordOptsVisibility = () => {
    const hasChord = !!chordSel.value;
    if (arpWrap)     arpWrap.hidden = !hasChord;
    if (cpxRow)      cpxRow.hidden = !hasChord;
    if (chordLbl)    chordLbl.hidden = !hasChord;
    if (ratchetRow)  ratchetRow.hidden = hasChord;
  };
  ratchetInput.value = (t.ratchets && t.ratchets[idx]) || 1;
  ratchetLbl.textContent = `×${ratchetInput.value}`;
  ratchetInput.addEventListener("input", () => {
    if (!t.ratchets) t.ratchets = new Array(t.length).fill(1);
    const v = Math.max(1, Math.min(8, Math.round(Number(ratchetInput.value) || 1)));
    t.ratchets[idx] = v;
    ratchetLbl.textContent = `×${v}`;
  });
  const syncArpRowVisibility = () => { arpRow.hidden = !(chordSel.value && arpBox.checked); };
  syncChordOptsVisibility();
  syncArpRowVisibility();

  // Build Launchpad-style pad grid (bottom-left = lowest, top-right = highest).
  // Only 3 octaves are visible at a time — use the pager (oct +/−) to shift the window.
  // When a scale is active, only in-scale notes are shown and columns = scale length.
  const kb = el.querySelector(".sq-se__keyboard");
  const octDownBtn  = el.querySelector(".se-oct-down");
  const octUpBtn    = el.querySelector(".se-oct-up");
  const octRangeLbl = el.querySelector(".sq-se__oct-range");
  const scaleIntervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const PC_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  // Microtonal scales (Hüseyni, 24-TET) carry half-integer intervals; step the pad
  // by 0.5 semitones so quarter tones appear as clickable pads.
  const EPS = 1e-6;
  const scaleStep = scaleIntervals && scaleIntervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const VIEW_OCTS = 3;
  const MIN_OCT = 1, MAX_OCT = 6;
  const octaveOf = (m) => Math.floor(m / 12) - 1;
  let viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, octaveOf(defaultNote) - 1));
  const COLS = scaleIntervals ? scaleIntervals.length : 12;
  kb.style.gridTemplateColumns = `repeat(${COLS}, var(--se-pad-size))`;

  const renderPads = () => {
    kb.replaceChildren();
    const lo = 24 + (viewOctStart - 1) * 12;
    const hi = lo + VIEW_OCTS * 12;
    const visible = [];
    for (let m = lo; m < hi && m <= 95; m += scaleStep) {
      if (!scaleIntervals) { visible.push(m); continue; }
      const rel = ((m - state.scale.root) % 12 + 12) % 12;
      if (scaleIntervals.some(i => Math.abs(i - rel) < EPS)) visible.push(m);
    }
    const ROWS = Math.max(1, Math.ceil(visible.length / COLS));
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const basePc = ((Math.round(m) % 12) + 12) % 12;
      const isMicrotonal = m !== Math.round(m);
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "sq-se__pad";
      pad.dataset.note = String(m);
      if (scaleIntervals) {
        pad.classList.add("in-scale");
        if (!isMicrotonal && basePc === state.scale.root) pad.classList.add("is-root");
      }
      pad.title = midiToName(m);
      pad.textContent = isMicrotonal
        ? midiToName(m)
        : `${PC_NAMES[basePc]}${octaveOf(m)}`;
      pad.style.gridRow = String(ROWS - Math.floor(i / COLS));
      pad.style.gridColumn = String((i % COLS) + 1);
      kb.appendChild(pad);
    }
    // re-apply selected highlight if the current note is in view
    const cur = Number(noteInput.value);
    const active = kb.querySelector(`.sq-se__pad[data-note="${cur}"]`);
    if (active) active.classList.add("is-selected");
    if (octRangeLbl) octRangeLbl.textContent = `oct ${viewOctStart}–${viewOctStart + VIEW_OCTS - 1}`;
    if (octDownBtn) octDownBtn.disabled = viewOctStart <= MIN_OCT;
    if (octUpBtn)   octUpBtn.disabled   = viewOctStart + VIEW_OCTS - 1 >= MAX_OCT;
  };
  renderPads();
  if (octDownBtn) octDownBtn.addEventListener("click", () => {
    if (viewOctStart > MIN_OCT) { viewOctStart--; renderPads(); }
  });
  if (octUpBtn) octUpBtn.addEventListener("click", () => {
    if (viewOctStart + VIEW_OCTS - 1 < MAX_OCT) { viewOctStart++; renderPads(); }
  });
  const setNote = (v, { render = true } = {}) => {
    // Preserve fractional MIDI here — microtonal scales yield quarter-tone notes
    // that applyScale will snap to the nearest scale pitch.
    let n = Math.max(24, Math.min(95, Number(v)));
    n = applyScale(n);
    noteInput.value = String(n);
    t.notes[idx] = n;
    if (!t.isDrumKit) t.lastEditedNote = n;
    const nOct = octaveOf(n);
    if (nOct < viewOctStart || nOct > viewOctStart + VIEW_OCTS - 1) {
      viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, nOct - 1));
      renderPads();
    } else {
      kb.querySelectorAll(".sq-se__pad.is-selected").forEach(k => k.classList.remove("is-selected"));
      const active = kb.querySelector(`.sq-se__pad[data-note="${n}"]`);
      if (active) active.classList.add("is-selected");
    }
    rebuildChords();
    syncChordOptsVisibility();
    syncArpRowVisibility();
    if (render) { refresh(); renderStepGrid(t); }
  };
  kb.addEventListener("click", (e) => {
    const k = e.target.closest(".sq-se__pad");
    if (!k) return;
    setNote(Number(k.dataset.note));
  });

  const refresh = () => {
    const n = Number(noteInput.value);
    noteLbl.textContent = `${midiToName(n)} (${n})`;
    velLbl.textContent = Number(velInput.value).toFixed(2);
    const ch = chordSel.value;
    let chordLbls = "single";
    if (ch) {
      const base = chordNotes(Number(noteInput.value), ch);
      const cpx = Math.max(0, Math.min(base.length - 1, Number(cpxInput.value) || 0));
      const voiced = invertChord(base, cpx);
      chordLbls = (arpBox.checked ? "arp: " : "") + voiced.map(midiToName).join(arpBox.checked ? " → " : " · ");
    }
    chordLbl.textContent = chordLbls;
    const off = Number(offsetInput.value);
    offsetLbl.textContent = `${off >= 0 ? "+" : ""}${off.toFixed(2)}`;
    arpBox.disabled = !ch;
    cpxInput.disabled = !ch;
    const cur = Number(noteInput.value);
    kb.querySelectorAll(".sq-se__pad.is-selected").forEach(k => k.classList.remove("is-selected"));
    const sel = kb.querySelector(`.sq-se__pad[data-note="${cur}"]`);
    if (sel) sel.classList.add("is-selected");
  };
  refresh();

  offsetInput.addEventListener("input", () => {
    if (!t.offsets) t.offsets = new Array(t.length).fill(0);
    t.offsets[idx] = Number(offsetInput.value);
    refresh();
  });

  // Sample region / fades / loop / slicing now live in the one track-level
  // "sample" modal (openSampleEditorModal), not per-step — so the step editor's
  // sample row is always hidden.
  const sampleRow = el.querySelector(".sq-se__sample-row");
  if (sampleRow) sampleRow.hidden = true;

  velInput.addEventListener("input", () => {
    t.velocities[idx] = Number(velInput.value);
    refresh();
    const cell = t.el.querySelector(`.sq-step[data-idx="${idx}"]`);
    if (cell) cell.style.setProperty("--vel", String(t.velocities[idx]));
  });
  chordSel.addEventListener("change", () => {
    t.chords[idx] = chordSel.value;
    refresh();
    renderStepGrid(t);
  });
  arpBox.addEventListener("change", () => {
    if (!t.arps) t.arps = new Array(t.length).fill(false);
    t.arps[idx] = arpBox.checked;
    syncArpRowVisibility();
    refresh();
  });
  chordSel.addEventListener("change", () => {
    // clearing the chord also clears arp state so it doesn't "ghost" between chord selections
    if (!chordSel.value) {
      arpBox.checked = false;
      if (!t.arps) t.arps = new Array(t.length).fill(false);
      t.arps[idx] = false;
    }
    syncChordOptsVisibility();
    syncArpRowVisibility();
  });
  arpRate.addEventListener("change",  () => { if (!t.arpRates)  t.arpRates  = new Array(t.length).fill(0.25); t.arpRates[idx]  = Number(arpRate.value); });
  arpRange.addEventListener("change", () => { if (!t.arpRanges) t.arpRanges = new Array(t.length).fill(1);    t.arpRanges[idx] = Number(arpRange.value); });
  arpDir.addEventListener("change",   () => { if (!t.arpDirs)   t.arpDirs   = new Array(t.length).fill("up"); t.arpDirs[idx]   = arpDir.value; });
  cpxInput.addEventListener("input", () => {
    if (!t.complexities) t.complexities = new Array(t.length).fill(0);
    t.complexities[idx] = Math.max(0, Math.min(4, Number(cpxInput.value) || 0));
    refresh();
  });
  el.querySelector(".sq-se__close").addEventListener("click", closeStepEditor);

  const escHandler = (e) => { if (e.key === "Escape") closeStepEditor(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStepEditor(); });
  document.addEventListener("keydown", escHandler);
  stepEditor = { overlay, el, escHandler };
}

