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
//
// A BROUGHT KEY IS NOT IN EITHER OF THEM. A visitor composing on their own
// Anthropic key hands it to the route, which hands it to the worker in the
// same fire-and-forget POST that starts one; it never reaches this file. What
// does is a hash of it (`keyHash`), which is what the limits below are
// counted against when there is no account to count them against.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
 * A stable name for a key that is not the key.
 *
 * A brought key is the only thing a signed-out visitor can be identified by,
 * and the limits below have to be counted against something. Hashed because
 * nothing on the server has any business holding the key itself, and salted
 * with nothing on purpose: two requests on the same key must land in the same
 * bucket across worker invocations and across deploys.
 */
export const hashApiKey = (apiKey) =>
  createHash("sha256").update(String(apiKey)).digest("base64url").slice(0, 32);

/**
 * The same, for an invite code.
 *
 * A code's BUDGET is Postgres's (migration 0012) -- what it is worth in turns
 * and whether it is still worth anything. What is counted here is the other
 * limit entirely: how hard one code may drive this site's worker, which is
 * the same thing counted against an account and against a brought key, and
 * has to be counted against something. Hashed for `hashApiKey`'s reason --
 * nothing in a blob that outlives the turn has any business being a usable
 * credential.
 */
export const hashInviteCode = (code) =>
  createHash("sha256").update(`invite:${String(code)}`).digest("base64url").slice(0, 32);

// What one account -- or one brought key -- may have running at once. A turn
// can run for fifteen minutes and there is nothing in the request path to make
// anyone wait, so without these an account could park unbounded concurrent
// agent runs on the deploy's key, and a signed-out visitor unbounded worker
// invocations on the deploy's compute.
//
// The brought-key case is deliberately counted the same way even though the
// SPEND is the visitor's: what is being rationed there is this site's worker,
// not Anthropic's bill. Rotating keys would buy a fresh bucket, and cost the
// holder a fresh key's worth of tokens to use it.
const MAX_IN_FLIGHT = Number(process.env.COMPOSE_MAX_IN_FLIGHT || 3);
const MAX_PER_HOUR = Number(process.env.COMPOSE_MAX_PER_HOUR || 40);
// A job older than the worker's own ceiling is over whatever its record says:
// a worker that was killed never got to write one.
const STALE_MS = 16 * 60 * 1000;

/** Which usage bucket a job counts against: the invite code that let it in,
 *  the key it will be run on, or -- failing both -- the account that started
 *  it. The order is the order the route decides in: a turn paid for by a
 *  brought key or let in by a code counts against that, even when there is an
 *  account signed in, because the site's allowance is not what it is
 *  spending. */
const bucketFor = ({ userId, keyHash, inviteHash }) =>
  inviteHash ? `invites/${inviteHash}` : keyHash ? `keys/${keyHash}` : userId ? `users/${userId}` : null;

/** What this bucket currently has running, and what it has started lately. */
async function bucketUsage(bucket) {
  const now = Date.now();
  const rec = (await read(bucket)) ?? { inFlight: [], started: [] };
  return {
    inFlight: (rec.inFlight ?? []).filter((j) => now - j.at < STALE_MS),
    started: (rec.started ?? []).filter((t) => now - t < 60 * 60 * 1000),
  };
}

/** Compare two secrets without leaking where they first differ. */
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Stake out a job. Returns the id the browser polls, the `viewToken` it polls
 * WITH, and the token the worker must present.
 *
 * Two secrets because there are two readers and they are not the same reader.
 * The worker token says an invocation came from the route that created the
 * job -- the worker endpoint takes nothing but an id, so without it anyone who
 * guessed one could make us run somebody's turn again. The view token is how a
 * signed-out visitor proves a job is theirs to read: there is no account to
 * check it against, and a job holds somebody's song.
 *
 * Refuses rather than queues when a bucket is over its limits -- a queue would
 * still be work promised against the same key, just later.
 */
export async function createJob({ userId, keyHash, inviteHash, message, history, session, model }) {
  const bucket = bucketFor({ userId, keyHash, inviteHash });
  if (!bucket) return { error: "couldn't tell whose turn that is" };

  const usage = await bucketUsage(bucket);
  if (usage.inFlight.length >= MAX_IN_FLIGHT) {
    return { error: `you already have ${usage.inFlight.length} of these running — let one finish first.` };
  }
  if (usage.started.length >= MAX_PER_HOUR) {
    return { error: "that's a lot of composing in one hour — give it a little while." };
  }

  const id = newId();
  const token = randomBytes(24).toString("base64url");
  const viewToken = randomBytes(24).toString("base64url");
  const at = Date.now();
  // `model` is the one the panel picked for THIS message, already checked
  // against the allowlist by the route. Undefined means the caller didn't
  // choose, and the turn falls back to the deploy's own default.
  //
  // Note what is NOT written: the key a brought-key turn runs on. The route
  // passes that to the worker directly.
  await put(id, {
    userId: userId ?? null,
    keyHash: keyHash ?? null,
    inviteHash: inviteHash ?? null,
    token,
    // Carried here as well so a finished job is still readable if its
    // progress record has gone: without it, restoring one would write a
    // record its signed-out owner has no way to prove is theirs.
    viewToken,
    message,
    history,
    session,
    model,
    createdAt: new Date().toISOString(),
  });
  await put(`${id}/progress`, {
    userId: userId ?? null,
    keyHash: keyHash ?? null,
    inviteHash: inviteHash ?? null,
    viewToken,
    status: "running",
    events: [],
    createdAt: new Date().toISOString(),
  });
  await put(bucket, {
    inFlight: [...usage.inFlight, { id, at }],
    started: [...usage.started, at],
  });
  return { id, token, viewToken };
}

/** Stop counting a job against its bucket's in-flight limit. */
async function releaseJob(owner, id) {
  const bucket = bucketFor(owner);
  if (!bucket) return;
  const usage = await bucketUsage(bucket);
  await put(bucket, {
    inFlight: usage.inFlight.filter((j) => j.id !== id),
    started: usage.started,
  });
}

/**
 * Whether this asker may read this job's progress.
 *
 * Either they hold the token the job was created with -- which is what a
 * signed-out visitor has instead of an account -- or the job belongs to the
 * account asking. A job created before view tokens existed has only the
 * second, which is why the account path is still here on its own terms.
 */
export function canReadJob(progress, { userId, token } = {}) {
  if (!progress) return false;
  if (progress.viewToken && sameToken(progress.viewToken, token ?? "")) return true;
  if (progress.userId && userId && progress.userId === userId) return true;
  return false;
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
  // Falling back to a bare {} wrote a finished record with nothing on it to
  // read it by, and the status route answers 404 to a job the asker can't
  // prove is theirs -- so the song was finished, stored, and unreachable. The
  // input record carries the same identity; with neither there is nobody to
  // report to, and writing an unreadable record would only be readable by
  // nobody.
  const input = p ? null : await getJobInput(id);
  if (!p && !input) return;
  const owner = {
    userId: p?.userId ?? input?.userId ?? null,
    keyHash: p?.keyHash ?? input?.keyHash ?? null,
    inviteHash: p?.inviteHash ?? input?.inviteHash ?? null,
  };
  const viewToken = p?.viewToken ?? input?.viewToken ?? null;
  await put(`${id}/progress`, {
    ...(p ?? { events: [] }),
    ...owner,
    viewToken,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  if (patch?.status === "done" || patch?.status === "error") await releaseJob(owner, id);
}
