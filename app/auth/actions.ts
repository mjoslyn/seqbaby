"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "@/lib/recoveryCookie";

type ActionState = { error?: string; message?: string };

export async function signIn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/studio");
}

export async function signUp(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message };
  // If email confirmation is disabled in Supabase, a session is returned and the
  // user is already signed in; otherwise they must confirm via email first.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/studio");
  }
  return { message: "Check your email to confirm your account, then sign in." };
}

export async function signInWithMagicLink(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message };
  return { message: "Magic link sent — check your email." };
}

// Emails a password reset link. The link lands on /auth/confirm, which signs
// the visitor in with a recovery session and sends them to /reset-password.
// The reply is the same whether or not the address has an account, so this
// form can't be used to find out who has one.
export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "Enter the email you signed up with." };
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });
  // A rate limit is worth saying; anything about the address itself is not.
  if (error?.status === 429) return { error: error.message };
  return {
    message:
      "If there's an account for that email, a reset link is on its way.",
  };
}

// Sets a new password from /reset-password. Settings asks for the current
// password before changing it; this can't, because forgetting it is the point.
// So it needs the recovery cookie /auth/confirm sets when a reset link is
// followed, or any signed-in session (a laptop left open) could skip that check.
export async function setNewPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 6)
    return { error: "Password must be at least 6 characters." };
  if (password !== confirm) return { error: "Those two don't match." };

  const jar = await cookies();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !jar.get(RECOVERY_COOKIE))
    return { error: "This reset link has expired. Ask for a new one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  jar.delete(RECOVERY_COOKIE);
  revalidatePath("/", "layout");
  redirect("/studio");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/studio");
}
