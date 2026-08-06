// ---- per-pattern sound (the p-lock) -------------------------------------
// Normally a track has one sound and 32 patterns of notes: change the cutoff
// and it changes everywhere. p-lock is per track AND per pattern — the button
// belongs to the track, its state belongs to the pattern you're on. So the bass
// can have its own sound in the chorus while the verse and the middle eight go
// on sharing the track's.
//
//   bass    pattern 1  unlocked -> the track's shared sound  \ these two move
//           pattern 3  unlocked -> the track's shared sound  / together
//           pattern 2  LOCKED   -> its own sound
//
// Two places a sound can live, then: `t.patterns[i].sound` for a locked
// pattern, and `t.baseSound` for every unlocked one. The live state stays where
// every other module expects it (`t.params`, `t.filter`, `t.eq`, `t.comp`,
// `t.fxConfig`, `t.lfoConfig`); switching patterns writes the live sound back
// to whichever of the two owns the pattern being left, and reads whichever owns
// the one being entered. Editing on an unlocked pattern is therefore editing
// the shared sound, which is what makes the unlocked patterns move together.
//
// Recall is diffed, not applied wholesale, and that is the load-bearing part:
// in chain mode patterns advance at bar boundaries *while the transport runs*,
// from inside the scheduler callback. Setting every parameter every bar would
// re-register ~130 LFOs and regenerate the reverb's impulse response each time.
// Only what actually differs is touched, so switching between two patterns that
// share a sound costs almost nothing.

import { defaultLFOConfig, syncLFO } from "./lfo.js";
import { setParam, updateGranularSpeedEnabled } from "./params.js";
import { refreshParamIndicators } from "./paramTargets.js";
import { refreshFxPanelUI, renderModPanel, syncTrackSoundUI } from "./render.js";
import { applyCompressorConfig, setEQ, setFilter } from "./signal.js";
import { state } from "./state.js";

/** @typedef {import("./types.js").Track} Track */

/** Order-independent deep compare — cheaper than stringify and doesn't care
 *  which order two objects happened to be built in. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object") return a === b;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same(a[k], b[k])) return false;
  return true;
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Is this track's sound locked to this pattern? @param {Track} t */
export function patternLocked(t, idx) { return !!t?.patterns?.[idx]?.soundLocked; }

/**
 * The whole of a track's sound, as a plain snapshot: the synth params, the
 * filter and its envelope, the fx rack, the eq and compressor, and the mods.
 * @param {Track} t
 */
export function capturePatternSound(t) {
  // Only the LFOs that are actually running. The mod matrix has an entry for
  // every one of the ~130 modulation targets whether or not it was ever used,
  // and at 32 patterns a track those defaults would be 400KB of a session that
  // has to fit in a share link — while saying nothing. A key that isn't here
  // means "not modulated", which is what applyPatternSound assumes.
  const lfoConfig = {};
  for (const [k, cfg] of Object.entries(t.lfoConfig)) {
    if (cfg?.enabled) lfoConfig[k] = clone(cfg);
  }
  return {
    params: { ...t.params },
    filter: { ...t.filter },
    eq: { ...t.eq },
    comp: { ...t.comp },
    fxConfig: clone(t.fxConfig),
    lfoConfig,
  };
}

// fxConfig key → the rack method that installs it.
const FX_APPLY = {
  amp: "applyAmp", vinyl: "applyVinyl", cassette: "applyCassette", fuzz: "applyFuzz",
  ringmod: "applyRingMod", shaper: "applyWaveShaper", crush: "applyCrush",
  autowah: "applyAutoWah", chorus: "applyChorus", phaser: "applyPhaser",
  flanger: "applyFlanger", pitchshift: "applyPitchShift", delay: "applyDelay",
};

/**
 * Install a snapshot onto the live track, touching only what differs.
 * @param {Track} t @param {ReturnType<capturePatternSound>} snap
 * @returns {boolean} whether anything changed (callers skip the repaint if not)
 */
export function applyPatternSound(t, snap) {
  if (!snap) return false;
  let touched = false;

  if (snap.params) {
    for (const [k, v] of Object.entries(snap.params)) {
      if (same(t.params[k], v)) continue;
      setParam(t, k, v);              // writes t.params and the live voice
      touched = true;
    }
  }
  if (snap.filter) {
    for (const [k, v] of Object.entries(snap.filter)) {
      if (same(t.filter[k], v)) continue;
      setFilter(t, k, v);
      touched = true;
    }
  }
  if (snap.eq) {
    for (const band of ["low", "mid", "high"]) {
      if (snap.eq[band] === undefined || same(t.eq[band], snap.eq[band])) continue;
      setEQ(t, band, snap.eq[band]);
      touched = true;
    }
  }
  if (snap.comp && !same(t.comp, snap.comp)) {
    Object.assign(t.comp, snap.comp);
    applyCompressorConfig(t);
    touched = true;
  }
  if (snap.fxConfig) {
    for (const [key, cfg] of Object.entries(snap.fxConfig)) {
      if (same(t.fxConfig[key], cfg)) continue;
      const prev = t.fxConfig[key];
      t.fxConfig[key] = clone(cfg);
      touched = true;
      if (!t.fxRack) continue;
      if (key === "reverb") {
        // The tail length rebuilds the impulse response, which is far too
        // expensive to do on every bar — only pass it when it really moved.
        const decayMoved = Math.abs((cfg?.decay ?? 2) - (prev?.decay ?? 2)) > 0.05;
        try {
          t.fxRack.applyReverb(decayMoved ? { ...cfg } : { wet: cfg?.wet });
        } catch (e) { console.warn("pattern sound: reverb", e); }
        continue;
      }
      const fn = FX_APPLY[key];
      if (fn && typeof t.fxRack[fn] === "function") {
        try { t.fxRack[fn]({ ...cfg }); } catch (e) { console.warn("pattern sound: " + key, e); }
      }
    }
  }
  if (snap.lfoConfig) {
    // Walk the live matrix, not the snapshot: a key the snapshot leaves out is
    // one this sound doesn't modulate, and if the outgoing one did, it has to
    // be torn back down to the default rather than left running.
    const defaults = defaultLFOConfig();
    for (const key of Object.keys(t.lfoConfig)) {
      const want = snap.lfoConfig[key] ?? defaults[key];
      if (!want || same(t.lfoConfig[key], want)) continue;
      t.lfoConfig[key] = clone(want);
      touched = true;
      try { syncLFO(t, key); } catch (e) { console.warn("pattern sound: lfo " + key, e); }
    }
  }
  return touched;
}

/**
 * Write the live sound back to whichever store owns the pattern being left: the
 * pattern itself if it's locked, the track's shared sound if it isn't. Called
 * on the way out of a pattern, and before serializing — otherwise edits made
 * since the last switch would never reach what the save writes out.
 * @param {Track} t @param {number} idx
 */
export function flushPatternSound(t, idx) {
  const p = t?.patterns?.[idx];
  if (!p) return;
  if (p.soundLocked) p.sound = capturePatternSound(t);
  else t.baseSound = capturePatternSound(t);
}

/** Flush every track's current pattern. */
export function flushAllPatternSounds() {
  for (const t of state.tracks) flushPatternSound(t, state.activePattern);
}

/**
 * Recall the sound that owns a pattern. A locked pattern with no snapshot yet
 * inherits whatever is playing and keeps it from then on, so locking one
 * pattern never silently rewrites the ones you haven't visited.
 * @param {Track} t @param {number} idx
 * @returns {boolean} whether the live sound actually changed
 */
export function recallPatternSound(t, idx) {
  const p = t?.patterns?.[idx];
  if (!p) return false;
  if (p.soundLocked) {
    if (!p.sound) { p.sound = capturePatternSound(t); return false; }
    return applyPatternSound(t, p.sound);
  }
  // Unlocked: the track's shared sound. Absent until the first flush, in which
  // case the live sound already is the shared one.
  if (!t.baseSound) { t.baseSound = capturePatternSound(t); return false; }
  return applyPatternSound(t, t.baseSound);
}

/**
 * Lock or unlock this track's sound for one pattern.
 *
 * Locking keeps the sound you can currently hear — or, if this pattern was
 * locked before, brings back the sound it had, since unlocking never threw it
 * away. Unlocking hands the pattern back to the track's shared sound. There's
 * no undo in this app, so neither direction may destroy anything: the toggle
 * round-trips.
 * @param {Track} t @param {number} idx @param {boolean} on
 * @returns {boolean} whether the live sound changed as a result
 */
export function setPatternLock(t, idx, on) {
  const p = t?.patterns?.[idx];
  if (!p) return false;
  let changed = false;
  if (on) {
    p.soundLocked = true;
    // Make sure the unlocked patterns still have something to share before
    // this pattern wanders off with its own sound.
    if (!t.baseSound) t.baseSound = capturePatternSound(t);
    if (!p.sound) p.sound = capturePatternSound(t);
    else changed = applyPatternSound(t, p.sound);
  } else {
    // Keep the pattern's sound where it is — re-locking brings it back.
    p.soundLocked = false;
    if (t.baseSound) changed = applyPatternSound(t, t.baseSound);
  }
  refreshPatternLockUI(t);
  return changed;
}

/** Paint the p-lock button and the track's border for the active pattern. */
export function refreshPatternLockUI(t) {
  const on = patternLocked(t, state.activePattern);
  const btn = t?.el?.querySelector(".sq-track__plock");
  if (btn) btn.setAttribute("aria-pressed", String(on));
  t?.el?.classList.toggle("is-plocked", on);
}

/** Repaint every track's p-lock button — the state belongs to the pattern, so
 *  it changes under you on a switch. */
export function refreshAllPatternLockUI() {
  for (const t of state.tracks) refreshPatternLockUI(t);
}

/**
 * Repaint the sound controls after a recall. Kept apart from the recall itself
 * because the transport calls that one per track on a bar boundary: the audio
 * has to land on time, the sliders can catch up after.
 * @param {Track} t
 */
export function refreshPatternSoundUI(t) {
  if (!t?.el) return;
  syncTrackSoundUI(t);
  refreshFxPanelUI(t);
  renderModPanel(t, t._modPanelEl || t.el.querySelector(".sq-track__mod-panel"));
  refreshParamIndicators(t);
  updateGranularSpeedEnabled(t);
}
