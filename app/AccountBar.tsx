"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import PatchBay from "@/app/PatchBay";
import SongsMenu from "@/app/SongsMenu";
import SaveButton from "@/app/SaveButton";
import NewSongButton from "@/app/NewSongButton";
import ComposeChat from "@/app/ComposeChat";
import JamPanel from "@/app/JamPanel";
import { getOpenSong } from "@/app/songs/openSong";
import { IconHelp, IconMenu } from "@/app/menuIcons";
import Avatar from "@/app/Avatar";
import SongByline from "@/app/SongByline";
import type { LinkedSongCard } from "@/app/songs/linkedSongTitle";
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
  avatarGrid = null,
  serverKey = false,
  viewing = null,
}: {
  name: string | null;
  username?: string | null;
  /** The step-grid avatar (app/profile/avatarGrid.js); null draws the one
   *  the name generates. */
  avatarGrid?: string | null;
  /** Whether this deploy has an Anthropic key of its own. The compose panel
   *  needs it to know whether composing on the SITE's key is on offer at all
   *  — a visitor's own key works either way. */
  serverKey?: boolean;
  /** Someone else's song, named by the URL: drawn as "title by @owner". */
  viewing?: LinkedSongCard | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  // The bar is pinned to the top, and so is the transport directly under it —
  // two sticky siblings both at `top: 0` would pile up on the same line the
  // moment the page scrolled. The transport takes this bar's height as its
  // own offset instead (`--sq-topbar-h`, read in public/style.css).
  //
  // Measured rather than written down: the height is whatever 12px monospace
  // and a row of bordered buttons come out at, and a constant that was a pixel
  // wrong would show as a seam or a clipped border for every visitor. A
  // ResizeObserver rather than a one-off read, because the row is also what
  // changes when the layout crosses 768px.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty(
        "--sq-topbar-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sq-topbar-h");
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // A tap on anything in the sheet closes it, `save`/`songs`/`compose`/`jam`
  // included: those open a panel of their own (a `.songsWrap`), but that panel
  // is `position: fixed` and outlives the accordion just fine once `.barItems`
  // stops hiding the wrapper holding it (see `.barItems:has(.panel)` in
  // ui.module.css) -- so nothing here has to know which button it was.
  const onItemClick = useCallback(() => setMenuOpen(false), []);

  // On a phone the transport's master level meter and beat dial sit here,
  // beside `menu`: the bar is pinned, so both stay in view however far down
  // the tracks you are. They are the engine's own elements MOVED (beat.js finds
  // the dial by id and meters.js the meter by class, so each paints wherever it
  // is), not copies to keep in step. They go home again when the layout widens
  // past 768px and when this bar unmounts, before React takes the slot away
  // with them.
  const beatSlotRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const slot = beatSlotRef.current;
    if (!slot) return;
    const moved = [
      document.querySelector<HTMLElement>(".sq-meter--master"),
      document.getElementById("beat-indicator"),
    ]
      .filter((el): el is HTMLElement => !!el && !!el.parentNode)
      .map((el) => ({ el, home: el.parentNode as Node, next: el.nextSibling }));
    if (!moved.length) return;
    const goHome = () => {
      for (const { el, home, next } of moved) {
        if (el.parentNode === home) continue;
        if (next && next.parentNode === home) home.insertBefore(el, next);
        else home.appendChild(el);
      }
    };
    const mq = window.matchMedia("(max-width: 768px)");
    const place = () => {
      if (!mq.matches) return goHome();
      for (const { el } of moved) slot.appendChild(el);
    };
    place();
    mq.addEventListener("change", place);
    return () => {
      mq.removeEventListener("change", place);
      goHome();
    };
  }, []);

  return (
    <div
      ref={barRef}
      className={`${styles.topBar} ${menuOpen ? styles.topBarMenuOpen : ""}`}
    >
      {viewing && <SongByline song={viewing} />}
      <span ref={beatSlotRef} className={styles.beatSlot} aria-hidden />
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
      {/* Always mounted (CSS decides visibility) so it can dim behind a panel
          that outlived the sheet, not just behind the sheet itself. Its click
          handler only ever needs to close the accordion -- a panel left open
          under it already closes itself on the same outside click via its own
          document listener. */}
      <div
        className={styles.sheetBackdrop}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />
      <div
        id="topbar-items"
        className={`${styles.barItems} ${menuOpen ? styles.barItemsOpen : ""}`}
        onClick={onItemClick}
      >
        <NewSongButton />
        {name && <SaveButton />}
        {/* Outside the signed-in branch on purpose: compose runs on the
            visitor's own Anthropic key when they have one, and that needs no
            account. Signed in with a key on the deploy, the panel offers the
            choice. */}
        <ComposeChat signedIn={!!name} serverKey={serverKey} />
        <button
          className={styles.shareBtn}
          onClick={() => window.seqbaby?.onShareSet?.(getOpenSong().title)}
          title="create a shareable link for this session"
        >
          share
        </button>
        {/* Outside the signed-in branch too: a jam needs nobody to have an
            account, only the link. The account's name is what a signed-in
            member is called in the room. */}
        <JamPanel accountName={name} accountUsername={username ?? null} />
        {name ? (
          <>
            <PatchBay />
            <SongsMenu />
            {/* Your face and name ARE the way into your settings; the page
                you show other people is one link further, from there. */}
            <a className={styles.accountName} title="your settings" href="/settings">
              <Avatar grid={avatarGrid} name={username || name} size={20} />
              <span className={styles.accountNameText}>{name}</span>
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
      {/* Last in the row, so the far right: the manual, as a question mark. */}
      <a className={styles.manualLink} href="/manual" title="how seqbaby works" aria-label="manual">
        <IconHelp />
      </a>
    </div>
  );
}
