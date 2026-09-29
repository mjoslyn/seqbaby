import { ImageResponse } from "next/og";
import { SUPERBUG } from "@/app/superbugs/riff";
import { W, H, BG, PANEL, STEP, BEAT, FG, DIM, ROW_COLORS, HEADERS, Brand } from "../parts";

// The bug report page's link-preview image: a pixel bug, the page's line, and
// the riff its toy plays (app/superbugs/riff.ts), the melody drawn as a
// piano roll over the three drum lanes. Static, so it costs no reads.

export const runtime = "nodejs";

const PINK = "#ff6fa3";
const EYE = "#0e0f12";
const PER_BAR = 6; // 3/4 in eighths
// kick, snare, hat: not the pink of the melody, which the bug wears.
const LANE_COLORS = [ROW_COLORS[0], ROW_COLORS[1], ROW_COLORS[3]];

// A beetle from above: antennae, head, split wing cases, six legs. `x` body,
// `o` an eye, `.` nothing.
const BUG = [
  ".x.......x.",
  "..x.....x..",
  "...xxxxx...",
  "...xoxox...",
  "x..xxxxx..x",
  ".xxxx.xxxx.",
  "..xxx.xxx..",
  "xxxxx.xxxxx",
  "..xxx.xxx..",
  ".xxxx.xxxx.",
  "x..xx.xx..x",
  "....x.x....",
];

function Bug({ cell }: { cell: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", transform: "rotate(14deg)" }}>
      {BUG.map((row, y) => (
        <div key={y} style={{ display: "flex" }}>
          {row.split("").map((c, x) => (
            <div
              key={x}
              style={{
                width: cell,
                height: cell,
                background: c === "x" ? PINK : c === "o" ? EYE : "transparent",
                borderRadius: c === "." ? 0 : 2,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// The melody lane as a piano roll: one column per step, the note at its
// pitch, the steps the toy leaves silent drawn as an empty column.
function Roll({ width, height, gap }: { width: number; height: number; gap: number }) {
  const { blip, start, steps } = SUPERBUG;
  const lo = Math.min(...blip);
  const hi = Math.max(...blip);
  const cw = Math.floor((width - gap * (steps - 1)) / steps);
  const nh = Math.floor(height / (hi - lo + 1));
  const on = start[3];
  return (
    <div style={{ display: "flex", gap, height }}>
      {blip.map((p, x) => (
        <div
          key={x}
          style={{
            display: "flex",
            position: "relative",
            width: cw,
            height,
            background: x % PER_BAR === 0 ? BEAT : PANEL,
            borderRadius: 6,
          }}
        >
          {on[x] === "x" ? (
            <div
              style={{
                position: "absolute",
                left: 4,
                top: (hi - p) * nh,
                width: cw - 8,
                height: nh,
                borderRadius: 4,
                background: PINK,
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Drums({ width, gap }: { width: number; gap: number }) {
  const { start, steps } = SUPERBUG;
  const cw = Math.floor((width - gap * (steps - 1)) / steps);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {start.slice(0, 3).map((lane, y) => (
        <div key={y} style={{ display: "flex", gap }}>
          {lane.split("").map((c, x) => (
            <div
              key={x}
              style={{
                width: cw,
                height: 22,
                borderRadius: 5,
                background: c === "x" ? LANE_COLORS[y] : x % PER_BAR === 0 ? BEAT : STEP,
                opacity: c === "x" && y === 2 ? (x % 2 ? 0.5 : 0.85) : 1,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export async function GET() {
  const inner = W - 112;
  const gap = 6;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: BG, padding: 56, color: FG }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          <div style={{ display: "flex", fontSize: 24, color: DIM }}>playseqbaby.com/superbugs</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>superbugs</div>
            <div style={{ display: "flex", fontSize: 29, color: DIM, maxWidth: 820 }}>
              something crawled into the sequencer and it is not a feature. tell us what it did.
            </div>
          </div>
          <Bug cell={13} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: "auto" }}>
          <Roll width={inner} height={150} gap={gap} />
          <Drums width={inner} gap={gap} />
        </div>
      </div>
    ),
    { width: W, height: H, headers: HEADERS },
  );
}
