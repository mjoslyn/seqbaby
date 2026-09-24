import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getShare, getShareMeta } from "@/lib/api.js";
import { previewFromSession } from "@/app/songs/songPreview";

// What a link preview image needs to know, looked up for /api/og.
//
// A plain anon client, not the cookie one: whoever fetches a preview image is
// a crawler with no session, and the answer must be the one a crawler is
// allowed -- published songs and public display fields, nothing else. The
// same reasoning as app/home/feed.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-z0-9_-]{2,30}$/i;
const SLUG = /^[A-Za-z0-9_-]{4,64}$/;

type Row = Record<string, unknown>;
export type CardPerson = { handle: string; grid: string | null };
export type SongCard = { title: string; owner: CardPerson | null; bpm: number | null; preview: unknown };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function anon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

function named(title: unknown): string | null {
  const t = str(title);
  return t && t.toLowerCase() !== "untitled" ? t : null;
}

/** A person, by id or by handle, from profile_cards. The grid is migration
 *  0014's; asked of a database without it, the select is retried without. */
async function person(supabase: SupabaseClient, by: { id?: unknown; handle?: string }): Promise<CardPerson | null> {
  const run = (cols: string) => {
    const q = supabase.from("profile_cards").select(cols);
    return (by.handle ? q.eq("username_lower", by.handle.toLowerCase()) : q.eq("id", by.id as string)).maybeSingle<Row>();
  };
  if (!by.handle && !(typeof by.id === "string" && UUID.test(by.id))) return null;
  let res = await run("username,display_name,avatar_grid");
  if (res.error) res = await run("username,display_name");
  const handle = str(res.data?.username) ?? str(res.data?.display_name);
  return handle ? { handle, grid: str(res.data?.avatar_grid) } : null;
}

/** The song a share link (`s`) or a deep link (`open`) names, or null. */
export async function songCard(slug: string | null, openId: string | null): Promise<SongCard | null> {
  if (slug && !SLUG.test(slug)) return null;
  if (!slug && !(openId && UUID.test(openId))) return null;
  const supabase = anon();
  try {
    if (supabase) {
      const run = (cols: string) => {
        const q = supabase.from("songs").select(cols).eq("is_public", true);
        return (slug ? q.eq("share_slug", slug) : q.eq("id", openId as string)).maybeSingle<Row>();
      };
      const base = "title,owner_id,bpm:data->bpm";
      let res = await run(`${base},preview`);
      if (res.error) res = await run(base);
      const title = named(res.data?.title);
      if (res.data && title) {
        const bpm = res.data.bpm;
        return {
          title,
          owner: await person(supabase, { id: res.data.owner_id }).catch(() => null),
          bpm: typeof bpm === "number" ? Math.round(bpm) : null,
          preview: res.data.preview ?? null,
        };
      }
    }
    if (!slug) return null;
    // A quick anonymous share: a session in the Blobs store, never in the
    // database, so its preview is computed here from the session itself.
    const meta = await getShareMeta({ id: slug }).catch(() => null);
    const body = (await getShare({ id: slug }).catch(() => null)) as Row | null;
    if (!body) return null;
    const session = (body.session ?? body) as Row;
    const title = named(meta?.title) ?? named(body.title) ?? "a song";
    const ownerId = meta?.ownerId ?? body.ownerId;
    return {
      title,
      owner: supabase ? await person(supabase, { id: ownerId }).catch(() => null) : null,
      bpm: typeof session.bpm === "number" ? Math.round(session.bpm) : null,
      preview: previewFromSession(session),
    };
  } catch {
    return null;
  }
}

/** A jam invite's host, from the handle the link carries -- only once it is
 *  found in profile_cards, for the reason jamHostName gives. */
export async function jamHost(by: string | null): Promise<CardPerson | null> {
  if (!by || !HANDLE.test(by)) return null;
  const supabase = anon();
  if (!supabase) return null;
  return person(supabase, { handle: by }).catch(() => null);
}
