"use client";

import { useCallback, useEffect, useState } from "react";
import { listMyPatches, deletePatch, setPatchPublic, type MyPatch } from "@/app/patches/actions";
import { syncBay } from "@/app/patches/patchSync";
import styles from "@/app/ui.module.css";

// Your patch bay (migration 0018): every patch saved in the studio or from a
// card, private until published. Publishing shows it in the gallery and on
// your profile; unpublishing takes it back out and keeps it; delete removes
// it from every studio you use.
export default function PatchManager() {
  const [patches, setPatches] = useState<MyPatch[]>([]);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });

  const refresh = useCallback(async () => {
    const res = await listMyPatches();
    if (res.error) setStatus({ text: res.error, err: true });
    else setPatches(res.patches);
  }, []);

  useEffect(() => {
    // Patches saved in this browser before the bay existed go up first.
    syncBay()
      .catch(() => {})
      .then(refresh);
  }, [refresh]);

  async function togglePublic(p: MyPatch) {
    const res = await setPatchPublic(p.id, !p.is_public);
    if (res.error) return setStatus({ text: res.error, err: true });
    setStatus({ text: p.is_public ? `Unpublished "${p.name}"` : `Published "${p.name}"` });
    refresh();
  }

  async function doDelete(p: MyPatch) {
    if (!window.confirm(`Delete "${p.name}" from your patches?`)) return;
    const res = await deletePatch(p.id);
    if (res.error) return setStatus({ text: res.error, err: true });
    setStatus({ text: `Deleted "${p.name}"` });
    refresh();
  }

  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>your patches</h3>
        <span className={styles.sectionCount}>{patches.length}</span>
      </div>
      {patches.length === 0 ? (
        <div className={styles.emptyBig}>
          Save a patch from a track in the studio (the disk icon), or from any
          patch card, and it lands here. Publish it to show it on your profile.
        </div>
      ) : (
        patches.map((p) => (
          <div className={styles.repoRow} key={p.id}>
            <div className={styles.repoMain}>
              <span className={styles.repoName}>{p.name}</span>
              <div className={styles.repoMeta}>
                {p.engine_type ? `${p.engine_type} · ` : ""}
                {p.is_public ? "published · " : ""}
                {p.created_at.slice(0, 10)}
              </div>
            </div>
            <button className={styles.repoAction} onClick={() => togglePublic(p)}>
              {p.is_public ? "unpublish" : "publish"}
            </button>
            <button className={styles.repoAction} onClick={() => doDelete(p)}>
              delete
            </button>
          </div>
        ))
      )}

      <div className={`${styles.status} ${status.err ? styles.statusErr : ""}`}>
        {status.text}
      </div>
    </div>
  );
}
