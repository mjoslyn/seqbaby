import { PALETTE, SIZE, gridFor } from "@/app/profile/avatarGrid";

// A person's avatar: their step grid (app/profile/avatarGrid.js), drawn like
// the studio's step grid -- lit steps in the studio's colours, unlit ones
// dark, every fourth column a shade lighter where the beat falls. Someone who
// never drew one gets the grid their name generates, so there is no empty
// circle and no pair of initials anywhere.
//
// Pure SVG with no hooks, so server pages and client islands draw it alike.
// Below 40px the gaps between steps go: at 16 cells across, a one-unit gap
// at that size is most of a pixel and the picture turns to mesh.

const CELL = 4;

export default function Avatar({
  grid,
  name,
  size = 32,
  className,
  title,
  step = -1,
}: {
  /** The stored `avatar_grid`, or null/undefined for the name's default. */
  grid: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
  title?: string;
  /** The playhead's column while it plays (PlayableAvatar), -1 when still. */
  step?: number;
}) {
  const g = gridFor(grid, name);
  const gap = size >= 40 ? 1 : 0;
  const span = SIZE * (CELL + gap) + gap;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      shapeRendering={gap ? undefined : "crispEdges"}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none", borderRadius: Math.max(3, size / 8) }}
    >
      <rect width={span} height={span} fill="#15171c" />
      {g.cells.map((v, i) => {
        const c = i % SIZE;
        const fill = v ? PALETTE[v]?.hex : gap ? (c % 4 === 0 ? "#333846" : "#2a2e38") : null;
        if (!fill) return null;
        return (
          <rect
            key={i}
            x={gap + c * (CELL + gap)}
            y={gap + Math.floor(i / SIZE) * (CELL + gap)}
            width={CELL}
            height={CELL}
            rx={gap ? 0.7 : 0}
            fill={fill}
          />
        );
      })}
      {step >= 0 && (
        <rect
          x={step * (CELL + gap)}
          y={0}
          width={CELL + 2 * gap}
          height={span}
          fill="#ffffff"
          opacity={0.28}
        />
      )}
    </svg>
  );
}
