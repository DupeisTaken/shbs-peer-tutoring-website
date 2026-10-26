/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import chineseMessages from "../../../messages/zh.json";
import type { AdmissionRecoveryPlan } from "~/lib/recovery";
import { AdmissionRecovery } from "./admission-recovery";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  inspect: vi.fn(),
  receipt: vi.fn(),
  mutation: vi.fn(),
  apply: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    recovery: {
      list: { useQuery: mocks.list },
      inspect: { useQuery: mocks.inspect },
      receipt: { useQuery: mocks.receipt },
      voidAdmission: { useMutation: mocks.mutation },
    },
  },
}));
const initialPlan: AdmissionRecoveryPlan = {
  version: 1,
  actionId: "admission-root",
  applicationId: "source-application",
  fingerprint: "a".repeat(64),
  coverage: "COMPLETE",
  dependentEventCount: 0,
  websiteEligible: true,
  alreadyVoided: false,
  blockers: [],
  warnings: [],
  effects: {
    registrationCodeCount: 1,
    tutorId: "retained-tutor",
    accountIds: ["account-1"],
    pairingIds: [],
    tuteeIds: [],
  },
  events: [
    { id: "event-1", kind: "ADMISSION", createdAt: "2026-10-20T10:00:00.000Z" },
  ],
};
function query(data: unknown) {
  return {
    data,
    isError: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    refetch: mocks.refetch,
    error: null,
  };
}
const wrap = (children: React.ReactNode) => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    {children}
  </NextIntlClientProvider>
);
function mount(
  props: Partial<React.ComponentProps<typeof AdmissionRecovery>> = {},
) {
  return render(
    wrap(
      <AdmissionRecovery
        initialAction="admission-root"
        actorId="current-admin"
        canInspectRecords
        {...props}
      />,
    ),
  );
}
function startConfirmation() {
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "Admission was entered in error" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Void admission and recover effects" }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue(
    query({
      items: [
        {
          id: "admission-root",
          applicationId: "source-application",
          createdAt: new Date("2026-10-20T10:00:00.000Z"),
        },
      ],
      nextCursor: null,
    }),
  );
  mocks.inspect.mockReturnValue(query(initialPlan));
  mocks.receipt.mockReturnValue(
    query({
      id: "durable-receipt",
      actionId: "admission-root",
      actorId: "authorizing-admin",
      reason: "Admission was entered in error",
      channel: "WEBSITE",
      createdAt: new Date("2026-10-21T10:00:00.000Z"),
    }),
  );
  mocks.mutation.mockReturnValue({
    mutateAsync: mocks.apply,
    isPending: false,
  });
  mocks.apply.mockResolvedValue({
    receiptId: "durable-receipt",
    actionId: "admission-root",
    replayed: false,
  });
  let keyCounter = 0;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () =>
      `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`,
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(cleanup);

it.each([0, 1])(
  "allows a reviewed website operation with %i later events and complete coverage",
  (count) => {
    mocks.inspect.mockReturnValue(
      query({ ...initialPlan, dependentEventCount: count }),
    );
    mount();
    const review = screen.getByRole<HTMLButtonElement>("button", {
      name: "Review recovery",
    });
    expect(review.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Recovery reason"), {
      target: { value: "Valid reason" },
    });
    fireEvent.click(review);
    expect(
      screen.getByRole("dialog", { name: "Confirm Admission Recovery" }),
    ).toBeTruthy();
    expect(mocks.apply).not.toHaveBeenCalled();
  },
);
it.each([2, 3])(
  "requires CLI for %i events even if stale server eligibility says yes",
  (count) => {
    mocks.inspect.mockReturnValue(
      query({
        ...initialPlan,
        dependentEventCount: count,
        websiteEligible: true,
      }),
    );
    mount();
    expect(
      screen.queryByRole("button", { name: "Review recovery" }),
    ).toBeNull();
    expect(screen.getByText("Operator CLI required")).toBeTruthy();
    expect(
      screen.getByText(
        "npm run recovery -- admission inspect --action-id 'admission-root' --actor-id 'current-admin' --out PLAN.json",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Inspect database records" })
        .getAttribute("href"),
    ).toBe("/admin/database");
  },
);
it("blocks unknown coverage and keeps the missing-evidence explanation", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      coverage: "UNKNOWN",
      blockers: ["Missing captured journal"],
    }),
  );
  mount();
  expect(screen.queryByRole("button", { name: "Review recovery" })).toBeNull();
  expect(screen.getByText("Missing captured journal")).toBeTruthy();
  expect(screen.getByText("Incomplete or unsupported")).toBeTruthy();
});
it("localizes canonical evidence in Chinese while retaining identifiers and unknown diagnostics", () => {
  const warning =
    "Independent tutor admission is preserved; its access and assignments will remain.";
  const blocker = "The application has an independent invalidity decision.";
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      coverage: "UNKNOWN",
      blockers: [
        blocker,
        "Database coverage is incomplete for: User, Pairing",
        "Unsupported dependent event: MANUAL_EDIT.",
        "Future operator diagnostic",
      ],
      warnings: [warning],
    }),
  );
  render(
    <NextIntlClientProvider
      locale="zh"
      timeZone="Asia/Shanghai"
      messages={chineseMessages}
    >
      <AdmissionRecovery
        initialAction="admission-root"
        actorId="current-admin"
      />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByText(chineseMessages.recovery.evidence.invalidity),
  ).toBeTruthy();
  expect(
    screen.getByText(chineseMessages.recovery.evidence.preserveAdmission),
  ).toBeTruthy();
  expect(
    screen.getByText(
      chineseMessages.recovery.evidence.missingCoverage.replace(
        "{tables}",
        "User, Pairing",
      ),
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      chineseMessages.recovery.evidence.unsupportedEvent.replace(
        "{kind}",
        "MANUAL_EDIT",
      ),
    ),
  ).toBeTruthy();
  expect(screen.queryByText(blocker)).toBeNull();
  expect(screen.queryByText(warning)).toBeNull();
  expect(screen.getByText("Future operator diagnostic")).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: chineseMessages.recovery.reviewApply,
    }),
  ).toBeNull();
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("retains the same idempotency key after a failed retry and creates a new intent on reason edit", async () => {
  mocks.apply.mockRejectedValue(new Error("Transport interrupted"));
  mount();
  startConfirmation();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Recovery could not be confirmed",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Void admission and recover effects" }),
  );
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
  expect(mocks.apply.mock.calls[0]?.[0]).toEqual(
    mocks.apply.mock.calls[1]?.[0],
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "A different reviewed reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Void admission and recover effects" }),
  );
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(3));
  expect(
    (mocks.apply.mock.calls[2]?.[0] as { clientKey: string }).clientKey,
  ).not.toBe(
    (mocks.apply.mock.calls[0]?.[0] as { clientKey: string }).clientKey,
  );
});
it("resets the reviewed reason and confirmation when the plan fingerprint changes", () => {
  const view = mount();
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "Old reviewed reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      fingerprint: "b".repeat(64),
      dependentEventCount: 1,
    }),
  );
  view.rerender(
    wrap(
      <AdmissionRecovery initialAction="admission-root" canInspectRecords />,
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Recovery reason",
    }).value,
  ).toBe("");
});
it("shows an immutable receipt link after success and refreshes evidence without resubmitting", async () => {
  mount();
  startConfirmation();
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "Permanent receipt link" }),
    ).toBeTruthy(),
  );
  expect(
    screen
      .getByRole("link", { name: "Permanent receipt link" })
      .getAttribute("href"),
  ).toBe("/admin/recovery?receipt=durable-receipt");
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});
it("distinguishes a queued Coordinator request from an applied recovery", async () => {
  mocks.apply.mockRejectedValue({ data: { approvalId: "pending-proposal" } });
  mount({ coordinator: true, canInspectRecords: false });
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "Request reviewed recovery" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review approval request" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Request Head approval" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "View approval request" }),
    ).toBeTruthy(),
  );
  expect(
    screen.queryByRole("link", { name: "Permanent receipt link" }),
  ).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "no recovery has been applied",
  );
});
it("preserves a committed receipt locator after a read transport failure and hides it after authorization denial", async () => {
  mocks.apply.mockResolvedValue({
    receiptId: "receipt /?&",
    actionId: "admission-root",
    replayed: false,
  });
  mocks.receipt.mockReturnValue({
    ...query(undefined),
    isSuccess: false,
    isError: true,
    error: { data: { code: "INTERNAL_SERVER_ERROR" } },
  });
  const view = mount();
  startConfirmation();
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "Permanent receipt link" }),
    ).toBeTruthy(),
  );
  expect(
    screen
      .getByRole("link", { name: "Permanent receipt link" })
      .getAttribute("href"),
  ).toBe("/admin/recovery?receipt=receipt%20%2F%3F%26");
  expect(screen.queryByText("authorizing-admin")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review recovery" })).toBeNull();
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  mocks.receipt.mockReturnValue({
    ...query(undefined),
    isSuccess: false,
    isError: true,
    error: { data: { code: "FORBIDDEN" } },
  });
  view.rerender(wrap(<AdmissionRecovery initialAction="admission-root" />));
  expect(
    screen.queryByRole("link", { name: "Permanent receipt link" }),
  ).toBeNull();
});
it("hides cached roots, preview, receipt and open confirmation after an authorization failure", () => {
  const view = mount({ initialReceipt: "durable-receipt" });
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "Reviewed reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  mocks.inspect.mockReturnValue({
    ...query(initialPlan),
    isError: true,
    error: { data: { code: "FORBIDDEN" } },
  });
  view.rerender(
    wrap(
      <AdmissionRecovery
        initialAction="admission-root"
        initialReceipt="durable-receipt"
        canInspectRecords
      />,
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("retained-tutor")).toBeNull();
  expect(screen.queryByText("authorizing-admin")).toBeNull();
  expect(screen.queryByLabelText("Captured admission action ID")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});
it("never presents failed preview loading as an empty or safe recovery", () => {
  mocks.inspect.mockReturnValue({ ...query(initialPlan), isError: true });
  mount();
  expect(screen.queryByRole("button", { name: "Review recovery" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
it("keeps a denied read concealed through a later transport failure", () => {
  const view = mount();
  mocks.inspect.mockReturnValue({
    ...query(initialPlan),
    isSuccess: false,
    isError: true,
    error: { data: { code: "FORBIDDEN" } },
  });
  view.rerender(wrap(<AdmissionRecovery initialAction="admission-root" />));
  mocks.inspect.mockReturnValue({
    ...query(initialPlan),
    isSuccess: false,
    isError: true,
    error: { data: { code: "INTERNAL_SERVER_ERROR" } },
  });
  view.rerender(wrap(<AdmissionRecovery initialAction="admission-root" />));
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("retained-tutor")).toBeNull();
});
it("uses the shared pending dialog guard for Escape and cancel", () => {
  const view = mount();
  fireEvent.change(screen.getByLabelText("Recovery reason"), {
    target: { value: "Reviewed reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
  mocks.mutation.mockReturnValue({ mutateAsync: mocks.apply, isPending: true });
  view.rerender(wrap(<AdmissionRecovery initialAction="admission-root" />));
  const dialog = screen.getByRole("dialog");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled,
  ).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true, bubbles: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
});
it("keeps unexpected identifiers as JSON data rather than constructing executable shell text", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      actionId: "unexpected'$(command)",
      dependentEventCount: 2,
    }),
  );
  mount();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Copy CLI inspect command",
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "npm run recovery -- admission inspect --action-id ACTION_ID --actor-id 'current-admin' --out PLAN.json",
    ),
  ).toBeTruthy();
});
it("includes verification-clock restoration count and identities in the consequences review", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      effects: {
        ...initialPlan.effects,
        verificationClockIds: ["survey-clock-1", "survey-clock-2"],
      },
    }),
  );
  mount();
  const label = screen.getByText("Verification clocks to restore");
  expect(label.nextElementSibling?.textContent).toBe(
    "2survey-clock-1, survey-clock-2",
  );
});
it("reviews causal messaging-link removal while preserving message history and independent access", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initialPlan,
      effects: {
        ...initialPlan.effects,
        messageLinkIds: ["student-1:tutor-1", "student-2:tutor-1"],
      },
    }),
  );
  mount();
  const label = screen.getByText("Causal messaging links to remove");
  expect(label.nextElementSibling?.textContent).toBe(
    "2student-1:tutor-1, student-2:tutor-1",
  );
  expect(
    screen.getByText(
      "Only messaging links created by this admission chain are removed. Message history and independent messaging access remain.",
    ),
  ).toBeTruthy();
});
