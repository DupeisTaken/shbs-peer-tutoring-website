// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { QualificationRequests } from "./qualification-requests";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  resetSubmit: vi.fn(),
  retry: vi.fn(),
  error: false,
  loading: false,
  status: "REJECTED",
  recall: vi.fn(),
  recallPending: false,
  recallError: "",
  recallSuccess: false,
  invalidate: vi.fn(),
  recallOptions: {
    onSuccess: async (): Promise<unknown> => undefined,
    onError: async (): Promise<unknown> => undefined,
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      qualificationApplication: { mine: { invalidate: mocks.invalidate } },
      admin: { tutorApplications: { invalidate: mocks.invalidate } },
      tutor: { myInterviews: { invalidate: mocks.invalidate } },
      interviewManagement: { options: { invalidate: mocks.invalidate } },
    }),
    qualificationApplication: {
      submit: {
        useMutation: () => ({ mutate: mocks.submit, reset: mocks.resetSubmit }),
      },
      recall: {
        useMutation: (options: typeof mocks.recallOptions) => {
          mocks.recallOptions = options;
          return {
            mutate: mocks.recall,
            isPending: mocks.recallPending,
            error: mocks.recallError ? { message: mocks.recallError } : null,
            isSuccess: mocks.recallSuccess,
            variables: { id: "past" },
          };
        },
      },
      mine: {
        useQuery: () => ({
          isLoading: mocks.loading,
          error: mocks.error ? { message: "Synthetic loading error" } : null,
          refetch: mocks.retry,
          data:
            mocks.loading || mocks.error
              ? undefined
              : {
                  approved: [{ id: "science", name: "Science" }],
                  options: [
                    {
                      id: "history",
                      name: "AP History",
                      type: "ADDITIONAL_SUBJECT",
                    },
                  ],
                  requests: [
                    {
                      id: "past",
                      requestedSubject: { name: "History" },
                      type: "HIGHER_LEVEL",
                      status: mocks.status,
                      updatedAt: new Date("2026-09-02T00:00:00Z"),
                      recalledAt:
                        mocks.status === "RECALLED"
                          ? new Date("2026-09-03T00:00:00Z")
                          : null,
                      qualificationReason: "Synthetic evidence",
                      decisionComment: "More evidence needed",
                      qualificationSnapshot: [],
                      createdAt: new Date("2026-09-01T00:00:00Z"),
                    },
                  ],
                },
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = false;
  mocks.loading = false;
  mocks.status = "REJECTED";
  mocks.recallPending = false;
  mocks.recallError = "";
  mocks.recallSuccess = false;
});
afterEach(cleanup);
const show = (active = true) =>
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <QualificationRequests active={active} />
    </NextIntlClientProvider>,
  );

it("submits one chosen subject and evidence without any caller-supplied tutor identity", () => {
  show();
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Request qualification",
  });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Subject and level"), {
    target: { value: "history" },
  });
  fireEvent.change(screen.getByLabelText("Explain your qualifications"), {
    target: { value: "Completed the course" },
  });
  fireEvent.click(button);
  expect(mocks.submit).toHaveBeenCalledWith({
    subjectId: "history",
    reason: "Completed the course",
  });
  expect(screen.getByText("Rejected")).toBeTruthy();
  expect(screen.getByText("Decision: More evidence needed")).toBeTruthy();
});
it("retains history and approved subjects while inactive without exposing submission controls", () => {
  show(false);
  expect(screen.getByText("Science")).toBeTruthy();
  expect(screen.getByText("Rejected")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Request qualification" }),
  ).toBeNull();
});
it("shows a loading state and a retry for a failed query", () => {
  mocks.loading = true;
  const view = show();
  expect(screen.getByRole("status").textContent).toBe(
    "Loading qualifications…",
  );
  view.unmount();
  mocks.loading = false;
  mocks.error = true;
  show();
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic loading error",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});

it.each(["PENDING", "INTERVIEW"])(
  "confirms recall of %s and submits the displayed version",
  async (status) => {
    mocks.status = status;
    show();
    fireEvent.click(screen.getByRole("button", { name: "Recall request" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Withdraw your request for History?");
    expect(mocks.recall).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep request" }),
    );
    expect(mocks.recall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recall request" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Recall request",
      }),
    );
    await waitFor(() =>
      expect(mocks.recall).toHaveBeenCalledExactlyOnceWith({
        id: "past",
        expectedUpdatedAt: new Date("2026-09-02T00:00:00Z"),
      }),
    );
    await mocks.recallOptions.onSuccess?.();
    expect(mocks.resetSubmit).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  },
);

it.each(["ACCEPTED", "REJECTED", "RECALLED"])(
  "keeps %s requests read-only",
  (status) => {
    mocks.status = status;
    show();
    expect(screen.queryByRole("button", { name: "Recall request" })).toBeNull();
    if (status === "RECALLED")
      expect(screen.getByText(/^Recalled on/)).toBeTruthy();
  },
);

it("prevents duplicate clicks and reports mutation failure/success", async () => {
  mocks.status = "PENDING";
  mocks.recallPending = true;
  const view = show();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Recalling…" })
      .disabled,
  ).toBe(true);
  view.unmount();
  mocks.recallPending = false;
  mocks.recallError = "This request changed. Refresh and try again.";
  const failed = show();
  expect(screen.getByRole("alert").textContent).toBe(mocks.recallError);
  await mocks.recallOptions.onError?.();
  expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  failed.unmount();
  mocks.recallError = "";
  mocks.recallSuccess = true;
  mocks.status = "RECALLED";
  show();
  expect(screen.getByRole("status").textContent).toContain("Request recalled");
});

it("hides recall for inactive tutors even with an open request", () => {
  mocks.status = "PENDING";
  show(false);
  expect(screen.queryByRole("button", { name: "Recall request" })).toBeNull();
});
