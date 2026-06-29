import { type db as DbClient } from "~/server/db";

/**
 * Free-form expandable panels (accordion sections) on the public landing page. Mirrors the news
 * feed: one `LandingSection` carries ordering + visibility; the localized title + markdown body live
 * in `LandingSectionTranslation`, with `en` as the always-present fallback. Edited on /admin/landing.
 */

export interface PublicSection {
  id: string;
  title: string;
  /** Markdown — rendered via <Markdown>; may embed images as ![alt](/api/images/<id>). */
  body: string;
  openByDefault: boolean;
  /** INLINE expands an accordion in place; PAGE links to /p/<slug>. */
  mode: "INLINE" | "PAGE";
  slug: string | null;
  /** False for a hidden section shown only in the admin preview. */
  published: boolean;
}

function pickTranslation<T extends { locale: string }>(rows: T[], locale: string): T | null {
  return (
    rows.find((r) => r.locale === locale) ??
    rows.find((r) => r.locale === "en") ??
    rows[0] ??
    null
  );
}

/**
 * Sections in display order. Empty array hides the accordion entirely. By default only published
 * sections; with `includeHidden` (the admin preview) hidden ones are returned too, each flagged
 * `published: false` so the view can badge them.
 */
export async function getLandingSections(
  db: typeof DbClient,
  locale: string,
  opts?: { includeHidden?: boolean },
): Promise<PublicSection[]> {
  const sections = await db.landingSection.findMany({
    where: opts?.includeHidden ? {} : { published: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      published: true,
      openByDefault: true,
      mode: true,
      slug: true,
      translations: { select: { locale: true, title: true, body: true } },
    },
  });

  const out: PublicSection[] = [];
  for (const section of sections) {
    const tr = pickTranslation(section.translations, locale);
    if (!tr) continue;
    out.push({
      id: section.id,
      title: tr.title,
      body: tr.body,
      openByDefault: section.openByDefault,
      mode: section.mode,
      slug: section.slug,
      published: section.published,
    });
  }
  return out;
}

/** One PAGE-mode section by slug (with the locale's translation, en fallback) for its detail page. */
export async function getSectionBySlug(
  db: typeof DbClient,
  slug: string,
  locale: string,
): Promise<{ title: string; body: string; published: boolean } | null> {
  const section = await db.landingSection.findUnique({
    where: { slug },
    select: {
      published: true,
      mode: true,
      translations: { select: { locale: true, title: true, body: true } },
    },
  });
  if (section?.mode !== "PAGE") return null;
  const tr = pickTranslation(section.translations, locale);
  if (!tr) return null;
  return { title: tr.title, body: tr.body, published: section.published };
}
