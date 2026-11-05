import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainDb } from "../transactions";
import {
  inspectRecords,
  inspectRecoveryEvidence,
  listRecordTables,
} from "./record-inspector";
import type {
  InspectRecordsInput,
  InspectRecoveryEvidenceInput,
  RecordKey,
} from "./record-inspector";

const operator = { operator: true } as const;
const web = { userId: "current-admin" };
const identityMetadataCases = [
  ["LegacySignupDecline", { tuteeId: "declined-source" }],
  ["PersonPartitionReceipt", { id: "partition" }],
  ["RetiredHistoryOwnership", { sourceUserId: "retired" }],
  ["HistoryRowOwnership", { entity: "Tutor", recordId: "original" }],
  ["PersonHistoryCorrectionReceipt", { id: "history-correction" }],
  ["ParticipantConsolidation", { kind: "TUTOR", sourceId: "original" }],
  ["PairingExecutionSuccessor", { sourcePairingId: "original" }],
  ["SessionPlanExecution", { planId: "plan" }],
  ["SessionParticipantExecution", { participantId: "participant" }],
  ["SessionResponseExecution", { responseId: "response" }],
  [
    "QualificationTransferGrant",
    {
      targetTutorId: "target",
      sourceTutorId: "original",
      sourceSubjectId: "source-subject",
      subjectId: "subject",
    },
  ],
  ["PersonParticipationTransferReceipt", { id: "transfer" }],
  [
    "StudentRequestExecutionAssignment",
    { surveyId: "request", pairingId: "pairing" },
  ],
] as const;
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
    recoveryCheckpoint: { findMany: vi.fn().mockResolvedValue([]) },
    programFeature: { findMany: vi.fn().mockResolvedValue([]) },
    recoveryFence: { findMany: vi.fn().mockResolvedValue([]) },
    scheduledProgramRefresh: { findMany: vi.fn().mockResolvedValue([]) },
    monthlyHoursSchedule: { findMany: vi.fn() },
    monthlyHoursReport: { findMany: vi.fn() },
    schoolHoursSchedule: { findMany: vi.fn() },
    schoolHoursReport: { findMany: vi.fn() },
  };
  return { db, client: db as unknown as DomainDb };
}

describe("read-only database inspector", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(identityMetadataCases)(
    "exposes only reviewed %s metadata identically to website and operator",
    async (table, key) => {
      const { db, client } = fixture();
      const privateFields = {
        clientKey: "PRIVATE-SENTINEL",
        intakeSnapshot: { contact: "PRIVATE-SENTINEL" },
        inputHash: "PRIVATE-SENTINEL",
        before: { secret: "PRIVATE-SENTINEL" },
        after: { secret: "PRIVATE-SENTINEL" },
        sources: ["PRIVATE-SENTINEL"],
        subjects: ["PRIVATE-SENTINEL"],
        sourceUserIds: ["PRIVATE-SENTINEL"],
        quarantineUserIds: ["PRIVATE-SENTINEL"],
        assignments: { secret: "PRIVATE-SENTINEL" },
        selection: { secret: "PRIVATE-SENTINEL" },
        result: { secret: "PRIVATE-SENTINEL" },
      };
      const findMany = vi
        .fn()
        .mockResolvedValue([{ ...key, revision: 2, ...privateFields }]);
      Object.assign(db, {
        [table[0]!.toLowerCase() + table.slice(1)]: { findMany },
      });
      const website = await inspectRecords(client, web, { table, key });
      const host = await inspectRecords(client, operator, { table, key });
      expect(website).toEqual(host);
      expect(website.table).toMatchObject({
        available: true,
        keyFields: Object.keys(key),
      });
      expect(website.rows[0]?.reference).toEqual({ table, key });
      expect(JSON.stringify(website.rows)).not.toContain("PRIVATE-SENTINEL");
      for (const call of findMany.mock.calls) {
        const args = call[0] as {
          where: unknown;
          select: Record<string, boolean>;
        };
        expect(args.where).toEqual(key);
        for (const field of Object.keys(privateFields))
          expect(args.select[field], `${table}.${field}`).toBeUndefined();
      }
    },
  );
  it("requires every reviewed compound identity component and refuses extra key fields", async () => {
    const { db, client } = fixture();
    const findMany = vi.fn();
    Object.assign(db, { qualificationTransferGrant: { findMany } });
    const invalidKeys: RecordKey[] = [
      {
        targetTutorId: "target",
        sourceTutorId: "source",
        subjectId: "subject",
      },
      {
        targetTutorId: "target",
        sourceTutorId: "source",
        sourceSubjectId: "source-subject",
        subjectId: "subject",
        receiptId: "receipt",
      },
    ];
    for (const key of invalidKeys)
      await expect(
        inspectRecords(client, operator, {
          table: "QualificationTransferGrant",
          key,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(findMany).not.toHaveBeenCalled();
  });
  it("inspects safe schedule status without selecting private authorization evidence", async () => {
    const { db, client } = fixture();
    db.scheduledProgramRefresh.findMany.mockResolvedValue([
      {
        id: "schedule",
        sourceTermId: "source",
        state: "SCHEDULED",
        version: 1,
        executeAt: new Date("2030-01-01T00:00:00Z"),
        expectedPreparation: { private: "must-not-escape" },
        authorizedById: "private-head",
        authorizedByName: "Private approver",
        authorityRevision: 4,
      },
    ]);
    const result = await inspectRecords(client, web, {
      table: "ScheduledProgramRefresh",
    });
    expect(result.table).toMatchObject({ available: true, keyFields: ["id"] });
    expect(result.rows[0]?.fields).toMatchObject({
      state: "SCHEDULED",
      executeAt: "2030-01-01T00:00:00.000Z",
    });
    const args = db.scheduledProgramRefresh.findMany.mock
      .calls[0]?.[0] as unknown as {
      select: Record<string, boolean>;
    };
    for (const name of [
      "expectedPreparation",
      "authorizedById",
      "authorizedByName",
      "authorityRevision",
    ])
      expect(args.select[name]).toBeUndefined();
    expect(JSON.stringify(result.rows)).not.toContain("must-not-escape");
    expect(result.rows[0]?.fields).not.toHaveProperty("authorizedById");
  });
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
    "MonthlyHoursSchedule",
    "MonthlyHoursReport",
    "SchoolHoursSchedule",
    "SchoolHoursReport",
  ])("refuses row reads for %s even with operator authority", async (table) => {
    const { client } = fixture();
    await expect(
      inspectRecords(client, operator, { table, key: { id: "guessed" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("catalogues reporting tables without fetching their private balances, recipients or capabilities", async () => {
    const { db, client } = fixture();
    const tables = await listRecordTables(client, web);
    for (const name of [
      "MonthlyHoursSchedule",
      "MonthlyHoursReport",
      "SchoolHoursSchedule",
      "SchoolHoursReport",
    ]) {
      const table = tables.find((entry) => entry.name === name);
      expect(table).toMatchObject({ available: false, keyFields: ["id"] });
      expect(table?.fields.every((field) => !field.readable)).toBe(true);
      await expect(
        inspectRecords(client, web, {
          table: name,
          key: { id: "private-report" },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(db.monthlyHoursSchedule.findMany).not.toHaveBeenCalled();
    expect(db.monthlyHoursReport.findMany).not.toHaveBeenCalled();
    expect(db.schoolHoursSchedule.findMany).not.toHaveBeenCalled();
    expect(db.schoolHoursReport.findMany).not.toHaveBeenCalled();
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

describe("safe recovery journal evidence", () => {
  function change(overrides: Record<string, unknown> = {}) {
    return {
      id: 1n,
      actionId: "admission",
      eventId: "registration",
      entity: "User",
      operation: "UPDATE",
      recordKey: { id: "account", personId: "person" },
      changedFields: ["name", "passwordHash"],
      before: { passwordHash: "private-before" },
      after: { passwordHash: "private-after" },
      ...overrides,
    };
  }

  it("follows a checkpoint's exact persisted action to journal events without reading its scope", async () => {
    const { db, client } = fixture();
    db.recoveryCheckpoint.findMany.mockResolvedValue([
      {
        id: "checkpoint",
        actionId: "root",
        sourceEntity: "PasswordResetToken",
        sourceId: "private-token",
        scope: { secret: "private-scope" },
      },
    ]);
    db.recoveryChange.findMany.mockResolvedValue([
      change({ actionId: "root", eventId: "event" }),
    ]);
    const input = { table: "RecoveryCheckpoint", key: { id: "checkpoint" } };
    const website = await inspectRecords(client, web, input);
    const host = await inspectRecords(client, operator, input);
    expect(website).toEqual(host);
    expect(website.rows[0]?.evidence).toEqual({
      kind: "RECOVERY_METADATA",
      interpretation: "RECORDED_RELATION_ONLY",
      affectedRecord: null,
      relatedRecords: [{ table: "RecoveryAction", key: { id: "root" } }],
    });
    expect(JSON.stringify(website)).not.toContain("private-scope");
    db.recoveryCheckpoint.findMany.mockClear();
    const evidence = await inspectRecoveryEvidence(client, web, input);
    expect(evidence).toEqual(
      await inspectRecoveryEvidence(client, operator, input),
    );
    expect(evidence.changes[0]?.evidence?.relatedRecords).toContainEqual({
      table: "RecoveryEvent",
      key: { id: "event" },
    });
    expect(db.recoveryCheckpoint.findMany).toHaveBeenCalledWith({
      where: { id: "checkpoint" },
      select: { actionId: true },
      take: 1,
    });
    expect(db.recoveryChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ actionId: "root" }] },
        take: 26,
      }),
    );
    expect(JSON.stringify(evidence)).not.toContain("private-token");
    expect(JSON.stringify(evidence)).not.toContain("private-scope");
  });

  it.each([
    ["RecoveryReceipt", { id: "receipt" }, { actionId: "root" }],
    ["RecoveryWorkflowDraft", { id: "draft" }, { actionId: "root" }],
    [
      "RecoveryDeliveryEffect",
      { id: "effect" },
      { actionId: "root", eventId: "event" },
    ],
    [
      "RecoveryDeliveryCoverage",
      { eventId: "event" },
      { actionId: "root", eventId: "event" },
    ],
  ] as const)(
    "anchors %s only through reviewed persisted recovery identities",
    async (table, key, anchor) => {
      const { db, client } = fixture();
      const findMany = vi
        .fn()
        .mockResolvedValue([
          { ...key, ...anchor, answers: { secret: "private-answers" } },
        ]);
      Object.assign(db, {
        [table[0]!.toLowerCase() + table.slice(1)]: { findMany },
      });
      const inspected = await inspectRecords(client, web, { table, key });
      expect(inspected.rows[0]?.evidence?.relatedRecords).toEqual(
        Object.entries(anchor).map(([name, id]) => ({
          table: name === "actionId" ? "RecoveryAction" : "RecoveryEvent",
          key: { id },
        })),
      );
      expect(JSON.stringify(inspected)).not.toContain("private-answers");
      findMany.mockClear();
      await inspectRecoveryEvidence(client, web, { table, key });
      expect(findMany).toHaveBeenCalledWith({
        where: key,
        select: Object.fromEntries(
          Object.keys(anchor).map((name) => [name, true]),
        ),
        take: 1,
      });
      expect(db.recoveryChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [anchor] },
        }),
      );
    },
  );

  it("links delivery cancellation to its exact effect without treating its recovery key as a receipt ID", async () => {
    const { db, client } = fixture();
    const findMany = vi.fn().mockResolvedValue([
      {
        effectId: "effect",
        recoveryKey: "opaque-request-key",
        disposition: "PENDING_CANCELLED",
      },
    ]);
    Object.assign(db, { recoveryDeliveryCancellation: { findMany } });
    const inspected = await inspectRecords(client, web, {
      table: "RecoveryDeliveryCancellation",
      key: { effectId: "effect" },
    });
    expect(inspected.rows[0]?.evidence?.relatedRecords).toEqual([
      { table: "RecoveryDeliveryEffect", key: { id: "effect" } },
    ]);
  });

  it.each([
    { records: [] },
    { records: [{ actionId: null }] },
    { records: [{ actionId: { secret: "private-root" } }] },
    { records: [{ actionId: "x".repeat(1025) }] },
  ])(
    "does not infer an action for absent or malformed checkpoint metadata (%j)",
    async ({ records }) => {
      const { db, client } = fixture();
      db.recoveryCheckpoint.findMany.mockResolvedValue(records);
      const result = await inspectRecoveryEvidence(client, web, {
        table: "RecoveryCheckpoint",
        key: { id: "checkpoint" },
      });
      expect(result.changes).toEqual([]);
      expect(db.recoveryChange.findMany).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private-root");
    },
  );

  it("binds checkpoint pagination to both the source key and its persisted action", async () => {
    const { db, client } = fixture();
    const source = { table: "RecoveryCheckpoint", key: { id: "checkpoint" } };
    db.recoveryCheckpoint.findMany.mockResolvedValue([{ actionId: "root" }]);
    db.recoveryChange.findMany.mockResolvedValue([
      change(),
      change({ id: 2n }),
    ]);
    const first = await inspectRecoveryEvidence(client, web, {
      ...source,
      limit: 1,
    });
    db.recoveryChange.findMany.mockClear();
    db.recoveryChange.findMany.mockResolvedValue([]);
    await inspectRecoveryEvidence(client, web, {
      ...source,
      cursor: first.nextCursor!,
    });
    expect(db.recoveryChange.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [{ actionId: "root" }, { id: { gt: 1n } }] },
      }),
    );
    db.recoveryChange.findMany.mockClear();
    db.recoveryCheckpoint.findMany.mockResolvedValue([
      { actionId: "different-root" },
    ]);
    await expect(
      inspectRecoveryEvidence(client, web, {
        ...source,
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.recoveryChange.findMany).not.toHaveBeenCalled();
    db.user.findUnique.mockResolvedValue({ role: "VIEWER" });
    db.recoveryCheckpoint.findMany.mockClear();
    await expect(
      inspectRecoveryEvidence(client, web, source),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.recoveryCheckpoint.findMany).not.toHaveBeenCalled();
  });

  it("projects only the approved target identity and column names identically on both transports", async () => {
    const { db, client } = fixture();
    db.recoveryChange.findMany.mockResolvedValue([change()]);
    const website = await inspectRecords(client, web, {
      table: "RecoveryChange",
    });
    const cli = await inspectRecords(client, operator, {
      table: "RecoveryChange",
    });
    expect(website).toEqual(cli);
    expect(website.rows[0]?.fields).toMatchObject({
      recordKey: { id: "account" },
      changedFields: ["name", "passwordHash"],
    });
    expect(website.rows[0]?.evidence).toEqual({
      kind: "RECOVERY_JOURNAL",
      interpretation: "RECORDED_RELATION_ONLY",
      affectedRecord: { table: "User", key: { id: "account" } },
      relatedRecords: [
        { table: "RecoveryAction", key: { id: "admission" } },
        { table: "RecoveryEvent", key: { id: "registration" } },
      ],
    });
    for (const args of db.recoveryChange.findMany.mock.calls.map(
      ([arg]) => arg as unknown as { select: Record<string, boolean> },
    )) {
      expect(args.select.recordKey).toBe(true);
      expect(args.select.changedFields).toBe(true);
      expect(args.select.before).toBeUndefined();
      expect(args.select.after).toBeUndefined();
    }
    expect(JSON.stringify(website)).not.toContain("private-before");
    expect(JSON.stringify(website)).not.toContain("private-after");
    expect(website.rows[0]?.fields.recordKey).not.toHaveProperty("personId");
  });

  it("retains the complete persisted three-column qualification identity", async () => {
    const { db, client } = fixture();
    db.recoveryChange.findMany.mockResolvedValue([
      change({
        entity: "QualificationGrant",
        recordKey: {
          tutorId: "t",
          sourceSubjectId: "source",
          subjectId: "subject",
        },
        changedFields: ["grantedAt"],
      }),
    ]);
    const result = await inspectRecords(client, web, {
      table: "RecoveryChange",
    });
    const key = {
      tutorId: "t",
      sourceSubjectId: "source",
      subjectId: "subject",
    };
    expect(result.rows[0]?.fields.recordKey).toEqual(key);
    expect(result.rows[0]?.evidence?.affectedRecord).toEqual({
      table: "QualificationGrant",
      key,
    });
  });

  it.each([
    "UnknownFutureTable",
    "DirectMessage",
    "PasswordResetToken",
    "HistoricalRecordClaimReceipt",
    "SessionCalendarToken",
    "MonthlyHoursReport",
  ])(
    "does not expose protected target keys or their JSON evidence for %s",
    async (entity) => {
      const { db, client } = fixture();
      db.recoveryChange.findMany.mockResolvedValue([
        change({
          entity,
          recordKey: { id: "private-capability", tokenHash: "private-token" },
          changedFields: ["tokenHash"],
        }),
      ]);
      const result = await inspectRecords(client, operator, {
        table: "RecoveryChange",
      });
      expect(result.rows[0]?.evidence?.affectedRecord).toBeNull();
      expect(result.rows[0]?.fields).not.toHaveProperty("recordKey");
      expect(result.rows[0]?.fields).not.toHaveProperty("changedFields");
      expect(JSON.stringify(result)).not.toContain("private-capability");
      expect(JSON.stringify(result)).not.toContain("private-token");
    },
  );

  it.each([
    null,
    [],
    "private-json",
    { id: { secret: "private-json" } },
    { id: "account", arbitrary: "private-json" },
    { personId: "person" },
    { id: "x".repeat(1025) },
    { id: 12 },
  ])(
    "omits malformed journal keys without echoing arbitrary JSON (%j)",
    async (recordKey) => {
      const { db, client } = fixture();
      db.recoveryChange.findMany.mockResolvedValue([change({ recordKey })]);
      const result = await inspectRecords(client, web, {
        table: "RecoveryChange",
      });
      expect(result.rows[0]?.fields).not.toHaveProperty("recordKey");
      expect(result.rows[0]?.evidence?.affectedRecord).toBeNull();
      expect(result.rows[0]?.omitted).toContainEqual({
        field: "recordKey",
        reason: "restricted",
      });
      expect(JSON.stringify(result)).not.toContain("private-json");
    },
  );

  it.each([
    null,
    "name",
    {},
    ["name", "name"],
    ["missingField"],
    ["name;SQL"],
    ["name", { secret: "private-json" }],
    ["n".repeat(101)],
    Array.from({ length: 201 }, () => "name"),
    ["emailVerificationCodes"],
  ])(
    "omits malformed, unknown or unbounded changed column names (%j)",
    async (changedFields) => {
      const { db, client } = fixture();
      db.recoveryChange.findMany.mockResolvedValue([change({ changedFields })]);
      const result = await inspectRecords(client, web, {
        table: "RecoveryChange",
      });
      expect(result.rows[0]?.fields).not.toHaveProperty("changedFields");
      expect(result.rows[0]?.omitted).toContainEqual({
        field: "changedFields",
        reason: "restricted",
      });
      expect(JSON.stringify(result)).not.toContain("private-json");
    },
  );

  it("never exposes other JSON snapshots after enabling the two reviewed journal projections", async () => {
    const { client } = fixture();
    const tables = await listRecordTables(client, web);
    const readableJson = tables.flatMap((table) =>
      table.fields
        .filter((field) => field.type === "Json" && field.readable)
        .map((field) => `${table.name}.${field.name}`),
    );
    expect(readableJson.sort()).toEqual([
      "RecoveryChange.changedFields",
      "RecoveryChange.recordKey",
    ]);
  });

  it("uses bounded exact compound-key journal filters and source-bound pagination", async () => {
    const { db, client } = fixture();
    const source = {
      table: "PairingTutee",
      key: { pairingId: "p'$(untrusted)", tuteeId: "t" },
    };
    db.recoveryChange.findMany.mockResolvedValueOnce([
      change({
        id: 9007199254740993n,
        entity: source.table,
        recordKey: source.key,
        changedFields: ["tuteeId"],
      }),
      change({
        id: 9007199254740994n,
        entity: source.table,
        recordKey: source.key,
        changedFields: [],
      }),
    ]);
    const first = await inspectRecoveryEvidence(client, web, {
      ...source,
      limit: 1,
    });
    expect(first).toMatchObject({
      version: 1,
      interpretation: "RECORDED_RELATION_ONLY",
      source,
    });
    expect(first.changes).toHaveLength(1);
    expect(db.recoveryChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              entity: source.table,
              AND: [
                {
                  recordKey: {
                    path: ["pairingId"],
                    equals: source.key.pairingId,
                  },
                },
                { recordKey: { path: ["tuteeId"], equals: "t" } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: 2,
      }),
    );
    db.recoveryChange.findMany.mockResolvedValue([]);
    await inspectRecoveryEvidence(client, web, {
      ...source,
      cursor: first.nextCursor!,
      limit: 1,
    });
    expect(db.recoveryChange.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [expect.any(Object), { id: { gt: 9007199254740993n } }] },
      }),
    );
    await expect(
      inspectRecoveryEvidence(client, web, {
        table: "User",
        key: { id: "another-source" },
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each([
    ["RecoveryAction", { id: "a" }, { actionId: "a" }],
    ["RecoveryEvent", { id: "e" }, { eventId: "e" }],
    ["RecoveryChange", { id: "9007199254740993" }, { id: 9007199254740993n }],
  ] as const)(
    "navigates %s using a fixed journal identity filter",
    async (table, key, where) => {
      const { db, client } = fixture();
      await inspectRecoveryEvidence(client, web, { table, key });
      expect(db.recoveryChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [where] },
          take: 26,
        }),
      );
    },
  );

  it("shares evidence output and page limits across website and CLI", async () => {
    const { db, client } = fixture();
    db.recoveryChange.findMany.mockResolvedValue([change()]);
    const input = { table: "User", key: { id: "account" } };
    expect(await inspectRecoveryEvidence(client, web, input)).toEqual(
      await inspectRecoveryEvidence(client, operator, input),
    );
    for (const authority of [web, operator]) {
      for (const limit of [0, 51, 1.5])
        await expect(
          inspectRecoveryEvidence(client, authority, { ...input, limit }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("refuses protected source existence, invalid keys/cursors and revoked current authority before querying evidence", async () => {
    const { db, client } = fixture();
    await expect(
      inspectRecoveryEvidence(client, operator, {
        table: "HistoricalRecordClaimReceipt",
        key: { tokenHash: "private-token" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const invalidInputs: InspectRecoveryEvidenceInput[] = [
      { table: "PairingTutee", key: { pairingId: "missing-student" } },
      { table: "User", key: { id: "account" }, cursor: "malformed" },
      { table: "User", key: { id: "account" }, cursor: "x".repeat(8193) },
    ];
    for (const input of invalidInputs)
      await expect(
        inspectRecoveryEvidence(client, web, input),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.user.findUnique.mockResolvedValue({ role: "VIEWER" });
    await expect(
      inspectRecoveryEvidence(client, web, {
        table: "User",
        key: { id: "account" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.recoveryChange.findMany).not.toHaveBeenCalled();
  });
});
