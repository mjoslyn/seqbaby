// The rules of a compose job, without its storage.
//
// Writing a whole song takes minutes, far longer than a request may run, so a
// turn is a JOB: the route starts it and the browser polls for its progress.
// Where a job lives is a Durable Object per job (workers/composeJob.ts), and
// what a person may have running is a Durable Object per usage bucket
// (ComposeLimits, same file). Both are single-threaded, which is what makes
// "check the limit, then take a slot" one step without etags or retries. This
// file is the arithmetic both of them and the routes share, plain JS with
// node:crypto only, so `node --test` runs it.
//
// A BROUGHT KEY IS NOT STORED. A visitor composing on their own Anthropic key
// hands it to the route, which hands it to the job object in the call that
// starts it; the object keeps it in memory for the life of the turn and never
// writes it to storage. What is kept is a hash of it (`keyHash`), which is
// what the limits are counted against when there is no account.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const newJobId = () => randomBytes(12).toString("base64url");
export const newSecret = () => randomBytes(24).toString("base64url");

/**
 * A stable name for a key that is not the key. Unsalted on purpose: two
 * requests on the same key must land in the same bucket across deploys.
 */
export const hashApiKey = (apiKey) =>
  createHash("sha256").update(String(apiKey)).digest("base64url").slice(0, 32);

// What one account, or one brought key, may have running at once, and start
// in an hour. A turn can run for fifteen minutes and nothing in the request
// path makes anyone wait, so without these an account could park unbounded
// concurrent agent runs on the deploy's key, and a signed-out visitor
// unbounded runs on the deploy's compute. The brought-key case is counted the
// same way even though the SPEND is the visitor's: what is rationed there is
// this site's Worker, not Anthropic's bill.
export const MAX_IN_FLIGHT = Number(process.env.COMPOSE_MAX_IN_FLIGHT || 3);
export const MAX_PER_HOUR = Number(process.env.COMPOSE_MAX_PER_HOUR || 40);
// A job older than the alarm's own ceiling is over whatever its record says:
// an object that was evicted mid-turn never got to release its slot.
export const STALE_MS = 16 * 60 * 1000;

/** Which usage bucket a job counts against: the account that started it, or
 *  -- with no account -- the key (or address) it will be run on. */
export const bucketFor = ({ userId, keyHash }) =>
  userId ? `users/${userId}` : keyHash ? `keys/${keyHash}` : null;

/** What a bucket's record says is running, and what it has started lately. */
export function usageOf(rec, now = Date.now()) {
  return {
    inFlight: (rec?.inFlight ?? []).filter((j) => now - j.at < STALE_MS),
    started: (rec?.started ?? []).filter((t) => now - t < 60 * 60 * 1000),
  };
}

/** Take a slot for job `id`, or say why not. Returns the next record. */
export function takeSlot(rec, id, now = Date.now()) {
  const usage = usageOf(rec, now);
  if (usage.inFlight.length >= MAX_IN_FLIGHT) {
    return { error: `you already have ${usage.inFlight.length} of these running — let one finish first.` };
  }
  if (usage.started.length >= MAX_PER_HOUR) {
    return { error: "that's a lot of composing in one hour — give it a little while." };
  }
  return { inFlight: [...usage.inFlight, { id, at: now }], started: [...usage.started, now] };
}

export function releaseSlot(rec, id, now = Date.now()) {
  const usage = usageOf(rec, now);
  return { inFlight: usage.inFlight.filter((j) => j.id !== id), started: usage.started };
}

/** Compare two secrets without leaking where they first differ. */
export function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Whether this asker may read this job's progress: they hold the view token
 * the job was created with (all a signed-out visitor has), or the job belongs
 * to the account asking.
 */
export function canReadJob(progress, { userId, token } = {}) {
  if (!progress) return false;
  if (progress.viewToken && sameToken(progress.viewToken, token ?? "")) return true;
  if (progress.userId && userId && progress.userId === userId) return true;
  return false;
}

// Whether the SITE's key has run out of budget. Set by a job whose turn on the
// deploy's key failed for want of credit, read by the studio (to switch the
// compose button off) and by the route (to refuse before starting a job that
// can only fail the same way). It expires rather than waiting to be cleared,
// because topping up happens on Anthropic's console where nothing here can
// see it: after BUDGET_RETRY_MS the next turn is let through, and either
// succeeds (clearing it) or sets it again. Kept in D1's site_flags.
const BUDGET_KEY = "compose_out_of_budget_at";
const BUDGET_RETRY_MS = Number(process.env.COMPOSE_BUDGET_RETRY_MS || 30 * 60 * 1000);

/** @param {D1Database} db */
export async function markSiteOutOfBudget(db) {
  await db
    .prepare("insert into site_flags (key, value) values (?1, ?2) on conflict (key) do update set value = ?2")
    .bind(BUDGET_KEY, Date.now())
    .run();
}

/** @param {D1Database} db */
export async function clearSiteOutOfBudget(db) {
  await db.prepare("update site_flags set value = 0 where key = ?1 and value <> 0").bind(BUDGET_KEY).run();
}

/** Never throws: it is read on the studio's render path.
 *  @param {D1Database | null | undefined} db */
export async function siteOutOfBudget(db) {
  try {
    if (!db) return false;
    const row = await db.prepare("select value from site_flags where key = ?1").bind(BUDGET_KEY).first();
    const at = Number(row?.value) || 0;
    return !!at && Date.now() - at < BUDGET_RETRY_MS;
  } catch {
    return false;
  }
}
