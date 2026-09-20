// Integration seam for the Next.js shell.
//
// The engine has historically exposed nothing on `window` — save/load/share were
// wired straight to DOM buttons. To let the React shell (accounts, cloud songs,
// patch browser) drive the engine without touching the audio/UI code, we attach a
// small, stable API to `window.seqbaby` and fire a `seqbaby:ready` event once it's
// installed. Keep this surface intentional and additive.
import { loadPatches, savePatch, storePatches } from "./catalog.js";
import { canRedo, canUndo, redo, undo } from "./history.js";
import { flushJam, inJam, jamState, jamTogglePlay, receiveJamPatch, receiveJamPhase, receiveJamState, startJam, stopJam } from "./jam.js";
import { mergeSet } from "./liveSet.js";
import {
  applySet,
  applyTrackPatch,
  newSet,
  onExportSet,
  onImportSet,
  onLoadSet,
  onNewSet,
  onSaveSet,
  onShareSet,
  serializeSet,
  serializeTrackPatch,
} from "./session.js";
import { SET_VERSION, validateSet } from "./sessionFormat.js";
import { state } from "./state.js";

export function installAppApi() {
  if (typeof window === "undefined") return;
  const api = {
    version: 1,
    // session (song) snapshot <-> live engine
    serializeSet,
    applySet,
    // The same session, written onto the engine WITHOUT stopping it: the tracks
    // that changed are changed, the ones that appeared are added mid-bar, and
    // everything already playing goes on playing (liveSet.js). `applySet` is
    // how a song ARRIVES — it tears the session down and builds it again, which
    // is right for opening one and fatal for auditioning a change to the one
    // you are listening to.
    mergeSet,
    // blank the session -- back to the starter tracks with nothing written.
    // `newSet` resets; `onNewSet` is the flow around it (confirms first when
    // there is something to lose), which is what a button should call.
    newSet,
    onNewSet,
    // The serialized-session format version, and a check of a blob against it.
    // applySet validates on its own, so this is for a caller that wants to
    // refuse a blob before offering to load it -- note `version` above is the
    // version of THIS api surface, which is a different thing.
    setVersion: SET_VERSION,
    validateSet,
    // built-in flows (localStorage + share) — reused as-is for now
    onSaveSet,
    onLoadSet,
    onShareSet,
    onExportSet,
    onImportSet,
    // undo / redo over the whole session (history.js). Exposed so the shell's
    // own chrome can drive the same stack the engine's buttons do — there is
    // one history, not one per surface.
    undo,
    redo,
    canUndo,
    canRedo,
    // saved Tone.js patches (localStorage)
    loadPatches,
    storePatches,
    // add/replace a single patch and refresh the catalog + engine selects
    savePatch,
    // a track's whole sound as a portable patch (engine + params + fx + audio)
    serializeTrackPatch,
    applyTrackPatch,
    // A jam: several studios holding one song (jam.js). The shell owns the
    // room -- who is in it, the connection, the invite link -- and hands the
    // engine a `send`; the engine decides what an edit is and how a peer's
    // change is written onto a running sequencer. Nothing here knows what the
    // wire is.
    jam: {
      start: startJam,
      stop: stopJam,
      active: inJam,
      flush: flushJam,
      state: jamState,
      receivePatch: receiveJamPatch,
      receiveState: receiveJamState,
      // Playhead position: the play button calls this instead of togglePlay
      // while in a jam — play/stop stay this screen's own decision, but a
      // start lands on the step the room's beat is on rather than always on
      // step 0. A peer's own start tells this screen where that was. See the
      // playhead-position section of jam.js.
      togglePlay: jamTogglePlay,
      receivePhase: receiveJamPhase,
    },
    // live engine state (read-only handle; mutate via the functions above)
    get state() {
      return state;
    },
  };
  window.seqbaby = Object.assign(window.seqbaby || {}, api);
  try {
    window.dispatchEvent(new CustomEvent("seqbaby:ready"));
  } catch {}
  return window.seqbaby;
}
