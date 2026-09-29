import { beforeEach, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ emailNotificationsEnabled: true });
  mocks.rows.mockResolvedValue([{ id: "notice-1" }]);
  mocks.available.mockReturnValue(true);
  mocks.send.mockResolvedValue(undefined);
});
function notice(category: string, event: string) {
  mocks.row.mockResolvedValue({
    id: "notice-1",
    status: "PENDING",
    category,
    event,
    recipient: "recipient@example.test",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    attempts: 0,
    previousPrimary: false,
    user: {
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
    expect(mocks.update).toHaveBeenCalledWith(
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
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "PENDING",
        attempts: 1,
        lastError: "Email delivery failed; check the configured transport.",
      }) as unknown,
    }),
  );
  expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("sentinel");
});
