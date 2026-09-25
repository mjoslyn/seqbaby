import PlayButton from "../PlayButton";
import Avatar from "../Avatar";
import LikeButton from "../LikeButton";
import SavePatchButton from "../SavePatchButton";
import { canPreview, engineLabel, patchKey } from "./patchPreview";
import PatchRoll from "./PatchRoll";
import type { FeedPatch } from "./feed";
import styles from "./home.module.css";

// A patch in the gallery, laid out like a song card. A patch has no notes of
// its own, so the picture is the phrase the play button plays on it
// (patchPreview.js): the same list drawn and heard.

export default function PatchCard({ patch, age }: { patch: FeedPatch; age: string }) {
  return (
    <li className={styles.card}>
      {canPreview(patch.engine) && <PlayButton slug={patchKey(patch.id)} title={patch.name} />}
      <span className={styles.print}>
        <PatchRoll patch={patch} svgClass={styles.printSvg} laneClass={styles.rollLane} noteClass={styles.printOn} />
      </span>
      <span className={styles.cardTitle}>{patch.name}</span>
      <span className={styles.cardMeta}>
        <span className={styles.engineTag}>{engineLabel(patch.engine)}</span>
        {patch.owner ? (
          patch.owner.handle ? (
            <a className={styles.cardOwner} href={`/u/${patch.owner.handle}`}>
              <Avatar grid={patch.owner.avatarGrid} name={patch.owner.handle} size={18} />@{patch.owner.handle}
            </a>
          ) : (
            <span className={styles.cardOwner}>
              <Avatar grid={patch.owner.avatarGrid} name={patch.owner.name} size={18} />
              {patch.owner.name}
            </span>
          )
        ) : (
          <span>someone</span>
        )}
        <span>{age}</span>
        <LikeButton songId={patch.id} kind="patch" likes={patch.likes} className={styles.like} likedClassName={styles.liked} />
        <SavePatchButton patchId={patch.id} name={patch.name} className={styles.savePatch} savedClassName={styles.saved} />
      </span>
    </li>
  );
}
