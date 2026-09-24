import type { Metadata } from "next";

// The link preview, in one place. The studio's default card (layout.tsx) and
// the one a share link gets (studio/page.tsx's generateMetadata) differ only in the
// title and the line under it, and og/twitter metadata does NOT inherit field
// by field between segments — a page that sets `openGraph` replaces the
// layout's whole object — so the parts that stay the same have to be written
// from something shared or they quietly go missing on the song card.

export const SITE_URL = "https://www.playseqbaby.com/";
export const SHARE_IMAGE = `${SITE_URL}share.png`;

export const SITE_DESCRIPTION =
  "Prompt-driven step sequencer — Plaits, 808/909 kits, hand-built emulations, samples, MIDI.";

/** og + twitter for one card. `image` is the song or jam's own picture
 *  (app/api/og), absolute; the site's share.png when there is none. */
export function shareCard(title: string, description: string, image: string = SHARE_IMAGE) {
  return {
    openGraph: {
      type: "website",
      title,
      description,
      url: SITE_URL,
      images: [
        {
          url: image,
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
      images: [image],
    },
  } satisfies Metadata;
}
