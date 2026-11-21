// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type * as ScreenshotsModule from "~/lib/help/screenshots";
type HelpScreenshot = ScreenshotsModule.HelpScreenshot;
import type { HelpStep } from "~/lib/help/types";
import { StepScreenshotGallery } from "./step-screenshot-gallery";

const mock = vi.hoisted(() => ({ screenshot: vi.fn() }));
vi.mock("~/lib/help/screenshots", async (importOriginal) => ({
  ...(await importOriginal<typeof ScreenshotsModule>()),
  getHelpScreenshot: mock.screenshot,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders each frame's own labels, provenance and protected full-context links", () => {
  const title = { en: "Review both panels", zh: "检查两个面板" };
  const step: HelpStep = {
    title,
    body: title,
    screenshot: "first-state",
    supplementaryScreenshots: ["second-state"],
    callouts: [
      {
        bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
        label: { en: "Primary target", zh: "主要目标" },
      },
    ],
  };
  mock.screenshot.mockImplementation((id: string): HelpScreenshot => ({
    id,
    file: `${id}.en.jpg`,
    locale: "en",
    role: "TUTOR",
    route: "/dashboard",
    capturedAt: "2026-11-16T00:00:00Z",
    viewport: { width: 1280, height: 720 },
    sha256: "a".repeat(64),
    sourceRevision: (id === "first-state" ? "b" : "c").repeat(40),
    sourceLabel: "Reviewed development baseline",
    state: { en: `${id} state`, zh: `${id}状态` },
    callouts: [
      {
        bounds: { x: 0.5, y: 0.4, width: 0.2, height: 0.1 },
        label: { en: "Supplemental target", zh: "补充目标" },
      },
    ],
  }));
  render(
    <StepScreenshotGallery
      slug="review-panels"
      step={step}
      number={2}
      locale="en"
    />,
  );
  expect(
    screen.getAllByRole("img").map((image) => image.getAttribute("src")),
  ).toEqual([
    "/api/help/images/first-state?locale=en",
    "/api/help/images/second-state?locale=en",
  ]);
  const legends = screen.getAllByRole("list", { name: "Screenshot callouts" });
  expect(legends.map((legend) => legend.textContent)).toEqual([
    "Primary target",
    "Supplemental target",
  ]);
  expect(new Set(legends.map((legend) => legend.id)).size).toBe(2);
  expect(
    screen
      .getAllByRole("link", { name: "Open annotated full screenshot" })
      .map((link) => link.getAttribute("href")),
  ).toEqual([
    "/help/review-panels/screenshots/2",
    "/help/review-panels/screenshots/2?view=2",
  ]);
  expect(screen.getByText("b".repeat(40))).toBeTruthy();
  expect(screen.getByText("c".repeat(40))).toBeTruthy();
  expect(screen.getByText("second-state state")).toBeTruthy();
});
