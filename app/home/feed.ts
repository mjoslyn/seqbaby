import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rankSongs } from "./rank";
import { patchEngineKey } from "./patchPreview";

// What the homepage shows of the people using the studio: the songs they have
// published and the patches they have put in the gallery, each ranked by
// likes and freshness together (rank.js), and who made them. Twelve of each.
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
  /** Hearts (migration 0016); 0 before that has run. */
  likes: number;
  owner: { handle: string | null; name: string; avatarGrid: string | null } | null;
  /** The step preview the database computes (migration 0012), or null before
   *  that migration has run -- the card then falls back to `fingerprint`. */
  preview: unknown;
};

export type FeedPerson = {
  handle: string;
  bio: string | null;
  avatarGrid: string | null;
  /** How many songs they have published. */
  songs: number;
};

export type FeedPatch = {
  id: string;
  name: string;
  /** The engine key it plays on (`custom` for a legacy Tone config). */
  engine: string;
  /** The patch's own `isDrumKit`, when it carries one. */
  drum: boolean | null;
  /** A sampler patch's sample id, which is often the only thing that says
   *  which drum it is. */
  sampleId: string | null;
  createdAt: string;
  /** Hearts (migration 0017); 0 before that has run. */
  likes: number;
  owner: FeedSong["owner"];
};

export type Feed = { songs: FeedSong[]; people: FeedPerson[]; patches: FeedPatch[] };

/** How many of each the homepage shows. */
export const FEED_SIZE = 12;

const EMPTY: Feed = { songs: [], people: [], patches: [] };

type Row = Record<string, unknown>;

/**
 * A select that asks for columns a later migration added (`preview` from
 * 0012, `avatar_grid` from 0014) and, if the database does not have them yet
 * -- PostgREST fails the whole query then -- asks again without. A feed with
 * fingerprints and generated avatars beats no feed at all.
 */
async function withOptional(
  run: (cols: string) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  base: string,
  optional: string,
): Promise<Row[] | null> {
  const first = await run(`${base},${optional}`);
  if (!first.error) return first.data;
  const second = await run(base);
  return second.error ? null : second.data;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function named(title: unknown): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t && t.toLowerCase() !== "untitled" ? t : "a song with no name";
}

/** Never throws: with no Supabase env, a table missing its migration or the
 *  network down, the homepage still renders, just with nothing in the feed. */
export async function loadFeed(limit = FEED_SIZE): Promise<Feed> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return EMPTY;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const [ranked, people, patches] = await Promise.all([
      rankedIds(supabase, limit),
      loadPeople(supabase, limit),
      loadPatches(supabase, limit),
    ]);
    if (!ranked.length) return { songs: [], people, patches };

    // `data->bpm` rather than `data`: a song's data is the whole session,
    // base64 samples included, and a card needs one number out of it.
    const found = await withOptional(
      (cols) =>
        supabase
          .from("songs")
          .select(cols)
          .in(
            "id",
            ranked.map((r) => r.id),
          )
          .returns<Row[]>(),
      "id,title,share_slug,updated_at,owner_id,bpm:data->bpm",
      "preview",
    );
    const byRowId = new Map<string, Row>((found ?? []).map((r) => [r.id as string, r]));
    const rows = ranked.flatMap((c) => {
      const r = byRowId.get(c.id);
      return r ? [{ row: r, likes: c.likes }] : [];
    });
    if (!rows.length) return { songs: [], people, patches };

    const byId = await owners(
      supabase,
      rows.map(({ row }) => row.owner_id as string),
    );

    const songs: FeedSong[] = rows.map(({ row: r, likes }) => ({
      id: r.id as string,
      title: named(r.title),
      slug: r.share_slug as string,
      bpm: typeof r.bpm === "number" ? Math.round(r.bpm) : null,
      updatedAt: r.updated_at as string,
      likes,
      owner: byId.get(r.owner_id as string) ?? null,
      preview: r.preview ?? null,
    }));

    return { songs, people, patches };
  } catch {
    return EMPTY;
  }
}

/** Who owns what, for the byline on a card: `profile_cards`, so a public song
 *  or patch by someone whose page is private is still attributed. */
async function owners(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, NonNullable<FeedSong["owner"]>>> {
  const byId = new Map<string, NonNullable<FeedSong["owner"]>>();
  const unique = [...new Set(ids)];
  if (!unique.length) return byId;
  const cards = await withOptional(
    (cols) => supabase.from("profile_cards").select(cols).in("id", unique).returns<Row[]>(),
    "id,username,display_name",
    "avatar_grid",
  );
  for (const c of cards ?? []) {
    // One name per person now (migration 0013); display_name is only the
    // fallback for a profile that has not been through that yet.
    const handle = str(c.username);
    const name = handle || str(c.display_name) || "";
    if (name) byId.set(c.id as string, { handle, name, avatarGrid: str(c.avatar_grid) });
  }
  return byId;
}

/**
 * The public gallery's patches, ranked like the songs (rank.js): likes and
 * freshness together, over a window of the newest. Freshness is `created_at`,
 * the clock the card's age reads. Never `config` itself -- a sampler patch
 * carries its sample as base64 -- only the few fields inside it that decide
 * what the card draws and plays (patchPreview.js); the card's play button
 * fetches the rest from /api/patch/<id> when pressed. A database without the
 * `likes` field (0017) ranks on freshness alone.
 */
async function loadPatches(supabase: SupabaseClient, limit: number): Promise<FeedPatch[]> {
  try {
    const data = await withOptional(
      (cols) =>
        supabase
          .from("patches")
          .select(cols)
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(CANDIDATES)
          .returns<Row[]>(),
      "id,name,created_at,owner_id,kind:config->>_kind,engine:config->>engineKey,drum:config->isDrumKit,sample:config->sampleSource->>id",
      "likes",
    );
    if (!data?.length) return [];
    const ranked = rankSongs(
      data.map((r) => ({
        r,
        updatedAt: r.created_at as string,
        likes: typeof r.likes === "number" ? r.likes : 0,
      })),
    ).slice(0, limit);
    const byId = await owners(
      supabase,
      ranked.map(({ r }) => r.owner_id as string),
    );
    return ranked.map(({ r, likes }) => ({
      id: r.id as string,
      name: str(r.name) ?? "a patch with no name",
      engine: patchEngineKey({ _kind: r.kind, engineKey: r.engine }),
      drum: typeof r.drum === "boolean" ? r.drum : null,
      sampleId: str(r.sample),
      createdAt: r.created_at as string,
      likes,
      owner: byId.get(r.owner_id as string) ?? null,
    }));
  } catch {
    return [];
  }
}

/** How far back the ranking looks. A song older than the newest this-many has
 *  to have been liked a great deal to outscore them (see rank.js's numbers),
 *  and ranking every public song ever would count every like ever. */
const CANDIDATES = 200;

/**
 * The ids to show, best first. Asks only for what the ranking needs -- no
 * preview, no bpm -- over a window of the newest published songs, then ranks
 * them in rank.js. A database without the `likes` field (0016) ranks on
 * freshness alone, which is what the homepage did before likes existed.
 */
async function rankedIds(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ id: string; likes: number }[]> {
  const rows = await withOptional(
    (cols) =>
      supabase
        .from("songs")
        .select(cols)
        .eq("is_public", true)
        .not("share_slug", "is", null)
        .order("updated_at", { ascending: false })
        .limit(CANDIDATES)
        .returns<Row[]>(),
    "id,updated_at",
    "likes",
  );
  const candidates = (rows ?? []).map((r) => ({
    id: r.id as string,
    updatedAt: r.updated_at as string,
    likes: typeof r.likes === "number" ? r.likes : 0,
  }));
  return rankSongs(candidates)
    .slice(0, limit)
    .map(({ id, likes }) => ({ id, likes }));
}

/**
 * Every public profile, whether or not they have published anything yet.
 * Every profile has a handle since migration 0013; the filter is for a
 * database that has not had it. Read from `profiles`, which anon may read only where
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
  show: number,
): Promise<FeedPerson[]> {
  // Read a wider window than is shown, then sort it: the busiest of the
  // newest 48, not the busiest of the newest twelve.
  const limit = Math.max(48, show);
  try {
    const profiles = await withOptional(
      (cols) =>
        supabase
          .from("profiles")
          .select(cols)
          .eq("is_public", true)
          .not("username", "is", null)
          .order("created_at", { ascending: false })
          .limit(limit)
          .returns<Row[]>(),
      "id,username,bio,created_at",
      "avatar_grid",
    );
    if (!profiles?.length) return [];

    const ids = profiles.map((p) => p.id as string);
    const { data: owned } = await supabase
      .from("songs")
      .select("owner_id")
      .eq("is_public", true)
      .in("owner_id", ids);
    const counts = new Map<string, number>();
    for (const r of owned ?? []) counts.set(r.owner_id as string, (counts.get(r.owner_id as string) ?? 0) + 1);

    return profiles
      .map((p, i) => ({
        order: i,
        person: {
          handle: p.username as string,
          bio: str(p.bio),
          avatarGrid: str(p.avatar_grid),
          songs: counts.get(p.id as string) ?? 0,
        },
      }))
      .sort((a, b) => b.person.songs - a.person.songs || a.order - b.order)
      .slice(0, show)
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
