import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "@/lib/recoveryCookie";
import ResetForm from "./ResetForm";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

// Where a password reset link lands, via /auth/confirm, already signed in.
// Without the recovery cookie there is nothing to reset: the link expired, was
// used, or this page was opened by hand.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const recovering = !!user && !!(await cookies()).get(RECOVERY_COOKIE);

  return (
    <div className={styles.authWrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" />
          seqbaby
        </div>
        {recovering ? (
          <ResetForm email={user.email ?? ""} />
        ) : (
          <>
            <p className={styles.error}>
              This reset link has expired or already been used.
            </p>
            <p className={styles.hint}>
              <Link href="/login?mode=reset">Send a new one</Link>
            </p>
          </>
        )}
        <p className={styles.hint}>
          <Link href="/studio">← back to the studio</Link>
        </p>
      </div>
    </div>
  );
}
