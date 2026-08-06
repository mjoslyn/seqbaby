import { runAutomationForStep } from "./automation.js";
import { fireMetronome, paintBeatIndicator } from "./beat.js";
import { engineByKey } from "./catalog.js";
import { BAR_TICKS, wosc } from "./constants.js";
import { setStatus } from "./dom.js";
import { loadDx7Worklet } from "./dx7.js";
import { currentBpm, syncAllLFOs } from "./lfo.js";
import { init, needsResume, primeAudioForIOS } from "./main.js";
import { updateMidiUI } from "./render.js";
import { ensureFxRack, fireFilterEnv, routeVoiceToRack } from "./signal.js";
import { findNextNonEmptyPattern, invertChord, state, switchPattern } from "./state.js";
import { loadTb303Worklet } from "./tb303.js";
import { loadVirusWorklet } from "./virus.js";
import { applyScale, chordNotes, nameToMidi } from "./theory.js";
import { buildVoiceForEngine } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Paint ONE track's "now" highlight (step grid + piano roll column) on `idx`.
 * `idx < 0` clears it. Per-track because there's no single moment that's "now"
 * for the whole rig: swing, per-step nudges and per-track speed all move a
 * step off the grid, so each track's playhead is scheduled on its own time.
 * @param {Track} t @param {number} idx
 */
export function paintTrackNow(t, idx) {
  const on = idx >= 0;
  const cells = t.el.querySelectorAll(".sq-step");
  cells.forEach(c => {
    const start = Number(c.dataset.idx);
    const span = Number(c.dataset.span) || 1;
    c.classList.toggle("is-now", on && idx >= start && idx < start + span);
  });
  // Piano roll: highlight the column for the current step, if the roll is open.
  const rollPanel = t._rollPanelEl || t.el.querySelector(".sq-track__roll-panel");
  if (rollPanel && !rollPanel.hidden) {
    rollPanel.querySelectorAll(".sq-roll__cell.is-now, .sq-roll__vel-cell.is-now")
      .forEach(c => c.classList.remove("is-now"));
    if (on) {
      rollPanel.querySelectorAll(`.sq-roll__cell[data-step="${idx}"], .sq-roll__vel-cell[data-step="${idx}"]`)
        .forEach(c => c.classList.add("is-now"));
    }
  }
}

/**
 * Repaint every track's "now" highlight at once, from their tick counters.
 * The transport doesn't use this while running — it paints each track from the
 * step loop, on that step's own time (see paintTrackNow). This is for the
 * callers that need a whole-rig repaint outside the schedule: stop, re-renders.
 * `ticks` is an optional per-track snapshot of trackTick values; omit it to
 * read live.
 * @param {number[]} [ticks]
 */
export function paintNowIndicator(ticks) {
  for (let ti = 0; ti < state.tracks.length; ti++) {
    const t = state.tracks[ti];
    const tk = ticks ? (ticks[ti] ?? 0) : (t.trackTick ?? 0);
    paintTrackNow(t, tk > 0 ? ((tk - 1) % t.length + t.length) % t.length : -1);
  }
}

// ---- transport ---------------------------------------------------------

// How far the audible output trails the render clock, used to delay the
// playhead/beat visuals so they track what you HEAR. Chrome reports it
// (ctx.outputLatency, including Bluetooth). Safari has no outputLatency API
// and its real render→speaker latency on macOS is large enough to see (the
// playhead visibly leads the sound), so it gets an ear-tuned estimate.
// `?vlat=<seconds>` overrides for calibration or unusual outputs.
const VISUAL_LATENCY_OVERRIDE = (() => {
  const v = new URLSearchParams(location.search).get("vlat");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
})();
const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
// Fallback for Safari ≤18.3, which has no outputLatency API: an ear-tuned
// net estimate of the render→speaker latency. Safari 18.4+ (WebKit, Jan
// 2025) reports the real ctx.outputLatency and takes the measured path
// below. (An earlier 0.18 value was tuned against the broken Tone.Draw
// scheduler that painted ~0.32s early — with correct scheduling the estimate
// should be an actual device latency, not a bug offset.)
const SAFARI_OUTPUT_LATENCY_EST = 0.09;
// Paints land ~2-3 display frames after their scheduled time anyway (next rAF
// + compositor), which already cancels small audio output latencies. Only
// compensate beyond that, or Chrome visuals go late and the audio reads early.
const DISPLAY_LAG_EST = 0.03;
export function visualOutputLatency() {
  if (VISUAL_LATENCY_OVERRIDE !== null) return VISUAL_LATENCY_OVERRIDE;
  const ctx = state.audioCtx;
  if (!ctx) return 0;
  // outputLatency reads 0 until the context is actually running (and on old
  // Safari it's undefined) — the || chain treats both as "not reported".
  const reported = ctx.outputLatency || 0;
  if (reported > 0) return Math.max(0, reported - DISPLAY_LAG_EST);
  if (IS_SAFARI) return SAFARI_OUTPUT_LATENCY_EST;
  return Math.max(0, (ctx.baseLatency || 0) - DISPLAY_LAG_EST);
}

/**
 * Schedule a UI callback for the wall-clock moment an audio event becomes
 * AUDIBLE. Deliberately not Tone.Draw: measured on Chrome, Tone.Draw fired
 * callbacks a rock-constant ~316ms before the audio graph even rendered the
 * event — a fixed clock skew (its timeline latches onto Tone's default
 * context, which starts ticking at page load, not the raw context we pass to
 * Tone.setContext). Mapping audio time → wall clock against OUR context
 * sidesteps that whole class of bug, and works while the tab is hidden
 * (setTimeout still fires, throttled; rAF-driven Draw stops entirely — which
 * silently stalled pattern-switch commits in background tabs).
 * @param {() => void} cb @param {number} audioTime context time of the event
 * @param {number} [extra] additional seconds (e.g. output latency compensation)
 */
function scheduleAtAudible(cb, audioTime, extra = 0) {
  const ctx = state.audioCtx;
  const delayMs = Math.max(0, (audioTime - ctx.currentTime + extra) * 1000);
  setTimeout(cb, delayMs);
}

/**
 * Lazily build the AudioContext, master bus, and every track voice on the
 * first play. Safe to call repeatedly.
 * @returns {Promise<void>}
 */
export async function ensureAudio() {
  if (state.ready) return;
  // state.audioCtx + Tone.setContext are wired up at init() time so Tone.Transport
  // latches onto our context from first access.
  await Tone.start();
  // Tone.start() resolves successfully even when our underlying raw AudioContext
  // (passed to Tone.setContext at init) stays "suspended" — Tone v15 sometimes
  // doesn't propagate resume() to externally-provided contexts. Resume directly
  // from inside the user gesture so audio actually unlocks.
  if (needsResume(state.audioCtx)) {
    try { await state.audioCtx.resume(); } catch (e) { console.warn("audioCtx.resume failed", e); }
  }
  if (!state.masterGain) {
    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = 1;
    // Brickwall-ish safety limiter on the master bus. When many voices stack
    // (or a burst of late-scheduled events piles onto the same instant on a
    // janky mobile main thread) the summed signal can rocket past 0 dBFS and
    // hard-clip at ctx.destination — the "sound blows out" symptom. This catches
    // peaks transparently: it sits idle until the signal approaches full scale.
    state.masterLimiter = state.audioCtx.createDynamicsCompressor();
    state.masterLimiter.threshold.value = -2;
    state.masterLimiter.knee.value = 0;
    state.masterLimiter.ratio.value = 20;
    state.masterLimiter.attack.value = 0.002;
    state.masterLimiter.release.value = 0.1;
    state.masterGain.connect(state.masterLimiter);
    state.masterLimiter.connect(state.audioCtx.destination);
    state.masterAnalyser = state.audioCtx.createAnalyser();
    state.masterAnalyser.fftSize = 1024;
    state.masterAnalyser.smoothingTimeConstant = 0.25;
    // Tap pre-limiter so the clip indicator still warns when the mix is hot.
    state.masterGain.connect(state.masterAnalyser);
  }
  // Worklet WASM is kicked off at init() (loadWorklet below is single-flight),
  // so this await is usually instant by the time the user hits play.
  await loadWorklet();
  // Web MIDI is NOT awaited here. Chrome 124+ shows a permission prompt for
  // requestMIDIAccess even without sysex; awaiting it stalls audio init on the
  // prompt and burns the play click's user activation, after which the context
  // resume() below gets silently rejected and the app starts dead-silent. It's
  // requested in the background — and only when a track actually uses MIDI.
  requestMidiIfNeeded();
  for (const t of state.tracks) {
    try { ensureFxRack(t); } catch (e) { console.warn("fx rack init failed for", t.name, e); }
    if (!t.voice) {
      try {
        t.voice = buildVoiceForEngine(state.audioCtx, t.engineKey, t.params, t);
        if (t.voice.type === "midi") {
          t.voice.setChannel(t.midi.channel);
          const out = state.midi?.outputs.get(t.midi.outputId);
          if (out) t.voice.setOutput(out);
        }
        if (t.voice.setGlide) t.voice.setGlide(t.glide);
      } catch (e) { console.error("voice init failed for", t.name, e); }
    }
    try { routeVoiceToRack(t); } catch (e) { console.warn("route failed for", t.name, e); }
  }
  state.ready = true;
  for (const t of state.tracks) { try { syncAllLFOs(t); } catch (e) { console.warn("lfo sync failed", e); } }
  // iOS Safari quirk: after AudioWorklet load + voice construction, the
  // context's state can be "running" while the underlying audio renderer
  // hasn't actually started pumping — sound only appears after a visibility
  // change. A suspend+resume cycle forces iOS to re-engage the audio session
  // and start rendering the worklet graph. Best-effort; ignore failures.
  //
  // TOUCH DEVICES ONLY. On desktop Chrome this cycle runs many awaits past the
  // original play-click gesture (Tone.start → worklet load → voice build), so
  // the resume() after suspend() is no longer covered by user activation and
  // Chrome silently rejects it — leaving the context suspended and the app
  // dead-silent even though the status line reads "ready". The kick is only
  // needed for the iOS renderer, so gate it to touch devices.
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
  if (isTouch) {
    try {
      await state.audioCtx.suspend();
      await state.audioCtx.resume();
    } catch (e) {
      console.warn("audio kick cycle failed", e);
    }
  }
  // Belt-and-suspenders: if the context is still suspended here (e.g. an
  // earlier resume was rejected), the status readout would misleadingly show
  // "ready". Try one more resume and surface the real state.
  if (needsResume(state.audioCtx)) {
    try { await state.audioCtx.resume(); } catch (e) { console.warn("final resume failed", e); }
    if (needsResume(state.audioCtx)) {
      console.warn(`audioCtx still ${state.audioCtx.state} after ensureAudio — audio will be silent`);
    }
  }
}

/**
 * Load the engine's AudioWorklets exactly once: Plaits (+ its WASM), the
 * TB-303, the Virus and the DX7. Single-flight so a preload at init() and the await in
 * ensureAudio can't double-register a processor; a failed load clears the slot
 * so the next play retries. A synth worklet's failure is swallowed — it falls
 * back to a Tone voice (see voices.js) rather than taking the play path down.
 * @returns {Promise<unknown>}
 */
export function loadWorklet() {
  if (!state.woscLoad) {
    state.woscLoad = wosc.loadOscillator(state.audioCtx);
    state.woscLoad.catch(() => { state.woscLoad = null; });
  }
  const tb303 = loadTb303Worklet(state.audioCtx).catch(e => { console.warn("tb-303 worklet load failed", e); });
  const virus = loadVirusWorklet(state.audioCtx).catch(e => { console.warn("virus worklet load failed", e); });
  const dx7 = loadDx7Worklet(state.audioCtx).catch(e => { console.warn("dx7 worklet load failed", e); });
  return Promise.all([state.woscLoad, tb303, virus, dx7]);
}

/**
 * Open the master bus back up.
 *
 * Stop ramps the master to 0 to swallow the events Tone's lookahead had already
 * queued, and leaves it there — a timer can't restore it, because silencing a
 * voice releases it and a long-release patch would fade back in over the top.
 * But the master is also what the computer keyboard plays through, and that is
 * meant to work whether the transport runs or not: before this, every key was
 * silent once you'd pressed stop. So anything that wants to make a sound while
 * stopped asks for the bus first.
 */
export function wakeMasterBus() {
  if (state.playing) return;                       // already open
  const g = state.masterGain?.gain;
  if (!g || !state.audioCtx || g.value > 0.999) return;
  const now = state.audioCtx.currentTime;
  try {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + 0.015);
  } catch {}
}

/**
 * Request Web MIDI access in the background — but only if a track actually
 * uses a MIDI engine (the Chrome permission prompt shouldn't appear for
 * sessions that never touch MIDI). Once granted, wire the outputs onto any
 * already-built MIDI voices. Never awaited on the play path.
 */
export function requestMidiIfNeeded() {
  if (state.midi) { wireMidiOutputs(); return; }
  const anyMidi = state.tracks.some(t => engineByKey(t.engineKey)?.type === "midi");
  if (!anyMidi) return;
  ensureMidi().then(wireMidiOutputs).catch(() => null);
}

function wireMidiOutputs() {
  if (!state.midi) return;
  for (const t of state.tracks) {
    if (t.voice?.type !== "midi") continue;
    t.voice.setChannel(t.midi.channel);
    const out = state.midi.outputs.get(t.midi.outputId);
    if (out) t.voice.setOutput(out);
  }
}

export async function ensureMidi() {
  if (state.midi || !navigator.requestMIDIAccess) return state.midi;
  state.midi = await navigator.requestMIDIAccess({ sysex: false });
  const refresh = () => {
    for (const t of state.tracks) if (engineByKey(t.engineKey)?.type === "midi") updateMidiUI(t);
  };
  state.midi.addEventListener("statechange", refresh);
  refresh();
  return state.midi;
}

export function silenceAllVoices() {
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of state.tracks) {
    try { t.voice?.silence(now); } catch {}
  }
}

// ---- audio bounce (WAV / WebM) ----------------------------------------
// Render the current pattern(s) by capturing live playback via a
// MediaStreamDestinationNode + MediaRecorder. Optional post-decode to 16-bit
// PCM WAV.
export async function togglePlay() {
  const btn = document.getElementById("play");
  if (state.playing) {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    if (state.repeatId !== null) { Tone.Transport.clear(state.repeatId); state.repeatId = null; }
    // Fast master-gain cut. Tone synth triggerAttackRelease calls issued by the
    // last few scheduleRepeat callbacks live inside Tone's ~100 ms lookahead and
    // are already queued as native Web Audio events — stopping the Transport
    // doesn't unschedule them. Ramping master to 0 makes them inaudible so stop
    // actually stops.
    if (state.masterGain && state.audioCtx) {
      const now = state.audioCtx.currentTime;
      const g = state.masterGain.gain;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.02);
      } catch {}
    }
    // The gain stays down until something asks for the bus back (see
    // wakeMasterBus). Restoring it on a timer instead sounds wrong: silencing a
    // voice *releases* it, and a long-release patch would then fade back in
    // over the top of the silence you just asked for.
    silenceAllVoices();
    state.playing = false;
    btn.textContent = "play";
    btn.classList.remove("is-playing");
    state.tick = 0;
    for (const t of state.tracks) { t.trackTick = 0; t.speedAccum = 0; }
    paintNowIndicator();
    setStatus("stopped");
    return;
  }
  // iOS: synchronously prime audio inside the click's gesture task BEFORE
  // awaiting anything else. Without this the context resume that ensureAudio
  // attempts later won't be honored on Safari.
  primeAudioForIOS();
  setStatus(`unlocking audio (ctx: ${state.audioCtx?.state || "?"})...`);
  try {
    await ensureAudio();
  } catch (err) {
    console.error("ensureAudio failed:", err);
    setStatus(`audio init failed: ${err?.message || err}`, true);
    return;
  }
  // Confirm post-unlock state on screen so a no-dev-console iPhone user can
  // tell us whether the context actually resumed.
  setStatus(`audio ready (ctx: ${state.audioCtx?.state || "?"})`);
  Tone.Transport.bpm.value = Number(document.getElementById("bpm").value);
  // Per-track swing is applied manually in the transport loop; keep Tone's global swing disabled.
  Tone.Transport.swing = 0;
  Tone.Transport.swingSubdivision = "16n";

  if (state.repeatId !== null) Tone.Transport.clear(state.repeatId);
  state.tick = 0;
  for (const t of state.tracks) { t.trackTick = 0; t.speedAccum = 0; }
  // Restore master gain — the stop branch ramps it to 0 to kill the lookahead-
  // queued tail of Tone synth events that Transport.stop() can't unschedule.
  if (state.masterGain && state.audioCtx) {
    const now = state.audioCtx.currentTime;
    const g = state.masterGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + 0.02);
    } catch {}
  }
  state.repeatId = Tone.Transport.scheduleRepeat((time) => {
    // Derived from the transport that is actually running the sequence, not
    // from Tone.Time("16n"). `Tone.setContext` leaves Tone's time helpers
    // resolving against a different transport than the one we schedule on, so
    // Tone.Time("16n").toSeconds() answers 0.125s — the 120bpm value — at every
    // tempo. Everything scaled by a step took that: note lengths, swing, the
    // per-step micro-timing offsets, automation ramps and arp spans. At 60bpm
    // notes came out half the length of their step; at 180 they overlapped the
    // next one.
    const baseStepDur = 60 / (Tone.Transport.bpm.value || currentBpm()) / 4;
    const anySolo = state.tracks.some(t => t.soloed);
    const masterSwing = Number(document.getElementById("swing")?.value) || 0;
    const lat = visualOutputLatency();
    for (const t of state.tracks) {
      if (!t.voice) continue;
      if (anySolo ? !t.soloed : t.muted) continue;
      const speed = Math.max(0.0001, t.speed ?? 1);
      const effDur = baseStepDur / speed;
      t.speedAccum = (t.speedAccum ?? 0) + speed;
      let slot = 0; // sub-tick offset (for speed > 1, multiple steps per global tick)
      while (t.speedAccum >= 1) {
        t.speedAccum -= 1;
        const idx = (t.trackTick ?? 0) % t.length;
        t.trackTick = (t.trackTick ?? 0) + 1;
        // Where this step actually lands: the grid slot, pushed by master swing
        // (odd steps only) and the step's own micro-nudge.
        const swingOffset = (idx % 2 === 1) ? effDur * masterSwing : 0;
        const microOffset = (t.offsets?.[idx] ?? 0) * effDur;
        const stepTime = Math.max(state.audioCtx.currentTime + 0.002,
          time + slot * effDur + swingOffset + microOffset);
        // Automation runs every step regardless of whether a note fires — at the
        // step's real time, not the bare grid time, or a swung/nudged step's lane
        // lands up to half a step early and the *previous* note hears the value.
        // Silent steps swing too, so the lane keeps the same groove as the notes.
        runAutomationForStep(t, idx, stepTime, effDur);
        // Same for the playhead: paint it when this step is AUDIBLE, so a swung
        // or nudged step lights up with its note instead of on the bare grid.
        // Also before the silent-step bail — the playhead moves on every step.
        // The `playing` guard matters because these are scheduled up to the
        // lookahead plus a swung step ahead: stop clears the highlights, and
        // without it a paint still in flight would re-light a step afterwards.
        scheduleAtAudible(() => { if (state.playing) paintTrackNow(t, idx); }, stepTime, lat);
        if (!t.steps[idx]) { slot++; continue; }
        const span = Math.max(1, t.lengths[idx] || 1);
        // A note lasts its written step length. Voices that honor `duration`
        // (Plaits, samples, melodic synths) follow it; drum-synth recipes with
        // fixed envelopes don't.
        const duration = span * effDur;
        const hitTime = stepTime;
        const root = noteForStep(t, idx);
        const vel = t.velocities[idx] ?? 0.5;
        const chord = t.chords[idx] || "";
        const arp = !!(t.arps && t.arps[idx]);
        const cpx = (t.complexities && t.complexities[idx]) || 0;
        let notes = chord ? chordNotes(root, chord) : [root];
        if (chord && cpx) notes = invertChord(notes, cpx);
        const chordCount = notes.length;
        // Polyphonic extras (from the piano roll) stack on top of the chord/root.
        // Per-extra length comes from t.extraLengths; falls back to the anchor's
        // length so the simple "all the same length" stack still works.
        const extras = t.extraNotes && t.extraNotes[idx];
        const extraLens = t.extraLengths && t.extraLengths[idx];
        const extraDurs = [];
        if (Array.isArray(extras) && extras.length) {
          for (let e = 0; e < extras.length; e++) {
            const eSpan = Math.max(1, Math.min(span, (Array.isArray(extraLens) ? extraLens[e] : null) ?? span));
            const eDur  = eSpan * effDur;
            extraDurs.push(eDur);
          }
          notes = [...notes, ...extras];
        }
        const list = (t.voice.poly && !arp) ? notes : (arp ? notes : [notes[0]]);
        const durationFor = (i) => i < chordCount ? duration : (extraDurs[i - chordCount] ?? duration);
        // Sample-based voices play longer than the step; extend the envelope sustain
        // so the ADSR actually shapes the whole sample, not just the first few ms.
        const sampleDur = (t.voice.buffer && t.voice.type === "sampler")
          ? (t.voice.buffer.duration || 0)
          : 0;
        const envDur = Math.max(duration, sampleDur);
        try { fireFilterEnv(t, hitTime, envDur); } catch (e) { console.warn(e); }
        if (arp && notes.length > 1) {
          // classic arpeggiator: rate (beats per note) × range (octaves) × direction
          const rateBeats = t.arpRates?.[idx] ?? 0.25;
          const rateSec = Math.max(0.02, rateBeats * (60 / currentBpm()));
          const range = Math.max(1, Math.min(4, t.arpRanges?.[idx] ?? 1));
          const dir = t.arpDirs?.[idx] ?? "up";
          let expanded = [];
          for (let o = 0; o < range; o++) for (const n of notes) expanded.push(n + o * 12);
          let seq;
          if (dir === "down") seq = expanded.slice().reverse();
          else if (dir === "updown") {
            seq = expanded.concat(expanded.slice(0, -1).reverse().slice(0, -1));
            if (seq.length === 0) seq = expanded;
          } else if (dir === "random") {
            seq = expanded.slice();
            for (let k = seq.length - 1; k > 0; k--) {
              const j = Math.floor(Math.random() * (k + 1));
              [seq[k], seq[j]] = [seq[j], seq[k]];
            }
          } else seq = expanded;
          // The arp runs for the note's whole written length. That's the step
          // span, not `duration` — in trigger mode `duration` is a fixed 50 ms,
          // which would collapse the whole arp to a single hit. Round the count
          // up so a length that isn't a whole number of arp notes still gets
          // filled to its end (the last note is trimmed to what's left).
          const arpSpan = span * effDur;
          const count = Math.max(1, Math.ceil(arpSpan / rateSec - 1e-6));
          for (let k = 0; k < count; k++) {
            const n = seq[k % seq.length];
            const remain = arpSpan - k * rateSec;
            const noteDur = Math.max(0.01, Math.min(rateSec, remain) * 0.92);
            try { t.voice.hit(n, hitTime + k * rateSec, noteDur, vel); } catch (e) { console.warn(e); }
          }
        } else {
          const sd = t.sampleDefaults || {};
          // Non-sampler voices still get the step's written span — the 303
          // reads it to tell a tie (slides into the next note) from a plain step.
          const sampleOpts = (t.voice.type !== "sampler")
            ? { span }
            : {
                startOffset: sd.start ?? 0,
                endOffset:   sd.end   ?? 1,
                fadeIn:      sd.fadeIn  ?? 0,
                fadeOut:     sd.fadeOut ?? 0,
                loopMode:    sd.loopMode ?? "off",
                pitchBase:   t.isDrumKit ? 36 : 60,
                isDrumKit:   t.isDrumKit,
                // Propagate the time-sync mode so the voice can re-fit the rate
                // to the trimmed slice (1× bpm should fit a bar whether the
                // user plays the whole buffer or a quarter of it).
                sampleSpeedMode: t.sampleSpeedMode,
                pitchLocked: t.pitchLock !== false,
              };
          const ratchet = Math.max(1, Math.min(8, Math.round(t.ratchets?.[idx] ?? 1)));
          if (ratchet > 1 && !chord) {
            // retrigger the single note N times evenly across the step
            const sub = duration / ratchet;
            // Each retrigger is its own note, tie or not — otherwise the 303
            // would read a tied step's repeats as one long slide and swallow them.
            const ratchetOpts = (t.voice.type !== "sampler") ? { span: 1 } : sampleOpts;
            for (let r = 0; r < ratchet; r++) {
              for (let i = 0; i < list.length; i++) {
                try { t.voice.hit(list[i], hitTime + r * sub, sub * 0.92, vel, ratchetOpts); } catch (e) { console.warn(e); }
              }
            }
          } else {
            for (let i = 0; i < list.length; i++) {
              try { t.voice.hit(list[i], hitTime, durationFor(i), vel, sampleOpts); } catch (e) { console.warn(e); }
            }
          }
        }
        slot++;
      }
    }
    // Paint at the time the audio actually reaches the speakers, not when the
    // graph renders it (see visualOutputLatency + scheduleAtAudible above).
    // The step playheads are scheduled per track inside the loop above, on each
    // step's own swung/nudged time. The beat indicator stays on the bare grid:
    // it marks quarters, which land on even 16ths and never swing.
    // Snapshot the tick now — it advances before the deferred paint fires.
    const globalTickSnap = state.tick;
    scheduleAtAudible(() => paintBeatIndicator(globalTickSnap), time, lat);
    if (state.metronome && state.tick % 4 === 0) fireMetronome(time, state.tick % 16 === 0);
    state.tick++;
    // manual pattern queue: when switch-mode is "finish" and the user queued a
    // different pattern, commit at the next bar boundary. Synchronous, NOT
    // deferred to the audible moment: this callback runs ~lookAhead ahead of
    // the speakers, and the next callback (the new bar's first step) must read
    // the switched pattern's data or it plays the old pattern's opening steps.
    if (state.patternSwitchMode === "finish" && state.queuedPattern !== null && state.tick % BAR_TICKS === 0) {
      switchPattern(state.queuedPattern);
    }
    // pattern chaining: advance at bar boundaries when chain mode is on, respecting per-pattern repeats
    if (state.patternMode === "chain" && state.tick % BAR_TICKS === 0) {
      state.chainBarCount++;
      const needed = Math.max(1, state.patternRepeats[state.activePattern] ?? 1);
      if (state.chainBarCount >= needed) {
        state.chainBarCount = 0;
        const next = findNextNonEmptyPattern(state.activePattern);
        if (next >= 0 && next !== state.activePattern) {
          switchPattern(next); // synchronous — same reasoning as the manual queue above
        }
      }
    }
  }, "16n");

  // Start with offset 0 — the explicit offset is the canonical way to rewind,
  // avoiding the stop/cancel/position dance which in Tone 15 can leave the
  // first events unscheduled. The lead keeps the first "16n" callbacks from
  // landing at `time < currentTime` (the Math.max clamp above would otherwise
  // pile their hits onto one instant, making the first bar unplayable).
  //
  // The lead is adaptive: when the output pipeline only just started running
  // (first-ever play, and the play click itself was the unlocking gesture),
  // macOS Core Audio drops the first fraction of a second of DAC output while
  // the device spins up — the context clock advances but nothing is audible,
  // so a 100 ms lead lands the opening notes inside the drop window ("playhead
  // moves, no sound"). Give a cold output a longer runway; warm starts (the
  // usual case — init()'s first-gesture unlock resumed the context long before
  // play, and the keep-alive node holds the device open) keep the snappy 0.1 s.
  if (!state._outputRunningSince && state.audioCtx.state === "running") {
    state._outputRunningSince = performance.now();
  }
  const outputAgeMs = performance.now() - (state._outputRunningSince ?? performance.now());
  Tone.Transport.start(outputAgeMs < 1500 ? "+0.5" : "+0.1", 0);
  state.playing = true;
  btn.textContent = "stop";
  btn.classList.add("is-playing");
  setStatus("playing");
}

/**
 * The effective MIDI note a step will play (respecting drum-kit defaults).
 * @param {Track} t @param {number} idx @returns {number}
 */
export function noteForStep(t, idx) {
  const raw = t.notes[idx];
  let n;
  if (typeof raw === "number" && Number.isFinite(raw)) n = raw;
  else if (typeof raw === "string") { const m = nameToMidi(raw); n = m != null ? m : (engineByKey(t.engineKey)?.defaultNote ?? 60); }
  else n = engineByKey(t.engineKey)?.defaultNote ?? 60;
  return applyScale(n);
}

// ---- prompting ---------------------------------------------------------

