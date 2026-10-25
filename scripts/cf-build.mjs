// The Cloudflare build: `opennextjs-cloudflare build` with the engine's asset
// version set.
//
// NEXT_PUBLIC_ENGINE_VERSION puts every engine asset under /e/<sha>/ (see
// app/engineAssets.ts and scripts/stamp-engine-assets.mjs), which is what
// lets public/_headers serve them `immutable`. Workers Builds sets
// WORKERS_CI_COMMIT_SHA; a build from a checkout uses its HEAD. OpenNext runs
// `npm run build` itself, which stamps the assets and builds Next with this
// environment.

import { execSync, spawnSync } from "node:child_process";

let version = process.env.NEXT_PUBLIC_ENGINE_VERSION || process.env.WORKERS_CI_COMMIT_SHA || "";
if (!version) {
  try {
    version = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* not a checkout: unversioned assets, which still work, uncached */
  }
}
console.log(`[cf-build] engine version: ${version || "(none)"}`);

const res = spawnSync("npx", ["opennextjs-cloudflare", "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_ENGINE_VERSION: version },
});
process.exit(res.status ?? 1);
