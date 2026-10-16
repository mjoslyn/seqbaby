/**
 * The piano view: the keyboard track's patterns as a full-height piano roll,
 * the fourth view beside groove, clips and arrange (views.js). The editor
 * itself is pianoEditor.js, shared with the groove view's `roll` button
 * (pianoRoll.js); this is the instance of it that lives in `#piano`, laid
 * out with every pattern the song uses end to end and switched on and off
 * by the view switcher. The track is the keyboard's (`state.activeTrackId`),
 * so the computer keys play what is shown.
 */

import { createPianoEditor } from "./pianoEditor.js";
import { state } from "./state.js";
import { onViewChange } from "./views.js";

let editor = null;

function currentTrack() {
  let t = state.tracks.find((o) => o.id === state.activeTrackId);
  if (!t || t.engineKey === "bus") t = state.tracks.find((o) => o.engineKey !== "bus") || null;
  return t;
}

export function installPianoView() {
  const root = document.getElementById("piano");
  if (!root) return;
  editor = createPianoEditor({
    root,
    isOpen: () => state.view === "piano",
    track: currentTrack,
    scope: "all",
    chrome: { trackPicker: true, sound: true, loop: true, fold: false },
  });
  onViewChange((v) => { if (v === "piano") editor.open(); else editor.close(); });
}

/** Repaint on the next frame, if this is the open view. */
export function schedulePianoPaint() { editor?.schedulePaint(); }
