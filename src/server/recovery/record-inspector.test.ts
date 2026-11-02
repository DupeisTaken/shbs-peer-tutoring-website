import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainDb } from "../transactions";
import { inspectRecords, listRecordTables } from "./record-inspector";
import type { InspectRecordsInput } from "./record-inspector";

const operator = { operator: true } as const;
const web = { userId: "current-admin" };
function fixture() {
  const db = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        role: "ADMIN",
        suspendedAt: null,
        mergedIntoId: null,
        schoolDeparture: null,
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    tutorAvailability: { findMany: vi.fn().mockResolvedValue([]) },
    patrolCreditWindow: { findMany: vi.fn().mockResolvedValue([]) },
    directMessage: { findMany: vi.fn() },
    historicalRecordClaimReceipt: { findMany: vi.fn() },
    registrationCode: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    recoveryChange: { findMany: vi.fn().mockResolvedValue([]) },
    programFeature: { findMany: vi.fn().mockResolvedValue([]) },
    recoveryFence: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, client: db as unknown as DomainDb };
}

describe("read-only database inspector", () => {
  beforeEach(() => vi.clearAllMocks());
  it("catalogues unsupported models without reading rows or private existence", async () => {
    const { db, client } = fixture();
    const tables = await listRecordTables(client, web);
    expect(
      tables.find((table) => table.name === "DirectMessage")?.available,
    ).toBe(false);
    expect(
      tables.find((table) => table.name === "HistoricalRecordClaimReceipt")
        ?.available,
    ).toBe(false);
    expect(
      tables.find((table) => table.name === "TutorAvailability")?.keyFields,
    ).toEqual(["tutorId", "slotId"]);
    expect(db.directMessage.findMany).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { role: "COORDINATOR" },
    { role: "VIEWER" },
    { role: "TUTOR" },
    { role: "HEAD", suspendedAt: new Date() },
    { role: "HEAD", mergedIntoId: "survivor" },
    { role: "HEAD", recoveryVoidedAt: new Date() },
  ])(
    "rechecks current role, suspension and retirement (%j)",
    async (account) => {
      const { db, client } = fixture();
      db.user.findUnique.mockResolvedValue(account);
      await expect(listRecordTables(client, web)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        inspectRecords(client, web, { table: "User" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.user.findMany).not.toHaveBeenCalled();
    },
  );
  it("allows a current Head and immediately rejects a subsequent demotion", async () => {
    const { db, client } = fixture();
    db.user.findUnique
      .mockResolvedValueOnce({ role: "HEAD" })
      .mockResolvedValueOnce({ role: "VIEWER" });
    await expect(
      inspectRecords(client, web, { table: "User" }),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      inspectRecords(client, web, { table: "User" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });
  it("preserves independent staff access after participant departure", async () => {
    const { db, client } = fixture();
    db.user.findUnique.mockResolvedValue({
      role: "HEAD",
      schoolDeparture: { userId: "current-admin" },
    });
    await expect(
      inspectRecords(client, web, { table: "User" }),
    ).resolves.toMatchObject({ rows: [] });
  });
  it("selects safe persisted fields without fetching credential or consent material", async () => {
    const { db, client } = fixture();
    db.user.findMany.mockResolvedValue([
      {
        id: "u1",
        role: "ADMIN",
        name: "Actual name",
        passwordHash: "must-not-escape",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const result = await inspectRecords(client, operator, { table: "User" });
    const args = db.user.findMany.mock.calls[0]?.[0] as unknown as {
      select: Record<string, boolean>;
    };
    expect(args.select.passwordHash).toBeUndefined();
    expect(args.select.sessionVersion).toBeUndefined();
    expect(args.select.emailVerificationCodes).toBeUndefined();
    expect(result.rows[0]?.fields).not.toHaveProperty("passwordHash");
    expect(result.rows[0]?.fields.name).toBe("Actual name");
    expect(result.rows[0]?.fields.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.rows[0]?.omitted).toContainEqual({
      field: "passwordHash",
      reason: "restricted",
    });
    expect(result.rows[0]?.reference).toEqual({
      table: "User",
      key: { id: "u1" },
    });
  });
  it.each([
    "DirectMessage",
    "PolicyAcceptance",
    "PasswordResetToken",
    "CaptchaGrant",
    "HistoricalRecordClaimReceipt",
    "StudentSignup",
    "SessionPlanningReceipt",
    "SessionPlanningResponse",
    "SessionNotice",
    "SessionCalendarToken",
  ])("refuses row reads for %s even with operator authority", async (table) => {
    const { client } = fixture();
    await expect(
      inspectRecords(client, operator, { table, key: { id: "guessed" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("uses complete compound keys as bound exact filters", async () => {
    const { db, client } = fixture();
    const key = { tutorId: "$(untrusted)'", slotId: "slot" };
    db.tutorAvailability.findMany.mockResolvedValue([key]);
    const result = await inspectRecords(client, operator, {
      table: "TutorAvailability",
      key,
    });
    expect(db.tutorAvailability.findMany).toHaveBeenCalledWith({
      where: key,
      select: { tutorId: true, slotId: true },
      orderBy: [{ tutorId: "asc" }, { slotId: "asc" }],
      take: 26,
    });
    expect(result.rows[0]?.key).toEqual(key);
  });
  it("pages compound identities without skipping equal leading keys", async () => {
    const { db, client } = fixture();
    db.tutorAvailability.findMany.mockResolvedValueOnce([
      { tutorId: "a", slotId: "1" },
      { tutorId: "a", slotId: "2" },
    ]);
    const first = await inspectRecords(client, operator, {
      table: "TutorAvailability",
      limit: 1,
    });
    expect(first.rows).toHaveLength(1);
    await inspectRecords(client, operator, {
      table: "TutorAvailability",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(db.tutorAvailability.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ tutorId: { gt: "a" } }, { tutorId: "a", slotId: { gt: "1" } }],
        },
        take: 2,
      }),
    );
  });
  it("round trips DateTime compound keys as persisted dates", async () => {
    const { db, client } = fixture();
    const key = { crewUserId: "crew", windowStart: "2026-01-01T00:00:00.000Z" };
    await inspectRecords(client, operator, {
      table: "PatrolCreditWindow",
      key,
    });
    expect(db.patrolCreditWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { crewUserId: "crew", windowStart: new Date(key.windowStart) },
      }),
    );
  });
  const invalidInputs: InspectRecordsInput[] = [
    { table: "User; DROP TABLE User" },
    { table: "User", limit: 101 },
    { table: "User", limit: 0 },
    { table: "User", key: {} },
    { table: "User", key: { id: "u", role: "HEAD" } },
    { table: "TutorAvailability", key: { tutorId: "t" } },
    { table: "User", cursor: "not-json" },
    {
      table: "User",
      cursor: Buffer.from(
        JSON.stringify({ table: "Term", key: { id: "t" } }),
      ).toString("base64url"),
    },
    {
      table: "PatrolCreditWindow",
      key: { crewUserId: "crew", windowStart: "not-a-date" },
    },
  ];
  it.each(invalidInputs)(
    "rejects unknown identifiers, malformed filters and unbounded paging (%j)",
    async (input) => {
      const { db, client } = fixture();
      await expect(
        inspectRecords(client, operator, input),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.user.findMany).not.toHaveBeenCalled();
    },
  );
  it("bounds large values with an explicit reason and retains the exact record reference", async () => {
    const { db, client } = fixture();
    db.user.findMany.mockResolvedValue([{ id: "u", name: "x".repeat(32769) }]);
    const result = await inspectRecords(client, operator, { table: "User" });
    expect(result.rows[0]?.fields).not.toHaveProperty("name");
    expect(result.rows[0]?.omitted).toContainEqual({
      field: "name",
      reason: "size",
    });
    expect(result.rows[0]?.reference.key).toEqual({ id: "u" });
  });
  it("exposes the admission linkage without selecting registration capabilities", async () => {
    const { db, client } = fixture();
    db.registrationCode.findMany.mockResolvedValue([
      {
        id: "registration-id",
        applicationId: "application-id",
        tutorId: "tutor-id",
      },
    ]);
    const result = await inspectRecords(client, operator, {
      table: "RegistrationCode",
    });
    const args = db.registrationCode.findMany.mock.calls[0]?.[0] as unknown as {
      select: Record<string, boolean>;
    };
    expect(args.select.applicationId).toBe(true);
    expect(args.select.code).toBeUndefined();
    expect(args.select.emailCodeHash).toBeUndefined();
    expect(result.rows[0]?.fields.applicationId).toBe("application-id");
    expect(result.rows[0]?.omitted).toContainEqual({
      field: "code",
      reason: "restricted",
    });
  });
  it("exposes legacy audit chronology without retrieving arbitrary snapshots", async () => {
    const { db, client } = fixture();
    await inspectRecords(client, operator, { table: "AuditLog" });
    const args = db.auditLog.findMany.mock.calls[0]?.[0] as unknown as {
      select: Record<string, boolean>;
    };
    expect(args.select.id).toBe(true);
    expect(args.select.createdAt).toBe(true);
    expect(args.select.details).toBeUndefined();
    expect(args.select.undoData).toBeUndefined();
  });
  it("round trips large recovery journal IDs without precision loss or payload retrieval", async () => {
    const { db, client } = fixture();
    db.recoveryChange.findMany.mockResolvedValue([
      { id: 9007199254740993n, actionId: "a", eventId: "e" },
    ]);
    const result = await inspectRecords(client, operator, {
      table: "RecoveryChange",
      key: { id: "9007199254740993" },
    });
    expect(db.recoveryChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9007199254740993n } }),
    );
    expect(result.rows[0]?.reference.key.id).toBe("9007199254740993");
    expect(result.rows[0]?.omitted).toContainEqual({
      field: "before",
      reason: "restricted",
    });
    expect(result.rows[0]?.omitted).toContainEqual({
      field: "recordKey",
      reason: "restricted",
    });
  });
  it("allows at most 50 website rows and 100 trusted operator rows", async () => {
    const { db, client } = fixture();
    await expect(
      inspectRecords(client, web, { table: "User", limit: 51 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.user.findMany).not.toHaveBeenCalled();
    await expect(
      inspectRecords(client, operator, { table: "User", limit: 100 }),
    ).resolves.toMatchObject({ rows: [] });
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
    await expect(
      inspectRecords(client, operator, { table: "User", limit: 101 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("uses finite-domain filters to paginate enum primary keys", async () => {
    const { db, client } = fixture();
    const catalog = await listRecordTables(client, operator);
    expect(
      catalog.find((table) => table.name === "ProgramFeature")?.available,
    ).toBe(true);
    // CREW is a persisted enum value; the cursor is transport data, not SQL.
    const cursor = Buffer.from(
      JSON.stringify({ table: "ProgramFeature", key: { key: "CREW" } }),
    ).toString("base64url");
    await inspectRecords(client, operator, { table: "ProgramFeature", cursor });
    const args = db.programFeature.findMany.mock.calls[0]?.[0] as unknown as {
      where: { OR: Array<{ key: unknown }> };
    };
    expect(
      args.where.OR.every(
        (branch) =>
          typeof branch.key === "object" &&
          branch.key !== null &&
          "in" in branch.key,
      ),
    ).toBe(true);
    await expect(
      inspectRecords(client, operator, {
        table: "ProgramFeature",
        key: { key: "unknown-feature" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("inspects the recovery fence revision without writes", async () => {
    const { db, client } = fixture();
    db.recoveryFence.findMany.mockResolvedValue([
      { actionId: "admission-root", revision: 3 },
    ]);
    const result = await inspectRecords(client, operator, {
      table: "RecoveryFence",
      key: { actionId: "admission-root" },
    });
    expect(db.recoveryFence.findMany).toHaveBeenCalledWith({
      where: { actionId: "admission-root" },
      select: { actionId: true, revision: true },
      orderBy: [{ actionId: "asc" }],
      take: 26,
    });
    expect(result.rows[0]?.fields).toEqual({
      actionId: "admission-root",
      revision: 3,
    });
    expect(result.rows[0]?.reference).toEqual({
      table: "RecoveryFence",
      key: { actionId: "admission-root" },
    });
  });
});
