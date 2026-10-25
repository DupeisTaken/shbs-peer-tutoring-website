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
  quarters: true,
  history: false,
  outside: false,
  periodsRead: vi.fn<(input: { period: string }) => void>(),
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
    useUtils: () => ({
      admin: {
        meetings: { invalidate: state.refresh },
        meetingPeriods: { invalidate: vi.fn() },
      },
    }),
    admin: {
      meetingPeriods: {
        useQuery: () => ({
          data: {
            quarters: state.quarters,
            current: state.quarters
              ? { key: "26-27:Q1", label: "2026–27 Q1" }
              : { key: "26-27:S1", label: "2026–27 S1" },
            outsideUpcoming: state.outside ? 1 : 0,
            history: state.history
              ? [{ key: "25-26:Q4", label: "2025–26 Q4", count: 2 }]
              : [],
          },
        }),
      },
      meetings: {
        useQuery: (input: { period: string }) => {
          state.periodsRead(input);
          return {
            error: state.readError,
            isSuccess: !state.readError,
            isFetching: false,
            refetch: state.readRefetch,
            data: [
              {
                id: "meeting",
                title:
                  input.period === "26-27:Q1"
                    ? "Synthetic briefing"
                    : "Historical briefing",
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
          };
        },
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
  state.quarters = true;
  state.history = false;
  state.outside = false;
  sessionStorage.clear();
  state.readError = null;
  state.attendances = [];
  state.pending = false;
  state.error = null;
  state.refresh.mockResolvedValue(undefined);
  state.completion = undefined;
});

it("loads history on demand and retains its attendance draft across quarter collapse", async () => {
  state.history = true;
  mount();
  expect(
    state.periodsRead.mock.calls.every(
      ([input]) => input.period === "26-27:Q1",
    ),
  ).toBe(true);
  const toggle = async (summary: HTMLElement, open: boolean) => {
    const details = summary.closest("details")!;
    await act(async () => {
      details.open = open;
      fireEvent(details, new Event("toggle"));
    });
  };
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  expect(
    screen.queryByRole("button", { name: /^Historical briefing/ }),
  ).toBeNull();
  const quarter = screen.getByText("2025–26 Q4 · 2 meetings");
  await toggle(quarter, true);
  const region = quarter.closest("details")!;
  fireEvent.click(
    within(region).getByRole("button", { name: /^Historical briefing/ }),
  );
  const choose = () =>
    within(region).getByRole("group", {
      name: `Attendance for ${state.longName}`,
    });
  fireEvent.click(
    within(choose()).getByRole("button", {
      name: messages.admin.meetings.status.unexcusedAbsent,
    }),
  );
  await toggle(quarter, false);
  await toggle(quarter, true);
  expect(
    within(choose())
      .getByRole("button", {
        name: messages.admin.meetings.status.unexcusedAbsent,
      })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(state.save).not.toHaveBeenCalled();
  expect(
    within(region).queryByLabelText(messages.admin.meetings.titlePlaceholder),
  ).toBeNull();
});

it("keeps the supplemental upcoming overview read-only while its owning history remains editable", async () => {
  state.history = true;
  state.outside = true;
  mount();
  const outside = screen.getByRole("region", {
    name: messages.meetingPeriods.outside,
  });
  expect(
    within(outside).queryByRole("button", {
      name: messages.admin.meetings.delete,
    }),
  ).toBeNull();
  fireEvent.click(
    within(outside).getByRole("button", { name: /^Historical briefing/ }),
  );
  expect(
    within(outside).queryByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.meetingPeriods.history }),
  );
  const details = screen
    .getByText("2025–26 Q4 · 2 meetings")
    .closest("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  fireEvent.click(
    within(details).getByRole("button", { name: /^Historical briefing/ }),
  );
  expect(
    within(details).getByRole("button", {
      name: messages.admin.meetings.saveAttendance,
    }),
  ).toBeTruthy();
  expect(state.save).not.toHaveBeenCalled();
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

it("retains a failed-sync attendance controller through regrouping and blocks reload during recovery", async () => {
  state.refresh.mockRejectedValue(new Error("Refresh failed"));
  const view = render(sessionMeetingPage());
  fireEvent.click(screen.getByRole("button", { name: /^Synthetic briefing ·/ }));
  const present = screen.getByRole("button", { name: messages.admin.meetings.status.present });
  fireEvent.click(present);
  fireEvent.click(screen.getByRole("button", { name: messages.admin.meetings.saveAttendance }));
  await act(async () => { await state.completion?.(); });
  state.quarters = false;
  view.rerender(sessionMeetingPage());
  expect(screen.getByRole("button", { name: messages.admin.meetings.status.present })).toBe(present);
  expect(present.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("Attendance was saved");
  expect(screen.queryByLabelText(messages.admin.meetings.titlePlaceholder)).toBeNull();
  let finishRefresh: (() => void) | undefined;
  state.refresh.mockImplementation(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: messages.uiPatterns.retry }));
  });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.meetingPeriods.reload }).disabled).toBe(true);
  await act(async () => { finishRefresh?.(); });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.meetingPeriods.reload }).disabled).toBe(false);
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

it.each(["stats", "summary"] as const)(
  "opens the %s tutor reader on demand with header Close and retained attendance evidence",
  (entryPoint) => {
    const reason =
      "Recorded medical appointment; retain this historical reason";
    state.attendances = [
      {
        tutorId: "recorded-past",
        status: "EXCUSED_ABSENT",
        excusedAt: new Date("2026-09-28T04:00:00Z"),
        reason,
        tutor: { englishName: "Recorded Graduate" },
      },
    ];
    render(sessionMeetingPage());
    if (entryPoint === "summary") {
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.admin.meetings.summary.show,
        }),
      );
    }
    const table = screen.getByRole("table", {
      name:
        entryPoint === "stats"
          ? messages.admin.meetings.stats.title
          : messages.admin.meetings.summary.show,
    });
    const row = within(table).getByText("Recorded Graduate").closest("tr")!;
    expect(within(row).getByText(messages.admin.summary.inactive)).toBeTruthy();
    // Zero totals and missing evidence keep their meaning after the presentation migration.
    const cells = [...row.querySelectorAll("td")].map(
      (cell) => cell.textContent,
    );
    expect(
      entryPoint === "stats" ? cells.slice(1, 4) : cells.slice(0, 2),
    ).toEqual(entryPoint === "stats" ? ["0", "1", "0"] : ["EA", "·"]);
    expect(screen.queryByText(reason, { exact: false })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = within(row).getByRole("button", {
      name: `${messages.tablePatterns.details}: Recorded Graduate`,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Recorded Graduate" });
    const close = within(dialog).getByRole("button", {
      name: messages.accountProfile.close,
    });
    // The same header owns the title and the first focused Close control.
    expect(
      within(close.parentElement!).getByRole("heading", {
        name: "Recorded Graduate",
      }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(close);
    const recorded = within(dialog)
      .getByRole("heading", {
        name: "Synthetic briefing",
      })
      .closest("li")!;
    expect(
      within(recorded).getByText(messages.admin.meetings.status.excusedAbsent),
    ).toBeTruthy();
    expect(within(recorded).getByText(reason, { exact: false })).toBeTruthy();
    const missing = within(dialog)
      .getByRole("heading", {
        name: "Other briefing",
      })
      .closest("li")!;
    expect(within(missing).getByText("—")).toBeTruthy();
    expect(
      within(missing).queryByText(
        messages.admin.meetings.status.unexcusedAbsent,
      ),
    ).toBeNull();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(reason, { exact: false })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(
      within(
        screen.getByRole("dialog", { name: "Recorded Graduate" }),
      ).getByText(reason, { exact: false }),
    ).toBeTruthy();
    expect(state.save).not.toHaveBeenCalled();
  },
);

it("keeps an unrecorded past tutor available in summary details without inventing absence evidence", () => {
  render(sessionMeetingPage());
  expect(screen.getByText(messages.admin.meetings.stats.empty)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.meetings.summary.show,
    }),
  );
  const summary = screen.getByRole("table", {
    name: messages.admin.meetings.summary.show,
  });
  const row = within(summary).getByText("Past Tutor").closest("tr")!;
  expect(within(row).getAllByTitle("—")).toHaveLength(2);
  fireEvent.click(
    within(row).getByRole("button", {
      name: `${messages.tablePatterns.details}: Past Tutor`,
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Past Tutor" });
  expect(within(dialog).getAllByText("—")).toHaveLength(2);
  expect(
    within(dialog).queryByText(messages.admin.meetings.status.unexcusedAbsent),
  ).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: messages.accountProfile.close }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
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
        viewStateKey(
          "head",
          "/admin/meetings",
          "meeting-panels-v1",
          "26-27:Q1",
        ),
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
      viewStateKey("head", "/admin/meetings", "meeting-panels-v1", "26-27:Q1"),
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
