import { createClient } from "@/lib/supabase/server";

// Not a server action file on purpose: this is read by generateMetadata, which
// runs on the server already, and nothing on the client should be able to ask
// the server to resolve arbitrary slugs to titles.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `untitled` is the column default — a song nobody named. Putting it on a card
// says less than the site's own title does, so it counts as no title at all.
// (A song saved through the studio gets a generated name instead; see
// app/songs/songName.js.)
function named(title: unknown): string | null {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t || t.toLowerCase() === "untitled") return null;
  return t;
}

/**
 * The title of the song a studio URL names — `?s=<slug>` (a share link) or
 * `?open=<id>` (a deep link) — or null when the URL names none, the song is
 * not readable by whoever is asking, or it was never named.
 */
export async function linkedSongTitle(
  slug: string | null,
  songId: string | null,
): Promise<string | null> {
  if (!slug && !songId) return null;
  try {
    const supabase = await createClient();
    if (slug) {
      // Same lookup as app/api/share/route.ts. A slug that resolves to nothing
      // is a legacy Netlify Blobs share — a bare session blob, with no title in
      // it — so there is nothing to show and the default card stands.
      const { data } = await supabase
        .from("songs")
        .select("title")
        .eq("share_slug", slug)
        .eq("is_public", true)
        .maybeSingle();
      return named(data?.title);
    }
    // A non-uuid would come back as a 400 from PostgREST; skip the round trip.
    if (!songId || !UUID.test(songId)) return null;
    // No is_public filter: RLS decides. A crawler is anonymous and sees only
    // published songs, while the owner following their own link gets the real
    // title in the tab.
    const { data } = await supabase
      .from("songs")
      .select("title")
      .eq("id", songId)
      .maybeSingle();
    return named(data?.title);
  } catch {
    // The engine is meant to run with no Supabase env at all, where creating
    // the client throws. A link preview is never worth failing the page over.
    return null;
  }
}
