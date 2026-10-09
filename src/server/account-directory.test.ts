import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";

const caller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: "directory-reviewer",
        name: "Synthetic reviewer",
        email: "reviewer@example.test",
      },
      role: "HEAD" as Session["role"],
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
    throw new Error(
      "Account directory tests require isolated local shbs_shipping_test",
    );
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
        id: "current",
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Current",
        active: true,
      },
      {
        id: "old",
        schoolYear: "23-24",
        quarter: "Q1",
        name: "Old",
        active: false,
      },
    ],
  });
  await db.tutor.createMany({
    data: [
      {
        id: "direct",
        englishName: "Current Tutor",
        status: "PENDING",
        gradeLevel: 12,
      },
      {
        id: "archive-1",
        englishName: "Archive One",
        status: "ARCHIVED",
        gradeLevel: 9,
        gradeSchoolYear: "23-24",
      },
      {
        id: "archive-2",
        englishName: "Archive Two",
        status: "GRADUATED",
        gradeLevel: 10,
        gradeSchoolYear: "24-25",
      },
      { id: "unowned", englishName: "Unowned Tutor", status: "ACTIVE" },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "direct-student",
        englishName: "Current Student",
        status: "ACTIVE",
        intakeTermId: "current",
      },
      {
        id: "retained-student",
        englishName: "Past Student",
        status: "INACTIVE",
        intakeTermId: "old",
        gradeLevel: "9",
      },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: "directory-reviewer",
        email: "reviewer@example.test",
        role: "HEAD",
        username: "reviewer",
      },
      {
        id: "person",
        name: "Synthetic Person",
        email: "person@example.test",
        username: "person",
        role: "ADMIN",
        tutorId: "direct",
        studentId: "direct-student",
        tuteeMember: true,
        canTranslate: true,
        crewStatus: "INACTIVE",
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      },
    ],
  });
  await db.academicProfile.create({
    data: {
      userId: "person",
      status: "REPORTED",
      gradeLevel: 12,
      schoolYear: "26-27",
      confirmedAt: new Date(),
      reconfirmRequired: false,
    },
  });
  await db.tutorProfileOwnership.createMany({
    data: ["archive-1", "archive-2"].map((tutorId) => ({
      tutorId,
      userId: "person",
    })),
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: "retained-student", userId: "person" },
  });
});
afterAll(() => db.$disconnect());

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "%s can read separate attachments and several retained records without writes",
  async (role) => {
    await db.user.update({
      where: { id: "directory-reviewer" },
      data: { role },
    });
    const before = await db.user.findUnique({ where: { id: "person" } });
    const result = await caller().admin.accountDetails({ userId: "person" });
    expect(result.membership).toMatchObject({
      rank: "ADMIN",
      tutor: true,
      tutee: true,
      translator: true,
      crew: true,
    });
    expect(result.attached.map((row) => row.id).sort()).toEqual([
      "direct",
      "direct-student",
    ]);
    expect(result.retained.map((row) => row.id).sort()).toEqual([
      "archive-1",
      "archive-2",
      "retained-student",
    ]);
    expect(
      result.retained.every(
        (row) => row.academic.expectedGraduationYear === 2027,
      ),
    ).toBe(true);
    expect(
      result.retained.every((row) => row.academic.needsConfirmation === false),
    ).toBe(true);
    expect(await db.user.findUnique({ where: { id: "person" } })).toEqual(
      before,
    );
    expect(await db.historicalAcademicRecord.count()).toBe(0);
    expect(result).not.toHaveProperty("passwordHash");
  },
);

it.each(["VIEWER", "TUTOR", "STUDENT", "CREW"] as const)(
  "denies %s even with a stale Head session",
  async (role) => {
    await db.user.update({
      where: { id: "directory-reviewer" },
      data: { role },
    });
    await expect(
      caller().admin.accountDetails({ userId: "person" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().admin.accountDetails({ tutorId: "archive-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it("distinguishes roster-only records with retained owners and keeps revoked capability separate", async () => {
  const owned = await caller().admin.accountDetails({ tutorId: "archive-1" });
  expect(owned.membership).toBeNull();
  expect(owned.attached[0]).toMatchObject({
    direct: false,
    retainedOwner: { id: "person" },
    academic: { schoolYear: "23-24", gradeLevel: 9 },
  });
  expect(
    (await caller().admin.accountDetails({ tutorId: "unowned" })).attached[0]
      ?.retainedOwner,
  ).toBeNull();
  await db.user.update({
    where: { id: "person" },
    data: {
      tutorAccessRevoked: true,
      suspendedAt: new Date(),
      suspendedReason: "Synthetic restriction",
    },
  });
  const revoked = await caller().admin.accountDetails({ userId: "person" });
  expect(revoked.membership).toMatchObject({ tutor: false, tutee: true });
  expect(revoked.attached).toHaveLength(2);
  expect(revoked.suspendedReason).toBe("Synthetic restriction");
});

it("uses saved original academics after reactivation and in the existing tutor detail dialog", async () => {
  await db.historicalAcademicRecord.create({
    data: {
      id: "legacy-tutor:direct",
      tutorId: "direct",
      rawGrade: "7",
      schoolYear: "20-21",
      source: "LEGACY_TUTOR",
    },
  });
  const result = await caller().admin.accountDetails({ userId: "person" });
  expect(result.attached.find((row) => row.id === "direct")).toMatchObject({
    historical: true,
    academic: {
      gradeLevel: 7,
      schoolYear: "20-21",
      expectedGraduationYear: 2026,
      needsConfirmation: false,
    },
  });
  expect(await caller().tutorDetails.get({ tutorId: "direct" })).toMatchObject({
    historicalGrade: true,
    academic: {
      gradeLevel: 7,
      schoolYear: "20-21",
      expectedGraduationYear: 2026,
      needsConfirmation: false,
    },
  });
});

it("does not infer missing enrollment years from today's program year and rejects missing records", async () => {
  await db.tutor.update({
    where: { id: "archive-1" },
    data: { gradeSchoolYear: null },
  });
  expect(
    (await caller().admin.accountDetails({ tutorId: "archive-1" })).attached[0]
      ?.academic.expectedGraduationYear,
  ).toBeNull();
  await expect(
    caller().admin.accountDetails({ userId: "missing" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller().admin.accountDetails({ tutorId: "missing" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
