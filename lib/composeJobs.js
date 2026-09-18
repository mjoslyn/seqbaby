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

// What one account may spend on the deploy's single Anthropic key. A turn can
// run for fifteen minutes and there is nothing in the request path to make
// anyone wait, so without these an account could park unbounded concurrent
// agent runs on it.
const MAX_IN_FLIGHT = Number(process.env.COMPOSE_MAX_IN_FLIGHT || 3);
const MAX_PER_HOUR = Number(process.env.COMPOSE_MAX_PER_HOUR || 40);
// A job older than the worker's own ceiling is over whatever its record says:
// a worker that was killed never got to write one.
const STALE_MS = 16 * 60 * 1000;

const userKey = (userId) => `users/${userId}`;

/** What this account currently has running, and what it has started lately. */
async function userUsage(userId) {
  const now = Date.now();
  const rec = (await read(userKey(userId))) ?? { inFlight: [], started: [] };
  return {
    inFlight: (rec.inFlight ?? []).filter((j) => now - j.at < STALE_MS),
    started: (rec.started ?? []).filter((t) => now - t < 60 * 60 * 1000),
  };
}

/**
 * Stake out a job. Returns the id the browser polls and the token the worker
 * must present: the id alone reaches a real job, and the worker endpoint takes
 * nothing but an id, so without a secret anyone who guessed one could make us
 * run somebody's turn again.
 *
 * Refuses rather than queues when an account is over its limits -- a queue
 * would still be work promised against the same key, just later.
 */
export async function createJob({ userId, message, history, session, model }) {
  const usage = await userUsage(userId);
  if (usage.inFlight.length >= MAX_IN_FLIGHT) {
    return { error: `you already have ${usage.inFlight.length} of these running — let one finish first.` };
  }
  if (usage.started.length >= MAX_PER_HOUR) {
    return { error: "that's a lot of composing in one hour — give it a little while." };
  }

  const id = newId();
  const token = randomBytes(24).toString("base64url");
  const at = Date.now();
  // `model` is the one the panel picked for THIS message, already checked
  // against the allowlist by the route. Undefined means the caller didn't
  // choose, and the turn falls back to the deploy's own default.
  await put(id, { userId, token, message, history, session, model, createdAt: new Date().toISOString() });
  await put(`${id}/progress`, {
    userId,
    status: "running",
    events: [],
    createdAt: new Date().toISOString(),
  });
  await put(userKey(userId), {
    inFlight: [...usage.inFlight, { id, at }],
    started: [...usage.started, at],
  });
  return { id, token };
}

/** Stop counting a job against its owner's in-flight limit. */
async function releaseJob(userId, id) {
  if (!userId) return;
  const usage = await userUsage(userId);
  await put(userKey(userId), {
    inFlight: usage.inFlight.filter((j) => j.id !== id),
    started: usage.started,
  });
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
  const p = await getJobProgress(id);
  // Falling back to a bare {} wrote a finished record with no owner on it, and
  // the status route answers 404 to a job that isn't the asker's -- so the
  // song was finished, stored, and unreachable. The input record knows whose
  // it is; with neither there is nobody to report to, and writing an ownerless
  // record would only be readable by nobody.
  const owner = p?.userId ?? (await getJobInput(id))?.userId;
  if (!owner) return;
  await put(`${id}/progress`, {
    ...(p ?? { events: [] }),
    userId: owner,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  if (patch?.status === "done" || patch?.status === "error") await releaseJob(owner, id);
}
