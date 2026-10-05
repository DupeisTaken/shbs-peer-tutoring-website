import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import { recordCsv } from "~/lib/record-transfer";
import {
  legacyAcademicRecordId,
  type HistoricalCorrectionInput,
} from "~/lib/historical-academics";
import { historicalAcademicSnapshot, preserveHistoricalAcademics } from "~/server/historical-academics";
import { ApprovalQueued } from "~/server/approvals";
import { synchronizeAcademicMirrors } from "~/server/academics";
import { lockAccountProfile, updateAccountProfile } from "~/server/account-profile";
import { lockUsernameNamespace } from "~/server/auth/username";
import { applyRecords } from "~/server/record-transfer";
import {
  issueRegistrationCode,
  setEmailVerification,
  confirmEmailCode,
  completeRegistration,
} from "~/server/auth/registration";

const roles = [
  "HEAD",
  "ADMIN",
  "COORDINATOR",
  "VIEWER",
  "STUDENT",
  "TUTOR",
  "CREW",
] as const;
const caller = (role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: role, name: role },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const key = (id: string) => legacyAcademicRecordId("TUTEE", id);
const file = (name: string, rows: Record<string, unknown>[]) => ({
  name: `${name}.csv`,
  text: recordCsv(Object.keys(rows[0]!), rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  ))),
});

async function reset() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error(
      "Historical correction tests require isolated loopback shbs_shipping_test",
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
}
beforeEach(async () => {
  await reset();
  await db.user.createMany({
    data: roles.map((role) => ({
      id: role,
      role,
      name: role,
      email: `${role}@example.test`,
      emailVerifiedAt: new Date(),
      passwordHash: "synthetic-only",
    })),
  });
  await db.term.createMany({
    data: [
      {
        id: "old",
        name: "Old period",
        schoolYear: "24-25",
        quarter: "Q1",
        active: false,
      },
      {
        id: "current",
        name: "Current period",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "a",
        englishName: "Identical Learner",
        status: "INACTIVE",
        gradeLevel: null,
        intakeTermId: "old",
      },
      {
        id: "b",
        englishName: "Identical Learner",
        status: "INACTIVE",
        gradeLevel: "初三",
        intakeTermId: null,
      },
    ],
  });
});
afterAll(async () => {
  await reset();
  await db.$disconnect();
});

async function input(
  ids = [key("a")],
  method: "WEBSITE" | "CSV" = "WEBSITE",
): Promise<HistoricalCorrectionInput> {
  const rows = [];
  for (const recordId of ids) {
    const record = await historicalAcademicSnapshot(db, recordId);
    rows.push({
      recordId,
      expectedFingerprint: record.fingerprint,
      rawGrade: "G8",
      schoolYear: "24-25",
      evidence: "Synthetic 2024 register",
      reason: "Verified transcription against original register",
    });
  }
  return { rows, method };
}
async function prepared(
  value: HistoricalCorrectionInput,
  role: Session["role"] = "HEAD",
) {
  const preview = await caller(role).historicalAcademics.preview(value);
  return { ...value, ticket: preview.ticket };
}
async function queue(value: Awaited<ReturnType<typeof prepared>>) {
  try {
    await caller("COORDINATOR").historicalAcademics.correctBatch(value);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw new Error("Expected a proposal, never a live coordinator save");
}

it("reads missing/raw grades without writes, accounts, current-year assumptions or name matching", async () => {
  const before = await db.user.count();
  const result = await caller().historicalAcademics.list({
    kind: "TUTEE",
    search: "Identical",
  });
  expect(result.records.map((row) => row.recordId)).toEqual([
    key("a"),
    key("b"),
  ]);
  expect(result.records.map((row) => row.current)).toEqual([
    { rawGrade: null, schoolYear: "24-25" },
    { rawGrade: "初三", schoolYear: null },
  ]);
  await caller().historicalAcademics.preview(await input());
  expect(await db.historicalAcademicRecord.count()).toBe(0);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect(await db.user.count()).toBe(before);
});

it.each(["WEBSITE", "CSV"] as const)(
  "applies a %s batch and preserves original evidence/reference years",
  async (method) => {
    const initial = await db.tutee.findMany({ orderBy: { id: "asc" } });
    const value = await input([key("a"), key("b")], method);
    value.rows[1] = { ...value.rows[1]!, rawGrade: null, schoolYear: "23-24" };
    expect(
      await caller("ADMIN").historicalAcademics.correctBatch(await prepared(value)),
    ).toEqual({ count: 2 });
    expect(await db.tutee.findMany({ orderBy: { id: "asc" } })).toEqual(
      initial,
    );
    expect(
      await db.historicalAcademicRecord.findUnique({ where: { id: key("b") } }),
    ).toMatchObject({
      rawGrade: "初三",
      schoolYear: null,
      originalConfirmedAt: null,
    });
    const corrections = await db.historicalAcademicCorrection.findMany({
      orderBy: { recordId: "asc" },
    });
    expect(corrections).toHaveLength(2);
    expect(corrections[1]).toMatchObject({
      rawGrade: null,
      schoolYear: "23-24",
      actorId: "ADMIN",
      revision: 1,
      method,
      before: { rawGrade: "初三", schoolYear: null },
    });
    expect(corrections[1]!.correctedAt.getTime()).toBeGreaterThan(
      Date.parse("2026-01-01"),
    );
    expect(await db.academicProfile.count()).toBe(0);
    expect(await db.academicConfirmation.count()).toBe(0);
    const roster = await caller().admin.tutees();
    expect(roster.find((row) => row.id === "b")).toMatchObject({
      historical: true,
      enrollmentCorrection: { rawGrade: null, schoolYear: "23-24" },
    });
  },
);

it("retains every correction revision and rejects replay or altered preview contents", async () => {
  const first = await prepared(await input());
  await expect(
    caller().historicalAcademics.correctBatch({
      ...first,
      rows: [{ ...first.rows[0]!, rawGrade: "12" }],
    }),
  ).rejects.toThrow("HISTORICAL_PREVIEW_REQUIRED");
  await caller().historicalAcademics.correctBatch(first);
  await expect(caller().historicalAcademics.correctBatch(first)).rejects.toThrow(
    "HISTORICAL_STALE",
  );
  const second = await input();
  second.rows[0]!.rawGrade = "Year 13";
  await caller().historicalAcademics.correctBatch(await prepared(second));
  expect(
    await db.historicalAcademicCorrection.findMany({
      orderBy: { revision: "asc" },
    }),
  ).toMatchObject([
    {
      revision: 1,
      rawGrade: "G8",
      before: { rawGrade: null, schoolYear: "24-25" },
    },
    {
      revision: 2,
      rawGrade: "Year 13",
      before: { rawGrade: "G8", schoolYear: "24-25" },
    },
  ]);
});

it("preserves recorded graduation as original evidence without changing participation", async () => {
  await db.tutee.update({
    where: { id: "a" },
    data: { academicallyGraduated: true },
  });
  await caller().historicalAcademics.correctBatch(await prepared(await input()));
  expect(
    await db.historicalAcademicRecord.findUnique({ where: { id: key("a") } }),
  ).toMatchObject({
    academicallyGraduated: true,
    rawGrade: null,
    schoolYear: "24-25",
  });
  expect(await db.tutee.findUnique({ where: { id: "a" } })).toMatchObject({
    academicallyGraduated: true,
    status: "INACTIVE",
  });
});

it("rejects the entire batch after a roster edit or deletion", async () => {
  const value = await prepared(await input([key("a"), key("b")]));
  await db.tutee.update({
    where: { id: "b" },
    data: { notes: "Concurrent staff edit" },
  });
  await expect(caller().historicalAcademics.correctBatch(value)).rejects.toThrow(
    "HISTORICAL_STALE",
  );
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
  await db.tutee.delete({ where: { id: "b" } });
  await expect(caller().historicalAcademics.correctBatch(value)).rejects.toThrow(
    "HISTORICAL_NOT_FOUND",
  );
  expect(await db.historicalAcademicRecord.count()).toBe(0);
});

it.each(["direct", "approval"])(
  "rolls back earlier rows and audit if a later %s database write fails",
  async (mode) => {
    const value = await prepared(await input([key("a"), key("b")]));
    const request = mode === "approval" ? await queue(value) : null;
    const auditCount = await db.auditLog.count();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_historical_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."recordId" = 'legacy-tutee:b' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_historical_fixture BEFORE INSERT ON "HistoricalAcademicCorrection" FOR EACH ROW EXECUTE FUNCTION fail_historical_fixture()`,
    );
    try {
      await expect(
        request
          ? caller("ADMIN").approval.decide({
              id: request.id,
              approve: true,
              note: "Synthetic late database failure",
            })
          : caller().historicalAcademics.correctBatch(value),
      ).rejects.toThrow();
      expect(await db.historicalAcademicRecord.count()).toBe(0);
      expect(await db.historicalAcademicCorrection.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(auditCount);
      if (request)
        expect(
          (
            await db.approvalRequest.findUniqueOrThrow({
              where: { id: request.id },
            })
          ).state,
        ).toBe("PENDING");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER fail_historical_fixture ON "HistoricalAcademicCorrection"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION fail_historical_fixture()`);
    }
  },
);

it("serializes overlapping batch retries to exactly one correction", async () => {
  const value = await prepared(await input());
  const results = await Promise.allSettled([
    caller().historicalAcademics.correctBatch(value),
    caller().historicalAcademics.correctBatch(value),
  ]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(await db.historicalAcademicCorrection.count()).toBe(1);
});

it("preserves newer account academics on explicit linking and detects ownership drift/conflicts", async () => {
  await db.academicProfile.create({
    data: {
      userId: "STUDENT",
      status: "REPORTED",
      gradeLevel: 11,
      schoolYear: "26-27",
      confirmedAt: new Date(),
      reconfirmRequired: false,
    },
  });
  const academic = await db.academicProfile.findUniqueOrThrow({
    where: { userId: "STUDENT" },
  });
  const stale = await prepared(await input());
  const link = await caller("ADMIN").tuteeHistory.preview({
    tuteeId: "a",
    userId: "STUDENT",
  });
  await caller("ADMIN").tuteeHistory.link({
    tuteeId: "a",
    userId: "STUDENT",
    fingerprint: link.fingerprint,
    reason: "Synthetic register confirms this exact participant",
  });
  await expect(caller().historicalAcademics.correctBatch(stale)).rejects.toThrow(
    "HISTORICAL_STALE",
  );
  await caller().historicalAcademics.correctBatch(await prepared(await input()));
  expect(
    await db.academicProfile.findUnique({ where: { userId: "STUDENT" } }),
  ).toEqual(academic);
  const detail = await caller("STUDENT").tuteeHistory.myDetails({
    tuteeId: "a",
  });
  expect(detail.historicalAcademics[0]).toMatchObject({
    original: { rawGrade: null, schoolYear: "24-25" },
    current: { rawGrade: "G8", schoolYear: "24-25" },
  });
  await db.user.update({ where: { id: "VIEWER" }, data: { studentId: "a" } });
  await expect(
    caller().historicalAcademics.preview(await input()),
  ).rejects.toThrow("HISTORICAL_OWNERSHIP_CONFLICT");
});

it("queues a coordinator batch without live changes and applies all rows inside approval", async () => {
  const value = await prepared(
    await input([key("a"), key("b")]),
    "COORDINATOR",
  );
  const request = await queue(value);
  expect(await db.historicalAcademicRecord.count()).toBe(0);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
  expect(request.targets).toHaveProperty("historicalAcademics");
  await caller("ADMIN").approval.decide({
    id: request.id,
    approve: true,
    note: "Reviewed both historical references",
  });
  expect(
    await db.historicalAcademicCorrection.count({
      where: { approvalId: request.id, actorId: "ADMIN" },
    }),
  ).toBe(2);
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .state,
  ).toBe("APPROVED");
});

it.each(["stale", "demoted"])(
  "rejects %s coordinator approvals without partial application",
  async (scenario) => {
    const request = await queue(
      await prepared(await input([key("a"), key("b")])),
    );
    if (scenario === "stale")
      await db.tutee.update({
        where: { id: "b" },
        data: { gradeLevel: "Different" },
      });
    else
      await db.user.update({
        where: { id: "COORDINATOR" },
        data: { role: "VIEWER" },
      });
    await expect(
      caller("ADMIN").approval.decide({
        id: request.id,
        approve: true,
        note: "Attempt obsolete correction",
      }),
    ).rejects.toThrow();
    expect(await db.historicalAcademicCorrection.count()).toBe(0);
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).state,
    ).toBe("PENDING");
  },
);

it.each(["VIEWER", "STUDENT", "TUTOR", "CREW"] as const)(
  "denies %s reads, previews and writes even with a valid ticket",
  async (role) => {
    const value = await input();
    const ready = await prepared(value);
    await expect(caller(role).historicalAcademics.list({})).rejects.toThrow();
    await expect(
      caller(role).historicalAcademics.preview(value),
    ).rejects.toThrow();
    await expect(
      caller(role).historicalAcademics.correctBatch(ready),
    ).rejects.toThrow();
    await expect(
      caller(role).historicalAcademics.audit({ recordId: key("a") }),
    ).rejects.toThrow();
  },
);

it("rejects suspended managers, forged role cookies and anonymous access", async () => {
  const ready = await prepared(await input());
  await db.user.update({
    where: { id: "HEAD" },
    data: { suspendedAt: new Date() },
  });
  await expect(caller().historicalAcademics.correctBatch(ready)).rejects.toThrow();
  await db.user.update({ where: { id: "ADMIN" }, data: { role: "VIEWER" } });
  await expect(
    caller("ADMIN").historicalAcademics.preview(await input()),
  ).rejects.toThrow();
  const anonymous = createCaller({ db, headers: new Headers(), session: null });
  await expect(anonymous.historicalAcademics.list({})).rejects.toThrow();
});

it("requires fresh review when a linked current academic report changes", async () => {
  await db.studentProfileOwnership.create({
    data: { tuteeId: "a", userId: "STUDENT" },
  });
  const ready = await prepared(await input());
  await db.academicProfile.create({
    data: {
      userId: "STUDENT",
      status: "REPORTED",
      gradeLevel: 12,
      schoolYear: "26-27",
      confirmedAt: new Date(),
      reconfirmRequired: false,
    },
  });
  await db.user.update({
    where: { id: "STUDENT" },
    data: { profileVersion: { increment: 1 } },
  });
  await expect(caller().historicalAcademics.correctBatch(ready)).rejects.toThrow(
    "HISTORICAL_STALE",
  );
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it("retains corrected accountless evidence when linking later to a newer account report", async () => {
  await caller().historicalAcademics.correctBatch(await prepared(await input()));
  const corrections = await db.historicalAcademicCorrection.findMany();
  await db.academicProfile.create({
    data: {
      userId: "STUDENT",
      status: "REPORTED",
      gradeLevel: 11,
      schoolYear: "26-27",
      confirmedAt: new Date(),
      reconfirmRequired: false,
    },
  });
  const link = await caller("ADMIN").tuteeHistory.preview({
    tuteeId: "a",
    userId: "STUDENT",
  });
  await caller("ADMIN").tuteeHistory.link({
    tuteeId: "a",
    userId: "STUDENT",
    fingerprint: link.fingerprint,
    reason: "Exact archived identity evidence verified",
  });
  expect(await db.historicalAcademicCorrection.findMany()).toEqual(corrections);
  expect(
    await db.academicProfile.findUnique({ where: { userId: "STUDENT" } }),
  ).toMatchObject({
    gradeLevel: 11,
    schoolYear: "26-27",
    reconfirmRequired: false,
  });
  expect(
    (await caller("STUDENT").tuteeHistory.myDetails({ tuteeId: "a" }))
      .historicalAcademics[0]?.current,
  ).toEqual({ rawGrade: "G8", schoolYear: "24-25" });
});

it("routes historical profile grade edits through audited corrections while allowing contact edits", async () => {
  const row = await db.tutee.findUniqueOrThrow({ where: { id: "a" } });
  const fields = {
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    englishName: row.englishName,
    status: row.status,
  };
  await expect(
    caller().admin.updateTutee({ ...fields, gradeLevel: "8" }),
  ).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
  await caller().admin.updateTutee({ ...fields, phone: "Synthetic contact" });
  expect(await db.tutee.findUnique({ where: { id: "a" } })).toMatchObject({
    gradeLevel: null,
    phone: "Synthetic contact",
  });
});

it("imports multiple raw/unknown periods without accounts and retains additive retry behavior after correction", async () => {
  const files = [
    file("Tutor", [
      { id: "archive-tutor", englishName: "Archive Tutor", status: "ARCHIVED" },
    ]),
    file("HistoricalAcademicRecord", [
      {
        id: "archive-year-1",
        tutorId: "archive-tutor",
        rawGrade: "Year 13",
        schoolYear: "23-24",
        source: "Original register 2023",
        originalConfirmedAt: "2023-10-01T00:00:00Z",
      },
      {
        id: "archive-year-2",
        tutorId: "archive-tutor",
        rawGrade: null,
        schoolYear: "24-25",
        source: "Original register 2024",
        originalConfirmedAt: null,
      },
    ]),
  ];
  const users = await db.user.count();
  const first = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: first.ticket });
  await caller().historicalAcademics.correctBatch(
    await prepared(await input(["archive-year-1", "archive-year-2"], "CSV")),
  );
  const retry = await caller().recordTransfer.preview({ files });
  expect(retry.summary.every((row) => row.created === 0)).toBe(true);
  await caller().recordTransfer.import({ files, ticket: retry.ticket });
  expect(await db.user.count()).toBe(users);
  expect(await db.historicalAcademicCorrection.count()).toBe(2);
  expect(
    await db.historicalAcademicRecord.findUnique({
      where: { id: "archive-year-1" },
    }),
  ).toMatchObject({
    rawGrade: "Year 13",
    originalConfirmedAt: new Date("2023-10-01T00:00:00Z"),
  });
  const changed = [
    file("HistoricalAcademicRecord", [
      {
        id: "archive-year-1",
        tutorId: "archive-tutor",
        rawGrade: "Changed",
        source: "Changed source",
      },
    ]),
  ];
  await expect(
    caller().recordTransfer.preview({ files: changed }),
  ).rejects.toThrow();
});

it.each([
  { id: "legacy-tutee:b", tuteeId: "a", source: "Wrong reserved identity" },
  {
    id: "invalid-year",
    tuteeId: "a",
    schoolYear: "24-27",
    source: "Nonadjacent year",
  },
  { id: "no-owner", source: "No participant" },
  { id: "no-source", tuteeId: "a", source: "" },
])(
  "rejects invalid original academic imports without partial records: $id",
  async (row) => {
    await expect(
      caller().recordTransfer.preview({
        files: [file("HistoricalAcademicRecord", [row])],
      }),
    ).rejects.toThrow();
    expect(await db.historicalAcademicRecord.count()).toBe(0);
  },
);

async function legacyTutor(status: "ACTIVE" | "ARCHIVED" | "GRADUATED" | "TRANSFERRED" = "ARCHIVED") {
  return db.tutor.create({
    data: {
      id: "legacy-tutor",
      englishName: "Historical Tutor",
      status,
      gradeLevel: 9,
      gradeSchoolYear: "24-25",
      gradeConfirmedAt: new Date("2024-10-01T00:00:00Z"),
    },
  });
}

it.each(["TUTEE", "TUTOR"] as const)(
  "rejects a reserved %s archive original that replaces an unmaterialized baseline",
  async (kind) => {
    const participant = kind === "TUTEE"
      ? await db.tutee.update({ where: { id: "a" }, data: { gradeLevel: "9" } })
      : await legacyTutor();
    const recordId = legacyAcademicRecordId(kind, participant.id);
    const original = await historicalAcademicSnapshot(db, recordId);
    const files = [file("HistoricalAcademicRecord", [{
      id: recordId,
      ...(kind === "TUTEE" ? { tuteeId: participant.id } : { tutorId: participant.id }),
      rawGrade: "12",
      schoolYear: "25-26",
      source: "Arbitrary replacement evidence",
    }])];
    await expect(caller().recordTransfer.preview({ files })).rejects.toThrow("Reserved legacy academic evidence must match");
    expect(await historicalAcademicSnapshot(db, recordId)).toEqual(original);
    expect(await db.historicalAcademicRecord.count()).toBe(0);
    expect(await db.historicalAcademicCorrection.count()).toBe(0);
  },
);

it.each(["rawGrade", "schoolYear", "source", "academicallyGraduated", "originalConfirmedAt"] as const)(
  "checks the reserved legacy original's %s independently",
  async (field) => {
    const tutor = await legacyTutor();
    const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
    const { original } = await historicalAcademicSnapshot(db, recordId);
    const changed = {
      rawGrade: "12",
      schoolYear: "25-26",
      source: "Replacement source",
      academicallyGraduated: true,
      originalConfirmedAt: new Date("2024-11-01T00:00:00Z"),
    };
    await expect(caller().recordTransfer.preview({
      files: [file("HistoricalAcademicRecord", [{ id: recordId, tutorId: tutor.id, ...original, [field]: changed[field] }])],
    })).rejects.toThrow("Reserved legacy academic evidence must match");
  },
);

it.each(["ARCHIVED", "GRADUATED", "TRANSFERRED", "corrected"] as const)(
  "protects %s tutor evidence from roster academic edits but permits contact edits",
  async (status) => {
    const tutor = await legacyTutor(status === "corrected" ? "ACTIVE" : status);
    const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
    if (status === "corrected")
      await caller().historicalAcademics.correctBatch(await prepared(await input([recordId])));
    const original = await historicalAcademicSnapshot(db, recordId);
    const fields = { id: tutor.id, expectedUpdatedAt: tutor.updatedAt, status: tutor.status };
    await expect(caller().admin.updateTutor({ ...fields, gradeLevel: 10 })).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
    await expect(caller().admin.updateTutor({ ...fields, gradeLevel: null, academicallyGraduated: true })).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
    await caller().admin.updateTutor({ ...fields, firstName: "Historical", lastName: "Tutor", email: "archive-contact@example.test" });
    expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({
      gradeLevel: 9,
      gradeSchoolYear: "24-25",
      gradeConfirmedAt: tutor.gradeConfirmedAt,
      firstName: "Historical",
      lastName: "Tutor",
      email: "archive-contact@example.test",
    });
    expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original.original);
    expect((await caller().admin.tutors()).find((row) => row.id === tutor.id)).toMatchObject({ historicalGrade: true });
  },
);

it("preserves ordinary current accountless tutor grade editing", async () => {
  const tutor = await legacyTutor("ACTIVE");
  await caller().admin.updateTutor({ id: tutor.id, expectedUpdatedAt: tutor.updatedAt, status: tutor.status, gradeLevel: 10 });
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ gradeLevel: 10, gradeSchoolYear: null, gradeConfirmedAt: null });
  expect(await db.historicalAcademicRecord.count()).toBe(0);
});

it.each(["TUTEE", "TUTOR"] as const)(
  "accepts exact reserved %s evidence and preserves correction overlays on archive retry",
  async (kind) => {
    const participant = kind === "TUTEE"
      ? await db.tutee.findUniqueOrThrow({ where: { id: "a" } })
      : await legacyTutor();
    const recordId = legacyAcademicRecordId(kind, participant.id);
    const { original } = await historicalAcademicSnapshot(db, recordId);
    const files = [file("HistoricalAcademicRecord", [{
      id: recordId,
      ...(kind === "TUTEE" ? { tuteeId: participant.id } : { tutorId: participant.id }),
      ...original,
    }])];
    const preview = await caller().recordTransfer.preview({ files });
    expect(await db.historicalAcademicRecord.count()).toBe(0);
    await caller().recordTransfer.import({ files, ticket: preview.ticket });
    await caller().historicalAcademics.correctBatch(await prepared(await input([recordId])));
    const snapshot = await historicalAcademicSnapshot(db, recordId);
    const retry = await caller().recordTransfer.preview({ files });
    expect(retry.summary).toEqual([{ table: "HistoricalAcademicRecord", created: 0, skipped: 1 }]);
    await caller().recordTransfer.import({ files, ticket: retry.ticket });
    expect(await historicalAcademicSnapshot(db, recordId)).toEqual(snapshot);
    expect(snapshot.original).toEqual(original);
    expect(snapshot.revision).toBe(1);
  },
);

it("restores a new participant and its preserved original together even after roster mirrors advanced", async () => {
  const tutor = await legacyTutor("ACTIVE");
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  await caller().historicalAcademics.correctBatch(await prepared(await input([recordId])));
  await db.tutor.update({ where: { id: tutor.id }, data: { gradeLevel: 11, gradeSchoolYear: "26-27" } });
  const archive = await caller().recordTransfer.export({});
  const files = archive.files.filter((row) => ["Tutor.csv", "HistoricalAcademicRecord.csv"].includes(row.name));
  const original = (await historicalAcademicSnapshot(db, recordId)).original;
  await db.historicalAcademicCorrection.deleteMany();
  await db.historicalAcademicRecord.deleteMany();
  await db.tutor.deleteMany();
  const preview = await caller().recordTransfer.preview({ files });
  await caller().recordTransfer.import({ files, ticket: preview.ticket });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ gradeLevel: 11, gradeSchoolYear: "26-27" });
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it("rechecks reserved baselines at import and atomically rolls back earlier archive rows", async () => {
  const { original } = await historicalAcademicSnapshot(db, key("a"));
  const files = [
    file("SubjectLevel", [{ id: "atomic-level", name: "Earlier archive row" }]),
    file("HistoricalAcademicRecord", [{ id: key("a"), tuteeId: "a", ...original }]),
  ];
  const preview = await caller().recordTransfer.preview({ files });
  await db.tutee.update({ where: { id: "a" }, data: { gradeLevel: "9" } });
  const audits = await db.auditLog.count();
  await expect(caller().recordTransfer.import({ files, ticket: preview.ticket })).rejects.toThrow("Reserved legacy academic evidence must match");
  expect(await db.subjectLevel.count({ where: { id: "atomic-level" } })).toBe(0);
  expect(await db.historicalAcademicRecord.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(audits);
});

it("preserves tutor originals across status-only reactivation and subsequent profile edits", async () => {
  const tutor = await legacyTutor();
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  await caller().admin.updateTutor({ id: tutor.id, expectedUpdatedAt: tutor.updatedAt, status: "ACTIVE" });
  const current = await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } });
  await expect(caller().admin.updateTutor({ id: tutor.id, expectedUpdatedAt: current.updatedAt, status: "ACTIVE", gradeLevel: 10 })).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});


// Exercise the real acceptance route, including invitation creation and status reconciliation.
it.each(["ARCHIVED", "GRADUATED", "TRANSFERRED"] as const)(
  "preserves %s tutor originals through initial-applicant reactivation",
  async (status) => {
    const seeded = await legacyTutor(status);
    const email = "returning-archive@example.test";
    const tutor = await db.tutor.update({ where: { id: seeded.id }, data: { email } });
    const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
    const { original } = await historicalAcademicSnapshot(db, recordId);
    await db.programFeature.create({ data: { key: "INTERVIEWS", enabled: false } });
    const app = await db.tutorApplication.create({ data: { name: "Historical Tutor", email, type: "INITIAL" } });
    await caller().admin.setApplicationStatus({ id: app.id, expectedUpdatedAt: app.updatedAt, status: "ACCEPTED" });
    const current = await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } });
    expect(current.status).toBe("ACTIVE");
    expect(await db.user.count({ where: { tutorId: tutor.id } })).toBe(0);
    await expect(caller().admin.updateTutor({ id: tutor.id, expectedUpdatedAt: current.updatedAt, status: "ACTIVE", gradeLevel: 10 }))
      .rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
    expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
    expect(await db.historicalAcademicCorrection.count()).toBe(0);
    const preserved = await db.historicalAcademicRecord.findUniqueOrThrow({ where: { id: recordId } });
    const accepted = await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } });
    await caller().admin.setApplicationStatus({ id: app.id, expectedUpdatedAt: accepted.updatedAt, status: "ACCEPTED" });
    expect(await db.historicalAcademicRecord.findUnique({ where: { id: recordId } })).toEqual(preserved);
    expect(await db.registrationCode.count({ where: { applicationId: app.id } })).toBe(1);
  },
);

it("keeps linked current academic saves separate from an unmaterialized archived tutor original", async () => {
  const tutor = await legacyTutor("ARCHIVED");
  await db.user.update({ where: { id: "HEAD" }, data: { tutorId: tutor.id } });
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  const account = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  await caller().admin.updateAccountAcademics({ userId: account.id, expectedProfileVersion: account.profileVersion, expectedSchoolYear: "26-27", status: "REPORTED", gradeLevel: 10, reason: "Synthetic current report" });
  expect(await db.academicProfile.findUnique({ where: { userId: account.id } })).toMatchObject({ gradeLevel: 10, schoolYear: "26-27" });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});


it("keeps current academic graduation separate from an unmaterialized historical tutee original", async () => {
  await db.user.update({ where: { id: "HEAD" }, data: { studentId: "a" } });
  const { original } = await historicalAcademicSnapshot(db, key("a"));
  const account = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  await caller().admin.updateAccountAcademics({ userId: account.id, expectedProfileVersion: account.profileVersion, expectedSchoolYear: "26-27", status: "GRADUATED", gradeLevel: null, reason: "Synthetic current graduation" });
  expect(await db.academicProfile.findUnique({ where: { userId: account.id } })).toMatchObject({ status: "GRADUATED", gradeLevel: null });
  expect((await historicalAcademicSnapshot(db, key("a"))).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});


it.each([
  { status: "INACTIVE", intakeTermId: "old" },
  { status: "INACTIVE", intakeTermId: null },
  { status: "ACTIVE", intakeTermId: "old" },
] as const)("keeps current graduation separate from historical tutee evidence ($status/$intakeTermId)", async (history) => {
  await db.tutee.update({ where: { id: "a" }, data: history });
  await db.user.update({ where: { id: "HEAD" }, data: { studentId: "a" } });
  const { original } = await historicalAcademicSnapshot(db, key("a"));
  const account = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  await caller().admin.updateAccountAcademics({ userId: account.id, expectedProfileVersion: account.profileVersion, expectedSchoolYear: "26-27", status: "GRADUATED", gradeLevel: null, reason: "Synthetic current graduation" });
  expect(await db.academicProfile.findUnique({ where: { userId: account.id } })).toMatchObject({ status: "GRADUATED", gradeLevel: null });
  expect(await db.tutee.findUnique({ where: { id: "a" } })).toMatchObject({ academicallyGraduated: true });
  expect((await historicalAcademicSnapshot(db, key("a"))).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it.each([false, true])("preserves originals before tutoring access links/synchronizes a historical tutor (linked=%s)", async (linked) => {
  const tutor = await legacyTutor();
  await db.tutor.update({ where: { id: tutor.id }, data: { email: "head@example.test" } });
  if (linked) await db.user.update({ where: { id: "HEAD" }, data: { tutorId: tutor.id } });
  await db.academicProfile.create({ data: { userId: "HEAD", status: "REPORTED", gradeLevel: 11, schoolYear: "26-27", confirmedAt: new Date("2026-09-01"), reconfirmRequired: false } });
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  expect(await caller().admin.setUserCanTutor({ userId: "HEAD", canTutor: true })).toMatchObject({ linked: true });
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ status: "ACTIVE", gradeLevel: 11, gradeSchoolYear: "26-27" });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it.each(["GRADUATED", "TRANSFERRED"] as const)("preserves originals on a reviewed %s school return", async (reason) => {
  const tutor = await legacyTutor(reason);
  await db.user.update({ where: { id: "HEAD" }, data: { tutorId: tutor.id } });
  await db.schoolDeparture.create({ data: { userId: "HEAD", reason, source: "HEAD", revision: 1 } });
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  await caller().departure.setState({ userId: "HEAD", action: "RETURN", expectedRevision: 1, explanation: "Reviewed return to school" });
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ status: "PENDING" });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it.each([false, true])("preserves originals when registration reuses a historical tutor (bound=%s)", async (bound) => {
  const tutor = await legacyTutor();
  const email = "returning-registration@example.test";
  await db.tutor.update({ where: { id: tutor.id }, data: { email } });
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  const issued = await issueRegistrationCode({ email, tutorId: bound ? tutor.id : undefined });
  let row = await db.registrationCode.findUniqueOrThrow({ where: { id: issued.id } });
  const challenge = await setEmailVerification(row, email);
  if (!challenge.ok) throw new Error("Expected verification challenge");
  row = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  const verified = await confirmEmailCode(row, challenge.emailCode);
  if (!verified.ok) throw new Error("Expected verified invitation");
  row = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  expect(await completeRegistration(row, { firstName: "Historical", lastName: "Tutor", gradeLevel: 11, password: "Synthetic-password-123!", completionProof: verified.completionProof })).toMatchObject({ ok: true });
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ status: "ACTIVE", gradeLevel: 11, gradeSchoolYear: "26-27" });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});

it.each(["TUTEE", "TUTOR"] as const)("preserves unknown and already corrected %s originals when synchronizing current academic mirrors", async (kind) => {
  const participant = kind === "TUTOR" ? await legacyTutor() : await db.tutee.findUniqueOrThrow({ where: { id: "a" } });
  if (kind === "TUTOR") await db.tutor.update({ where: { id: participant.id }, data: { gradeLevel: null, gradeSchoolYear: null, gradeConfirmedAt: null, academicallyGraduated: true } });
  await db.user.update({ where: { id: "HEAD" }, data: kind === "TUTOR" ? { tutorId: participant.id } : { studentId: participant.id } });
  const recordId = legacyAcademicRecordId(kind, participant.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  await db.academicProfile.create({ data: { userId: "HEAD", status: "REPORTED", gradeLevel: 10, schoolYear: "26-27", confirmedAt: new Date("2026-09-01"), reconfirmRequired: false } });
  await synchronizeAcademicMirrors(db, "HEAD");
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  await caller().historicalAcademics.correctBatch(await prepared(await input([recordId])));
  const preserved = await db.historicalAcademicRecord.findUniqueOrThrow({ where: { id: recordId }, include: { corrections: true } });
  await db.academicProfile.update({ where: { userId: "HEAD" }, data: { status: "GRADUATED", gradeLevel: null, schoolYear: null } });
  await synchronizeAcademicMirrors(db, "HEAD");
  expect(await db.historicalAcademicRecord.findUnique({ where: { id: recordId }, include: { corrections: true } })).toEqual(preserved);
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
});

it.each(["profile", "status", "reinstate", "undo"] as const)("preserves an undated historical tutee through %s restoration", async (path) => {
  const tutee = await db.tutee.update({ where: { id: "a" }, data: { intakeTermId: null } });
  const { original } = await historicalAcademicSnapshot(db, key(tutee.id));
  if (path === "profile") await caller().admin.updateTutee({ id: tutee.id, expectedUpdatedAt: tutee.updatedAt, englishName: tutee.englishName, status: "ACTIVE" });
  else if (path === "status") await caller().admin.setTuteeStatus({ id: tutee.id, expectedUpdatedAt: tutee.updatedAt, status: "ACTIVE" });
  else if (path === "reinstate") {
    const removal = await db.tuteeRemovalRequest.create({ data: { tuteeId: tutee.id, state: "APPROVED" } });
    await caller().admin.reinstateTutee({ requestId: removal.id });
  } else {
    const entry = await db.auditLog.create({ data: { action: "Synthetic status change", entity: "Tutee", undoData: { kind: "tutee.status", payload: { id: tutee.id, status: "ACTIVE" } } } });
    await caller().admin.undoAudit({ id: entry.id });
  }
  const current = await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } });
  expect(current.status).toBe(path === "reinstate" ? "PENDING" : "ACTIVE");
  expect((await caller().admin.tutees()).find((row) => row.id === tutee.id)).toMatchObject({ historical: false, historicalGrade: true, enrollmentCorrection: null });
  await expect(caller().admin.updateTutee({ id: tutee.id, expectedUpdatedAt: current.updatedAt, englishName: current.englishName, status: current.status, gradeLevel: "10" })).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
  expect((await historicalAcademicSnapshot(db, key(tutee.id))).original).toEqual(original);
  expect(await db.historicalAcademicCorrection.count()).toBe(0);
});


it("preserves originals when a card correction reinstates an undated tutee", async () => {
  const tutee = await db.tutee.update({ where: { id: "a" }, data: { intakeTermId: null } });
  const { original } = await historicalAcademicSnapshot(db, key(tutee.id));
  await db.tuteeRemovalRequest.create({ data: { tuteeId: tutee.id, kind: "PUNISHMENT", state: "APPROVED", resolvedAt: tutee.updatedAt, pairingSnapshot: { pairingIds: [], status: "ACTIVE" } } });
  const card = await db.disciplinaryCard.create({ data: { tuteeId: tutee.id, color: "RED", reviewStatus: "VALID" } });
  await caller().admin.reviewCard({ id: card.id, expectedUpdatedAt: card.updatedAt, reviewStatus: "INVALID", reviewNote: "Verified original attendance" });
  expect(await db.tutee.findUnique({ where: { id: tutee.id } })).toMatchObject({ status: "PENDING" });
  expect((await historicalAcademicSnapshot(db, key(tutee.id))).original).toEqual(original);
  expect(await db.historicalAcademicRecord.count({ where: { id: key(tutee.id) } })).toBe(1);
});

it.each(["direct", "survey"] as const)("preserves originals on %s assignment of an inactive tutee", async (path) => {
  const tutee = await db.tutee.update({ where: { id: "a" }, data: { intakeTermId: "current" } });
  const { original } = await historicalAcademicSnapshot(db, key(tutee.id));
  const tutor = await db.tutor.create({ data: { englishName: "Current Tutor", status: "ACTIVE" } });
  const subject = await db.subject.create({ data: { name: "Synthetic Mathematics" } });
  await db.tutorQualification.create({ data: { tutorId: tutor.id, subjectId: subject.id, approvedById: "HEAD", grants: { create: { subjectId: subject.id } } } });
  if (path === "direct") {
    await caller().admin.assignTuteeToTutor({ tuteeId: tutee.id, tutorId: tutor.id, termId: "current", subject: subject.name });
  } else {
    const survey = await db.studentSurvey.create({ data: { tuteeId: tutee.id, email: "historical-survey@example.test", intakeTermId: "current", tokenHash: "synthetic-historical-token", expiresAt: new Date("2099-01-01"), confirmedAt: new Date(), policyRevision: "synthetic-test-revision", policySnapshot: [], payload: { englishName: tutee.englishName, email: "historical-survey@example.test", preferredContact: "historical-survey@example.test", firstChoiceId: subject.id, slotIds: ["synthetic-slot"], signatureName: tutee.englishName, agreed: true, policyRevision: "synthetic-test-revision" } } });
    const ticket = await caller().studentWorkflow.prepareAction({ action: "ASSIGN", target: survey.id });
    await db.studentActionConfirmation.update({ where: { id: ticket.id }, data: { readyAt: new Date(0) } });
    await caller().studentWorkflow.assign({ id: survey.id, ticket: ticket.id, subjectId: subject.id, tutorId: tutor.id });
  }
  const current = await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } });
  expect(current.status).toBe("ACTIVE");
  expect(await db.pairingTutee.count({ where: { tuteeId: tutee.id } })).toBe(1);
  await expect(caller().admin.updateTutee({ id: tutee.id, expectedUpdatedAt: current.updatedAt, englishName: current.englishName, status: current.status, gradeLevel: "10" })).rejects.toThrow("HISTORICAL_EDITOR_REQUIRED");
  expect((await historicalAcademicSnapshot(db, key(tutee.id))).original).toEqual(original);
});

it("rolls original preservation back when application promotion cannot link the account", async () => {
  const tutor = await legacyTutor();
  await db.tutor.update({ where: { id: tutor.id }, data: { email: "head@example.test" } });
  const other = await db.tutor.create({ data: { englishName: "Another Tutor" } });
  await db.user.update({ where: { id: "HEAD" }, data: { tutorId: other.id } });
  await db.programFeature.create({ data: { key: "INTERVIEWS", enabled: false } });
  const app = await db.tutorApplication.create({ data: { name: "Historical Tutor", email: "head@example.test", type: "INITIAL" } });
  await expect(caller().admin.setApplicationStatus({ id: app.id, expectedUpdatedAt: app.updatedAt, status: "ACCEPTED" })).rejects.toThrow("Account already belongs to another tutor.");
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ status: "ARCHIVED", gradeLevel: 9, gradeSchoolYear: "24-25" });
  expect(await db.tutorApplication.findUnique({ where: { id: app.id } })).toMatchObject({ status: "PENDING", promotedTutorId: null });
  expect(await db.historicalAcademicRecord.count()).toBe(0);
  expect(await db.registrationCode.count()).toBe(0);
});

it.each([false, true])("serializes a historical correction with a current academic save (correction first=%s)", async (correctionFirst) => {
  const tutor = await legacyTutor();
  await db.user.update({ where: { id: "HEAD" }, data: { tutorId: tutor.id } });
  const recordId = legacyAcademicRecordId("TUTOR", tutor.id);
  const { original } = await historicalAcademicSnapshot(db, recordId);
  const ready = await prepared(await input([recordId]));
  const account = await db.user.findUniqueOrThrow({ where: { id: "HEAD" } });
  const save = () => caller().admin.updateAccountAcademics({ userId: "HEAD", expectedProfileVersion: account.profileVersion, expectedSchoolYear: "26-27", status: "REPORTED", gradeLevel: 11, reason: "Current confirmed report" });
  const correct = () => caller().historicalAcademics.correctBatch(ready);
  const results = await Promise.allSettled(correctionFirst ? [correct(), save()] : [save(), correct()]);
  expect(results[correctionFirst ? 1 : 0].status).toBe("fulfilled");
  const correction = results[correctionFirst ? 0 : 1];
  if (correction.status === "rejected") expect(correction.reason).toMatchObject({ message: "HISTORICAL_STALE" });
  expect((await historicalAcademicSnapshot(db, recordId)).original).toEqual(original);
  expect(await db.academicProfile.findUnique({ where: { userId: "HEAD" } })).toMatchObject({ gradeLevel: 11, schoolYear: "26-27" });
});


it.each(["TUTEE", "TUTOR"] as const)("preservation locks %s evidence without blocking assignment foreign-key reads", async (kind) => {
  const tutor = await legacyTutor();
  const participantId = kind === "TUTOR" ? tutor.id : "a";
  let release!: () => void;
  let acquired!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const preserving = db.$transaction(async (tx) => {
    await preserveHistoricalAcademics(tx, kind, participantId);
    acquired();
    await hold;
  });
  try {
    await Promise.race([ready, preserving]);
    await db.$transaction(async (tx) => {
      // A pairing needs KEY SHARE on the stable participant IDs. The evidence fence
      // must block academic/status updates without adding a cross-participant FK cycle.
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'");
      await tx.pairing.create({ data: { tutorId: tutor.id, termId: "current", subject: "Synthetic Mathematics", dayOfWeek: 1, startMin: 900, endMin: 960, tutees: { create: { tuteeId: "a" } } } });
    });
  } finally {
    release();
    await preserving;
  }
  expect(await db.pairingTutee.count({ where: { tuteeId: "a" } })).toBe(1);
});


it("allows paired academic mirrors and tutee reassignment to finish in opposite participant order", async () => {
  const tutor = await legacyTutor("ACTIVE");
  await db.user.update({ where: { id: "HEAD" }, data: { tutorId: tutor.id, studentId: "a" } });
  await db.academicProfile.create({ data: { userId: "HEAD", status: "REPORTED", gradeLevel: 11, schoolYear: "26-27", confirmedAt: new Date("2026-09-01"), reconfirmRequired: false } });
  const { original } = await historicalAcademicSnapshot(db, key("a"));
  let release!: () => void;
  let acquired!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const mirroring = db.$transaction(async (tx) => {
    // Pause after the real mirror path's account→Tutor prefix. Its remaining Tutee
    // write must coexist with assignment's Tutee→Tutor foreign-key lock order.
    await lockAccountProfile(tx, "HEAD");
    await preserveHistoricalAcademics(tx, "TUTOR", tutor.id);
    acquired();
    await hold;
    await synchronizeAcademicMirrors(tx, "HEAD");
  });
  try {
    await Promise.race([ready, mirroring]);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'");
      await preserveHistoricalAcademics(tx, "TUTEE", "a");
      await tx.pairing.create({ data: { tutorId: tutor.id, termId: "current", subject: "Synthetic Mathematics", dayOfWeek: 1, startMin: 900, endMin: 960, tutees: { create: { tuteeId: "a" } } } });
      await tx.tutee.update({ where: { id: "a" }, data: { status: "ACTIVE" } });
    });
  } finally {
    release();
    await mirroring;
  }
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ gradeLevel: 11, gradeSchoolYear: "26-27" });
  expect(await db.tutee.findUnique({ where: { id: "a" } })).toMatchObject({ status: "ACTIVE" });
  expect((await historicalAcademicSnapshot(db, key("a"))).original).toEqual(original);
});


it("orders reserved archive participant locks before a dual-linked academic mirror can wait on them", async () => {
  const tutor = await legacyTutor();
  await db.user.update({ where: { id: "STUDENT" }, data: { tutorId: tutor.id, studentId: "a" } });
  await db.academicProfile.create({ data: { userId: "STUDENT", status: "REPORTED", gradeLevel: 11, schoolYear: "26-27", confirmedAt: new Date("2026-09-01"), reconfirmRequired: false } });
  const tutorKey = legacyAcademicRecordId("TUTOR", tutor.id);
  const tuteeOriginal = (await historicalAcademicSnapshot(db, key("a"))).original;
  const tutorOriginal = (await historicalAcademicSnapshot(db, tutorKey)).original;
  // Deliberately reverse the mirror's participant order in a valid archive.
  const files = [file("HistoricalAcademicRecord", [
    { id: key("a"), tuteeId: "a", tutorId: null, ...tuteeOriginal },
    { id: tutorKey, tuteeId: null, tutorId: tutor.id, ...tutorOriginal },
  ])];
  let acquired!: () => void;
  let started!: (pid: number) => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const importingPid = new Promise<number>((resolve) => { started = resolve; });
  const mirroring = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, "STUDENT");
    await preserveHistoricalAcademics(tx, "TUTOR", tutor.id);
    acquired();
    const pid = await importingPid;
    await vi.waitUntil(async () => {
      const [row] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND NOT granted) AS waiting`;
      return row?.waiting;
    }, { timeout: 2000, interval: 10 });
    await synchronizeAcademicMirrors(tx, "STUDENT");
  }, { timeout: 15000 });
  await Promise.race([ready, mirroring]);
  const importing = db.$transaction(async (tx) => {
    await lockUsernameNamespace(tx);
    // A different Head actor must not accidentally serialize on the mirrored account.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id='HEAD' FOR SHARE`;
    const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    started(backend!.pid);
    return applyRecords(tx, files);
  }, { timeout: 15000 });
  const results = await Promise.allSettled([mirroring, importing]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  expect((await historicalAcademicSnapshot(db, key("a"))).original).toEqual(tuteeOriginal);
  expect((await historicalAcademicSnapshot(db, tutorKey)).original).toEqual(tutorOriginal);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ gradeLevel: 11, gradeSchoolYear: "26-27" });
});


it("orders reserved archive row locks with a dual-linked account name writer", async () => {
  const tutor = await legacyTutor();
  await db.user.update({ where: { id: "STUDENT" }, data: { tutorId: tutor.id, studentId: "a" } });
  const tutorKey = legacyAcademicRecordId("TUTOR", tutor.id);
  const tuteeOriginal = (await historicalAcademicSnapshot(db, key("a"))).original;
  const tutorOriginal = (await historicalAcademicSnapshot(db, tutorKey)).original;
  const files = [file("HistoricalAcademicRecord", [
    { id: key("a"), tuteeId: "a", tutorId: null, ...tuteeOriginal },
    { id: tutorKey, tuteeId: null, tutorId: tutor.id, ...tutorOriginal },
  ])];
  let acquired!: () => void;
  let started!: (pid: number) => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const importingPid = new Promise<number>((resolve) => { started = resolve; });
  const renaming = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, "STUDENT");
    // Name writers use ordinary row updates, with no participant advisory lock.
    await tx.tutor.update({ where: { id: tutor.id }, data: { englishName: "Updated Person" } });
    acquired();
    const pid = await importingPid;
    await vi.waitUntil(async () => {
      const [row] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS waiting`;
      return row?.waiting;
    }, { timeout: 2000, interval: 10 });
    await updateAccountProfile(tx, "STUDENT", { name: "Updated Person" });
  }, { timeout: 15000 });
  await Promise.race([ready, renaming]);
  const importing = db.$transaction(async (tx) => {
    await lockUsernameNamespace(tx);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id='HEAD' FOR SHARE`;
    const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    started(backend!.pid);
    return applyRecords(tx, files);
  }, { timeout: 15000 });
  const results = await Promise.allSettled([renaming, importing]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({ englishName: "Updated Person" });
  expect(await db.tutee.findUnique({ where: { id: "a" } })).toMatchObject({ englishName: "Updated Person" });
  expect((await historicalAcademicSnapshot(db, key("a"))).original).toEqual(tuteeOriginal);
  expect((await historicalAcademicSnapshot(db, tutorKey)).original).toEqual(tutorOriginal);
});

it("retains original CSV row diagnostics when reserved participant locks are reordered", async () => {
  const first = (await historicalAcademicSnapshot(db, key("a"))).original;
  const second = (await historicalAcademicSnapshot(db, key("b"))).original;
  const files = [file("HistoricalAcademicRecord", [
    { id: key("a"), tuteeId: "a", ...first },
    { id: key("b"), tuteeId: "b", ...second, schoolYear: "24-27" },
  ])];
  await expect(caller().recordTransfer.preview({ files })).rejects.toThrow("HistoricalAcademicRecord.csv, row 3: Historical schoolYear must be an adjacent reference year or null.");
  expect(await db.historicalAcademicRecord.count()).toBe(0);
});
