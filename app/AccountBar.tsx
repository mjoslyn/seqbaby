"use client";

import { signOut } from "@/app/auth/actions";
import SongsMenu from "@/app/SongsMenu";
import styles from "@/app/ui.module.css";

// A dedicated account bar that sits above the transport (rendered as the first
// element on the page, ahead of the engine markup).
export function AccountBar({ name }: { name: string | null }) {
  return (
    <div className={styles.topBar}>
      <button
        className={styles.shareBtn}
        onClick={() => window.seqbaby?.onShareSet?.()}
        title="create a shareable link for this session"
      >
        share
      </button>
      {name ? (
        <>
          <SongsMenu />
          <span className={styles.accountName} title={name}>
            {name}
          </span>
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
  );
}
