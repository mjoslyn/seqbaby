// The engine's integration API, installed on window by public/js/appApi.js.
export {};

declare global {
  interface Window {
    seqbaby?: {
      version: number;
      serializeSet: () => unknown;
      applySet: (data: unknown) => {
        version: number;
        warnings: string[];
      } | void;
      /**
       * The same session, written onto the engine WITHOUT stopping it
       * (public/js/liveSet.js): tracks that changed change, tracks that
       * appeared join on the step everyone else is on, and everything already
       * playing goes on playing. `applySet` is how a song ARRIVES, and it
       * tears the session down to do it — right for opening one, fatal for
       * auditioning a change to the one you are listening to.
       *
       * Deliberately does not take `activePattern` from the blob: which
       * pattern you are looking at is the view, not the song.
       */
      mergeSet: (data: unknown) => {
        version: number;
        warnings: string[];
        added: number;
        removed: number;
        rebuilt: number;
      } | null;
      /** Format version of the blob serializeSet() writes (not `version`). */
      setVersion: number;
      validateSet: (data: unknown) => {
        ok: boolean;
        version: number;
        errors: string[];
        warnings: string[];
      };
      /** Blank the session (starter tracks, nothing written). No prompt. */
      newSet: () => void;
      /** The flow around newSet: asks first when there is work to lose. */
      onNewSet: () => Promise<void>;
      onSaveSet: () => void;
      onLoadSet: () => void;
      onShareSet: () => void;
      onExportSet: () => void;
      onImportSet: () => void;
      /** Step the session's undo history (public/js/history.js). Both return
       *  whether there was anything to step to. */
      undo: () => boolean;
      redo: () => boolean;
      canUndo: () => boolean;
      canRedo: () => boolean;
      loadPatches: () => Record<string, unknown>;
      storePatches: (obj: Record<string, unknown>) => void;
      savePatch: (name: string, config: unknown) => void;
      serializeTrackPatch: (track: unknown) => unknown;
      applyTrackPatch: (track: unknown, patch: unknown) => void;
      /**
       * A jam: several studios holding one song (public/js/jam.js). The shell
       * runs the room and hands the engine `send`; the engine watches for
       * edits, diffs them against what the room last agreed on, and lays a
       * peer's patch over this copy without stopping the transport.
       */
      jam: {
        /** Start telling `send` about edits; the session as it is now is the base. */
        start: (room: {
          send: (msg: { type: "patch"; patch: unknown } | { type: "playhead"; originMs: number; bpm: number }) => void;
        }) => void;
        stop: () => void;
        active: () => boolean;
        /** Send whatever is waiting to settle, now. */
        flush: () => void;
        /** The whole session, for a newcomer. */
        state: () => unknown;
        /** A peer's patch. `ok: false` means this copy is not the one it was
         *  written against: ask the sender for the whole session. */
        receivePatch: (patch: unknown, who?: { name?: string; id?: string }) => { ok: boolean; reason?: string };
        /** The room's whole session, on joining or after a refused patch. */
        receiveState: (session: unknown, who?: { name?: string; id?: string }) => { ok: boolean; reason?: string };
        /**
         * The play button's own action while in a jam: play/stop stay this
         * screen's own decision, but a start lands on the step the room's
         * beat is on rather than always on step 0.
         */
        togglePlay: () => void;
        /** A peer pressed play and is saying where the beat is. */
        receivePhase: (originMs: number, bpm: number) => void;
      };
      state: unknown;
    };
    // Set by EngineScripts' inline marker, which only executes when the studio
    // HTML is parsed from the document (i.e. not on a client-side navigation).
    // ScriptLoader reads it to decide whether to run its fallback boot.
    __seqbabyServerBoot?: number;
  }
}
