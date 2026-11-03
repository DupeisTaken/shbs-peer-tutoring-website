import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma";

/** Stable source identities satisfy the real router's CUID validation. Generated
 * domain rows still use the production Prisma defaults. */
export const fixtureId = (kind: string, index = 0) =>
  `c${createHash("sha256").update(`${kind}:${index}`).digest("hex").slice(0, 24)}`;
export const fixtureKey = (kind: string, index = 0) => {
  const hex = createHash("sha256").update(`${kind}:${index}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export const addDays = (date: string, count: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

export type Fixture = Awaited<ReturnType<typeof seedFixture>>;

/** Passive evidence only: neither source is made clean by the harness. Older
 * baseline code may carry the reviewed metadata schema without consuming it. */
export async function readMaintenanceReadiness(db: PrismaClient) {
  const [inventory] = await db.$queryRaw<{ metadataPresent: boolean; openRequests: number }[]>`
    SELECT (to_regclass('public."SchedulingMaintenanceState"') IS NOT NULL
      AND to_regclass('public."SchedulingDirtyEvent"') IS NOT NULL) AS "metadataPresent",
      (SELECT count(*)::int FROM public."SessionPlanningRequest"
        WHERE status IN ('PENDING','SPLIT_REQUESTED')) AS "openRequests"
  `;
  assert.ok(inventory);
  if (!inventory.metadataPresent) return { ...inventory, state: null };
  const [state] = await db.$queryRaw<{
    triggersValid: boolean; id: string | null;
    publicationVersion: number | null; settlementVersion: number | null;
    windowStart: string | null; prepareEnd: string | null; timeZone: string | null;
    settlementBatchActive: boolean | null;
    queuedRequests: number | null; capturedSettlementEvents: number | null;
    publicationPending: number; settlementGlobalPending: number; settlementRetryPending: number;
  }[]>`
    SELECT public.scheduling_verify_maintenance_triggers() AS "triggersValid",
      state.id, state."publicationVersion", state."settlementVersion",
      state."windowStart", state."prepareEnd", state."timeZone", state."settlementBatchActive",
      cardinality(state."settlementRequestIds") AS "queuedRequests",
      cardinality(state."settlementEventIds") AS "capturedSettlementEvents",
      (SELECT count(*)::int FROM public."SchedulingDirtyEvent"
        WHERE "publicationPending") AS "publicationPending",
      (SELECT count(*)::int FROM public."SchedulingDirtyEvent"
        WHERE "settlementPending" AND "requestId" IS NULL) AS "settlementGlobalPending",
      (SELECT count(*)::int FROM public."SchedulingDirtyEvent"
        WHERE "settlementPending" AND "requestId" IS NOT NULL) AS "settlementRetryPending"
    FROM (SELECT 1) seed
    LEFT JOIN public."SchedulingMaintenanceState" state ON state.id='program'
  `;
  assert.ok(state);
  return { ...inventory, state };
}

export async function resetFixture(db: PrismaClient) {
  // The executable performs the stricter target + exclusive-run guard first.
  // Recheck catalog scope atomically. Explicitly named public tables, without
  // CASCADE, cannot silently truncate foreign-schema dependents.
  await db.$transaction(async (tx) => {
    const identity = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    assert.equal(identity[0]?.database, "shbs_performance_test");
    const schemas = await tx.$queryRaw<{ nspname: string }[]>`
      SELECT nspname FROM pg_namespace
      WHERE nspname<>'public' AND nspname<>'information_schema' AND nspname !~ '^pg_'
    `;
    assert.equal(schemas.length, 0, "Refusing reset of a database with additional user schemas.");
    const externalReferences = await tx.$queryRaw<{ constraint_name: string }[]>`
      SELECT constraint_row.conname AS constraint_name
      FROM pg_constraint constraint_row
      JOIN pg_class source ON source.oid=constraint_row.conrelid
      JOIN pg_namespace source_schema ON source_schema.oid=source.relnamespace
      JOIN pg_class target ON target.oid=constraint_row.confrelid
      JOIN pg_namespace target_schema ON target_schema.oid=target.relnamespace
      WHERE constraint_row.contype='f'
        AND ((source_schema.nspname='public' AND target_schema.nspname<>'public')
          OR (target_schema.nspname='public' AND source_schema.nspname<>'public'))
    `;
    assert.equal(externalReferences.length, 0, "Refusing reset with cross-schema foreign-key dependencies.");
    const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename
    `;
    assert.ok(tables.length > 0, "Migrate the explicitly owned disposable database first.");
    await tx.$executeRawUnsafe(
      "TRUNCATE " + tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`).join(",") + " RESTART IDENTITY",
    );
  }, { timeout: 20_000 });
}

/** Synthetic pre-existing roster/provenance, not a survey-enrollment benchmark.
 * Seed and journal witnesses are always outside measured request intervals. */
export async function seedFixture(db: PrismaClient, anchor: Date) {
  const { currentPolicy } = await import("../../src/server/policy-acceptance");
  const localDate = new Date(anchor.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay() || 7;
  const monday = addDays(localDate, 8 - weekday);
  const termId = fixtureId("term");
  const adminId = fixtureId("admin");
  const slotId = fixtureId("slot");
  const alternateSlotId = fixtureId("slot", 1);
  const subjectId = fixtureId("subject");
  const year = anchor.getUTCFullYear() % 100;
  const schoolYear = `${String(year).padStart(2, "0")}-${String((year + 1) % 100).padStart(2, "0")}`;
  await db.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
  await db.term.createMany({ data: [
    { id: termId, name: "Synthetic profile current", schoolYear, quarter: "Q1", active: true,
      startDate: new Date(`${addDays(monday, -14)}T00:00:00Z`), endDate: new Date(`${addDays(monday, 70)}T00:00:00Z`) },
    { id: fixtureId("prior-term"), name: "Synthetic profile prior", schoolYear: `${String((year + 99) % 100).padStart(2, "0")}-${String(year).padStart(2, "0")}`, quarter: "Q1" },
  ] });
  await db.user.create({ data: { id: adminId, name: "Synthetic administrator", email: "profile-admin@example.test", role: "ADMIN" } });
  await db.subject.createMany({ data: [
    { id: subjectId, name: "Profile Mathematics" },
    { id: fixtureId("subject", 1), name: "Profile Science" },
  ] });
  await db.timeSlot.createMany({ data: [
    { id: slotId, label: "Profile Monday", dayOfWeek: 1, startMin: 900, endMin: 945 },
    { id: alternateSlotId, label: "Profile Tuesday", dayOfWeek: 2, startMin: 960, endMin: 1005 },
  ] });
  await db.room.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
    id: fixtureId("room", index), name: `Synthetic room ${String(index).padStart(3, "0")}`, programOrder: index,
  })) });
  await db.schoolCalendarDay.createMany({ data: [
    { date: addDays(monday, 5), isSchoolDay: true, timetableWeekday: 3, note: "Synthetic Saturday makeup" },
    { date: addDays(monday, 10), isSchoolDay: false, note: "Synthetic closure" },
  ] });
  await db.policyDocument.create({ data: { slug: "tutor-policy", locale: "en", title: "Synthetic policy", body: "Synthetic profiling policy", version: "1" } });
  const policy = await currentPolicy(db, "tutor-policy");
  const pairs: { id: string; tutorId: string; tutorUserId: string; tuteeIds: string[]; studentUserIds: string[]; roomId: string; dayOfWeek: number }[] = [];
  for (let index = 0; index < 100; index++) {
    const ownerIndex = index === 1 ? 0 : index;
    const tutorId = fixtureId("tutor", ownerIndex);
    const tutorUserId = fixtureId("tutor-user", ownerIndex);
    const tuteeIds = [fixtureId("student", ownerIndex * 2), fixtureId("student", ownerIndex * 2 + 1)];
    const studentUserIds = [fixtureId("student-user", ownerIndex * 2), fixtureId("student-user", ownerIndex * 2 + 1)];
    if (index !== 1) {
      await db.tutor.create({ data: { id: tutorId, englishName: `Synthetic tutor ${index}`, status: "ACTIVE" } });
      await db.user.create({ data: { id: tutorUserId, name: `Synthetic tutor ${index}`, email: `profile-tutor-${index}@example.test`, role: "TUTOR", tutorId, emailVerifiedAt: anchor } });
      await db.tutee.createMany({ data: tuteeIds.map((id, person) => ({ id, englishName: `Synthetic learner ${index}-${person}`, status: "ACTIVE" as const, intakeTermId: termId, firstChoiceId: subjectId })) });
      for (const [person, userId] of studentUserIds.entries()) {
        await db.user.create({ data: { id: userId, name: `Synthetic learner ${index}-${person}`, email: `profile-student-${index}-${person}@example.test`, role: "STUDENT", tuteeMember: true,
          // Pair three intentionally exercises retained ownership without direct attachment.
          ...(index === 3 ? {} : { studentId: tuteeIds[person] }), emailVerifiedAt: anchor } });
        await db.studentProfileOwnership.create({ data: { userId, tuteeId: tuteeIds[person]! } });
      }
      await db.policyAcceptance.create({ data: { userId: tutorUserId, slug: "tutor-policy", revision: policy.revision, snapshot: policy.documents, signature: `Synthetic tutor ${index}` } });
      await db.tutorQualification.create({ data: { tutorId, subjectId, status: "APPROVED", approvedById: adminId, grants: { create: { subjectId } } } });
      await db.tutorSubjectWillingness.create({ data: { tutorId, subjectId, willing: true } });
      await db.tutorAvailability.createMany({ data: [slotId, alternateSlotId].map((slotId) => ({ tutorId, slotId })) });
    }
    const dayOfWeek = index < 10 ? 1 : 1 + index % 5;
    const roomId = fixtureId("room", ownerIndex);
    const pairing = await db.pairing.create({ data: {
      id: fixtureId("pairing", index), termId, tutorId,
      subject: index === 1 ? "Profile Science" : "Profile Mathematics",
      dayOfWeek, startMin: 900, endMin: 945, scheduleConfirmed: true,
      timeSlotId: index < 10 ? slotId : null,
      // NONE keeps the group unambiguous; other rows exercise real room conflicts.
      roomMode: index < 2 ? "NONE" : "AUTO", roomId: index < 2 ? null : roomId,
      tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
    } });
    pairs.push({ id: pairing.id, tutorId, tutorUserId, tuteeIds, studentUserIds, roomId, dayOfWeek });
  }
  await db.tutorQualification.create({ data: { tutorId: pairs[0]!.tutorId, subjectId: fixtureId("subject", 1), status: "APPROVED", approvedById: adminId, grants: { create: { subjectId: fixtureId("subject", 1) } } } });
  const group = await db.pairingGroup.create({ data: { id: fixtureId("group"), tutorId: pairs[0]!.tutorId, termId, primaryPairingId: pairs[0]!.id } });
  await db.pairing.updateMany({ where: { id: { in: pairs.slice(0, 2).map((pair) => pair.id) } }, data: { groupId: group.id } });

  // A populated persisted continuation generation exercises publication key and
  // membership reads without claiming this seed performs intake acceptance.
  const continuing = pairs[98]!;
  const priorPairingId = fixtureId("prior-pairing");
  const continuationSlotId = fixtureId("continuation-slot");
  const priorStudents = continuing.tuteeIds.map((_, person) => fixtureId("prior-student", person));
  await db.timeSlot.create({ data: { id: continuationSlotId, label: "Synthetic continued block", dayOfWeek: continuing.dayOfWeek, startMin: 900, endMin: 945 } });
  await db.tutorAvailability.create({ data: { tutorId: continuing.tutorId, slotId: continuationSlotId } });
  await db.tuteeAvailability.createMany({ data: continuing.tuteeIds.map((tuteeId) => ({ tuteeId, slotId: continuationSlotId })) });
  await db.pairing.update({ where: { id: continuing.id }, data: { timeSlotId: continuationSlotId } });
  await db.tutee.createMany({ data: priorStudents.map((id, person) => ({ id, englishName: `Synthetic prior learner ${person}`, status: "ACTIVE" as const, intakeTermId: fixtureId("prior-term"), firstChoiceId: subjectId })) });
  await db.studentProfileOwnership.createMany({ data: priorStudents.map((tuteeId, person) => ({ tuteeId, userId: continuing.studentUserIds[person]! })) });
  await db.pairing.create({ data: { id: priorPairingId, tutorId: continuing.tutorId, termId: fixtureId("prior-term"), subject: "Profile Mathematics", dayOfWeek: continuing.dayOfWeek, startMin: 900, endMin: 945, timeSlotId: continuationSlotId, scheduleConfirmed: true, roomMode: "NONE", tutees: { create: priorStudents.map((tuteeId) => ({ tuteeId })) } } });
  await db.studentContinuationPairing.create({ data: { sourcePairingId: priorPairingId, targetTermId: termId, pairingId: continuing.id } });
  for (const [person, tuteeId] of continuing.tuteeIds.entries()) {
    const surveyId = fixtureId("survey", person);
    await db.studentSurvey.create({ data: { id: surveyId, email: `profile-student-98-${person}@example.test`, intakeTermId: termId, tuteeId, payload: { firstChoiceId: subjectId, slotIds: [continuationSlotId] }, policyRevision: "synthetic", policySnapshot: {}, submittedAt: anchor, confirmedAt: anchor, tokenHash: `synthetic-profile-${person}`, expiresAt: new Date(`${addDays(monday, 60)}T00:00:00Z`) } });
    const assignment = await db.studentContinuationAssignment.create({ data: { id: fixtureId("continuation", person), surveyId, sourcePairingId: priorPairingId, sourceTuteeId: priorStudents[person]!, targetTermId: termId, targetPairingId: continuing.id, tuteeId, tutorId: continuing.tutorId, status: "ASSIGNED", assignedAt: anchor, snapshot: { tutorId: continuing.tutorId, subject: "Profile Mathematics", sourceGroupId: null, dayOfWeek: continuing.dayOfWeek, startMin: 900, endMin: 945, timeSlotId: continuationSlotId } } });
    await db.studentContinuationReceipt.create({ data: { userId: continuing.studentUserIds[person]!, clientKey: fixtureKey("continuation", person), inputHash: "synthetic-profile", surveyId, result: { state: "ASSIGNED", assignmentId: assignment.id, targetPairingId: continuing.id } } });
  }
  const roots = [
    { kind: "tutor", entity: "Tutor", recordId: pairs[0]!.tutorId },
    { kind: "student", entity: "User", recordId: pairs[2]!.studentUserIds[0]! },
    { kind: "retained-alias", entity: "User", recordId: pairs[3]!.studentUserIds[0]! },
    { kind: "multiple-tutor", entity: "Tutor", recordId: pairs[4]!.tutorId },
    { kind: "multiple-student", entity: "User", recordId: pairs[4]!.studentUserIds[0]! },
  ];
  for (const [index, root] of roots.entries()) {
    await db.recoveryAction.create({ data: { id: fixtureId("root", index), kind: "INITIAL_ADMISSION", applicationId: `synthetic-${root.kind}`, before: {} } });
    await db.recoveryTrackedEntity.create({ data: { actionId: fixtureId("root", index), entity: root.entity, recordId: root.recordId } });
  }
  return { anchor, monday, termId, schoolYear, adminId, slotId, alternateSlotId, subjectId, pairs, recoveryRootIds: roots.map((_, index) => fixtureId("root", index)) };
}

export async function assertRecoveryWitnesses(db: PrismaClient, fixture: Fixture) {
  for (const actionId of fixture.recoveryRootIds) {
    const changes = await db.recoveryChange.findMany({ where: { actionId }, orderBy: { id: "asc" } });
    assert.ok(changes.length > 0, "Missing positive publication recovery journal.");
    assert.ok(changes.some((change) => change.entity === "SessionPlanParticipant"), "Recovery root never observed participant publication.");
    const fence = await db.recoveryFence.findUniqueOrThrow({ where: { actionId } });
    assert.equal(fence.revision, changes.length, "Recovery fence and append count differ.");
  }
}

/** Late-root visibility witness uses ONLY the existing sequential Prisma writer.
 * It is a semantic fixture outside timing, not an optimized implementation. */
export async function addLateRootWitness(db: PrismaClient, fixture: Fixture) {
  const person = fixture.pairs[6]!;
  const actionId = fixtureId("late-root");
  await db.$transaction(async (tx) => {
    const plan = await tx.sessionPlan.create({ data: { generationKey: "synthetic-late-root-witness", tutorId: person.tutorId, termId: fixture.termId, originalDate: addDays(fixture.monday, 35), timeZone: "Asia/Shanghai", sourceFingerprint: "synthetic-late-root-witness" } });
    await tx.sessionPlanAssignment.create({ data: { planId: plan.id, pairingId: person.id, subject: "Profile Mathematics", tuteeIds: person.tuteeIds, primary: true } });
    await tx.recoveryAction.create({ data: { id: actionId, kind: "INITIAL_ADMISSION", applicationId: "synthetic-late-root", before: {} } });
    await tx.recoveryTrackedEntity.create({ data: { actionId, entity: "User", recordId: person.studentUserIds[0]! } });
    const date = addDays(fixture.monday, 35);
    const cohort = await tx.sessionPlanCohort.create({ data: { planId: plan.id, date, startMin: 900, endMin: 945, startsAt: new Date(`${date}T07:00:00Z`), endsAt: new Date(`${date}T07:45:00Z`), online: false } });
    await tx.sessionPlanParticipant.createMany({ data: person.tuteeIds.map((tuteeId) => ({ planId: plan.id, cohortId: cohort.id, tuteeId })) });
    const changes = await tx.recoveryChange.findMany({ where: { actionId }, orderBy: { id: "asc" } });
    assert.deepEqual(changes.map((change) => [change.entity, change.operation]), [["SessionPlanParticipant", "INSERT"], ["SessionPlanParticipant", "INSERT"]]);
    assert.equal((await tx.recoveryFence.findUniqueOrThrow({ where: { actionId } })).revision, 2);
  }, { timeout: 20_000 });
}

/** A retained downtime backlog: unique genuine source-plan/roster snapshots,
 * historical dates within the synthetic term, and captured split negotiations.
 * The earlier diagnostic clock first observes these as future commitments. */
export async function seedRequestBacklog(db: PrismaClient, fixture: Fixture) {
  await db.term.update({ where: { id: fixture.termId }, data: { startDate: new Date(`${addDays(fixture.monday, -49)}T00:00:00Z`) } });
  const sources = (await db.sessionPlanCohort.findMany({
    where: { status: "SCHEDULED", plan: { tutorId: { not: fixture.pairs[98]!.tutorId } }, rescheduled: false },
    include: { plan: { include: { assignments: true } }, participants: true },
    orderBy: [{ date: "asc" }, { plan: { tutorId: "asc" } }, { id: "asc" }],
  })).filter((cohort) => (new Date(`${cohort.date}T00:00:00Z`).getUTCDay() || 7) <= 5).slice(0, 205);
  assert.equal(sources.length, 205, "Sunday materialization must provide 205 distinct ordinary source cohorts.");
  const earlierClock = new Date(`${addDays(fixture.monday, -42)}T00:00:00Z`);
  const owners = new Map(fixture.pairs.flatMap((pair) => pair.tuteeIds.map((id, person) => [id, pair.studentUserIds[person]!] as const)));
  const requests = [];
  const offers = [];
  const responses = [];
  for (const [index, source] of sources.entries()) {
    const date = addDays(source.date, -35);
    const createdAt = new Date(earlierClock.getTime() - 60_000 + index);
    const plan = await db.sessionPlan.create({ data: {
      generationKey: source.plan.generationKey.replace(source.plan.originalDate, date),
      tutorId: source.plan.tutorId, termId: source.plan.termId, originalDate: date,
      timeZone: source.plan.timeZone, sourceFingerprint: source.plan.sourceFingerprint,
      sourceScheduleFingerprint: source.plan.sourceScheduleFingerprint,
      createdAt,
    } });
    // Relation reads have no implicit SQL order. Keep fixture recovery append
    // order deterministic while retaining the authoritative primary identity.
    const assignments = [...source.plan.assignments].sort((a, b) => Number(b.primary) - Number(a.primary) || a.pairingId.localeCompare(b.pairingId));
    await db.sessionPlanAssignment.createMany({ data: assignments.map((assignment) => ({
      planId: plan.id, pairingId: assignment.pairingId, subject: assignment.subject,
      tuteeIds: assignment.tuteeIds!, primary: assignment.primary,
    })) });
    const startsAt = new Date(`${date}T07:00:00Z`);
    const cohort = await db.sessionPlanCohort.create({ data: {
      planId: plan.id, date, startMin: source.startMin, endMin: source.endMin,
      startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      roomId: source.roomId, online: source.online, createdAt,
    } });
    const people = source.participants.map((person) => person.tuteeId).sort();
    assert.equal(people.length, 2);
    await db.sessionPlanParticipant.createMany({ data: people.map((tuteeId) => ({ planId: plan.id, cohortId: cohort.id, tuteeId })) });
    const tutor = fixture.pairs.find((pair) => pair.tutorId === plan.tutorId)!;
    const requestId = fixtureId("backlog-request", index);
    requests.push({ id: requestId, planId: plan.id, cohortId: cohort.id,
      kind: "RESCHEDULE", scope: "ALL", participantIds: people,
      status: "SPLIT_REQUESTED", stage: 2, version: 4, currentOfferId: fixtureId("backlog-offer", index * 2 + 1),
      rejectionKeys: [`tutee:${people[0]!}`], createdAt, updatedAt: createdAt });
    for (const sequence of [1, 2]) {
      const offerId = fixtureId("backlog-offer", index * 2 + sequence - 1);
      const startMin = source.startMin + sequence * 90;
      offers.push({ id: offerId, requestId, sequence, date, startMin, endMin: startMin + 45,
        startsAt: new Date(`${date}T00:00:00Z`).getTime() + (startMin - 480) * 60_000,
        cutoffAt: startsAt, authorKey: sequence === 1 ? `tutor:${plan.tutorId}` : `tutee:${people[0]!}`, createdAt });
      const audience = [{ actorKey: `tutor:${plan.tutorId}`, actorUserId: tutor.tutorUserId },
        ...people.map((tuteeId) => ({ actorKey: `tutee:${tuteeId}`, actorUserId: owners.get(tuteeId)! }))];
      for (const person of audience) {
        const author = person.actorKey === (sequence === 1 ? `tutor:${plan.tutorId}` : `tutee:${people[0]!}`);
        const rejected = sequence === 1 && person.actorKey === `tutee:${people[0]!}`;
        responses.push({ offerId, ...person, state: author ? "ACCEPTED" : rejected ? "REJECTED" : "PENDING", acceptedBy: author ? "AUTHOR" : null });
      }
    }
  }
  await db.sessionPlanningRequest.createMany({ data: requests });
  await db.sessionPlanningOffer.createMany({ data: offers.map(({ startsAt, ...offer }) => ({ ...offer, startsAt: new Date(startsAt), endsAt: new Date(startsAt + 45 * 60_000), online: true })) });
  await db.sessionPlanningResponse.createMany({ data: responses });
  return { requestIds: requests.map((request) => request.id), earlierClock };
}

export type RequestVisit = {
  sequence: string; requestId: string; beforeAt: Date; afterAt: Date;
  beforeStatus: string; afterStatus: string;
};

export async function readPendingPublicationEventIds(db: PrismaClient) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT event.id::text AS id FROM public."SchedulingDirtyEvent" event
    WHERE event."publicationPending" ORDER BY event.id
  `;
  return rows.map((row) => row.id);
}

/** Follow the exact pre-pass set, including acknowledged rows subsequently
 * deleted after both consumers finish. New publication writes cannot mask it. */
export async function inspectPublicationAcknowledgements(db: PrismaClient, visibleIds: string[]) {
  return db.$queryRaw<{ id: string; publicationPending: boolean }[]>`
    SELECT witness.id::text AS id, COALESCE(event."publicationPending",false) AS "publicationPending"
    FROM unnest(${visibleIds}::bigint[]) WITH ORDINALITY AS witness(id,ordinal)
    LEFT JOIN public."SchedulingDirtyEvent" event ON event.id=witness.id
    ORDER BY witness.ordinal
  `;
}

/** Isolated instrumentation, identical on both sources. It observes genuine
 * request writes and rejects only selected synthetic notice inserts. It never
 * changes production triggers, source results or maintenance metadata. */
export async function installBacklogWitness(db: PrismaClient, requestIds: string[]) {
  assert.equal(requestIds.length, 205);
  assert.ok(requestIds.every((id) => /^c[0-9a-f]{24}$/.test(id)));
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const scope = `"public"."profile_scope_${suffix}"`;
  const visits = `"public"."profile_visits_${suffix}"`;
  const observe = `"public"."profile_observe_${suffix}"`;
  const fail = `"public"."profile_fail_${suffix}"`;
  const observeTrigger = `"profile_observe_${suffix}"`;
  const failTrigger = `"profile_fail_${suffix}"`;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TABLE ${scope} ("requestId" text PRIMARY KEY, fail boolean NOT NULL DEFAULT false)`);
    await tx.$executeRawUnsafe(`CREATE TABLE ${visits} (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "requestId" text NOT NULL, "beforeAt" timestamp NOT NULL, "afterAt" timestamp NOT NULL, "beforeStatus" text NOT NULL, "afterStatus" text NOT NULL)`);
    await tx.$executeRawUnsafe(`INSERT INTO ${scope} ("requestId") VALUES ${requestIds.map((id) => `('${id}')`).join(",")}`);
    await tx.$executeRawUnsafe(`CREATE FUNCTION ${observe}() RETURNS trigger LANGUAGE plpgsql AS $witness$
      BEGIN
        IF NEW."updatedAt" IS DISTINCT FROM OLD."updatedAt" AND EXISTS (SELECT 1 FROM ${scope} WHERE "requestId"=NEW.id) THEN
          INSERT INTO ${visits} ("requestId","beforeAt","afterAt","beforeStatus","afterStatus")
            VALUES (NEW.id,OLD."updatedAt",NEW."updatedAt",OLD.status,NEW.status);
        END IF;
        RETURN NEW;
      END; $witness$`);
    await tx.$executeRawUnsafe(`CREATE FUNCTION ${fail}() RETURNS trigger LANGUAGE plpgsql AS $witness$
      BEGIN
        IF NEW.event IN ('expired','stale') AND EXISTS (SELECT 1 FROM ${scope} WHERE "requestId"=NEW."requestId" AND fail) THEN
          RAISE EXCEPTION 'Synthetic scoped backlog notice failure';
        END IF;
        RETURN NEW;
      END; $witness$`);
    await tx.$executeRawUnsafe(`CREATE TRIGGER ${observeTrigger} AFTER UPDATE OF "updatedAt" ON public."SessionPlanningRequest" FOR EACH ROW EXECUTE FUNCTION ${observe}()`);
    await tx.$executeRawUnsafe(`CREATE TRIGGER ${failTrigger} BEFORE INSERT ON public."SessionNotice" FOR EACH ROW EXECUTE FUNCTION ${fail}()`);
  }, { timeout: 20_000 });
  return {
    async clearVisits() { await db.$executeRawUnsafe(`TRUNCATE ${visits}`); },
    async readVisits() { return db.$queryRawUnsafe<RequestVisit[]>(`SELECT visit.sequence::text AS sequence,visit."requestId",visit."beforeAt",visit."afterAt",visit."beforeStatus",visit."afterStatus" FROM ${visits} visit ORDER BY visit.sequence`); },
    async setFailures(ids: string[]) {
      assert.ok(ids.every((id) => requestIds.includes(id)));
      await db.$executeRawUnsafe(`UPDATE ${scope} SET fail=("requestId"=ANY($1::text[]))`, ids);
    },
    async close() {
      const errors: unknown[] = [];
      for (const sql of [
        `DROP TRIGGER IF EXISTS ${observeTrigger} ON public."SessionPlanningRequest"`,
        `DROP TRIGGER IF EXISTS ${failTrigger} ON public."SessionNotice"`,
        `DROP FUNCTION IF EXISTS ${observe}()`, `DROP FUNCTION IF EXISTS ${fail}()`,
        `DROP TABLE IF EXISTS ${visits}`, `DROP TABLE IF EXISTS ${scope}`,
      ]) try { await db.$executeRawUnsafe(sql); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Owned backlog instrumentation cleanup failed.");
    },
  };
}
