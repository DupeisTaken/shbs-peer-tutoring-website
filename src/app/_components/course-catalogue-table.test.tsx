// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { CourseCatalogueTable } from "./course-catalogue-table";

afterEach(cleanup);
const subjects = [
  { id: "1", name: "Algebra", levelId: null, active: false },
  { id: "2", name: "AP Biology", levelId: "ap", active: true },
  { id: "3", name: "AP Chemistry", levelId: "ap", active: false },
  { id: "4", name: "Biology", levelId: "regular", active: true },
];
const levels = [
  { id: "regular", name: "Standard" },
  { id: "ap", name: "AP" },
];
const show = (
  overrides: Partial<React.ComponentProps<typeof CourseCatalogueTable>> = {},
) => {
  const onApply = vi.fn().mockResolvedValue({ count: 1 });
  const props = {
    subjects,
    levels,
    readOnly: false,
    pending: false,
    onApply,
    ...overrides,
  };
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CourseCatalogueTable {...props} />
    </NextIntlClientProvider>,
  );
  return { ...view, onApply, props };
};
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText<HTMLInputElement>(label), {
    target: { value },
  });
const rows = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);

it("combines case-insensitive search, level and status without changing catalogue data or name order", () => {
  const before = structuredClone(subjects);
  show();
  change("Search course names", "  bIOLogy  ");
  expect(rows()).toHaveLength(2);
  change("Level", "ap");
  change("Status", "active");
  expect(rows()).toEqual([expect.stringContaining("AP Biology")]);
  expect(screen.getByRole("status").textContent).toBe("1 of 4 subjects");
  expect(subjects).toEqual(before);
  fireEvent.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "Clear filters" }),
  );
  expect(rows()).toHaveLength(4);
});

it("finds no-level inactive offerings, handles no matches and clears all filters together", () => {
  show();
  change("Level", "none");
  change("Status", "inactive");
  expect(rows()).toEqual([expect.stringContaining("Algebra")]);
  change("Search course names", "biology");
  expect(screen.getByText("No subjects match these filters.")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("Select all visible").disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Clear filters"));
  expect(rows()).toHaveLength(4);
});

it("selects only visible rows and applies only visible selections while explicitly retaining hidden ones", async () => {
  const { onApply } = show();
  change("Level", "ap");
  fireEvent.click(
    screen.getByLabelText<HTMLInputElement>("Select all visible"),
  );
  expect(screen.getByText("2 selected · 0 hidden")).toBeTruthy();
  change("Status", "active");
  expect(screen.getByText("2 selected · 1 hidden")).toBeTruthy();
  change("Set status", "inactive");
  fireEvent.click(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Apply to 1 visible selected",
    }),
  );
  await waitFor(() =>
    expect(onApply).toHaveBeenCalledWith({ ids: ["2"], active: false }),
  );
  await waitFor(() =>
    expect(screen.getByText("1 selected · 1 hidden")).toBeTruthy(),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Apply to 0 visible selected",
    }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Clear filters"));
  expect(
    screen.getByLabelText<HTMLInputElement>("Select AP Chemistry").checked,
  ).toBe(true);
  fireEvent.click(screen.getByText("Clear selection"));
  expect(screen.getByText("0 selected · 0 hidden")).toBeTruthy();
});

it("deselects only the visible rows and shows partial selection accurately", () => {
  show();
  fireEvent.click(screen.getByLabelText<HTMLInputElement>("Select Algebra"));
  expect(
    screen.getByLabelText<HTMLInputElement>("Select all visible").indeterminate,
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText<HTMLInputElement>("Select all visible"),
  );
  change("Level", "ap");
  fireEvent.click(
    screen.getByLabelText<HTMLInputElement>("Select all visible"),
  );
  expect(screen.getByText("2 selected · 2 hidden")).toBeTruthy();
});

it("retains selections on errors and submits explicit no-level batch updates", async () => {
  const onApply = vi.fn().mockRejectedValue(new Error("Conflict"));
  show({ onApply });
  fireEvent.click(screen.getByLabelText<HTMLInputElement>("Select AP Biology"));
  change("Set level", "none");
  fireEvent.click(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Apply to 1 visible selected",
    }),
  );
  await waitFor(() =>
    expect(onApply).toHaveBeenCalledWith({ ids: ["2"], levelId: null }),
  );
  expect(screen.getByText("1 selected · 0 hidden")).toBeTruthy();
});

it("permits read-only filtering but exposes no selection or mutation controls", () => {
  show({ readOnly: true });
  change("Search course names", "biology");
  expect(rows()).toHaveLength(2);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText("Set status")).toBeNull();
});

it("excludes removed rows after refresh, disables pending writes and handles an empty catalogue", () => {
  const { rerender, props } = show();
  fireEvent.click(screen.getByLabelText<HTMLInputElement>("Select Algebra"));
  rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <CourseCatalogueTable {...props} subjects={subjects.slice(1)} pending />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("0 selected · 0 hidden")).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("Select all visible").disabled,
  ).toBe(true);
  rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <CourseCatalogueTable {...props} subjects={[]} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("No subjects yet.")).toBeTruthy();
});
