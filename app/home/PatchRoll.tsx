import { PHRASE_STEPS, phraseFor, previewHint } from "./patchPreview";

// A patch's picture: the phrase its play button plays (patchPreview.js), over
// dim step lanes. No hooks, so the homepage card and a profile row share it.
// The note colour is the caller's: the homepage cycles it card by card.

export type RollPatch = { engine: string; drum: boolean | null; name: string; sampleId: string | null };

export default function PatchRoll({
  patch,
  svgClass,
  laneClass,
  noteClass,
}: {
  patch: RollPatch;
  svgClass?: string;
  laneClass?: string;
  noteClass?: string;
}) {
  const phrase = phraseFor(patch.engine, patch.drum ?? undefined, previewHint(patch.name, patch.sampleId));
  const W = PHRASE_STEPS * 4;
  const H = 16;
  const notes = phrase.steps.map((s) => s.note ?? 0);
  const lo = Math.min(...notes);
  const span = Math.max(1, Math.max(...notes) - lo);
  return (
    <svg className={svgClass} viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="none">
      {Array.from({ length: PHRASE_STEPS }, (_, i) => (
        <rect key={`g${i}`} x={i * 4 + 0.5} y={0} width={3} height={H} rx={0.6} className={laneClass} />
      ))}
      {phrase.steps.map((s) => {
        // A drum is a hit, drawn by how hard; a note sits at its pitch.
        const h = phrase.kind === "drum" ? 3 + s.vel * 11 : 3;
        const y = phrase.kind === "drum" ? H - h : (1 - ((s.note ?? lo) - lo) / span) * (H - 3);
        return (
          <rect key={s.i} x={s.i * 4 + 0.5} y={y} width={s.len * 4 - 1} height={h} rx={0.6} className={noteClass} />
        );
      })}
    </svg>
  );
}
