// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HelpArticle, HelpAudience } from "~/lib/help/types";
import HelpPage from "./page";
import HelpArticlePage from "./[slug]/page";
import HelpDownloadsPage from "~/app/(admin)/admin/help/page";
import { helpCopy } from "./copy";

const mock = vi.hoisted(() => {
  const t = (value: string) => ({ en: value, zh: value });
  const makeArticle = (
    slug: string,
    audience: HelpAudience,
    title: string,
  ): HelpArticle => ({
    slug,
    audience,
    title: t(title),
    summary: t(`Summary for ${title}`),
    route: "/signin",
    prerequisites: [t("A synthetic prerequisite")],
    steps: [
      {
        title: t("A synthetic step"),
        body: t(`Body available to ${audience}`),
        screenshot: `capture-${slug}`,
      },
    ],
    expected: t("Saved result"),
    explanation: [t("How the result works")],
    troubleshooting: [
      {
        problem: t("A recoverable problem"),
        solution: t("A recovery direction"),
      },
    ],
    related: ["head-only"],
    sources: ["synthetic.ts"],
    covers: ["synthetic action"],
  });
  return {
    locale: "en",
    access: { audiences: ["public"] as HelpAudience[], canDownload: false },
    screenshot: vi.fn(),
    articles: [
      makeArticle("getting-started", "public", "Public starting guide"),
      makeArticle("tutor-only", "tutor", "Tutoring training"),
      makeArticle("staff-tasks", "staff", "Staff training"),
      makeArticle("admin-tasks", "admin", "Administrator training"),
      makeArticle("head-only", "head", "Head authority training"),
    ],
  };
});
vi.mock("next-intl/server", () => ({ getLocale: async () => mock.locale }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("~/server/help/access", () => ({
  getHelpAccess: async () => mock.access,
}));
vi.mock("~/lib/help/catalogue", () => ({
  helpArticles: mock.articles,
  helpAudiences: ["public", "tutor", "staff", "admin", "head"],
  helpAudienceTitles: {
    public: { en: "Visitors", zh: "访客" },
    tutor: { en: "Tutoring training", zh: "辅导培训" },
    staff: { en: "Staff training", zh: "工作人员培训" },
    admin: { en: "Administrator training", zh: "管理员培训" },
    head: { en: "Head authority training", zh: "负责人培训" },
  },
}));
vi.mock("~/lib/help/screenshots", () => ({
  getHelpScreenshot: mock.screenshot,
  helpCaptureInfo: {
    sourceRevision: "synthetic-revision",
    capturedAt: "2026-11-15T16:00:00Z",
    baseUrl: "http://127.0.0.1:3017",
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.locale = "en";
  mock.access = { audiences: ["public"], canDownload: false };
  for (const article of mock.articles) {
    delete article.requiresPrivateLink;
    article.route = "/signin";
  }
});
afterEach(cleanup);

it("filters forbidden articles before serializing catalogue props or audience shortcuts", async () => {
  const page = await HelpPage();
  // Inspect serialized data props, excluding framework component identities
  // (Next's Link export contains a circular self-reference in the test runtime).
  const serialized = JSON.stringify(page, (key, value: unknown) =>
    key === "type" || key === "_owner" ? undefined : value,
  );
  expect(serialized).toContain("Public starting guide");
  expect(serialized).not.toContain("Head authority training");
  expect(serialized).not.toContain("Body available to tutor");
  render(page);
  expect(screen.getByRole("heading", { name: "Help & how-to" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("1 of 1 guides found");
  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href"))
    .toBe("/signin?callbackUrl=%2Fhelp");
  expect(
    screen.queryByRole("button", { name: "Tutoring training" }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: "PDF handbooks" })).toBeNull();
});

it.each(["tutor-only", "head-only", "missing-article"])(
  "rejects direct unavailable article %s before rendering screenshot metadata or content",
  async (slug) => {
    await expect(
      HelpArticlePage({ params: Promise.resolve({ slug }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mock.screenshot).not.toHaveBeenCalled();
  },
);

it("renders authorized steps, named recovery directions and only accessible related links", async () => {
  mock.access.audiences = ["public", "account", "student", "tutor"];
  render(
    await HelpArticlePage({ params: Promise.resolve({ slug: "tutor-only" }) }),
  );
  expect(
    screen.getByRole("heading", { name: "Tutoring training" }),
  ).toBeTruthy();
  expect(screen.getByText("Body available to tutor")).toBeTruthy();
  expect(screen.getByText("A recovery direction")).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Head authority training" }),
  ).toBeNull();
  expect(mock.screenshot).toHaveBeenCalledWith("capture-tutor-only", "en");
});

it("uses an explicit English reading language for other interface locales", async () => {
  mock.locale = "de";
  render(await HelpPage());
  expect(screen.getByRole("main").getAttribute("lang")).toBe("en");
  expect(
    screen.getByText(
      "This guide is shown in English. English and Chinese editions are currently available.",
    ),
  ).toBeTruthy();
});

it.each([
  ["en", "/request-appeal"],
  ["zh", "/request-appeal"],
  ["en", "/"],
  ["zh", "/"],
] as const)(
  "directs the %s reader to the emailed capability instead of the bare %s route",
  async (locale, route) => {
    mock.locale = locale;
    const article = mock.articles[0]!;
    article.requiresPrivateLink = true;
    article.route = route;
    render(
      await HelpArticlePage({
        params: Promise.resolve({ slug: article.slug }),
      }),
    );
    expect(screen.getByText(helpCopy[locale].privateLinkHint)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: helpCopy[locale].openPage }),
    ).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === route),
    ).toBe(false);
    expect(screen.getByText("Body available to public")).toBeTruthy();
  },
);

it("retains the working page CTA for an ordinary guide", async () => {
  render(
    await HelpArticlePage({
      params: Promise.resolve({ slug: "getting-started" }),
    }),
  );
  expect(
    screen.getByRole("link", { name: "Open this page" }).getAttribute("href"),
  ).toBe("/signin");
  expect(screen.queryByText(helpCopy.en.privateLinkHint)).toBeNull();
});

it("offers staff participant PDFs without granting participant guide access or admin/Head editions", async () => {
  mock.access = {
    audiences: [
      "public",
      "account",
      "student",
      "observer",
      "staff",
      "translator",
    ],
    canDownload: true,
  };
  render(await HelpDownloadsPage());
  expect(
    screen.getByRole("heading", { name: "Tutoring training" }),
  ).toBeTruthy();
  expect(
    screen
      .getAllByRole("link", { name: "Download PDF · English" })[0]!
      .getAttribute("href"),
  ).toContain("locale=en");
  expect(
    screen.queryByRole("heading", { name: "Administrator training" }),
  ).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Head authority training" }),
  ).toBeNull();
});

it("keeps the Head handbook out of Admin downloads and rejects non-staff download pages", async () => {
  mock.access = {
    audiences: [
      "public",
      "account",
      "student",
      "observer",
      "staff",
      "admin",
      "translator",
    ],
    canDownload: true,
  };
  render(await HelpDownloadsPage());
  expect(
    screen.getByRole("heading", { name: "Administrator training" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Head authority training" }),
  ).toBeNull();
  mock.access.canDownload = false;
  await expect(HelpDownloadsPage()).rejects.toThrow("NOT_FOUND");
});

it("includes the Head edition only when the current allowlist contains Head authority", async () => {
  mock.access = {
    audiences: [
      "public",
      "account",
      "student",
      "observer",
      "staff",
      "admin",
      "head",
      "translator",
    ],
    canDownload: true,
  };
  render(await HelpDownloadsPage());
  expect(
    screen.getByRole("heading", { name: "Head authority training" }),
  ).toBeTruthy();
  expect(
    screen
      .getAllByRole("link", { name: "Download PDF · 中文" })
      .some(
        (link) => link.getAttribute("href") === "/api/help/pdf/head?locale=zh",
      ),
  ).toBe(true);
});
