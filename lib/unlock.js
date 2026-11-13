// The unlock code: a code the deploy keeps as a secret (COMPOSE_UNLOCK_CODE),
// shared as a link (`/studio?unlock=<code>`), that lets whoever opens it
// compose without an account and pick sonnet or opus.
//
// Opening the link sets a cookie, so it is remembered. The cookie does not
// hold the code: it holds a random visitor id and an HMAC of that id keyed
// by the code. So the cookie proves the code was known when it was set, the
// visitor id gives each person their own usage bucket (the limits are per
// person, not one pool for everyone with the link), and rotating the secret
// invalidates every cookie at once, since none of them signs under the new one.
//
// Plain JS with no imports (Web Crypto only), for lib/composeJobs.js's
// reasons: the route, the studio page and `node --test` all read it.

export const UNLOCK_COOKIE = "sq_unlock";
/** How long a cookie lasts once set: a year, or until the code is rotated. */
export const UNLOCK_MAX_AGE = 60 * 60 * 24 * 365;
/** What an unlock adds to the compose model menu. */
export const UNLOCK_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];

const enc = new TextEncoder();

function b64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(id, code) {
  const key = await crypto.subtle.importKey("raw", enc.encode(code), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`seqbaby-unlock:${id}`)));
}

/** Compare without stopping at the first difference. */
function same(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Whether `given` is the deploy's code. No code set means nothing unlocks. */
export function codeMatches(given, code) {
  const c = String(code ?? "").trim();
  if (!c) return false;
  return same(String(given ?? "").trim(), c);
}

/** A fresh cookie value: a random visitor id and its signature under `code`. */
export async function mintUnlock(code) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
  return `${id}.${await sign(id, code)}`;
}

/** The visitor id a cookie carries, or null when it is not signed under the current code. */
export async function readUnlock(value, code) {
  const c = String(code ?? "").trim();
  if (!c || typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  return same(value.slice(dot + 1), await sign(id, c)) ? id : null;
}
