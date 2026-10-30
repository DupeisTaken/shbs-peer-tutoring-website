import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { resolvePlanningCalendarDay } from "~/lib/session-planning";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { readOverlappingCohorts, readOverlappingHolds } from "./conflict-reads";
import { participantKeys } from "./participants";
import {
  readPublicationValidationSnapshot,
  type PublicationValidationInput,
  type PublicationValidationSnapshot,
} from "./publication-validation";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(async () => {
  await db.$disconnect();
});

type Fixture = {
  prefix: string;
  planId: string;
  otherTutorId: string;
  tuteeIds: string[];
  input: PublicationValidationInput;
};

/** Unique, rollback-only rows include all journal writes and never reset another
 * suite's fixtures. The actual PostgreSQL reader is compared with live readers.
 */
async function withFixture(
  work: (tx: TransactionDb, fixture: Fixture) => Promise<void>,
) {
  const rollback = new Error("Roll back publication-validation fixture");
  try {
    await db.$transaction(
      async (tx) => {
        const prefix = `publication-validation-${randomUUID()}`;
        const tutorId = `${prefix}-tutor`;
        const otherTutorId = `${prefix}-other-tutor`;
        const tuteeIds = [0, 1, 2].map((i) => `${prefix}-learner-${i}`);
        await tx.tutor.createMany({
          data: [tutorId, otherTutorId].map((id) => ({
            id,
            englishName: "Synthetic tutor",
          })),
        });
        await tx.tutee.createMany({
          data: tuteeIds.map((id) => ({
            id,
            englishName: "Synthetic learner",
          })),
        });
        const term = await tx.term.create({
          data: { name: prefix, schoolYear: prefix, quarter: "Q1" },
        });
        const room = await tx.room.create({ data: { name: prefix } });
        const date = "2096-10-06";
        const plan = await tx.sessionPlan.create({
          data: {
            generationKey: prefix,
            tutorId,
            termId: term.id,
            originalDate: date,
            timeZone: "Asia/Shanghai",
            sourceFingerprint: prefix,
          },
        });
        await work(tx, {
          prefix,
          planId: plan.id,
          otherTutorId,
          tuteeIds,
          input: {
            tutorId,
            termId: term.id,
            originalDate: date,
            date,
            participantIds: [tuteeIds[0]!],
            roomId: room.id,
            startMin: 450,
            endMin: 495,
            // This local morning crosses UTC midnight; JSON wall clocks must not
            // be interpreted in the process's timezone when returned to callers.
            startsAt: new Date("2096-10-05T23:30:00.000Z"),
            endsAt: new Date("2096-10-06T00:15:00.000Z"),
          },
        });
        throw rollback;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

const ordered = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

async function cohort(
  tx: TransactionDb,
  f: Fixture,
  suffix: string,
  offset = 0,
  status = "SCHEDULED",
) {
  return tx.sessionPlanCohort.create({
    data: {
      id: `${f.prefix}-${suffix}`,
      planId: f.planId,
      date: f.input.date,
      startMin: f.input.startMin + offset,
      endMin: f.input.endMin + offset,
      startsAt: new Date(f.input.startsAt.getTime() + offset * 60_000),
      endsAt: new Date(f.input.endsAt.getTime() + offset * 60_000),
      roomId: f.input.roomId,
      status,
    },
  });
}

async function pairing(
  tx: TransactionDb,
  f: Fixture,
  suffix: string,
  dayOfWeek: number,
) {
  return tx.pairing.create({
    data: {
      id: `${f.prefix}-${suffix}`,
      tutorId: f.otherTutorId,
      termId: f.input.termId,
      subject: "Synthetic subject",
      dayOfWeek,
      startMin: 449,
      endMin: 494,
      // These independent recurrence fixtures can overlap without reserving
      // one physical room. Room facts are exercised separately below.
      roomId: null,
      scheduleConfirmed: true,
      tutees: { create: { tuteeId: f.tuteeIds[1]! } },
    },
  });
}

describe("fresh initial-publication validation snapshot", () => {
  it("matches live cohort/current-offer readers at strict UTC boundaries and observes preceding writes", async () => {
    await withFixture(async (tx, f) => {
      const occupied = await cohort(tx, f, "occupied");
      const empty = await cohort(tx, f, "empty");
      await cohort(tx, f, "touches-before", -45);
      await cohort(tx, f, "touches-after", 45);
      await cohort(tx, f, "cancelled", 0, "CANCELLED");
      await cohort(tx, f, "recorded", 0, "RECORDED");
      const person = await tx.sessionPlanParticipant.create({
        data: {
          planId: f.planId,
          cohortId: occupied.id,
          tuteeId: f.tuteeIds[0]!,
        },
      });
      await tx.sessionPlanParticipant.create({
        data: {
          planId: f.planId,
          cohortId: empty.id,
          tuteeId: f.tuteeIds[1]!,
          status: "CANCELLED",
        },
      });
      async function request(
        suffix: string,
        offset: number,
        oldOverlap = false,
      ) {
        const request = await tx.sessionPlanningRequest.create({
          data: {
            id: `${f.prefix}-request-${suffix}`,
            planId: f.planId,
            cohortId: occupied.id,
            kind: "RESCHEDULE",
            scope: "ALL",
            participantIds: [f.tuteeIds[0]!],
          },
        });
        for (const [index, minutes] of (oldOverlap
          ? [0, offset]
          : [offset]
        ).entries()) {
          const offer = await tx.sessionPlanningOffer.create({
            data: {
              requestId: request.id,
              sequence: index + 1,
              authorKey: `tutor:${f.input.tutorId}`,
              date: f.input.date,
              startMin: f.input.startMin + minutes,
              endMin: f.input.endMin + minutes,
              startsAt: new Date(f.input.startsAt.getTime() + minutes * 60_000),
              endsAt: new Date(f.input.endsAt.getTime() + minutes * 60_000),
              roomId: f.input.roomId,
              cutoffAt: f.input.startsAt,
            },
          });
          await tx.sessionPlanningRequest.update({
            where: { id: request.id },
            data: { currentOfferId: offer.id },
          });
        }
        return tx.sessionPlanningRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
      }
      const current = await request("current", 0);
      await request("old-overlap-current-touching", 45, true);
      await request("before", -45);
      const accepted = await request("accepted", 0);
      await tx.sessionPlanningRequest.update({
        where: { id: accepted.id },
        data: { status: "ACCEPTED" },
      });
      const foreign = await request("foreign-current", 45);
      await tx.sessionPlanningRequest.update({
        where: { id: foreign.id },
        data: { currentOfferId: current.currentOfferId },
      });

      const snapshot = await readPublicationValidationSnapshot(tx, f.input);
      expect(ordered(snapshot.cohorts)).toEqual(
        ordered(
          await readOverlappingCohorts(tx, f.input.startsAt, f.input.endsAt),
        ),
      );
      expect(ordered(snapshot.holds)).toEqual(
        ordered(
          await readOverlappingHolds(tx, f.input.startsAt, f.input.endsAt),
        ),
      );
      expect(
        snapshot.cohorts
          .filter((row) => row.id.startsWith(f.prefix))
          .map((row) => row.id)
          .sort(),
      ).toEqual([empty.id, occupied.id].sort());
      expect(
        snapshot.cohorts.find((row) => row.id === empty.id)?.participants,
      ).toEqual([]);
      expect(
        snapshot.holds
          .filter((row) => row.id.startsWith(f.prefix))
          .map((row) => row.id),
      ).toEqual([current.id]);
      expect(snapshot.cohorts[0]!.startsAt).toBeInstanceOf(Date);
      expect(snapshot.holds[0]!.offers[0]!.endsAt).toBeInstanceOf(Date);

      await tx.sessionPlanParticipant.update({
        where: { id: person.id },
        data: { cohortId: empty.id },
      });
      await tx.sessionPlanningRequest.update({
        where: { id: current.id },
        data: { status: "ACCEPTED" },
      });
      const fresh = await readPublicationValidationSnapshot(tx, f.input);
      expect(
        fresh.cohorts.find((row) => row.id === occupied.id)?.participants,
      ).toEqual([]);
      expect(
        fresh.cohorts.find((row) => row.id === empty.id)?.participants,
      ).toEqual([{ tuteeId: f.tuteeIds[0] }]);
      expect(fresh.holds.some((row) => row.id === current.id)).toBe(false);
      expect(
        snapshot.cohorts.find((row) => row.id === occupied.id)?.participants,
      ).toEqual([{ tuteeId: f.tuteeIds[0] }]);
    });
  });

  it("uses the shared live calendar including tombstones and makeup weekdays, but civil weekdays for room blocks", async () => {
    await withFixture(async (tx, f) => {
      const civil = new Date(`${f.input.date}T00:00:00Z`).getUTCDay() || 7;
      const mapped = civil === 1 ? 2 : 1;
      for (let day = 1; day <= 7; day++)
        await pairing(tx, f, `day-${day}`, day);
      await tx.schoolCalendarDay.create({
        data: {
          date: f.input.date,
          isSchoolDay: true,
          timetableWeekday: mapped,
          version: 3,
          scheduleRevision: 2,
        },
      });
      await tx.roomUnavailability.create({
        data: {
          roomId: f.input.roomId!,
          dayOfWeek: mapped,
          startMin: 450,
          endMin: 495,
        },
      });
      const read = () => readPublicationValidationSnapshot(tx, f.input);
      const makeup = await read();
      expect(makeup.timetable).toEqual(
        resolvePlanningCalendarDay(
          f.input.date,
          await tx.schoolCalendarDay.findMany(),
        ),
      );
      expect(makeup.recurring.map((row) => row.id)).toEqual([
        `${f.prefix}-day-${mapped}`,
      ]);
      expect(ordered(makeup.recurring)).toEqual(
        ordered(
          await tx.pairing.findMany({
            where: {
              termId: f.input.termId,
              scheduleConfirmed: true,
              dayOfWeek: mapped,
              startMin: { lt: f.input.endMin },
            },
            select: {
              id: true,
              tutorId: true,
              roomId: true,
              startMin: true,
              dayOfWeek: true,
              tutees: { select: { tuteeId: true } },
            },
          }),
        ),
      );
      expect(makeup.roomExists).toBe(true);
      expect(makeup.roomBlocked).toBe(false);
      await tx.roomUnavailability.create({
        data: {
          roomId: f.input.roomId!,
          dayOfWeek: civil,
          startMin: 449,
          endMin: 451,
        },
      });
      expect((await read()).roomBlocked).toBe(true);
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: { isSchoolDay: false, timetableWeekday: null },
      });
      expect((await read()).recurring).toEqual([]);
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: { active: false, scheduleRevision: 4 },
      });
      const reset = await read();
      expect(reset.timetable).toEqual(
        resolvePlanningCalendarDay(
          f.input.date,
          await tx.schoolCalendarDay.findMany(),
        ),
      );
      expect(reset.timetable.calendarRevision).toBe(4);
      expect(reset.recurring.map((row) => row.id)).toEqual(
        civil <= 5 ? [`${f.prefix}-day-${civil}`] : [],
      );
      expect(
        (
          await readPublicationValidationSnapshot(tx, {
            ...f.input,
            roomId: `${f.prefix}-missing`,
          })
        ).roomExists,
      ).toBe(false);
      const online = await readPublicationValidationSnapshot(tx, {
        ...f.input,
        roomId: null,
      });
      expect(online.roomExists).toBe(true);
      expect(online.roomBlocked).toBe(false);
    });
  });

  it("checks weekday hints against the live calendar and falls back after makeup, closure and reset changes", async () => {
    await withFixture(async (tx, f) => {
      for (let day = 1; day <= 7; day++)
        await pairing(tx, f, `hint-day-${day}`, day);
      const firstDay = 1;
      const secondDay = 2;
      await tx.schoolCalendarDay.create({
        data: {
          date: f.input.date,
          isSchoolDay: true,
          timetableWeekday: firstDay,
        },
      });
      // Unfiltered snapshots may contain extra unused canonical/materialized
      // facts. Compare every fact consumed by the actual recurrence decisions.
      const usedFacts = (snapshot: PublicationValidationSnapshot) => {
        const tutorIds = new Set([
          f.input.tutorId,
          ...snapshot.cohorts.map((row) => row.plan.tutorId),
          ...snapshot.holds.map((row) => row.plan.tutorId),
          ...snapshot.recurring.map((row) => row.tutorId),
        ]);
        const tuteeIds = new Set([
          ...f.input.participantIds,
          ...snapshot.cohorts.flatMap((row) =>
            row.participants.map((person) => person.tuteeId),
          ),
          ...snapshot.holds.flatMap((row) =>
            Array.isArray(row.participantIds)
              ? row.participantIds.filter(
                  (id): id is string => typeof id === "string",
                )
              : [],
          ),
          ...snapshot.recurring.flatMap((row) =>
            row.tutees.map((person) => person.tuteeId),
          ),
        ]);
        return {
          cohorts: ordered(snapshot.cohorts),
          holds: ordered(snapshot.holds),
          recurring: ordered(snapshot.recurring),
          timetable: snapshot.timetable,
          roomExists: snapshot.roomExists,
          roomBlocked: snapshot.roomBlocked,
          tutorKeys: new Map(
            [...tutorIds].map((id) => [id, snapshot.keys.tutor.get(id)]),
          ),
          tuteeKeys: new Map(
            [...tuteeIds].map((id) => [id, snapshot.keys.tutee.get(id)]),
          ),
          materialized: new Set(
            snapshot.recurring
              .filter((row) => snapshot.materialized.has(row.id))
              .map((row) => row.id),
          ),
        };
      };
      const compare = async (weekdayHint: number) => {
        const unfiltered = await readPublicationValidationSnapshot(tx, f.input);
        const hinted = await readPublicationValidationSnapshot(tx, {
          ...f.input,
          weekdayHint,
        });
        expect(usedFacts(hinted)).toEqual(usedFacts(unfiltered));
        return hinted;
      };
      expect((await compare(firstDay)).recurring.map((row) => row.id)).toEqual([
        `${f.prefix}-hint-day-${firstDay}`,
      ]);
      expect((await compare(secondDay)).recurring.map((row) => row.id)).toEqual(
        [`${f.prefix}-hint-day-${firstDay}`],
      );
      await compare(0);
      let reads = 0;
      let changeAfterRead = false;
      const interposed = {
        $queryRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const rows = await tx.$queryRaw(strings, ...values);
          if (++reads === 1 && changeAfterRead)
            await tx.schoolCalendarDay.update({
              where: { date: f.input.date },
              data: { timetableWeekday: 3, scheduleRevision: { increment: 1 } },
            });
          return rows;
        },
      } as unknown as TransactionDb;
      await readPublicationValidationSnapshot(interposed, {
        ...f.input,
        weekdayHint: firstDay,
      });
      expect(reads).toBe(1);
      reads = 0;
      changeAfterRead = true;
      // Execute real SQL, then change the calendar before the fallback read.
      // The second statement must be unfiltered and control its own result.
      const interleaved = await readPublicationValidationSnapshot(interposed, {
        ...f.input,
        weekdayHint: secondDay,
      });
      expect(reads).toBe(2);
      expect(interleaved.timetable.effectiveTimetableWeekday).toBe(3);
      expect(interleaved.recurring.map((row) => row.id)).toEqual([
        `${f.prefix}-hint-day-3`,
      ]);
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: {
          timetableWeekday: secondDay,
          scheduleRevision: { increment: 1 },
        },
      });
      expect((await compare(firstDay)).recurring.map((row) => row.id)).toEqual([
        `${f.prefix}-hint-day-${secondDay}`,
      ]);
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: {
          isSchoolDay: false,
          timetableWeekday: null,
          scheduleRevision: { increment: 1 },
        },
      });
      expect((await compare(secondDay)).recurring).toEqual([]);
      expect((await compare(0)).recurring).toEqual([]);
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: { active: false, scheduleRevision: { increment: 1 } },
      });
      const reset = await compare(secondDay);
      expect(reset.timetable).toEqual(
        resolvePlanningCalendarDay(
          f.input.date,
          await tx.schoolCalendarDay.findMany(),
        ),
      );
      await tx.schoolCalendarDay.update({
        where: { date: f.input.date },
        data: {
          active: true,
          isSchoolDay: true,
          timetableWeekday: firstDay,
          scheduleRevision: { increment: 1 },
        },
      });
      expect((await compare(0)).recurring.map((row) => row.id)).toEqual([
        `${f.prefix}-hint-day-${firstDay}`,
      ]);
    });
  });

  it("materializes only regular exceptions for the target date, including cancelled and moved plans and earlier own writes", async () => {
    await withFixture(async (tx, f) => {
      const day = new Date(`${f.input.date}T00:00:00Z`).getUTCDay() || 7;
      const pairings = [];
      for (let i = 0; i < 5; i++)
        pairings.push(await pairing(tx, f, `materialized-${i}`, day));
      for (let i = 0; i < 4; i++) {
        const plan = await tx.sessionPlan.create({
          data: {
            generationKey: `${f.prefix}-exception-${i}`,
            tutorId: f.otherTutorId,
            termId: f.input.termId,
            originalDate: i === 3 ? "2096-10-07" : f.input.date,
            kind: i === 2 ? "EXTRA" : "REGULAR",
            sourceFingerprint: f.prefix,
            timeZone: "Asia/Shanghai",
            assignments: {
              create: {
                pairingId: pairings[i]!.id,
                subject: "Synthetic",
                tuteeIds: f.tuteeIds,
              },
            },
            cohorts: {
              create: {
                date: i === 1 ? "2096-10-07" : f.input.date,
                startMin: 600,
                endMin: 645,
                startsAt: new Date("2096-10-07T02:00:00Z"),
                endsAt: new Date("2096-10-07T02:45:00Z"),
                status: i === 0 ? "CANCELLED" : "SCHEDULED",
                rescheduled: i === 1,
              },
            },
          },
        });
        expect(plan.id).toBeTruthy();
      }
      // Initial publication has inserted this assignment, but not its cohort.
      await tx.sessionPlanAssignment.create({
        data: {
          planId: f.planId,
          pairingId: pairings[4]!.id,
          subject: "Synthetic",
          tuteeIds: f.tuteeIds,
        },
      });
      const snapshot = await readPublicationValidationSnapshot(tx, {
        ...f.input,
        originalDate: "2096-10-05",
      });
      const expected = await tx.sessionPlanAssignment.findMany({
        where: {
          pairingId: { in: pairings.map((row) => row.id) },
          plan: { kind: "REGULAR", originalDate: f.input.date },
        },
        select: { pairingId: true },
      });
      expect(snapshot.materialized).toEqual(
        new Set(expected.map((row) => row.pairingId)),
      );
      expect(snapshot.materialized).toEqual(
        new Set([pairings[0]!.id, pairings[1]!.id, pairings[4]!.id]),
      );
    });
  });

  it("matches canonical aliases and direct precedence across potential recurrences and rereads link changes", async () => {
    await withFixture(async (tx, f) => {
      const directId = `${f.prefix}-direct-user`;
      const retainedId = `${f.prefix}-retained-user`;
      await tx.user.create({
        data: {
          id: directId,
          email: `${directId}@example.test`,
          tutorId: f.otherTutorId,
          studentId: f.tuteeIds[0],
        },
      });
      await tx.user.create({
        data: { id: retainedId, email: `${retainedId}@example.test` },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: f.tuteeIds[0]!, userId: retainedId },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: f.tuteeIds[1]!, userId: directId },
      });
      // A matched student supplies the same user's other role even when that
      // tutor ID was absent from every requested/conflicting tutor list.
      const linkedRole = await readPublicationValidationSnapshot(tx, f.input);
      expect(linkedRole.keys.tutor.get(f.otherTutorId)).toBe(
        `user:${directId}`,
      );
      await tx.tutorProfileOwnership.create({
        data: { tutorId: f.input.tutorId, userId: directId },
      });
      const otherDay =
        ((new Date(`${f.input.date}T00:00:00Z`).getUTCDay() || 7) % 7) + 1;
      await pairing(tx, f, "potential-other-day", otherDay);
      await tx.schoolCalendarDay.create({
        data: { date: f.input.date, isSchoolDay: false },
      });
      const potential = await tx.pairing.findMany({
        where: {
          termId: f.input.termId,
          scheduleConfirmed: true,
          startMin: { lt: f.input.endMin },
        },
        include: { tutees: { select: { tuteeId: true } } },
      });
      const expectedKeys = () =>
        participantKeys(
          tx,
          [f.input.tutorId, ...potential.map((row) => row.tutorId)],
          [
            ...f.input.participantIds,
            ...potential.flatMap((row) =>
              row.tutees.map((person) => person.tuteeId),
            ),
          ],
        );
      const first = await readPublicationValidationSnapshot(tx, f.input);
      expect(first.keys).toEqual(await expectedKeys());
      expect(first.recurring).toEqual([]);
      expect(first.keys.tutor.get(f.input.tutorId)).toBe(`user:${directId}`);
      expect(first.keys.tutor.get(f.otherTutorId)).toBe(`user:${directId}`);
      expect(first.keys.tutee.get(f.tuteeIds[0]!)).toBe(`user:${directId}`);
      expect(first.keys.tutee.get(f.tuteeIds[1]!)).toBe(`user:${directId}`);
      await tx.user.update({
        where: { id: directId },
        data: { studentId: null },
      });
      const next = await readPublicationValidationSnapshot(tx, f.input);
      expect(next.keys).toEqual(await expectedKeys());
      expect(next.keys.tutee.get(f.tuteeIds[0]!)).toBe(`user:${retainedId}`);
      expect(first.keys.tutee.get(f.tuteeIds[0]!)).toBe(`user:${directId}`);
    });
  });
});
