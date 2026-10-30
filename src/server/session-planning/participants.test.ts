import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { participantKeys, participantsOverlap } from "./participants";

it("uses one tagged query with bound arrays and retains duplicate/empty fallback order", async () => {
  const query = vi
    .fn<
      (text: TemplateStringsArray, ...values: unknown[]) => Promise<never[]>
    >()
    .mockResolvedValue([]);
  const database = { $queryRaw: query } as unknown as TransactionDb;
  const literalId = "literal-'\"; SELECT unchanged --";
  const tutorIds = ["second", "first", "second", "", literalId];
  const tuteeIds = ["first", "missing", "first"];
  const keys = await participantKeys(database, tutorIds, tuteeIds);
  expect(query).toHaveBeenCalledTimes(1);
  const [text, ...values] = query.mock.calls[0]!;
  expect(Array.isArray(text.raw)).toBe(true);
  expect(text.join("?")).not.toContain(literalId);
  expect(values).toEqual([tutorIds, tuteeIds, tutorIds, tuteeIds]);
  expect([...keys.tutor]).toEqual([
    ["second", "tutor:second"],
    ["first", "tutor:first"],
    ["", "tutor:"],
    [literalId, `tutor:${literalId}`],
  ]);
  expect([...keys.tutee]).toEqual([
    ["first", "tutee:first"],
    ["missing", "tutee:missing"],
  ]);
});

/** Unique, rollback-only fixtures never truncate or retain another suite's data. */
async function withFixture(
  work: (tx: TransactionDb, prefix: string) => Promise<void>,
) {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const rollback = new Error("Rollback participant-key fixture");
  await db
    .$transaction(async (tx) => {
      await work(tx, `participant-keys-${randomUUID()}`);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

afterAll(async () => {
  await db.$disconnect();
});

describe("fresh PostgreSQL canonical participant reads", () => {
  it("joins current and retained aliases while keeping unowned tutor/tutee IDs separate", async () => {
    await withFixture(async (tx, prefix) => {
      expect(await participantKeys(tx, [], [])).toEqual({
        tutor: new Map(),
        tutee: new Map(),
      });
      const tutorId = `${prefix}-current-tutor`;
      const retainedTutor = `${prefix}-retained-tutor`;
      const studentId = `${prefix}-current-student`;
      const retainedStudent = `${prefix}-retained-student`;
      const sharedRoleId = `${prefix}-separate-roles`;
      const userId = `${prefix}-user`;
      const missing = `${prefix}-missing`;
      await tx.tutor.createMany({
        data: [tutorId, retainedTutor, sharedRoleId].map((id) => ({
          id,
          englishName: "Synthetic tutor",
        })),
      });
      await tx.tutee.createMany({
        data: [studentId, retainedStudent, sharedRoleId].map((id) => ({
          id,
          englishName: "Synthetic learner",
        })),
      });
      await tx.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          tutorId,
          studentId,
        },
      });
      await tx.tutorProfileOwnership.create({
        data: { tutorId: retainedTutor, userId },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: retainedStudent, userId },
      });

      const keys = await participantKeys(
        tx,
        [tutorId, retainedTutor, tutorId, missing, sharedRoleId],
        [studentId, retainedStudent, studentId, missing, sharedRoleId],
      );
      expect([...keys.tutor]).toEqual([
        [tutorId, `user:${userId}`],
        [retainedTutor, `user:${userId}`],
        [missing, `tutor:${missing}`],
        [sharedRoleId, `tutor:${sharedRoleId}`],
      ]);
      expect([...keys.tutee]).toEqual([
        [studentId, `user:${userId}`],
        [retainedStudent, `user:${userId}`],
        [missing, `tutee:${missing}`],
        [sharedRoleId, `tutee:${sharedRoleId}`],
      ]);
      expect(
        participantsOverlap(keys, tutorId, [], missing, [retainedStudent]),
      ).toBe(true);
      expect(
        participantsOverlap(keys, retainedTutor, [], missing, [studentId]),
      ).toBe(true);
      expect(
        participantsOverlap(keys, sharedRoleId, [], missing, [sharedRoleId]),
      ).toBe(false);
    });
  });

  it("prefers a direct user link over retained ownership and retains the other linked role", async () => {
    await withFixture(async (tx, prefix) => {
      const tutorId = `${prefix}-tutor`;
      const studentId = `${prefix}-student`;
      const direct = `${prefix}-direct`;
      const retained = `${prefix}-retained`;
      await tx.tutor.create({
        data: { id: tutorId, englishName: "Synthetic direct tutor" },
      });
      await tx.tutee.create({
        data: { id: studentId, englishName: "Synthetic direct learner" },
      });
      await tx.user.create({
        data: {
          id: direct,
          email: `${direct}@example.test`,
          tutorId,
          studentId,
        },
      });
      await tx.user.create({
        data: { id: retained, email: `${retained}@example.test` },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: studentId, userId: retained },
      });
      // Tutor ownership guards require a direct login and retained tutor owner
      // to agree. Student history permits the legacy disagreement tested above.
      await tx.tutorProfileOwnership.create({
        data: { tutorId, userId: direct },
      });

      const throughStudent = await participantKeys(tx, [], [studentId]);
      expect([...throughStudent.tutor]).toEqual([[tutorId, `user:${direct}`]]);
      expect([...throughStudent.tutee]).toEqual([
        [studentId, `user:${direct}`],
      ]);
      const throughTutor = await participantKeys(tx, [tutorId], []);
      expect([...throughTutor.tutor]).toEqual([[tutorId, `user:${direct}`]]);
      expect([...throughTutor.tutee]).toEqual([[studentId, `user:${direct}`]]);
    });
  });

  it("rereads ownership and direct-link changes on every call without mutating earlier maps", async () => {
    await withFixture(async (tx, prefix) => {
      const studentId = `${prefix}-student`;
      const first = `${prefix}-first`;
      const second = `${prefix}-second`;
      await tx.tutee.create({
        data: { id: studentId, englishName: "Synthetic retained learner" },
      });
      await tx.user.createMany({
        data: [first, second].map((id) => ({
          id,
          email: `${id}@example.test`,
        })),
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: studentId, userId: first },
      });
      const original = await participantKeys(tx, [], [studentId]);
      await tx.studentProfileOwnership.update({
        where: { tuteeId: studentId },
        data: { userId: second, revision: { increment: 1 } },
      });
      const reassigned = await participantKeys(tx, [], [studentId]);
      expect(original.tutee.get(studentId)).toBe(`user:${first}`);
      expect(reassigned.tutee.get(studentId)).toBe(`user:${second}`);
      await tx.user.update({ where: { id: first }, data: { studentId } });
      expect(
        (await participantKeys(tx, [], [studentId])).tutee.get(studentId),
      ).toBe(`user:${first}`);
      await tx.user.update({ where: { id: first }, data: { studentId: null } });
      expect(
        (await participantKeys(tx, [], [studentId])).tutee.get(studentId),
      ).toBe(`user:${second}`);
      expect(original.tutee.get(studentId)).toBe(`user:${first}`);
    });
  });
});
