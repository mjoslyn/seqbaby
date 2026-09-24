import { ImageResponse } from "next/og";
import { decodePreview, type Preview } from "@/app/songs/songPreview";
import { loadFeed } from "@/app/home/feed";
import { W, H, BG, PANEL, FG, DIM, HEADERS, Steps, Face, Brand, clip } from "../parts";

// The homepage's link-preview image: the hero line, and under it the songs
// people have most recently published, each drawn from its own steps the way
// the feed draws it. So a link to the front door shows what is behind it,
// and changes as people publish.
//
// The feed is the homepage's own read (app/home/feed.ts: anon, never
// throws). A database with nothing published in it, no preview column or no
// env at all gets a beat of our own instead, so the card is never empty.

export const runtime = "nodejs";

const PINK = "#ff6fa3";
const LIME = "#c2f04a";
const CYAN = "#6ee7ff";
const SHOWN = 3;

// Four lanes, written the way the preview column writes them: 1-9 a hit's
// velocity, `-` held, `.` a rest. Kick, clap, hats, and a bassline that ties.
const HOUSE: Preview | null = decodePreview({
  p: 0,
  t: [
    { s: "9...9...9...9..." },
    { s: "....8.......8..5" },
    { s: "5.9.5.9.5.9.5.97" },
    { s: "8-..6.8-..7.9-.6" },
  ],
});

type Shown = { title: string; handle: string | null; grid: string | null; preview: Preview };

async function latest(): Promise<Shown[]> {
  const { songs } = await loadFeed(12);
  const out: Shown[] = [];
  for (const s of songs) {
    const preview = decodePreview(s.preview);
    if (!preview?.rows.length) continue;
    out.push({
      title: s.title,
      handle: s.owner?.handle ?? s.owner?.name ?? null,
      grid: s.owner?.avatarGrid ?? null,
      preview,
    });
    if (out.length === SHOWN) break;
  }
  return out;
}

function SongTile({ song, width }: { song: Shown; width: number }) {
  const pad = 18;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height: 236,
        background: PANEL,
        borderRadius: 14,
        padding: pad,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
        <Steps preview={song.preview} width={width - pad * 2} height={120} />
      </div>
      <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: FG }}>{clip(song.title, 20)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 21, color: CYAN }}>
        {song.handle ? (
          <>
            <Face person={{ handle: song.handle, grid: song.grid }} size={26} seed={song.handle} />
            {clip(`@${song.handle}`, 20)}
          </>
        ) : (
          <span style={{ color: DIM }}>someone</span>
        )}
      </div>
    </div>
  );
}

export async function GET() {
  const songs = await latest();
  const inner = W - 112;
  const gap = 20;
  const tileW = Math.floor((inner - gap * (SHOWN - 1)) / SHOWN);

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: BG, padding: 56, color: FG }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          <div style={{ display: "flex", fontSize: 24, color: DIM }}>a step sequencer with opinions</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 34, gap: 10 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1 }}>
            turn the knobs. all of them.
            <span style={{ color: PINK, marginLeft: 18, transform: "rotate(-3deg)" }}>at once.</span>
          </div>
          <div style={{ display: "flex", fontSize: 27, color: DIM }}>
            {songs.length
              ? "in a browser tab. here's what people just made with it."
              : "in a browser tab. no install, no account needed to make noise."}
          </div>
        </div>

        <div style={{ display: "flex", marginTop: "auto" }}>
          {songs.length ? (
            <div style={{ display: "flex", gap }}>
              {songs.map((s, i) => (
                <SongTile key={i} song={s} width={songs.length === 1 ? inner : tileW} />
              ))}
            </div>
          ) : HOUSE ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Steps preview={HOUSE} width={inner} height={200} />
              <div style={{ display: "flex", fontSize: 22, color: LIME }}>open the studio → playseqbaby.com</div>
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: W, height: H, headers: HEADERS },
  );
}
