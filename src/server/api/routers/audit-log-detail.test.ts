import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import type { db as database } from "~/server/db";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// This read-contract suite never opens or resets an operator's database.
vi.mock("~/server/db", () => ({ db: {} }));
import { createCaller } from "~/server/api/root";

const entry = {
  id: "audit-entry",
  userId: "former-account",
  userName: "Historical Actor",
  createdAt: new Date("2026-10-08T12:34:56.789Z"),
  kind: "ACTION",
  operation: "program.setProfilePolicy",
  entity: "ProgramSettings",
  entityId: "program",
  action: "Changed name display and grade settings",
  approvalId: "historical-approval",
  details: {
    before: { usePreferredNames: false, offeredGrades: [10, 11] },
    after: { usePreferredNames: true, offeredGrades: [10, 11, 12] },
  },
  undone: true,
  undoneAt: new Date("2026-10-09T01:02:03.456Z"),
};

function fixture(role: Session["role"] = "ADMIN") {
  const account = {
    role,
    name: "Current Reader",
    username: "reader",
    tutorId: null,
    suspendedAt: null as Date | null,
    mergedIntoId: null as string | null,
    schoolDeparture: null as {
      reason: string;
      observerRevoked: boolean;
      tutorDerived: boolean;
    } | null,
  };
  const stored = {
    ...entry,
    undoData: { kind: "private-executable-instruction" },
    futurePrivateField: "Not part of the read contract",
  };
  const mock = {
    user: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async (): Promise<typeof account | null> => account,
        ),
    },
    auditLog: {
      // Model Prisma's projection, so accidentally selecting a full row is visible.
      findUnique: vi
        .fn()
        .mockImplementation(
          async (args: {
            select?: Record<string, boolean>;
          }): Promise<Record<string, unknown> | null> =>
            args.select
              ? Object.fromEntries(
                  Object.entries(stored).filter(([key]) => args.select?.[key]),
                )
              : stored,
        ),
    },
  };
  const context = {
    db: mock as unknown as typeof database,
    headers: new Headers(),
    session: {
      user: { id: "reader", name: "Session Reader" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    } as Session | null,
  };
  return { account, mock, context, caller: createCaller(context) };
}

describe("audit event detail read boundary", () => {
  it.each<Session["role"]>(["HEAD", "ADMIN", "COORDINATOR"])(
    "returns exact stored evidence to current %s without executable undo data",
    async (role) => {
      const { caller, mock } = fixture(role);
      const result = await caller.admin.auditLogDetail({ id: entry.id });
      expect(result).toEqual(entry);
      expect(result).not.toHaveProperty("undoData");
      expect(result).not.toHaveProperty("futurePrivateField");
      expect(mock.auditLog.findUnique).toHaveBeenCalledWith({
        where: { id: entry.id },
        select: Object.fromEntries(
          Object.keys(entry).map((key) => [key, true]),
        ),
      });
      // Only the reader is fetched: renamed/deleted actors and targets cannot
      // silently replace the immutable actor or before/after snapshots.
      expect(mock.user.findUnique).toHaveBeenCalledOnce();
      expect(mock.user.findUnique.mock.calls[0]?.[0]).toMatchObject({
        where: { id: "reader" },
      });
    },
  );

  it.each<Session["role"]>(["VIEWER", "TUTOR", "STUDENT", "CREW"])(
    "denies %s before reading private evidence, even with a stale admin session",
    async (role) => {
      const { caller, account, mock } = fixture("ADMIN");
      account.role = role;
      await expect(
        caller.admin.auditLogDetail({ id: entry.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.auditLog.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each<Session["role"]>(["TUTOR", "STUDENT"])(
    "denies a departed %s observer who may read management summaries",
    async (role) => {
      const { caller, account, mock } = fixture(role);
      account.schoolDeparture = {
        reason: "GRADUATED",
        observerRevoked: false,
        tutorDerived: false,
      };
      await expect(
        caller.admin.auditLogDetail({ id: entry.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.auditLog.findUnique).not.toHaveBeenCalled();
    },
  );

  it("honors a current staff promotion instead of a stale viewer role", async () => {
    const { caller, account } = fixture("VIEWER");
    account.role = "ADMIN";
    await expect(
      caller.admin.auditLogDetail({ id: entry.id }),
    ).resolves.toEqual(entry);
  });

  it.each(["suspended", "deleted", "merged", "signed out"] as const)(
    "denies a %s account before fetching evidence",
    async (state) => {
      const { account, mock, context } = fixture();
      if (state === "suspended") account.suspendedAt = new Date();
      if (state === "deleted") mock.user.findUnique.mockResolvedValue(null);
      if (state === "merged") account.mergedIntoId = "survivor";
      if (state === "signed out") context.session = null;
      await expect(
        createCaller(context).admin.auditLogDetail({ id: entry.id }),
      ).rejects.toMatchObject({
        code: state === "suspended" ? "FORBIDDEN" : "UNAUTHORIZED",
      });
      expect(mock.auditLog.findUnique).not.toHaveBeenCalled();
    },
  );

  it("returns NOT_FOUND for a missing event", async () => {
    const { caller, mock } = fixture();
    mock.auditLog.findUnique.mockResolvedValue(null);
    await expect(
      caller.admin.auditLogDetail({ id: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves unavailable evidence on legacy and generic events", async () => {
    const { caller, mock } = fixture();
    const legacy = {
      ...entry,
      userId: null,
      userName: null,
      operation: null,
      entityId: null,
      approvalId: null,
      details: null,
      undone: false,
      undoneAt: null,
    };
    mock.auditLog.findUnique.mockResolvedValue(legacy);
    await expect(
      caller.admin.auditLogDetail({ id: entry.id }),
    ).resolves.toEqual(legacy);
  });

  it("rejects an empty event identifier without reading the audit table", async () => {
    const { caller, mock } = fixture();
    await expect(caller.admin.auditLogDetail({ id: "" })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
    expect(mock.auditLog.findUnique).not.toHaveBeenCalled();
  });
});
