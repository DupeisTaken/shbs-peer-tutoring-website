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
        { id: "home", href: "/?home=1", label: "Program Home", group: "general" },
      ]}
      account={<button>Account</button>}
      navigation={withNavigation ? <button>Navigation</button> : undefined}
    />,
  );
}

it.each([true, false])(
  "renders the (Logo) Title switcher and desktop order Account -> Bell -> ? -> Theme -> Language while preserving mobile flex ordering (navigation=%s)",
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
    ).toBe("/?home=1");

    const controls = [
      ...container.querySelectorAll(
        "header button, header a, header select",
      ),
    ];
    const accountBtn = screen.getByRole("button", { name: "Account" });
    const bellBtn = screen.getByRole("button", { name: "Notifications" });
    const helpLink = screen.getByRole("link", { name: "Help Center" });
    const themeBtn = screen.getByRole("button", { name: "Theme" });
    const languageSelect = screen.getByRole("combobox", { name: "Language" });

    const accountIndex = controls.indexOf(accountBtn);
    const bellIndex = controls.indexOf(bellBtn);
    const helpIndex = controls.indexOf(helpLink);
    const themeIndex = controls.indexOf(themeBtn);
    const languageIndex = controls.indexOf(languageSelect);

    // Desktop DOM & Tab order puts Account to the left of the utility icons.
    expect(accountIndex).toBeGreaterThan(-1);
    expect(bellIndex).toBeGreaterThan(accountIndex);
    expect(helpIndex).toBeGreaterThan(bellIndex);
    expect(themeIndex).toBeGreaterThan(helpIndex);
    expect(languageIndex).toBeGreaterThan(themeIndex);

    // Mobile Row 2 preserves legacy visual order: Bell ? Theme (order-1) ... Language (order-2 ml-auto) Avatar (order-3).
    expect(bellBtn.parentElement!.parentElement!.className).toContain("order-1");
    expect(bellBtn.parentElement!.parentElement!.className).toContain("lg:order-none");
    expect(languageSelect.parentElement!.className).toContain("order-2");
    expect(languageSelect.parentElement!.className).toContain("ml-auto");
    expect(languageSelect.parentElement!.className).toContain("lg:order-none");
    expect(accountBtn.parentElement!.parentElement!.className).toContain("order-3");
    expect(accountBtn.parentElement!.parentElement!.className).toContain("lg:order-none");

    expect(themeBtn.dataset.compact).toBe("true");
    expect(languageSelect.getAttribute("data-compact")).toBe("true");
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

it("compiles responsive flex, mobile ordering, and desktop spacing utilities against Tailwind", async () => {
  const { container } = renderHeader();
  const row = container.querySelector("header > div")!;
  const iconsGroup = screen.getByRole("button", { name: "Theme" }).parentElement!
    .parentElement!;
  const group = iconsGroup.parentElement!;
  const divider = group.querySelector("span[aria-hidden='true']")!;
  const languageWrap = screen.getByRole("combobox", { name: "Language" }).parentElement!;
  const accountWrap = screen.getByRole("button", { name: "Account" }).parentElement!
    .parentElement!;
  const classes = [
    ...row.classList,
    ...group.classList,
    ...divider.classList,
    ...iconsGroup.classList,
    ...languageWrap.classList,
    ...accountWrap.classList,
  ];
  const require = createRequire(import.meta.url);
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n@tailwind utilities;`);
  const output = parse(compiler.build(classes));
  expect(declarationsFor(output, ".flex")).toMatchObject({ display: "flex" });
  expect(declarationsFor(output, ".flex-wrap")).toMatchObject({
    "flex-wrap": "wrap",
  });
  expect(declarationsFor(output, ".lg\\:contents")).toMatchObject({
    display: "contents",
  });
  expect(declarationsFor(output, ".lg\\:gap-0")).toMatchObject({
    gap: "0",
  });
  expect(declarationsFor(output, ".lg\\:gap-2")).toMatchObject({
    gap: "calc(var(--spacing) * 2)",
  });
  expect(declarationsFor(output, ".lg\\:ml-2")).toMatchObject({
    "margin-left": "calc(var(--spacing) * 2)",
  });
  expect(declarationsFor(output, ".order-1")).toMatchObject({ order: "1" });
  expect(declarationsFor(output, ".order-2")).toMatchObject({ order: "2" });
  expect(declarationsFor(output, ".order-3")).toMatchObject({ order: "3" });
  expect(declarationsFor(output, ".lg\\:order-none")).toMatchObject({
    order: "0",
  });
  expect(declarationsFor(output, ".ml-auto")).toMatchObject({
    "margin-left": "auto",
  });
});
