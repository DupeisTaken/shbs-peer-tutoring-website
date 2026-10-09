import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { db as database } from "~/server/db";

const mocks = vi.hoisted(() => ({ status: vi.fn(), resend: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/email/delivery-status", () => ({
  getEmailDeliveryStatus: mocks.status,
}));
vi.mock("~/server/email/resend-stuck", () => ({
  resendStuckEmails: mocks.resend,
}));
import { createCaller } from "../root";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ channels: [], retrying: 0, failed: 0 });
  mocks.resend.mockResolvedValue({ queued: 2 });
});

function fixture(role: Session["role"], claimedRole = role) {
  const actor = {
    role,
    name: "Synthetic reader",
    tutorId: null,
    schoolDeparture: null,
  };
  const mock = {
    user: { findUnique: vi.fn().mockResolvedValue(actor) },
    auditLog: { create: vi.fn() },
    emailDelivery: { count: vi.fn() },
  };
  return {
    mock,
    caller: createCaller({
      db: mock as unknown as typeof database,
      headers: new Headers(),
      session: {
        user: { id: "email-status-reader", name: "Synthetic reader" },
        role: claimedRole,
        tutorId: null,
        expires: "2099-01-01",
      },
    }),
  };
}

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "allows %s to read diagnostics without writes",
  async (role) => {
    const { caller, mock } = fixture(role);
    await expect(caller.program.emailDeliveryStatus()).resolves.toEqual({
      channels: [],
      retrying: 0,
      failed: 0,
    });
    expect(mocks.status).toHaveBeenCalledWith(mock);
    expect(mock.auditLog.create).not.toHaveBeenCalled();
  },
);

it.each(["STUDENT", "TUTOR", "VIEWER"] as const)(
  "rejects %s before accessing SMTP status even with stale admin claims",
  async (role) => {
    const { caller } = fixture(role, "ADMIN");
    await expect(caller.program.emailDeliveryStatus()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.status).not.toHaveBeenCalled();
  },
);

it.each(["HEAD", "ADMIN"] as const)(
  "allows %s to queue stuck mail",
  async (role) => {
    const { caller, mock } = fixture(role);
    await expect(caller.program.resendStuckEmails()).resolves.toEqual({
      queued: 2,
    });
    expect(mocks.resend).toHaveBeenCalledWith(mock, {
      id: "email-status-reader",
      name: "Synthetic reader",
    });
  },
);

it.each(["COORDINATOR", "STUDENT", "TUTOR", "VIEWER"] as const)(
  "denies %s retry writes even with stale admin session claims",
  async (role) => {
    const { caller, mock } = fixture(role, "ADMIN");
    await expect(caller.program.resendStuckEmails()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.resend).not.toHaveBeenCalled();
    // A denied mutation leaves delivery untouched but records the live actor's attempt.
    expect(mock.auditLog.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        userId: "email-status-reader",
        userName: "Synthetic reader",
        action: "Denied: Resend Stuck Emails",
        entity: "program",
        approvalId: undefined,
        operation: "program.resendStuckEmails",
        kind: "ATTEMPT",
        details: {
          actorRole: role,
          applied: false,
          errorCode: "FORBIDDEN",
          evidenceVersion: 1,
          outcome: "DENIED",
        },
      },
    });
    expect(mock.emailDelivery.count).not.toHaveBeenCalled();
  },
);
