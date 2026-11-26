/**
 * The mix view: the fifth view, a mixer.
 *
 * With one song it is a mixing desk for it: a channel strip per track (fader,
 * pan, mute, solo, a meter) and one per fx bus. With a second song loaded onto
 * deck B (mix.js) it is two desks side by side with a crossfader between them:
 * each deck's tracks, the deck's own bus strip (fader, a three-band eq, a
 * filter), a row of that deck's patterns to switch between, and the controls
 * that end the mix: land deck B as the song, keep both as one song, or eject.
 *
 * **Every control here is a skin over a control the track already has.** A
 * strip's fader is a range input whose `input` event writes the track's own
 * `.p-vol` and dispatches ITS `input` event, so the handler that already
 * exists does the work and a move is an edit like any other: the stored
 * sound, undo, a jam, knob recording and a lane all see it. Mute and solo
 * `.click()` the track's own buttons, as the clip view's do. The strips read
 * the real controls back on the meter's frame, so a fader follows its knob
 * moved anywhere else. Nothing here holds a value.
 *
 * Under the desk sits the selected strip's own track card (trackDetail.js),
 * so a strip's notes, panels and lanes are edited where they always are: a
 * deck B track's step grid shows the pattern that deck is on, and a deck
 * bus's card is where its rack, its mod matrix and its lanes live.
 *
 * Rebuilt whole from engine state, coalesced on one frame and only while
 * open, as the clip view is; never while a control in it is held.
 */

import { toggleCue } from "./cue.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import { samplePeak } from "./meters.js";
import {
  addMasterBus, masterBus, removeMasterBus, deckATracks, deckBTracks, deckLabel, ejectDeckA, setDeckAPlaying, deckSide, deskDecks, matchDeckTempo, setXfadeOn, ejectDeckB, ejectDeckTrack, fadeToDeck, fadeRefDeck, deckPlaying, setFadeLength, deckSceneOf, focusDeck, moveTrack, keepBothDecks, loadDeckA, loadDeckB, 
  mixSource, mixTempo, requestDeckScene, requestSongScene, setDeckChain, setDeckPlaying, setDeckRepeat, setDeckXfade, setMixTempo,
  setTempoDeck, setTempoLink, setXfade, setXfadeCurve, setXfadeBands,
} from "./mix.js";
import { FADE_BARS, XFADE_BANDS, XFADE_BAND_TIPS, XFADE_CURVES, XFADE_CURVE_TIPS, filledSlots, scaleLabel, tempoRelation } from "./mixPlan.js";
import { trackControl } from "./paramTargets.js";
import { loadSetsMap } from "./session.js";
import { patternMeter, stepsPerBarForMeter } from "./meter.js";
import { setPatternMode } from "./patternBar.js";
import { isPatternNonEmpty, state, trackSlot } from "./state.js";
import { makeTrackDetail, trackHue } from "./trackDetail.js";
import { makeViewSplit } from "./viewSplit.js";
import { onViewChange } from "./views.js";

let root = null;
let desk = null;      // the rebuilt half
let foot = null;      // the footer drawer: the sheets' toggles, and load a deck
let detail = null;    // the selected strip's own track card
let raf = 0;
let holding = false;  // a control in the desk is held: no rebuild under the pointer
let stale = false;    // a repaint was asked for meanwhile
let fadeBars = 4;
/** Where a fade to each side begins: the pattern ("bar": any, the next bar line; "playing"; or a slot) and the bar of it. */
const fadeAt = { pat: "playing", bar: 0, deck: null };
let fadeHad = false;
/** The deck the fade selects go by: the one picked while it plays, else the nearest playing. */
function fadeDeck() {
  return fadeAt.deck && deckPlaying(fadeAt.deck) ? fadeAt.deck : fadeRefDeck();
}
/** A fade asked for while the transport starts: run once it is playing. */
let pendingFade = null;

/**
 * A deck's ▶ and ■. ▶ starts it when `whose` pattern comes round (double-
 * click: the next bar), or lets a deck stopping at its pattern's end play on;
 * ■ stops it when its pattern comes round (again: calls that off; double-
 * click: now), or calls off a start it was armed for.
 */
function playStop(L, on, armed, stopping, dis, whose, armOn) {
  const playTip = stopping ? `deck ${L} stops when its pattern comes round: click to let it play on`
    : on ? `deck ${L} is playing`
    : armed ? `deck ${L} starts ${armOn === "pattern" ? `when ${whose} comes round` : "on the next bar"} (double-click: on the next bar)`
    : `start deck ${L} when ${whose} comes round (double-click: on the next bar). With the transport stopped, it starts with it`;
  const stopTip = stopping ? `deck ${L} stops when its pattern comes round. Click to let it play on; double-click to stop it now`
    : on ? `stop deck ${L} when its pattern comes round. Double-click: stop it now`
    : armed ? `call off deck ${L}'s start` : `deck ${L} is stopped`;
  return `<button type="button" class="sq-mix__play${on && !stopping ? " is-on" : ""}${armed ? " is-armed" : ""}" data-act="deck-play" ${dis} title="${esc(playTip)}">${armed ? "…" : "▶"} ${L}</button>`
    + `<button type="button" class="sq-mix__play sq-mix__stop${stopping ? " is-armed" : ""}" data-act="deck-stop" ${dis || (!on && !armed ? "disabled" : "")} title="${esc(stopTip)}">${stopping ? "■…" : "■"}</button>`;
}

/**
 * Fade towards a side: queued (on the side's select) or `now`. Stopped, the
 * transport is started first (its own play button) and the fade asked for
 * once it plays; clicks made meanwhile only replace what is asked.
 */
function queueFade(side, now = false) {
  const run = () => fadeToDeck(side === "l" ? "a" : "b", fadeBars, now ? { now: true } : { at: fadeAt.pat, bar: fadeAt.bar, ref: fadeDeck() });
  if (state.playing) { pendingFade = null; run(); return; }
  const starting = !!pendingFade;
  pendingFade = run;
  if (starting) return;
  const go = () => { const f = pendingFade; pendingFade = null; if (state.playing) f?.(); };
  window.addEventListener("seqbaby:transport", go, { once: true });
  setTimeout(() => { if (pendingFade) { window.removeEventListener("seqbaby:transport", go); pendingFade = null; } }, 5000);
  document.getElementById("play")?.click();
}
let meterTimer = 0;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));
const isOpen = () => state.view === "mix" && !!root;

// The two sheets over the desk: the selected track's card (`inst`, from the
// bottom, where the split's lower pane was) and the master fx bus's strip
// (`master`, at the right). Each is toggled from the mix bar and remembered
// per browser; the desk under them has the whole view.
const SHEETS_KEY = "seqbaby.mixSheets.v1";
const sheets = { inst: false, master: true };
try { Object.assign(sheets, JSON.parse(localStorage.getItem(SHEETS_KEY) || "{}") || {}); } catch {}
function setSheet(k, on) {
  sheets[k] = !!on;
  try { localStorage.setItem(SHEETS_KEY, JSON.stringify({ inst: !!sheets.inst, master: !!sheets.master })); } catch {}
  root?.classList.toggle("has-inst", !!sheets.inst);
  scheduleMixPaint();
}

export function installMixView() {
  root = document.getElementById("mix");
  if (!root) return;
  const panes = makeViewSplit(root, "mix");
  desk = document.createElement("div");
  desk.className = "sq-mix__desk";
  panes.top.appendChild(desk);
  root.classList.add("is-overlay");
  root.classList.toggle("has-inst", !!sheets.inst);
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "sq-mix__sheet-x sq-btn--ghost";
  shut.dataset.act = "sheet-inst";
  shut.title = "close this sheet (the mix bar's instrument button opens it again)";
  shut.setAttribute("aria-label", "close the instrument sheet");
  shut.textContent = "×";
  panes.bottom.appendChild(shut);
  foot = document.createElement("div");
  foot.className = "sq-mix__foot";
  foot.setAttribute("role", "toolbar");
  foot.setAttribute("aria-label", "mix sheets and decks");
  root.appendChild(foot);
  detail = makeTrackDetail(panes.bottom, scheduleMixPaint, { buses: true, clips: true });
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("dblclick", onDblClick);
  // A held control keeps the desk it is in: a rebuild would take the knob out
  // from under the pointer mid-drag.
  desk.addEventListener("pointerdown", (e) => { if (e.target.closest("input[type=range]")) holding = true; }, true);
  const release = () => {
    if (!holding) return;
    holding = false;
    if (stale) scheduleMixPaint();
  };
  window.addEventListener("pointerup", release, true);
  wireStripDrag(desk, release);
  window.addEventListener("pointercancel", release, true);
  onViewChange((v) => {
    if (v === "mix") { render(); startMeters(); }
    else { detail.release(); stopMeters(); }
  });
  for (const ev of ["seqbaby:mix", "seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset", "seqbaby:transport"]) {
    window.addEventListener(ev, () => { scheduleMixPaint(); paintSwitchDot(); });
  }
}

/** The view switch's `mix` button says a second song is loaded, from any view. */
function paintSwitchDot() {
  const b = document.querySelector('#view-switch [data-view="mix"]');
  if (b) b.toggleAttribute("data-on", deskDecks().length > 0);
}

/** The mix as the desk sees it: null with no deck loaded HERE (the clip view's songs are its own). */
const deskMix = () => (deskDecks().length ? state.mix : null);

/** Repaint on the next frame, if this is the open view. */
export function scheduleMixPaint() {
  if (!isOpen() || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

// ---- drawing ------------------------------------------------------------------

/** A knob-sized control over one of the track's own (`sel`), read back from it. */
function proxy(t, sel, { cls = "", label = "", title = "" } = {}) {
  const real = /** @type {HTMLInputElement|null} */ (trackControl(t, sel));
  if (!real) return "";
  const a = (k) => esc(real.getAttribute(k) ?? "");
  return `<label class="sq-mix__ctl ${cls}" title="${esc(title)}">
    <input type="range" min="${a("min")}" max="${a("max")}" step="${a("step")}" value="${esc(real.value)}" data-ctl="${esc(sel)}"${cls.includes("is-fader") ? ' data-dbl="jump"' : ""} aria-label="${esc(`${t.name || "track"} ${label}`)}" />
    ${label ? `<span>${esc(label)}</span>` : ""}</label>`;
}

/**
 * Rearranging a deck's strips: drag a strip by its name onto another strip of
 * the same deck (before it on the left half, after it on the right half), or
 * alt + ← / → on a focused name. A strip only moves inside its own deck, and a
 * bus only among the buses (moveTrack, mix.js, holds both rules). The desk is
 * held still while a drag is under way, as it is for a knob.
 */
function wireStripDrag(desk, release) {
  let dragId = null;
  const clear = () => desk.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => el.classList.remove("is-drop-before", "is-drop-after"));
  // where a drop on strip `el` puts the dragged track: before which track
  const target = (e) => {
    const el = e.target.closest?.(".sq-mix__strip");
    const t = dragId && trackById(dragId);
    const over = el && trackById(el.dataset.trackId);
    if (!t || !over || over === t || over._deckBus || over._masterBus || (over._deck || null) !== (t._deck || null)
      || (over.engineKey === "bus") !== (t.engineKey === "bus")) return null;
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    let before = over;
    if (after) {
      const group = state.tracks.filter((x) => x !== t && !x._deckBus && !x._masterBus && (x._deck || null) === (t._deck || null)
        && (x.engineKey === "bus") === (t.engineKey === "bus") && !x._staged && !x._leaving);
      before = group[group.indexOf(over) + 1] || null;
    }
    return { el, after, before };
  };
  desk.addEventListener("dragstart", (e) => {
    const name = e.target.closest?.(".sq-mix__name[draggable]");
    const el = name?.closest(".sq-mix__strip");
    if (!el) return;
    dragId = el.dataset.trackId;
    holding = true;
    el.classList.add("is-dragging");
    try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch { /* some browsers refuse */ }
  });
  desk.addEventListener("dragover", (e) => {
    const at = dragId && target(e);
    clear();
    if (!at) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    at.el.classList.add(at.after ? "is-drop-after" : "is-drop-before");
  });
  desk.addEventListener("drop", (e) => {
    const at = dragId && target(e);
    const t = dragId && trackById(dragId);
    clear();
    if (!at || !t) return;
    e.preventDefault();
    moveTrack(t, at.before);
  });
  desk.addEventListener("dragend", () => {
    clear();
    desk.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
    dragId = null;
    holding = true;
    release();
    scheduleMixPaint();
  });
  desk.addEventListener("keydown", (e) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const el = e.target.closest?.(".sq-mix__name[draggable]")?.closest(".sq-mix__strip");
    const t = el && trackById(el.dataset.trackId);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const group = state.tracks.filter((x) => !x._deckBus && !x._masterBus && (x._deck || null) === (t._deck || null)
      && (x.engineKey === "bus") === (t.engineKey === "bus") && !x._staged && !x._leaving);
    const i = group.indexOf(t);
    const moved = e.key === "ArrowLeft"
      ? i > 0 && moveTrack(t, group[i - 1])
      : i < group.length - 1 && moveTrack(t, group[i + 2] || null);
    if (moved) requestAnimationFrame(() => document.querySelector(`#mix .sq-mix__strip[data-track-id="${t.id}"] .sq-mix__name`)?.focus());
  });
}

/** A deck's wet / dry into the master fx bus: a proxy over the `.p-mfx` of the track that owns the feed. */
function feedKnob(t, who) {
  if (!t || !masterBus()) return "";
  return proxy(t, ".p-mfx", { cls: "sq-mix__feed", label: "mst fx", title: `${who} into the master fx bus, wet / dry: right, all of it goes through the bus; left, it goes round it, straight to the master. Right-click its knob on the card below for an LFO or a lane` });
}

function strip(t, shown) {
  const bus = t.engineKey === "bus";
  const master = !!t._masterBus;
  const deckBus = !!t._deckBus || master;
  const [hue, color] = bus ? [0, "var(--fg-dim)"] : trackHue(t);
  const cls = ["sq-mix__strip"];
  if (bus) cls.push("is-bus");
  if (deckBus) cls.push("is-deck-bus");
  if (master) cls.push("is-master");
  if (t.muted) cls.push("is-muted");
  if (shown && shown.id === t.id) cls.push("is-selected");
  const slot = trackSlot(t);
  const what = master ? "the whole mix" : "this deck";
  const name = master ? "master fx" : deckBus ? `deck ${deckLabel(t._deckBus)}` : (t.name || "track");
  // a deck's bus carries the deck's tone: three bands and a filter
  const tone = deckBus ? `<div class="sq-mix__tone">
      ${proxy(t, ".p-eq-high", { label: "hi", title: `${what}'s highs (the bus's own eq, ±18dB). Double-click for flat` })}
      ${proxy(t, ".p-eq-mid", { label: "mid", title: `${what}'s mids` })}
      ${proxy(t, ".p-eq-low", { label: "low", title: master ? "the whole mix's lows" : "this deck's lows: cut one deck's bass while the other's comes in" })}
      ${proxy(t, ".p-cutoff", { label: "filter", title: `a lowpass over ${master ? "everything" : "the whole deck"} (the bus's own filter)` })}
    </div>${master ? "" : `<div class="sq-mix__tone is-feed">${feedKnob(t, name)}</div>`}` : `<div class="sq-mix__tone">${bus ? "" : proxy(t, ".fx-pan-pos", { label: "pan", title: "where this track sits, left to right (its pan stage)" })}</div>`;
  return `<div class="${cls.join(" ")}" data-track-id="${t.id}" style="--track-hue:${hue};--track-color:${color}">
    <button type="button" class="sq-mix__name" data-act="select"${deckBus ? "" : ' draggable="true"'} title="${esc(deckBus
      ? `${name}: everything ${master ? "goes through here on the way out" : "on this deck sums here"}. Select it to open its eq, rack, mod and lanes below`
      : `${name}: select it to edit its ${bus ? "rack and lanes" : "notes and sound"} below. Drag it along the deck (or alt + ← →) to move it`)}">${esc(name)}</button>
    ${tone}
    <div class="sq-mix__fader">
      <div class="sq-mix__meter" aria-hidden="true"><i></i></div>
      ${proxy(t, ".p-vol", { cls: "is-fader", title: `${name}: level. Drag to move it; double-click to put it where you clicked` })}
    </div>
    <div class="sq-mix__ms">
      <button type="button" class="sq-mix__cue" data-act="cue" aria-pressed="${!!t._cue}" title="cue: hear ${deckBus ? what : "it"} in the cue output, apart from the mix">C</button>
      <button type="button" class="sq-mix__mute" data-act="mute" aria-pressed="${!!t.muted}" ${t.soloed ? "disabled" : ""} title="mute">M</button>
      ${master ? `<button type="button" class="sq-mix__x" data-act="master-off" title="take the master fx bus off: everything goes straight to the master again, and its settings go with it" aria-label="remove the master fx bus">×</button>` : `<button type="button" class="sq-mix__solo" data-act="solo" aria-pressed="${!!t.soloed}" ${t.muted ? "disabled" : ""} title="solo${deckBus ? ": hear this deck alone" : ""}">S</button>`}
      ${deckBus ? "" : `<button type="button" class="sq-mix__x" data-act="eject-track" title="${esc(t._deck ? `eject ${name}: take this one track off the deck (the deck's last track takes the deck with it)` : `remove ${name} from the song (it asks first, and undo brings it back)`)}" aria-label="eject ${esc(name)}">×</button>`}
    </div>
    <span class="sq-mix__slot" title="${bus ? "a bus plays no notes" : t._clipOff ? "this track's clip is stopped" : `on pattern ${slot + 1}`}">${bus ? "bus" : `${t._clipOff ? "off" : `p${slot + 1}`}${t._frozen ? " ❄" : ""}`}</span>
  </div>`;
}

/**
 * A deck's patterns: the filled slots, the one it is on, the one waiting, and
 * under each number how many bars the deck's chain plays it for (deck A's is
 * the song's `patternRepeats`, deck B's its own). The `chain` box is the
 * deck's mode: through its patterns, or round the one it is on.
 */
function scenes(deck, tracks, scene, queued, repeats, chain) {
  const filled = filledSlots(tracks, PATTERN_COUNT);
  const out = [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    if (!filled[i] && i !== scene && i !== queued) continue;
    const cls = ["sq-mix__scene"];
    if (i === scene) cls.push("is-active");
    if (i === queued) cls.push("is-queued");
    if (!filled[i]) cls.push("is-empty");
    const r = Math.max(1, Math.min(16, Number(repeats?.[i]) || 1));
    const opts = Array.from({ length: 16 }, (_, k) => `<option value="${k + 1}"${k + 1 === r ? " selected" : ""}>×${k + 1}</option>`).join("");
    out.push(`<span class="sq-mix__pat">
      <button type="button" class="${cls.join(" ")}" data-deck="${deck}" data-scene="${i}" title="deck ${deck.toUpperCase()} to pattern ${i + 1}: a click queues it for when the pattern playing comes round (stopped, it switches at once). Double-click: now">${i + 1}</button>
      <select class="sq-mix__rep${r > 1 ? " is-set" : ""}" data-deck="${deck}" data-rep="${i}" title="pattern ${i + 1}: with chain on, deck ${deck.toUpperCase()} plays it for ${r} bar${r === 1 ? "" : "s"} before the next" aria-label="deck ${deck} pattern ${i + 1} repeat">${opts}</select>
    </span>`);
  }
  const box = `<label class="sq-mix__check sq-mix__chain" title="chain: deck ${deck.toUpperCase()} plays through its patterns, each for the bars under its number. Off, it repeats the pattern it is on"><input type="checkbox" data-act="chain-${deck}" ${chain ? "checked" : ""} /> chain</label>`;
  // how far through its repeats the pattern playing is (painted by tickMeters)
  const prog = `<span class="sq-mix__prog" data-prog="${deck}" hidden title="deck ${deck.toUpperCase()}'s chain: which bar of the pattern's repeat count is playing, and how far through them it is"><i></i><b></b></span>`;
  return `<div class="sq-mix__scenes" role="group" aria-label="deck ${deck} patterns">${out.join("")}${box}${prog}</div>`;
}

function deckA(shown) {
  const m = deskMix();
  const tracks = deckATracks().filter((t) => !t._staged && !t._leaving);
  const strips = [...tracks.filter((t) => t.engineKey !== "bus"), ...tracks.filter((t) => t.engineKey === "bus")];
  const bpm = Number(document.getElementById("bpm")?.value) || 120;
  const key = scaleLabel(state.scale);
  const pm = patternMeter(state.activePattern);
  return `<div class="sq-mix__deck" data-deck="a">
    <div class="sq-mix__head">
      <b>${m ? "A" : "mixer"}</b>
      <span class="sq-mix__title">${esc(state.songName || (m ? "the open song" : "this song"))}</span>
      <span class="sq-mix__facts">${bpm} bpm${key ? ` · ${esc(key)}` : ""} · ${pm.num}/${pm.den}</span>
      ${m ? `<span class="sq-mix__grow"></span><button type="button" class="sq-btn--ghost" data-act="load-deck" ${m.landing ? "disabled" : ""} title="load another song onto deck A: once it has loaded it takes this song's place as deck A and the song, and the other decks stay as they are. One undo step brings this song back">load…</button><button type="button" class="sq-btn--ghost sq-mix__eject-a" data-act="eject-a" ${m.landing || deskDecks()[0]?.loading ? "disabled" : ""} title="take deck A off: its tracks go, deck B becomes deck A (and the song), and every other deck moves back a letter. One undo step brings the old song back">eject</button>` : ""}
    </div>
    ${m ? (() => {
      const on = !m.aOff, armed = m.aArm === true, stopping = on && m.aArm === false;
      return `<div class="sq-mix__deckbar">
      ${playStop("A", on, armed, stopping, "", "the pattern playing", m.aArmOn)}
      <button type="button" class="sq-btn--ghost" data-act="match-bpm" ${Math.abs(bpm - mixTempo()) < 0.01 ? "disabled" : ""} title="match the playing tempo: set deck A's tempo (the song's, ${bpm} bpm) to the one playing now, so the tempo slider no longer pulls towards ${bpm}">= bpm</button>
    </div>`;
    })() : ""}
    ${scenes("a", tracks, state.activePattern, state.queuedPattern, state.patternRepeats, state.patternMode !== "repeat")}
    ${m ? `<div class="sq-mix__strips">
      ${strips.map((t) => strip(t, shown)).join("")}
      ${m.busA && state.tracks.includes(m.busA) ? strip(m.busA, shown) : ""}
    </div>` : grid(tracks, shown)}
  </div>`;
}

/**
 * The one desk (no other deck loaded) as a grid, nothing scrolling sideways:
 * the tracks that go straight to the master, wrapping, then a block per bus
 * with the tracks that feed it beside it. Decks kept as one song are buses,
 * so each of them is a block of its own.
 */
function grid(tracks, shown) {
  const buses = tracks.filter((t) => t.engineKey === "bus");
  // a bus that feeds another bus is a block of its own, not a strip in two
  const fed = (bus) => tracks.filter((t) => t.engineKey !== "bus" && String(t.out) === String(bus.id));
  const free = tracks.filter((t) => t.engineKey !== "bus" && !buses.some((b) => String(t.out) === String(b.id)));
  const block = (list, bus) => `<div class="sq-mix__group${bus ? " has-bus" : ""}">
      ${bus ? strip(bus, shown) : ""}
      <div class="sq-mix__strips is-wrap">${list.map((t) => strip(t, shown)).join("")}</div>
    </div>`;
  return `<div class="sq-mix__grid">
    ${free.length ? block(free, null) : ""}
    ${buses.map((b) => block(fed(b), b)).join("")}
  </div>`;
}

/** One loaded deck: its header (start, crossfader assign, land, eject), its patterns, its strips. */
function deckCard(d, shown) {
  const m = deskMix();
  const L = deckLabel(d.id);
  const tracks = deckBTracks(d.id);
  const strips = [...tracks.filter((t) => t.engineKey !== "bus"), ...tracks.filter((t) => t.engineKey === "bus")];
  const g = d.globals;
  const key = scaleLabel(g.scale);
  const tm = patternMeter(state.activePattern);
  const clash = g.meter.num !== tm.num || g.meter.den !== tm.den;
  const busy = d.loading || m.landing;
  const armed = d.arm === true;
  const stopping = d.on && d.arm === false;
  const dis = busy ? "disabled" : "";
  return `<div class="sq-mix__deck is-other${d.on ? " is-on" : ""}" data-deck="${d.id}">
    <div class="sq-mix__head">
      <b>${L}</b>
      <span class="sq-mix__title">${esc(d.title)}</span>
      <span class="sq-mix__facts">${d.bpm} bpm${key ? ` · ${esc(key)}` : ""} · ${g.meter.num}/${g.meter.den}</span>
      ${clash ? `<span class="sq-mix__warn" title="deck ${L} was written in ${g.meter.num}/${g.meter.den} and the bar line is deck A's (${tm.num}/${tm.den}): its patterns loop at their own length, and its pattern switches land on deck A's bars">meters differ</span>` : ""}
      ${d.loading ? `<span class="sq-mix__warn">loading…</span>` : ""}
    </div>
    <div class="sq-mix__deckbar">
      ${playStop(L, d.on, armed, stopping, dis, "deck A's pattern", d.armOn)}
      <button type="button" class="sq-btn--ghost" data-act="match-bpm" ${Math.abs(d.bpm - mixTempo()) < 0.01 ? "disabled" : ""} title="match the playing tempo: set deck ${L}'s tempo (${d.bpm} bpm) to the one playing now, so the tempo slider no longer pulls towards ${d.bpm} and landing it keeps this tempo">= bpm</button>
      <span class="sq-mix__grow"></span>
      <button type="button" class="sq-btn--ghost" data-act="load-deck" title="load another song onto deck ${L}, in place of this one: same place, same side of the crossfader">load…</button>
      <button type="button" class="sq-btn--ghost" data-act="eject" title="take deck ${L} off">eject</button>
    </div>
    ${scenes(d.id, tracks, d.scene, d.queued, d.repeats, d.chain)}
    <div class="sq-mix__strips">
      ${state.tracks.includes(d.bus) ? strip(d.bus, shown) : ""}
      ${strips.map((t) => strip(t, shown)).join("")}
    </div>
  </div>`;
}

/** Every loaded deck, then the way to load another: there is no limit. */
function otherDecks(shown) {
  const decks = deskDecks();
  if (!decks.length) {
    return `<div class="sq-mix__deck is-empty" data-deck="">
      <div class="sq-mix__empty">
        <b>no other deck yet</b>
        <p>Load another song to mix it with this one, or to move over to it: they play in time, each on its own fader, with a crossfader between them. Load as many as you like.</p>
        <button type="button" data-act="load">load a song onto a deck</button>
      </div>
    </div>`;
  }
  return `${decks.map((d) => deckCard(d, shown)).join("")}
    <button type="button" class="sq-mix__add" data-act="load" title="load another song onto a new deck">+<span>deck</span></button>`;
}

/** The bar's way to the master fx bus: adds it, or selects the one there. */
function masterBtn() {
  const on = !!masterBus();
  return `<button type="button" class="sq-mix__sheetbtn" data-act="sheet-inst" aria-pressed="${!!sheets.inst}" title="the selected track's card (its instrument, fx, mod and steps) as a sheet over the desk: show or hide it. Selecting a strip opens it">instrument</button><button type="button" class="sq-mix__masterbtn${on ? " is-on" : ""}" data-act="master-fx" aria-pressed="${on && !!sheets.master}" title="${on
    ? "the master fx bus: show or hide its sheet at the right of the desk (the bus stays in the path either way; its × takes it off)"
    : "add a master fx bus: one bus every track and every deck goes through on the way out, with its own filter, eq, fx rack, mod matrix and lanes. It is this desk's, not the song's: it is not saved, and it stays when you land or open another song"}">master fx</button>`;
}

function bar() {
  const m = deskMix();
  if (!m) {
    return `<div class="sq-mix__bar">
      <span class="sq-mix__hint">a fader, a pan, mute and solo per track. Select a strip to edit that track below.</span>
    </div>`;
  }
  const a = Number(document.getElementById("bpm")?.value) || 120;
  const f = focusDeck();
  const decks = deskDecks();
  const busy = m.landing || decks.some((d) => d.loading);
  let tempo = "";
  if (f) {
    const rel = tempoRelation(a, f.bpm);
    const now = Math.round(mixTempo() * 10) / 10;
    const L = deckLabel(f.id);
    const pick = decks.length > 1
      ? `<select data-act="tempo-deck" aria-label="the deck the tempo runs to" title="which deck's tempo the slider runs to">${decks.map((d) => `<option value="${d.id}"${d === f ? " selected" : ""}>${deckLabel(d.id)} ${d.bpm}</option>`).join("")}</select>`
      : `<span>${f.bpm}</span>`;
    tempo = rel.kind === "same" && decks.length < 2
      ? `<span class="sq-mix__facts" title="both songs are at ${a} bpm">same tempo</span>`
      : `<label class="sq-mix__tempo" title="the tempo the mix plays at, from deck A's (${a}) to deck ${L}'s (${f.bpm})${rel.kind === "apart" ? `: ${rel.pct}% apart` : rel.kind === "same" ? "" : `: ${rel.kind} time, so the beat lines up at either`}. Only the transport moves: synced delays and LFOs stay on deck A's tempo until the mix lands">
        <span>${a}</span>
        <input type="range" class="sq-mix__tempo-x" min="0" max="1" step="0.005" value="${m.tempoX}" data-act="tempo" aria-label="mix tempo" ${m.tempoLink ? "disabled" : ""} />
        ${pick}
        <b class="sq-mix__bpm">${now}</b>
      </label>
      <label class="sq-mix__check" title="the tempo rides the crossfader: all deck A at one end, all deck ${L} at the other"><input type="checkbox" data-act="link" ${m.tempoLink ? "checked" : ""} /> follow</label>`;
  }
  const n = decks.length + 1;
  return `<div class="sq-mix__bar">
    ${tempo}
    ${xfadeRow()}
    <span class="sq-mix__grow"></span>
    <button type="button" data-act="keep" ${busy ? "disabled" : ""} title="keep every deck as one song: each deck becomes a bus, with the crossfader's balance in its fader">keep ${n === 2 ? "both" : `all ${n}`}</button>
  </div>`;
}

/** The names on a side of the crossfader ("A C"), or "none". */
function sideNames(side) {
  const ids = ["a", ...deskDecks().map((d) => d.id)].filter((id) => deckSide(id) === side);
  return ids.length ? ids.map(deckLabel).join(" ") : "none";
}

/** The crossfader's own controls: the slider, the fades either way, the curve. */
function xfadeParts() {
  const m = deskMix();
  const L = sideNames("l"), R = sideNames("r");
  const off = !!m.xfOff;
  const any = !off && (L !== "none" || R !== "none");
  const bars = FADE_BARS.map((b) => `<option value="${b}"${b === fadeBars ? " selected" : ""}>${b} bar${b === 1 ? "" : "s"}</option>`).join("");
  // One pair of selects for where a fade begins, either way: the pattern
  // (any: the next bar line; pat: the pattern the playing deck nearest the
  // crossfader is on, fadeRefDeck, the deck being faded away from; or one of
  // that deck's patterns) and the bar of it. An arrow each side of the slider
  // queues a fade that way there; a double-click on it starts it now.
  // a deck picked in the select holds until a fade has run: the deck it moved
  // away from is no longer the one to go by
  if (fadeHad && !m.fade) fadeAt.deck = null;
  fadeHad = !!m.fade;
  const ref = fadeDeck(), RL = deckLabel(ref);
  const slotsOf = (id) => { const o = []; for (let i = 0; i < PATTERN_COUNT; i++) if (isPatternNonEmpty(i, id)) o.push(i); return o; };
  // every playing deck's patterns, the deck the fade goes by first
  const playing = ["a", ...deskDecks().map((d) => d.id)].filter((id) => deckPlaying(id));
  const listed = [ref, ...playing.filter((id) => id !== ref)];
  if (typeof fadeAt.pat === "number" && !slotsOf(ref).includes(fadeAt.pat)) fadeAt.pat = "playing";
  const { pat, bar } = fadeAt;
  const bt = bar ? `bar ${bar + 1} of ` : "";
  const when = pat === "bar" ? (bar ? `${bar} bar${bar === 1 ? "" : "s"} after the next bar line` : "on the next bar line")
    : pat === "playing" ? `on ${bt || "the start of "}the pattern deck ${RL} is playing, when it comes round`
    : `on ${bt || "the start of "}deck ${RL}'s pattern ${pat + 1}`;
  const arrow = (side) => {
    const to = side === "l" ? 0 : 1;
    const f = m.fade;
    const mine = f && f.to === to;
    const name = side === "l" ? L : R;
    return `<button type="button" class="sq-mix__fadebtn${mine ? (f.wait ? " is-armed" : " is-on") : ""}" data-act="fade-${side === "l" ? "a" : "b"}" title="fade to the ${side === "l" ? "left" : "right"} side (${esc(name)}) over the length picked, starting ${esc(when)}. Starts the transport when it is stopped. Double-click starts the fade now">${side === "l" ? "◂" : "▸"}</button>`;
  };
  const opt = (val, label, sel) => `<option value="${val}"${sel ? " selected" : ""}>${label}</option>`;
  const groups = listed.map((id) => {
    const L2 = esc(deckLabel(id)), mine = id === ref;
    return `<optgroup label="deck ${L2}">${opt(`${id}:playing`, `${L2} pat (${deckSceneOf(id) + 1})`, mine && pat === "playing")}${slotsOf(id).map((i) => opt(`${id}:${i}`, `${L2} pat ${i + 1}`, mine && pat === i)).join("")}</optgroup>`;
  }).join("");
  const patSel = `<select data-act="fade-pat" aria-label="the pattern a fade begins in" title="the pattern a fade (either way) begins in. any: the next bar line. A deck's pat (N): the pattern that deck is playing, when it comes round; a number: that pattern of that deck (one holding one pattern is sent to it, a chain arrives by itself). Every playing deck is listed; left alone it follows the deck nearest the crossfader, deck ${esc(RL)} now">${opt("bar", "any", pat === "bar")}${groups}</select>`;
  const barSel = `<select data-act="fade-bar" aria-label="the bar a fade begins on" title="the bar of that pattern a fade begins on: bar 1 is where it comes round, a later bar can fall inside the pass under way, a shorter pattern wraps. With any pattern, how many bar lines on from the next">${Array.from({ length: 16 }, (_, i) => `<option value="${i}"${i === bar ? " selected" : ""}>${pat === "bar" ? "" : `${esc(RL)} `}bar ${i + 1}</option>`).join("")}</select>`;
  const shapes = XFADE_CURVES.map((c) => `<option value="${c}"${m.curve === c ? " selected" : ""} title="${esc(XFADE_CURVE_TIPS[c])}">${c}</option>`).join("");
  return {
    L, R,
    slider: `<input type="range" class="sq-mix__xfade" min="0" max="1" step="0.005" value="${m.x}" data-act="xfade" aria-label="crossfader" title="the crossfader: all of its left side (${esc(L)}) at the left, all of its right (${esc(R)}) at the right. Click anywhere on it to go there" ${any ? "" : "disabled"} />`,
    fadeL: arrow("l"),
    fadeR: arrow("r"),
    at: `<div class="sq-mix__fade" role="group" aria-label="where a fade begins"><span class="sq-mix__fadeat">xfade at</span>${patSel}${barSel}</div>`,
    length: `<select data-act="fade-bars" aria-label="fade length" title="how long an automatic fade takes. Changed while a fade is queued or running, it changes that fade too">${bars}</select>`,
    curve: `<label class="sq-mix__check" title="the crossfader's shape. ${esc(m.curve)}: ${esc(XFADE_CURVE_TIPS[m.curve] || "")}"><select data-act="curve" aria-label="crossfader shape">${shapes}</select></label>`,
    bands: `<label class="sq-mix__check" title="how the crossfader moves the bass, mids and highs. ${esc(m.bands || "together")}: ${esc(XFADE_BAND_TIPS[m.bands || "together"] || "")}"><select data-act="xf-bands" aria-label="crossfader bands">${XFADE_BANDS.map((b) => `<option value="${b}"${(m.bands || "together") === b ? " selected" : ""} title="${esc(XFADE_BAND_TIPS[b])}">${b}</option>`).join("")}</select></label>`,
  };
}

/** (The crossfader used to sit between two decks as a column. It is always in the bar now.) */
function center() {
  const m = null;
  if (!m) return "";
  const x = xfadeParts();
  return `<div class="sq-mix__center">
    <div class="sq-mix__xlabels"><span>${esc(x.L)}</span><span>${esc(x.R)}</span></div>
    ${x.slider}
    ${x.curve}
  </div>`;
}

/**
 * The crossfader, always in the bar across the top, on the line the tempo
 * and `follow fader` are on, and on each side
 * of it a chip per deck. A lit chip is a deck attached to that side; a click
 * attaches it there (taking it off the other side), a click on a lit one
 * takes it off the crossfader, to play at its own fader.
 */
function xfadeRow() {
  const m = deskMix();
  if (!m || deskDecks().length < 1) return "";
  const x = xfadeParts();
  const ids = ["a", ...deskDecks().map((d) => d.id)];
  const chips = (side) => `<div class="sq-mix__assign" role="group" aria-label="decks on the crossfader's ${side === "l" ? "left" : "right"}">${ids.map((id) => {
    const on = deckSide(id) === side;
    return `<button type="button" class="sq-mix__side${on ? " is-on" : ""}${id === "a" ? " is-a" : ""}" data-act="side" data-deck-id="${id}" data-side="${side}" aria-pressed="${on}" title="deck ${deckLabel(id)}: ${on ? "on this side of the crossfader. Click to take it off: it then plays at its own fader" : `put it on the crossfader's ${side === "l" ? "left" : "right"}`}">${deckLabel(id)}</button>`;
  }).join("")}</div>`;
  const off = !!m.xfOff;
  return `<span class="sq-mix__sep"></span>
    <div class="sq-mix__xrow${off ? " is-off" : ""}">
      <label class="sq-mix__check" title="the crossfader, on or off. Off, every deck plays at its own fader, whatever side it is on and wherever the slider sits"><input type="checkbox" data-act="xf-on" ${off ? "" : "checked"} /> xfade</label>
      ${chips("l")}
      ${x.fadeL}
      ${x.slider}
      ${x.fadeR}
      ${chips("r")}
      ${x.at}
      ${x.length}
      ${x.curve}
      ${x.bands}
    </div>`;
}

function render() {
  if (!desk || !isOpen()) return;
  if (holding) { stale = true; return; }
  // a repeat picker held open: a repaint (every bar line while playing)
  // would close it under the pointer
  const held = document.activeElement?.closest?.("#mix [data-rep]");
  if (held) { stale = true; held.addEventListener("blur", () => scheduleMixPaint(), { once: true }); return; }
  stale = false;
  // the selection first, so the strips can mark it; the card is seated after
  const shown = detail.sync();
  const sc = desk.querySelectorAll(".sq-mix__strips");
  const scroll = [...sc].map((el) => el.scrollLeft);
  const mb = masterBus();
  // the footer drawer: the two sheets' toggles and the way to another deck
  if (foot) foot.innerHTML = `${masterBtn()}<span class="sq-mix__grow"></span><button type="button" data-act="load" title="load another song onto a new deck, to mix it with this one or move over to it">+ load a deck…</button>`;
  desk.innerHTML = `${bar()}<div class="sq-mix__body${mb && sheets.master ? " has-master" : ""}"><div class="sq-mix__decks${deskMix() ? " is-two" : ""}">${deckA(shown)}${center()}${otherDecks(shown)}</div>${mb && sheets.master ? `<div class="sq-mix__master"><b>master</b>${deskMix() ? "" : `<div class="sq-mix__strip is-feedhost" data-track-id="${mb.id}"><div class="sq-mix__tone is-feed">${feedKnob(mb, "the song")}</div></div>`}${strip(mb, shown)}</div>` : ""}</div>`;
  upgradeKnobs(desk);
  desk.querySelectorAll(".sq-mix__strips").forEach((el, i) => { if (scroll[i]) el.scrollLeft = scroll[i]; });
  paintSwitchDot();
}

// ---- the meters, and the faders following their knobs ----------------------------

function tickMeters() {
  if (!isOpen()) return;
  for (const el of desk.querySelectorAll(".sq-mix__strip")) {
    const t = trackById(el.dataset.trackId);
    if (!t) continue;
    const bar = el.querySelector(".sq-mix__meter i");
    if (bar && t.meterAnalyser) {
      const pct = Math.round(Math.pow(Math.min(1, samplePeak(t.meterAnalyser)), 0.85) * 100);
      if (bar._pct !== pct) { bar.style.height = `${pct}%`; bar._pct = pct; bar.classList.toggle("is-clip", pct >= 99); }
    }
    if (holding) continue;
    // a control moved anywhere else (its own knob, a lane's base, an undo)
    for (const p of el.querySelectorAll("input[data-ctl]")) {
      const real = /** @type {HTMLInputElement|null} */ (trackControl(t, p.dataset.ctl));
      if (real && p.value !== real.value) p.value = real.value;
    }
  }
  paintProgress();
  const m = deskMix();
  if (m && !holding) {
    const x = /** @type {HTMLInputElement|null} */ (desk.querySelector(".sq-mix__xfade"));
    if (x && Math.abs(Number(x.value) - m.x) > 0.002) x.value = String(m.x);          // an automatic fade
    const tx = /** @type {HTMLInputElement|null} */ (desk.querySelector(".sq-mix__tempo-x"));
    if (tx && Math.abs(Number(tx.value) - m.tempoX) > 0.002) tx.value = String(m.tempoX);
    const bpm = desk.querySelector(".sq-mix__bpm");
    const now = String(Math.round(mixTempo() * 10) / 10);
    if (bpm && bpm.textContent !== now) bpm.textContent = now;
  }
}
/**
 * Where a deck's chain is in the pattern it is on: the bar playing, of how
 * many, and the fraction of them gone. Null when it is not chaining (a
 * pattern on repeat has no count to be part way through) or not playing.
 */
function chainProgress(deck) {
  if (!state.playing) return null;
  const barLen = Math.max(1, stepsPerBarForMeter(patternMeter(state.activePattern)));
  const into = Math.min(1, (state.barTick ?? 0) / barLen);
  if (deck === "a") {
    if (state.patternMode !== "chain" || state.mix?.aOff) return null;
    const of = Math.max(1, state.patternRepeats[state.activePattern] ?? 1);
    const bar = Math.min(of - 1, state.chainBarCount ?? 0);
    return { bar: bar + 1, of, frac: (bar + into) / of };
  }
  const d = deskDecks().find((x) => x.id === deck);
  if (!d || !d.on || !d.chain) return null;
  const of = Math.max(1, d.repeats[d.scene] ?? 1);
  const bar = Math.min(of - 1, d.barCount ?? 0);
  return { bar: bar + 1, of, frac: (bar + into) / of };
}

function paintProgress() {
  for (const el of desk.querySelectorAll("[data-prog]")) {
    const p = chainProgress(el.dataset.prog);
    if (!p) { if (!el.hidden) el.hidden = true; continue; }
    if (el.hidden) el.hidden = false;
    const text = `${p.bar} of ${p.of}`;
    const label = el.lastElementChild, fill = el.firstElementChild;
    if (label.textContent !== text) label.textContent = text;
    const w = `${Math.round(p.frac * 100)}%`;
    if (fill.style.width !== w) fill.style.width = w;
  }
}

function startMeters() { if (!meterTimer) meterTimer = window.setInterval(tickMeters, 1000 / 30); }
function stopMeters() { if (meterTimer) { clearInterval(meterTimer); meterTimer = 0; } }

// ---- events ---------------------------------------------------------------------

function onInput(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
  const act = el.dataset.act;
  if (act === "xfade") { setXfade(Number(el.value)); return; }
  if (act === "tempo") { setMixTempo(Number(el.value)); return; }
  const sel = el.dataset.ctl;
  const t = trackById(el.closest(".sq-mix__strip")?.dataset.trackId);
  if (!sel || !t) return;
  // The track's own control, through its own event: whatever turning that
  // knob does (the stored sound, an fx stage wired in, a lane's base) happens.
  const real = /** @type {HTMLInputElement|null} */ (trackControl(t, sel));
  if (!real || real.value === el.value) return;
  real.value = el.value;
  real.dispatchEvent(new Event("input", { bubbles: true }));
}

function onChange(e) {
  const el = e.target;
  const act = el?.dataset?.act;
  // a pattern's repeat count: deck A's is the song's (undo, save and a jam
  // see it, as from the clip view's row), deck B's is the deck's own
  if (el?.dataset?.rep != null) {
    const i = Number(el.dataset.rep);
    const v = Math.max(1, Math.min(16, Number(el.value) || 1));
    if (el.dataset.deck === "a") {
      state.patternRepeats[i] = v;
      if (i === state.activePattern) {
        const input = document.getElementById("pattern-repeats");
        if (input) input.value = String(v);
      }
    } else setDeckRepeat(i, v, el.dataset.deck);
    el.blur();
    scheduleMixPaint();
    return;
  }
  if (act === "chain-a") { setPatternMode(el.checked ? "chain" : "repeat"); scheduleMixPaint(); return; }
  if (act?.startsWith("chain-")) { setDeckChain(el.checked, act.slice(6)); return; }
  if (act === "deck-xf") { setDeckXfade(el.checked, el.closest(".sq-mix__deck")?.dataset.deck); return; }
  if (act === "tempo-deck") { setTempoDeck(el.value); return; }
  if (act === "xf-on") { setXfadeOn(el.checked); return; }
  if (act === "link") { setTempoLink(el.checked); return; }
  if (act === "curve") { setXfadeCurve(el.value); return; }
  if (act === "xf-bands") { setXfadeBands(el.value); return; }
  if (act === "fade-bars") { fadeBars = Number(el.value) || 4; setFadeLength(fadeBars); }
  if (act === "fade-pat" || act === "fade-bar") {
    if (act === "fade-pat") {
      const [id, v] = el.value.split(":");
      if (el.value === "bar") fadeAt.pat = "bar";
      else { fadeAt.deck = id; fadeAt.pat = v === "playing" ? v : Number(v); }
    }
    else fadeAt.bar = Number(el.value) || 0;
    // a fade still waiting is queued again where the selects now say
    const f = state.mix?.fade;
    if (f?.wait) queueFade(f.to === 1 ? "r" : "l");
    scheduleMixPaint();
  }
}

function onDblClick(e) {
  // (the crossfader and the tempo are plain sliders: a click already puts
  // them where it lands, so a double-click has nothing to add)
  // a fade arrow: a click queued the fade for the bar or the pattern; the
  // double-click starts it now
  const fade = e.target.closest?.("[data-act=fade-a], [data-act=fade-b]");
  if (fade) { queueFade(fade.dataset.act === "fade-a" ? "l" : "r", true); return; }
  // a deck's ▶: the double-click starts it on the next bar (or lets a
  // stopping deck play on); its ■: the double-click stops it now
  const btn = e.target.closest?.("[data-act=deck-play], [data-act=deck-stop]");
  if (btn) {
    const go = btn.dataset.act === "deck-play", id = btn.closest(".sq-mix__deck")?.dataset.deck;
    if (id === "a") { if (state.mix) setDeckAPlaying(go); }
    else if (deskDecks().some((x) => x.id === id)) setDeckPlaying(go, id);
    return;
  }
  // a pattern number: now, whatever the switch setting
  const sc = e.target.closest?.("[data-scene]");
  if (!sc) return;
  const n = Number(sc.dataset.scene);
  if (sc.dataset.deck === "a") requestSongScene(n, { when: "now" });
  else requestDeckScene(n, sc.dataset.deck, { when: "now" });
}

async function onClick(e) {
  const sc = e.target.closest?.("[data-scene]");
  if (sc) {
    const n = Number(sc.dataset.scene);
    // a click queues it for when the pattern playing comes round; the
    // double-click (onDblClick) switches at once
    if (sc.dataset.deck === "a") requestSongScene(n); else requestDeckScene(n, sc.dataset.deck, { when: "pattern" });
    scheduleMixPaint();
    return;
  }
  const act = e.target.closest?.("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "load") { openPicker(); return; }
  const deckId = e.target.closest(".sq-mix__deck")?.dataset.deck || undefined;
  if (act === "deck-play" || act === "deck-stop") {
    const go = act === "deck-play";
    if (deckId === "a") {
      const m = state.mix;
      if (m && (go ? m.aOff || m.aArm === false : !m.aOff || m.aArm === true)) setDeckAPlaying(go, { when: go || !m.aOff ? "pattern" : "now" });
    } else {
      const d = deskDecks().find((x) => x.id === deckId);
      if (d && (go ? !d.on || d.arm === false : d.on || d.arm === true)) setDeckPlaying(go, d.id, { when: go || d.on ? "pattern" : "now" });
    }
    return;
  }
  if (act === "fade-a" || act === "fade-b") { queueFade(act === "fade-a" ? "l" : "r"); return; }
  if (act === "side") {
    const b = e.target.closest("[data-act=side]");
    const id = b.dataset.deckId, side = b.dataset.side;
    setDeckXfade(deckSide(id) === side ? null : side, id);
    return;
  }
  if (act === "load-deck") {
    if (deckId === "a") openPicker({ asA: true, heading: "load a song onto deck A" });
    else if (deckId) openPicker({ replace: deckId, heading: `load a song onto deck ${deckLabel(deckId)}` });
    return;
  }
  if (act === "eject-a") { await ejectDeckA(); return; }
  if (act === "eject") { ejectDeckB({ id: deckId }); return; }
  if (act === "match-bpm") { matchDeckTempo(deckId); return; }
  if (act === "keep") { keepBothDecks(); return; }
  if (act === "master-fx") {
    // no bus yet: make one and show it; else the button shows / hides its sheet
    if (!masterBus()) { addMasterBus(); setSheet("master", true); }
    else setSheet("master", !sheets.master);
    return;
  }
  if (act === "sheet-inst") { setSheet("inst", !sheets.inst); return; }
  if (act === "master-off") { removeMasterBus(); scheduleMixPaint(); return; }
  const el = e.target.closest(".sq-mix__strip");
  const t = el && trackById(el.dataset.trackId);
  if (!t) return;
  if (act === "cue") { toggleCue(t); e.target.closest("[data-act=cue]")?.setAttribute("aria-pressed", String(!!t._cue)); scheduleMixPaint(); return; }
  if (act === "mute" || act === "solo") {
    // the track's own button, so one piece of code owns what mute means
    trackControl(t, act === "mute" ? ".sq-track__mute" : ".sq-track__solo")?.click();
    scheduleMixPaint();
    return;
  }
  if (act === "eject-track") {
    // a deck's track just goes; the song's own goes through its own remove
    // button, which asks first and is an edit undo can take back
    if (t._deck) ejectDeckTrack(t);
    else trackControl(t, ".sq-track__remove")?.click();
    scheduleMixPaint();
    return;
  }
  if (act === "select") { detail.select(t); if (!sheets.inst) setSheet("inst", true); }
}

// ---- the picker: a song for a new deck ------------------------------------------------

/** Read a share link or deep link: `{slug}` for ?s=, `{id}` for ?open=, else null. */
function readLink(text) {
  const s = String(text || "").trim();
  if (!/[?&](s|open)=/.test(s)) return null;
  try {
    const q = new URL(s, location.href).searchParams;
    if (q.get("s")) return { slug: q.get("s") };
    if (q.get("open")) return { id: q.get("open") };
  } catch {}
  return null;
}

async function loadFrom(entry) {
  if (entry.kind === "local") return { session: loadSetsMap()[entry.id], title: entry.title, source: { kind: "local", name: entry.id } };
  if (entry.kind === "account") {
    const r = await mixSource().load(entry.id);
    return { session: r.session, title: r.title || entry.title, source: { kind: "account", id: entry.id, versionId: r.versionId ?? null, owned: r.owned !== false } };
  }
  if (entry.kind === "share") {
    const r = await fetch(`/api/share?id=${encodeURIComponent(entry.id)}`);
    if (!r.ok) throw new Error("that share link did not load");
    const { session } = await r.json();
    return { session, title: entry.title || `shared ${entry.id}`, source: { kind: "share", slug: entry.id } };
  }
  throw new Error("unknown source");
}

/** The song picker, for another view to load a deck with (the clip view). */
export function openDeckPicker(info = {}) { return openPicker(info); }

async function openPicker({ asA = false, heading = "", ...extra } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  overlay.innerHTML = `<div class="sq-modal sq-mix__picker" role="dialog" aria-modal="true" aria-label="load a song onto a deck">
      <div class="sq-modal__title">${esc(heading || "load a song onto a new deck")}</div>
      <input class="sq-modal__input" type="search" placeholder="search songs, or paste a share link" autocomplete="off" />
      <div class="sq-mix__list" role="listbox"><div class="sq-mix__hint">looking for songs…</div></div>
      <div class="sq-modal__actions">
        <button type="button" class="sq-btn--ghost" data-pick="file">from a file…</button>
        <button type="button" class="modal-cancel sq-btn--ghost">cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = /** @type {HTMLInputElement} */ (overlay.querySelector("input"));
  const list = overlay.querySelector(".sq-mix__list");
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".modal-cancel")) close(); });
  setTimeout(() => input.focus(), 0);

  /** @type {Array<{kind: string, id: string, title: string, note: string}>} */
  let entries = [];
  // the account's list: on its way, here, or failed (and why)
  let remote = mixSource()?.list ? "loading" : "none";
  let remoteError = "";
  const local = loadSetsMap();
  for (const name of Object.keys(local)) entries.push({ kind: "local", id: name, title: name, note: "this browser", bpm: Number(local[name]?.bpm) || null, tags: [] });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const link = readLink(input.value);
    if (link) {
      list.innerHTML = `<button type="button" class="sq-mix__pick" data-link="1"><b>${link.slug ? "the shared song" : "the song"} this link names</b><span>press enter to load it</span></button>`;
      return;
    }
    // a search reads the title, who made it, its tags and its tempo ("148")
    const hay = (x) => `${x.title} ${x.note} ${(x.tags || []).join(" ")} ${x.bpm ? `${Math.round(x.bpm)} bpm` : ""}`.toLowerCase();
    const hits = entries.filter((x) => !q || hay(x).includes(q));
    const rows = hits.map((x) => `<button type="button" class="sq-mix__pick" data-i="${entries.indexOf(x)}">
        <b>${esc(x.title)}</b>
        <span class="sq-mix__pick-bpm">${x.bpm ? `${Math.round(x.bpm)} bpm` : ""}</span>
        <span class="sq-mix__pick-tags">${(x.tags || []).slice(0, 3).map((g) => `<i>${esc(g)}</i>`).join("")}</span>
        <span class="sq-mix__pick-note">${esc(x.note)}</span>
      </button>`).join("");
    const note = remote === "loading" ? `<div class="sq-mix__hint">looking for songs…</div>`
      : remote === "failed" ? `<div class="sq-mix__hint is-error">${esc(remoteError)} <button type="button" class="sq-btn--ghost" data-pick="retry">try again</button></div>`
      : hits.length ? ""
      : `<div class="sq-mix__hint">${entries.length ? "nothing matches" : remote === "none" ? "paste a share link, or load a song exported as a file" : "no songs here yet: publish one, save one, paste a share link, or load a file"}</div>`;
    list.innerHTML = rows + note;
  };
  draw();
  const locals = entries.slice();
  const fetchList = () => {
    const src = mixSource();
    if (!src?.list) return;
    remote = "loading";
    draw();
    // a list that never answers is a failure too, not a spinner for ever
    const slow = new Promise((_, no) => setTimeout(() => no(new Error("the song list is taking too long")), 20000));
    Promise.race([src.list(), slow]).then((songs) => {
      const got = (songs || []).map((s) => ({ kind: "account", id: String(s.id), title: s.title || "untitled", note: s.note || "your songs", bpm: Number(s.bpm) || null, tags: Array.isArray(s.tags) ? s.tags : [] }));
      entries = [...got, ...locals];
      remote = "ready";
    }).catch((err) => {
      console.error("mix: the song list did not load", err);
      remote = "failed";
      remoteError = err?.message || "the song list did not load";
    }).finally(() => { if (overlay.isConnected) draw(); });
  };
  fetchList();

  const go = async (get) => {
    list.innerHTML = `<div class="sq-mix__hint">loading…</div>`;
    try {
      const got = await get();
      if (!got?.session) throw new Error("that song is empty");
      close();
      await (asA ? loadDeckA : loadDeckB)(got.session, { title: got.title, source: got.source, ...extra });
    } catch (err) {
      console.error(err);
      setStatus(`deck: ${err?.message || "that song did not load"}`, true);
      if (overlay.isConnected) list.innerHTML = `<div class="sq-mix__hint is-error">${esc(err?.message || "that song did not load")}</div>`;
    }
  };
  const goLink = () => {
    const link = readLink(input.value);
    if (!link) return false;
    if (link.slug) go(() => loadFrom({ kind: "share", id: link.slug, title: "" }));
    else if (mixSource()) go(() => loadFrom({ kind: "account", id: link.id, title: "" }));
    else setStatus("sign in to load a song by its link", true);
    return true;
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (goLink()) return;
    list.querySelector(".sq-mix__pick")?.click();
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest('[data-pick="retry"]')) { fetchList(); return; }
    const b = e.target.closest(".sq-mix__pick");
    if (!b) return;
    if (b.dataset.link) { goLink(); return; }
    const entry = entries[Number(b.dataset.i)];
    if (entry) go(() => loadFrom(entry));
  });
  overlay.querySelector('[data-pick="file"]').addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.addEventListener("change", () => {
      const file = inp.files?.[0];
      if (!file) return;
      go(async () => ({ session: JSON.parse(await file.text()), title: file.name.replace(/\.json$/i, ""), source: { kind: "file" } }));
    });
    inp.click();
  });
}
