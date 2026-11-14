/**
 * The mix: a second song on deck B, played beside the one that is open.
 *
 * A transition (transition.js) takes the studio from one song to another on a
 * plan: both songs in for a few bars, a curve, a landing. This is the same
 * overlap held open and put under the hand. The second song's tracks are built
 * into `state.tracks` beside the song's own, flagged (`_deck: "b"`), and each
 * deck sums into a bus of its own on the way to the master:
 *
 *   song's tracks ─▶ deck A bus ─┐
 *                                ├─▶ master      (the crossfader is the two
 *   deck B tracks ─▶ deck B bus ─┘                buses' output gains)
 *
 * **The deck buses are real `bus` tracks** (`_deckBus`), so a deck has a
 * fader, an eq, a filter, a rack, a mod matrix and automation lanes with no
 * code of its own, and a lane on a deck's fader or eq belongs to a pattern as
 * every lane does. The routing is the mix's, not the song's: `t.out` stays
 * "master" and `outputTargetFor` (signal.js) reads "master" as the deck's bus
 * for as long as a mix is loaded.
 *
 * **None of it is in the song.** `serializeSet` leaves deck B and both buses
 * out (`inSong`, state.js), so a save, the undo stack, a jam and the unsaved
 * check see the open song and nothing else, and `mergeSet` neither matches
 * nor removes them, so an undo under a mix leaves the other deck playing.
 * The mix ends one of three ways:
 *
 *   eject   deck B and the buses go; the song is as it was
 *   land    deck B becomes the song (its tracks, scale, bank, tempo), the old
 *           song's tracks go, one undo step
 *   keep    both decks become one song: the flags come off, the buses are the
 *           song's buses, the crossfader's balance is folded into their faders
 *
 * **Each deck has a scene of its own.** `trackSlot(t)` was already per track
 * (clips.js); the pattern bar's scene moves the song (`onDeckA`), and deck B
 * has `mix.scene`, a queue and a chain here, committed on the same bar line
 * (`mixStep`, called by the transport). Deck B's patterns are its tracks' own
 * (`t.patterns`), so the two banks never collide; what is NOT per deck is the
 * meter (the bar line is the song's) and the swing. Deck B's notes are snapped
 * to its own scale (`mix.scale`, read by `noteForStep`).
 *
 * **The tempo is the transport's alone while mixing** (`tempoX`: 0 the song's
 * bpm, 1 deck B's), as a transition's ramp is: the bpm field, the synced LFOs
 * and the synced delays stay on the song's tempo until the mix lands.
 */

import { PATTERN_COUNT } from "./constants.js";
import { announceClips, restartTrackCount, seedTrackCount } from "./clips.js";
import { refreshChanceScale } from "./chance.js";
import { setStatus } from "./dom.js";
import { flushHistory, markExternalEdit } from "./history.js";
import { flushJam } from "./jam.js";
import { applyGlobalsInPlace, deepCopy, mergeSet } from "./liveSet.js";
import { applyMacroPads } from "./macro.js";
import { stepsPerBarForMeter, transportMeter } from "./meter.js";
import { bakeLevel, deckSummary, fadeAt, filledSlots, meterOf, mixBpm, nextFilled, sameScale, startSlot, xfadeGains, XFADE_CURVES } from "./mixPlan.js";
import { trackControl } from "./paramTargets.js";
import { renderPatternGrid } from "./patternBar.js";
import { flushPatternSound, recallPatternSound, refreshAllPatternLockUI, refreshPatternSoundUI, resolveSoundSources } from "./patternSound.js";
import { applyBusMute, placeBusesLast, setActiveTrack } from "./render.js";
import { syncScaleUI } from "./scaleUI.js";
import { loadTrackFromData, migrateTrackData, serializeSet, trackShellFor } from "./session.js";
import { migrateLegacyNames, validateSet } from "./sessionFormat.js";
import { applyCompressorConfig, refreshAllTrackOutputs, refreshCompSourceDropdowns, refreshNoiseBeds, refreshOutputSelects, releaseSilencedTracks, wouldFeedback } from "./signal.js";
import { aliasPattern, inSong, onDeckA, paintTrackSlotBadge, queueTrackPaint, state, switchPattern, syncMeterUI, syncRepeatsUI, trackSlot } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, quantizeToScale } from "./theory.js";
import { nameToMidi } from "./theoryData.js";
import { createTrack, removeTrack } from "./track.js";
import { restoreLookAhead, stretchLookAhead } from "./transition.js";
import { requestMidiIfNeeded } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const fieldBpm = () => Number(document.getElementById("bpm")?.value) || 120;

// ---- the decks ------------------------------------------------------------------
//
// `state.mix` is `{ decks, busA, x, curve, fade, tempoX, tempoLink, focus,
// landing }`. A deck (`decks[i]`) is one loaded song: `{ id, title, source,
// globals, bpm, scale, repeats, scene, queued, barCount, countOrigin, chain,
// on, arm, bus, loading, pending, made, refs }`. Its id is a letter from "b"
// on; its tracks carry `_deck: id`, its bus `_deckBus: id` as well. There is
// no limit on how many there are. The crossfader has two sides and every
// deck, A included, is on one of them or on neither (`xf`: "l", "r" or null;
// `mix.sideA` for deck A: a mixer's crossfader-assign switch). Deck A starts
// on the left and a loaded deck on the right; a deck on neither plays at its
// own fader whatever the crossfader says. The tempo slider runs from deck A's tempo to ONE deck's, `focus`,
// which is also the deck a call that names none means.

const DECK_LETTERS = "bcdefghijklmnopqrstuvwxyz";
// A song loaded in the clip view is a deck too, but the two views do not
// share them: the mix view's desk shows the decks loaded there (letters), the
// clip view the songs loaded there (`forClips`, ids "s1", "s2" ...).
function nextDeckId(m, clips = false) {
  const used = new Set(m.decks.map(d => d.id));
  if (clips) { for (let n = 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`; }
  for (const c of DECK_LETTERS) if (!used.has(c)) return c;
  for (let n = 27; ; n++) if (!used.has(`n${n}`)) return `n${n}`;
}
/** A deck's name as drawn: "B", "C" ... */
export function deckLabel(id) { return String(id || "").toUpperCase(); }

/** Every loaded deck, in the order they were loaded. */
export function mixDecks() { return state.mix?.decks || []; }
/** The decks on the mix view's desk: the ones loaded there. */
export function deskDecks() { return mixDecks().filter(d => !d.forClips); }
/** The songs loaded in the clip view. */
export function clipDecks() { return mixDecks().filter(d => d.forClips); }
/** The deck `id` names; with none given, the tempo's deck, else the desk's first. */
export function getDeck(id) {
  const m = state.mix;
  if (!m) return null;
  if (id != null) return m.decks.find(d => d.id === id) || null;
  return m.decks.find(d => d.id === m.focus) || deskDecks()[0] || m.decks[0] || null;
}
/** The deck the tempo slider runs to, or null. */
export function focusDeck() {
  const m = state.mix;
  return (m && m.decks.find(d => d.id === m.focus)) || null;
}
const deckLive = (d) => !!state.mix && state.mix.decks.includes(d);

/** A deck's own tracks (its buses included, the deck bus not). The crossfader's deck by default. */
export function deckBTracks(id) {
  const d = getDeck(id);
  return d ? state.tracks.filter(t => t._deck === d.id && !t._deckBus) : [];
}
/** The song's tracks: deck A. */
export function deckATracks() {
  return state.tracks.filter(inSong);
}

/** Something about the mix changed: the view repaints (never from inside the scheduler). */
function announce() {
  setTimeout(() => { try { window.dispatchEvent(new CustomEvent("seqbaby:mix")); } catch {} }, 0);
}

// ---- where a second song comes from ------------------------------------------
//
// The shell hands the engine its way to the account's songs (app/MixSongs.tsx),
// as it hands it the patch bay: `{ list(): [{id, title, note}], load(id):
// session }`. Without one (signed out, the legacy server) the picker still has
// this browser's saved sessions, a file and a share link.

let source = null;
export function setMixSource(backend) { source = backend && typeof backend.load === "function" ? backend : null; }
export function mixSource() { return source; }

// ---- loading a deck -------------------------------------------------------------

/** A deck's bus: an ordinary `bus` track, flagged, at unity. */
function makeDeckBus(deck) {
  const t = createTrack({ name: `deck ${deckLabel(deck)}`, engineKey: "bus", length: 16, params: { vol: 1 } });
  t._deckBus = deck;
  if (deck !== "a") t._deck = deck;
  t.el?.classList.add("is-deck-bus");
  if (t.el) t.el.dataset.deck = deck;
  const vol = trackControl(t, ".p-vol");
  if (vol) vol.value = "1";
  return t;
}

/**
 * Load a session onto a NEW deck, beside whatever is loaded (`info.replace`:
 * a deck id to take off first). Its tracks are built one per task (a track is
 * 50-100ms of main thread, and the other decks may be playing), stopped until
 * the deck is started, on the slot the song was saved on, and on the
 * crossfader's far side.
 * @param {Object} blob a session from serializeSet (or the song builder)
 * @param {{title?: string, source?: any, replace?: string}} [info]
 * @returns {Promise<boolean>} whether it loaded (false: ejected meanwhile)
 */
export function loadDeckB(blob, info = {}) {
  const check = validateSet(blob);
  if (!check.ok) throw new Error(`Not a readable seqbaby session: ${check.errors.join("; ")}`);
  const s = deepCopy(blob);
  migrateLegacyNames(s);
  const tds = (s.tracks || []).map(migrateTrackData);
  if (!tds.some(t => t.engineKey !== "bus")) throw new Error("that song has no tracks to play");
  if (info.replace && state.mix) ejectDeckB({ quiet: true, id: info.replace });

  let m = state.mix;
  if (!m) {
    m = state.mix = {
      decks: [], busA: null,
      x: 0, curve: "blend", fade: null,
      tempoX: 0, tempoLink: false,
      focus: null, landing: false,
      sideA: "l",
    };
  }
  const sum = deckSummary(s);
  const repeats = Array.from({ length: PATTERN_COUNT }, (_, i) => Math.max(1, Number(s.patternRepeats?.[i]) || 1));
  const d = {
    id: nextDeckId(m, !!info.clips),
    title: String(info.title || "").trim() || "untitled",
    source: info.source || null,
    // the loaded song's globals: what landing writes, and what the header reads
    globals: {
      bpm: sum.bpm, swing: Number.isFinite(s.swing) ? s.swing : null,
      scale: s.scale ? { active: !!s.scale.active, root: s.scale.root | 0, mode: s.scale.mode || "minor" } : { active: false, root: 0, mode: "minor" },
      patternMeters: Array.isArray(s.patternMeters) ? s.patternMeters : null,
      patternMode: s.patternMode, macroPads: Array.isArray(s.macroPads) ? s.macroPads : [],
      meter: meterOf(s, startSlot(s)),
    },
    bpm: sum.bpm,
    repeats,
    scene: startSlot(s), queued: null, barCount: 0, countOrigin: state.tick,
    chain: s.patternMode === "chain" || s.patternMode === "arrange",
    on: false, arm: null,
    // Loaded from the clip view (`info.clips`): a launcher has no crossfader
    // to bring a deck in with, so the deck is off it (at its own fader) and
    // awake with every clip stopped, ready for the first one launched.
    xf: info.clips ? null : "r",
    forClips: !!info.clips,
    bus: null,
    loading: true,
    pending: tds.slice(), made: [],
    refs: tds.map(td => ({ out: td.outIndex, comp: td.compSourceIndex })),
  };
  // read by the transport for every note this deck plays (noteForStep)
  d.scale = d.globals.scale;
  m.decks.push(d);
  if (!m.focus && !d.forClips) m.focus = d.id;
  // Nothing heavy yet. A bus is a track (50-100ms to build), and the songs
  // loaded may be playing: the scheduler is given its longer lookahead first,
  // and a moment to schedule that far ahead, and only then are the buses
  // built, one a task, like the tracks after them. Built here at once, the
  // two buses alone held the clock past the lookahead it had: late steps.
  stretchLookAhead();
  announce();
  setStatus(`deck ${deckLabel(d.id)}: loading "${d.title}"…`);
  return new Promise((resolve) => { d.resolve = resolve; setTimeout(() => buildBuses(d), state.playing ? LOOKAHEAD_SETTLE_MS : 0); });
}

/** How long a stretched lookahead is given to fill before heavy work starts. */
const LOOKAHEAD_SETTLE_MS = 160;

/** The deck buses, one a task: deck A's (the first deck loaded makes it), then this deck's. */
function buildBuses(d) {
  const m = state.mix;
  if (!deckLive(d)) { d.resolve?.(false); return; }
  if (!m.busA) {
    m.busA = makeDeckBus("a");
    placeBusesLast();
    refreshOutputSelects();
    // the song's tracks, through deck A's bus: the same level by another
    // path, so swapped rather than ducked
    if (state.ready) refreshAllTrackOutputs({ swap: true });
    applyXfade();
    announce();
    setTimeout(() => buildBuses(d), 0);
    return;
  }
  d.bus = makeDeckBus(d.id);
  aliasPattern(d.bus, d.scene);
  placeBusesLast();
  refreshOutputSelects();
  applyXfade();
  announce();
  setTimeout(() => buildNext(d), 0);
}

/**
 * One deck track from its serialized form (migrated), or null when it would
 * not load. Built as if the scene were the deck's: createTrack and the loader
 * alias a new track to `state.activePattern` and recall that slot's locked
 * sound, and this track's slot is the deck's. One synchronous task, put back
 * in `finally`, as serializeSet swaps the track list.
 */
function makeDeckTrack(d, td) {
  let t = null;
  const scene = state.activePattern;
  try {
    state.activePattern = d.scene;
    t = createTrack(trackShellFor(td));
    t._deck = d.id;
    t.el?.classList.add("is-deck-b");
    // A solo carried in would silence the song that is playing.
    loadTrackFromData(t, { ...td, soloed: false });
    // A deck plays its scene, not a timeline: the blocks wait for a landing.
    t._deckArrangement = t.arrangement?.length ? t.arrangement : null;
    t.arrangement = [];
    if (state.playing) seedTrackCount(t, state.tick - d.countOrigin);
  } catch (e) {
    console.error("mix: a deck track failed to load", e);
    if (t && state.tracks.includes(t)) { try { removeTrack(t); } catch {} }
    t = null;
  } finally {
    state.activePattern = scene;
  }
  return t;
}

function buildNext(d) {
  if (!deckLive(d)) { d.resolve?.(false); return; }      // ejected meanwhile
  const td = d.pending.shift();
  if (!td) { finishLoad(d); return; }
  const t = makeDeckTrack(d, td);
  if (t) paintTrackSlotBadge(t);
  d.made.push(t);
  placeBusesLast();
  orderDeck(d);
  announce();
  setTimeout(() => buildNext(d), 0);
}

/**
 * A deck's tracks in the order its song lists them. Each is made unflagged
 * (createTrack files it with the song's own) and flagged afterwards, which
 * lands it in front of the ones made before it.
 */
function orderDeck(d) {
  const made = d.made.filter(t => t && state.tracks.includes(t));
  const at = made.map(t => state.tracks.indexOf(t)).sort((x, y) => x - y);
  if (made.every((t, i) => state.tracks[at[i]] === t)) return;
  const next = state.tracks.slice();
  made.forEach((t, i) => { next[at[i]] = t; });
  state.tracks = next;
}

function finishLoad(d) {
  const made = d.made;
  // The cross-track references, now that every track exists: indices into the
  // loaded session, resolved against the tracks made from it, in its order.
  d.refs.forEach((ref, i) => {
    const t = made[i];
    if (!t) return;
    const bus = Number.isInteger(ref.out) && ref.out >= 0 ? made[ref.out] : null;
    t.out = bus && bus !== t && bus.engineKey === "bus" ? String(bus.id) : "master";
    resolveSoundSources(t, made, true);
    const src = Number.isInteger(ref.comp) && ref.comp >= 0 ? made[ref.comp] : null;
    t.comp.source = src && src !== t ? String(src.id) : "self";
  });
  for (const t of deckBTracks(d.id)) if (t.out !== "master" && wouldFeedback(t, t.out)) t.out = "master";
  placeBusesLast();
  refreshOutputSelects();
  refreshCompSourceDropdowns();
  if (state.ready) {
    refreshAllTrackOutputs();
    for (const t of deckBTracks(d.id)) { applyBusMute(t); applyCompressorConfig(t); }
    refreshNoiseBeds();
  }
  requestMidiIfNeeded();
  applyXfade();
  renderPatternGrid();
  d.loading = false;
  d.pending = null;
  if (d.forClips) wakeDeck(d.id);
  if (!mixDecks().some(x => x.loading)) restoreLookAhead();
  const n = deckBTracks(d.id).filter(t => t.engineKey !== "bus").length;
  const L = deckLabel(d.id);
  setStatus(`deck ${L}: "${d.title}" loaded, ${n} track${n === 1 ? "" : "s"} at ${d.bpm} bpm. Start it, then bring the crossfader over`);
  announce();
  d.resolve?.(true);
}

// ---- a deck as a session: read whole, and written in place ------------------------
//
// The compose panel's turn on a deck (app/ComposeChat.tsx): the model is sent
// the deck's song in the session format and its answer is merged back onto
// the deck's tracks, as a turn on the open song is merged onto the song's.

/**
 * A deck's song in the session format: its tracks (indices counted along
 * them), its own tempo, scale, repeats, meters and pads, and the pattern the
 * deck is on. Null with no such deck loaded.
 */
export function serializeDeckB(id) {
  const d = getDeck(id);
  if (!d || d.loading) return null;
  const all = state.tracks, scene = state.activePattern;
  const mine = deckBTracks(d.id);
  let s;
  // The song's serializer over the deck's tracks alone, on the deck's scene:
  // the same swap serializeSet makes to leave a staged track out.
  try {
    state.tracks = mine;
    state.activePattern = d.scene;
    s = serializeSet({ decks: true });
  } finally {
    state.tracks = all;
    state.activePattern = scene;
  }
  s.tracks.forEach((td, i) => {
    const blocks = mine[i]?._deckArrangement;
    if (blocks?.length) td.arrangement = blocks.map(b => ({ slot: b.slot, start: b.start, bars: b.bars }));
  });
  return {
    ...s,
    bpm: d.bpm,
    swing: d.globals.swing ?? s.swing,
    scale: { ...d.scale },
    activePattern: d.scene,
    patternMode: d.chain ? "chain" : "repeat",
    patternRepeats: d.repeats.slice(),
    patternMeters: d.globals.patternMeters || s.patternMeters,
    macroPads: d.globals.macroPads || [],
  };
}

/**
 * Write a session onto a deck in place: `mergeSet` (liveSet.js) scoped to the
 * deck, so the tracks that did not change keep the voices they are playing
 * with, new ones join in phase, and no other deck is touched. The deck's
 * tempo, scale, repeats and meters follow; the pattern it is on does not, as
 * a merge never moves the scene.
 * @returns {object|null} mergeSet's summary, or null with no such deck loaded
 */
export function mergeDeckB(session, id) {
  const m = state.mix;
  const d = getDeck(id);
  if (!m || !d || d.loading || m.landing) return null;
  const out = mergeSet(session, {
    serialize: () => serializeDeckB(d.id),
    tracks: () => deckBTracks(d.id),
    globals(cur, target) {
      if (Number(target.bpm) > 0) d.bpm = d.globals.bpm = Number(target.bpm);
      if (Number.isFinite(target.swing)) d.globals.swing = target.swing;
      if (target.scale) {
        d.scale = d.globals.scale = { active: !!target.scale.active, root: target.scale.root | 0, mode: target.scale.mode || "minor" };
      }
      if (Array.isArray(target.patternRepeats)) {
        for (let i = 0; i < PATTERN_COUNT; i++) d.repeats[i] = Math.max(1, Number(target.patternRepeats[i]) || 1);
      }
      if (Array.isArray(target.patternMeters)) d.globals.patternMeters = target.patternMeters;
      if (target.patternMode && target.patternMode !== cur.patternMode) d.chain = target.patternMode !== "repeat";
      d.globals.meter = meterOf(target, d.scene);
      applyTempo();
      return false;                    // the bar line's meter is deck A's
    },
    create(td) {
      const t = makeDeckTrack(d, td);
      if (!t) throw new Error(`deck ${deckLabel(d.id)}: "${td.name || "a track"}" would not load`);
      return t;
    },
    done(made, target) {
      // The blob's order is the deck's order now, and what its pads index.
      d.made = made.slice();
      d.globals.macroPads = Array.isArray(target.macroPads) ? target.macroPads : [];
      (target.tracks || []).forEach((td, i) => {
        const t = made[i];
        if (!t) return;
        // a deck plays its scene: any timeline waits for a landing
        if (t.arrangement?.length || td.arrangement?.length) t._deckArrangement = td.arrangement?.length ? td.arrangement : null;
        t.arrangement = [];
      });
      orderDeck(d);
    },
  });
  orderDeck(d);                        // after the merge's own last reorder
  placeBusesLast();
  applyXfade();
  announceClips();
  announce();
  return out;
}

// ---- a deck's transport ---------------------------------------------------------

// When a deck started while the transport runs comes in: on the next bar
// line, or held until deck A's pattern comes round (`pattern`), so the two
// songs' PHRASES line up and not only their bars. Per browser.
const START_KEY = "seqbaby.mixStart.v1";
export const DECK_STARTS = ["bar", "pattern"];
let startOn = "bar";
try { const v = window.localStorage.getItem(START_KEY); if (DECK_STARTS.includes(v)) startOn = v; } catch {}
export function deckStartMode() { return startOn; }
export function setDeckStartMode(mode) {
  if (!DECK_STARTS.includes(mode)) return;
  startOn = mode;
  try { window.localStorage.setItem(START_KEY, mode); } catch {}
  setStatus(mode === "pattern" ? "a deck started now comes in when deck A's pattern comes round" : "a deck started now comes in on the next bar");
  announce();
}

/**
 * Whether the bar line the transport is on (asked before its queue and chain
 * run) is where deck A's pattern starts over or gives way to the next: a
 * queued pattern landing, the chain's repeat count running out, or, in repeat
 * mode, the longest part coming back to its first step. In arrange mode a
 * bar line is all there is to go by.
 */
export function patternLine({ queue = true } = {}) {
  if (state.patternMode === "arrange") return true;
  // (`queue: false`: asked on behalf of the queue itself, which is waiting
  // for the pattern to come round rather than being the reason it does)
  if (queue && state.queuedPattern != null && (state._queueOnPattern || state.patternSwitchMode === "finish")) return true;
  if (state.patternMode === "chain" || state.patLoop) {
    const reps = Math.max(1, state.patternRepeats?.[state.activePattern] ?? 1);
    return (state.chainBarCount ?? 0) + 1 >= reps;
  }
  let best = null, most = -1;
  for (const t of deckATracks()) {
    if (t.engineKey === "bus" || t._staged || t._leaving || t._clipOff || !t.length) continue;
    const cycle = t.length / Math.max(0.0001, t.speed ?? 1);
    if (cycle > most) { most = cycle; best = t; }
  }
  if (!best) return true;
  return Math.round((best.trackTick ?? 0)) % best.length === 0;
}

/**
 * Start or stop a deck. A start waits for the bar line while the transport
 * runs, so the songs' ones land together; a stop is at once. With the
 * transport stopped the deck is armed and starts with it.
 */
export function setDeckPlaying(on, id, { when = "now" } = {}) {
  const d = getDeck(id);
  if (!d || d.loading) return;
  const L = deckLabel(d.id);
  on = !!on;
  if (!on && when === "pattern" && d.on && state.playing) {
    // armed to stop (`arm: false`): the deck plays its pattern out and stops
    // where it comes round (deckBar). Asked again, the stop is called off.
    d.arm = d.arm === false ? null : false;
    setStatus(d.arm === false ? `deck ${L} stops when its pattern comes round (double-click: now)` : `deck ${L} plays on`);
  } else if (on && d.on && d.arm === false) {
    d.arm = null;
    setStatus(`deck ${L} plays on`);
  } else if (!on) {
    d.on = false;
    d.arm = null;
    d.queued = null;
    releaseSilencedTracks();
    refreshNoiseBeds();
    setStatus(`deck ${L} stopped`);
  } else if (!state.playing) {
    d.on = true;
    d.arm = null;
    setStatus(`deck ${L} armed: it starts with the transport`);
  } else if (!d.on) {
    d.arm = true;
    setStatus(startOn === "pattern" ? `deck ${L} starts when deck A's pattern comes round` : `deck ${L} starts on the next bar`);
  }
  announce();
}

/**
 * Wake a deck for its clips: a deck that was never started is "on" with every
 * track's clip stopped, so the first clip launched on it sounds and nothing
 * else of the deck does. A deck already on is left as it is.
 */
export function wakeDeck(id) {
  const d = getDeck(id);
  if (!d || d.loading || d.on) return;
  for (const t of deckBTracks(d.id)) if (t.engineKey !== "bus") { t._clipOff = true; t._queuedSlot = null; }
  d.on = true;
  d.arm = null;
  refreshNoiseBeds();
  announceClips();
  announce();
}

/** The crossfader's gain on a deck right now (1 for a deck on neither side). */
export function deckXfadeGain(id) {
  return sideGains()[deckSide(id)] ?? 1;
}

/** Every track of a deck onto `slot` (its bus too: the bus's lanes are the pattern's). */
function putDeckOn(d, slot, { restart = false } = {}) {
  for (const t of state.tracks) {
    if (t._deck !== d.id || t._frozen) continue;     // frozen on a clip: it stays (trackDetail.js)
    const was = trackSlot(t);
    if (was !== slot) flushPatternSound(t, was);
    t._queuedSlot = null;
    t._clipOff = false;
    if (was !== slot) {
      aliasPattern(t, slot);
      if (recallPatternSound(t, slot)) t._soundUiStale = true;
    }
    if (restart) restartTrackCount(t);
    // always the deferred queue, one track per task: this runs inside the
    // scheduler on a bar line as often as it runs from a click
    queueTrackPaint(t);
  }
  d.scene = slot;
  d.queued = null;
  d.barCount = 0;
  if (restart) d.countOrigin = state.tick;
}

/**
 * A deck to pattern `slot`, by the switch mode the pattern bar honours: at the
 * bar line in "finish" mode while the deck plays, otherwise now.
 */
export function requestDeckScene(slot, id, { when } = {}) {
  const d = getDeck(id);
  if (!d || !Number.isInteger(slot) || slot < 0 || slot >= PATTERN_COUNT) return;
  const L = deckLabel(d.id);
  // `when`: "pattern" queues it for when the deck's pattern comes round (the
  // mix view's click), "now" switches at once (its double-click); unset, the
  // pattern bar's switch setting decides, at the bar line or now.
  const wait = when === "pattern" || (when !== "now" && state.patternSwitchMode === "finish");
  if (state.playing && d.on && wait) {
    d.queued = slot === d.scene && deckBTracks(d.id).every(t => t._frozen || (trackSlot(t) === slot && !t._clipOff)) ? null : slot;
    d.queuePhrase = when === "pattern";
    setStatus(d.queued == null ? `deck ${L}: pattern ${slot + 1}` : `deck ${L}: pattern ${slot + 1} queued${d.queuePhrase ? " for when this one comes round" : ""}`);
  } else {
    putDeckOn(d, slot);
    setStatus(`deck ${L}: pattern ${slot + 1}`);
  }
  announceClips();
  announce();
}

/** How many bars a deck's chain plays pattern `slot` for (1..16). */
export function setDeckRepeat(slot, bars, id) {
  const d = getDeck(id);
  if (!d || !(slot >= 0 && slot < PATTERN_COUNT)) return;
  d.repeats[slot] = Math.max(1, Math.min(16, Math.round(Number(bars)) || 1));
  announce();
}

/** Whether a deck plays through its patterns (its chain) or holds its scene. */
export function setDeckChain(on, id) {
  const d = getDeck(id);
  if (!d) return;
  d.chain = !!on;
  d.barCount = 0;
  setStatus(`deck ${deckLabel(d.id)} ${d.chain ? "plays through its patterns" : "repeats its pattern"}`);
  announce();
}

/**
 * Called by the transport once per step, after the bar line is worked out and
 * before the song's own queue and chain: the automatic fade a step at a time,
 * and on a bar line each deck's start, its queued scene and its chain.
 * @param {number} nextTime when the next step sounds
 * @param {boolean} barLine
 */
export function mixStep(nextTime, barLine) {
  const m = state.mix;
  if (!m) return;
  // where things that wait for the start setting may begin: the next bar
  // line, or the one deck A's pattern comes round on
  const phrase = barLine && (startOn !== "pattern" || patternLine());
  if (m.fade) {
    const f = m.fade;
    if (f.wait) {
      // an automatic fade starts where a started deck would
      if (phrase) { f.wait = false; f.from = m.x; announce(); }
    } else {
      f.done++;
      writeXfade(fadeAt(f.from, f.to, f.done, f.steps), nextTime);
      if (f.done >= f.steps) { m.fade = null; announce(); }
    }
  }
  if (!barLine) return;
  for (const d of m.decks) deckBar(d, phrase);
}

/**
 * Whether the bar line the transport is on is where a deck's own pattern
 * starts over or gives way to the next: its chain's repeat count running
 * out, or, holding one pattern, its longest part back at its first step.
 */
function deckPatternLine(d) {
  if (d.chain) return (d.barCount ?? 0) + 1 >= Math.max(1, d.repeats[d.scene] ?? 1);
  let best = null, most = -1;
  for (const t of deckBTracks(d.id)) {
    if (t.engineKey === "bus" || t._clipOff || t._frozen || !t.length) continue;
    const cycle = t.length / Math.max(0.0001, t.speed ?? 1);
    if (cycle > most) { most = cycle; best = t; }
  }
  return !best || Math.round(best.trackTick ?? 0) % best.length === 0;
}

/**
 * Deck A (the song) to pattern `slot` from the mix view: queued for when its
 * pattern comes round (`when: "pattern"`, committed by the transport), or at
 * once. Stopped, there is nothing to wait for.
 */
export function requestSongScene(slot, { when = "pattern" } = {}) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PATTERN_COUNT) return;
  if (!state.playing || when === "now") { switchPattern(slot); announce(); return; }
  const there = slot === state.activePattern && state.tracks.every(t => !onDeckA(t) || t._frozen || (trackSlot(t) === slot && !t._clipOff));
  state.queuedPattern = there ? null : slot;
  state._queueOnPattern = !there;
  renderPatternGrid();
  setStatus(there ? `pattern ${slot + 1}` : `pattern ${slot + 1} queued for when this one comes round`);
  announce();
}

/** One deck's bar line. `phrase`: an armed deck may start here. */
function deckBar(d, phrase) {
  if (d.loading) return;
  if (d.arm === true) {
    if (!phrase) return;
    d.arm = null;
    d.on = true;
    putDeckOn(d, d.queued ?? d.scene, { restart: true });
    refreshNoiseBeds();
    announce();
    return;
  }
  if (!d.on) return;
  // armed to stop: here, if this is where its pattern comes round
  if (d.arm === false && deckPatternLine(d)) {
    d.on = false;
    d.arm = null;
    d.queued = null;
    releaseSilencedTracks();
    refreshNoiseBeds();
    setStatus(`deck ${deckLabel(d.id)} stopped`);
    announce();
    return;
  }
  // a pattern queued for the pattern's end waits for it; one queued for the
  // bar line lands here
  if (d.queued != null && (!d.queuePhrase || deckPatternLine(d))) {
    putDeckOn(d, d.queued, { restart: true });
    announce();
    return;
  }
  if (!d.chain) return;
  d.barCount++;
  if (d.barCount < Math.max(1, d.repeats[d.scene] ?? 1)) return;
  d.barCount = 0;
  const next = nextFilled(filledSlots(deckBTracks(d.id)), d.scene);
  if (next >= 0 && next !== d.scene) {
    putDeckOn(d, next, { restart: true });
    announce();
  }
}

// ---- the crossfader -------------------------------------------------------------

/** A deck bus's output gain: what the crossfader moves (its fader stays the deck's own). */
function busOut(t) {
  return t?.fxRack?.output?.gain || null;
}

function glide(prm, v, at) {
  if (!prm) return;
  const now = state.audioCtx?.currentTime ?? 0;
  const when = Math.max(now, at ?? now);
  try { prm.cancelScheduledValues(when); prm.setTargetAtTime(v, when, 0.012); }
  catch { try { prm.value = v; } catch {} }
}

/** A deck's side of the crossfader: "l", "r" or null. `id` "a" is deck A. */
export function deckSide(id) {
  const m = state.mix;
  if (!m) return null;
  if (id === "a") return m.sideA === "l" || m.sideA === "r" ? m.sideA : null;
  const x = getDeck(id)?.xf;
  return x === "l" ? "l" : x ? "r" : null;
}

/** The crossfader's gain for a side: left, right, or unity for a deck on neither. */
function sideGains() {
  const m = state.mix;
  // switched off (`xfOff`), the crossfader is out of the circuit: every deck
  // at its own fader, wherever the slider sits
  const any = !!m && !m.xfOff && (deckSide("a") || m.decks.some(d => d.xf));
  const g = any ? xfadeGains(m.x, m.curve) : { a: 1, b: 1 };
  return { l: g.a, r: g.b };
}

/** Every deck at its side's gain; a deck on neither side at unity. */
function applyXfade(at) {
  const m = state.mix;
  if (!m) return;
  const g = sideGains();
  glide(busOut(m.busA), g[deckSide("a")] ?? 1, at);
  for (const d of m.decks) glide(busOut(d.bus), g[deckSide(d.id)] ?? 1, at);
}

function writeXfade(x, at) {
  const m = state.mix;
  if (!m) return;
  m.x = clamp01(x);
  applyXfade(at);
  if (m.tempoLink) { m.tempoX = m.x; applyTempo(); }
}

/** Move the crossfader by hand: 0 is all deck A, 1 all of its deck. Cancels a fade under way. */
export function setXfade(x) {
  const m = state.mix;
  if (!m) return;
  m.fade = null;
  writeXfade(x);
}

/**
 * Switch the crossfader off or on. Off, every deck plays at its own fader
 * whatever side it is on and wherever the slider sits; the sides and the
 * slider are kept for when it comes back.
 */
export function setXfadeOn(on) {
  const m = state.mix;
  if (!m) return;
  m.xfOff = !on;
  if (m.xfOff) m.fade = null;
  applyXfade();
  setStatus(m.xfOff ? "crossfader off: every deck plays at its own fader" : "crossfader on");
  announce();
}

export function setXfadeCurve(curve) {
  const m = state.mix;
  if (!m || !XFADE_CURVES.includes(curve)) return;
  m.curve = curve;
  applyXfade();
  announce();
}

/**
 * Put a deck on a side of the crossfader, or take it off (a mixer's assign
 * switch). `side`: "l", "r", or false / null for off (true is the right, as
 * it was). `id` "a" is deck A. Off, a deck plays at its own fader whatever
 * the crossfader says.
 */
export function setDeckXfade(side, id) {
  const m = state.mix;
  if (!m) return;
  const to = side === "l" ? "l" : side === "r" || side === true ? "r" : null;
  if (id === "a") m.sideA = to;
  else {
    const d = getDeck(id);
    if (!d) return;
    d.xf = to;
    id = d.id;
  }
  applyXfade();
  setStatus(`deck ${deckLabel(id)} is ${to ? `on the crossfader's ${to === "l" ? "left" : "right"}` : "off the crossfader: it plays at its own fader"}`);
  announce();
}

/** Which deck's tempo the tempo slider runs to. */
export function setTempoDeck(id) {
  const m = state.mix;
  const d = getDeck(id);
  if (!m || !d || m.focus === d.id) return;
  m.focus = d.id;
  applyTempo();
  announce();
}

/** Fold a gain into a bus's own fader: the level stays when the gain goes. */
function foldLevel(bus, gain) {
  if (!bus) return;
  const vol = trackControl(bus, ".p-vol");
  if (!vol) return;
  const next = String(bakeLevel(Number(vol.value), gain));
  if (next === vol.value) return;
  vol.value = next;
  vol.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Fade to a deck over `bars` bars, a step at a time on the transport's clock
 * (the crossfader as a transition's sweep is: one press, the song does it).
 * Stopped, or with no bars, it jumps. It starts where a started deck does
 * (the `start:` setting): on the next bar line, or when deck A's pattern
 * comes round, so a fade runs over whole bars of a phrase; `now` starts it
 * at once. "a" / "l" is the
 * left side; anything else the right.
 * @param {string} deck @param {number} bars
 */
export function fadeToDeck(deck, bars, { now = false } = {}) {
  const m = state.mix;
  if (!m || m.xfOff) return;
  const to = deck === "a" || deck === "l" ? 0 : 1;
  const steps = Math.max(0, Math.round(Number(bars) || 0)) * stepsPerBarForMeter(transportMeter());
  if (!state.playing || !steps) { m.fade = null; writeXfade(to); announce(); return; }
  // `now` (the button's double-click): it starts on the next step instead of
  // waiting for the bar or the pattern
  m.fade = { from: m.x, to, steps, done: 0, wait: !now };
  setStatus(`fading to the crossfader's ${to ? "right" : "left"} over ${bars} bar${bars === 1 ? "" : "s"}, from ${now ? "now" : startOn === "pattern" ? "deck A's next pattern" : "the next bar"}`);
  announce();
}

// ---- the tempo ------------------------------------------------------------------

/** The tempo the mix is playing at: between the song's and the tempo deck's by `tempoX`. */
export function mixTempo() {
  const m = state.mix;
  const f = focusDeck();
  return m && f ? mixBpm(fieldBpm(), f.bpm, m.tempoX) : fieldBpm();
}

function applyTempo() {
  if (!state.mix || !state.ready) return;
  try { Tone.getTransport().bpm.value = mixTempo(); } catch {}
}

/** 0 the song's tempo, 1 the tempo deck's. Only the transport moves (see the top of the file). */
export function setMixTempo(x) {
  const m = state.mix;
  if (!m) return;
  m.tempoX = clamp01(x);
  applyTempo();
}

/**
 * Set a deck's tempo to the one playing: the deck is then "at" this tempo, so
 * its header says so, the tempo slider no longer pulls away from it towards
 * what the song was saved at, and landing it keeps the tempo being heard.
 * (Every deck already PLAYS at the transport's tempo: there is one clock.)
 */
export function matchDeckTempo(id) {
  const m = state.mix;
  const d = getDeck(id);
  if (!m || !d) return false;
  const bpm = Math.round(mixTempo() * 100) / 100;
  d.bpm = bpm;
  // the slider runs to this deck: it is at the deck's end now, and stays put
  if (m.focus === d.id) { m.tempoX = 1; m.tempoLink = false; }
  applyTempo();
  setStatus(`deck ${deckLabel(d.id)} is at ${bpm} bpm now, the tempo playing`);
  announce();
  return true;
}

/** Whether the tempo rides the crossfader. */
export function setTempoLink(on) {
  const m = state.mix;
  if (!m) return;
  m.tempoLink = !!on;
  if (m.tempoLink) { m.tempoX = m.x; applyTempo(); }
  announce();
}

// ---- ending the mix -------------------------------------------------------------

/**
 * Tracks on their way out: withheld, hidden from every reader, removed once
 * faded, ONE PER TASK (removing a track is tens of milliseconds of main
 * thread, and a deck's worth in one task held the scheduler past its
 * lookahead). `done` runs after the last has gone.
 */
function sendOff(tracks, afterMs = 70, done = null) {
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of tracks) {
    t._leaving = true;
    t._clipOff = true;
    // no longer any deck's, never the song's (deck A's bus keeps its own flag)
    if (t._deck || !t._deckBus) t._deck = "~";
    try { t.voice?.releaseHeld?.(now); } catch {}
  }
  const next = () => {
    const t = tracks.find(x => state.tracks.includes(x));
    if (!t) {
      announceClips();
      announce();
      try { done?.(); } catch (e) { console.error(e); }
      return;
    }
    try { removeTrack(t); } catch (e) { console.error("mix: removing a track failed", e); }
    setTimeout(next, 0);
  };
  setTimeout(next, afterMs);
}

/**
 * Take a deck off (the tempo's deck by default): its tracks and its bus go.
 * The last one out takes deck A's bus with it, and the song is routed back
 * to the master, at its own tempo, exactly as it was.
 */
export function ejectDeckB({ quiet = false, id } = {}) {
  const m = state.mix;
  const d = getDeck(id);
  if (!m || !d) return false;
  d.pending = null;
  const last = m.decks.length === 1;
  const gone = state.tracks.filter(t => t._deck === d.id || (last && t._deckBus));
  glide(busOut(d.bus), 0);
  m.decks = m.decks.filter(x => x !== d);
  if (last) state.mix = null;
  else if (m.focus === d.id) {
    // The tempo's deck went: the tempo is the song's again, and the slider
    // runs to the next deck.
    m.focus = deskDecks()[0]?.id ?? null;
    m.tempoX = 0;
    m.tempoLink = false;
  }
  if (state.playing) stretchLookAhead();
  sendOff(gone, 70, () => { if (!mixDecks().some(x => x.loading)) restoreLookAhead(); });
  if (state.ready) {
    if (last) {
      refreshAllTrackOutputs({ swap: true });      // the song's tracks, back to the master
      try { Tone.getTransport().bpm.value = fieldBpm(); } catch {}
    } else { applyXfade(); applyTempo(); }
  }
  refreshOutputSelects();
  refreshCompSourceDropdowns();
  refreshNoiseBeds();
  d.resolve?.(false);
  if (!quiet) setStatus(`deck ${deckLabel(d.id)} ejected: "${d.title}" is gone${last ? ", the song is as it was" : ""}`);
  announceClips();
  announce();
  return true;
}

/**
 * Take ONE track off a deck: the track goes, the rest of the deck plays on.
 * Not in the undo stack (a deck is not in the song). The deck's last track
 * takes the deck with it. A track of the song's own is not this function's:
 * its `remove` button is, which asks first and can be undone.
 * @returns {boolean} whether it went
 */
export function ejectDeckTrack(t) {
  const d = (t?._deck && mixDecks().find(x => x.id === t._deck)) || null;
  if (!d || t._deckBus || d.loading || state.mix?.landing) return false;
  const left = deckBTracks(d.id).filter(x => x !== t && x.engineKey !== "bus");
  if (!left.length) return ejectDeckB({ id: d.id });
  const name = t.name || "track";
  sendOff([t]);
  setTimeout(() => {
    refreshOutputSelects();
    refreshCompSourceDropdowns();
    refreshNoiseBeds();
  }, 90);
  setStatus(`deck ${deckLabel(d.id)}: "${name}" ejected`);
  announceClips();
  announce();
  return true;
}

/** Every note of a track snapped to `scale`, in every pattern: what it has been playing. */
function bakeScale(t, scale) {
  const intervals = scale?.active ? SCALES[scale.mode] : null;
  if (!intervals || t.engineKey === "bus") return;
  for (const p of t.patterns || []) {
    if (!p?.notes) continue;
    for (let i = 0; i < p.notes.length; i++) {
      let n = p.notes[i];
      if (typeof n === "string") n = nameToMidi(n);
      if (typeof n === "number" && Number.isFinite(n)) p.notes[i] = quantizeToScale(n, scale.root, intervals);
    }
  }
}

/**
 * Keep every deck as one song. The flags come off, the deck buses become the
 * song's buses with every master-bound track sent to its own, the crossfader's
 * balance is folded into the bus faders it was between, and the tempo the
 * mix is at is the song's. One undo step.
 *
 * Songs can be in different scales and a session has one: when any differs
 * each deck's notes are written as they have been sounding (snapped to its
 * own scale) and the session's scale is switched off, so nothing changes pitch.
 */
export function keepBothDecks() {
  const m = state.mix;
  if (!m || m.landing || !deskDecks().length || m.decks.some(d => d.loading)) return false;
  // The desk's decks are what is kept. The songs loaded in the clip view are
  // that view's own, and go: one song cannot hold a deck that is still loose.
  const loose = clipDecks();
  for (const c of loose) ejectDeckB({ quiet: true, id: c.id });
  flushHistory();
  const bpm = Math.round(mixTempo() * 100) / 100;
  const a = deckATracks();
  const decks = m.decks.map(d => ({ d, tracks: deckBTracks(d.id) }));

  if (m.decks.some(d => !sameScale(state.scale, d.scale))) {
    for (const t of a) bakeScale(t, state.scale);
    for (const { d, tracks } of decks) for (const t of tracks) bakeScale(t, d.scale);
    state.scale.active = false;
    syncScaleUI();
    refreshChanceScale();
  }
  // Each deck's scene moves to the song's: a swap in each of its tracks' banks,
  // so nothing is lost and a reload (which puts every track on the scene)
  // plays what is playing now.
  const scene = state.activePattern;
  for (const { d, tracks } of decks) {
    if (d.scene === scene) continue;
    for (const t of [...tracks, d.bus]) {
      const here = trackSlot(t);
      flushPatternSound(t, here);
      const tmp = t.patterns[scene]; t.patterns[scene] = t.patterns[d.scene]; t.patterns[d.scene] = tmp;
      const now = here === d.scene ? scene : here === scene ? d.scene : here;
      aliasPattern(t, now);
      queueTrackPaint(t);
    }
    const r = state.patternRepeats;
    if ((r[scene] ?? 1) === 1 && d.repeats[d.scene] > 1) r[scene] = d.repeats[d.scene];
  }
  // Each deck's own buses say whose they are: two songs each with a "room"
  // would otherwise be two strips called "room" in one song. One that
  // already ends in a deck's letter (kept before) keeps its name, and a name
  // already in the song (a song kept once, then kept again with another
  // deck) moves on to the next letter free, the deck buses' own included.
  const taken = new Set(a.filter(t => t.engineKey === "bus" && /\s[a-z]$/i.test(t.name || "")).map(t => t.name.trim().toLowerCase()));
  const rename = (t, name) => {
    taken.add(name.toLowerCase());
    if (t.name === name) return;
    const field = trackControl(t, ".sq-track__name");
    if (field) { field.value = name; field.dispatchEvent(new Event("input", { bubbles: true })); }
    t.name = name;
  };
  const free = (base, letter, upper) => {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let k = Math.max(0, letters.indexOf(letter.toLowerCase()));
    for (let n = 0; n < 26 && taken.has(`${base} ${letters[k]}`.toLowerCase()); n++) k = (k + 1) % 26;
    return `${base} ${upper ? letters[k].toUpperCase() : letters[k]}`;
  };
  const tag = (list, id) => {
    for (const t of list) {
      if (t.engineKey !== "bus" || /\s[a-z]$/i.test(t.name || "")) continue;
      rename(t, free((t.name || "bus").trim(), id, false));
    }
  };
  tag(a, "a");
  for (const { d, tracks } of decks) tag(tracks, d.id);
  rename(m.busA, free("deck", "a", true));
  for (const d of m.decks) rename(d.bus, free("deck", d.id, true));
  // The sends become the song's own.
  for (const t of a) if (!t.out || t.out === "master") t.out = String(m.busA.id);
  for (const { d, tracks } of decks) for (const t of tracks) if (!t.out || t.out === "master") t.out = String(d.bus.id);
  // The crossfader goes; its balance stays, in the faders it was between.
  const g = sideGains();
  foldLevel(m.busA, g[deckSide("a")] ?? 1);
  for (const d of m.decks) foldLevel(d.bus, g[deckSide(d.id)] ?? 1);
  for (const bus of [m.busA, ...m.decks.map(d => d.bus)]) glide(busOut(bus), 1);
  for (const t of [...decks.flatMap(x => x.tracks), m.busA, ...m.decks.map(d => d.bus)]) {
    t._deck = undefined;
    t._deckBus = undefined;
    t.el?.classList.remove("is-deck-b", "is-deck-bus");
    if (t._deckArrangement) t.arrangement = t._deckArrangement;
    t._deckArrangement = null;
  }
  const n = m.decks.length + 1;
  state.mix = null;
  placeBusesLast();
  const field = /** @type {HTMLInputElement|null} */ (document.getElementById("bpm"));
  if (field && Number(field.value) !== bpm) {
    field.value = String(bpm);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  settle();
  markExternalEdit("keep the decks");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  setStatus(`${n === 2 ? "both" : `all ${n}`} decks kept as one song at ${bpm} bpm: each deck is a bus now, with the crossfader's balance in its fader`);
  return true;
}

/** Everything that draws the track list, after the song's tracks changed under it. */
function settle() {
  refreshOutputSelects();
  refreshCompSourceDropdowns();
  if (state.ready) {
    refreshAllTrackOutputs();
    for (const t of state.tracks) applyBusMute(t);
    refreshNoiseBeds();
  }
  for (const t of state.tracks) paintTrackSlotBadge(t);
  refreshAllPatternLockUI();
  renderPatternGrid();
  syncRepeatsUI();
  syncMeterUI();
  announceClips();
  announce();
}

/**
 * Land: a deck (the tempo's by default) becomes the song. Its tracks stay
 * exactly as they are playing (edits made on the deck included), its scale,
 * bank settings and macro pads come in, the tempo the mix is at becomes the
 * song's, and the old song's tracks go, with every other deck. One undo
 * step, which brings the old song back.
 *
 * **It lands without a gap.** Re-pointing the deck's tracks from their bus to
 * the master the ordinary way ducks each one (FXRack.softSwitch), all at the
 * same instant: a hole in the song at the moment it arrives. So they are
 * connected to a landing gain as well, that gain rises as the two deck buses
 * fall (the same signal twice, so a linear crossfade holds the level), and
 * the landing gain is what "master" means for the song's tracks until the
 * transport next stops (`state._landGain`, read by signal.js), when everything
 * is re-pointed in silence.
 * @returns {Promise<boolean>}
 */
export function landDeckB(id) {
  const m = state.mix;
  const d = getDeck(id);
  if (!m || !d || d.loading || m.landing) return Promise.resolve(false);
  flushHistory();
  const bpm = Math.round(mixTempo() * 100) / 100;      // before the other decks go: the tempo being heard
  // The landing's own work (the old song's tracks taken down, the globals,
  // every list repainted) is main thread the scheduler has to see past.
  if (state.playing) stretchLookAhead();
  for (const other of m.decks.slice()) if (other !== d) ejectDeckB({ quiet: true, id: other.id });
  m.landing = true;
  m.fade = null;
  announce();
  const LAND_MS = 45;
  const ctx = state.audioCtx;
  const live = state.ready && ctx && state.masterGain;
  let land = null;
  if (live) {
    const now = ctx.currentTime;
    land = state._landGain || ctx.createGain();
    if (!state._landGain) { try { land.connect(state.masterGain); } catch {} }
    const was = state._landGain ? 1 : 0;
    // The deck's tracks that go straight to its bus: onto the landing gain as
    // well, which starts where they are not yet heard through it.
    const direct = deckBTracks(d.id).filter(t => (!t.out || t.out === "master") && t.fxRack);
    if (!was) {
      try { land.gain.cancelScheduledValues(now); land.gain.setValueAtTime(0, now); land.gain.linearRampToValueAtTime(1, now + LAND_MS / 1000); } catch {}
      for (const t of direct) { try { t.fxRack.output.connect(land); } catch {} }
    }
    for (const bus of [m.busA, d.bus]) {
      const g = busOut(bus);
      // with a landing gain already in place the deck has no second path to
      // rise on, so its bus stays up until it is removed
      if (!g || (was && bus === d.bus)) continue;
      try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + LAND_MS / 1000); } catch {}
    }
    d._landDirect = was ? [] : direct;
  }
  return new Promise((resolve) => {
    // What is HEARD changes over LAND_MS (the gains above); the bookkeeping
    // waits for the lookahead to have filled.
    setTimeout(() => { resolve(finishLanding(m, d, land, bpm)); }, live ? Math.max(LAND_MS + 15, state.playing ? LOOKAHEAD_SETTLE_MS : 0) : 0);
  });
}

function finishLanding(m, d, land, bpm) {
  if (state.mix !== m || !m.decks.includes(d)) return false;     // a song arrived meanwhile
  const b = deckBTracks(d.id);
  const old = state.tracks.filter(t => inSong(t) || t._deckBus);
  // The blob's order first (the macro pads index into it), then anything
  // added on the deck since (a duplicate).
  const order = [...d.made.filter(t => t && b.includes(t)), ...b.filter(t => !d.made.includes(t))];

  if (land && d._landDirect?.length) {
    state._landGain = land;
    // already where the routing will say they go: no re-point, no duck
    for (const t of d._landDirect) if (t.fxRack) { t.fxRack._routedTo = land; t.fxRack._routedMeter = t.meterAnalyser; }
  }
  for (const t of b) {
    t._deck = undefined;
    t.el?.classList.remove("is-deck-b");
    if (t._deckArrangement) t.arrangement = t._deckArrangement;
    t._deckArrangement = null;
  }
  state.mix = null;
  sendOff(old, 0, () => { settle(); restoreLookAhead(); });
  // the old song's tracks are still in the list until the timer above runs;
  // every write below is to the new song's
  for (const t of old) { try { t.voice?.silence?.(state.audioCtx?.currentTime ?? 0); } catch {} }

  // The deck's globals, each guarded on having moved (liveSet.js).
  const cur = serializeSet();
  const g = d.globals;
  const target = {
    ...cur,
    bpm,
    swing: g.swing ?? cur.swing,
    scale: g.scale,
    patternMode: d.chain ? "chain" : "repeat",
    patternRepeats: d.repeats,
    patternMeters: g.patternMeters || cur.patternMeters,
  };
  const metersMoved = applyGlobalsInPlace(cur, target, { pads: false });
  state.activePattern = d.scene;
  state.queuedPattern = null;
  state.patLoop = null;
  state.chainBarCount = d.barCount;
  if (state.playing) {
    if (d.on) state._countOrigin = d.countOrigin;
    else {
      // never started: it comes in on the bar the transport is in
      state._countOrigin = state.tick - (state.barTick ?? 0);
      for (const t of order) seedTrackCount(t, state.barTick ?? 0);
    }
  }
  if (metersMoved) for (const t of order) { aliasPattern(t, trackSlot(t)); renderStepGrid(t); }
  applyMacroPads(g.macroPads, d.made.map(t => (t && order.includes(t) ? t : undefined)));
  placeBusesLast();
  const first = order.find(t => t.engineKey !== "bus");
  if (first) setActiveTrack(first);
  for (const t of order) if (t._soundUiStale) { t._soundUiStale = false; refreshPatternSoundUI(t); }
  markExternalEdit(`land deck ${deckLabel(d.id)}`);
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  setStatus(`landed: "${d.title}" is the song now, at ${bpm} bpm`);
  // The shell's open-song slot named the old song: the next save must not file
  // this one as a version of it (app/MixSongs.tsx).
  try { window.dispatchEvent(new CustomEvent("seqbaby:mixlanded", { detail: { title: d.title, source: d.source } })); } catch {}
  return true;
}

/** Write a track's name, and the field that shows it. */
function nameTrack(t, name) {
  if (!t || t.name === name) return;
  const field = trackControl(t, ".sq-track__name");
  if (field) { field.value = name; field.dispatchEvent(new Event("input", { bubbles: true })); }
  t.name = name;
}

/**
 * Eject deck A: the open song's tracks go, and every deck moves back a
 * letter. Deck B becomes deck A, which is to say the song (its tracks as they
 * are playing, its scale, bank, pads and the tempo being heard, as a landing
 * brings them), C becomes B, and so on. With one deck loaded that is a
 * landing and the mix ends.
 *
 * Nothing that is sounding is re-pointed: the deck's own bus BECOMES deck A's
 * bus, and the crossfader is mirrored so that deck A is on its left again
 * with every level where it was. One undo step brings the old song back.
 * @returns {Promise<boolean>}
 */
export function ejectDeckA() { return promoteDeck(deskDecks()[0]); }

/**
 * The clip view's own version: the song goes, and the first song loaded in
 * the clip view becomes the song (its clips stay as they are, stopped or
 * playing), the others moving up a number. The mix view's decks stay put.
 */
export function ejectClipSong() { return promoteDeck(clipDecks()[0]); }

function promoteDeck(d) {
  const m = state.mix;
  if (!m || !d || d.loading || m.landing) return Promise.resolve(false);
  const clips = !!d.forClips;
  if (m.decks.length === 1) return landDeckB(d.id);
  flushHistory();
  const bpm = Math.round(mixTempo() * 100) / 100;
  if (state.playing) stretchLookAhead();
  const b = deckBTracks(d.id);
  const oldSong = state.tracks.filter(inSong);
  const oldBus = m.busA;
  const order = [...d.made.filter(t => t && b.includes(t)), ...b.filter(t => !d.made.includes(t))];
  const side = deckSide(d.id);

  // the old song leaves under its own bus, which goes with it
  glide(busOut(oldBus), 0);
  if (oldBus) { oldBus._deck = "~"; oldBus._deckBus = "~"; }
  for (const t of oldSong) { try { t.voice?.silence?.(state.audioCtx?.currentTime ?? 0); } catch {} }

  // the deck is the song, and its bus is deck A's
  const bus = d.bus;
  bus._deck = undefined;
  bus._deckBus = "a";
  if (bus.el) bus.el.dataset.deck = "a";
  nameTrack(bus, "deck A");
  m.busA = bus;
  // The crossfader follows the shift. The deck that is deck A now was on the
  // right, and deck A belongs on the left: the whole crossfader is mirrored
  // (the fader to the other end, and a deck that is PLAYING to the other
  // side with it), which leaves everything heard exactly where it was, since
  // the two sides' curves mirror each other. A deck that is not playing
  // keeps its side: it is the next one to bring in, and belongs opposite
  // deck A. So after B was brought in and A ejected, the fader is back at
  // the left with the new deck A full, and the next deck waits on the right.
  if (clips) { /* a clip song is on no side: deck A stays where it is */ }
  else if (side === "r") {
    m.x = 1 - m.x;
    for (const x of m.decks) if (x !== d && x.xf && x.on) x.xf = x.xf === "l" ? "r" : "l";
    m.sideA = "l";
  } else m.sideA = side;
  for (const t of b) {
    t._deck = undefined;
    t.el?.classList.remove("is-deck-b");
    if (t._deckArrangement) t.arrangement = t._deckArrangement;
    t._deckArrangement = null;
  }
  m.decks = m.decks.filter(x => x !== d);

  // every other deck on the desk back a letter (in order, so each letter is
  // free when taken); the clip view's songs keep their own names
  const shift = (x, to) => {
    if (to === x.id) return;
    const from = x.id;
    for (const t of state.tracks) {
      if (t._deck === from) t._deck = to;
      if (t._deckBus === from) { t._deckBus = to; if (t.el) t.el.dataset.deck = to; }
    }
    if (new RegExp(`^deck ${deckLabel(from)}$`, "i").test(x.bus?.name || "")) nameTrack(x.bus, `deck ${deckLabel(to)}`);
    x.id = to;
  };
  if (clips) clipDecks().forEach((x, i) => shift(x, `s${i + 1}`));
  else deskDecks().forEach((x, i) => shift(x, DECK_LETTERS[i] || x.id));
  if (!clips || !deskDecks().some(x => x.id === m.focus)) m.focus = deskDecks()[0]?.id ?? null;
  m.tempoX = 0;                                    // the tempo being heard is the song's now
  m.tempoLink = false;
  m.fade = null;

  sendOff([...oldSong, ...(oldBus ? [oldBus] : [])], 0, () => { settle(); restoreLookAhead(); });

  // The deck's globals, each guarded on having moved (liveSet.js), as a landing writes them.
  const cur = serializeSet();
  const g = d.globals;
  const target = {
    ...cur,
    bpm,
    swing: g.swing ?? cur.swing,
    scale: g.scale,
    patternMode: d.chain ? "chain" : "repeat",
    patternRepeats: d.repeats,
    patternMeters: g.patternMeters || cur.patternMeters,
  };
  const metersMoved = applyGlobalsInPlace(cur, target, { pads: false });
  state.activePattern = d.scene;
  state.queuedPattern = null;
  state._queueOnPattern = false;
  state.patLoop = null;
  state.chainBarCount = d.barCount;
  if (state.playing) {
    if (d.on) state._countOrigin = d.countOrigin;
    else {
      state._countOrigin = state.tick - (state.barTick ?? 0);
      for (const t of order) seedTrackCount(t, state.barTick ?? 0);
    }
  }
  if (metersMoved) for (const t of order) { aliasPattern(t, trackSlot(t)); renderStepGrid(t); }
  applyMacroPads(g.macroPads, d.made.map(t => (t && order.includes(t) ? t : undefined)));
  placeBusesLast();
  const first = order.find(t => t.engineKey !== "bus");
  if (first) setActiveTrack(first);
  for (const t of order) if (t._soundUiStale) { t._soundUiStale = false; refreshPatternSoundUI(t); }
  applyTempo();
  applyXfade();
  refreshNoiseBeds();
  markExternalEdit("eject deck A");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  setStatus(clips
    ? `song removed: "${d.title}" is the song now, at ${bpm} bpm`
    : `deck A ejected: "${d.title}" is deck A and the song now, at ${bpm} bpm, and the other decks moved back a letter`);
  try { window.dispatchEvent(new CustomEvent("seqbaby:mixlanded", { detail: { title: d.title, source: d.source } })); } catch {}
  announceClips();
  announce();
  return Promise.resolve(true);
}

// ---- keeping it honest ------------------------------------------------------------

export function installMix() {
  // A whole session arriving tears every track down, the decks' with them.
  const dropped = () => {
    const m = state.mix;
    if (!m) return;
    state.mix = null;
    for (const d of m.decks) { d.pending = null; d.resolve?.(false); }
    restoreLookAhead();
    for (const t of state.tracks.filter(x => x._deck || x._deckBus)) { try { removeTrack(t); } catch {} }
    announce();
  };
  window.addEventListener("seqbaby:setapplied", dropped);
  window.addEventListener("seqbaby:newset", dropped);
  // A play press writes the transport's tempo from the field, and the first
  // one builds the audio graph: the mix's tempo and the crossfader go back on.
  // A stop is when the landing gain can be let go, in silence.
  window.addEventListener("seqbaby:transport", () => {
    const m = state.mix;
    if (m) {
      for (const d of m.decks) {
        if (state.playing) { d.barCount = 0; d.countOrigin = 0; }
        else { d.arm = null; d.queued = null; }
      }
      if (state.playing) m.fade = null;
      applyTempo();
      applyXfade();
      announce();
    }
    if (!state.playing && state._landGain) {
      state._landGain = null;
      if (state.ready) refreshAllTrackOutputs();
    }
  });
  // The song's tempo moved (typed, an undo, a merge): the mix's sits between
  // it and the tempo deck's, so it moves too. After main.js's own
  // listener, which wrote the field's value to the transport.
  document.getElementById("bpm")?.addEventListener("input", () => { if (state.mix) applyTempo(); });
}
