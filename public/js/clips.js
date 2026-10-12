/**
 * Clips: a pattern slot launched on ONE track.
 *
 * The pattern bar switches every track together (`switchPattern`, state.js):
 * that is a scene. A clip is the same move on one track — the bass onto slot
 * 5 while the drums stay on slot 2 — which is what the clip view's grid
 * launches and what the arrangement plays per track. The slot a track is on is
 * `trackSlot(t)` (`t._patternIdx`); the scene stays `state.activePattern`, and
 * a scene launch puts every track back on it.
 *
 * Nothing here is saved: like `activePattern`, where each track is and whether
 * it is stopped is performance state. A load puts every track on the scene.
 *
 * The transport imports this (its bar-line commits and the arrangement's block
 * switches), state.js does not, so there is no cycle: this module leans on
 * state.js's alias, paint queue and patternSound.js's two stores.
 */

import { PATTERN_COUNT } from "./constants.js";
import { arrangementBars, blockAt, writeBar } from "./arrangement.js";
import { stepsPerBarForMeter, transportMeter } from "./meter.js";
import { setStatus } from "./dom.js";
import { flushPatternSound, recallPatternSound } from "./patternSound.js";
import { releaseSilencedTracks } from "./signal.js";
import { renderPatternGrid } from "./patternBar.js";
import { aliasPattern, paintTrackPatternUINow, paintTrackSlotBadge, queueTrackPaint, state, trackSlot } from "./state.js";

/**
 * Land a track's step counter where it would be had it counted from global
 * tick 0 to `ticks`: `trackTick` runs at `speed` steps per global tick, and a
 * track slower than the transport starts its accumulator one tick short of
 * full so its first step fires ON the downbeat rather than a tick after it.
 * The one place this arithmetic lives — a play press seeds every track from
 * the start tick, a bar-line switch from 0, an arrangement block from where in
 * the block the transport is.
 * @param {Track} t @param {number} ticks
 */
export function seedTrackCount(t, ticks) {
  const sp = Math.max(0.0001, t.speed ?? 1);
  t.trackTick = Math.round(Math.max(0, ticks) * sp);
  t.speedAccum = sp < 1 ? 1 - sp : 0;
}

/** A pattern switched in on a bar line starts the track from its first step. */
export function restartTrackCount(t) { seedTrackCount(t, 0); }

/** Something about which clips are playing or queued changed: the views repaint. */
export function announceClips() {
  window.dispatchEvent(new CustomEvent("seqbaby:clips"));
}

/**
 * Put track `t` on pattern `slot`, now. The p-lock stores are kept honest
 * exactly as a scene switch keeps them (flush the slot being left, recall the
 * one entered), the stopped flag clears, and the track repaints — on the
 * deferred one-track-per-task queue when the transport asks (`deferUi`), since
 * this runs inside the scheduler callback on a bar line. `restart` begins the
 * pattern from its first step, which a bar-line launch wants and a mid-bar
 * click does not (a click keeps counting, as the pattern bar's does).
 * @param {Track} t @param {number} slot
 * @param {{restart?: boolean, deferUi?: boolean}} [opts]
 * @returns {boolean} whether the track moved to another slot
 */
export function launchClip(t, slot, { restart = false, deferUi = false } = {}) {
  if (!t || !Number.isInteger(slot) || slot < 0 || slot >= PATTERN_COUNT) return false;
  const was = trackSlot(t);
  const moved = was !== slot;
  if (moved) flushPatternSound(t, was);
  t._queuedSlot = null;
  t._clipOff = false;
  if (moved) {
    aliasPattern(t, slot);
    if (recallPatternSound(t, slot)) t._soundUiStale = true;
  }
  if (restart) restartTrackCount(t);
  if (deferUi) queueTrackPaint(t); else paintTrackPatternUINow(t);
  announceClips();
  return moved;
}

/**
 * The clip view's click: honour the switch mode the pattern bar honours. In
 * "finish" mode while playing the clip waits for the bar line (the transport
 * commits `t._queuedSlot`); otherwise it lands now.
 * @param {Track} t @param {number} slot
 */
export function requestClipLaunch(t, slot) {
  if (!t || slot < 0 || slot >= PATTERN_COUNT) return;
  if (state.patternSwitchMode === "finish" && state.playing) {
    t._queuedSlot = slot;
    renderPatternGrid();
    announceClips();
    setStatus(`${t.name?.trim() || "track"}: pattern ${slot + 1} queued`);
    return;
  }
  launchClip(t, slot);
  setStatus(`${t.name?.trim() || "track"}: pattern ${slot + 1}`);
}

/**
 * Stop a track's clip: it plays nothing until a clip is launched on it or the
 * scene is switched. Its notes are withheld as mute withholds them (the
 * transport checks `_clipOff` where it checks `muted`), so a drone's latched
 * note is let go the same way.
 * @param {Track} t
 */
export function stopClip(t) {
  if (!t || t.engineKey === "bus") return;
  t._clipOff = true;
  t._queuedSlot = null;
  releaseSilencedTracks();
  paintTrackPatternUINow(t);
  announceClips();
  setStatus(`${t.name?.trim() || "track"}: stopped`);
}

/** Stop every track's clip. */
export function stopAllClips() {
  for (const t of state.tracks) if (t.engineKey !== "bus") { t._clipOff = true; t._queuedSlot = null; }
  releaseSilencedTracks();
  for (const t of state.tracks) paintTrackPatternUINow(t);
  announceClips();
  setStatus("all clips stopped");
}

/**
 * The bar-line commit of every clip waiting in finish mode. The scene queue
 * wins when both are set: a scene launch is every track together, and
 * `switchPattern` clears the per-track queue on its way.
 */
export function commitQueuedClips() {
  for (const t of state.tracks) {
    const slot = t._queuedSlot;
    if (slot == null) continue;
    launchClip(t, slot, { restart: true, deferUi: true });
  }
}

/** Forget every queued clip (a stop). */
export function clearQueuedClips() {
  for (const t of state.tracks) t._queuedSlot = null;
}

// ---- arrange mode ----------------------------------------------------------
//
// `patternMode === "arrange"`: every track plays its own timeline of blocks
// (arrangement.js). The transport keeps one ruler position, `state.arrBar`,
// in bars of slot 0's meter (transportMeter), advanced on every bar line and
// wrapped at the arrangement's end; at each bar every track is put on the
// block covering it, or stopped in a gap.

/** How long the arrangement is, in bars of the ruler. Never under one. */
export function arrangeLength() { return arrangementBars(state.tracks); }

/**
 * Put every track where the arrangement says it is on ruler bar
 * `state.arrBar`. A block's first bar (or a block other than the one the
 * track is on) launches its pattern from step 0, as a chain section does; a
 * bar inside a block the track is already on leaves it looping. A gap stops
 * the track. `tickInBlock`, when given, is where in the block the transport
 * is starting (a jam joining mid-song), so the pattern lands mid-way too.
 * @param {{deferUi?: boolean, tickInBar?: number}} [opts]
 */
export function applyArrangementBar({ deferUi = true, tickInBar = 0 } = {}) {
  const bar = state.arrBar;
  for (const t of state.tracks) {
    if (t.engineKey === "bus") continue;
    const b = blockAt(t.arrangement || [], bar);
    if (!b) {
      if (!t._clipOff) { t._clipOff = true; t._queuedSlot = null; if (deferUi) queueTrackPaint(t); else paintTrackPatternUINow(t); }
      continue;
    }
    if (b.start === bar || b.slot !== trackSlot(t) || t._clipOff) {
      launchClip(t, b.slot, { restart: true, deferUi });
      // a start inside the block (a jam's shared beat): count from where the
      // block began, not from its first step
      const barLen = stepsPerBarForMeter(transportMeter());
      const into = (bar - b.start) * barLen + tickInBar;
      if (into > 0) seedTrackCount(t, into);
    }
  }
  announceClips();
}

/**
 * The bar line in arrange mode: the next bar, wrapping at the end, and every
 * track onto its block. `_arrOrigin` is moved on the wrap so the view's
 * playhead keeps reading the ruler position off the global tick.
 */
export function advanceArrangement() {
  const len = arrangeLength();
  if (state._arrJump != null) {
    // a jump asked for mid-bar (the ruler clicked while playing) lands here,
    // on the bar line, as a queued clip does
    state.arrBar = Math.min(len - 1, Math.max(0, state._arrJump));
    state._arrJump = null;
  } else {
    state.arrBar += 1;
    if (state.arrBar >= len) state.arrBar = 0;
  }
  // the origin follows, so the view maps the tick being heard to this bar
  state._arrOrigin = state.tick - state.arrBar * stepsPerBarForMeter(transportMeter());
  applyArrangementBar({ deferUi: true });
}

/**
 * Start the arrangement from a bar: the marker a play press starts from, and
 * while it plays, a jump at the next bar line. Not saved: where you start
 * from is a view's state, like the scene.
 * @param {number} bar
 */
export function setArrangeStart(bar) {
  const b = Math.max(0, Math.round(bar));
  state.arrStartBar = b;
  if (state.playing && state.patternMode === "arrange") state._arrJump = b;
  announceClips();
}

/**
 * Where a play press lands in the arrangement: `startTick` (0, or a jam's
 * shared beat) plus the start marker's bars, modulo the arrangement's
 * length, as a ruler bar and the ticks into it. Every track is put on its
 * block from there. `_arrOrigin` is the global tick that would have been
 * ruler bar 0, which a marker puts before the start (negative, fine: it is
 * only ever subtracted from a tick).
 * @param {number} startTick
 * @param {{startBar?: number}} [opts]
 */
export function seedArrangement(startTick, { startBar = 0 } = {}) {
  const barLen = stepsPerBarForMeter(transportMeter());
  const loop = arrangeLength() * barLen;
  const at = startTick + Math.max(0, startBar) * barLen;
  const inLoop = ((at % loop) + loop) % loop;
  state.arrBar = Math.floor(inLoop / barLen);
  state._arrOrigin = startTick - inLoop;
  state._arrJump = null;
  applyArrangementBar({ deferUi: false, tickInBar: inLoop % barLen });
}

// ---- recording ----------------------------------------------------------
//
// With `state.arrRecord` armed, every bar line in a non-arrange mode writes
// what each track just played — its slot, or nothing if stopped or muted —
// onto its timeline at `state.arrRecBar`: launching clips over eight bars
// leaves eight bars of arrangement. It records over whatever those bars held.

/**
 * Arm or disarm recording. Armed before play, it writes from bar 0; armed
 * while playing, from the bar the transport is in (bars since play began),
 * so the recording lands where in the song you are.
 */
export function setArrangeRecord(on) {
  state.arrRecord = !!on;
  if (on) state.arrRecBar = state.playing ? Math.floor(state.tick / stepsPerBarForMeter(transportMeter())) : 0;
  announceClips();
}

/** The bar line's write, BEFORE any switch, so the slot written is the one that sounded. */
export function recordArrangementBar() {
  if (!state.arrRecord || state.patternMode === "arrange") return;
  for (const t of state.tracks) {
    if (t.engineKey === "bus") continue;
    const slot = (t._clipOff || t.muted) ? null : trackSlot(t);
    t.arrangement = writeBar(t.arrangement || [], state.arrRecBar, slot);
  }
  state.arrRecBar += 1;
  announceClips();
}

export { paintTrackSlotBadge };
