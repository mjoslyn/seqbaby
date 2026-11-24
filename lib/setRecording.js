// The server's reading of a recorded set (public/js/setFormat.js is the
// engine's). public/js is kept out of the Next graph, so the few things the
// server needs are spelled here again, and test/setFormat.test.js holds the
// two to the same answers.

export const SET_FORMAT = 1;
export const SET_MAX_EVENTS = 400_000;
export const SET_MAX_STEPS = 260_000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isSession = (s) => isObj(s) && (s.tracks == null || Array.isArray(s.tracks));

/** @returns {{ok: boolean, errors: string[]}} */
export function checkRecording(rec) {
  const errors = [];
  if (!isObj(rec)) return { ok: false, errors: ["not a recording"] };
  if (!Number.isInteger(rec._set) || rec._set < 1) errors.push("not a recorded set");
  else if (rec._set > SET_FORMAT) errors.push(`recorded by a newer seqbaby (set format ${rec._set})`);
  const st = rec.start;
  if (!isObj(st) || !isSession(st.session)) errors.push("no starting point");
  else if (st.decks != null && (!Array.isArray(st.decks) || !st.decks.every((d) => isObj(d) && typeof d.id === "string" && isSession(d.session)))) errors.push("decks is not a list of decks");
  if (!Array.isArray(rec.events)) errors.push("events is not a list");
  else {
    if (rec.events.length > SET_MAX_EVENTS) errors.push(`too many events (${rec.events.length})`);
    let last = -1;
    for (let i = 0; i < rec.events.length && errors.length < 8; i++) {
      const e = rec.events[i];
      if (!Array.isArray(e) || e.length < 4) { errors.push(`event ${i} is not an event`); continue; }
      if (!Number.isInteger(e[0]) || e[0] < 0) errors.push(`event ${i}: step ${JSON.stringify(e[0])}`);
      else if (e[0] < last) errors.push(`event ${i} is out of order`);
      else last = e[0];
      if (!(typeof e[1] === "number" && e[1] >= 0 && e[1] <= 1)) errors.push(`event ${i}: frac ${JSON.stringify(e[1])}`);
      if (typeof e[2] !== "string") errors.push(`event ${i}: kind`);
    }
  }
  if (!Number.isInteger(rec.steps) || rec.steps < 0 || rec.steps > SET_MAX_STEPS) errors.push(`steps ${JSON.stringify(rec.steps)}`);
  return { ok: errors.length === 0, errors };
}

/** @returns {{seconds: number, steps: number, events: number, decks: number, bpm: number|null}} */
export function recordingSummary(rec) {
  const decks = new Set((rec?.start?.decks || []).map((d) => d.id));
  for (const e of rec?.events || []) if (e[2] === "deck" && e[3]?.id) decks.add(e[3].id);
  const bpm = Number(rec?.bpm ?? rec?.start?.session?.bpm);
  return {
    seconds: Math.max(0, Number(rec?.seconds) || 0),
    steps: Math.max(0, rec?.steps | 0),
    events: Array.isArray(rec?.events) ? rec.events.length : 0,
    decks: decks.size,
    bpm: Number.isFinite(bpm) ? bpm : null,
  };
}

/** mm:ss (or h:mm:ss). */
export function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
