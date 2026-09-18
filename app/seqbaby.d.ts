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
      state: unknown;
    };
    // Set by EngineScripts' inline marker, which only executes when the studio
    // HTML is parsed from the document (i.e. not on a client-side navigation).
    // ScriptLoader reads it to decide whether to run its fallback boot.
    __seqbabyServerBoot?: number;
  }
}
