// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "ACCEPTED",
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({ dateTime: (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", ...options }).format(date) }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: { myInterviews: { invalidate: vi.fn() } },
    }),
    tutor: {
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
              isHead: false,
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
    expect(
      screen.getByText(
        `tutor.interviews.status${status === "ACCEPTED" ? "Accepted" : "Rejected"}`,
      ),
    ).toBeTruthy();
  },
);
