import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import {
  approveQualification,
  assertQualified,
  eligibleSubjectIds,
} from "~/server/qualifications";
import { ApprovalQueued } from "~/server/approvals";

const caller = (role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: `catalogue-${role}`,
        name: role,
        email: `${role}@example.test`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw Error("Catalogue tests require the isolated shipping test database");
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
  await db.user.createMany({
    data: ["HEAD", "COORDINATOR", "VIEWER", "TUTOR"].map((role) => ({
      id: `catalogue-${role}`,
      role: role as Session["role"],
      email: `${role}@example.test`,
    })),
  });
  await db.tutor.createMany({
    data: [
      { id: "tutor", englishName: "Synthetic Tutor", status: "ACTIVE" },
      { id: "future", englishName: "Future Tutor", status: "ACTIVE" },
    ],
  });
  await db.subjectLevel.createMany({
    data: [
      { id: "standard", name: "Standard", prefix: "", rank: 0 },
      { id: "honors", name: "Honors", prefix: "Honors", rank: 1 },
      { id: "ap", name: "AP", prefix: "AP", rank: 2 },
    ],
  });
});
afterAll(() => db.$disconnect());

async function calculus() {
  const group = await caller().admin.saveCourseGroup({
    name: "Calculus",
    offerings: [
      { levelId: "ap", baseName: "Calculus AB" },
      { levelId: "standard", baseName: "Calculus" },
      { levelId: "honors", baseName: "Calculus" },
    ],
  });
  const variants = await db.subject.findMany({
    where: { groupId: group.id },
    orderBy: { level: { rank: "asc" } },
  });
  return {
    group,
    standard: variants[0]!,
    honors: variants[1]!,
    ap: variants[2]!,
  };
}

it("creates separate names per level and orders all selection APIs by group then beginner level", async () => {
  const { group } = await calculus();
  const computer = await caller().admin.saveCourseGroup({
    name: "Computer Science",
    offerings: [
      { levelId: "standard", baseName: "Intro to Computer Science" },
      { levelId: "ap", baseName: "Computer Science A" },
    ],
  });
  const expected = [
    "Calculus",
    "Honors Calculus",
    "AP Calculus AB",
    "Intro to Computer Science",
    "AP Computer Science A",
  ];
  expect((await caller().application.options()).subjects.map((s) => s.name)).toEqual(
    expected,
  );
  expect(
    (await caller().tutee.signupOptions()).subjects.map((s) => s.name),
  ).toEqual(expected);
  expect((await caller().admin.subjects()).map((s) => s.name)).toEqual(
    expected,
  );
  await caller().admin.reorderCatalogue({
    kind: "groups",
    ids: [computer.id, group.id],
  });
  expect((await caller().application.options()).subjects.map((s) => s.name)).toEqual([
    ...expected.slice(3),
    ...expected.slice(0, 3),
  ]);
});

it("snapshots grants, isolates other groups, retains old eligibility after reorder and uses the new order only for future approvals", async () => {
  const { standard, honors, ap } = await calculus();
  await caller().admin.saveCourseGroup({
    name: "Government",
    offerings: [{ levelId: "standard", baseName: "Government" }],
  });
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: true,
  });
  const before = (await eligibleSubjectIds(db, "tutor")).sort();
  expect(before).toEqual([standard.id, honors.id, ap.id].sort());
  await caller().admin.reorderCatalogue({
    kind: "levels",
    ids: ["ap", "standard", "honors"],
  });
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: true,
  });
  expect((await eligibleSubjectIds(db, "tutor")).sort()).toEqual(before);
  await caller().interviewManagement.qualify({
    tutorId: "future",
    subjectId: ap.id,
    qualified: true,
  });
  expect(await eligibleSubjectIds(db, "future")).toEqual([ap.id]);
  await expect(
    db.$transaction((tx) => assertQualified(tx, "tutor", standard.id)),
  ).resolves.toBeUndefined();
  await expect(
    db.$transaction((tx) => assertQualified(tx, "future", standard.id)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("application selections and pending or rejected approvals never confer eligibility", async () => {
  const { ap } = await calculus();
  await db.tutorApplication.create({
    data: {
      name: "Synthetic Applicant",
      email: "applicant@example.test",
      subjectIntents: { create: { subjectId: ap.id } },
    },
  });
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([]);
  await db.tutorQualification.create({
    data: {
      tutorId: "tutor",
      subjectId: ap.id,
      approvedById: "catalogue-HEAD",
      status: "PENDING",
      grants: { create: { subjectId: ap.id } },
    },
  });
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([]);
  await db.tutorQualification.updateMany({ data: { status: "REJECTED" } });
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([]);
  await db.$transaction((tx) =>
    approveQualification(tx, "tutor", ap.id, "catalogue-HEAD"),
  );
  expect(await eligibleSubjectIds(db, "tutor")).toHaveLength(3);
});

it("retains independent overlapping approvals and does not retrospectively grant newly offered levels", async () => {
  const group = await caller().admin.saveCourseGroup({
    name: "History",
    offerings: [
      { levelId: "standard", baseName: "US History" },
      { levelId: "ap", baseName: "US History" },
    ],
  });
  const variants = await db.subject.findMany({ where: { groupId: group.id } });
  const ap = variants.find((v) => v.levelId === "ap")!;
  const standard = variants.find((v) => v.levelId === "standard")!;
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: true,
  });
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: standard.id,
    qualified: true,
  });
  await caller().admin.saveCourseGroup({
    id: group.id,
    name: "History",
    offerings: [
      ...variants.map((s) => ({ levelId: s.levelId, baseName: s.baseName })),
      { levelId: "honors", baseName: "US History" },
    ],
  });
  expect((await eligibleSubjectIds(db, "tutor")).sort()).toEqual(
    [standard.id, ap.id].sort(),
  );
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: false,
  });
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([standard.id]);
});

it("archives offerings and renames dependent pairing labels without losing choices, intents or grants", async () => {
  const { group, standard, ap } = await calculus();
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: true,
  });
  const term = await db.term.create({
    data: {
      name: "Synthetic",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const tutee = await db.tutee.create({
    data: { englishName: "Synthetic Tutee", firstChoiceId: standard.id },
  });
  const app = await db.tutorApplication.create({
    data: {
      name: "Applicant",
      email: "applicant@example.test",
      subjectIntents: { create: { subjectId: ap.id } },
    },
  });
  const pairing = await db.pairing.create({
    data: {
      termId: term.id,
      tutorId: "tutor",
      subject: ap.name,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 930,
    },
  });
  await caller().admin.saveCourseGroup({
    id: group.id,
    name: "Calculus",
    offerings: [{ levelId: "ap", baseName: "Calculus BC" }],
  });
  expect(
    await db.subject.findUnique({ where: { id: standard.id } }),
  ).toMatchObject({ active: false });
  expect(await db.tutee.findUnique({ where: { id: tutee.id } })).toMatchObject({
    firstChoiceId: standard.id,
  });
  expect(
    await db.applicationSubjectIntent.count({
      where: { applicationId: app.id, subjectId: ap.id },
    }),
  ).toBe(1);
  expect(
    await db.pairing.findUnique({ where: { id: pairing.id } }),
  ).toMatchObject({ subject: "AP Calculus BC" });
  expect(await eligibleSubjectIds(db, "tutor")).toHaveLength(3);
  await caller().admin.updateSubjectLevel({ id: "ap", prefix: "Advanced" });
  expect(
    await db.pairing.findUnique({ where: { id: pairing.id } }),
  ).toMatchObject({ subject: "Advanced Calculus BC" });
  await expect(
    caller().admin.deleteSubjectLevel({ id: "ap" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it.each(["VIEWER", "TUTOR"] as const)(
  "%s cannot bypass catalogue or qualification permissions",
  async (role) => {
    await expect(
      caller(role).admin.saveCourseGroup({
        name: "Forbidden",
        offerings: [{ levelId: "standard", baseName: "Forbidden" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(role).admin.reorderCatalogue({
        kind: "levels",
        ids: ["ap", "honors", "standard"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(role).interviewManagement.qualify({
        tutorId: "tutor",
        subjectId: "missing",
        qualified: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it("queues coordinator changes and captures catalogue dependencies before approval", async () => {
  const { ap } = await calculus();
  try {
    await caller("COORDINATOR").interviewManagement.qualify({
      tutorId: "tutor",
      subjectId: ap.id,
      qualified: true,
    });
    throw Error("Expected approval queue");
  } catch (error) {
    expect((error as { cause: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  }
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([]);
  expect(
    await db.approvalRequest.count({
      where: { operation: "interviewManagement.qualify" },
    }),
  ).toBe(1);
});

it("rejects incomplete reorder and duplicate offered levels atomically", async () => {
  await expect(
    caller().admin.reorderCatalogue({
      kind: "levels",
      ids: ["ap", "ap", "standard"],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().admin.saveCourseGroup({
      name: "Invalid",
      offerings: [
        { levelId: "ap", baseName: "One" },
        { levelId: "ap", baseName: "Two" },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.courseGroup.count()).toBe(0);
});

it("enforces persisted eligibility on real assignment routes and preserves historical schedule edits", async () => {
  const { standard, ap } = await calculus();
  await db.term.create({
    data: {
      name: "Synthetic",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const slot = await db.timeSlot.create({
    data: { label: "After school", dayOfWeek: 1, startMin: 900, endMin: 930 },
  });
  const input = {
    tutorId: "tutor",
    subject: standard.name,
    timeSlotId: slot.id,
    tuteeIds: [],
  };
  await expect(caller().admin.createPairing(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: true,
  });
  const pairing = await caller().admin.createPairing(input);
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: ap.id,
    qualified: false,
  });
  // Retained historical assignments can still be scheduled; new assignment boundaries revalidate.
  await expect(
    caller().admin.updatePairing({ ...input, id: pairing.id }),
  ).resolves.toMatchObject({ id: pairing.id });
  await expect(
    caller().admin.updatePairing({
      ...input,
      id: pairing.id,
      tutorId: "future",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.pairing.count()).toBe(1);
});

it("explicitly regroups existing variants without changing IDs or prior grants", async () => {
  const first = await caller().admin.createSubject({
    name: "US History",
    levelId: "standard",
  });
  const second = await caller().admin.createSubject({
    name: "US History",
    levelId: "ap",
  });
  await caller().interviewManagement.qualify({
    tutorId: "tutor",
    subjectId: second.id,
    qualified: true,
  });
  await caller().admin.saveCourseGroup({
    id: first.groupId!,
    name: "US History",
    offerings: [
      { subjectId: first.id, levelId: "standard", baseName: "US History" },
      { subjectId: second.id, levelId: "ap", baseName: "US History" },
    ],
  });
  expect(await eligibleSubjectIds(db, "tutor")).toEqual([second.id]);
  await caller().interviewManagement.qualify({
    tutorId: "future",
    subjectId: second.id,
    qualified: true,
  });
  expect((await eligibleSubjectIds(db, "future")).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  expect(await db.subject.count()).toBe(2);
});
