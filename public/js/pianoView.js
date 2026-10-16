/**
 * The piano view: the keyboard track's patterns as a full-height piano roll,
 * the fourth view beside groove, clips and arrange (views.js). The editor
 * itself is pianoEditor.js, shared with the groove view's `roll` button
 * (pianoRoll.js); this is the instance of it that lives in `#piano`, laid
 * out with every pattern the song uses end to end and switched on and off
 * by the view switcher. The track is the keyboard's (`state.activeTrackId`),
 * so the computer keys play what is shown. Under the roll, past the split's
 * handle (viewSplit.js), is that track's own card (trackDetail.js), as the
 * clip and arrangement views have: the instrument, its panels, its lanes.
 * The roll is the step editor here, so the card's step grid is hidden
 * (style.css), and the toolbar's `sound` window is left off: the card it
 * would open is already on screen.
 */

import { createPianoEditor } from "./pianoEditor.js";
import { state } from "./state.js";
import { makeTrackDetail } from "./trackDetail.js";
import { onViewChange } from "./views.js";
import { makeViewSplit } from "./viewSplit.js";

let editor = null;
let detail = null;

function currentTrack() {
  let t = state.tracks.find((o) => o.id === state.activeTrackId);
  if (!t || t.engineKey === "bus") t = state.tracks.find((o) => o.engineKey !== "bus") || null;
  return t;
}

export function installPianoView() {
  const root = document.getElementById("piano");
  if (!root) return;
  const panes = makeViewSplit(root, "piano");
  detail = makeTrackDetail(panes.bottom, () => editor?.schedulePaint());
  editor = createPianoEditor({
    root: panes.top,
    isOpen: () => state.view === "piano",
    track: currentTrack,
    scope: "all",
    chrome: { trackPicker: true, sound: false, loop: true, fold: false },
    onRender: (t) => { if (t) detail.show(t); else detail.release(); },
  });
  onViewChange((v) => { if (v === "piano") editor.open(); else { editor.close(); detail.release(); } });
}

/** Repaint on the next frame, if this is the open view. */
export function schedulePianoPaint() { editor?.schedulePaint(); }
