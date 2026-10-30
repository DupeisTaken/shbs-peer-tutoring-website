// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, type ReactNode } from "react";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { TutorSchedule } from "./tutor-schedule";

const state = vi.hoisted(() => ({
  interviewError: null as null | { data: { code: string } },
  meetingError: null as null | { data: { code: string } },
  interviewOptions: vi.fn(),
  meetingOptions: vi.fn(),
  interviewRetry: vi.fn(),
  meetingRetry: vi.fn(),
  interviewMounted: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    personalSchedule: {
      interviews: {
        useQuery: (_input: unknown, options: unknown) => {
          state.interviewOptions(options);
          return {
            data: {
              appointments: [
                {
                  id: "panel",
                  name: "Synthetic Panel Applicant",
                  subjects: ["Math"],
                  interviewAt: new Date("2026-10-28T07:00:00Z"),
                  isHead: false,
                },
                {
                  id: "chair",
                  name: "Synthetic Chair Applicant",
                  subjects: ["Science"],
                  interviewAt: new Date("2026-10-29T07:00:00Z"),
                  isHead: true,
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
                  date: new Date("2026-10-30T07:00:00Z"),
                  excused: false,
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
}));
vi.mock("~/app/_components/session-agenda", () => ({
  SessionAgenda: ({
    supplementalEvents,
  }: {
    supplementalEvents: { id: string; content: ReactNode }[];
  }) => (
    <section>
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
) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : en}
  >
    <TutorSchedule
      active={active}
      interviewsEnabled={interviewsEnabled}
      meetingsEnabled={meetingsEnabled}
      now={new Date("2026-10-26T00:00:00Z")}
    />
  </NextIntlClientProvider>
);

it("opens one panelist controller and keeps chair navigation in its owning workspace", () => {
  render(ui());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: en.unifiedSchedule.openChair })
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
it("retains independent cached meetings beside a source-specific read retry", () => {
  state.meetingError = { data: { code: "INTERNAL_SERVER_ERROR" } };
  render(ui());
  expect(screen.getByText("Synthetic Briefing")).toBeTruthy();
  expect(screen.getByText("Synthetic Panel Applicant")).toBeTruthy();
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
