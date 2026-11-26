import { type db as DbClient } from "~/server/db";
import { GLOBAL_LOCALE } from "~/server/home/content";
import { getLayout } from "~/server/home/blocks";
import { getCustomPageBySlug, pageOwnerKey } from "~/server/home/pages";
import {
  ABOUT_CUSTOM_MODE_KEY,
  ABOUT_PAGE_SLUG,
} from "~/lib/about-content";
import type { Block } from "~/lib/page-blocks";

export type AboutLiveStats = {
  /** Distinct completed tutoring session blocks with at least one present tutee. */
  totalSessions: number;
  /** Sum of recorded durationMin across those completed tutoring session blocks. */
  totalMinutesTutored: number;
};

export type AboutCustomPageMeta = {
  id: string;
  slug: string;
  title: Record<string, string>;
  published: boolean;
  updatedAt: Date;
};

export type AboutPageMode = {
  useCustom: boolean;
  customPage: AboutCustomPageMeta | null;
};

/**
 * Aggregate counting-only live program statistics for the dedicated /about page.
 *
 * Counts distinct held tutoring session blocks where the tutor was not absent and at least one
 * tutee was marked PRESENT:
 * - Combined multi-subject blocks store shared clock time on their primary Session row
 *   (`shFactor = 1 + present >= 2`), while merged sibling rows always carry `shFactor = 0`.
 * - Tutor-absent sessions (`shFactor = 0`), all-excused sessions (`shFactor = 0`), and
 *   no-show sessions with zero present tutees (`shFactor = 1`) are excluded.
 */
export async function getAboutLiveStats(
  db: typeof DbClient,
): Promise<AboutLiveStats> {
  const aggregate = await db.session.aggregate({
    where: {
      tutorStatus: { not: "TUTOR_ABSENT" },
      shFactor: { gte: 2 },
    },
    _count: { _all: true },
    _sum: { durationMin: true },
  });
  return {
    totalSessions: aggregate._count._all,
    totalMinutesTutored: Math.max(0, aggregate._sum.durationMin ?? 0),
  };
}

/**
 * Current active Program Head's login email, automatically following leadership transfers.
 * Returns null if no active HEAD account is configured yet.
 */
export async function getCurrentHeadEmail(
  db: typeof DbClient,
): Promise<string | null> {
  const head = await db.user.findFirst({
    where: { role: "HEAD", mergedIntoId: null, suspendedAt: null },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return head?.email ?? null;
}

/** Read whether the custom editor-authored About page is enabled and its backing CustomPage row. */
export async function getAboutPageMode(
  db: typeof DbClient,
): Promise<AboutPageMode> {
  const [toggleRow, page] = await Promise.all([
    db.homeContent.findUnique({
      where: {
        key_locale: { key: ABOUT_CUSTOM_MODE_KEY, locale: GLOBAL_LOCALE },
      },
      select: { value: true },
    }),
    db.customPage.findUnique({
      where: { slug: ABOUT_PAGE_SLUG },
      select: {
        id: true,
        slug: true,
        title: true,
        published: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    useCustom: toggleRow?.value === "true" && !!page,
    customPage: page
      ? {
          ...page,
          title: (page.title ?? {}) as Record<string, string>,
        }
      : null,
  };
}

/**
 * Resolve the optional custom editor-authored About page for /about rendering.
 * Returns null unless custom mode is enabled (or an authorized editor explicitly requested preview)
 * and the backing CustomPage exists.
 */
export async function getCustomAboutRender(
  db: typeof DbClient,
  locale: string,
  options: { allowPreview: boolean },
): Promise<{
  title: string;
  titleLocale: string | undefined;
  blocks: Block[];
  isPreview: boolean;
} | null> {
  const [toggleRow, page] = await Promise.all([
    db.homeContent.findUnique({
      where: {
        key_locale: { key: ABOUT_CUSTOM_MODE_KEY, locale: GLOBAL_LOCALE },
      },
      select: { value: true },
    }),
    getCustomPageBySlug(db, ABOUT_PAGE_SLUG, locale),
  ]);
  if (!page) return null;
  const active = toggleRow?.value === "true" && page.published;
  if (!active && !options.allowPreview) return null;
  const blocks = await getLayout(db, pageOwnerKey(page.id));
  return {
    title: page.title,
    titleLocale: page.titleLocale,
    blocks,
    isPreview: !active,
  };
}
