import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { inTransaction } from "~/server/transactions";
import {
  newContinuationOpening,
  settleContinuationOpening,
  updateContinuationOpening,
} from "./continuation-opening";
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const at = (hour: number) => new Date(Date.UTC(2026, 10, 1, hour));
beforeEach(async () => {
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
});
afterAll(() => db.$disconnect());

async function term(
  data: {
    active?: boolean;
    signupEnabled?: boolean;
    signupOpensAt?: Date | null;
    signupClosesAt?: Date | null;
  } = {},
) {
  return db.term.create({
    data: {
      id: "destination",
      schoolYear: "26-27",
      quarter: "Q2",
      name: "Destination",
      active: true,
      signupOpensAt: at(10),
      signupClosesAt: at(11),
      ...newContinuationOpening(
        { id: "source", schoolYear: "26-27", quarter: "Q1" },
        { schoolYear: "26-27", quarter: "Q2" },
        false,
        at(9),
      ),
      ...data,
    },
  });
}
const settle = (now: Date) =>
  inTransaction(db, (tx) => settleContinuationOpening(tx, "destination", now));
const change = (
  patch: Parameters<typeof updateContinuationOpening>[2],
  now: Date,
) =>
  inTransaction(db, (tx) =>
    updateContinuationOpening(tx, "destination", patch, now),
  );

it("settles a missed complete window exactly once across concurrent observers", async () => {
  await term();
  const results = await Promise.all([settle(at(12)), settle(at(12))]);
  expect(results.map((row) => row.signupFirstOpenedAt)).toEqual([
    at(10),
    at(10),
  ]);
  expect(
    await db.auditLog.count({
      where: { operation: "program.recordFirstSignupOpening" },
    }),
  ).toBe(1);
});

it("settles the old interval before a pause and never restarts it on reopening", async () => {
  await term({ signupClosesAt: null });
  expect(
    (await change({ signupEnabled: false }, at(11))).signupFirstOpenedAt,
  ).toEqual(at(10));
  const reopened = await change(
    { signupEnabled: true, signupOpensAt: at(12) },
    at(12),
  );
  expect(reopened.signupFirstOpenedAt).toEqual(at(10));
  expect(reopened.continuationSourceTermId).toBe("source");
});

it("does not count disabled intervals and opens at actual enabling", async () => {
  await term({ signupEnabled: false, signupClosesAt: null });
  expect((await settle(at(11))).signupFirstOpenedAt).toBeNull();
  expect(
    (await change({ signupEnabled: true }, at(12))).signupFirstOpenedAt,
  ).toEqual(at(12));
});

it("starts a late activation at activation, never at a historical configured opening", async () => {
  await term({ active: false, signupOpensAt: at(8), signupClosesAt: null });
  expect((await change({ active: true }, at(12))).signupFirstOpenedAt).toEqual(
    at(12),
  );
});

it("moving an unopened schedule preserves no phantom first opening", async () => {
  await term({ signupClosesAt: null });
  await change({ signupOpensAt: at(12) }, at(9));
  expect((await settle(at(11))).signupFirstOpenedAt).toBeNull();
  expect((await settle(at(13))).signupFirstOpenedAt).toEqual(at(12));
});

it("retains millisecond precision when an edit opens a previously scheduled window", async () => {
  const base = +at(10);
  await term({ signupOpensAt: new Date(base + 500), signupClosesAt: null });
  const updated = await change(
    { signupOpensAt: new Date(base + 200) },
    new Date(base + 250),
  );
  expect(updated.signupFirstOpenedAt).toEqual(new Date(base + 250));
});

it("preserves unknown migrated or imported history through reopening", async () => {
  await db.term.create({
    data: {
      id: "destination",
      name: "Imported",
      schoolYear: "26-27",
      quarter: "Q2",
    },
  });
  const row = await change(
    { active: true, signupEnabled: true, signupOpensAt: null },
    at(12),
  );
  expect(row).toMatchObject({
    signupOpeningStateSince: null,
    signupFirstOpenedAt: null,
    continuationSourceTermId: null,
    continuationQuarterTransition: false,
  });
  await expect(
    db.term.update({
      where: { id: row.id },
      data: { signupOpeningStateSince: at(12) },
    }),
  ).rejects.toThrow();
});

it("rolls settlement and audit back with its enclosing write", async () => {
  await term();
  await expect(
    inTransaction(db, async (tx) => {
      await settleContinuationOpening(tx, "destination", at(12));
      throw new Error("Synthetic rollback");
    }),
  ).rejects.toThrow("Synthetic rollback");
  expect(
    (await db.term.findUniqueOrThrow({ where: { id: "destination" } }))
      .signupFirstOpenedAt,
  ).toBeNull();
  expect(await db.auditLog.count()).toBe(0);
});

it("database rejects clock resets and forged source provenance", async () => {
  await term();
  await settle(at(12));
  await expect(
    db.term.update({
      where: { id: "destination" },
      data: { signupFirstOpenedAt: at(12) },
    }),
  ).rejects.toThrow();
  await expect(
    db.term.update({
      where: { id: "destination" },
      data: { continuationSourceTermId: "different" },
    }),
  ).rejects.toThrow();
});

it.each(["direct", "approved"] as const)(
  "%s refresh records the actual source and immediate first opening",
  async (mode) => {
    await db.user.createMany({
      data: (["HEAD", "ADMIN"] as const).map((role) => ({
        id: `opening-${role}`,
        name: role,
        role,
        email: `${role.toLowerCase()}@example.test`,
      })),
    });
    await db.term.create({
      data: {
        id: "source",
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Source",
        active: true,
        signupOpeningStateSince: new Date(Date.now() - 60_000),
      },
    });
    const caller = (role: "HEAD" | "ADMIN") =>
      createCaller({
        db,
        headers: new Headers(),
        session: {
          user: { id: `opening-${role}`, name: role },
          role,
          tutorId: null,
          expires: "2099-01-01",
        },
      });
    const review = await caller("HEAD").program.nextRecruitment();
    const input = {
      confirm: "REFRESH",
      expectedTermId: "source",
      expectedPreparation: review.refreshEvidence,
    };
    const startedAt = Date.now();
    if (mode === "direct") await caller("HEAD").admin.refresh(input);
    else {
      await expect(caller("ADMIN").admin.refresh(input)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      const proposal = await db.approvalRequest.findFirstOrThrow({
        where: { operation: "admin.refresh", state: "PENDING" },
      });
      // Recording an already elapsed opening is observation, not a changed refresh proposal.
      await inTransaction(db, (tx) => settleContinuationOpening(tx, "source"));
      await caller("HEAD").approval.decide({
        id: proposal.id,
        approve: true,
        note: "Reviewed continuation opening",
      });
    }
    const destination = await db.term.findFirstOrThrow({
      where: { active: true },
    });
    expect(destination).toMatchObject({
      quarter: "Q2",
      continuationSourceTermId: "source",
      continuationQuarterTransition: true,
    });
    expect(+destination.signupFirstOpenedAt!).toBeGreaterThanOrEqual(startedAt);
    expect(+destination.signupFirstOpenedAt!).toBeLessThanOrEqual(Date.now());
    expect(
      (await db.term.findUniqueOrThrow({ where: { id: "source" } })).active,
    ).toBe(false);
  },
);
