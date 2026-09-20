// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "ACCEPTED",
  type: "INITIAL",
  isHead: false,
  schedule: vi.fn(),
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
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      myInterviews: {
        useQuery: () => ({
          data: [
            {
              id: "application-1",
              name: "Closed Applicant",
              email: "closed@example.test",
              isHead: state.isHead,
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

afterEach(() => {
  cleanup();
  state.status = "ACCEPTED";
  state.isHead = false;
  state.type = "INITIAL";
  state.schedule.mockClear();
});

it.each(["ACCEPTED", "REJECTED"] as const)(
  "renders completed %s panel voting as read-only while retaining votes and outcome",
  (status) => {
    state.status = status;
    render(<MyInterviews />);

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
  render(<MyInterviews />);
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
