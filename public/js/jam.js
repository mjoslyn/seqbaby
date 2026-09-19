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
// What is deliberately NOT shared: the transport. Everyone hears their own
// copy, on their own clock — two browsers across a network cannot play in
// sample lockstep and pretending otherwise would be worse than not trying.
// And the view: which pattern you are looking at is yours (history.js drops
// `activePattern` from a snapshot for the same reason; jamSync strips it).

import { setStatus } from "./dom.js";
import { markExternalEdit, pinAutomated } from "./history.js";
import { applySessionPatch, diffSession } from "./jamSync.js";
import { deepCopy, mergeSet } from "./liveSet.js";
import { applySet, serializeSet } from "./session.js";
import { state } from "./state.js";

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
}

/** Stop. Edits after this are nobody's business but this studio's. */
export function stopJam() {
  clearTimeout(settleTimer);
  settleTimer = null;
  room = null;
  base = null;
}

export function inJam() { return !!room; }

/** The whole session, for a newcomer. Whatever is pending goes out first, so
 *  what they get and what the room is about to hear agree. */
export function jamState() {
  if (settleTimer) flushJam();
  return serializeSet();
}
