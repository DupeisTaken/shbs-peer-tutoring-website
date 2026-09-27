import { beforeEach, afterAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("~/server/email/sender", () => ({
  emailSender: mail,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "./db";
import { createCaller } from "./api/root";
import {
  applyAcademicIntake,
  accountAcademics,
  requireAcademicConfirmation,
  initializeAccountAcademics,
  confirmAccountAcademics,
} from "./academics";
import { currentPolicy } from "./policy-acceptance";
import {
  issueRegistrationCode,
  completeRegistration,
  setEmailVerification,
  confirmEmailCode,
} from "./auth/registration";
import { submitSurvey, confirmSurvey, surveyInput } from "./student-survey";
const caller = (id: string, role: Session["role"] = "STUDENT") =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const reported = (
  expectedProfileVersion = 0,
  gradeLevel = 10,
  schoolYear = "26-27",
) => ({
  status: "REPORTED" as const,
  gradeLevel,
  schoolYear,
  expectedProfileVersion,
  reason: "Self-reported confirmation",
});
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw Error("Academic tests require isolated local shbs_shipping_test");
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
    data: [
      {
        id: "academic-head",
        email: "head@example.test",
        role: "HEAD",
        username: "academichead",
      },
      {
        id: "academic-admin",
        email: "admin@example.test",
        role: "ADMIN",
        username: "academicadmin",
      },
      {
        id: "academic-viewer",
        email: "viewer@example.test",
        role: "VIEWER",
        username: "academicviewer",
      },
      {
        id: "academic-person",
        email: "person@example.test",
        role: "STUDENT",
        username: "stablecustom",
      },
    ],
  });
  await db.term.create({
    data: {
      id: "academic-term",
      name: "Current",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  mail.send.mockReset().mockResolvedValue(undefined);
});
afterAll(() => db.$disconnect());
it.each(["student", "tutor", "crew", "mixed"])(
  "shares self-reported academics for %s with staff lists",
  async (kind) => {
    if (kind === "tutor" || kind === "mixed") {
      await db.tutor.create({
        data: {
          id: "academic-tutor",
          englishName: "Same Person",
          username: "stablecustom",
        },
      });
      await db.user.update({
        where: { id: "academic-person" },
        data: { tutorId: "academic-tutor" },
      });
    }
    if (kind === "crew" || kind === "mixed")
      await db.user.update({
        where: { id: "academic-person" },
        data: { crewStatus: "ACTIVE" },
      });
    await caller("academic-person").account.updateAcademics(reported());
    const me = await caller("academic-person").account.me();
    expect(me.academic).toMatchObject({
      gradeLevel: 10,
      schoolYear: "26-27",
      expectedGraduationYear: 2029,
      needsConfirmation: false,
    });
    expect(me.username).toBe("stablecustom");
    const rows = await caller("academic-admin", "ADMIN").admin.accounts();
    expect(rows.rows.find((row) => row.userId === me.id)?.academic).toEqual(
      me.academic,
    );
    if (kind === "tutor" || kind === "mixed")
      expect(
        (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
          .gradeSchoolYear,
      ).toBe("26-27");
  },
);
it("protects ownership, staff authority, stale versions and concurrent edits", async () => {
  await expect(
    caller("academic-viewer", "VIEWER").admin.updateAccountAcademics({
      ...reported(),
      userId: "academic-person",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const outcomes = await Promise.allSettled([
    caller("academic-person").account.updateAcademics(reported()),
    caller("academic-admin", "ADMIN").admin.updateAccountAcademics({
      ...reported(0, 11),
      userId: "academic-person",
    }),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.academicConfirmation.count()).toBe(1);
  await expect(
    caller("academic-person").account.updateAcademics(reported()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.academicProfile.findUnique({
      where: { userId: "academic-admin" },
    }),
  ).toBeNull();
});
it("preserves historical enrollments, signatures, same-name records and handles on correction", async () => {
  await db.tutee.createMany({
    data: [
      {
        id: "academic-current",
        englishName: "Same Person",
        gradeLevel: "G9",
        signatureName: "Signed Name",
      },
      {
        id: "academic-other",
        englishName: "Same Person",
        gradeLevel: "Year 10",
      },
    ],
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { studentId: "academic-current" },
  });
  await caller("academic-admin", "ADMIN").admin.updateAccountAcademics({
    ...reported(),
    userId: "academic-person",
  });
  expect(
    await db.tutee.findUnique({ where: { id: "academic-current" } }),
  ).toMatchObject({ gradeLevel: "G9", signatureName: "Signed Name" });
  const roster = await caller("academic-admin", "ADMIN").admin.tutees();
  expect(
    roster.find((row) => row.id === "academic-current")?.academic.gradeLevel,
  ).toBe(10);
  expect(
    await db.tutee.findUnique({ where: { id: "academic-other" } }),
  ).toMatchObject({ gradeLevel: "Year 10" });
});
it("records repetitions/gaps explicitly while an ordinary participation break preserves graduation", async () => {
  await caller("academic-person").account.updateAcademics(reported());
  await db.term.update({
    where: { id: "academic-term" },
    data: { schoolYear: "27-28" },
  });
  expect(
    (await accountAcademics(db, "academic-person")).academic,
  ).toMatchObject({ expectedGraduationYear: 2029, needsConfirmation: true });
  await expect(
    requireAcademicConfirmation(db, "academic-person"),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await caller("academic-person").account.updateAcademics(
    reported(1, 11, "27-28"),
  );
  expect(
    (await accountAcademics(db, "academic-person")).academic
      .expectedGraduationYear,
  ).toBe(2029);
  await caller("academic-person").account.updateAcademics({
    ...reported(2, 10, "27-28"),
    reason: "Repeated G10 after an academic gap",
  });
  expect(
    (await accountAcademics(db, "academic-person")).academic
      .expectedGraduationYear,
  ).toBe(2030);
  expect(
    await caller("academic-person").account.academicHistory(),
  ).toHaveLength(3);
});
it("keeps unknown/not-applicable and missing current terms explicit without optional-field barriers", async () => {
  await caller("academic-person").account.updateAcademics({
    status: "UNKNOWN",
    gradeLevel: null,
    rawGrade: "IB1",
    schoolYear: null,
    expectedProfileVersion: 0,
  });
  await expect(
    requireAcademicConfirmation(db, "academic-person"),
  ).resolves.toBeUndefined();
  await db.term.updateMany({ data: { active: false } });
  expect(
    (await accountAcademics(db, "academic-person")).academic,
  ).toMatchObject({
    rawGrade: "IB1",
    expectedGraduationYear: null,
    needsConfirmation: true,
  });
  await caller("academic-person").account.updateAcademics({
    status: "NOT_APPLICABLE",
    gradeLevel: null,
    schoolYear: null,
    expectedProfileVersion: 1,
  });
  await applyAcademicIntake(
    db,
    "academic-person",
    undefined,
    "27-28",
    new Date(),
    "VERIFIED_SURVEY",
  );
  expect((await accountAcademics(db, "academic-person")).academic.status).toBe(
    "NOT_APPLICABLE",
  );
});
it("ignores stale intake but safely confirms a current-version return", async () => {
  await caller("academic-person").account.updateAcademics(reported());
  await applyAcademicIntake(
    db,
    "academic-person",
    "G8",
    "26-27",
    new Date(0),
    "VERIFIED_SURVEY",
    0,
  );
  expect(
    (await accountAcademics(db, "academic-person")).academic.gradeLevel,
  ).toBe(10);
  await applyAcademicIntake(
    db,
    "academic-person",
    "G10",
    "27-28",
    new Date(Date.now() + 1000),
    "VERIFIED_SURVEY",
    1,
  );
  expect(
    (await accountAcademics(db, "academic-person")).academic
      .expectedGraduationYear,
  ).toBe(2030);
});
it.each(["ACTIVE", "PENDING", "OPTED_OUT", "ARCHIVED", "GRADUATED"] as const)(
  "rollover never advances %s tutor grades or shifts history",
  async (status) => {
    await db.tutor.create({
      data: { id: "academic-tutor", englishName: "Member", status },
    });
    await db.user.update({
      where: { id: "academic-person" },
      data: { tutorId: "academic-tutor" },
    });
    await caller("academic-person").account.updateAcademics(reported());
    await db.term.update({
      where: { id: "academic-term" },
      data: { quarter: "Q4" },
    });
    await caller("academic-head", "HEAD").admin.refresh({
      confirm: "REFRESH",
      expectedTermId: "academic-term",
    });
    expect(
      (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
        .gradeLevel,
    ).toBe(10);
    expect(
      (await accountAcademics(db, "academic-person")).academic,
    ).toMatchObject({ expectedGraduationYear: 2029, needsConfirmation: true });
  },
);
it("graduates confirmed current-year G12, preserving stale G12 until correction", async () => {
  await db.tutor.createMany({
    data: [
      { id: "academic-tutor", englishName: "Current", status: "ACTIVE" },
      {
        id: "academic-stale",
        englishName: "Stale",
        status: "ACTIVE",
        gradeLevel: 12,
      },
    ],
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { tutorId: "academic-tutor" },
  });
  await caller("academic-person").account.updateAcademics(reported(0, 12));
  await db.term.update({
    where: { id: "academic-term" },
    data: { quarter: "Q3" },
  });
  await caller("academic-head", "HEAD").admin.refresh({
    confirm: "REFRESH",
    expectedTermId: "academic-term",
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
      .status,
  ).toBe("GRADUATED");
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-stale" } }))
      .status,
  ).toBe("ACTIVE");
});
it("verified survey captures reference year and leaves original answers immutable", async () => {
  await db.subject.create({ data: { id: "academic-subject", name: "Math" } });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Agree to attend",
    },
  });
  await db.timeSlot.create({
    data: {
      id: "academic-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  const policy = await currentPolicy(db, "tutee-policy");
  const input = surveyInput.parse({
    email: "new@example.test",
    englishName: "New Student",
    gradeLevel: "Grade 10",
    firstChoiceId: "academic-subject",
    slotIds: ["academic-slot"],
    preferredContact: "email",
    signatureName: "New Student",
    agreed: true,
    policyRevision: policy.revision,
  });
  await submitSurvey(db, input);
  const token = /token=([a-f0-9]{64})/.exec(
    (mail.send.mock.calls.at(-1)![0] as { text: string }).text,
  )![1]!;
  await confirmSurvey(db, token, "NewStudentPassword42");
  const user = await db.user.findUniqueOrThrow({
    where: { email: input.email },
  });
  expect((await accountAcademics(db, user.id)).academic).toMatchObject({
    gradeLevel: 10,
    schoolYear: "26-27",
    expectedGraduationYear: 2029,
  });
  expect((await db.studentSurvey.findFirstOrThrow()).payload).toMatchObject({
    gradeLevel: "Grade 10",
    signatureName: "New Student",
  });
});

it("migration preserves legacy conflicts and nonstandard grades without inventing years", async () => {
  // Use a rollback-only schema in the already allowlisted local test DB. Production tables are never touched.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA academic_migration_fixture");
    await client.query("SET LOCAL search_path TO academic_migration_fixture");
    await client.query(`CREATE TABLE "Tutor" (id text PRIMARY KEY, "gradeLevel" integer);
      CREATE TABLE "Tutee" (id text PRIMARY KEY, "gradeLevel" text);
      CREATE TABLE "User" (id text PRIMARY KEY, "gradeLevel" integer, "tutorId" text, "studentId" text);
      INSERT INTO "Tutor" VALUES ('t1',10),('t2',9);
      INSERT INTO "Tutee" VALUES ('s1','G10'),('s2','IB1'),('s3','Grade 1');
      INSERT INTO "User" VALUES ('mixed',11,'t1','s1'),('crew',8,NULL,NULL),('nonstandard',NULL,NULL,'s2'),('child',NULL,NULL,'s3'),('tutor',NULL,'t2',NULL),('parent',NULL,NULL,NULL);`);
    await client.query(
      await readFile(
        "prisma/migrations/20260924160108_canonical_academic_profiles/migration.sql",
        "utf8",
      ),
    );
    const { rows } = await client.query<{
      userId: string;
      status: string;
      gradeLevel: number | null;
      rawGrade: string | null;
      schoolYear: string | null;
      confirmedAt: Date | null;
    }>('SELECT * FROM "AcademicProfile"');
    expect(rows).toHaveLength(6);
    for (const row of rows)
      expect(row).toMatchObject({
        status: "UNKNOWN",
        schoolYear: null,
        confirmedAt: null,
      });
    expect(rows.find((row) => row.userId === "mixed")).toMatchObject({
      gradeLevel: null,
      rawGrade: "Account: 11; Tutor: 10; Enrollment: G10",
    });
    expect(rows.find((row) => row.userId === "crew")).toMatchObject({
      gradeLevel: 8,
      rawGrade: "8",
    });
    expect(rows.find((row) => row.userId === "nonstandard")).toMatchObject({
      gradeLevel: null,
      rawGrade: "IB1",
    });
    expect(rows.find((row) => row.userId === "child")).toMatchObject({
      gradeLevel: 1,
      rawGrade: "Grade 1",
    });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

it.each([false, true])(
  "verified existing-account intake respects concurrent profile changes: %s",
  async (editAfterSubmission) => {
    await db.subject.create({ data: { id: "academic-subject", name: "Math" } });
    await db.timeSlot.create({
      data: {
        id: "academic-slot",
        label: "After school",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    });
    await db.policyDocument.create({
      data: {
        slug: "tutee-policy",
        locale: "en",
        title: "Policy",
        body: "Attend",
      },
    });
    await caller("academic-person").account.updateAcademics(reported());
    await db.term.update({
      where: { id: "academic-term" },
      data: { schoolYear: "27-28" },
    });
    const policy = await currentPolicy(db, "tutee-policy");
    await submitSurvey(
      db,
      surveyInput.parse({
        email: "person@example.test",
        englishName: "Returning Person",
        gradeLevel: "G10",
        firstChoiceId: "academic-subject",
        slotIds: ["academic-slot"],
        preferredContact: "email",
        signatureName: "Signed Person",
        agreed: true,
        policyRevision: policy.revision,
      }),
    );
    const token = /token=([a-f0-9]{64})/.exec(
      (mail.send.mock.calls.at(-1)![0] as { text: string }).text,
    )![1]!;
    if (editAfterSubmission)
      await caller("academic-person").account.updateAcademics(
        reported(1, 12, "27-28"),
      );
    await confirmSurvey(db, token, "ExistingSetupPassword42");
    const academic = (await accountAcademics(db, "academic-person")).academic;
    expect(academic).toMatchObject({
      schoolYear: "27-28",
      gradeLevel: editAfterSubmission ? 12 : 10,
      expectedGraduationYear: editAfterSubmission ? 2028 : 2030,
    });
    expect((await db.studentSurvey.findFirstOrThrow()).payload).toMatchObject({
      gradeLevel: "G10",
      signatureName: "Signed Person",
    });
  },
);

it.each([true, false])(
  "re-registration retains canonical academic identity with established handle: %s",
  async (hasHandle) => {
    await db.tutor.create({
      data: {
        id: "academic-tutor",
        englishName: "Person",
        username: hasHandle ? "stablecustom" : null,
        gradeLevel: 10,
      },
    });
    await db.user.update({
      where: { id: "academic-person" },
      data: {
        tutorId: "academic-tutor",
        role: "TUTOR",
        username: hasHandle ? "stablecustom" : null,
      },
    });
    await caller("academic-person", "TUTOR").account.updateAcademics(
      reported(),
    );
    const issued = await issueRegistrationCode({
      email: "person@example.test",
      tutorId: "academic-tutor",
      kind: "TUTOR",
      issuedById: "academic-head",
    });
    let row = await db.registrationCode.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const staged = await setEmailVerification(row, "person@example.test");
    if (!staged.ok) throw Error("Expected challenge");
    row = await db.registrationCode.findUniqueOrThrow({
      where: { id: row.id },
    });
    const confirmed = await confirmEmailCode(row, staged.emailCode);
    if (!confirmed.ok) throw Error("Expected verification");
    row = await db.registrationCode.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(
      await completeRegistration(row, {
        firstName: "Changed",
        lastName: "Person",
        gradeLevel: 12,
        gradeSchoolYear: "26-27",
        password: "RegistrationPassword42",
        completionProof: confirmed.completionProof,
      }),
    ).toMatchObject({ ok: true, academicConfirmationRequired: true });
    expect(
      (await accountAcademics(db, "academic-person")).academic,
    ).toMatchObject({
      gradeLevel: 10,
      expectedGraduationYear: 2029,
      needsConfirmation: true,
    });
    expect(
      await db.tutor.findUnique({ where: { id: "academic-tutor" } }),
    ).toMatchObject({
      gradeLevel: 10,
      gradeSchoolYear: "26-27",
      status: "PENDING",
      username: hasHandle ? "stablecustom" : "cperson29",
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: "academic-person" } }))
        .username,
    ).toBe(hasHandle ? "stablecustom" : "cperson29");
    await expect(
      caller("academic-person", "TUTOR").tutor.activateAccount({
        available: true,
      }),
    ).rejects.toMatchObject({ message: "ACADEMIC_CONFIRMATION_REQUIRED" });
    const current = await accountAcademics(db, "academic-person");
    await caller("academic-person", "TUTOR").account.updateAcademics(
      reported(current.profileVersion),
    );
    await caller("academic-person", "TUTOR").tutor.activateAccount({
      available: true,
    });
    expect(
      (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
        .status,
    ).toBe("ACTIVE");
  },
);
it("new explicit roster links preserve legacy evidence without inferring a confirmation year", async () => {
  await db.tutor.create({
    data: { id: "academic-tutor", englishName: "Person", gradeLevel: 9 },
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { tutorId: "academic-tutor" },
  });
  await initializeAccountAcademics(db, "academic-person");
  expect(
    (await accountAcademics(db, "academic-person")).academic,
  ).toMatchObject({
    gradeLevel: 9,
    rawGrade: "9",
    schoolYear: null,
    expectedGraduationYear: null,
    needsConfirmation: true,
  });
  await caller("academic-person").account.updateAcademics(reported(1));
  await initializeAccountAcademics(db, "academic-person");
  expect(
    (await accountAcademics(db, "academic-person")).academic.gradeLevel,
  ).toBe(10);
});

it("linking roster evidence fills only an empty legacy profile and records conflicts", async () => {
  await db.academicProfile.create({ data: { userId: "academic-person" } });
  await db.tutor.create({
    data: { id: "academic-tutor", englishName: "Person", gradeLevel: 10 },
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { tutorId: "academic-tutor" },
  });
  await initializeAccountAcademics(db, "academic-person");
  expect(
    (await accountAcademics(db, "academic-person")).academic,
  ).toMatchObject({ gradeLevel: 10, rawGrade: "10", schoolYear: null });
  await caller("academic-person").account.updateAcademics(reported(1));
  await db.tutor.update({
    where: { id: "academic-tutor" },
    data: { gradeLevel: 9 },
  });
  await initializeAccountAcademics(db, "academic-person");
  expect(
    (await accountAcademics(db, "academic-person")).academic,
  ).toMatchObject({ gradeLevel: 10, needsConfirmation: true });
  expect(
    await db.auditLog.findFirst({
      where: { operation: "academic.linkConflict" },
    }),
  ).toMatchObject({ details: { gradeLevel: 9 } });
});
it.each([false, true])(
  "coordinator academic corrections queue and reject stale approval: %s",
  async (stale) => {
    await db.user.create({
      data: {
        id: "academic-coordinator",
        email: "coordinator@example.test",
        role: "COORDINATOR",
      },
    });
    await expect(
      caller(
        "academic-coordinator",
        "COORDINATOR",
      ).admin.updateAccountAcademics({
        ...reported(),
        userId: "academic-person",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await db.academicProfile.findUnique({
        where: { userId: "academic-person" },
      }),
    ).toBeNull();
    const proposal = await db.approvalRequest.findFirstOrThrow({
      where: { operation: "admin.updateAccountAcademics" },
    });
    if (stale)
      await caller("academic-person").account.updateAcademics(reported(0, 11));
    const decision = caller("academic-admin", "ADMIN").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Reviewed academic correction",
    });
    if (stale)
      await expect(decision).rejects.toMatchObject({ code: "CONFLICT" });
    else await decision;
    expect(
      (await accountAcademics(db, "academic-person")).academic.gradeLevel,
    ).toBe(stale ? 11 : 10);
  },
);

it("a roster edit started before academic confirmation cannot overwrite its mirror", async () => {
  await db.tutor.create({
    data: {
      id: "academic-tutor",
      englishName: "Original Person",
      firstName: "Original",
      lastName: "Person",
      status: "ACTIVE",
      gradeLevel: 10,
    },
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { tutorId: "academic-tutor" },
  });
  await caller("academic-person").account.updateAcademics(reported());
  // Interleave the real queries after the resolver's compatibility read, before its transaction.
  const originalRead = db.tutor.findUniqueOrThrow.bind(db.tutor);
  const interleavedRead = async (
    args: Parameters<typeof db.tutor.findUniqueOrThrow>[0],
  ) => {
    const original = await originalRead(args);
    await confirmAccountAcademics(db, "academic-person", reported(1, 11), {
      actorId: "academic-person",
      source: "SELF_SERVICE",
    });
    return original;
  };
  // This awaited test seam does not use Prisma's fluent relation accessors.
  const read = vi
    .spyOn(db.tutor, "findUniqueOrThrow")
    .mockImplementationOnce(
      interleavedRead as unknown as typeof db.tutor.findUniqueOrThrow,
    );
  try {
    await caller("academic-admin", "ADMIN").admin.updateTutor({
      id: "academic-tutor",
      firstName: "Changed",
      lastName: "Person",
      gradeLevel: 10,
      status: "ACTIVE",
    });
  } finally {
    read.mockRestore();
  }
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
      .gradeLevel,
  ).toBe(11);
  expect(
    (await accountAcademics(db, "academic-person")).academic.gradeLevel,
  ).toBe(11);
});
it("provisional roster grades never mint an unconfirmed graduation suffix", async () => {
  const tutor = await caller("academic-head", "HEAD").admin.createTutor({
    firstName: "Provisional",
    lastName: "Person",
    gradeLevel: 10,
  });
  expect(tutor.username).toBe("pperson");
  expect(tutor.gradeSchoolYear).toBeNull();
});

it("activation checks the current reference year atomically and still permits opting out", async () => {
  await db.tutor.create({
    data: { id: "academic-tutor", englishName: "Returning", status: "PENDING" },
  });
  await db.user.update({
    where: { id: "academic-person" },
    data: { tutorId: "academic-tutor" },
  });
  await caller("academic-person").account.updateAcademics(reported());
  await db.term.update({
    where: { id: "academic-term" },
    data: { schoolYear: "27-28" },
  });
  await expect(
    caller("academic-person").tutor.activateAccount({ available: true }),
  ).rejects.toMatchObject({ message: "ACADEMIC_CONFIRMATION_REQUIRED" });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
      .status,
  ).toBe("PENDING");
  await caller("academic-person").account.updateAcademics(
    reported(1, 11, "27-28"),
  );
  await caller("academic-person").tutor.activateAccount({ available: true });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
      .status,
  ).toBe("ACTIVE");
  await db.tutor.update({
    where: { id: "academic-tutor" },
    data: { status: "PENDING" },
  });
  await db.term.update({
    where: { id: "academic-term" },
    data: { schoolYear: "28-29" },
  });
  await caller("academic-person").tutor.activateAccount({ available: false });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "academic-tutor" } }))
      .status,
  ).toBe("OPTED_OUT");
});

it("verified Unicode student chooses Latin spelling with confirmed year and retains the handle through correction and return", async () => {
  await db.subject.create({ data: { id: "academic-subject", name: "Math" } });
  await db.timeSlot.create({
    data: {
      id: "academic-slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Attend",
    },
  });
  const policy = await currentPolicy(db, "tutee-policy");
  const input = surveyInput.parse({
    email: "unicode@example.test",
    englishName: "王小明",
    preferredLatinName: "Xiaoming Wang",
    gradeLevel: "G10",
    firstChoiceId: "academic-subject",
    slotIds: ["academic-slot"],
    preferredContact: "email",
    signatureName: "王小明",
    agreed: true,
    policyRevision: policy.revision,
  });
  await submitSurvey(db, input);
  const firstToken = /token=([a-f0-9]{64})/.exec(
    (mail.send.mock.calls.at(-1)![0] as { text: string }).text,
  )![1]!;
  await confirmSurvey(db, firstToken, "UnicodeStudentPassword42");
  const user = await db.user.findUniqueOrThrow({
    where: { email: input.email },
  });
  expect(user.username).toBe("xwang29");
  expect(
    (await accountAcademics(db, user.id)).academic.expectedGraduationYear,
  ).toBe(2029);
  await caller(user.id).account.updateAcademics(
    reported(user.profileVersion, 9),
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).username,
  ).toBe("xwang29");
  await db.term.update({
    where: { id: "academic-term" },
    data: { active: false },
  });
  await db.term.create({
    data: {
      id: "academic-next",
      name: "Next Year",
      schoolYear: "27-28",
      quarter: "Q1",
      active: true,
    },
  });
  await submitSurvey(db, input);
  const returnToken = /token=([a-f0-9]{64})/.exec(
    (mail.send.mock.calls.at(-1)![0] as { text: string }).text,
  )![1]!;
  await confirmSurvey(db, returnToken);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).username,
  ).toBe("xwang29");
  expect((await accountAcademics(db, user.id)).academic).toMatchObject({
    gradeLevel: 10,
    schoolYear: "27-28",
    expectedGraduationYear: 2030,
  });
  expect(await db.studentSurvey.count({ where: { email: input.email } })).toBe(
    2,
  );
});
it("explicit student backfill uses the canonical reference year", async () => {
  await db.user.update({
    where: { id: "academic-person" },
    data: { username: null, name: "Maria Gomez", emailVerifiedAt: new Date() },
  });
  await caller("academic-person").account.updateAcademics(reported());
  await db.term.update({
    where: { id: "academic-term" },
    data: { schoolYear: "29-30" },
  });
  await caller("academic-head", "HEAD").admin.backfillStudentUsernames({
    userIds: ["academic-person"],
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "academic-person" } }))
      .username,
  ).toBe("mgomez29");
});

/** Exercise the public completion API: the success response must distinguish login creation from activation. */
async function redeemAcademicInvitation(
  kind: "CREW" | "TUTOR",
  gradeLevel?: number,
  gradeSchoolYear?: string,
) {
  const issued = await issueRegistrationCode({
    email: "person@example.test",
    kind,
    issuedById: "academic-head",
  });
  let row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const staged = await setEmailVerification(row, "person@example.test");
  if (!staged.ok) throw Error("Expected challenge");
  row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const proof = await confirmEmailCode(row, staged.emailCode);
  if (!proof.ok) throw Error("Expected proof");
  const result = await caller("academic-person").registration.complete({
    code: issued.code,
    completionProof: proof.completionProof,
    firstName: "Returning",
    lastName: "Person",
    gradeLevel,
    gradeSchoolYear,
    password: "RegistrationPassword42",
  });
  expect(
    (await db.registrationCode.findUniqueOrThrow({ where: { id: issued.id } }))
      .usedAt,
  ).not.toBeNull();
  return result;
}

it.each(["OPTED_OUT", "INACTIVE", "ACTIVE"] as const)(
  "crew invitation preserves pending academic review from %s",
  async (crewStatus) => {
    await db.user.update({
      where: { id: "academic-person" },
      data: { role: "CREW", crewStatus },
    });
    await caller("academic-person", "CREW").account.updateAcademics(reported());
    await db.term.update({
      where: { id: "academic-term" },
      data: { schoolYear: "27-28" },
    });
    const result = await redeemAcademicInvitation("CREW");
    expect(result).toMatchObject({
      ok: true,
      username: "stablecustom",
      academicConfirmationRequired: true,
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: "academic-person" } }))
        .crewStatus,
    ).toBe(crewStatus === "INACTIVE" ? "INACTIVE" : "OPTED_OUT");
    await expect(
      requireAcademicConfirmation(db, "academic-person"),
    ).rejects.toMatchObject({ message: "ACADEMIC_CONFIRMATION_REQUIRED" });
    const current = await accountAcademics(db, "academic-person");
    await caller("academic-person", "CREW").account.updateAcademics(
      reported(current.profileVersion, 11, "27-28"),
    );
    await expect(
      requireAcademicConfirmation(db, "academic-person"),
    ).resolves.toBeUndefined();
  },
);

it.each(["CREW", "TUTOR"] as const)(
  "%s invitations expose a conflict with Not Applicable",
  async (kind) => {
    await caller("academic-person").account.updateAcademics({
      expectedProfileVersion: 0,
      status: "NOT_APPLICABLE",
      gradeLevel: null,
      schoolYear: null,
    });
    expect(
      (await accountAcademics(db, "academic-person")).academic
        .needsConfirmation,
    ).toBe(false);
    const result = await redeemAcademicInvitation(kind, 10, "26-27");
    expect(result.academicConfirmationRequired).toBe(true);
    expect(
      (await accountAcademics(db, "academic-person")).academic,
    ).toMatchObject({
      status: "NOT_APPLICABLE",
      gradeLevel: null,
      expectedGraduationYear: null,
      needsConfirmation: true,
    });
    await expect(
      requireAcademicConfirmation(db, "academic-person"),
    ).rejects.toMatchObject({ message: "ACADEMIC_CONFIRMATION_REQUIRED" });
  },
);

it.each(["UNKNOWN", "NOT_APPLICABLE"] as const)(
  "optional %s academics do not block invitation activation",
  async (status) => {
    await caller("academic-person").account.updateAcademics({
      expectedProfileVersion: 0,
      status,
      gradeLevel: null,
      schoolYear: null,
      rawGrade: status === "UNKNOWN" ? "University" : null,
    });
    const result = await redeemAcademicInvitation("TUTOR");
    expect(result.academicConfirmationRequired).toBe(false);
    const user = await db.user.findUniqueOrThrow({
      where: { id: "academic-person" },
      include: { tutor: true },
    });
    expect(user.tutor?.status).toBe("ACTIVE");
  },
);
