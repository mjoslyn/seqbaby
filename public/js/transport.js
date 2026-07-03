import { runAutomationForStep } from "./automation.js";
import { fireMetronome, paintBeatIndicator } from "./beat.js";
import { engineByKey } from "./catalog.js";
import { BAR_TICKS, wosc } from "./constants.js";
import { setStatus } from "./dom.js";
import { currentBpm, syncAllLFOs } from "./lfo.js";
import { init, primeAudioForIOS } from "./main.js";
import { updateMidiUI } from "./render.js";
import { ensureFxRack, fireFilterEnv, routeVoiceToRack } from "./signal.js";
import { findNextNonEmptyPattern, invertChord, state, switchPattern } from "./state.js";
import { applyScale, chordNotes, nameToMidi } from "./theory.js";
import { buildVoiceForEngine } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
export function paintNowIndicator() {
  for (const t of state.tracks) {
    const tk = t.trackTick ?? 0;
    const idx = ((tk - 1) % t.length + t.length) % t.length;
    const cells = t.el.querySelectorAll(".step");
    cells.forEach(c => {
      const start = Number(c.dataset.idx);
      const span = Number(c.dataset.span) || 1;
      c.classList.toggle("now", tk > 0 && idx >= start && idx < start + span);
    });
    // Piano roll: highlight the column for the current step, if the roll is open.
    const rollPanel = t._rollPanelEl || t.el.querySelector(".track-roll-panel");
    if (rollPanel && !rollPanel.hidden) {
      rollPanel.querySelectorAll(".roll-cell.now, .roll-vel-cell.now")
        .forEach(c => c.classList.remove("now"));
      if (tk > 0) {
        rollPanel.querySelectorAll(`.roll-cell[data-step="${idx}"], .roll-vel-cell[data-step="${idx}"]`)
          .forEach(c => c.classList.add("now"));
      }
    }
  }
}

// ---- transport ---------------------------------------------------------

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
  if (state.audioCtx.state === "suspended") {
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
  await wosc.loadOscillator(state.audioCtx);
  await ensureMidi().catch(() => null);
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
  try {
    await state.audioCtx.suspend();
    await state.audioCtx.resume();
  } catch (e) {
    console.warn("audio kick cycle failed", e);
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
    // doesn't unschedule them. Ramping master to 0 for a beat makes them inaudible
    // so stop actually stops. togglePlay restores the gain on the next start.
    if (state.masterGain && state.audioCtx) {
      const now = state.audioCtx.currentTime;
      const g = state.masterGain.gain;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.02);
      } catch {}
    }
    silenceAllVoices();
    state.playing = false;
    btn.textContent = "play";
    btn.classList.remove("playing");
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
    const baseStepDur = Tone.Time("16n").toSeconds();
    const anySolo = state.tracks.some(t => t.soloed);
    const masterSwing = Number(document.getElementById("swing")?.value) || 0;
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
        // Automation runs every step regardless of whether a note fires.
        const autoTime = Math.max(state.audioCtx.currentTime + 0.002, time + slot * effDur);
        runAutomationForStep(t, idx, autoTime, effDur);
        if (!t.steps[idx]) { slot++; continue; }
        const span = Math.max(1, t.lengths[idx] || 1);
        // Gate mode plays for the full step length; trigger mode fires a short
        // hit. Voices that honor `duration` (Plaits, samples, melodic synths)
        // will follow this; drum-synth recipes with fixed envelopes don't.
        const duration = (t.noteMode === "trigger") ? 0.05 : span * effDur;
        const swingOffset = (idx % 2 === 1) ? effDur * masterSwing : 0;
        const microOffset = (t.offsets?.[idx] ?? 0) * effDur;
        const hitTime = Math.max(state.audioCtx.currentTime + 0.002,
          time + slot * effDur + swingOffset + microOffset);
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
            const eDur  = (t.noteMode === "trigger") ? 0.05 : eSpan * effDur;
            extraDurs.push(eDur);
          }
          notes = [...notes, ...extras];
        }
        const list = (t.voice.poly && !arp) ? notes : (arp ? notes : [notes[0]]);
        const durationFor = (i) => i < chordCount ? duration : (extraDurs[i - chordCount] ?? duration);
        // Sample-based voices play longer than the step; extend the envelope sustain
        // so the ADSR actually shapes the whole sample, not just the first few ms.
        const sampleDur = (t.voice.buffer && ["sample","eleven","upload"].includes(t.voice.type))
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
          const count = Math.max(1, Math.floor(duration / rateSec));
          for (let k = 0; k < count; k++) {
            const n = seq[k % seq.length];
            try { t.voice.hit(n, hitTime + k * rateSec, rateSec * 0.92, vel); } catch (e) { console.warn(e); }
          }
        } else {
          const sampleOpts = (t.voice.type === "eleven" || t.voice.type === "upload" || t.voice.type === "sample")
            ? {
                startOffset: t.sampleStarts?.[idx] ?? 0,
                endOffset:   t.sampleEnds?.[idx]   ?? 1,
                fadeIn:      t.sampleFadeIns?.[idx]  ?? 0,
                fadeOut:     t.sampleFadeOuts?.[idx] ?? 0,
                loopMode:    t.sampleLoopModes?.[idx] ?? "off",
                pitchBase:   t.isDrumKit ? 36 : 60,
                // Propagate the time-sync mode so the voice can re-fit the rate
                // to the trimmed slice (1× bpm should fit a bar whether the
                // user plays the whole buffer or a quarter of it).
                sampleSpeedMode: t.sampleSpeedMode,
              }
            : null;
          const ratchet = Math.max(1, Math.min(8, Math.round(t.ratchets?.[idx] ?? 1)));
          if (ratchet > 1 && !chord) {
            // retrigger the single note N times evenly across the step
            const sub = duration / ratchet;
            for (let r = 0; r < ratchet; r++) {
              for (let i = 0; i < list.length; i++) {
                try { t.voice.hit(list[i], hitTime + r * sub, sub * 0.92, vel, sampleOpts); } catch (e) { console.warn(e); }
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
    Tone.Draw.schedule(paintNowIndicator, time);
    Tone.Draw.schedule(() => paintBeatIndicator(state.tick), time);
    if (state.metronome && state.tick % 4 === 0) fireMetronome(time, state.tick % 16 === 0);
    state.tick++;
    // manual pattern queue: when switch-mode is "finish" and the user queued a
    // different pattern, commit at the next bar boundary.
    if (state.patternSwitchMode === "finish" && state.queuedPattern !== null && state.tick % BAR_TICKS === 0) {
      const next = state.queuedPattern;
      Tone.Draw.schedule(() => switchPattern(next), time);
    }
    // pattern chaining: advance at bar boundaries when chain mode is on, respecting per-pattern repeats
    if (state.patternMode === "chain" && state.tick % BAR_TICKS === 0) {
      state.chainBarCount++;
      const needed = Math.max(1, state.patternRepeats[state.activePattern] ?? 1);
      if (state.chainBarCount >= needed) {
        state.chainBarCount = 0;
        const next = findNextNonEmptyPattern(state.activePattern);
        if (next >= 0 && next !== state.activePattern) {
          Tone.Draw.schedule(() => switchPattern(next), time);
        }
      }
    }
  }, "16n");

  // Start in 100 ms with offset 0. The +0.1 lookahead keeps the first "16n"
  // callbacks from landing at `time < currentTime` on cold start (context drifted
  // forward during ensureAudio) — the Math.max clamp above would otherwise pile
  // their hits onto the same instant, making the first bar unplayable. The
  // explicit offset 0 is the canonical way to rewind, avoiding the stop/cancel/
  // position dance which in Tone 15 can leave the first events unscheduled.
  Tone.Transport.start("+0.1", 0);
  state.playing = true;
  btn.textContent = "stop";
  btn.classList.add("playing");
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

