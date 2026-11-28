import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/app/profile/actions";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { isAdminEmail } from "@/lib/plans.js";
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
  const admin = isAdminEmail(user?.email, (await cfEnv()).ADMIN_EMAILS);

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
        <ProfileForm profile={profile} />
        <AccountSettings email={user?.email ?? ""} />
        <PatchManager />
        <SetManager />
      </div>
    </div>
  );
}
