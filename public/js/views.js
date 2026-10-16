/**
 * The view switcher: groove (the track list of step grids, the studio as it
 * always was), clips (tracks x the 32 slots as launchable clips, clipView.js),
 * arrange (a timeline of pattern blocks per track, arrangeView.js) and piano
 * (one track's pattern as a full piano roll, pianoView.js).
 *
 * One song, three pictures of it: switching views changes nothing about what
 * plays. The open view is `state.view`, a body class `view-<name>` (style.css
 * hides `#tracks` under the others and their sections under groove). It
 * is not remembered: the studio always opens on groove, and which view you
 * were in is not part of the music either. Desktop only in this cut: below 768px the switcher is
 * hidden and the groove view stands.
 *
 * Tab cycles the views, as it does in the software this is modelled on, but
 * only while nothing is focused: a Tab with a control focused is still the
 * browser's focus traversal.
 */

import { state } from "./state.js";

export const VIEWS = ["groove", "clips", "arrange", "piano"];
const MOBILE = "(max-width: 768px)";

/** @type {Array<(view: string) => void>} */
const listeners = [];

/** Be told when the view changes (the two views render on their way in). */
export function onViewChange(fn) { listeners.push(fn); }

export function isMobileLayout() {
  return typeof matchMedia === "function" && matchMedia(MOBILE).matches;
}

/** Open a view. Unknown names are ignored; on a phone only groove exists. */
export function setView(view) {
  if (!VIEWS.includes(view)) return;
  if (isMobileLayout()) view = "groove";
  // Opened while playing, the view takes the transport with it at the next
  // bar line (the mode a play press would have picked: transport.js reads
  // the flag there). A flag rather than a mode write here, so that a jam
  // peer's mode is never fought over: only a switch of THIS screen's view
  // asks, once.
  if (state.playing && view !== state.view) state._viewSwitched = true;
  state.view = view;
  for (const v of VIEWS) document.body.classList.toggle(`view-${v}`, v === view);
  document.querySelectorAll("#view-switch [data-view]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  });
  const clips = document.getElementById("clips");
  const arr = document.getElementById("arrange");
  const piano = document.getElementById("piano");
  if (clips) clips.hidden = view !== "clips";
  if (arr) arr.hidden = view !== "arrange";
  if (piano) piano.hidden = view !== "piano";
  for (const fn of listeners) fn(view);          // a repaint on the way in, even to the same view
}

export function installViews() {
  const sw = document.getElementById("view-switch");
  if (sw) {
    sw.addEventListener("click", (e) => {
      const b = e.target.closest("[data-view]");
      if (b) setView(b.dataset.view);
    });
  }
  // Tab cycles, shift-Tab backwards, only with nothing focused (a focused
  // control keeps the browser's Tab) and never inside vim's command line.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (state.vimMode === "command") return;
    if (isMobileLayout()) return;
    e.preventDefault();
    const i = VIEWS.indexOf(state.view);
    setView(VIEWS[(i + (e.shiftKey ? VIEWS.length - 1 : 1)) % VIEWS.length]);
  });
  // The studio opens on groove. The view used to be remembered per browser;
  // drop what an older build left behind.
  try { localStorage.removeItem("seqbaby.view.v1"); } catch {}
  setView("groove");
}
