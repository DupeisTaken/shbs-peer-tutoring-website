// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render, screen } from "@testing-library/react";
import { parse, type Root } from "postcss";
import { compile } from "tailwindcss";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./workspace-header";

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

function renderHeader(withNavigation = true) {
  render(
    <WorkspaceHeader
      href="/admin"
      title="Long translated workspace title"
      items={[{ href: "/student", label: "Enter Tutee Page" }]}
      identity={<span>Account identity</span>}
      account={<button>Account</button>}
      navigation={withNavigation ? <button>Navigation</button> : undefined}
    />,
  );
  const theme = screen.getByRole("button", { name: "Theme" });
  return theme.parentElement!.parentElement!;
}

it.each([true, false])(
  "keeps one set of utilities in its mobile area with navigation=%s",
  (withNavigation) => {
    const group = renderHeader(withNavigation);
    for (const name of ["Theme", "Notifications", "Account"]) {
      const controls = screen.getAllByRole("button", { name });
      expect(controls).toHaveLength(1);
      expect(group.contains(controls[0]!)).toBe(true);
      // Wrapping the group must not shrink individual touch targets to fit.
      expect(controls[0]!.parentElement!.classList.contains("shrink-0")).toBe(
        true,
      );
    }
    expect(screen.getAllByRole("combobox", { name: "Language" })).toHaveLength(1);
    expect(group.contains(screen.getByRole("combobox"))).toBe(false);
    expect(screen.getByRole("button", { name: "Theme" }).dataset.compact).toBe(
      "true",
    );
    const navigation = screen.queryByRole("button", { name: "Navigation" });
    expect(!!navigation).toBe(withNavigation);
    if (navigation) expect(group.contains(navigation)).toBe(false);
    for (const token of ["col-start-2", "col-span-2", "row-start-2"]) {
      expect(group.classList.contains(token)).toBe(true);
    }
    expect(group.classList.contains("overflow-hidden")).toBe(false);
  },
);

function declarationsFor(output: Root, selector: string) {
  const values: Record<string, string> = {};
  output.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      values[declaration.prop] = declaration.value;
    });
  });
  return values;
}

it("compiles mobile wrapping and preserves the desktop contents layout", async () => {
  const group = renderHeader();
  // Compile the rendered classes against the installed Tailwind theme, rather
  // than assuming class names imply CSS. jsdom cannot prove non-overlap: actual
  // EN/ZH narrow/desktop screenshots and 200% bounds remain a separate gate.
  const require = createRequire(import.meta.url);
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n@tailwind utilities;`);
  const output = parse(compiler.build([...group.classList]));
  expect(declarationsFor(output, ".flex")).toMatchObject({ display: "flex" });
  expect(declarationsFor(output, ".min-w-0")).toMatchObject({
    "min-width": "calc(var(--spacing) * 0)",
  });
  expect(declarationsFor(output, ".flex-wrap")).toMatchObject({
    "flex-wrap": "wrap",
  });
  expect(declarationsFor(output, ".lg\\:contents")).toMatchObject({
    display: "contents",
  });
  const desktopMedia: string[] = [];
  output.walkRules(".lg\\:contents", (rule) => {
    rule.walkAtRules("media", (media) => {
      desktopMedia.push(media.params);
    });
  });
  expect(desktopMedia).toContain("(width >= 64rem)");
});
