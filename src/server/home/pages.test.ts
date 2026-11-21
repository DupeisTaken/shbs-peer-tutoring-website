import { describe, expect, it, vi } from "vitest";
import { getCustomPageBySlug, getNavPages } from "./pages";

describe("custom page language provenance", () => {
  it.each([
    {
      title: { en: "English title" },
      titleLocale: "en",
      value: "English title",
    },
    {
      title: { en: "English title", zh: "中文标题" },
      titleLocale: "zh",
      value: "中文标题",
    },
    { title: { fr: "Titre" }, titleLocale: "fr", value: "Titre" },
  ])(
    "retains $titleLocale title provenance without changing draft visibility",
    async ({ title, titleLocale, value }) => {
      const findUnique = vi
        .fn()
        .mockResolvedValue({ id: "synthetic", title, published: false });
      const db = { customPage: { findUnique } } as unknown as Parameters<
        typeof getCustomPageBySlug
      >[0];
      expect(await getCustomPageBySlug(db, "synthetic-page", "zh")).toEqual({
        id: "synthetic",
        title: value,
        titleLocale,
        published: false,
      });
      expect(findUnique).toHaveBeenCalledWith({
        where: { slug: "synthetic-page" },
        select: { id: true, title: true, published: true },
      });
    },
  );

  it("keeps missing pages missing", async () => {
    const db = {
      customPage: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof getCustomPageBySlug>[0];
    expect(await getCustomPageBySlug(db, "missing", "zh")).toBeNull();
  });

  it("retains each published nav label's language, order and empty-label filtering", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { slug: "english", title: { en: "English title" } },
      { slug: "chinese", title: { en: "English title", zh: "中文标题" } },
      { slug: "french", title: { fr: "Titre" } },
      { slug: "empty", title: { zh: "", en: "Hidden fallback" } },
      { slug: "whitespace", title: { en: "  " } },
    ]);
    const db = { customPage: { findMany } } as unknown as Parameters<
      typeof getNavPages
    >[0];
    expect(await getNavPages(db, "zh")).toEqual([
      { slug: "english", label: "English title", labelLocale: "en" },
      { slug: "chinese", label: "中文标题", labelLocale: "zh" },
      { slug: "french", label: "Titre", labelLocale: "fr" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { published: true, showInNav: true },
      orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }],
      select: { slug: true, title: true },
    });
  });
});
