"use client";

import { useEffect, useRef, useState } from "react";
import { IconHelp } from "@/app/menuIcons";
import styles from "@/app/ui.module.css";

// The question mark at the end of the account bar: the manual, and the way to
// report a bug (/superbugs). Both open in a new tab, so neither leaves (and
// stops) the song you are in -- and hiding this tab is what writes the studio
// breadcrumb a bug report reads (StudioBreadcrumb.tsx).
//
// Same `.songsWrap` / `.panel` shell as the other bar menus, so on a phone it
// is the same bottom sheet, with the same backdrop, as save and songs.
export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`${styles.songsWrap} ${styles.helpWrap}`}>
      <button
        type="button"
        className={styles.manualLink}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="help"
        title="help"
      >
        <IconHelp />
      </button>
      {open && (
        <div className={`${styles.panel} ${styles.helpPanel}`} role="menu">
          <a
            className={styles.helpItem}
            href="/manual"
            target="_blank"
            rel="noopener"
            role="menuitem"
            title="how seqbaby works (opens in a new tab)"
            onClick={() => setOpen(false)}
          >
            manual
          </a>
          <a
            className={styles.helpItem}
            href="/superbugs"
            target="_blank"
            rel="noopener"
            role="menuitem"
            title="found a bug? tell us (opens in a new tab)"
            onClick={() => setOpen(false)}
          >
            report a bug
          </a>
        </div>
      )}
    </div>
  );
}
