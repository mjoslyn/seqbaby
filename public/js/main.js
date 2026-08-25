import { installAppApi } from "./appApi.js";
import { buildBeatIndicator, paintBeatIndicator } from "./beat.js";
import { bounceAudio, showBounceDialog } from "./bounce.js";
import { loadBuffer, normalizeAudioBuffer } from "./buffers.js";
import { BUNDLED_SAMPLES, GRANULAR_SAMPLES, GRANULAR_SAMPLE_BASE, GRANULAR_SAMPLE_CREDIT, SAMPLE_BASE, rebuildEngineCatalog } from "./catalog.js";
import { LFO_KEYS, PATTERN_COUNT } from "./constants.js";
import { isMobileDevice, setStatus } from "./dom.js";
import { HELP_TIPS, ICON_BOUNCE, ICON_CAPTURE, ICON_CHAIN, ICON_FINISH, ICON_KEYBOARD, ICON_METRONOME, ICON_NOW, ICON_REC, ICON_REPEAT } from "./icons.js";
import { upgradeKnobs } from "./knob.js";
import { openMacroPads } from "./macro.js";
import { applySampleSpeed, attachBpmDrag, lfoRateLabel, retuneSyncedLFOs } from "./lfo.js";
import { captureSequence, initComputerKeyboard, isDesktopKeyboard, resetKbdKeys, syncKbdArpUI } from "./keyboard.js";
import { autoAccents, parseMeter, redetectDrumKit, stepsPerBarForMeter } from "./meter.js";
import { meterTick } from "./meters.js";
import { setEngineKey } from "./params.js";
import { installParamContextMenu } from "./paramMenu.js";
import { copyPattern, openPatternMenu, renderPatternGrid } from "./patternBar.js";
import { setActiveTrack } from "./render.js";
import { initScaleUI } from "./scaleUI.js";
import { loadShareFromUrl, onExportSet, onImportSet, onLoadSet, onSaveSet, onShareSet } from "./session.js";
import { state, switchPattern } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { createTrack, resizePattern } from "./track.js";
import { ensureAudio, loadWorklet, togglePlay } from "./transport.js";

export function showAudioGateDialog() {
  if (!state.audioCtx) return;
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
  if (!isTouch) return;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay sq-audio__gate-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-audio__gate-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="sq-audio__gate-title">tap to enable audio</div>
    <div class="sq-audio__gate-hint" aria-live="polite"></div>
    <button class="sq-audio__gate-btn" type="button">enable audio</button>
    <div class="sq-audio__gate-status"></div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const hintEl = modal.querySelector(".sq-audio__gate-hint");
  let tipIdx = Math.floor(Math.random() * HELP_TIPS.length);
  hintEl.textContent = HELP_TIPS[tipIdx];
  const tipTimer = setInterval(() => {
    tipIdx = (tipIdx + 1) % HELP_TIPS.length;
    hintEl.style.opacity = "0";
    setTimeout(() => {
      hintEl.textContent = HELP_TIPS[tipIdx];
      hintEl.style.opacity = "";
    }, 180);
  }, 3200);
  const btn = modal.querySelector(".sq-audio__gate-btn");
  const statusEl = modal.querySelector(".sq-audio__gate-status");
  btn.addEventListener("click", async () => {
    primeAudioForIOS();
    btn.disabled = true;
    statusEl.textContent = `unlocking… (ctx: ${state.audioCtx?.state || "?"})`;
    try {
      await ensureAudio();
    } catch (err) {
      statusEl.textContent = `failed: ${err?.message || err}`;
      btn.disabled = false;
      btn.textContent = "try again";
      return;
    }
    statusEl.textContent = `ready (ctx: ${state.audioCtx?.state || "?"})`;
    clearInterval(tipTimer);
    overlay.remove();
    setStatus(`audio ready (ctx: ${state.audioCtx?.state || "?"})`);
  });
}

// Build a 1-second silent WAV (8 kHz mono 8-bit unsigned PCM) and attach it to
// the iOS audio unlock element. The element has loop=true so once it's playing
// it keeps the iOS audio session in "playback" mode indefinitely. The HTML
// previously inlined a 44-byte WAV with zero sample data, which makes play()
// resolve immediately and lets the session deactivate — symptom: ctx.state
// stays "running" but no audio is emitted until a tab switch forces iOS to
// re-engage the session.
export function initSilentAudioLoop() {
  const el = document.getElementById("ios-audio-unlock");
  if (!el) return;
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buf = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buf);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + numSamples, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits/sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, numSamples, true);
  new Uint8Array(buf, 44).fill(0x80); // 0x80 = silence for unsigned 8-bit PCM
  try { el.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); } catch {}
}

// iOS Safari parks the AudioContext in a non-standard "interrupted" state
// (not "suspended") when the tab is backgrounded, the screen locks, or a
// call/Siri/another app takes the audio session. Any strict === "suspended"
// check misses it, so no recovery path ever fires and the app stays silent
// until reload. Use this everywhere a resume decision is made.
export function needsResume(ctx) {
  return !!ctx && (ctx.state === "suspended" || ctx.state === "interrupted");
}

export function primeAudioForIOS() {
  const ctx = state.audioCtx;
  if (!ctx) return;
  if (needsResume(ctx)) {
    try { ctx.resume(); } catch {}
  }
  // Silent buffer through destination — token "something played" signal.
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
  // Real (but inaudible) oscillator briefly. iOS's audio renderer sometimes
  // refuses to fully engage from a silent BufferSource alone — Safari only
  // starts pumping the worklet graph once a real signal-producing node has
  // run through ctx.destination. Volume is at -120 dB and the pulse is 30 ms,
  // so it's effectively inaudible but it kicks the audio pipeline awake.
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    osc.frequency.value = 440;
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.03);
  } catch {}
  // Always (re-)play inside the gesture. With loop=true the element should
  // stay playing indefinitely, but if iOS ever pauses it (background tab,
  // low-power mode, route change) the next gesture will re-engage the
  // playback session. play() on an already-playing element is a no-op.
  const el = document.getElementById("ios-audio-unlock");
  if (el && el.paused) {
    try {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }
}

// Recovery when the tab becomes visible again (visibilitychange/pageshow).
// Three iOS failure modes on return from background:
//  1. state "suspended" — a plain resume() works.
//  2. state "interrupted" — resume() sometimes works without a gesture; when
//     it's rejected, the permanent gesture unlock listener picks it up on the
//     next tap.
//  3. state "running" but the renderer isn't actually pumping (audio session
//     lost while backgrounded) — detectable as a frozen currentTime; a
//     suspend+resume cycle re-engages the session. Touch devices only: on
//     desktop Chrome a resume() outside user activation can be silently
//     rejected, and the suspend would then leave a previously-working
//     context dead (same reasoning as the kick in ensureAudio).
let _recoveringAudio = false;
async function recoverAudioAfterReturn() {
  const ctx = state.audioCtx;
  if (!ctx || ctx.state === "closed" || _recoveringAudio) return;
  _recoveringAudio = true;
  try {
    if (needsResume(ctx)) {
      try { await ctx.resume(); } catch {}
    }
    if (ctx.state !== "running") return; // gesture unlock will handle it
    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
    if (!isTouch) return;
    const t0 = ctx.currentTime;
    await new Promise((r) => setTimeout(r, 250));
    if (document.visibilityState !== "visible" || ctx.state !== "running") return;
    if (ctx.currentTime > t0) return; // renderer is healthy
    try {
      await ctx.suspend();
      await ctx.resume();
    } catch {}
  } finally {
    _recoveringAudio = false;
  }
}

export async function pickAudioFileForTrack(t, targetEngine = "sampler") {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac";
    inp.style.display = "none";
    document.body.appendChild(inp);
    let resolved = false;
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      inp.remove();
      if (!file) { if (!resolved) resolve(false); resolved = true; return; }
      try {
        setStatus(`loading "${file.name}"...`);
        const arrayBuf = await file.arrayBuffer();
        await ensureAudio();
        // decodeAudioData mutates the buffer, so keep a copy for persistence
        const persistBytes = arrayBufferToBase64(arrayBuf.slice(0));
        const audioBuf = normalizeAudioBuffer(await state.audioCtx.decodeAudioData(arrayBuf));
        t.uploadBuffer = audioBuf;
        t.uploadAudio = persistBytes;
        t.uploadAudioMime = file.type || "audio/wav";
        t.uploadFileName = file.name;
        t.soundPromptText = file.name;
        if (targetEngine === "sampler") t.sampleSource = { kind: "upload", name: file.name };
        // Push the decoded buffer to the matching live voice if we're already on
        // the target engine; otherwise switch to it (which rebuilds the voice and
        // picks up the freshly-set uploadBuffer). Both the sampler and the granular
        // engine read from track.uploadBuffer.
        const targetType = targetEngine === "dm:granular" ? "granular" : "sampler";
        if (t.engineKey === targetEngine && t.voice?.type === targetType) {
          t.voice.setBuffer(audioBuf);
        } else {
          setEngineKey(t, targetEngine);
          if (t.el) t.el.querySelector(".sq-track__engine").value = targetEngine;
        }
        // Root note tracks the sample's natural-playback octave: C2 for drum-kit
        // samples, C4 otherwise. New notes on an empty grid anchor to this root
        // (via lastUsedNote), so clear the stale last-edited pitch on load.
        if (targetEngine === "sampler") { redetectDrumKit(t); t.sliceBase = t.isDrumKit ? 36 : 60; t.lastEditedNote = null; }
        applySampleSpeed(t);
        setStatus(`"${t.name}" ← ${file.name} (${Math.round(audioBuf.duration * 1000)}ms)`);
        resolve(true);
      } catch (err) {
        console.error(err);
        setStatus(`failed to load "${file.name}"`, true);
        resolve(false);
      }
    }, { once: true });
    // if user cancels the picker there's no "cancel" event; fall back to a short timeout
    window.addEventListener("focus", () => {
      setTimeout(() => { if (!resolved && !inp.files?.length) { resolved = true; inp.remove(); resolve(false); } }, 300);
    }, { once: true });
    inp.click();
  });
}

// Sampler source picker: choose "load file…" or one of the bundled samples.
// Resolves true if a source was chosen (and the track switched to the sampler),
// false if the user dismissed it. Mirrors pickAudioFileForTrack's commit/cancel
// contract so the engine dropdown can revert on cancel.
export function openSamplerSourceModal(t) {
  return new Promise(resolve => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; overlay.remove(); document.removeEventListener("keydown", esc); resolve(ok); };
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sq-modal sq-sampler__src-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="sq-modal__title">sampler source</div>
      <button type="button" class="sq-sampler__src-file sq-btn">load file…</button>
      <div class="sq-sampler__src-sep">or a bundled sample</div>
      <div class="sq-sampler__src-list"></div>
      <div class="sq-modal__actions"><button type="button" class="sq-sampler__src-cancel sq-btn--ghost">cancel</button></div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const chooseBundled = async (id, label) => {
      t.sampleSource = { kind: "bundled", id, name: label };
      t.uploadBuffer = null; t.uploadAudio = null; t.uploadFileName = label;
      const already = t.engineKey === "sampler";
      if (already) {
        if (t.voice?.type === "sampler") { t.voice.buffer = null; t.voice.loadBundled?.(id); }
      } else {
        setEngineKey(t, "sampler");
        if (t.el) t.el.querySelector(".sq-track__engine").value = "sampler";
      }
      redetectDrumKit(t);
      t.sliceBase = t.isDrumKit ? 36 : 60;   // root note matches the sample octave
      t.lastEditedNote = null;               // new grid notes anchor to that root
      try {
        await ensureAudio();
        const buf = await loadBuffer(state.audioCtx, `${SAMPLE_BASE}/${id}.mp3`);
        t.uploadBuffer = buf;
        if (t.voice?.type === "sampler") t.voice.setBuffer(buf);
        applySampleSpeed(t);
      } catch (e) { console.warn("bundled sample load", e); }
      setStatus(`"${t.name}" ← ${label}`);
      finish(true);
    };

    const list = modal.querySelector(".sq-sampler__src-list");
    for (const s of BUNDLED_SAMPLES) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sq-sampler__src-item sq-btn--ghost"; b.textContent = s.label;
      b.addEventListener("click", () => chooseBundled(s.id, s.label));
      list.appendChild(b);
    }
    modal.querySelector(".sq-sampler__src-file").addEventListener("click", async () => {
      // hand off to the file picker; keep this modal's promise tied to its result
      const ok = await pickAudioFileForTrack(t, "sampler");
      finish(ok);
    });
    modal.querySelector(".sq-sampler__src-cancel").addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
    const esc = (e) => { if (e.key === "Escape") finish(false); };
    document.addEventListener("keydown", esc);
  });
}

// Source picker for the granular engine: the bundled texture library or your own
// file. Same commit/cancel contract as openSamplerSourceModal so the engine
// dropdown can revert when it's dismissed.
export function openGranularSourceModal(t) {
  return new Promise(resolve => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; overlay.remove(); document.removeEventListener("keydown", esc); resolve(ok); };
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sq-modal sq-sampler__src-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const c = GRANULAR_SAMPLE_CREDIT;
    modal.innerHTML = `
      <div class="sq-modal__title">granular source</div>
      <button type="button" class="sq-sampler__src-file sq-btn">load file…</button>
      <div class="sq-sampler__src-sep">or a texture to granulate</div>
      <div class="sq-sampler__src-list"></div>
      <div class="sq-modal__credit">textures from <a href="${c.url}" target="_blank" rel="noopener">${c.title}</a> by ${c.author} (${c.license})</div>
      <div class="sq-modal__actions"><button type="button" class="sq-sampler__src-cancel sq-btn--ghost">cancel</button></div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const chooseTexture = async (id, label) => {
      const already = t.engineKey === "dm:granular";
      t.uploadAudio = null;                 // streamed, not persisted as base64
      t.uploadFileName = label;
      t.soundPromptText = label;
      t.granularSample = { id, label };     // remembered so a reload restores it
      if (!already) {
        setEngineKey(t, "dm:granular");
        if (t.el) t.el.querySelector(".sq-track__engine").value = "dm:granular";
      }
      setStatus(`loading "${label}"…`);
      try {
        await ensureAudio();
        const buf = await loadBuffer(state.audioCtx, `${GRANULAR_SAMPLE_BASE}/${id}.wav`);
        t.uploadBuffer = buf;
        if (t.voice?.type === "granular") t.voice.setBuffer(buf);
        setStatus(`"${t.name}" ← ${label} (${Math.round(buf.duration * 1000)}ms)`);
      } catch (e) {
        console.warn("granular texture load", e);
        setStatus(`failed to load "${label}"`, true);
      }
      finish(true);
    };

    const list = modal.querySelector(".sq-sampler__src-list");
    for (const s of GRANULAR_SAMPLES) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sq-sampler__src-item sq-btn--ghost"; b.textContent = s.label;
      b.addEventListener("click", () => chooseTexture(s.id, s.label));
      list.appendChild(b);
    }
    modal.querySelector(".sq-sampler__src-file").addEventListener("click", async () => {
      const ok = await pickAudioFileForTrack(t, "dm:granular");
      finish(ok);
    });
    modal.querySelector(".sq-sampler__src-cancel").addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
    const esc = (e) => { if (e.key === "Escape") finish(false); };
    document.addEventListener("keydown", esc);
  });
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---- scale UI ----------------------------------------------------------

// Firefox still hasn't implemented the AudioListener position/orientation
// AudioParams (positionX…upZ are undefined — bugzilla #1283029). Tone v15
// dropped the standardized-audio-context polyfill that used to paper over
// this, so its Listener wraps those undefineds in Tone.Param during the lazy
// context init and the "param must be an AudioParam" assert throws. That
// poisons Tone.getDestination()/getListener() for the whole session: every
// Tone-based voice and FX rack build fails, and the transport runs without
// producing sound (keyboard-played Plaits voices still work — they never
// touch Tone). Stand in real AudioParams borrowed from dangling
// ConstantSourceNodes (never started or connected, so they're inert and
// cost nothing). seqbaby does no 3D spatialization, so the values are moot.
function shimFirefoxListenerParams(ctx) {
  const l = ctx.listener;
  if (!l || l.positionX) return;
  const defaults = {
    positionX: 0, positionY: 0, positionZ: 0,
    forwardX: 0, forwardY: 0, forwardZ: -1,
    upX: 0, upY: 1, upZ: 0,
  };
  for (const [key, dv] of Object.entries(defaults)) {
    try {
      const src = ctx.createConstantSource();
      src.offset.value = dv;
      Object.defineProperty(l, key, { value: src.offset, configurable: true });
    } catch (e) { console.warn("listener param shim failed for", key, e); }
  }
}

export function init() {
  // The engine's code is all here — tell the preloader it's past downloading
  // and into building the studio. Guarded: nothing in the engine requires the
  // preloader to exist (the legacy static server serves no overlay at all).
  try { window.__sqPreload?.step("engine"); } catch {}
  // Create the AudioContext and bind Tone to it BEFORE anything reads
  // Tone.Transport. Tone.Transport's internal Clock latches onto the context's
  // time at first access; if we defer this to the play-click handler, Tone's
  // default context has already been ticking for several seconds and the clock
  // stays anchored there, so Transport.start("+0.1") resolves to "default-ctx
  // time + 0.1", which is several seconds in the future against our fresh
  // AudioContext. Diagnostics confirmed: drift == time from page load to click.
  // Creating the context here is fine — it starts suspended and Tone.start()
  // resumes it inside the user gesture.
  // "interactive" asks for the smallest render buffer the device supports,
  // which leaves no headroom on phones — one long render quantum and the
  // output crackles. Pattern playback is scheduled ahead of time, so mobile
  // can afford "playback" (larger buffer); Chrome's ctx.outputLatency feeds
  // visualOutputLatency() so the playhead stays aligned with the ear.
  state.audioCtx = new AudioContext({ latencyHint: isMobileDevice() ? "playback" : "interactive" });
  shimFirefoxListenerParams(state.audioCtx);
  Tone.setContext(state.audioCtx);
  // Widen the transport's scheduler lookahead. Tone's clock ticks on the main
  // thread; when that thread stalls (layout, GC, a heavy pattern switch — all
  // worse on mobile), callbacks fire late and every note they schedule gets
  // clamped to "now" by the Math.max guard in the transport loop. That clamp
  // both drags the groove off the grid ("falls out of time") and piles the
  // delayed hits onto one instant (amplitude spike → clipping). A larger
  // lookahead schedules events far enough ahead that a brief stall is absorbed
  // before it can reach the audio clock. Latency is irrelevant for pattern
  // playback, so we can afford a generous window — more so on mobile.
  try {
    const ctxWrap = Tone.getContext();
    // Safari's main-thread timers fire late more often than Chrome's, which
    // pushes scheduled hits into the Math.max "now" clamp in the transport
    // loop (audio lands late relative to the beat). Give it the same wider
    // window as mobile; latency is irrelevant for pattern playback.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    ctxWrap.lookAhead = (isMobileDevice() || isSafari) ? 0.25 : 0.15;
  } catch (e) { console.warn("lookAhead tune failed", e); }
  // Track when the output pipeline first actually starts running, and pin it
  // open. Two jobs:
  //  1. `_outputRunningSince` lets togglePlay size the transport lead — on a
  //     cold start macOS drops the first fraction of a second of DAC output
  //     while the device spins up (clock advances, no sound), so a
  //     freshly-started output needs a longer lead than a warm one.
  //  2. A session-long silent ConstantSource keep-alive (offset 0 = pure DC,
  //     inaudible) holds the render graph and output device engaged between
  //     plays, so only the very first start can ever be cold.
  state.audioCtx.addEventListener("statechange", () => {
    if (state.audioCtx.state !== "running") return;
    if (!state._outputRunningSince) state._outputRunningSince = performance.now();
    if (!state._keepAlive) {
      try {
        const ka = state.audioCtx.createConstantSource();
        ka.offset.value = 0;
        ka.connect(state.audioCtx.destination);
        ka.start();
        state._keepAlive = ka;
      } catch (e) { console.warn("keep-alive init failed", e); }
    }
  });
  // Resume/unlock on the first gesture of ANY kind, not just the play button —
  // a session usually taps steps, drags sliders, or presses note keys first.
  // Autoplay policy requires the resume to originate inside a real gesture;
  // doing it on the earliest one also warms the output device seconds before
  // play is hit, so the play click starts against an already-running pipeline.
  // Kept installed permanently: it's a cheap no-op while running and quietly
  // recovers whenever the browser re-suspends the context.
  const unlockAudio = () => {
    // Also re-prime when the silent unlock <audio> element has been paused —
    // iOS pauses media elements on background, which demotes the audio
    // session; the context can then read "running" while nothing is actually
    // rendered. Replaying the element (inside this gesture) re-engages it.
    const el = document.getElementById("ios-audio-unlock");
    if (needsResume(state.audioCtx) || (el && el.paused)) primeAudioForIOS();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  }
  // Warm the Plaits worklet/WASM fetch+compile off the play path (addModule
  // works fine on a suspended context). By play time this is usually resolved,
  // so ensureAudio's await is instant instead of a network+compile stall
  // between the click and Transport.start.
  loadWorklet().catch(() => {});
  initSilentAudioLoop();
  rebuildEngineCatalog();
  requestAnimationFrame(meterTick);

  document.getElementById("play").addEventListener("click", togglePlay);
  buildBeatIndicator();
  paintBeatIndicator(1);
  const metroBtn = document.getElementById("metronome");
  if (metroBtn) {
    metroBtn.innerHTML = ICON_METRONOME;
    metroBtn.addEventListener("click", () => {
      state.metronome = !state.metronome;
      metroBtn.setAttribute("aria-pressed", String(state.metronome));
    });
  }
  const runBounce = async (btnId, mode) => {
    const opts = await showBounceDialog({ mode });
    if (!opts) return;
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "rendering…";
    setStatus(`rendering ${opts.bars} bar${opts.bars === 1 ? "" : "s"} to ${opts.format}…`);
    try {
      await bounceAudio({
        bars: opts.bars,
        format: opts.format,
        chainWhole: mode === "track",
        fileStem: mode === "track" ? "session" : "pattern",
        filename: opts.filename,
      });
      setStatus(`render ready — downloaded`);
    } catch (err) {
      console.error(err);
      setStatus(`render failed — see console`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
  document.getElementById("bounce-audio")?.addEventListener("click", () => runBounce("bounce-audio", "pattern"));
  document.getElementById("bounce-track")?.addEventListener("click", () => runBounce("bounce-track", "track"));
  for (const btn of document.querySelectorAll(".sq-dl__btn .sq-dl__icon")) btn.innerHTML = ICON_BOUNCE;
  document.getElementById("bpm").addEventListener("input", e => {
    if (state.ready) Tone.Transport.bpm.value = Number(e.target.value);
    retuneSyncedLFOs();
    for (const t of state.tracks) {
      if (t.fxRack && t.fxConfig.delay.sync) t.fxRack.applyDelay({});
      applySampleSpeed(t);
    }
    // A synced mod's length is quoted in hz off the tempo, so the reading beside
    // every open row is stale the moment the tempo moves. lfoRateLabel is the
    // one place that sentence is written (buildLfoRow draws the same text).
    for (const t of state.tracks) {
      for (const key of LFO_KEYS) {
        if (!t.lfoConfig[key].sync) continue;
        const row = t.el.querySelector(`.sq-lfo__row[data-key="${key}"]`);
        const lbl = row?.querySelector(".sq-lfo__rate-label");
        if (lbl) lbl.textContent = lfoRateLabel(t.lfoConfig[key]);
      }
    }
  });
  // Vertical drag on the BPM field — on mobile there's no spinner and tapping
  // a number input only opens the numeric keypad, so let users drag up/down to
  // scrub the value. A clean tap still focuses the input to type a value.
  attachBpmDrag(document.getElementById("bpm"));
  // Right-click any parameter control → its mods + automation lanes. One
  // delegated listener covers every track, now and after any rebuild.
  installParamContextMenu();
  // Everything outside a track — the transport's swing, mainly. Tracks upgrade
  // their own subtree in renderTrack and the modals theirs as they build, so
  // this only has to cover what was in the document from the start.
  upgradeKnobs(document);
  document.getElementById("macro-pads")?.addEventListener("click", openMacroPads);
  // The master swing slider has no listener on purpose: the transport loop reads
  // its value straight off the DOM each callback (~0.1 µs), so there's nothing to
  // mirror into state and nothing to do when it moves.
  document.getElementById("add-track").addEventListener("click", () => {
    createTrack({ name: `track ${state.tracks.length + 1}`, engineKey: "plaits:0" });
  });

  // The fx bus is reachable from the engine dropdown like everything else, but
  // it isn't an instrument and nobody goes looking for it there.
  document.getElementById("add-bus")?.addEventListener("click", () => {
    const n = state.tracks.filter(t => t.engineKey === "bus").length + 1;
    createTrack({ name: n === 1 ? "bus" : `bus ${n}`, engineKey: "bus" });
  });

  // Computer keyboard → notes. On desktop it's always active — letter keys play
  // the active track's voice unless a text field is focused (see keyboard.js).
  // Skipped on mobile: no physical keyboard, and the kbd controls are hidden by
  // CSS below 768px.
  const kbdIcon = document.getElementById("kbd-icon");
  if (kbdIcon) kbdIcon.innerHTML = ICON_KEYBOARD;
  const kbdChordPanel = document.getElementById("kbd-chord");
  const kbdCaptureBtn = document.getElementById("kbd-capture");
  if (kbdCaptureBtn) kbdCaptureBtn.innerHTML = ICON_CAPTURE;
  if (isDesktopKeyboard()) {
    initComputerKeyboard();
    if (kbdChordPanel) kbdChordPanel.hidden = false;
    if (kbdCaptureBtn) kbdCaptureBtn.disabled = false;
    document.body.classList.add("kbd-notes-on");
    if (state.activeTrackId == null && state.tracks[0]) setActiveTrack(state.tracks[0]);
  }
  if (kbdCaptureBtn) kbdCaptureBtn.addEventListener("click", () => {
    const res = captureSequence();
    setStatus(res.msg, !res.ok);
  });
  const chordTypeSel = document.getElementById("kbd-chord-type");
  if (chordTypeSel) { chordTypeSel.value = state.kbdChordType; chordTypeSel.addEventListener("change", () => { state.kbdChordType = chordTypeSel.value; syncKbdArpUI(); }); }
  const chordCpxSel = document.getElementById("kbd-chord-cpx");
  if (chordCpxSel) { chordCpxSel.value = String(state.kbdChordCpx); chordCpxSel.addEventListener("change", () => { state.kbdChordCpx = Math.max(0, Math.min(4, Number(chordCpxSel.value) || 0)); }); }
  // Arp settings for keyboard chords — the group only appears in chord mode.
  const arpOnBox   = document.getElementById("kbd-arp-on");
  const arpRateSel = document.getElementById("kbd-arp-rate");
  const arpRngSel  = document.getElementById("kbd-arp-range");
  const arpDirSel  = document.getElementById("kbd-arp-dir");
  if (arpOnBox) { arpOnBox.checked = !!state.kbdArp; arpOnBox.addEventListener("change", () => { state.kbdArp = arpOnBox.checked; syncKbdArpUI(); }); }
  if (arpRateSel) { arpRateSel.value = String(state.kbdArpRate); arpRateSel.addEventListener("change", () => { state.kbdArpRate = Number(arpRateSel.value) || 0.25; }); }
  if (arpRngSel)  { arpRngSel.value  = String(state.kbdArpRange); arpRngSel.addEventListener("change", () => { state.kbdArpRange = Number(arpRngSel.value) || 1; }); }
  if (arpDirSel)  { arpDirSel.value  = String(state.kbdArpDir); arpDirSel.addEventListener("change", () => { state.kbdArpDir = arpDirSel.value || "up"; }); }
  syncKbdArpUI();

  // Record computer-keyboard notes into the active track (while the transport plays).
  const recBtn = document.getElementById("kbd-record");
  if (recBtn) { recBtn.innerHTML = ICON_REC; recBtn.disabled = !isDesktopKeyboard(); }
  const setKbdRecord = (on) => {
    state.kbdRecord = on;
    if (recBtn) recBtn.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("kbd-recording", on);
  };
  if (recBtn) recBtn.addEventListener("click", () => {
    if (!state.kbdRecord) {
      if (state.activeTrackId == null && state.tracks[0]) setActiveTrack(state.tracks[0]);
      setKbdRecord(true);
      setStatus("recording keyboard → active track — notes land on the current step. click a track to target it.");
      if (!state.playing) togglePlay();   // roll the transport so notes get captured
    } else {
      setKbdRecord(false);
      setStatus("keyboard recording off");
    }
  });

  const modeBtn = document.getElementById("pattern-mode");
  const syncModeLabel = () => {
    modeBtn.innerHTML = state.patternMode === "chain" ? ICON_CHAIN : ICON_REPEAT;
    modeBtn.title = state.patternMode === "chain"
      ? "chain: advance through non-empty patterns (click to switch to repeat)"
      : "repeat: loop current pattern (click to switch to chain)";
    modeBtn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
  };
  syncModeLabel();
  modeBtn.addEventListener("click", () => {
    state.patternMode = state.patternMode === "chain" ? "repeat" : "chain";
    syncModeLabel();
  });
  const switchBtn = document.getElementById("pattern-switch");
  if (switchBtn) {
    const syncSwitchLabel = () => {
      switchBtn.innerHTML = state.patternSwitchMode === "finish" ? ICON_FINISH : ICON_NOW;
      switchBtn.title = state.patternSwitchMode === "finish"
        ? "switch: finish — wait for the current bar to end before switching"
        : "switch: now — switch patterns immediately";
      switchBtn.setAttribute("aria-pressed", String(state.patternSwitchMode === "finish"));
    };
    syncSwitchLabel();
    switchBtn.addEventListener("click", () => {
      state.patternSwitchMode = state.patternSwitchMode === "finish" ? "immediate" : "finish";
      syncSwitchLabel();
      // Flipping back to immediate commits any currently queued switch right away.
      if (state.patternSwitchMode === "immediate" && state.queuedPattern !== null) {
        switchPattern(state.queuedPattern);
      }
    });
  }
  // These session buttons moved to the top account bar; guard in case they're
  // absent from the markup.
  document.getElementById("set-save")?.addEventListener("click", onSaveSet);
  document.getElementById("set-load")?.addEventListener("click", onLoadSet);
  document.getElementById("set-export")?.addEventListener("click", onExportSet);
  document.getElementById("set-import")?.addEventListener("click", onImportSet);
  document.getElementById("set-share")?.addEventListener("click", onShareSet);
  document.getElementById("pattern-menu-btn")?.addEventListener("click", openPatternMenu);
  document.getElementById("pattern-dup").addEventListener("click", () => {
    const next = (state.activePattern + 1) % PATTERN_COUNT;
    copyPattern(state.activePattern, next);
    switchPattern(next);
  });
  document.getElementById("pattern-repeats").addEventListener("change", e => {
    const v = Math.max(1, Math.min(16, Number(e.target.value) || 1));
    e.target.value = v;
    state.patternRepeats[state.activePattern] = v;
  });
  const meterSel = document.getElementById("pattern-meter");
  if (meterSel) {
    meterSel.addEventListener("change", () => {
      const m = parseMeter(meterSel.value);
      if (!m) return;
      const patIdx = state.activePattern;
      const prev = state.patternMeters[patIdx] || { num: 4, den: 4 };
      state.patternMeters[patIdx] = m;
      if (patIdx === 0) {
        // Pattern 1 is the source: sync the meter (only) into every slot that
        // hasn't been explicitly customized. Their step counts stay put.
        for (let i = 1; i < PATTERN_COUNT; i++) {
          if (!state.patternMeterCustomized[i]) state.patternMeters[i] = { num: m.num, den: m.den };
        }
      } else {
        // User set a non-#1 pattern's meter explicitly — lock it off from #1.
        state.patternMeterCustomized[patIdx] = true;
      }
      // Resize every track on the active pattern to preserve its bar count under
      // the new meter (e.g. 1 bar of 4/4 = 16 steps → 1 bar of 7/8 = 14). Tracks
      // that already match just get their accents + step grid refreshed.
      const oldSpb = stepsPerBarForMeter(prev);
      const newSpb = stepsPerBarForMeter(m);
      for (const t of state.tracks) {
        const bars = Math.max(1, Math.round((t.length || newSpb) / oldSpb));
        const newLen = Math.max(1, Math.min(128, bars * newSpb));
        if (newLen !== t.length) {
          resizePattern(t, patIdx, newLen);
        } else {
          t.accents = autoAccents(t.length, m);
          renderStepGrid(t);
        }
      }
      paintBeatIndicator(state.tick);
    });
  }
  renderPatternGrid();

  initScaleUI();

  // starter kit
  createTrack({ name: "kick",   engineKey: "dm:808-kick" });
  createTrack({ name: "snare",  engineKey: "dm:808-snare" });
  createTrack({ name: "hat",    engineKey: "dm:909-chat" });
  createTrack({ name: "accent", engineKey: "plaits:12" });
  createTrack({ name: "bass",   engineKey: "dm:303" });
  createTrack({ name: "lead",   engineKey: "plaits:0" });

  setStatus("ready");
  // Expose the engine API on window.seqbaby for the Next.js shell.
  installAppApi();
  // if the URL carries ?s=<id>, pull that shared session
  loadShareFromUrl();
  // Close the AudioContext on page hide. Chrome reuses its audio process across
  // tab reloads; a leaked AudioContext from the previous page leaves the worklet
  // graph and clock in a degraded state, which surfaces as "first play is delayed
  // and out of sync after a refresh — only a full browser restart clears it".
  // Only close on a real unload. When the page goes into the back/forward
  // cache instead (e.persisted — common on iOS Safari), it comes back with all
  // JS state intact; closing the context here would restore the page around a
  // permanently-dead "closed" AudioContext that no resume() can revive, so the
  // app looks fine but never makes sound again until a manual reload.
  window.addEventListener("pagehide", (e) => {
    try { Tone.Transport.stop(); } catch {}
    if (!e.persisted) { try { state.audioCtx?.close(); } catch {} }
  });
  // Visibility resume: iOS often suspends or "interrupts" the audio context
  // (or just stops rendering it) when the tab loses focus. Re-resuming on
  // visibility change gets sound back without requiring a tap; when the
  // resume needs gesture authority (common from "interrupted") the permanent
  // unlockAudio listener above catches the next tap.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recoverAudioAfterReturn();
  });
  window.addEventListener("pageshow", () => { recoverAudioAfterReturn(); });
  // The studio is built and wired: drop the preloader. It fades over the audio
  // gate below rather than the other way round, which is why it goes first —
  // the gate is the next thing the visitor is meant to be looking at.
  try { window.__sqPreload?.done(); } catch {}
  // Up-front audio permission gate. A single tap on this dialog runs the
  // full iOS unlock dance inside a user-gesture frame (resume + silent
  // BufferSource + <audio>.play() to switch the iOS audio session to
  // "playback"). After the gate, the play button only has to start the
  // Transport — no late awaits, no chance of losing gesture authority.
  showAudioGateDialog();
  // Re-render step grids when crossing the mobile/desktop breakpoint so the
  // visual column count (16 vs 8) tracks the viewport. Debounced + gated so
  // rotation triggers a single render.
  let _lastIsMobile = window.innerWidth <= 768;
  let _resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const now = window.innerWidth <= 768;
      if (now !== _lastIsMobile) {
        _lastIsMobile = now;
        for (const t of state.tracks) {
          try { renderStepGrid(t); } catch {}
        }
      }
    }, 120);
  });
}

init();

