import { createClient } from "@supabase/supabase-js";

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

export type Feed = { songs: FeedSong[]; people: { handle: string; name: string; songs: number }[] };

const EMPTY: Feed = { songs: [], people: [] };

function named(title: unknown): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t && t.toLowerCase() !== "untitled" ? t : "a song with no name";
}

/** Never throws: with no Supabase env, a table missing its migration or the
 *  network down, the homepage still renders, just with nothing in the feed. */
export async function loadFeed(limit = 12): Promise<Feed> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return EMPTY;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    // `data->bpm` rather than `data`: a song's data is the whole session,
    // base64 samples included, and a card needs one number out of it.
    const { data: rows, error } = await supabase
      .from("songs")
      .select("id,title,share_slug,updated_at,owner_id,bpm:data->bpm")
      .eq("is_public", true)
      .not("share_slug", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error || !rows?.length) return EMPTY;

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

    // The people are whoever made the songs above, most prolific first. Only
    // those with a handle: a profile page is addressed by one.
    const counts = new Map<string, { handle: string; name: string; songs: number }>();
    for (const s of songs) {
      const h = s.owner?.handle;
      if (!h) continue;
      const e = counts.get(h) ?? { handle: h, name: s.owner!.name, songs: 0 };
      e.songs++;
      counts.set(h, e);
    }
    const people = [...counts.values()].sort((a, b) => b.songs - a.songs);
    return { songs, people };
  } catch {
    return EMPTY;
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
