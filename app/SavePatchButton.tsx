"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconSave } from "./menuIcons";

// Save a published patch into your own patches: the studio's saved-patch store
// (localStorage seqbaby.patches.v1, catalog.js), which is what a track's load
// button picks from. The homepage and a profile page run no engine, so this
// writes the store directly, the way PatchManager reads it.
//
// The config comes from /api/patch/<id>, the same cached read a card's play
// button makes, so a patch already auditioned costs nothing more.

const PATCHES_KEY = "seqbaby.patches.v1";

function readStore(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PATCHES_KEY) || "{}");
  } catch {
    return {};
  }
}

function uniqueName(base: string, taken: Record<string, unknown>): string {
  if (!(base in taken)) return base;
  for (let i = 2; i < 999; i++) if (!(`${base} ${i}` in taken)) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

export default function SavePatchButton({
  patchId,
  name,
  className,
  savedClassName,
}: {
  patchId: string;
  name: string;
  className?: string;
  savedClassName?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [savedAs, setSavedAs] = useState("");

  async function save() {
    if (state === "busy") return;
    setState("busy");
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = "/login";
        return;
      }
      const res = await fetch(`/api/patch/${patchId}`);
      if (!res.ok) throw new Error("not found");
      const patch = (await res.json()) as { name?: string; config?: unknown };
      if (patch.config === undefined) throw new Error("no config");

      const all = readStore();
      // Saving the same patch twice must not put a second copy in the list.
      const json = JSON.stringify(patch.config);
      const existing = Object.keys(all).find((k) => JSON.stringify(all[k]) === json);
      const as = existing ?? uniqueName(patch.name || name, all);
      if (!existing) {
        all[as] = patch.config;
        localStorage.setItem(PATCHES_KEY, JSON.stringify(all));
      }
      setSavedAs(as);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  const saved = state === "saved";
  const label = saved
    ? `saved to your patches as "${savedAs}"`
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
