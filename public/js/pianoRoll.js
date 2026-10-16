/**
 * The groove view's piano roll: a track's `roll` button opens the piano
 * editor (pianoEditor.js, the same one the piano view is) in a modal, on
 * that track alone and on the pattern it is on. It is made when the modal
 * opens and taken down when it closes (`openRollEditor` / `closeRollEditor`,
 * from stepEditor.js's openRollAsModal), so a track carries no listeners
 * while its roll is shut; while it is open it is `t._rollEditor`, and
 * `refreshRollIfOpen` is how the rest of the engine (the step grid, a
 * pattern transform, a session merge, a scale change) asks it to redraw.
 *
 * On a phone the groove view is the only view, so this is the piano roll
 * there: the editor's touch gestures (a pan tool, two fingers to scroll and
 * pinch, a finger held on a note for its step editor) are what make it one.
 */

import { createPianoEditor } from "./pianoEditor.js";
import { renderAutomationPanel } from "./render.js";

/** Build the editor into the track's roll panel, just reparented into its modal. */
export function openRollEditor(t, panel) {
  closeRollEditor(t);
  t._rollEditor = createPianoEditor({
    root: panel,
    isOpen: () => !!t._rollModal,
    track: () => t,
    scope: "slot",
    chrome: { trackPicker: false, sound: false, loop: false, fold: true },
  });
  t._rollEditor.open();
}

export function closeRollEditor(t) {
  t._rollEditor?.destroy();
  t._rollEditor = null;
}

/** Redraw the track's roll if its modal is open (on the next frame, never mid-drag). */
export function refreshRollIfOpen(t) {
  t._rollEditor?.schedulePaint();
}

export function refreshAutIfOpen(t) {
  // _autPanelEl follows the panel even when it's been moved into a modal.
  const panel = t._autPanelEl || t.el?.querySelector(".sq-track__aut-panel");
  if (!panel || panel.hidden) return;
  renderAutomationPanel(t, panel);
}
