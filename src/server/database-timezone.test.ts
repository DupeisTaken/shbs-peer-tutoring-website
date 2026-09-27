import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { db } from "./db";
import { utcDatabaseUrl } from "./database-url";

afterAll(() => db.$disconnect());

it("the application connection uses UTC before any domain query", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  expect(
    await db.$queryRaw`SELECT current_setting('TimeZone') AS zone`,
  ).toEqual([{ zone: "UTC" }]);
});

it.each(["Asia/Shanghai", "America/New_York"])(
  "keeps generated timestamps and expiry comparisons in UTC despite %s startup options",
  async (zone) => {
    assertIsolatedTestDatabase(process.env.DATABASE_URL);
    const source = new URL(process.env.DATABASE_URL!);
    source.searchParams.set(
      "options",
      `-c statement_timeout=5000 -c timezone=${zone}`,
    );
    const client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: utcDatabaseUrl(source.href),
        max: 2,
      }),
    });
    try {
      // Hold two transactions concurrently to force two physical connections.
      // Temporary fixtures disappear on commit/rollback and never touch domain data.
      let firstReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        firstReady = resolve;
      });
      let releaseFirst!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ pid: number; zone: string }[]>`
          SELECT pg_backend_pid() AS pid, current_setting('TimeZone') AS zone`;
        firstReady();
        await release;
        return rows[0]!;
      });
      try {
        // If connection startup fails, propagate it rather than waiting for ready.
        await Promise.race([ready, first]);
        const second = await client.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<
            { pid: number; zone: string; timeout: string }[]
          >`
            SELECT pg_backend_pid() AS pid, current_setting('TimeZone') AS zone,
              current_setting('statement_timeout') AS timeout`;
          await tx.$executeRaw`CREATE TEMP TABLE utc_timestamp_probe (
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP(3) NOT NULL
          ) ON COMMIT DROP`;
          const future = new Date(Date.now() + 60_000);
          const before = Date.now();
          const [stored] = await tx.$queryRaw<
            {
              created_at: Date;
              expires_at: Date;
              expired: boolean;
            }[]
          >`INSERT INTO utc_timestamp_probe (expires_at) VALUES (${future})
            RETURNING created_at, expires_at, expires_at <= CURRENT_TIMESTAMP AS expired`;
          expect(stored!.expires_at.toISOString()).toBe(future.toISOString());
          expect(Math.abs(stored!.created_at.getTime() - before)).toBeLessThan(
            5_000,
          );
          expect(stored!.expired).toBe(false);
          // Exercise both sides of the same mixed-type comparison used by expiry triggers.
          await tx.$executeRaw`UPDATE utc_timestamp_probe SET expires_at = ${new Date(before - 60_000)}`;
          expect(
            await tx.$queryRaw`SELECT expires_at <= CURRENT_TIMESTAMP AS expired FROM utc_timestamp_probe`,
          ).toEqual([{ expired: true }]);
          return rows[0]!;
        });
        releaseFirst();
        const firstRow = await first;
        expect(firstRow.zone).toBe("UTC");
        expect(second.zone).toBe("UTC");
        expect(second.timeout).toBe("5s");
        expect(firstRow.pid).not.toBe(second.pid);
      } finally {
        releaseFirst();
        await first;
      }
    } finally {
      await client.$disconnect();
    }
  },
);
