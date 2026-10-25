import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// The homepage, /songs, /people and /patches are cached for 60s and
// regenerated in the background (`revalidate = 60`). OpenNext keeps those
// pages in R2 and queues the regeneration through a Durable Object; both
// bindings are in wrangler.jsonc. Nothing calls revalidateTag, so there is no
// tag cache.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: doQueue,
});
