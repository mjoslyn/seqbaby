"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

type State = { error?: string; message?: string };

export async function updateEmail(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "Enter a new email address" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  if (email === user.email) return { error: "That's already your email" };

  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/confirm` },
  );
  if (error) return { error: error.message };
  return {
    message:
      "Confirmation sent — check your new email (and current one) to complete the change.",
  };
}

export async function updatePassword(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  if (next.length < 6)
    return { error: "New password must be at least 6 characters" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in" };

  // Re-verify identity with the current password before changing it.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) return { error: "Current password is incorrect" };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };
  return { message: "Password updated." };
}
