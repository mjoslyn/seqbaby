// Free compose: a few turns on Haiku with no account.
//
// A signed-out visitor may compose FREE_TURNS times in a rolling window, on
// the cheap model only. Three limits stand behind it, because an anonymous
// identity is only a cookie and a cookie is easy to throw away:
//
//   visitor   a signed cookie with a random id (FREE_COOKIE): FREE_TURNS per
//             FREE_WINDOW_DAYS. Minted by the compose route on the first turn,
//             after the Turnstile check when the deploy has one.
//   address   the visitor's IP, hashed with the secret so it is never stored:
//             FREE_IP_PER_DAY, so a private window or a cleared cookie does
//             not start the count over.
//   site      every free turn on the deploy: FREE_SITE_PER_DAY. What bounds
//             the worst case, whatever someone does to get round the two above.
//
// Each limit is a record in a ComposeLimits Durable Object (workers/composeJob.ts),
// single-threaded, so a check and a take are one step. This file is the
// arithmetic and the cookie, plain JS with Web Crypto only, for lib/unlock.js's
// reasons: the route, the studio page and `node --test` all read it.

export const FREE_COOKIE = "sq_free";
/** The cookie outlives the window, so the count it carries is the one kept. */
export const FREE_MAX_AGE = 60 * 60 * 24 * 365;
/** The only model a free turn runs on. */
export const FREE_MODEL = "claude-haiku-5-5";

const DAY = 24 * 60 * 60 * 1000;

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
};

/**
 * The deploy's free-compose settings, from its env. Off when the turn count is
 * 0 or there is no secret to sign the cookie with (COMPOSE_FREE_SECRET, else
 * BETTER_AUTH_SECRET, which production has anyway).
 * @param {Record<string, string | undefined>} env
 */
export function freeConfig(env = {}) {
  const secret = String(env.COMPOSE_FREE_SECRET || env.BETTER_AUTH_SECRET || "").trim();
  const turns = num(env.COMPOSE_FREE_TURNS, 10);
  return {
    on: !!secret && turns > 0,
    secret,
    turns,
    windowMs: num(env.COMPOSE_FREE_WINDOW_DAYS, 30) * DAY || 30 * DAY,
    ipPerDay: num(env.COMPOSE_FREE_IP_PER_DAY, 20),
    sitePerDay: num(env.COMPOSE_FREE_SITE_PER_DAY, 2000),
  };
}

const enc = new TextEncoder();

function b64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

function same(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** A fresh cookie value: a random visitor id and its signature. */
export async function mintFree(secret) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
  return `${id}.${await hmac(secret, `seqbaby-free:${id}`)}`;
}

/** The visitor id a cookie carries, or null when it is not signed under `secret`. */
export async function readFree(value, secret) {
  const s = String(secret ?? "").trim();
  if (!s || typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  return same(value.slice(dot + 1), await hmac(s, `seqbaby-free:${id}`)) ? id : null;
}

/** An address as a bucket name that is not the address. */
export async function hashIp(ip, secret) {
  return (await hmac(secret, `seqbaby-ip:${String(ip ?? "")}`)).slice(0, 24);
}

/**
 * Take one of `limit` turns in a rolling window for job `id`, or say no.
 * The record is the turns taken, `[{id, at}]`, oldest first.
 * @returns {{ rec: {id: string, at: number}[], left: number } | { error: "limit", left: 0 }}
 */
export function takeWindow(rec, id, limit, windowMs, now = Date.now()) {
  const live = (Array.isArray(rec) ? rec : []).filter((t) => t && now - t.at < windowMs);
  if (live.length >= limit) return { error: "limit", left: 0 };
  const next = [...live, { id, at: now }];
  return { rec: next, left: limit - next.length };
}

/** Give back job `id`'s turn (a job that never started). */
export function dropWindow(rec, id) {
  return (Array.isArray(rec) ? rec : []).filter((t) => t && t.id !== id);
}

/** How many turns are left in the window. */
export function windowLeft(rec, limit, windowMs, now = Date.now()) {
  const live = (Array.isArray(rec) ? rec : []).filter((t) => t && now - t.at < windowMs);
  return Math.max(0, limit - live.length);
}

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Take one of `limit` turns today (UTC). The record is `{day, n}`: a count,
 * not a list, since the site's can run to thousands. A limit of 0 allows none.
 * @returns {{ rec: {day: string, n: number}, day: string } | { error: "limit" }}
 */
export function takeDaily(rec, limit, now = Date.now()) {
  const day = dayOf(now);
  const n = rec && rec.day === day ? Number(rec.n) || 0 : 0;
  if (n >= limit) return { error: "limit" };
  return { rec: { day, n: n + 1 }, day };
}

/** Give back a turn taken on `day` (the day takeDaily returned): a give-back
 *  that lands after midnight still comes off the day it was charged to. */
export function dropDaily(rec, day) {
  if (!rec || rec.day !== day) return rec ?? null;
  return { day, n: Math.max(0, (Number(rec.n) || 0) - 1) };
}

/** What each limit running out says to the visitor. */
export function freeLimitMessage(which, cfg) {
  if (which === "visitor") {
    return `that's your ${cfg.turns} free turns. Make an account to keep composing.`;
  }
  if (which === "ip") {
    return "free composing from this connection is used up for today. Make an account to keep going.";
  }
  return "free composing is resting for today. Make an account to keep going.";
}

/** Bucket names, kept apart from the account and unlock buckets. */
export const freeBuckets = {
  visitor: (id) => `free/${id}`,
  ip: (hash) => `freeip/${hash}`,
  site: () => "free-site",
};
