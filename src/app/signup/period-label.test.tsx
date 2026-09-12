/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import SignupPage from "./page";

const state = vi.hoisted(() => ({ quarterSystem: true, waiting: false }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ QUARTER_SYSTEM: state.quarterSystem }),
}));
vi.mock("~/server/period", () => ({
  getActivePeriodOrNull: async () => ({
    schoolYear: "26-27",
    quarter: "Q3",
    semester: "S2",
    signupOpensAt: state.waiting ? new Date("2090-01-01T00:00:00Z") : null,
    signupPreviewUrl: null,
  }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { period: string }) =>
    values ? `${key} ${values.period}` : key,
}));
vi.mock("./signup-form", () => ({ SignupForm: () => <div>Request form</div> }));
vi.mock("./signup-opening-notice", () => ({
  SignupOpeningNotice: ({ periodLabel }: { periodLabel: string }) => (
    <div>Opens: {periodLabel}</div>
  ),
}));
vi.mock("~/app/_components/floating-language-switcher", () => ({
  FloatingLanguageSwitcher: () => null,
}));

afterEach(() => {
  state.quarterSystem = true;
  state.waiting = false;
});

it.each([true, false])(
  "uses the configured period mode on the open form (quarters=%s)",
  async (enabled) => {
    state.quarterSystem = enabled;
    const html = renderToStaticMarkup(await SignupPage());
    expect(html).toContain(
      enabled
        ? "public.signup.quarter 2026–27 Q3"
        : "public.signup.semester 2026–27 S2",
    );
    expect(html).toContain("Request form");
    expect(html).not.toContain("public.signup.term");
  },
);

it("uses semester wording in the pre-opening notice without exposing the form early", async () => {
  state.quarterSystem = false;
  state.waiting = true;
  const html = renderToStaticMarkup(await SignupPage());
  expect(html).toContain("Opens: 2026–27 S2");
  expect(html).not.toContain("Request form");
});
