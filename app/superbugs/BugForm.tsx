"use client";

import { useState } from "react";
import styles from "./superbugs.module.css";

const ISSUES = "https://github.com/mjoslyn/seqbaby/issues";

type Result = { kind: "ok"; url: string } | { kind: "err"; msg: string; fallback: string } | null;

export default function BugForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "");
    const payload = {
      title: v("title"),
      what: v("what"),
      steps: v("steps"),
      where: v("where") || location.href,
      contact: v("contact"),
      website: v("website"),
    };
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        setResult({ kind: "ok", url: data.url });
        e.currentTarget.reset();
      } else {
        const body = `${payload.what}\n\n${payload.steps ? `Steps:\n${payload.steps}\n\n` : ""}${navigator.userAgent}`;
        setResult({
          kind: "err",
          msg: data.error || "that did not go through",
          fallback: `${ISSUES}/new?title=${encodeURIComponent(`[superbug] ${payload.title}`)}&body=${encodeURIComponent(body)}`,
        });
      }
    } catch {
      setResult({ kind: "err", msg: "could not reach the server", fallback: `${ISSUES}/new` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>title</span>
        <input name="title" required maxLength={120} placeholder="the reverb eats my snare" />
      </label>
      <label>
        <span>what happened</span>
        <textarea name="what" required rows={5} maxLength={4000} placeholder="what you saw, and what you expected" />
      </label>
      <label>
        <span>how to make it happen (optional)</span>
        <textarea name="steps" rows={4} maxLength={4000} placeholder="1. open the studio&#10;2. ..." />
      </label>
      <label>
        <span>song link or page (optional)</span>
        <input name="where" maxLength={300} placeholder="defaults to this page" />
      </label>
      <label>
        <span>email, if you want a reply (optional)</span>
        <input name="contact" type="email" maxLength={200} />
        <small>it goes on a public issue. leave it blank if that bothers you.</small>
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className={styles.trap} />
      <button type="submit" disabled={busy} className={styles.submit}>
        {busy ? "sending..." : "release the superbug"}
      </button>
      {result?.kind === "ok" && (
        <p className={styles.ok} role="status">
          filed. <a href={result.url} target="_blank" rel="noopener noreferrer">see the issue</a>
        </p>
      )}
      {result?.kind === "err" && (
        <p className={styles.err} role="alert">
          {result.msg}.{" "}
          <a href={result.fallback} target="_blank" rel="noopener noreferrer">file it on GitHub instead</a>
        </p>
      )}
    </form>
  );
}
