"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "@/app/auth/actions";
import SongsMenu from "@/app/SongsMenu";
import SaveButton from "@/app/SaveButton";
import NewSongButton from "@/app/NewSongButton";
import ComposeChat from "@/app/ComposeChat";
import { IconMenu } from "@/app/menuIcons";
import styles from "@/app/ui.module.css";

// A dedicated account bar that sits above the transport (rendered as the first
// element on the page, ahead of the engine markup).
//
// On a phone the row does not fit: eight items at 12px in 375px of viewport ran
// off the right-hand edge, taking `sign out`, `settings` and half the account
// name with them — and the bar has `justify-content: flex-end`, so what was cut
// was cut with no way to scroll to it. So on mobile the items collapse behind
// one `menu` button and open as a sheet under the bar.
//
// The items are rendered ONCE and moved by CSS, not duplicated into a separate
// mobile menu: `SaveButton` and `SongsMenu` each hold their own open state, the
// name they have offered and a list fetched from the server, and two live
// copies of that would be two answers to "what is this song called".
export function AccountBar({
  name,
  username,
}: {
  name: string | null;
  username?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // A tap on anything in the sheet is a finished action, so the sheet gets out
  // of the way — except on `save` and `songs`, whose whole job is to open a
  // panel of their own. Those two are the `songsWrap` wrappers, so one test on
  // the way up covers both and nothing has to be told about the sheet.
  const onItemClick = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.(`.${styles.songsWrap}`)) return;
    setMenuOpen(false);
  }, []);

  return (
    <div
      className={`${styles.topBar} ${menuOpen ? styles.topBarMenuOpen : ""}`}
    >
      <a className={styles.manualLink} href="/manual" title="how seqbaby works">
        manual
      </a>
      <button
        className={styles.menuBtn}
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-controls="topbar-items"
        aria-label={menuOpen ? "close menu" : "open menu"}
      >
        <IconMenu on={menuOpen} />
        menu
      </button>
      {menuOpen && (
        <div
          className={styles.sheetBackdrop}
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
      )}
      <div
        id="topbar-items"
        className={`${styles.barItems} ${menuOpen ? styles.barItemsOpen : ""}`}
        onClick={onItemClick}
      >
        <NewSongButton />
        {name && <SaveButton />}
        <button
          className={styles.shareBtn}
          onClick={() => window.seqbaby?.onShareSet?.()}
          title="create a shareable link for this session"
        >
          share
        </button>
        {name ? (
          <>
            <ComposeChat />
            <SongsMenu />
            <a
              className={styles.accountName}
              title="your profile"
              href={username ? `/u/${username}` : "/settings"}
            >
              {name}
            </a>
            <a className={styles.accountBtn} href="/settings">
              settings
            </a>
            <form action={signOut}>
              <button className={styles.accountBtn} type="submit">
                sign out
              </button>
            </form>
          </>
        ) : (
          <a className={styles.accountBtn} href="/login">
            sign in
          </a>
        )}
      </div>
    </div>
  );
}
