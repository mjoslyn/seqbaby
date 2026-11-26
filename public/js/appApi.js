// Integration seam for the Next.js shell.
//
// The engine has historically exposed nothing on `window` — save/load/share were
// wired straight to DOM buttons. To let the React shell (accounts, cloud songs,
// patch browser) drive the engine without touching the audio/UI code, we attach a
// small, stable API to `window.seqbaby` and fire a `seqbaby:ready` event once it's
// installed. Keep this surface intentional and additive.
import { setPatchBackend, setPatchList } from "./catalog.js";
import { canRedo, canUndo, hasUnsavedChanges, markSaved, redo, undo } from "./history.js";
import { flushJam, inJam, jamState, jamTogglePlay, receiveJamPatch, receiveJamPhase, receiveJamState, startJam, stopJam } from "./jam.js";
import { mergeSet } from "./liveSet.js";
import { primeAudioForIOS } from "./main.js";
import { startPlayback, stopPlayback } from "./transport.js";
import { launchClip, stopClip } from "./clips.js";
import {
  applySet,
  applyTrackPatch,
  confirmDiscard,
  hasUnsavedWork,
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
import { loadDeckA, setDeckAPlaying, setXfadeOn, ejectClipSong, ejectDeckA, ejectDeckB, ejectDeckTrack, matchDeckTempo, fadeToDeck, getDeck, keepBothDecks, landDeckB, loadDeckB, mergeDeckB, mixDecks, requestDeckScene, serializeDeckB, setDeckPlaying, setDeckXfade, setMixSource, setMixTempo, setTempoDeck, setXfade } from "./mix.js";
import { state } from "./state.js";
import { measureSet } from "./measure.js";
import { captureStart, closeReplay, forkPoint, loadReplay, openFork, pauseReplay, playReplay, replayState, seekReplay, setRecordState, toggleSetRecord } from "./setRecorder.js";
import { clearCues, cueConfig, setCue, toggleCue } from "./cue.js";
import { restoreLookAhead, stretchLookAhead } from "./lookahead.js";

export function installAppApi() {
  if (typeof window === "undefined") return;
  const api = {
    version: 1,
    // Recorded live sets (setRecorder.js): the studio's recorder, and the
    // replay the set player (app/set/[id]) drives. `forkPoint` is where a
    // paused replay is, as a starting point; `openFork` opens the studio on
    // one, armed to record a new set from it.
    // The cue (cue.js): this browser's headphone output. `set` takes any of
    // {mode: "off" | "split" | "multi" | "device", pair, level, blend, sink (an
    // output device's id, for "device")}; `toggle` cues a track.
    cue: { set: setCue, toggle: toggleCue, clear: clearCues, state: () => ({ ...cueConfig() }) },
    sets: {
      toggle: toggleSetRecord,
      state: setRecordState,
      capture: captureStart,
      load: loadReplay,
      play: playReplay,
      pause: pauseReplay,
      seek: seekReplay,
      close: closeReplay,
      replay: replayState,
      forkPoint,
      openFork,
    },
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
    // Unsaved changes: whether the song has moved since it was last saved,
    // shared, exported or opened (history.js), and the shell's half of that —
    // a save into the account is a save point, and opening another song over
    // this one asks first, the way `new` and leaving the page do.
    hasUnsavedChanges,
    hasUnsavedWork,
    markSaved,
    confirmDiscard,
    // Saved patches live in the account; the shell hands the engine its way
    // there and the list (app/PatchBay.tsx, catalog.js).
    setPatchBackend,
    setPatchList,
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
    // The transport, for a shell that plays a song without the studio's own
    // buttons: the homepage's song cards run this engine in a hidden frame
    // (app/home/enginePlayer.ts). `play` / `stop` are idempotent, unlike the
    // play button's toggle. `unlock` is the iOS priming the first gesture
    // does, for a caller whose gesture landed in another frame: call it
    // synchronously inside a click and a `play` stuck on a suspended context
    // goes through.
    play: () => startPlayback(),
    stop: () => stopPlayback(),
    unlock: primeAudioForIOS,
    // Play a session with the output disconnected and read every meter, a
    // section at a time (measure.js). It REPLACES this engine's session, so it
    // is for the hidden player frame only: the compose panel's listen.
    measure: measureSet,
    // A longer scheduling lookahead while something heavy shares this main
    // thread (lookahead.js): the hidden frame above building a song while
    // this studio plays.
    stretchLookAhead,
    restoreLookAhead,
    // Clips (clips.js), by track index: a slot on one track, now; and a
    // track's clip stopped. For the headless audition and the verify skill.
    launchClip: (i, slot) => launchClip(state.tracks[i], slot),
    stopClip: (i) => stopClip(state.tracks[i]),
    // The mix (mix.js): other songs on decks beside the open one, as many as
    // are loaded. A call that names no deck means the tempo's deck. The shell
    // hands over its way to the account's songs (app/MixSongs.tsx), as it
    // hands over the patch bay; the rest is for a caller with no mix view (the
    // verify skill, a headless audition).
    setMixSource,
    mix: {
      load: loadDeckB,
      eject: ejectDeckB,
      ejectA: ejectDeckA,
      ejectClipSong,
      land: landDeckB,
      keepBoth: keepBothDecks,
      play: setDeckPlaying,
      playA: setDeckAPlaying,
      scene: requestDeckScene,
      xfade: setXfade,
      xfadeOn: setXfadeOn,
      fadeTo: fadeToDeck,
      loadA: loadDeckA,
      tempo: setMixTempo,
      ejectTrack: (i) => ejectDeckTrack(state.tracks[i]),
      matchTempo: matchDeckTempo,
      deckXfade: setDeckXfade,
      tempoDeck: setTempoDeck,
      // A deck as a session, read whole and written in place: the compose
      // panel's turn on the other deck (app/ComposeChat.tsx). `loaded` says
      // whether there is a deck B to read.
      loaded: () => { const d = getDeck(); return !!d && !d.loading; },
      decks: () => mixDecks().map(d => ({ id: d.id, title: d.title, bpm: d.bpm, on: d.on, scene: d.scene, loading: d.loading })),
      serialize: serializeDeckB,
      merge: mergeDeckB,
    },
    // The open song's name as the shell shows it, so a bounce is named for
    // it (bounce.js). The shell owns which song is open; null means none.
    setSongName: (name) => {
      state.songName = typeof name === "string" && name.trim() ? name.trim() : null;
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
