// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ServiceHoursComparison } from "./service-hours-comparison";
import type { ServiceHoursRow } from "~/lib/service-hours-view";
afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "retains fractional, minute-derived and negative hours in both views and Details (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh : messages;
    const rows: ServiceHoursRow[] = [
      {
        tutorId: "fractional",
        englishName: "Fractional Tutor",
        active: true,
        sessions: 1,
        adjustmentCount: 2,
        earned: 0.75,
        extras: 0.25,
        punishments: 0.125,
        total: 0.875,
      },
      {
        tutorId: "minute",
        englishName: "Minute Tutor",
        active: true,
        sessions: 1,
        adjustmentCount: 0,
        earned: 1 / 60,
        extras: 0,
        punishments: 0,
        total: 1 / 60,
      },
      {
        tutorId: "negative",
        englishName: "Negative Tutor",
        active: true,
        sessions: 0,
        adjustmentCount: 1,
        earned: 0,
        extras: 0,
        punishments: 0.25,
        total: -0.25,
      },
    ];
    const expected = [
      ["0.75", "0.25", "0.125", "0.875"],
      ["0.016666666666666666", "0", "0", "0.016666666666666666"],
      ["0", "0", "0.25", "-0.25"],
    ];
    const show = (panel: "summary" | "breakdown") => (
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={copy}
      >
        <ServiceHoursComparison
          rows={rows}
          panel={panel}
          sort={{ key: "total", dir: "none", toggle: vi.fn() }}
        />
      </NextIntlClientProvider>
    );
    const view = render(show("summary"));
    const records = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1);
    for (const [index, record] of records.entries()) {
      expect(
        within(record).getByRole("cell", { name: expected[index]![3] }),
      ).toBeTruthy();
      fireEvent.click(
        within(record).getByRole("button", {
          name: `${copy.tablePatterns.details}: ${rows[index]!.englishName}`,
        }),
      );
      expect(
        Array.from(screen.getByRole("dialog").querySelectorAll("dd"))
          .slice(1)
          .map((value) => value.textContent),
      ).toEqual(expected[index]);
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: copy.tablePatterns.close,
        }),
      );
    }
    view.rerender(show("breakdown"));
    const comparisons = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1);
    for (const [index, record] of comparisons.entries()) {
      expect(
        within(record)
          .getAllByRole("cell")
          .slice(2)
          .map((cell) => cell.textContent),
      ).toEqual(expected[index]);
    }
    expect(rows[1]!.total).toBe(1 / 60);
    expect(rows[2]!.total).toBe(-0.25);
  },
);

it("keeps a named keyboard-scrollable breakdown as the only roster without fake actions", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <ServiceHoursComparison
        panel="breakdown"
        sort={{ key: "total", dir: "none", toggle: vi.fn() }}
        rows={[
          {
            tutorId: "one",
            englishName: "Sample Tutor",
            active: true,
            sessions: 3,
            adjustmentCount: 2,
            earned: 2.5,
            extras: 1,
            punishments: 0.5,
            total: 3,
          },
          {
            tutorId: "two",
            englishName: "Past Tutor",
            active: false,
            sessions: 1,
            adjustmentCount: 0,
            earned: 1,
            extras: 0,
            punishments: 0,
            total: 1,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getAllByRole("table")).toHaveLength(1);
  const region = screen.getByRole("region", {
    name: messages.admin.summary.compareLabel,
  });
  expect(region.tabIndex).toBe(0);
  expect(within(region).getAllByRole("columnheader")).toHaveLength(6);
  expect(within(region).getAllByRole("row")).toHaveLength(3);
  expect(within(region).getByText(/Past Tutor/).textContent).toContain(
    messages.admin.summary.inactive,
  );
  expect(within(region).getByText("2.5")).toBeTruthy();
  expect(within(region).getByText("0.5")).toBeTruthy();
  expect(within(region).getAllByRole("button")).toHaveLength(6);
  expect(
    within(region).queryByRole("button", { name: /details|edit/i }),
  ).toBeNull();
});
