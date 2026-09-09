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
      /** The flow around newSet: confirms first when there is work to lose. */
      onNewSet: () => void;
      onSaveSet: () => void;
      onLoadSet: () => void;
      onShareSet: () => void;
      onExportSet: () => void;
      onImportSet: () => void;
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
