// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MyInterviews, ScheduleInterviewDetails } from "./my-interviews";

const state = vi.hoisted(() => ({
  rows: [] as ReturnType<typeof interview>[],
  enabled: [] as boolean[],
  pending: false,
  errorCode: "",
  error: "",
  mutationError: "",
  loading: false,
  fetching: false,
  vote: vi.fn(),
  schedule: vi.fn(),
  refetch: vi.fn(),
  invalidateSchedule: vi.fn(),
  close: vi.fn(),
  voteObserver: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key} (${values.count})`,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
    number: (value: number) => value.toFixed(4),
  }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: { myInterviews: { invalidate: vi.fn() } },
      personalSchedule: {
        interviews: { invalidate: state.invalidateSchedule },
      },
    }),
    tutor: {
      myInterviews: {
        useQuery: (_input?: undefined, options?: { enabled?: boolean }) => {
          state.enabled.push(options?.enabled !== false);
          return {
            data: state.rows,
            error: state.error
              ? Object.assign(new Error(state.error), {
                  data: { code: state.errorCode },
                })
              : null,
            isLoading: state.loading,
            isSuccess: !state.error && !state.loading,
            isFetching: state.fetching,
            refetch: state.refetch,
          };
        },
      },
      castInterviewVote: {
        useMutation: () => {
          state.voteObserver();
          return {
            mutate: state.vote,
            reset: vi.fn(),
            isPending: state.pending,
            error: state.mutationError ? new Error(state.mutationError) : null,
          };
        },
      },
      setInterviewTime: {
        useMutation: () => ({ mutate: state.schedule, reset: vi.fn() }),
      },
      decideInterview: {
        useMutation: () => ({ mutate: vi.fn(), reset: vi.fn() }),
      },
    },
  },
}));

function interview(id: string, patch = {}) {
  return {
    id,
    name: `Applicant ${id}`,
    email: `${id}@example.test`,
    status: "INTERVIEW",
    isHead: false,
    canChair: false,
    isInvalid: false,
    type: "INITIAL",
    interviewAt: null as Date | null,
    updatedAt: new Date("2026-10-01"),
    interviewCompletedAt: null,
    interviewDurationMin: null,
    myAwardedHours: 0,
    pendingDecision: false,
    subjectIntents: [],
    interviewers: [{ isHead: true, tutor: { englishName: "Chair" } }],
    votes: [
      {
        tutorId: "chair",
        accept: true,
        comment: "Panel evidence",
        tutor: { englishName: "Chair" },
      },
    ],
    myVote: null,
    tally: { accepts: 1, rejects: 0 },
    decisionComment: null,
    decidedByTutor: null,
    ...patch,
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  state.rows = [];
  state.enabled = [];
  state.pending = false;
  state.errorCode = "";
  state.error = "";
  state.mutationError = "";
  state.loading = false;
  state.fetching = false;
  vi.clearAllMocks();
});

it("starts private reads only on deliberate opening and retains the vote draft after Close", () => {
  state.rows = [interview("a")];
  const view = render(
    <ScheduleInterviewDetails applicationId={null} onClose={state.close} />,
  );
  expect(state.enabled.every((enabled) => !enabled)).toBe(true);
  expect(state.voteObserver).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(state.enabled.at(-1)).toBe(true);
  fireEvent.change(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
    { target: { value: "Retained draft" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(state.close).toHaveBeenCalledOnce();
  view.rerender(
    <ScheduleInterviewDetails applicationId={null} onClose={state.close} />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.enabled.at(-1)).toBe(true);
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Retained draft")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /tutor.interviews.accept/ }),
  );
  expect(state.vote).toHaveBeenCalledWith({
    applicationId: "a",
    accept: true,
    comment: "Retained draft",
  });
});

it("retains each application's independent vote draft across selection changes and background errors", () => {
  state.rows = [interview("a"), interview("b")];
  const view = render(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  fireEvent.change(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
    { target: { value: "Draft A" } },
  );
  view.rerender(
    <ScheduleInterviewDetails applicationId="b" onClose={state.close} />,
  );
  fireEvent.change(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
    { target: { value: "Draft B" } },
  );
  state.error = "Offline";
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Draft A")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Offline");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: /tutor.interviews.accept/,
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "tutor.interviews.voteCommentPlaceholder",
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: /tutor.interviews.accept/ }),
  );
  expect(state.vote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "tutor.tasks.retry" }));
  expect(state.refetch).toHaveBeenCalledOnce();
  view.rerender(
    <ScheduleInterviewDetails applicationId="b" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Draft B")).toBeTruthy();
});

it("blocks dismissal and external selection switching while the existing vote write is pending", () => {
  state.rows = [interview("a"), interview("b")];
  const view = render(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  fireEvent.change(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
    { target: { value: "Pending A" } },
  );
  state.pending = true;
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "close" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  view.rerender(
    <ScheduleInterviewDetails applicationId="b" onClose={state.close} />,
  );
  expect(screen.getByRole("dialog", { name: "Applicant a" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Applicant b" })).toBeNull();
  expect(state.close).not.toHaveBeenCalled();
  state.pending = false;
  state.mutationError = "Vote rejected";
  view.rerender(
    <ScheduleInterviewDetails applicationId="b" onClose={state.close} />,
  );
  expect(screen.getByRole("dialog", { name: "Applicant b" })).toBeTruthy();
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Pending A")).toBeTruthy();
  expect(screen.getByText("Vote rejected")).toBeTruthy();
});

it("conceals every private surface and disables reads while retaining a pending vote owner and draft", () => {
  state.rows = [interview("a")];
  const view = render(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  fireEvent.change(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
    { target: { value: "Pending private draft" } },
  );
  state.pending = true;
  view.rerender(
    <ScheduleInterviewDetails
      applicationId="a"
      enabled={false}
      onClose={state.close}
    />,
  );
  expect(state.enabled.at(-1)).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("a@example.test")).toBeNull();
  expect(screen.queryByText(/Panel evidence/)).toBeNull();
  expect(screen.queryByDisplayValue("Pending private draft")).toBeNull();
  expect(state.close).not.toHaveBeenCalled();
  // The same pending observer and form state resume after authority returns.
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Pending private draft")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "close" }).disabled,
  ).toBe(true);
  state.pending = false;
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByDisplayValue("Pending private draft")).toBeTruthy();
  view.rerender(
    <ScheduleInterviewDetails
      applicationId={null}
      showAll
      enabled={false}
      onClose={state.close}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Applicant a")).toBeNull();
  expect(state.enabled.at(-1)).toBe(false);
});

it("conceals cached private evidence on access denial and removed panel membership", () => {
  state.rows = [interview("a")];
  const view = render(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByText("a@example.test")).toBeTruthy();
  state.errorCode = "FORBIDDEN";
  state.error = "Permission revoked";
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByText("interviewReview.accessDenied")).toBeTruthy();
  expect(screen.queryByText("a@example.test")).toBeNull();
  expect(screen.queryByText(/Panel evidence/)).toBeNull();
  state.errorCode = "";
  state.error = "Offline";
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.queryByText("a@example.test")).toBeNull();
  state.error = "";
  state.rows = [];
  view.rerender(
    <ScheduleInterviewDetails applicationId="a" onClose={state.close} />,
  );
  expect(screen.getByText("unifiedScheduleInterview.unavailable")).toBeTruthy();
  expect(
    screen.queryByLabelText("tutor.interviews.voteCommentPlaceholder"),
  ).toBeNull();
});

it("opens member voting for an assigned chair without chair controls and links to the chair workspace tab", () => {
  state.rows = [interview("chair", { isHead: true, canChair: true })];
  render(
    <ScheduleInterviewDetails
      applicationId="chair"
      compact
      onClose={state.close}
    />,
  );
  expect(state.voteObserver).toHaveBeenCalled();
  expect(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /tutor.interviews.accept/ }),
  );
  expect(state.vote).toHaveBeenCalledWith({
    applicationId: "chair",
    accept: true,
    comment: undefined,
  });
  expect(
    screen
      .getByRole("link", { name: "unifiedScheduleInterview.chairWorkspace" })
      .getAttribute("href"),
  ).toBe("#chair-interviews");
  expect(screen.queryByLabelText("tutor.interviews.setTime")).toBeNull();
  expect(
    screen.queryByLabelText("tutor.interviews.decisionCommentPlaceholder"),
  ).toBeNull();
  expect(screen.queryByText("interviewReview.chairNeedsUpdate")).toBeNull();
});

it("keeps unscheduled, chaired, completed, invalid and recalled panel assignments reachable from work and history", () => {
  state.rows = [
    interview("unscheduled", { status: "PENDING" }),
    interview("invalid", { isInvalid: true }),
    interview("completed", { status: "ACCEPTED" }),
    interview("recalled", { status: "RECALLED" }),
    interview("chair", { isHead: true }),
  ];
  const view = render(
    <ScheduleInterviewDetails
      applicationId={null}
      showAll
      onClose={state.close}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "interviewReview.active (3)" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "interviewReview.completed (2)" }),
  ).toBeTruthy();
  expect(screen.getByText("Applicant chair")).toBeTruthy();
  expect(screen.getByText("unifiedSchedule.chair")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "unifiedScheduleInterview.chairWorkspace" })
      .getAttribute("href"),
  ).toBe("/dashboard#chair-interviews");
  expect(state.voteObserver).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "tablePatterns.details: Applicant recalled",
    }),
  );
  const reader = screen.getByRole("dialog", { name: "Applicant recalled" });
  expect(
    within(reader).getByText("qualificationRequests.RECALLED"),
  ).toBeTruthy();
  expect(
    within(reader).getByRole<HTMLButtonElement>("button", {
      name: /tutor.interviews.accept/,
    }).disabled,
  ).toBe(true);
  view.rerender(
    <ScheduleInterviewDetails
      applicationId="invalid"
      showAll
      onClose={state.close}
    />,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: /tutor.interviews.accept/,
    }).disabled,
  ).toBe(true);
});

it("separates chair duties from member voting in the chair workspace and links to Schedule for voting", () => {
  state.rows = [
    interview("chair-dated", {
      isHead: true,
      canChair: true,
      interviewAt: new Date("2026-10-28T07:00:00Z"),
    }),
    interview("chair-legacy", {
      isHead: true,
      canChair: false,
      myVote: { accept: true, comment: "Solid demo" },
    }),
    interview("panelist"),
  ];
  render(<MyInterviews audience="chair" />);
  expect(screen.getByText("Applicant chair-dated")).toBeTruthy();
  expect(screen.getByText("Applicant chair-legacy")).toBeTruthy();
  expect(screen.queryByText("Applicant panelist")).toBeNull();
  expect(screen.getByText("interviewReview.chairNeedsUpdate")).toBeTruthy();
  // Strict split: no member vote form in the chair workspace.
  expect(
    screen.queryByLabelText("tutor.interviews.voteCommentPlaceholder"),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: /tutor.interviews.accept/ }),
  ).toBeNull();
  // Dated chair interview links to its calendar event; unscheduled links to Schedule's interview dialog.
  expect(
    screen
      .getByRole("link", { name: "tutor.interviews.voteInSchedule" })
      .getAttribute("href"),
  ).toBe("#interview-chair-dated");
  expect(
    screen
      .getByRole("link", { name: "tutor.interviews.updateVoteInSchedule" })
      .getAttribute("href"),
  ).toBe("#tutor-appointments");
  // Live chair authority still gates scheduling/decision controls.
  expect(screen.getAllByLabelText("tutor.interviews.setTime")).toHaveLength(1);
});

it("renders an explicit empty state in the chair workspace tab with manual refresh when no chair interviews exist", () => {
  state.rows = [interview("panelist")];
  render(<MyInterviews audience="chair" />);
  expect(screen.getByText("dashboard.interviews.title")).toBeTruthy();
  expect(screen.getByText("interviewReview.noChairInterviews")).toBeTruthy();
  expect(screen.queryByText("Applicant panelist")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "interviewReview.refresh" }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.invalidateSchedule).toHaveBeenCalledOnce();
});

it("refreshes votes in the chair workspace without discarding decision drafts and disables while fetching", () => {
  state.rows = [interview("chair", { isHead: true, canChair: true })];
  const view = render(<MyInterviews audience="chair" />);
  const decision = screen.getByLabelText<HTMLInputElement>(
    "tutor.interviews.decisionCommentPlaceholder",
  );
  fireEvent.change(decision, { target: { value: "Keep chair draft" } });
  fireEvent.click(
    screen.getByRole("button", { name: "interviewReview.refresh" }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.invalidateSchedule).toHaveBeenCalledOnce();
  expect(decision.value).toBe("Keep chair draft");

  state.fetching = true;
  view.rerender(<MyInterviews audience="chair" />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "interviewReview.refreshing",
    }).disabled,
  ).toBe(true);
});
