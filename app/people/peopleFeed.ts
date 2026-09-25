import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { str, withOptional, type Row } from "../home/feed";
import { patchEngineKey } from "../home/patchPreview";
import { gatherPeople, type Person } from "./people";

// What the people explorer (/people) starts from: everyone with a public
// profile who has published a song or a patch, with what the page searches,
// sorts and filters on. Read once per minute (`revalidate` in page.tsx) with a
// plain anon client, for feed.ts's reasons; the rest is the browser's
// (people.js).
//
// Built from the published work, not from the profiles, for the homepage
// people list's reason: an account with nothing to hear never appears. Never
// `data` or `config`: a song's data and a sampler patch's config carry base64
// samples, and a person's card needs a bpm and an engine key out of them.

/** How many of the newest public songs, and of the newest public patches,
 *  the explorer counts over. Past it, the counts are of the recent ones. */
export const PEOPLE_WINDOW = 1000;

export type PeopleCatalog = { people: Person[]; hasInstruments: boolean; now: number };

/** How many profile ids go in one `in` filter (owners() in feed.ts, same reason). */
const ID_SLICE = 100;

/** Never throws, for loadFeed's reason: no env or no network is an empty
 *  explorer, not a failed page. */
export async function loadPeopleCatalog(): Promise<PeopleCatalog> {
  const now = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const empty = { people: [], hasInstruments: false, now };
  if (!url || !key) return empty;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const [songs, patches] = await Promise.all([
      withOptional(
        (cols) =>
          supabase
            .from("songs")
            .select(cols)
            .eq("is_public", true)
            .not("share_slug", "is", null)
            .order("updated_at", { ascending: false })
            .limit(PEOPLE_WINDOW)
            .returns<Row[]>(),
        "owner_id,updated_at,bpm:data->bpm",
        ["likes,engines", "likes"],
      ),
      withOptional(
        (cols) =>
          supabase
            .from("patches")
            .select(cols)
            .eq("is_public", true)
            .order("created_at", { ascending: false })
            .limit(PEOPLE_WINDOW)
            .returns<Row[]>(),
        "owner_id,created_at,kind:config->>_kind,engine:config->>engineKey",
        "likes",
      ),
    ]);
    const ids = [...new Set([...(songs ?? []), ...(patches ?? [])].map((r) => r.owner_id as string))];
    if (!ids.length) return empty;
    const profiles = await publicProfiles(supabase, ids);
    const people = gatherPeople(
      (songs ?? []).map((r) => ({
        owner: r.owner_id as string,
        bpm: r.bpm,
        likes: r.likes as number | undefined,
        at: r.updated_at as string,
        engines: r.engines,
      })),
      (patches ?? []).map((r) => ({
        owner: r.owner_id as string,
        likes: r.likes as number | undefined,
        at: r.created_at as string,
        engine: patchEngineKey({ _kind: r.kind, engineKey: r.engine }),
      })),
      profiles,
    );
    // Before 0019 a song names no engines, so only patches would fill the
    // chips: a filter that ignores most of the work is worse than none.
    const hasInstruments = (songs ?? []).some((r) => Array.isArray(r.engines));
    if (!hasInstruments) for (const p of people) p.instruments = [];
    return { people, hasInstruments, now };
  } catch {
    return empty;
  }
}

/**
 * The public profiles among these ids, from `profiles` (bio is there and not
 * on profile_cards, which must not carry it). `is_public` is filtered here as
 * well as by the RLS policy, so the list does not lean on the policy alone.
 */
async function publicProfiles(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, { handle: string; bio: string | null; avatarGrid: string | null }>> {
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_SLICE) slices.push(ids.slice(i, i + ID_SLICE));
  const rows = (
    await Promise.all(
      slices.map((slice) =>
        withOptional(
          (cols) =>
            supabase
              .from("profiles")
              .select(cols)
              .eq("is_public", true)
              .not("username", "is", null)
              .in("id", slice)
              .returns<Row[]>(),
          "id,username,bio",
          "avatar_grid",
        ),
      ),
    )
  ).flatMap((r) => r ?? []);
  const out = new Map<string, { handle: string; bio: string | null; avatarGrid: string | null }>();
  for (const p of rows) {
    const handle = str(p.username);
    if (handle) out.set(p.id as string, { handle, bio: str(p.bio), avatarGrid: str(p.avatar_grid) });
  }
  return out;
}
