import { signOut } from "@/app/auth/actions";
import SongsMenu from "@/app/SongsMenu";
import styles from "@/app/ui.module.css";

// Floating account indicator, top-right of the studio. Server component: the
// signed-in name is resolved in the page and passed in; sign-out is a server action.
export function AccountBar({ name }: { name: string | null }) {
  return (
    <div className={styles.accountBar}>
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
