// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import HandbookPage from "./page";

const state = vi.hoisted(() => ({
  locale: "en",
  policy: null as { title: string; body: string } | null,
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/policy", () => ({
  localizedPolicy: async () => state.policy,
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async () => (key: string) => {
    const messages = state.locale === "zh" ? zh : en;
    return key === "tutor.nav.handbook"
      ? messages.tutor.nav.handbook
      : messages.tutor.handbook.empty;
  },
}));
vi.mock("~/app/_components/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "retains one %s page heading with and without a published handbook",
  async (locale) => {
    state.locale = locale;
    const messages = locale === "zh" ? zh : en;
    state.policy = null;
    const view = render(await HandbookPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: messages.tutor.nav.handbook,
      }),
    ).toBeTruthy();
    expect(screen.getByText(messages.tutor.handbook.empty)).toBeTruthy();
    state.policy = {
      title: "Synthetic Published Policy",
      body: "Published policy evidence",
    };
    view.rerender(await HandbookPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: state.policy.title }),
    ).toBeTruthy();
    expect(screen.queryByText(messages.tutor.handbook.empty)).toBeNull();
    expect(screen.getByText(state.policy.body)).toBeTruthy();
  },
);
