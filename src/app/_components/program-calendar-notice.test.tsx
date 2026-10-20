/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProgramCalendarNotice } from "./program-calendar";

const state = vi.hoisted(() => ({
  days: [] as { date: string; endDate?: string; reason: string }[],
  error: null as null | { message: string; data?: { code?: string } },
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      calendar: {
        useQuery: () => ({
          data: state.days,
          error: state.error,
          isSuccess: !state.error,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
    },
  },
}));
beforeEach(() => {
  state.days = [{ date: "2026-10-15", reason: "School event / 学校活动" }];
  state.error = null;
});
afterEach(cleanup);
const tree = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
    <ProgramCalendarNotice />
  </NextIntlClientProvider>
);

it.each(["en", "zh"] as const)(
  "shows informational dates in %s without attendance actions",
  (locale) => {
    render(tree(locale));
    const messages = locale === "en" ? en : zh;
    expect(
      screen.getByText(messages.programCalendar.informational),
    ).toBeTruthy();
    expect(screen.getByText("2026-10-15").getAttribute("dateTime")).toBe(
      "2026-10-15",
    );
    expect(screen.getAllByText("2026-10-15")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);

it.each(["en", "zh"] as const)(
  "shows both inclusive endpoints for a multi-day notice in %s",
  (locale) => {
    state.days = [
      {
        date: "2026-12-28",
        endDate: "2027-01-04",
        reason: "Winter break / 寒假",
      },
    ];
    render(tree(locale));
    expect(screen.getByText("2026-12-28").getAttribute("dateTime")).toBe(
      "2026-12-28",
    );
    expect(screen.getByText("2027-01-04").getAttribute("dateTime")).toBe(
      "2027-01-04",
    );
    expect(screen.getByRole("listitem").textContent).toContain(
      locale === "en" ? " to " : " 至 ",
    );
  },
);

it("hides denied cached dates through transport failure and reveals them only after fresh success", () => {
  const notice = render(tree());
  state.error = { message: "Denied", data: { code: "UNAUTHORIZED" } };
  notice.rerender(tree());
  expect(screen.queryByText("2026-10-15")).toBeNull();
  state.error = { message: "Offline" };
  notice.rerender(tree());
  expect(screen.queryByText("2026-10-15")).toBeNull();
  state.error = null;
  notice.rerender(tree());
  expect(screen.getByText("2026-10-15")).toBeTruthy();
});
