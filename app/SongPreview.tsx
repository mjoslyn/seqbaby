import { decodePreview } from "@/app/songs/songPreview";

// A song's steps, drawn: one row per track, one cell per step of the pattern
// it was saved on. The data is the `preview` column the database computes
// (migration 0012); decodePreview turns it into cells.
//
// No hooks and no "use client", so the server components (the homepage, a
// profile page) and the client ones (the songs menu) draw it the same way.
// Colours are inline styles over the studio's tokens, because an SVG
// presentation attribute cannot read a CSS variable and a CSS module would
// tie it to one page's stylesheet.

const ROW_COLORS = ["var(--accent)", "var(--accent-2)", "#ff9fd0", "#ffb86b", "#b69cff"];
const CELL = 4;
const DOT = 3;

export default function SongPreview({
  preview,
  className,
  height,
}: {
  preview: unknown;
  className?: string;
  /** CSS height; defaults to 8px per track, between 24 and 64. */
  height?: number | string;
}) {
  const p = decodePreview(preview);
  if (!p) return null;
  const w = p.cols * CELL;
  const h = p.rows.length * CELL;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{
        display: "block",
        width: "100%",
        height: height ?? Math.max(24, Math.min(64, p.rows.length * 8)),
      }}
    >
      {p.rows.map((row, y) => {
        const color = ROW_COLORS[y % ROW_COLORS.length];
        const top = y * CELL + (CELL - DOT) / 2;
        return row.cells.map((c, x) => {
          const left = x * CELL + (CELL - DOT) / 2;
          if (!c)
            return (
              <rect
                key={`${y}-${x}`}
                x={left}
                y={top}
                width={DOT}
                height={DOT}
                rx={0.5}
                style={{ fill: x % 4 === 0 ? "#333846" : "var(--step)" }}
              />
            );
          const opacity = row.gen === "chance" ? 0.5 : 0.35 + 0.65 * c.v;
          if (c.tie)
            // A held step: a bar from the cell before, so a note reads as one
            // shape across however many steps it lasts.
            return (
              <rect
                key={`${y}-${x}`}
                x={x * CELL - (CELL - DOT)}
                y={top + DOT * 0.25}
                width={CELL + (CELL - DOT) / 2 + 0.01}
                height={DOT * 0.5}
                style={{ fill: color, opacity }}
              />
            );
          return (
            <rect
              key={`${y}-${x}`}
              x={left}
              y={top}
              width={DOT}
              height={DOT}
              rx={row.gen === "chance" ? DOT / 2 : 0.5}
              style={{ fill: color, opacity }}
            />
          );
        });
      })}
    </svg>
  );
}
