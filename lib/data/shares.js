// The studio's quick `share` button (public/js/session.js onShareSet): a whole
// session behind a short id, no account needed. Was Netlify Blobs (lib/api.js,
// which keeps an in-memory version for the legacy static server).
//
// The session is in R2 (shares/<id>.json, it may carry samples); the `shares`
// row holds what a link preview reads without fetching it: a title, and the
// sharer when one was signed in.

import { randomBytes } from "node:crypto";
import { first, run } from "./db.js";
import { generateSongName } from "../../app/songs/songName.js";

const ID_RE = /^[a-zA-Z0-9]{4,32}$/;
const key = (id) => `shares/${id}.json`;

function newShareId() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) || randomBytes(4).toString("hex");
}

/** Store a session; returns its id. `title` is the open song's own name when
 *  there is one, else one is generated from the session (app/songs/songName.js). */
export async function putShare(env, { session, ownerId, title: givenTitle }) {
  if (!session || typeof session !== "object") throw new Error("empty session");
  const trimmed = typeof givenTitle === "string" ? givenTitle.trim().slice(0, 200) : "";
  const title = trimmed && trimmed.toLowerCase() !== "untitled" ? trimmed : generateSongName(session);
  const owner = typeof ownerId === "string" && ownerId ? ownerId : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newShareId();
    if (await first(env.DB, "select 1 as taken from shares where id = ?1", id)) continue;
    await env.BLOBS.put(key(id), JSON.stringify({ session, createdAt: new Date().toISOString() }));
    await run(env.DB, "insert into shares (id, title, owner_id) values (?1, ?2, ?3)", id, title, owner);
    return { id };
  }
  throw new Error("could not allocate a share link");
}

/** A stored share's session, or null. */
export async function getShare(env, id) {
  if (!id || !ID_RE.test(String(id))) return null;
  const obj = await env.BLOBS.get(key(id));
  if (!obj) return null;
  return obj.json();
}

/** Just the title and sharer, without the session: what a link preview needs. */
export async function getShareMeta(env, id) {
  if (!id || !ID_RE.test(String(id))) return null;
  const row = await first(env.DB, "select title, owner_id from shares where id = ?1", id);
  if (!row || typeof row.title !== "string") return null;
  return { title: row.title, ownerId: row.owner_id ?? null };
}
