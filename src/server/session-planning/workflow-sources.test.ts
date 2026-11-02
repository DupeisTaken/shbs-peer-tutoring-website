import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { utcDatabaseUrl } from "~/server/database-url";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { invalidateSessionPlansForPairings } from ".";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(async () => {
  await db.$disconnect();
});

const now = new Date("2050-10-02T00:00:00Z");
const olderPublication = new Date("2050-09-28T00:00:00Z");
const newerPublication = new Date("2050-09-30T00:00:00Z");

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

/** Unique rows avoid reliance on the previous file's fixtures. Captured rosters
 * deliberately omit the later learner: only post-publication continuation
 * evidence may justify that difference from today's assignment roster.
 */
async function seed(tx: TransactionDb, extraLearner = false) {
  const prefix = `source-workflow-${randomUUID()}`;
  const tutorId = `${prefix}-tutor`;
  const tutorUserId = `${prefix}-tutor-user`;
  const tuteeIds = [`${prefix}-learner`, `${prefix}-later-learner`];
  const tuteeUserIds = tuteeIds.map((id) => `${id}-user`);
  const term = await tx.term.create({
    data: {
      name: "Synthetic source verification",
      schoolYear: prefix,
      quarter: "Q1",
      active: true,
    },
  });
  await tx.tutor.create({
    data: { id: tutorId, englishName: "Synthetic Tutor", status: "ACTIVE" },
  });
  await tx.tutee.createMany({
    data: tuteeIds.map((id) => ({
      id,
      englishName: "Synthetic Learner",
      status: "ACTIVE",
    })),
  });
  await tx.user.create({
    data: {
      id: tutorUserId,
      tutorId,
      name: "Synthetic Tutor",
      role: "TUTOR",
      email: `${prefix}-tutor@example.test`,
      emailVerifiedAt: now,
    },
  });
  await tx.user.createMany({
    data: tuteeIds.map((studentId, index) => ({
      id: tuteeUserIds[index]!,
      studentId,
      name: "Synthetic Learner",
      role: "STUDENT",
      email: `${prefix}-learner-${index}@example.test`,
      emailVerifiedAt: now,
      tuteeMember: true,
    })),
  });
  const pairing = await tx.pairing.create({
    data: {
      tutorId,
      termId: term.id,
      subject: "Synthetic Math",
      dayOfWeek: 3,
      startMin: 900,
      endMin: 945,
      scheduleConfirmed: true,
      roomMode: "NONE",
      tutees: {
        create: (extraLearner ? tuteeIds : tuteeIds.slice(0, 1)).map(
          (tuteeId) => ({ tuteeId }),
        ),
      },
    },
  });
  const plans: {
    id: string;
    cohortId: string;
    participantId: string;
    createdAt: Date;
  }[] = [];
  for (const [index, date] of ["2050-11-02", "2050-11-09"].entries()) {
    const createdAt = index === 0 ? olderPublication : newerPublication;
    const plan = await tx.sessionPlan.create({
      data: {
        generationKey: `${prefix}-${date}`,
        tutorId,
        termId: term.id,
        originalDate: date,
        timeZone: "UTC",
        createdAt,
        sourceFingerprint: "synthetic-source",
        assignments: {
          create: {
            pairingId: pairing.id,
            subject: pairing.subject,
            tuteeIds: [tuteeIds[0]!],
            primary: true,
          },
        },
      },
    });
    const cohort = await tx.sessionPlanCohort.create({
      data: {
        planId: plan.id,
        date,
        startMin: 900,
        endMin: 945,
        startsAt: new Date(`${date}T15:00:00Z`),
        endsAt: new Date(`${date}T15:45:00Z`),
      },
    });
    const participant = await tx.sessionPlanParticipant.create({
      data: { planId: plan.id, cohortId: cohort.id, tuteeId: tuteeIds[0]! },
    });
    plans.push({
      id: plan.id,
      cohortId: cohort.id,
      participantId: participant.id,
      createdAt,
    });
  }
  return {
    prefix,
    tutorId,
    tutorUserId,
    tuteeIds,
    tuteeUserIds,
    termId: term.id,
    pairingId: pairing.id,
    plans,
  };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

async function cleanup(fixture: Fixture) {
  await db.$transaction(
    async (tx) => {
      const planIds = fixture.plans.map((plan) => plan.id);
      await tx.sessionNotice.deleteMany({
        where: {
          recipientUserId: {
            in: [fixture.tutorUserId, ...fixture.tuteeUserIds],
          },
        },
      });
      await tx.sessionPlanParticipant.deleteMany({
        where: { planId: { in: planIds } },
      });
      await tx.sessionPlanCohort.deleteMany({
        where: { planId: { in: planIds } },
      });
      await tx.sessionPlanAssignment.deleteMany({
        where: { planId: { in: planIds } },
      });
      await tx.sessionPlan.deleteMany({ where: { id: { in: planIds } } });
      await tx.pairingTutee.deleteMany({
        where: { pairingId: fixture.pairingId },
      });
      await tx.pairing.delete({ where: { id: fixture.pairingId } });
      await tx.user.deleteMany({
        where: { id: { in: [fixture.tutorUserId, ...fixture.tuteeUserIds] } },
      });
      await tx.tutee.deleteMany({ where: { id: { in: fixture.tuteeIds } } });
      await tx.tutor.delete({ where: { id: fixture.tutorId } });
      await tx.term.delete({ where: { id: fixture.termId } });
    },
    { timeout: 10_000 },
  );
}

describe("publication source verification", () => {
  it("re-reads both plans after a blocked source lock observes a committed suspension", async () => {
    const fixture = await db.$transaction((tx) => seed(tx));
    // A separate owned connection permits a real row-lock wait even if the
    // application's test client uses a one-connection pool. It also observes the
    // wait through PostgreSQL, without mocking the source verifier or its reads.
    const writer = new Client({
      connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
      connectionTimeoutMillis: 3000,
    });
    let connected = false;
    let writerOpen = false;
    let invalidating: Promise<void> | undefined;
    try {
      await writer.connect();
      connected = true;
      await writer.query("BEGIN");
      writerOpen = true;
      await writer.query('UPDATE "User" SET "suspendedAt"=$1 WHERE id=$2', [
        now,
        fixture.tutorUserId,
      ]);
      const started = deferred<number>();
      invalidating = db.$transaction(
        async (tx) => {
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          started.resolve(backend!.pid);
          await lockEntity(tx, "program:period");
          await invalidateSessionPlansForPairings(tx, [fixture.pairingId], now);
        },
        { timeout: 10_000 },
      );
      void invalidating.catch(started.reject);
      const readerPid = await started.promise;
      await vi.waitFor(
        async () => {
          const result = await writer.query<{ blocked: boolean }>(
            "SELECT pg_backend_pid()=ANY(pg_blocking_pids($1::int)) AS blocked",
            [readerPid],
          );
          expect(result.rows[0]?.blocked).toBe(true);
        },
        { timeout: 3000, interval: 25 },
      );
      // The initial planInclude graph was read while the suspension was still
      // uncommitted. Only evidence read after the blocked SHARE lock can see it.
      await writer.query("COMMIT");
      writerOpen = false;
      await invalidating;
      const cohorts = await db.sessionPlanCohort.findMany({
        where: { id: { in: fixture.plans.map((plan) => plan.cohortId) } },
      });
      expect(cohorts).toHaveLength(2);
      expect(
        cohorts.every(
          (cohort) =>
            cohort.status === "CANCELLED" &&
            cohort.version === 2 &&
            !cohort.sourceInvalidated,
        ),
      ).toBe(true);
      const participants = await db.sessionPlanParticipant.findMany({
        where: { id: { in: fixture.plans.map((plan) => plan.participantId) } },
      });
      expect(participants).toHaveLength(2);
      expect(
        participants.every(
          (person) =>
            person.status === "CANCELLED" &&
            person.version === 2 &&
            !person.calendarSuppressed,
        ),
      ).toBe(true);
      expect(
        await db.sessionNotice.count({
          where: {
            recipientUserId: {
              in: [fixture.tutorUserId, ...fixture.tuteeUserIds],
            },
            event: "cancelled",
          },
        }),
      ).toBe(4);
    } finally {
      if (connected) {
        if (writerOpen) await writer.query("ROLLBACK").catch(() => undefined);
        await writer.end();
      }
      await invalidating?.catch(() => undefined);
      await cleanup(fixture);
    }
  }, 20_000);

  it.each([
    {
      label: "equal to the oldest publication",
      assignedAt: olderPublication,
      valid: [false, false],
    },
    {
      label: "between publications",
      assignedAt: new Date("2050-09-29T00:00:00Z"),
      valid: [true, false],
    },
    {
      label: "equal to the newer publication",
      assignedAt: newerPublication,
      valid: [true, false],
    },
    {
      label: "after both publications",
      assignedAt: new Date("2050-10-01T00:00:00Z"),
      valid: [true, true],
    },
  ])(
    "applies continuation evidence $label only to publications it follows",
    async ({ assignedAt, valid }) => {
      const rollback = new Error(
        "Roll back the isolated continuation timestamp fixture.",
      );
      try {
        await db.$transaction(
          async (tx) => {
            const fixture = await seed(tx, true);
            // Seed retained assignment evidence directly. The earlier publication may
            // accept a later consent delta; a newer stale snapshot cannot borrow a
            // consent event from before (or exactly at) its own creation timestamp.
            await tx.studentContinuationAssignment.create({
              data: {
                surveyId: `${fixture.prefix}-survey`,
                sourcePairingId: `${fixture.prefix}-prior-pairing`,
                sourceTuteeId: fixture.tuteeIds[1]!,
                targetTermId: fixture.termId,
                targetPairingId: fixture.pairingId,
                tuteeId: fixture.tuteeIds[1]!,
                tutorId: fixture.tutorId,
                status: "ASSIGNED",
                assignedAt,
                snapshot: { source: "synthetic-retained-consent" },
              },
            });
            await lockEntity(tx, "program:period");
            await invalidateSessionPlansForPairings(
              tx,
              [fixture.pairingId],
              now,
            );
            for (const [index, plan] of fixture.plans.entries()) {
              const cohort = await tx.sessionPlanCohort.findUniqueOrThrow({
                where: { id: plan.cohortId },
              });
              const participant =
                await tx.sessionPlanParticipant.findUniqueOrThrow({
                  where: { id: plan.participantId },
                });
              expect(cohort.status).toBe(
                valid[index] ? "SCHEDULED" : "CANCELLED",
              );
              expect(cohort.version).toBe(valid[index] ? 1 : 2);
              expect(participant.status).toBe(
                valid[index] ? "SCHEDULED" : "CANCELLED",
              );
              expect(participant.version).toBe(valid[index] ? 1 : 2);
              expect(
                (
                  await tx.sessionPlanAssignment.findUniqueOrThrow({
                    where: {
                      planId_pairingId: {
                        planId: plan.id,
                        pairingId: fixture.pairingId,
                      },
                    },
                  })
                ).tuteeIds,
              ).toEqual([fixture.tuteeIds[0]]);
            }
            expect(
              await tx.sessionNotice.count({
                where: {
                  recipientUserId: {
                    in: [fixture.tutorUserId, ...fixture.tuteeUserIds],
                  },
                  event: "cancelled",
                },
              }),
            ).toBe(valid.filter((value) => !value).length * 2);
            throw rollback;
          },
          { timeout: 15_000 },
        );
      } catch (error) {
        if (error !== rollback) throw error;
      }
    },
  );
});
