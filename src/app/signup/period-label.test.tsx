/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PublicSignupTransition } from "~/lib/public-signup-transition";
import SignupPage from "./page";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/public-signup-transition", () => ({ readPublicSignupTransition: state.read }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("./signup-form", () => ({ SignupForm: ({ initialTransition }: { initialTransition: PublicSignupTransition }) =>
  <div>Request form for {initialTransition.current?.label}; next {initialTransition.next?.label ?? "none"}</div> }));
vi.mock("~/app/_components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("~/app/_components/theme-switcher", () => ({ ThemeSwitcher: () => null }));

it.each(["2026–27 Q3", "2026–27 S2"])("hands the server period projection to the live form (%s)", async (label) => {
  state.read.mockResolvedValue({ serverNow: "2026-10-30T00:00:00Z", timeZone: "Asia/Shanghai",
    current: { termId: "source", label, kind: label.includes("Q3") ? "quarter" : "semester",
      window: { enabled: true, opensAt: null, closesAt: null, previewUrl: null } }, next: null });
  const html = renderToStaticMarkup(await SignupPage());
  expect(html).toContain(`Request form for ${label}; next none`);
  expect(html).toContain("survey.intro");
});

it("keeps current and next target separate in the initial public projection", async () => {
  state.read.mockResolvedValue({ current: { label: "2026–27 Q1" }, next: { label: "2026–27 Q2" } });
  const html = renderToStaticMarkup(await SignupPage());
  expect(html).toContain("Request form for 2026–27 Q1; next 2026–27 Q2");
});
