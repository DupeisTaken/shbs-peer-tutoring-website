// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { DashboardTasks } from "./dashboard-tasks";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";
vi.mock("~/app/_components/focus-visible-context", () => ({
  focusVisibleContext: vi.fn(),
}));

const state = vi.hoisted(() => ({
  error: false,
  loading: false,
  membership: false,
  retry: vi.fn(),
  interviews: vi.fn(),
  meetings: vi.fn(),
  interviewStatus: "INTERVIEW",
  completedEvidence: false,
  pausedInterview: false,
  mixedInterviews: false,
  empty: false,
  grouped: false,
  unscheduledGroup: false,
  invalidGroup: false,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tutor: {
      myTuteeRemovalRequests: {
        useQuery: () => ({ data: state.empty ? [] : [{ id: "removal" }] }),
      },
      myStatusRequest: {
        useQuery: () => ({ data: state.membership ? { id: "status" } : null }),
      },
      myPairings: {
        useQuery: () => ({
          data: state.empty
            ? []
            : state.loading
              ? undefined
              : [
                  {
                    id: "today",
                    groupId: state.grouped ? "group" : null,
                    group: { primaryPairingId: "today" },
                    subject: "Friday maths",
                    scheduleConfirmed: !state.unscheduledGroup,
                    dayOfWeek: 5,
                    startMin: 900,
                    endMin: 960,
                    room: { name: "A101" },
                    tutees: [{ tuteeId: "student" }],
                  },
                  {
                    id: "unknown",
                    subject: "Unconfirmed",
                    scheduleConfirmed: false,
                    dayOfWeek: 5,
                    startMin: 0,
                    endMin: 0,
                    tutees: [{ tuteeId: "student" }],
                  },
                  {
                    id: "yesterday",
                    groupId: state.grouped ? "group" : null,
                    group: { primaryPairingId: "today" },
                    subject: "Thursday science",
                    scheduleConfirmed: !state.unscheduledGroup,
                    dayOfWeek: state.grouped ? 5 : 4,
                    startMin: 900,
                    endMin: 960,
                    tutees: [
                      { tuteeId: "student" },
                      ...(state.invalidGroup ? [{ tuteeId: "other-student" }] : []),
                    ],
                  },
                ],
          isLoading: state.loading,
          error: state.error ? new Error("Offline") : null,
          refetch: state.retry,
        }),
      },
      myInterviews: {
        useQuery: (_: unknown, options: unknown) => {
          state.interviews(options);
          return {
            data: state.empty
              ? []
              : [
                  {
                    status: state.interviewStatus,
                    isInvalid: state.pausedInterview,
                    interviewCompletedAt: state.completedEvidence
                      ? new Date("2026-10-01")
                      : null,
                    pendingDecision: state.completedEvidence,
                  },
                  { status: "ACCEPTED", isInvalid: false },
                  ...(state.mixedInterviews
                    ? [{ status: "PENDING", isInvalid: false }]
                    : []),
                ],
          };
        },
      },
      myMeetings: {
        useQuery: (_: unknown, options: unknown) => {
          state.meetings(options);
          return { data: state.empty ? [] : [{ id: "meeting" }] };
        },
      },
    },
    studentWorkflow: {
      tutorRoster: {
        useQuery: () => ({
          data: state.empty
            ? []
            : [
                { pending: true, verified: true },
                { pending: false, verified: false },
              ],
        }),
      },
    },
    qualificationApplication: {
      mine: {
        useQuery: () => ({
          data: {
            requests: state.empty
              ? []
              : [{ status: "INTERVIEW" }, { status: "RECALLED" }],
          },
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.error = false;
  state.loading = false;
  state.membership = false;
  state.pausedInterview = false;
  state.interviewStatus = "INTERVIEW";
  state.completedEvidence = false;
  state.mixedInterviews = false;
  state.empty = false;
  state.grouped = false;
  state.unscheduledGroup = false;
  state.invalidGroup = false;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", window.location.pathname);
});
const show = (status = "ACTIVE", enabled = true) =>
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DashboardTasks
        status={status}
        interviewsEnabled={enabled}
        meetingsEnabled={enabled}
        now={new Date("2026-10-01T17:00:00Z")}
      />
      <section id="attendance" tabIndex={-1}>
        Attendance target
      </section>
    </NextIntlClientProvider>,
  );

it("shows a reusable group once in today’s recurring schedule", () => {
  state.grouped = true;
  show();
  expect(screen.getByText("Friday maths + Thursday science")).toBeTruthy();
  expect(screen.queryByText("Friday maths")).toBeNull();
  expect(screen.queryByText("Thursday science")).toBeNull();
});

it("counts an unscheduled group once and does not invent a session for it", () => {
  state.grouped = true;
  state.unscheduledGroup = true;
  show();
  // The grouped plan plus the independent Unconfirmed assignment are two tasks.
  expect(screen.getByText(/Unconfirmed schedules \(2\)/)).toBeTruthy();
  expect(screen.queryByText("Friday maths + Thursday science")).toBeNull();
});

it("keeps an incomplete group discoverable as a repair task rather than a usable scheduled block", () => {
  state.grouped = true;
  state.invalidGroup = true;
  show();
  expect(screen.getByText(/1 pairing group needs repair/)).toBeTruthy();
  expect(screen.queryByText("Friday maths + Thursday science")).toBeNull();
  expect(
    within(screen.getByRole("navigation", { name: messages.tutor.tasks.attention }))
      .getByRole("link", { name: messages.dashboard.pairings.title })
      .getAttribute("href"),
  ).toBe("#tutor-pairings");
});

it("prioritizes attendance and the program-zone weekday, excluding unconfirmed times", () => {
  show();
  expect(screen.getByText("Friday maths")).toBeTruthy();
  expect(screen.queryByText("Thursday science")).toBeNull();
  expect(screen.queryByText("Unconfirmed")).toBeNull();
  expect(
    within(
      screen.getByRole("navigation", { name: messages.tutor.tasks.attention }),
    ).getByRole("link", { name: messages.dashboard.pairings.title }),
  ).toBeTruthy();
  expect(screen.getByText(/Unconfirmed schedules \(1\)/)).toBeTruthy();
  expect(screen.getByText(/Roster follow-ups \(2\)/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Open interviews (1)" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Pending qualifications (1)" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Record attendance" }));
  expect(document.activeElement?.id).toBe("attendance");
});
it.each(["PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"])(
  "keeps %s read-only with pending requirements visible",
  (status) => {
    show(status);
    expect(
      screen.queryByRole("link", { name: "Record attendance" }),
    ).toBeNull();
    expect(screen.queryByText("Friday maths")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Pending qualifications (1)" }),
    ).toBeTruthy();
    expect(
      !!screen.queryByRole("link", { name: "Confirm participation" }),
    ).toBe(status === "PENDING");
    expect(state.interviews).toHaveBeenCalledWith({ enabled: false });
    expect(state.meetings).toHaveBeenCalledWith({ enabled: false });
  },
);
it("does not query disabled modules or expose their cached shortcuts", () => {
  show("ACTIVE", false);
  expect(screen.queryByRole("link", { name: /Open interviews/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Upcoming meetings/ })).toBeNull();
  expect(state.interviews).toHaveBeenCalledWith({ enabled: false });
});
it("keeps membership and recall-window requests discoverable for inactive tutors", () => {
  state.membership = true;
  show("OPTED_OUT");
  expect(
    screen
      .getByRole("link", { name: "Participation request awaiting review" })
      .getAttribute("href"),
  ).toBe("/settings");
  expect(
    within(
      screen.getByRole("navigation", { name: messages.tutor.tasks.attention }),
    )
      .getByRole("link", { name: messages.dashboard.pairings.title })
      .getAttribute("href"),
  ).toBe("#tutor-pairings");
  expect(screen.getByText(/Opt-outs in recall window \(1\)/)).toBeTruthy();
});
it("announces unknown/loading tasks and retries a failed read without hiding cached records", () => {
  state.loading = true;
  const view = show();
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(
    screen.queryByRole("navigation", { name: messages.tutor.tasks.navigation }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: "My pairings (0)" })).toBeNull();
  expect(screen.queryByText("No confirmed regular sessions today.")).toBeNull();
  view.unmount();
  state.loading = false;
  state.error = true;
  show();
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be loaded",
  );
  expect(screen.getByText("Friday maths")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("excludes paused interviews from actionable counts and omits redundant permanent navigation", () => {
  state.pausedInterview = true;
  const view = show();
  expect(
    screen.queryByRole("link", { name: "Open interviews (1)" }),
  ).toBeNull();
  expect(
    screen.queryByRole("navigation", { name: messages.tutor.tasks.navigation }),
  ).toBeNull();
  expect(
    screen.getAllByRole("link", { name: "Record attendance" }),
  ).toHaveLength(1);
  state.pausedInterview = false;
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DashboardTasks
        status="ACTIVE"
        interviewsEnabled
        meetingsEnabled
        now={new Date("2026-10-01T17:00:00Z")}
      />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("link", { name: "Open interviews (1)" }),
  ).toBeTruthy();
});

it("counts only eligible rows in a mixed paused and ordinary interview list", () => {
  state.pausedInterview = true;
  state.mixedInterviews = true;
  show();
  expect(
    screen.getByRole("link", { name: "Open interviews (1)" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Open interviews (2)" }),
  ).toBeNull();
});

it("shows the empty attention state only when every required read succeeded", () => {
  state.empty = true;
  const view = show();
  expect(screen.getByText(messages.tutor.tasks.emptyTasks)).toBeTruthy();
  expect(screen.getByText(messages.tutor.tasks.noSessions)).toBeTruthy();
  state.error = true;
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DashboardTasks
        status="ACTIVE"
        interviewsEnabled
        meetingsEnabled
        now={new Date("2026-10-01T17:00:00Z")}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText(messages.tutor.tasks.emptyTasks)).toBeNull();
});

it("reveals repeated anchors after native hash navigation and handles history hashes", () => {
  let frame: FrameRequestCallback = () => undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const view = show();
  const link = screen.getByRole("link", { name: "Record attendance" });
  fireEvent.click(link);
  expect(link.getAttribute("href")).toBe("#attendance");
  // JSDOM does not execute browser scrolling. Supply only the native URL result;
  // actual header bounds and reveal position are covered by browser evidence.
  window.history.replaceState(null, "", "#attendance");
  act(() => frame(0));
  expect(focusVisibleContext).toHaveBeenLastCalledWith(
    document.getElementById("attendance"),
  );
  fireEvent.click(link);
  act(() => frame(1));
  expect(focusVisibleContext).toHaveBeenCalledTimes(2);
  fireEvent(window, new HashChangeEvent("hashchange"));
  act(() => frame(2));
  expect(focusVisibleContext).toHaveBeenCalledTimes(3);
  view.unmount();
});

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
])("does not steal focus for modified anchor activation %j", (modifiers) => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  show();
  const before = raf.mock.calls.length;
  fireEvent.click(
    screen.getByRole("link", { name: "Record attendance" }),
    modifiers,
  );
  expect(raf.mock.calls.length).toBe(before);
  expect(document.activeElement?.id).not.toBe("attendance");
});

it("refreshes interview attention from the shared result without treating completion or queued decision as a terminal outcome", () => {
  const view = show();
  const updated = () => (
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <DashboardTasks
        status="ACTIVE"
        interviewsEnabled
        meetingsEnabled
        now={new Date("2026-10-01T17:00:00Z")}
      />
    </NextIntlClientProvider>
  );
  state.completedEvidence = true;
  view.rerender(updated());
  expect(
    screen.getByRole("link", { name: "Open interviews (1)" }),
  ).toBeTruthy();
  state.interviewStatus = "ACCEPTED";
  view.rerender(updated());
  expect(
    screen.queryByRole("link", { name: "Open interviews (1)" }),
  ).toBeNull();
  state.interviewStatus = "INTERVIEW";
  view.rerender(updated());
  expect(
    screen.getByRole("link", { name: "Open interviews (1)" }),
  ).toBeTruthy();
});
