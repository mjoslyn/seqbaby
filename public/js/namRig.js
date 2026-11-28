// ---- the nam stage owns a guitar's or bass's amp and cab ----------------------
// A capture on the rack's nam amp stage IS an amp (and often the cab too), so
// a guitar or bass track feeding one plays as a DI: the instrument's own amp
// and cab are taken out of the worklet (`setRigBypass` on the voice, which
// sends amp di / cab di) and their rows on the panel are greyed with a line
// saying why. Nothing stored moves: `t.params` keeps the amp and cab that were
// picked, so taking the capture off, or turning its wet to zero, puts them
// back exactly. Decided by `namOwnsRig`: the engine is the guitar or the bass,
// and some nam stage (the stage or a copy, `nam#2`) has a capture and a wet
// above zero, which is when the rack wires it into the chain.
//
// Called from `refreshPanelBadges` (every panel edit, a session or patch load,
// a p-lock recall) and from `routeTrackOutput` (every voice or rack rebuilt).

import { fxInstanceIds } from "./constants.js";

const RIG_ENGINES = new Set(["dm:guitar", "dm:bass"]);

/** Whether this track's nam stage stands in for its instrument's amp and cab. */
export function namOwnsRig(t) {
  if (!t || !RIG_ENGINES.has(t.engineKey)) return false;
  const fx = t.fxConfig || {};
  const ids = ["nam", ...fxInstanceIds(fx).filter((id) => id.startsWith("nam#"))];
  return ids.some((id) => {
    const c = fx[id];
    return !!(c && c.model && Number(c.wet) > 0);
  });
}

const NOTE = "the nam amp stage is this track's amp: the guitar plays into it as a DI. Turn its wet down or unload the capture to use these again.";

/** Make the voice and the panel agree with `namOwnsRig`. Cheap when nothing changed. */
export function syncNamRig(t) {
  if (!t) return;
  const on = namOwnsRig(t);
  if (t.voice && t.voice._rigDi !== on) t.voice.setRigBypass?.(on);
  // the panel may have been moved into a modal, so look wherever the track's controls are
  const roots = new Set([t.el]);
  if (typeof document !== "undefined") document.querySelectorAll(`[data-track-id="${t.id}"]`).forEach((r) => roots.add(r));
  for (const root of roots) {
    root?.querySelectorAll?.("[data-rig]").forEach((row) => {
      if (row.classList.contains("is-nam-owned") === on) return;
      row.classList.toggle("is-nam-owned", on);
      row.querySelectorAll("input, select").forEach((el) => { el.disabled = on; });
      if (on) row.setAttribute("title", NOTE.replace("the guitar", t.engineKey === "dm:bass" ? "the bass" : "the guitar"));
      else row.removeAttribute("title");
    });
  }
}
