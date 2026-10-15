import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { currentPolicy } from "~/server/policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const tutorId = "combined-tutor";
const termId = "combined-current";
function caller(role: Session["role"] = "TUTOR") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: role === "TUTOR" ? "combined-owner" : "combined-admin" },
      role,
      tutorId: role === "TUTOR" ? tutorId : null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}
const preference = () => caller().tutor.workloadPreference();
const staffWorkload = async () =>
  (await caller("ADMIN").admin.assignmentWorkloads()).tutors.find(
    (tutor) => tutor.id === tutorId,
  );
async function combine() {
  const state = await caller().pairingGroups.mine();
  return caller().pairingGroups.save({
    snapshot: state.snapshot,
    groups: [
      { pairingIds: ["combined-a", "combined-b"], slotId: "combined-slot" },
    ],
  });
}

beforeEach(async () => {
  // Both PRs run against the same disposable database and real router middleware.
  // This catches schedule persistence/counting drift that isolated mocks cannot.
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.createMany({
    data: [
      {
        id: termId,
        name: "Current",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
      {
        id: "combined-old",
        name: "Previous",
        schoolYear: "25-26",
        quarter: "Q4",
      },
    ],
  });
  await db.tutor.create({
    data: {
      id: tutorId,
      englishName: "Synthetic Combined Tutor",
      status: "ACTIVE",
    },
  });
  await db.user.createMany({
    data: [
      {
        id: "combined-owner",
        email: "combined-owner@example.test",
        role: "TUTOR",
        tutorId,
      },
      {
        id: "combined-admin",
        email: "combined-admin@example.test",
        role: "ADMIN",
      },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "combined-active",
        englishName: "Synthetic Active",
        status: "ACTIVE",
      },
      {
        id: "combined-pending",
        englishName: "Synthetic Pending",
        status: "PENDING",
      },
      {
        id: "combined-inactive",
        englishName: "Synthetic Inactive",
        status: "INACTIVE",
      },
    ],
  });
  await db.timeSlot.create({
    data: {
      id: "combined-slot",
      label: "Shared Monday",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  for (const [index, id] of [
    "combined-a",
    "combined-b",
    "combined-c",
    "combined-history",
    "combined-empty",
    "combined-inactive-only",
  ].entries()) {
    await db.pairing.create({
      data: {
        id,
        tutorId,
        termId: id === "combined-history" ? "combined-old" : termId,
        subject: `Synthetic Subject ${index + 1}`,
        scheduleConfirmed: id !== "combined-c",
        dayOfWeek: index + 1,
        startMin: 900,
        endMin: 960,
        tutees: {
          create:
            id === "combined-empty"
              ? []
              : [
                  {
                    tuteeId:
                      id === "combined-inactive-only"
                        ? "combined-inactive"
                        : id === "combined-b"
                          ? "combined-pending"
                          : "combined-active",
                  },
                ],
        },
      },
    });
  }
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Synthetic policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: "combined-owner",
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic Tutor",
    },
  });
});
afterAll(() => db.$disconnect());

it.each([null, 0, 4])(
  "combines and splits real assignments while preserving preference %s and its version",
  async (preferredMaximum) => {
    await caller().tutor.setWorkloadPreference({
      preferredMaximum,
      expectedVersion: 0,
    });
    expect(await preference()).toMatchObject({
      count: 3,
      preferredMaximum,
      version: 1,
    });
    const grouped = await combine();
    expect(await preference()).toMatchObject({
      count: 2,
      preferredMaximum,
      version: 1,
    });
    expect(await staffWorkload()).toMatchObject({
      count: 2,
      preferredMaximum,
      version: 1,
    });
    expect(
      (await preference())?.blocks.some(
        (block) =>
          block.pairingIds.includes("combined-a") &&
          block.pairingIds.includes("combined-b"),
      ),
    ).toBe(true);
    // Split returns both members to awaiting-schedule; they reserve separate effort.
    await caller().pairingGroups.save({
      snapshot: grouped.snapshot,
      groups: [],
    });
    expect(await preference()).toMatchObject({
      count: 3,
      preferredMaximum,
      version: 1,
    });
    expect(await staffWorkload()).toMatchObject({
      count: 3,
      preferredMaximum,
      version: 1,
    });
    expect(await db.pairing.count()).toBe(6);
    expect(await db.pairingTutee.count()).toBe(5);
    expect(await db.session.count()).toBe(0);
  },
);

it("rejects stale group saves without changing workload or an independently saved preference", async () => {
  const stale = await caller().pairingGroups.mine();
  await combine();
  await caller().tutor.setWorkloadPreference({
    preferredMaximum: 2,
    expectedVersion: 0,
  });
  await expect(
    caller().pairingGroups.save({ snapshot: stale.snapshot, groups: [] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await preference()).toMatchObject({
    count: 2,
    preferredMaximum: 2,
    version: 1,
  });
  expect(await db.pairingGroup.count()).toBe(1);
});

it("locks inactive tutors to zero and preserves their group when editing is denied", async () => {
  const grouped = await combine();
  await db.tutor.update({
    where: { id: tutorId },
    data: { status: "OPTED_OUT" },
  });
  expect(await preference()).toMatchObject({
    count: 0,
    preferredMaximum: 0,
    canEdit: false,
  });
  expect(await staffWorkload()).toMatchObject({
    count: 0,
    preferredMaximum: 0,
    assignable: false,
  });
  await expect(
    caller().pairingGroups.save({ snapshot: grouped.snapshot, groups: [] }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.pairingGroup.count()).toBe(1);
  await db.tutor.update({ where: { id: tutorId }, data: { status: "ACTIVE" } });
  expect(await preference()).toMatchObject({
    count: 2,
    preferredMaximum: 0,
    canEdit: true,
  });
});
