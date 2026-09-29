"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import {
  signIn,
  signUp,
  signInWithMagicLink,
  requestPasswordReset,
} from "@/app/auth/actions";
import styles from "@/app/ui.module.css";

type Mode = "signin" | "signup" | "reset";
const initial = {} as { error?: string; message?: string };

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  // Set when /auth/confirm could not use the link it was handed.
  const [linkFailed, setLinkFailed] = useState(false);
  // `/login?mode=signup` opens on the create-account tab: the homepage's
  // "make an account" goes there. `?mode=reset` opens on the reset form, from
  // an expired reset link. Read after mount rather than through
  // useSearchParams, which would need a Suspense boundary to keep this page
  // static, for two flags.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const m = q.get("mode");
    if (m === "signup" || m === "reset") setMode(m);
    if (q.get("error") === "confirm") setLinkFailed(true);
  }, []);
  const [signInState, signInAction, signInPending] = useActionState(
    signIn,
    initial,
  );
  const [signUpState, signUpAction, signUpPending] = useActionState(
    signUp,
    initial,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    initial,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    requestPasswordReset,
    initial,
  );

  const isSignin = mode === "signin";
  const isReset = mode === "reset";
  const state = isReset ? resetState : isSignin ? signInState : signUpState;

  return (
    <div className={styles.authWrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" />
          seqbaby
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${isSignin ? styles.tabActive : ""}`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`${styles.tab} ${mode === "signup" ? styles.tabActive : ""}`}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        {isReset && (
          <p className={styles.hintText}>
            Enter your email and we&apos;ll send a link to set a new password.
          </p>
        )}

        <form
          action={
            isReset ? resetAction : isSignin ? signInAction : signUpAction
          }
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              email
            </label>
            <input
              className={styles.input}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          {!isReset && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                password
              </label>
              <input
                className={styles.input}
                id="password"
                name="password"
                type="password"
                autoComplete={isSignin ? "current-password" : "new-password"}
                minLength={6}
                required
              />
              {isSignin && (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setMode("reset")}
                >
                  forgot password?
                </button>
              )}
            </div>
          )}
          <button
            className={styles.button}
            type="submit"
            disabled={
              isReset ? resetPending : isSignin ? signInPending : signUpPending
            }
          >
            {isReset
              ? resetPending
                ? "Sending…"
                : "Send reset link"
              : isSignin
                ? signInPending
                  ? "Signing in…"
                  : "Sign in"
                : signUpPending
                  ? "Creating…"
                  : "Create account"}
          </button>
        </form>

        {isSignin && (
          <form action={magicAction}>
            <input type="hidden" name="email" value="" id="magic-email" />
            <button
              className={styles.ghost}
              type="submit"
              disabled={magicPending}
              onClick={(e) => {
                const email = (
                  document.getElementById("email") as HTMLInputElement | null
                )?.value;
                const hidden = e.currentTarget.form?.querySelector(
                  "#magic-email",
                ) as HTMLInputElement | null;
                if (hidden) hidden.value = email ?? "";
              }}
            >
              {magicPending ? "Sending…" : "Email me a magic link"}
            </button>
          </form>
        )}

        {isReset && (
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setMode("signin")}
          >
            ← back to sign in
          </button>
        )}

        {linkFailed && !state?.error && !state?.message && (
          <p className={styles.error}>
            That link has expired or already been used. Ask for a new one.
          </p>
        )}
        {state?.error && <p className={styles.error}>{state.error}</p>}
        {state?.message && <p className={styles.message}>{state.message}</p>}
        {isSignin && magicState?.message && (
          <p className={styles.message}>{magicState.message}</p>
        )}
        {isSignin && magicState?.error && (
          <p className={styles.error}>{magicState.error}</p>
        )}

        <p className={styles.hint}>
          <Link href="/studio">← back to the studio</Link>
        </p>
      </div>
    </div>
  );
}
