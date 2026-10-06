/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import SessionFlagsPage from "../(admin)/admin/session-flags/page";
import ServiceHoursPage from "../(admin)/admin/service-hours/page";
import { ReadOnlyProvider } from "./read-only";

const state = vi.hoisted(() => ({
  loaded: true,
  loading: false,
  empty: false,
  pending: false,
  readError: null as null | { message: string; data?: { code: string } },
  writeError: null as null | { message: string; data?: { approvalId: string } },
  retry: vi.fn(),
  decide: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { sessionFlags: { invalidate: vi.fn() } } }),
    admin: {
      periodSummary: {
        useQuery: (input: unknown) => {
          state.summary(input);
          return { data: { scope: { label: "Synthetic semester" }, rows: [] } };
        },
      },
      sessionFlags: {
        useQuery: () => ({
          data: !state.loaded
            ? undefined
            : state.empty
              ? []
              : [
                  {
                    id: "flag",
                    tutor: "Synthetic Tutor",
                    subject: "Synthetic Subject",
                    observed: 1,
                    expected: 2,
                    room: "Synthetic Room",
                    date: new Date("2026-10-01T00:00:00Z"),
                    startMin: 900,
                    endMin: 960,
                  },
                ],
          isLoading: state.loading,
          error: state.readError,
          refetch: state.retry,
        }),
      },
      decideSessionFlag: {
        useMutation: () => ({
          mutate: state.decide,
          isPending: state.pending,
          error: state.writeError,
        }),
      },
    },
  },
}));
beforeEach(() => {
  state.loaded = true;
  state.loading = false;
  state.empty = false;
  state.pending = false;
  state.readError = null;
  state.writeError = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

const flags = (readOnly = false) => (
  <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
    <ReadOnlyProvider value={readOnly}>
      <SessionFlagsPage />
    </ReadOnlyProvider>
  </NextIntlClientProvider>
);

it("separates unknown, failed, denied and successfully empty flag reads", () => {
  state.loaded = false;
  state.loading = true;
  const view = render(flags());
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  state.loading = false;
  state.readError = { message: "Synthetic read failure" };
  view.rerender(flags());
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic read failure",
  );
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.readError = {
    message: "Synthetic access denial",
    data: { code: "FORBIDDEN" },
  };
  view.rerender(flags());
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
  expect(screen.getByRole("status").textContent).toContain(
    "Synthetic access denial",
  );
  state.readError = null;
  state.loaded = true;
  state.empty = true;
  view.rerender(flags());
  expect(screen.getByText(en.admin.sessionFlags.empty)).toBeTruthy();
});

it("retains review inputs through pending writes and read/write failures, then retries the same decision", () => {
  const view = render(flags());
  const note = screen.getByRole<HTMLInputElement>("textbox", {
    name: en.admin.sessionFlags.notePlaceholder,
  });
  const hours = screen.getByRole<HTMLInputElement>("spinbutton", {
    name: en.admin.sessionFlags.penaltyHours,
  });
  fireEvent.change(note, { target: { value: "Synthetic review note" } });
  fireEvent.change(hours, { target: { value: "1.25" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.penalize }),
  );
  expect(state.decide).toHaveBeenCalledExactlyOnceWith({
    flagId: "flag",
    action: "PENALIZE",
    note: "Synthetic review note",
    penaltyHours: 1.25,
  });
  state.pending = true;
  view.rerender(flags());
  expect(note.matches(":disabled")).toBe(true);
  expect(hours.matches(":disabled")).toBe(true);
  state.pending = false;
  state.writeError = { message: "Synthetic rejected write" };
  state.readError = { message: "Synthetic failed refresh" };
  view.rerender(flags());
  expect(note.value).toBe("Synthetic review note");
  expect(hours.value).toBe("1.25");
  expect(note.matches(":disabled")).toBe(true);
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  state.readError = null;
  view.rerender(flags());
  expect(note.matches(":disabled")).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.penalize }),
  );
  expect(state.decide).toHaveBeenCalledTimes(2);
  expect(state.decide.mock.calls[1]).toEqual(state.decide.mock.calls[0]);
});

it("reports a queued proposal without calling it an applied decision or discarding its note", () => {
  const view = render(flags());
  const note = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(note, { target: { value: "Retained proposal note" } });
  state.writeError = {
    message: "Transport error",
    data: { approvalId: "proposal" },
  };
  view.rerender(flags());
  expect(screen.getByRole("status").textContent).toBe(en.approvals.queuedBody);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(note.value).toBe("Retained proposal note");
});

it("keeps viewer records readable without review inputs or mutation actions", () => {
  render(flags(true));
  expect(screen.getByText(/Synthetic Tutor/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(state.decide).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "keeps the %s month filter native, labelled and reversible beside its history link",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <ServiceHoursPage />
      </NextIntlClientProvider>,
    );
    const month = screen.getByLabelText<HTMLInputElement>(
      messages.admin.summary.monthLabel,
      { selector: "input" },
    );
    fireEvent.change(month, { target: { value: "2026-10" } });
    expect(state.summary).toHaveBeenLastCalledWith({ month: "2026-10" });
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.summary.clearMonth }),
    );
    expect(state.summary).toHaveBeenLastCalledWith(undefined);
    expect(month.value).toBe("");
    expect(
      screen.getByRole("link", { name: messages.admin.summary.viewHistory })
        .getAttribute("href"),
    ).toBe("/admin/history");
  },
);
