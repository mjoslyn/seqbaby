"use client";

import { useState } from "react";
import { requestProAccess } from "./actions";
import styles from "@/app/ui.module.css";

// The request form on /pro. One optional field: what they make, which is
// all an admin has to go on.
export default function ProForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return <p className={styles.pageSub}>Sent. You&apos;ll get an email when it&apos;s answered.</p>;
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await requestProAccess(message);
        setBusy(false);
        if (r.ok || r.pending) setDone(true);
        else setError(r.error ?? "couldn't send that");
      }}
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pro-message">
          what do you make? (optional)
        </label>
        <textarea
          id="pro-message"
          className={styles.input}
          rows={4}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="the kind of music, what you'd use compose for, a link to your page"
        />
      </div>
      <button className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} type="submit" disabled={busy}>
        {busy ? "sending…" : "request pro"}
      </button>
      {error && <p className={styles.pageSub}>{error}</p>}
    </form>
  );
}
