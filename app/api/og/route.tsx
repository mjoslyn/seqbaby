import { ImageResponse } from "next/og";
import { decodePreview, type Preview } from "@/app/songs/songPreview";
import { PALETTE, SIZE, gridFor } from "@/app/profile/avatarGrid";
import { songCard, jamHost, type CardPerson } from "./cardData";

// The link-preview image for a shared song (`?s=`, `?open=`) and a jam invite
// (`?jam=`, `&by=`): the song's own steps, drawn the way its card is drawn on
// the homepage, with its title and whoever made it. studio/page.tsx points
// og:image here whenever the URL names one of those.
//
// A PNG, not the SVG the pages draw: the crawlers behind link previews
// (iMessage, Slack, Discord, X) do not render SVG images. ImageResponse lays
// out plain flex divs, so the grid is divs too.
//
// Anything that cannot be resolved still gets an image -- the steps of a
// song nobody can read are not shown, but a card is never a broken image.

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const BG = "#0e0f12";
const PANEL = "#15171c";
const STEP = "#2a2e38";
const BEAT = "#333846";
const FG = "#e8e6df";
const DIM = "#8a8c93";
const ROW_COLORS = ["#c2f04a", "#6ee7ff", "#ff9ad5", "#ffa94d", "#a68bff"];

function Steps({ preview, width, height }: { preview: Preview; width: number; height: number }) {
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

function Face({ person, size, seed }: { person: CardPerson | null; size: number; seed: string }) {
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

function Brand() {
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

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// A jam has no song anyone can look up (a room is a Realtime channel), so
// its picture is four euclidean rings seeded by the room, which is also what
// a room looks like while people are in it: everybody's parts going round.
function jamPreview(room: string): Preview | null {
  let h = 2166136261;
  for (let i = 0; i < room.length; i++) h = Math.imul(h ^ room.charCodeAt(i), 16777619);
  const t = [0, 1, 2, 3].map((i) => {
    h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
    return { n: 16, g: { p: 3 + (h % 9), n: 16, r: (h >>> 8) % 16, l: i === 3, a: true } };
  });
  return decodePreview({ p: 0, t });
}

const HEADERS = {
  // Link previews are fetched once and cached by the platform; a song edited
  // later can wait an hour to look different there.
  "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const one = (k: string) => {
    const v = sp.get(k);
    return v && v.length < 200 ? v : null;
  };
  const jam = one("jam");

  if (jam) {
    const host = await jamHost(one("by"));
    const preview = jamPreview(jam);
    return new ImageResponse(
      (
        <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: BG, padding: 56, color: FG }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Brand />
            <div style={{ display: "flex", fontSize: 26, color: BG, background: "#c2f04a", padding: "6px 16px", borderRadius: 8, fontWeight: 700 }}>
              live jam
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 32, marginTop: 36 }}>
            <Face person={host} size={132} seed={`jam:${jam}`} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", fontSize: 58, fontWeight: 700, lineHeight: 1.05 }}>
                {host ? clip(`@${host.handle}`, 22) : "someone"}
              </div>
              <div style={{ display: "flex", fontSize: 34, color: DIM }}>wants you in the room. no account needed.</div>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: "auto" }}>
            {preview && <Steps preview={preview} width={W - 112} height={230} />}
          </div>
        </div>
      ),
      { width: W, height: H, headers: HEADERS },
    );
  }

  const song = await songCard(one("s"), one("open"));
  const preview = song ? decodePreview(song.preview) : null;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: BG, padding: 56, color: FG }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          {song?.bpm ? <div style={{ display: "flex", fontSize: 28, color: DIM }}>{song.bpm} bpm</div> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, lineHeight: 1.05 }}>
            {clip(song?.title ?? "a song made in seqbaby", 30)}
          </div>
          {song?.owner ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, color: "#6ee7ff" }}>
              <Face person={song.owner} size={44} seed={song.owner.handle} />
              @{song.owner.handle}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", marginTop: "auto" }}>
          {preview ? (
            <Steps preview={preview} width={W - 112} height={song?.owner ? 250 : 300} />
          ) : (
            <div style={{ display: "flex", fontSize: 30, color: DIM }}>open it to hear it, remix it or fork it.</div>
          )}
        </div>
      </div>
    ),
    { width: W, height: H, headers: HEADERS },
  );
}
