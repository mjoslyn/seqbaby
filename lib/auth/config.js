// Accounts: Better Auth over D1, replacing Supabase Auth.
//
// What it has to do is what Supabase did for this app, and no more:
//
//   email + password    sign up (confirmed by email), sign in, change, reset
//   magic link          sign in (and sign up) from a link in an email
//   email change        confirmed from the old address, verified at the new one
//   delete account      the user row goes, and everything hangs off it by
//                       `on delete cascade` (db/migrations/0001_init.sql)
//
// Plain JS taking its database and its mailer as arguments, so `node --test`
// builds the same configuration over node:sqlite (test/auth.test.js);
// lib/auth/index.ts is the Worker's half and passes D1 and the EMAIL binding.
//
// Accounts that came over from Supabase (scripts/migrate-from-supabase.mjs)
// keep their user ids and their bcrypt password hashes: `verify` below checks
// a bcrypt hash as Supabase would, and everything new is hashed Better Auth's
// way (scrypt). Nobody has to reset a password because of the move.

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import bcrypt from "bcryptjs";
import { nameBase, nameCandidate } from "./nameBase.js";

/** Supabase's minimum, kept so no existing password stops being valid. */
export const MIN_PASSWORD = 6;

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

/**
 * @param {{
 *   database: any,
 *   secret: string,
 *   baseURL?: string,
 *   trustedOrigins?: string[],
 *   sendMail: (m: { to: string, subject: string, lead: string, label: string, url: string }) => Promise<void>,
 *   withNextCookies?: boolean,
 * }} opts
 */
export function makeAuth({ database, secret, baseURL, trustedOrigins, sendMail, withNextCookies = true }) {
  return betterAuth({
    database,
    secret,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: async ({ hash, password }) =>
          hash.startsWith("$2") ? bcrypt.compare(password, hash) : verifyPassword({ hash, password }),
      },
      sendResetPassword: async ({ user, url }) =>
        sendMail({
          to: user.email,
          subject: "reset your seqbaby password",
          lead: "Someone asked to reset the password on your seqbaby account. Follow the link to choose a new one; it works once, for an hour.",
          label: "choose a new password",
          url,
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in unconfirmed sends the link again, so nobody is stuck on an
      // email that never came.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendMail({
          to: user.email,
          subject: "confirm your email for seqbaby",
          lead: "Confirm this address to finish setting up your seqbaby account.",
          label: "confirm my email",
          url,
        }),
    },
    user: {
      changeEmail: {
        enabled: true,
        // To the CURRENT address first; once approved, the new address gets a
        // verification of its own. Supabase's "secure email change", which is
        // what the settings page's message has always promised.
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) =>
          sendMail({
            to: user.email,
            subject: "approve your seqbaby email change",
            lead: `Someone asked to change your seqbaby account's email to ${newEmail}. Approve it, and that address gets a confirmation link of its own.`,
            label: "approve the change",
            url,
          }),
      },
      deleteUser: { enabled: true },
    },
    session: {
      // Long, because nothing refreshes a session in the background any more
      // (there is no middleware): any server action extends it, and someone
      // who has not opened the studio for two months signs in again.
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
      // A signed copy of the session in a cookie, checked without D1 for five
      // minutes at a time: the studio asks who is signed in on every load.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      // Ids are uuids, as Supabase's were, so migrated users keep theirs and
      // every id in the schema has one shape.
      database: { generateId: () => crypto.randomUUID() },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await createProfile(database, user);
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 60,
        sendMagicLink: async ({ email, url }) =>
          sendMail({
            to: email,
            subject: "your seqbaby sign-in link",
            lead: "Follow the link to sign in to seqbaby. It works once, for an hour.",
            label: "sign in",
            url,
          }),
      }),
      // Lets a server action set the session cookie. Must be last.
      ...(withNextCookies ? [nextCookies()] : []),
    ],
  });
}
