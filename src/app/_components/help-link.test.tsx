// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { HelpLink } from "./help-link";

const state = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

afterEach(cleanup);

it.each([
  ["en", en],
  ["zh", zh],
] as const)("renders localized Help Center icon entrance (%s)", (locale, messages) => {
  state.pathname = "/dashboard";
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <HelpLink />
    </NextIntlClientProvider>,
  );
  const link = screen.getByRole("link", { name: messages.helpNav.title });
  expect(link.getAttribute("href")).toBe("/help");
});

it.each(["/help", "/help/use-help-catalogue"])(
  "hides Help Center icon when already inside Help Center (%s)",
  (pathname) => {
    state.pathname = pathname;
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
        <HelpLink />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  },
);
