import type { TransactionDb } from "../transactions";

const MAX_SLUG_LENGTH = 60;

/** Generated slugs must satisfy the same length and shape constraints as edited slugs. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/** Caller holds home:page-slugs until its write commits. Both tables reserve /p/<slug>,
 * including unpublished pages, so publishing later cannot steal another document's URL. */
export async function uniquePageSlug(
  tx: TransactionDb,
  base: string,
  self: { sectionId?: string; pageId?: string } = {},
): Promise<string> {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const prefix = base
      .slice(0, MAX_SLUG_LENGTH - suffix.length)
      .replace(/-+$/g, "");
    const candidate = `${prefix}${suffix}`;
    const section = await tx.landingSection.findFirst({
      where: {
        slug: candidate,
        ...(self.sectionId ? { id: { not: self.sectionId } } : {}),
      },
      select: { id: true },
    });
    const page = await tx.customPage.findFirst({
      where: {
        slug: candidate,
        ...(self.pageId ? { id: { not: self.pageId } } : {}),
      },
      select: { id: true },
    });
    if (!section && !page) return candidate;
  }
}
