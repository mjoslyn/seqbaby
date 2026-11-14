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
import { aliasPattern, inSong, paintTrackSlotBadge, queueTrackPaint, state, syncMeterUI, syncRepeatsUI, trackSlot } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, quantizeToScale } from "./theory.js";
import { nameToMidi } from "./theoryData.js";
import { createTrack, removeTrack } from "./track.js";
import { restoreLookAhead, stretchLookAhead } from "./transition.js";
import { requestMidiIfNeeded } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const fieldBpm = () => Number(document.getElementById("bpm")?.value) || 120;

/** Deck B's own tracks (its buses included, the deck bus not). */
export function deckBTracks() {
  return state.tracks.filter(t => t._deck === "b" && !t._deckBus);
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
// as it hands it the patch bay: `{ list(): [{id, title, bpm}], load(id):
// session }`. Without one (signed out, the legacy server) the picker still has
// this browser's saved sessions, a file and a share link.

let source = null;
export function setMixSource(backend) { source = backend && typeof backend.load === "function" ? backend : null; }
export function mixSource() { return source; }

// ---- loading deck B -----------------------------------------------------------

/** A deck's bus: an ordinary `bus` track, flagged, at unity. */
function makeDeckBus(deck) {
  const t = createTrack({ name: deck === "a" ? "deck A" : "deck B", engineKey: "bus", length: 16, params: { vol: 1 } });
  t._deckBus = deck;
  if (deck === "b") t._deck = "b";
  t.el?.classList.add("is-deck-bus");
  if (t.el) t.el.dataset.deck = deck;
  const vol = trackControl(t, ".p-vol");
  if (vol) vol.value = "1";
  return t;
}

/**
 * Load a session onto deck B. Its tracks are built one per task (a track is
 * 50-100ms of main thread, and the song on deck A may be playing), stopped
 * until the deck is started, on the slot the song was saved on.
 * @param {Object} blob a session from serializeSet (or the song builder)
 * @param {{title?: string, source?: any}} [info]
 * @returns {Promise<boolean>} whether it loaded (false: replaced or ejected meanwhile)
 */
export function loadDeckB(blob, info = {}) {
  const check = validateSet(blob);
  if (!check.ok) throw new Error(`Not a readable seqbaby session: ${check.errors.join("; ")}`);
  const s = deepCopy(blob);
  migrateLegacyNames(s);
  const tds = (s.tracks || []).map(migrateTrackData);
  if (!tds.some(t => t.engineKey !== "bus")) throw new Error("that song has no tracks to play");
  if (state.mix) ejectDeckB({ quiet: true });

  const sum = deckSummary(s);
  const repeats = Array.from({ length: PATTERN_COUNT }, (_, i) => Math.max(1, Number(s.patternRepeats?.[i]) || 1));
  const m = state.mix = {
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
    x: 0, curve: "blend", fade: null,
    tempoX: 0, tempoLink: false,
    busA: null, busB: null,
    loading: true, landing: false,
    pending: tds.slice(), made: [],
    refs: tds.map(td => ({ out: td.outIndex, comp: td.compSourceIndex })),
  };
  // read by the transport for every note deck B plays (noteForStep)
  m.scale = m.globals.scale;

  m.busA = makeDeckBus("a");
  m.busB = makeDeckBus("b");
  aliasPattern(m.busB, m.scene);
  placeBusesLast();
  refreshOutputSelects();
  if (state.ready) refreshAllTrackOutputs();     // the song's tracks, through deck A's bus
  applyXfade();
  stretchLookAhead();
  announce();
  setStatus(`deck B: loading "${m.title}"…`);
  return new Promise((resolve) => { m.resolve = resolve; setTimeout(() => buildNext(m), 0); });
}

/**
 * One deck B track from its serialized form (migrated), or null when it would
 * not load. Built as if the scene were deck B's: createTrack and the loader
 * alias a new track to `state.activePattern` and recall that slot's locked
 * sound, and this track's slot is the deck's. One synchronous task, put back
 * in `finally`, as serializeSet swaps the track list.
 */
function makeDeckTrack(m, td) {
  let t = null;
  const scene = state.activePattern;
  try {
    state.activePattern = m.scene;
    t = createTrack(trackShellFor(td));
    t._deck = "b";
    t.el?.classList.add("is-deck-b");
    // A solo carried in would silence the song that is playing.
    loadTrackFromData(t, { ...td, soloed: false });
    // Deck B plays its scene, not a timeline: the blocks wait for a landing.
    t._deckArrangement = t.arrangement?.length ? t.arrangement : null;
    t.arrangement = [];
    if (state.playing) seedTrackCount(t, state.tick - m.countOrigin);
  } catch (e) {
    console.error("mix: a deck B track failed to load", e);
    if (t && state.tracks.includes(t)) { try { removeTrack(t); } catch {} }
    t = null;
  } finally {
    state.activePattern = scene;
  }
  return t;
}

function buildNext(m) {
  if (state.mix !== m) { m.resolve?.(false); return; }      // ejected or replaced meanwhile
  const td = m.pending.shift();
  if (!td) { finishLoad(m); return; }
  const t = makeDeckTrack(m, td);
  if (t) paintTrackSlotBadge(t);
  m.made.push(t);
  placeBusesLast();
  orderDeck(m);
  announce();
  setTimeout(() => buildNext(m), 0);
}

/**
 * Deck B's tracks in the order its song lists them. Each is made unflagged
 * (createTrack files it with the song's own) and flagged afterwards, which
 * lands it in front of the ones made before it.
 */
function orderDeck(m) {
  const made = m.made.filter(t => t && state.tracks.includes(t));
  const at = made.map(t => state.tracks.indexOf(t)).sort((x, y) => x - y);
  if (made.every((t, i) => state.tracks[at[i]] === t)) return;
  const next = state.tracks.slice();
  made.forEach((t, i) => { next[at[i]] = t; });
  state.tracks = next;
}

function finishLoad(m) {
  const made = m.made;
  // The cross-track references, now that every track exists: indices into the
  // loaded session, resolved against the tracks made from it, in its order.
  m.refs.forEach((ref, i) => {
    const t = made[i];
    if (!t) return;
    const bus = Number.isInteger(ref.out) && ref.out >= 0 ? made[ref.out] : null;
    t.out = bus && bus !== t && bus.engineKey === "bus" ? String(bus.id) : "master";
    resolveSoundSources(t, made, true);
    const src = Number.isInteger(ref.comp) && ref.comp >= 0 ? made[ref.comp] : null;
    t.comp.source = src && src !== t ? String(src.id) : "self";
  });
  for (const t of deckBTracks()) if (t.out !== "master" && wouldFeedback(t, t.out)) t.out = "master";
  placeBusesLast();
  refreshOutputSelects();
  refreshCompSourceDropdowns();
  if (state.ready) {
    refreshAllTrackOutputs();
    for (const t of deckBTracks()) { applyBusMute(t); applyCompressorConfig(t); }
    refreshNoiseBeds();
  }
  requestMidiIfNeeded();
  applyXfade();
  renderPatternGrid();
  m.loading = false;
  m.pending = null;
  restoreLookAhead();
  const n = deckBTracks().filter(t => t.engineKey !== "bus").length;
  setStatus(`deck B: "${m.title}" loaded, ${n} track${n === 1 ? "" : "s"} at ${m.bpm} bpm. Start it, then bring the crossfader over`);
  announce();
  m.resolve?.(true);
}

// ---- deck B as a session: read whole, and written in place -----------------------
//
// The compose panel's turn on deck B (app/ComposeChat.tsx): the model is sent
// deck B's song in the session format and its answer is merged back onto deck
// B's tracks, as a turn on the open song is merged onto the song's.

/**
 * Deck B's song in the session format: its tracks (indices counted along
 * them), its own tempo, scale, repeats, meters and pads, and the pattern the
 * deck is on. Null with no deck loaded.
 */
export function serializeDeckB() {
  const m = state.mix;
  if (!m || m.loading) return null;
  const all = state.tracks, scene = state.activePattern;
  let s;
  // The song's serializer over deck B's tracks alone, on the deck's scene: the
  // same swap serializeSet makes to leave a staged track out.
  try {
    state.tracks = deckBTracks();
    state.activePattern = m.scene;
    s = serializeSet({ decks: true });
  } finally {
    state.tracks = all;
    state.activePattern = scene;
  }
  s.tracks.forEach((td, i) => {
    const blocks = deckBTracks()[i]?._deckArrangement;
    if (blocks?.length) td.arrangement = blocks.map(b => ({ slot: b.slot, start: b.start, bars: b.bars }));
  });
  return {
    ...s,
    bpm: m.bpm,
    swing: m.globals.swing ?? s.swing,
    scale: { ...m.scale },
    activePattern: m.scene,
    patternMode: m.chain ? "chain" : "repeat",
    patternRepeats: m.repeats.slice(),
    patternMeters: m.globals.patternMeters || s.patternMeters,
    macroPads: m.globals.macroPads || [],
  };
}

/**
 * Write a session onto deck B in place: `mergeSet` (liveSet.js) scoped to the
 * deck, so the tracks that did not change keep the voices they are playing
 * with, new ones join in phase, and the song on deck A is not touched. The
 * deck's tempo, scale, repeats and meters follow; the pattern it is on does
 * not, as a merge never moves the scene.
 * @returns {object|null} mergeSet's summary, or null with no deck loaded
 */
export function mergeDeckB(session) {
  const m = state.mix;
  if (!m || m.loading || m.landing) return null;
  const out = mergeSet(session, {
    serialize: serializeDeckB,
    tracks: deckBTracks,
    globals(cur, target) {
      if (Number(target.bpm) > 0) m.bpm = m.globals.bpm = Number(target.bpm);
      if (Number.isFinite(target.swing)) m.globals.swing = target.swing;
      if (target.scale) {
        m.scale = m.globals.scale = { active: !!target.scale.active, root: target.scale.root | 0, mode: target.scale.mode || "minor" };
      }
      if (Array.isArray(target.patternRepeats)) {
        for (let i = 0; i < PATTERN_COUNT; i++) m.repeats[i] = Math.max(1, Number(target.patternRepeats[i]) || 1);
      }
      if (Array.isArray(target.patternMeters)) m.globals.patternMeters = target.patternMeters;
      if (target.patternMode && target.patternMode !== cur.patternMode) m.chain = target.patternMode !== "repeat";
      m.globals.meter = meterOf(target, m.scene);
      applyTempo();
      return false;                    // the bar line's meter is deck A's
    },
    create(td) {
      const t = makeDeckTrack(m, td);
      if (!t) throw new Error(`deck B: "${td.name || "a track"}" would not load`);
      return t;
    },
    done(made, target) {
      // The blob's order is the deck's order now, and what its pads index.
      m.made = made.slice();
      m.globals.macroPads = Array.isArray(target.macroPads) ? target.macroPads : [];
      (target.tracks || []).forEach((td, i) => {
        const t = made[i];
        if (!t) return;
        // a deck plays its scene: any timeline waits for a landing
        if (t.arrangement?.length || td.arrangement?.length) t._deckArrangement = td.arrangement?.length ? td.arrangement : null;
        t.arrangement = [];
      });
      orderDeck(m);
    },
  });
  orderDeck(m);                        // after the merge's own last reorder
  applyXfade();
  announceClips();
  announce();
  return out;
}

// ---- deck B's transport ---------------------------------------------------------

/**
 * Start or stop deck B. A start waits for the bar line while the transport
 * runs, so the two songs' ones land together; a stop is at once. With the
 * transport stopped the deck is armed and starts with it.
 */
export function setDeckPlaying(on) {
  const m = state.mix;
  if (!m || m.loading) return;
  on = !!on;
  if (!on) {
    m.on = false;
    m.arm = null;
    m.queued = null;
    releaseSilencedTracks();
    refreshNoiseBeds();
    setStatus("deck B stopped");
  } else if (!state.playing) {
    m.on = true;
    m.arm = null;
    setStatus("deck B armed: it starts with the transport");
  } else if (!m.on) {
    m.arm = true;
    setStatus("deck B starts on the next bar");
  }
  announce();
}

/** Every deck B track onto `slot` (its bus too: the bus's lanes are the pattern's). */
function putDeckOn(slot, { restart = false } = {}) {
  const m = state.mix;
  if (!m) return;
  for (const t of state.tracks) {
    if (t._deck !== "b") continue;
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
  m.scene = slot;
  m.queued = null;
  m.barCount = 0;
  if (restart) m.countOrigin = state.tick;
}

/**
 * Deck B to pattern `slot`, by the switch mode the pattern bar honours: at the
 * bar line in "finish" mode while the deck plays, otherwise now.
 */
export function requestDeckScene(slot) {
  const m = state.mix;
  if (!m || !Number.isInteger(slot) || slot < 0 || slot >= PATTERN_COUNT) return;
  if (state.playing && m.on && state.patternSwitchMode === "finish") {
    m.queued = slot === m.scene && deckBTracks().every(t => trackSlot(t) === slot && !t._clipOff) ? null : slot;
    setStatus(m.queued == null ? `deck B: pattern ${slot + 1}` : `deck B: pattern ${slot + 1} queued`);
  } else {
    putDeckOn(slot);
    setStatus(`deck B: pattern ${slot + 1}`);
  }
  announceClips();
  announce();
}

/** How many bars deck B's chain plays pattern `slot` for (1..16). */
export function setDeckRepeat(slot, bars) {
  const m = state.mix;
  if (!m || !(slot >= 0 && slot < PATTERN_COUNT)) return;
  m.repeats[slot] = Math.max(1, Math.min(16, Math.round(Number(bars)) || 1));
  announce();
}

/** Whether deck B plays through its patterns (its chain) or holds its scene. */
export function setDeckChain(on) {
  const m = state.mix;
  if (!m) return;
  m.chain = !!on;
  m.barCount = 0;
  setStatus(m.chain ? "deck B plays through its patterns" : "deck B repeats its pattern");
  announce();
}

/**
 * Called by the transport once per step, after the bar line is worked out and
 * before the song's own queue and chain: the automatic fade a step at a time,
 * and on a bar line deck B's start, its queued scene and its chain.
 * @param {number} nextTime when the next step sounds
 * @param {boolean} barLine
 */
export function mixStep(nextTime, barLine) {
  const m = state.mix;
  if (!m) return;
  if (m.fade) {
    const f = m.fade;
    f.done++;
    writeXfade(fadeAt(f.from, f.to, f.done, f.steps), nextTime);
    if (f.done >= f.steps) { m.fade = null; announce(); }
  }
  if (!barLine || m.loading) return;
  if (m.arm === true) {
    m.arm = null;
    m.on = true;
    putDeckOn(m.queued ?? m.scene, { restart: true });
    refreshNoiseBeds();
    announce();
    return;
  }
  if (!m.on) return;
  if (m.queued != null) {
    putDeckOn(m.queued, { restart: true });
    announce();
    return;
  }
  if (!m.chain) return;
  m.barCount++;
  if (m.barCount < Math.max(1, m.repeats[m.scene] ?? 1)) return;
  m.barCount = 0;
  const next = nextFilled(filledSlots(deckBTracks()), m.scene);
  if (next >= 0 && next !== m.scene) {
    putDeckOn(next, { restart: true });
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

function applyXfade(at) {
  const m = state.mix;
  if (!m) return;
  const g = xfadeGains(m.x, m.curve);
  glide(busOut(m.busA), g.a, at);
  glide(busOut(m.busB), g.b, at);
}

function writeXfade(x, at) {
  const m = state.mix;
  if (!m) return;
  m.x = clamp01(x);
  applyXfade(at);
  if (m.tempoLink) { m.tempoX = m.x; applyTempo(); }
}

/** Move the crossfader by hand: 0 is all deck A, 1 all deck B. Cancels a fade under way. */
export function setXfade(x) {
  const m = state.mix;
  if (!m) return;
  m.fade = null;
  writeXfade(x);
}

export function setXfadeCurve(curve) {
  const m = state.mix;
  if (!m || !XFADE_CURVES.includes(curve)) return;
  m.curve = curve;
  applyXfade();
  announce();
}

/**
 * Fade to a deck over `bars` bars, a step at a time on the transport's clock
 * (the crossfader as a transition's sweep is: one press, the song does it).
 * Stopped, or with no bars, it jumps.
 * @param {"a"|"b"} deck @param {number} bars
 */
export function fadeToDeck(deck, bars) {
  const m = state.mix;
  if (!m) return;
  const to = deck === "b" ? 1 : 0;
  const steps = Math.max(0, Math.round(Number(bars) || 0)) * stepsPerBarForMeter(transportMeter());
  if (!state.playing || !steps) { m.fade = null; writeXfade(to); announce(); return; }
  m.fade = { from: m.x, to, steps, done: 0 };
  setStatus(`fading to deck ${deck.toUpperCase()} over ${bars} bar${bars === 1 ? "" : "s"}`);
  announce();
}

// ---- the tempo ------------------------------------------------------------------

/** The tempo the mix is playing at: between the song's and deck B's by `tempoX`. */
export function mixTempo() {
  const m = state.mix;
  return m ? mixBpm(fieldBpm(), m.bpm, m.tempoX) : fieldBpm();
}

function applyTempo() {
  if (!state.mix || !state.ready) return;
  try { Tone.getTransport().bpm.value = mixTempo(); } catch {}
}

/** 0 the song's tempo, 1 deck B's. Only the transport moves (see the top of the file). */
export function setMixTempo(x) {
  const m = state.mix;
  if (!m) return;
  m.tempoX = clamp01(x);
  applyTempo();
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

/** Tracks on their way out: withheld, hidden from every reader, removed once faded. */
function sendOff(tracks, afterMs = 70) {
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of tracks) {
    t._leaving = true;
    t._clipOff = true;
    if (t._deck === "b") t._deck = "x";          // no longer deck B's, never the song's
    else if (!t._deckBus) t._deck = "x";
    try { t.voice?.releaseHeld?.(now); } catch {}
  }
  setTimeout(() => {
    for (const t of tracks) if (state.tracks.includes(t)) { try { removeTrack(t); } catch (e) { console.error("mix: removing a track failed", e); } }
    announceClips();
    announce();
  }, afterMs);
}

/**
 * Take deck B off: its tracks and both deck buses go, and the song is routed
 * back to the master, at its own tempo, exactly as it was.
 */
export function ejectDeckB({ quiet = false } = {}) {
  const m = state.mix;
  if (!m) return false;
  m.pending = null;
  const gone = state.tracks.filter(t => t._deck === "b" || t._deckBus);
  glide(busOut(m.busB), 0);
  state.mix = null;
  sendOff(gone);
  if (state.ready) {
    refreshAllTrackOutputs();                    // the song's tracks, back to the master
    try { Tone.getTransport().bpm.value = fieldBpm(); } catch {}
  }
  refreshOutputSelects();
  refreshCompSourceDropdowns();
  refreshNoiseBeds();
  restoreLookAhead();
  m.resolve?.(false);
  if (!quiet) setStatus(`deck B ejected: "${m.title}" is gone, the song is as it was`);
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
 * Keep both decks as one song. The flags come off, the deck buses become the
 * song's buses with every master-bound track sent to its own, the crossfader's
 * balance is folded into the two bus faders, and the tempo the mix is at is
 * the song's. One undo step.
 *
 * Two songs can be in two scales and a session has one: when they differ each
 * deck's notes are written as they have been sounding (snapped to its own
 * scale) and the session's scale is switched off, so nothing changes pitch.
 */
export function keepBothDecks() {
  const m = state.mix;
  if (!m || m.loading || m.landing) return false;
  flushHistory();
  const bpm = Math.round(mixTempo() * 100) / 100;
  const a = deckATracks(), b = deckBTracks();

  if (!sameScale(state.scale, m.scale)) {
    for (const t of a) bakeScale(t, state.scale);
    for (const t of b) bakeScale(t, m.scale);
    state.scale.active = false;
    syncScaleUI();
    refreshChanceScale();
  }
  // Deck B's scene moves to the song's: a swap in each of its tracks' banks, so
  // nothing is lost and a reload (which puts every track on the scene) plays
  // what is playing now.
  const scene = state.activePattern;
  if (m.scene !== scene) {
    for (const t of [...b, m.busB]) {
      const here = trackSlot(t);
      flushPatternSound(t, here);
      const tmp = t.patterns[scene]; t.patterns[scene] = t.patterns[m.scene]; t.patterns[m.scene] = tmp;
      const now = here === m.scene ? scene : here === scene ? m.scene : here;
      aliasPattern(t, now);
      queueTrackPaint(t);
    }
    const r = state.patternRepeats;
    if ((r[scene] ?? 1) === 1 && m.repeats[m.scene] > 1) r[scene] = m.repeats[m.scene];
  }
  // The sends become the song's own.
  for (const t of a) if (!t.out || t.out === "master") t.out = String(m.busA.id);
  for (const t of b) if (!t.out || t.out === "master") t.out = String(m.busB.id);
  // The crossfader goes; its balance stays, in the two faders.
  const g = xfadeGains(m.x, m.curve);
  for (const [bus, gain] of [[m.busA, g.a], [m.busB, g.b]]) {
    const vol = trackControl(bus, ".p-vol");
    if (vol) {
      vol.value = String(bakeLevel(Number(vol.value), gain));
      vol.dispatchEvent(new Event("input", { bubbles: true }));
    }
    glide(busOut(bus), 1);
  }
  for (const t of [...b, m.busA, m.busB]) {
    t._deck = undefined;
    t._deckBus = undefined;
    t.el?.classList.remove("is-deck-b", "is-deck-bus");
    if (t._deckArrangement) t.arrangement = t._deckArrangement;
    t._deckArrangement = null;
  }
  state.mix = null;
  placeBusesLast();
  const field = /** @type {HTMLInputElement|null} */ (document.getElementById("bpm"));
  if (field && Number(field.value) !== bpm) {
    field.value = String(bpm);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  settle();
  markExternalEdit("keep both decks");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  setStatus(`both decks kept as one song at ${bpm} bpm: each deck is a bus now, with the crossfader's balance in its fader`);
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
 * Land: deck B becomes the song. Its tracks stay exactly as they are playing
 * (edits made on the deck included), its scale, bank settings and macro pads
 * come in, the tempo the mix is at becomes the song's, and the old song's
 * tracks go. One undo step, which brings the old song back.
 *
 * **It lands without a gap.** Re-pointing deck B's tracks from their bus to
 * the master the ordinary way ducks each one (FXRack.softSwitch), all at the
 * same instant: a hole in the song at the moment it arrives. So they are
 * connected to a landing gain as well, that gain rises as the two deck buses
 * fall (the same signal twice, so a linear crossfade holds the level), and
 * the landing gain is what "master" means for the song's tracks until the
 * transport next stops (`state._landGain`, read by signal.js), when everything
 * is re-pointed in silence.
 * @returns {Promise<boolean>}
 */
export function landDeckB() {
  const m = state.mix;
  if (!m || m.loading || m.landing) return Promise.resolve(false);
  flushHistory();
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
    // Deck B's tracks that go straight to their deck's bus: onto the landing
    // gain as well, which starts where they are not yet heard through it.
    const direct = deckBTracks().filter(t => (!t.out || t.out === "master") && t.fxRack);
    if (!was) {
      try { land.gain.cancelScheduledValues(now); land.gain.setValueAtTime(0, now); land.gain.linearRampToValueAtTime(1, now + LAND_MS / 1000); } catch {}
      for (const t of direct) { try { t.fxRack.output.connect(land); } catch {} }
    }
    for (const bus of [m.busA, m.busB]) {
      const g = busOut(bus);
      // with a landing gain already in place deck B has no second path to
      // rise on, so its bus stays up until it is removed
      if (!g || (was && bus === m.busB)) continue;
      try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + LAND_MS / 1000); } catch {}
    }
    m._landDirect = was ? [] : direct;
  }
  return new Promise((resolve) => {
    setTimeout(() => { resolve(finishLanding(m, land)); }, live ? LAND_MS + 15 : 0);
  });
}

function finishLanding(m, land) {
  if (state.mix !== m) return false;               // a song arrived meanwhile
  const bpm = Math.round(mixTempo() * 100) / 100;
  const b = deckBTracks();
  const old = state.tracks.filter(t => inSong(t) || t._deckBus);
  // The blob's order first (the macro pads index into it), then anything
  // added on the deck since (a duplicate).
  const order = [...m.made.filter(t => t && b.includes(t)), ...b.filter(t => !m.made.includes(t))];

  if (land && m._landDirect?.length) {
    state._landGain = land;
    // already where the routing will say they go: no re-point, no duck
    for (const t of m._landDirect) if (t.fxRack) { t.fxRack._routedTo = land; t.fxRack._routedMeter = t.meterAnalyser; }
  }
  for (const t of b) {
    t._deck = undefined;
    t.el?.classList.remove("is-deck-b");
    if (t._deckArrangement) t.arrangement = t._deckArrangement;
    t._deckArrangement = null;
  }
  state.mix = null;
  sendOff(old, 0);
  // the old song's tracks are still in the list until the timer above runs;
  // every write below is to the new song's
  for (const t of old) { try { t.voice?.silence?.(state.audioCtx?.currentTime ?? 0); } catch {} }

  // Deck B's globals, each guarded on having moved (liveSet.js).
  const cur = serializeSet();
  const g = m.globals;
  const target = {
    ...cur,
    bpm,
    swing: g.swing ?? cur.swing,
    scale: g.scale,
    patternMode: m.chain ? "chain" : "repeat",
    patternRepeats: m.repeats,
    patternMeters: g.patternMeters || cur.patternMeters,
  };
  const metersMoved = applyGlobalsInPlace(cur, target, { pads: false });
  state.activePattern = m.scene;
  state.queuedPattern = null;
  state.patLoop = null;
  state.chainBarCount = m.barCount;
  if (state.playing) {
    if (m.on) state._countOrigin = m.countOrigin;
    else {
      // never started: it comes in on the bar the transport is in
      state._countOrigin = state.tick - (state.barTick ?? 0);
      for (const t of order) seedTrackCount(t, state.barTick ?? 0);
    }
  }
  if (metersMoved) for (const t of order) { aliasPattern(t, trackSlot(t)); renderStepGrid(t); }
  applyMacroPads(g.macroPads, m.made.map(t => (t && order.includes(t) ? t : undefined)));
  placeBusesLast();
  const first = order.find(t => t.engineKey !== "bus");
  if (first) setActiveTrack(first);
  for (const t of order) if (t._soundUiStale) { t._soundUiStale = false; refreshPatternSoundUI(t); }
  setTimeout(settle, 0);                           // after the old tracks are gone
  markExternalEdit("land deck B");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  setStatus(`landed: "${m.title}" is the song now, at ${bpm} bpm`);
  // The shell's open-song slot named the old song: the next save must not file
  // this one as a version of it (app/MixSongs.tsx).
  try { window.dispatchEvent(new CustomEvent("seqbaby:mixlanded", { detail: { title: m.title, source: m.source } })); } catch {}
  return true;
}

// ---- keeping it honest ------------------------------------------------------------

export function installMix() {
  // A whole session arriving tears every track down, deck B's with them.
  const dropped = () => {
    const m = state.mix;
    if (!m) return;
    state.mix = null;
    m.pending = null;
    m.resolve?.(false);
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
    if (state.mix) {
      if (state.playing) { state.mix.barCount = 0; state.mix.countOrigin = 0; state.mix.fade = null; }
      else { state.mix.arm = null; state.mix.queued = null; }
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
  // it and deck B's, so it moves too. After main.js's own listener, which
  // wrote the field's value to the transport.
  document.getElementById("bpm")?.addEventListener("input", () => { if (state.mix) applyTempo(); });
}
