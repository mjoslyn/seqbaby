import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicProfile } from "@/app/profile/actions";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `${username} · seqbaby` };
}

function fmtDate(iso: string) {
  return iso.slice(0, 10);
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const res = await getPublicProfile(username);

  if ("notFound" in res) notFound();

  if ("private" in res) {
    return (
      <div className={styles.page}>
        <div className={styles.pageInner}>
          <nav className={styles.pageNav}>
            <Link href="/">← studio</Link>
          </nav>
          <h1 className={styles.pageTitle}>@{res.username}</h1>
          <p className={styles.pageSub}>This profile is private.</p>
        </div>
      </div>
    );
  }

  const { profile, isOwner, songs, patches } = res;
  const name = profile.display_name || profile.username || "anon";

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <nav className={styles.pageNav}>
          <Link href="/">← studio</Link>
          {isOwner && <Link href="/settings">edit profile</Link>}
        </nav>

        <div className={styles.profileHead}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.avatar} src={profile.avatar_url} alt="" />
          ) : (
            <div className={styles.avatar}>{initials(name)}</div>
          )}
          <div>
            <div className={styles.profileName}>
              {name}
              {isOwner && !profile.is_public && (
                <span className={styles.privateBadge}>private</span>
              )}
            </div>
            {profile.username && (
              <div className={styles.profileHandle}>@{profile.username}</div>
            )}
          </div>
        </div>
        {profile.bio && <p className={styles.profileBio}>{profile.bio}</p>}

        <div className={styles.sectionHead}>
          <h3>sessions</h3>
          <span className={styles.sectionCount}>{songs.length}</span>
        </div>
        {songs.length === 0 ? (
          <div className={styles.emptyBig}>no published sessions yet</div>
        ) : (
          songs.map((s) => (
            <div className={styles.repoRow} key={s.id}>
              <div className={styles.repoMain}>
                {s.share_slug ? (
                  <Link className={styles.repoName} href={`/?s=${s.share_slug}`}>
                    {s.title}
                  </Link>
                ) : (
                  <span className={styles.repoName}>{s.title}</span>
                )}
                <div className={styles.repoMeta}>
                  updated {fmtDate(s.updated_at)}
                </div>
              </div>
              {s.share_slug && (
                <Link className={styles.repoAction} href={`/?s=${s.share_slug}`}>
                  open
                </Link>
              )}
            </div>
          ))
        )}

        <div className={styles.sectionHead}>
          <h3>patches</h3>
          <span className={styles.sectionCount}>{patches.length}</span>
        </div>
        {patches.length === 0 ? (
          <div className={styles.emptyBig}>no published patches yet</div>
        ) : (
          patches.map((p) => (
            <div className={styles.repoRow} key={p.id}>
              <div className={styles.repoMain}>
                <span className={styles.repoName}>{p.name}</span>
                <div className={styles.repoMeta}>
                  {p.engine_type ? `${p.engine_type} · ` : ""}
                  {fmtDate(p.created_at)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
