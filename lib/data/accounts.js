// Deleting an account, everything in it included. Shared by the account's own
// delete (app/account/actions.ts) and the admin page's (lib/data/admin.js).
//
// The user row's deletion cascades in D1 to the profile, songs, versions,
// chats, patches, sets, likes and sessions (db/migrations/0001_init.sql). What
// lives in R2 does not cascade, so it is deleted first, by prefix.

import { all, run } from "./db.js";
import { dropPrefix, patchPrefix, songPrefix } from "./blob.js";
import { setPrefix } from "./sets.js";

/** Delete a user and all their data. Returns whether a user row went. */
export async function deleteUserData(env, userId) {
  if (!userId) return false;
  const [songs, patches, sets] = await Promise.all([
    all(env.DB, "select id from songs where owner_id = ?1", userId),
    all(env.DB, "select id from patches where owner_id = ?1", userId),
    all(env.DB, "select id from sets where owner_id = ?1", userId),
  ]);
  for (const s of songs) await dropPrefix(env.BLOBS, songPrefix(s.id));
  for (const p of patches) await dropPrefix(env.BLOBS, patchPrefix(p.id));
  for (const x of sets) await dropPrefix(env.BLOBS, setPrefix(x.id));
  return (await run(env.DB, 'delete from "user" where id = ?1', userId)) > 0;
}
