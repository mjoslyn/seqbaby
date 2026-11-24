import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { setMeta } from "@/lib/data/sets.js";
import { profileCards } from "@/lib/data/profiles.js";
import { clockLabel } from "@/lib/setRecording.js";
import SetPlayer from "./SetPlayer";
import styles from "@/app/ui.module.css";

export const dynamic = "force-dynamic";

// The set player: a recorded live set (public/js/setRecorder.js) played back
// through the real studio, in a frame, with every clip launch, deck move, knob
// turn and edit landing on the step it was made on. Pause holds the place;
// fork takes the studio as it stands into a new set.

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  const meta = await setMeta(env, userId, id).catch(() => null);
  if (!meta) return null;
  const ids = [meta.ownerId];
  let from: { id: string; title: string } | null = null;
  if (meta.forkedFrom) {
    const src = await setMeta(env, userId, meta.forkedFrom).catch(() => null);
    if (src) { from = { id: src.id, title: src.title }; ids.push(src.ownerId); }
  }
  const cards = await profileCards(env, ids).catch(() => []);
  const owner = cards.find((c: { id: string }) => c.id === meta.ownerId) as { username?: string } | undefined;
  return { meta, owner: owner?.username ?? null, from };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const got = await load(id);
  if (!got) return { title: "set · seqbaby" };
  const by = got.owner ? ` by ${got.owner}` : "";
  return {
    title: `${got.meta.title}${by} · seqbaby`,
    description: `A live set${by}, ${clockLabel(got.meta.seconds)} long, played back in seqbaby's studio: every clip, knob and crossfade as it happened.`,
  };
}

export default async function SetPage({ params }: Params) {
  const { id } = await params;
  const got = await load(id);
  if (!got) notFound();
  const { meta, owner, from } = got;
  return (
    <div className={styles.page}>
      <div className={styles.pageInner} style={{ maxWidth: "none" }}>
        <nav className={styles.pageNav}>
          <Link href="/studio">← studio</Link>
          {owner && <Link href={`/u/${owner}`}>@{owner}</Link>}
        </nav>
        <h1 className={styles.pageTitle}>{meta.title}</h1>
        <p className={styles.pageSub}>
          {owner ? <>a live set by <Link href={`/u/${owner}`}>@{owner}</Link> · </> : null}
          {clockLabel(meta.seconds)}
          {meta.decks ? ` · ${meta.decks + 1} decks` : ""}
          {meta.bpm ? ` · ${Math.round(meta.bpm)} bpm` : ""}
          {!meta.isPublic ? " · private" : ""}
          {from ? (
            <>
              {" · forked from "}
              <Link href={`/set/${from.id}`}>{from.title}</Link>
            </>
          ) : null}
        </p>
        <SetPlayer id={meta.id} title={meta.title} owned={meta.owned} isPublic={meta.isPublic} />
      </div>
    </div>
  );
}
