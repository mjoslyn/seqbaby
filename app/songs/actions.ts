"use server";

import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type SongListItem = {
  id: string;
  title: string;
  updated_at: string;
  is_public: boolean;
  share_slug: string | null;
};

function newSlug(): string {
  return (
    randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) ||
    randomBytes(4).toString("hex")
  );
}

// Save the current song. Insert when no id, update in place when id is owned.
export async function saveSong(input: {
  id?: string;
  title: string;
  data: unknown;
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const title = (input.title || "untitled").slice(0, 200);

  if (input.id) {
    const { error } = await supabase
      .from("songs")
      .update({ title, data: input.data })
      .eq("id", input.id)
      .eq("owner_id", user.id);
    if (error) return { error: error.message };
    return { id: input.id };
  }

  const { data: row, error } = await supabase
    .from("songs")
    .insert({ owner_id: user.id, title, data: input.data })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: row.id };
}

export async function listSongs(): Promise<{
  songs: SongListItem[];
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { songs: [] };
  const { data, error } = await supabase
    .from("songs")
    .select("id,title,updated_at,is_public,share_slug")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return { songs: [], error: error.message };
  return { songs: (data as SongListItem[]) ?? [] };
}

// Load a song's data. RLS allows the owner, or anyone if the song is public.
export async function loadSong(
  id: string,
): Promise<{ title?: string; data?: unknown; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("songs")
    .select("title,data")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Song not found" };
  return { title: data.title, data: data.data };
}

export async function renameSong(
  id: string,
  title: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("songs")
    .update({ title: (title || "untitled").slice(0, 200) })
    .eq("id", id)
    .eq("owner_id", user.id);
  return error ? { error: error.message } : { ok: true };
}

export async function deleteSong(
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("songs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  return error ? { error: error.message } : { ok: true };
}

// Publish (or re-publish) a song: mark public and ensure it has a share slug.
export async function publishSong(
  id: string,
): Promise<{ slug?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing, error: readErr } = await supabase
    .from("songs")
    .select("share_slug")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!existing) return { error: "Song not found" };

  let slug = existing.share_slug as string | null;
  // Assign a fresh unique slug if none, retrying on the unique constraint.
  for (let attempt = 0; !slug && attempt < 5; attempt++) {
    const candidate = newSlug();
    const { error } = await supabase
      .from("songs")
      .update({ is_public: true, share_slug: candidate })
      .eq("id", id)
      .eq("owner_id", user.id);
    if (!error) {
      slug = candidate;
      break;
    }
    if (!/duplicate key|unique/i.test(error.message)) return { error: error.message };
  }
  if (!slug) return { error: "Could not allocate a share link" };

  // Ensure is_public is set even when a slug already existed.
  const { error: pubErr } = await supabase
    .from("songs")
    .update({ is_public: true })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (pubErr) return { error: pubErr.message };

  return { slug };
}

export async function unpublishSong(
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { error } = await supabase
    .from("songs")
    .update({ is_public: false })
    .eq("id", id)
    .eq("owner_id", user.id);
  return error ? { error: error.message } : { ok: true };
}
