// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render as renderUI,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TuteeOverview } from "./tutee-overview";
import { TuteeNavigation } from "./navigation";
import { StudentPortal } from "~/app/_components/student-portal";
import { programDateKey } from "~/lib/program-time";
const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  requests: vi.fn(),
  view: "dashboard",
  settings: vi.fn(),
  calendar: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/student",
  useSearchParams: () => new URLSearchParams({ view: mocks.view }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Sep 13" }),
}));
const render = (ui: ReactElement) =>
  renderUI(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ promptText: vi.fn(), dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      calendar: { useQuery: () => ({ data: [] }) },
      schoolCalendar: { useQuery: mocks.calendar },
    },
    student: {
      me: { useQuery: mocks.personal },
      feedbackSettings: { useQuery: mocks.settings },
      appeal: { useMutation: () => ({ mutate: vi.fn() }) },
      feedback: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    studentWorkflow: { mine: { useQuery: mocks.requests } },
  },
}));
beforeEach(() => {
  mocks.view = "dashboard";
  window.history.replaceState(null, "", "/student");
  mocks.calendar.mockReset().mockReturnValue({
    data: [],
    error: null,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.personal.mockReturnValue({
    data: {
      user: { name: "Sam" },
      schedule: [],
      sessions: [],
      cards: [],
      appeals: [],
    },
  });
  mocks.requests.mockReturnValue({ data: [] });
  mocks.settings.mockReturnValue({ data: false });
});
afterEach(cleanup);
it("reads bounded school-date facts beside the weekly overview without displaying staff notes", () => {
  const date = programDateKey(new Date(), "Asia/Shanghai");
  const last = new Date(`${date}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 13);
  mocks.calendar.mockReturnValue({
    data: [
      {
        date,
        isSchoolDay: false,
        timetableWeekday: null,
        version: 2,
        scheduleRevision: 2,
        note: "Private staff note",
      },
    ],
    error: null,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  });
  render(<TuteeOverview />);
  expect(mocks.calendar).toHaveBeenLastCalledWith(
    { from: date, to: last.toISOString().slice(0, 10) },
    { enabled: true, refetchInterval: 60_000 },
  );
  expect(screen.getByText("closureWarning")).toBeTruthy();
  expect(
    document.querySelector(`time[datetime="${date}"]`)?.parentElement
      ?.textContent,
  ).toContain("noSchool");
  expect(screen.queryByText("Private staff note")).toBeNull();
  expect(
    screen.getByRole("link", { name: /schedule 0 scheduledSubjects/ }),
  ).toBeTruthy();
});
it("leaves the route-owned intake action singular and retains account navigation without enrollment", () => {
  render(<TuteeOverview />);
  expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
  expect(screen.queryByText("formHelp")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: /account accountHelp/ })
      .getAttribute("href"),
  ).toBe("/student?view=account");
});
it("links to focused views with a single active navigation item and handles unknown deep links", () => {
  mocks.view = "attendance";
  const { rerender } = render(<TuteeNavigation />);
  expect(
    screen
      .getByRole("link", { name: "attendance" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    screen.getByRole("link", { name: "messages" }).getAttribute("href"),
  ).toBe("/student?view=messages");
  mocks.view = "not-a-view";
  rerender(<TuteeNavigation />);
  expect(
    screen
      .getByRole("link", { name: "dashboard" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it.each(["messages", "account"])(
  "keeps the %s tab in the tutee workspace",
  (view) => {
    mocks.view = view;
    render(<TuteeNavigation />);
    const tab = screen.getByRole("link", { name: view });
    expect(tab.getAttribute("href")).toBe(`/student?view=${view}`);
    expect(tab.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      document.querySelector('a[href="/my-account"], a[href="/messages"]'),
    ).toBeNull();
  },
);
it("keeps unavailable data distinct from a genuine empty overview", () => {
  mocks.personal.mockReturnValue({
    error: { message: "Connection interrupted" },
  });
  render(<TuteeOverview />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Connection interrupted",
  );
  expect(screen.getByText("—")).toBeTruthy();
});
it("shows schedules without unrelated attendance, disciplinary records or paging controls", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [
        {
          id: "pair-1",
          subject: "Math",
          tutor: { englishName: "Tutor A" },
          scheduleConfirmed: true,
          dayOfWeek: 1,
          startMin: 930,
          endMin: 990,
          room: null,
        },
      ],
      sessions: [],
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="schedule" />);
  expect(screen.getByText("Math · Tutor A")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "schedule" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "next" })).toBeNull();
});
it("attendance pagination is not enabled by unrelated disciplinary history", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: [],
      cards: Array.from({ length: 20 }, () => ({ id: "hidden-card" })),
      appeals: [],
    },
  });
  render(<StudentPortal view="attendance" />);
  expect(
    screen.getByRole("button", { name: "next" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("heading", { name: "cards" })).toBeNull();
});
it("support paging is independent of a full attendance page", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: Array.from({ length: 20 }, () => ({})),
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="support" />);
  expect(
    screen.getByRole("button", { name: "next" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("heading", { name: "appeals" })).toBeTruthy();
});
it("a full attendance page can move forward while retaining the selected section", () => {
  mocks.personal.mockReturnValue({
    data: {
      schedule: [],
      sessions: Array.from({ length: 20 }, (_, i) => ({
        session: {
          id: String(i),
          date: new Date(),
          pairing: { subject: "Math" },
        },
        status: "PRESENT",
        feedback: null,
      })),
      cards: [],
      appeals: [],
    },
  });
  render(<StudentPortal view="attendance" />);
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(mocks.personal).toHaveBeenLastCalledWith(
    { page: 1 },
    { enabled: true },
  );
  expect(screen.queryByRole("heading", { name: "cards" })).toBeNull();
});

it("shows the assigned tutor while awaiting a schedule and counts only confirmed subjects", () => {
  const common = {
    dayOfWeek: 1,
    startMin: 930,
    endMin: 990,
    room: null,
    tutor: { englishName: "Tutor A" },
  };
  mocks.personal.mockReturnValue({
    data: {
      user: { name: "Sam" },
      sessions: [],
      cards: [],
      appeals: [],
      schedule: [
        { ...common, id: "pending", subject: "Math", scheduleConfirmed: false },
        {
          ...common,
          id: "scheduled",
          subject: "English",
          scheduleConfirmed: true,
        },
      ],
    },
  });
  const { unmount } = render(<TuteeOverview />);
  expect(
    screen.getByRole("link", { name: /schedule 1 scheduledSubjects/ }),
  ).toBeTruthy();
  expect(screen.getByText("awaiting")).toBeTruthy();
  expect(screen.getByText("Mon 15:30–16:30")).toBeTruthy();
  unmount();
  render(<StudentPortal view="schedule" />);
  expect(
    screen.getByText("Math · Tutor A").parentElement?.textContent,
  ).toContain("awaiting");
  expect(
    screen.getByText("Math · Tutor A").parentElement?.textContent,
  ).not.toContain("15:30");
  expect(
    screen.getByText("English · Tutor A").parentElement?.textContent,
  ).toContain("15:30–16:30");
});

it("keeps initially unknown summaries distinct from loaded empty records and retries only their read", () => {
  const refetch = vi.fn();
  mocks.personal.mockReturnValue({
    data: undefined,
    error: { message: "Offline" },
    refetch,
  });
  mocks.requests.mockReturnValue({ data: undefined });
  render(<TuteeOverview />);
  expect(screen.getAllByText("—")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("button", { name: "retry" })).toHaveLength(1);
});

it("combines initial overview recovery without duplicate loading or failed-read actions", () => {
  mocks.personal.mockReturnValue({ data: undefined });
  mocks.requests.mockReturnValue({ data: undefined });
  const { rerender } = render(<TuteeOverview />);
  expect(screen.getAllByText("loading")).toHaveLength(1);
  const scheduleRead = vi.fn();
  const requestRead = vi.fn();
  mocks.personal.mockReturnValue({
    error: { message: "Schedule unavailable" },
    refetch: scheduleRead,
  });
  mocks.requests.mockReturnValue({
    error: { message: "Requests unavailable" },
    refetch: requestRead,
  });
  rerender(<TuteeOverview />);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByText("schedule: Schedule unavailable")).toBeTruthy();
  expect(screen.getByText("requests: Requests unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(scheduleRead).toHaveBeenCalledOnce();
  expect(requestRead).toHaveBeenCalledOnce();
});

it("retains meaningful headings in the combined portal while dedicated attendance omits its duplicate heading", () => {
  const { unmount } = render(<StudentPortal view="all" />);
  expect(screen.getByRole("heading", { name: "schedule" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "attendance" })).toBeTruthy();
  unmount();
  render(<StudentPortal view="attendance" />);
  expect(screen.queryByRole("heading", { name: "attendance" })).toBeNull();
});
