// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

import { canSubmitCardAppeal, Pager } from "./student-portal";

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "names %s pagination and exposes only the known page position",
  (locale) => {
    const setPage = vi.fn();
    const messages = locale === "en" ? en : zh;
    const ui = (page: number, more: boolean) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Pager
          label="Attendance records"
          page={page}
          setPage={setPage}
          more={more}
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(0, true));
    const nav = screen.getByRole("navigation", { name: "Attendance records" });
    const buttons = within(nav).getAllByRole("button");
    const previous = within(nav).getByRole("button", {
      name: messages.workflows.previous,
    });
    const next = within(nav).getByRole("button", {
      name: messages.workflows.next,
    });
    expect(previous.hasAttribute("disabled")).toBe(true);
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(within(nav).getByRole("status").textContent).toContain("1");
    expect(
      buttons.every((button) => button.getAttribute("type") === "button"),
    ).toBe(true);
    fireEvent.click(next);
    expect(setPage).toHaveBeenLastCalledWith(1);
    rerender(ui(1, true));
    fireEvent.click(previous);
    expect(setPage).toHaveBeenLastCalledWith(0);
    rerender(ui(2, false));
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(within(nav).getByRole("status").textContent).toContain("3");
    expect(nav.textContent).not.toMatch(/of|共/);
  },
);

it("supplies a translated default name and disables forward navigation for an empty first page", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Pager page={0} setPage={vi.fn()} more={false} />
    </NextIntlClientProvider>,
  );
  const nav = screen.getByRole("navigation", { name: en.workflows.pagination });
  expect(
    within(nav)
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
});

const now = new Date("2026-09-10T00:00:00Z");

it.each([
  ["PENDING", false, "2026-09-10T00:00:00Z", true],
  ["VALID", false, "2026-09-10T00:00:00Z", true],
  ["INVALID", false, "2026-09-10T00:00:00Z", false],
  ["PENDING", true, "2026-09-10T00:00:00Z", false],
  ["VALID", false, "2026-09-09T23:59:59Z", false],
] as const)(
  "allows only one open appeal for a non-invalid card (%s, existing=%s)",
  (reviewStatus, hasExistingAppeal, deadline, expected) => {
    expect(
      canSubmitCardAppeal({
        reviewStatus,
        hasExistingAppeal,
        deadline: new Date(deadline),
        now,
      }),
    ).toBe(expected);
  },
);
