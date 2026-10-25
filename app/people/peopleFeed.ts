import { cfEnv } from "@/lib/cf";
import { all, idList, json } from "@/lib/data/db.js";
import { str, type Row } from "../home/feed";
import { patchEngineKey } from "../home/patchPreview";
import { gatherPeople, type Person } from "./people";

// What the people explorer (/people) starts from: everyone with a public
// profile who has published a song or a patch, with what the page searches,
// sorts and filters on. Read once per minute (`revalidate` in page.tsx), with
// no session read, for feed.ts's reasons; the rest is the browser's
// (people.js).
//
// Built from the published work, not from the profiles, for the homepage
// people list's reason: an account with nothing to hear never appears. Never
// `data` or `config`: a song's data and a sampler patch's config carry base64
// samples, and a person's card needs a bpm and an engine key out of them.

/** How many of the newest public songs, and of the newest public patches,
 *  the explorer counts over. Past it, the counts are of the recent ones. */
export const PEOPLE_WINDOW = 1000;

export type PeopleCatalog = { people: Person[]; hasInstruments: boolean };

/** Never throws, for loadFeed's reason: no database or no network is an empty
 *  explorer, not a failed page. */
export async function loadPeopleCatalog(): Promise<PeopleCatalog> {
  const empty = { people: [], hasInstruments: false };
  try {
    const db = (await cfEnv()).DB;
    const [songs, patches]: [Row[], Row[]] = await Promise.all([
      all(
        db,
        `select s.owner_id, s.updated_at, s.bpm, s.engines,
                (select count(*) from song_likes l where l.song_id = s.id) as likes
           from songs s where s.is_public = 1 and s.share_slug is not null
          order by s.updated_at desc limit ?1`,
        PEOPLE_WINDOW,
      ),
      all(
        db,
        `select p.owner_id, p.created_at, p.kind, p.engine_key,
                (select count(*) from patch_likes l where l.patch_id = p.id) as likes
           from patches p where p.is_public = 1
          order by p.created_at desc limit ?1`,
        PEOPLE_WINDOW,
      ),
    ]);
    const ids = [...new Set([...songs, ...patches].map((r) => r.owner_id as string))];
    if (!ids.length) return empty;
    const profiles = await publicProfiles(db, ids);
    const people = gatherPeople(
      songs.map((r) => ({
        owner: r.owner_id as string,
        bpm: r.bpm,
        likes: Number(r.likes) || 0,
        at: r.updated_at as string,
        engines: json(r.engines, []),
      })),
      patches.map((r) => ({
        owner: r.owner_id as string,
        likes: Number(r.likes) || 0,
        at: r.created_at as string,
        engine: patchEngineKey({ _kind: r.kind, engineKey: r.engine_key }),
      })),
      profiles,
    );
    return { people, hasInstruments: true };
  } catch {
    return empty;
  }
}

/** The public profiles among these ids, with the bio (public pages only). */
async function publicProfiles(
  db: D1Database,
  ids: string[],
): Promise<Map<string, { handle: string; bio: string | null; avatarGrid: string | null }>> {
  const rows: Row[] = await all(
    db,
    "select id, username, bio, avatar_grid from profiles where is_public = 1 and id in (select value from json_each(?1))",
    idList(ids),
  );
  const out = new Map<string, { handle: string; bio: string | null; avatarGrid: string | null }>();
  for (const p of rows) {
    const handle = str(p.username);
    if (handle) out.set(p.id as string, { handle, bio: str(p.bio), avatarGrid: str(p.avatar_grid) });
  }
  return out;
}
