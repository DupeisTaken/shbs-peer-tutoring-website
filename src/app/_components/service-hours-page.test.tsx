/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import ServiceHoursPage from "../(admin)/admin/service-hours/page";
import { SessionViewProvider } from "./session-view-state";
import type { ServiceHoursRow } from "~/lib/service-hours-view";

const query = vi.hoisted(() => ({
  error: null as null | { data: { code: string } },
  retry: vi.fn(),
  loaded: true,
  rows: [] as ServiceHoursRow[],
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["summary"] }));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      periodSummary: {
        useQuery: () => ({
          data: query.loaded
            ? {
                scope: { label: "Synthetic semester" },
                rows: query.rows,
                totals: { earned: 8, extras: 0, punishments: 3, total: 5 },
              }
            : undefined,
          error: query.error,
          isSuccess: !query.error && query.loaded,
          isFetching: false,
          refetch: query.retry,
        }),
      },
    },
  },
}));
let client: QueryClient;
const row = (
  tutorId: string,
  overrides: Partial<ServiceHoursRow> = {},
): ServiceHoursRow => ({
  tutorId,
  englishName: tutorId,
  active: true,
  sessions: 0,
  adjustmentCount: 0,
  earned: 0,
  extras: 0,
  punishments: 0,
  total: 0,
  ...overrides,
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sessionStorage.clear();
  query.error = null;
  query.loaded = true;
  query.retry.mockClear();
  query.rows = [
    row("No records"),
    row("Zero credit", { sessions: 1 }),
    row("Zero adjustment", { adjustmentCount: 1 }),
    row("Deduction", {
      active: false,
      adjustmentCount: 1,
      punishments: 3,
      total: -3,
    }),
    row("same-one", {
      englishName: "Same Name",
      sessions: 1,
      earned: 3,
      total: 3,
    }),
    row("same-two", {
      englishName: "Same Name",
      sessions: 2,
      earned: 5,
      total: 5,
    }),
  ];
});
afterEach(() => {
  cleanup();
  client.clear();
});
function show(locale: "en" | "zh" = "en") {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <SessionViewProvider
          identity="staff"
          pathname="/admin/service-hours"
          verified
        >
          <ServiceHoursPage />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
const rosterNames = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.firstElementChild!.textContent);

it.each(["en", "zh"] as const)(
  "filters evidence independently and keeps program totals separate (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh.admin.summary : en.admin.summary;
    render(show(locale));
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", {
        name: copy.statusLabel,
      }).value,
    ).toBe("active");
    expect(rosterNames()).toHaveLength(5);
    const totals = screen.getByRole("region", { name: copy.programTotals });
    expect(totals.textContent).toContain("5.0");
    fireEvent.change(
      screen.getByRole("combobox", { name: copy.activityLabel }),
      { target: { value: "records" } },
    );
    expect(rosterNames()).toHaveLength(4);
    expect(rosterNames()).not.toContain("No records");
    expect(screen.getByText("Zero credit")).toBeTruthy();
    expect(screen.getByText("Zero adjustment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.viewInactive }));
    expect(rosterNames()).toEqual([`Deduction ${copy.inactive}`]);
    expect(totals.textContent).toContain("5.0");
    expect(
      screen.getByRole("region", {
        name: copy.filteredSubtotal.replace("{count}", "1"),
      }).textContent,
    ).toContain("-3.0");
    fireEvent.click(screen.getByRole("button", { name: copy.resetFilters }));
    expect(rosterNames()).toHaveLength(5);
  },
);

it("keeps same-name IDs distinct, and retains selected sort and rows across summary/breakdown and navigation", () => {
  const view = render(show());
  fireEvent.change(
    screen.getByRole("searchbox", { name: en.admin.summary.searchLabel }),
    { target: { value: " same " } },
  );
  expect(rosterNames()).toEqual(["Same Name", "Same Name"]);
  const sortTotal = () =>
    within(screen.getByRole("table")).getByRole("button", {
      name: en.admin.summary.columns.total,
    });
  fireEvent.click(sortTotal());
  fireEvent.click(sortTotal());
  expect(
    within(screen.getByRole("table")).getAllByRole("row")[1]!.textContent,
  ).toContain("5.0");
  const summary = screen.getByRole("tab", {
    name: en.admin.summary.viewSummary,
  });
  summary.focus();
  fireEvent.keyDown(summary, { key: "ArrowRight" });
  const breakdown = screen.getByRole("tab", {
    name: en.admin.summary.viewBreakdown,
  });
  expect(document.activeElement).toBe(breakdown);
  expect(summary.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(breakdown);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(
    within(screen.getByRole("table")).getAllByRole("columnheader"),
  ).toHaveLength(6);
  expect(
    within(screen.getByRole("table")).getAllByRole("row")[1]!.textContent,
  ).toContain("5.0");
  view.unmount();
  render(show());
  expect(
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: en.admin.summary.searchLabel,
    }).value,
  ).toBe(" same ");
  expect(
    screen
      .getByRole("tab", { name: en.admin.summary.viewBreakdown })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen
      .getByRole("columnheader", { name: en.admin.summary.columns.total })
      .getAttribute("aria-sort"),
  ).toBe("descending");
  expect(rosterNames()).toHaveLength(2);
});

it("distinguishes no matches, an empty roster and an initial read failure", () => {
  const view = render(show());
  fireEvent.change(
    screen.getByRole("searchbox", { name: en.admin.summary.searchLabel }),
    { target: { value: "missing" } },
  );
  expect(screen.getByText(en.admin.summary.noMatches)).toBeTruthy();
  expect(screen.queryByText(en.admin.summary.emptyRoster)).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  query.rows = [];
  view.rerender(show());
  expect(screen.getByText(en.admin.summary.emptyRoster)).toBeTruthy();
  query.loaded = false;
  query.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  view.rerender(show());
  expect(screen.queryByText(en.admin.summary.emptyRoster)).toBeNull();
  expect(
    screen.getByText(
      en.managementRecovery.loadFailed.replace(
        "{section}",
        en.admin.summary.title,
      ),
    ),
  ).toBeTruthy();
});

it("retains filters and totals through refresh failure, but conceals them and clears session choices after denial", () => {
  const view = render(show());
  fireEvent.change(
    screen.getByRole("searchbox", { name: en.admin.summary.searchLabel }),
    { target: { value: "Same" } },
  );
  query.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  view.rerender(show());
  expect(rosterNames()).toHaveLength(2);
  expect(
    screen.getByRole("region", { name: en.admin.summary.programTotals }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: en.managementRecovery.retry.replace(
        "{section}",
        en.admin.summary.title,
      ),
    }),
  );
  expect(query.retry).toHaveBeenCalledOnce();
  query.error = { data: { code: "FORBIDDEN" } };
  view.rerender(show());
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    screen.queryByRole("region", { name: en.admin.summary.programTotals }),
  ).toBeNull();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(
    Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    ).some((key) => key?.includes("service-hours-roster")),
  ).toBe(false);
  query.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  view.rerender(show());
  expect(screen.queryByText("Same Name")).toBeNull();
  query.error = null;
  view.rerender(show());
  expect(
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: en.admin.summary.searchLabel,
    }).value,
  ).toBe("");
});
