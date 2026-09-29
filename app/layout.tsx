import type { Metadata, Viewport } from "next";
import { STYLE_SRC } from "./engineAssets";
import PostHogIdentify from "./PostHogIdentify";
import { SITE_DESCRIPTION, SITE_URL, shareCard } from "./shareCard";

export const metadata: Metadata = {
  // Resolves every relative URL below (and each page's canonical) against the
  // production host, so a deploy preview never claims to be the real site.
  metadataBase: new URL(SITE_URL),
  title: "seqbaby",
  applicationName: "seqbaby",
  description:
    "A step sequencer in a browser tab: Plaits, 808/909 kits, hand-built analog and FM emulations, samples, MIDI out.",
  // The homescreen icon is the logo, rasterised from public/favicon.svg by
  // scripts/make-app-icons.mjs — iOS ignores an SVG apple-touch-icon and
  // Android wants real pixel sizes in the manifest, so both need PNGs. Added
  // to the homescreen with nothing here, iOS used a screenshot of the page.
  // favicon.ico and the 48px PNG are for search engines as much as tabs:
  // Google's favicon crawler wants a raster in a multiple of 48px (else /favicon.ico),
  // and with neither it showed a grey globe beside the site in results.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
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
  // The default card. A link that names a song overrides this with the song's
  // own title — see generateMetadata in studio/page.tsx.
  ...shareCard("seqbaby", SITE_DESCRIPTION),
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
      <body suppressHydrationWarning>
        <PostHogIdentify />
        {children}
      </body>
    </html>
  );
}
