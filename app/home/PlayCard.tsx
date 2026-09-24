"use client";

import { useSyncExternalStore } from "react";
import { getPlayer, prefetch, subscribePlayer, togglePlay, type PlayerState } from "./enginePlayer";
import styles from "./home.module.css";

// The play button on a homepage song card. The engine behind it loads on the
// first press (enginePlayer.ts); until then the homepage carries none of it.

const IDLE: PlayerState = { slug: null, status: "idle" };

const LABEL = {
  idle: "play",
  loading: "loading",
  playing: "stop",
  tap: "tap to hear it",
  error: "couldn't play it, try again",
} as const;

export default function PlayCard({ slug, title }: { slug: string; title: string }) {
  const player = useSyncExternalStore(subscribePlayer, getPlayer, () => IDLE);
  const status = player.slug === slug ? player.status : "idle";
  const label = `${LABEL[status]}: ${title}`;
  return (
    <button
      type="button"
      className={`${styles.play} ${status !== "idle" ? styles.playActive : ""}`}
      data-status={status}
      onClick={() => togglePlay(slug)}
      onPointerEnter={() => prefetch(slug)}
      onFocus={() => prefetch(slug)}
      aria-label={label}
      aria-pressed={status === "playing"}
      title={status === "loading" ? "loading the studio's engine…" : LABEL[status]}
    >
      {status === "playing" ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" />
        </svg>
      ) : status === "loading" ? (
        <span className={styles.playSpin} aria-hidden />
      ) : status === "tap" ? (
        <span className={styles.playTap}>tap</span>
      ) : status === "error" ? (
        <span className={styles.playTap}>!</span>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M5 3.2v9.6L12.8 8z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
