/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import MeetingsPage from "./page";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { viewStateKey } from "~/lib/session-view-state";

const state = vi.hoisted(() => ({
  save: vi.fn(),
  readError: null as null | { message: string; data?: { code?: string } },
  readRefetch: vi.fn(),
  reset: vi.fn(),
  pending: false,
  error: null as null | { message: string; data: { approvalId: string } },
  attendances: [] as {
    tutorId: string;
    status: string;
    excusedAt: Date | null;
    reason: string | null;
    tutor: { englishName: string };
  }[],
  longName: "AlexandraMontgomeryWellingtonSyntheticTutor",
  refresh: vi.fn<() => Promise<void>>(),
  completion: undefined as undefined | (() => Promise<void>),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ admin: { meetings: { invalidate: state.refresh } } }),
    admin: {
      meetings: {
        useQuery: () => ({
          error: state.readError,
          isSuccess: !state.readError,
          isFetching: false,
          refetch: state.readRefetch,
          data: [
            {
              id: "meeting",
              title: "Synthetic briefing",
              date: new Date("2026-09-29T04:00:00Z"),
              attendances: state.attendances,
            },
            {
              id: "other",
              title: "Other briefing",
              date: new Date("2026-10-02T04:00:00Z"),
              attendances: [],
            },
          ],
        }),
      },
      tutors: {
        useQuery: () => ({
          isSuccess: true,
          isFetching: false,
          refetch: vi.fn(),
          data: [
            { id: "active", englishName: state.longName, status: "ACTIVE" },
            { id: "past", englishName: "Past Tutor", status: "ARCHIVED" },
            {
              id: "recorded-past",
              englishName: "Recorded Graduate",
              status: "GRADUATED",
            },
          ],
        }),
      },
      createMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
      recordMeetingAttendance: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => ({
          mutate: (input: unknown) => {
            state.save(input);
            state.completion = options.onSuccess;
          },
          reset: state.reset,
          isPending: state.pending,
          error: state.error,
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.readError = null;
  state.attendances = [];
  state.pending = false;
  state.error = null;
  state.refresh.mockResolvedValue(undefined);
  state.completion = undefined;
});
afterEach(cleanup);
function mount(readOnly = false) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <MeetingsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
}

it("keeps long-name choices reachable with mobile touch targets and persists the selected status", () => {
  mount();
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  const row = group.parentElement!;
  // DOM checks guard responsive intent; running-browser dimensions are verified separately.
  expect(row.classList.contains("min-w-0")).toBe(true);
  expect(row.classList.contains("flex-col")).toBe(true);
  expect(group.classList.contains("flex-wrap")).toBe(true);
  for (const button of within(group).getAllByRole("button")) {
    expect(button.classList.contains("control-compact")).toBe(true);
    expect(button.classList.contains("whitespace-nowrap")).toBe(false);
  }
  const absent = within(group).getByRole("button", {
    name: "Unexcused Absent",
  });
  fireEvent.click(absent);
  expect(absent.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  );
  expect(state.save).toHaveBeenCalledWith({
    meetingId: "meeting",
    entries: [{ tutorId: "active", status: "UNEXCUSED_ABSENT" }],
  });
  expect(screen.queryByText("Past Tutor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past tutors" }));
  expect(screen.getByText("Past Tutor")).toBeTruthy();
});

it("retains separate attendance drafts when selecting another meeting or collapsing", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.status.present,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Other briefing ·/ }));
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.status.unexcusedAbsent,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  expect(
    screen
      .getByRole("button", { name: messages.admin.meetings.status.present })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  expect(
    screen.queryByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  expect(
    screen
      .getByRole("button", { name: messages.admin.meetings.status.present })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /^Other briefing ·/ }));
  expect(
    screen
      .getByRole("button", {
        name: messages.admin.meetings.status.unexcusedAbsent,
      })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(state.save).not.toHaveBeenCalled();
});

it("retains accepted attendance after failed synchronization and retries reads only", async () => {
  state.refresh.mockRejectedValue(new Error("Refresh failed"));
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.status.present,
    }),
  );
  const save = screen.getByRole("button", {
    name: messages.admin.meetings.saveAttendance,
  });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(state.save).toHaveBeenCalledOnce();
  await act(async () => {
    await state.completion?.();
  });
  fireEvent.click(screen.getByRole("button", { name: /^Other briefing ·/ }));
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  expect(save.matches(":disabled")).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(
    "Attendance was saved",
  );
  state.refresh.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.retry }),
    );
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(state.save).toHaveBeenCalledOnce();
});

it("keeps the responsive attendance choices read-only for viewers", () => {
  mount(true);
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  for (const button of within(group).getAllByRole<HTMLButtonElement>("button"))
    expect(button.disabled).toBe(true);
  expect(
    screen.queryByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  ).toBeNull();
});

it("retains past tutors with attendance while hiding only unrecorded past tutors", () => {
  state.attendances = [
    {
      tutorId: "recorded-past",
      status: "PRESENT",
      excusedAt: null,
      reason: null,
      tutor: { englishName: "Recorded Graduate" },
    },
  ];
  mount();
  const editor = screen.getByRole("button", {
    name: messages.pastTutors.show,
  }).parentElement!;
  expect(within(editor).getByText("Recorded Graduate")).toBeTruthy();
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
  expect(
    within(editor).queryByRole("group", { name: /Recorded Graduate/ }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.show }),
  );
  expect(within(editor).getByText("Past Tutor")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  );
  expect(within(editor).getByText("Recorded Graduate")).toBeTruthy();
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps an unsaved active-tutor choice through past-tutor reveal and hide", () => {
  mount();
  const group = screen.getByRole("group", {
    name: `Attendance for ${state.longName}`,
  });
  const present = within(group).getByRole("button", {
    name: messages.admin.meetings.status.present,
  });
  fireEvent.click(present);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.show }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  );
  expect(
    screen.getByRole("group", { name: `Attendance for ${state.longName}` }),
  ).toBe(group);
  expect(present.getAttribute("aria-pressed")).toBe("true");
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  );
  expect(state.save).toHaveBeenCalledWith({
    meetingId: "meeting",
    entries: [{ tutorId: "active", status: "PRESENT" }],
  });
});

it("keeps all past tutors in the summary independently of the editor visibility toggle", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.meetings.summary.show }),
  );
  const summary = screen.getByRole("region", {
    name: messages.admin.meetings.summary.show,
  });
  expect(within(summary).getByText("Past Tutor")).toBeTruthy();
  expect(within(summary).getByText("Recorded Graduate")).toBeTruthy();
  const editor = screen.getByRole("button", {
    name: messages.pastTutors.show,
  }).parentElement!;
  expect(within(editor).queryByText("Past Tutor")).toBeNull();
});

it("identifies a recorded attendance correction and keeps queued changes out of saved state", () => {
  state.attendances = [
    {
      tutorId: "active",
      status: "PRESENT",
      excusedAt: null,
      reason: null,
      tutor: { englishName: state.longName },
    },
  ];
  state.error = { message: "Queued", data: { approvalId: "request-1" } };
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.status.unexcusedAbsent,
    }),
  );
  expect(screen.getByText(messages.approvals.reversalHelp)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.correctAttendance,
    }),
  );
  expect(state.save).toHaveBeenCalledWith({
    meetingId: "meeting",
    entries: [{ tutorId: "active", status: "UNEXCUSED_ABSENT" }],
  });
  expect(screen.getByText(messages.approvals.queuedBody)).toBeTruthy();
  expect(screen.queryByText(messages.admin.meetings.saved)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

const sessionMeetingPage = () => (
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="Asia/Shanghai"
  >
    <SessionViewProvider identity="head" pathname="/admin/meetings" verified>
      <ReadOnlyProvider value={false}>
        <MeetingsPage />
      </ReadOnlyProvider>
    </SessionViewProvider>
  </NextIntlClientProvider>
);
it("restores summary and visibility but starts meeting fields and attendance editors fresh", () => {
  const view = render(sessionMeetingPage());
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.meetings.summary.show }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pastTutors.show }),
  );
  fireEvent.change(
    screen.getByLabelText(messages.admin.meetings.titlePlaceholder),
    { target: { value: "unsaved meeting" } },
  );
  view.unmount();
  render(sessionMeetingPage());
  expect(
    screen.getByRole("button", { name: messages.admin.meetings.summary.hide }),
  ).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>(
      messages.admin.meetings.titlePlaceholder,
    ).value,
  ).toBe("");
  expect(
    screen.queryByRole("group", { name: `Attendance for ${state.longName}` }),
  ).toBeNull();
  expect(
    JSON.parse(
      sessionStorage.getItem(
        viewStateKey("head", "/admin/meetings", "meeting-panels-v1", ""),
      )!,
    ),
  ).toEqual({ showPast: true, showSummary: true });
  fireEvent.click(
    screen.getByRole("button", { name: /^Synthetic briefing ·/ }),
  );
  expect(
    screen.getByRole("button", { name: messages.pastTutors.hide }),
  ).toBeTruthy();
  expect(JSON.stringify(sessionStorage)).not.toContain("unsaved meeting");
  expect(state.save).not.toHaveBeenCalled();
});
it("clears meeting view choices and conceals cached attendance through failed read recovery", () => {
  const view = render(sessionMeetingPage());
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.meetings.summary.show }),
  );
  state.readError = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(sessionMeetingPage());
  expect(
    screen.queryByRole("button", { name: /^Synthetic briefing ·/ }),
  ).toBeNull();
  expect(
    sessionStorage.getItem(
      viewStateKey("head", "/admin/meetings", "meeting-panels-v1", ""),
    ),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(state.readRefetch).toHaveBeenCalledOnce();
  state.readError = { message: "Network failure" };
  view.rerender(sessionMeetingPage());
  expect(
    screen.queryByRole("button", { name: /^Synthetic briefing ·/ }),
  ).toBeNull();
  state.readError = null;
  view.rerender(sessionMeetingPage());
  expect(
    screen.getByRole("button", { name: messages.admin.meetings.summary.show }),
  ).toBeTruthy();
  expect(state.save).not.toHaveBeenCalled();
});
