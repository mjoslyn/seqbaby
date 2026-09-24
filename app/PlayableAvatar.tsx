"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import { gridFor } from "@/app/profile/avatarGrid";
import { playAvatar } from "@/app/profile/avatarPlayer";
import styles from "./playableAvatar.module.css";

// An avatar you can hear: hover shows a play button over it, a click loops the
// grid as a pattern (avatarPlayer.ts) with the playhead drawn across it, and a
// second click stops it. Starting another avatar stops this one.
//
// It often sits inside a link (a person's card), so the click is kept from
// reaching it: playing someone's face should not also leave the page. That is
// why this is a span with role=button rather than a <button> -- a button
// inside an <a> is invalid markup.
export default function PlayableAvatar({
  grid,
  name,
  size = 32,
  className,
}: {
  grid: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const [step, setStep] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const playing = step >= 0;

  const toggle = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (playing) return stopRef.current?.();
    const g = gridFor(grid, name);
    stopRef.current = playAvatar(() => g, setStep);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${playing ? "stop" : "play"} ${name}'s avatar`}
      aria-pressed={playing}
      title={playing ? "stop" : "play this avatar"}
      className={[styles.wrap, playing ? styles.playing : "", className ?? ""].join(" ")}
      style={{ width: size, height: size, borderRadius: Math.max(3, size / 8) }}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") toggle(e);
      }}
    >
      <Avatar grid={grid} name={name} size={size} step={step} />
      <span className={styles.overlay} aria-hidden>
        <svg viewBox="0 0 24 24" width={Math.max(14, size * 0.4)} height={Math.max(14, size * 0.4)}>
          {playing ? (
            <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
          ) : (
            <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
          )}
        </svg>
      </span>
    </span>
  );
}
