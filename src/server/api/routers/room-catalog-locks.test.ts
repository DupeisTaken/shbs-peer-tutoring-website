import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { Client } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import type { Room } from "../../../../generated/prisma";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { utcDatabaseUrl } from "~/server/database-url";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// This case creates and removes only its uniquely named synthetic records.
// Validate before any fixture or cleanup can reach the database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);

afterAll(async () => { await db.$disconnect(); }, 10_000);

it("keeps room creation outside an allocation's catalog view until its schedule fence commits", async () => {
  const prefix = `room-catalog-${randomUUID()}`;
  const userId = `${prefix}-admin`;
  const name = `${prefix}-new-room`;
  await db.user.create({ data: {
    id: userId, name: "Synthetic room catalog admin",
    email: `${prefix}@example.test`, role: "ADMIN",
  } });
  const session: Session = {
    user: { id: userId }, role: "ADMIN", tutorId: null,
    expires: "2099-01-01T00:00:00Z",
  };
  const caller = createCaller({ db, headers: new Headers(), session });
  // A separate owned connection both holds the actual scheduling advisory lock
  // and observes its waiter, even when the Prisma pool has only one connection.
  const holder = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
    connectionTimeoutMillis: 3_000, query_timeout: 3_000,
  });
  let holderOpen = false;
  let creating: Promise<Room> | undefined;
  let drained: Promise<PromiseSettledResult<Room>[]> | undefined;
  let signalWriter: (pid: number) => void = () => undefined;
  const writerReady = new Promise<number>((resolve) => { signalWriter = resolve; });
  let finished = false;
  try {
    await holder.connect();
    await holder.query("BEGIN");
    holderOpen = true;
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('planned-room-schedule',0))");
    const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const readCatalog = async () => (await holder.query<{ id: string; programOrder: number }>(
      'SELECT id,"programOrder" FROM "public"."Room" ORDER BY id',
    )).rows;
    const before = await readCatalog();
    // Scope the genuine API request to this transaction so its exact backend
    // can be observed. All permission, audit and room-creation code still runs.
    creating = db.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      signalWriter(backend!.pid);
      return databaseScope.run(tx, () => caller.admin.createRoom({ name }));
    }, { timeout: 15_000 });
    drained = Promise.allSettled([creating]);
    void creating.then(() => { finished = true; }, () => { finished = true; });
    const writerPid = await Promise.race([
      writerReady,
      creating.then(() => { throw new Error("Creation finished before its lock-observation barrier."); }),
    ]);
    await vi.waitUntil(async () => {
      const observation = await holder.query<{ waiting: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid=$1::int AND locktype='advisory' AND NOT granted
            AND $2::int=ANY(pg_blocking_pids($1::int))
        ) AS waiting`, [writerPid, holderPid]);
      return observation.rows[0]?.waiting === true;
    }, { timeout: 5_000, interval: 20 });
    expect(finished).toBe(false);
    expect(await readCatalog()).toEqual(before);

    await holder.query("COMMIT");
    holderOpen = false;
    const created = await creating;
    expect(created.name).toBe(name);
    expect(created.programOrder).toBe((before.length ? Math.max(...before.map((room) => room.programOrder)) : -1) + 1);
    expect(await db.room.findUnique({ where: { id: created.id } })).toEqual(created);
  } finally {
    // Release the blocker before draining the real request; no promise or owned
    // connection may survive a failed observation/assertion into the next case.
    const errors: unknown[] = [];
    try { if (holderOpen) await holder.query("ROLLBACK"); } catch (error) { errors.push(error); }
    try { await holder.end(); } catch (error) { errors.push(error); }
    if (drained) await drained;
    try {
      await db.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { userId } });
        await tx.room.deleteMany({ where: { name } });
        await tx.user.deleteMany({ where: { id: userId } });
      }, { timeout: 10_000 });
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Room catalog fixture cleanup failed.");
  }
}, 35_000);
