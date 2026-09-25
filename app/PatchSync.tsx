"use client";

import { useEffect } from "react";
import { pushDeleted, pushSaved, syncBay } from "./patches/patchSync";

// Keeps the studio's saved patches and the signed-in account's patch bay in
// step (patches/patchSync.ts). Mounted by the account bar for a signed-in
// visitor only; draws nothing.
export default function PatchSync() {
  useEffect(() => {
    const run = () => void syncBay().catch(() => {});
    run();
    // Back to this tab: a patch may have been saved from a card elsewhere.
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    const onSaved = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name;
      if (name) void pushSaved(name).catch(() => {});
    };
    const onDeleted = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name;
      if (name) void pushDeleted(name).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("seqbaby:patchsaved", onSaved);
    window.addEventListener("seqbaby:patchdeleted", onDeleted);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("seqbaby:patchsaved", onSaved);
      window.removeEventListener("seqbaby:patchdeleted", onDeleted);
    };
  }, []);
  return null;
}
