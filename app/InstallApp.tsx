"use client";

import { useEffect } from "react";
import { engineAsset } from "@/app/engineAssets";
import { watchInstall } from "@/app/installApp";

// Mounted once, in the root layout: registers the service worker
// (public/sw.js) and starts listening for the browser's offer to install.
// Renders nothing; the offer itself is in the help menu.
//
// The worker is production's only. In dev it would hand the edit-and-reload
// loop a cached engine module, and a worker left over from a production build
// on localhost is taken off for the same reason.
export default function InstallApp() {
  useEffect(() => {
    watchInstall();
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    let cancelled = false;
    const warm = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        // What this page loaded, for the worker to keep: on a first visit it
        // arrived after the engine did.
        const urls = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((u) => u.startsWith(location.origin));
        const path = location.pathname;
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({
          type: "warm",
          urls,
          page: !location.search && (path === "/studio" || path === "/") ? path : undefined,
          engine: engineAsset("") || undefined,
        });
      } catch {
        /* no worker: the site works as it always did */
      }
    };
    // after the page has what it needs: the engine's own boot comes first
    if (document.readyState === "complete") setTimeout(warm, 3000);
    else window.addEventListener("load", () => setTimeout(warm, 3000), { once: true });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
