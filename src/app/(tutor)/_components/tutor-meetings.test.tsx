// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { TutorMeetings } from "./tutor-meetings";
const state = vi.hoisted(() => ({
  quarters: true,
  history: false,
  empty: false,
  read: vi.fn<(input: { period: string }) => void>(),
  mutate: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  pending: false,
  error: "",
  success: false,
  excused: false,
  status: null as null | "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT" | "EXEMPT",
  cancelError: "",
  canExcuse: true,
  meetingDate: new Date("2026-10-10T00:00:00Z"),
  serverNow: undefined as Date | undefined,
  onSuccess: async (): Promise<void> => undefined,
  onError: (_err?: { data?: { code?: string } }): void => undefined,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myMeetings: { invalidate: state.refresh },
        meetingRecords: { invalidate: vi.fn() },
        meetingPeriods: { invalidate: vi.fn() },
      },
      personalSchedule: {
        meetings: { invalidate: vi.fn() },
        meetingDetail: { invalidate: vi.fn() },
      },
    }),
    tutor: {
      meetingPeriods: {
        useQuery: () => ({
          data: {
            quarters: state.quarters,
            current: state.quarters
              ? { key: "26-27:Q1", label: "2026–27 Q1" }
              : { key: "26-27:S1", label: "2026–27 S1" },
            outsideUpcoming: 0,
            history: state.history
              ? [{ key: "25-26:Q4", label: "2025–26 Q4", count: 1 }]
              : [],
          },
        }),
      },
      meetingRecords: {
        useQuery: (input: { period: string }) => {
          state.read(input);
          return {
            data:
              state.empty && input.period === "26-27:Q1"
                ? []
                : [
                    {
                      id: "meeting",
                      title:
                        input.period === "26-27:Q1"
                          ? "Synthetic meeting"
                          : "Historical meeting",
                      date: state.meetingDate,
                      excused: state.excused,
                      canExcuse: state.canExcuse,
                      upcoming: true,
                      status: state.status,
                      serverNow: state.serverNow,
                    },
                  ],
          };
        },
      },
      excuseMeeting: {
        useMutation: (options: {
          onSuccess: () => Promise<void>;
          onError?: (err: { data?: { code?: string } }) => void;
        }) => {
          state.onSuccess = options.onSuccess;
          state.onError = (err) => options.onError?.(err ?? {});
          return {
            mutate: state.mutate,
            isPending: state.pending,
            isSuccess: state.success,
            error: state.error ? new Error(state.error) : null,
          };
        },
      },
      cancelMeetingExcuse: {
        useMutation: () => ({
          mutate: state.cancel,
          error: state.cancelError ? new Error(state.cancelError) : null,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.history = false;
  state.quarters = true;
  state.empty = false;
  state.pending = false;
  state.error = "";
  state.success = false;
  state.excused = false;
  state.status = null;
  state.cancelError = "";
  state.canExcuse = true;
  state.meetingDate = new Date("2026-10-10T00:00:00Z");
  state.serverNow = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps personal history reachable with an empty current quarter and no history writes", async () => {
  state.history = true;
  state.empty = true;
  render(element());
  expect(screen.getByText(messages.meetingPeriods.empty)).toBeTruthy();
  expect(
    state.read.mock.calls.every(([input]) => input.period === "26-27:Q1"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  for (const label of ["2025–26 Q4 · 1 meeting"]) {
    const details = screen.getByText(label).closest("details")!;
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
  }
  expect(screen.getByText("Historical meeting")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  ).toBeNull();
  expect(screen.getByText(messages.auditEventDetails.notRecorded)).toBeTruthy();
  expect(state.mutate).not.toHaveBeenCalled();
});
const element = (locale = "en") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : messages}
  >
    <TutorMeetings />
  </NextIntlClientProvider>
);
const start = () => {
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Exam conflict draft" },
  });
  return view;
};
it("keeps an excuse draft and pending owner through Q→S→Q grouping changes", () => {
  const view = start();
  const draft = screen.getByRole<HTMLInputElement>("textbox");
  state.quarters = false;
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.value).toBe("Exam conflict draft");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.meetingPeriods.reload,
    }).disabled,
  ).toBe(true);
  state.pending = false;
  state.quarters = true;
  view.rerender(element());
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(
    screen.queryByText(messages.meetingPeriods.groupingChanged),
  ).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});
it("cancel writes nothing; failed writes retain the reason and pending writes freeze it", async () => {
  let view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.common.dismiss }),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  view.unmount();
  view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    meetingId: "meeting",
    reason: "Exam conflict draft",
  });
  state.error = "Deadline changed. Try again.";
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
  expect(screen.getByRole("alert").textContent).toContain(state.error);
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.common.dismiss,
    }).disabled,
  ).toBe(true);
  await act(async () => state.onSuccess());
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("retains the server's meeting cutoff instead of offering a forbidden excuse", () => {
  state.canExcuse = false;
  render(element());
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  ).toBeNull();
  expect(screen.getByText(messages.tutor.meetings.tooLate)).toBeTruthy();
});

it("uses standard controls for the reason draft and both row actions", () => {
  start();
  for (const control of [
    screen.getByRole("textbox"),
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
    screen.getByRole("button", { name: messages.common.dismiss }),
  ]) {
    expect(control.className).toContain("control-standard");
    expect(control.className).not.toContain("btn-sm");
  }
});

it("does not announce an earlier success beside a failed cancellation", async () => {
  const view = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  state.success = true;
  state.excused = true;
  await act(async () => state.onSuccess());
  view.rerender(element());
  expect(screen.getByRole("status").textContent).toBe(messages.workflows.saved);
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.cancelExcuse }),
  );
  state.cancelError = "Cancellation failed";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe("Cancellation failed");
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  { locale: "en", catalog: messages, action: "Submit absence excuse" },
  { locale: "zh", catalog: zh, action: "提交请假说明" },
])(
  "names the $locale inline absence action and keeps the original request",
  ({ locale, catalog, action }) => {
    render(element(locale));
    fireEvent.click(
      screen.getByRole("button", { name: catalog.tutor.meetings.excuseBtn }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  Exam conflict draft  " },
    });
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
      meetingId: "meeting",
      reason: "Exam conflict draft",
    });
  },
);

it("auto-hides the open excuse form at the server-anchored 45-minute cutoff and transitions to past status at start", () => {
  vi.useFakeTimers();
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  state.meetingDate = new Date("2026-10-10T10:00:00.000Z");
  state.serverNow = new Date("2026-10-10T09:14:00.000Z"); // 46 min before start
  start();

  // Exact 45-minute boundary remains inclusive.
  monotonic = 60_000;
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  ).toBeTruthy();

  // 1 ms past the 45-minute cutoff auto-hides the inline excuse interface.
  monotonic = 60_001;
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  ).toBeNull();
  expect(screen.getByText(messages.tutor.meetings.tooLate)).toBeTruthy();
  expect(state.mutate).not.toHaveBeenCalled();

  // Once the meeting start time passes, transition to the past status badge.
  monotonic = 46 * 60_000 + 1;
  act(() => {
    vi.advanceTimersByTime(45 * 60_000);
  });
  expect(screen.queryByText(messages.tutor.meetings.tooLate)).toBeNull();
  expect(screen.getByText(messages.auditEventDetails.notRecorded)).toBeTruthy();
});

it.each([
  { locale: "en", catalog: messages },
  { locale: "zh", catalog: zh },
])(
  "auto-hides Cancel Excuse after the 45-minute cutoff passes ($locale)",
  ({ locale, catalog }) => {
    vi.useFakeTimers();
    let monotonic = 0;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    state.excused = true;
    state.meetingDate = new Date("2026-10-10T10:00:00.000Z");
    state.serverNow = new Date("2026-10-10T09:14:00.000Z");
    render(element(locale));
    expect(
      screen.getByRole("button", { name: catalog.tutor.meetings.cancelExcuse }),
    ).toBeTruthy();

    monotonic = 60_001;
    act(() => {
      vi.advanceTimersByTime(60_001);
    });
    expect(
      screen.queryByRole("button", { name: catalog.tutor.meetings.cancelExcuse }),
    ).toBeNull();
    expect(screen.getByText(catalog.tutor.meetings.excusedBadge)).toBeTruthy();
    expect(state.cancel).not.toHaveBeenCalled();
  },
);

it("renders staff-recorded attendance on an upcoming meeting as a read-only status badge and refreshes on CONFLICT", async () => {
  state.status = "PRESENT";
  state.excused = false;
  state.canExcuse = false;
  const view = render(element());
  expect(screen.getByText(messages.admin.meetings.status.present)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.tutor.meetings.cancelExcuse }),
  ).toBeNull();
  expect(screen.queryByText(messages.tutor.meetings.tooLate)).toBeNull();

  view.unmount();
  state.status = null;
  state.canExcuse = true;
  const formView = start();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  state.error = "Staff recorded attendance for this meeting. Ask staff to correct it.";
  await act(async () => {
    state.onError({ data: { code: "CONFLICT" } });
  });
  formView.rerender(element());
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert").textContent).toContain("Staff recorded attendance");
});
