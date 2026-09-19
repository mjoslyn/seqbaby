import assert from "node:assert/strict";
import test from "node:test";

import { Reassembler, chunkMessage } from "../lib/jamWire.js";

// lib/jamWire.js cuts a jam message into parts the transport will carry and
// puts them back together on the other side. Pinned: a message survives the
// trip whole, two peers' parts interleaving do not mix, and a message whose
// parts stop coming is not held forever.

/** Something big enough to need several parts. */
const session = () => ({ tracks: Array.from({ length: 6 }, (_, i) => ({ name: `t${i}`, lane: Array(2000).fill(i) })) });

// ---- chunking -----------------------------------------------------------

test("a small message is one part and comes back as itself", () => {
  const msg = { type: "patch", from: "abc", patch: { v: 1 } };
  const parts = chunkMessage(msg);
  assert.equal(parts.length, 1);
  const r = new Reassembler();
  assert.deepEqual(r.push(parts[0]), msg);
});

test("a big message is cut up and reassembled, interleaved with another", () => {
  const big = { type: "state", session: session() };
  const other = { type: "hello", from: "x", note: "y".repeat(500) };
  const pb = chunkMessage(big, "big", 1000);
  const po = chunkMessage(other, "other", 200);
  assert.ok(pb.length > 20);
  assert.ok(po.length > 1);
  const r = new Reassembler();
  let gotBig, gotOther;
  const n = Math.max(pb.length, po.length);
  for (let i = 0; i < n; i++) {
    if (i < pb.length) { const m = r.push(pb[i]); if (m) gotBig = m; }
    if (i < po.length) { const m = r.push(po[i]); if (m) gotOther = m; }
  }
  assert.deepEqual(gotBig, big);
  assert.deepEqual(gotOther, other);
  assert.equal(r.pending.size, 0);
});

test("a message whose parts stop coming is forgotten", () => {
  const parts = chunkMessage({ a: "z".repeat(1000) }, "stale", 100);
  const r = new Reassembler({ ttlMs: 1000 });
  r.push(parts[0], 0);
  assert.equal(r.pending.size, 1);
  r.push(chunkMessage({ b: 1 }, "fresh")[0], 5000);   // any later traffic sweeps
  assert.equal(r.pending.size, 0);
});
