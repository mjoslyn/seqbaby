// Shared logic used by both the local Node server and the Netlify Functions.
import { randomBytes } from "node:crypto";
// Relative, not "@/..." -- this module also runs under plain Node
// (server.js) and a Netlify Function (netlify/functions/share.mjs), neither
// of which resolves Next's path alias.
import { generateSongName } from "../app/songs/songName.js";

// ---- shared-session blobs ---------------------------------------------

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

function newShareId() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) || randomBytes(4).toString("hex");
}

const ID_RE = /^[a-zA-Z0-9]{4,32}$/;

// `ownerId` is the signed-in sharer, when there is one -- this is the quick,
// anonymous "share" button in the top bar, not the account-side publish flow
// (SaveButton/SongsMenu), so nothing here requires an account or names the
// song by hand. A title is generated from the session itself either way
// (app/songs/songName.js, already pure/deterministic for exactly this kind
// of reuse), so even a signed-out share's card says what the song is rather
// than falling back to the bare site card.
export async function putShare({ session, ownerId }) {
  if (!session || typeof session !== "object") throw new Error("empty session");
  const id = newShareId();
  const title = generateSongName(session);
  const owner = typeof ownerId === "string" && ownerId ? ownerId : null;
  const body = { session, createdAt: new Date().toISOString(), title, ownerId: owner };
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
