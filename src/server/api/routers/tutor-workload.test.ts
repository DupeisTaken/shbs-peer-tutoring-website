import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { approveQualification } from "~/server/qualifications";
import { workloadPreferenceInput } from "~/server/tutor-workload";
import { safeAuditSnapshot } from "~/server/audit/evidence";
import { ApprovalQueued } from "~/server/approvals";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const caller = (id = "staff", role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, email: `${id}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
let tutorId: string;
let otherTutorId: string;
let termId: string;
let tuteeId: string;
beforeEach(async () => {
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
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic Workload Tutor" },
  });
  const other = await db.tutor.create({
    data: { englishName: "Synthetic Zero Tutor" },
  });
  tutorId = tutor.id;
  otherTutorId = other.id;
  await db.user.createMany({
    data: [
      { id: "staff", email: "staff@example.test", role: "ADMIN" },
      {
        id: "coordinator",
        email: "coordinator@example.test",
        role: "COORDINATOR",
      },
      { id: "viewer", email: "viewer@example.test", role: "VIEWER" },
      { id: "owner", email: "owner@example.test", role: "TUTOR", tutorId },
      {
        id: "other",
        email: "other@example.test",
        role: "TUTOR",
        tutorId: otherTutorId,
      },
    ],
  });
  termId = (
    await db.term.create({
      data: {
        name: "Synthetic current quarter",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
    })
  ).id;
  tuteeId = (
    await db.tutee.create({
      data: { englishName: "Synthetic Pending Tutee", status: "PENDING" },
    })
  ).id;
});
afterAll(() => db.$disconnect());
const preference = () => caller("owner", "TUTOR").tutor.workloadPreference();
const save = (preferredMaximum: number | null, expectedVersion = 0) =>
  caller("owner", "TUTOR").tutor.setWorkloadPreference({
    preferredMaximum,
    expectedVersion,
  });
const workload = async () =>
  (await caller().admin.assignmentWorkloads()).tutors.find(
    (row) => row.id === tutorId,
  )!;
const pairing = (
  fields: Partial<{
    tutorId: string;
    termId: string;
    scheduleConfirmed: boolean;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
    tuteeIds: string[];
  }> = {},
) => {
  const { tuteeIds = [tuteeId], ...data } = fields;
  return db.pairing.create({
    data: {
      tutorId,
      termId,
      subject: "Synthetic subject",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      ...data,
      tutees: { create: tuteeIds.map((id) => ({ tuteeId: id })) },
    },
  });
};
it("counts current shared blocks once, pending placeholders separately, zero explicitly, and excludes empty/history/inactive-only rosters", async () => {
  await pairing();
  await pairing();
  await pairing({ scheduleConfirmed: false });
  await pairing({ scheduleConfirmed: false });
  await pairing({ dayOfWeek: 2 });
  await pairing({ dayOfWeek: 3, tuteeIds: [] });
  const inactive = await db.tutee.create({
    data: { englishName: "Synthetic Inactive", status: "INACTIVE" },
  });
  await pairing({ dayOfWeek: 4, tuteeIds: [inactive.id] });
  const old = await db.term.create({
    data: { name: "Synthetic ended", schoolYear: "25-26", quarter: "Q4" },
  });
  await pairing({ termId: old.id });
  expect((await workload()).count).toBe(4);
  expect(
    (await caller().admin.assignmentWorkloads()).tutors.find(
      (row) => row.id === otherTutorId,
    )?.count,
  ).toBe(0);
  expect((await preference())?.count).toBe(4);
});
it("retains confirmed work when its catalog slot becomes inactive and ignores historical attendance", async () => {
  const slot = await db.timeSlot.create({
    data: {
      label: "Synthetic archived slot",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      active: false,
    },
  });
  const p = await pairing();
  await db.pairing.update({
    where: { id: p.id },
    data: { timeSlotId: slot.id },
  });
  await db.session.create({
    data: {
      pairingId: p.id,
      tutorId,
      date: new Date("2026-01-01"),
      month: "2026-01",
      schoolYear: "25-26",
      quarter: "Q2",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
    },
  });
  expect((await workload()).count).toBe(1);
});
it("uses the same single current quarter as assignment when an older active flag remains", async () => {
  await pairing();
  const older = await db.term.create({
    data: {
      name: "Synthetic older active flag",
      schoolYear: "25-26",
      quarter: "Q3",
      active: true,
      createdAt: new Date("2020-01-01"),
    },
  });
  await pairing({ termId: older.id, dayOfWeek: 2 });
  const context = await caller().admin.assignmentWorkloads();
  expect(context.termId).toBe(termId);
  expect(context.tutors.find((row) => row.id === tutorId)?.count).toBe(1);
});
it.each(["inactive", "revoked"] as const)(
  "keeps retained %s pairings visible while authoritative eligibility suppresses current and projected workload",
  async (kind) => {
    const retained = await pairing();
    await save(0);
    expect(await workload()).toMatchObject({ count: 1, assignable: true });
    if (kind === "inactive")
      await db.tutor.update({
        where: { id: tutorId },
        data: { status: "OPTED_OUT" },
      });
    else
      await db.user.update({
        where: { id: "owner" },
        data: { tutorAccessRevoked: true },
      });
    expect(
      (await caller().admin.pairings()).some((row) => row.id === retained.id),
    ).toBe(true);
    expect(await workload()).toMatchObject({
      count: 0,
      blocks: [],
      assignable: false,
    });
    if (kind === "inactive")
      await db.tutor.update({
        where: { id: tutorId },
        data: { status: "ACTIVE" },
      });
    else
      await db.user.update({
        where: { id: "owner" },
        data: { tutorAccessRevoked: false },
      });
    expect(await workload()).toMatchObject({
      count: 1,
      assignable: true,
      preferredMaximum: 0,
    });
  },
);
it("refreshes after reassignment, removing the last current tutee and deleting a block", async () => {
  const p = await pairing();
  expect((await workload()).count).toBe(1);
  await db.pairing.update({
    where: { id: p.id },
    data: { tutorId: otherTutorId },
  });
  expect((await workload()).count).toBe(0);
  expect(
    (await caller().admin.assignmentWorkloads()).tutors.find(
      (row) => row.id === otherTutorId,
    )?.count,
  ).toBe(1);
  await db.pairingTutee.deleteMany({ where: { pairingId: p.id } });
  expect(
    (await caller().admin.assignmentWorkloads()).tutors.find(
      (row) => row.id === otherTutorId,
    )?.count,
  ).toBe(0);
  const next = await pairing();
  await caller().admin.deletePairing({ id: next.id });
  expect((await workload()).count).toBe(0);
});
it("distinguishes unset, explicit zero, upper boundary and clearing with an independent version", async () => {
  expect(await preference()).toMatchObject({
    preferredMaximum: null,
    version: 0,
  });
  await save(0);
  expect(await preference()).toMatchObject({ preferredMaximum: 0, version: 1 });
  await save(4, 1);
  expect(await preference()).toMatchObject({ preferredMaximum: 4, version: 2 });
  await save(null, 2);
  expect(await preference()).toMatchObject({
    preferredMaximum: null,
    version: 3,
  });
  expect(
    safeAuditSnapshot(
      { preferredAssignedBlocks: 4, workloadPreferenceVersion: 2 },
      "Tutor",
    ),
  ).toMatchObject({ preferredAssignedBlocks: 4, workloadPreferenceVersion: 2 });
});
it.each([-1, 5, 1.5, NaN])(
  "rejects invalid preference %s on the server",
  async (preferredMaximum) => {
    await expect(save(preferredMaximum)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await preference())?.version).toBe(0);
  },
);
it("rejects a target ID, private workload observers and accounts without linked tutor ownership", async () => {
  expect(
    workloadPreferenceInput.safeParse({
      preferredMaximum: 1,
      expectedVersion: 0,
      tutorId: otherTutorId,
    }).success,
  ).toBe(false);
  await expect(
    caller("viewer", "VIEWER").admin.assignmentWorkloads(),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller().tutor.setWorkloadPreference({
      preferredMaximum: 1,
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller("other", "TUTOR").tutor.setWorkloadPreference({
    preferredMaximum: 2,
    expectedVersion: 0,
  });
  expect((await preference())?.preferredMaximum).toBeNull();
});
it.each(["revoked", "suspended", "departed"] as const)(
  "rejects %s participation even with an old tutor session",
  async (kind) => {
    if (kind === "revoked")
      await db.user.update({
        where: { id: "owner" },
        data: { tutorAccessRevoked: true },
      });
    if (kind === "suspended")
      await db.user.update({
        where: { id: "owner" },
        data: { suspendedAt: new Date() },
      });
    if (kind === "departed")
      await db.schoolDeparture.create({
        data: {
          userId: "owner",
          reason: "GRADUATED",
          source: "synthetic-test",
        },
      });
    await expect(save(2)).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
it.each(["VIEWER", "departure"] as const)(
  "withholds advisory scalars from legacy %s roster/pairing projections",
  async (access) => {
    await save(3);
    await pairing();
    if (access === "departure")
      await db.schoolDeparture.create({
        data: {
          userId: "owner",
          reason: "GRADUATED",
          source: "synthetic-test",
        },
      });
    const observer =
      access === "VIEWER"
        ? caller("viewer", "VIEWER")
        : caller("owner", "TUTOR");
    const tutors = await observer.admin.tutors();
    const pairings = await observer.admin.pairings();
    expect(JSON.stringify({ tutors, pairings })).not.toContain(
      "preferredAssignedBlocks",
    );
    expect(JSON.stringify({ tutors, pairings })).not.toContain(
      "workloadPreferenceVersion",
    );
    await expect(observer.admin.assignmentWorkloads()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    if (access === "departure")
      expect(await observer.tutor.workloadPreference()).toMatchObject({
        preferredMaximum: 3,
        canEdit: false,
      });
  },
);
it("resets inactive status to zero, rejects stale drafts and leaves zero on reactivation", async () => {
  await pairing();
  await save(4);
  await db.tutor.update({
    where: { id: tutorId },
    data: { status: "OPTED_OUT" },
  });
  expect(await preference()).toMatchObject({
    preferredMaximum: 0,
    count: 0,
    version: 2,
  });
  await expect(save(3, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.tutor.update({ where: { id: tutorId }, data: { status: "ACTIVE" } });
  expect(await preference()).toMatchObject({
    preferredMaximum: 0,
    count: 1,
    version: 2,
  });
  await expect(save(3, 1)).rejects.toMatchObject({ code: "CONFLICT" });
  await save(2, 2);
});
it("admits one concurrent versioned save and preserves current choice on a stale retry", async () => {
  const results = await Promise.allSettled([save(2), save(3)]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const current = await preference();
  expect(current?.version).toBe(1);
  await expect(save(4)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await preference())?.preferredMaximum).toBe(
    current?.preferredMaximum,
  );
});
it("serializes an active save racing inactivity so the final value is always locked zero", async () => {
  await save(4);
  const outcomes = await Promise.allSettled([
    save(2, 1),
    db.tutor.update({
      where: { id: tutorId },
      data: { status: "TRANSFERRED" },
    }),
  ]);
  expect(outcomes[1]?.status).toBe("fulfilled");
  const current = await preference();
  expect(current).toMatchObject({ preferredMaximum: 0, status: "TRANSFERRED" });
  expect(current!.version).toBeGreaterThanOrEqual(2);
});
it("lowering below load retains assignments and a qualified over-preference assignment still commits under existing staff rules", async () => {
  await pairing();
  await save(0);
  const subject = await db.subject.create({
    data: { name: "Synthetic Workload Mathematics" },
  });
  const slot = await db.timeSlot.create({
    data: {
      label: "Synthetic Tuesday",
      dayOfWeek: 2,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.$transaction((tx) =>
    approveQualification(tx, tutorId, subject.id, "staff"),
  );
  const otherTutee = await db.tutee.create({
    data: { englishName: "Synthetic second tutee" },
  });
  const created = await caller().admin.createPairing({
    tutorId,
    subject: subject.name,
    subjectId: subject.id,
    timeSlotId: slot.id,
    tuteeIds: [otherTutee.id],
  });
  expect(created.tutorId).toBe(tutorId);
  expect(await db.pairing.count({ where: { tutorId } })).toBe(2);
  expect(await workload()).toMatchObject({ count: 2, preferredMaximum: 0 });
  expect(await db.approvalRequest.count()).toBe(0);
  await expect(
    caller("coordinator", "COORDINATOR").admin.assignmentWorkloads(),
  ).resolves.toHaveProperty("tutors");
});
it("keeps queued assignment evidence and sibling profile versions unchanged by advisory saves", async () => {
  const subject = await db.subject.create({
    data: { name: "Synthetic queued subject" },
  });
  const slot = await db.timeSlot.create({
    data: {
      label: "Synthetic queued slot",
      dayOfWeek: 2,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.$transaction((tx) =>
    approveQualification(tx, tutorId, subject.id, "staff"),
  );
  const payload = {
    tutorId,
    subject: subject.name,
    subjectId: subject.id,
    timeSlotId: slot.id,
    tuteeIds: [tuteeId],
  };
  await expect(
    caller("coordinator", "COORDINATOR").admin.createPairing(payload),
  ).rejects.toHaveProperty("cause", expect.any(ApprovalQueued));
  const proposal = await db.approvalRequest.findFirstOrThrow();
  expect(JSON.stringify(proposal.targets)).not.toContain(
    "preferredAssignedBlocks",
  );
  expect(JSON.stringify(proposal.targets)).not.toContain(
    "workloadPreferenceVersion",
  );
  const before = await db.tutor.findUniqueOrThrow({ where: { id: tutorId } });
  const ownerBefore = await db.user.findUniqueOrThrow({
    where: { id: "owner" },
  });
  await save(4);
  await save(0, 1);
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: tutorId } })).updatedAt,
  ).toEqual(before.updatedAt);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "owner" } }))
      .profileVersion,
  ).toBe(ownerBefore.profileVersion);
  await caller().approval.decide({
    id: proposal.id,
    approve: true,
    note: "Advisory preference does not change assignment authorization",
  });
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }))
      .state,
  ).toBe("APPROVED");
  expect(await workload()).toMatchObject({ count: 1, preferredMaximum: 0 });
});
