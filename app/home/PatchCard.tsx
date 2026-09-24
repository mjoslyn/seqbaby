"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import PlayButton from "../PlayButton";
import Avatar from "../Avatar";
import { getPlayer, patchKey, playheadStep, subscribePlayer, type PlayerState } from "../enginePlayer";
import { PHRASE_STEPS, canPreview, engineLabel, phraseFor, previewHint } from "./patchPreview";
import type { FeedPatch } from "./feed";
import styles from "./home.module.css";

// A patch in the gallery, laid out like a song card. A patch has no notes of
// its own, so the picture is the phrase the play button plays on it
// (patchPreview.js): the same list drawn and heard. While it plays, a
// playhead walks it and the notes under it light up, read off the hidden
// engine's own transport.

const IDLE: PlayerState = { slug: null, status: "idle" };

function usePlayhead(key: string): number | null {
  const player = useSyncExternalStore(subscribePlayer, getPlayer, () => IDLE);
  const playing = player.slug === key && player.status === "playing";
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) {
      setStep(null);
      return;
    }
    let raf = 0;
    let last = -1;
    const tick = () => {
      const s = playheadStep();
      const at = s == null ? -1 : ((s % PHRASE_STEPS) + PHRASE_STEPS) % PHRASE_STEPS;
      if (at !== last) {
        last = at;
        setStep(at < 0 ? null : at);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return step;
}

function Roll({ patch, step }: { patch: FeedPatch; step: number | null }) {
  const phrase = phraseFor(patch.engine, patch.drum ?? undefined, previewHint(patch.name, patch.sampleId));
  const W = PHRASE_STEPS * 4;
  const H = 16;
  const notes = phrase.steps.map((s) => s.note ?? 0);
  const lo = Math.min(...notes);
  const span = Math.max(1, Math.max(...notes) - lo);
  return (
    <svg className={styles.printSvg} viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="none">
      {Array.from({ length: PHRASE_STEPS }, (_, i) => (
        <rect key={`g${i}`} x={i * 4 + 0.5} y={0} width={3} height={H} rx={0.6} className={styles.rollLane} />
      ))}
      {step != null && <rect x={step * 4} y={0} width={4} height={H} className={styles.rollHead} />}
      {phrase.steps.map((s) => {
        const lit = step != null && step >= s.i && step < s.i + s.len;
        // A drum is a hit, drawn by how hard; a note sits at its pitch.
        const h = phrase.kind === "drum" ? 3 + s.vel * 11 : 3;
        const y = phrase.kind === "drum" ? H - h : (1 - ((s.note ?? lo) - lo) / span) * (H - 3);
        return (
          <rect
            key={s.i}
            x={s.i * 4 + 0.5}
            y={y}
            width={s.len * 4 - 1}
            height={h}
            rx={0.6}
            className={lit ? styles.rollLit : styles.printOn}
          />
        );
      })}
    </svg>
  );
}

export default function PatchCard({ patch, age }: { patch: FeedPatch; age: string }) {
  const key = patchKey(patch.id);
  const step = usePlayhead(key);
  return (
    <li className={styles.card}>
      {canPreview(patch.engine) && <PlayButton slug={key} title={patch.name} />}
      <span className={styles.print}>
        <Roll patch={patch} step={step} />
      </span>
      <span className={styles.cardTitle}>{patch.name}</span>
      <span className={styles.cardMeta}>
        <span className={styles.engineTag}>{engineLabel(patch.engine)}</span>
        {patch.owner ? (
          patch.owner.handle ? (
            <a className={styles.cardOwner} href={`/u/${patch.owner.handle}`}>
              <Avatar grid={patch.owner.avatarGrid} name={patch.owner.handle} size={18} />@{patch.owner.handle}
            </a>
          ) : (
            <span className={styles.cardOwner}>
              <Avatar grid={patch.owner.avatarGrid} name={patch.owner.name} size={18} />
              {patch.owner.name}
            </span>
          )
        ) : (
          <span>someone</span>
        )}
        <span>{age}</span>
      </span>
    </li>
  );
}
