"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  signIn,
  signUp,
  signInWithMagicLink,
} from "@/app/auth/actions";
import styles from "@/app/ui.module.css";

type Mode = "signin" | "signup";
const initial = {} as { error?: string; message?: string };

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
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

  const isSignin = mode === "signin";
  const state = isSignin ? signInState : signUpState;

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
            className={`${styles.tab} ${!isSignin ? styles.tabActive : ""}`}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        <form action={isSignin ? signInAction : signUpAction}>
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
          </div>
          <button
            className={styles.button}
            type="submit"
            disabled={isSignin ? signInPending : signUpPending}
          >
            {isSignin
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

        {state?.error && <p className={styles.error}>{state.error}</p>}
        {state?.message && <p className={styles.message}>{state.message}</p>}
        {isSignin && magicState?.message && (
          <p className={styles.message}>{magicState.message}</p>
        )}
        {isSignin && magicState?.error && (
          <p className={styles.error}>{magicState.error}</p>
        )}

        <p className={styles.hint}>
          <Link href="/">← back to the studio</Link>
        </p>
      </div>
    </div>
  );
}
