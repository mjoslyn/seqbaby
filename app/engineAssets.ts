// Cache-busting prefix for the engine's static assets, set from the deploy's
// commit SHA (netlify.toml passes $COMMIT_REF into the build).
// scripts/stamp-engine-assets.mjs publishes copies of the assets under
// public/e/<sha>/, so these URLs are real static files — identical bytes, fresh
// addresses per deploy. That's what lets them be served `immutable`.
//
// The version goes in the PATH, not a ?query, and that distinction is the whole
// design. Relative specifiers inside the engine ("./voices.js") resolve against
// the importing module's URL, which keeps the path but drops the query — so a
// path prefix propagates through all 41 modules for free, while ?v= would reach
// only main.js and leave its imports unversioned. It also means zero changes to
// public/js: no rewritten specifiers, no bundler.
//
// Empty when NEXT_PUBLIC_ENGINE_VERSION is unset (dev, plain `next build`), so
// assets stay at their bare paths and the edit-and-reload loop is untouched.
const ENGINE_VERSION = process.env.NEXT_PUBLIC_ENGINE_VERSION || "";
const ENGINE_PREFIX = ENGINE_VERSION ? `/e/${ENGINE_VERSION}` : "";

/** Address a public/ asset at this deploy's versioned path. */
export const engineAsset = (path: string) => `${ENGINE_PREFIX}${path}`;

// The engine's three boot scripts, in the order they must execute.
// `Tone` and `window.woscillators` are ambient globals that main.js's module
// graph reads at eval time, so ordering is load-bearing (see ScriptLoader).
// Tone comes from jsdelivr, which already serves it immutable and versioned.
export const TONE_SRC =
  "https://cdn.jsdelivr.net/npm/tone@15.0.4/build/Tone.js";
export const WOSC_SRC = engineAsset("/woscillators.js");
export const MAIN_SRC = engineAsset("/js/main.js");
export const STYLE_SRC = engineAsset("/style.css");

// Every module reachable from main.js. The graph is 8 levels deep, and the
// browser can only discover level N+1 after parsing level N — that's up to
// eight sequential round trips before the engine has all its code. Listing
// them here as <link rel="modulepreload"> collapses that to one parallel
// fetch that starts while the HTML is still streaming.
//
// Keep in sync when adding/removing a module in public/js/. A stale entry only
// costs a wasted 404; a missing one just falls back to discovery.
// Regenerate with:
//   node -e 'const fs=require("fs"),s=new Set();(function w(f){if(s.has(f))return;s.add(f);for(const m of fs.readFileSync(f,"utf8").matchAll(/from\s+"\.\/(\w+\.js)"/g))w(m[1])})("main.js");console.log([...s].sort().join("\n"))'
// from public/js/. (types.js is JSDoc-only and intentionally absent.)
export const ENGINE_MODULES = [
  "appApi.js",
  "automation.js",
  "bass.js",
  "beat.js",
  "bounce.js",
  "buffers.js",
  "catalog.js",
  "constants.js",
  "curves.js",
  "dialogs.js",
  "dom.js",
  "dx7.js",
  "fxRack.js",
  "generate.js",
  "guitar.js",
  "icons.js",
  "keyboard.js",
  "lfo.js",
  "main.js",
  "meter.js",
  "meters.js",
  "paramMenu.js",
  "paramTargets.js",
  "patternSound.js",
  "params.js",
  "patternBar.js",
  "pianoRoll.js",
  "render.js",
  "scaleUI.js",
  "session.js",
  "signal.js",
  "state.js",
  "stepEditor.js",
  "stepGrid.js",
  "tb303.js",
  "theory.js",
  "track.js",
  "transport.js",
  "virus.js",
  "voices.js",
  "wavetableEditor.js",
].map((f) => engineAsset(`/js/${f}`));
