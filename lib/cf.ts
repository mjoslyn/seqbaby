import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The Worker's bindings, from anywhere on the server: a route, a server
 * action, a server component. Async, because a page prerendered at build time
 * (the homepage's first render) asks before any request exists, and only the
 * async form answers then (from wrangler's local stand-ins).
 *
 * Under `next dev` the same bindings come from wrangler's local simulation
 * (initOpenNextCloudflareForDev in next.config.mjs), so D1, R2 and the
 * Durable Objects all work locally with nothing deployed.
 */
export async function cfEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as CloudflareEnv;
}

/** D1, the database. */
export async function cfDb(): Promise<D1Database> {
  return (await cfEnv()).DB;
}
