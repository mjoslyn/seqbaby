"use server";

import { createClient } from "@/lib/supabase/server";

export type MyPatch = {
  id: string;
  name: string;
  engine_type: string | null;
  is_public: boolean;
  created_at: string;
};

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
