import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicProfile } from "@/app/profile/actions";
import ForkButton from "@/app/ForkButton";
import LikeButton from "@/app/LikeButton";
import SavePatchButton from "@/app/SavePatchButton";
import PlayButton from "@/app/PlayButton";
import PlayableAvatar from "@/app/PlayableAvatar";
import SongPreview from "@/app/SongPreview";
import PatchRoll from "@/app/home/PatchRoll";
import { canPreview, engineLabel, patchEngineKey, patchKey } from "@/app/home/patchPreview";
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
            <Link href="/studio">← studio</Link>
          </nav>
          <h1 className={styles.pageTitle}>@{res.username}</h1>
          <p className={styles.pageSub}>This profile is private.</p>
        </div>
      </div>
    );
  }

  const { profile, isOwner, songs, patches } = res;
  const name = profile.username || profile.display_name || "anon";

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <nav className={styles.pageNav}>
          <Link href="/studio">← studio</Link>
          {isOwner && <Link href="/settings">edit profile</Link>}
        </nav>

        <div className={styles.profileHead}>
          <PlayableAvatar grid={profile.avatar_grid} name={name} size={72} />
          <div>
            <div className={styles.profileName}>
              {name}
              {isOwner && !profile.is_public && (
                <span className={styles.privateBadge}>private</span>
              )}
            </div>
            {profile.username && profile.username !== name && (
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
              {s.share_slug ? <PlayButton slug={s.share_slug} title={s.title} variant="row" /> : null}
              {s.preview ? (
                <div className={styles.repoPreview}>
                  <SongPreview preview={s.preview} height="100%" />
                </div>
              ) : null}
              <div className={styles.repoMain}>
                {s.share_slug ? (
                  <Link className={styles.repoName} href={`/studio?s=${s.share_slug}`}>
                    {s.title}
                  </Link>
                ) : (
                  <span className={styles.repoName}>{s.title}</span>
                )}
                <div className={styles.repoMeta}>
                  {s.forkedFrom ? (
                    <>
                      ⑂ forked from {s.forkedFrom.title}
                      {s.forkedFrom.username && (
                        <>
                          {" by "}
                          <Link href={`/u/${s.forkedFrom.username}`}>
                            @{s.forkedFrom.username}
                          </Link>
                        </>
                      )}
                      {" · "}
                    </>
                  ) : s.forked_from ? (
                    "⑂ fork · "
                  ) : null}
                  updated {fmtDate(s.updated_at)}
                </div>
              </div>
              <LikeButton
                songId={s.id}
                likes={s.likes ?? 0}
                className={styles.repoAction}
                likedClassName={styles.repoLiked}
              />
              <ForkButton songId={s.id} className={styles.repoAction} forkedClassName={styles.repoSaved} />
              {s.share_slug && (
                <Link className={styles.repoAction} href={`/studio?s=${s.share_slug}`}>
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
          patches.map((p) => {
            // The same picture and the same player as a homepage patch card.
            const engine = patchEngineKey({ _kind: p.kind, engineKey: p.engine });
            const roll = {
              engine,
              drum: typeof p.drum === "boolean" ? p.drum : null,
              name: p.name,
              sampleId: p.sample,
            };
            return (
              <div className={styles.repoRow} key={p.id}>
                {canPreview(engine) ? <PlayButton slug={patchKey(p.id)} title={p.name} variant="row" /> : null}
                <div className={styles.repoPreview}>
                  <PatchRoll
                    patch={roll}
                    svgClass={styles.rollSvg}
                    laneClass={styles.rollLane}
                    noteClass={styles.rollNote}
                  />
                </div>
                <div className={styles.repoMain}>
                  <span className={styles.repoName}>{p.name}</span>
                  <div className={styles.repoMeta}>
                    {engineLabel(engine)} · {fmtDate(p.created_at)}
                  </div>
                </div>
                <LikeButton
                  songId={p.id}
                  kind="patch"
                  likes={p.likes ?? 0}
                  className={styles.repoAction}
                  likedClassName={styles.repoLiked}
                />
                <SavePatchButton
                  patchId={p.id}
                  name={p.name}
                  className={styles.repoAction}
                  savedClassName={styles.repoSaved}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
