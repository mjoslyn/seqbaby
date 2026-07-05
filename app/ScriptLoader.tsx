"use client";

import { useEffect } from "react";

// The engine boots as a side effect of importing /js/main.js, and it hard-depends
// on two globals being present first: `Tone` (used unqualified across ~10 modules)
// and `window.woscillators` (destructured at module-eval time in constants.js).
// Dynamically-inserted scripts are async by default and would NOT preserve order,
// so we chain them explicitly with onload: Tone -> woscillators -> main.js (module).
// A module-level guard makes this run exactly once per page load.
let booted = false;

function loadScript(src: string, asModule = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    if (asModule) s.type = "module";
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.body.appendChild(s);
  });
}

export default function ScriptLoader() {
  useEffect(() => {
    if (booted) {
      // Soft navigation back into the studio (e.g. the post-sign-in redirect)
      // re-renders the markup with a fresh, empty #tracks, orphaning the nodes
      // the engine created imperatively. If a prior boot completed (window.seqbaby
      // exists) but #tracks is now empty, a full reload re-boots cleanly.
      if (
        window.seqbaby &&
        document.querySelectorAll("#tracks .sq-track").length === 0
      ) {
        window.location.reload();
      }
      return;
    }
    booted = true;
    (async () => {
      try {
        await loadScript("https://cdn.jsdelivr.net/npm/tone@15.0.4/build/Tone.js");
        await loadScript("/woscillators.js");
        await loadScript("/js/main.js", true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[seqbaby] engine boot failed", err);
      }
    })();
  }, []);

  return null;
}
