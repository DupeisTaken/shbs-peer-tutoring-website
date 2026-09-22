// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const state = vi.hoisted(() => ({ viewerSignup: true, locale: "en" }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ VIEWER_SIGNUP: state.viewerSignup }),
}));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: () => false }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    let value: unknown = state.locale === "zh" ? zh : en;
    for (const part of key.split("."))
      value = (value as Record<string, unknown>)[part];
    if (typeof value !== "string")
      throw new Error(`Missing translation: ${key}`);
    return value;
  },
}));
vi.mock("~/app/_components/floating-language-switcher", () => ({
  FloatingLanguageSwitcher: () => null,
}));
vi.mock("./register-flow", () => ({
  RegisterFlow: () => <div>Invitation form</div>,
}));
vi.mock("../viewer-signup/viewer-signup-flow", () => ({
  ViewerSignupFlow: () => <div>Viewer form</div>,
}));
vi.mock("../signin/sign-in-form", () => ({
  SignInForm: () => <div>Sign-in form</div>,
}));

import RegisterPage from "./page";
import ViewerSignupPage from "../viewer-signup/page";
import SignInPage from "../signin/page";

beforeEach(() => {
  state.viewerSignup = true;
  state.locale = "en";
});
afterEach(cleanup);

// Exercise each rendered entry point and its feature gate, not just literal href source text.
it.each(["en", "zh"])(
  "explains the viewer and invitation boundary in %s",
  async (locale) => {
    state.locale = locale;
    const copy = locale === "zh" ? zh : en;
    render(await RegisterPage());
    expect(
      screen
        .getByRole("link", { name: copy.auth.signupRoutes.viewerLink })
        .getAttribute("href"),
    ).toBe("/viewer-signup");
    expect(
      screen.getByText(copy.auth.signupRoutes.viewerHelp, { exact: false }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: copy.survey.requestTutor })
        .getAttribute("href"),
    ).toBe("/signup");
    cleanup();
    render(await ViewerSignupPage());
    expect(
      screen
        .getByRole("link", { name: copy.auth.signupRoutes.invitationLink })
        .getAttribute("href"),
    ).toBe("/register");
    expect(screen.getByText(copy.public.viewerSignup.intro)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: copy.survey.requestTutor })
        .getAttribute("href"),
    ).toBe("/signup");
    cleanup();
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen
        .getByRole("link", { name: copy.auth.signupRoutes.invitationLink })
        .getAttribute("href"),
    ).toBe("/register");
    expect(
      screen
        .getByRole("link", { name: copy.auth.signupRoutes.viewerLink })
        .getAttribute("href"),
    ).toBe("/viewer-signup");
  },
);

it("omits closed viewer registration without hiding member or tutee routes", async () => {
  state.viewerSignup = false;
  for (const page of [
    RegisterPage,
    () => SignInPage({ searchParams: Promise.resolve({}) }),
  ]) {
    render(await page());
    expect(
      screen.queryByRole("link", { name: en.auth.signupRoutes.viewerLink }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: en.survey.requestTutor })
        .getAttribute("href"),
    ).toBe("/signup");
    cleanup();
  }
  await expect(ViewerSignupPage()).rejects.toThrow("redirect:/");
});

it("provides signup navigation copy in every bundled language", () => {
  const directory = resolve("messages");
  for (const filename of readdirSync(directory).filter((file) =>
    file.endsWith(".json"),
  )) {
    const messages = JSON.parse(
      readFileSync(resolve(directory, filename), "utf8"),
    ) as { auth: { signupRoutes: Record<string, string> } };
    for (const key of Object.keys(en.auth.signupRoutes)) {
      expect(messages.auth.signupRoutes[key], `${filename}: ${key}`).toMatch(
        /\S/,
      );
    }
  }
});
