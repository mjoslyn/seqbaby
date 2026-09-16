import type { Metadata } from "next";

// The link preview, in one place. The studio's default card (layout.tsx) and
// the one a share link gets (page.tsx's generateMetadata) differ only in the
// title and the line under it, and og/twitter metadata does NOT inherit field
// by field between segments — a page that sets `openGraph` replaces the
// layout's whole object — so the parts that stay the same have to be written
// from something shared or they quietly go missing on the song card.

export const SITE_URL = "https://seqbaby.netlify.app/";
export const SHARE_IMAGE = `${SITE_URL}share.png`;

export const SITE_DESCRIPTION =
  "Prompt-driven step sequencer — Plaits, 808/909 kits, hand-built emulations, samples, MIDI.";

/** og + twitter for one card. The image is the same either way. */
export function shareCard(title: string, description: string) {
  return {
    openGraph: {
      type: "website",
      title,
      description,
      url: SITE_URL,
      images: [
        {
          url: SHARE_IMAGE,
          width: 1200,
          height: 630,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE],
    },
  } satisfies Metadata;
}
