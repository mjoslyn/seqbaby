// ---- the track switcher: go to a track from the pinned transport --------------
//
// A song is a long page of track cards, and the bars pinned over it (the
// account bar, the transport) had no way to say "take me to the bass". This
// is a select in the transport listing every track; picking one focuses it:
//
//   groove   the page scrolls so its card sits just under the pinned bars
//   clips / arrange / mix / piano   it becomes the view's selected track, so
//            its card is the one in the bottom pane (trackDetail.js hears
//            `seqbaby:focustrack`)
//
// and in every view it becomes the computer keyboard's track (setActiveTrack;
// a bus has no instrument, so a bus is shown but the keys stay where they
// were). Focus is where you are looking, not the song: nothing here is saved,
// undone or shared in a jam.
//
// The options are rebuilt when the select is about to open, so the list is
// never stale and nothing has to tell it a track was added or renamed; the
// value shown is kept on the active track by a few cheap events.

import { setStatus } from "./dom.js";
import { setActiveTrack } from "./render.js";
import { state } from "./state.js";

const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));

function labelOf(t, n) {
  const name = (t.name || "").trim() || "track";
  return `${n} ${name}${t.engineKey === "bus" ? " (bus)" : ""}${t.muted ? " · muted" : ""}`;
}

/** The tracks as the switcher lists them: the song's, then each deck's. */
export function switchGroups() {
  const groups = new Map();
  for (const t of state.tracks) {
    if (t._leaving || t._deck === "~" || t._masterBus) continue;
    const key = t._deck || (t._deckBus && t._deckBus !== "a" ? t._deckBus : "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

function rebuild(sel) {
  const groups = switchGroups();
  const many = groups.size > 1;
  const frag = document.createDocumentFragment();
  for (const [key, list] of groups) {
    const host = many ? document.createElement("optgroup") : frag;
    if (many) host.label = key ? `deck ${String(key).toUpperCase()}` : "deck A";
    list.forEach((t, i) => {
      const o = document.createElement("option");
      o.value = String(t.id);
      o.textContent = labelOf(t, i + 1);
      host.appendChild(o);
    });
    if (many) frag.appendChild(host);
  }
  sel.replaceChildren(frag);
  paint(sel);
}

/** Show the track in focus (the last one picked here, else the keyboard's). */
function paint(sel) {
  const id = sel._focusId != null && trackById(sel._focusId) ? sel._focusId : state.activeTrackId;
  if (id != null && sel.querySelector(`option[value="${CSS.escape(String(id))}"]`)) sel.value = String(id);
}

/** How far down the window the pinned bars reach. */
function pinnedBottom() {
  let b = 0;
  for (const el of document.querySelectorAll(".sq-transport, .sq-pattern-bar")) {
    const cs = getComputedStyle(el);
    const h = el.getBoundingClientRect().height;
    // where its bottom sits once it is stuck: its sticky offset plus its height
    if (cs.position === "sticky" && h) b = Math.max(b, (parseFloat(cs.top) || 0) + h);
  }
  return b;
}

/**
 * Put a track in focus: the keyboard's track, the open view's selected one,
 * and on screen.
 * @param {import("./types.js").Track} t
 */
export function focusTrack(t) {
  if (!t) return;
  setActiveTrack(t);
  try { window.dispatchEvent(new CustomEvent("seqbaby:focustrack", { detail: { id: t.id } })); } catch {}
  const el = t.el;
  if (state.view && state.view !== "groove") return;        // the view's detail took it
  if (!el || !el.getClientRects().length) { setStatus(`"${t.name || "track"}" is on a mix deck: open the mix view to see it`); return; }
  const top = el.getBoundingClientRect().top + window.scrollY - pinnedBottom() - 8;
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  window.scrollTo({ top: Math.max(0, top), behavior: calm ? "auto" : "smooth" });
  el.classList.remove("is-focus-flash");
  void el.offsetWidth;                                       // restart the animation
  el.classList.add("is-focus-flash");
  setTimeout(() => el.classList.remove("is-focus-flash"), 900);
}

export function initTrackSwitch() {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("track-switch"));
  if (!sel) return;
  const fresh = () => rebuild(sel);
  // just before it opens (a pointer, a key, a screen reader's focus)
  for (const ev of ["pointerdown", "focus", "keydown"]) sel.addEventListener(ev, fresh);
  sel.addEventListener("change", () => {
    const t = trackById(sel.value);
    if (!t) return;
    sel._focusId = t.id;
    focusTrack(t);
    sel.blur();                         // the computer keyboard is the piano again
  });
  window.addEventListener("seqbaby:activetrack", () => { sel._focusId = null; paint(sel); });
  for (const ev of ["seqbaby:setapplied", "seqbaby:newset", "seqbaby:songedited", "seqbaby:ready"]) window.addEventListener(ev, fresh);
  fresh();
}
