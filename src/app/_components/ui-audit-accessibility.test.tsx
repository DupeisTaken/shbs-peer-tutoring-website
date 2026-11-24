// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { BrandingProvider } from "./branding-provider";
import { resolveBranding } from "~/lib/branding-config";
import { NavLink } from "./nav-link";
import { ThemeSwitcher } from "./theme-switcher";
import { WorkspaceHeader } from "./workspace-header";
import { InlineNotice } from "./ui/patterns";
import RouteError from "../error";

const navState = vi.hoisted(() => ({ pathname: "/admin/users" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
}));
vi.mock("./language-switcher", () => ({
  LanguageSwitcher: () => <select aria-label="Language" />,
}));
vi.mock("./notification-bell", () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

afterEach(cleanup);

describe("shared accessibility fixes (#843, #844, #845)", () => {
  it("exposes aria-current=page only on the active NavLink", () => {
    navState.pathname = "/admin/users";
    render(
      <nav aria-label="Admin Navigation">
        <NavLink href="/admin" label="Dashboard" exact />
        <NavLink href="/admin/users" label="Users & Roles" />
      </nav>,
    );
    expect(
      screen.getByRole("link", { name: "Users & Roles" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders a skip-to-content link, brand mark, and desktop-aligned DOM Tab order", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
        <WorkspaceHeader
          href="/admin"
          title="SHBS Peer Tutoring Team"
          items={[{ href: "/student", label: "Enter Tutee Page" }]}
          identity={<span>Admin</span>}
          account={<button type="button">Account</button>}
          skipLabel={en.common.skipToContent}
          skipToId="admin-content"
          containerClassName="mx-auto max-w-6xl"
        />
      </NextIntlClientProvider>,
    );
    const skip = screen.getByRole("link", { name: en.common.skipToContent });
    expect(skip.getAttribute("href")).toBe("#admin-content");
    const brandMark = container.querySelector<HTMLImageElement>(
      "header [data-brand-mark] img",
    );
    expect(brandMark?.getAttribute("src")).toBe("/icon.png");
    expect(brandMark?.getAttribute("alt")).toBe("");
    const controls = [
      ...container.querySelectorAll("header a, header button, header select"),
    ];
    const enterIndex = controls.indexOf(
      screen.getByRole("link", { name: "Enter Tutee Page" }),
    );
    const languageIndex = controls.indexOf(
      screen.getByRole("combobox", { name: "Language" }),
    );
    // Language switcher follows workspace navigation in DOM/Tab order on desktop.
    expect(enterIndex).toBeGreaterThan(0);
    expect(languageIndex).toBeGreaterThan(enterIndex);
  });

  it("supports accent tone, title, and green semantic success on InlineNotice", () => {
    render(
      <>
        <InlineNotice tone="accent" title="Program update" announcement="status">
          <p>Details here.</p>
        </InlineNotice>
        <InlineNotice tone="success" announcement="status">
          <p>Saved.</p>
        </InlineNotice>
      </>,
    );
    const notices = screen.getAllByRole("status");
    expect(notices[0]?.className).toContain("bg-accent-50");
    expect(screen.getByText("Program update")).toBeTruthy();
    expect(notices[1]?.className).toContain("bg-green-50");
  });

  it("returns keyboard focus to the ThemeSwitcher trigger after selecting a swatch or pressing Escape", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
        <ThemeSwitcher />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: en.components.theme.label });
    fireEvent.click(trigger);
    const emerald = screen.getByRole("button", {
      name: en.components.theme.names.emerald,
    });
    emerald.focus();
    fireEvent.click(emerald);
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["en", "zh"] as const)(
    "renders localized route error recovery with retry and home links (%s)",
    (locale) => {
      const messages = locale === "zh" ? zh : en;
      const reset = vi.fn();
      render(
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          timeZone="Asia/Shanghai"
        >
          <BrandingProvider branding={resolveBranding({})}>
            <RouteError error={new Error("Boom")} reset={reset} />
          </BrandingProvider>
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(messages.pageRecovery.errorTitle)).toBeTruthy();
      expect(screen.getByText(messages.pageRecovery.errorBody)).toBeTruthy();
      expect(
        screen.getByRole("link", { name: messages.workflows.home }).getAttribute("href"),
      ).toBe("/");
      fireEvent.click(screen.getByRole("button", { name: messages.uiPatterns.retry }));
      expect(reset).toHaveBeenCalledOnce();
    },
  );
});
