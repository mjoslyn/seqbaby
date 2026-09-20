// ---- jam: several studios, one song -----------------------------------
//
// A jam is a room whose members all hold the same session and hear about each
// other's edits as they happen. This is the engine half of it: WHEN this
// studio has something to tell the room, and HOW a peer's change is written
// onto a running sequencer. The room itself — who is in it, the connection,
// the invite link — is the shell's (app/JamPanel.tsx), which hands this module
// a `send` and calls `receive` with what comes back. Nothing here knows what
// the wire is.
//
// Three things decide the shape of this file, and all three were already
// decided elsewhere.
//
// **Nothing is instrumented, for history.js's reason.** The undo stack watches
// the events a human interaction ends in and asks the session whether it
// changed, so that an edit made anywhere in fifty modules is undoable without
// knowing history.js exists. A jam has exactly that problem — every one of
// those edits has to reach the room — and takes exactly that answer: the same
// event list, the same settle, `serializeSet` as the thing compared. Whatever
// changes the session gets broadcast, including things nobody thought of as
// edits: a song opened from the menu, `new`, an undo, a compose turn kept.
//
// **What goes on the wire is a diff** (jamSync.js), against the session the
// room last agreed on, and a peer's diff is laid over this studio's copy and
// written through `mergeSet` (liveSet.js): the session format onto a RUNNING
// engine, so a peer adding a track lands on the step everyone else is on and
// nothing that was playing stops. `applySet` is used once, when a newcomer
// takes the room's whole session on arrival — the one time a teardown is right.
//
// **A peer's edit is an undo step here**, labelled with their name
// (`markExternalEdit`). Not because undoing someone else's work is a feature,
// but because leaving it OUT of the stack would make the next local edit's
// entry carry it, and undoing that would take theirs back with it silently.
// On the stack it is a step you can see the name of; and an undo of it is an
// edit like any other, so it goes back out to the room. There is one song.
//
// **Play and stop stay each person's own decision** — pressing them here
// never asks anyone else's screen to start or stop. What IS shared is WHERE:
// pressing play lands this screen's step 0 on whatever step the room's beat
// would be on if it had been running continuously since the room's last
// press of play, rather than always on the pattern's own step 0. Two people
// pressing play a bar apart hear the same step at the same time instead of
// two bars out of phase with each other. See the playhead-position section
// below. There is still no shared clock: each browser renders the sequence
// on its own AudioContext from the moment IT presses play, at its own
// sample rate — this lines up which STEP is playing, not the audio samples,
// and two browsers across a network sharing a sample clock is exactly as
// impossible as it always was.
//
// Not shared: the view. Which pattern you are looking at is yours
// (history.js drops `activePattern` from a snapshot for the same reason;
// jamSync strips it).

import { setStatus } from "./dom.js";
import { markExternalEdit, pinAutomated } from "./history.js";
import { highlightJamPatch } from "./jamActivity.js";
import { applySessionPatch, diffSession } from "./jamSync.js";
import { currentBpm } from "./lfo.js";
import { deepCopy, mergeSet } from "./liveSet.js";
import { applySet, serializeSet } from "./session.js";
import { state } from "./state.js";
import { startPlayback, stopPlayback } from "./transport.js";

/** As history.js's: long enough for a gesture to finish, short enough that the
 *  room sees a step painted while you are still painting the next. */
const SETTLE_MS = 420;

/** The events an interaction ends in — history.js's list, for its reasons. */
const EVENTS = ["pointerup", "pointercancel", "click", "keyup", "change", "input", "drop"];

let room = null;        // { send } while in a jam
let base = null;        // the session the room last agreed on, as this studio saw it
let applying = false;   // a peer's change is being written: not an edit of ours
let settleTimer = null;
let started = false;

/** The live session, minus the view, pinned as history pins it: a field an
 *  automation lane rewrites every step is not something to tell the room. */
function snapshot(prev) {
  const snap = serializeSet();
  delete snap.activePattern;
  return pinAutomated(prev, snap);
}

// ---- telling the room ---------------------------------------------------

/** Compare the session with what the room has and send the difference. */
export function flushJam() {
  clearTimeout(settleTimer);
  settleTimer = null;
  if (!room || applying) return;
  const next = snapshot(base);
  const patch = diffSession(base, next);
  if (!patch) return;
  base = next;
  room.send({ type: "patch", patch });
}

function scheduleFlush() {
  if (!room || applying) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(flushJam, SETTLE_MS);
}

function onInteraction(e) {
  if (!room || applying) return;
  if (e.target instanceof Element && e.target.closest(".sq-jam-ignore")) return;
  scheduleFlush();
}

// A whole session arriving — opened from the menu, `new`, a share link — is
// something the room has to hear too. Unless it is the room's own session
// arriving (`applying`), in which case it is what the room already knows.
function onSessionArrived() {
  if (!room || applying) return;
  scheduleFlush();
}

function install() {
  if (started) return;
  started = true;
  for (const ev of EVENTS) document.addEventListener(ev, onInteraction, true);
  window.addEventListener("seqbaby:setapplied", onSessionArrived);
  window.addEventListener("seqbaby:newset", onSessionArrived);
}

// ---- hearing from it ----------------------------------------------------

/**
 * A peer's patch. Anything of ours still waiting to settle is sent FIRST, so
 * it is diffed against the base it was made on rather than against a session
 * with the peer's change already in it (history.js's `undo` banks a pending
 * gesture for the same reason).
 *
 * @param {Object} patch from jamSync's diffSession
 * @param {{name?: string, id?: string}} [who]
 * @returns {{ok: boolean, reason?: string}} `ok: false` means this studio's
 *   copy is not the one the patch was written against, and the shell should
 *   ask the sender for the whole session.
 */
export function receiveJamPatch(patch, who = {}) {
  if (!room) return { ok: false, reason: "not in a jam" };
  if (settleTimer) flushJam();
  const r = applySessionPatch(base, patch);
  if (!r.ok) return { ok: false, reason: r.reason };
  writeFromPeer(r.session, who, false);
  // Read from the patch itself, not the merged result: the diff already says
  // exactly which fields moved, which is what a colour-coded border needs
  // and a before/after session would mean re-deriving.
  highlightJamPatch(patch, who);
  return { ok: true };
}

/**
 * The room's whole session, on joining it (or after a refused patch). Written
 * with `applySet`: this is a song ARRIVING, and the teardown is the point.
 */
export function receiveJamState(session, who = {}) {
  if (!room) return { ok: false, reason: "not in a jam" };
  clearTimeout(settleTimer);
  settleTimer = null;
  writeFromPeer(session, who, true);
  return { ok: true };
}

function writeFromPeer(session, who, whole) {
  applying = true;
  try {
    if (whole) {
      applySet(deepCopy(session));
    } else {
      try {
        mergeSet(session);
      } catch (e) {
        // A merge that throws partway leaves a session that is half of each;
        // a rebuild from the blob is the only state anybody can name.
        console.error("[seqbaby] jam: merge failed, rebuilding the session", e);
        const blob = deepCopy(session);
        blob.activePattern = state.activePattern;
        applySet(blob);
      }
    }
  } finally {
    applying = false;
  }
  // The engine, read back, is the only honest answer to what the room now
  // holds here: the merge normalizes (clamps, drops a send that would feed
  // back, moves the buses down), and anything it decided not to write must
  // not be sent back out as an edit of ours.
  base = snapshot(base);
  const name = who.name || "someone";
  setStatus(whole ? `jam: took the room's session from ${name}` : `jam: ${name}`);
  // On the undo stack, in the peer's name; coalesced per peer so a drag of
  // theirs arriving as several patches is one step.
  markExternalEdit(name, who.id ? `jam:${who.id}` : null);
}

// ---- playhead position ---------------------------------------------------
//
// A virtual beat that keeps going whether or not anyone's transport is
// actually running: `phase` is the wall-clock instant (`originMs`) that
// would be step 0 of it, at the bpm it was set at. Whoever presses play
// computes the step that virtual beat is on RIGHT NOW and starts there
// instead of at 0, then re-broadcasts the same origin — unchanged — so a
// later joiner still lands on the beat rather than on whenever they last
// heard about it. The first press in a room (or the first since anyone
// last heard a broadcast) has no `phase` yet and starts at step 0 like solo
// play always has, which is what then seeds it for everyone after.
//
// This says nothing about WHEN someone presses play or stop, only where
// their pattern begins if they do — a stale `phase` from a room that has
// been silent for an hour still answers "which step", it just isn't a step
// anyone is currently hearing, which is fine: the point is that two people
// who both press play land in the same place in the pattern, not that
// pressing play summons a beat that was never there.

let phase = null; // {originMs, bpm} | null

/** The step the room's virtual beat is on right now, or 0 with none known. */
function currentPhaseTick() {
  if (!phase || !(phase.bpm > 0)) return 0;
  const stepDur = 60 / phase.bpm / 4;
  return Math.max(0, Math.floor((Date.now() - phase.originMs) / 1000 / stepDur));
}

/** Record where step 0 of the virtual beat falls, from a start at `tick`. */
function setPhaseFromTick(tick, bpm) {
  const stepDur = 60 / bpm / 4;
  phase = { originMs: Date.now() - tick * stepDur * 1000, bpm };
}

/**
 * The play button's own action, while in a jam: start (or stop) right here,
 * right away — nobody else's screen is asked to do anything — landing a
 * start on the room's current step rather than always on step 0, and
 * telling the room where that step came from so a later joiner can too.
 */
export function jamTogglePlay() {
  if (!room) return;
  if (state.playing) { stopPlayback(); return; }
  const tick = currentPhaseTick();
  startPlayback({ tick }).then(() => {
    // Not `if (!state.playing) return` alone: ensureAudio() is awaited
    // inside startPlayback, and leaving the jam mid-await is a room this
    // screen no longer has anything to tell.
    if (!room || !state.playing) return;
    const bpm = currentBpm();
    setPhaseFromTick(tick, bpm);
    room.send({ type: "playhead", originMs: phase.originMs, bpm });
  });
}

/**
 * A peer pressed play and is telling the room where the beat is. Recorded
 * for the next START on this screen — never touches a transport already
 * running here.
 * @param {number} originMs @param {number} bpm
 */
export function receiveJamPhase(originMs, bpm) {
  if (!room || !(bpm > 0)) return;
  phase = { originMs, bpm };
}

// ---- the room's edge ----------------------------------------------------

/**
 * Start telling `send` about edits. The session as it is now becomes the
 * base — what this studio believes the room holds — so the first patch
 * describes the first edit, not the whole song. A newcomer's base is replaced
 * the moment the room's session arrives (`receiveJamState`).
 * @param {{send: (msg: Object) => void}} r
 */
export function startJam(r) {
  install();
  room = r;
  base = snapshot(null);
  phase = null;
}

/** Stop. Edits after this are nobody's business but this studio's. */
export function stopJam() {
  clearTimeout(settleTimer);
  settleTimer = null;
  room = null;
  base = null;
  phase = null;
}

export function inJam() { return !!room; }

/** The whole session, for a newcomer. Whatever is pending goes out first, so
 *  what they get and what the room is about to hear agree. */
export function jamState() {
  if (settleTimer) flushJam();
  return serializeSet();
}
