import type { MetadataRoute } from "next";
import { SITE_URL } from "./shareCard";

// Everything public is crawlable. The account pages and the API are not
// pages anyone should land on from a search, except /api/og: link-preview
// crawlers (Twitter's among them) honour robots.txt, and that is the cards.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/og"],
      disallow: ["/api/", "/login", "/settings", "/reset-password", "/auth/"],
    },
    sitemap: `${SITE_URL}sitemap.xml`,
    host: SITE_URL.replace(/\/$/, ""),
  };
}
