/**
 * The detail under the clip grid, the arrangement and the piano roll (the
 * bottom pane of each, viewSplit.js): the selected track's
 * own card — its instrument row, inline fx / mod / filter panels and the step
 * grid of the pattern it is on — which is the track's real `.sq-track`
 * element MOVED out of `#tracks` (hidden under those views) and put back in
 * order when another track is selected or the view closes, the way a panel
 * is reparented into a modal and the pattern bar's children into its phone
 * menu. Nothing is copied: every listener, every knob and every lookup by
 * `data-track-id` keeps working, and the step grid shows the clip the track
 * is on because the alias is the track's.
 *
 * One of these per view, each with its own element; only the open view's
 * holds a card, since a view releases its detail on the way out. A view's
 * own repaint must be `innerHTML` on a SIBLING of the detail, never on the
 * detail or its parent, or the card would be taken out of the document. The
 * card is re-seated after every repaint (`sync`) because a merge's
 * `setTrackOrder` (liveSet.js) appends every card back into `#tracks`.
 */

import { clipShadeColor, clipShades } from "./clipView.js";
import { announceClips, requestClipLaunch, stopClip } from "./clips.js";
import { PATTERN_COUNT } from "./constants.js";
import { patternSvg, svgUrl } from "./patternPicture.js";
import { setActiveTrack } from "./render.js";
import { state, trackSlot } from "./state.js";

// the track list's eight hues (style.css), for the card's stripe and borders
const HUES = [[35, "hsl(35 85% 58%)"], [232, "hsl(232 70% 68%)"], [297, "hsl(297 55% 68%)"], [120, "hsl(120 45% 52%)"],
  [253, "hsl(253 70% 72%)"], [318, "hsl(318 65% 68%)"], [155, "hsl(155 45% 50%)"], [275, "hsl(275 55% 70%)"]];

const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));
const rows = () => state.tracks.filter((t) => t.engineKey !== "bus");

/** A track's hue and colour, as its row in the views wears it. @returns {[number, string]} */
export function trackHue(t) {
  return HUES[Math.max(0, rows().indexOf(t)) % HUES.length];
}

/** A track's card goes back to its place in #tracks, by state.tracks order. */
export function restoreTrackCard(t) {
  const host = document.getElementById("tracks");
  if (!t?.el || !host || t.el.parentElement === host) return;
  const i = state.tracks.indexOf(t);
  const next = state.tracks.slice(i + 1).find((o) => o.el?.parentElement === host);
  if (next) host.insertBefore(t.el, next.el); else host.appendChild(t.el);
}

/**
 * @param {HTMLElement} container  the view's root; the detail is appended to it
 * @param {() => void} onChange   called when the selection changes (the view repaints)
 */
export function makeTrackDetail(container, onChange, { buses = false, clips = false } = {}) {
  // `buses`: the mix view's detail also shows a bus's card (a deck's bus is
  // where its eq, its rack and its lanes are).
  const ok = (t) => !!t && (buses || t.engineKey !== "bus");
  const el = document.createElement("div");
  el.className = "sq-track-detail";
  el.innerHTML = `<div class="sq-track-detail__title"></div>${clips ? `<div class="sq-track-detail__clips" role="group" aria-label="this track's clips"></div>` : ""}`;
  container.appendChild(el);
  const title = el.firstElementChild;
  // `clips`: the selected track's own clips under the title (the mix view,
  // which has no clip grid): every pattern it has notes in, drawn as the clip
  // view draws a cell. A click launches that clip on this track alone, so the
  // step grid below shows it; the one playing, clicked, stops.
  const clipRow = clips ? el.querySelector(".sq-track-detail__clips") : null;
  clipRow?.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-slot]");
    const t = trackById(selectedId);
    if (!b || !t) return;
    const slot = Number(b.dataset.slot);
    if (slot === trackSlot(t) && !t._clipOff && t._queuedSlot == null) stopClip(t);
    else requestClipLaunch(t, slot);
    announceClips();
    onChange?.();
  });
  function paintClips(t) {
    if (!clipRow) return;
    if (!t || t.engineKey === "bus") { clipRow.hidden = true; clipRow.innerHTML = ""; return; }
    const shades = clipShades(t);
    const slot = trackSlot(t);
    const cells = [];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = t.patterns?.[i];
      const filled = !!p?.steps?.some(Boolean);
      if (!filled && i !== slot && i !== t._queuedSlot) continue;
      const cls = ["sq-clip"];
      const shade = clipShadeColor(shades[i]);
      const svg = shades[i] >= 0 ? patternSvg(p, t.isDrumKit ? 36 : 60, { fat: 1.4 }) : "";
      const vars = [shade && `--clip-c:${shade}`, svg && `--notes:${svgUrl(svg)}`].filter(Boolean);
      if (filled) cls.push("is-filled");
      if (svg) cls.push("has-notes");
      if (i === slot && !t._clipOff) cls.push("is-now");
      if (i === t._queuedSlot) cls.push("is-queued");
      cells.push(`<button type="button" class="${cls.join(" ")}" data-slot="${i}"${vars.length ? ` style="${vars.join(";")}"` : ""} title="pattern ${i + 1}: play this clip on this track and edit it below${i === slot && !t._clipOff ? " (playing: click to stop it)" : ""}">${svg ? '<i class="sq-clip__notes"></i>' : ""}<span class="sq-clip__n">${i + 1}</span></button>`);
    }
    const html = cells.join("");
    clipRow.hidden = !html;
    if (clipRow._html !== html) { clipRow.innerHTML = html; clipRow._html = html; }
  }
  let selectedId = null;

  /** Select a track: its card comes in, the previous one goes home. */
  function select(t) {
    if (!ok(t)) return;
    const prev = trackById(selectedId);
    if (prev && prev !== t) restoreTrackCard(prev);
    selectedId = t.id;
    setActiveTrack(t);                 // the computer keyboard plays what is shown
    onChange?.();
  }

  /**
   * Put the card back in the list (the view is closing) — only if it is still
   * HERE: the view opening may already have taken it into its own detail,
   * since every view hears the switch and the order they hear it in is the
   * order they were installed.
   */
  function release() {
    const t = trackById(selectedId);
    if (t?.el?.parentElement === el) restoreTrackCard(t);
  }

  /**
   * After a repaint: a selection that still names a track (the first one
   * when none does, or the song changed under it), its card in the detail,
   * the title. Returns the track shown, for the view to mark its row.
   */
  function sync() {
    let t = trackById(selectedId);
    if (!ok(t)) {
      t = trackById(state.activeTrackId);
      if (!ok(t)) t = rows()[0] || null;
      selectedId = t?.id ?? null;
    }
    for (const o of state.tracks) if (o !== t && o.el?.parentElement === el) restoreTrackCard(o);
    if (!t?.el) { title.textContent = ""; paintClips(null); el.hidden = true; return null; }
    el.hidden = false;
    if (t.el.parentElement !== el) el.appendChild(t.el);
    const [hue, color] = trackHue(t);
    el.style.setProperty("--track-hue", String(hue));
    el.style.setProperty("--track-color", color);
    title.textContent = `${t._deck && t._deck !== "~" ? `deck ${t._deck.toUpperCase()} · ` : ""}${t.name || "track"} · pattern ${trackSlot(t) + 1}${t._clipOff ? " (stopped)" : ""}`;
    paintClips(t);
    return t;
  }

  /**
   * Show a track without selecting it (the piano view, whose track is the
   * keyboard's already): its card in the detail, as `sync` puts it.
   */
  function show(t) {
    selectedId = t?.id ?? null;
    return sync();
  }

  return { el, select, release, sync, show, get selectedId() { return selectedId; } };
}
