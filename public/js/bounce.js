import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { ICON_CHAIN, ICON_REPEAT } from "./icons.js";
import { currentBpm } from "./lfo.js";
import { suggestSetName } from "./session.js";
import { isPatternNonEmpty, state, switchPattern } from "./state.js";
import { ensureAudio, togglePlay } from "./transport.js";

export async function bounceAudio({ bars = 1, format = "wav", chainWhole = false, filename = null, fileStem = "bounce" } = {}) {
  await ensureAudio();
  const ctx = state.audioCtx;
  const recDest = ctx.createMediaStreamDestination();
  // Tap the post-limiter node (the one feeding destination) so the bounce
  // captures the same limited signal the user hears.
  const masterOut = state.masterLimiter || state.masterGain;
  masterOut.connect(recDest);
  // Silent render: temporarily disconnect from ctx.destination so the
  // user doesn't hear the bounce; the recorder still gets the signal via recDest.
  try { masterOut.disconnect(ctx.destination); } catch {}
  const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
  const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported?.(m)) || "";
  const rec = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  // Reset transport to the top of pattern 1 and start fresh.
  if (state.playing) await togglePlay();
  if (state.activePattern !== 0) switchPattern(0);

  const bpm = currentBpm();
  const durSec = bars * 4 * (60 / bpm);

  const prevMode = state.patternMode;
  if (chainWhole) {
    state.patternMode = "chain";
    const modeBtn = document.getElementById("pattern-mode");
    if (modeBtn) {
      modeBtn.setAttribute("aria-pressed", "true");
      try { modeBtn.innerHTML = ICON_CHAIN; } catch {}
    }
  }

  // Progress dialog — ticks once per animation frame until total elapsed matches
  // the render duration + tail. Auto-closes when the render completes.
  const totalSec = durSec + 0.4;
  const progress = openBounceProgressDialog({ totalSec, bars, format });

  rec.start();
  await togglePlay();                    // start playback
  // wait for the requested duration + a small tail so reverbs + releases finish
  await new Promise(r => setTimeout(r, totalSec * 1000));
  if (state.playing) await togglePlay(); // stop
  rec.stop();
  await stopped;
  try { masterOut.disconnect(recDest); } catch {}
  try { masterOut.connect(ctx.destination); } catch {}

  if (chainWhole) {
    state.patternMode = prevMode;
    const modeBtn = document.getElementById("pattern-mode");
    if (modeBtn) {
      modeBtn.setAttribute("aria-pressed", String(prevMode === "chain"));
      try { modeBtn.innerHTML = prevMode === "chain" ? ICON_CHAIN : ICON_REPEAT; } catch {}
    }
  }

  progress.setStatus("encoding…");
  const raw = new Blob(chunks, { type: mime || "audio/webm" });
  let out, ext;
  if (format === "wav") {
    try {
      const buf = await ctx.decodeAudioData(await raw.arrayBuffer());
      out = audioBufferToWav(buf);
      ext = "wav";
    } catch (err) {
      console.warn("wav encode failed, falling back to raw recording:", err);
      out = raw;
      ext = mime.includes("mp4") ? "mp4" : "webm";
    }
  } else {
    out = raw;
    ext = mime.includes("mp4") ? "mp4" : "webm";
  }
  progress.close();
  const stem = (filename && filename.trim()) || `seqbaby-${fileStem}-${Date.now()}`;
  const finalName = /\.(wav|webm|mp4)$/i.test(stem) ? stem : `${stem}.${ext}`;
  downloadBlob(out, finalName);
}

// A non-interactive modal that shows a progress bar + label while a bounce is
// running. Returns { setStatus(text), close() }. Drives the bar via rAF so it
// reads the wall-clock elapsed time rather than audio-thread state.
export function openBounceProgressDialog({ totalSec, bars, format }) {
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  overlay.innerHTML = `
    <div class="sq-modal" role="dialog" aria-modal="true">
      <div class="sq-modal__title">rendering audio</div>
      <div class="sq-bounce__progress-label">${bars} bar${bars === 1 ? "" : "s"} → ${format}</div>
      <div class="sq-bounce__progress-bar"><div class="sq-bounce__progress-fill"></div></div>
      <div class="sq-bounce__progress-status">capturing…</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const fill = overlay.querySelector(".sq-bounce__progress-fill");
  const statusEl = overlay.querySelector(".sq-bounce__progress-status");
  const startedAt = performance.now();
  let closed = false;
  const tick = () => {
    if (closed) return;
    const elapsed = (performance.now() - startedAt) / 1000;
    const pct = Math.max(0, Math.min(100, (elapsed / totalSec) * 100));
    fill.style.width = pct.toFixed(1) + "%";
    if (pct < 100) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    setStatus: (msg) => { statusEl.textContent = msg; fill.style.width = "100%"; },
    close: () => { closed = true; overlay.remove(); },
  };
}

// Total bars across every non-empty pattern (respecting per-pattern repeat counts).
export function trackTotalBars() {
  let bars = 0;
  for (let i = 0; i < PATTERN_COUNT; i++) {
    if (!isPatternNonEmpty(i)) continue;
    bars += Math.max(1, state.patternRepeats?.[i] ?? 1);
  }
  return Math.max(1, bars);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Encode a mono/stereo AudioBuffer to a 16-bit PCM WAV blob.
export function audioBufferToWav(buffer) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const blockAlign = ch * 2;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, dataSize, true);
  const channels = [];
  for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function showBounceDialog({ mode = "pattern" } = {}) {
  const isTrack = mode === "track";
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const bars = isTrack ? trackTotalBars() : Math.max(1, Math.ceil((state.tracks[0]?.length ?? 16) / 16));
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const suggested = suggestBounceFilename(mode);
    const note = isTrack
      ? `chains through every non-empty pattern (${bars} bar${bars === 1 ? "" : "s"}) at ${currentBpm()} bpm.`
      : `captures the current pattern (${bars} bar${bars === 1 ? "" : "s"}) at ${currentBpm()} bpm.`;
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">${isTrack ? "download session as audio" : "download pattern as audio"}</div>
        <div class="sq-bounce__opts">
          <label>file name <input class="b-name" type="text" value="${esc(suggested)}" /></label>
        </div>
        <div class="sq-bounce__note">${note}</div>
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          <button class="sq-modal__ok">${isTrack ? "download session" : "download pattern"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const nameInput = overlay.querySelector(".b-name");
    setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch {} }, 0);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector(".sq-modal__ok").addEventListener("click", () => {
      const filename = (nameInput.value || suggested).trim();
      close({ bars, format: "wav", filename });
    });
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

// Match the session-save button's suggested name exactly.
export function suggestBounceFilename() {
  return suggestSetName();
}

// iOS Safari only honors AudioContext.resume() and BufferSource.start() when
// they're invoked synchronously inside a user-gesture task. Awaiting anything
// before the call drops you off the gesture stack and resume() silently
// fails. Call this *first thing* in any handler that needs audio, before
// any `await`. Three nudges, in order, address three distinct iOS quirks:
//   1. ctx.resume() (sync, no await) — authorizes the suspended→running
//      transition inside the gesture frame.
//   2. silent BufferSource through ctx.destination — Safari leaves the
//      pipeline muted until something actually plays.
//   3. play() on a hidden <audio> element with a real (silent) src — flips
//      the iOS audio session from "ambient" (ringer-controlled, muted by
//      the side silent switch) to "playback", so output ignores the silent
//      switch.
// Up-front audio permission gate. Mobile browsers (iOS especially) require a
// user gesture before any AudioContext can produce sound. Rather than relying
// on the play button — where any await before the unlock can cost gesture
// authority — show a blocking overlay on page load. One tap runs the full
// unlock dance synchronously inside the gesture.
