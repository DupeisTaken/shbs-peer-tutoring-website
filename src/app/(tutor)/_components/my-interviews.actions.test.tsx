// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { MyInterviews } from "./my-interviews";
const state = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: unknown) => false),
  decide: vi.fn(),
  approve: vi.fn(async (_input: unknown) => ({ ok: true })),
  vote: vi.fn(),
  schedule: vi.fn(),
  refreshRoute: vi.fn(),
  refreshInterviews: vi.fn(async () => undefined),
  fetchTotal: vi.fn(async () => undefined),
  refreshNotifications: vi.fn(async () => undefined),
  refreshUnread: vi.fn(async () => undefined),
  queued: false,
  error: "",
  isHead: true,
  pending: false,
  success: false,
  accepts: 1,
  rejects: 0,
  version: new Date("2026-10-01T00:00:00Z"),
  fetch: vi.fn(async () => [
    { id: "application", updatedAt: new Date("2026-10-02T00:00:00Z") },
  ]),
  reset: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refreshRoute }),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myInterviews: {
          invalidate: state.refreshInterviews,
          fetch: state.fetch,
        },
        myMonthlyTotal: { fetch: state.fetchTotal },
      },
      notification: {
        list: { invalidate: state.refreshNotifications },
        unreadCount: { invalidate: state.refreshUnread },
      },
    }),
    tutor: {
      myInterviews: {
        useQuery: () => ({
          data: [
            {
              id: "application",
              name: "Sample Applicant",
              email: "applicant@example.test",
              isHead: state.isHead,
              canChair: state.isHead,
              type: "INITIAL",
              status: "INTERVIEW",
              interviewAt: null,
              interviewCompletedAt: null,
              interviewDurationMin: null,
              panel: [
                {
                  tutorId: "chair",
                  name: "Chair",
                  isHead: true,
                  attended: false,
                },
              ],
              subjectIntents: [],
              interviewers: [{ tutor: { englishName: "Chair" }, isHead: true }],
              votes: [],
              myVote: null,
              tally: { accepts: state.accepts, rejects: state.rejects },
              decisionComment: null,
              decidedByTutor: null,
              updatedAt: state.version,
            },
          ],
        }),
      },
      setInterviewTime: {
        useMutation: () => ({ mutate: state.schedule, reset: vi.fn() }),
      },
      castInterviewVote: {
        useMutation: () => ({ mutate: state.vote, reset: vi.fn() }),
      },
      decideInterview: {
        useMutation: () => ({
          mutate: state.decide,
          mutateAsync: state.approve,
          reset: state.reset,
          isPending: state.pending,
          isSuccess: state.success,
          error: state.queued
            ? { message: "Queued", data: { approvalId: "proposal" } }
            : state.error
              ? { message: state.error, data: {} }
              : null,
        }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.confirm.mockResolvedValue(false);
  state.queued = false;
  state.error = "";
  state.isHead = true;
  state.pending = false;
  state.success = false;
  state.accepts = 1;
  state.rejects = 0;
  state.version = new Date("2026-10-01T00:00:00Z");
});
const element = () => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    <MyInterviews />
  </NextIntlClientProvider>
);
it("collects explicit hours and attendance for approval, and only writes after the consequence review", async () => {
  render(element());
  fireEvent.change(
    screen.getByLabelText(messages.tutor.interviews.decisionCommentPlaceholder),
    { target: { value: "Panel decision draft" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.interviews.approve }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Sample Applicant");
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.decide).not.toHaveBeenCalled();
  expect(state.approve).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByLabelText(messages.workflows.interviewComplete),
    { target: { value: "2026-09-01T10:00" } },
  );
  fireEvent.change(screen.getByLabelText(messages.workflows.duration), {
    target: { value: "45" },
  });
  fireEvent.click(screen.getByLabelText("Chair"));
  fireEvent.click(
    screen.getByRole("button", { name: messages.interviewApproval.review }),
  );
  fireEvent.click(
    within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", {
      name: messages.interviewApproval.confirm,
    }),
  );
  await waitFor(() =>
    expect(state.approve).toHaveBeenCalledWith({
      applicationId: "application",
      accept: true,
      comment: "Panel decision draft",
      expectedUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      completion: {
        completedAt: new Date("2026-09-01T02:00:00Z"),
        durationMin: 45,
        attendedTutorIds: ["chair"],
      },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.fetchTotal).toHaveBeenCalledExactlyOnceWith(undefined, {
    staleTime: 0,
  });
  expect(state.refreshInterviews).toHaveBeenCalledOnce();
  expect(state.refreshRoute).toHaveBeenCalledOnce();
  expect(state.refreshNotifications).toHaveBeenCalledOnce();
  expect(state.refreshUnread).toHaveBeenCalledOnce();
});

it.each(["hours", "notifications", "unread"])(
  "recovers a failed %s read without repeating an accepted approval",
  async (failedRead) => {
    const read =
      failedRead === "hours"
        ? state.fetchTotal
        : failedRead === "notifications"
          ? state.refreshNotifications
          : state.refreshUnread;
    read.mockRejectedValueOnce(new Error("Read offline"));
    render(element());
    fireEvent.change(
      screen.getByLabelText(
        messages.tutor.interviews.decisionCommentPlaceholder,
      ),
      {
        target: { value: "Panel decision draft" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.interviews.approve }),
    );
    fireEvent.change(
      screen.getByLabelText(messages.workflows.interviewComplete),
      {
        target: { value: "2026-09-01T10:00" },
      },
    );
    fireEvent.change(screen.getByLabelText(messages.workflows.duration), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByLabelText("Chair"));
    fireEvent.click(
      screen.getByRole("button", { name: messages.interviewApproval.review }),
    );
    fireEvent.click(
      within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", {
        name: messages.interviewApproval.confirm,
      }),
    );
    await screen.findByText(messages.actionReview.refreshFailed);
    expect(state.approve).toHaveBeenCalledOnce();
    expect(state.refreshRoute).toHaveBeenCalledTimes(
      failedRead === "hours" ? 0 : 1,
    );
    fireEvent.click(
      screen.getByRole("button", { name: messages.actionReview.retry }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.fetchTotal).toHaveBeenCalledTimes(2);
    expect(state.refreshInterviews).toHaveBeenCalledTimes(2);
    expect(state.refreshRoute).toHaveBeenCalledTimes(
      failedRead === "hours" ? 1 : 2,
    );
    expect(state.refreshNotifications).toHaveBeenCalledTimes(2);
    expect(state.refreshUnread).toHaveBeenCalledTimes(2);
    expect(state.approve).toHaveBeenCalledOnce();
  },
);
it("retains failed decision drafts and distinguishes queued approval from applied success", () => {
  const view = render(element());
  fireEvent.change(
    screen.getByLabelText(messages.tutor.interviews.decisionCommentPlaceholder),
    { target: { value: "Keep this evidence" } },
  );
  state.error = "Record changed. Review the current evidence.";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toContain(state.error);
  expect(
    screen.getByLabelText<HTMLInputElement>(
      messages.tutor.interviews.decisionCommentPlaceholder,
    ).value,
  ).toBe("Keep this evidence");
  state.error = "";
  state.queued = true;
  view.rerender(element());
  expect(screen.getByRole("status").textContent).toBe(
    messages.approvals.queuedBody,
  );
  expect(screen.queryByText(messages.tutor.interviews.saved)).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.interviews.approve,
    }).disabled,
  ).toBe(true);
});
it("only the chair gets final decision controls", () => {
  state.isHead = false;
  render(element());
  expect(
    screen.queryByLabelText(
      messages.tutor.interviews.decisionCommentPlaceholder,
    ),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.tutor.interviews.approve }),
  ).toBeNull();
  expect(
    screen.getByLabelText(messages.tutor.interviews.voteCommentPlaceholder),
  ).toBeTruthy();
});

it.each([
  { accepts: 0, rejects: 0 },
  { accepts: 0, rejects: 1 },
])(
  "blocks approval before all votes or against the majority: %j",
  ({ accepts, rejects }) => {
    state.accepts = accepts;
    state.rejects = rejects;
    render(element());
    fireEvent.change(
      screen.getByLabelText(
        messages.tutor.interviews.decisionCommentPlaceholder,
      ),
      { target: { value: "Reviewed" } },
    );
    const approve = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.interviews.approve,
    });
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.approve).not.toHaveBeenCalled();
  },
);

it("does not silently adopt a refreshed application version and preserves drafts when explicit reload fails", async () => {
  const view = render(element());
  const input = screen.getByLabelText<HTMLInputElement>(
    messages.tutor.interviews.decisionCommentPlaceholder,
  );
  fireEvent.change(input, { target: { value: "Old reviewed evidence" } });
  state.version = new Date("2026-10-02T00:00:00Z");
  state.error = "Application changed";
  view.rerender(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.interviews.approve }),
  );
  fireEvent.change(
    screen.getByLabelText(messages.workflows.interviewComplete),
    { target: { value: "2026-09-01T10:00" } },
  );
  fireEvent.change(screen.getByLabelText(messages.workflows.duration), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByLabelText("Chair"));
  state.approve.mockRejectedValueOnce(new Error("Application changed"));
  fireEvent.click(
    screen.getByRole("button", { name: messages.interviewApproval.review }),
  );
  fireEvent.click(
    within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", {
      name: messages.interviewApproval.confirm,
    }),
  );
  await waitFor(() =>
    expect(state.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getAllByText("Application changed").length).toBeGreaterThan(
      0,
    ),
  );
  fireEvent.click(
    within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", {
      name: messages.actionReview.cancel,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.common.cancel,
    }),
  );
  state.fetch.mockRejectedValueOnce(new Error("Reload offline"));
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.tasks.reloadDecision }),
  );
  await screen.findByText("Reload offline");
  expect(input.value).toBe("Old reviewed evidence");
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.tasks.reloadDecision }),
  );
  await waitFor(() => expect(input.value).toBe(""));
  expect(state.reset).toHaveBeenCalledOnce();
});

it("cancels vote and final-decision drafts without writing", () => {
  render(element());
  const vote = screen.getByLabelText<HTMLInputElement>(
    messages.tutor.interviews.voteCommentPlaceholder,
  );
  const decision = screen.getByLabelText<HTMLInputElement>(
    messages.tutor.interviews.decisionCommentPlaceholder,
  );
  fireEvent.change(vote, { target: { value: "Unsaved vote evidence" } });
  fireEvent.change(decision, { target: { value: "Unsaved final decision" } });
  const cancels = screen.getAllByRole("button", {
    name: messages.common.cancel,
  });
  fireEvent.click(cancels[1]!);
  fireEvent.click(cancels[2]!);
  expect(vote.value).toBe("");
  expect(decision.value).toBe("");
  expect(state.vote).not.toHaveBeenCalled();
  expect(state.decide).not.toHaveBeenCalled();
});
