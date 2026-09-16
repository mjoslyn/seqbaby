import type { Metadata, Viewport } from "next";
import { STYLE_SRC } from "./engineAssets";

export const metadata: Metadata = {
  title: "seqbaby",
  description:
    "Prompt-driven step sequencer in the browser: Plaits, 808/909 kits, hand-built analog and FM emulations, samples, MIDI out.",
  // The homescreen icon is the logo, rasterised from public/favicon.svg by
  // scripts/make-app-icons.mjs — iOS ignores an SVG apple-touch-icon and
  // Android wants real pixel sizes in the manifest, so both need PNGs. Added
  // to the homescreen with nothing here, iOS used a screenshot of the page.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "seqbaby",
  },
  other: { "mobile-web-app-capable": "yes" },
  openGraph: {
    type: "website",
    title: "seqbaby",
    description:
      "Prompt-driven step sequencer — Plaits, 808/909 kits, hand-built emulations, samples, MIDI.",
    url: "https://seqbaby.netlify.app/",
    images: [
      {
        url: "https://seqbaby.netlify.app/share.png",
        width: 1200,
        height: 630,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "seqbaby",
    description:
      "Prompt-driven step sequencer — Plaits, 808/909 kits, hand-built emulations, samples, MIDI.",
    images: ["https://seqbaby.netlify.app/share.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0f12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: browser extensions commonly inject attributes on
    // <html>/<body> (e.g. data-scribe-recorder-ready) before React hydrates, which
    // would otherwise surface as a benign attribute-mismatch warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The engine's global stylesheet — plain CSS served from public/, kept
            out of the bundler pipeline (same as the original index.html).
            Version-prefixed so it can be cached immutably; see engineAssets. */}
        <link rel="stylesheet" href={STYLE_SRC} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
