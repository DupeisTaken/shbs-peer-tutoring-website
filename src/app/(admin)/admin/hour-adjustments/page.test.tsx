// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  pending: false,
  loading: false,
  error: null as Error | null,
  deleteError: null as Error | null,
  rows: [
    {
      id: "synthetic-adjustment",
      tutor: { englishName: "Alexandra Montgomery-Wellington Synthetic Tutor" },
      month: "2026-09",
      type: "EXTRA" as const,
      amount: 1.5,
      reason:
        "Synthetic explanation with full detail. " +
        "LongUnbrokenReason".repeat(12),
    },
  ],
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { adjustments: { invalidate: vi.fn() } } }),
    admin: {
      tutors: {
        useQuery: () => ({
          data: [
            {
              id: "synthetic-tutor",
              status: "ACTIVE",
              englishName: state.rows[0]!.tutor.englishName,
            },
            { id: "synthetic-archived", englishName: "Past Archived Tutor", status: "ARCHIVED" },
            { id: "synthetic-graduated", englishName: "Past Graduated Tutor", status: "GRADUATED" },
          ],
        }),
      },
      adjustments: {
        useQuery: () => ({
          data: state.rows,
          isLoading: state.loading,
          error: state.error,
        }),
      },
      createAdjustment: {
        useMutation: () => ({
          mutate: state.create,
          isPending: false,
          error: null,
        }),
      },
      deleteAdjustment: {
        useMutation: () => ({
          mutate: state.remove,
          isPending: state.pending,
          error: state.deleteError,
        }),
      },
    },
  },
}));

import AdjustmentsPage from "./page";

function renderPage(locale = "en", readOnly = false) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <AdjustmentsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.pending = false;
  state.loading = false;
  state.error = null;
  state.deleteError = null;
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it("reveals past choices and retains a selected past tutor after hiding the others", () => {
  renderPage();
  expect(screen.queryByRole("option", { name: "Past Archived Tutor" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  expect(screen.getByRole("option", { name: "Past Graduated Tutor" })).toBeTruthy();
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: en.admin.adjustments.table.tutor });
  fireEvent.change(select, { target: { value: "synthetic-archived" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide past tutors" }));
  expect(select.value).toBe("synthetic-archived");
  expect(screen.getByRole("option", { name: "Past Archived Tutor" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Past Graduated Tutor" })).toBeNull();
  // Historical adjustment rows are independent of the current-work picker.
  expect(screen.getByRole("table").textContent).toContain(state.rows[0]!.tutor.englishName);
});

it.each(["en", "zh"])(
  "keeps brief columns and opens the complete reason from rightmost text actions in %s",
  (locale) => {
    renderPage(locale);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
    const row = within(table).getAllByRole("row")[1]!;
    expect(row.textContent).toContain(state.rows[0]!.tutor.englishName);
    expect(row.textContent).not.toContain(state.rows[0]!.reason);
    expect(within(row).getByText("1.5")).toBeTruthy();
    const month = within(row).getByText("2026-09", { selector: "time" });
    expect(month.getAttribute("datetime")).toBe("2026-09");
    const actions = within(row).getAllByRole("cell").at(-1)!;
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
    const detail = within(actions).getByRole("button", {
      name: new RegExp(
        `^${locale === "zh" ? zh.tablePatterns.details : en.tablePatterns.details}:`,
      ),
    });
    expect(detail.className).toContain("table-action-link");
    fireEvent.click(detail);
    expect(
      within(screen.getByRole("dialog")).getByText(state.rows[0]!.reason),
    ).toBeTruthy();
  },
);

it("submits the selected month, half-hour amount and trimmed reason unchanged", () => {
  renderPage();
  fireEvent.change(screen.getByRole("combobox", { name: "Tutor" }), {
    target: { value: "synthetic-tutor" },
  });
  fireEvent.change(screen.getByLabelText("Month"), {
    target: { value: "2026-10" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
    target: { value: "PUNISHMENT" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Amount" }), {
    target: { value: "0.5" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "  Synthetic reason  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(state.create).toHaveBeenCalledWith({
    tutorId: "synthetic-tutor",
    month: "2026-10",
    type: "PUNISHMENT",
    amount: 0.5,
    reason: "Synthetic reason",
  });
});

it("deletes the selected row and disables repeat requests while pending", () => {
  const view = renderPage();
  fireEvent.click(screen.getByRole("button", { name: /^Delete:/ }));
  expect(state.remove).toHaveBeenCalledWith({ id: "synthetic-adjustment" });
  view.unmount();
  state.pending = true;
  renderPage();
  expect(
    screen.getByRole("button", { name: /^Delete:/ }).hasAttribute("disabled"),
  ).toBe(true);
});

it("hides mutations while retaining the rightmost detail action for viewers", () => {
  renderPage("en", true);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Delete:/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^View details:/ })).toBeTruthy();
  expect(screen.getAllByRole("columnheader")).toHaveLength(5);
  expect(screen.getByText("2026-09", { selector: "time" })).toBeTruthy();
});

it("announces loading and request errors", () => {
  state.loading = true;
  const view = renderPage();
  expect(screen.getByRole("status").textContent).toBe("Loading…");
  view.unmount();
  state.loading = false;
  state.error = new Error("Synthetic list failure");
  state.deleteError = new Error("Synthetic delete failure");
  renderPage();
  expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual([
    "Synthetic delete failure",
    "Synthetic list failure",
  ]);
});
