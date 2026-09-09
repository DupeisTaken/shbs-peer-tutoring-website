// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  me: { role: "TUTOR", canTranslate: false },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: state.me }) } },
    translationReview: {
      list: { useQuery: () => ({ data: [], error: null }) },
      decide: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("./translation-composer", () => ({
  TranslationComposer: () => <div>translation-composer</div>,
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));

import { TranslationReview } from "./translation-review";

afterEach(() => {
  cleanup();
});

it("hides the translation composer from an unassigned tutor", () => {
  state.me = { role: "TUTOR", canTranslate: false };
  render(<TranslationReview />);
  expect(screen.queryByText("translation-composer")).toBeNull();
});

it("shows the translation composer for an explicitly assigned translator", () => {
  state.me = { role: "TUTOR", canTranslate: true };
  render(<TranslationReview />);
  expect(screen.getByText("translation-composer")).toBeTruthy();
});

it("does not show the composer to elevated staff", () => {
  state.me = { role: "ADMIN", canTranslate: false };
  render(<TranslationReview />);
  expect(screen.queryByText("translation-composer")).toBeNull();
});
