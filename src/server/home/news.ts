import { type db as DbClient } from "~/server/db";

/**
 * Program-news feed for the public landing page. Mirrors PolicyDocument: one `NewsPost` carries the
 * lifecycle (DRAFT/PUBLISHED/ARCHIVED), ordering and date; the localized title + markdown body live
 * in `NewsTranslation` rows, with `en` always present as the fallback for untranslated locales.
 * Edited on /admin/landing; rendered through the shared <Markdown> component.
 */

export interface PublicNewsItem {
  id: string;
  title: string;
  /** Markdown — rendered via <Markdown>; may embed images as ![alt](/api/images/<id>). */
  body: string;
  /** ISO date the post is stamped with (publishedAt), or null. */
  date: string | null;
  pinned: boolean;
  /** False for a DRAFT shown only in the admin preview. */
  published: boolean;
}

/** Pick the best translation for a locale: exact → `en` → any (never empty if the post has rows). */
function pickTranslation<T extends { locale: string }>(rows: T[], locale: string): T | null {
  return (
    rows.find((r) => r.locale === locale) ??
    rows.find((r) => r.locale === "en") ??
    rows[0] ??
    null
  );
}

/**
 * Posts for the landing page, newest first (pinned on top). Empty array hides the feed. By default
 * only PUBLISHED posts; with `includeDrafts` (the admin preview) DRAFT posts are returned too, each
 * flagged `published: false` so the view can badge them. ARCHIVED posts are never shown.
 */
export async function getLandingNews(
  db: typeof DbClient,
  locale: string,
  opts?: { includeDrafts?: boolean },
): Promise<PublicNewsItem[]> {
  const posts = await db.newsPost.findMany({
    where: { status: opts?.includeDrafts ? { in: ["PUBLISHED", "DRAFT"] } : "PUBLISHED" },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      pinned: true,
      publishedAt: true,
      translations: { select: { locale: true, title: true, body: true } },
    },
  });

  const items: PublicNewsItem[] = [];
  for (const post of posts) {
    const tr = pickTranslation(post.translations, locale);
    if (!tr) continue;
    items.push({
      id: post.id,
      title: tr.title,
      body: tr.body,
      date: post.publishedAt ? post.publishedAt.toISOString() : null,
      pinned: post.pinned,
      published: post.status === "PUBLISHED",
    });
  }
  return items;
}
