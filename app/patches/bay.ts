"use client";

import { createClient } from "@/lib/supabase/client";

// The patch bay from the browser: the studio's saved patches, read and written
// straight to `patches` under its RLS (owner_all), the way LikeButton reads.
// Straight rather than through a server action because a sampler patch
// carries its sample as base64, and a server action's body stops at 1MB.

export type BayEntry = {
  id: string;
  name: string;
  engineKey: string | null;
  kind: string | null;
  /** Only for a legacy custom-Tone patch, which the engine builds as an engine. */
  config?: unknown;
};

async function me() {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return { supabase, userId: data.session?.user.id ?? null };
}

/** The account's patches, newest first and one per name, without configs
 *  except the small legacy ones. Null when signed out. */
export async function loadIndex(): Promise<BayEntry[] | null> {
  const { supabase, userId } = await me();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("patches")
    .select("id,name,engineKey:config->>engineKey,kind:config->>_kind")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const list: BayEntry[] = [];
  for (const r of (data ?? []) as BayEntry[]) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    list.push({ id: r.id, name: r.name, engineKey: r.engineKey, kind: r.kind });
  }
  const legacy = list.filter((p) => p.kind !== "track-patch");
  if (legacy.length) {
    const { data: rows } = await supabase
      .from("patches")
      .select("id,config")
      .in("id", legacy.map((p) => p.id));
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r.config]));
    for (const p of legacy) p.config = byId.get(p.id);
  }
  return list;
}

export async function fetchConfig(id: string): Promise<unknown> {
  const { supabase } = await me();
  const { data, error } = await supabase.from("patches").select("config").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("patch not found");
  return data.config;
}

function engineTypeOf(config: unknown): string | null {
  const c = config as Record<string, unknown> | null;
  const synth = c?.synth as Record<string, unknown> | undefined;
  return (
    (typeof c?.engineKey === "string" && c.engineKey) ||
    (typeof c?.type === "string" && c.type) ||
    (typeof synth?.type === "string" && synth.type) ||
    null
  );
}

/** Save by name, as the studio always has: the patch of that name is
 *  replaced, else a private one is made. Returns its id. */
export async function putPatch(name: string, config: unknown): Promise<string> {
  const { supabase, userId } = await me();
  if (!userId) throw new Error("sign in to save patches");
  name = name.slice(0, 120);
  const { data: existing, error: findErr } = await supabase
    .from("patches")
    .select("id")
    .eq("owner_id", userId)
    .eq("name", name)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  const fields = { name, config, engine_type: engineTypeOf(config) };
  const { data, error } = existing
    ? await supabase.from("patches").update(fields).eq("id", existing.id).select("id").single()
    : await supabase
        .from("patches")
        .insert({ owner_id: userId, is_public: false, ...fields })
        .select("id")
        .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function removePatch(id: string): Promise<void> {
  const { supabase } = await me();
  const { data, error } = await supabase.from("patches").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("patch not found");
}

// ---- off localStorage ------------------------------------------------------
//
// Patches used to live in this browser (seqbaby.patches.v1). The first time a
// signed-in account opens the studio or settings here, they go up into it and
// the browser's copy is removed. A patch the account already has under that
// name is skipped when it is the same patch, and saved beside it as `name 2`
// when it is not: nothing here overwrites what the account holds.

const LEGACY_KEY = "seqbaby.patches.v1";

// jsonb does not keep key order, so "the same patch" is compared on sorted keys.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

export async function migrateLocalPatches(): Promise<number> {
  let local: Record<string, unknown>;
  try {
    local = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
  } catch {
    local = {};
  }
  const names = Object.keys(local);
  if (!names.length) return clearLeftovers(), 0;
  const { supabase, userId } = await me();
  if (!userId) return 0;

  const { data: mine, error } = await supabase.from("patches").select("id,name").eq("owner_id", userId);
  if (error) return 0;
  const taken = new Map((mine ?? []).map((r) => [r.name as string, r.id as string]));

  let moved = 0;
  const left: Record<string, unknown> = {};
  for (const name of names) {
    try {
      const id = taken.get(name);
      if (id && canonical(await fetchConfig(id)) === canonical(local[name])) {
        moved++;
        continue;
      }
      let as = name.slice(0, 120);
      for (let i = 2; taken.has(as); i++) as = `${name} ${i}`.slice(0, 120);
      const { data, error: insErr } = await supabase
        .from("patches")
        .insert({ owner_id: userId, is_public: false, name: as, config: local[name], engine_type: engineTypeOf(local[name]) })
        .select("id")
        .single();
      if (insErr) throw insErr;
      taken.set(as, data.id as string);
      moved++;
    } catch {
      left[name] = local[name];
    }
  }
  // Only what made it across leaves the browser; the rest waits for next time.
  try {
    if (Object.keys(left).length) localStorage.setItem(LEGACY_KEY, JSON.stringify(left));
    else localStorage.removeItem(LEGACY_KEY);
  } catch {}
  clearLeftovers();
  return moved;
}

// The branch-only sync that preceded this kept a record per account.
function clearLeftovers() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("seqbaby.patchBay.v1:")) localStorage.removeItem(k);
    }
  } catch {}
}
