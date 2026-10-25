import "server-only";
import { headers } from "next/headers";
import { cfEnv } from "@/lib/cf";
import { makeAuth } from "./config.js";
import { linkMail, sendMail } from "./mail";

type Auth = ReturnType<typeof makeAuth>;

// One Better Auth instance per database binding and site origin: building one
// is cheap but not free, and both change between a build-time prerender, the
// production hostname and a preview URL.
const cache = new WeakMap<object, Map<string, Auth>>();

/** This request's own origin: what Better Auth puts in emailed links and
 *  checks a form's Origin header against. The Host can be trusted here: only
 *  hostnames routed to this Worker reach it. */
async function requestOrigin(): Promise<string | undefined> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return undefined;
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return undefined; // no request (a build-time prerender)
  }
}

/** Better Auth, wired to this Worker's D1 and email binding. */
export async function getAuth(): Promise<Auth> {
  const env = await cfEnv();
  // BETTER_AUTH_URL pins the origin (the production site); without it, each
  // hostname the Worker answers on (a preview, localhost) is its own.
  const origin = env.BETTER_AUTH_URL || (await requestOrigin()) || "http://localhost:3000";
  let byOrigin = cache.get(env.DB);
  if (!byOrigin) cache.set(env.DB, (byOrigin = new Map()));
  let auth = byOrigin.get(origin);
  if (!auth) {
    if (!env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production")
      throw new Error("BETTER_AUTH_SECRET is not set (npx wrangler secret put BETTER_AUTH_SECRET)");
    auth = makeAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET || "dev-only-secret-dev-only-secret-0000",
      baseURL: origin,
      trustedOrigins: [origin],
      sendMail: ({ to, subject, lead, label, url }) => sendMail(env, linkMail(to, subject, lead, label, url)),
    });
    byOrigin.set(origin, auth);
  }
  return auth;
}
