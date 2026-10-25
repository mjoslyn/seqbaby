import { cfEnv } from "@/lib/cf";
import { all, json } from "@/lib/data/db.js";
import { named, owners, type FeedSong, type Row } from "../home/feed";
import { instrumentsOf } from "./explore";

// What the songs explorer (/songs) starts from: the newest published songs,
// each with what the page searches, sorts and filters on. Read once per
// minute (`revalidate` in page.tsx), with no session read, for feed.ts's
// reasons; everything after that happens in the browser (explore.js).
//
// Never `data`: a song's data is the whole session, samples included. The bpm,
// the engines and the picture are columns written with the song
// (lib/data/songs.js songColumns); the hearts are counted here.

export type ExploreSong = FeedSong & {
  /** The instruments it is made of (explore.js `instrumentOf`), sorted. */
  instruments: string[];
};

/** How many of the newest published songs the explorer holds. Enough to be
 *  every song for a long while; past it, the newest this-many. */
export const EXPLORE_WINDOW = 600;

export type ExploreCatalog = { songs: ExploreSong[]; hasInstruments: boolean; now: number };

/** Never throws, for loadFeed's reason: no env or no network is an empty
 *  explorer, not a failed page. */
export async function loadExplore(): Promise<ExploreCatalog> {
  const now = Date.now();
  try {
    const db = (await cfEnv()).DB;
    const rows: Row[] = await all(
      db,
      `select s.id, s.title, s.share_slug, s.updated_at, s.owner_id, s.bpm, s.preview, s.engines,
              (select count(*) from song_likes l where l.song_id = s.id) as likes
         from songs s where s.is_public = 1 and s.share_slug is not null
        order by s.updated_at desc limit ?1`,
      EXPLORE_WINDOW,
    );
    if (!rows.length) return { songs: [], hasInstruments: false, now };
    const byId = await owners(
      db,
      rows.map((r) => r.owner_id as string),
    );
    const songs = rows.map((r) => ({
      id: r.id as string,
      title: named(r.title),
      slug: r.share_slug as string,
      bpm: typeof r.bpm === "number" && r.bpm > 0 ? Math.round(r.bpm) : null,
      updatedAt: r.updated_at as string,
      likes: Number(r.likes) || 0,
      owner: byId.get(r.owner_id as string) ?? null,
      preview: json(r.preview),
      instruments: instrumentsOf(json(r.engines, [])),
    }));
    return { songs, hasInstruments: true, now };
  } catch {
    return { songs: [], hasInstruments: false, now };
  }
}
