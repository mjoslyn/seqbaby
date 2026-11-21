// Play a session with the speakers off and read the meters.
//
// For the compose panel's listen (app/ComposeChat.tsx, mcp/hearing.mjs): the
// model that wrote a song cannot hear it, so before a turn finishes, the
// panel loads the song into a HIDDEN studio (the same `/studio?embed` frame
// the homepage's play buttons use, app/enginePlayer.ts) and calls this there.
// It is mcp/audition.mjs's read of the analysers, with two differences: the
// master is disconnected from the output for as long as it runs, so nothing
// is heard, and each section of a chained song is played on its own, so a
// part that only comes in at the drop is listened to as well.
//
// It replaces the session in the engine it runs in and stops its transport,
// which is why it is only ever called in that throwaway frame, never in the
// studio a person is working in.

import { state, switchPattern } from "./state.js";
import { applySet } from "./session.js";
import { ensureAudio, startPlayback, stopPlayback } from "./transport.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);
const hasSteps = (t, p) => t?.engineKey !== "bus" && !!t?.patterns?.[p]?.steps?.some(Boolean);

/** The slots worth a listen, in the order the song plays them. */
function slotsToHear(session, max) {
  const tracks = Array.isArray(session?.tracks) ? session.tracks : [];
  const live = tracks.some((t) => t?.euclid?.on || t?.chance?.on);
  const used = [];
  for (let p = 0; p < 32; p++) if (tracks.some((t) => hasSteps(t, p))) used.push(p);
  const active = Number.isInteger(session?.activePattern) ? session.activePattern : 0;
  if (session?.patternMode !== "chain" && session?.patternMode !== "arrange") return used.includes(active) || live ? [active] : used.slice(0, 1);
  return (used.length ? used : live ? [active] : []).slice(0, max);
}

/**
 * Which live track each of the session's tracks became. applySet makes them
 * in order and then moves the buses to the end (placeBusesLast), so that is
 * the order to expect; anything else is matched by engine and name.
 */
function liveTracks(session) {
  const src = session.tracks || [];
  const order = [...src.keys()].sort((a, b) => (src[a]?.engineKey === "bus") - (src[b]?.engineKey === "bus") || a - b);
  const out = new Array(src.length).fill(null);
  if (order.length === state.tracks.length) order.forEach((si, li) => { out[si] = state.tracks[li]; });
  if (out.every((t, i) => t && (src[i].engineKey === "bus") === (t.engineKey === "bus"))) return out;
  const used = new Set();
  return src.map((s) => {
    const t = state.tracks.find((x) => !used.has(x) && x.name === s?.name && (x.engineKey === "bus") === (s?.engineKey === "bus"));
    if (t) used.add(t);
    return t || null;
  });
}

/**
 * @param {object} session a serialized song
 * @param {{ maxSections?: number, maxSeconds?: number, budgetMs?: number, onLoaded?: () => void }} [opts]
 *        `onLoaded` is called once the session is built and before any of it
 *        plays: the heavy main-thread work is over by then.
 * @returns {Promise<{ sections: object[] } | { error: string }>}
 */
export async function measureSet(session, { maxSections = 6, maxSeconds = 5, budgetMs = 30000, onLoaded } = {}) {
  if (!session || typeof session !== "object") return { error: "no session" };
  const slots = slotsToHear(session, maxSections);
  if (!slots.length) return { error: "nothing to play" };
  let out = null;
  try {
    await stopPlayback();
    // Each section is heard looping on its own.
    applySet({ ...session, patternMode: "repeat" });
    // The graph is built on first play. Raced: on a browser that wants a
    // gesture this frame never had, the resume inside it does not settle.
    const ok = await Promise.race([ensureAudio().then(() => true, () => false), sleep(5000).then(() => false)]);
    onLoaded?.();
    out = state.masterLimiter || state.masterGain;
    if (!ok || !out || state.audioCtx?.state !== "running") return { error: "audio is locked" };
    try { out.disconnect(state.audioCtx.destination); } catch {}

    const tracks = liveTracks(session);
    const bufs = new Map();
    const read = (an, a) => {
      if (!an) return;
      // One buffer per analyser, at its own fftSize (see mcp/audition.mjs).
      let buf = bufs.get(an);
      if (!buf) bufs.set(an, (buf = new Float32Array(an.fftSize)));
      an.getFloatTimeDomainData(buf);
      let sq = 0, pk = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; sq += v * v; const av = v < 0 ? -v : v; if (av > pk) pk = av; }
      a.sq += sq / buf.length; a.n++; if (pk > a.peak) a.peak = pk;
    };
    const stepSec = 60 / (Number(session.bpm) || 120) / 4;
    const started = performance.now();
    const sections = [];
    for (const slot of slots) {
      if (performance.now() - started > budgetMs) break;
      switchPattern(slot);
      await startPlayback();
      const t0 = performance.now();
      while (!state.playing && performance.now() - t0 < 2500) await sleep(40);
      if (!state.playing || state.audioCtx?.state !== "running") { await stopPlayback(); return sections.length ? { sections } : { error: "it would not play" }; }
      // Past the transport's start lead (half a second on a cold output).
      await sleep(sections.length ? 200 : 650);
      const longest = Math.max(16, ...(session.tracks || []).filter((t) => hasSteps(t, slot)).map((t) => t.patterns[slot].steps.length / (t.speed > 0 ? t.speed : 1)));
      const seconds = Math.min(maxSeconds, Math.max(2, longest * stepSec));
      const acc = tracks.map(() => ({ sq: 0, n: 0, peak: 0 }));
      const master = { sq: 0, n: 0, peak: 0 };
      const until = performance.now() + seconds * 1000;
      while (performance.now() < until) {
        tracks.forEach((t, i) => read(t?.meterAnalyser, acc[i]));
        read(state.masterAnalyser, master);
        await sleep(40);
      }
      await stopPlayback();
      sections.push({
        pattern: slot, seconds, samples: master.n,
        master: { rmsDb: db(Math.sqrt(master.sq / Math.max(1, master.n))), peakDb: db(master.peak) },
        tracks: tracks.map((t, i) => (t && acc[i].n ? { index: i, rmsDb: db(Math.sqrt(acc[i].sq / acc[i].n)), peakDb: db(acc[i].peak) } : null)).filter(Boolean),
      });
      await sleep(120);
    }
    return sections.length ? { sections } : { error: "nothing was read" };
  } catch (e) {
    return { error: String(e?.message || e) };
  } finally {
    try { await stopPlayback(); } catch {}
    if (out && state.audioCtx) { try { out.connect(state.audioCtx.destination); } catch {} }
  }
}
