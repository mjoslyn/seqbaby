"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_public: boolean;
  created_at: string;
};

export type ProfileSong = {
  id: string;
  title: string;
  share_slug: string | null;
  updated_at: string;
  forked_from: string | null;
  forkedFrom: { title: string; username: string | null } | null;
};
export type ProfilePatch = {
  id: string;
  name: string;
  engine_type: string | null;
  created_at: string;
};

export type PublicProfile =
  | { notFound: true }
  | { private: true; username: string }
  | {
      profile: Profile;
      isOwner: boolean;
      songs: ProfileSong[];
      patches: ProfilePatch[];
    };

const USERNAME_RE = /^[a-z0-9_-]{2,30}$/i;

export async function getMyProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,avatar_url,is_public,created_at")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function updateProfile(input: {
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  is_public?: boolean;
}): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const patch: Record<string, unknown> = {};
  if (input.username !== undefined) {
    const u = input.username.trim();
    if (u && !USERNAME_RE.test(u))
      return { error: "Username: 2–30 chars, letters/numbers/-/_ only" };
    patch.username = u || null;
  }
  if (input.display_name !== undefined)
    patch.display_name = input.display_name.trim().slice(0, 80) || null;
  if (input.bio !== undefined) patch.bio = input.bio.trim().slice(0, 500) || null;
  if (input.avatar_url !== undefined)
    patch.avatar_url = input.avatar_url.trim().slice(0, 500) || null;
  if (input.is_public !== undefined) patch.is_public = !!input.is_public;

  const { data: rows, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("id");
  if (error) {
    if (/duplicate key|unique/i.test(error.message))
      return { error: "That username is taken" };
    return { error: error.message };
  }
  // The signup trigger creates this row, so a miss here means it is genuinely
  // absent -- report that rather than a save that silently did nothing.
  if (!rows?.length) return { error: "Profile not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function getPublicProfile(
  username: string,
): Promise<PublicProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Exact match on the stored folded handle, never ILIKE: `_` and `%` are ILIKE
  // wildcards and `_` is a legal username character, so /u/a_c also matched
  // `abc` and then 404'd on maybeSingle's multi-row error, while /u/a%25 matched
  // every handle starting with "a". Equality on the generated column also means
  // the lookup uses profiles_username_lower_key instead of scanning the table.
  const handle = username.toLowerCase();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,username,display_name,bio,avatar_url,is_public,created_at")
    .eq("username_lower", handle)
    .maybeSingle();

  // A lookup that failed is not the same answer as "no such user". Reporting one
  // as the other is what hid the duplicate-handle breakage in the first place.
  if (error) throw new Error(`Profile lookup failed: ${error.message}`);

  if (!profile) {
    // Empty means one of two different things, and the page says different
    // things about them: no such handle, or a private profile the RLS policy
    // withheld. profile_cards carries display fields for every profile and no
    // private ones, so it distinguishes them -- which is what keeps "This
    // profile is private" on the page instead of a bare 404.
    const { data: card, error: cardErr } = await supabase
      .from("profile_cards")
      .select("username")
      .eq("username_lower", handle)
      .maybeSingle();
    // 42P01 is "relation does not exist" -- 0007 has not been applied yet. In
    // that world the policy from 0001 is still in force, so a private profile
    // came back from the query above and is caught below; reaching here means
    // the handle really is unused. Tolerating it keeps this file correct on
    // either side of the migration, rather than turning every 404 into a 500
    // during the window. (Same tactic as api/share/route.ts.)
    if (cardErr && cardErr.code !== "42P01")
      throw new Error(`Profile lookup failed: ${cardErr.message}`);
    if (!card) return { notFound: true };
    return { private: true, username: card.username ?? username };
  }

  const isOwner = !!user && user.id === profile.id;
  // Unreachable once 0007 is applied -- the policy already withheld the row.
  // Kept deliberately: it means this file is correct whether or not the
  // migration has run, so the deploy is safe in either order, and it is the
  // second lock on a door that should not have been relying on one.
  if (!profile.is_public && !isOwner)
    return { private: true, username: profile.username ?? username };

  const [{ data: songs }, { data: patches }] = await Promise.all([
    supabase
      .from("songs")
      .select("id,title,share_slug,updated_at,forked_from")
      .eq("owner_id", profile.id)
      .eq("is_public", true)
      .order("updated_at", { ascending: false }),
    supabase
      .from("patches")
      .select("id,name,engine_type,created_at")
      .eq("owner_id", profile.id)
      .eq("is_public", true)
      .order("created_at", { ascending: false }),
  ]);

  // Resolve fork lineage (source title + author handle) for any forked sessions,
  // limited to sources the viewer can read (public or owned).
  const songRows = (songs ?? []) as Omit<ProfileSong, "forkedFrom">[];
  const forkIds = [
    ...new Set(songRows.map((s) => s.forked_from).filter(Boolean)),
  ] as string[];
  const lineage = new Map<string, { title: string; username: string | null }>();
  if (forkIds.length) {
    const { data: sources } = await supabase
      .from("songs")
      .select("id,title,owner_id")
      .in("id", forkIds);
    const ownerIds = [...new Set((sources ?? []).map((s) => s.owner_id))];
    const handles = new Map<string, string | null>();
    if (ownerIds.length) {
      // profile_cards, not profiles: a public song forked from someone whose
      // own page is private should still say who wrote it.
      const { data: profs } = await supabase
        .from("profile_cards")
        .select("id,username")
        .in("id", ownerIds);
      for (const p of profs ?? []) handles.set(p.id, p.username);
    }
    for (const s of sources ?? [])
      lineage.set(s.id, {
        title: s.title,
        username: handles.get(s.owner_id) ?? null,
      });
  }

  return {
    profile: profile as Profile,
    isOwner,
    songs: songRows.map((s) => ({
      ...s,
      forkedFrom: s.forked_from ? (lineage.get(s.forked_from) ?? null) : null,
    })),
    patches: (patches as ProfilePatch[]) ?? [],
  };
}
