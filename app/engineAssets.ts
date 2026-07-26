// The engine's three boot scripts, in the order they must execute.
// `Tone` and `window.woscillators` are ambient globals that main.js's module
// graph reads at eval time, so ordering is load-bearing (see ScriptLoader).
export const TONE_SRC =
  "https://cdn.jsdelivr.net/npm/tone@15.0.4/build/Tone.js";
export const WOSC_SRC = "/woscillators.js";
export const MAIN_SRC = "/js/main.js";

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
  "beat.js",
  "bounce.js",
  "buffers.js",
  "catalog.js",
  "constants.js",
  "curves.js",
  "dialogs.js",
  "dom.js",
  "fxRack.js",
  "generate.js",
  "icons.js",
  "keyboard.js",
  "lfo.js",
  "main.js",
  "meter.js",
  "meters.js",
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
  "theory.js",
  "track.js",
  "transport.js",
  "voices.js",
  "wavetableEditor.js",
].map((f) => `/js/${f}`);
