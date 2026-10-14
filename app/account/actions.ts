"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

type State = { error?: string; message?: string };

export async function updateEmail(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "enter a new email address" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not signed in" };
  if (email === user.email) return { error: "that's already your email" };

  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/confirm` },
  );
  if (error) return { error: error.message };
  return {
    message:
      "confirmation sent: check your new email (and the current one) to complete the change.",
  };
}

export async function updatePassword(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  if (next.length < 6)
    return { error: "new password must be at least 6 characters" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "not signed in" };

  // Re-verify identity with the current password before changing it.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) return { error: "current password is incorrect" };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };
  return { message: "password updated." };
}

// Permanently delete the signed-in user's account and all their data (cascades
// to profile, songs, patches). Guarded server-side by a typed confirmation.
export async function deleteAccount(
  confirm: string,
): Promise<{ ok?: boolean; error?: string }> {
  if (confirm !== "DELETE") return { error: 'Type "DELETE" to confirm' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not signed in" };

  const { error } = await supabase.rpc("delete_own_account");
  if (error) return { error: error.message };
  await supabase.auth.signOut();
  return { ok: true };
}
