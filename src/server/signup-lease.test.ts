import { afterAll, expect, it, vi } from "vitest";
import { db } from "./db";
import { withSignupLease } from "./signup-admission";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

afterAll(() => db.$disconnect());
it("admits every available slot during simultaneous allocation and rejects only overflow", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const lane = "simultaneous-test";
  await db.signupLease.deleteMany({ where: { slot: { startsWith: `${lane}:` } } });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let entered = 0;
  // Start all eight acquisitions together, holding work until allocation finishes.
  const results = Promise.allSettled(Array.from({ length: 8 }, () => withSignupLease(db, lane, async () => {
    entered++;
    await pending;
  })));
  try {
    await vi.waitFor(() => expect(entered).toBe(8), { timeout: 3000 });
    await expect(withSignupLease(db, lane, async () => undefined)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  } finally { release(); }
  expect((await results).every(result => result.status === "fulfilled")).toBe(true);
  expect(await db.signupLease.count({ where: { slot: { startsWith: `${lane}:` } } })).toBe(0);
});
