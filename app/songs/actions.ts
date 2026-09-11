"use server";

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SongListItem = {
  id: string;
  title: string;
  updated_at: string;
  is_public: boolean;
  share_slug: string | null;
  current_version_id: string | null;
};

/** A node of a song's version tree. Never carries `data` -- the list is drawn
 *  for every song in the menu, and the blobs are the whole session each. */
export type SongVersion = {
  id: string;
  parent_id: string | null;
  seq: number;
  label: string | null;
  created_at: string;
};

const SONG_LIST_COLS = "id,title,updated_at,is_public,share_slug,current_version_id";

function newSlug(): string {
  return (
    randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) ||
    randomBytes(4).toString("hex")
  );
}

function hashData(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data) ?? "").digest("hex");
}

// Append a version to a song's tree and return its id.
//
// `parentId` is what makes the history a tree rather than a list: it is the
// version the save was made FROM, which is the tip when you have been editing
// forward and an older version when you loaded one and carried on. Two saves
// naming the same parent are two branches.
//
// A save whose blob is byte-identical to its parent's returns the parent
// instead of inserting. Otherwise pressing save twice would hang a duplicate
// off the tree, and these blobs are entire sessions -- base64 sample payloads
// included. Opening an old version and saving it unchanged therefore reverts
// the song to it (the caller still moves the tip) without a row that says
// nothing; every version it was ahead of stays in the tree.
//
// Versions backfilled by migration 0009 have an empty hash, which matches
// nothing -- so the first save of a pre-existing song always records, which is
// the safe direction to be wrong in.
async function appendVersion(
  supabase: SupabaseClient,
  input: {
    songId: string;
    ownerId: string;
    parentId: string | null;
    data: unknown;
    label?: string | null;
  },
): Promise<{ versionId?: string; seq?: number; unchanged?: boolean; error?: string }> {
  const hash = hashData(input.data);

  let parentId = input.parentId;
  if (parentId) {
    // Also the parent's existence check: a version id from a stale client, or
    // one belonging to another song, must not become a parent here.
    const { data: parent, error } = await supabase
      .from("song_versions")
      .select("id,seq,data_hash")
      .eq("id", parentId)
      .eq("song_id", input.songId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!parent) parentId = null;
    else if (parent.data_hash === hash)
      return { versionId: parent.id, seq: parent.seq, unchanged: true };
  }

  // `seq` is unique per song, and max()+1 is not atomic. One user saving from
  // two tabs is the realistic collision, so retry rather than serialize.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: top, error: seqErr } = await supabase
      .from("song_versions")
      .select("seq")
      .eq("song_id", input.songId)
      .order("seq", { ascending: false })
      .limit(1);
    if (seqErr) return { error: seqErr.message };
    const seq = (top?.[0]?.seq ?? 0) + 1;

    const { data: row, error } = await supabase
      .from("song_versions")
      .insert({
        song_id: input.songId,
        owner_id: input.ownerId,
        parent_id: parentId,
        data: input.data,
        data_hash: hash,
        seq,
        label: input.label ?? null,
      })
      .select("id")
      .single();
    if (!error) return { versionId: row.id, seq };
    if (!/duplicate key|unique/i.test(error.message)) return { error: error.message };
  }
  return { error: "Could not allocate a version number" };
}

// A free title for a name the USER DID NOT CHOOSE.
//
// `saveNamedSong` upserts by title, which is right when someone typed the name
// -- re-saving "my track" should be a new version of my track -- and wrong when
// the name was generated, because two unrelated sessions can land on the same
// two common words and merging them would be silent data loss. Generated names
// are therefore disambiguated instead: "cold squelch", "cold squelch 2".
//
// One bounded `in` query rather than a prefix `like`: no wildcard escaping to
// get subtly wrong, and no fetching an account's whole song list.
async function freeTitle(
  supabase: SupabaseClient,
  ownerId: string,
  base: string,
): Promise<string> {
  const candidates = [base, ...Array.from({ length: 24 }, (_, i) => `${base} ${i + 2}`)];
  const { data, error } = await supabase
    .from("songs")
    .select("title")
    .eq("owner_id", ownerId)
    .in("title", candidates);
  // A failed lookup is not worth failing a save over; the worst case is a
  // duplicate row in the list, which the user can rename.
  if (error) return base;
  const taken = new Set((data ?? []).map((r) => r.title as string));
  const free = candidates.find((c) => !taken.has(c));
  return (free ?? `${base} ${Date.now().toString(36)}`).slice(0, 200);
}

// Save the current song. Insert when no id, update in place when id is owned.
// Either way a version is appended: `parentVersionId` is the version being
// edited (the client's idea of where it is in the tree), defaulting to the
// song's current tip.
export async function saveSong(input: {
  id?: string;
  title: string;
  data: unknown;
  parentVersionId?: string | null;
  /** The title was generated for an unnamed song rather than typed. */
  titleGenerated?: boolean;
}): Promise<{
  id?: string;
  title?: string;
  versionId?: string;
  versionSeq?: number;
  unchanged?: boolean;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  let title = (input.title || "untitled").slice(0, 200);
  // Only the insert path: updating a song in place is not creating a name that
  // has to be free, it is keeping the one the song already has.
  if (input.titleGenerated && !input.id) title = await freeTitle(supabase, user.id, title);

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
      .select("id,current_version_id");
    if (error) return { error: error.message };
    if (!rows?.length) return { error: "Song not found" };

    const parentId =
      input.parentVersionId !== undefined
        ? input.parentVersionId
        : (rows[0].current_version_id as string | null);
    const ver = await appendVersion(supabase, {
      songId: input.id,
      ownerId: user.id,
      parentId,
      data: input.data,
    });
    if (ver.error) return { id: input.id, error: ver.error };
    await setCurrentVersion(supabase, input.id, user.id, ver.versionId!);
    return {
      id: input.id,
      title,
      versionId: ver.versionId,
      versionSeq: ver.seq,
      unchanged: ver.unchanged,
    };
  }

  const { data: row, error } = await supabase
    .from("songs")
    .insert({ owner_id: user.id, title, data: input.data })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const ver = await appendVersion(supabase, {
    songId: row.id,
    ownerId: user.id,
    parentId: null,
    data: input.data,
    label: "first save",
  });
  if (ver.error) return { id: row.id, title, error: ver.error };
  await setCurrentVersion(supabase, row.id, user.id, ver.versionId!);
  return { id: row.id, title, versionId: ver.versionId, versionSeq: ver.seq };
}

// Point a song at the version its `data` now mirrors. Failing this leaves the
// song correct and only the tip pointer stale, so it is not worth failing a
// save over -- the next save re-parents from whatever the client passes.
async function setCurrentVersion(
  supabase: SupabaseClient,
  songId: string,
  ownerId: string,
  versionId: string,
): Promise<void> {
  await supabase
    .from("songs")
    .update({ current_version_id: versionId })
    .eq("id", songId)
    .eq("owner_id", ownerId);
}

// Fork a public (or owned) song into the current user's account. The copy starts
// private and records its ancestry via forked_from. A fork starts a NEW tree
// rooted at the copied state: the source's history is the source owner's, and
// is not readable here anyway.
export async function forkSong(
  sourceId: string,
  sourceVersionId?: string,
): Promise<{ id?: string; title?: string; versionId?: string; error?: string }> {
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

  let data = src.data;
  let suffix = "fork";
  if (sourceVersionId) {
    // Only your own versions are readable, so this branch is the owner forking
    // a point in their own history into a separate song.
    const { data: ver, error: verErr } = await supabase
      .from("song_versions")
      .select("data,seq")
      .eq("id", sourceVersionId)
      .eq("song_id", sourceId)
      .maybeSingle();
    if (verErr) return { error: verErr.message };
    if (!ver) return { error: "Version not found" };
    data = ver.data;
    suffix = `v${ver.seq}`;
  }

  const title = `${src.title} (${suffix})`.slice(0, 200);
  const { data: row, error } = await supabase
    .from("songs")
    .insert({
      owner_id: user.id,
      title,
      data,
      forked_from: sourceId,
      is_public: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const ver = await appendVersion(supabase, {
    songId: row.id,
    ownerId: user.id,
    parentId: null,
    data,
    label: sourceVersionId ? `forked from ${suffix}` : "forked",
  });
  if (ver.error) return { id: row.id, title, error: ver.error };
  await setCurrentVersion(supabase, row.id, user.id, ver.versionId!);
  return { id: row.id, title, versionId: ver.versionId };
}

// Save the current session under a name, with an optional public toggle. Updates
// the existing same-named song for this user (so re-saving doesn't pile up dupes),
// otherwise inserts. When public, ensures a share slug and returns it.
export async function saveNamedSong(input: {
  title: string;
  data: unknown;
  isPublic: boolean;
  parentVersionId?: string | null;
  /** The title was generated for an unnamed song rather than typed, so it must
   *  not upsert onto an unrelated song that happens to share it. */
  titleGenerated?: boolean;
}): Promise<{
  id?: string;
  title?: string;
  slug?: string;
  versionId?: string;
  versionSeq?: number;
  unchanged?: boolean;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  let title = (input.title || "untitled").slice(0, 200);
  if (input.titleGenerated) title = await freeTitle(supabase, user.id, title);

  const { data: existingRows } = await supabase
    .from("songs")
    .select("id,share_slug,current_version_id")
    .eq("owner_id", user.id)
    .eq("title", title)
    .order("updated_at", { ascending: false })
    .limit(1);
  let id = existingRows?.[0]?.id as string | undefined;
  let slug = existingRows?.[0]?.share_slug as string | null | undefined;
  const head = existingRows?.[0]?.current_version_id as string | null | undefined;

  let versionId: string | undefined;
  let versionSeq: number | undefined;
  let unchanged: boolean | undefined;
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
    // This save is a step forward from wherever the caller was in the tree,
    // defaulting to the song's tip.
    const ver = await appendVersion(supabase, {
      songId: id,
      ownerId: user.id,
      parentId:
        input.parentVersionId !== undefined ? input.parentVersionId : (head ?? null),
      data: input.data,
    });
    if (ver.error) return { id, error: ver.error };
    versionId = ver.versionId;
    versionSeq = ver.seq;
    unchanged = ver.unchanged;
    await setCurrentVersion(supabase, id, user.id, versionId!);
  } else {
    const { data: row, error } = await supabase
      .from("songs")
      .insert({ owner_id: user.id, title, data: input.data })
      .select("id,share_slug")
      .single();
    if (error) return { error: error.message };
    id = row.id;
    slug = row.share_slug;
    const ver = await appendVersion(supabase, {
      songId: id!,
      ownerId: user.id,
      parentId: null,
      data: input.data,
      label: "first save",
    });
    if (ver.error) return { id, error: ver.error };
    versionId = ver.versionId;
    versionSeq = ver.seq;
    await setCurrentVersion(supabase, id!, user.id, versionId!);
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
    return { id, title, slug: slug ?? undefined, versionId, versionSeq, unchanged };
  }
  const { data: privRows, error: privErr } = await supabase
    .from("songs")
    .update({ is_public: false })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (privErr) return { error: privErr.message };
  if (!privRows?.length) return { error: "Song not found" };
  return { id, title, versionId, versionSeq, unchanged };
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
    .select(SONG_LIST_COLS)
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return { songs: [], error: error.message };
  return { songs: (data as SongListItem[]) ?? [] };
}

// Load a song's data. RLS allows the owner, or anyone if the song is public.
//
// `versionId` is the tip the data mirrors, and `owned` says whether saving on
// top of this song is even possible -- opening someone else's public song has
// to leave the studio pointing at no song at all, or the next save would try to
// write a row the caller does not own.
export async function loadSong(
  id: string,
): Promise<{
  title?: string;
  data?: unknown;
  versionId?: string | null;
  owned?: boolean;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("songs")
    .select("title,data,owner_id,current_version_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Song not found" };
  return {
    title: data.title,
    data: data.data,
    versionId: data.current_version_id as string | null,
    owned: !!user && data.owner_id === user.id,
  };
}

// The song's whole version tree, without the blobs. Parents are ids in this same
// list (or null for a root), so the caller builds the tree; nothing here assumes
// it has one shape.
export async function listVersions(
  songId: string,
): Promise<{ versions: SongVersion[]; currentId?: string | null; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { versions: [] };
  const { data, error } = await supabase
    .from("song_versions")
    .select("id,parent_id,seq,label,created_at")
    .eq("song_id", songId)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return { versions: [], error: error.message };
  const { data: song } = await supabase
    .from("songs")
    .select("current_version_id")
    .eq("id", songId)
    .eq("owner_id", user.id)
    .maybeSingle();
  return {
    versions: (data as SongVersion[]) ?? [],
    currentId: (song?.current_version_id as string | null) ?? null,
  };
}

// One version's session blob. Loading this and saving is what branches: the
// caller hands the id back as the next save's parentVersionId.
export async function loadVersion(
  versionId: string,
): Promise<{
  songId?: string;
  title?: string;
  seq?: number;
  data?: unknown;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data, error } = await supabase
    .from("song_versions")
    .select("song_id,seq,data")
    .eq("id", versionId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Version not found" };
  const { data: song } = await supabase
    .from("songs")
    .select("title")
    .eq("id", data.song_id)
    .maybeSingle();
  return {
    songId: data.song_id as string,
    title: song?.title as string | undefined,
    seq: data.seq as number,
    data: data.data,
  };
}

// Name a version ("before the breakdown"). The only mutable field on one --
// everything else about a version is what was saved, and rewriting that would
// make the history a lie.
export async function labelVersion(
  versionId: string,
  label: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const trimmed = label.trim().slice(0, 120);
  const { data: rows, error } = await supabase
    .from("song_versions")
    .update({ label: trimmed || null })
    .eq("id", versionId)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Version not found" };
  return { ok: true };
}

// Prune one version. Refused for the current tip and for any version with
// children: `parent_id` cascades, so deleting a version with a branch under it
// would take the branch with it, and this app has no undo.
export async function deleteVersion(
  versionId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: ver, error: readErr } = await supabase
    .from("song_versions")
    .select("id,song_id")
    .eq("id", versionId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!ver) return { error: "Version not found" };

  const { data: song } = await supabase
    .from("songs")
    .select("current_version_id")
    .eq("id", ver.song_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (song?.current_version_id === versionId)
    return { error: "That is the current version" };

  const { data: kids, error: kidErr } = await supabase
    .from("song_versions")
    .select("id")
    .eq("parent_id", versionId)
    .limit(1);
  if (kidErr) return { error: kidErr.message };
  if (kids?.length) return { error: "Delete the branches off it first" };

  const { data: rows, error } = await supabase
    .from("song_versions")
    .delete()
    .eq("id", versionId)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: error.message };
  if (!rows?.length) return { error: "Version not found" };
  return { ok: true };
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
