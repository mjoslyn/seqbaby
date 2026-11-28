import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/app/profile/actions";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { effectivePlan, isAdminEmail } from "@/lib/plans.js";
import { planRow } from "@/lib/data/admin.js";
import ProfileForm from "./ProfileForm";
import AccountSettings from "./AccountSettings";
import PatchManager from "./PatchManager";
import SetManager from "./SetManager";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const user = await currentUser();
  const env = await cfEnv();
  const admin = isAdminEmail(user?.email, env.ADMIN_EMAILS);
  const plan = user ? effectivePlan(await planRow(env, user.id)) : null;

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <nav className={styles.pageNav}>
          <Link href="/studio">← studio</Link>
          {profile.username && (
            <Link href={`/u/${profile.username}`}>view my profile</Link>
          )}
          {admin && <Link href="/admin">admin</Link>}
        </nav>
        <h1 className={styles.pageTitle}>profile settings</h1>
        <p className={styles.pageSub}>
          Your profile showcases the songs, patches and sets you publish.
        </p>
        <p className={styles.pageSub}>
          plan: <b>{admin ? "admin" : plan?.label ?? "free"}</b>
          {!admin && plan?.id === "free" ? (
            <> · {plan.turns} compose turns a month on Haiku · <Link href="/pro">request pro</Link></>
          ) : (
            <> · <Link href="/pro">plans</Link></>
          )}
        </p>
        <ProfileForm profile={profile} />
        <AccountSettings email={user?.email ?? ""} />
        <PatchManager />
        <SetManager />
      </div>
    </div>
  );
}
