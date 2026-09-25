import { ImageResponse } from "next/og";
import { decodePreview, type Preview } from "@/app/songs/songPreview";
import { songCard, jamHost } from "./cardData";
import { W, H, BG, FG, DIM, HEADERS, Steps, Face, Brand, clip } from "./parts";

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
            <div style={{ display: "flex", fontSize: 30, color: DIM }}>open it to hear it or remix it.</div>
          )}
        </div>
      </div>
    ),
    { width: W, height: H, headers: HEADERS },
  );
}
