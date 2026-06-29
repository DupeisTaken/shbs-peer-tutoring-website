import { type db as DbClient } from "~/server/db";
import { pickLocalized } from "~/lib/page-blocks";

/**
 * Standalone admin-built pages reached at /p/<slug>. Metadata lives in `CustomPage` (localized
 * `title` JSON map, publish + nav flags); the page's content is a block layout in `PageLayout` with
 * ownerKey `page:<id>` (see ./blocks.ts). Edited on /admin/landing.
 */

/** ownerKey for a custom page's block layout. */
export function pageOwnerKey(pageId: string): string {
  return `page:${pageId}`;
}

/** A published custom page by slug (title resolved for the locale). Includes unpublished too —
 *  the caller decides visibility. */
export async function getCustomPageBySlug(
  db: typeof DbClient,
  slug: string,
  locale: string,
): Promise<{ id: string; title: string; published: boolean } | null> {
  const page = await db.customPage.findUnique({
    where: { slug },
    select: { id: true, title: true, published: true },
  });
  if (!page) return null;
  return {
    id: page.id,
    title: pickLocalized(page.title as Record<string, string>, locale),
    published: page.published,
  };
}

/** Published pages flagged for the top nav, in order, with their localized label. */
export async function getNavPages(
  db: typeof DbClient,
  locale: string,
): Promise<{ slug: string; label: string }[]> {
  const pages = await db.customPage.findMany({
    where: { published: true, showInNav: true },
    orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }],
    select: { slug: true, title: true },
  });
  return pages
    .map((p) => ({ slug: p.slug, label: pickLocalized(p.title as Record<string, string>, locale) }))
    .filter((p) => p.label.trim());
}
