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
    // An update matching zero rows is not an error to PostgREST -- a wrong id,
    // someone else's id, or a row deleted in another tab all come back clean. So
    // every write here asks for the affected rows back and checks them; without
    // that the caller is told the save succeeded when nothing was written.
    const { data: rows, error } = await supabase
      .from("songs")
      .update({ title, data: input.data })
      .eq("id", input.id)
      .eq("owner_id", user.id)
      .select("id");
    if (error) return { error: error.message };
    if (!rows?.length) return { error: "Song not found" };
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

// Fork a public (or owned) song into the current user's account. The copy starts
// private and records its ancestry via forked_from.
export async function forkSong(
  sourceId: string,
): Promise<{ id?: string; title?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: src, error: readErr } = await supabase
    .from("songs")
    .select("title,data")
    .eq("id", sourceId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!src) return { error: "Source session not found" };

  const title = `${src.title} (fork)`.slice(0, 200);
  const { data: row, error } = await supabase
    .from("songs")
    .insert({
      owner_id: user.id,
      title,
      data: src.data,
      forked_from: sourceId,
      is_public: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: row.id, title };
}

// Save the current session under a name, with an optional public toggle. Updates
// the existing same-named song for this user (so re-saving doesn't pile up dupes),
// otherwise inserts. When public, ensures a share slug and returns it.
export async function saveNamedSong(input: {
  title: string;
  data: unknown;
  isPublic: boolean;
}): Promise<{ id?: string; slug?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const title = (input.title || "untitled").slice(0, 200);

  const { data: existingRows } = await supabase
    .from("songs")
    .select("id,share_slug")
    .eq("owner_id", user.id)
    .eq("title", title)
    .order("updated_at", { ascending: false })
    .limit(1);
  let id = existingRows?.[0]?.id as string | undefined;
  let slug = existingRows?.[0]?.share_slug as string | null | undefined;

  if (id) {
    const { data: rows, error } = await supabase
      .from("songs")
      .update({ data: input.data })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id");
    if (error) return { error: error.message };
    // The SELECT above and this UPDATE are not atomic: the row can go away in
    // between.
    if (!rows?.length) return { error: "Song not found" };
  } else {
    const { data: row, error } = await supabase
      .from("songs")
      .insert({ owner_id: user.id, title, data: input.data })
      .select("id,share_slug")
      .single();
    if (error) return { error: error.message };
    id = row.id;
    slug = row.share_slug;
  }

  if (input.isPublic) {
    if (!slug) slug = newSlug();
    const { data: rows, error } = await supabase
      .from("songs")
      .update({ is_public: true, share_slug: slug })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id");
    if (error) return { error: error.message };
    if (!rows?.length) return { error: "Song not found" };
    return { id, slug: slug ?? undefined };
  }
  const { data: privRows, error: privErr } = await supabase
    .from("songs")
    .update({ is_public: false })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (privErr) return { error: privErr.message };
  if (!privRows?.length) return { error: "Song not found" };
  return { id };
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
  const { data: rows, error } = await supabase
    .from("songs")
    .update({ title: (title || "untitled").slice(0, 200) })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Song not found" };
  return { ok: true };
}

export async function deleteSong(
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: rows, error } = await supabase
    .from("songs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Song not found" };
  return { ok: true };
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
    const { data: rows, error } = await supabase
      .from("songs")
      .update({ is_public: true, share_slug: candidate })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id");
    if (!error) {
      // Clean, but nothing written: the song went away between the read above
      // and this write. Handing back a share link for it would be a lie.
      if (!rows?.length) return { error: "Song not found" };
      slug = candidate;
      break;
    }
    if (!/duplicate key|unique/i.test(error.message)) return { error: error.message };
  }
  if (!slug) return { error: "Could not allocate a share link" };

  // Ensure is_public is set even when a slug already existed.
  const { data: pubRows, error: pubErr } = await supabase
    .from("songs")
    .update({ is_public: true })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (pubErr) return { error: pubErr.message };
  if (!pubRows?.length) return { error: "Song not found" };

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
  const { data: rows, error } = await supabase
    .from("songs")
    .update({ is_public: false })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Song not found" };
  return { ok: true };
}
