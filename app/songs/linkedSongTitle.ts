import { cache } from "react";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { first } from "@/lib/data/db.js";
import { getShareMeta } from "@/lib/data/shares.js";

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
 * The name to put on a card for one profile: attribution fields only, which a
 * public song by someone whose own page is private still gets. Null when the
 * profile has no name to show.
 */
export async function ownerName(db: D1Database, ownerId: unknown): Promise<string | null> {
  return (await ownerCard(db, ownerId))?.name ?? null;
}

type OwnerCard = { name: string; handle: string | null; avatarGrid: string | null };

/** ownerName's lookup, with the handle and avatar the studio's byline draws. */
async function ownerCard(db: D1Database, ownerId: unknown): Promise<OwnerCard | null> {
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return null;
  const row = await first(db, "select username, display_name, avatar_grid from profiles where id = ?1", ownerId);
  const name = cardName(row);
  if (!name) return null;
  const handle = typeof row?.username === "string" && row.username.trim() ? row.username.trim() : null;
  const grid = typeof row?.avatar_grid === "string" ? row.avatar_grid : null;
  return { name, handle, avatarGrid: grid };
}

export type LinkedSong = {
  /** The song's title, never `untitled`. */
  title: string;
  /** Whose it is, or null when that could not be resolved. */
  owner: string | null;
};

/** What the studio's byline needs (app/SongByline.tsx): linkedSong's answer
 *  plus who, as a link and a face, and the song's row for the heart. */
export type LinkedSongCard = LinkedSong & {
  /** The songs row, or null for a quick anonymous share (no row, no heart). */
  songId: string | null;
  ownerId: string | null;
  ownerHandle: string | null;
  ownerAvatarGrid: string | null;
  likes: number;
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
  const card = await linkedSongCard(slug, songId);
  return card ? { title: card.title, owner: card.owner } : null;
}

/** linkedSong, with everything the studio's byline draws. One lookup for
 *  both, so the tab's title and the byline under it cannot disagree. */
// Cached per request: generateMetadata (the tab's title) and the account
// bar (the byline) both ask, and should cost one lookup between them.
export const linkedSongCard = cache(async function linkedSongCard(
  slug: string | null,
  songId: string | null,
): Promise<LinkedSongCard | null> {
  if (!slug && !songId) return null;
  try {
    const env = await cfEnv();
    const db = env.DB;
    type SongRow = { id?: unknown; title?: unknown; owner_id?: unknown; likes?: unknown };
    const COLS = "id, title, owner_id, (select count(*) from song_likes l where l.song_id = songs.id) as likes";
    let row: SongRow | null = null;
    if (slug) {
      // Same lookup as app/api/share/route.ts.
      row = await first(db, `select ${COLS} from songs where share_slug = ?1 and is_public = 1`, slug);
    } else {
      if (!songId || !UUID.test(songId)) return null;
      // A crawler is anonymous and sees only published songs, while the owner
      // following their own link gets the real title in the tab.
      row = await first(
        db,
        `select ${COLS} from songs where id = ?1 and (is_public = 1 or owner_id = ?2)`,
        songId,
        (await currentUserId()) ?? "",
      );
    }
    const title = named(row?.title);
    if (title) {
      let owner: OwnerCard | null = null;
      try {
        owner = await ownerCard(db, row?.owner_id);
      } catch {
        // The title is enough for a card; the name is the better half of it,
        // not the whole of it.
      }
      return {
        title,
        owner: owner?.name ?? null,
        songId: typeof row?.id === "string" ? row.id : null,
        ownerId: typeof row?.owner_id === "string" ? row.owner_id : null,
        ownerHandle: owner?.handle ?? null,
        ownerAvatarGrid: owner?.avatarGrid ?? null,
        likes: Number(row?.likes) || 0,
      };
    }
    if (!slug) return null;
    // A slug that names no published song may still be a quick, anonymous
    // share (the studio's own `share` button, lib/data/shares.js), which
    // carries a title and, for a signed-in sharer, an owner id. Metadata
    // only: never pull the whole session down just to learn its name.
    const meta = await getShareMeta(env, slug);
    const shareTitle = named(meta?.title);
    if (!shareTitle) return null;
    let shareOwner: OwnerCard | null = null;
    if (meta?.ownerId) {
      try {
        shareOwner = await ownerCard(db, meta.ownerId);
      } catch {
        /* same tradeoff as above */
      }
    }
    return {
      title: shareTitle,
      owner: shareOwner?.name ?? null,
      songId: null,
      ownerId: typeof meta?.ownerId === "string" ? meta.ownerId : null,
      ownerHandle: shareOwner?.handle ?? null,
      ownerAvatarGrid: shareOwner?.avatarGrid ?? null,
      likes: 0,
    };
  } catch {
    // A link preview is never worth failing the page over.
    return null;
  }
});

/**
 * The name on a jam invite's card. A jam room is a Durable Object holding
 * WebSockets and nothing else -- no row anywhere says who started it -- so
 * the invite link carries the host's handle (`?jam=<room>&by=<handle>`,
 * written by JamPanel.tsx for a signed-in host). Anyone can type a URL, so
 * the handle is only ever put on a card once it has been found among the
 * profiles: the worst a made-up one can do is name nobody, and the card then
 * says "Someone". Null when there is no such handle.
 */
export async function jamHostName(by: string | null): Promise<string | null> {
  if (!by || !HANDLE.test(by)) return null;
  try {
    const db = (await cfEnv()).DB;
    return cardName(await first(db, "select username, display_name from profiles where username_lower = ?1", by.toLowerCase()));
  } catch {
    return null;
  }
}
