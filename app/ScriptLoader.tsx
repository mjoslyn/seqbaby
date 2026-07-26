"use client";

import { useEffect } from "react";
import { MAIN_SRC, TONE_SRC, WOSC_SRC } from "./engineAssets";

// The engine normally boots from the <script> tags EngineScripts server-renders
// into the document (fastest path — the parser starts them immediately). This
// component covers the two cases that path can't:
//
//  1. Soft navigation back into the studio (e.g. the post-sign-in redirect).
//     React re-renders the markup with a fresh, empty #tracks, orphaning the
//     nodes the engine created imperatively, and the server-rendered <script>
//     tags do NOT re-execute. A full reload re-boots cleanly.
//  2. Arriving at the studio by client-side navigation (e.g. from /login). The
//     engine markup is applied as innerHTML there, so its <script> tags never
//     execute and nothing has booted. We fall back to ordered injection.
//
// The engine hard-depends on two globals being present before main.js runs:
// `Tone` (used unqualified across ~10 modules) and `window.woscillators`
// (destructured at module-eval time in constants.js). Dynamically-inserted
// scripts are async by default and would NOT preserve order, so the fallback
// chains them explicitly with onload.
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
      if (
        window.seqbaby &&
        document.querySelectorAll("#tracks .sq-track").length === 0
      ) {
        window.location.reload();
      }
      return;
    }
    booted = true;

    // Set synchronously by EngineScripts' inline marker, and only on the parser
    // path — so it means "the ordered boot is already under way", even though
    // main.js may still be mid-execution and window.seqbaby not yet assigned.
    // Booting a second copy would be far worse than booting none.
    if (window.__seqbabyServerBoot) return;

    (async () => {
      try {
        await loadScript(TONE_SRC);
        await loadScript(WOSC_SRC);
        await loadScript(MAIN_SRC, true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[seqbaby] engine boot failed", err);
      }
    })();
  }, []);

  return null;
}
