"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/auth/config.js";
import { safeNext } from "@/lib/safeNext";

type ActionState = { error?: string; message?: string };

/** Better Auth throws an APIError carrying a status and a message meant for
 *  people; anything else is ours to word. */
function authError(e: unknown): { status: number; code: string; message: string } {
  const err = e as { status?: unknown; statusCode?: number; body?: { code?: string; message?: string }; message?: string };
  return {
    status: typeof err?.statusCode === "number" ? err.statusCode : 0,
    code: err?.body?.code ?? "",
    message: err?.body?.message || err?.message || "something went wrong",
  };
}

/** Where a link in an email lands: /auth/confirm sends the visitor on to
 *  `next`, or to the sign-in page when the link failed. */
const confirmUrl = (next: string) => `/auth/confirm?next=${encodeURIComponent(next)}`;

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = safeNext(formData.get("next"));
  try {
    const auth = await getAuth();
    await auth.api.signInEmail({
      body: { email, password, callbackURL: confirmUrl(next) },
      headers: await headers(),
    });
  } catch (e) {
    const err = authError(e);
    if (err.code === "EMAIL_NOT_VERIFIED")
      return { error: "confirm your email first: we've sent the link again." };
    if (err.status === 401 || err.code === "INVALID_EMAIL_OR_PASSWORD")
      return { error: "that email and password don't match an account." };
    return { error: err.message };
  }
  revalidatePath("/", "layout");
  // Back where the visitor was when a heart, a remix or a save sent them here.
  redirect(next);
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = safeNext(formData.get("next"));
  if (password.length < MIN_PASSWORD) return { error: `password must be at least ${MIN_PASSWORD} characters.` };
  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({
      body: { email, password, name: "", callbackURL: confirmUrl(next) },
      headers: await headers(),
    });
  } catch (e) {
    const err = authError(e);
    if (/already exists/i.test(err.message)) return { error: "there's already an account for that email: sign in instead." };
    return { error: err.message };
  }
  // Email confirmation is required, so nobody is signed in yet.
  return { message: "check your email to confirm your account, then sign in." };
}

export async function signInWithMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "enter your email first." };
  const next = safeNext(formData.get("next"));
  try {
    const auth = await getAuth();
    await auth.api.signInMagicLink({
      body: { email, callbackURL: confirmUrl(next), errorCallbackURL: "/login?error=confirm" },
      headers: await headers(),
    });
  } catch (e) {
    return { error: authError(e).message };
  }
  return { message: "magic link sent: check your email." };
}

// Emails a password reset link. The link goes through Better Auth's
// /api/auth/reset-password/<token>, which sends the visitor to
// /reset-password?token=<token>. The reply is the same whether or not the
// address has an account, so this form can't be used to find out who has one.
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "enter the email you signed up with." };
  try {
    const auth = await getAuth();
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
      headers: await headers(),
    });
  } catch (e) {
    // A rate limit is worth saying; anything about the address itself is not.
    if (authError(e).status === 429) return { error: "too many tries: wait a minute and ask again." };
  }
  return { message: "if there's an account for that email, a reset link is on its way." };
}

// Sets a new password from /reset-password. The token from the emailed link is
// the proof: it can only have come out of the account's inbox, which is why
// this needs no current password (settings asks for one).
export async function setNewPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const token = String(formData.get("token") || "");
  if (password.length < MIN_PASSWORD) return { error: `password must be at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "those two don't match." };
  if (!token) return { error: "this reset link has expired. Ask for a new one." };
  try {
    const auth = await getAuth();
    await auth.api.resetPassword({ body: { newPassword: password, token }, headers: await headers() });
  } catch {
    return { error: "this reset link has expired. Ask for a new one." };
  }
  // Every session was signed out by the reset, this one included.
  redirect("/login?reset=done");
}

export async function signOut() {
  try {
    const auth = await getAuth();
    await auth.api.signOut({ headers: await headers() });
  } catch {
    /* already signed out */
  }
  revalidatePath("/", "layout");
  redirect("/studio");
}
