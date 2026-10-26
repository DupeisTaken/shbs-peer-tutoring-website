// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import { MyInterviews } from "./my-interviews";

const state = vi.hoisted(() => ({
  rows: [] as ReturnType<typeof interview>[],
  pending: false,
  error: "",
  errorCode: "",
  refetch: vi.fn(),
  vote: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ tutor: { myInterviews: { invalidate: vi.fn() } } }),
    tutor: {
      myInterviews: {
        useQuery: () => ({
          data: state.rows,
          error: state.error
            ? Object.assign(new Error(state.error), {
                data: { code: state.errorCode },
              })
            : null,
          isSuccess: !state.error,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      setInterviewTime: {
        useMutation: () => ({
          mutate: state.schedule,
          reset: vi.fn(),
          isPending: state.pending,
        }),
      },
      castInterviewVote: {
        useMutation: () => ({
          mutate: state.vote,
          reset: vi.fn(),
          isPending: state.pending,
          error: state.error ? new Error(state.error) : null,
        }),
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
    isHead: true,
    canChair: true,
    isInvalid: false,
    type: "INITIAL",
    interviewAt: null as Date | null,
    updatedAt: new Date("2026-10-01"),
    decidedAt: null,
    interviewCompletedAt: null,
    interviewDurationMin: null,
    myAwardedHours: 0,
    pendingDecision: false,
    subjectIntents: [],
    interviewers: [{ isHead: true, tutor: { englishName: "Chair" } }],
    votes: [],
    myVote: null,
    tally: { accepts: 0, rejects: 0 },
    decisionComment: null,
    decidedByTutor: null,
    ...patch,
  };
}
const element = () => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    <MyInterviews />
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  state.rows = [];
  state.error = "";
  state.errorCode = "";
  state.pending = false;
  vi.clearAllMocks();
});

it("formats a 35-minute source credit without exposing floating-point noise", () => {
  state.rows = [
    interview("fractional", {
      status: "ACCEPTED",
      interviewCompletedAt: new Date("2026-10-01"),
      interviewDurationMin: 35,
      myAwardedHours: 35 / 60,
    }),
  ];
  render(element());
  fireEvent.click(
    screen.getByRole("button", { name: "Completed interviews (1)" }),
  );
  expect(
    screen.getByText("Your recorded interview credit: 0.5833 hours"),
  ).toBeTruthy();
  expect(screen.queryByText(/0\.5833333333333334/)).toBeNull();
  expect(state.rows[0]!.myAwardedHours).toBe(35 / 60);
});

it("groups terminal history behind one initially closed menu and keeps unresolved completion/approval work active", () => {
  state.rows = [
    interview("terminal", { status: "ACCEPTED" }),
    interview("recalled", { status: "RECALLED" }),
    interview("pending-award", {
      interviewCompletedAt: new Date("2026-10-01"),
      interviewDurationMin: 45,
      myAwardedHours: 0.75,
      pendingDecision: true,
    }),
  ];
  const view = render(element());
  const menu = screen.getByRole("button", { name: "Completed interviews (2)" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(
    screen.getByText("Applicant terminal").closest("[hidden]"),
  ).toBeTruthy();
  expect(screen.getByText("Applicant pending-award")).toBeTruthy();
  expect(screen.getByText(en.interviewReview.decisionPending)).toBeTruthy();
  expect(
    screen.getByText("Your recorded interview credit: 0.75 hours"),
  ).toBeTruthy();
  fireEvent.click(menu);
  expect(screen.getByText("Applicant terminal")).toBeTruthy();
  expect(screen.getByText(en.qualificationRequests.RECALLED)).toBeTruthy();
  expect(
    screen.getAllByText(en.interviewReview.completionPending),
  ).toHaveLength(2);
  expect(
    view.container.querySelectorAll('[data-interview-id="terminal"]'),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("link", { name: en.interviewReview.registrationAction }),
  ).toBeNull();
  fireEvent.click(menu);
  expect(
    screen.getByText("Applicant recalled").closest("[hidden]"),
  ).toBeTruthy();
});

it("retains scheduling, voting and decision drafts and pending/errors across collapse, reload failure and reorder", () => {
  state.rows = [
    interview("a"),
    interview("b", { interviewAt: new Date("2026-10-01") }),
  ];
  const view = render(element());
  const schedule = screen.getAllByLabelText<HTMLInputElement>(
    en.tutor.interviews.setTime,
  )[1]!;
  const vote = screen.getAllByLabelText<HTMLInputElement>(
    en.tutor.interviews.voteCommentPlaceholder,
  )[1]!;
  const decision = screen.getAllByLabelText<HTMLInputElement>(
    en.tutor.interviews.decisionCommentPlaceholder,
  )[1]!;
  fireEvent.change(schedule, { target: { value: "2026-10-02T16:00" } });
  fireEvent.change(vote, { target: { value: "Vote draft" } });
  fireEvent.change(decision, { target: { value: "Decision draft" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.collapse }),
  );
  expect(
    screen.getByDisplayValue("Vote draft").closest("[hidden]"),
  ).toBeTruthy();
  state.rows = [
    interview("a", {
      interviewAt: new Date("2026-09-01"),
      updatedAt: new Date("2026-10-02"),
    }),
    state.rows[1]!,
  ];
  state.pending = true;
  state.error = "Background refresh unavailable";
  view.rerender(element());
  expect(
    screen.getByRole("button", { name: en.tutor.tasks.retry }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.expand }),
  );
  expect(screen.getByDisplayValue("Vote draft")).toBe(vote);
  expect(screen.getByDisplayValue("Decision draft")).toBe(decision);
  expect(screen.getByDisplayValue("2026-10-02T16:00")).toBe(schedule);
  expect(schedule.disabled).toBe(true);
  expect(
    view.container
      .querySelectorAll("[data-interview-id]")[0]
      ?.getAttribute("data-interview-id"),
  ).toBe("a");
  expect(state.vote).not.toHaveBeenCalled();
});

it("reopens server records and updates history counts without duplicating or optimistically moving entries", () => {
  state.rows = [interview("a"), interview("b", { status: "REJECTED" })];
  const view = render(element());
  expect(
    screen.getByRole("button", { name: "Completed interviews (1)" }),
  ).toBeTruthy();
  state.rows = [interview("a", { status: "ACCEPTED" }), interview("b")];
  view.rerender(element());
  expect(screen.getByText("Applicant b")).toBeTruthy();
  expect(screen.getByText("Applicant a").closest("[hidden]")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Completed interviews (1)" }),
  );
  expect(
    view.container.querySelectorAll('[data-interview-id="a"]'),
  ).toHaveLength(1);
});

it("reveals an explicitly focused destination even for repeated same-hash navigation and keeps drafts", () => {
  state.rows = [interview("a")];
  render(element());
  fireEvent.change(
    screen.getByLabelText(en.tutor.interviews.voteCommentPlaceholder),
    { target: { value: "Retained navigation draft" } },
  );
  for (let i = 0; i < 2; i++) {
    fireEvent.click(
      screen.getByRole("button", { name: en.interviewReview.collapse }),
    );
    fireEvent.focus(document.getElementById("tutor-interviews")!);
    expect(
      screen.getByRole("button", { name: en.interviewReview.collapse }),
    ).toBeTruthy();
    expect(
      screen.getByDisplayValue("Retained navigation draft").closest("[hidden]"),
    ).toBeNull();
  }
  fireEvent.click(
    screen.getByRole("button", { name: en.interviewReview.collapse }),
  );
  fireEvent.focus(
    screen.getByRole("button", { name: en.interviewReview.expand }),
  );
  expect(
    screen.getByRole("button", { name: en.interviewReview.expand }),
  ).toBeTruthy();
});

it("conceals cached applicant evidence after authoritative denial until a fresh authorized success", () => {
  state.rows = [interview("a")];
  const view = render(element());
  expect(screen.getByText("Applicant a")).toBeTruthy();
  state.error = "Access revoked";
  state.errorCode = "FORBIDDEN";
  view.rerender(element());
  expect(screen.queryByText("Applicant a")).toBeNull();
  state.error = "Network unavailable";
  state.errorCode = "";
  view.rerender(element());
  expect(screen.queryByText("Applicant a")).toBeNull();
  state.error = "";
  view.rerender(element());
  expect(screen.getByText("Applicant a")).toBeTruthy();
});
