"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clockLabel } from "@/lib/setRecording.js";
import styles from "@/app/ui.module.css";

// Your recorded live sets (public/js/setRecorder.js): every set saved from the
// studio's `set` button, private until made public. Public ones show on your
// profile; anyone with the link can play them. Through /api/sets, the routes
// the studio saves with.

type MySet = {
  id: string;
  title: string;
  seconds: number;
  decks: number;
  isPublic: boolean;
  forkedFrom: string | null;
  createdAt: string;
};

export default function SetManager() {
  const [sets, setSets] = useState<MySet[]>([]);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sets");
      const out = (await res.json()) as { sets?: MySet[]; error?: string };
      if (!res.ok || out.error) throw new Error(out.error || `could not list sets (${res.status})`);
      setSets(out.sets ?? []);
    } catch (e) {
      setStatus({ text: String((e as Error)?.message ?? e), err: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patch(s: MySet, body: { title?: string; isPublic?: boolean }, done: string) {
    const res = await fetch(`/api/sets/${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok || out.error) return setStatus({ text: out.error || "could not change the set", err: true });
    setStatus({ text: done });
    void refresh();
  }

  function rename(s: MySet) {
    const title = window.prompt("Rename the set", s.title)?.trim();
    if (!title || title === s.title) return;
    void patch(s, { title }, `renamed to "${title}"`);
  }

  async function doDelete(s: MySet) {
    if (!window.confirm(`Delete the set "${s.title}"? Its link stops working.`)) return;
    const res = await fetch(`/api/sets/${encodeURIComponent(s.id)}`, { method: "DELETE" });
    if (!res.ok) return setStatus({ text: "could not delete the set", err: true });
    setStatus({ text: `deleted "${s.title}"` });
    void refresh();
  }

  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>your sets</h3>
        <span className={styles.sectionCount}>{sets.length}</span>
      </div>
      {sets.length === 0 ? (
        <div className={styles.emptyBig}>
          Press <b>set</b> in the studio&apos;s transport and play: everything you launch, mix and turn is
          recorded until you stop, and saved here. Make one public to show it on your profile.
        </div>
      ) : (
        sets.map((s) => (
          <div className={styles.repoRow} key={s.id}>
            <div className={styles.repoMain}>
              <Link className={styles.repoName} href={`/set/${s.id}`}>
                {s.title}
              </Link>
              <div className={styles.repoMeta}>
                {clockLabel(s.seconds)}
                {s.decks ? ` · ${s.decks + 1} decks` : ""}
                {s.forkedFrom ? " · fork" : ""}
                {s.isPublic ? " · public" : ""}
                {` · ${s.createdAt.slice(0, 10)}`}
              </div>
            </div>
            <Link className={styles.repoAction} href={`/set/${s.id}`}>
              play
            </Link>
            <button className={styles.repoAction} onClick={() => rename(s)}>
              rename
            </button>
            <button
              className={styles.repoAction}
              onClick={() => void patch(s, { isPublic: !s.isPublic }, s.isPublic ? `"${s.title}" is private` : `"${s.title}" is public`)}
            >
              {s.isPublic ? "make private" : "make public"}
            </button>
            <button className={styles.repoAction} onClick={() => void doDelete(s)}>
              delete
            </button>
          </div>
        ))
      )}
      <div className={`${styles.status} ${status.err ? styles.statusErr : ""}`}>{status.text}</div>
    </div>
  );
}
