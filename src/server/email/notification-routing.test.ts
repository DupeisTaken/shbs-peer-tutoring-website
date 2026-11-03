import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  rows: vi.fn(),
  leases: vi.fn(),
  row: vi.fn(),
  account: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  available: vi.fn(),
  send: vi.fn(),
  reminderEligible: vi.fn(),
  ownership: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: {
    programSettings: { findUnique: mocks.settings },
    $queryRaw: mocks.rows,
    $executeRaw: mocks.execute,
    historyRowOwnership: { findUnique: mocks.ownership },
    user: { findUnique: mocks.account },
    emailDelivery: {
      findUnique: mocks.row,
      findUniqueOrThrow: mocks.row,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("./sender", () => ({
  emailSender: { send: mocks.send },
  isEmailDeliveryAvailable: mocks.available,
}));
vi.mock("./event-reminders", () => ({
  queueEventReminders: vi.fn(),
  validateEventReminder: mocks.reminderEligible,
}));
import { deliverNotifications } from "./notification-delivery";
import { renderEmail } from "./template";
import type { EmailMessage } from "./sender";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
const leaseUntil = new Date("2030-01-01T00:05:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  vi.stubEnv("AUTH_SECRET", "synthetic-notification-secret");
  mocks.settings.mockResolvedValue({ emailNotificationsEnabled: true });
  mocks.leases.mockResolvedValue([{ id: "notice-1", leaseUntil, attemptId: null }]);
  // Keep the real identity/recovery admission path. A lease row is not a
  // cancellation record, causal root or transport outcome.
  mocks.rows.mockImplementation((parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (sql.includes("WITH candidates AS MATERIALIZED")) return mocks.leases();
    if (sql.includes('SELECT DISTINCT "actionId"')) return Promise.resolve([]);
    if (sql.includes('FROM "EmailDelivery"') && sql.includes("FOR UPDATE"))
      return Promise.resolve([{ id: "notice-1" }]);
    if (sql.includes('SELECT true AS found FROM "RecoveryDeliveryCancellation"'))
      return Promise.resolve([]);
    throw new Error("Unexpected notification routing fixture query");
  });
  mocks.account.mockResolvedValue({
    mergedIntoId: null,
    recoveryVoidedAt: null,
    suspendedAt: null,
  });
  mocks.ownership.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.execute.mockResolvedValue(0);
  mocks.available.mockReturnValue(true);
  mocks.send.mockResolvedValue(undefined);
  mocks.reminderEligible.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
function notice(
  category: string,
  event: string,
  options: {
    retired?: boolean;
    destination?: string;
    role?: string;
    review?: boolean;
    reminder?: boolean;
    suspended?: boolean;
    context?: unknown;
  } = {},
) {
  const row = {
    id: "notice-1",
    userId: "account-1",
    sourceNotificationId: null,
    leaseUntil,
    attemptId: null as string | null,
    attemptStartedAt: null as Date | null,
    status: "PENDING",
    category,
    event,
    context: options.context ?? null,
    destination: options.destination ?? null,
    recipient: "recipient@example.test",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    attempts: 0,
    previousPrimary: false,
    user: {
      role: options.role ?? "STUDENT",
      mergedIntoId: options.retired ? "surviving-account" : null,
      email: "recipient@example.test",
      emailMessages: true,
      emailInfo: true,
      emailReviewRequests: options.review ?? false,
      emailEventReminders: options.reminder ?? false,
      suspendedAt: options.suspended ? new Date() : null,
      emailSecurity: false,
      emails: [{ email: "recipient@example.test", verifiedAt: new Date() }],
    },
  };
  mocks.row.mockImplementation(async () => row);
  mocks.account.mockResolvedValue({
    mergedIntoId: row.user.mergedIntoId,
    recoveryVoidedAt: null,
    suspendedAt: row.user.suspendedAt,
  });
  mocks.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      const attempts = row.attempts + (typeof data.attempts === "object" ? 1 : 0);
      Object.assign(row, data, { attempts });
      return row;
    },
  );
  mocks.updateMany.mockImplementation(
    async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      // Bulk stale-attempt cleanup and settings sweeps do not match this fresh
      // fixture. Exact row writes retain the admitted token and state for finish.
      if (where.id !== row.id) return { count: 0 };
      if (typeof where.status === "string" && where.status !== row.status)
        return { count: 0 };
      if ("attemptId" in where && where.attemptId !== row.attemptId)
        return { count: 0 };
      if (where.leaseUntil instanceof Date &&
        where.leaseUntil.getTime() !== row.leaseUntil?.getTime())
        return { count: 0 };
      const attempts = typeof data.attempts === "object"
        ? row.attempts + 1 : data.attempts ?? row.attempts;
      Object.assign(row, data, { attempts });
      return { count: 1 };
    },
  );
  return row;
}
it.each([
  "primary_changed",
  "secondary_added",
  "secondary_removed",
  "security_changed",
])(
  "sends essential %s account notices through SECURITY, even when personal security notices are disabled",
  async (event) => {
    notice("security", event);
    await deliverNotifications();
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ category: "SECURITY" }),
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }) as unknown,
      }),
    );
  },
);
it.each([
  ["messages", "message_received"],
  ["information", "information_changed"],
  ["information", "program_update"],
])("routes %s/%s notices through PROGRAM", async (category, event) => {
  notice(category, event);
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({ category: "PROGRAM" }),
  );
});
it("keeps unavailable program delivery pending while security delivery is available", async () => {
  notice("messages", "message_received");
  mocks.available.mockImplementation((category) => category === "SECURITY");
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: {
      id: "notice-1",
      leaseUntil,
      attemptId: null,
      status: { in: ["PENDING", "SENDING"] },
    },
    data: { leaseUntil: null, availableAt: expect.any(Date) as unknown },
  });
});
it("records a safe failed attempt instead of marking security delivery sent", async () => {
  notice("security", "primary_changed");
  mocks.send.mockRejectedValue(new Error("provider credential sentinel"));
  await deliverNotifications();
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "PENDING",
        attempts: 1,
        lastError: "Email delivery failed; check the configured transport.",
      }) as unknown,
    }),
  );
  expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("sentinel");
});
it("sends an eligible ordinary notice before recording SMTP acceptance", async () => {
  notice("info", "tutor_application_pending", {
    role: "ADMIN",
    destination: "/admin/applications",
  });
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.account).toHaveBeenCalledWith({
    where: { id: "account-1" },
    select: { mergedIntoId: true, recoveryVoidedAt: true, suspendedAt: true },
  });
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: "notice-1" },
    data: {
      status: "SENDING",
      attemptId: expect.any(String) as unknown,
      attemptStartedAt: expect.any(Date) as unknown,
      attempts: { increment: 1 },
    },
  });
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.send.mock.invocationCallOrder[0]!,
  );
  const sentCall = mocks.updateMany.mock.calls.findIndex(
    ([input]) => (input as { data: { status: string } }).data.status === "SENT",
  );
  expect(sentCall).toBeGreaterThanOrEqual(0);
  expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.updateMany.mock.invocationCallOrder[sentCall]!,
  );
});

it.each([
  [
    "security",
    "security_changed",
    "SECURITY",
    "/my-account",
    "ACCOUNT SECURITY",
  ],
  ["messages", "message_received", "PROGRAM", "/messages", "PRIVATE MESSAGES"],
  [
    "information",
    "program_update",
    "PROGRAM",
    "/admin/approvals?request=synthetic#details",
    "PROGRAM UPDATE",
  ],
])(
  "preserves purpose and template destination together for %s/%s",
  async (category, event, purpose, path, eyebrow) => {
    notice(category, event, { role: "ADMIN", destination: path });
    await deliverNotifications();
    const message = mocks.send.mock.calls[0]?.[0] as EmailMessage;
    expect(message.category).toBe(purpose);
    expect(message.presentation?.eyebrow).toBe(eyebrow);
    const action = message.presentation!.action!;
    expect(new URL(action.url).searchParams.get("callbackUrl")).toBe(path);
    expect(message.text).toContain(action.url);
    expect(renderEmail({ brand: "School", ...message })).toContain(
      action.label,
    );
  },
);

it.each(["security", "information"])(
  "skips %s email for retired history owners without sending template actions",
  async (category) => {
    notice(
      category,
      category === "security" ? "security_changed" : "program_update",
      { retired: true, destination: "/admin/approvals" },
    );
    await deliverNotifications();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          leaseUntil: null,
        }) as unknown,
      }),
    );
  },
);

it.each(["messages", "info", "information"])(
  "includes a matching signed HTML/plaintext unsubscribe link only for optional %s mail",
  async (category) => {
    notice(
      category,
      category === "messages" ? "message_received" : "program_update",
    );
    await deliverNotifications();
    const message = mocks.send.mock.calls[0]?.[0] as EmailMessage;
    const url = new URL(message.presentation!.unsubscribeUrl!);
    expect(url.origin + url.pathname).toBe(
      "https://school.example.test/unsubscribe",
    );
    expect(verifyUnsubscribeToken(url.searchParams.get("token")!)).toBe(
      "notice-1",
    );
    expect(message.text).toContain(`Unsubscribe / 取消订阅: ${url.href}`);
    expect(url.href).not.toContain("recipient");
  },
);

it("never offers an unsubscribe capability in essential security mail", async () => {
  notice("security", "security_changed");
  await deliverNotifications();
  const message = mocks.send.mock.calls[0]?.[0] as EmailMessage;
  expect(message.presentation?.unsubscribeUrl).toBeUndefined();
  expect(message.text).not.toContain("Unsubscribe");
});

it.each([
  { role: "ADMIN", review: false },
  { role: "STUDENT", review: true },
  { role: "HEAD", review: true, suspended: true },
])(
  "skips review mail without current eligible opted-in authority: %j",
  async (options) => {
    notice("review", "management_review_pending", options);
    await deliverNotifications();
    expect(mocks.send).not.toHaveBeenCalled();
  },
);

it("keeps head-only review mail separate from ordinary Admin reviews", async () => {
  notice("review", "management_head_review_pending", {
    role: "ADMIN",
    review: true,
  });
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  notice("review", "management_head_review_pending", {
    role: "HEAD",
    review: true,
  });
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const message = mocks.send.mock.calls[0]?.[0] as EmailMessage;
  expect(message.presentation?.eyebrow).toBe("REVIEW REQUEST");
  expect(message.presentation?.unsubscribeUrl).toBeTruthy();
});

it("retains participant updates for review-pending events under ordinary info preferences", async () => {
  notice("info", "student_withdrawal_pending", {
    role: "STUDENT",
    review: false,
    destination: "/student",
  });
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("retains generic legacy home fallback but withholds detailed staff facts after role loss", async () => {
  notice("info", "program_update", {
    role: "STUDENT",
    destination: "/admin/requests",
  });
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledOnce();
  const generic = mocks.send.mock.calls[0]?.[0] as EmailMessage;
  expect(
    new URL(generic.presentation!.action!.url).searchParams.get("callbackUrl"),
  ).toBe("/");
  mocks.send.mockClear();
  notice("info", "tutee_feedback_received", {
    role: "STUDENT",
    destination: "/admin/support",
    context: {
      emailDetail: {
        en: "Morgan submitted session feedback.",
        zh: "Morgan 提交了辅导反馈。",
      },
    },
  });
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("requires reminder opt-in and a still-current eligible event before dispatch", async () => {
  notice("reminder", "meeting_upcoming", { role: "TUTOR", reminder: false });
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  notice("reminder", "meeting_upcoming", { role: "TUTOR", reminder: true });
  mocks.reminderEligible.mockResolvedValue(false);
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.reminderEligible.mockResolvedValue(true);
  // A skipped row is terminal; evaluate a fresh pending notice for eligibility.
  notice("reminder", "meeting_upcoming", { role: "TUTOR", reminder: true });
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledOnce();
  const message = mocks.send.mock.calls[0]?.[0] as EmailMessage;
  expect(message.presentation?.eyebrow).toBe("UPCOMING EVENT");
  expect(message.presentation?.unsubscribeUrl).toBeTruthy();
});

it("fails optional delivery safely if a signing secret is unavailable", async () => {
  notice("messages", "message_received");
  vi.stubEnv("AUTH_SECRET", "");
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "PENDING",
        attempts: 1,
        leaseUntil: null,
      }) as unknown,
    }),
  );
});


it("withholds a quarantined optional copy at the real admission boundary", async () => {
  notice("info", "program_update");
  mocks.ownership.mockResolvedValue({ readerUserId: null });
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "notice-1", status: "PENDING", leaseUntil, attemptId: null, attemptStartedAt: null },
    data: expect.objectContaining({ status: "CANCELLED" }) as unknown,
  }));
});

it("does not send from a stale worker lease", async () => {
  notice("info", "program_update");
  mocks.leases.mockResolvedValue([{ id: "notice-1", leaseUntil: new Date(leaseUntil.getTime() - 1), attemptId: null }]);
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rechecks current account authority after reading an eligible routing snapshot", async () => {
  const row = notice("info", "program_update");
  mocks.account.mockResolvedValue({
    mergedIntoId: "surviving-account",
    recoveryVoidedAt: null,
    suspendedAt: null,
  });
  await deliverNotifications();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(row.status).toBe("CANCELLED");
});

it("retains an admitted transport failure as uncertain without sending it again", async () => {
  const row = notice("info", "program_update");
  mocks.send.mockRejectedValue(new Error("provider credential sentinel"));
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(row).toMatchObject({
    status: "UNCERTAIN",
    attemptId: expect.any(String) as unknown,
    attemptStartedAt: expect.any(Date) as unknown,
    attempts: 1,
  });
  expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("sentinel");
  // Even a stale sweep presenting this row again must not replay its transport.
  await deliverNotifications();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledOnce();
});
