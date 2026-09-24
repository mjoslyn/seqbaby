import { type Preview } from "@/app/songs/songPreview";
import { PALETTE, SIZE, gridFor } from "@/app/profile/avatarGrid";
import { type CardPerson } from "./cardData";

// The pieces every link-preview image is drawn from: the song and jam card
// (./route.tsx) and the homepage's (./home/route.tsx). Here rather than in
// either route because a route file may export only its handlers.

export const W = 1200;
export const H = 630;
export const BG = "#0e0f12";
export const PANEL = "#15171c";
export const STEP = "#2a2e38";
export const BEAT = "#333846";
export const FG = "#e8e6df";
export const DIM = "#8a8c93";
export const ROW_COLORS = ["#c2f04a", "#6ee7ff", "#ff9ad5", "#ffa94d", "#a68bff"];

export function Steps({ preview, width, height }: { preview: Preview; width: number; height: number }) {
  const gap = preview.cols > 32 ? 2 : 4;
  const cw = Math.floor((width - gap * (preview.cols - 1)) / preview.cols);
  const ch = Math.min(cw * 1.6, Math.floor((height - gap * (preview.rows.length - 1)) / preview.rows.length));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {preview.rows.map((row, y) => {
        const color = ROW_COLORS[y % ROW_COLORS.length];
        return (
          <div key={y} style={{ display: "flex", gap }}>
            {row.cells.map((c, x) => (
              <div
                key={x}
                style={{
                  height: ch,
                  borderRadius: Math.min(8, cw / 5),
                  background: c ? color : x % 4 === 0 ? BEAT : STEP,
                  opacity: c ? (c.tie ? 0.55 : 0.4 + 0.6 * c.v) : 1,
                  // A held step reaches back into the gap, so a note reads as
                  // one bar across however many steps it lasts.
                  marginLeft: c?.tie ? -gap : 0,
                  width: c?.tie ? cw + gap : cw,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function Face({ person, size, seed }: { person: CardPerson | null; size: number; seed: string }) {
  const g = gridFor(person?.grid ?? null, person?.handle ?? seed);
  const cell = size / SIZE;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: size, height: size, background: PANEL, borderRadius: size / 8, overflow: "hidden" }}>
      {g.cells.map((v, i) => (
        <div key={i} style={{ width: cell, height: cell, background: v ? PALETTE[v]?.hex ?? PANEL : PANEL }} />
      ))}
    </div>
  );
}

export function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, color: FG, fontWeight: 700 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 0, 1, 1].map((on, i) => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: on ? "#c2f04a" : STEP }} />
        ))}
      </div>
      seqbaby
    </div>
  );
}

export function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const HEADERS = {
  // Link previews are fetched once and cached by the platform; a song edited
  // later can wait an hour to look different there.
  "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};
