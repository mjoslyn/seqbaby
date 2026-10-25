// Profiles: your own, and other people's public pages.
//
// What the database's policies held when this was Supabase (migration 0007):
// a private profile is readable by its owner only, and attribution (a handle
// and an avatar on a public song or patch) is readable for everyone, private
// page or not, but never the bio. Here that is which columns each query asks
// for: `profileCard` reads the attribution fields and nothing else.

import { all, bool, first, idList, isUnique, json, run } from "./db.js";
import { patchCardFields } from "./patches.js";
import { AVATAR_GRID_RE } from "../../app/profile/avatarGrid.js";

const USERNAME_RE = /^[a-z0-9_-]{2,30}$/i;
const PROFILE_COLS = "id, username, display_name, bio, avatar_url, avatar_grid, is_public, created_at";

const profileRow = (r) => (r ? { ...r, avatar_grid: r.avatar_grid ?? null, is_public: bool(r.is_public) } : null);

export async function getMyProfile(env, userId) {
  if (!userId) return null;
  return profileRow(await first(env.DB, `select ${PROFILE_COLS} from profiles where id = ?1`, userId));
}

/** Attribution: handle, name and avatar, for anyone (never the bio). */
export async function profileCards(env, ids) {
  if (!ids.length) return [];
  return all(
    env.DB,
    "select id, username, display_name, avatar_url, avatar_grid from profiles where id in (select value from json_each(?1))",
    idList(ids),
  );
}

export async function updateProfile(env, userId, input) {
  if (!userId) return { error: "not signed in" };
  const sets = [];
  const params = [];
  const set = (col, v) => {
    params.push(v);
    sets.push(`${col} = ?${params.length}`);
  };
  if (input.username !== undefined) {
    const u = String(input.username).trim();
    if (!USERNAME_RE.test(u)) return { error: "name: 2–30 chars, letters/numbers/-/_ only" };
    set("username", u);
    set("display_name", u);
  }
  if (input.bio !== undefined) set("bio", String(input.bio).trim().slice(0, 500) || null);
  if (input.avatar_url !== undefined) {
    const a = String(input.avatar_url).trim().slice(0, 500);
    // An https image or nothing: it is drawn on other people's screens.
    if (a && !/^https:\/\/[^\s]+$/i.test(a)) return { error: "avatar: an https:// image URL, or upload one" };
    set("avatar_url", a || null);
  }
  if (input.avatar_grid !== undefined) {
    if (input.avatar_grid !== null && !AVATAR_GRID_RE.test(input.avatar_grid))
      return { error: "that avatar is not a grid this app can draw" };
    set("avatar_grid", input.avatar_grid);
  }
  if (input.is_public !== undefined) set("is_public", input.is_public ? 1 : 0);
  if (!sets.length) return { ok: true };
  params.push(userId);
  try {
    const changed = await run(env.DB, `update profiles set ${sets.join(", ")} where id = ?${params.length}`, ...params);
    if (!changed) return { error: "profile not found" };
  } catch (e) {
    if (isUnique(e)) return { error: "that name is taken" };
    return { error: String(e?.message ?? e) };
  }
  return { ok: true };
}

/**
 * A profile page: the profile, and its public songs and patches. A private
 * page shows only to its owner; anyone else is told it is private (which
 * needs only the handle, the attribution half).
 */
export async function getPublicProfile(env, userId, username) {
  // Exact match on the folded handle, never a LIKE: `_` is a legal username
  // character and a LIKE wildcard.
  const handle = String(username).toLowerCase();
  const profile = profileRow(await first(env.DB, `select ${PROFILE_COLS} from profiles where username_lower = ?1`, handle));
  if (!profile) return { notFound: true };
  const isOwner = !!userId && userId === profile.id;
  if (!profile.is_public && !isOwner) return { private: true, username: profile.username ?? username };

  const [songRows, patchRows] = await Promise.all([
    all(
      env.DB,
      `select s.id, s.title, s.share_slug, s.updated_at, s.forked_from, s.preview,
              (select count(*) from song_likes l where l.song_id = s.id) as likes,
              exists (select 1 from songs src where src.id = s.forked_from and src.is_template = 1 and src.owner_id = s.owner_id) as from_template
         from songs s
        where s.owner_id = ?1 and s.is_public = 1
        order by s.updated_at desc`,
      profile.id,
    ),
    all(
      env.DB,
      `select p.id, p.name, p.engine_type, p.created_at, p.kind, p.engine_key, p.drum, p.sample,
              (select count(*) from patch_likes l where l.patch_id = p.id) as likes
         from patches p
        where p.owner_id = ?1 and p.is_public = 1
        order by p.created_at desc`,
      profile.id,
    ),
  ]);

  // Remix lineage, limited to sources the viewer can read (public or owned).
  const remixIds = [...new Set(songRows.filter((s) => !bool(s.from_template) && s.forked_from).map((s) => s.forked_from))];
  const lineage = new Map();
  if (remixIds.length) {
    const sources = await all(
      env.DB,
      `select s.id, s.title, p.username
         from songs s left join profiles p on p.id = s.owner_id
        where s.id in (select value from json_each(?1)) and (s.is_public = 1 or s.owner_id = ?2)`,
      idList(remixIds),
      userId ?? "",
    );
    for (const s of sources) lineage.set(s.id, { title: s.title, username: s.username ?? null });
  }

  return {
    profile,
    isOwner,
    songs: songRows.map((s) => ({
      id: s.id,
      title: s.title,
      share_slug: s.share_slug ?? null,
      updated_at: s.updated_at,
      forked_from: s.forked_from ?? null,
      preview: json(s.preview),
      likes: Number(s.likes) || 0,
      from_template: bool(s.from_template),
      remixedFrom: s.forked_from && !bool(s.from_template) ? (lineage.get(s.forked_from) ?? null) : null,
    })),
    patches: patchRows.map((p) => ({
      id: p.id,
      name: p.name,
      engine_type: p.engine_type ?? null,
      created_at: p.created_at,
      ...patchCardFields(p),
      likes: Number(p.likes) || 0,
    })),
  };
}
