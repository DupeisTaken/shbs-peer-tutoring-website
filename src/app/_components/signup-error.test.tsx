// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SignupError } from "./signup-error";
afterEach(cleanup);
it.each([
  ["en", en, "37 seconds"],
  ["zh", zh, "37 秒"],
] as const)("translates retry timing in %s", (locale, messages, text) => {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SignupError
        error={{ message: "SIGNUP_RETRY", data: { retryAfterSeconds: 37 } }}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(new RegExp(text))).toBeTruthy();
});
it("shows delivery failure honestly and preserves existing policy errors", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SignupError error={{ message: "SIGNUP_MAIL_FAILED" }} />
      <SignupError error={{ message: "PROFILE_LATIN_NAME_REQUIRED" }} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/Email could not be delivered/)).toBeTruthy();
  expect(screen.queryByText("PROFILE_LATIN_NAME_REQUIRED")).toBeNull();
});
it.each([
  ["en", en],
  ["zh", zh],
] as const)(
  "translates crew source/proof failures at the shared invitation entry in %s",
  (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <div>
          <SignupError error={{ message: "CREW_DISABLED" }} />
        </div>
        <div>
          <SignupError error={{ message: "SIGNUP_CREW_INVALID" }} />
        </div>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.public.crewSignup.disabled)).toBeTruthy();
    expect(
      screen.getByText(messages.public.crewSignup.invalidCode),
    ).toBeTruthy();
    expect(screen.queryByText("CREW_DISABLED")).toBeNull();
    expect(screen.queryByText("SIGNUP_CREW_INVALID")).toBeNull();
  },
);
