import { createClient } from "@/lib/supabase/server";
import { getShareMeta } from "@/lib/api.js";

// Not a server action file on purpose: this is read by generateMetadata, which
// runs on the server already, and nothing on the client should be able to ask
// the server to resolve arbitrary slugs to titles, or arbitrary handles to
// whether they exist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A handle as profile/actions.ts accepts one (USERNAME_RE there). Anything
// else is not a handle and is not worth a round trip -- or a place on a card.
const HANDLE = /^[a-z0-9_-]{2,30}$/i;

// `untitled` is the column default — a song nobody named. Putting it on a card
// says less than the site's own title does, so it counts as no title at all.
// (A song saved through the studio gets a generated name instead; see
// app/songs/songName.js.)
function named(title: unknown): string | null {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t || t.toLowerCase() === "untitled") return null;
  return t;
}

/** What a card calls a person: their handle, or the display name of an
 *  account that has not picked one. Null when neither is set. */
function cardName(card: { username?: unknown; display_name?: unknown } | null): string | null {
  const u = typeof card?.username === "string" ? card.username.trim() : "";
  if (u) return u;
  const d = typeof card?.display_name === "string" ? card.display_name.trim() : "";
  return d || null;
}

/**
 * The name to put on a card for one profile, read from `profile_cards` --
 * the attribution view, not the profiles table, for the reason the profile
 * page reads it: a public song by someone whose own page is private is still
 * theirs. Null when the view is missing (migration 0007 not applied yet) or
 * the profile has no name to show.
 */
export async function ownerName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: unknown,
): Promise<string | null> {
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return null;
  const { data } = await supabase
    .from("profile_cards")
    .select("username,display_name")
    .eq("id", ownerId)
    .maybeSingle();
  return cardName(data);
}

export type LinkedSong = {
  /** The song's title, never `untitled`. */
  title: string;
  /** Whose it is, or null when that could not be resolved. */
  owner: string | null;
};

/**
 * The song a studio URL names — `?s=<slug>` (a share link) or `?open=<id>`
 * (a deep link) — as its title plus its owner's name, or null when the URL
 * names none, the song is not readable by whoever is asking, or it was never
 * named. The owner is looked up second and separately: a song with a title
 * and no resolvable owner is still a song worth a card.
 */
export async function linkedSong(
  slug: string | null,
  songId: string | null,
): Promise<LinkedSong | null> {
  if (!slug && !songId) return null;
  try {
    const supabase = await createClient();
    let row: { title?: unknown; owner_id?: unknown } | null = null;
    if (slug) {
      // Same lookup as app/api/share/route.ts.
      const { data } = await supabase
        .from("songs")
        .select("title,owner_id")
        .eq("share_slug", slug)
        .eq("is_public", true)
        .maybeSingle();
      row = data;
    } else {
      // A non-uuid would come back as a 400 from PostgREST; skip the round trip.
      if (!songId || !UUID.test(songId)) return null;
      // No is_public filter: RLS decides. A crawler is anonymous and sees only
      // published songs, while the owner following their own link gets the real
      // title in the tab.
      const { data } = await supabase
        .from("songs")
        .select("title,owner_id")
        .eq("id", songId)
        .maybeSingle();
      row = data;
    }
    const title = named(row?.title);
    if (title) {
      let owner: string | null = null;
      try {
        owner = await ownerName(supabase, row?.owner_id);
      } catch {
        // The title is enough for a card; the name is the better half of it,
        // not the whole of it.
      }
      return { title, owner };
    }
    if (!slug) return null;
    // A slug that names no published song may still be a quick, anonymous
    // share (lib/api.js's Blobs store, behind the studio's own `share`
    // button) rather than a legacy one with nothing worth showing — those
    // carry a generated title and, for a signed-in sharer, an owner id
    // (see putShare). Metadata only: never pull the whole session down just
    // to learn its name.
    const meta = await getShareMeta({ id: slug });
    const shareTitle = named(meta?.title);
    if (!shareTitle) return null;
    let shareOwner: string | null = null;
    if (meta?.ownerId) {
      try {
        shareOwner = await ownerName(supabase, meta.ownerId);
      } catch {
        /* same tradeoff as above */
      }
    }
    return { title: shareTitle, owner: shareOwner };
  } catch {
    // The engine is meant to run with no Supabase env at all, where creating
    // the client throws. A link preview is never worth failing the page over.
    return null;
  }
}

/**
 * The name on a jam invite's card. A jam room is a Realtime channel and
 * nothing else -- no row anywhere says who started it -- so the invite link
 * carries the host's handle (`?jam=<room>&by=<handle>`, written by
 * JamPanel.tsx for a signed-in host). Anyone can type a URL, so the handle is
 * only ever put on a card once it has been found in `profile_cards`: the
 * worst a made-up one can do is name nobody, and the card then says
 * "Someone". Null when there is no such handle, or no Supabase to ask.
 */
export async function jamHostName(by: string | null): Promise<string | null> {
  if (!by || !HANDLE.test(by)) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profile_cards")
      .select("username,display_name")
      .eq("username_lower", by.toLowerCase())
      .maybeSingle();
    return cardName(data);
  } catch {
    return null;
  }
}
