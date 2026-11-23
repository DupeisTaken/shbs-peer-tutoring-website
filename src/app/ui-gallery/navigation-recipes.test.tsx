/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { BrandingProvider } from "~/app/_components/branding-provider";
import { resolveBranding } from "~/lib/branding-config";
import { NavigationRecipes } from "./navigation-recipes";

beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["en", "zh"] as const)(
  "renders BrandMark, skip link, section links and step heading focus in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const { container } = render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <BrandingProvider branding={resolveBranding({})}>
          <NavigationRecipes locale={locale} />
        </BrandingProvider>
      </NextIntlClientProvider>,
    );

    const skipLink = screen.getByRole("link", {
      name: locale === "zh" ? "跳到主要内容" : "Skip to main content",
    });
    expect(skipLink.getAttribute("href")).toBe("#ui-gallery-main");
    expect(skipLink.className).toContain("skip-link");
    expect(container.querySelector("header svg")).toBeTruthy();

    const themeButton = screen.getByRole("button", {
      name: locale === "zh" ? "示例主题" : "Example theme",
    });
    const section = themeButton.closest("section")!;
    expect(section.dataset.theme).toBeUndefined();
    fireEvent.click(themeButton);
    expect(section.dataset.theme).toBe("emerald");

    const currentLink = screen.getByRole("link", {
      name: locale === "zh" ? "组件展示" : "UI gallery",
    });
    expect(currentLink.getAttribute("aria-current")).toBe("page");

    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "zh" ? "下一步（示例）" : "Next step (example)",
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: messages.registrationFlow.verifyTitle }),
    );
  },
);
