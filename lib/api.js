// Shared logic used by both the local Node server and the Netlify Functions.
import { randomBytes } from "node:crypto";
// Relative, not "@/..." -- this module also runs under plain Node
// (server.js) and a Netlify Function (netlify/functions/share.mjs), neither
// of which resolves Next's path alias.
import { generateSongName } from "../app/songs/songName.js";

// ---- anonymous shares ----------------------------------------------------
//
// The studio's quick `share` button. Shares are rows in Supabase's `shares`
// table (migration 0020), written and read with the secret key: no client
// touches that table, and this module is the only way in or out.
//
// Netlify Blobs was the store before that. It stays in two places only:
//   - READ, for an id not found in the table: links sent out before the
//     move keep working until scripts/migrate-shares.mjs has copied them over.
//   - WRITE, when this deploy has no secret key: a share still has to land
//     somewhere, and losing it to the in-memory map below would be worse.
// Outside a Netlify context with no Supabase env (`next dev`, server.js, the
// tests), both fall through to a Map in this process.

// Local in-memory fallback (used when running outside a Netlify context).
const _memStore = new Map();
const SHARE_NS = "seqbaby-shares";

async function blobStore() {
  try {
    const mod = await import("@netlify/blobs");
    return mod.getStore({ name: SHARE_NS, consistency: "strong" });
  } catch {
    return null;
  }
}

// Imported lazily: @supabase/supabase-js is a dependency of the app, and this
// module is also loaded by `node --test` with nothing installed.
async function db() {
  try {
    const { adminClient } = await import("./supabase/admin.js");
    return adminClient();
  } catch {
    return null;
  }
}

/** The store a share is written to, for the migration script. */
export { SHARE_NS };

function newShareId() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) || randomBytes(4).toString("hex");
}

const ID_RE = /^[a-zA-Z0-9]{4,32}$/;

// `ownerId` is the signed-in sharer, when there is one -- this is the quick,
// anonymous "share" button in the top bar, not the account-side publish flow
// (SaveButton/SongsMenu), so nothing here requires an account or names the
// song by hand. `title` is the studio's own name for what it is sharing --
// the currently open song's title, when there is one -- and is trusted as
// given rather than re-derived: a song already named "riot operator" must
// not come back "panic cloud" because this button regenerated one from the
// session's content. Only a session with nothing else to call itself (no
// song open, or one still sitting on the `untitled` default) falls back to
// `generateSongName` (app/songs/songName.js, already pure/deterministic for
// exactly this kind of reuse), so even a signed-out share's card still says
// what the song is rather than falling back to the bare site card.
export async function putShare({ session, ownerId, title: givenTitle }) {
  if (!session || typeof session !== "object") throw new Error("empty session");
  const id = newShareId();
  const trimmed = typeof givenTitle === "string" ? givenTitle.trim() : "";
  const title =
    trimmed && trimmed.toLowerCase() !== "untitled" ? trimmed : generateSongName(session);
  const owner = typeof ownerId === "string" && ownerId ? ownerId : null;
  const body = { session, createdAt: new Date().toISOString(), title, ownerId: owner };
  const sb = await db();
  if (sb) {
    // An 8-character id clashing is unlikely, not impossible: a fresh one on
    // a primary-key violation, a few times, before giving up.
    let tryId = id;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await sb.from("shares").insert({
        id: tryId, session, title, owner_id: owner, created_at: body.createdAt,
      });
      if (!error) return { id: tryId, storage: "supabase" };
      if (error.code !== "23505") { console.warn("share insert failed:", error.message); break; }
      tryId = newShareId();
    }
  }
  const store = await blobStore();
  if (store) {
    try {
      // Metadata is a separate, cheap read (getShareMeta) -- a link preview
      // must not pull down a whole session, base64 samples included, just to
      // learn its title and who shared it.
      await store.setJSON(id, body, { metadata: { title, ownerId: owner } });
      return { id, storage: "netlify" };
    }
    catch (e) { console.warn("blob setJSON failed, falling back to memory:", e?.message ?? e); }
  }
  _memStore.set(id, body);
  return { id, storage: "memory" };
}

export async function getShare({ id }) {
  if (!id || !ID_RE.test(String(id))) throw new Error("bad id");
  const sb = await db();
  if (sb) {
    const { data, error } = await sb
      .from("shares")
      .select("session,title,owner_id,created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) console.warn("share read failed:", error.message);
    if (data) return { session: data.session, createdAt: data.created_at, title: data.title, ownerId: data.owner_id };
  }
  const store = await blobStore();
  if (store) {
    try {
      const body = await store.get(id, { type: "json" });
      if (body) return body;
    } catch (e) {
      console.warn("blob get failed:", e?.message ?? e);
    }
  }
  const local = _memStore.get(id);
  if (!local) throw new Error("share not found");
  return local;
}

/**
 * Just the title + ownerId for a share, without paying for the session it
 * carries -- what a link preview needs. Null for an id that resolves to
 * nothing, or to a share written before this existed (no metadata attached).
 */
export async function getShareMeta({ id }) {
  if (!id || !ID_RE.test(String(id))) return null;
  const sb = await db();
  if (sb) {
    const { data, error } = await sb.from("shares").select("title,owner_id").eq("id", id).maybeSingle();
    if (error) console.warn("share meta read failed:", error.message);
    if (data) return typeof data.title === "string" ? { title: data.title, ownerId: data.owner_id ?? null } : null;
  }
  const store = await blobStore();
  if (store) {
    try {
      const res = await store.getMetadata(id);
      if (res?.metadata && typeof res.metadata.title === "string") return res.metadata;
      return null;
    } catch (e) {
      console.warn("blob getMetadata failed:", e?.message ?? e);
      return null;
    }
  }
  const local = _memStore.get(id);
  if (!local || typeof local.title !== "string") return null;
  return { title: local.title, ownerId: local.ownerId ?? null };
}
