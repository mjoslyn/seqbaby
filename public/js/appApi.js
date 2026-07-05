// Integration seam for the Next.js shell.
//
// The engine has historically exposed nothing on `window` — save/load/share were
// wired straight to DOM buttons. To let the React shell (accounts, cloud songs,
// patch browser) drive the engine without touching the audio/UI code, we attach a
// small, stable API to `window.seqbaby` and fire a `seqbaby:ready` event once it's
// installed. Keep this surface intentional and additive.
import { loadPatches, savePatch, storePatches } from "./catalog.js";
import {
  applySet,
  applyTrackPatch,
  onExportSet,
  onImportSet,
  onLoadSet,
  onSaveSet,
  onShareSet,
  serializeSet,
  serializeTrackPatch,
} from "./session.js";
import { state } from "./state.js";

export function installAppApi() {
  if (typeof window === "undefined") return;
  const api = {
    version: 1,
    // session (song) snapshot <-> live engine
    serializeSet,
    applySet,
    // built-in flows (localStorage + share) — reused as-is for now
    onSaveSet,
    onLoadSet,
    onShareSet,
    onExportSet,
    onImportSet,
    // saved Tone.js patches (localStorage)
    loadPatches,
    storePatches,
    // add/replace a single patch and refresh the catalog + engine selects
    savePatch,
    // a track's whole sound as a portable patch (engine + params + fx + audio)
    serializeTrackPatch,
    applyTrackPatch,
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
