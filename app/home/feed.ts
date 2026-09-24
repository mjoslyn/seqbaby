import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// What the homepage shows of the people using the studio: the songs they have
// published, newest first, and who made them.
//
// A plain anon client, not the cookie one in lib/supabase/server.ts, on
// purpose. Reading cookies makes a page dynamic, and the homepage is the one
// page everybody lands on: it is rendered once a minute (`revalidate` in
// page.tsx) and served from the cache in between. What it reads is public
// anyway -- `songs_public_read` for the rows, `profile_cards` for the names --
// so there is no session that could change the answer.

export type FeedSong = {
  id: string;
  title: string;
  slug: string;
  bpm: number | null;
  updatedAt: string;
  owner: { handle: string | null; name: string } | null;
};

export type FeedPerson = {
  handle: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  /** How many songs they have published. */
  songs: number;
};

export type Feed = { songs: FeedSong[]; people: FeedPerson[] };

const EMPTY: Feed = { songs: [], people: [] };

function named(title: unknown): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t && t.toLowerCase() !== "untitled" ? t : "a song with no name";
}

/** Never throws: with no Supabase env, a table missing its migration or the
 *  network down, the homepage still renders, just with nothing in the feed. */
export async function loadFeed(limit = 24): Promise<Feed> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return EMPTY;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    // `data->bpm` rather than `data`: a song's data is the whole session,
    // base64 samples included, and a card needs one number out of it.
    const [{ data: rows, error }, people] = await Promise.all([
      supabase
        .from("songs")
        .select("id,title,share_slug,updated_at,owner_id,bpm:data->bpm")
        .eq("is_public", true)
        .not("share_slug", "is", null)
        .order("updated_at", { ascending: false })
        .limit(limit),
      loadPeople(supabase),
    ]);
    if (error || !rows?.length) return { songs: [], people };

    const ownerIds = [...new Set(rows.map((r) => r.owner_id as string))];
    const { data: cards } = await supabase
      .from("profile_cards")
      .select("id,username,display_name")
      .in("id", ownerIds);
    const byId = new Map<string, { handle: string | null; name: string }>();
    for (const c of cards ?? []) {
      const handle = typeof c.username === "string" && c.username ? c.username : null;
      const name = handle || (typeof c.display_name === "string" && c.display_name) || "";
      if (name) byId.set(c.id as string, { handle, name });
    }

    const songs: FeedSong[] = rows.map((r) => ({
      id: r.id as string,
      title: named(r.title),
      slug: r.share_slug as string,
      bpm: typeof r.bpm === "number" ? Math.round(r.bpm) : null,
      updatedAt: r.updated_at as string,
      owner: byId.get(r.owner_id as string) ?? null,
    }));

    return { songs, people };
  } catch {
    return EMPTY;
  }
}

/**
 * Every public profile with a handle, whether or not they have published
 * anything yet. Read from `profiles`, which anon may read only where
 * `is_public` (migration 0007) -- the filter is repeated here so the list
 * does not depend on that policy to stay public-only. `bio` is on the
 * profile page already, so it is fine here; it is NOT on profile_cards, which
 * is why this is not that view.
 *
 * Ordered by how many songs they have published, then newest first, so the
 * people with something to hear come before the ones who just signed up.
 */
async function loadPeople(
  supabase: SupabaseClient,
  limit = 48,
): Promise<FeedPerson[]> {
  try {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id,username,display_name,bio,avatar_url,created_at")
      .eq("is_public", true)
      .not("username", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !profiles?.length) return [];

    const ids = profiles.map((p) => p.id as string);
    const { data: owned } = await supabase
      .from("songs")
      .select("owner_id")
      .eq("is_public", true)
      .in("owner_id", ids);
    const counts = new Map<string, number>();
    for (const r of owned ?? []) counts.set(r.owner_id as string, (counts.get(r.owner_id as string) ?? 0) + 1);

    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return profiles
      .map((p, i) => ({
        order: i,
        person: {
          handle: p.username as string,
          name: str(p.display_name) ?? (p.username as string),
          bio: str(p.bio),
          avatarUrl: str(p.avatar_url),
          songs: counts.get(p.id as string) ?? 0,
        },
      }))
      .sort((a, b) => b.person.songs - a.person.songs || a.order - b.order)
      .map((e) => e.person);
  } catch {
    return [];
  }
}

/** A song's fingerprint: four lanes of sixteen steps, hashed from its id. It
 *  is not the song's rhythm (that would mean reading the whole session) --
 *  just a face that stays the same every time the card is drawn. */
export function fingerprint(id: string): boolean[][] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  // Denser at the bottom (hats), sparser at the top (the kick), the way a beat
  // usually looks written down.
  const density = [0.28, 0.2, 0.55, 0.35];
  return density.map((d, lane) =>
    Array.from({ length: 16 }, (_, i) => (lane === 0 && i % 4 === 0 ? next() < 0.8 : next() < d)),
  );
}
