import { installAppApi } from "./appApi.js";
import { buildBeatIndicator, paintBeatIndicator } from "./beat.js";
import { bounceAudio, showBounceDialog } from "./bounce.js";
import { normalizeAudioBuffer } from "./buffers.js";
import { rebuildEngineCatalog } from "./catalog.js";
import { LFO_KEYS, PATTERN_COUNT } from "./constants.js";
import { isMobileDevice, setStatus } from "./dom.js";
import { HELP_TIPS, ICON_CHAIN, ICON_DOWNLOAD, ICON_FINISH, ICON_METRONOME, ICON_NOW, ICON_REPEAT } from "./icons.js";
import { applySampleSpeed, attachBpmDrag, rateFromSync, retuneSyncedLFOs } from "./lfo.js";
import { autoAccents, parseMeter, stepsPerBarForMeter } from "./meter.js";
import { meterTick } from "./meters.js";
import { setEngineKey } from "./params.js";
import { copyPattern, openPatternMenu, renderPatternGrid } from "./patternBar.js";
import { syncAllGlobalFxLFOs } from "./globalFx.js";
import { syncAllMorphageneLFOs } from "./morphageneMod.js";
import { refreshMorphageneSync, wireGlobalFxPanels, wireMorphagenePanel } from "./render.js";
import { initScaleUI } from "./scaleUI.js";
import { loadShareFromUrl, onExportSet, onImportSet, onLoadSet, onSaveSet, onShareSet } from "./session.js";
import { state, switchPattern } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { createTrack, resizePattern } from "./track.js";
import { ensureAudio, togglePlay } from "./transport.js";

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

export function primeAudioForIOS() {
  const ctx = state.audioCtx;
  if (!ctx) return;
  if (ctx.state === "suspended") {
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

export async function pickAudioFileForTrack(t) {
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
        if (t.engineKey === "upload" && t.voice?.type === "upload") {
          t.voice.setBuffer(audioBuf);
        } else {
          setEngineKey(t, "upload");
          if (t.el) t.el.querySelector(".sq-track__engine").value = "upload";
        }
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

export function init() {
  // Create the AudioContext and bind Tone to it BEFORE anything reads
  // Tone.Transport. Tone.Transport's internal Clock latches onto the context's
  // time at first access; if we defer this to the play-click handler, Tone's
  // default context has already been ticking for several seconds and the clock
  // stays anchored there, so Transport.start("+0.1") resolves to "default-ctx
  // time + 0.1", which is several seconds in the future against our fresh
  // AudioContext. Diagnostics confirmed: drift == time from page load to click.
  // Creating the context here is fine — it starts suspended and Tone.start()
  // resumes it inside the user gesture.
  state.audioCtx = new AudioContext({ latencyHint: "interactive" });
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
    ctxWrap.lookAhead = isMobileDevice() ? 0.25 : 0.15;
  } catch (e) { console.warn("lookAhead tune failed", e); }
  initSilentAudioLoop();
  rebuildEngineCatalog();
  requestAnimationFrame(meterTick);

  document.getElementById("play").addEventListener("click", togglePlay);
  wireMorphagenePanel();
  wireGlobalFxPanels();
  const wirePanelToggle = (btnId, panelId) => {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const show = panel.hidden;
      panel.hidden = !show;
      btn.setAttribute("aria-pressed", String(show));
    });
  };
  wirePanelToggle("morph-toggle", "morph-panel");
  wirePanelToggle("globalfx-toggle", "globalfx-panel");
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
  for (const btn of document.querySelectorAll(".sq-dl__btn .sq-dl__icon")) btn.innerHTML = ICON_DOWNLOAD;
  document.getElementById("bpm").addEventListener("input", e => {
    if (state.ready) Tone.Transport.bpm.value = Number(e.target.value);
    retuneSyncedLFOs();
    refreshMorphageneSync();
    syncAllMorphageneLFOs();
    syncAllGlobalFxLFOs();
    for (const t of state.tracks) {
      if (t.fxRack && t.fxConfig.delay.sync) t.fxRack.applyDelay({});
      applySampleSpeed(t);
    }
    for (const t of state.tracks) {
      for (const key of LFO_KEYS) {
        if (!t.lfoConfig[key].sync) continue;
        const row = t.el.querySelector(`.sq-lfo__row[data-key="${key}"]`);
        if (!row) continue;
        const lbl = row.querySelector(".sq-lfo__rate-label");
        const divSel = row.querySelector(".sq-lfo__div");
        const opt = divSel.options[divSel.selectedIndex];
        lbl.textContent = `${opt ? opt.textContent : t.lfoConfig[key].div} · ${rateFromSync(t.lfoConfig[key].div).toFixed(2)} hz`;
      }
    }
  });
  // Vertical drag on the BPM field — on mobile there's no spinner and tapping
  // a number input only opens the numeric keypad, so let users drag up/down to
  // scrub the value. A clean tap still focuses the input to type a value.
  attachBpmDrag(document.getElementById("bpm"));
  // Master swing — read live by the transport loop each callback; no per-track
  // swing state to mirror anymore.
  document.getElementById("swing").addEventListener("input", () => {});
  document.getElementById("add-track").addEventListener("click", () => {
    createTrack({ name: `track ${state.tracks.length + 1}`, engineKey: "plaits:0" });
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
  window.addEventListener("pagehide", () => {
    try { Tone.Transport.stop(); } catch {}
    try { state.audioCtx?.close(); } catch {}
  });
  // Visibility resume: iOS often suspends the audio context (or just stops
  // rendering it) when the tab loses focus. Re-resuming on visibility change
  // gets sound back without requiring a tap.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.audioCtx
        && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
  });
  window.addEventListener("pageshow", () => {
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
  });
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

