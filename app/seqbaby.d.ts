// The engine's integration API, installed on window by public/js/appApi.js.
export {};

declare global {
  interface Window {
    seqbaby?: {
      version: number;
      serializeSet: () => unknown;
      applySet: (data: unknown) => void;
      onSaveSet: () => void;
      onLoadSet: () => void;
      onShareSet: () => void;
      onExportSet: () => void;
      onImportSet: () => void;
      loadPatches: () => Record<string, unknown>;
      storePatches: (obj: Record<string, unknown>) => void;
      state: unknown;
    };
  }
}
