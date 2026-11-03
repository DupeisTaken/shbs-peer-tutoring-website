/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import type { CheckpointPlan } from "~/server/recovery/checkpoint-contract";
import {
  CheckpointRecovery,
  RecoveryOwnerFollowUp,
} from "./checkpoint-recovery";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  inspect: vi.fn(),
  receipt: vi.fn(),
  capture: vi.fn(),
  restore:
    vi.fn<
      (input: {
        checkpointId: string;
        expectedFingerprint: string;
        clientKey: string;
        reason: string;
      }) => Promise<{ receiptId: string }>
    >(),
  refetch: vi.fn(),
  restoreMutation: vi.fn(),
  invalidateList: vi.fn(),
  invalidateInspect: vi.fn(),
  invalidateReceipt: vi.fn(),
  fetchInspect: vi.fn(),
  fetchReceipt: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      recovery: {
        checkpoints: { invalidate: mocks.invalidateList },
        inspectCheckpoint: {
          invalidate: mocks.invalidateInspect,
          fetch: mocks.fetchInspect,
        },
        receipt: {
          invalidate: mocks.invalidateReceipt,
          fetch: mocks.fetchReceipt,
        },
      },
    }),
    recovery: {
      checkpoints: { useQuery: mocks.list },
      inspectCheckpoint: { useQuery: mocks.inspect },
      receipt: { useQuery: mocks.receipt },
      captureCheckpoint: {
        useMutation: () => ({ mutateAsync: mocks.capture, isPending: false }),
      },
      restoreCheckpoint: { useMutation: mocks.restoreMutation },
    },
  },
}));
const initial: CheckpointPlan = {
  version: 1,
  checkpointId: "checkpoint",
  actionId: "action",
  adapter: "PARTICIPANT_TUTOR",
  sourceEntity: "Tutor",
  sourceId: "synthetic-tutor",
  createdAt: new Date("2030-01-01T00:00:00Z"),
  fingerprint: "a".repeat(64),
  coverage: "COMPLETE",
  dependentEventCount: 1,
  websiteEligible: true,
  blockers: [],
  warnings: [],
  effects: ["Synthetic status correction"],
  preserved: ["Synthetic original evidence"],
  chronology: [],
  receiptId: null,
  directRoles: ["ADMIN", "HEAD"],
  delivery: {
    version: 1,
    coverage: "COMPLETE",
    fingerprint: "d".repeat(64),
    blockers: [],
    effects: [],
  },
};
const query = (data: unknown) => ({
  data,
  isLoading: false,
  isFetching: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: mocks.refetch,
});
let queryClient: QueryClient;
let authority = "synthetic-authority-v1";
function recoveryTree(
  locale = "en",
  role: "ADMIN" | "HEAD" | "COORDINATOR" = "ADMIN",
  initialReceipt = "",
  initialCheckpoint = "checkpoint",
) {
  return (
    <QueryClientProvider key={authority} client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={locale === "zh" ? zh : en}
      >
        <CheckpointRecovery
          role={role}
          initialCheckpoint={initialCheckpoint}
          initialReceipt={initialReceipt}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function mount(
  locale = "en",
  role: "ADMIN" | "HEAD" | "COORDINATOR" = "ADMIN",
  initialReceipt = "",
  initialCheckpoint = "checkpoint",
) {
  return render(recoveryTree(locale, role, initialReceipt, initialCheckpoint));
}
function enterReason() {
  fireEvent.change(screen.getByLabelText("Restoration reason"), {
    target: { value: "Synthetic reviewed restoration" },
  });
}
function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Review restoration" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Restore reviewed checkpoint" }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  authority = "synthetic-authority-v1";
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  for (const mock of [
    mocks.invalidateList,
    mocks.invalidateInspect,
    mocks.invalidateReceipt,
    mocks.fetchInspect,
    mocks.fetchReceipt,
  ])
    mock.mockResolvedValue(undefined);
  mocks.list.mockReturnValue(query({ items: [], nextCursor: null }));
  mocks.inspect.mockReturnValue(query(initial));
  mocks.receipt.mockReturnValue(query(undefined));
  mocks.refetch.mockResolvedValue({ data: initial });
  mocks.restore.mockResolvedValue({ receiptId: "receipt" });
  mocks.capture.mockResolvedValue({
    checkpointId: "new-checkpoint",
    actionId: "new-action",
  });
  mocks.restoreMutation.mockReturnValue({
    mutateAsync: mocks.restore,
    isPending: false,
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

it.each(["en", "zh"])(
  "renders localized checkpoint scope, review and current evidence (%s)",
  (locale) => {
    mount(locale);
    expect(
      screen.getByRole("heading", {
        name:
          locale === "zh"
            ? "参与状态与工作流程检查点"
            : "Participant and Workflow Checkpoints",
      }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        locale === "zh" ? "来源记录编号" : "Source record ID",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Synthetic original evidence")).toBeTruthy();
  },
);

it("cancel performs no write and a failed attempt retains reason and its exact retry key", async () => {
  mocks.restore.mockRejectedValueOnce(new Error("synthetic failure"));
  mount();
  enterReason();
  fireEvent.click(screen.getByRole("button", { name: "Review restoration" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.restore).not.toHaveBeenCalled();
  confirm();
  await screen.findByText(
    "Restoration was not confirmed. Your reason and retry intent are retained.",
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("Synthetic reviewed restoration");
  confirm();
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(2));
  expect(mocks.restore.mock.calls[1]?.[0]).toEqual(
    mocks.restore.mock.calls[0]?.[0],
  );
});

it("retains a draft across changed previews and requires explicit review before using a new fingerprint", async () => {
  const view = mount();
  enterReason();
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      fingerprint: "b".repeat(64),
      effects: ["New synthetic consequence"],
    }),
  );
  view.rerender(recoveryTree());
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("Synthetic reviewed restoration");
  fireEvent.click(
    screen.getByRole("button", { name: "Review updated consequences" }),
  );
  expect(await screen.findByText("New synthetic consequence")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", false);
});

it("refreshes a rejected stale preview without adopting it or replaying the write", async () => {
  mocks.restore.mockRejectedValueOnce({ data: { code: "CONFLICT" } });
  const view = mount();
  enterReason();
  confirm();
  await screen.findByText(
    "Restoration was not confirmed. Your reason and retry intent are retained.",
  );
  expect(mocks.invalidateInspect).toHaveBeenCalledWith({
    checkpointId: "checkpoint",
  });
  expect(mocks.restore).toHaveBeenCalledTimes(1);

  const updated = {
    ...initial,
    fingerprint: "b".repeat(64),
    effects: ["New synthetic consequence"],
  };
  mocks.inspect.mockReturnValue(query(updated));
  view.rerender(recoveryTree());
  expect(screen.queryByText("New synthetic consequence")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("Synthetic reviewed restoration");

  fireEvent.click(
    screen.getByRole("button", { name: "Review updated consequences" }),
  );
  expect(await screen.findByText("New synthetic consequence")).toBeTruthy();
  confirm();
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(2));
  expect(mocks.restore.mock.calls[1]?.[0]).toMatchObject({
    checkpointId: initial.checkpointId,
    expectedFingerprint: updated.fingerprint,
    reason: "Synthetic reviewed restoration",
  });
  expect(mocks.restore.mock.calls[1]?.[0].clientKey).not.toBe(
    mocks.restore.mock.calls[0]?.[0].clientKey,
  );
  await screen.findByText(
    "Restoration saved. Use the receipt below to recover its result without repeating the write.",
  );
});

it("explicitly re-inspects the current checkpoint without issuing a write", () => {
  mount();
  enterReason();
  fireEvent.click(screen.getByRole("button", { name: "Inspect checkpoint" }));
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("Synthetic reviewed restoration");
});

it.each(["capture", "restore"] as const)(
  "conceals all cached evidence after %s denial until every private scope passes a fresh read",
  async (operation) => {
    mocks[operation].mockRejectedValueOnce({ data: { code: "FORBIDDEN" } });
    mocks.list.mockReturnValue(
      query({
        items: [
          {
            ...initial,
            id: "saved-checkpoint",
            sourceId: "Private saved source",
          },
        ],
        nextCursor: null,
      }),
    );
    mocks.receipt.mockReturnValue(
      query({
        reason: "Private accepted receipt",
        createdAt: initial.createdAt,
        result: null,
        deliveries: null,
      }),
    );
    mount("en", "ADMIN", "accepted-receipt");
    enterReason();
    expect(screen.getByText("Private accepted receipt")).toBeTruthy();
    if (operation === "restore") confirm();
    else {
      fireEvent.change(screen.getByLabelText("Source record ID"), {
        target: { value: "capture-source" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save checkpoint" }));
    }
    const denial =
      "Recovery access is no longer available. Private records have been hidden.";
    await screen.findByText(denial);
    for (const text of [
      "Synthetic status correction",
      "Synthetic original evidence",
      "Tutor: Private saved source",
      "Private accepted receipt",
    ])
      expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByLabelText("Restoration reason")).toBeNull();

    // Existing successful query objects cannot release the mutation denial,
    // and success on the list/preview cannot substitute for the receipt read.
    mocks.refetch
      .mockResolvedValueOnce({ isSuccess: true })
      .mockResolvedValueOnce({ isSuccess: true })
      .mockResolvedValueOnce({ isSuccess: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry read" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry read" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(mocks.refetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText(denial)).toBeTruthy();
    expect(screen.queryByText("Private accepted receipt")).toBeNull();
    expect(mocks[operation]).toHaveBeenCalledTimes(1);

    mocks.refetch.mockResolvedValue({ isSuccess: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry read" }));
    await screen.findByText("Synthetic status correction");
    expect(screen.getByText("Private accepted receipt")).toBeTruthy();
    expect(mocks.refetch).toHaveBeenCalledTimes(6);
    expect(mocks[operation]).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
    ).toBe("Synthetic reviewed restoration");
    if (operation === "restore") {
      confirm();
      await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(2));
      expect(mocks.restore.mock.calls[1]?.[0]).toEqual(
        mocks.restore.mock.calls[0]?.[0],
      );
      await screen.findByText(
        "Restoration saved. Use the receipt below to recover its result without repeating the write.",
      );
    } else
      expect(
        screen.getByLabelText<HTMLInputElement>("Source record ID").value,
      ).toBe("capture-source");
  },
);

it("enforces the website event bound in the UI while retaining CLI-only inspection", () => {
  mocks.inspect.mockReturnValue(
    query({ ...initial, dependentEventCount: 2, websiteEligible: false }),
  );
  mount();
  enterReason();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(screen.getByText("Synthetic status correction")).toBeTruthy();
  expect(screen.getByText(en.checkpointRecovery.cliOnly)).toBeTruthy();
  expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
});

it.each(["en", "zh"])(
  "shows a recorded attendance receipt without suggesting another CLI restoration (%s)",
  (locale) => {
    const labels =
      locale === "zh" ? zh.checkpointRecovery : en.checkpointRecovery;
    mocks.inspect.mockReturnValue(
      query({
        ...initial,
        adapter: "ATTENDANCE",
        sourceEntity: "Session",
        sourceId: "synthetic-session",
        websiteEligible: false,
        dependentEventCount: 2,
        receiptId: "saved-receipt",
        blockers: ["Synthetic post-restoration evidence detail"],
      }),
    );
    mount(locale, "ADMIN", "saved-receipt");
    const website = screen.getByText(labels.website).parentElement!;
    expect(within(website).getByText(labels.recorded)).toBeTruthy();
    expect(screen.queryByText(labels.cliOnly)).toBeNull();
    expect(
      screen.getByText("Synthetic post-restoration evidence detail"),
    ).toBeTruthy();
    expect(screen.getByText("saved-receipt")).toBeTruthy();
    expect(screen.getByLabelText(labels.reason)).toHaveProperty(
      "disabled",
      true,
    );
    const review = screen.getByRole("button", { name: labels.review });
    expect(review).toHaveProperty("disabled", true);
    fireEvent.click(review);
    expect(mocks.restore).not.toHaveBeenCalled();
  },
);

it("honors a newly read receipt before adopting changed consequences", () => {
  const view = mount();
  enterReason();
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      fingerprint: "b".repeat(64),
      websiteEligible: false,
      receiptId: "another-reviewer-receipt",
      effects: ["New completed consequence"],
    }),
  );
  view.rerender(recoveryTree());
  const website = screen.getByText(
    en.checkpointRecovery.website,
  ).parentElement!;
  expect(
    within(website).getByText(en.checkpointRecovery.recorded),
  ).toBeTruthy();
  expect(screen.queryByText(en.checkpointRecovery.cliOnly)).toBeNull();
  expect(screen.queryByText("New completed consequence")).toBeNull();
  expect(screen.getByLabelText("Restoration reason")).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(mocks.restore).not.toHaveBeenCalled();
});

it.each(["en", "zh"])(
  "keeps unsupported evidence blocked instead of recommending CLI bypass (%s)",
  (locale) => {
    const labels =
      locale === "zh" ? zh.checkpointRecovery : en.checkpointRecovery;
    mocks.inspect.mockReturnValue(
      query({
        ...initial,
        coverage: "UNKNOWN",
        websiteEligible: false,
        dependentEventCount: 2,
        blockers: [
          "Unsupported participant descendant changes require a separate correction.",
        ],
      }),
    );
    mount(locale);
    const website = screen.getByText(labels.website).parentElement!;
    expect(within(website).getByText(labels.blockers)).toBeTruthy();
    expect(screen.queryByText(labels.cliOnly)).toBeNull();
    expect(
      screen.getByText(
        locale === "zh"
          ? "不受支持的参与者后续变更须另行修正。"
          : "Unsupported participant descendant changes require a separate correction.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.review })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.restore).not.toHaveBeenCalled();
  },
);

it("keeps an accepted restoration blocked through receipt-read failure and retries only the read", async () => {
  mocks.receipt.mockReturnValue({
    ...query(undefined),
    isError: true,
    isSuccess: false,
  });
  mount();
  enterReason();
  confirm();
  await screen.findByText(
    "Restoration saved. Use the receipt below to recover its result without repeating the write.",
  );
  expect(screen.getByText("receipt")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry read" }));
  expect(mocks.refetch).toHaveBeenCalled();
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
  expect(screen.queryByText(en.checkpointRecovery.cliOnly)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
});

it("distinguishes Coordinator submission from applied restoration", async () => {
  mocks.restore.mockRejectedValue({ data: { approvalId: "approval" } });
  mount("en", "COORDINATOR");
  enterReason();
  fireEvent.click(
    screen.getByRole("button", { name: "Request management review" }),
  );
  // The confirmation deliberately repeats the exact request-only consequence.
  fireEvent.click(
    screen
      .getAllByRole("button", { name: "Request management review" })
      .at(-1)!,
  );
  await screen.findByText(
    "Submitted for approval. No restoration has been applied.",
  );
  expect(screen.getByText(en.checkpointRecovery.reviewPending)).toBeTruthy();
  expect(screen.queryByText(en.checkpointRecovery.cliOnly)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "View approval request" })
      .getAttribute("href"),
  ).toContain("approval");
  expect(
    screen.queryByText(
      "Restoration saved. Use the receipt below to recover its result without repeating the write.",
    ),
  ).toBeNull();
});

it("conceals cached private evidence when current authority is denied", () => {
  mocks.inspect.mockReturnValue({
    ...query(initial),
    isError: true,
    isSuccess: false,
    error: { data: { code: "FORBIDDEN" } },
  });
  mount();
  expect(
    screen.getByText(
      "Recovery access is no longer available. Private records have been hidden.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Synthetic status correction")).toBeNull();
});

it("shows already-sent and admitted outcomes without claiming that mail was retracted", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      delivery: {
        ...initial.delivery,
        effects: [
          {
            id: "sent",
            eventId: "event",
            deliveryId: "sent-delivery",
            notificationId: null,
            disposition: "SENT",
            cancellation: null,
          },
          {
            id: "flight",
            eventId: "event",
            deliveryId: "flight-delivery",
            notificationId: null,
            disposition: "IN_FLIGHT_OR_UNKNOWN",
            cancellation: null,
          },
        ],
      },
    }),
  );
  mount();
  expect(screen.getByText("Already sent")).toBeTruthy();
  expect(
    screen.getByText("Transport admitted or outcome unknown"),
  ).toBeTruthy();
  expect(
    screen.getByText("Original observations and sent mail cannot be erased."),
  ).toBeTruthy();
});

it.each([false, true])(
  "distinguishes a saved owner-action draft from active restoration and only renders permitted links (owner=%s)",
  (owner) => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RecoveryOwnerFollowUp
          result={{
            outcome: "AWAITING_OWNER_ACTION",
            drafts: [
              {
                draftId: "draft",
                ownerUserId: "owner",
                version: 1,
                state: "PENDING_OWNER_REVIEW",
                destination: owner ? "/signup?recoveryDraft=draft" : null,
              },
            ],
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Saved — awaiting owner action" }),
    ).toBeTruthy();
    expect(screen.getByText(/does not restore active membership/)).toBeTruthy();
    expect(
      screen.queryByRole("link", {
        name: "Review my recovered request draft",
      }) !== null,
    ).toBe(owner);
  },
);

it("renders canonical checkpoint warnings and preserved boundaries in Chinese", () => {
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      effects: ["Restore TUTOR synthetic-tutor lifecycle to ARCHIVED."],
      warnings: [
        "Assignments with later attendance, consent or other unsupported work cannot be replayed.",
      ],
      preserved: ["Current account security, restrictions and ownership."],
    }),
  );
  mount("zh");
  expect(
    screen.getByText("将辅导伙伴 synthetic-tutor 的参与状态恢复为已归档。"),
  ).toBeTruthy();
  expect(screen.getByText("当前账号安全、限制与归属。")).toBeTruthy();
  expect(
    screen.getByText(
      "已有后续出勤、同意记录或其他不受支持操作的分配不能重放。",
    ),
  ).toBeTruthy();
});

function cachedPlans() {
  mocks.inspect.mockImplementation(
    ({ checkpointId }: { checkpointId: string }) =>
      query({
        ...initial,
        checkpointId,
        actionId: `action-${checkpointId}`,
        sourceId: `synthetic-${checkpointId}`,
      }),
  );
}
function selectCheckpoint(id: string) {
  fireEvent.change(screen.getByLabelText("Checkpoint reference"), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Inspect checkpoint" }));
}
function ledgerEntry(id = "checkpoint") {
  return queryClient.getQueryData<{ checkpoints: Record<string, unknown> }>([
    "checkpoint-recovery",
    "private-intent-ledger",
  ])?.checkpoints[id];
}
function requestReview() {
  fireEvent.click(
    screen.getByRole("button", { name: "Request management review" }),
  );
  fireEvent.click(
    screen
      .getAllByRole("button", { name: "Request management review" })
      .at(-1)!,
  );
}

it("latches an independently read exact receipt beside stale eligible A through selection and page remount", () => {
  cachedPlans();
  mocks.receipt.mockReturnValue(
    query({
      id: "url-receipt",
      checkpoint: { id: "checkpoint" },
      reason: "Synthetic committed receipt",
      createdAt: initial.createdAt,
      result: null,
      deliveries: null,
    }),
  );
  const view = mount("en", "ADMIN", "url-receipt");
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(ledgerEntry()).toEqual({ receiptId: "url-receipt" });
  selectCheckpoint("checkpoint-b");
  expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
  expect(screen.queryByText("url-receipt")).toBeNull();
  selectCheckpoint("checkpoint");
  enterReason();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  view.unmount();
  mocks.receipt.mockReturnValue(query(undefined));
  mount();
  enterReason();
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
  expect(screen.getByText("url-receipt")).toBeTruthy();
  const review = screen.getByRole("button", { name: "Review restoration" });
  expect(review).toHaveProperty("disabled", true);
  fireEvent.click(review);
  expect(ledgerEntry()).toEqual({ receiptId: "url-receipt" });
  expect(mocks.restore).not.toHaveBeenCalled();
});

it.each(["URL only", "wrong receipt", "wrong checkpoint"] as const)(
  "does not latch a %s receipt beside A or carry a fabricated terminal outcome across remount",
  (kind) => {
    cachedPlans();
    const data =
      kind === "URL only"
        ? undefined
        : {
            id: kind === "wrong receipt" ? "different-receipt" : "url-receipt",
            checkpoint: {
              id: kind === "wrong checkpoint" ? "checkpoint-b" : "checkpoint",
            },
            reason: "Synthetic unmatched receipt",
            createdAt: initial.createdAt,
            result: null,
            deliveries: null,
          };
    mocks.receipt.mockReturnValue(query(data));
    const view = mount("en", "ADMIN", "url-receipt");
    enterReason();
    expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review restoration" }),
    ).toHaveProperty("disabled", false);
    expect(ledgerEntry()).not.toHaveProperty("receiptId");
    view.unmount();
    mount("en", "ADMIN", "url-receipt");
    expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review restoration" }),
    ).toHaveProperty("disabled", false);
    expect(ledgerEntry()).not.toHaveProperty("receiptId");
    expect(mocks.restore).not.toHaveBeenCalled();
  },
);

it.each(["direct", "queued"] as const)(
  "retains a compact %s terminal latch across A→B→A and a true page remount with cached pre-write A",
  async (outcome) => {
    cachedPlans();
    if (outcome === "queued")
      mocks.restore.mockRejectedValue({ data: { approvalId: "approval-a" } });
    const role = outcome === "queued" ? "COORDINATOR" : "ADMIN";
    const view = mount("en", role);
    enterReason();
    if (outcome === "queued") requestReview();
    else confirm();
    await screen.findByText(
      outcome === "queued"
        ? en.checkpointRecovery.queued
        : en.checkpointRecovery.recorded,
    );
    expect(ledgerEntry()).toEqual(
      outcome === "queued"
        ? { approvalId: "approval-a" }
        : { receiptId: "receipt" },
    );
    expect(mocks.invalidateInspect).toHaveBeenCalledWith({
      checkpointId: "checkpoint",
    });
    selectCheckpoint("checkpoint-b");
    expect(screen.getByText("Tutor: synthetic-checkpoint-b")).toBeTruthy();
    expect(screen.queryByText("receipt")).toBeNull();
    selectCheckpoint("checkpoint");
    enterReason();
    expect(
      screen.getByRole("button", {
        name:
          outcome === "queued"
            ? "Request management review"
            : "Review restoration",
      }),
    ).toHaveProperty("disabled", true);
    view.unmount();
    mount("en", role);
    enterReason();
    expect(
      screen.getByText(
        outcome === "queued"
          ? en.checkpointRecovery.reviewPending
          : en.checkpointRecovery.recorded,
      ),
    ).toBeTruthy();
    const button = screen.getByRole("button", {
      name:
        outcome === "queued"
          ? "Request management review"
          : "Review restoration",
    });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  },
);

it("requires explicit adoption when evidence refreshes before the first reason edit", async () => {
  const view = mount();
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      fingerprint: "b".repeat(64),
      effects: ["Unadopted new consequence"],
    }),
  );
  view.rerender(recoveryTree());
  expect(screen.getByText("Synthetic status correction")).toBeTruthy();
  expect(screen.queryByText("Unadopted new consequence")).toBeNull();
  expect(screen.getByText(en.checkpointRecovery.changed)).toBeTruthy();
  enterReason();
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(
    screen.getByRole("button", { name: "Review updated consequences" }),
  );
  expect(await screen.findByText("Unadopted new consequence")).toBeTruthy();
});

it("retains consecutive typed characters before batched query-cache observer notifications", () => {
  mount();
  const input =
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason");
  const reason = "Synthetic consecutive input";
  for (const character of reason)
    fireEvent.change(input, { target: { value: input.value + character } });
  expect(input.value).toBe(reason);
  expect(ledgerEntry()).toMatchObject({ reason });
});

it("keeps an uncertain direct attempt exact across remount and reconciles it without adopting changed consequences", async () => {
  mocks.restore.mockRejectedValueOnce(new Error("Synthetic lost response"));
  const view = mount();
  fireEvent.change(screen.getByLabelText("Restoration reason"), {
    target: { value: "  Synthetic exact reason  " },
  });
  confirm();
  await screen.findByText(en.checkpointRecovery.failed);
  const firstIntent = mocks.restore.mock.calls[0]![0];
  expect(firstIntent.reason).toBe("Synthetic exact reason");
  view.unmount();
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      fingerprint: "b".repeat(64),
      effects: ["Unadopted uncertain consequence"],
    }),
  );
  mount();
  expect(screen.getByLabelText("Restoration reason")).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByRole("button", { name: "Review updated consequences" }),
  ).toHaveProperty("disabled", true);
  expect(screen.queryByText("Unadopted uncertain consequence")).toBeNull();
  confirm();
  await screen.findByText(en.checkpointRecovery.recorded);
  expect(mocks.restore.mock.calls[1]![0]).toEqual(firstIntent);
  expect(ledgerEntry()).toEqual({ receiptId: "receipt" });
});

it("holds an uncertain approval creation for read-only reconciliation instead of sending another proposal", async () => {
  mocks.restore.mockRejectedValueOnce(
    new Error("Synthetic uncertain proposal response"),
  );
  const view = mount("en", "COORDINATOR");
  enterReason();
  requestReview();
  await screen.findByText(en.checkpointRecovery.failed);
  expect(
    screen
      .getByRole("link", { name: "View approval request" })
      .getAttribute("href"),
  ).toBe("/admin/approvals");
  expect(
    screen.getByRole("button", { name: "Request management review" }),
  ).toHaveProperty("disabled", true);
  view.unmount();
  mount("en", "COORDINATOR");
  expect(
    screen.getByRole("button", { name: "Request management review" }),
  ).toHaveProperty("disabled", true);
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  expect(ledgerEntry()).toMatchObject({
    uncertain: true,
    attempt: mocks.restore.mock.calls[0]![0],
  });
});

it("records A's late completion only under A while a different page scope B is mounted", async () => {
  cachedPlans();
  let finish!: (value: { receiptId: string }) => void;
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  enterReason();
  confirm();
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(1));
  view.unmount();
  const other = mount("en", "ADMIN", "", "checkpoint-b");
  await act(async () => {
    finish({ receiptId: "receipt-a" });
  });
  await waitFor(() =>
    expect(ledgerEntry()).toEqual({ receiptId: "receipt-a" }),
  );
  expect(screen.getByText("Tutor: synthetic-checkpoint-b")).toBeTruthy();
  expect(screen.queryByText("receipt-a")).toBeNull();
  expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
  expect(mocks.invalidateInspect).toHaveBeenCalledWith({
    checkpointId: "checkpoint",
  });
  other.unmount();
  mount();
  expect(screen.getByText("receipt-a")).toBeTruthy();
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
});

it("retains a fresh server receipt over a stale queued preview across remount", async () => {
  mocks.restore.mockRejectedValueOnce({ data: { approvalId: "approval-a" } });
  const view = mount("en", "COORDINATOR");
  enterReason();
  requestReview();
  await screen.findByText(en.checkpointRecovery.queued);
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      websiteEligible: false,
      receiptId: "reviewer-receipt",
    }),
  );
  view.rerender(recoveryTree("en", "COORDINATOR"));
  await waitFor(() =>
    expect(ledgerEntry()).toEqual({ receiptId: "reviewer-receipt" }),
  );
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
  expect(screen.queryByText(en.checkpointRecovery.queued)).toBeNull();
  view.unmount();
  mocks.inspect.mockReturnValue(query({ ...initial }));
  mount("en", "COORDINATOR");
  expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
  expect(mocks.restore).toHaveBeenCalledTimes(1);
});

it.each(["approval", "error"] as const)(
  "never replaces an observed server receipt with A's late %s response",
  async (outcome) => {
    let fail!: (reason: unknown) => void;
    mocks.restore.mockImplementationOnce(
      () =>
        new Promise<{ receiptId: string }>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const view = mount();
    enterReason();
    confirm();
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(1));
    mocks.inspect.mockReturnValue(
      query({
        ...initial,
        fingerprint: "b".repeat(64),
        websiteEligible: false,
        receiptId: "observed-server-receipt",
      }),
    );
    view.rerender(recoveryTree());
    await waitFor(() =>
      expect(ledgerEntry()).toEqual({ receiptId: "observed-server-receipt" }),
    );
    await act(async () => {
      fail(
        outcome === "approval"
          ? { data: { approvalId: "late-approval" } }
          : new Error("Synthetic late response failure"),
      );
    });
    expect(ledgerEntry()).toEqual({ receiptId: "observed-server-receipt" });
    expect(screen.queryByText(en.checkpointRecovery.failed)).toBeNull();
    expect(screen.queryByText(en.checkpointRecovery.queued)).toBeNull();
    view.unmount();
    mocks.inspect.mockReturnValue(query({ ...initial }));
    mount();
    expect(screen.getByText(en.checkpointRecovery.recorded)).toBeTruthy();
    expect(screen.getByText("observed-server-receipt")).toBeTruthy();
    expect(screen.queryByText("late-approval")).toBeNull();
    expect(screen.queryByText(en.checkpointRecovery.failed)).toBeNull();
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  },
);

it("retains read denial across route remount and rechecks the denied off-screen scope before releasing privacy", async () => {
  mocks.inspect.mockReturnValue({
    ...query(initial),
    isError: true,
    isSuccess: false,
    error: { data: { code: "FORBIDDEN" } },
  });
  const view = mount();
  expect(screen.getByText(en.checkpointRecovery.denied)).toBeTruthy();
  view.unmount();
  cachedPlans();
  mount("en", "ADMIN", "", "checkpoint-b");
  expect(screen.getByText(en.checkpointRecovery.denied)).toBeTruthy();
  expect(screen.queryByText("Tutor: synthetic-checkpoint-b")).toBeNull();
  mocks.refetch.mockResolvedValue({ isSuccess: true });
  mocks.fetchInspect.mockRejectedValueOnce(
    new Error("Synthetic still-denied A"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry read" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry read" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(mocks.fetchInspect).toHaveBeenCalledWith(
    { checkpointId: "checkpoint" },
    { staleTime: 0 },
  );
  expect(screen.getByText(en.checkpointRecovery.denied)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry read" }));
  await screen.findByText("Tutor: synthetic-checkpoint-b");
  expect(screen.queryByText(en.checkpointRecovery.denied)).toBeNull();
});

it("drops old authority intent and ignores its late completion after the provider replaces and clears its QueryClient", async () => {
  let finish!: (value: { receiptId: string }) => void;
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  enterReason();
  confirm();
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(1));
  const retiredClient = queryClient;
  retiredClient.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  authority = "synthetic-other-actor-role-and-revisions";
  view.rerender(recoveryTree());
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("");
  await act(async () => {
    finish({ receiptId: "retired-authority-receipt" });
  });
  expect(screen.queryByText("retired-authority-receipt")).toBeNull();
  expect(screen.queryByText(en.checkpointRecovery.recorded)).toBeNull();
  expect(
    retiredClient.getQueryData([
      "checkpoint-recovery",
      "private-intent-ledger",
    ]),
  ).toBeUndefined();
  expect(JSON.stringify(ledgerEntry()) ?? "").not.toContain(
    "Synthetic reviewed restoration",
  );
});
