// ---- jam activity: whose edit is that? -----------------------------------
//
// A jam's peers all edit one song; this says WHICH of them just touched
// WHAT, on screen — a colour-coded border, for a couple of seconds, on the
// track, the specific knob, and the pattern slot a peer's patch reached
// into. jam.js knows WHEN a peer's edit arrives and hands this module the
// same diff it applied (jamSync.js's patch, from `diffSession`), never the
// merged session: the diff already says exactly what moved, and re-deriving
// that from a before/after session would mean walking the whole tree twice.
//
// **The colour is recomputed, not sent.** JamPanel.tsx already gives every
// peer a colour purely from their id (`colorFor`, for the presence dots), so
// this carries the identical hash rather than threading a colour through
// `who` on every message — the same "no shared state, same answer
// everywhere" bargain the rest of the jam already strikes (rnd square's
// per-step hash, first-press phase origin). A border here and the dot beside
// a name in the jam panel are always the same colour without the two ever
// having to agree on it.
//
// **A diff path is read back into a DOM class by the same naming rule the
// markup already follows.** A track's `params.<key>` is almost always
// `p-<key>` in the DOM — `CONTROL_TARGETS` in paramTargets.js builds its own
// classes the same way — and an fx stage's `fxConfig.<stage>.<field>` is
// `fx-<stage>-<field>`; FIELD_CLASS below covers the handful of fields whose
// class doesn't spell out that way (the filter env, the shaper amount, the
// pitch shifter's semitones). A path that doesn't resolve to a class costs
// nothing beyond the track's own border, which every touched field lights
// up regardless of whether its own control could be found.
//
// **Identity, not index.** A patch's tracks are keyed by position in the
// session it was made against (jamSync.js's `patch.keys`), and the local
// track list can be in a different order by the time it arrives — a bus
// moved back down, say. So a touched track is looked up by the same
// identity the patch already carries (engine key + name), exactly what
// `alignTracks` (liveSet.js) matches a merge's incoming tracks by, not by
// replaying the patch's own index into `state.tracks`.
//
// Only per-track field diffs are read (`patch.d.obj.tracks.arr`) — a whole
// tracks array replaced outright (a track added or removed changes the
// count, so the diff can't be keyed by index) carries no fine-grained path
// to highlight from, and is left alone: the track list itself repaints, which
// is activity enough to see.

import { state } from "./state.js";

/** How long a touch stays lit. Long enough to read a name off a slow hover,
 *  short enough that a still track reads as still again quickly. */
const TOUCH_MS = 1800;

/** Filter fields whose DOM class doesn't spell out from the field name. */
const FILTER_FIELD_CLASS = {
  cutoff: "p-cutoff", reson: "p-reson", env: "p-envamt",
  attack: "p-envatk", decay: "p-envdec", sustain: "p-envsus", release: "p-envrel",
};

/** fx stage fields whose class suffix isn't the field name verbatim. */
const FX_FIELD_ALIASES = {
  shaper: { amount: "amt" },
  pitchshift: { semitones: "semi" },
};

/** Track-level (non-nested) fields with their own control. */
const TRACK_FIELD_CLASS = {
  name: "sq-track__name", engineKey: "sq-track__engine", length: "sq-track__len",
  speed: "sq-track__speed", glide: "sq-track__glide", outIndex: "sq-track__out",
};

/** A diff path (from the track's own root) to the DOM class of the control
 *  it belongs to, or null when there isn't one worth lighting up on its own —
 *  the track's border still gets it either way. @param {(string|number)[]} path */
function controlClassForPath(path) {
  const [root, key, sub] = path;
  switch (root) {
    case "params": return key ? `p-${key}` : null;
    case "filter": return key ? (FILTER_FIELD_CLASS[key] || null) : null;
    case "eq":     return key ? `p-eq-${key}` : null;
    case "comp":   return key ? (key === "source" ? "sq-comp__source" : `comp-${key}`) : null;
    case "euclid": return key ? `p-euc${key}` : null;
    case "chance": return key ? `p-chn${key}` : null;
    case "fxConfig": {
      if (!key || !sub) return null;
      const alias = FX_FIELD_ALIASES[key]?.[sub] || sub;
      return `fx-${key}-${alias}`;
    }
    default: return TRACK_FIELD_CLASS[root] || null;
  }
}

/** Walk a jamSync diff node (`{set}` / `{obj, del}` / `{arr}`), calling `cb`
 *  with the path to every leaf that changed. Mirrors `patchValue`'s shape,
 *  reading rather than applying it. @param {(string|number)[]} path */
function walkLeaves(node, path, cb) {
  if (!node) return;
  if (Object.prototype.hasOwnProperty.call(node, "set")) { cb(path); return; }
  if (node.obj) {
    for (const k of Object.keys(node.obj)) walkLeaves(node.obj[k], path.concat(k), cb);
    for (const k of node.del || []) cb(path.concat(k));
    return;
  }
  if (node.arr) {
    for (const i of Object.keys(node.arr)) walkLeaves(node.arr[i], path.concat(i), cb);
  }
}

/** The same hash JamPanel.tsx's `colorFor` uses for a peer's presence dot,
 *  so a border here is always that peer's own colour without the two
 *  ever sharing state. @param {string} id */
export function peerColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
}

// el -> { timer, prevTitle }. A touch is retriggerable: a peer still leaning
// on a knob (several settled patches in a row) just keeps the ring lit and
// resets the clock, rather than flickering off and on between them.
const touched = new WeakMap();

function touch(el, color, label) {
  if (!el) return;
  let rec = touched.get(el);
  if (!rec) {
    rec = { timer: null, prevTitle: el.title || "" };
    touched.set(el, rec);
  } else {
    clearTimeout(rec.timer);
  }
  el.style.setProperty("--jam-color", color);
  el.classList.add("is-jam-touched");
  if (label) el.title = label;
  rec.timer = setTimeout(() => {
    el.classList.remove("is-jam-touched");
    el.style.removeProperty("--jam-color");
    el.title = rec.prevTitle;
    touched.delete(el);
  }, TOUCH_MS);
}

/** The element a control's own ring belongs on — the knob if it has one
 *  (drawn as a circle), otherwise the field it sits in. */
function ringTarget(el) {
  return el.closest(".sq-knob") || el.closest(".sq-field, .sq-fx__ctl, .sq-contagion__f, .sq-hexop__f") || el;
}

function highlightControl(t, cls, color, label) {
  const el = t.el?.querySelector(`.${cls}`);
  if (el) touch(ringTarget(el), color, label);
}

function highlightPattern(idx, color, label) {
  const cell = document.getElementById("pattern-grid")?.children?.[idx];
  if (cell) touch(cell, color, label);
}

/**
 * A peer's patch just landed. Light up the track(s), the specific controls
 * and the pattern slot(s) it touched, in their colour.
 * @param {Object} patch from jamSync's diffSession (jam.js already has it)
 * @param {{name?: string, id?: string}} who
 */
export function highlightJamPatch(patch, who = {}) {
  const tracksArr = patch?.d?.obj?.tracks?.arr;
  if (!tracksArr) return;
  const color = who.id ? peerColor(who.id) : "var(--accent)";
  const name = who.name || "someone";
  const label = `${name} is editing this`;
  for (const [i, sub] of Object.entries(tracksArr)) {
    const key = patch.keys?.[i];
    if (!key) continue;
    const t = state.tracks.find((tr) => tr.engineKey === key[0] && tr.name === key[1]);
    if (!t) continue;
    let any = false;
    walkLeaves(sub, [], (path) => {
      any = true;
      if (path[0] === "patterns" && path.length > 1) {
        const idx = Number(path[1]);
        if (Number.isFinite(idx)) highlightPattern(idx, color, `${name} is editing pattern ${idx + 1}`);
        return;
      }
      const cls = controlClassForPath(path);
      if (cls) highlightControl(t, cls, color, label);
    });
    if (any) touch(t.el, color, label);
  }
}
