// The profile a new account needs, made by the sign-up hook (lib/auth/config.js)
// and, for an account whose hook never ran, by the admin page (lib/data/admin.js).
// Plain JS with no Better Auth import, so the data layer can use it.

import { nameBase, nameCandidate } from "./nameBase.js";

/**
 * Make the profile a new user needs: the username is the name (migration
 * 0013), from the email's local part, made unique by trying `-2`, `-3` ...
 * against the unique index, which is the only check that cannot race.
 * @param {{ prepare(sql: string): any }} db a D1 database (or the test shim)
 * @param {{ id: string, email: string }} user
 */
export async function createProfile(db, user) {
  const base = nameBase(String(user.email || "").split("@")[0]);
  for (let n = 1; n < 200; n++) {
    const cand = nameCandidate(base, n, user.id);
    try {
      await db
        .prepare("insert into profiles (id, username, display_name) values (?1, ?2, ?2) on conflict (id) do nothing")
        .bind(user.id, cand)
        .run();
      return cand;
    } catch (e) {
      if (!/unique|constraint/i.test(String(e?.message ?? e))) throw e;
    }
  }
  throw new Error("could not find a free username");
}
