/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SuperJSON from "superjson";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ManagementActions } from "./management-actions";

const mocks = vi.hoisted(() => ({
  params: "",
  list: vi.fn(),
  cancel: vi.fn(),
  decide: vi.fn(),
  refetch: vi.fn(),
  requesters: vi.fn(),
  replace: vi.fn(),
  decisionState: {},
}));
// Dialog internals have their own tests; these doubles verify that this panel
// preserves the staged review flow and only forwards fresh reviewer tickets.
vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    children,
    onConfirm,
    onCancel,
  }: {
    children: React.ReactNode;
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
  }) => (
    <div role="dialog" aria-label="Consequence confirmation">
      {children}
      <button onClick={() => onConfirm("fresh-review-ticket")}>
        Confirm consequences
      </button>
      <button onClick={onCancel}>Cancel confirmation</button>
    </div>
  ),
}));
vi.mock("./assignment-confirmation", () => ({
  AssignmentConfirmation: ({
    onConfirm,
  }: {
    onConfirm: (ticket: string) => void;
  }) => (
    <div role="dialog" aria-label="Qualification confirmation">
      <button onClick={() => onConfirm("fresh-qualification-ticket")}>
        Confirm qualifications
      </button>
    </div>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.params),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    approval: {
      list: { useQuery: mocks.list },
      requesters: { useQuery: mocks.requesters },
      decide: {
        useMutation: (options: { onSuccess: () => void }) => ({
          ...mocks.decisionState,
          mutate: (value: unknown) => {
            mocks.decide(value);
            options.onSuccess();
          },
        }),
      },
      cancel: {
        useMutation: (options: { onSuccess: () => void }) => ({
          mutate: (value: unknown) => {
            mocks.cancel(value);
            options.onSuccess();
          },
        }),
      },
    },
  },
}));

const row = (state = "PENDING") => ({
  id: "request-1",
  operation: "admin.updateRoom",
  requesterId: "coordinator",
  requesterName: "Alex Coordinator",
  state,
  createdAt: new Date("2026-09-12T00:00:00Z"),
  reviewedAt: state === "PENDING" ? null : new Date("2026-09-13T00:00:00Z"),
  reviewerName: state === "CANCELLED" ? null : "Morgan Admin",
  reviewNote:
    state === "PENDING" || state === "CANCELLED" ? null : "Booking checked.",
  payload: SuperJSON.serialize({ id: "room-1", name: "New room name" }),
  targets: { rooms: [{ record: { id: "room-1", name: "Original room" } }] },
});
function queue(
  rows = [row()],
  canReview = false,
  total = rows.length,
  headReviewer = false,
) {
  mocks.list.mockReturnValue({
    data: {
      rows,
      canReview,
      headReviewer,
      total,
      viewerId: canReview && !headReviewer ? "admin" : "coordinator",
      requesters: canReview
        ? [{ id: "coordinator", label: "Alex Coordinator" }]
        : [],
    },
    refetch: mocks.refetch,
  });
}
function view(reviewer = false, locale = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? en : zh}
    >
      <ManagementActions reviewer={reviewer} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = "";
  mocks.decisionState = {};
  mocks.refetch.mockResolvedValue({});
  queue();
});
afterEach(cleanup);

it("shows departure consequences to Head without exposing the revision counter", () => {
  const departure = {
    ...row(),
    operation: "departure.setState",
    payload: SuperJSON.serialize({
      userId: "student",
      action: "RETURN",
      expectedRevision: 3,
      explanation: "Returning next term",
    }),
  };
  queue([departure], true, 1, true);
  render(view(true));
  expect(
    screen.getByRole("heading", {
      name: "Change school departure or viewer access",
    }),
  ).toBeTruthy();
  expect(
    screen.getByText(/This removes departure-based viewer access/),
  ).toBeTruthy();
  expect(screen.queryByText("Expected Revision")).toBeNull();
});

it("requires a nonblank note and explains both proposal outcomes", () => {
  queue([row()], true);
  render(view(true));
  const approve = screen.getByRole("button", {
    name: "Approve and Apply",
  });
  const reject = screen.getByRole("button", {
    name: "Reject with Feedback",
  });
  expect(approve.hasAttribute("disabled")).toBe(true);
  expect(reject.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Your decision note (required)"), {
    target: { value: "   " },
  });
  expect(approve.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(en.approvals.review.decisionHelp)).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Please check the name" },
  });
  fireEvent.click(reject);
  expect(mocks.decide).toHaveBeenCalledWith({
    id: "request-1",
    approve: false,
    note: "Please check the name",
  });
});

it("explains Head-only requests when an Admin cannot decide them", () => {
  queue([{ ...row(), operation: "admin.setMemberships" }], true);
  render(view(true));
  expect(screen.getByText("Only Head can decide this request.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Approve and Apply" }),
  ).toBeNull();
});

it("shows the requested rejection in both the card and fresh consequence confirmation", () => {
  queue(
    [
      {
        ...row(),
        operation: "studentWorkflow.resolveReview",
        payload: SuperJSON.serialize({
          id: "underlying",
          approve: false,
          ticket: "old-ticket",
        }),
      },
    ],
    true,
  );
  render(view(true));
  expect(
    screen.getByText(en.approvals.review.decisionRequestHelp),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Decline the withdrawal as proposed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve and Apply" }));
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole("dialog")).getByText(
      "Reject the underlying request",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm consequences" }));
  expect(mocks.decide).toHaveBeenCalledWith({
    id: "request-1",
    approve: true,
    note: "Decline the withdrawal as proposed",
    ticket: "fresh-review-ticket",
  });
});

it("still requires the assignment qualification step after consequence confirmation", () => {
  queue(
    [
      {
        ...row(),
        operation: "studentWorkflow.assign",
        payload: SuperJSON.serialize({ id: "signup", tutorId: "tutor" }),
      },
    ],
    true,
  );
  render(view(true));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Both checks reviewed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve and Apply" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm consequences" }));
  expect(mocks.decide).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm qualifications" }),
  );
  expect(mocks.decide).toHaveBeenCalledWith({
    id: "request-1",
    approve: true,
    note: "Both checks reviewed",
    ticket: "fresh-review-ticket",
    overrideTicket: "fresh-qualification-ticket",
  });
});

it("keeps a failed decision visible and disables decisions while saving", () => {
  queue([row()], true);
  mocks.decisionState = {
    error: new Error("The affected records changed"),
    isPending: true,
  };
  render(view(true));
  expect(screen.getByRole("alert").textContent).toBe(
    "The affected records changed",
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Reviewed" },
  });
  expect(
    screen
      .getByRole("button", {
        name: "Approve and Apply",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("restores linked filters and makes the banner's full-list URL reset older pages", () => {
  mocks.params = "status=REJECTED&page=1";
  queue([row("REJECTED")], false, 30);
  const rendered = render(view());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "REJECTED", page: 1 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approved" }));
  expect(mocks.replace).toHaveBeenCalledWith(
    "/admin/approvals?status=APPROVED",
    { scroll: false },
  );
  mocks.params = "status=all";
  rendered.rerender(view());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: undefined, page: 0 }),
  );
});

it("shows coordinator history and proposed/affected records without privileged requester queries", () => {
  render(view());
  expect(
    screen.getByRole("heading", { name: "Management Actions" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "All Statuses" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(screen.getByRole("region", { name: "Affected record" })).getByText(
      "Original room",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "What is requested" })).getByText(
      "Original room",
    ),
  ).toBeTruthy();
  expect(screen.getByText("New room name")).toBeTruthy();
  expect(screen.getByText(/Not applied — awaiting/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(mocks.requesters).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw Request" }));
  expect(mocks.cancel).toHaveBeenCalledWith({ id: "request-1" });
  expect(mocks.refetch).toHaveBeenCalled();
});

it("shows reviewer filters and refreshes after a decision", () => {
  queue([row()], true);
  render(view(true));
  expect(
    screen
      .getByRole("button", { name: "Pending Review" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "coordinator" },
  });
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ requesterId: "coordinator", page: 0 }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Checked evidence" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve and Apply" }));
  expect(mocks.decide).toHaveBeenCalledWith({
    id: "request-1",
    approve: true,
    note: "Checked evidence",
  });
  expect(mocks.refetch).toHaveBeenCalled();
});

it("resets pagination/filters for a detail link and returns to the full list", () => {
  queue([row()], true, 26);
  const rendered = render(view(true));
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1 }),
  );
  mocks.params = "request=request-1";
  rendered.rerender(view(true));
  expect(mocks.list).toHaveBeenLastCalledWith({
    requestId: "request-1",
    page: 0,
    requesterId: undefined,
    state: undefined,
  });
  expect(screen.queryByRole("button", { name: "Older" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "All Requests" }).getAttribute("href"),
  ).toBe("/admin/approvals?status=all");
  mocks.params = "status=all";
  rendered.rerender(view(true));
  expect(
    screen
      .getByRole("button", { name: "All Statuses" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it.each(["APPROVED", "REJECTED", "CANCELLED"])(
  "shows %s history, including withdrawal time without a reviewer note",
  (state) => {
    queue([row(state)]);
    render(view());
    expect(
      screen.getByText(
        state === "APPROVED"
          ? /Applied when approved/
          : state === "REJECTED"
            ? /Not applied — rejected/
            : /Not applied — withdrawn/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Withdraw Request" }),
    ).toBeNull();
    expect(
      screen.getByText(
        state === "CANCELLED"
          ? /Withdrawn by Alex Coordinator/
          : /Morgan Admin ·/,
      ),
    ).toBeTruthy();
  },
);

it("renders localized loading, error and unavailable detail states", () => {
  mocks.list.mockReturnValue({ isLoading: true });
  const rendered = render(view(false, "zh"));
  expect(screen.getByRole("status").textContent).toBe("正在加载…");
  mocks.list.mockReturnValue({
    error: new Error("Try again"),
    refetch: mocks.refetch,
  });
  rendered.rerender(view(false, "zh"));
  expect(screen.getByRole("alert").textContent).toBe("Try again");
  mocks.params = "request=missing";
  queue([]);
  rendered.rerender(view(false, "zh"));
  expect(screen.getByText(zh.approvals.missingHint)).toBeTruthy();
});

it.each([true, false])(
  "only shows self-review controls for a live Head: %s",
  (headReviewer) => {
    queue(
      [{ ...row(), requesterId: headReviewer ? "coordinator" : "admin" }],
      true,
      1,
      headReviewer,
    );
    render(view(true));
    expect(
      screen.queryByRole("button", { name: "Approve and Apply" }) !== null,
    ).toBe(headReviewer);
  },
);
