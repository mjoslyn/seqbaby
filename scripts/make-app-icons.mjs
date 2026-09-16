#!/usr/bin/env node
// Rasterise public/favicon.svg — the logo — into the PNG homescreen icons
// (public/icons/*.png). iOS ignores SVG for `apple-touch-icon` and Android
// wants real sizes in the manifest, so the logo has to be baked to PNG; the
// art itself still lives only in favicon.svg, which this reads.
//
// One-off: run it when the logo changes, and commit the PNGs.
//
//   node scripts/make-app-icons.mjs            # needs a Chrome/Chromium
//   CHROME=/path/to/chrome node scripts/...    # or point it at one
//
// Headless Chrome is the rasteriser because it is the same renderer the logo
// is drawn by in the app, and it is already on the machines that build this.
//
// It draws into a CANVAS and reads the PNG back out as a data URL, rather than
// taking a `--screenshot` of a `--window-size`d page. That is load-bearing:
// Chrome's new headless mode is a real browser window, so `--window-size` is
// the WINDOW and the viewport is what is left after the browser's own UI — and
// it is clamped to a minimum besides. Asking for 180x180 gets a 500x93
// viewport, and `--screenshot` then writes a 180x180 file whose bottom 88 rows
// are background, because the page was only ever laid out 93 pixels tall. That
// is how the homescreen icon came to be a picture of the top half of the logo.
// A canvas has the size we give it and knows nothing about windows.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

// The logo's ink does not fill its 64-unit viewBox (the headphone band starts
// at y=9.5, the patch cable runs out to x=61.6), so the icons centre and scale
// the DRAWN bounds rather than the box — otherwise every icon sits low-left.
const INK = { x: 6, y: 9.5, w: 55.6, h: 50.1 };
const BG = "#0e0f12"; // --bg, so the icon matches the app it opens

// `fill` is the fraction of the icon the logo spans. Maskable icons are cropped
// to a circle by the launcher, so theirs stays inside the 80% safe zone.
const ICONS = [
  { file: "apple-touch-icon.png", size: 180, fill: 0.8 },
  { file: "icon-192.png", size: 192, fill: 0.8 },
  { file: "icon-512.png", size: 512, fill: 0.8 },
  { file: "icon-maskable-512.png", size: 512, fill: 0.58 },
];

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    ...["chromium-1194", "chromium_headless_shell-1194"].map((d) =>
      join("/opt/pw-browsers", d, "chrome-linux", "chrome"),
    ),
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no Chrome/Chromium found — set CHROME=<path>");
  return found;
}

// The logo's markup goes INLINE into the page: an <img src="favicon.svg"> would
// be a second file:// fetch, which headless Chrome may refuse.
const logo = readFileSync(join(root, "public", "favicon.svg"), "utf8");
const logoInner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

function iconSvg(size, fill) {
  const scale = (size * fill) / Math.max(INK.w, INK.h);
  const cx = INK.x + INK.w / 2;
  const cy = INK.y + INK.h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="geometricPrecision">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-cx} ${-cy})">${logoInner}</g>
</svg>`;
}

// One page renders every icon, and measures the ink it actually drew
// (getImageData over the canvas) so node can check the logo landed where the
// maths said it would. That check is the point: the bug this replaced wrote
// PNGs of the right SIZE with the logo cut in half, and nothing noticed.
function page(specs) {
  return `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre></body>
<script>
const SPECS = ${JSON.stringify(specs)};
const BG = ${JSON.stringify(BG)};

function draw(svg, size) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      ok({ url: c.toDataURL("image/png"), ink: inkBox(ctx, size) });
    };
    img.onerror = () => fail(new Error("svg did not decode"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// Bounds of everything that is not the flat background.
function inkBox(ctx, size) {
  const d = ctx.getImageData(0, 0, size, size).data;
  const r0 = d[0], g0 = d[1], b0 = d[2];
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (d[i] === r0 && d[i + 1] === g0 && d[i + 2] === b0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

(async () => {
  const out = [];
  for (const s of SPECS) out.push({ file: s.file, ...(await draw(s.svg, s.size)) });
  document.getElementById("out").textContent = "SQICONS:" + JSON.stringify(out);
})().catch((e) => {
  document.getElementById("out").textContent = "SQICONS-ERROR:" + e.message;
});
<\/script>`;
}

const chrome = findChrome();
const tmp = join(root, ".icon-build");
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

let dom;
try {
  const html = join(tmp, "icons.html");
  writeFileSync(
    html,
    page(ICONS.map(({ file, size, fill }) => ({ file, size, svg: iconSvg(size, fill) }))),
  );
  dom = execFileSync(
    chrome,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      // The drawing is async (the SVG has to decode), and --dump-dom fires at
      // load. Virtual time holds the dump until the page has gone quiet.
      "--virtual-time-budget=20000",
      "--dump-dom",
      `file://${html}`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Only what the page WROTE, not the script that wrote it — --dump-dom
// serialises the <script> too, markers and all.
const written = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const report = written ? written[1] : "";
if (report.startsWith("SQICONS-ERROR:")) {
  throw new Error(`rasteriser failed: ${report.slice("SQICONS-ERROR:".length)}`);
}
if (!report.startsWith("SQICONS:")) {
  throw new Error("rasteriser produced nothing — is the Chrome at " + chrome + " usable?");
}
const results = JSON.parse(report.slice("SQICONS:".length));

for (const spec of ICONS) {
  const got = results.find((r) => r.file === spec.file);
  if (!got) throw new Error(`no output for ${spec.file}`);

  // The logo spans `fill` of the icon on its long axis and is centred, so where
  // its ink lands is known in advance. A pixel or two of slack for the round
  // caps and the antialiasing; anything more means it was cropped or misplaced.
  const { size, fill } = spec;
  const w = size * fill;
  const h = (w * INK.h) / INK.w;
  const want = {
    x0: (size - w) / 2,
    x1: (size + w) / 2,
    y0: (size - h) / 2,
    y1: (size + h) / 2,
  };
  for (const k of ["x0", "y0", "x1", "y1"]) {
    if (Math.abs(got.ink[k] - want[k]) > 2) {
      throw new Error(
        `${spec.file}: logo is not where it should be — ink ${k}=${got.ink[k]}, expected ~${want[k].toFixed(1)}`,
      );
    }
  }

  const png = Buffer.from(got.url.slice(got.url.indexOf(",") + 1), "base64");
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`${spec.file}: got ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  }
  writeFileSync(join(outDir, spec.file), png);
  console.log(`public/icons/${spec.file}  ${size}x${size}`);
}
