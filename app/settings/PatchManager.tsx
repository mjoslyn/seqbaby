"use client";

import { useCallback, useEffect, useState } from "react";
import {
  publishPatch,
  listMyPatches,
  deletePatch,
  type MyPatch,
} from "@/app/patches/actions";
import styles from "@/app/ui.module.css";

type LocalPatch = { name: string; config: unknown };
const PATCHES_KEY = "seqbaby.patches.v1";

function engineOf(config: unknown): string | null {
  const c = config as Record<string, unknown> | null;
  return (typeof c?.engineKey === "string" && c.engineKey) || null;
}

export default function PatchManager() {
  const [local, setLocal] = useState<LocalPatch[]>([]);
  const [published, setPublished] = useState<MyPatch[]>([]);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });

  const readLocal = useCallback(() => {
    try {
      const all = JSON.parse(localStorage.getItem(PATCHES_KEY) || "{}");
      setLocal(
        Object.entries(all).map(([name, config]) => ({ name, config })),
      );
    } catch {
      setLocal([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await listMyPatches();
    if (res.error) setStatus({ text: res.error, err: true });
    else setPublished(res.patches);
  }, []);

  useEffect(() => {
    readLocal();
    refresh();
  }, [readLocal, refresh]);

  async function doPublish(p: LocalPatch) {
    setStatus({ text: "Publishing…" });
    const res = await publishPatch({
      name: p.name,
      engine_type: engineOf(p.config),
      config: p.config,
    });
    if (res.error) return setStatus({ text: res.error, err: true });
    setStatus({ text: `Published "${p.name}"` });
    refresh();
  }

  async function doDelete(p: MyPatch) {
    const res = await deletePatch(p.id);
    if (res.error) return setStatus({ text: res.error, err: true });
    setStatus({ text: "Unpublished" });
    refresh();
  }

  const publishedNames = new Set(published.map((p) => p.name));

  return (
    <div>
      <div className={styles.sectionHead}>
        <h3>your saved patches</h3>
        <span className={styles.sectionCount}>{local.length}</span>
      </div>
      {local.length === 0 ? (
        <div className={styles.emptyBig}>
          Save a patch from a track in the studio (the disk icon), then publish
          it here to show it on your profile.
        </div>
      ) : (
        local.map((p) => (
          <div className={styles.repoRow} key={p.name}>
            <div className={styles.repoMain}>
              <span className={styles.repoName}>{p.name}</span>
              <div className={styles.repoMeta}>
                {engineOf(p.config) ?? "patch"}
                {publishedNames.has(p.name) ? " · published" : ""}
              </div>
            </div>
            <button className={styles.repoAction} onClick={() => doPublish(p)}>
              publish
            </button>
          </div>
        ))
      )}

      <div className={styles.sectionHead}>
        <h3>published patches</h3>
        <span className={styles.sectionCount}>{published.length}</span>
      </div>
      {published.length === 0 ? (
        <div className={styles.emptyBig}>nothing published yet</div>
      ) : (
        published.map((p) => (
          <div className={styles.repoRow} key={p.id}>
            <div className={styles.repoMain}>
              <span className={styles.repoName}>{p.name}</span>
              <div className={styles.repoMeta}>
                {p.engine_type ? `${p.engine_type} · ` : ""}
                {p.created_at.slice(0, 10)}
              </div>
            </div>
            <button className={styles.repoAction} onClick={() => doDelete(p)}>
              unpublish
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
