import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  rows: vi.fn(),
  row: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  available: vi.fn(),
  send: vi.fn(),
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
});
afterEach(() => vi.unstubAllEnvs());
function notice(
  category: string,
  event: string,
  options: { retired?: boolean; destination?: string; role?: string } = {},
) {
  mocks.row.mockResolvedValue({
    id: "notice-1",
    status: "PENDING",
    category,
    event,
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
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: "notice-1" },
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
    expect(mocks.update).toHaveBeenCalledWith(
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
    expect(message.text).toContain(`Unsubscribe: ${url.href}`);
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
