// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ResetPasswordPage from "./page";
import ForgotPasswordPage from "../forgot-password/page";

vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    let value: unknown = en;
    for (const part of key.split("."))
      value = (value as Record<string, unknown>)[part];
    return value;
  },
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("./reset-password-form", () => ({
  ResetPasswordForm: ({ token }: { token: string }) => (
    <div data-testid="reset-form">{token}</div>
  ),
}));
vi.mock("../forgot-password/forgot-password-form", () => ({
  ForgotPasswordForm: () => <div>Recovery form</div>,
}));
afterEach(cleanup);

it("shows a recovery route when the reset token is missing", async () => {
  render(await ResetPasswordPage({ searchParams: Promise.resolve({}) }));
  expect(screen.queryByTestId("reset-form")).toBeNull();
  expect(screen.getByText(en.auth.reset.missingToken)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.auth.reset.requestLink })
      .getAttribute("href"),
  ).toBe("/forgot-password");
});

it("passes the reset token through the shared card without losing the sign-in route", async () => {
  render(
    await ResetPasswordPage({
      searchParams: Promise.resolve({ token: "synthetic-token" }),
    }),
  );
  expect(screen.getByTestId("reset-form").textContent).toBe("synthetic-token");
  expect(screen.queryByText(en.auth.reset.missingToken)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: en.auth.reset.backToSignIn })
      .getAttribute("href"),
  ).toBe("/signin");
});

it("retains the recovery form and both return destinations", async () => {
  render(await ForgotPasswordPage());
  expect(screen.getByText("Recovery form")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.auth.forgot.backToSignIn })
      .getAttribute("href"),
  ).toBe("/signin");
  expect(
    screen
      .getByRole("link", { name: en.common.backToMain })
      .getAttribute("href"),
  ).toBe("/");
});
