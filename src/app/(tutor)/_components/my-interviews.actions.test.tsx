// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { MyInterviews } from "./my-interviews";
const state = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: unknown) => false),
  decide: vi.fn(),
  vote: vi.fn(),
  schedule: vi.fn(),
  queued: false,
  error: "",
  isHead: true,
  pending: false,
  success: false,
  version: new Date("2026-10-01T00:00:00Z"),
  fetch: vi.fn(async () => [
    { id: "application", updatedAt: new Date("2026-10-02T00:00:00Z") },
  ]),
  reset: vi.fn(),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: { myInterviews: { invalidate: vi.fn(), fetch: state.fetch } },
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
              type: "INITIAL",
              status: "INTERVIEW",
              interviewAt: null,
              subjectIntents: [],
              interviewers: [{ tutor: { englishName: "Chair" }, isHead: true }],
              votes: [],
              myVote: null,
              tally: { accepts: 1, rejects: 0 },
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
it("names the applicant, cancels without writes and submits the reviewed version", async () => {
  render(element());
  fireEvent.change(
    screen.getByLabelText(messages.tutor.interviews.decisionCommentPlaceholder),
    { target: { value: "Panel decision draft" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.interviews.approve }),
  );
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(
    (state.confirm.mock.calls[0]?.[0] as { message: string }).message,
  ).toContain("Sample Applicant");
  expect(state.decide).not.toHaveBeenCalled();
  state.confirm.mockResolvedValue(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.interviews.approve }),
  );
  await waitFor(() =>
    expect(state.decide).toHaveBeenCalledWith({
      applicationId: "application",
      accept: true,
      comment: "Panel decision draft",
      expectedUpdatedAt: new Date("2026-10-01T00:00:00Z"),
    }),
  );
});
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

it("does not silently adopt a refreshed application version and preserves drafts when explicit reload fails", async () => {
  const view = render(element());
  const input = screen.getByLabelText<HTMLInputElement>(
    messages.tutor.interviews.decisionCommentPlaceholder,
  );
  fireEvent.change(input, { target: { value: "Old reviewed evidence" } });
  state.version = new Date("2026-10-02T00:00:00Z");
  state.error = "Application changed";
  view.rerender(element());
  state.confirm.mockResolvedValue(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.interviews.approve }),
  );
  await waitFor(() =>
    expect(state.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: new Date("2026-10-01T00:00:00Z"),
      }),
    ),
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
