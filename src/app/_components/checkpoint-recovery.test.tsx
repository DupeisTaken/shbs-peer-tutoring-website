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
  restore: vi.fn(),
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
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "zh" ? zh : en}
    >
      <CheckpointRecovery role={role} initialCheckpoint="checkpoint" />
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
