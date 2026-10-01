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
  extraStatuses: [] as string[],
  empty: false,
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
                  requests: (mocks.empty
                    ? []
                    : [mocks.status, ...mocks.extraStatuses]
                  ).map((status, index) => ({
                    id: index === 0 ? "past" : `past-${index}`,
                    requestedSubject: {
                      name: index === 0 ? "History" : `History ${status}`,
                    },
                    type: "HIGHER_LEVEL",
                    status,
                    updatedAt: new Date("2026-09-02T00:00:00Z"),
                    recalledAt:
                      status === "RECALLED"
                        ? new Date("2026-09-03T00:00:00Z")
                        : null,
                    qualificationReason: "Synthetic evidence",
                    interviewAt:
                      status === "INTERVIEW"
                        ? new Date("2026-10-01T00:00:00Z")
                        : null,
                    decisionComment: "More evidence needed",
                    qualificationSnapshot:
                      status === "ACCEPTED"
                        ? [{ name: "Granted subject" }]
                        : [],
                    createdAt: new Date("2026-09-01T00:00:00Z"),
                  })),
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
  mocks.extraStatuses = [];
  mocks.empty = false;
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

const filter = (name: string, count: number) =>
  screen.getByRole("button", { name: `${name} ${count}` });

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
  fireEvent.click(filter("Rejected", 1));
  expect(screen.getByRole("listitem").textContent).toContain("Rejected");
  expect(screen.getByText("Decision: More evidence needed")).toBeTruthy();
});
it("retains history and approved subjects while inactive without exposing submission controls", () => {
  show(false);
  expect(screen.getByText("Science")).toBeTruthy();
  fireEvent.click(filter("Rejected", 1));
  expect(screen.getByRole("listitem").textContent).toContain("Rejected");
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
    fireEvent.click(
      filter(
        status === "ACCEPTED"
          ? "Approved"
          : status === "REJECTED"
            ? "Rejected"
            : "Recalled",
        1,
      ),
    );
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
  expect(screen.getByText(/Request recalled/).getAttribute("role")).toBe(
    "status",
  );
});

it("hides recall for inactive tutors even with an open request", () => {
  mocks.status = "PENDING";
  show(false);
  expect(screen.queryByRole("button", { name: "Recall request" })).toBeNull();
});

it("starts with pending and interview requests and filters every terminal status with counts", () => {
  mocks.status = "PENDING";
  mocks.extraStatuses = ["INTERVIEW", "ACCEPTED", "REJECTED", "RECALLED"];
  show();
  expect(filter("Pending", 2).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText(/^Interview:/)).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: "Recall request" }),
  ).toHaveLength(2);

  for (const [label, status] of [
    ["Approved", "ACCEPTED"],
    ["Rejected", "REJECTED"],
    ["Recalled", "RECALLED"],
  ] as const) {
    fireEvent.click(filter(label, 1));
    expect(filter(label, 1).getAttribute("aria-pressed")).toBe("true");
    expect(filter("Pending", 2).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem").textContent).toContain(
      `History ${status}`,
    );
    expect(screen.queryByRole("button", { name: "Recall request" })).toBeNull();
    if (status === "ACCEPTED")
      expect(
        screen.getByText("Granted at approval: Granted subject"),
      ).toBeTruthy();
  }
});

it.each([true, false])(
  "distinguishes empty history from an empty filter (no history: %s)",
  (empty) => {
    mocks.empty = empty;
    show();
    expect(screen.getByRole("status").textContent).toBe(
      empty
        ? messages.qualificationRequests.empty
        : messages.qualificationRequests.emptyFilter,
    );
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(filter("Pending", 0)).toBeTruthy();
    if (!empty) {
      fireEvent.click(filter("Rejected", 1));
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByRole("listitem")).toBeTruthy();
    }
  },
);

it("collapses only history, preserves its filter, and keeps mutation feedback visible", () => {
  mocks.recallSuccess = true;
  show();
  fireEvent.click(filter("Rejected", 1));
  const collapse = screen.getByRole("button", { name: "Collapse" });
  const content = document.getElementById(
    collapse.getAttribute("aria-controls")!,
  )!;
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(collapse);
  expect(content.hidden).toBe(true);
  expect(
    screen.queryByRole("group", { name: "Filter request history" }),
  ).toBeNull();
  expect(screen.queryByRole("listitem")).toBeNull();
  expect(screen.getByLabelText("Subject and level")).toBeTruthy();
  expect(screen.getByText("Science")).toBeTruthy();
  expect(screen.getByText(/Request recalled/)).toBeTruthy();
  const expand = screen.getByRole("button", { name: "Expand" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(expand);
  expect(content.hidden).toBe(false);
  expect(filter("Rejected", 1).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("listitem")).toBeTruthy();
});

it("updates groups after a recall without resetting selection or collapse state", () => {
  mocks.status = "PENDING";
  const view = show();
  fireEvent.click(filter("Recalled", 0));
  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  mocks.status = "RECALLED";
  view.rerender(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <QualificationRequests active />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByRole("listitem")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(filter("Recalled", 1).getAttribute("aria-pressed")).toBe("true");
  expect(filter("Pending", 0)).toBeTruthy();
  expect(screen.getByText(/^Recalled on/)).toBeTruthy();
});
