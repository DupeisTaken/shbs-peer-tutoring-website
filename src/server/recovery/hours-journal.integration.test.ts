import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

const reportTables = [
  "MonthlyHoursSchedule",
  "MonthlyHoursReport",
  "SchoolHoursSchedule",
  "SchoolHoursReport",
];

const privateFields = [
  "snapshot",
  "openingBaseline",
  "sourceBaseline",
  "recipientEmails",
  "recipientUserIds",
  "intendedRecipients",
  "linkTokenHash",
  "reason",
];

async function rollbackFixture(work: (tx: TransactionDb) => Promise<void>) {
  // Recovery evidence is append-only. Roll back synthetic evidence and any DDL
  // together instead of weakening retention or leaving altered global coverage.
  await expect(
    db.$transaction(
      async (tx) => {
        await work(tx);
        throw new Error("rollback synthetic hours recovery journal");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic hours recovery journal");
}

async function createHourRows(
  tx: TransactionDb,
  prefix: string,
  schoolGeneratedById?: string,
) {
  const privateValues = {
    snapshot: { text: "private-report-snapshot" },
    openingBaseline: { text: "private-opening-balance" },
    sourceBaseline: { text: "private-source-balance" },
    intendedRecipients: ["private-school-recipient@example.test"],
    linkTokenHash: "private-capability-hash",
    reason: "private-adjustment-reason",
  };
  const monthlySchedule = await tx.monthlyHoursSchedule.create({
    data: {
      id: `${prefix}-monthly-schedule`,
      recipientUserIds: ["private-staff-recipient"],
    },
  });
  const monthlyReport = await tx.monthlyHoursReport.create({
    data: {
      id: `${prefix}-monthly-report`,
      scheduleId: monthlySchedule.id,
      month: "2026-10",
      revision: 1,
      configVersion: 0,
      timeZone: "Asia/Shanghai",
      contentHash: "a".repeat(64),
      generationHash: "b".repeat(64),
      generationKey: `${prefix}-monthly-key`,
      snapshot: privateValues.snapshot,
      intendedRecipients: privateValues.intendedRecipients,
      reason: privateValues.reason,
    },
  });
  const schoolSchedule = await tx.schoolHoursSchedule.create({
    data: {
      id: `${prefix}-school-schedule`,
      recipientEmails: privateValues.intendedRecipients,
      openingBaseline: privateValues.openingBaseline,
    },
  });
  const schoolReport = await tx.schoolHoursReport.create({
    data: {
      id: `${prefix}-school-report`,
      scheduleId: schoolSchedule.id,
      month: "2026-10",
      revision: 1,
      configVersion: 0,
      baselineVersion: 0,
      timeZone: "Asia/Shanghai",
      contentHash: "c".repeat(64),
      generationHash: "d".repeat(64),
      generationKey: `${prefix}-school-key`,
      generatedById: schoolGeneratedById,
      snapshot: privateValues.snapshot,
      sourceBaseline: privateValues.sourceBaseline,
      intendedRecipients: privateValues.intendedRecipients,
      linkTokenHash: privateValues.linkTokenHash,
      reason: privateValues.reason,
    },
  });
  return { monthlySchedule, monthlyReport, schoolSchedule, schoolReport };
}

const triggerMetadata = (tx: TransactionDb) => tx.$queryRaw`
  SELECT oid::text, tgfoid::text, tgtype::int, tgenabled::text,
    pg_get_triggerdef(oid) AS definition
  FROM pg_trigger WHERE tgrelid='"SchoolHoursSchedule"'::regclass
    AND tgname='recovery_change_journal'`;

it("reuses compatible origin and always triggers and installs absent coverage", async () => {
  await rollbackFixture(async (tx) => {
    const before = await triggerMetadata(tx);
    await tx.$executeRaw`SELECT recovery_install_hours_journal()`;
    expect(await triggerMetadata(tx)).toEqual(before);
    await tx.$executeRawUnsafe(
      'ALTER TABLE "SchoolHoursSchedule" ENABLE ALWAYS TRIGGER recovery_change_journal',
    );
    const always = await triggerMetadata(tx);
    await tx.$executeRaw`SELECT recovery_install_hours_journal()`;
    expect(await triggerMetadata(tx)).toEqual(always);
    await tx.$executeRawUnsafe(
      'DROP TRIGGER recovery_change_journal ON "SchoolHoursSchedule"',
    );
    await tx.$executeRaw`SELECT recovery_install_hours_journal()`;
    expect(await triggerMetadata(tx)).toMatchObject([
      { tgtype: 29, tgenabled: "O" },
    ]);
  });
});

it.each([
  [
    "disabled",
    'ALTER TABLE "SchoolHoursSchedule" DISABLE TRIGGER recovery_change_journal',
  ],
  [
    "replica-only",
    'ALTER TABLE "SchoolHoursSchedule" ENABLE REPLICA TRIGGER recovery_change_journal',
  ],
  [
    "wrong function",
    'CREATE OR REPLACE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "SchoolHoursSchedule" FOR EACH ROW EXECUTE FUNCTION pg_temp.hours_wrong_journal()',
  ],
  [
    "missing events",
    'CREATE OR REPLACE TRIGGER recovery_change_journal AFTER INSERT ON "SchoolHoursSchedule" FOR EACH ROW EXECUTE FUNCTION recovery_capture_change()',
  ],
  [
    "statement orientation",
    'CREATE OR REPLACE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "SchoolHoursSchedule" FOR EACH STATEMENT EXECUTE FUNCTION recovery_capture_change()',
  ],
  [
    "unexpected arguments",
    "CREATE OR REPLACE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON \"SchoolHoursSchedule\" FOR EACH ROW EXECUTE FUNCTION recovery_capture_change('unexpected')",
  ],
  [
    "conditional coverage",
    'CREATE OR REPLACE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "SchoolHoursSchedule" FOR EACH ROW WHEN (true) EXECUTE FUNCTION recovery_capture_change()',
  ],
])(
  "refuses %s coverage without replacing the existing trigger",
  async (_name, ddl) => {
    await rollbackFixture(async (tx) => {
      await tx.$executeRawUnsafe(
        "CREATE FUNCTION pg_temp.hours_wrong_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN COALESCE(NEW,OLD); END $$",
      );
      // All DDL values above are fixed test constants, never external identifiers.
      await tx.$executeRawUnsafe(ddl);
      const before = await triggerMetadata(tx);
      await tx.$executeRawUnsafe("SAVEPOINT hours_guard_check");
      await expect(
        tx.$executeRaw`SELECT recovery_install_hours_journal()`,
      ).rejects.toThrow("incompatible");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT hours_guard_check");
      expect(await triggerMetadata(tx)).toEqual(before);
    });
  },
);

it("covers all hours tables with the origin recovery journal after migration", async () => {
  const coverage = await db.$queryRaw<
    Array<{
      tableName: string;
      enabled: string;
      events: number;
      journal: string;
    }>
  >`
    SELECT c.relname AS "tableName", t.tgenabled::text AS enabled,
      t.tgtype::int AS events, t.tgfoid::regprocedure::text AS journal
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${reportTables}::text[])
      AND t.tgname='recovery_change_journal' ORDER BY c.relname`;
  expect(coverage.map((row) => row.tableName)).toEqual(
    [...reportTables].sort(),
  );
  for (const row of coverage) {
    expect(["O", "A"]).toContain(row.enabled);
    expect(row.events).toBe(29);
    expect(row.journal).toBe("recovery_capture_change()");
  }
});

it("journals reporting consequences without copying report bodies or private delivery material", async () => {
  const prefix = `hours-journal-${randomUUID()}`;
  await rollbackFixture(async (tx) => {
    const root = await tx.recoveryAction.create({
      data: {
        id: `${prefix}-root`,
        kind: "INITIAL_ADMISSION",
        applicationId: `${prefix}-application`,
        before: {},
        after: {},
      },
    });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action', ${root.id}, true), set_config('shbs.recovery_kind', 'UNSUPPORTED', true)`;
    await createHourRows(tx, prefix);
    await tx.schoolHoursSchedule.update({
      where: { id: `${prefix}-school-schedule` },
      data: {
        openingBaseline: { text: "updated-private-opening-balance" },
      },
    });
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: root.id, entity: { in: reportTables } },
      orderBy: { id: "asc" },
    });
    expect(changes).toHaveLength(5);
    expect([...new Set(changes.map((change) => change.entity))].sort()).toEqual(
      [...reportTables].sort(),
    );
    const update = changes.find((change) => change.operation === "UPDATE");
    expect(update?.changedFields).toContain("openingBaseline");
    for (const change of changes) {
      expect(change.after).toHaveProperty("id");
      for (const field of privateFields)
        expect(change.after).not.toHaveProperty(field);
      const evidence = JSON.stringify({
        before: change.before,
        after: change.after,
        recordKey: change.recordKey,
      });
      expect(evidence).not.toContain("private-");
    }
  });
});

it("baselines existing related rows once without changing reports or inventing historical causality", async () => {
  const prefix = `hours-baseline-${randomUUID()}`;
  await rollbackFixture(async (tx) => {
    // Write these records before establishing the tracked identities: this
    // reproduces old rows whose journal never observed their original insertion.
    const rows = await createHourRows(tx, prefix);
    const root = await tx.recoveryAction.create({
      data: {
        id: `${prefix}-root`,
        kind: "INITIAL_ADMISSION",
        applicationId: `${prefix}-application`,
        before: {},
        after: {},
      },
    });
    const unrelated = await tx.recoveryAction.create({
      data: {
        id: `${prefix}-unrelated`,
        kind: "INITIAL_ADMISSION",
        applicationId: `${prefix}-unrelated-application`,
        before: {},
        after: {},
      },
    });
    const completed = await tx.recoveryAction.create({
      data: {
        id: `${prefix}-completed`,
        kind: "INITIAL_ADMISSION",
        applicationId: `${prefix}-completed-application`,
        before: {},
        after: {},
      },
    });
    await tx.recoveryTrackedEntity.createMany({
      data: [
        {
          actionId: root.id,
          entity: "MonthlyHoursSchedule",
          recordId: rows.monthlySchedule.id,
        },
        {
          actionId: root.id,
          entity: "SchoolHoursSchedule",
          recordId: rows.schoolSchedule.id,
        },
        {
          actionId: completed.id,
          entity: "SchoolHoursSchedule",
          recordId: rows.schoolSchedule.id,
        },
      ],
    });
    await tx.recoveryReceipt.create({
      data: {
        actionId: completed.id,
        actorId: `${prefix}-operator`,
        clientKey: randomUUID(),
        inputHash: "synthetic-input",
        reason: "Synthetic completed recovery",
        channel: "OPERATOR",
        fingerprint: "synthetic-fingerprint",
        evidence: {},
      },
    });
    expect(
      await tx.recoveryChange.count({ where: { actionId: root.id } }),
    ).toBe(0);
    await tx.$executeRaw`SELECT recovery_register_hours_baseline()`;
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: root.id },
      orderBy: { id: "asc" },
    });
    expect(changes).toHaveLength(4);
    expect(changes.map((change) => change.entity).sort()).toEqual(
      [...reportTables].sort(),
    );
    for (const change of changes) {
      expect(change.operation).toBe("BASELINE");
      expect(change.before).toBeNull();
      expect(change.changedFields).toBeNull();
      for (const field of privateFields)
        expect(change.after).not.toHaveProperty(field);
      expect(
        JSON.stringify({ after: change.after, recordKey: change.recordKey }),
      ).not.toContain("private-");
    }
    expect(
      await tx.recoveryEvent.findMany({ where: { actionId: root.id } }),
    ).toMatchObject([
      { kind: "UNSUPPORTED", transactionId: "hours-journal-baseline-v1" },
    ]);
    expect(
      await tx.recoveryChange.count({
        where: { actionId: { in: [unrelated.id, completed.id] } },
      }),
    ).toBe(0);
    expect(
      await tx.recoveryTrackedEntity.count({ where: { actionId: root.id } }),
    ).toBe(4);
    const fence = await tx.recoveryFence.findUniqueOrThrow({
      where: { actionId: root.id },
    });
    await tx.$executeRaw`SELECT recovery_register_hours_baseline()`;
    expect(
      await tx.recoveryChange.findMany({
        where: { actionId: root.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(changes);
    expect(
      await tx.recoveryFence.findUniqueOrThrow({
        where: { actionId: root.id },
      }),
    ).toEqual(fence);
    expect(
      await tx.monthlyHoursSchedule.findUniqueOrThrow({
        where: { id: rows.monthlySchedule.id },
      }),
    ).toEqual(rows.monthlySchedule);
    expect(
      await tx.monthlyHoursReport.findUniqueOrThrow({
        where: { id: rows.monthlyReport.id },
      }),
    ).toEqual(rows.monthlyReport);
    expect(
      await tx.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: rows.schoolSchedule.id },
      }),
    ).toEqual(rows.schoolSchedule);
    expect(
      await tx.schoolHoursReport.findUniqueOrThrow({
        where: { id: rows.schoolReport.id },
      }),
    ).toEqual(rows.schoolReport);
  });
});

it("discovers report-to-schedule-to-sibling links in one baseline call and leaves a second call unchanged", async () => {
  const prefix = `hours-baseline-chain-${randomUUID()}`;
  await rollbackFixture(async (tx) => {
    const actorId = `${prefix}-actor`;
    const rows = await createHourRows(tx, prefix, actorId);
    const schedule = await tx.schoolHoursSchedule.update({
      where: { id: rows.schoolSchedule.id },
      data: { headReportId: rows.schoolReport.id },
    });
    const sibling = await tx.schoolHoursReport.create({
      data: {
        // Visit this sibling before the head report to exercise reverse links.
        id: `${prefix}-a-earlier-report`,
        scheduleId: schedule.id,
        month: "2026-09",
        revision: 1,
        configVersion: 0,
        baselineVersion: 0,
        timeZone: "Asia/Shanghai",
        contentHash: "e".repeat(64),
        generationHash: "f".repeat(64),
        generationKey: `${prefix}-earlier-key`,
        snapshot: { text: "private-earlier-snapshot" },
        sourceBaseline: { text: "private-earlier-balance" },
        intendedRecipients: ["private-earlier-recipient@example.test"],
        linkTokenHash: "private-earlier-capability-hash",
      },
    });
    const root = await tx.recoveryAction.create({
      data: {
        id: `${prefix}-root`,
        kind: "INITIAL_ADMISSION",
        applicationId: `${prefix}-application`,
        before: {},
        after: {},
      },
    });
    await tx.recoveryTrackedEntity.create({
      data: { actionId: root.id, entity: "User", recordId: actorId },
    });
    await tx.$executeRaw`SELECT recovery_register_hours_baseline()`;
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: root.id },
      orderBy: { id: "asc" },
    });
    expect(changes).toHaveLength(3);
    expect(changes.map((change) => change.recordKey)).toEqual([
      expect.objectContaining({ id: rows.schoolReport.id }),
      expect.objectContaining({ id: schedule.id }),
      expect.objectContaining({ id: sibling.id }),
    ]);
    for (const change of changes) {
      expect(change.operation).toBe("BASELINE");
      expect(JSON.stringify(change.after)).not.toContain("private-");
      for (const field of privateFields)
        expect(change.after).not.toHaveProperty(field);
    }
    const tracked = await tx.recoveryTrackedEntity.findMany({
      where: { actionId: root.id },
      orderBy: [{ entity: "asc" }, { recordId: "asc" }],
    });
    expect(tracked).toHaveLength(4);
    const fence = await tx.recoveryFence.findUniqueOrThrow({
      where: { actionId: root.id },
    });
    await tx.$executeRaw`SELECT recovery_register_hours_baseline()`;
    expect(
      await tx.recoveryChange.findMany({
        where: { actionId: root.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(changes);
    expect(
      await tx.recoveryTrackedEntity.findMany({
        where: { actionId: root.id },
        orderBy: [{ entity: "asc" }, { recordId: "asc" }],
      }),
    ).toEqual(tracked);
    expect(
      await tx.recoveryFence.findUniqueOrThrow({
        where: { actionId: root.id },
      }),
    ).toEqual(fence);
    expect(
      await tx.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: schedule.id },
      }),
    ).toEqual(schedule);
    expect(
      await tx.schoolHoursReport.findUniqueOrThrow({
        where: { id: rows.schoolReport.id },
      }),
    ).toEqual(rows.schoolReport);
    expect(
      await tx.schoolHoursReport.findUniqueOrThrow({
        where: { id: sibling.id },
      }),
    ).toEqual(sibling);
  });
});
