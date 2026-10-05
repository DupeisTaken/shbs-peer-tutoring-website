// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { DashboardTasks } from "./dashboard-tasks";

const state = vi.hoisted(() => ({
  error: false,
  loading: false,
  membership: false,
  retry: vi.fn(),
  interviews: vi.fn(),
  meetings: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tutor: {
      myTuteeRemovalRequests: {
        useQuery: () => ({ data: [{ id: "removal" }] }),
      },
      myStatusRequest: {
        useQuery: () => ({ data: state.membership ? { id: "status" } : null }),
      },
      myPairings: {
        useQuery: () => ({
          data: state.loading
            ? undefined
            : [
                {
                  id: "today",
                  subject: "Friday maths",
                  scheduleConfirmed: true,
                  dayOfWeek: 5,
                  startMin: 900,
                  endMin: 960,
                  room: { name: "A101" },
                },
                {
                  id: "unknown",
                  subject: "Unconfirmed",
                  scheduleConfirmed: false,
                  dayOfWeek: 5,
                  startMin: 0,
                  endMin: 0,
                },
                {
                  id: "yesterday",
                  subject: "Thursday science",
                  scheduleConfirmed: true,
                  dayOfWeek: 4,
                  startMin: 900,
                  endMin: 960,
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
          return { data: [{ status: "INTERVIEW" }, { status: "ACCEPTED" }] };
        },
      },
      myMeetings: {
        useQuery: (_: unknown, options: unknown) => {
          state.meetings(options);
          return { data: [{ id: "meeting" }] };
        },
      },
    },
    studentWorkflow: {
      tutorRoster: {
        useQuery: () => ({
          data: [
            { pending: true, verified: true },
            { pending: false, verified: false },
          ],
        }),
      },
    },
    qualificationApplication: {
      mine: {
        useQuery: () => ({
          data: { requests: [{ status: "INTERVIEW" }, { status: "RECALLED" }] },
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
  vi.clearAllMocks();
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

it("prioritizes attendance and the program-zone weekday, excluding unconfirmed times", () => {
  show();
  expect(screen.getByText("Friday maths")).toBeTruthy();
  expect(screen.queryByText("Thursday science")).toBeNull();
  expect(screen.queryByText("Unconfirmed")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Schedule follow-up (3)" }),
  ).toBeTruthy();
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
    screen
      .getByRole("link", { name: "Opt-outs in recall window (1)" })
      .getAttribute("href"),
  ).toBe("#tutor-pairings");
});
it("announces unknown/loading tasks and retries a failed read without hiding cached records", () => {
  state.loading = true;
  const view = show();
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(
    screen.getByRole("link", { name: messages.dashboard.pairings.title }),
  ).toBeTruthy();
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
