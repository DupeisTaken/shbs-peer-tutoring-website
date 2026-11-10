import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification } from "~/server/qualifications";
import { isAppliedInterviewCompletion } from "~/server/interview-hours";

const caller = (id: string) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
      role: "HEAD" as Session["role"],
      tutorId: "stale-session-link",
      expires: "2099-01-01",
    },
  });
const completedAt = new Date("2026-09-15T04:00:37.456Z");
const oldPanel = ["old-chair", "old-qualified", "old-member"];
const newPanel = ["new-chair", "new-qualified", "new-member"];
const completion = {
  completedAt,
  durationMin: 45,
  attendedTutorIds: oldPanel.map((id) => `${id}-tutor`),
};
const credits = () =>
  db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.create({
    data: {
      name: "Synthetic Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["applicant", "TUTOR"],
    ["head", "HEAD"],
    ["old-chair", "ADMIN"],
    ["old-qualified", "TUTOR"],
    ["old-member", "TUTOR"],
    ["new-chair", "ADMIN"],
    ["new-qualified", "TUTOR"],
    ["new-member", "TUTOR"],
    ["coordinator", "COORDINATOR"],
  ] as const) {
    await db.tutor.create({
      data: {
        id: `${id}-tutor`,
        englishName: `Synthetic ${id}`,
        status: "ACTIVE",
      },
    });
    await db.user.create({
      data: {
        id,
        role,
        username: id,
        email: `${id}@example.test`,
        emailVerifiedAt: new Date(),
        tutorId: `${id}-tutor`,
      },
    });
  }
  await db.courseGroup.create({
    data: { id: "history", name: "Synthetic History", rank: 0 },
  });
  await db.subjectLevel.createMany({
    data: [
      { id: "standard", name: "Synthetic Standard", prefix: "", rank: 0 },
      { id: "advanced", name: "Synthetic Advanced", prefix: "AP", rank: 1 },
    ],
  });
  await db.subject.createMany({
    data: ["standard", "advanced"].map((levelId) => ({
      id: `history-${levelId}`,
      name: `Synthetic History ${levelId}`,
      baseName: "Synthetic History",
      groupId: "history",
      levelId,
    })),
  });
  await db.$transaction(async (tx) => {
    for (const id of ["old-qualified", "new-qualified"])
      await approveQualification(tx, `${id}-tutor`, "history-advanced", "head");
  });
});
afterAll(() => db.$disconnect());

async function stage(higher = false, completed = true) {
  if (higher)
    await db.$transaction((tx) =>
      approveQualification(tx, "applicant-tutor", "history-standard", "head"),
    );
  const { id } = await caller("applicant").qualificationApplication.submit({
    subjectId: "history-advanced",
    reason: "Synthetic subject evidence",
  });
  const pending = await db.tutorApplication.findUniqueOrThrow({
    where: { id },
  });
  await caller("head").admin.assignInterviewers({
    applicationId: id,
    tutorIds: oldPanel.map((person) => `${person}-tutor`),
    headTutorId: "old-chair-tutor",
    expectedUpdatedAt: pending.updatedAt,
  });
  for (const person of oldPanel)
    await caller(person).tutor.castInterviewVote({
      applicationId: id,
      accept: true,
      comment: "Synthetic original vote",
    });
  if (completed) {
    const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
    await caller("head").interviewManagement.complete({
      applicationId: id,
      ...completion,
      reason: "Synthetic actual interview",
      expectedUpdatedAt: app.updatedAt,
    });
  }
  return id;
}

async function repair(id: string) {
  await db.tutor.updateMany({
    where: { id: { in: oldPanel.map((person) => `${person}-tutor`) } },
    data: { status: "OPTED_OUT" },
  });
  const before = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  await caller("head").admin.assignInterviewers({
    applicationId: id,
    tutorIds: newPanel.map((person) => `${person}-tutor`),
    headTutorId: "new-chair-tutor",
    expectedUpdatedAt: before.updatedAt,
    repairReason:
      "Original panelists are unavailable; retain their completed service",
  });
  for (const person of newPanel)
    await caller(person).tutor.castInterviewVote({
      applicationId: id,
      accept: true,
    });
  return db.tutorApplication.findUniqueOrThrow({
    where: { id },
    include: { interviewers: true },
  });
}

it.each([false, true])(
  "approves a repaired completed qualification with every original attendee replaced, retaining all service (higher=%s)",
  async (higher) => {
    const id = await stage(higher);
    const originalService = await credits();
    const original = await db.tutorApplication.findUniqueOrThrow({
      where: { id },
    });
    const repaired = await repair(id);
    expect(repaired.type).toBe(higher ? "HIGHER_LEVEL" : "ADDITIONAL_SUBJECT");
    expect(repaired.interviewers.every((person) => !person.attended)).toBe(
      true,
    );
    const input = {
      id,
      accept: true,
      comment: "Fresh panel reviewed the original completed interview",
      expectedUpdatedAt: repaired.updatedAt,
      retainRecordedService: true as const,
      completion: { ...completion, attendedTutorIds: [] },
    };
    await expect(
      caller("new-chair").qualificationApplication.decide({
        ...input,
        expectedUpdatedAt: original.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller("new-chair").qualificationApplication.decide(input),
    ).resolves.toMatchObject({ ok: true });
    const accepted = await db.tutorApplication.findUniqueOrThrow({
      where: { id },
    });
    expect(accepted).toMatchObject({
      status: "ACCEPTED",
      qualificationDecidedById: "new-chair",
      decidedByTutorId: "new-chair-tutor",
      interviewCompletedAt: original.interviewCompletedAt,
      interviewDurationMin: original.interviewDurationMin,
      interviewSchoolYear: original.interviewSchoolYear,
      interviewQuarter: original.interviewQuarter,
    });
    expect(await credits()).toEqual(originalService);
    expect(
      await db.qualificationGrant.count({
        where: {
          tutorId: "applicant-tutor",
          sourceSubjectId: "history-advanced",
        },
      }),
    ).toBeGreaterThan(0);
    await expect(
      caller("new-chair").qualificationApplication.decide(input),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await db.tutorApplication.findUniqueOrThrow({ where: { id } }),
    ).toEqual(accepted);
    expect(await credits()).toEqual(originalService);
    await expect(
      caller("new-chair").qualificationApplication.decide({
        ...input,
        completion: { ...input.completion, durationMin: 46 },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.tutorApplication.findUniqueOrThrow({ where: { id } }),
    ).toEqual(accepted);
    expect(await credits()).toEqual(originalService);
  },
);

it.each(["one", "all"])(
  "refuses a retained approval when %s former source credits are missing",
  async (missing) => {
    const id = await stage();
    const repaired = await repair(id);
    const original = await credits();
    await db.serviceHourAdjustment.deleteMany({
      where: {
        id: {
          in:
            missing === "one"
              ? [original[0]!.id]
              : original.map((row) => row.id),
        },
      },
    });
    const damaged = await credits();
    await expect(
      caller("new-chair").qualificationApplication.decide({
        id,
        accept: true,
        comment: "Synthetic retained approval",
        expectedUpdatedAt: repaired.updatedAt,
        retainRecordedService: true,
        completion: { ...completion, attendedTutorIds: [] },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await db.tutorApplication.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("INTERVIEW");
    expect(
      await db.qualificationGrant.count({
        where: { tutorId: "applicant-tutor" },
      }),
    ).toBe(0);
    expect(await credits()).toEqual(damaged);
  },
);

it("requires nonempty first-service attendance and refuses a retained flag without recorded service", async () => {
  const id = await stage(false, false);
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  const input = {
    id,
    accept: true,
    comment: "Synthetic initial completion",
    expectedUpdatedAt: app.updatedAt,
    completion: { ...completion, attendedTutorIds: [] },
  };
  await expect(
    caller("old-chair").qualificationApplication.decide(input),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller("old-chair").qualificationApplication.decide({
      ...input,
      retainRecordedService: true,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await credits()).toEqual([]);
  expect(
    (await db.tutorApplication.findUniqueOrThrow({ where: { id } })).status,
  ).toBe("INTERVIEW");
});

it("does not grant historical service to a newly assigned voting panelist", async () => {
  const id = await stage();
  const repaired = await repair(id);
  const originalService = await credits();
  const correction = {
    applicationId: id,
    ...completion,
    attendedTutorIds: ["new-chair-tutor"],
    reason: "Synthetic separate correction",
    expectedUpdatedAt: repaired.updatedAt,
  };
  expect(await isAppliedInterviewCompletion(db, correction)).toBe(false);
  await expect(
    caller("head").interviewManagement.complete(correction),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await credits()).toEqual(originalService);
  expect(
    await db.tutorApplication.findUniqueOrThrow({
      where: { id },
      include: { interviewers: true },
    }),
  ).toEqual(repaired);
});

const recordedReviewCases = [
  { label: "initial", type: "INITIAL", repaired: false },
  { label: "additional", type: "ADDITIONAL_SUBJECT", repaired: false },
  { label: "higher", type: "HIGHER_LEVEL", repaired: false },
  { label: "repaired additional", type: "ADDITIONAL_SUBJECT", repaired: true },
  { label: "repaired higher", type: "HIGHER_LEVEL", repaired: true },
] as const;
type RecordedReviewCase = (typeof recordedReviewCases)[number];

async function recordedReview(row: RecordedReviewCase) {
  let id: string;
  if (row.type === "INITIAL") {
    const app = await db.tutorApplication.create({
      data: {
        name: "Synthetic initial version review",
        email: "initial-version@example.test",
        subjectIntents: { create: { subjectId: "history-advanced" } },
      },
    });
    id = app.id;
    await caller("head").admin.assignInterviewers({
      applicationId: id,
      tutorIds: oldPanel.map((person) => `${person}-tutor`),
      headTutorId: "old-chair-tutor",
      expectedUpdatedAt: app.updatedAt,
    });
    for (const actor of oldPanel)
      await caller(actor).tutor.castInterviewVote({
        applicationId: id,
        accept: true,
      });
  } else id = await stage(row.type === "HIGHER_LEVEL", false);
  const first = {
    applicationId: id,
    ...completion,
    reason: "Synthetic first completion without a reviewed version",
  };
  // A first completion has no earlier service to overwrite. Preserve this
  // intentional tokenless contract while making recorded changes versioned.
  await expect(
    caller("head").interviewManagement.complete(first),
  ).resolves.toEqual({ ok: true });
  if (row.repaired) await repair(id);
  const app = await db.tutorApplication.findUniqueOrThrow({ where: { id } });
  expect(app).toMatchObject({
    type: row.type,
    interviewCompletedAt: completedAt,
    interviewDurationMin: 45,
  });
  return { id, first, app };
}

async function recordedState(id: string) {
  return {
    app: await db.tutorApplication.findUniqueOrThrow({
      where: { id },
      include: {
        interviewers: { orderBy: { tutorId: "asc" } },
        votes: { orderBy: { tutorId: "asc" } },
      },
    }),
    credits: await credits(),
    sources: await db.auditLog.findMany({
      where: {
        entity: "TutorApplication",
        entityId: id,
        OR: [
          {
            details: {
              path: ["effects", "interviewServiceVersion"],
              equals: 1,
            },
          },
          { details: { path: ["effects", "panelRepairVersion"], equals: 1 } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    proposals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    grants: await db.qualificationGrant.findMany({
      orderBy: [
        { tutorId: "asc" },
        { sourceSubjectId: "asc" },
        { subjectId: "asc" },
      ],
    }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
  };
}

it.each(
  recordedReviewCases.flatMap((row) =>
    (["missing", "stale"] as const).map((version) => ({ ...row, version })),
  ),
)(
  "$label recorded changes refuse a $version version before direct writes or Coordinator admission",
  async (row) => {
    const { id } = await recordedReview(row);
    const input = {
      applicationId: id,
      completedAt: new Date("2026-10-15T04:00:37.456Z"),
      durationMin: 60,
      attendedTutorIds: ["old-qualified-tutor"],
      reason: "Synthetic changed recorded service requires review ownership",
      ...(row.version === "stale" ? { expectedUpdatedAt: new Date(0) } : {}),
    };
    const before = await recordedState(id);
    for (const actor of [
      "head",
      row.repaired ? "new-chair" : "old-chair",
      "coordinator",
    ])
      await expect(
        caller(actor).interviewManagement.complete(input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await recordedState(id)).toEqual(before);
    expect(await db.approvalRequest.count()).toBe(0);
  },
);

it.each(recordedReviewCases)(
  "$label first completion and exact Head/Admin/Coordinator receipts preserve their version exceptions",
  async (row) => {
    const { id, first, app } = await recordedReview(row);
    const before = await recordedState(id);
    for (const actor of [
      "head",
      row.repaired ? "new-chair" : "old-chair",
      "coordinator",
    ])
      for (const version of ["missing", "current", "stale"] as const)
        await expect(
          caller(actor).interviewManagement.complete({
            ...first,
            ...(version === "missing"
              ? {}
              : {
                  expectedUpdatedAt:
                    version === "current" ? app.updatedAt : new Date(0),
                }),
          }),
        ).resolves.toEqual({ ok: true });
    expect(await recordedState(id)).toEqual(before);
    expect(await db.approvalRequest.count()).toBe(0);
  },
);
