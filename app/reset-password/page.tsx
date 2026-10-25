import Link from "next/link";
import ResetForm from "./ResetForm";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

// Where a password reset link lands, via Better Auth's
// /api/auth/reset-password/<token>, which checks the token and sends the
// visitor here with it (`?token=`), or with `?error=` when it has expired or
// been used. The token itself is checked again when the new password is set.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" && !sp.error ? sp.token : "";

  return (
    <div className={styles.authWrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" />
          seqbaby
        </div>
        {token ? (
          <ResetForm token={token} />
        ) : (
          <>
            <p className={styles.error}>This reset link has expired or already been used.</p>
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
