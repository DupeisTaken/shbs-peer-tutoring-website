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
      account={<button>Account</button>}
      navigation={withNavigation ? <button>Navigation</button> : undefined}
    />,
  );
}

it.each([true, false])(
  "renders the (Logo) Title switcher and unified Bell -> ? -> Theme -> Language -> Account order across desktop and mobile (navigation=%s)",
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
    const bellBtn = screen.getByRole("button", { name: "Notifications" });
    const helpLink = screen.getByRole("link", { name: "Help Center" });
    const themeBtn = screen.getByRole("button", { name: "Theme" });
    const languageSelect = screen.getByRole("combobox", { name: "Language" });
    const accountBtn = screen.getByRole("button", { name: "Account" });

    const bellIndex = controls.indexOf(bellBtn);
    const helpIndex = controls.indexOf(helpLink);
    const themeIndex = controls.indexOf(themeBtn);
    const languageIndex = controls.indexOf(languageSelect);
    const accountIndex = controls.indexOf(accountBtn);

    // Unified DOM & visual order puts Bell -> ? -> Theme -> Language -> Account on both desktop and mobile.
    expect(bellIndex).toBeGreaterThan(-1);
    expect(helpIndex).toBeGreaterThan(bellIndex);
    expect(themeIndex).toBeGreaterThan(helpIndex);
    expect(languageIndex).toBeGreaterThan(themeIndex);
    expect(accountIndex).toBeGreaterThan(languageIndex);

    // Mobile Row 2 pushes Language + Account to the right without CSS order overrides.
    expect(bellBtn.parentElement!.parentElement!.className).not.toContain("order-");
    expect(languageSelect.parentElement!.className).toContain("ml-auto");
    expect(languageSelect.parentElement!.className).toContain("lg:ml-2");
    expect(accountBtn.parentElement!.parentElement!.className).toContain("lg:-mr-2");

    expect(themeBtn.dataset.compact).toBe("true");
    expect(languageSelect.getAttribute("data-compact")).toBe("true");
    const navigation = screen.queryByRole("button", { name: "Navigation" });
    expect(!!navigation).toBe(withNavigation);

    // Mobile Row 1 centers the (Logo) Title switcher and its dropdown; when the 44px
    // management drawer trigger is present, symmetric 2.75rem grid tracks keep it dead-center.
    const switcher = container.querySelector("details")!;
    const summary = switcher.querySelector("summary")!;
    const switcherWrap = switcher.parentElement!;
    const brandRow = switcherWrap.parentElement!;
    // Optical left offset must live on <details>, not <summary>, so shrink-to-fit sizing
    // never clips the workspace title text by 4px on desktop.
    expect(switcher.className).toContain("lg:-ml-1");
    expect(summary.className).not.toMatch(/\b-ml-|\blg:-ml-/);
    expect(switcherWrap.className).toContain("justify-center");
    expect(switcherWrap.className).toContain("lg:contents");
    if (withNavigation) {
      expect(brandRow.className).toContain("grid");
      expect(brandRow.className).toContain(
        "grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]",
      );
      expect(brandRow.className).toContain("lg:contents");
      expect(brandRow.children).toHaveLength(3);
    } else {
      expect(brandRow.className).toContain("justify-center");
      expect(brandRow.className).toContain("lg:contents");
    }
    const popover = container.querySelector("details > nav")!;
    expect(popover.className).toContain("left-1/2");
    expect(popover.className).toContain("-translate-x-1/2");
    expect(popover.className).toContain("lg:left-0");
    expect(popover.className).toContain("lg:translate-x-0");
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

it("compiles responsive flex, mobile centering, supervising Tier-1 chrome, and desktop spacing utilities against Tailwind", async () => {
  const { container } = renderHeader();
  const header = container.querySelector("header")!;
  const row = container.querySelector("header > div")!;
  const brandRow = row.children[0]!;
  const switcher = container.querySelector("details")!;
  const summary = switcher.querySelector("summary")!;
  const switcherWrap = switcher.parentElement!;
  const popover = container.querySelector("details > nav")!;
  const iconsGroup = screen.getByRole("button", { name: "Theme" }).parentElement!
    .parentElement!;
  const group = iconsGroup.parentElement!;
  const divider = group.querySelector("span[aria-hidden='true']")!;
  const languageWrap = screen.getByRole("combobox", { name: "Language" }).parentElement!;
  const accountWrap = screen.getByRole("button", { name: "Account" }).parentElement!
    .parentElement!;
  const classes = [
    ...header.classList,
    ...row.classList,
    ...brandRow.classList,
    ...switcherWrap.classList,
    ...switcher.classList,
    ...summary.classList,
    ...popover.classList,
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
  expect(declarationsFor(output, ".w-full")).toMatchObject({
    width: "100%",
  });
  expect(declarationsFor(output, ".border-t-\\[2\\.5px\\]")).toMatchObject({
    "border-top-width": "2.5px",
  });
  expect(
    declarationsFor(output, ".border-t-\\[color\\:var\\(--action-background\\)\\]"),
  ).toMatchObject({
    "border-top-color": "var(--action-background)",
  });
  expect(declarationsFor(output, ".max-w-7xl")).toMatchObject({
    "max-width": "var(--container-7xl)",
  });
  expect(declarationsFor(output, ".flex")).toMatchObject({ display: "flex" });
  expect(declarationsFor(output, ".grid")).toMatchObject({ display: "grid" });
  expect(
    declarationsFor(
      output,
      ".grid-cols-\\[2\\.75rem_minmax\\(0\\,1fr\\)_2\\.75rem\\]",
    ),
  ).toMatchObject({
    "grid-template-columns": "2.75rem minmax(0,1fr) 2.75rem",
  });
  expect(declarationsFor(output, ".justify-center")).toMatchObject({
    "justify-content": "center",
  });
  expect(declarationsFor(output, ".left-1\\/2")).toMatchObject({
    left: "calc(1 / 2 * 100%)",
  });
  expect(declarationsFor(output, ".-translate-x-1\\/2")).toMatchObject({
    "--tw-translate-x": "calc(calc(1 / 2 * 100%) * -1)",
  });
  expect(declarationsFor(output, ".lg\\:left-0")).toMatchObject({
    left: "0",
  });
  expect(declarationsFor(output, ".lg\\:translate-x-0")).toMatchObject({
    "--tw-translate-x": "0",
  });
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
  expect(declarationsFor(output, ".lg\\:ml-3\\.5")).toMatchObject({
    "margin-left": "calc(var(--spacing) * 3.5)",
  });
  expect(declarationsFor(output, ".lg\\:mr-1\\.5")).toMatchObject({
    "margin-right": "calc(var(--spacing) * 1.5)",
  });
  expect(declarationsFor(output, ".lg\\:-ml-1")).toMatchObject({
    "margin-left": "calc(var(--spacing) * -1)",
  });
  expect(declarationsFor(output, ".lg\\:-mr-2")).toMatchObject({
    "margin-right": "calc(var(--spacing) * -2)",
  });
  expect(declarationsFor(output, ".ml-auto")).toMatchObject({
    "margin-left": "auto",
  });

  // Avoid reserving a root scrollbar gutter on <html>: on Windows/classic-scrollbar browsers
  // it leaves a blank vertical gap past the right edge of full-bleed sticky banners on
  // pane-scrolled (Management) and short routes.
  const globalsCss = readFileSync(
    require.resolve("../../styles/globals.css"),
    "utf8",
  );
  expect(globalsCss).not.toMatch(/scrollbar-gutter\s*:/);
});
