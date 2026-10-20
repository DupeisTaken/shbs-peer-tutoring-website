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
async function combine(slotId: string | null = "combined-slot") {
  const state = await caller().pairingGroups.mine();
  return caller().pairingGroups.save({
    snapshot: state.snapshot,
    groups: [{ pairingIds: ["combined-a", "combined-b"], slotId }],
  });
}

beforeEach(async () => {
  // Group and workload writes use the same disposable database and real middleware.
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
          // A valid two-subject group needs both the active and pending student
          // on each subject. Disjoint rosters must fail before workload changes.
          create:
            id === "combined-empty"
              ? []
              : id === "combined-a" || id === "combined-b"
                ? [
                    { tuteeId: "combined-active" },
                    { tuteeId: "combined-pending" },
                  ]
                : [
                    {
                      tuteeId:
                        id === "combined-inactive-only"
                          ? "combined-inactive"
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

it.each(
  [null, 0, 4].flatMap((preferredMaximum) =>
    [null, "combined-slot"].map((slotId) => ({ preferredMaximum, slotId })),
  ),
)(
  "combines and splits real assignments while preserving preference $preferredMaximum and its version with slot $slotId",
  async ({ preferredMaximum, slotId }) => {
    await caller().tutor.setWorkloadPreference({
      preferredMaximum,
      expectedVersion: 0,
    });
    expect(await preference()).toMatchObject({
      count: 3,
      preferredMaximum,
      version: 1,
    });
    const memberships = await db.pairingTutee.findMany({
      orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
    });
    const grouped = await combine(slotId);
    expect(grouped.groups[0]).toMatchObject({
      groupStatus: slotId === null ? "awaiting" : "scheduled",
      groupEligibility: { eligible: true },
    });
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
    expect(await db.pairingTutee.count()).toBe(7);
    expect(
      await db.pairingTutee.findMany({
        orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
      }),
    ).toEqual(memberships);
    expect(await db.session.count()).toBe(0);
  },
);

it.each([null, "combined-slot"])(
  "rejects incomplete subject coverage without changing assignments or workload with slot %s",
  async (slotId) => {
    await caller().tutor.setWorkloadPreference({
      preferredMaximum: 2,
      expectedVersion: 0,
    });
    // Reintroduce the old fixture's defect deliberately: a populated member is
    // insufficient when one student lacks a subject in the proposed group.
    await db.pairingTutee.delete({
      where: {
        pairingId_tuteeId: {
          pairingId: "combined-b",
          tuteeId: "combined-pending",
        },
      },
    });
    const before = await caller().pairingGroups.mine();
    const tutorWorkload = await preference();
    const managementWorkload = await staffWorkload();
    const attempt = combine(slotId);
    await expect(attempt).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(attempt).rejects.toThrow(
      "Synthetic Pending: Synthetic Subject 2",
    );
    expect(await caller().pairingGroups.mine()).toEqual(before);
    expect(await preference()).toEqual(tutorWorkload);
    expect(await staffWorkload()).toEqual(managementWorkload);
    expect(await db.pairingGroup.count()).toBe(0);
    expect(await db.pairingTutee.count()).toBe(6);
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
