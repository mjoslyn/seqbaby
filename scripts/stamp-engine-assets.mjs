// Copies the engine's static assets to a version-stamped path under public/e/,
// so each deploy addresses them at URLs nobody has cached before and they can be
// served `immutable` (see netlify.toml).
//
// Why a copy rather than a rewrite: the engine is 33 unbundled ES modules whose
// relative specifiers ("./voices.js") resolve against the importing module's
// URL, so the version has to live in the PATH — a ?query is dropped during that
// resolution and would only ever reach main.js. A path prefix could come from a
// Netlify rewrite instead, but rewrites are routing behaviour that can't be
// verified until it's live, and the failure mode is every engine asset 404ing.
// Real files at real paths are served straight off the CDN, get the same headers
// as any other static asset, and can be checked locally with `next start`.
//
// Runs only when NEXT_PUBLIC_ENGINE_VERSION is set — i.e. in the Netlify build,
// never in `npm run dev`. The edit-and-reload loop over public/js is untouched.

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "public", "e");

// Kept in step with app/engineAssets.ts. Boot-critical assets only: the
// wavetable WAVs are fetched by the engine at absolute paths it builds itself,
// and they're lazy, so they stay unversioned.
const ASSETS = ["js", "woscillators.js", "style.css"];

const version = process.env.NEXT_PUBLIC_ENGINE_VERSION || "";

if (!version) {
  console.log("[stamp-engine-assets] no NEXT_PUBLIC_ENGINE_VERSION — skipping");
  process.exit(0);
}

// Drop stamps from previous builds so a rebuilt working tree doesn't accumulate
// them (and so a local run leaves nothing behind that a later deploy would ship).
await rm(outRoot, { recursive: true, force: true });

const outDir = join(outRoot, version);
await mkdir(outDir, { recursive: true });

for (const asset of ASSETS) {
  await cp(join(root, "public", asset), join(outDir, asset), {
    recursive: true,
  });
}

const modules = (await readdir(join(outDir, "js"))).filter((f) =>
  f.endsWith(".js"),
);
console.log(
  `[stamp-engine-assets] public/e/${version}/ — ${modules.length} modules + ${
    ASSETS.length - 1
  } assets`,
);
