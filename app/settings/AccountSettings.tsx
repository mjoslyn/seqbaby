"use client";

import { useActionState } from "react";
import { updateEmail, updatePassword } from "@/app/account/actions";
import styles from "@/app/ui.module.css";

const initial = {} as { error?: string; message?: string };

export default function AccountSettings({ email }: { email: string }) {
  const [emailState, emailAction, emailPending] = useActionState(
    updateEmail,
    initial,
  );
  const [pwState, pwAction, pwPending] = useActionState(
    updatePassword,
    initial,
  );

  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>account</h3>
      </div>

      <form action={emailAction}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="acct-email">
            email
          </label>
          <input
            className={styles.input}
            id="acct-email"
            name="email"
            type="email"
            defaultValue={email}
            required
          />
          <div className={styles.hintText}>
            changing this sends a confirmation link to the new address
          </div>
        </div>
        <button
          className={styles.button}
          type="submit"
          disabled={emailPending}
          style={{ maxWidth: 220 }}
        >
          {emailPending ? "Updating…" : "Update email"}
        </button>
        {emailState.error && <p className={styles.error}>{emailState.error}</p>}
        {emailState.message && (
          <p className={styles.message}>{emailState.message}</p>
        )}
      </form>

      <form action={pwAction} style={{ marginTop: 22 }}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="acct-current">
            current password
          </label>
          <input
            className={styles.input}
            id="acct-current"
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="acct-next">
            new password
          </label>
          <input
            className={styles.input}
            id="acct-next"
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        <button
          className={styles.button}
          type="submit"
          disabled={pwPending}
          style={{ maxWidth: 220 }}
        >
          {pwPending ? "Updating…" : "Update password"}
        </button>
        {pwState.error && <p className={styles.error}>{pwState.error}</p>}
        {pwState.message && <p className={styles.message}>{pwState.message}</p>}
      </form>
    </div>
  );
}
