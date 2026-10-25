import { cfEnv } from "@/lib/cf";
import { first, json } from "@/lib/data/db.js";
import { getShare, getShareMeta } from "@/lib/data/shares.js";
import { previewFromSession } from "@/app/songs/songPreview";

// What a link preview image needs to know, looked up for /api/og.
//
// No session read: whoever fetches a preview image is a crawler with no
// session, and the answer must be the one a crawler is allowed -- published
// songs and public display fields, nothing else. The same reasoning as
// app/home/feed.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-z0-9_-]{2,30}$/i;
const SLUG = /^[A-Za-z0-9_-]{4,64}$/;

type Row = Record<string, unknown>;
export type CardPerson = { handle: string; grid: string | null };
export type SongCard = { title: string; owner: CardPerson | null; bpm: number | null; preview: unknown };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function named(title: unknown): string | null {
  const t = str(title);
  return t && t.toLowerCase() !== "untitled" ? t : null;
}

/** A person, by id or by handle: attribution fields only, never the bio. */
async function person(db: D1Database, by: { id?: unknown; handle?: string }): Promise<CardPerson | null> {
  if (!by.handle && !(typeof by.id === "string" && UUID.test(by.id))) return null;
  const row: Row | null = by.handle
    ? await first(db, "select username, display_name, avatar_grid from profiles where username_lower = ?1", by.handle.toLowerCase())
    : await first(db, "select username, display_name, avatar_grid from profiles where id = ?1", by.id);
  const handle = str(row?.username) ?? str(row?.display_name);
  return handle ? { handle, grid: str(row?.avatar_grid) } : null;
}

/** The song a share link (`s`) or a deep link (`open`) names, or null. */
export async function songCard(slug: string | null, openId: string | null): Promise<SongCard | null> {
  if (slug && !SLUG.test(slug)) return null;
  if (!slug && !(openId && UUID.test(openId))) return null;
  try {
    const env = await cfEnv();
    const row: Row | null = slug
      ? await first(env.DB, "select title, owner_id, bpm, preview from songs where share_slug = ?1 and is_public = 1", slug)
      : await first(env.DB, "select title, owner_id, bpm, preview from songs where id = ?1 and is_public = 1", openId);
    const title = named(row?.title);
    if (row && title) {
      return {
        title,
        owner: await person(env.DB, { id: row.owner_id }).catch(() => null),
        bpm: typeof row.bpm === "number" ? Math.round(row.bpm) : null,
        preview: json(row.preview),
      };
    }
    if (!slug) return null;
    // A quick anonymous share: a session in R2, never in the songs table, so
    // its preview is computed here from the session itself.
    const meta = await getShareMeta(env, slug).catch(() => null);
    const body = (await getShare(env, slug).catch(() => null)) as Row | null;
    if (!body) return null;
    const session = (body.session ?? body) as Row;
    const shareTitle = named(meta?.title) ?? "a song";
    return {
      title: shareTitle,
      owner: await person(env.DB, { id: meta?.ownerId }).catch(() => null),
      bpm: typeof session.bpm === "number" ? Math.round(session.bpm) : null,
      preview: previewFromSession(session),
    };
  } catch {
    return null;
  }
}

/** A jam invite's host, from the handle the link carries -- only once it is
 *  found among the profiles, for the reason jamHostName gives. */
export async function jamHost(by: string | null): Promise<CardPerson | null> {
  if (!by || !HANDLE.test(by)) return null;
  try {
    return await person((await cfEnv()).DB, { handle: by });
  } catch {
    return null;
  }
}
