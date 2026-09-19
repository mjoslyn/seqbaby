// ---- jam wire: a message, in parts the transport will carry -------------
//
// The room's transport (Supabase Realtime broadcast, in app/JamPanel.tsx)
// caps a payload, and a whole session with a sample in it is well over the
// cap. So a message is cut into parts here and put back together on the
// other side, keyed on a message id. One part for almost everything -- a knob
// turn is a few hundred characters -- and several for the session a newcomer
// takes on arrival.
//
// Beside the compose helpers in lib/ rather than beside jamSync.js in the
// engine, because the shell imports it and the engine never does: public/js
// is kept out of the Next graph (tsconfig excludes it), and what is cut up
// here is the shell's envelope, not the engine's patch. No imports, so
// test/jamWire.test.js runs it under `node --test`.

/** How much of a message goes in one part. The transport caps a payload well
 *  above this; the margin covers JSON escaping and the envelope. */
export const JAM_CHUNK_CHARS = 60_000;

let chunkSeq = 0;

/**
 * Cut a message into parts.
 * @param {any} msg
 * @param {string} [id] the message id; minted when absent
 * @param {number} [max]
 * @returns {{id: string, part: number, parts: number, data: string}[]}
 */
export function chunkMessage(msg, id = `${Date.now().toString(36)}-${(chunkSeq++).toString(36)}`, max = JAM_CHUNK_CHARS) {
  const text = JSON.stringify(msg);
  const parts = Math.max(1, Math.ceil(text.length / max));
  const out = [];
  for (let i = 0; i < parts; i++) {
    out.push({ id, part: i, parts, data: text.slice(i * max, (i + 1) * max) });
  }
  return out;
}

/**
 * Puts parts back together. Parts of one message arrive in order on one
 * connection, but two messages from two peers interleave, so they are kept
 * by id; a message whose parts stop coming is dropped after a while rather
 * than held forever.
 */
export class Reassembler {
  constructor({ ttlMs = 30_000 } = {}) {
    this.ttlMs = ttlMs;
    /** @type {Map<string, {parts: (string|null)[], got: number, total: number, at: number}>} */
    this.pending = new Map();
  }

  /**
   * @param {{id: string, part: number, parts: number, data: string}} chunk
   * @param {number} [now]
   * @returns {any|undefined} the message, once every part is in
   */
  push(chunk, now = Date.now()) {
    if (!chunk || typeof chunk.data !== "string") return undefined;
    // Any traffic at all is the moment to forget a message that stalled.
    this.sweep(now);
    const total = Number(chunk.parts) || 1;
    if (total === 1) return parse(chunk.data);
    let rec = this.pending.get(chunk.id);
    if (!rec || rec.total !== total) {
      rec = { parts: new Array(total).fill(null), got: 0, total, at: now };
      this.pending.set(chunk.id, rec);
    }
    const i = Number(chunk.part);
    if (i >= 0 && i < total && rec.parts[i] === null) { rec.parts[i] = chunk.data; rec.got++; }
    rec.at = now;
    if (rec.got < total) return undefined;
    this.pending.delete(chunk.id);
    return parse(rec.parts.join(""));
  }

  sweep(now = Date.now()) {
    for (const [id, rec] of this.pending) if (now - rec.at > this.ttlMs) this.pending.delete(id);
  }
}

function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
