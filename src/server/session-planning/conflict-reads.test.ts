import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { readOverlappingCohorts, readOverlappingHolds } from "./conflict-reads";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(async () => {
  await db.$disconnect();
});

const date = "2050-11-02";
const instant = (minute: number) => new Date(Date.UTC(2050, 10, 2, 0, minute));

/** Each case owns unique synthetic rows and rolls them back, including journal
 * entries. It never truncates or commits fixture changes in the guarded test DB.
 */
async function withFixture(
  work: (
    tx: TransactionDb,
    fixture: {
      prefix: string;
      planId: string;
      tutorId: string;
      roomId: string;
      tuteeIds: string[];
    },
  ) => Promise<void>,
) {
  const rollback = new Error("Roll back the isolated conflict-read fixture.");
  try {
    await db.$transaction(
      async (tx) => {
        const prefix = `conflict-read-${randomUUID()}`;
        const tutorId = `${prefix}-tutor`;
        const tuteeIds = Array.from(
          { length: 4 },
          (_, i) => `${prefix}-learner-${i}`,
        );
        const term = await tx.term.create({
          data: {
            name: "Synthetic conflict reads",
            schoolYear: prefix,
            quarter: "Q1",
          },
        });
        await tx.tutor.create({
          data: {
            id: tutorId,
            englishName: "Synthetic Tutor",
            status: "ACTIVE",
          },
        });
        await tx.tutee.createMany({
          data: tuteeIds.map((id) => ({
            id,
            englishName: "Synthetic Learner",
            status: "ACTIVE",
          })),
        });
        const room = await tx.room.create({ data: { name: prefix } });
        const plan = await tx.sessionPlan.create({
          data: {
            generationKey: prefix,
            tutorId,
            termId: term.id,
            originalDate: date,
            timeZone: "UTC",
            sourceFingerprint: "synthetic-conflict-read",
          },
        });
        await work(tx, {
          prefix,
          planId: plan.id,
          tutorId,
          roomId: room.id,
          tuteeIds,
        });
        throw rollback;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe("fresh overlapping conflict reads", () => {
  it("keeps strict UTC boundaries, scheduled rosters and empty cohorts, and observes subsequent writes", async () => {
    await withFixture(async (tx, fixture) => {
      const { prefix, planId, tutorId, roomId, tuteeIds } = fixture;
      const ids = Object.fromEntries(
        ["overlap", "empty", "before", "after", "cancelled", "recorded"].map(
          (kind) => [kind, `${prefix}-${kind}`],
        ),
      );
      await tx.sessionPlanCohort.createMany({
        data: [
          { id: ids.overlap, startMin: 900, endMin: 945, status: "SCHEDULED" },
          { id: ids.empty, startMin: 900, endMin: 945, status: "SCHEDULED" },
          { id: ids.before, startMin: 855, endMin: 900, status: "SCHEDULED" },
          { id: ids.after, startMin: 945, endMin: 990, status: "SCHEDULED" },
          {
            id: ids.cancelled,
            startMin: 900,
            endMin: 945,
            status: "CANCELLED",
          },
          { id: ids.recorded, startMin: 900, endMin: 945, status: "RECORDED" },
        ].map((row) => ({
          ...row,
          planId,
          date,
          roomId: row.id === ids.empty ? null : roomId,
          online: row.id === ids.empty,
          startsAt: instant(row.startMin),
          endsAt: instant(row.endMin),
        })),
      });
      const scheduled = await tx.sessionPlanParticipant.create({
        data: { planId, cohortId: ids.overlap, tuteeId: tuteeIds[0]! },
      });
      await tx.sessionPlanParticipant.create({
        data: {
          planId,
          cohortId: ids.overlap,
          tuteeId: tuteeIds[1]!,
          status: "CANCELLED",
        },
      });
      await tx.sessionPlanParticipant.create({
        data: {
          planId,
          cohortId: ids.empty,
          tuteeId: tuteeIds[2]!,
          status: "CANCELLED",
        },
      });
      const owned = new Set(Object.values(ids));
      // Offset-bearing input represents the same instants; no date-label filter is allowed.
      const startsAt = new Date("2050-11-02T23:00:00+08:00");
      const endsAt = new Date("2050-11-02T23:45:00+08:00");
      const rows = (await readOverlappingCohorts(tx, startsAt, endsAt)).filter(
        (row) => owned.has(row.id),
      );
      expect(rows.map((row) => row.id).sort()).toEqual(
        [ids.overlap, ids.empty].sort(),
      );
      const occupied = rows.find((row) => row.id === ids.overlap)!;
      expect(occupied).toEqual({
        id: ids.overlap,
        planId,
        startsAt: instant(900),
        endsAt: instant(945),
        roomId,
        online: false,
        plan: { tutorId },
        participants: [{ tuteeId: tuteeIds[0] }],
      });
      expect(occupied.startsAt).toBeInstanceOf(Date);
      expect(occupied.endsAt).toBeInstanceOf(Date);
      expect(rows.find((row) => row.id === ids.empty)?.participants).toEqual(
        [],
      );
      expect(rows.find((row) => row.id === ids.empty)).toMatchObject({
        roomId: null,
        online: true,
      });

      await tx.sessionPlanParticipant.update({
        where: { id: scheduled.id },
        data: { cohortId: ids.empty },
      });
      const next = (await readOverlappingCohorts(tx, startsAt, endsAt)).filter(
        (row) => owned.has(row.id),
      );
      expect(next.find((row) => row.id === ids.overlap)?.participants).toEqual(
        [],
      );
      expect(next.find((row) => row.id === ids.empty)?.participants).toEqual([
        { tuteeId: tuteeIds[0] },
      ]);
    });
  });

  it("joins only a pending request's own current offer and retains exclusion, parent and JSON identity facts", async () => {
    await withFixture(async (tx, fixture) => {
      const { prefix, planId, tutorId, roomId, tuteeIds } = fixture;
      const source = await tx.sessionPlanCohort.create({
        data: {
          planId,
          date,
          startMin: 900,
          endMin: 945,
          startsAt: instant(900),
          endsAt: instant(945),
        },
      });
      const parent = await tx.sessionPlanningRequest.create({
        data: {
          planId,
          cohortId: source.id,
          kind: "EXTRA",
          scope: "ALL",
          participantIds: tuteeIds,
          status: "SPLIT",
        },
      });
      const requestIds: string[] = [parent.id];
      async function request(
        kind: string,
        currentStart: number | null,
        options: {
          oldStart?: number;
          status?: string;
          parentRequestId?: string;
        } = {},
      ) {
        const row = await tx.sessionPlanningRequest.create({
          data: {
            id: `${prefix}-request-${kind}`,
            planId,
            cohortId: source.id,
            kind: "EXTRA",
            scope: "ONE",
            participantIds: [tuteeIds[0]!],
            status: options.status ?? "PENDING",
            parentRequestId: options.parentRequestId,
          },
        });
        requestIds.push(row.id);
        let sequence = 0;
        for (const startMin of [options.oldStart, currentStart]) {
          if (startMin === undefined || startMin === null) continue;
          const offer = await tx.sessionPlanningOffer.create({
            data: {
              requestId: row.id,
              sequence: ++sequence,
              authorKey: `tutor:${tutorId}`,
              date,
              startMin,
              endMin: startMin + 45,
              startsAt: instant(startMin),
              endsAt: instant(startMin + 45),
              roomId,
              cutoffAt: instant(startMin),
            },
          });
          if (startMin === currentStart) {
            await tx.sessionPlanningRequest.update({
              where: { id: row.id },
              data: { currentOfferId: offer.id },
            });
          }
        }
        return tx.sessionPlanningRequest.findUniqueOrThrow({
          where: { id: row.id },
        });
      }
      await request("historical-only", 945, { oldStart: 900 });
      const current = await request("current", 900, {
        oldStart: 855,
        parentRequestId: parent.id,
      });
      await request("before", 855);
      await request("after", 945);
      await request("cancelled", 900, { status: "CANCELLED" });
      await request("no-offer", null);
      const malformed = await request("foreign-current-pointer", null);
      await tx.sessionPlanningRequest.update({
        where: { id: malformed.id },
        data: { currentOfferId: current.currentOfferId },
      });
      const owned = new Set(requestIds);
      const rows = (
        await readOverlappingHolds(tx, instant(900), instant(945))
      ).filter((row) => owned.has(row.id));
      expect(rows).toEqual([
        {
          id: current.id,
          currentOfferId: current.currentOfferId,
          kind: "EXTRA",
          parentRequestId: parent.id,
          participantIds: [tuteeIds[0]],
          plan: { tutorId },
          offers: [
            {
              id: current.currentOfferId,
              startsAt: instant(900),
              endsAt: instant(945),
              roomId,
              online: false,
            },
          ],
        },
      ]);
      expect(rows[0]!.offers[0]!.startsAt).toBeInstanceOf(Date);
      const excluded = await readOverlappingHolds(
        tx,
        instant(900),
        instant(945),
        current.id,
      );
      expect(excluded.filter((row) => owned.has(row.id))).toEqual([]);
      await tx.sessionPlanningRequest.update({
        where: { id: current.id },
        data: { status: "ACCEPTED" },
      });
      expect(
        (await readOverlappingHolds(tx, instant(900), instant(945))).filter(
          (row) => owned.has(row.id),
        ),
      ).toEqual([]);
    });
  });
});
