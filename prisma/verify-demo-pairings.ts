// Run through: npm test -- src/test/demo-seed.test.ts --maxWorkers=1
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient, StudentSurvey } from "../generated/prisma";
import { policyActionTarget } from "../src/lib/policy-evidence";
import { createCaller } from "../src/server/api/root";
import { databaseScope, scopedDatabase } from "../src/server/db-scope";
import { currentPolicy } from "../src/server/policy-acceptance";
import { acceptStudentPolicy, prepareStudentAction } from "../src/server/student-workflow";
import type { DomainDb, TransactionDb } from "../src/server/transactions";
import { DEMO_LESSONS, demoAssignmentId, seedDemoPairings } from "./demo-pairings";
import { verifyDemoPairingCoverage } from "./demo-pairings-verification";
import { assertDemoDatabase, seedId } from "./demo-support";

const assignments = DEMO_LESSONS.flatMap((lesson) => lesson.tuteeIds.map((tuteeId) => ({
  lesson, tuteeId, id: demoAssignmentId(lesson.id, tuteeId),
})));

async function actor(db: PrismaClient, userId: string) {
  const scoped = scopedDatabase(db);
  const user = await scoped.user.findUniqueOrThrow({ where: { id: userId } });
  return createCaller({
    db: scoped,
    headers: new Headers(),
    session: {
      user: { id: user.id, name: user.name, email: user.email },
      role: user.role,
      tutorId: user.tutorId,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function frozenEvidence(client: DomainDb) {
  // Compare in memory only: neither accepted personal evidence nor credentials
  // are printed. Lifecycle fields such as firstAssignedAt are deliberately not
  // confused with the original signed intake and consent evidence.
  return digest([
    await client.session.findMany({ orderBy: { id: "asc" } }),
    await client.sessionTutee.findMany({ orderBy: [{ sessionId: "asc" }, { tuteeId: "asc" }] }),
    await client.sessionFlag.findMany({ orderBy: { id: "asc" } }),
    await client.schoolHoursReport.findMany({ orderBy: { id: "asc" } }),
    await client.policyAcceptance.findMany({ orderBy: { id: "asc" } }),
    await client.studentSurvey.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true, email: true, intakeTermId: true, payload: true,
        policyRevision: true, policySnapshot: true, submittedAt: true,
        confirmedAt: true, publicSignupEmailConfirmedAt: true,
      },
    }),
    await client.studentSignupRevision.findMany({ orderBy: { id: "asc" } }),
    await client.sessionPlan.findMany({ orderBy: { id: "asc" } }),
    await client.sessionPlanAssignment.findMany({ orderBy: [{ planId: "asc" }, { pairingId: "asc" }] }),
    await client.sessionPlanParticipant.findMany({ orderBy: { id: "asc" } }),
  ]);
}

async function fixtureState(client: DomainDb) {
  return digest([
    await frozenEvidence(client),
    await client.pairing.findMany({ orderBy: { id: "asc" } }),
    await client.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] }),
    await client.pairingGroup.findMany({ orderBy: { id: "asc" } }),
    await client.tutee.findMany({ orderBy: { id: "asc" } }),
    await client.studentSurvey.findMany({ orderBy: { id: "asc" } }),
    await client.tutorQualification.findMany({ orderBy: [{ tutorId: "asc" }, { subjectId: "asc" }] }),
    await client.qualificationGrant.findMany({ orderBy: [{ tutorId: "asc" }, { sourceSubjectId: "asc" }, { subjectId: "asc" }] }),
  ]);
}

async function rolledBack(db: PrismaClient, label: string, probe: (tx: TransactionDb) => Promise<void>) {
  const before = await fixtureState(db);
  const rollback = new Error(`Successful rollback: ${label}`);
  try {
    await db.$transaction((tx) => databaseScope.run(tx, async () => {
      await probe(tx);
      throw rollback;
    }), { timeout: 120_000 });
    assert.fail("A verification probe must never commit");
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await fixtureState(db), before, `${label}: all fixture state must roll back`);
  console.log(`Verified: ${label} (rolled back).`);
}

/** The harness owns the guarded database and its lifecycle. Real server callers
 * retain authorization, input validation and audit middleware inside each probe. */
export async function verifyDemoPairingWorkflows(db: PrismaClient) {
  const connectionString = process.env.DATABASE_URL ?? "";
  assertDemoDatabase(connectionString);
  assert.ok(new URL(connectionString).pathname.endsWith("_test"),
    "Pairing workflow probes require a disposable shbs_*_test database, never the preview.");
  const [identity] = await db.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
  assert.equal(identity?.database, decodeURIComponent(new URL(connectionString).pathname.slice(1)),
    "The caller-owned client must target the guarded test database");
  console.log("Pairing coverage:", await verifyDemoPairingCoverage(db));

  await rolledBack(db, "all 26 Select tutor assignments from pre-assignment state", async (tx) => {
    const before = await frozenEvidence(tx);
    const adminId = seedId("user-admin");
    const admin = await actor(db, adminId);
    const policy = await currentPolicy(tx, "tutee-policy");
    const pending: {
      assignment: (typeof assignments)[number];
      survey: StudentSurvey;
      userId: string;
      assignTicket: Awaited<ReturnType<typeof prepareStudentAction>>;
      policyTicket: Awaited<ReturnType<typeof prepareStudentAction>>;
    }[] = [];
    for (const assignment of assignments) {
      const student = await tx.tutee.findUniqueOrThrow({
        where: { id: assignment.tuteeId }, include: { user: true },
      });
      const survey = await tx.studentSurvey.findUnique({ where: { tuteeId: student.id } });
      if (student.signupSource === "SELF_SERVICE") {
        assert.ok(survey, `${student.englishName}: self-service assignment needs its original survey`);
        assert.equal(survey.state, "OPEN");
        assert.ok(survey.confirmedAt, `${student.englishName}: replay must not send verification email`);
        assert.equal(survey.invalidatedAt, null);
        assert.ok(student.user, `${student.englishName}: missing confirmed account`);
        await tx.policyAcceptance.findUniqueOrThrow({
          where: { userId_slug_revision: {
            userId: student.user.id, slug: "tutee-policy", revision: policy.revision,
          } },
        });
        const assignTicket = await prepareStudentAction(tx, adminId, "ASSIGN", survey.id);
        const policyTicket = await prepareStudentAction(tx, student.user.id, "POLICY",
          policyActionTarget("tutee-policy", policy.revision));
        pending.push({ assignment, survey, userId: student.user.id, assignTicket, policyTicket });
      } else {
        assert.equal(survey, null, `${student.englishName}: staff/unknown source must use its own intake path`);
      }
    }
    assert.equal(pending.length, 24);
    // Use genuine issued readiness times, once for the whole batch. No forged
    // confirmation, edited timer, override grant or auth bypass is needed.
    const readyAt = Math.max(...pending.flatMap((item) => [
      item.assignTicket.readyAt.getTime(), item.policyTicket.readyAt.getTime(),
    ]));
    await delay(Math.max(0, readyAt - Date.now()) + 20);
    for (const item of pending) {
      await acceptStudentPolicy(tx, item.userId, policy.revision, item.policyTicket.id);
      assert.ok((await tx.studentActionConfirmation.findUniqueOrThrow({
        where: { id: item.policyTicket.id },
      })).usedAt);
    }

    // Reconstruct only the pre-assignment lifecycle inside this rollback probe.
    // Keeping original Pairing rows retains every Session foreign key. Later
    // discipline/review examples remain present; this does not claim they were
    // already present when the original assignment was made.
    await tx.pairingTutee.deleteMany({ where: { pairingId: { in: assignments.map((row) => row.id) } } });
    await tx.tutee.updateMany({ where: { id: { in: assignments.map((row) => row.tuteeId) } }, data: { status: "PENDING" } });
    await tx.studentSurvey.updateMany({
      where: { id: { in: pending.map((row) => row.survey.id) } },
      data: { firstAssignedAt: null, verificationDueAt: null },
    });
    let selfService = 0;
    let staffOrUnknown = 0;
    for (const assignment of assignments) {
      const { lesson, tuteeId } = assignment;
      const subject = await tx.subject.findUniqueOrThrow({ where: { id: lesson.subjectId } });
      const self = pending.find((row) => row.assignment.id === assignment.id);
      try {
        if (self) {
          await admin.studentWorkflow.assign({
            id: self.survey.id, ticket: self.assignTicket.id,
            subjectId: lesson.subjectId, tutorId: lesson.tutorId,
          });
          assert.ok((await tx.studentActionConfirmation.findUniqueOrThrow({
            where: { id: self.assignTicket.id },
          })).usedAt);
          selfService++;
        } else {
          const student = await tx.tutee.findUniqueOrThrow({ where: { id: tuteeId } });
          await admin.admin.assignSignup({
            tuteeId, expectedUpdatedAt: student.updatedAt,
            assignments: [{ subject: subject.name, subjectId: lesson.subjectId, tutorId: lesson.tutorId }],
          });
          staffOrUnknown++;
        }
      } catch (cause) {
        throw new Error(`Select tutor replay failed for ${tuteeId} / ${lesson.subject}`, { cause });
      }
      const created = await tx.pairing.findMany({
        where: { term: { active: true }, subject: subject.name, tutees: { some: { tuteeId } } },
        include: { tutees: true },
      });
      assert.equal(created.length, 1);
      const row = created[0]!;
      assert.notEqual(row.id, assignment.id);
      assert.equal(row.tutorId, lesson.tutorId);
      assert.deepEqual(row.tutees.map((member) => member.tuteeId), [tuteeId]);
      assert.equal(row.scheduleConfirmed, false);
      assert.equal(row.groupId, null);
      assert.equal(row.timeSlotId, null);
    }
    assert.deepEqual({ selfService, staffOrUnknown }, { selfService: 24, staffOrUnknown: 2 });
    assert.equal(await frozenEvidence(tx), before, "Assignment replay must retain frozen evidence");
  });

  await rolledBack(db, "Alice splits and rejoins three real assignments", async (tx) => {
    const before = await frozenEvidence(tx);
    const alice = await actor(db, seedId("user-alice"));
    const initial = await alice.pairingGroups.mine();
    assert.equal(initial.pairings.length, 3);
    assert.equal(initial.groups.length, 1);
    const originalGroup = initial.groups[0]!;
    const split = await alice.pairingGroups.save({ snapshot: initial.snapshot, groups: [] });
    assert.equal(split.groups.length, 0);
    assert.equal(split.pairings.length, 3);
    assert.ok(split.pairings.every((row) => !row.scheduleConfirmed && !row.groupId && !row.timeSlotId));
    const joined = await alice.pairingGroups.save({
      snapshot: split.snapshot,
      groups: [{ pairingIds: originalGroup.pairingIds, slotId: originalGroup.slotId }],
    });
    assert.equal(joined.groups.length, 1);
    assert.equal(joined.groups[0]!.groupStatus, "scheduled");
    assert.deepEqual([...joined.groups[0]!.pairingIds].sort(), [...originalGroup.pairingIds].sort());
    assert.equal(await frozenEvidence(tx), before, "Split/rejoin must not alter sessions, hours, reports or signed evidence");
  });

  await rolledBack(db, "selective repeat preserves unchanged fixtures", async (tx) => {
    const before = await fixtureState(tx);
    assert.deepEqual(await seedDemoPairings(tx), {
      convertedLessons: 0, createdAssignments: 0, approvedQualifications: 0, deviations: [],
    });
    assert.equal(await fixtureState(tx), before);
  });

  await rolledBack(db, "selective enrichment preserves an operator-edited pairing", async (tx) => {
    const id = seedId("pairing-harold-apenglit");
    await tx.pairing.update({ where: { id }, data: { subject: "Operator changed this assignment" } });
    const changed = await fixtureState(tx);
    const result = await seedDemoPairings(tx);
    assert.ok(result.deviations.length > 0);
    assert.equal(await fixtureState(tx), changed);
    assert.equal((await tx.pairing.findUniqueOrThrow({ where: { id } })).subject,
      "Operator changed this assignment");
  });

  await rolledBack(db, "selective enrichment does not recreate a deleted assignment", async (tx) => {
    const id = demoAssignmentId(seedId("pairing-alice-math"), seedId("tutee-liam"));
    assert.equal(await tx.session.count({ where: { pairingId: id } }), 0);
    // This extra assignment has no historical Session foreign keys. Detach it
    // first so the remaining two-member group stays coherent during deletion.
    await tx.pairing.update({ where: { id }, data: {
      groupId: null, scheduleConfirmed: false, timeSlotId: null,
    } });
    await tx.pairing.delete({ where: { id } });
    const changed = await fixtureState(tx);
    const result = await seedDemoPairings(tx);
    assert.ok(result.deviations.length > 0);
    assert.equal(await tx.pairing.count({ where: { id } }), 0);
    assert.equal(await fixtureState(tx), changed);
  });
  console.log("Verified all 26 assignments through normal Select tutor calls, 10 groups and 2 singles, Alice split/rejoin, and selective preservation. Every mutation probe rolled back.");
}
