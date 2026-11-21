// What the studio heard, read as notes for the model that wrote the song.
//
// A compose turn runs where there is no audio (a Durable Object), so the model
// writes blind: a filter shut on a sub, a part twelve dB over the rest and a
// bus nothing reaches all look fine in the JSON. The browser that asked for
// the turn has the engine, though. Before a turn that changed the song
// finishes, the panel plays that song silently in a hidden studio
// (public/js/measure.js, app/enginePlayer.ts), reads every track's meter per
// section, and posts the numbers back. This file is the server's half: it
// takes that report as untrusted input (numbers only, clamped, indices
// checked against the song) and turns it into sentences.
//
// Plain JS, no DOM: the job object and `node --test` run it.

import { trackRole } from "../public/js/songBuilder.js";

const SILENT_DB = -55;
const HOT_DB = 3;
const MAX_SECTIONS = 8;
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
/** An index is in range or it is nothing: clamping one would name another track. */
const idx = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/**
 * The browser's report, cut down to what is believable about `song`, or null.
 * Shape in: { sections: [{ pattern, seconds, samples, master: { rmsDb, peakDb },
 * tracks: [{ index, rmsDb, peakDb }] }] }.
 */
export function sanitizeReport(raw, song) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sections)) return null;
  const count = song?.tracks?.length || 0;
  const sections = [];
  for (const s of raw.sections.slice(0, MAX_SECTIONS)) {
    const pattern = idx(s?.pattern, 0, 31);
    const seconds = num(s?.seconds, 0, 60);
    const samples = num(s?.samples, 0, 100000);
    const rmsDb = num(s?.master?.rmsDb, -120, 24), peakDb = num(s?.master?.peakDb, -120, 24);
    if (pattern == null || seconds == null || samples == null || rmsDb == null || peakDb == null) continue;
    // Too few reads to say anything: a tab in the background runs its timers
    // once a second.
    if (samples < 8 || seconds < 1) continue;
    const seen = new Set();
    const tracks = [];
    for (const t of Array.isArray(s.tracks) ? s.tracks.slice(0, 64) : []) {
      const index = idx(t?.index, 0, count - 1);
      const r = num(t?.rmsDb, -120, 24), p = num(t?.peakDb, -120, 24);
      if (index == null || r == null || p == null || seen.has(index)) continue;
      seen.add(index);
      tracks.push({ index, rmsDb: Math.round(r * 10) / 10, peakDb: Math.round(p * 10) / 10 });
    }
    sections.push({ pattern, seconds, samples, master: { rmsDb: Math.round(rmsDb * 10) / 10, peakDb: Math.round(peakDb * 10) / 10 }, tracks });
  }
  return sections.length ? { sections } : null;
}

/** Whether track `t` starts a note in pattern `p` inside the first `seconds`. */
function playsEarly(song, t, p, seconds) {
  if (t.euclid?.on || t.chance?.on) return true;
  const pat = t.patterns?.[p];
  if (!pat?.steps?.some(Boolean)) return false;
  const stepSec = 60 / (Number(song.bpm) || 120) / 4 / (t.speed > 0 ? t.speed : 1);
  const within = Math.floor((seconds * 0.6) / stepSec);
  return pat.steps.slice(0, Math.max(1, within)).some(Boolean);
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const list = (xs) => xs.join(", ");

/**
 * What to tell the model about a (sanitized) report.
 * @returns {{ notes: string[], table: string }} `notes` are the problems;
 *          `table` is every reading, for it to judge the balance itself
 */
export function hearingNotes(song, report) {
  const notes = [];
  const tracks = song.tracks || [];
  const soloed = tracks.some((t) => t.soloed);
  const silentIn = new Map(), loud = new Map(), buried = new Map();
  const hot = [], quiet = [];
  const lines = [];
  for (const sec of report?.sections || []) {
    const audible = [];
    const cells = [];
    for (const m of sec.tracks) {
      const t = tracks[m.index];
      if (!t || t.engineKey === "bus") continue;
      // A part with nothing written in this pattern is not in the reading.
      if (!t.euclid?.on && !t.chance?.on && !t.patterns?.[sec.pattern]?.steps?.some(Boolean)) continue;
      cells.push(`${m.index} ${t.name} ${m.rmsDb}/${m.peakDb}`);
      if (t.muted || soloed) continue;
      if (m.peakDb < SILENT_DB) {
        if (playsEarly(song, t, sec.pattern, sec.seconds)) (silentIn.get(m.index) || silentIn.set(m.index, []).get(m.index)).push(sec.pattern);
      } else audible.push(m);
    }
    lines.push(`pattern ${sec.pattern}: master ${sec.master.rmsDb}/${sec.master.peakDb} | ${cells.join(" | ")}`);
    const mid = median(audible.map((m) => m.rmsDb));
    if (mid != null && audible.length >= 3) {
      for (const m of audible) {
        const d = m.rmsDb - mid;
        // A kick or a sub is meant to lead; give them more room before saying so.
        const role = trackRole(tracks[m.index]);
        const over = role === "kick" || role === "sub" ? 16 : 12;
        if (d > over && d > (loud.get(m.index) ?? 0)) loud.set(m.index, d);
        if (d < -22 && d < (buried.get(m.index) ?? 0)) buried.set(m.index, d);
      }
    }
    // The reading is taken before the limiter (-2dB), and one kick at its
    // usual level already touches it: only a mix well into it is said.
    if (sec.master.peakDb > HOT_DB) hot.push(`${sec.pattern} (${sec.master.peakDb}dB)`);
    else if (audible.length >= 3 && sec.master.rmsDb < -32) quiet.push(`${sec.pattern} (${sec.master.rmsDb}dB)`);
  }
  const name = (i) => `track ${i} (${tracks[i].name})`;
  for (const [i, pats] of silentIn) notes.push(`${name(i)} has notes in pattern${pats.length > 1 ? "s" : ""} ${list(pats)} but made no sound there. Look at its filter cutoff, its volume, the octave its notes are in, and where it is sent`);
  for (const [i, d] of loud) notes.push(`${name(i)} is ${Math.round(d)}dB louder than the middle of the mix: bring its vol down`);
  for (const [i, d] of buried) notes.push(`${name(i)} is ${Math.round(-d)}dB under the middle of the mix, close to inaudible: bring its vol up, or open its filter`);
  if (hot.length) notes.push(`the master is into the limiter in pattern${hot.length > 1 ? "s" : ""} ${list(hot)}: pull the loudest tracks down a little rather than leaning on it`);
  if (quiet.length) notes.push(`the whole mix is quiet in pattern${quiet.length > 1 ? "s" : ""} ${list(quiet)}: raise the parts that carry it`);
  return { notes, table: lines.join("\n") };
}

/** The message a turn is sent back with after a listen, or null to let it stop. */
export function hearingNudge(song, report) {
  const { notes, table } = hearingNotes(song, report);
  if (!notes.length) return null;
  return `The studio played the song back and read the meters (rms/peak in dB per track, per pattern):\n${table}\n\nWhat that shows:\n- ${notes.join("\n- ")}\nFix these, then reply. The readings are of the song as it stood; you will not get another listen this turn.`;
}
