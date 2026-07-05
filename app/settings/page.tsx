import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/app/profile/actions";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";
import AccountSettings from "./AccountSettings";
import PatchManager from "./PatchManager";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        <AccountSettings email={user?.email ?? ""} />
        <PatchManager />
      </div>
    </div>
  );
}
