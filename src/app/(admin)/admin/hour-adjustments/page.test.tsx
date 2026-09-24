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
              englishName: state.rows[0]!.tutor.englishName,
            },
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
});
afterEach(cleanup);

it.each(["en", "zh"])(
  "keeps complete records and semantic columns in %s",
  (locale) => {
    renderPage(locale);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    const row = within(table).getAllByRole("row")[1]!;
    expect(row.textContent).toContain(state.rows[0]!.tutor.englishName);
    expect(row.textContent).toContain(state.rows[0]!.reason);
    expect(within(row).getByText("1.5")).toBeTruthy();
    const month = within(row).getByText("2026-09", { selector: "time" });
    expect(month.getAttribute("datetime")).toBe("2026-09");
    // One action survives the responsive reflow, with the record identified for assistive tech.
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(
      within(row).getByRole("button").getAttribute("aria-label"),
    ).toContain("2026-09");
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

it("hides mutation controls and their unused column for viewers", () => {
  renderPage("en", true);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
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
