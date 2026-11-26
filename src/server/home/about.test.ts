import { describe, expect, it, vi } from "vitest";
import {
  getAboutLiveStats,
  getAboutPageMode,
  getCurrentHeadEmail,
  getCustomAboutRender,
} from "./about";
import { ABOUT_CUSTOM_MODE_KEY, ABOUT_PAGE_SLUG } from "~/lib/about-content";

type DbArg = Parameters<typeof getAboutLiveStats>[0];

describe("about server loaders", () => {
  it("counts only distinct held sessions with at least one present tutee and sums minutes", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _count: { _all: 42 },
      _sum: { durationMin: 1890 },
    });
    const db = { session: { aggregate } } as unknown as DbArg;

    expect(await getAboutLiveStats(db)).toEqual({
      totalSessions: 42,
      totalMinutesTutored: 1890,
    });
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        tutorStatus: { not: "TUTOR_ABSENT" },
        shFactor: { gte: 2 },
      },
      _count: { _all: true },
      _sum: { durationMin: true },
    });
  });

  it("clamps empty or negative minute totals safely to zero", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _count: { _all: 0 },
      _sum: { durationMin: null },
    });
    const db = { session: { aggregate } } as unknown as DbArg;

    expect(await getAboutLiveStats(db)).toEqual({
      totalSessions: 0,
      totalMinutesTutored: 0,
    });
  });

  it("returns the active non-merged, non-suspended HEAD login email", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ email: "current-head@shbs.example" });
    const db = { user: { findFirst } } as unknown as DbArg;

    expect(await getCurrentHeadEmail(db)).toBe("current-head@shbs.example");
    expect(findFirst).toHaveBeenCalledWith({
      where: { role: "HEAD", mergedIntoId: null, suspendedAt: null },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
  });

  it("reports built-in mode unless both the reserved toggle and custom about page exist", async () => {
    const findHomeContent = vi.fn().mockResolvedValue({ value: "true" });
    const findCustomPage = vi.fn().mockResolvedValue(null);
    const db = {
      homeContent: {
        findUnique: findHomeContent,
      },
      customPage: {
        findUnique: findCustomPage,
      },
    } as unknown as DbArg;

    expect(await getAboutPageMode(db)).toEqual({
      useCustom: false,
      customPage: null,
    });
    expect(findHomeContent).toHaveBeenCalledWith({
      where: { key_locale: { key: ABOUT_CUSTOM_MODE_KEY, locale: "en" } },
      select: { value: true },
    });
    expect(findCustomPage).toHaveBeenCalledWith({
      where: { slug: ABOUT_PAGE_SLUG },
      select: {
        id: true,
        slug: true,
        title: true,
        published: true,
        updatedAt: true,
      },
    });
  });

  it("resolves active custom About pages and falls back to built-in when unpublished without preview", async () => {
    const baseDb = (toggleValue: string | null, published: boolean) =>
      ({
        homeContent: {
          findUnique: vi
            .fn()
            .mockResolvedValue(toggleValue ? { value: toggleValue } : null),
        },
        customPage: {
          findUnique: vi.fn().mockResolvedValue({
            id: "about-page-id",
            title: { en: "Custom About", zh: "自定义关于" },
            published,
          }),
        },
        pageLayout: {
          findUnique: vi.fn().mockResolvedValue({
            blocks: [
              { id: "b1", type: "RICH_TEXT", text: { en: "Hello" } },
            ],
          }),
        },
      }) as unknown as DbArg;

    // Published + enabled -> live custom render
    expect(
      await getCustomAboutRender(baseDb("true", true), "zh", {
        allowPreview: false,
      }),
    ).toMatchObject({
      title: "自定义关于",
      titleLocale: "zh",
      isPreview: false,
    });

    // Unpublished + enabled without preview -> safe fallback (null)
    expect(
      await getCustomAboutRender(baseDb("true", false), "en", {
        allowPreview: false,
      }),
    ).toBeNull();

    // Unpublished + authorized preview -> preview render
    expect(
      await getCustomAboutRender(baseDb("true", false), "en", {
        allowPreview: true,
      }),
    ).toMatchObject({
      title: "Custom About",
      isPreview: true,
    });
  });
});
