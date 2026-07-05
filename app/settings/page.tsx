import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/app/profile/actions";
import ProfileForm from "./ProfileForm";
import PatchManager from "./PatchManager";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <nav className={styles.pageNav}>
          <Link href="/">← studio</Link>
          {profile.username && (
            <Link href={`/u/${profile.username}`}>view my profile</Link>
          )}
        </nav>
        <h1 className={styles.pageTitle}>profile settings</h1>
        <p className={styles.pageSub}>
          Your profile showcases the sessions and patches you publish.
        </p>
        <ProfileForm profile={profile} />
        <PatchManager />
      </div>
    </div>
  );
}
