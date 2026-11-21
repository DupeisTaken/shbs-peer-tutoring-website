// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type * as ScreenshotsModule from "~/lib/help/screenshots";
import type { HelpArticle, HelpAudience } from "~/lib/help/types";
import HelpStepScreenshotPage from "./[slug]/screenshots/[step]/page";

const mock = vi.hoisted(() => ({
  locale: "en",
  audiences: ["staff"] as HelpAudience[],
  screenshot: vi.fn(),
  access: vi.fn(),
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => mock.locale }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("~/server/help/access", () => ({
  getHelpAccess: () =>
    mock.access() as Promise<{
      audiences: HelpAudience[];
      canDownload: boolean;
    }>,
}));
vi.mock("~/lib/help/catalogue", () => {
  const text = { en: "Staff evidence", zh: "工作人员证据" };
  const article: HelpArticle = {
    slug: "staff-guide",
    audience: "staff",
    route: "/admin",
    title: text,
    summary: text,
    prerequisites: [text],
    steps: [
      {
        title: text,
        body: text,
        screenshot: "staff-state",
        supplementaryScreenshots: ["staff-detail"],
        callouts: [
          {
            bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
            label: { en: "Read evidence", zh: "阅读证据" },
          },
        ],
      },
    ],
    expected: text,
    explanation: [text],
    troubleshooting: [{ problem: text, solution: text }],
    sources: [],
    covers: [],
  };
  return { helpArticles: [article] };
});
vi.mock("~/lib/help/screenshots", async (importOriginal) => ({
  ...(await importOriginal<typeof ScreenshotsModule>()),
  getHelpScreenshot: mock.screenshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.locale = "en";
  mock.audiences = ["staff"];
  mock.access.mockImplementation(async () => ({
    audiences: mock.audiences,
    canDownload: true,
  }));
  mock.screenshot.mockReturnValue({
    id: "staff-state",
    file: "staff-state.en.jpg",
    route: "/admin",
    locale: "en",
    role: "HEAD",
    capturedAt: "2026-11-16T00:00:00Z",
    viewport: { width: 1440, height: 1000 },
    sha256: "a".repeat(64),
    sourceRevision: "b".repeat(40),
    sourceLabel: "Reviewed main baseline",
    callouts: [
      {
        bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
        label: { en: "Read evidence", zh: "阅读证据" },
      },
    ],
  });
});
afterEach(cleanup);

it.each(["0", "01", "-1", "1.5", "2", "9007199254740993"])(
  "rejects invalid step %s before screenshot metadata",
  async (step) => {
    await expect(
      HelpStepScreenshotPage({
        params: Promise.resolve({ slug: "staff-guide", step }),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mock.screenshot).not.toHaveBeenCalled();
  },
);

it("rechecks live article access and conceals the full view after revocation", async () => {
  render(
    await HelpStepScreenshotPage({
      params: Promise.resolve({ slug: "staff-guide", step: "1" }),
    }),
  );
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "/api/help/images/staff-state?locale=en",
  );
  expect(
    screen
      .getByRole("link", { name: "Open original full screenshot" })
      .getAttribute("href"),
  ).toBe("/api/help/images/staff-state?locale=en");
  expect(screen.getByText("b".repeat(40))).toBeTruthy();
  mock.audiences = ["public"];
  await expect(
    HelpStepScreenshotPage({
      params: Promise.resolve({ slug: "staff-guide", step: "1" }),
    }),
  ).rejects.toThrow("NOT_FOUND");
  expect(mock.access).toHaveBeenCalledTimes(2);
  expect(mock.screenshot).toHaveBeenCalledTimes(1);
});

it("keeps Chinese guide labels with an explicitly identified English fallback capture", async () => {
  mock.locale = "zh";
  render(
    await HelpStepScreenshotPage({
      params: Promise.resolve({ slug: "staff-guide", step: "1" }),
    }),
  );
  expect(screen.getByRole("main").getAttribute("lang")).toBe("zh");
  expect(screen.getByRole("list", { name: "截图标注" }).textContent).toContain(
    "阅读证据",
  );
  expect(screen.getByText(/英文界面/)).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "打开完整标注截图" }).tabIndex,
  ).toBe(0);
});

it.each(["0", "01", "-1", "1.5", "3", "9007199254740993", ["1", "2"]])(
  "rejects undeclared or malformed view %j before image metadata",
  async (view) => {
    await expect(
      HelpStepScreenshotPage({
        params: Promise.resolve({ slug: "staff-guide", step: "1" }),
        searchParams: Promise.resolve({ view }),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mock.screenshot).not.toHaveBeenCalled();
  },
);

it("selects only the authorized step's supplementary frame and its own labels", async () => {
  mock.screenshot.mockReturnValue({
    ...mock.screenshot(),
    id: "staff-detail",
    file: "staff-detail.en.jpg",
    callouts: [
      {
        bounds: { x: 0.5, y: 0.4, width: 0.2, height: 0.1 },
        label: { en: "Second state marker", zh: "第二视图标记" },
      },
    ],
  });
  mock.screenshot.mockClear();
  render(
    await HelpStepScreenshotPage({
      params: Promise.resolve({ slug: "staff-guide", step: "1" }),
      searchParams: Promise.resolve({ view: "2" }),
    }),
  );
  expect(mock.screenshot).toHaveBeenCalledWith("staff-detail", "en");
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "/api/help/images/staff-detail?locale=en",
  );
  expect(
    screen.getByRole("list", { name: "Screenshot callouts" }).textContent,
  ).toContain("Second state marker");
  expect(
    screen.getByRole("list", { name: "Screenshot callouts" }).textContent,
  ).not.toContain("Read evidence");
  expect(
    screen.getByRole("link", { name: "View 2" }).getAttribute("aria-current"),
  ).toBe("page");
  mock.audiences = ["public"];
  await expect(
    HelpStepScreenshotPage({
      params: Promise.resolve({ slug: "staff-guide", step: "1" }),
      searchParams: Promise.resolve({ view: "2" }),
    }),
  ).rejects.toThrow("NOT_FOUND");
  expect(mock.screenshot).toHaveBeenCalledTimes(1);
});
