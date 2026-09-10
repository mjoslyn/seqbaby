"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listVersions,
  loadVersion,
  labelVersion,
  deleteVersion,
  forkSong,
  type SongVersion,
} from "@/app/songs/actions";
import { layoutVersions } from "@/app/songs/versionTree";
import styles from "@/app/ui.module.css";

type Node = { v: SongVersion; depth: number; branch: boolean };

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// One song's version history, drawn as the tree it is. Clicking a version loads
// it into the studio and points the next save at it, which is what makes saving
// from an older version a branch rather than an overwrite.
export default function VersionTree({
  songId,
  baseVersionId,
  onOpen,
  onChanged,
  setStatus,
}: {
  songId: string;
  baseVersionId: string | null;
  /** Called with the version whose blob is now in the studio. */
  onOpen: (versionId: string, title?: string) => void;
  /** Something outside this tree changed (a fork made a new song). */
  onChanged: () => void;
  setStatus: (s: { text: string; err?: boolean }) => void;
}) {
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listVersions(songId);
    if (res.error) return setStatus({ text: res.error, err: true });
    setNodes(layoutVersions(res.versions) as Node[]);
    setCurrentId(res.currentId ?? null);
  }, [songId, setStatus]);

  useEffect(() => {
    refresh();
  }, [refresh, baseVersionId]);

  const open = useCallback(
    async (v: SongVersion) => {
      const res = await loadVersion(v.id);
      if (res.error || res.data === undefined)
        return setStatus({ text: res.error ?? "Version not found", err: true });
      try {
        window.seqbaby?.applySet(res.data);
      } catch (e) {
        return setStatus({
          text: `Load failed: ${(e as Error).message}`,
          err: true,
        });
      }
      onOpen(v.id, res.title);
      setStatus({
        text:
          v.id === currentId
            ? `Loaded v${v.seq}`
            : `Loaded v${v.seq} — saving branches from here`,
      });
    },
    [currentId, onOpen, setStatus],
  );

  const rename = useCallback(
    async (v: SongVersion) => {
      const next = window.prompt("name this version", v.label ?? "");
      if (next === null) return;
      const res = await labelVersion(v.id, next);
      if (res.error) return setStatus({ text: res.error, err: true });
      refresh();
    },
    [refresh, setStatus],
  );

  const fork = useCallback(
    async (v: SongVersion) => {
      setStatus({ text: "Forking…" });
      const res = await forkSong(songId, v.id);
      if (res.error || !res.id)
        return setStatus({ text: res.error ?? "Fork failed", err: true });
      setStatus({ text: `v${v.seq} forked into "${res.title}"` });
      onChanged();
    },
    [songId, onChanged, setStatus],
  );

  const prune = useCallback(
    async (v: SongVersion) => {
      const res = await deleteVersion(v.id);
      if (res.error) return setStatus({ text: res.error, err: true });
      setStatus({ text: `Deleted v${v.seq}` });
      refresh();
    },
    [refresh, setStatus],
  );

  if (!nodes) return <div className={styles.empty}>loading history…</div>;
  if (!nodes.length) return <div className={styles.empty}>no versions yet</div>;

  return (
    <div className={styles.verTree}>
      {nodes.map(({ v, depth, branch }) => {
        const isBase = v.id === baseVersionId;
        const isTip = v.id === currentId;
        return (
          <div
            className={styles.verRow}
            key={v.id}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <button
              className={`${styles.verTitle} ${isBase ? styles.verActive : ""}`}
              onClick={() => open(v)}
              title="load this version into the studio"
            >
              <span className={styles.verMark}>
                {isBase ? "▸" : branch ? "└" : "·"}
              </span>
              v{v.seq}
              {v.label ? ` ${v.label}` : ""}
              {isTip && <span className={styles.verTip}> current</span>}
            </button>
            <span className={styles.verMeta}>{ago(v.created_at)}</span>
            <button
              className={styles.iconBtn}
              onClick={() => rename(v)}
              title="name this version"
            >
              name
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => fork(v)}
              title="fork this version into a song of its own"
            >
              fork
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => prune(v)}
              title="delete this version (only if nothing branches off it)"
            >
              del
            </button>
          </div>
        );
      })}
    </div>
  );
}
