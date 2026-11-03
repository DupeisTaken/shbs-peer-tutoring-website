import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { applyUndo } from "~/server/audit/log";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { lockEntity } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",")} CASCADE`,
  );
  await db.user.create({
    data: { id: "reviewer", email: "reviewer@example.test", role: "HEAD" },
  });
  await db.tutee.create({
    data: { id: "learner", englishName: "Synthetic learner", status: "ACTIVE" },
  });
  await db.disciplinaryCard.create({
    data: {
      id: "card",
      tuteeId: "learner",
      color: "RED",
      reviewStatus: "VALID",
    },
  });
  await db.studentAppeal.create({
    data: {
      id: "appeal",
      studentId: "learner",
      cardId: "card",
      body: "Synthetic appeal",
    },
  });
  await db.programFeature.upsert({
    where: { key: "DISCIPLINE" },
    create: { key: "DISCIPLINE", enabled: true },
    update: { enabled: true },
  });
});
afterAll(() => db.$disconnect());

it.each(["appeal", "undo"])(
  "%s waits for the recovery period fence before locking its card",
  async (mode) => {
    const held = deferred<void>();
    const release = deferred<void>();
    const started = deferred<number>();
    const blocker = db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const writer = db.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pg_backend_pid() AS pid`;
      started.resolve(backend!.pid);
      return databaseScope.run(tx, async () => {
        if (mode === "undo")
          return applyUndo(
            {
              kind: "card.review",
              payload: {
                id: "card",
                reviewStatus: "PENDING",
                reviewNote: null,
                reviewedAt: null,
                reviewedById: null,
              },
            },
            tx,
          );
        const appeal = await tx.studentAppeal.findUniqueOrThrow({
          where: { id: "appeal" },
        });
        return createCaller({
          db,
          headers: new Headers(),
          session: {
            user: { id: "reviewer" },
            role: "HEAD",
            tutorId: null,
            expires: new Date(Date.now() + 60_000).toISOString(),
          },
        }).student.decideAppeal({
          id: appeal.id,
          expectedUpdatedAt: appeal.updatedAt,
          overturn: true,
          reason: "Synthetic reviewed appeal",
        });
      });
    });
    // Attach immediately so a rejected writer cannot become an unhandled promise
    // while the separate connection checks the real PostgreSQL wait state.
    const outcome = writer.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      const pid = await started.promise;
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND NOT granted) AS waiting`;
        waiting = row?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // Recovery already holding the period fence must remain able to acquire the
      // card row. Before the fix, the waiting writer held it and NOWAIT failed.
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DisciplinaryCard" WHERE id='card' FOR UPDATE NOWAIT`;
      });
      expect(
        (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: "card" } }))
          .reviewStatus,
      ).toBe("VALID");
    } finally {
      release.resolve();
      await blocker;
      const result = await outcome;
      if (!result.ok) throw result.error;
    }
    expect(
      (await db.disciplinaryCard.findUniqueOrThrow({ where: { id: "card" } }))
        .reviewStatus,
    ).toBe(mode === "undo" ? "PENDING" : "INVALID");
    expect(
      (await db.studentAppeal.findUniqueOrThrow({ where: { id: "appeal" } }))
        .state,
    ).toBe(mode === "appeal" ? "UPHELD" : "PENDING");
  },
);
