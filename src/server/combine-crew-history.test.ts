import { afterAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { previewCombine } from "./combine-accounts";
import { hashPassword } from "./auth/password";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(async () => {
  // Retired identity guards intentionally reject deletes; isolated fixture cleanup uses TRUNCATE.
  await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
  await db.$disconnect();
});

it("shows one crew member with both patrol histories and refuses merge-family deletion", async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  const password = "Crew-combine-test-190!";
  const head = await db.user.create({
    data: {
      email: "crew-head190@example.test",
      role: "HEAD",
      passwordHash: hashPassword(password),
    },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Combined Crew Tutor", status: "ACTIVE" },
  });
  const survivor = await db.user.create({
    data: {
      email: "crew-keep190@example.test",
      username: "crewkeep190",
      role: "TUTOR",
      tutorId: tutor.id,
      crewStatus: "ACTIVE",
      passwordHash: hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  });
  const duplicate = await db.user.create({
    data: {
      email: "crew-retire190@example.test",
      username: "crewretire190",
      role: "TUTOR",
      crewStatus: "ACTIVE",
    },
  });
  const original = await db.patrol.create({
    data: {
      crewUserId: duplicate.id,
      hours: 1.5,
      note: "Original historical evidence",
    },
  });
  await db.patrol.create({ data: { crewUserId: survivor.id, hours: 0.5 } });
  const caller = (
    id: string,
    role: Session["role"],
    tutorId: string | null = null,
  ) =>
    createCaller({
      db,
      headers: new Headers(),
      session: { user: { id }, role, tutorId, expires: "2099-01-01T00:00:00Z" },
    });
  const staff = caller(head.id, "HEAD");
  const pair = { survivorId: survivor.id, duplicateId: duplicate.id };
  const preview = await previewCombine(db, pair);
  expect(preview.conflicts).toEqual([]);
  await staff.accountCombine.combine({
    ...pair,
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  });
  const roster = await staff.admin.crewRoster();
  expect(roster).toHaveLength(1);
  expect(roster[0]).toMatchObject({ id: survivor.id, patrols: 2, hours: 2 });
  expect(await caller(survivor.id, "TUTOR", tutor.id).tutor.myCrew()).toEqual({
    isCrew: true,
    patrols: 2,
    hours: 2,
  });
  expect(await db.patrol.findUnique({ where: { id: original.id } })).toEqual(
    original,
  );
  for (const userId of [survivor.id, duplicate.id]) {
    await expect(
      staff.admin.deleteCrewMember({ userId }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      staff.admin.deleteUser({ userId, confirmPassword: password }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  }
  expect(await db.patrol.count()).toBe(2);
});
