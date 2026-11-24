/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectorRecipe } from "./selector-recipe";

afterEach(cleanup);

describe("SelectorRecipe", () => {
  it.each(["en", "zh"] as const)(
    "renders standard, compact, disabled, invalid, popover menu and short/long CheckboxListbox examples in %s",
    (locale) => {
      render(<SelectorRecipe locale={locale} />);
      const zh = locale === "zh";

      const standard = screen.getByRole<HTMLSelectElement>("combobox", {
        name: zh
          ? "标准全宽表单选择（含长选项）"
          : "Standard full-width form select (long option)",
      });
      expect(standard.classList.contains("select")).toBe(true);

      const compact = screen.getByRole<HTMLSelectElement>("combobox", {
        name: zh ? "学期" : "Term",
      });
      expect(compact.classList.contains("select")).toBe(true);
      expect(compact.classList.contains("control-compact")).toBe(true);
      expect(compact.classList.contains("field-auto")).toBe(true);

      const disabled = screen.getByRole<HTMLSelectElement>("combobox", {
        name: zh ? "禁用状态" : "Disabled state",
      });
      expect(disabled.disabled).toBe(true);

      const invalid = screen.getByRole<HTMLSelectElement>("combobox", {
        name: zh ? "校验错误状态" : "Validation error state",
      });
      expect(invalid.getAttribute("aria-invalid")).toBe("true");
      expect(invalid.getAttribute("aria-describedby")).toBeTruthy();
      fireEvent.change(invalid, { target: { value: "204" } });
      expect(invalid.getAttribute("aria-invalid")).toBeNull();

      // Short & long CheckboxListbox controls render native checkboxes (no <select multiple>).
      expect(
        screen.getByRole("checkbox", { name: zh ? "星期一" : "Monday" }),
      ).toBeTruthy();
      const search = screen.getByRole("searchbox", {
        name: zh ? "筛选选项" : "Filter options",
      });
      fireEvent.change(search, { target: { value: "Physics" } });
      expect(
        screen.getByRole("button", { name: zh ? "仅看已选" : "Selected only" }),
      ).toBeTruthy();

      const nav = screen.getByRole("navigation", {
        name: zh ? "示例工作区菜单" : "Example workspace menu",
      });
      expect(nav.classList.contains("popover-surface")).toBe(true);
      fireEvent.click(
        within(nav).getByRole("button", {
          name: zh ? "帮助中心" : "Help Center",
        }),
      );
      expect(
        screen.getByText(zh ? "当前选择：帮助中心" : "Selected: Help Center"),
      ).toBeTruthy();
    },
  );
});
