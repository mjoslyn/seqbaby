"use client";

import { useActionState, useState } from "react";
import {
  updateEmail,
  updatePassword,
  deleteAccount,
} from "@/app/account/actions";
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
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  async function doDelete() {
    setDeleting(true);
    setDeleteErr("");
    const res = await deleteAccount(confirmText);
    if (res.error) {
      setDeleting(false);
      setDeleteErr(res.error);
      return;
    }
    // account gone — full reload to the (logged-out) studio
    window.location.href = "/";
  }

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

      <div className={styles.sectionHead}>
        <h3 className={styles.dangerTitle}>danger zone</h3>
      </div>
      {!confirming ? (
        <button
          className={styles.dangerBtn}
          onClick={() => setConfirming(true)}
        >
          Delete account
        </button>
      ) : (
        <div className={styles.dangerBox}>
          <p className={styles.dangerText}>
            This permanently deletes your account, profile, sessions, and
            patches. This cannot be undone. Type <b>DELETE</b> to confirm.
          </p>
          <input
            className={styles.input}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoFocus
          />
          <div className={styles.dangerActions}>
            <button
              className={styles.dangerBtn}
              onClick={doDelete}
              disabled={deleting || confirmText !== "DELETE"}
            >
              {deleting ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              className={styles.repoAction}
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
                setDeleteErr("");
              }}
            >
              cancel
            </button>
          </div>
          {deleteErr && <p className={styles.error}>{deleteErr}</p>}
        </div>
      )}
    </div>
  );
}
