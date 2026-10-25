"use client";

import { useActionState } from "react";
import { setNewPassword } from "@/app/auth/actions";
import styles from "@/app/ui.module.css";

const initial = {} as { error?: string; message?: string };

export default function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setNewPassword, initial);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} readOnly />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          new password
        </label>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
          autoFocus
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="confirm">
          again
        </label>
        <input
          className={styles.input}
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      <button className={styles.button} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </button>
      {state?.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}
