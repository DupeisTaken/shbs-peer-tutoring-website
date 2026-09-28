// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SignupError } from "./signup-error";
afterEach(cleanup);
it.each([["en", en, "37 seconds"], ["zh", zh, "37 秒"]] as const)("translates retry timing in %s", (locale, messages, text) => {
  render(<NextIntlClientProvider locale={locale} messages={messages}><SignupError error={{ message: "SIGNUP_RETRY", data: { retryAfterSeconds: 37 } }} /></NextIntlClientProvider>);
  expect(screen.getByText(new RegExp(text))).toBeTruthy();
});
it("shows delivery failure honestly and preserves existing policy errors", () => {
  render(<NextIntlClientProvider locale="en" messages={en}><SignupError error={{ message: "SIGNUP_MAIL_FAILED" }} /><SignupError error={{ message: "PROFILE_LATIN_NAME_REQUIRED" }} /></NextIntlClientProvider>);
  expect(screen.getByText(/Email could not be delivered/)).toBeTruthy();
  expect(screen.queryByText("PROFILE_LATIN_NAME_REQUIRED")).toBeNull();
});
