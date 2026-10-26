/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SuperJSON from "superjson";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ManagementActions } from "./management-actions";
import { SessionViewProvider } from "./session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

const mocks = vi.hoisted(() => ({
  params: "",
  list: vi.fn(),
  cancel: vi.fn(),
  decide: vi.fn(),
  refetch: vi.fn(),
  requesters: vi.fn(),
  replace: vi.fn(),
  decisionState: {},
  invalidateInterviews: vi.fn(),
  invalidateOptions: vi.fn(),
  invalidateApplications: vi.fn(),
  invalidateCodes: vi.fn(),
  reconcileNotices: vi.fn(),
}));
// Dialog internals have their own tests; these doubles verify that this panel
// preserves the staged review flow and only forwards fresh reviewer tickets.
vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    children,
    onConfirm,
    onCancel,
    action,
    target,
    message,
  }: {
    children: React.ReactNode;
    onConfirm: (ticket: string) => void;
    onCancel: () => void;
    action: string;
    target: string;
    message: string;
  }) => (
    <div
      role="dialog"
      aria-label="Consequence confirmation"
      data-action={action}
      data-target={target}
    >
      <p>{message}</p>
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
    notification: { reconcileManagementReviews: { useMutation: () => ({ mutateAsync: mocks.reconcileNotices }) } },
    useUtils: () => ({
      tutor: { myInterviews: { invalidate: mocks.invalidateInterviews } },
      interviewManagement: { options: { invalidate: mocks.invalidateOptions } },
      admin: {
        tutorApplications: { invalidate: mocks.invalidateApplications },
        registrationCodes: { invalidate: mocks.invalidateCodes },
      },
    }),
    approval: {
      list: { useQuery: mocks.list },
      requesters: { useQuery: mocks.requesters },
      decide: {
        useMutation: (options: { onSuccess: () => void }) => ({
          ...mocks.decisionState,
          mutateAsync: async (value: unknown) => {
            mocks.decide(value);
            options.onSuccess();
          },
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
  canDecide: undefined as boolean | undefined,
  reviewerRoles: undefined as string[] | undefined,
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
  isFetching = false,
) {
  const result = {
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
    isFetching,
    isSuccess: true,
  };
  mocks.list.mockReturnValue(result);
  return result;
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
  window.sessionStorage.clear();
  vi.clearAllMocks();
  mocks.params = "";
  mocks.decisionState = {};
  mocks.refetch.mockResolvedValue({});
  mocks.reconcileNotices.mockReset().mockResolvedValue({ pending: 2, created: 1 });
  for (const invalidate of [
    mocks.invalidateInterviews,
    mocks.invalidateOptions,
    mocks.invalidateApplications,
    mocks.invalidateCodes,
  ])
    invalidate.mockResolvedValue(undefined);
  queue();
});
afterEach(cleanup);

it.each([false, true])("lets Admin and Head deliberately reconcile notices without deciding requests (Head=%s)", async (headReviewer) => {
  queue([], true, 0, headReviewer);
  render(view(true));
  expect(mocks.reconcileNotices).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.approvals.reviewerNoticesRefresh }));
  await screen.findByText(en.approvals.reviewerNoticesResult.replace("{created}", "1").replace("{pending}", "2"));
  expect(mocks.reconcileNotices).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();
});

it("conceals notification reconciliation from request-only Coordinators", () => {
  queue([], false);
  render(view(false));
  expect(screen.queryByRole("button", { name: en.approvals.reviewerNoticesRefresh })).toBeNull();
  expect(mocks.reconcileNotices).not.toHaveBeenCalled();
});

it("admits one reconciliation while pending and permits a deliberate retry after failure", async () => {
  let reject!: (failure: Error) => void;
  mocks.reconcileNotices.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  queue([], true);
  render(view(true, "zh"));
  const button = screen.getByRole("button", { name: zh.approvals.reviewerNoticesRefresh });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(mocks.reconcileNotices).toHaveBeenCalledOnce();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: zh.approvals.reviewerNoticesPending }).disabled).toBe(true);
  await act(async () => reject(new Error("Temporary notification failure")));
  expect(screen.getByRole("alert").textContent).toBe("Temporary notification failure");
  fireEvent.click(screen.getByRole("button", { name: zh.approvals.reviewerNoticesRefresh }));
  await screen.findByText(zh.approvals.reviewerNoticesResult.replace("{created}", "1").replace("{pending}", "2"));
  expect(mocks.reconcileNotices).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

// A decision can remove the only row on the last page. The remaining queue must
// stay reachable even when its new total no longer needs a second page.
it.each([25, 0])(
  "preserves filtered previous-page recovery after the queue shrinks to %s",
  (total) => {
    mocks.params = "status=PENDING&page=1&requester=coordinator";
    queue([row()], true, 26);
    const mounted = render(view(true));
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.approvals.previous,
      }).disabled,
    ).toBe(false);
    queue([], true, total);
    mounted.rerender(view(true));
    const previous = screen.getByRole<HTMLButtonElement>("button", {
      name: en.approvals.previous,
    });
    expect(previous.disabled).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: en.approvals.next })
        .disabled,
    ).toBe(true);
    fireEvent.click(previous);
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/admin/approvals?status=PENDING&requester=coordinator",
      { scroll: false },
    );
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 0,
        state: "PENDING",
        requesterId: "coordinator",
      }),
    );
  },
);

it.each([
  [
    "studentWorkflow.headEditSignup",
    { id: "signup", signedTicket: "old-ticket" },
    "SIGNUP_EDIT",
    "signup",
    en.signupEditing.headConsequences,
  ],
  [
    "studentWorkflow.headUnassign",
    { id: "signup", pairingId: "pairing", signedTicket: "old-ticket" },
    "SIGNUP_UNASSIGN",
    "signup:pairing",
    en.signupAppeal.unassignConsequences,
  ],
  [
    "studentWorkflow.resolveSignupAppeal",
    { id: "appeal", approve: false, signedTicket: "old-ticket" },
    "SIGNUP_APPEAL",
    "appeal:false",
    en.signupAppeal.rejectConsequences,
  ],
  [
    "studentWorkflow.resolveSignupAppeal",
    { id: "appeal", approve: true, signedTicket: "old-ticket" },
    "SIGNUP_APPEAL",
    "appeal:true",
    en.signupAppeal.approveConsequences,
  ],
] as const)(
  "reviews %s with its exact target and a fresh reviewer ticket",
  (operation, payload, action, target, consequence) => {
    queue(
      [
        {
          ...row(),
          operation,
          payload: SuperJSON.serialize(payload),
          canDecide: true,
        },
      ],
      true,
      1,
      true,
    );
    render(view(true));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Reviewed immutable proposed changes" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.approvals.approve }));
    const dialog = screen.getByRole("dialog", {
      name: "Consequence confirmation",
    });
    expect(dialog.getAttribute("data-action")).toBe(action);
    expect(dialog.getAttribute("data-target")).toBe(target);
    expect(within(dialog).getByText(consequence)).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm consequences" }),
    );
    expect(mocks.decide).toHaveBeenCalledWith({
      id: "request-1",
      approve: true,
      note: "Reviewed immutable proposed changes",
      ticket: "fresh-review-ticket",
    });
  },
);

it("restores the reviewer list, gives explicit URL criteria precedence, and clears it on access denial", () => {
  const cached = queue([row()], true, 100);
  const key = viewStateKey(
    "head",
    "/admin/approvals",
    "approvals.list.v1",
    "reviewer",
  );
  writeViewState(window.sessionStorage, key, {
    state: "APPROVED",
    page: 2,
    requesterId: "coordinator",
    privateNote: "do not copy",
  });
  const tree = () => (
    <SessionViewProvider identity="head" pathname="/admin/approvals" verified>
      {view(true)}
    </SessionViewProvider>
  );
  const panel = render(tree());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      state: "APPROVED",
      page: 2,
      requesterId: "coordinator",
    }),
  );
  expect(JSON.stringify(window.sessionStorage)).not.toContain("do not copy");
  mocks.params = "status=all";
  panel.rerender(tree());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      state: undefined,
      page: 0,
      requesterId: undefined,
    }),
  );
  mocks.params = "status=PENDING&page=1&requester=coordinator";
  panel.rerender(tree());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      state: "PENDING",
      page: 1,
      requesterId: "coordinator",
    }),
  );
  mocks.list.mockReturnValue({
    ...cached,
    error: { message: "Denied", data: { code: "FORBIDDEN" } },
    isSuccess: false,
  });
  panel.rerender(tree());
  expect(screen.getByRole("alert").textContent).toBe("Denied");
  expect(screen.queryByText("Alex Coordinator")).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBeNull();
  mocks.list.mockReturnValue({
    ...cached,
    error: { message: "Offline" },
    isSuccess: false,
  });
  panel.rerender(tree());
  expect(screen.queryByText("Alex Coordinator")).toBeNull();
});

it("rejects saved requesters removed from the current authorized catalogue", () => {
  queue([row()], true);
  writeViewState(
    window.sessionStorage,
    viewStateKey("head", "/admin/approvals", "approvals.list.v1", "reviewer"),
    { state: "APPROVED", page: 1, requesterId: "removed-user" },
  );
  render(
    <SessionViewProvider identity="head" pathname="/admin/approvals" verified>
      {view(true)}
    </SessionViewProvider>,
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: en.approvals.requester,
    }).value,
  ).toBe("");
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ requesterId: undefined }),
  );
});

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
  queue([{ ...row(), operation: "admin.refresh", reviewerRoles: ["HEAD"], canDecide: false }], true);
  render(view(true));
  expect(screen.getByText(en.approvals.review.headRequired)).toBeTruthy();
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

it("aligns compact filter controls while preserving filter resets and pending refresh behavior", () => {
  mocks.params = "status=REJECTED&page=2";
  queue([row("REJECTED")], true, 80);
  const rendered = render(view(true));
  const requester = screen.getByRole("combobox", {
    name: en.approvals.requester,
  });
  const refresh = screen.getByRole<HTMLButtonElement>("button", {
    name: en.approvals.refresh,
  });
  const statuses = within(
    screen.getByRole("group", { name: en.approvals.status }),
  );
  for (const control of [
    requester,
    refresh,
    ...statuses.getAllByRole("button"),
  ]) {
    expect(control.classList.contains("control-compact")).toBe(true);
  }
  // Inputs have later base CSS rules: these utilities retain the 32px desktop
  // baseline while control-compact keeps the 44px mobile minimum.
  expect(requester.classList.contains("lg:min-h-8")).toBe(true);
  expect(requester.classList.contains("lg:py-1")).toBe(true);
  fireEvent.change(requester, { target: { value: "coordinator" } });
  expect(mocks.replace).toHaveBeenLastCalledWith(
    "/admin/approvals?status=REJECTED&requester=coordinator",
    { scroll: false },
  );
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      state: "REJECTED",
      requesterId: "coordinator",
      page: 0,
    }),
  );
  fireEvent.click(
    statuses.getByRole("button", { name: en.approvals.states.APPROVED }),
  );
  expect(mocks.replace).toHaveBeenLastCalledWith(
    "/admin/approvals?status=APPROVED&requester=coordinator",
    { scroll: false },
  );
  fireEvent.click(refresh);
  expect(mocks.refetch).toHaveBeenCalledOnce();
  queue([row("APPROVED")], true, 80, false, true);
  rendered.rerender(view(true));
  expect(refresh.disabled).toBe(true);
  fireEvent.click(refresh);
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(
    statuses
      .getByRole("button", { name: en.approvals.states.APPROVED })
      .getAttribute("aria-pressed"),
  ).toBe("true");
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

it("honors current server review authority for a payload-dependent reversal", () => {
  queue(
    [
      {
        ...row(),
        operation: "messaging.moderate",
        canDecide: false,
        reviewerRoles: ["ADMIN", "HEAD"],
        payload: SuperJSON.serialize({
          messageId: "message",
          hide: false,
          reason: "Restore checked content",
        }),
      },
    ],
    true,
  );
  render(view(true));
  expect(screen.getByText(en.approvals.review.waitingReviewer)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.approvals.approve }),
  ).toBeNull();
});
it("requires the current reviewer's fresh password for legacy management role requests", () => {
  queue(
    [
      {
        ...row(),
        operation: "admin.setUserRole",
        canDecide: true,
        reviewerRoles: ["ADMIN", "HEAD"],
        payload: SuperJSON.serialize({ userId: "account", role: "ADMIN" }),
      },
    ],
    true,
    1,
    false,
  );
  render(view(true));
  fireEvent.change(
    screen.getByRole("textbox", { name: en.approvals.review.noteRequired }),
    { target: { value: "Authority verified" } },
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.approvals.approve,
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(en.approvals.review.confirmPassword), {
    target: { value: "Synthetic-reviewer-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.approvals.approve }));
  expect(mocks.decide).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "request-1",
      approve: true,
      confirmPassword: "Synthetic-reviewer-password",
    }),
  );
});

it.each([
  "interviewManagement.complete",
  "tutor.decideInterview",
  "admin.assignInterviewers",
])(
  "refreshes shared tutor evidence and task counts after applied %s review",
  async (operation) => {
    queue(
      [
        {
          ...row(),
          operation,
          canDecide: true,
          payload: SuperJSON.serialize({
            applicationId: "candidate",
            durationMin: 45,
            completedAt: new Date("2026-10-01"),
            attendedTutorIds: ["panel"],
            reason: "Verified",
          }),
        },
      ],
      true,
      1,
      true,
    );
    render(view(true));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Reviewed immutable interview evidence" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.approvals.approve }));
    const confirm = screen.queryByRole("button", {
      name: "Confirm consequences",
    });
    if (confirm) fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.invalidateInterviews).toHaveBeenCalledOnce(),
    );
    expect(mocks.invalidateOptions).toHaveBeenCalledOnce();
    expect(mocks.invalidateApplications).toHaveBeenCalledOnce();
    expect(mocks.invalidateCodes).toHaveBeenCalledOnce();
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  },
);
