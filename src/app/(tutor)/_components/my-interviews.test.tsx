// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "ACCEPTED",
  type: "INITIAL",
  isHead: false,
  canChair: true,
  invalid: false,
  schedule: vi.fn(),
  vote: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({
    dateTime: (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Shanghai",
        ...options,
      }).format(date),
  }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: { myInterviews: { invalidate: vi.fn() } },
    }),
    tutor: {
      setInterviewTime: { useMutation: () => ({ mutate: state.schedule }) },
      castInterviewVote: {
        useMutation: () => ({
          mutate: state.vote,
          reset: vi.fn(),
          isPending: false,
        }),
      },
      myInterviews: {
        useQuery: () => ({
          data: [
            {
              id: "application-1",
              name: "Closed Applicant",
              email: "closed@example.test",
              isHead: state.isHead,
              canChair: state.isHead && state.canChair,
              isInvalid: state.invalid,
              type: state.type,
              qualificationReason:
                "Completed advanced coursework with teaching evidence.",
              subjectIntents: [
                { subject: { name: "Mathematics" }, taken: true, grade: "A" },
              ],
              interviewers: [
                { tutor: { englishName: "Panel Chair" }, isHead: true },
              ],
              interviewAt: null,
              votes: [
                {
                  tutorId: "panel-chair",
                  accept: true,
                  comment: "Strong demo",
                  tutor: { englishName: "Panel Chair" },
                },
              ],
              myVote: { accept: true, comment: "Strong demo" },
              status: state.status,
              tally: { accepts: 1, rejects: 0 },
              decisionComment: "Accepted after panel review",
              decidedByTutor: { englishName: "Panel Chair" },
              updatedAt: new Date("2026-09-10T00:00:00Z"),
            },
          ],
        }),
      },
    },
  },
}));

import { MyInterviews } from "./my-interviews";

function show() {
  const view = render(<MyInterviews />);
  // Inspect completed evidence by deliberately expanding its retained disclosure.
  const menu = screen.queryByRole("button", {
    name: "interviewReview.completed",
  });
  if (menu) fireEvent.click(menu);
  return view;
}

afterEach(() => {
  cleanup();
  state.status = "ACCEPTED";
  state.isHead = false;
  state.canChair = true;
  state.type = "INITIAL";
  state.invalid = false;
  state.schedule.mockClear();
  state.vote.mockClear();
});

it.each(["ACCEPTED", "REJECTED"] as const)(
  "renders completed %s panel voting as read-only while retaining votes and outcome",
  (status) => {
    state.status = status;
    show();

    const acceptButton = screen.getByRole("button", {
      name: /tutor\.interviews\.accept/,
    });
    const rejectButton = screen.getByRole("button", {
      name: /tutor\.interviews\.reject/,
    });
    const comment = screen.getByPlaceholderText(
      "tutor.interviews.voteCommentPlaceholder",
    );

    expect((acceptButton as HTMLButtonElement).disabled).toBe(true);
    expect((rejectButton as HTMLButtonElement).disabled).toBe(true);
    expect((comment as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "tutor.interviews.votingClosed",
    );
    expect(screen.getByText(/Strong demo/)).toBeTruthy();
    expect(screen.getByText("Mathematics · A", { exact: true })).toBeTruthy();
    expect(screen.queryByText(/Completed advanced coursework/)).toBeNull();
    expect(
      screen.getByText(
        `tutor.interviews.status${status === "ACCEPTED" ? "Accepted" : "Rejected"}`,
      ),
    ).toBeTruthy();
  },
);

it("gives an additional-request chair labelled scheduling controls and routes decisions to management", () => {
  state.status = "INTERVIEW";
  state.type = "HIGHER_LEVEL";
  state.isHead = true;
  show();
  expect(screen.getByText("Mathematics", { exact: true })).toBeTruthy();
  expect(screen.queryByText(/Mathematics ·/)).toBeNull();
  expect(screen.getByText(/Completed advanced coursework/)).toBeTruthy();
  const when = screen.getByLabelText("tutor.interviews.setTime");
  fireEvent.change(when, { target: { value: "2026-09-22T15:30" } });
  fireEvent.click(
    screen.getByRole("button", { name: "tutor.interviews.setTime" }),
  );
  expect(state.schedule).toHaveBeenCalledWith({
    applicationId: "application-1",
    interviewAt: new Date("2026-09-22T07:30:00Z"),
  });
  expect(
    screen.getByLabelText("tutor.interviews.voteCommentPlaceholder"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "qualificationRequests.reviewLink" })
      .getAttribute("href"),
  ).toBe("/admin/applications#application-application-1");
  expect(
    screen.queryByPlaceholderText(
      "tutor.interviews.decisionCommentPlaceholder",
    ),
  ).toBeNull();
});

it("retains recalled interview evidence with voting and scheduling closed", () => {
  state.status = "RECALLED";
  state.type = "HIGHER_LEVEL";
  state.isHead = true;
  show();
  expect(screen.getByText("qualificationRequests.RECALLED")).toBeTruthy();
  expect(screen.getByText(/Strong demo/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: /tutor\.interviews\.accept/,
    }).disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "tutor.interviews.setTime" }),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "qualificationRequests.reviewLink" }),
  ).toBeNull();
});

it("pauses a flagged initial interview without exposing staff reason or dropping prior votes", () => {
  state.status = "INTERVIEW";
  state.isHead = true;
  state.invalid = true;
  show();
  expect(screen.getByText("badge")).toBeTruthy();
  expect(screen.getByText("processingPaused")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: /tutor\.interviews\.accept/,
    }).disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "tutor.interviews.setTime" }),
  ).toBeNull();
  expect(
    screen.queryByPlaceholderText(
      "tutor.interviews.decisionCommentPlaceholder",
    ),
  ).toBeNull();
  expect(screen.getByText(/Strong demo/)).toBeTruthy();
});

it.each(["INITIAL", "ADDITIONAL_SUBJECT", "HIGHER_LEVEL"])(
  "retains a legacy %s chair's panel and vote while hiding ineligible chair actions",
  (type) => {
    state.status = "INTERVIEW";
    state.type = type;
    state.isHead = true;
    state.canChair = false;
    show();

    expect(screen.getByText("interviewReview.chairNeedsUpdate")).toBeTruthy();
    expect(screen.queryByLabelText("tutor.interviews.setTime")).toBeNull();
    expect(
      screen.queryByLabelText("tutor.interviews.decisionCommentPlaceholder"),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "qualificationRequests.reviewLink" }),
    ).toBeNull();
    const vote = screen.getByRole<HTMLButtonElement>("button", {
      name: /tutor\.interviews\.accept/,
    });
    expect(vote.disabled).toBe(false);
    fireEvent.click(vote);
    expect(state.vote).toHaveBeenCalledWith({
      applicationId: "application-1",
      accept: true,
      comment: "Strong demo",
    });
    expect(state.schedule).not.toHaveBeenCalled();
  },
);

it("retains a final decision when its recorded chair no longer has chair authority", () => {
  state.isHead = true;
  state.canChair = false;
  show();
  expect(screen.getByText("tutor.interviews.statusAccepted")).toBeTruthy();
  expect(screen.getByText(/Accepted after panel review/)).toBeTruthy();
  expect(screen.queryByText("interviewReview.chairNeedsUpdate")).toBeNull();
});
