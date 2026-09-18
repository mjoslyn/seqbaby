// Where a compose job lives while it runs.
//
// Writing a whole song takes minutes; a synchronous function gets 26 seconds
// (measured: a turn died at 28s). So the work happens in a background worker
// that nothing is waiting on, and its progress goes here for the browser to
// poll. Same storage the share links use -- Netlify Blobs, with an in-memory
// fallback outside a Netlify context -- for the same reason lib/api.js has
// one: `next dev` has no Blobs, and there the job runs in-process anyway, so
// a Map in the same process is exactly as good.
//
// Two records per job, deliberately:
//   compose-jobs/<id>           the input -- written once, read once by the worker
//   compose-jobs/<id>/progress  status, activity, result -- written often, POLLED often
// A session carries base64 sample payloads and can run to megabytes, and the
// browser polls every couple of seconds; one combined record would mean
// dragging the input back out on every one of those polls.

import { randomBytes } from "node:crypto";

const _mem = new Map();
const JOBS_NS = "seqbaby-compose-jobs";

async function store() {
  try {
    const mod = await import("@netlify/blobs");
    return mod.getStore({ name: JOBS_NS, consistency: "strong" });
  } catch {
    return null;
  }
}

async function put(key, value) {
  const s = await store();
  if (s) {
    try {
      await s.setJSON(key, value);
      return;
    } catch (e) {
      console.warn("compose job setJSON failed, falling back to memory:", e?.message ?? e);
    }
  }
  _mem.set(key, value);
}

async function read(key) {
  const s = await store();
  if (s) {
    try {
      const v = await s.get(key, { type: "json" });
      if (v) return v;
    } catch (e) {
      console.warn("compose job get failed:", e?.message ?? e);
    }
  }
  return _mem.get(key) ?? null;
}

const newId = () => randomBytes(12).toString("base64url");

/**
 * Stake out a job. Returns the id the browser polls and the token the worker
 * must present: the id alone reaches a real job, and the worker endpoint takes
 * nothing but an id, so without a secret anyone who guessed one could make us
 * run somebody's turn again.
 */
export async function createJob({ userId, message, history, session }) {
  const id = newId();
  const token = randomBytes(24).toString("base64url");
  await put(id, { userId, token, message, history, session, createdAt: new Date().toISOString() });
  await put(`${id}/progress`, {
    userId,
    status: "running",
    events: [],
    createdAt: new Date().toISOString(),
  });
  return { id, token };
}

/** The input, for the worker. */
export const getJobInput = (id) => read(id);

/** What the browser polls: status, what has happened, and the song once there
 *  is one. */
export const getJobProgress = (id) => read(`${id}/progress`);

export async function appendJobEvent(id, event) {
  const p = await getJobProgress(id);
  if (!p) return;
  p.events = [...(p.events ?? []), event].slice(-200); // a long song is a lot of tool calls
  p.updatedAt = new Date().toISOString();
  await put(`${id}/progress`, p);
}

export async function finishJob(id, patch) {
  const p = (await getJobProgress(id)) ?? {};
  await put(`${id}/progress`, { ...p, ...patch, updatedAt: new Date().toISOString() });
}
