"use server";

import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/auth/config.js";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { all, run } from "@/lib/data/db.js";
import { dropPrefix, patchPrefix, songPrefix } from "@/lib/data/blob.js";

type State = { error?: string; message?: string };

export async function updateEmail(_prev: State, formData: FormData): Promise<State> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "enter a new email address" };
  const user = await currentUser();
  if (!user) return { error: "not signed in" };
  if (email.toLowerCase() === user.email.toLowerCase()) return { error: "that's already your email" };
  try {
    const auth = await getAuth();
    await auth.api.changeEmail({ body: { newEmail: email, callbackURL: "/settings" }, headers: await headers() });
  } catch (e) {
    return { error: (e as { body?: { message?: string }; message?: string })?.body?.message ?? "couldn't change that" };
  }
  return {
    message: "confirmation sent: check your current email to approve the change, then your new one to confirm it.",
  };
}

export async function updatePassword(_prev: State, formData: FormData): Promise<State> {
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  if (next.length < MIN_PASSWORD) return { error: `new password must be at least ${MIN_PASSWORD} characters` };
  const user = await currentUser();
  if (!user) return { error: "not signed in" };
  try {
    const auth = await getAuth();
    // Checks the current password itself before changing it.
    await auth.api.changePassword({
      body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch {
    return { error: "current password is incorrect" };
  }
  return { message: "password updated." };
}

// Permanently delete the signed-in user's account and all their data. Guarded
// server-side by a typed confirmation. The user row's deletion cascades in D1
// to the profile, songs, versions, chats, patches, likes and sessions
// (db/migrations/0001_init.sql); what lives in R2 is deleted first, by prefix.
export async function deleteAccount(confirm: string): Promise<{ ok?: boolean; error?: string }> {
  if (confirm !== "DELETE") return { error: 'Type "DELETE" to confirm' };
  const user = await currentUser();
  if (!user) return { error: "not signed in" };
  const env = await cfEnv();
  try {
    const [songs, patches] = await Promise.all([
      all(env.DB, "select id from songs where owner_id = ?1", user.id),
      all(env.DB, "select id from patches where owner_id = ?1", user.id),
    ]);
    for (const s of songs) await dropPrefix(env.BLOBS, songPrefix(s.id));
    for (const p of patches) await dropPrefix(env.BLOBS, patchPrefix(p.id));
    await run(env.DB, 'delete from "user" where id = ?1', user.id);
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
  // The session row went with the user; the cookies are all that is left.
  const jar = await cookies();
  for (const c of jar.getAll()) if (c.name.includes("better-auth")) jar.delete(c.name);
  return { ok: true };
}
