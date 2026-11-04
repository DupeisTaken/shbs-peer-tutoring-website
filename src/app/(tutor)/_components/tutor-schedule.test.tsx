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
import { useEffect, type ReactNode } from "react";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { TutorSchedule } from "./tutor-schedule";

const state = vi.hoisted(() => ({
  completionTask: false,
  chairTask: false,
  interviewStatus: "INTERVIEW",
  ownVoteRecorded: false,
  completionState: "pending",
  interviewAt: new Date("2026-10-28T07:00:00Z"),
  meetingStatus: null as
    null | "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT" | "EXEMPT",
  meetingExcused: false,
  meetingUpcoming: true,
  interviewError: null as null | { data: { code: string } },
  meetingError: null as null | { data: { code: string } },
  interviewInput: vi.fn(),
  interviewOptions: vi.fn(),
  meetingOptions: vi.fn(),
  interviewRetry: vi.fn(),
  meetingRetry: vi.fn(),
  interviewMounted: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href} data-client-navigation>
      {children}
    </a>
  ),
}));
vi.mock("~/trpc/react", () => {
  const mocked = {
    api: {
      personalSchedule: {
        interviews: {
          useQuery: (_input: unknown, options: unknown) => {
            state.interviewOptions(options);
            return {
              data: {
                actionableTasks: state.completionTask
                  ? [
                      {
                        id: "completion",
                        name: "Completion example",
                        isHead: false,
                        canChair: false,
                        action: "completion",
                        sortAt: new Date(),
                        startsAt: null,
                      },
                    ]
                  : [],
                appointments: [
                  {
                    id: "panel",
                    name: "Synthetic Panel Applicant",
                    subjects: ["Math"],
                    interviewAt: state.interviewAt,
                    isHead: false,
                    status: state.interviewStatus,
                    ownVoteRecorded: state.ownVoteRecorded,
                    completionState: state.completionState,
                  },
                  {
                    id: "chair",
                    name: "Synthetic Chair Applicant",
                    subjects: ["Science"],
                    interviewAt: new Date("2026-10-29T07:00:00Z"),
                    isHead: true,
                    status: "INTERVIEW",
                    ownVoteRecorded: false,
                    completionState: "pending",
                  },
                ],
                tasks: [
                  {
                    id: "unscheduled",
                    name: "Synthetic Unscheduled Applicant",
                    reason: "unscheduled",
                    interviewAt: null,
                    isHead: false,
                  },
                  ...(state.chairTask
                    ? [
                        {
                          id: "past-chair",
                          name: "Synthetic Past Chair Applicant",
                          reason: "pastOpen",
                          interviewAt: new Date("2026-10-25T07:00:00Z"),
                          isHead: true,
                        },
                      ]
                    : []),
                ],
              },
              error: state.interviewError,
              isLoading: false,
              isSuccess: !state.interviewError,
              isFetching: false,
              refetch: state.interviewRetry,
            };
          },
        },
        meetings: {
          useQuery: (_input: unknown, options: unknown) => {
            state.meetingOptions(options);
            return {
              data: {
                appointments: [
                  {
                    id: "meeting",
                    title: "Synthetic Briefing",
                    date: new Date(
                      state.meetingUpcoming
                        ? "2026-10-30T07:00:00Z"
                        : "2026-10-25T07:00:00Z",
                    ),
                    excused: state.meetingExcused,
                    status: state.meetingStatus,
                    upcoming: state.meetingUpcoming,
                  },
                ],
              },
              error: state.meetingError,
              isLoading: false,
              isSuccess: !state.meetingError,
              isFetching: false,
              refetch: state.meetingRetry,
            };
          },
        },
      },
    },
  };
  return {
    api: {
      personalSchedule: Object.fromEntries(
        Object.entries(mocked.api.personalSchedule).map(([key, value]) => [
          key,
          {
            ...value,
            useInfiniteQuery: (input: unknown, options: unknown) => {
              if (key === "interviews") state.interviewInput(input);
              const result = value.useQuery(undefined, options);
              return {
                ...result,
                data: { pages: [result.data] },
                hasNextPage: false,
                fetchNextPage: vi.fn(),
              };
            },
          },
        ]),
      ),
    },
  };
});
vi.mock("~/app/_components/session-agenda", () => ({
  SessionAgenda: ({
    supplementalEvents,
    renderOverview,
    view,
    onViewChange,
  }: {
    supplementalEvents: { id: string; content: ReactNode }[];
    renderOverview: (overview: {
      canAddExtra: boolean;
      openExtra: () => void;
      items: [];
    }) => ReactNode;
    view: string;
    onViewChange: (view: string) => void;
  }) => (
    <section>
      {renderOverview({ canAddExtra: true, openExtra: vi.fn(), items: [] })}
      <button onClick={() => onViewChange("history")}>History filter</button>
      <span>{view}</span>
      <p>Tutoring retained</p>
      {supplementalEvents.map((event) => (
        <div key={event.id}>{event.content}</div>
      ))}
    </section>
  ),
}));
vi.mock("./schedule-interview-details", () => ({
  ScheduleInterviewDetails: ({
    applicationId,
    showAll,
    onClose,
    enabled,
  }: {
    applicationId: string | null;
    showAll: boolean;
    onClose: () => void;
    enabled: boolean;
  }) => {
    useEffect(() => {
      state.interviewMounted();
    }, []);
    return enabled && (applicationId || showAll) ? (
      <div role="dialog">
        Interview {applicationId ?? "history"}
        <button onClick={onClose}>Close interview</button>
      </div>
    ) : null;
  },
}));
vi.mock("./schedule-meeting-details", () => ({
  ScheduleMeetingDetails: ({
    meetingId,
    showAll,
    onClose,
  }: {
    meetingId: string | null;
    showAll: boolean;
    onClose: () => void;
  }) =>
    meetingId || showAll ? (
      <div role="dialog">
        Meeting {meetingId ?? "history"}
        <button onClick={onClose}>Close meeting</button>
      </div>
    ) : null,
}));
beforeEach(() => {
  state.chairTask = false;
  state.completionTask = false;
  state.interviewStatus = "INTERVIEW";
  state.ownVoteRecorded = false;
  state.completionState = "pending";
  state.interviewAt = new Date("2026-10-28T07:00:00Z");
  state.meetingStatus = null;
  state.meetingExcused = false;
  state.meetingUpcoming = true;
  state.interviewError = null;
  state.meetingError = null;
  vi.clearAllMocks();
});
afterEach(cleanup);
const ui = (
  active = true,
  interviewsEnabled = true,
  meetingsEnabled = true,
  locale = "en",
  compact = false,
) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : en}
  >
    <TutorSchedule
      compact={compact}
      active={active}
      interviewsEnabled={interviewsEnabled}
      meetingsEnabled={meetingsEnabled}
      now={new Date("2026-10-26T00:00:00Z")}
    />
  </NextIntlClientProvider>
);

const eventCard = (id: string) => {
  const card = document.getElementById(id);
  if (!card) throw new Error(`Event card is missing: ${id}`);
  return within(card);
};

const locales = [
  { locale: "en", messages: en },
  { locale: "zh", messages: zh },
];

it.each(locales)(
  "keeps a completed interview's missing vote actionable, then shows its recorded vote awaiting decision ($locale)",
  ({ locale, messages }) => {
    state.interviewAt = new Date("2026-10-25T07:00:00Z");
    const view = render(ui(true, true, true, locale, true));
    for (const completion of ["pending", "completed"] as const) {
      state.completionState = completion;
      view.rerender(ui(true, true, true, locale, true));
      const beforeVote = eventCard("interview-panel");
      expect(
        beforeVote
          .getByText(messages.agendaEvents.needsAction)
          .classList.contains("bg-yellow-100"),
        completion,
      ).toBe(true);
      expect(
        beforeVote.getByText(messages.agendaEvents.voteNeeded),
      ).toBeTruthy();
      expect(
        beforeVote.queryByText(messages.agendaEvents.completed),
      ).toBeNull();
      expect(
        beforeVote.queryByText(messages.agendaEvents.voteRecorded),
      ).toBeNull();
    }

    state.ownVoteRecorded = true;
    view.rerender(ui(true, true, true, locale, true));
    const afterVote = eventCard("interview-panel");
    expect(
      afterVote.getByText(messages.agendaEvents.voteRecorded),
    ).toBeTruthy();
    expect(
      afterVote.getByText(messages.agendaEvents.awaitingDecision),
    ).toBeTruthy();
    expect(afterVote.queryByText(messages.agendaEvents.needsAction)).toBeNull();
    expect(afterVote.queryByText(messages.agendaEvents.voteNeeded)).toBeNull();
    expect(afterVote.queryByText(messages.agendaEvents.completed)).toBeNull();
  },
);

it.each(locales)(
  "shows a pending scheduled interview as Upcoming without asking for a vote ($locale)",
  ({ locale, messages }) => {
    state.interviewStatus = "PENDING";
    render(ui(true, true, true, locale, true));
    const card = eventCard("interview-panel");
    expect(card.getByText(messages.agendaEvents.upcoming)).toBeTruthy();
    expect(card.queryByText(messages.agendaEvents.needsAction)).toBeNull();
    expect(card.queryByText(messages.agendaEvents.voteNeeded)).toBeNull();
    expect(card.queryByText(messages.agendaEvents.completed)).toBeNull();
  },
);

it.each(locales)(
  "shows applied terminal interview outcomes as completed rather than missing a vote ($locale)",
  ({ locale, messages }) => {
    state.interviewAt = new Date("2026-10-25T07:00:00Z");
    state.interviewStatus = "ACCEPTED";
    const view = render(ui(true, true, true, locale, true));
    for (const status of ["ACCEPTED", "REJECTED", "RECALLED"] as const) {
      state.interviewStatus = status;
      view.rerender(ui(true, true, true, locale, true));
      const card = eventCard("interview-panel");
      expect(
        card.getByText(messages.agendaEvents.completed),
        status,
      ).toBeTruthy();
      expect(
        card.queryByText(messages.agendaEvents.needsAction),
        status,
      ).toBeNull();
      expect(
        card.queryByText(messages.agendaEvents.voteNeeded),
        status,
      ).toBeNull();
      expect(
        card.queryByText(messages.agendaEvents.awaitingDecision),
        status,
      ).toBeNull();
    }
  },
);

it.each(locales)(
  "shows both staff-recorded and self-submitted excused absences ($locale)",
  ({ locale, messages }) => {
    state.meetingStatus = "EXCUSED_ABSENT";
    state.meetingUpcoming = false;
    const view = render(ui(true, true, true, locale, true));
    // Staff may record the status without a self-excuse timestamp. The badge
    // follows that status; it must not depend on the self-excuse capability.
    expect(state.meetingExcused).toBe(false);
    expect(
      eventCard("meeting-meeting").getByText(messages.agendaEvents.excused),
    ).toBeTruthy();
    state.meetingExcused = true;
    view.rerender(ui(true, true, true, locale, true));
    const card = eventCard("meeting-meeting");
    expect(card.getByText(messages.agendaEvents.excused)).toBeTruthy();
    expect(card.queryByText(messages.agendaEvents.needsAction)).toBeNull();
    expect(
      card.queryByText(messages.agendaEvents.awaitingAttendance),
    ).toBeNull();
  },
);

it.each(locales)(
  "does not turn exempt or unexcused meeting records into excused absences ($locale)",
  ({ locale, messages }) => {
    state.meetingUpcoming = false;
    state.meetingStatus = "UNEXCUSED_ABSENT";
    const view = render(ui(true, true, true, locale, true));
    for (const status of ["UNEXCUSED_ABSENT", "EXEMPT"] as const) {
      state.meetingStatus = status;
      view.rerender(ui(true, true, true, locale, true));
      const card = eventCard("meeting-meeting");
      expect(
        card.queryByText(messages.agendaEvents.excused),
        status,
      ).toBeNull();
      expect(
        card.queryByText(messages.agendaEvents.needsAction),
        status,
      ).toBeNull();
      expect(
        card.getByText(messages.agendaEvents.completed),
        status,
      ).toBeTruthy();
    }
  },
);

it.each(locales)(
  "shows an unrecorded past meeting as awaiting attendance without a tutor action ($locale)",
  ({ locale, messages }) => {
    state.meetingUpcoming = false;
    render(ui(true, true, true, locale, true));
    const card = eventCard("meeting-meeting");
    expect(
      card.getByText(messages.agendaEvents.awaitingAttendance),
    ).toBeTruthy();
    expect(card.queryByText(messages.agendaEvents.needsAction)).toBeNull();
    expect(card.queryByText(messages.agendaEvents.completed)).toBeNull();
    expect(card.queryByText(messages.agendaEvents.excused)).toBeNull();
    expect(
      card.getByRole("button", { name: messages.unifiedSchedule.openMeeting }),
    ).toBeTruthy();
  },
);

it("opens one panelist controller and keeps chair navigation in its owning workspace", () => {
  render(ui());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen
      .getAllByRole("link", { name: en.unifiedSchedule.openChair })[0]!
      .getAttribute("href"),
  ).toBe("/dashboard#tutor-interviews");
  fireEvent.click(
    screen.getAllByRole("button", {
      name: en.unifiedSchedule.openInterview,
    })[1]!,
  );
  expect(screen.getByRole("dialog").textContent).toContain("Interview panel");
  fireEvent.click(screen.getByText("Close interview"));
  fireEvent.click(
    screen.getByRole("button", { name: en.unifiedSchedule.interviewWork }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Interview history");
  expect(screen.getAllByText(en.unifiedSchedule.endUnknown)).toHaveLength(3);
});
it("uses native chair return links for appointments and outstanding work", () => {
  state.chairTask = true;
  render(ui());
  const links = screen.getAllByRole("link", {
    name: en.unifiedSchedule.openChair,
  });
  expect(links).toHaveLength(3);
  for (const link of links) {
    expect(link.getAttribute("href")).toBe("/dashboard#tutor-interviews");
    expect(link.hasAttribute("data-client-navigation")).toBe(false);
    expect(link.getAttribute("target")).toBeNull();
  }
});
it("keeps tutoring and meetings when interview access is revoked, including cached summaries", () => {
  const view = render(ui());
  state.interviewError = { data: { code: "FORBIDDEN" } };
  view.rerender(ui());
  expect(screen.queryByText("Synthetic Panel Applicant")).toBeNull();
  expect(screen.queryByText("Synthetic Unscheduled Applicant")).toBeNull();
  expect(screen.getByText("Synthetic Briefing")).toBeTruthy();
  expect(screen.getByText("Tutoring retained")).toBeTruthy();
  expect(screen.getByText(en.unifiedSchedule.denied)).toBeTruthy();
});
it("retains the detail owner while revoked summaries conceal its private UI", () => {
  const view = render(ui());
  fireEvent.click(
    screen.getAllByRole("button", {
      name: en.unifiedSchedule.openInterview,
    })[1]!,
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  state.interviewError = { data: { code: "FORBIDDEN" } };
  view.rerender(ui());
  expect(screen.queryByRole("dialog")).toBeNull();
  state.interviewError = null;
  view.rerender(ui());
  expect(screen.getByRole("dialog").textContent).toContain("Interview panel");
  expect(state.interviewMounted).toHaveBeenCalledOnce();
});
it("admits an initially disabled owner once and retains it across feature toggles", () => {
  const view = render(ui(true, false, false));
  expect(state.interviewMounted).not.toHaveBeenCalled();
  view.rerender(ui(true, true, false));
  fireEvent.click(
    screen.getAllByRole("button", {
      name: en.unifiedSchedule.openInterview,
    })[1]!,
  );
  expect(screen.getByRole("dialog").textContent).toContain("Interview panel");
  view.rerender(ui(true, false, false));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(ui(true, true, false));
  expect(screen.getByRole("dialog").textContent).toContain("Interview panel");
  expect(state.interviewMounted).toHaveBeenCalledOnce();
});
it("retains independent cached meetings beside a source-specific read retry", () => {
  state.meetingError = { data: { code: "INTERNAL_SERVER_ERROR" } };
  render(ui());
  expect(screen.getByText("Synthetic Briefing")).toBeTruthy();
  expect(
    screen.getAllByText("Synthetic Panel Applicant").length,
  ).toBeGreaterThan(0);
  fireEvent.click(
    screen.getByRole("button", { name: en.unifiedSchedule.retry }),
  );
  expect(state.meetingRetry).toHaveBeenCalledOnce();
  expect(state.interviewRetry).not.toHaveBeenCalled();
});
it.each([
  [false, true, true],
  [true, false, false],
])(
  "conceals inactive/disabled sources (%s,%s,%s)",
  (active, interviews, meetings) => {
    render(ui(active, interviews, meetings));
    expect(state.interviewOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, refetchInterval: false }),
    );
    expect(state.meetingOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, refetchInterval: false }),
    );
    expect(screen.queryByText("Synthetic Panel Applicant")).toBeNull();
    expect(screen.queryByText("Synthetic Briefing")).toBeNull();
  },
);
it("opens meeting history through its single controller in Chinese", () => {
  render(ui(true, true, true, "zh"));
  fireEvent.click(
    screen.getByRole("button", { name: zh.unifiedSchedule.meetingWork }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Meeting history");
  expect(screen.getByText(zh.unifiedSchedule.calendarScope)).toBeTruthy();
});

it("defaults dated events to Upcoming and changes filters without resetting the open interview owner", () => {
  render(ui());
  expect(state.interviewInput).toHaveBeenLastCalledWith({
    view: "upcoming",
    includeSummary: false,
  });
  fireEvent.click(
    screen.getAllByRole("button", {
      name: en.unifiedSchedule.openInterview,
    })[1]!,
  );
  const detail = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "History filter" }));
  expect(state.interviewInput).toHaveBeenLastCalledWith({
    view: "history",
    includeSummary: false,
  });
  expect(screen.getByRole("dialog")).toBe(detail);
  expect(state.interviewMounted).toHaveBeenCalledOnce();
});

it("routes missing completion evidence to its management workspace", () => {
  state.completionTask = true;
  render(ui());
  expect(
    screen
      .getByRole("link", { name: en.unifiedSchedule.viewEvent })
      .getAttribute("href"),
  ).toBe("/admin/applications#interview-records");
});

it("uses compact controls without repeated overview cards and keeps chair work local", () => {
  render(ui(true, true, true, "en", true));
  expect(
    screen.queryByRole("heading", { name: en.unifiedSchedule.upcoming }),
  ).toBeNull();
  expect(screen.queryByText(en.unifiedSchedule.sessionsHelp)).toBeNull();
  expect(
    screen.getByRole("button", { name: en.unifiedSchedule.addExtra }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.unifiedSchedule.openChair })
      .getAttribute("href"),
  ).toBe("#chair-interviews");
  fireEvent.click(
    screen.getByRole("button", { name: en.unifiedSchedule.interviewWork }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Interview history");
});
it("resolves the legacy schedule interview arrival to the personal reader", () => {
  window.history.replaceState(null, "", "/schedule#tutor-interviews");
  render(ui(true, true, true, "en", true));
  expect(screen.getByRole("dialog").textContent).toContain("Interview history");
  window.history.replaceState(null, "", "/");
});
