// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";

type AdjustmentFixture = {
  id: string;
  tutor: { englishName: string };
  month: string;
  type: "EXTRA";
  amount: number;
  reason: string | null;
  source: {
    kind:
      | "INDEPENDENT"
      | "INTERVIEW"
      | "LIVE_INTERVIEW"
      | "ORPHANED_INTERVIEW"
      | "UNRESOLVED_INTERVIEW"
      | "CONFLICTING_INTERVIEW";
    canDelete: boolean;
    correctionHref: string | null;
  };
};

const state = vi.hoisted(() => {
  const rows: AdjustmentFixture[] = [
    {
      id: "synthetic-adjustment",
      tutor: { englishName: "Alexandra Montgomery-Wellington Synthetic Tutor" },
      month: "2026-09",
      type: "EXTRA",
      amount: 1.5,
      reason:
        "Synthetic explanation with full detail. " +
        "LongUnbrokenReason".repeat(12),
      source: {
        kind: "INDEPENDENT",
        canDelete: true,
        correctionHref: null,
      },
    },
  ];
  return {
    create: vi.fn(),
    completeCreate: undefined as undefined | (() => Promise<unknown>),
    failCreate: undefined as undefined | ((error: Error) => Promise<unknown>),
    createError: null as Error | null,
    invalidate: vi.fn(),
    remove: vi.fn(),
    pending: false,
    loading: false,
    error: null as Error | null,
    deleteError: null as Error | null,
    rows,
  };
});

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { adjustments: { invalidate: state.invalidate } },
    }),
    admin: {
      tutors: {
        useQuery: () => ({
          data: [
            {
              id: "synthetic-tutor",
              status: "ACTIVE",
              englishName: state.rows[0]!.tutor.englishName,
            },
            {
              id: "synthetic-archived",
              englishName: "Past Archived Tutor",
              status: "ARCHIVED",
            },
            {
              id: "synthetic-graduated",
              englishName: "Past Graduated Tutor",
              status: "GRADUATED",
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
        useMutation: (options: {
          onSuccess: () => Promise<unknown>;
          onError: (error: Error) => Promise<unknown>;
          onSettled: () => void;
        }) => ({
          mutate: (input: unknown) => {
            state.create(input);
            state.completeCreate = async () => {
              await options.onSuccess();
              options.onSettled();
            };
            state.failCreate = async (error) => {
              state.createError = error;
              await options.onError(error);
              options.onSettled();
            };
          },
          reset: () => {
            state.createError = null;
          },
          isPending: false,
          error: state.createError,
        }),
      },
      deleteAdjustment: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            state.remove(input);
            if (state.deleteError) throw state.deleteError;
          },
          isPending: state.pending,
          error: state.deleteError,
        }),
      },
    },
  },
}));

import AdjustmentsPage from "./page";
const originalAdjustment = state.rows[0]!;

it.each(["en", "zh"])(
  "keeps persistent visible %s labels on all five creation fields",
  (locale) => {
    renderPage(locale);
    fireEvent.click(
      screen.getByRole("button", {
        name: (locale === "zh" ? zh : en).admin.adjustments.create,
      }),
    );
    const labels = (locale === "zh" ? zh : en).admin.adjustments.table;
    for (const name of [
      labels.tutor,
      labels.month,
      labels.type,
      labels.amount,
      labels.reason,
    ]) {
      const field = screen.getByLabelText(name, { selector: "input,select" });
      expect(field.closest("label")?.querySelector(".label")?.textContent).toBe(
        name,
      );
    }
  },
);

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
  state.rows = [
    {
      ...originalAdjustment,
      tutor: { ...originalAdjustment.tutor },
      source: { ...originalAdjustment.source },
    },
  ];
  state.completeCreate = undefined;
  state.failCreate = undefined;
  state.createError = null;
  state.pending = false;
  state.loading = false;
  state.error = null;
  state.deleteError = null;
  vi.clearAllMocks();
  state.invalidate.mockReset().mockResolvedValue(undefined);
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

// Completing the write must retire its draft even though the list underneath
// the modal also refreshes. An unchanged Add button must not duplicate hours.
it("audit: retires an accepted hour adjustment before another Add can replay it", async () => {
  renderPage();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.adjustments.create }),
  );
  fireEvent.change(screen.getByLabelText(en.admin.adjustments.table.tutor), {
    target: { value: "synthetic-tutor" },
  });
  fireEvent.change(screen.getByLabelText(en.admin.adjustments.table.reason), {
    target: { value: "Synthetic accepted adjustment" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.adjustments.form.add }),
  );
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    await state.completeCreate?.();
  });
  const repeat = screen.queryByRole("button", {
    name: en.admin.adjustments.form.add,
  });
  if (repeat) fireEvent.click(repeat);
  expect(state.create).toHaveBeenCalledTimes(1);
});

function openAdjustmentDraft() {
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.adjustments.create }),
  );
  fireEvent.change(screen.getByLabelText(en.admin.adjustments.table.tutor), {
    target: { value: "synthetic-tutor" },
  });
  fireEvent.change(screen.getByLabelText(en.admin.adjustments.table.reason), {
    target: { value: "Retained synthetic reason" },
  });
  return screen
    .getByLabelText(en.admin.adjustments.table.reason)
    .closest("form")!;
}

it("admits one same-tick adjustment and prevents pending dismissal", () => {
  renderPage();
  const form = openAdjustmentDraft();
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  const close = within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>(
    "button",
    { name: en.accountProfile.close },
  );
  expect(close.disabled).toBe(true);
  fireEvent.click(close);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("preserves a failed adjustment draft and permits an intentional retry", async () => {
  renderPage();
  const form = openAdjustmentDraft();
  fireEvent.submit(form);
  await act(async () => {
    await state.failCreate?.(new Error("Synthetic write failure"));
  });
  expect(screen.getByRole("alert").textContent).toBe("Synthetic write failure");
  expect(
    screen.getByLabelText<HTMLInputElement>(en.admin.adjustments.table.reason)
      .value,
  ).toBe("Retained synthetic reason");
  fireEvent.submit(form);
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[1]).toEqual(state.create.mock.calls[0]);
});

it.each([false, true])(
  "retires an accepted draft and recovers only reads after failed refresh (queued=%s)",
  async (queued) => {
    // Model React Query's swallowed refresh failure: invalidateAndReport observes
    // the matching reader's error revision after all active reads have settled.
    state.invalidate.mockImplementationOnce(
      async (
        _input: unknown,
        filters: {
          predicate: (read: {
            state: { errorUpdateCount: number; error: unknown };
          }) => boolean;
        },
      ) => {
        const read = { state: { errorUpdateCount: 0, error: null as unknown } };
        filters.predicate(read);
        read.state.errorUpdateCount = 1;
        read.state.error = new Error("Synthetic refresh failure");
      },
    );
    renderPage();
    fireEvent.submit(openAdjustmentDraft());
    await act(async () => {
      if (queued)
        await state.failCreate?.(
          Object.assign(new Error("Queued"), {
            data: { approvalId: "synthetic-approval" },
          }),
        );
      else await state.completeCreate?.();
    });
    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText(
        queued ? en.actionReview.queued : en.actionReview.applied,
      ),
    ).toBeTruthy();
    expect(
      dialog.queryByRole("button", { name: en.admin.adjustments.form.add }),
    ).toBeNull();
    expect(
      dialog.getByRole<HTMLButtonElement>("button", {
        name: en.admin.adjustments.create,
      }).disabled,
    ).toBe(true);
    if (queued)
      expect(
        dialog
          .getByRole("link", { name: en.actionReview.viewRequest })
          .getAttribute("href"),
      ).toBe("/admin/approvals?request=synthetic-approval");
    fireEvent.click(
      dialog.getByRole("button", { name: en.actionReview.retry }),
    );
    await waitFor(() =>
      expect(
        dialog.queryByRole("button", { name: en.actionReview.retry }),
      ).toBeNull(),
    );
    expect(state.invalidate).toHaveBeenCalledTimes(2);
    expect(state.create).toHaveBeenCalledTimes(1);
    // A distinct explicit entry starts an empty draft; it cannot replay the receipt.
    fireEvent.click(
      dialog.getByRole("button", { name: en.admin.adjustments.create }),
    );
    expect(
      dialog.getByLabelText<HTMLInputElement>(en.admin.adjustments.table.reason)
        .value,
    ).toBe("");
    expect(
      dialog.getByRole<HTMLButtonElement>("button", {
        name: en.admin.adjustments.form.add,
      }).disabled,
    ).toBe(true);
  },
);

it("reveals past choices and retains a selected past tutor after hiding the others", () => {
  renderPage();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.adjustments.create }),
  );
  expect(
    screen.queryByRole("option", { name: "Past Archived Tutor" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  expect(
    screen.getByRole("option", { name: "Past Graduated Tutor" }),
  ).toBeTruthy();
  const select = screen.getByRole<HTMLSelectElement>("combobox", {
    name: en.admin.adjustments.table.tutor,
  });
  fireEvent.change(select, { target: { value: "synthetic-archived" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide past tutors" }));
  expect(select.value).toBe("synthetic-archived");
  expect(
    screen.getByRole("option", { name: "Past Archived Tutor" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "Past Graduated Tutor" }),
  ).toBeNull();
  // Historical adjustment rows are independent of the current-work picker.
  expect(screen.getByRole("table").textContent).toContain(
    state.rows[0]!.tutor.englishName,
  );
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
    const reason = state.rows[0]!.reason;
    if (typeof reason !== "string")
      throw new Error(
        "The complete-reason fixture must contain its explanation",
      );
    expect(within(screen.getByRole("dialog")).getByText(reason)).toBeTruthy();
  },
);

it("submits the selected month, half-hour amount and trimmed reason unchanged", () => {
  renderPage();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.adjustments.create }),
  );
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

it("reviews the selected record, cancels without a write and deletes only after confirmation", async () => {
  const view = renderPage();
  fireEvent.click(screen.getByRole("button", { name: /^Delete:/ }));
  expect(state.remove).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").textContent).toContain(
    state.rows[0]!.reason,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Delete:/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete adjustment" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Change applied"),
  );
  expect(state.remove).toHaveBeenCalledWith({ id: "synthetic-adjustment" });
  view.unmount();
  state.pending = true;
  renderPage();
});

it("retains the adjustment and exact review after a failed deletion", async () => {
  state.deleteError = new Error("Synthetic delete failure");
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: /^Delete:/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete adjustment" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Synthetic delete failure",
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    state.rows[0]!.tutor.englishName,
  );
  state.deleteError = null;
  fireEvent.click(screen.getByRole("button", { name: "Delete adjustment" }));
  await waitFor(() => expect(state.remove).toHaveBeenCalledTimes(2));
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
    "Synthetic list failure",
  ]);
});

it.each(["en", "zh"] as const)(
  "uses server source metadata for protected credit actions and preserves independent deletion (%s)",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const href = "/admin/applications#interview-completion-source_application";
    state.rows = [
      {
        ...originalAdjustment,
        id: "interview_source_manual_note",
        tutor: { englishName: "Independent Prefix Neighbor" },
        reason: "Completed interview service",
        source: { kind: "INDEPENDENT", canDelete: true, correctionHref: null },
      },
      {
        ...originalAdjustment,
        id: "live-source",
        tutor: { englishName: "Live Interview Recipient" },
        source: {
          kind: "LIVE_INTERVIEW",
          canDelete: false,
          correctionHref: href,
        },
      },
      {
        ...originalAdjustment,
        id: "conflicting-source",
        tutor: { englishName: "Conflicting Source Recipient" },
        source: {
          kind: "CONFLICTING_INTERVIEW",
          canDelete: false,
          correctionHref: null,
        },
      },
    ];
    renderPage(locale);
    const manual = screen.getByRole("row", {
      name: /Independent Prefix Neighbor/,
    });
    const live = screen.getByRole("row", { name: /Live Interview Recipient/ });
    const conflict = screen.getByRole("row", {
      name: /Conflicting Source Recipient/,
    });
    expect(
      within(manual).getByRole("button", {
        name: new RegExp(`^${messages.admin.adjustments.table.delete}:`),
      }),
    ).toBeTruthy();
    expect(
      within(manual).queryByText(messages.admin.adjustments.source.interview),
    ).toBeNull();
    expect(
      within(live).queryByRole("button", {
        name: new RegExp(`^${messages.admin.adjustments.table.delete}:`),
      }),
    ).toBeNull();
    expect(
      within(live).getByText(messages.admin.adjustments.source.interview),
    ).toBeTruthy();
    expect(
      within(live)
        .getByRole("link", {
          name: new RegExp(`^${messages.admin.adjustments.source.correct}:`),
        })
        .getAttribute("href"),
    ).toBe(href);
    expect(
      within(conflict).getByText(messages.admin.adjustments.source.conflicting),
    ).toBeTruthy();
    expect(within(conflict).queryByRole("link")).toBeNull();
    expect(
      within(conflict).queryByRole("button", {
        name: new RegExp(`^${messages.admin.adjustments.table.delete}:`),
      }),
    ).toBeNull();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  },
);

it.each(["ORPHANED_INTERVIEW", "UNRESOLVED_INTERVIEW"] as const)(
  "labels %s without inventing a correction link or overriding its server action support",
  (kind) => {
    state.rows = [
      {
        ...originalAdjustment,
        source: { kind, canDelete: true, correctionHref: null },
      },
    ];
    renderPage();
    expect(
      screen.getByText(
        kind === "ORPHANED_INTERVIEW"
          ? en.admin.adjustments.source.orphaned
          : en.admin.adjustments.source.unresolved,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", {
        name: new RegExp(`^${en.admin.adjustments.source.correct}:`),
      }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /^Delete:/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^View details:/ }));
    expect(
      screen.getByText(en.admin.adjustments.source.unavailable),
    ).toBeTruthy();
    expect(state.remove).not.toHaveBeenCalled();
  },
);

it("shows a coarse interview source for observers without private correction navigation or deletion", () => {
  state.rows = [
    {
      ...originalAdjustment,
      reason: null,
      source: { kind: "INTERVIEW", canDelete: false, correctionHref: null },
    },
  ];
  renderPage("en", true);
  expect(screen.getByText(en.admin.adjustments.source.interview)).toBeTruthy();
  expect(
    screen.queryByRole("link", {
      name: new RegExp(`^${en.admin.adjustments.source.correct}:`),
    }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /^Delete:/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^View details:/ }));
  expect(screen.queryByText(originalAdjustment.reason!)).toBeNull();
  expect(state.remove).not.toHaveBeenCalled();
});
