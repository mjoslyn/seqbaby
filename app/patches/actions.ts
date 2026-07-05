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

// Publish a local patch (name + Tone.js config JSON) to the public gallery.
export async function publishPatch(input: {
  name: string;
  engine_type?: string | null;
  config: unknown;
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const name = (input.name || "patch").slice(0, 120);
  const { data, error } = await supabase
    .from("patches")
    .insert({
      owner_id: user.id,
      name,
      engine_type: input.engine_type ?? null,
      config: input.config,
      is_public: true,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
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
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,display_name,username")
      .in("id", ownerIds);
    for (const p of profs ?? [])
      names.set(p.id, p.display_name || p.username || "anon");
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
  const { error } = await supabase
    .from("patches")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  return error ? { error: error.message } : { ok: true };
}
