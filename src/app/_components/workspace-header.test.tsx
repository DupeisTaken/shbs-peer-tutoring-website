// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import { parse, type Root } from "postcss";
import { compile } from "tailwindcss";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./workspace-header";

vi.mock("./help-link", () => ({
  HelpLink: () => <Link href="/help">Help Center</Link>,
}));
vi.mock("./language-switcher", () => ({
  LanguageSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <select aria-label="Language" data-compact={compactAtDesktop}>
      <option>English</option>
    </select>
  ),
}));
vi.mock("./theme-switcher", () => ({
  ThemeSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <button data-compact={compactAtDesktop}>Theme</button>
  ),
}));
vi.mock("./notification-bell", () => ({
  NotificationBell: () => <button>Notifications</button>,
}));

afterEach(cleanup);

function renderHeader(withNavigation = true, hideTitle = false) {
  return render(
    <WorkspaceHeader
      href="/admin"
      title="Management"
      hideTitle={hideTitle}
      switcherItems={[
        { id: "tutor", href: "/dashboard", label: "Tutor", group: "workspaces" },
        { id: "home", href: "/", label: "Program Home", group: "general" },
      ]}
      identity={<span>Account identity</span>}
      account={<button>Account</button>}
      navigation={withNavigation ? <button>Navigation</button> : undefined}
    />,
  );
}

it.each([true, false])(
  "renders the (Logo) Title workspace switcher and utilities in exact order Bell -> ? -> Theme -> Language -> User (navigation=%s)",
  (withNavigation) => {
    const { container } = renderHeader(withNavigation);
    expect(
      container
        .querySelector<HTMLImageElement>("summary [data-brand-mark] img")
        ?.getAttribute("src"),
    ).toBe("/icon.png");
    expect(screen.getByText("Management")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Tutor" }).getAttribute("href"),
    ).toBe("/dashboard");
    expect(
      screen.getByRole("link", { name: "Program Home" }).getAttribute("href"),
    ).toBe("/");

    const controls = [
      ...container.querySelectorAll(
        "header button, header a, header select",
      ),
    ];
    const bellIndex = controls.indexOf(
      screen.getByRole("button", { name: "Notifications" }),
    );
    const helpIndex = controls.indexOf(
      screen.getByRole("link", { name: "Help Center" }),
    );
    const themeIndex = controls.indexOf(
      screen.getByRole("button", { name: "Theme" }),
    );
    const languageIndex = controls.indexOf(
      screen.getByRole("combobox", { name: "Language" }),
    );
    const accountIndex = controls.indexOf(
      screen.getByRole("button", { name: "Account" }),
    );

    expect(bellIndex).toBeGreaterThan(-1);
    expect(helpIndex).toBeGreaterThan(bellIndex);
    expect(themeIndex).toBeGreaterThan(helpIndex);
    expect(languageIndex).toBeGreaterThan(themeIndex);
    expect(accountIndex).toBeGreaterThan(languageIndex);

    expect(screen.getByRole("button", { name: "Theme" }).dataset.compact).toBe(
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: "Language" }).getAttribute("data-compact"),
    ).toBe("true");
    const navigation = screen.queryByRole("button", { name: "Navigation" });
    expect(!!navigation).toBe(withNavigation);
  },
);

it("hides visible title text on Program Home while keeping the logo switcher accessible", () => {
  const { container } = renderHeader(false, true);
  expect(container.querySelector("summary span.truncate")).toBeNull();
  expect(
    container
      .querySelector<HTMLImageElement>("summary [data-brand-mark] img")
      ?.getAttribute("src"),
  ).toBe("/icon.png");
  expect(
    container.querySelector("summary")?.getAttribute("aria-label"),
  ).toContain("Management");
});

function declarationsFor(output: Root, selector: string) {
  const values: Record<string, string> = {};
  output.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      values[declaration.prop] = declaration.value;
    });
  });
  return values;
}

it("compiles responsive flex and desktop contents utilities against Tailwind", async () => {
  renderHeader();
  const group = screen.getByRole("button", { name: "Theme" }).parentElement!
    .parentElement!.parentElement!;
  const require = createRequire(import.meta.url);
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n@tailwind utilities;`);
  const output = parse(compiler.build([...group.classList]));
  expect(declarationsFor(output, ".flex")).toMatchObject({ display: "flex" });
  expect(declarationsFor(output, ".flex-wrap")).toMatchObject({
    "flex-wrap": "wrap",
  });
  expect(declarationsFor(output, ".lg\\:contents")).toMatchObject({
    display: "contents",
  });
});
