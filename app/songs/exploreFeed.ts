import { createClient } from "@supabase/supabase-js";
import { named, owners, withOptional, type FeedSong, type Row } from "../home/feed";
import { instrumentsOf } from "./explore";

// What the songs explorer (/songs) starts from: the newest published songs,
// each with what the page searches, sorts and filters on. Read once per
// minute (`revalidate` in page.tsx) with a plain anon client, for feed.ts's
// reasons; everything after that happens in the browser (explore.js).
//
// Never `data`: a song's data is the whole session, samples included. The bpm
// is `data->bpm`, the engines are the `engines` computed field (0019), the
// picture is `preview` (0012), the hearts are `likes` (0016). A database
// missing a later one of those loses that column, not the page.

export type ExploreSong = FeedSong & {
  /** The instruments it is made of (explore.js `instrumentOf`), sorted. Empty
   *  before 0019, when the page hides the instrument filter. */
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { songs: [], hasInstruments: false, now };
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const rows = await withOptional(
      (cols) =>
        supabase
          .from("songs")
          .select(cols)
          .eq("is_public", true)
          .not("share_slug", "is", null)
          .order("updated_at", { ascending: false })
          .limit(EXPLORE_WINDOW)
          .returns<Row[]>(),
      "id,title,share_slug,updated_at,owner_id,bpm:data->bpm",
      ["likes,preview,engines", "likes,preview", "preview"],
    );
    if (!rows?.length) return { songs: [], hasInstruments: false, now };
    const byId = await owners(
      supabase,
      rows.map((r) => r.owner_id as string),
    );
    const hasInstruments = rows.some((r) => Array.isArray(r.engines));
    const songs = rows.map((r) => ({
      id: r.id as string,
      title: named(r.title),
      slug: r.share_slug as string,
      bpm: typeof r.bpm === "number" && r.bpm > 0 ? Math.round(r.bpm) : null,
      updatedAt: r.updated_at as string,
      likes: typeof r.likes === "number" ? r.likes : 0,
      owner: byId.get(r.owner_id as string) ?? null,
      preview: r.preview ?? null,
      instruments: instrumentsOf(r.engines),
    }));
    return { songs, hasInstruments, now };
  } catch {
    return { songs: [], hasInstruments: false, now };
  }
}
