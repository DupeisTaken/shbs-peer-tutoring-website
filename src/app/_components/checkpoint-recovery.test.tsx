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
}));
vi.mock("~/trpc/react", () => ({
  api: {
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
function mount(
  locale = "en",
  role: "ADMIN" | "HEAD" | "COORDINATOR" = "ADMIN",
  initialReceipt = "",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "zh" ? zh : en}
    >
      <CheckpointRecovery
        role={role}
        initialCheckpoint="checkpoint"
        initialReceipt={initialReceipt}
      />
    </NextIntlClientProvider>,
  );
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
afterEach(cleanup);

it.each(["en", "zh"])(
  "renders localized checkpoint scope, review and current evidence (%s)",
  (locale) => {
    mount(locale);
    expect(
      screen.getByRole("heading", {
        name:
          locale === "zh"
            ? "参与状态与工作流程检查点"
            : "Participant and workflow checkpoints",
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

it("retains a draft across changed previews and requires explicit review before using a new fingerprint", () => {
  const view = mount();
  enterReason();
  mocks.inspect.mockReturnValue(
    query({
      ...initial,
      fingerprint: "b".repeat(64),
      effects: ["New synthetic consequence"],
    }),
  );
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <CheckpointRecovery role="ADMIN" initialCheckpoint="checkpoint" />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Review restoration" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Restoration reason").value,
  ).toBe("Synthetic reviewed restoration");
  fireEvent.click(
    screen.getByRole("button", { name: "Review updated consequences" }),
  );
  expect(screen.getByText("New synthetic consequence")).toBeTruthy();
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
  expect(mocks.refetch).toHaveBeenCalledTimes(1);
  expect(mocks.restore).toHaveBeenCalledTimes(1);

  const updated = {
    ...initial,
    fingerprint: "b".repeat(64),
    effects: ["New synthetic consequence"],
  };
  mocks.inspect.mockReturnValue(query(updated));
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <CheckpointRecovery role="ADMIN" initialCheckpoint="checkpoint" />
    </NextIntlClientProvider>,
  );
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
  expect(screen.getByText("New synthetic consequence")).toBeTruthy();
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
});

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
