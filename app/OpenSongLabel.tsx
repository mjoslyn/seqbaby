"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getVersionSeq } from "@/app/songs/actions";
import { tellEngineSongName } from "@/app/songs/engineSongName";
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

  const title = song?.title || "untitled";
  const n = seq && seq.id === versionId ? seq.n : null;
  // The engine names a bounce with the same words this label shows. Only once
  // this has named something does a cleared slot clear the engine's too, or
  // mounting with nothing open would wipe the title SongByline handed over.
  const engineName = song?.id ? `${title}${n !== null ? ` v${n}` : ""}` : null;
  const told = useRef(false);
  useEffect(() => {
    if (!engineName && !told.current) return;
    told.current = !!engineName;
    tellEngineSongName(engineName);
  }, [engineName]);

  if (!song?.id) return null;
  const full = `${title}${n !== null ? ` v${n}` : ""}${song.isTemplate ? " (template)" : ""}`;
  return (
    <span className={styles.byline} title={full}>
      <span className={styles.bylineTitle}>{title}</span>
      {n !== null && <span className={styles.bylineVersion}>v{n}</span>}
      {song.isTemplate && <span className={styles.bylineBy}>template</span>}
    </span>
  );
}
