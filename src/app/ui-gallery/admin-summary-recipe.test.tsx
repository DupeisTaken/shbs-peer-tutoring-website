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
  "shows persisted room facts and keeps shortage, roomless and unscheduled states distinct (%s)",
  (locale) => {
    const catalog = locale === "en" ? en : zh;
    render(
      <NextIntlClientProvider locale={locale} messages={catalog}>
        <AdminSummaryRecipe locale={locale} />
      </NextIntlClientProvider>,
    );
    const rooms = within(
      screen.getByRole("region", {
        name: locale === "en" ? "Room names and status" : "教室名称与状态",
      }),
    );
    expect(rooms.getAllByRole("listitem")).toHaveLength(5);
    const labels = catalog.roomAllocation;
    for (const [name, status] of [
      ["A101", labels.mode.FIXED],
      [
        locale === "en"
          ? "Learning commons — north wing collaborative teaching room"
          : "学习共享空间——北翼协作教学教室",
        labels.mode.AUTO,
      ],
    ] as const) {
      const room = rooms.getByText(name);
      const row = within(room.closest("li")!);
      expect(
        room.compareDocumentPosition(row.getByText(status)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    for (const status of [
      labels.needsRoom,
      labels.mode.NONE,
      labels.awaiting,
    ]) {
      const label = rooms.getByText(status);
      expect(label.closest("li")?.textContent).toBe(status);
    }
    expect(rooms.queryByText("B202")).toBeNull();
  },
);

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
