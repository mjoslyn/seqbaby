"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getPlayer, prefetch, scheduleWarm, subscribePlayer, togglePlay, type PlayerState } from "./enginePlayer";
import styles from "./playButton.module.css";

// Play a published song where it is listed: a homepage card, a profile row.
// The engine behind it is deferred (enginePlayer.ts): it loads after the page
// does, so it is warm by the time anyone presses this, and the page itself
// carries none of it. One song plays at a time across every button on the page.

const IDLE: PlayerState = { slug: null, status: "idle" };

const LABEL = {
  idle: "play",
  loading: "loading",
  playing: "stop",
  tap: "tap to hear it",
  error: "couldn't play it, try again",
} as const;

export default function PlayButton({
  slug,
  title,
  variant = "card",
}: {
  slug: string;
  title: string;
  /** `card` floats over a homepage card's step picture; `row` sits inline. */
  variant?: "card" | "row";
}) {
  const player = useSyncExternalStore(subscribePlayer, getPlayer, () => IDLE);
  useEffect(scheduleWarm, []);
  const status = player.slug === slug ? player.status : "idle";
  return (
    <button
      type="button"
      className={`${styles.play} ${variant === "card" ? styles.card : styles.row}`}
      data-status={status}
      onClick={() => togglePlay(slug)}
      onPointerEnter={() => prefetch(slug)}
      onFocus={() => prefetch(slug)}
      aria-label={`${LABEL[status]}: ${title}`}
      aria-pressed={status === "playing"}
      title={status === "loading" ? "loading the studio's engine…" : LABEL[status]}
    >
      {status === "playing" ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
        </svg>
      ) : status === "loading" ? (
        <span className={styles.spin} aria-hidden />
      ) : status === "tap" ? (
        <span className={styles.word}>tap</span>
      ) : status === "error" ? (
        <span className={styles.word}>!</span>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M5.5 3.4v9.2L12.6 8z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
