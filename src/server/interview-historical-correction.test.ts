import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { Any, ArrayContaining, ObjectContaining } from "@vitest/expect";
import type { Session } from "next-auth";
import superjson from "superjson";
import type { Prisma } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification } from "~/server/qualifications";
import {
  interviewHoursId,
  INTERVIEW_HOURS_REASON,
  isAppliedInterviewCompletion,
} from "~/server/interview-hours";
import { lockUsernameNamespace } from "~/server/auth/username";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { databaseScope } from "~/server/db-scope";
import { lockApplicationReview } from "~/server/request-invalidity";

const originalPanel = [
  "old-chair",
  "old-qualified",
  "old-member",
  "old-missed",
];
const currentPanel = ["new-chair", "new-qualified", "new-member"];
const originallyAttended = ["old-chair-tutor", "old-qualified-tutor"];
const completedAt = new Date("2026-09-15T04:00:37.456Z");
const correctedAt = new Date("2026-10-20T05:00:12.345Z");
const tutorIds = (ids: string[]) => ids.map((id) => `${id}-tutor`);
const caller = (id = "head") =>
  createCaller({
    db,
    headers: new Headers(),
    // Claims deliberately disagree with persisted roles and tutor links.
    session: {
      user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
      role: "HEAD" as Session["role"],
      tutorId: "stale-link",
      expires: "2099-01-01",
    },
  });

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
      id: "historical-q1",
      name: "Synthetic recorded quarter",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["applicant", "TUTOR"],
    ["head", "HEAD"],
    ["coordinator", "COORDINATOR"],
    ["old-chair", "ADMIN"],
    ["old-qualified", "TUTOR"],
    ["old-member", "TUTOR"],
    ["old-missed", "TUTOR"],
    ["new-chair", "ADMIN"],
    ["new-qualified", "TUTOR"],
    ["new-member", "TUTOR"],
    ["unrelated", "TUTOR"],
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
  for (const [id, role] of [
    ["observer", "VIEWER"],
    ["student", "STUDENT"],
    ["crew", "CREW"],
  ] as const)
    await db.user.create({
      data: { id, role, username: id, email: `${id}@example.test` },
    });
  await db.subject.create({
    data: { id: "historical-subject", name: "Synthetic History" },
  });
  for (const id of ["old-qualified", "new-qualified"])
    await db.$transaction((tx) =>
      approveQualification(tx, `${id}-tutor`, "historical-subject", "head"),
    );
});

afterAll(() => db.$disconnect());

async function application(id: string) {
  return db.tutorApplication.findUniqueOrThrow({
    where: { id },
    include: {
      interviewers: { orderBy: { tutorId: "asc" } },
      votes: { orderBy: { tutorId: "asc" } },
    },
  });
}

async function vote(id: string, panel = currentPanel) {
  for (const person of panel)
    await caller(person).tutor.castInterviewVote({
      applicationId: id,
      accept: true,
      comment: "Synthetic reviewed evidence",
    });
}

async function stage() {
  const { id } = await caller("applicant").qualificationApplication.submit({
    subjectId: "historical-subject",
    reason: "Synthetic additional qualification",
  });
  await caller().admin.assignInterviewers({
    applicationId: id,
    tutorIds: tutorIds(originalPanel),
    headTutorId: "old-chair-tutor",
    expectedUpdatedAt: (await application(id)).updatedAt,
  });
  await vote(id, originalPanel);
  await caller().interviewManagement.complete({
    applicationId: id,
    completedAt,
    durationMin: 30,
    attendedTutorIds: originallyAttended,
    reason: "Synthetic first physical interview",
    expectedUpdatedAt: (await application(id)).updatedAt,
  });
  // Every historical candidate is now inactive. New voting membership supplies
  // decision authority but cannot manufacture attendance at the earlier event.
  await db.tutor.updateMany({
    where: { id: { in: tutorIds(originalPanel) } },
    data: { status: "OPTED_OUT" },
  });
  await caller().admin.assignInterviewers({
    applicationId: id,
    tutorIds: tutorIds(currentPanel),
    headTutorId: "new-chair-tutor",
    expectedUpdatedAt: (await application(id)).updatedAt,
    repairReason: "Synthetic full panel lifecycle replacement",
  });
  await vote(id);
  return application(id);
}

async function correction(id: string) {
  return {
    applicationId: id,
    completedAt: correctedAt,
    durationMin: 60,
    // Add an originally assigned but previously missed attendee, remove another.
    attendedTutorIds: ["old-chair-tutor", "old-missed-tutor"],
    reason: "Synthetic corrected duration, date and original attendance",
    expectedUpdatedAt: (await application(id)).updatedAt,
  };
}

async function state(id: string) {
  return {
    application: await application(id),
    credits: await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    }),
    grants: await db.qualificationGrant.findMany({
      orderBy: [
        { tutorId: "asc" },
        { sourceSubjectId: "asc" },
        { subjectId: "asc" },
      ],
    }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
    proposals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
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
  };
}

async function managementRecord(id: string) {
  const row = await caller().interviewManagement.completionEvidence({
    applicationId: id,
  });
  expect(row.id).toBe(id);
  return row;
}

function sourceRevision(sources: Awaited<ReturnType<typeof state>>["sources"]) {
  return sources.reduce((maximum, source) => {
    const details = source.details as {
      effects?: { sourceRevision?: number };
    } | null;
    return Math.max(maximum, details?.effects?.sourceRevision ?? 0);
  }, 0);
}

it("corrects historical date, duration and original attendees after the entire voting panel is replaced", async () => {
  const app = await stage();
  await db.term.update({
    where: { id: "historical-q1" },
    data: { active: false },
  });
  await db.term.create({
    data: {
      name: "Synthetic later active quarter",
      schoolYear: "27-28",
      quarter: "Q2",
      active: true,
    },
  });
  const manual = await db.serviceHourAdjustment.create({
    data: {
      id: `interview_${app.id}_manual_note`,
      tutorId: "old-qualified-tutor",
      type: "EXTRA",
      reason: "Synthetic unrelated manual hours",
      amount: 1.25,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
    },
  });
  const input = await correction(app.id);
  await expect(caller().interviewManagement.complete(input)).resolves.toEqual({
    ok: true,
  });
  const after = await state(app.id);
  expect(after.application).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: correctedAt,
    interviewDurationMin: 60,
    interviewSchoolYear: "26-27",
    interviewQuarter: "Q1",
  });
  expect(after.application.interviewers).toEqual(app.interviewers);
  expect(after.application.votes).toEqual(app.votes);
  expect(
    after.application.interviewers.every((person) => !person.attended),
  ).toBe(true);
  expect(after.credits.find((row) => row.id === manual.id)).toEqual(manual);
  expect(after.credits.filter((row) => row.id !== manual.id)).toEqual(
    new ArrayContaining(
      input.attendedTutorIds.map(
        (tutorId) =>
          new ObjectContaining({
            id: interviewHoursId(app.id, tutorId),
            tutorId,
            amount: 1,
            month: "2026-10",
            schoolYear: "26-27",
            quarter: "Q1",
            type: "EXTRA",
            reason: INTERVIEW_HOURS_REASON,
          }),
      ),
    ),
  );
  expect(after.credits).toHaveLength(3);
  const source = [...after.sources]
    .reverse()
    .find(
      (item) =>
        (item.details as { effects?: { interviewServiceVersion?: number } })
          ?.effects?.interviewServiceVersion === 1,
    );
  expect(source?.details).toMatchObject({
    effects: {
      interviewServiceVersion: 1,
      eligibleTutorIds: new ArrayContaining(tutorIds(originalPanel)),
      completion: {
        completedAt: correctedAt.toISOString(),
        durationMin: 60,
        schoolYear: "26-27",
        quarter: "Q1",
      },
      credits: new ArrayContaining(
        input.attendedTutorIds.map(
          (tutorId) =>
            new ObjectContaining({
              id: interviewHoursId(app.id, tutorId),
              tutorId,
              amount: 1,
            }),
        ),
      ),
    },
  });
  // Approval must adopt the legitimate corrected receipt, not the older repair's
  // duration/credits, and still belongs to the current assigned chair.
  await expect(
    caller("new-chair").qualificationApplication.decide({
      id: app.id,
      accept: true,
      comment: "Synthetic corrected-source approval",
      expectedUpdatedAt: after.application.updatedAt,
      retainRecordedService: true,
      completion: {
        completedAt: correctedAt,
        durationMin: 60,
        attendedTutorIds: [],
      },
    }),
  ).resolves.toEqual({ ok: true });
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(after.credits);
  expect(
    await db.qualificationGrant.count({
      where: { tutorId: "applicant-tutor", subjectId: "historical-subject" },
    }),
  ).toBe(1);
  expect(await db.registrationCode.count()).toBe(0);
});

it("projects actual historical credit and frozen attendance candidates without exposing private account fields", async () => {
  const app = await stage();
  const record = await managementRecord(app.id);
  expect(record.completionParticipants).toHaveLength(originalPanel.length);
  for (const id of originalPanel) {
    const attended = originallyAttended.includes(`${id}-tutor`);
    const participant = record.completionParticipants.find(
      (item) => item.tutorId === `${id}-tutor`,
    );
    expect(participant).toEqual({
      tutorId: `${id}-tutor`,
      tutor: { englishName: `Synthetic ${id}`, status: "OPTED_OUT" },
      attended,
      creditHours: attended ? 0.5 : 0,
      currentPanel: false,
    });
  }
  expect(
    record.completionParticipants.some((item) =>
      tutorIds(currentPanel).includes(item.tutorId),
    ),
  ).toBe(false);
  const read = await caller("new-chair").tutor.myInterviews();
  const own = read.find((item) => item.id === app.id);
  expect(own?.myAwardedHours).toBe(0);
  expect(own).not.toHaveProperty("completionParticipants");
  expect(own).not.toHaveProperty("credits");
  for (const actor of ["head", "new-chair", "coordinator"])
    expect(
      (
        await caller(actor).interviewManagement.completionEvidence({
          applicationId: app.id,
        })
      ).completionParticipants,
    ).toEqual(record.completionParticipants);
});

it("keeps a nameless original participant identifiable in the attendance review", async () => {
  const app = await stage();
  await db.tutor.update({
    where: { id: "old-missed-tutor" },
    data: { englishName: "  " },
  });
  const before = await state(app.id);
  const record = await managementRecord(app.id);
  // The linked account's public username is the materialized display fallback;
  // its immutable participant ID and recorded service remain independently exact.
  expect(
    record.completionParticipants.find(
      (person) => person.tutorId === "old-missed-tutor",
    ),
  ).toEqual({
    tutorId: "old-missed-tutor",
    tutor: { englishName: "old-missed", status: "OPTED_OUT" },
    attended: false,
    creditHours: 0,
    currentPanel: false,
  });
  expect(await state(app.id)).toEqual(before);
});

it.each(["observer", "student", "crew", "unrelated", "departed tutor"])(
  "denies %s access to counted historical service evidence",
  async (scenario) => {
    const app = await stage();
    let actor = scenario;
    if (scenario === "departed tutor") {
      actor = "unrelated";
      await db.schoolDeparture.create({
        data: {
          userId: actor,
          reason: "TRANSFERRED",
          effectiveAt: new Date(),
          source: "Synthetic staff-reviewed departure",
          tutorDerived: true,
        },
      });
    }
    await expect(
      caller(actor).interviewManagement.completionEvidence({
        applicationId: app.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = await state(app.id);
    // Source-aware version classification stays behind the existing management
    // role boundary, including missing-token requests from read-only observers.
    await expect(
      caller(actor).interviewManagement.complete({
        applicationId: app.id,
        completedAt: correctedAt,
        durationMin: 60,
        attendedTutorIds: ["old-chair-tutor", "old-missed-tutor"],
        reason: "Synthetic unauthorized missing-version correction",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await state(app.id)).toEqual(before);
  },
);

it("retains independently granted management read access after school departure", async () => {
  const app = await stage();
  await db.schoolDeparture.create({
    data: {
      userId: "old-chair",
      reason: "TRANSFERRED",
      effectiveAt: new Date(),
      source: "Synthetic staff-reviewed departure",
      tutorDerived: true,
    },
  });
  const record = await caller(
    "old-chair",
  ).interviewManagement.completionEvidence({ applicationId: app.id });
  expect(record.completionParticipants).toHaveLength(originalPanel.length);
});

it.each(["new-chair-tutor", "unrelated-tutor"])(
  "rejects historical attendance for %s outside the physical panel",
  async (tutorId) => {
    const app = await stage();
    const before = await state(app.id);
    await expect(
      caller().interviewManagement.complete({
        ...(await correction(app.id)),
        attendedTutorIds: [tutorId],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await state(app.id)).toEqual(before);
  },
);

it("keeps a corrected full-ledger receipt read-only for Admin and Coordinator despite a stale optimistic token", async () => {
  const app = await stage();
  const input = await correction(app.id);
  await caller().interviewManagement.complete(input);
  expect(await isAppliedInterviewCompletion(db, input)).toBe(true);
  const before = await state(app.id);
  for (const actor of ["head", "coordinator"])
    await expect(
      caller(actor).interviewManagement.complete(input),
    ).resolves.toEqual({ ok: true });
  expect(await state(app.id)).toEqual(before);
  expect(await db.approvalRequest.count()).toBe(0);
});

it("does not let an omitted version overwrite another manager's newer historical correction", async () => {
  const app = await stage();
  // Staff A opens the actual source-backed editor before staff B corrects it.
  const staffA = await managementRecord(app.id);
  expect(staffA).toMatchObject({
    interviewCompletedAt: completedAt,
    interviewDurationMin: 30,
  });
  const staffAChange = {
    applicationId: app.id,
    completedAt,
    durationMin: 45,
    attendedTutorIds: ["old-qualified-tutor", "old-member-tutor"],
    reason: "Synthetic staff A change from the earlier reviewed interview",
  };

  const staffBChange = await correction(app.id);
  await caller("new-chair").interviewManagement.complete(staffBChange);
  const staffBApplied = await state(app.id);
  expect(staffBApplied.application).toMatchObject({
    interviewCompletedAt: correctedAt,
    interviewDurationMin: 60,
  });
  // The captured old version normally protects B's newer complete ledger.
  await expect(
    caller().interviewManagement.complete({
      ...staffAChange,
      expectedUpdatedAt: staffA.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await state(app.id)).toEqual(staffBApplied);

  // Dropping the token must not turn the same stale review into authority to
  // overwrite B. Soft assertions retain all source/attendance effects if it does.
  const result: unknown = await caller()
    .interviewManagement.complete(staffAChange)
    .catch((error: unknown) => error);
  expect.soft(result).toMatchObject({ code: "CONFLICT" });
  expect.soft(await state(app.id)).toEqual(staffBApplied);
});

it("rejects an omitted version before admitting a Coordinator's changed historical correction", async () => {
  const app = await stage();
  // The Coordinator reviewed this earlier source, before another manager saved.
  const reviewed = await managementRecord(app.id);
  expect(reviewed.interviewDurationMin).toBe(30);
  const changedWithoutVersion = {
    applicationId: app.id,
    completedAt,
    durationMin: 45,
    attendedTutorIds: ["old-qualified-tutor", "old-member-tutor"],
    reason: "Synthetic Coordinator correction from an earlier reviewed source",
  };
  await caller("new-chair").interviewManagement.complete(
    await correction(app.id),
  );
  const before = await state(app.id);
  expect(before.proposals).toEqual([]);

  // Refusing only in the eventual resolver would admit an unreviewable proposal
  // and send notices. Admission must preserve the entire winning source state.
  const result: unknown = await caller("coordinator")
    .interviewManagement.complete(changedWithoutVersion)
    .catch((error: unknown) => error);
  expect.soft(result).toMatchObject({ code: "CONFLICT" });
  expect.soft(await state(app.id)).toEqual(before);
  expect.soft(await db.approvalRequest.count()).toBe(0);
});

it.each(["head", "new-chair", "coordinator"] as const)(
  "keeps an omitted-version exact full-ledger receipt read-only for %s",
  async (actor) => {
    const app = await stage();
    const input = await correction(app.id);
    await caller("new-chair").interviewManagement.complete(input);
    const receipt = {
      applicationId: app.id,
      completedAt: input.completedAt,
      durationMin: input.durationMin,
      attendedTutorIds: input.attendedTutorIds,
      reason: "Synthetic read-only recovery of the exact recorded source",
    };
    expect(await isAppliedInterviewCompletion(db, receipt)).toBe(true);
    const before = await state(app.id);
    await expect(
      caller(actor).interviewManagement.complete(receipt),
    ).resolves.toEqual({ ok: true });
    expect(await state(app.id)).toEqual(before);
    expect(await db.approvalRequest.count()).toBe(0);
  },
);

it("queues a Coordinator's changed historical correction without mutating service", async () => {
  const app = await stage();
  const input = await correction(app.id);
  const before = await state(app.id);
  await expect(
    caller("coordinator").interviewManagement.complete(input),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const after = await state(app.id);
  expect(after.credits).toEqual(before.credits);
  expect(after.application).toEqual(before.application);
  expect(after.sources).toEqual(before.sources);
  expect(after.proposals).toHaveLength(1);
  expect(after.proposals[0]).toMatchObject({
    operation: "interviewManagement.complete",
    state: "PENDING",
  });
  // This recipient is removed by the correction and is absent from both its
  // submitted attendee IDs and the new voting panel. Review still owns the
  // recipient's before identity and exact source credit.
  expect(after.proposals[0]?.targets).toMatchObject({
    Tutor: new ArrayContaining([
      new ObjectContaining({
        record: new ObjectContaining({ id: "old-qualified-tutor" }),
      }),
    ]),
    "Tutor.ServiceHourAdjustment": new ArrayContaining([
      new ObjectContaining({
        record: new ObjectContaining({
          id: interviewHoursId(app.id, "old-qualified-tutor"),
          tutorId: "old-qualified-tutor",
          amount: 0.5,
        }),
      }),
    ]),
  });
});

it("refuses approval of an already-pending legacy recorded correction that omitted its reviewed version", async () => {
  const app = await stage();
  const input = await correction(app.id);
  await expect(
    caller("coordinator").interviewManagement.complete(input),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const authentic = await db.approvalRequest.findFirstOrThrow({
    where: {
      requesterId: "coordinator",
      operation: "interviewManagement.complete",
      state: "PENDING",
    },
  });
  const reviewedPayload = superjson.deserialize<Record<string, unknown>>(
    authentic.payload as unknown as Parameters<typeof superjson.deserialize>[0],
  );
  const { expectedUpdatedAt, ...legacyPayload } = reviewedPayload;
  expect(expectedUpdatedAt).toEqual(input.expectedUpdatedAt);
  // Model a request admitted before the recorded-version guard was deployed.
  // Insert its frozen legacy shape from authentic current source/authority
  // evidence; never rewrite the existing proposal or alter service provenance.
  const legacy = await db.approvalRequest.create({
    data: {
      requesterId: authentic.requesterId,
      requesterName: authentic.requesterName,
      operation: authentic.operation,
      fingerprint: authentic.fingerprint,
      targets: authentic.targets as Prisma.InputJsonValue,
      payload: superjson.serialize(
        legacyPayload,
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  expect(
    superjson.deserialize<Record<string, unknown>>(
      legacy.payload as unknown as Parameters<typeof superjson.deserialize>[0],
    ),
  ).not.toHaveProperty("expectedUpdatedAt");
  const before = await state(app.id);
  expect(before.proposals).toHaveLength(2);
  expect(before.proposals.every((request) => request.state === "PENDING")).toBe(
    true,
  );
  await expect(
    caller().approval.decide({
      id: legacy.id,
      approve: true,
      note: "Synthetic review of retained pre-upgrade correction",
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "This changed since you loaded it — refresh and try again.",
  });
  expect(await state(app.id)).toEqual(before);
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: legacy.id } }),
  ).toEqual(legacy);
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: authentic.id } }),
  ).toEqual(authentic);
});

it.each(["stale", "nonmanagement", "suspended"] as const)(
  "refuses a %s historical correction atomically",
  async (scenario) => {
    const app = await stage();
    let actor = "head";
    if (scenario === "nonmanagement") actor = "unrelated";
    if (scenario === "suspended")
      await db.user.update({
        where: { id: "head" },
        data: { suspendedAt: new Date() },
      });
    const input = await correction(app.id);
    const before = await state(app.id);
    await expect(
      caller(actor).interviewManagement.complete({
        ...input,
        ...(scenario === "stale" ? { expectedUpdatedAt: new Date(0) } : {}),
      }),
    ).rejects.toMatchObject({
      code: scenario === "stale" ? "CONFLICT" : "FORBIDDEN",
    });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each(["missing", "wrong owner", "manual collision"] as const)(
  "refuses %s historical source evidence without treating it as an applied receipt",
  async (scenario) => {
    const app = await stage();
    const sourceId = interviewHoursId(app.id, "old-chair-tutor");
    if (scenario === "missing")
      await db.serviceHourAdjustment.delete({ where: { id: sourceId } });
    if (scenario === "wrong owner")
      await db.serviceHourAdjustment.update({
        where: { id: sourceId },
        data: { tutorId: "unrelated-tutor" },
      });
    if (scenario === "manual collision")
      await db.serviceHourAdjustment.update({
        where: { id: sourceId },
        data: { reason: "Synthetic unrelated manual award" },
      });
    const unchanged = {
      applicationId: app.id,
      completedAt,
      durationMin: 30,
      attendedTutorIds: originallyAttended,
      reason: "Synthetic corrupt exact receipt attempt",
      expectedUpdatedAt: app.updatedAt,
    };
    const before = await state(app.id);
    await expect(isAppliedInterviewCompletion(db, unchanged)).resolves.toBe(
      false,
    );
    await expect(
      caller("coordinator").interviewManagement.complete(unchanged),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller().interviewManagement.complete(await correction(app.id)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller().interviewManagement.completionEvidence({
        applicationId: app.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Metadata history remains readable even though counted service is untrustworthy.
    const history = await caller().interviewManagement.options({
      applicationId: app.id,
      completion: "ALL",
    });
    expect(history.applications.rows[0]).toMatchObject({ id: app.id });
    expect(history.applications.rows[0]).not.toHaveProperty(
      "completionParticipants",
    );
    expect(await state(app.id)).toEqual(before);
  },
);

it("carries the latest corrected source through another panel repair without widening physical attendee eligibility", async () => {
  const app = await stage();
  const originalRevision = sourceRevision((await state(app.id)).sources);
  await caller().interviewManagement.complete(await correction(app.id));
  const corrected = await state(app.id);
  const correctedRevision = sourceRevision(corrected.sources);
  expect(correctedRevision).toBeGreaterThan(originalRevision);
  const secondPanel = ["new-chair", "new-qualified", "unrelated"];
  await caller().admin.assignInterviewers({
    applicationId: app.id,
    tutorIds: tutorIds(secondPanel),
    headTutorId: "new-chair-tutor",
    repairReason: "Synthetic second post-correction panel change",
    expectedUpdatedAt: corrected.application.updatedAt,
  });
  const repaired = await application(app.id);
  const repairedState = await state(app.id);
  expect(sourceRevision(repairedState.sources)).toBe(correctedRevision);
  const repairSource = repairedState.sources.find(
    (source) =>
      (source.details as { reason?: string } | null)?.reason ===
      "Synthetic second post-correction panel change",
  );
  expect(repairSource?.details).toMatchObject({
    effects: {
      retainedService: {
        sourceRevision: correctedRevision,
        eligibleTutorIds: new ArrayContaining(tutorIds(originalPanel)),
        completedAt: correctedAt.toISOString(),
        durationMin: 60,
        credits: new ArrayContaining(
          corrected.credits.map(
            (credit) =>
              new ObjectContaining({
                id: credit.id,
                tutorId: credit.tutorId,
                amount: credit.amount,
              }),
          ),
        ),
      },
    },
  });
  expect(repaired.interviewers.every((item) => !item.attended)).toBe(true);
  expect(repaired.votes).toEqual([]);
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(corrected.credits);
  const row = await managementRecord(app.id);
  expect(row.completionParticipants.map((item) => item.tutorId).sort()).toEqual(
    tutorIds(originalPanel).sort(),
  );
  await vote(app.id, secondPanel);
  await expect(
    caller("new-chair").qualificationApplication.decide({
      id: app.id,
      accept: true,
      comment: "Synthetic latest corrected service retained",
      expectedUpdatedAt: (await application(app.id)).updatedAt,
      retainRecordedService: true,
      completion: {
        completedAt: correctedAt,
        durationMin: 60,
        attendedTutorIds: [],
      },
    }),
  ).resolves.toEqual({ ok: true });
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(corrected.credits);
});

it("cannot replace current chair authority with historical service ownership", async () => {
  const app = await stage();
  await caller().interviewManagement.complete(await correction(app.id));
  await db.user.update({
    where: { id: "new-chair" },
    data: { role: "COORDINATOR" },
  });
  const before = await state(app.id);
  await expect(
    caller("new-chair").qualificationApplication.decide({
      id: app.id,
      accept: true,
      comment: "Synthetic former authority must not decide",
      expectedUpdatedAt: before.application.updatedAt,
      retainRecordedService: true,
      completion: {
        completedAt: correctedAt,
        durationMin: 60,
        attendedTutorIds: [],
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await state(app.id)).toEqual(before);
});

it("rechecks persisted Admin authority after a historical correction waits on the namespace fence", async () => {
  const app = await stage();
  const input = await correction(app.id);
  const before = await state(app.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "new-chair" } }),
  ).toMatchObject({ role: "ADMIN", suspendedAt: null });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const blocker = db.$transaction(
    async (tx) => {
      await lockUsernameNamespace(tx);
      const [backend] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      ready(backend!.pid);
      await gate;
      // Publish the loss of authority only after the caller has read its old Admin
      // role and is demonstrably waiting behind this exact test-owned barrier.
      await tx.user.update({
        where: { id: "new-chair" },
        data: {
          role: "TUTOR",
          suspendedAt: new Date(),
        },
      });
    },
    { timeout: 10000 },
  );
  let correcting:
    | Promise<
        | { status: "fulfilled"; value: unknown }
        | { status: "rejected"; reason: unknown }
      >
    | undefined;
  let observedWait = false;
  try {
    const blockerPid = await Promise.race([
      locked,
      blocker.then(() => {
        throw new Error("Namespace blocker finished before its release gate");
      }),
    ]);
    // Consume rejection immediately while polling its lock, so cleanup never
    // leaves an unhandled RPC or a competing transaction for the next fixture.
    correcting = caller("new-chair")
      .interviewManagement.complete(input)
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    await vi.waitUntil(
      async () => {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND wait_event = 'advisory'
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))
          AND query LIKE '%pg_advisory_xact_lock%'
      ) AS waiting`;
        observedWait = row?.waiting === true;
        return observedWait;
      },
      { timeout: 3000, interval: 25 },
    );
  } finally {
    release();
    const [blockerResult] = await Promise.allSettled([blocker, correcting]);
    if (blockerResult.status === "rejected") throw blockerResult.reason;
  }
  expect(observedWait).toBe(true);
  const result = await correcting;
  expect(result?.status).toBe("rejected");
  if (result?.status !== "rejected")
    throw new Error("Correction unexpectedly retained stale Admin authority");
  const code = (result.reason as { code?: string } | null)?.code;
  expect(
    code === "FORBIDDEN" ||
      code === "CONFLICT" ||
      isSerializationFailure(result.reason),
  ).toBe(true);
  expect(await state(app.id)).toEqual(before);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "new-chair" } }),
  ).toMatchObject({ role: "TUTOR", suspendedAt: new Any(Date) });
}, 15000);

it.each([{ label: "different" }, { label: "identical" }])(
  "rechecks a waiting Coordinator correction proposal against the $label winning source before admission",
  async ({ label }) => {
    const app = await stage();
    const reviewed = await managementRecord(app.id);
    const winningInput = await correction(app.id);
    const proposed =
      label === "identical"
        ? winningInput
        : {
            applicationId: app.id,
            completedAt,
            durationMin: 45,
            attendedTutorIds: ["old-qualified-tutor", "old-member-tutor"],
            reason:
              "Synthetic waiting Coordinator correction from its captured review",
            expectedUpdatedAt: reviewed.updatedAt,
          };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      ready = resolve;
    });
    let winning: Awaited<ReturnType<typeof state>> | undefined;
    const blocker = db.$transaction(
      async (tx) => {
        await lockUsernameNamespace(tx);
        await lockApplicationReview(tx, app.id);
        const [backend] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        ready(backend!.pid);
        await gate;
        await databaseScope.run(tx, async () => {
          // Use the real reviewed writer while retaining the correct N→app fences.
          await caller().interviewManagement.complete(winningInput);
          winning = await state(app.id);
        });
      },
      { timeout: 10000 },
    );
    let proposing: Promise<unknown> | undefined;
    let observedWait = false;
    try {
      const blockerPid = await Promise.race([
        locked,
        blocker.then(() => {
          throw new Error(
            "Correction blocker completed before its release gate",
          );
        }),
      ]);
      proposing = caller("coordinator")
        .interviewManagement.complete(proposed)
        .then(
          (value) => ({ status: "fulfilled", value }),
          (reason: unknown) => ({ status: "rejected", reason }),
        );
      await vi.waitUntil(
        async () => {
          const [row] = await db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
            AND ${blockerPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%pg_advisory_xact_lock%'
        ) AS waiting`;
          observedWait = row?.waiting === true;
          return observedWait;
        },
        { timeout: 3000, interval: 25 },
      );
    } finally {
      release();
      const [blockerResult] = await Promise.allSettled([blocker, proposing]);
      if (blockerResult.status === "rejected") throw blockerResult.reason;
    }
    expect(observedWait).toBe(true);
    expect(await proposing).toMatchObject({
      status: "rejected",
      reason: { code: "CONFLICT" },
    });
    expect(winning).toBeDefined();
    expect(await state(app.id)).toEqual(winning);
    expect(await db.approvalRequest.count()).toBe(0);
    if (label === "identical") {
      // A queued intent is never silently converted into execution. A new exact
      // retry follows the ordinary read-only receipt path after the conflict.
      await expect(
        caller("coordinator").interviewManagement.complete(proposed),
      ).resolves.toEqual({ ok: true });
      expect(await state(app.id)).toEqual(winning);
    }
  },
  15000,
);

it("corrects historical service after approval while keeping the final qualification decision immutable", async () => {
  const app = await stage();
  await caller("new-chair").qualificationApplication.decide({
    id: app.id,
    accept: true,
    comment: "Synthetic final qualification decision",
    expectedUpdatedAt: app.updatedAt,
    retainRecordedService: true,
    completion: { completedAt, durationMin: 30, attendedTutorIds: [] },
  });
  const accepted = await state(app.id);
  await expect(
    caller().interviewManagement.complete(await correction(app.id)),
  ).resolves.toEqual({ ok: true });
  const corrected = await state(app.id);
  expect(corrected.application).toMatchObject({
    status: "ACCEPTED",
    decisionComment: accepted.application.decisionComment,
    decidedAt: accepted.application.decidedAt,
    decidedByTutorId: accepted.application.decidedByTutorId,
    qualificationDecidedById: accepted.application.qualificationDecidedById,
    qualificationSnapshot: accepted.application.qualificationSnapshot,
    interviewCompletedAt: correctedAt,
    interviewDurationMin: 60,
  });
  expect(corrected.grants).toEqual(accepted.grants);
  expect(corrected.codes).toEqual(accepted.codes);
  expect(corrected.notices).toEqual(accepted.notices);
});
