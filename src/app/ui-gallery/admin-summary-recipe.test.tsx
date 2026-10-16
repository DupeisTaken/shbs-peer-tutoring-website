/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AdminSummaryRecipe } from "./admin-summary-recipe";
afterEach(cleanup);
it.each(["en", "zh"] as const)(
  "preserves visible consequential labels, focus return and leading selection (%s)",
  (locale) => {
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <AdminSummaryRecipe locale={locale} />
      </NextIntlClientProvider>,
    );
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]!).getByRole("checkbox")).toBeTruthy();
    const action = within(cells.at(-1)!).getByRole("button", {
      name: locale === "en" ? "Archive example" : "归档示例",
    });
    expect(action.className).toContain("table-action-danger");
    action.focus();
    fireEvent.click(action);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: locale === "en" ? "Close" : "关闭",
      }),
    );
    expect(document.activeElement).toBe(action);
    expect(action.textContent).toBeTruthy();
  },
);
