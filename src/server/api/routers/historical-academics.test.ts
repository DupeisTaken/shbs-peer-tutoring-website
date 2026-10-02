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
import { historicalAcademicSnapshot } from "~/server/historical-academics";
import { ApprovalQueued } from "~/server/approvals";

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
  text: recordCsv(Object.keys(rows[0]!), rows),
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
