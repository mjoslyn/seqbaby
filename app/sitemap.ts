import type { MetadataRoute } from "next";
import { loadPeopleCatalog } from "./people/peopleFeed";
import { SITE_URL } from "./shareCard";

// The public pages, plus the page of everyone who has published something
// (the /people list, so an account with nothing to hear is left out).
// Rebuilt hourly; loadPeopleCatalog never throws, so no env is just the pages.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const page = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly") => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });
  const { people } = await loadPeopleCatalog();
  return [
    page("", 1, "daily"),
    page("studio", 0.9, "weekly"),
    page("songs", 0.8, "daily"),
    page("people", 0.7, "daily"),
    page("manual", 0.6, "monthly"),
    page("superbugs", 0.2, "monthly"),
    ...people.map((p) => ({
      url: `${SITE_URL}u/${encodeURIComponent(p.handle)}`,
      lastModified: Date.parse(p.latest) > 0 ? new Date(p.latest) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
