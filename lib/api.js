// Share links for the legacy static server (server.js, `npm run legacy:dev`),
// which has no Cloudflare bindings: an in-memory store, gone on restart. The
// deployed app's shares are lib/data/shares.js (D1 + R2).
import { randomBytes } from "node:crypto";
// Relative, not "@/..." -- this module runs under plain Node (server.js),
// which does not resolve Next's path alias.
import { generateSongName } from "../app/songs/songName.js";

const _memStore = new Map();

function newShareId() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) || randomBytes(4).toString("hex");
}

const ID_RE = /^[a-zA-Z0-9]{4,32}$/;

export async function putShare({ session, ownerId, title: givenTitle }) {
  if (!session || typeof session !== "object") throw new Error("empty session");
  const id = newShareId();
  const trimmed = typeof givenTitle === "string" ? givenTitle.trim().slice(0, 200) : "";
  const title = trimmed && trimmed.toLowerCase() !== "untitled" ? trimmed : generateSongName(session);
  const owner = typeof ownerId === "string" && ownerId ? ownerId : null;
  _memStore.set(id, { session, createdAt: new Date().toISOString(), title, ownerId: owner });
  return { id, storage: "memory" };
}

export async function getShare({ id }) {
  if (!id || !ID_RE.test(String(id))) throw new Error("bad id");
  const local = _memStore.get(id);
  if (!local) throw new Error("share not found");
  return local;
}
