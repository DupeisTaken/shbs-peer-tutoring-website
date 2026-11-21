import { beforeEach, expect, it, vi } from "vitest";
import LandingPage from "./page";

const state = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("~/server/home/images", () => ({
  authorizeHomeEditor: state.authorize,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("./landing-editor", () => ({ default: () => null }));

beforeEach(() => {
  state.authorize.mockResolvedValue({ ok: true, name: "Synthetic editor" });
});

it.each([
  { view: "pages", expected: "pages" },
  { view: "sections", expected: "sections" },
  { view: undefined, expected: undefined },
  { view: "layout", expected: undefined },
  { view: "https://example.test/", expected: undefined },
  { view: "/admin/users", expected: undefined },
  { view: ["pages", "sections"], expected: undefined },
  { view: ["pages"], expected: undefined },
])(
  "accepts only a scalar preview-owner view: $view",
  async ({ view, expected }) => {
    const page = await LandingPage({ searchParams: Promise.resolve({ view }) });
    expect(page).toMatchObject({ props: { initialView: expected } });
  },
);

it("does not mount a preview-selected editor when live authorization is denied", async () => {
  state.authorize.mockResolvedValue({ ok: false, name: null });
  const page = await LandingPage({
    searchParams: Promise.resolve({ view: "pages" }),
  });
  expect(page).not.toHaveProperty("props.initialView");
});
