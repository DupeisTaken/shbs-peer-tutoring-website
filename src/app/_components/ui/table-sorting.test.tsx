/** @vitest-environment jsdom */
import { Fragment, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SummaryTable, TableActions, TableDetails } from "./summary-table";
import { nextSort } from "../sortable";
import { pairingScheduleSortValue } from "~/lib/pairing-schedule";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";

afterEach(cleanup);
const source: {
  id: string;
  name: string;
  hours: number | null;
  date: number | null;
}[] = [
  { id: "z", name: "Room 10", hours: 2.75, date: 30 },
  { id: "a", name: "Room 2", hours: -1.5, date: 10 },
  { id: "b", name: "Room 2", hours: 2.1, date: 20 },
  { id: "missing", name: "", hours: null, date: null },
];
function Draft({ id }: { id: string }) {
  const [value, setValue] = useState(id);
  return (
    <input
      aria-label={`Draft ${id}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
function Example({
  rows = source,
  sortable = true,
  extra = true,
  locale = "en",
}: {
  rows?: typeof source;
  sortable?: boolean;
  extra?: boolean;
  locale?: string;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="UTC"
    >
      <SummaryTable label="Information" sortable={sortable}>
        <thead>
          <tr>
            {extra && <th data-sortable={false}>Select</th>}
            <th>Name</th>
            <Fragment>
              <th>Hours</th>
              <th>Date</th>
            </Fragment>
            <th className="table-actions-heading">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr key="loading">
            <td colSpan={extra ? 5 : 4}>Refreshing</td>
          </tr>
          {rows.map((row) => (
            <tr key={row.id} data-testid={row.id}>
              {extra && (
                <td>
                  <input type="checkbox" aria-label={`Select ${row.id}`} />
                </td>
              )}
              <th scope="row">{row.name || "—"}</th>
              <Fragment>
                <td data-sort-value={row.hours ?? ""}>
                  {row.hours ?? "Unknown"} h
                </td>
                <td data-sort-value={row.date ?? ""}>
                  Localized date {row.id}
                </td>
              </Fragment>
              <TableActions>
                <Draft id={row.id} />
                <TableDetails title={row.id}>
                  <p>Private detail</p>
                </TableDetails>
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
    </NextIntlClientProvider>
  );
}
const order = () =>
  screen
    .getAllByTestId(/^(z|a|b|missing)$/)
    .map((row) => row.getAttribute("data-testid"));
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

it.each(["en", "zh"])(
  "cycles natural text order, stable ties, missing-last and original order (%s)",
  (locale) => {
    render(<Example locale={locale} />);
    expect(order()).toEqual(["z", "a", "b", "missing"]);
    click("Name");
    expect(order()).toEqual(["a", "b", "z", "missing"]);
    expect(
      screen
        .getByRole("columnheader", { name: "Name" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");
    click("Name");
    expect(order()).toEqual(["z", "a", "b", "missing"]);
    expect(
      screen
        .getByRole("columnheader", { name: "Name" })
        .getAttribute("aria-sort"),
    ).toBe("descending");
    click("Name");
    expect(order()).toEqual(["z", "a", "b", "missing"]);
    expect(
      screen
        .getByRole("columnheader", { name: "Name" })
        .hasAttribute("aria-sort"),
    ).toBe(false);
    expect(screen.queryByText("Private detail")).toBeNull();
  },
);

it("uses signed decimal values and raw dates, resets a new column and leaves non-data headers alone", () => {
  render(<Example />);
  click("Hours");
  expect(order()).toEqual(["a", "b", "z", "missing"]);
  click("Hours");
  expect(order()).toEqual(["z", "b", "a", "missing"]);
  click("Date");
  expect(order()).toEqual(["a", "b", "z", "missing"]);
  expect(
    screen
      .getByRole("columnheader", { name: "Hours" })
      .hasAttribute("aria-sort"),
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.getAllByRole("row")[1]?.textContent).toBe("Refreshing");
});

it("retains keyed drafts, selection and header focus through sorting and live refreshes", () => {
  const view = render(<Example />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft z",
  });
  fireEvent.change(draft, { target: { value: "Unsaved draft" } });
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Select z",
  });
  fireEvent.click(checkbox);
  const button = screen.getByRole("button", { name: "Hours" });
  button.focus();
  click("Hours");
  expect(document.activeElement).toBe(button);
  expect(screen.getByRole("textbox", { name: "Draft z" })).toBe(draft);
  expect(draft.value).toBe("Unsaved draft");
  expect(checkbox.checked).toBe(true);
  const refreshed = [source[2]!, { ...source[0]!, hours: -5 }, source[1]!];
  view.rerender(<Example rows={refreshed} />);
  expect(order()).toEqual(["z", "a", "b"]);
  click("Hours");
  click("Hours");
  expect(order()).toEqual(["b", "z", "a"]);
  expect(draft.value).toBe("Unsaved draft");
  expect(source.map((row) => row.id)).toEqual(["z", "a", "b", "missing"]);
});

it("does not apply an old column index to a newly conditional header", () => {
  const view = render(<Example />);
  click("Hours");
  view.rerender(<Example extra={false} />);
  expect(
    screen
      .getByRole("columnheader", { name: "Date" })
      .hasAttribute("aria-sort"),
  ).toBe(false);
  expect(
    screen
      .getByRole("columnheader", { name: "Hours" })
      .getAttribute("aria-sort"),
  ).toBe("ascending");
  expect(order()).toEqual(["a", "b", "z", "missing"]);
});

it("keeps logs and paginated tables unsortable and handles empty information tables", () => {
  const view = render(<Example sortable={false} />);
  expect(screen.queryByRole("button", { name: "Name" })).toBeNull();
  view.rerender(<Example rows={[]} />);
  click("Name");
  click("Name");
  click("Name");
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

it("keeps independent tables independent and sort controls never submit a containing form", () => {
  const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <form onSubmit={submit}>
      <Example />
      <Example />
    </form>,
  );
  const tables = screen.getAllByRole("table");
  fireEvent.click(within(tables[0]!).getByRole("button", { name: "Hours" }));
  expect(
    within(tables[1]!)
      .getByRole("columnheader", { name: "Hours" })
      .hasAttribute("aria-sort"),
  ).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("transitions atomically and orders weekly schedules chronologically without sorting unknown placeholders", () => {
  let state = { key: "name", dir: "none" as const } as Parameters<
    typeof nextSort
  >[0];
  for (const dir of ["asc", "desc", "none", "asc"]) {
    state = nextSort(state, "name");
    expect(state.dir).toBe(dir);
  }
  expect(nextSort(state, "hours")).toEqual({ key: "hours", dir: "asc" });
  const monday = {
    scheduleConfirmed: true,
    dayOfWeek: 1,
    startMin: 900,
    endMin: 960,
  };
  expect(pairingScheduleSortValue(monday)).toBeLessThan(
    pairingScheduleSortValue({ ...monday, dayOfWeek: 2 }) as number,
  );
  expect(
    pairingScheduleSortValue({ ...monday, scheduleConfirmed: false }),
  ).toBe("");
});
