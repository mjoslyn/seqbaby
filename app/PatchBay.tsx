"use client";

import { useEffect } from "react";
import { fetchConfig, loadIndex, migrateLocalPatches, putPatch, removePatch } from "./patches/bay";

// Hands the engine its saved patches: the signed-in account's patch bay
// (patches/bay.ts), and the way to read and write it (catalog.js's
// setPatchBackend). Mounted by the account bar for a signed-in visitor only,
// so signed out the engine has no backend and says so when asked to save.
// Draws nothing.
export default function PatchBay() {
  useEffect(() => {
    let cancelled = false;
    const ids = new Map<string, string>();

    const index = async () => {
      const list = await loadIndex();
      if (!list) return null;
      ids.clear();
      for (const p of list) ids.set(p.name, p.id);
      return list;
    };

    const backend = {
      fetch: async (name: string) => {
        const id = ids.get(name);
        if (!id) throw new Error("patch not found");
        return fetchConfig(id);
      },
      save: async (name: string, config: unknown) => {
        ids.set(name, await putPatch(name, config));
      },
      remove: async (name: string) => {
        const id = ids.get(name);
        if (id) await removePatch(id);
        ids.delete(name);
      },
    };

    const start = async () => {
      await migrateLocalPatches().catch(() => 0);
      const list = await index().catch(() => null);
      if (cancelled || !list) return;
      window.seqbaby?.setPatchBackend(backend, list);
    };
    // Back to this tab: a patch may have been saved from a card, or changed
    // on another device.
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const list = await index().catch(() => null);
      if (!cancelled && list) window.seqbaby?.setPatchList(list);
    };

    const onReady = () => void start();
    if (window.seqbaby) onReady();
    else window.addEventListener("seqbaby:ready", onReady, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("seqbaby:ready", onReady);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
