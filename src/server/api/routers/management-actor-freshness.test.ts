import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { hashPassword } from "~/server/auth/password";
import { lockUsernameNamespace } from "~/server/auth/username";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const actorId = "c000000000000000000000495";
const targetId = "c000000000000000000000496";
const headId = "c000000000000000000000497";
const password = "Synthetic-fresh-authority-492!";
const caller = () => createCaller({ db, headers: new Headers(), session: {
  user: { id: actorId, name: "Admin" }, role: "ADMIN", tutorId: null, expires: "2099-01-01",
} });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Management actor freshness requires serial local shbs_shipping_test");
  (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.delete(`password-confirmation:${actorId}`);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: ([
    [actorId, "ADMIN"], [headId, "HEAD"], [targetId, "STUDENT"],
  ] as const).map(([id, role]) => ({ id, role, email: `${id}@example.test`,
    name: role, passwordHash: hashPassword(password) })) });
});
afterAll(() => db.$disconnect());

it.each([false, true])("lets Admin remove their own management and tutoring together, sole Viewer=%s", async (viewer) => {
  const tutor = await db.tutor.create({ data: { englishName: "Self-demoting Admin", status: "ACTIVE" } });
  const before = await db.user.update({ where: { id: actorId }, data: { tutorId: tutor.id, tutorAccessRevoked: false } });
  await caller().admin.setMemberships({ userId: actorId, confirmPassword: password,
    membership: { rank: "NONE", viewer, tutor: false, tutee: false, translator: false, crew: false } });
  expect(await db.user.findUniqueOrThrow({ where: { id: actorId } })).toMatchObject({
    role: viewer ? "VIEWER" : "STUDENT", tutorId: tutor.id, tutorAccessRevoked: true,
    passwordHash: before.passwordHash, email: before.email, canTranslate: false, tuteeMember: false,
  });
  expect((await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } })).status).toBe("ARCHIVED");
  expect(await db.policyAcceptance.count()).toBe(0);
  expect(await db.approvalRequest.count()).toBe(0);
  await expect(caller().admin.accounts()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it.each(["ADMIN", "COORDINATOR"] as const)("lets Admin grant and remove non-Head %s rank directly", async (role) => {
  await caller().admin.setUserRole({ userId: targetId, role, confirmPassword: password });
  expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).role).toBe(role);
  await caller().admin.setUserRole({ userId: targetId, role: "STUDENT", confirmPassword: password });
  expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).role).toBe("STUDENT");
  await expect(caller().admin.setUserRole({ userId: headId, role: "ADMIN", confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.user.count({ where: { role: "HEAD" } })).toBe(1);
  expect(await db.approvalRequest.count()).toBe(0);
});

it("rejects Coordinator management rank grants and demotions before creating a proposal", async () => {
  await db.user.update({ where: { id: actorId }, data: { role: "COORDINATOR" } });
  const membership = { rank: "NONE" as const, viewer: false, tutor: false,
    tutee: false, translator: false, crew: false };
  for (const rank of ["ADMIN", "COORDINATOR", "HEAD"] as const)
    await expect(caller().admin.setMemberships({ userId: targetId,
      membership: { ...membership, rank }, confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller().admin.setUserRole({ userId: targetId, role: "ADMIN", confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: targetId }, data: { role: "ADMIN" } });
  await expect(caller().admin.setMemberships({ userId: targetId, membership,
    confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).role).toBe("ADMIN");
  expect(await db.approvalRequest.count()).toBe(0);
});

it.each(["demoted", "suspended", "merged", "password"] as const)(
  "rejects a direct Admin role change when the actor becomes %s while waiting for the namespace",
  async (state) => {
    const target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    let announce!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.$transaction(async (tx) => {
      await lockUsernameNamespace(tx);
      announce();
      await gate;
      await tx.user.update({ where: { id: actorId }, data:
        state === "demoted" ? { role: "COORDINATOR" }
          : state === "suspended" ? { suspendedAt: new Date() }
            : state === "merged" ? { mergedIntoId: headId }
              : { passwordHash: hashPassword("Replacement-current-password-492!") },
      });
    }, { timeout: 10_000 }).then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => { announce(); return { status: "rejected" as const, reason }; },
    );
    await ready;
    const changing = caller().admin.setUserRole({ userId: targetId, role: "ADMIN", confirmPassword: password })
      .then((value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }));
    let observed = false;
    try {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`;
        if (rows[0]?.waiting) { observed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally { release(); }
    expect(await writer).toMatchObject({ status: "fulfilled" });
    expect(observed).toBe(true);
    expect(await changing).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toEqual(target);
    expect(await db.approvalRequest.count()).toBe(0);
  },
);
