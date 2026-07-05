"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  publishPatch,
  listPublicPatches,
  getPatch,
  deletePatch,
  type PublicPatch,
} from "@/app/patches/actions";
import styles from "@/app/ui.module.css";

type LocalPatch = { name: string; config: unknown };

// Best-effort engine label pulled from a patch config for display/metadata.
function engineTypeOf(config: unknown): string | null {
  const c = config as Record<string, unknown> | null;
  const synth = c?.synth as Record<string, unknown> | undefined;
  return (
    (typeof c?.type === "string" && c.type) ||
    (typeof synth?.type === "string" && synth.type) ||
    null
  );
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(n)) return n;
  }
  return `${base} ${Date.now()}`;
}

export default function PatchesMenu() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"mine" | "browse">("browse");
  const [local, setLocal] = useState<LocalPatch[]>([]);
  const [pub, setPub] = useState<PublicPatch[]>([]);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.seqbaby) return setReady(true);
    const onReady = () => setReady(true);
    window.addEventListener("seqbaby:ready", onReady);
    return () => window.removeEventListener("seqbaby:ready", onReady);
  }, []);

  const readLocal = useCallback(() => {
    const all = (window.seqbaby?.loadPatches() ?? {}) as Record<string, unknown>;
    setLocal(Object.entries(all).map(([name, config]) => ({ name, config })));
  }, []);

  const refreshPublic = useCallback(async () => {
    const res = await listPublicPatches();
    if (res.error) setStatus({ text: res.error, err: true });
    else setPub(res.patches);
  }, []);

  useEffect(() => {
    if (!open) return;
    readLocal();
    refreshPublic();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, readLocal, refreshPublic]);

  const doPublish = useCallback(
    async (p: LocalPatch) => {
      setStatus({ text: "Publishing…" });
      const res = await publishPatch({
        name: p.name,
        engine_type: engineTypeOf(p.config),
        config: p.config,
      });
      if (res.error) return setStatus({ text: res.error, err: true });
      setStatus({ text: `Published "${p.name}"` });
      refreshPublic();
    },
    [refreshPublic],
  );

  const doImport = useCallback(async (p: PublicPatch) => {
    const res = await getPatch(p.id);
    if (res.error || res.config === undefined)
      return setStatus({ text: res.error ?? "Import failed", err: true });
    const taken = new Set(Object.keys(window.seqbaby?.loadPatches() ?? {}));
    const name = uniqueName(res.name || p.name, taken);
    window.seqbaby?.savePatch(name, res.config);
    setStatus({ text: `Imported as "${name}"` });
  }, []);

  const doDelete = useCallback(
    async (p: PublicPatch) => {
      const res = await deletePatch(p.id);
      if (res.error) return setStatus({ text: res.error, err: true });
      setStatus({ text: "Removed" });
      refreshPublic();
    },
    [refreshPublic],
  );

  if (!ready) return null;

  return (
    <div className={styles.songsWrap} ref={wrapRef}>
      <button
        className={styles.accountBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        patches
      </button>
      {open && (
        <div className={styles.panel}>
          <div className={styles.saveRow}>
            <button
              className={`${styles.smallBtn} ${tab === "browse" ? styles.smallBtnPrimary : ""}`}
              onClick={() => setTab("browse")}
            >
              browse
            </button>
            <button
              className={`${styles.smallBtn} ${tab === "mine" ? styles.smallBtnPrimary : ""}`}
              onClick={() => setTab("mine")}
            >
              my patches
            </button>
          </div>
          <div className={styles.divider} />

          {tab === "browse" ? (
            pub.length === 0 ? (
              <div className={styles.empty}>no public patches yet</div>
            ) : (
              pub.map((p) => (
                <div className={styles.songRow} key={p.id}>
                  <span className={styles.songRowTitle} title={p.name}>
                    {p.name}
                    {p.author && (
                      <span className={styles.empty}> · {p.author}</span>
                    )}
                  </span>
                  <button
                    className={styles.iconBtn}
                    onClick={() => doImport(p)}
                    title="import into your patches"
                  >
                    import
                  </button>
                  {p.mine && (
                    <button
                      className={styles.iconBtn}
                      onClick={() => doDelete(p)}
                      title="remove from gallery"
                    >
                      del
                    </button>
                  )}
                </div>
              ))
            )
          ) : local.length === 0 ? (
            <div className={styles.empty}>
              no saved patches — save one from a track first
            </div>
          ) : (
            local.map((p) => (
              <div className={styles.songRow} key={p.name}>
                <span className={styles.songRowTitle} title={p.name}>
                  {p.name}
                </span>
                <button
                  className={styles.iconBtn}
                  onClick={() => doPublish(p)}
                  title="publish to the public gallery"
                >
                  publish
                </button>
              </div>
            ))
          )}

          <div
            className={`${styles.status} ${status.err ? styles.statusErr : ""}`}
          >
            {status.text}
          </div>
        </div>
      )}
    </div>
  );
}
