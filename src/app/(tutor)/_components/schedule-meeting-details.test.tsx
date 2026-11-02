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
import { ScheduleMeetingDetails } from "./schedule-meeting-details";

const state = vi.hoisted(() => ({
  pending: false,
  readError: null as { message: string; data?: { code: string } } | null,
  writeError: null as Error | null,
  success: false,
  canExcuse: true,
  close: vi.fn(),
  mutate: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  detailRead: vi.fn(),
  sourceRead: vi.fn(),
  onSuccess: async (): Promise<void> => undefined,
  onError: (): void => undefined,
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
    personalSchedule: {
      meetingDetail: {
        useQuery: (
          input: { meetingId: string },
          options: { enabled: boolean },
        ) => {
          state.detailRead(input, options);
          return {
            data: options.enabled
              ? {
                  id: input.meetingId,
                  title: `Synthetic ${input.meetingId}`,
                  date: new Date("2026-10-29T08:00:00Z"),
                  status: null,
                  reason: "Private own reason",
                  excused: false,
                  canExcuse: state.canExcuse,
                  upcoming: true,
                }
              : undefined,
            error: state.readError,
            isLoading: false,
            isFetching: false,
            isSuccess: !state.readError,
            refetch: state.retry,
          };
        },
      },
      meetings: {
        useQuery: () => ({
          data: { appointments: [] },
          error: state.readError,
          isSuccess: !state.readError,
          refetch: state.retry,
        }),
      },
    },
    tutor: {
      meetingPeriods: {
        useQuery: () => ({
          data: {
            quarters: true,
            current: { key: "26-27:Q1", label: "2026–27 Q1" },
            outsideUpcoming: 1,
            history: [{ key: "25-26:Q4", label: "2025–26 Q4", count: 1 }],
          },
        }),
      },
      meetingRecords: {
        useQuery: (input: { period: string }) => {
          state.sourceRead(input);
          return {
            data:
              input.period === "26-27:Q1"
                ? []
                : [
                    {
                      id:
                        input.period === "upcomingOutside"
                          ? "outside"
                          : "historical",
                      title:
                        input.period === "upcomingOutside"
                          ? "Future outside window"
                          : "Historical evidence",
                      date: new Date(
                        input.period === "upcomingOutside"
                          ? "2026-12-10T08:00:00Z"
                          : "2026-10-10T08:00:00Z",
                      ),
                      status: "PRESENT",
                      reason: null,
                      excused: false,
                      canExcuse: true,
                      upcoming: input.period === "upcomingOutside",
                    },
                  ],
          };
        },
      },
      excuseMeeting: {
        useMutation: (options: {
          onSuccess: () => Promise<void>;
          onError: () => void;
        }) => {
          state.onSuccess = options.onSuccess;
          state.onError = options.onError;
          return {
            mutate: state.mutate,
            isPending: state.pending,
            error: state.writeError,
            isSuccess: state.success,
          };
        },
      },
      cancelMeetingExcuse: {
        useMutation: () => ({ mutate: state.cancel, isPending: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.refresh.mockReset();
  state.pending = false;
  state.readError = null;
  state.writeError = null;
  state.success = false;
  state.canExcuse = true;
});

const element = (
  id: string | null = "one",
  showAll = false,
  locale = "en",
  enabled = true,
) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : messages}
  >
    <ScheduleMeetingDetails
      meetingId={id}
      showAll={showAll}
      enabled={enabled}
      onClose={state.close}
    />
  </NextIntlClientProvider>
);
function edit(value = "Exam conflict draft") {
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

it("mounts no detail read until selection and retains separate drafts through Close/reopen", () => {
  const view = render(element(null));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.detailRead).toHaveBeenLastCalledWith(
    { meetingId: "" },
    { enabled: false },
  );
  view.rerender(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: messages.accountProfile.close }),
  );
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.mutate).not.toHaveBeenCalled();
  view.rerender(element(null));
  view.rerender(element("two"));
  edit("Other meeting draft");
  view.rerender(element("one"));
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.excuseBtn }),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
});

it("retains rejected drafts, freezes pending input and admits one same-turn request", async () => {
  const view = render(element());
  edit("  Exam conflict draft  ");
  const submit = screen.getByRole("button", {
    name: messages.tutor.meetings.submitExcuse,
  });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
    meetingId: "one",
    reason: "Exam conflict draft",
  });
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.accountProfile.close,
    }).disabled,
  ).toBe(true);
  state.pending = false;
  state.writeError = new Error("Rejected excuse");
  await act(async () => state.onError());
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "  Exam conflict draft  ",
  );
  expect(screen.getByRole("alert").textContent).toBe("Rejected excuse");
});

it("conceals a pending owner's private DOM when disabled and preserves its rejected draft for authorized recovery", async () => {
  const view = render(element());
  edit("Pending private draft");
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").disabled).toBe(true);
  view.rerender(element("one", false, "en", false));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Private own reason")).toBeNull();
  expect(screen.queryByDisplayValue("Pending private draft")).toBeNull();
  expect(state.detailRead).toHaveBeenLastCalledWith(
    { meetingId: "one" },
    { enabled: false },
  );
  state.pending = false;
  state.writeError = new Error("Rejected after access changed");
  await act(async () => state.onError());
  view.rerender(element("one", false, "en", false));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Pending private draft",
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Rejected after access changed",
  );
  expect(state.mutate).toHaveBeenCalledOnce();
});

it("blocks cached-row writes during read failure and latches denial across later network errors", async () => {
  const view = render(element());
  edit();
  state.readError = { message: "Read failed" };
  view.rerender(element());
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.meetings.submitExcuse,
    }).disabled,
  ).toBe(true);
  state.readError = { message: "Forbidden", data: { code: "FORBIDDEN" } };
  view.rerender(element());
  expect(screen.queryByText("Private own reason")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  state.readError = { message: "Network failed" };
  view.rerender(element());
  expect(screen.queryByText("Private own reason")).toBeNull();
  state.readError = null;
  await act(async () => view.rerender(element()));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
  expect(state.mutate).not.toHaveBeenCalled();
});

it("offers only read recovery after an accepted excuse whose refresh failed, including after Close", async () => {
  const view = render(element());
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.meetings.submitExcuse }),
  );
  state.refresh.mockRejectedValueOnce(new Error("Refresh failed"));
  state.success = true;
  await act(async () => state.onSuccess());
  expect(screen.getByRole("alert").textContent).toContain(
    messages.sessionPlanning.savedRefreshFailed,
  );
  view.rerender(element(null));
  view.rerender(element());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.meetings.excuseBtn,
    }).disabled,
  ).toBe(true);
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.tasks.retry }),
    ),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledTimes(2);
});

it("latches record removal through transport errors until a successful read of that meeting", async () => {
  const view = render(element());
  edit();
  state.readError = {
    message: "Meeting no longer available",
    data: { code: "NOT_FOUND" },
  };
  view.rerender(element());
  expect(screen.queryByText("Synthetic one")).toBeNull();
  expect(screen.queryByText("Private own reason")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  state.readError = { message: "Later transport failure" };
  view.rerender(element());
  expect(screen.queryByText("Private own reason")).toBeNull();

  // A record-specific removal must not conceal a different cached reader.
  view.rerender(element("two"));
  expect(screen.getByText("Synthetic two")).toBeTruthy();
  view.rerender(element());
  expect(screen.queryByText("Private own reason")).toBeNull();
  state.readError = null;
  await act(async () => view.rerender(element()));
  expect(screen.getByText("Synthetic one")).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Exam conflict draft",
  );
  expect(state.mutate).not.toHaveBeenCalled();
});

it("keeps source-owned future and personal history reachable with an empty default window", async () => {
  render(element(null, true));
  expect(screen.getByText("Future outside window")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  const details = screen
    .getByText("2025–26 Q4 · 1 meeting")
    .closest("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  expect(screen.getByText("Historical evidence")).toBeTruthy();
  expect(state.sourceRead).toHaveBeenCalledWith(
    expect.objectContaining({ period: "25-26:Q4" }),
  );
  expect(state.mutate).not.toHaveBeenCalled();
});

it("hides the full source browser when its live Schedule guard denies access", () => {
  const view = render(element(null, true));
  expect(screen.getByText("Future outside window")).toBeTruthy();
  state.readError = { message: "Disabled module", data: { code: "FORBIDDEN" } };
  view.rerender(element(null, true));
  expect(screen.queryByText("Future outside window")).toBeNull();
  const reads = state.sourceRead.mock.calls.length;
  state.readError = { message: "Later transport failure" };
  view.rerender(element(null, true));
  expect(screen.queryByText("Future outside window")).toBeNull();
  expect(state.sourceRead.mock.calls).toHaveLength(reads);
  expect(state.mutate).not.toHaveBeenCalled();
});

it("retains full-browser history and its owned draft through transport failure while pausing writes", async () => {
  const view = render(element(null, true));
  edit();
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  const details = screen
    .getByText("2025–26 Q4 · 1 meeting")
    .closest("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  const draft = screen.getByRole<HTMLInputElement>("textbox");
  expect(screen.getByText("Historical evidence")).toBeTruthy();
  state.readError = { message: "Transport unavailable" };
  view.rerender(element(null, true));
  expect(screen.getByText("Historical evidence")).toBeTruthy();
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.value).toBe("Exam conflict draft");
  expect(draft.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.meetings.submitExcuse,
    }).disabled,
  ).toBe(true);
  state.readError = null;
  await act(async () => view.rerender(element(null, true)));
  expect(screen.getByRole("textbox")).toBe(draft);
  expect(draft.disabled).toBe(false);
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each(["en", "zh"])(
  "keeps the source cutoff and translated action in %s",
  (locale) => {
    const catalog = locale === "zh" ? zh : messages;
    state.canExcuse = false;
    render(element("one", false, locale));
    expect(screen.getByText(catalog.tutor.meetings.tooLate)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: catalog.tutor.meetings.excuseBtn }),
    ).toBeNull();
  },
);
