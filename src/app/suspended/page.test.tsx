// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import SuspendedPage from "./page";
import { SuspendedAppeal } from "./appeal-form";

const state = vi.hoisted(() => ({
  signedIn: true,
  suspended: true,
  pending: false,
  error: null as Error | null,
  submit: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
  auth: async () => (state.signedIn ? { user: { id: "synthetic" } } : null),
}));
vi.mock("~/trpc/server", () => ({
  api: {
    account: {
      suspension: async () => ({
        suspended: state.suspended,
        reason: "Synthetic reason",
        appeal: null,
      }),
    },
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      submitAppeal: {
        useMutation: () => ({
          mutate: state.submit,
          isPending: state.pending,
          error: state.error,
        }),
      },
    },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    key
      .split(".")
      .reduce(
        (value: unknown, part) => (value as Record<string, unknown>)[part],
        en,
      ),
}));
vi.mock("~/app/_components/public-header", () => ({
  PublicHeader: ({ navigation }: { navigation: React.ReactNode }) => (
    <header>
      <select aria-label="Language">
        <option>English</option>
        <option>中文</option>
      </select>
      {navigation}
    </header>
  ),
}));
vi.mock("~/app/_components/sign-out-button", () => ({
  SignOutButton: () => <button>Sign out</button>,
}));
beforeEach(() => {
  state.signedIn = true;
  state.suspended = true;
  state.pending = false;
  state.error = null;
  vi.clearAllMocks();
});
afterEach(cleanup);
it("uses one public heading and in-flow recovery navigation while preserving appeal access", async () => {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      {await SuspendedPage()}
    </NextIntlClientProvider>,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.common.backToMain })
      .getAttribute("href"),
  ).toBe("/");
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});
it("retains the existing sign-in and nonsuspended redirects", async () => {
  state.signedIn = false;
  await expect(SuspendedPage()).rejects.toThrow("redirect:/signin");
  state.signedIn = true;
  state.suspended = false;
  await expect(SuspendedPage()).rejects.toThrow("redirect:/");
});
it.each(["en", "zh"])(
  "preserves appeal drafts and freezes pending fields in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const content = () => (
      <NextIntlClientProvider
        locale={locale}
        timeZone="UTC"
        messages={messages}
      >
        <SuspendedAppeal pending={false} denied={false} />
      </NextIntlClientProvider>
    );
    const view = render(content());
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Keep this appeal" },
    });
    state.pending = true;
    view.rerender(content());
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(
      true,
    );
    state.pending = false;
    state.error = new Error("Synthetic failure");
    view.rerender(content());
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Keep this appeal",
    );
    expect(screen.getByRole("alert").textContent).toBe("Synthetic failure");
  },
);
