import { cfEnv } from "@/lib/cf";
import { all, idList, json } from "@/lib/data/db.js";
import { rankSongs } from "./rank";
import { patchEngineKey } from "./patchPreview";

// What the homepage shows of the people using the studio: the songs they have
// published and the patches they have put in the gallery, each ranked by
// likes and freshness together (rank.js), and who made them. Four of each
// (FEED_SIZE, HOME_PATCHES); /songs, /people and /patches hold the rest.
//
// No session is read here, on purpose. Reading cookies makes a page dynamic,
// and the homepage is the one page everybody lands on: it is rendered once a
// minute (`revalidate` in page.tsx) and served from the cache in between.
// Everything it reads is public -- public songs and patches, and the handles
// and avatars that attribute them -- so no session could change the answer.

export type FeedSong = {
  id: string;
  title: string;
  slug: string;
  bpm: number | null;
  updatedAt: string;
  likes: number;
  owner: { handle: string | null; name: string; avatarGrid: string | null } | null;
  /** The step preview written with the song (app/songs/songPreview.js), or
   *  null -- the card then falls back to `fingerprint`. */
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
  likes: number;
  owner: FeedSong["owner"];
};

export type Feed = { songs: FeedSong[]; people: FeedPerson[]; patches: FeedPatch[] };

/** How many songs and people the homepage shows. The share card asks for
 *  its own count (app/api/og/home). */
export const FEED_SIZE = 4;
/** How many patches it shows; the gallery page has every one. */
export const HOME_PATCHES = 4;
/** How many of the newest public patches the gallery page ranks and lists. */
export const GALLERY_WINDOW = 600;

const EMPTY: Feed = { songs: [], people: [], patches: [] };

export type Row = Record<string, unknown>;

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function named(title: unknown): string {
  const t = typeof title === "string" ? title.trim() : "";
  return t && t.toLowerCase() !== "untitled" ? t : "a song with no name";
}

/** Never throws: with no database, or the network down, the homepage still
 *  renders, just with nothing in the feed. */
export async function loadFeed(limit = FEED_SIZE): Promise<Feed> {
  try {
    const db = (await cfEnv()).DB;
    const [ranked, people, patches] = await Promise.all([
      rankedIds(db, limit),
      loadPeople(db, limit),
      loadPatches(db, HOME_PATCHES),
    ]);
    if (!ranked.length) return { songs: [], people, patches };

    const found = await all(
      db,
      `select id, title, share_slug, updated_at, owner_id, bpm, preview
         from songs where id in (select value from json_each(?1)) and is_public = 1`,
      idList(ranked.map((r) => r.id)),
    );
    const byRowId = new Map<string, Row>(found.map((r: Row) => [r.id as string, r]));
    const rows = ranked.flatMap((c) => {
      const r = byRowId.get(c.id);
      return r ? [{ row: r, likes: c.likes }] : [];
    });
    if (!rows.length) return { songs: [], people, patches };

    const byId = await owners(
      db,
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
      preview: json(r.preview),
    }));

    return { songs, people, patches };
  } catch {
    return EMPTY;
  }
}

/** Who owns what, for the byline on a card: handle, name and avatar, which
 *  attribute a public song or patch even when its owner's page is private
 *  (never the bio). */
export async function owners(
  db: D1Database,
  ids: string[],
): Promise<Map<string, NonNullable<FeedSong["owner"]>>> {
  const byId = new Map<string, NonNullable<FeedSong["owner"]>>();
  const unique = [...new Set(ids)];
  if (!unique.length) return byId;
  const cards: Row[] = await all(
    db,
    "select id, username, display_name, avatar_grid from profiles where id in (select value from json_each(?1))",
    idList(unique),
  );
  for (const c of cards) {
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
 * carries its sample as base64 -- only the few fields read out of it on write
 * that decide what the card draws and plays (patchPreview.js); the card's play
 * button fetches the rest from /api/patch/<id> when pressed.
 */
async function loadPatches(db: D1Database, limit: number, window = CANDIDATES): Promise<FeedPatch[]> {
  try {
    const data: Row[] = await all(
      db,
      `select p.id, p.name, p.created_at, p.owner_id, p.kind, p.engine_key, p.drum, p.sample,
              (select count(*) from patch_likes l where l.patch_id = p.id) as likes
         from patches p where p.is_public = 1
        order by p.created_at desc limit ?1`,
      window,
    );
    if (!data.length) return [];
    const ranked = rankSongs(
      data.map((r) => ({
        r,
        updatedAt: r.created_at as string,
        likes: Number(r.likes) || 0,
      })),
    ).slice(0, limit);
    const byId = await owners(
      db,
      ranked.map(({ r }) => r.owner_id as string),
    );
    return ranked.map(({ r, likes }) => {
      const drum = json(r.drum);
      return {
        id: r.id as string,
        name: str(r.name) ?? "a patch with no name",
        engine: patchEngineKey({ _kind: r.kind, engineKey: r.engine_key }),
        drum: typeof drum === "boolean" ? drum : null,
        sampleId: str(r.sample),
        createdAt: r.created_at as string,
        likes,
        owner: byId.get(r.owner_id as string) ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** How far back the ranking looks. A song older than the newest this-many has
 *  to have been liked a great deal to outscore them (see rank.js's numbers),
 *  and ranking every public song ever would count every like ever. */
const CANDIDATES = 200;

/** The ids to show, best first: the newest published songs, ranked in rank.js. */
async function rankedIds(db: D1Database, limit: number): Promise<{ id: string; likes: number }[]> {
  const rows: Row[] = await all(
    db,
    `select s.id, s.updated_at, (select count(*) from song_likes l where l.song_id = s.id) as likes
       from songs s where s.is_public = 1 and s.share_slug is not null
      order by s.updated_at desc limit ?1`,
    CANDIDATES,
  );
  const candidates = rows.map((r) => ({
    id: r.id as string,
    updatedAt: r.updated_at as string,
    likes: Number(r.likes) || 0,
  }));
  return rankSongs(candidates)
    .slice(0, limit)
    .map(({ id, likes }) => ({ id, likes }));
}

/** How many public songs the people list counts over. */
const PEOPLE_SONGS = 1000;

/**
 * The people who have published something: every public profile with at least
 * one public song, busiest first, then whoever published most recently.
 * Starts from the songs, not the profiles, so an account with nothing to hear
 * never makes the list however new it is. Only public profiles: `bio` is on a
 * public profile page already, so it is fine here.
 */
async function loadPeople(db: D1Database, show: number): Promise<FeedPerson[]> {
  try {
    const owned: Row[] = await all(
      db,
      "select owner_id from songs where is_public = 1 order by updated_at desc limit ?1",
      PEOPLE_SONGS,
    );
    const counts = new Map<string, number>();
    const latest = new Map<string, number>(); // first seen is newest: the query is ordered
    for (const r of owned) {
      const id = r.owner_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!latest.has(id)) latest.set(id, latest.size);
    }
    if (!counts.size) return [];

    const profiles: Row[] = await all(
      db,
      `select id, username, bio, avatar_grid from profiles
        where is_public = 1 and id in (select value from json_each(?1))`,
      idList([...counts.keys()]),
    );

    return profiles
      .map((p) => {
        const id = p.id as string;
        return {
          recent: latest.get(id) ?? Infinity,
          person: {
            handle: p.username as string,
            bio: str(p.bio),
            avatarGrid: str(p.avatar_grid),
            songs: counts.get(id) ?? 0,
          },
        };
      })
      .sort((a, b) => b.person.songs - a.person.songs || a.recent - b.recent)
      .slice(0, show)
      .map((e) => e.person);
  } catch {
    return [];
  }
}

/**
 * The gallery page's patches (/patches): the newest GALLERY_WINDOW public
 * patches, ranked as the homepage ranks its four. The same never-throw rule as
 * loadFeed; the page is cached the same way.
 */
export async function loadPatchGallery(): Promise<FeedPatch[]> {
  try {
    return await loadPatches((await cfEnv()).DB, GALLERY_WINDOW, GALLERY_WINDOW);
  } catch {
    return [];
  }
}
