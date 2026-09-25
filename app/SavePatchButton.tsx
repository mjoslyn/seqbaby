"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { savePatchToBay } from "@/app/patches/actions";
import { IconSave } from "./menuIcons";

// Save a published patch into your patch bay: a private copy in your account
// (savePatchToBay, migration 0018), which the studio pulls into its saved
// patches the next time it loads or comes back into view (patches/patchSync.ts).
//
// Whether a card's patch is already in your bay (a copy saved from it, or your
// own) is one batched browser read per page, the way LikeButton asks what you
// have liked: the homepage is cached and cannot know who is looking.

let pending: { ids: Set<string>; done: Promise<Set<string>> } | null = null;

function inMyBay(id: string): Promise<Set<string>> {
  if (!pending) {
    const ids = new Set<string>();
    const done = new Promise<Set<string>>((resolve) => {
      queueMicrotask(async () => {
        pending = null;
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          const me = data.session?.user.id;
          if (!me) return resolve(new Set());
          const list = [...ids].join(",");
          const { data: rows, error } = await supabase
            .from("patches")
            .select("id,saved_from")
            .eq("owner_id", me)
            .or(`id.in.(${list}),saved_from.in.(${list})`);
          if (error) return resolve(new Set());
          resolve(new Set((rows ?? []).flatMap((r) => [r.id as string, r.saved_from as string])));
        } catch {
          // No Supabase env, or no 0018 yet: nothing is saved.
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
      if (res.error === "Not signed in") {
        window.location.href = "/login";
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
