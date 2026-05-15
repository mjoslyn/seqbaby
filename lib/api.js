// Shared logic used by both the local Node server and the Netlify Functions.
import { randomBytes } from "node:crypto";

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

export async function putShare({ session }) {
  if (!session || typeof session !== "object") throw new Error("empty session");
  const id = newShareId();
  const body = { session, createdAt: new Date().toISOString() };
  const store = await blobStore();
  if (store) {
    try { await store.setJSON(id, body); return { id, storage: "netlify" }; }
    catch (e) { console.warn("blob setJSON failed, falling back to memory:", e?.message ?? e); }
  }
  _memStore.set(id, body);
  return { id, storage: "memory" };
}

export async function getShare({ id }) {
  if (!id || !/^[a-zA-Z0-9]{4,32}$/.test(String(id))) throw new Error("bad id");
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
