import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  rows: vi.fn(),
  row: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  available: vi.fn(),
  send: vi.fn(),
  reminderEligible: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: {
    programSettings: { findUnique: mocks.settings },
    $queryRaw: mocks.rows,
    emailDelivery: {
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  vi.stubEnv("AUTH_SECRET", "synthetic-notification-secret");
  mocks.settings.mockResolvedValue({ emailNotificationsEnabled: true });
  mocks.rows.mockResolvedValue([{ id: "notice-1" }]);
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
  mocks.row.mockResolvedValue({
    id: "notice-1",
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
  });
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
      leaseUntil: undefined,
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
