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

function page(size, fill) {
  const scale = (size * fill) / Math.max(INK.w, INK.h);
  const cx = INK.x + INK.w / 2;
  const cy = INK.y + INK.h / 2;
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${BG}}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="geometricPrecision">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-cx} ${-cy})">${logoInner}</g>
</svg>`;
}

const chrome = findChrome();
const tmp = join(root, ".icon-build");
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

try {
  for (const { file, size, fill } of ICONS) {
    const html = join(tmp, `${file}.html`);
    writeFileSync(html, page(size, fill));
    execFileSync(
      chrome,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${size},${size}`,
        `--screenshot=${join(outDir, file)}`,
        `file://${html}`,
      ],
      { stdio: "ignore" },
    );
    console.log(`public/icons/${file}  ${size}x${size}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
