"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getVersionSeq } from "@/app/songs/actions";
import { getOpenSong, subscribeOpenSong } from "@/app/songs/openSong";
import styles from "@/app/ui.module.css";

// Which of your songs the studio holds, and which version of it: "cold
// squelch v4", at the left of the top bar where SongByline names someone
// else's. The two never show together -- the byline goes as soon as the
// open-song slot gets an id, and this shows only once it has one.
//
// The number is looked up from the version id, because most of what sets the
// open song (a load, a save, a remix, compose's autosave) hands over the id.
const seqs = new Map<string, number>();

export default function OpenSongLabel() {
  const song = useSyncExternalStore(subscribeOpenSong, getOpenSong, () => null);
  const versionId = song?.versionId ?? null;
  const [seq, setSeq] = useState<{ id: string; n: number } | null>(null);

  useEffect(() => {
    if (!versionId) return;
    const known = seqs.get(versionId);
    if (known !== undefined) return setSeq({ id: versionId, n: known });
    let cancelled = false;
    getVersionSeq(versionId)
      .then((res) => {
        if (res.seq === undefined) return;
        seqs.set(versionId, res.seq);
        if (!cancelled) setSeq({ id: versionId, n: res.seq });
      })
      .catch(() => {
        /* the title alone still says what is open */
      });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  if (!song?.id) return null;
  const title = song.title || "untitled";
  const n = seq && seq.id === versionId ? seq.n : null;
  const full = `${title}${n !== null ? ` v${n}` : ""}${song.isTemplate ? " (template)" : ""}`;
  return (
    <span className={styles.byline} title={full}>
      <span className={styles.bylineTitle}>{title}</span>
      {n !== null && <span className={styles.bylineVersion}>v{n}</span>}
      {song.isTemplate && <span className={styles.bylineBy}>template</span>}
    </span>
  );
}
