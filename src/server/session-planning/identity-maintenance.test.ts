import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { planningWeeks } from "~/lib/session-planning";
import { db } from "~/server/db";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { ensureSessionPlanningWindow, lockSessionPlanning } from ".";
import { readSchedulingMaintenance } from "./maintenance";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const now = new Date("2026-10-26T00:00:00Z");
const window = { ...planningWeeks(now, "Asia/Shanghai"), timeZone: "Asia/Shanghai" };
const id = (name: string) => `identity-maintenance-${name}`;
const options = { timeout: 15_000, maxWait: 3000 };

function transaction<T>(work: (tx: TransactionDb) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    await lockSessionPlanning(tx);
    return work(tx);
  }, options);
}

async function pending(tx: TransactionDb, table: string) {
  return tx.$queryRaw<{ id: bigint; sourceTable: string; publicationPending: boolean; settlementPending: boolean }[]>`
    SELECT id,"sourceTable","publicationPending","settlementPending"
    FROM public."SchedulingDirtyEvent"
    WHERE "sourceTable"=${table} AND "publicationPending" ORDER BY id`;
}

async function cleanPublication() {
  // Exercise the real publisher/acknowledgement, rather than manufacture a clean
  // version in SQL. The retained historical fixture has no current recurrence.
  for (let pass = 0; pass < 4; pass++) {
    await ensureSessionPlanningWindow(db, now);
    if ((await transaction((tx) => readSchedulingMaintenance(tx, window))).current) return;
  }
  throw new Error("Identity fixture did not reach a verified warm publication.");
}

async function expectDirty(tx: TransactionDb, table: string) {
  const events = await pending(tx, table);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.sourceTable === table && event.publicationPending && event.settlementPending)).toBe(true);
  expect((await readSchedulingMaintenance(tx, window)).current).toBe(false);
}

const survey = (name: string) => ({
  id: id(name), email: `${name}@example.test`, intakeTermId: id("current-term"),
  payload: {}, policyRevision: "synthetic", policySnapshot: {},
  tokenHash: id(`${name}-token`), expiresAt: new Date("2026-12-01T00:00:00Z"),
});

type Dependency = {
  table: string;
  insert: (tx: TransactionDb) => Promise<unknown>;
  update: (tx: TransactionDb) => Promise<unknown>;
  read: (tx: TransactionDb) => Promise<unknown>;
};
const dependencies: Dependency[] = [
  {
    table: "ParticipantConsolidation",
    insert: (tx) => tx.participantConsolidation.create({ data: {
      kind: "TUTOR", sourceId: id("tutor-source"), targetId: id("tutor-target"), receiptId: id("transfer"), effectiveAt: now,
    } }),
    update: (tx) => tx.participantConsolidation.update({ where: { kind_sourceId: { kind: "TUTOR", sourceId: id("tutor-source") } }, data: { active: false, revision: { increment: 1 } } }),
    read: (tx) => tx.participantConsolidation.findUnique({ where: { kind_sourceId: { kind: "TUTOR", sourceId: id("tutor-source") } } }),
  },
  {
    table: "PairingExecutionSuccessor",
    insert: (tx) => tx.pairingExecutionSuccessor.create({ data: { sourcePairingId: id("pairing-source"), targetPairingId: id("pairing-target"), receiptId: id("transfer"), effectiveAt: now } }),
    update: (tx) => tx.pairingExecutionSuccessor.update({ where: { sourcePairingId: id("pairing-source") }, data: { targetPairingId: id("pairing-other"), revision: { increment: 1 } } }),
    read: (tx) => tx.pairingExecutionSuccessor.findUnique({ where: { sourcePairingId: id("pairing-source") } }),
  },
  {
    table: "SessionPlanExecution",
    insert: (tx) => tx.sessionPlanExecution.create({ data: {
      planId: id("plan"), tutorId: id("tutor-target"), receiptId: id("transfer"),
      assignments: [{ sourcePairingId: id("pairing-source"), targetPairingId: id("pairing-target") }],
    } }),
    update: (tx) => tx.sessionPlanExecution.update({ where: { planId: id("plan") }, data: {
      tutorId: id("tutor-other"), revision: { increment: 1 },
      assignments: [{ sourcePairingId: id("pairing-source"), targetPairingId: id("pairing-other") }],
    } }),
    read: (tx) => tx.sessionPlanExecution.findUnique({ where: { planId: id("plan") } }),
  },
  {
    table: "SessionParticipantExecution",
    insert: (tx) => tx.sessionParticipantExecution.create({ data: { participantId: id("participant"), tuteeId: id("learner-source"), sourceSurveyIds: [id("owner-survey")], receiptId: id("transfer") } }),
    update: (tx) => tx.sessionParticipantExecution.update({ where: { participantId: id("participant") }, data: { tuteeId: id("learner-target"), revision: { increment: 1 } } }),
    read: (tx) => tx.sessionParticipantExecution.findUnique({ where: { participantId: id("participant") } }),
  },
  {
    table: "SessionResponseExecution",
    insert: (tx) => tx.sessionResponseExecution.create({ data: { responseId: id("response"), userId: id("reader"), profileKind: "TUTEE", profileId: id("learner-source"), receiptId: id("transfer") } }),
    update: (tx) => tx.sessionResponseExecution.update({ where: { responseId: id("response") }, data: { userId: id("other-reader"), profileId: id("learner-target"), revision: { increment: 1 } } }),
    read: (tx) => tx.sessionResponseExecution.findUnique({ where: { responseId: id("response") } }),
  },
  {
    table: "RetiredHistoryOwnership",
    // Retirement's real AFTER trigger owns this INSERT. Do not delete its row or
    // disable authority guards to manufacture an otherwise impossible fixture.
    insert: (tx) => tx.user.update({ where: { id: id("retiring") }, data: { mergedIntoId: id("reader") } }),
    update: (tx) => tx.retiredHistoryOwnership.update({ where: { sourceUserId: id("retiring") }, data: { readerUserId: null, state: "QUARANTINED" } }),
    read: (tx) => tx.retiredHistoryOwnership.findUnique({ where: { sourceUserId: id("retiring") } }),
  },
  {
    table: "HistoryRowOwnership",
    insert: (tx) => tx.historyRowOwnership.create({ data: { entity: "Tutee", recordId: id("learner-source"), readerUserId: id("reader"), sourceUserIds: [id("reader")], receiptId: id("history-correction") } }),
    update: (tx) => tx.historyRowOwnership.update({ where: { entity_recordId: { entity: "Tutee", recordId: id("learner-source") } }, data: { sourceUserIds: [id("reader"), id("retiring")] } }),
    read: (tx) => tx.historyRowOwnership.findUnique({ where: { entity_recordId: { entity: "Tutee", recordId: id("learner-source") } } }),
  },
  {
    table: "PersonCombineReceipt",
    insert: (tx) => tx.personCombineReceipt.create({ data: { id: id("combine"), actorId: id("reader"), inputHash: "synthetic-input", personId: id("person"), outcome: "GROUPED", retiredUserIds: [], ownershipTransfers: [] } }),
    // Fixture-level DML verifies the dependency; this is not a public receipt-edit workflow.
    update: (tx) => tx.personCombineReceipt.update({ where: { id: id("combine") }, data: { ownershipTransfers: [{ entity: "Tutee", recordId: id("learner-source"), sourceUserId: id("retiring"), readerUserId: id("reader") }] } }),
    read: (tx) => tx.personCombineReceipt.findUnique({ where: { id: id("combine") } }),
  },
  {
    table: "StudentRequestExecutionAssignment",
    insert: (tx) => tx.studentRequestExecutionAssignment.create({ data: { surveyId: id("owner-survey"), pairingId: id("pairing-target"), tuteeId: id("learner-target"), sourceTuteeId: id("learner-source"), receiptId: id("transfer") } }),
    update: (tx) => tx.studentRequestExecutionAssignment.update({ where: { surveyId_pairingId: { surveyId: id("owner-survey"), pairingId: id("pairing-target") } }, data: { releasedAt: now, revision: { increment: 1 } } }),
    read: (tx) => tx.studentRequestExecutionAssignment.findUnique({ where: { surveyId_pairingId: { surveyId: id("owner-survey"), pairingId: id("pairing-target") } } }),
  },
  {
    table: "StudentSurvey",
    insert: (tx) => tx.studentSurvey.create({ data: survey("new-survey") }),
    update: (tx) => tx.studentSurvey.update({ where: { id: id("new-survey") }, data: { state: "RECALLED", resolvedAt: now } }),
    read: (tx) => tx.studentSurvey.findUnique({ where: { id: id("new-survey") } }),
  },
];

beforeEach(async () => {
  // Same guarded, serial disposable-database contract as maintenance-workflows.
  // Qualify the complete FK closure and never use CASCADE or disable triggers.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => 'public."' + tablename.replaceAll('"', '""') + '"').join(","));
  await db.programSettings.create({ data: { timeZone: window.timeZone } });
  await db.person.create({ data: { id: id("person") } });
  await db.term.createMany({ data: [
    { id: id("current-term"), name: "Synthetic current", schoolYear: "26-27", quarter: "Q1", active: true, startDate: new Date("2026-10-01"), endDate: new Date("2026-12-01") },
    { id: id("past-term"), name: "Synthetic retained", schoolYear: "25-26", quarter: "Q1", active: false },
  ] });
  await db.tutor.createMany({ data: ["source", "target", "other"].map((name) => ({ id: id(`tutor-${name}`), englishName: `Synthetic ${name}`, status: "ACTIVE" as const })) });
  await db.tutee.createMany({ data: ["source", "target"].map((name) => ({ id: id(`learner-${name}`), englishName: `Synthetic ${name}`, status: "ACTIVE" as const })) });
  await db.user.createMany({ data: [
    { id: id("reader"), role: "STUDENT", studentId: id("learner-source"), tuteeMember: true, email: "identity-reader@example.test" },
    { id: id("other-reader"), role: "STUDENT", studentId: id("learner-target"), tuteeMember: true, email: "identity-other@example.test" },
    { id: id("retiring"), role: "VIEWER", email: "identity-original@example.test" },
  ] });
  await db.pairing.createMany({ data: ["source", "target", "other"].map((name) => ({
    id: id(`pairing-${name}`), tutorId: id(`tutor-${name}`), termId: id("past-term"),
    subject: "Synthetic mathematics", dayOfWeek: 1, startMin: 900, endMin: 945, roomMode: "NONE" as const,
  })) });
  await db.pairingTutee.createMany({ data: ["source", "target", "other"].map((name) => ({
    pairingId: id(`pairing-${name}`), tuteeId: id(name === "source" ? "learner-source" : "learner-target"),
  })) });
  await db.personParticipationTransferReceipt.create({ data: {
    id: id("transfer"), actorId: id("reader"), inputHash: "synthetic-transfer",
    personId: id("person"), retainedUserId: id("reader"), selection: {}, result: {}, subjects: [],
  } });
  await db.personHistoryCorrectionReceipt.create({ data: {
    id: id("history-correction"), actorId: id("reader"), inputHash: "synthetic-history",
    personId: id("person"), destinationPersonId: id("person"), sourceUserIds: [], before: {}, after: {}, subjects: [],
  } });
  await db.sessionPlan.create({ data: {
    id: id("plan"), generationKey: id("retained-generation"), tutorId: id("tutor-source"), termId: id("past-term"),
    originalDate: "2025-10-06", timeZone: window.timeZone, sourceFingerprint: "synthetic-retained-source",
    assignments: { create: { pairingId: id("pairing-source"), subject: "Synthetic mathematics", tuteeIds: [id("learner-source")], primary: true } },
    cohorts: { create: { id: id("cohort"), date: "2025-10-06", startMin: 900, endMin: 945, startsAt: new Date("2025-10-06T07:00:00Z"), endsAt: new Date("2025-10-06T07:45:00Z") } },
  } });
  await db.sessionPlanParticipant.create({ data: { id: id("participant"), planId: id("plan"), cohortId: id("cohort"), tuteeId: id("learner-source") } });
  await db.sessionPlanningRequest.create({ data: {
    id: id("request"), planId: id("plan"), cohortId: id("cohort"), kind: "RESCHEDULE", scope: "ONE", status: "EXPIRED", participantIds: [id("learner-source")],
    offers: { create: {
      id: id("offer"), sequence: 1, authorKey: `tutor:${id("tutor-source")}`, date: "2025-10-07", startMin: 900, endMin: 945,
      startsAt: new Date("2025-10-07T07:00:00Z"), endsAt: new Date("2025-10-07T07:45:00Z"), cutoffAt: new Date("2025-10-06T07:00:00Z"),
      responses: { create: { id: id("response"), actorUserId: id("reader"), actorKey: `tutee:${id("learner-source")}` } },
    } },
  } });
  await db.studentSurvey.create({ data: { ...survey("owner-survey"), tuteeId: id("learner-source") } });
  await cleanPublication();
}, 30_000);

afterAll(async () => { await db.$disconnect(); });

describe.sequential("identity scheduling invalidation bridge", () => {
  it.each(dependencies)("invalidates committed $table inserts/updates and rolls both back atomically", async (dependency) => {
    async function rolledBack(mutate: Dependency["insert"]) {
      const before = await transaction((tx) => dependency.read(tx));
      const rollback = new Error("Roll back this exact identity mutation.");
      await expect(transaction(async (tx) => {
        await mutate(tx);
        expect(await dependency.read(tx)).not.toEqual(before);
        await expectDirty(tx, dependency.table);
        throw rollback;
      })).rejects.toBe(rollback);
      await transaction(async (tx) => {
        expect(await dependency.read(tx)).toEqual(before);
        expect(await pending(tx, dependency.table)).toEqual([]);
        expect((await readSchedulingMaintenance(tx, window)).current).toBe(true);
      });
    }

    expect(await transaction((tx) => dependency.read(tx))).toBeNull();
    await rolledBack(dependency.insert);
    await transaction(async (tx) => { await dependency.insert(tx); await expectDirty(tx, dependency.table); });
    await transaction((tx) => expectDirty(tx, dependency.table));
    await cleanPublication();
    await rolledBack(dependency.update);
    await transaction(async (tx) => { await dependency.update(tx); await expectDirty(tx, dependency.table); });
    await transaction((tx) => expectDirty(tx, dependency.table));
  }, 30_000);

  it.each(["missing", "disabled", "conditional", "replica-only"])("refuses a warm state with a %s identity source trigger", async (mode) => {
    const rollback = new Error("Restore the identity trigger definition.");
    await expect(transaction(async (tx) => {
      if (mode === "disabled") await tx.$executeRawUnsafe('ALTER TABLE public."HistoryRowOwnership" DISABLE TRIGGER scheduling_source_dirty');
      else if (mode === "replica-only") await tx.$executeRawUnsafe('ALTER TABLE public."HistoryRowOwnership" ENABLE REPLICA TRIGGER scheduling_source_dirty');
      else {
        await tx.$executeRawUnsafe('DROP TRIGGER scheduling_source_dirty ON public."HistoryRowOwnership"');
        if (mode === "conditional") await tx.$executeRawUnsafe('CREATE TRIGGER scheduling_source_dirty AFTER INSERT OR UPDATE OR DELETE ON public."HistoryRowOwnership" FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.scheduling_mark_dirty()');
      }
      const [verified] = await tx.$queryRaw<{ valid: boolean }[]>`SELECT public.scheduling_verify_maintenance_triggers() AS valid`;
      expect(verified?.valid).toBe(false);
      await expect(readSchedulingMaintenance(tx, window)).rejects.toThrow("source triggers");
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await transaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(true);
  });

  it("keeps invalidation independent of exact-root compensation and preserves the other journal root", async () => {
    const mapping = dependencies.find((item) => item.table === "ParticipantConsolidation")!;
    await transaction((tx) => mapping.insert(tx));
    await db.recoveryAction.createMany({ data: ["recovering-root", "other-root"].map((name) => ({ id: id(name), kind: "SYNTHETIC_IDENTITY_TEST", applicationId: id(`${name}-application`), before: {} })) });
    await db.recoveryTrackedEntity.createMany({ data: ["recovering-root", "other-root"].map((name) => ({ actionId: id(name), entity: "Tutor", recordId: id("tutor-source") })) });
    await cleanPublication();
    const mutate = async (tx: TransactionDb) => {
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating',${id("recovering-root")},true)`;
      await mapping.update(tx);
      await expectDirty(tx, mapping.table);
      expect(await tx.recoveryChange.count({ where: { actionId: id("recovering-root") } })).toBe(0);
      expect(await tx.recoveryChange.count({ where: { actionId: id("other-root"), entity: mapping.table, operation: "UPDATE" } })).toBe(1);
      expect(await tx.recoveryEvent.findFirst({ where: { actionId: id("other-root") } })).toMatchObject({ kind: "RECOVERY_COMPENSATION" });
      expect(await tx.recoveryFence.findUnique({ where: { actionId: id("other-root") } })).toMatchObject({ revision: 1 });
    };
    const rollback = new Error("Roll back compensation and its evidence together.");
    await expect(transaction(async (tx) => { await mutate(tx); throw rollback; })).rejects.toBe(rollback);
    expect(await db.recoveryChange.count({ where: { actionId: { in: [id("recovering-root"), id("other-root")] } } })).toBe(0);
    expect(await db.recoveryFence.findUnique({ where: { actionId: id("other-root") } })).toBeNull();
    expect((await transaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(true);
    await transaction(mutate);
    await transaction((tx) => expectDirty(tx, mapping.table));
  });

  it("does not bypass execution revisions, immutable request provenance or deletion guards", async () => {
    const mapping = dependencies.find((item) => item.table === "SessionParticipantExecution")!;
    await transaction((tx) => mapping.insert(tx));
    await cleanPublication();
    const before = await transaction((tx) => mapping.read(tx));
    const forbidden: (() => Promise<unknown>)[] = [
      () => transaction((tx) => tx.sessionParticipantExecution.update({ where: { participantId: id("participant") }, data: { tuteeId: id("learner-target") } })),
      () => transaction((tx) => tx.sessionParticipantExecution.update({ where: { participantId: id("participant") }, data: { sourceSurveyIds: [], revision: { increment: 1 } } })),
      () => transaction((tx) => tx.sessionParticipantExecution.delete({ where: { participantId: id("participant") } })),
    ];
    for (const mutate of forbidden) {
      await expect(mutate()).rejects.toThrow(/revision must advance|provenance is immutable|versioned replacement/);
      await transaction(async (tx) => {
        expect(await mapping.read(tx)).toEqual(before);
        expect(await pending(tx, mapping.table)).toEqual([]);
        expect((await readSchedulingMaintenance(tx, window)).current).toBe(true);
      });
    }
  });
});
