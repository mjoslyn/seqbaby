"use server";

import { createClient } from "@/lib/supabase/server";

export type MyPatch = {
  id: string;
  name: string;
  engine_type: string | null;
  is_public: boolean;
  created_at: string;
};

export type PublicPatch = {
  id: string;
  name: string;
  engine_type: string | null;
  created_at: string;
  author: string | null;
  mine: boolean;
};

// Publish a patch (name + config) to the public gallery. The patch bay holds
// every saved patch as a row already (0018), so this publishes the row of that
// name when there is one rather than putting a second copy in the gallery.
export async function publishPatch(input: {
  name: string;
  engine_type?: string | null;
  config: unknown;
}): Promise<{ id?: string; error?: string }> {
  const res = await putBayPatch({ ...input, is_public: true });
  return res.error ? { error: res.error } : { id: res.id };
}

export type BayPatch = { id: string; name: string; updated_at: string };

// Write a patch into the signed-in account's bay by name: the row of that name
// is updated (the newest, if an older gallery has duplicates), else one is
// inserted, private unless `is_public` says so. Names are the key because the
// studio's store is keyed by them.
export async function putBayPatch(input: {
  name: string;
  engine_type?: string | null;
  config: unknown;
  is_public?: boolean;
}): Promise<{ id?: string; name?: string; updated_at?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const name = (input.name || "patch").slice(0, 120);
  const fields = {
    name,
    engine_type: input.engine_type ?? null,
    config: input.config,
    ...(input.is_public === undefined ? {} : { is_public: input.is_public }),
  };
  const { data: existing, error: findErr } = await supabase
    .from("patches")
    .select("id")
    .eq("owner_id", user.id)
    .eq("name", name)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) return { error: findErr.message };
  const write = existing
    ? supabase.from("patches").update(fields).eq("id", existing.id).eq("owner_id", user.id)
    : supabase.from("patches").insert({ owner_id: user.id, is_public: false, ...fields });
  const { data, error } = await write.select("id,name,updated_at").single();
  if (error) return { error: error.message };
  return data;
}

// Save someone's published patch into your own bay: a private copy of it,
// remembering where it came from (`saved_from`), so a second save finds the
// first copy instead of making another. Your own patch is in your bay already.
export async function savePatchToBay(
  sourceId: string,
): Promise<{ id?: string; name?: string; already?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: src, error: readErr } = await supabase
    .from("patches")
    .select("id,owner_id,name,engine_type,config")
    .eq("id", sourceId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!src) return { error: "Patch not found" };
  if (src.owner_id === user.id) return { id: src.id, name: src.name, already: true };

  const { data: prior } = await supabase
    .from("patches")
    .select("id,name")
    .eq("owner_id", user.id)
    .eq("saved_from", sourceId)
    .limit(1)
    .maybeSingle();
  if (prior) return { id: prior.id, name: prior.name, already: true };

  // A name of its own: the bay is keyed by name, so a copy must not land on
  // a patch you already have that happens to share it.
  const { data: mine } = await supabase.from("patches").select("name").eq("owner_id", user.id);
  const taken = new Set((mine ?? []).map((r) => r.name as string));
  let name = src.name as string;
  for (let i = 2; taken.has(name); i++) name = `${src.name} ${i}`.slice(0, 120);

  const { data, error } = await supabase
    .from("patches")
    .insert({
      owner_id: user.id,
      name,
      engine_type: src.engine_type,
      config: src.config,
      is_public: false,
      saved_from: sourceId,
    })
    .select("id,name")
    .single();
  if (error) return { error: error.message };
  return { id: data.id, name: data.name };
}

// Every patch in the signed-in account's bay, without configs (a sampler
// patch carries its sample): the sync fetches a config only when it changed.
export async function listBayPatches(): Promise<{ patches: BayPatch[]; userId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { patches: [] };
  const { data, error } = await supabase
    .from("patches")
    .select("id,name,updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return { patches: [], userId: user.id, error: error.message };
  return { patches: (data as BayPatch[]) ?? [], userId: user.id };
}

// Publish or unpublish a patch in your bay. Unpublishing keeps it: it leaves
// the gallery, not your patches.
export async function setPatchPublic(
  id: string,
  isPublic: boolean,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: rows, error } = await supabase
    .from("patches")
    .update({ is_public: isPublic })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Patch not found" };
  return { ok: true };
}

export async function listMyPatches(): Promise<{
  patches: MyPatch[];
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { patches: [] };
  const { data, error } = await supabase
    .from("patches")
    .select("id,name,engine_type,is_public,created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return { patches: [], error: error.message };
  return { patches: (data as MyPatch[]) ?? [] };
}

// Public gallery, newest first, annotated with the author's display name and
// whether the current user owns each entry.
export async function listPublicPatches(
  limit = 60,
): Promise<{ patches: PublicPatch[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("patches")
    .select("id,name,engine_type,created_at,owner_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { patches: [], error: error.message };

  const rows = data ?? [];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    // profile_cards, not profiles: the gallery is read by anonymous visitors,
    // and a public patch by someone whose page is private still gets a byline.
    const { data: profs } = await supabase
      .from("profile_cards")
      .select("id,display_name,username")
      .in("id", ownerIds);
    for (const p of profs ?? [])
      names.set(p.id, p.username || p.display_name || "anon");
  }

  return {
    patches: rows.map((r) => ({
      id: r.id,
      name: r.name,
      engine_type: r.engine_type,
      created_at: r.created_at,
      author: names.get(r.owner_id) ?? null,
      mine: !!user && r.owner_id === user.id,
    })),
  };
}

// Fetch a patch's config for import (RLS: owner or public).
export async function getPatch(
  id: string,
): Promise<{ name?: string; config?: unknown; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patches")
    .select("name,config")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Patch not found" };
  return { name: data.name, config: data.config };
}

export async function deletePatch(
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  // Zero rows deleted is not an error to PostgREST -- check what was affected
  // rather than reporting a delete that never happened.
  const { data: rows, error } = await supabase
    .from("patches")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Patch not found" };
  return { ok: true };
}

/** Heart or un-heart a public patch (migration 0017), the patch twin of
 *  setLike in app/songs/actions.ts. Returns the fresh count. */
export async function setPatchLike(
  patchId: string,
  liked: boolean,
): Promise<{ liked?: boolean; likes?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (liked) {
    const { error } = await supabase
      .from("patch_likes")
      .upsert({ patch_id: patchId, user_id: user.id }, { onConflict: "patch_id,user_id", ignoreDuplicates: true });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("patch_likes")
      .delete()
      .eq("patch_id", patchId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };
  }

  const { data } = await supabase.from("patches").select("likes").eq("id", patchId).maybeSingle();
  const likes = typeof data?.likes === "number" ? data.likes : undefined;
  return { liked, likes };
}
