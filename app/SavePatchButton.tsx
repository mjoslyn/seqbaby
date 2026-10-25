"use client";

import { useEffect, useState } from "react";
import { patchesInMyBay, savePatchToBay } from "@/app/patches/actions";
import { IconSave } from "./menuIcons";
import { loginHref } from "@/lib/safeNext";

// Save a published patch into your patch bay: a private copy in your account
// (savePatchToBay, migration 0018), which the studio lists the next time it
// loads or comes back into view (app/PatchBay.tsx).
//
// Whether a card's patch is already in your bay (a copy saved from it, or your
// own) is one batched request per page, the way LikeButton asks what you have
// liked: the homepage is cached and cannot know who is looking.

let pending: { ids: Set<string>; done: Promise<Set<string>> } | null = null;

function inMyBay(id: string): Promise<Set<string>> {
  if (!pending) {
    const ids = new Set<string>();
    const done = new Promise<Set<string>>((resolve) => {
      queueMicrotask(async () => {
        pending = null;
        try {
          resolve(new Set(await patchesInMyBay([...ids])));
        } catch {
          resolve(new Set());
        }
      });
    });
    pending = { ids, done };
  }
  pending.ids.add(id);
  return pending.done;
}

export default function SavePatchButton({
  patchId,
  className,
  savedClassName,
}: {
  patchId: string;
  className?: string;
  savedClassName?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [savedAs, setSavedAs] = useState("");

  useEffect(() => {
    let cancelled = false;
    inMyBay(patchId).then((set) => {
      if (!cancelled && set.has(patchId)) setState((s) => (s === "idle" ? "saved" : s));
    });
    return () => {
      cancelled = true;
    };
  }, [patchId]);

  async function save() {
    if (state === "busy" || state === "saved") return;
    setState("busy");
    try {
      const res = await savePatchToBay(patchId);
      if (res.error === "not signed in") {
        window.location.href = loginHref(location.pathname + location.search);
        return;
      }
      if (res.error || !res.name) throw new Error(res.error);
      setSavedAs(res.name);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  const saved = state === "saved";
  const label = saved
    ? savedAs
      ? `saved to your patches as "${savedAs}"`
      : "in your patches"
    : state === "error"
      ? "could not save, try again"
      : "save to your patches";

  return (
    <button
      type="button"
      className={`${className ?? ""} ${saved ? (savedClassName ?? "") : ""}`}
      onClick={save}
      disabled={state === "busy"}
      aria-label={label}
      title={label}
    >
      <IconSave on={saved} />
    </button>
  );
}
