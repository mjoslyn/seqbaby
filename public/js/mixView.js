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

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import { samplePeak } from "./meters.js";
import {
  deckATracks, deckBTracks, ejectDeckB, fadeToDeck, keepBothDecks, landDeckB, loadDeckB, mixSource, mixTempo,
  requestDeckScene, setDeckChain, setDeckPlaying, setMixTempo, setTempoLink, setXfade, setXfadeCurve,
} from "./mix.js";
import { FADE_BARS, filledSlots, scaleLabel, tempoRelation } from "./mixPlan.js";
import { trackControl } from "./paramTargets.js";
import { loadSetsMap } from "./session.js";
import { patternMeter } from "./meter.js";
import { requestPatternSwitch, state, switchPattern, trackSlot } from "./state.js";
import { makeTrackDetail, trackHue } from "./trackDetail.js";
import { makeViewSplit } from "./viewSplit.js";
import { onViewChange } from "./views.js";

let root = null;
let desk = null;      // the rebuilt half
let detail = null;    // the selected strip's own track card
let raf = 0;
let holding = false;  // a control in the desk is held: no rebuild under the pointer
let stale = false;    // a repaint was asked for meanwhile
let fadeBars = 4;
let meterTimer = 0;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));
const isOpen = () => state.view === "mix" && !!root;

export function installMixView() {
  root = document.getElementById("mix");
  if (!root) return;
  const panes = makeViewSplit(root, "mix");
  desk = document.createElement("div");
  desk.className = "sq-mix__desk";
  panes.top.appendChild(desk);
  detail = makeTrackDetail(panes.bottom, scheduleMixPaint, { buses: true });
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
  if (b) b.toggleAttribute("data-on", !!state.mix);
}

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
    <input type="range" min="${a("min")}" max="${a("max")}" step="${a("step")}" value="${esc(real.value)}" data-ctl="${esc(sel)}" aria-label="${esc(`${t.name || "track"} ${label}`)}" />
    ${label ? `<span>${esc(label)}</span>` : ""}</label>`;
}

function strip(t, shown) {
  const bus = t.engineKey === "bus";
  const deckBus = !!t._deckBus;
  const [hue, color] = bus ? [0, "var(--fg-dim)"] : trackHue(t);
  const cls = ["sq-mix__strip"];
  if (bus) cls.push("is-bus");
  if (deckBus) cls.push("is-deck-bus");
  if (t.muted) cls.push("is-muted");
  if (shown && shown.id === t.id) cls.push("is-selected");
  const slot = trackSlot(t);
  const name = deckBus ? (t._deckBus === "a" ? "deck A" : "deck B") : (t.name || "track");
  // a deck's bus carries the deck's tone: three bands and a filter
  const tone = deckBus ? `<div class="sq-mix__tone">
      ${proxy(t, ".p-eq-high", { label: "hi", title: "this deck's highs (the bus's own eq, ±18dB). Double-click for flat" })}
      ${proxy(t, ".p-eq-mid", { label: "mid", title: "this deck's mids" })}
      ${proxy(t, ".p-eq-low", { label: "low", title: "this deck's lows: cut one deck's bass while the other's comes in" })}
      ${proxy(t, ".p-cutoff", { label: "filter", title: "a lowpass over the whole deck (the bus's own filter)" })}
    </div>` : `<div class="sq-mix__tone">${bus ? "" : proxy(t, ".fx-pan-pos", { label: "pan", title: "where this track sits, left to right (its pan stage)" })}</div>`;
  return `<div class="${cls.join(" ")}" data-track-id="${t.id}" style="--track-hue:${hue};--track-color:${color}">
    <button type="button" class="sq-mix__name" data-act="select" title="${esc(deckBus
      ? `${name}: everything on this deck sums here. Select it to open its eq, rack, mod and lanes below`
      : `${name}: select it to edit its ${bus ? "rack and lanes" : "notes and sound"} below`)}">${esc(name)}</button>
    ${tone}
    <div class="sq-mix__fader">
      <div class="sq-mix__meter" aria-hidden="true"><i></i></div>
      ${proxy(t, ".p-vol", { cls: "is-fader", title: `${name}: level` })}
    </div>
    <div class="sq-mix__ms">
      <button type="button" class="sq-mix__mute" data-act="mute" aria-pressed="${!!t.muted}" ${t.soloed ? "disabled" : ""} title="mute">M</button>
      <button type="button" class="sq-mix__solo" data-act="solo" aria-pressed="${!!t.soloed}" ${t.muted ? "disabled" : ""} title="solo${deckBus ? ": hear this deck alone" : ""}">S</button>
    </div>
    <span class="sq-mix__slot" title="${bus ? "a bus plays no notes" : t._clipOff ? "this track's clip is stopped" : `on pattern ${slot + 1}`}">${bus ? "bus" : t._clipOff ? "off" : `p${slot + 1}`}</span>
  </div>`;
}

/** A deck's patterns: the filled slots, the one it is on, the one waiting. */
function scenes(deck, tracks, scene, queued) {
  const filled = filledSlots(tracks, PATTERN_COUNT);
  const out = [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    if (!filled[i] && i !== scene && i !== queued) continue;
    const cls = ["sq-mix__scene"];
    if (i === scene) cls.push("is-active");
    if (i === queued) cls.push("is-queued");
    if (!filled[i]) cls.push("is-empty");
    out.push(`<button type="button" class="${cls.join(" ")}" data-deck="${deck}" data-scene="${i}" title="deck ${deck.toUpperCase()} to pattern ${i + 1} (now, or at the bar line, by the switch setting). Double-click: now">${i + 1}</button>`);
  }
  return `<div class="sq-mix__scenes" role="group" aria-label="deck ${deck} patterns">${out.join("")}</div>`;
}

function deckA(shown) {
  const m = state.mix;
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
    </div>
    ${scenes("a", tracks, state.activePattern, state.queuedPattern)}
    <div class="sq-mix__strips">
      ${strips.map((t) => strip(t, shown)).join("")}
      ${m?.busA && state.tracks.includes(m.busA) ? strip(m.busA, shown) : ""}
    </div>
  </div>`;
}

function deckB(shown) {
  const m = state.mix;
  if (!m) {
    return `<div class="sq-mix__deck is-empty" data-deck="b">
      <div class="sq-mix__empty">
        <b>deck B is empty</b>
        <p>Load a second song to mix it with this one, or to move over to it: both play in time, each on its own fader, with a crossfader between them.</p>
        <button type="button" data-act="load">load a song onto deck B</button>
      </div>
    </div>`;
  }
  const tracks = deckBTracks();
  const strips = [...tracks.filter((t) => t.engineKey !== "bus"), ...tracks.filter((t) => t.engineKey === "bus")];
  const g = m.globals;
  const key = scaleLabel(g.scale);
  const tm = patternMeter(state.activePattern);
  const clash = g.meter.num !== tm.num || g.meter.den !== tm.den;
  return `<div class="sq-mix__deck${m.on ? " is-on" : ""}" data-deck="b">
    <div class="sq-mix__head">
      <b>B</b>
      <span class="sq-mix__title">${esc(m.title)}</span>
      <span class="sq-mix__facts">${m.bpm} bpm${key ? ` · ${esc(key)}` : ""} · ${g.meter.num}/${g.meter.den}</span>
      ${clash ? `<span class="sq-mix__warn" title="deck B was written in ${g.meter.num}/${g.meter.den} and the bar line is deck A's (${tm.num}/${tm.den}): its patterns loop at their own length, and its pattern switches land on deck A's bars">meters differ</span>` : ""}
      ${m.loading ? `<span class="sq-mix__warn">loading…</span>` : ""}
    </div>
    ${scenes("b", tracks, m.scene, m.queued)}
    <div class="sq-mix__strips">
      ${state.tracks.includes(m.busB) ? strip(m.busB, shown) : ""}
      ${strips.map((t) => strip(t, shown)).join("")}
    </div>
  </div>`;
}

function bar() {
  const m = state.mix;
  if (!m) {
    return `<div class="sq-mix__bar">
      <button type="button" data-act="load" title="load a second song onto deck B, to mix it with this one or move over to it">load deck B…</button>
      <span class="sq-mix__hint">a fader, a pan, mute and solo per track. Select a strip to edit that track below.</span>
    </div>`;
  }
  const a = Number(document.getElementById("bpm")?.value) || 120;
  const rel = tempoRelation(a, m.bpm);
  const now = Math.round(mixTempo() * 10) / 10;
  const busy = m.loading || m.landing;
  const armed = m.arm === true;
  const tempo = rel.kind === "same"
    ? `<span class="sq-mix__facts" title="both songs are at ${a} bpm">same tempo</span>`
    : `<label class="sq-mix__tempo" title="the tempo the mix plays at, from deck A's (${a}) to deck B's (${m.bpm})${rel.kind === "apart" ? `: ${rel.pct}% apart` : `: ${rel.kind} time, so the beat lines up at either`}. Only the transport moves: synced delays and LFOs stay on deck A's tempo until the mix lands">
        <span>${a}</span>
        <input type="range" class="sq-mix__tempo-x" min="0" max="1" step="0.005" value="${m.tempoX}" data-act="tempo" aria-label="mix tempo" ${m.tempoLink ? "disabled" : ""} />
        <span>${m.bpm}</span>
        <b class="sq-mix__bpm">${now}</b>
      </label>
      <label class="sq-mix__check" title="the tempo rides the crossfader: all deck A at one end, all deck B at the other"><input type="checkbox" data-act="link" ${m.tempoLink ? "checked" : ""} /> follow fader</label>`;
  return `<div class="sq-mix__bar">
    <button type="button" data-act="load" title="load a different song onto deck B" ${busy ? "disabled" : ""}>load…</button>
    <button type="button" class="sq-mix__play${m.on ? " is-on" : ""}${armed ? " is-armed" : ""}" data-act="deck-play" ${busy ? "disabled" : ""} title="${m.on ? "stop deck B" : armed ? "deck B starts on the next bar" : "start deck B: on the next bar line while the transport plays, with it when it is stopped"}">${m.on ? "■ B" : armed ? "… B" : "▶ B"}</button>
    <label class="sq-mix__check" title="deck B plays through its patterns, each for its own repeat count, instead of repeating the one it is on"><input type="checkbox" data-act="chain" ${m.chain ? "checked" : ""} /> chain</label>
    <span class="sq-mix__sep"></span>
    ${tempo}
    <span class="sq-mix__sep"></span>
    <span class="sq-mix__grow"></span>
    <button type="button" data-act="land" ${busy ? "disabled" : ""} title="land: deck B becomes the song (its tracks as they are playing, its scale and patterns, the tempo the mix is at) and deck A's tracks go. One undo step brings the old song back">land B</button>
    <button type="button" data-act="keep" ${busy ? "disabled" : ""} title="keep both decks as one song: each deck becomes a bus, with the crossfader's balance in its fader">keep both</button>
    <button type="button" class="sq-btn--ghost" data-act="eject" title="take deck B off: the song is as it was">eject</button>
  </div>`;
}

function center() {
  const m = state.mix;
  if (!m) return "";
  const bars = FADE_BARS.map((b) => `<option value="${b}"${b === fadeBars ? " selected" : ""}>${b} bar${b === 1 ? "" : "s"}</option>`).join("");
  return `<div class="sq-mix__center">
    <div class="sq-mix__xlabels"><span>A</span><span>B</span></div>
    <input type="range" class="sq-mix__xfade" min="0" max="1" step="0.005" value="${m.x}" data-act="xfade" aria-label="crossfader: deck A to deck B" title="the crossfader: all deck A at the left, all deck B at the right. Double-click for the middle" />
    <div class="sq-mix__fade">
      <button type="button" data-act="fade-a" title="fade to deck A over the length picked, on the transport's clock">◂ A</button>
      <select data-act="fade-bars" aria-label="fade length" title="how long an automatic fade takes">${bars}</select>
      <button type="button" data-act="fade-b" title="fade to deck B over the length picked">B ▸</button>
    </div>
    <label class="sq-mix__check" title="blend: equal power, both decks at -3dB in the middle. cut: both full across the middle, each cut at its far end"><select data-act="curve" aria-label="crossfader curve">
      <option value="blend"${m.curve === "blend" ? " selected" : ""}>blend</option>
      <option value="cut"${m.curve === "cut" ? " selected" : ""}>cut</option>
    </select></label>
  </div>`;
}

function render() {
  if (!desk || !isOpen()) return;
  if (holding) { stale = true; return; }
  stale = false;
  // the selection first, so the strips can mark it; the card is seated after
  const shown = detail.sync();
  const sc = desk.querySelectorAll(".sq-mix__strips");
  const scroll = [...sc].map((el) => el.scrollLeft);
  desk.innerHTML = `${bar()}<div class="sq-mix__decks${state.mix ? " is-two" : ""}">${deckA(shown)}${center()}${deckB(shown)}</div>`;
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
  const m = state.mix;
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
  if (act === "chain") { setDeckChain(el.checked); return; }
  if (act === "link") { setTempoLink(el.checked); return; }
  if (act === "curve") { setXfadeCurve(el.value); return; }
  if (act === "fade-bars") { fadeBars = Number(el.value) || 4; }
}

function onDblClick(e) {
  if (e.target.closest?.(".sq-mix__xfade")) { setXfade(0.5); scheduleMixPaint(); return; }
  // a pattern number: now, whatever the switch setting
  const sc = e.target.closest?.("[data-scene]");
  if (!sc) return;
  const n = Number(sc.dataset.scene);
  if (sc.dataset.deck === "a") switchPattern(n);
  else { const was = state.patternSwitchMode; state.patternSwitchMode = "immediate"; try { requestDeckScene(n); } finally { state.patternSwitchMode = was; } }
}

async function onClick(e) {
  const sc = e.target.closest?.("[data-scene]");
  if (sc) {
    const n = Number(sc.dataset.scene);
    if (sc.dataset.deck === "a") requestPatternSwitch(n); else requestDeckScene(n);
    scheduleMixPaint();
    return;
  }
  const act = e.target.closest?.("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "load") { openPicker(); return; }
  if (act === "deck-play") { setDeckPlaying(!(state.mix?.on || state.mix?.arm === true)); return; }
  if (act === "fade-a" || act === "fade-b") { fadeToDeck(act === "fade-a" ? "a" : "b", fadeBars); return; }
  if (act === "eject") { ejectDeckB(); return; }
  if (act === "keep") { keepBothDecks(); return; }
  if (act === "land") { await landDeckB(); return; }
  const el = e.target.closest(".sq-mix__strip");
  const t = el && trackById(el.dataset.trackId);
  if (!t) return;
  if (act === "mute" || act === "solo") {
    // the track's own button, so one piece of code owns what mute means
    trackControl(t, act === "mute" ? ".sq-track__mute" : ".sq-track__solo")?.click();
    scheduleMixPaint();
    return;
  }
  if (act === "select") detail.select(t);
}

// ---- the picker: a song for deck B ------------------------------------------------

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

async function openPicker() {
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  overlay.innerHTML = `<div class="sq-modal sq-mix__picker" role="dialog" aria-modal="true" aria-label="load a song onto deck B">
      <div class="sq-modal__title">load a song onto deck B</div>
      <input class="sq-modal__input" type="search" placeholder="search your songs, or paste a share link" autocomplete="off" />
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
  const local = loadSetsMap();
  for (const name of Object.keys(local)) entries.push({ kind: "local", id: name, title: name, note: "this browser" });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const link = readLink(input.value);
    if (link) {
      list.innerHTML = `<button type="button" class="sq-mix__pick" data-link="1"><b>${link.slug ? "the shared song" : "the song"} this link names</b><span>press enter to load it</span></button>`;
      return;
    }
    const hits = entries.filter((x) => !q || x.title.toLowerCase().includes(q));
    list.innerHTML = hits.length
      ? hits.map((x) => `<button type="button" class="sq-mix__pick" data-i="${entries.indexOf(x)}"><b>${esc(x.title)}</b><span>${esc(x.note)}</span></button>`).join("")
      : `<div class="sq-mix__hint">${entries.length ? "nothing matches" : mixSource() ? "no songs yet: save one, paste a share link, or load a file" : "sign in to mix your saved songs. Signed out: paste a share link, or load a song exported as a file"}</div>`;
  };
  draw();
  const src = mixSource();
  if (src?.list) {
    src.list().then((songs) => {
      const mine = (songs || []).map((s) => ({ kind: "account", id: String(s.id), title: s.title || "untitled", note: s.note || "your songs" }));
      entries = [...mine, ...entries];
      if (overlay.isConnected) draw();
    }).catch(() => {});
  }

  const go = async (get) => {
    list.innerHTML = `<div class="sq-mix__hint">loading…</div>`;
    try {
      const got = await get();
      if (!got?.session) throw new Error("that song is empty");
      close();
      await loadDeckB(got.session, { title: got.title, source: got.source });
    } catch (err) {
      console.error(err);
      setStatus(`deck B: ${err?.message || "that song did not load"}`, true);
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
