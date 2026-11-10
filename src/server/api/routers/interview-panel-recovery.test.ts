import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { ArrayContaining, ObjectContaining } from "@vitest/expect";
import type { Session } from "next-auth";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { approveQualification } from "~/server/qualifications";
import { validatePanel } from "~/server/interviews";
import {
  interviewHoursId,
  INTERVIEW_HOURS_REASON,
} from "~/server/interview-hours";

const repairReason = "Synthetic panel repair after lifecycle change";
const originalPanel = [
  "recovery-chair-tutor",
  "recovery-qualified-tutor",
  "recovery-member-tutor",
];
const replacementPanel = [
  "recovery-head-tutor",
  "recovery-new-qualified-tutor",
  "recovery-spare-tutor",
];
const completedAt = new Date("2026-09-15T04:00:12.345Z");
const scheduledAt = new Date("2026-09-15T03:00:00Z");

// Session claims deliberately disagree with stored roles and tutor links. Repair
// authority must come from the live account, including the self-review boundary.
const caller = (id: string) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
      role: "HEAD" as Session["role"],
      tutorId: "deliberately-stale-link",
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
      name: "Synthetic Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["recovery-applicant", "TUTOR"],
    ["recovery-chair", "ADMIN"],
    ["recovery-head", "HEAD"],
    ["recovery-qualified", "TUTOR"],
    ["recovery-member", "TUTOR"],
    ["recovery-spare", "TUTOR"],
    ["recovery-new-qualified", "TUTOR"],
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
    data: { id: "recovery-history", name: "Synthetic History", rank: 0 },
  });
  await db.subjectLevel.createMany({
    data: [
      {
        id: "recovery-standard",
        name: "Synthetic Standard",
        prefix: "",
        rank: 0,
      },
      {
        id: "recovery-higher",
        name: "Synthetic Higher",
        prefix: "Higher",
        rank: 1,
      },
    ],
  });
  await db.subject.createMany({
    data: [
      {
        id: "recovery-lower-subject",
        name: "Synthetic Standard History",
        baseName: "Synthetic History",
        groupId: "recovery-history",
        levelId: "recovery-standard",
      },
      {
        id: "recovery-subject",
        name: "Synthetic Higher History",
        baseName: "Synthetic History",
        groupId: "recovery-history",
        levelId: "recovery-higher",
      },
    ],
  });
  for (const tutorId of [
    "recovery-qualified-tutor",
    "recovery-new-qualified-tutor",
  ])
    await db.$transaction((tx) =>
      approveQualification(tx, tutorId, "recovery-subject", "recovery-head"),
    );
});

afterAll(() => db.$disconnect());

it.each(["chair demotion", "nonchair opt-out"] as const)(
  "allows management to repair an additional qualification panel after %s",
  async (scenario) => {
    const { id } = await caller(
      "recovery-applicant",
    ).qualificationApplication.submit({
      subjectId: "recovery-subject",
      reason: "Synthetic documented recovery evidence",
    });
    const original = await db.tutorApplication.findUniqueOrThrow({
      where: { id },
    });
    await caller("recovery-head").admin.assignInterviewers({
      applicationId: id,
      tutorIds: [
        "recovery-chair-tutor",
        "recovery-qualified-tutor",
        "recovery-member-tutor",
      ],
      headTutorId: "recovery-chair-tutor",
      expectedUpdatedAt: original.updatedAt,
    });
    for (const voter of [
      "recovery-chair",
      "recovery-qualified",
      "recovery-member",
    ])
      await caller(voter).tutor.castInterviewVote({
        applicationId: id,
        accept: true,
      });
    if (scenario === "chair demotion")
      await db.user.update({
        where: { id: "recovery-chair" },
        data: { role: "COORDINATOR" },
      });
    else
      await db.tutor.update({
        where: { id: "recovery-member-tutor" },
        data: { status: "OPTED_OUT" },
      });

    const pending = await db.tutorApplication.findUniqueOrThrow({
      where: { id },
    });
    expect(pending).toMatchObject({
      type: "ADDITIONAL_SUBJECT",
      status: "INTERVIEW",
    });
    expect(await db.interviewVote.count({ where: { applicationId: id } })).toBe(
      3,
    );
    // This is a decision dead end, not merely a preference to edit the panel:
    // all votes exist, but neither outcome can be applied by the recorded chair.
    for (const accept of [true, false])
      await expect(
        caller("recovery-chair").qualificationApplication.decide({
          id,
          accept,
          comment: "Synthetic attempted outcome",
          expectedUpdatedAt: pending.updatedAt,
          ...(accept
            ? {
                completion: {
                  completedAt: new Date("2026-09-15T04:00:00Z"),
                  durationMin: 30,
                  attendedTutorIds: [
                    "recovery-chair-tutor",
                    "recovery-qualified-tutor",
                    "recovery-member-tutor",
                  ],
                },
              }
            : {}),
        }),
      ).rejects.toMatchObject({
        code: scenario === "chair demotion" ? "FORBIDDEN" : "BAD_REQUEST",
      });
    expect(
      await db.qualificationGrant.count({
        where: { tutorId: "recovery-applicant-tutor" },
      }),
    ).toBe(0);
    expect(await db.serviceHourAdjustment.count()).toBe(0);

    const tutorIds =
      scenario === "chair demotion"
        ? [
            "recovery-head-tutor",
            "recovery-qualified-tutor",
            "recovery-member-tutor",
          ]
        : [
            "recovery-chair-tutor",
            "recovery-qualified-tutor",
            "recovery-spare-tutor",
          ];
    const headTutorId =
      scenario === "chair demotion"
        ? "recovery-head-tutor"
        : "recovery-chair-tutor";
    // Prove the replacement itself satisfies current activity, chair and subject
    // requirements before exercising the actual management route.
    await db.$transaction((tx) => validatePanel(tx, id, tutorIds, headTutorId));
    // A lifecycle change cannot leave an otherwise open review impossible to
    // decide. Management must explicitly explain the repair.
    await expect(
      caller("recovery-head").admin.assignInterviewers({
        applicationId: id,
        tutorIds,
        headTutorId,
        expectedUpdatedAt: pending.updatedAt,
        repairReason,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await db.interviewVote.count({ where: { applicationId: id } })).toBe(
      0,
    );
    const audit = await db.auditLog.findFirst({
      where: {
        entityId: id,
        action: "Repaired open qualification interview panel",
      },
    });
    expect(audit).toMatchObject({
      userId: "recovery-head",
      operation: "admin.assignInterviewers",
    });
    expect(audit?.details).toMatchObject({
      reason: repairReason,
      effects: { panelRepairVersion: 1 },
    });
  },
);

async function application(id: string) {
  return db.tutorApplication.findUniqueOrThrow({
    where: { id },
    include: {
      interviewers: { orderBy: { tutorId: "asc" } },
      votes: { orderBy: { tutorId: "asc" } },
    },
  });
}

async function vote(id: string, tutorIds = originalPanel, accept = true) {
  for (const tutorId of tutorIds)
    await caller(tutorId.replace(/-tutor$/, "")).tutor.castInterviewVote({
      applicationId: id,
      accept,
      comment: `Synthetic deliberation from ${tutorId}`,
    });
}

async function openReview(higher = false) {
  if (higher)
    await db.$transaction((tx) =>
      approveQualification(
        tx,
        "recovery-applicant-tutor",
        "recovery-lower-subject",
        "recovery-head",
      ),
    );
  const { id } = await caller(
    "recovery-applicant",
  ).qualificationApplication.submit({
    subjectId: "recovery-subject",
    reason: "Synthetic open review evidence",
  });
  const before = await application(id);
  await caller("recovery-head").admin.assignInterviewers({
    applicationId: id,
    tutorIds: originalPanel,
    headTutorId: "recovery-chair-tutor",
    expectedUpdatedAt: before.updatedAt,
  });
  await vote(id);
  return application(id);
}

async function repairInput(id: string) {
  return {
    applicationId: id,
    tutorIds: replacementPanel,
    headTutorId: "recovery-head-tutor",
    expectedUpdatedAt: (await application(id)).updatedAt,
    repairReason,
  };
}

// Rejected attempts may have independent audit receipts. Domain sources and the
// explicit applied repair evidence must remain byte-for-byte unchanged.
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
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    proposals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    repairs: await db.auditLog.findMany({
      where: {
        entityId: id,
        action: "Repaired open qualification interview panel",
      },
      orderBy: { id: "asc" },
    }),
  };
}

async function completedReview(
  higher = false,
  attendedTutorIds = originalPanel,
) {
  const app = await openReview(higher);
  await caller("recovery-chair").tutor.setInterviewTime({
    applicationId: app.id,
    interviewAt: scheduledAt,
  });
  await caller("recovery-head").interviewManagement.complete({
    applicationId: app.id,
    completedAt,
    durationMin: 30,
    attendedTutorIds,
    reason: "Synthetic recorded service before panel lifecycle change",
    expectedUpdatedAt: (await application(app.id)).updatedAt,
  });
  return application(app.id);
}

it("repairs a higher-level review without changing its prior qualification source", async () => {
  const app = await openReview(true);
  expect(app.type).toBe("HIGHER_LEVEL");
  const grants = await db.qualificationGrant.findMany({
    where: { tutorId: app.requestedTutorId! },
  });
  await expect(
    caller("recovery-head").admin.assignInterviewers(await repairInput(app.id)),
  ).resolves.toEqual({ ok: true });
  expect((await application(app.id)).status).toBe("INTERVIEW");
  expect(
    await db.qualificationGrant.findMany({
      where: { tutorId: app.requestedTutorId! },
    }),
  ).toEqual(grants);
  expect(
    await db.interviewVote.count({ where: { applicationId: app.id } }),
  ).toBe(0);
});

it.each([
  "missing reason",
  "blank reason",
  "oversized reason",
  "stale version",
] as const)(
  "rejects %s without changing the open panel or its evidence",
  async (scenario) => {
    const app = await openReview();
    const input = await repairInput(app.id);
    const submission = {
      ...input,
      ...(scenario === "missing reason" ? { repairReason: undefined } : {}),
      ...(scenario === "blank reason" ? { repairReason: "  " } : {}),
      ...(scenario === "oversized reason"
        ? { repairReason: "x".repeat(1001) }
        : {}),
      ...(scenario === "stale version"
        ? { expectedUpdatedAt: new Date(0) }
        : {}),
    };
    const before = await state(app.id);
    await expect(
      caller("recovery-head").admin.assignInterviewers(submission),
    ).rejects.toMatchObject({
      code: scenario === "stale version" ? "CONFLICT" : "BAD_REQUEST",
    });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each(["self", "revoked self", "demoted", "suspended"] as const)(
  "requires a live independent management reviewer (%s)",
  async (scenario) => {
    const app = await openReview();
    const actorId = scenario.includes("self")
      ? "recovery-applicant"
      : "recovery-head";
    if (scenario.includes("self"))
      await db.user.update({
        where: { id: actorId },
        data: {
          role: "HEAD",
          tutorAccessRevoked: scenario === "revoked self",
        },
      });
    if (scenario === "demoted")
      await db.user.update({
        where: { id: actorId },
        data: { role: "COORDINATOR" },
      });
    if (scenario === "suspended")
      await db.user.update({
        where: { id: actorId },
        data: { suspendedAt: new Date() },
      });
    const before = await state(app.id);
    await expect(
      caller(actorId).admin.assignInterviewers(await repairInput(app.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each([
  "no qualification",
  "revoked member",
  "merged member",
  "nonstaff chair",
  "applicant panelist",
] as const)(
  "rejects an ineligible replacement panel (%s) atomically",
  async (scenario) => {
    const app = await openReview();
    const input = await repairInput(app.id);
    if (scenario === "no qualification")
      await db.tutorQualification.delete({
        where: {
          tutorId_subjectId: {
            tutorId: "recovery-new-qualified-tutor",
            subjectId: "recovery-subject",
          },
        },
      });
    if (scenario === "revoked member")
      await db.user.update({
        where: { id: "recovery-spare" },
        data: { tutorAccessRevoked: true },
      });
    if (scenario === "merged member")
      await db.user.update({
        where: { id: "recovery-spare" },
        data: { mergedIntoId: "recovery-qualified" },
      });
    const submission = {
      ...input,
      ...(scenario === "nonstaff chair"
        ? { headTutorId: "recovery-new-qualified-tutor" }
        : {}),
      ...(scenario === "applicant panelist"
        ? {
            tutorIds: [
              "recovery-head-tutor",
              "recovery-new-qualified-tutor",
              "recovery-applicant-tutor",
            ],
          }
        : {}),
    };
    const before = await state(app.id);
    await expect(
      caller("recovery-head").admin.assignInterviewers(submission),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each(["ACCEPTED", "REJECTED", "RECALLED"] as const)(
  "does not reopen %s qualification history even with an explicit repair reason",
  async (status) => {
    const app = await openReview();
    if (status === "RECALLED")
      await caller("recovery-applicant").qualificationApplication.recall({
        id: app.id,
        expectedUpdatedAt: app.updatedAt,
      });
    else {
      if (status === "REJECTED") await vote(app.id, originalPanel, false);
      await caller("recovery-chair").qualificationApplication.decide({
        id: app.id,
        accept: status === "ACCEPTED",
        comment: `Synthetic final ${status}`,
        expectedUpdatedAt: (await application(app.id)).updatedAt,
        ...(status === "ACCEPTED"
          ? {
              completion: {
                completedAt,
                durationMin: 30,
                attendedTutorIds: originalPanel,
              },
            }
          : {}),
      });
    }
    const before = await state(app.id);
    expect(before.application.status).toBe(status);
    await expect(
      caller("recovery-head").admin.assignInterviewers(
        await repairInput(app.id),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each([false, true])(
  "retains all historical service when every former attendee leaves the new panel (higher=%s)",
  async (higher) => {
    const app = await completedReview(higher);
    const originalCredits = await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    });
    // Similar prefixes are lookup candidates only; this is not source-owned service.
    const manual = await db.serviceHourAdjustment.create({
      data: {
        id: `interview_${app.id}_manual_note`,
        tutorId: "recovery-member-tutor",
        type: "EXTRA",
        amount: 1.25,
        month: "2026-09",
        schoolYear: "26-27",
        quarter: "Q1",
        reason: "Synthetic independent manual credit",
      },
    });
    for (const tutorId of originalPanel)
      await db.tutor.update({
        where: { id: tutorId },
        data: { status: "OPTED_OUT" },
      });
    await caller("recovery-head").admin.assignInterviewers(
      await repairInput(app.id),
    );
    const repaired = await application(app.id);
    expect(repaired).toMatchObject({
      status: "INTERVIEW",
      interviewAt: scheduledAt,
      interviewCompletedAt: completedAt,
      interviewDurationMin: 30,
      interviewSchoolYear: "26-27",
      interviewQuarter: "Q1",
    });
    expect(repaired.interviewers.every((person) => !person.attended)).toBe(
      true,
    );
    expect(repaired.votes).toEqual([]);
    expect(
      await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(
      [...originalCredits, manual].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        entityId: app.id,
        action: "Repaired open qualification interview panel",
      },
    });
    expect(audit.details).toMatchObject({
      reason: repairReason,
      effects: {
        panelRepairVersion: 1,
        previousPanel: new ArrayContaining(
          app.interviewers.map((person) => ({
            tutorId: person.tutorId,
            isHead: person.isHead,
            attended: true,
            assignedAt: person.createdAt.toISOString(),
          })),
        ),
        replacementPanel: new ArrayContaining(
          replacementPanel.map((tutorId) => ({
            tutorId,
            isHead: tutorId === "recovery-head-tutor",
            attended: false,
          })),
        ),
        supersededVotes: new ArrayContaining(
          app.votes.map((item) => ({
            tutorId: item.tutorId,
            accept: item.accept,
            comment: item.comment,
            createdAt: item.createdAt.toISOString(),
          })),
        ),
        retainedService: {
          completedAt: completedAt.toISOString(),
          durationMin: 30,
          schoolYear: "26-27",
          quarter: "Q1",
          scheduledAt: scheduledAt.toISOString(),
          credits: new ArrayContaining(
            originalCredits.map((row) => ({
              id: row.id,
              tutorId: row.tutorId,
              type: row.type,
              amount: row.amount,
              month: row.month,
              schoolYear: row.schoolYear,
              quarter: row.quarter,
              reason: row.reason,
            })),
          ),
        },
      },
    });
    const decision = {
      id: app.id,
      accept: true,
      comment: "Synthetic new panel approves retained interview evidence",
      expectedUpdatedAt: repaired.updatedAt,
      retainRecordedService: true as const,
      completion: {
        completedAt,
        durationMin: 30,
        attendedTutorIds: [] as string[],
      },
    };
    await expect(
      caller("recovery-head").qualificationApplication.decide(decision),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await application(app.id)).status).toBe("INTERVIEW");
    await vote(app.id, replacementPanel);
    const correctedAt = new Date("2026-10-15T04:00:12.345Z");
    await expect(
      caller("recovery-head").interviewManagement.complete({
        applicationId: app.id,
        completedAt: correctedAt,
        durationMin: 45,
        attendedTutorIds: originalPanel,
        expectedUpdatedAt: (await application(app.id)).updatedAt,
        reason: "Synthetic correction of actual historical service",
      }),
    ).resolves.toEqual({ ok: true });
    const correctedCredits = await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    });
    expect(correctedCredits.find((row) => row.id === manual.id)).toEqual(
      manual,
    );
    expect(correctedCredits.filter((row) => row.id !== manual.id)).toEqual(
      new ArrayContaining(
        originalCredits.map(
          (row) =>
            new ObjectContaining({
              id: row.id,
              tutorId: row.tutorId,
              amount: 0.75,
              month: "2026-10",
              schoolYear: "26-27",
              quarter: "Q1",
            }),
        ),
      ),
    );
    decision.completion = {
      completedAt: correctedAt,
      durationMin: 45,
      attendedTutorIds: [],
    };
    await expect(
      caller("recovery-head").qualificationApplication.decide({
        ...decision,
        expectedUpdatedAt: (await application(app.id)).updatedAt,
      }),
    ).resolves.toEqual({ ok: true });
    const accepted = await application(app.id);
    expect(accepted).toMatchObject({
      status: "ACCEPTED",
      interviewCompletedAt: correctedAt,
      interviewDurationMin: 45,
      interviewAt: scheduledAt,
    });
    expect(
      await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(correctedCredits);
    expect(
      await db.qualificationGrant.count({
        where: {
          tutorId: "recovery-applicant-tutor",
          subjectId: "recovery-subject",
        },
      }),
    ).toBe(1);
    expect(await db.registrationCode.count()).toBe(0);
    expect(
      await db.tutor.findUniqueOrThrow({
        where: { id: "recovery-applicant-tutor" },
      }),
    ).toMatchObject({ status: "ACTIVE" });
    const saved = await state(app.id);
    await expect(
      caller("recovery-head").qualificationApplication.decide({
        ...decision,
        expectedUpdatedAt: repaired.updatedAt,
      }),
    ).resolves.toEqual({ ok: true });
    expect(await state(app.id)).toEqual(saved);
  },
);

it("retains only actual original attendance and adds no service on a repaired rejection", async () => {
  const app = await completedReview(false, ["recovery-qualified-tutor"]);
  const credits = await db.serviceHourAdjustment.findMany({
    orderBy: { id: "asc" },
  });
  const tutorIds = [
    "recovery-chair-tutor",
    "recovery-qualified-tutor",
    "recovery-spare-tutor",
  ];
  await caller("recovery-head").admin.assignInterviewers({
    ...(await repairInput(app.id)),
    tutorIds,
    headTutorId: "recovery-chair-tutor",
  });
  const repaired = await application(app.id);
  expect(
    repaired.interviewers
      .filter((person) => person.attended)
      .map((person) => person.tutorId),
  ).toEqual(["recovery-qualified-tutor"]);
  await vote(app.id, tutorIds, false);
  await caller("recovery-chair").qualificationApplication.decide({
    id: app.id,
    accept: false,
    comment: "Synthetic repaired panel rejection",
    expectedUpdatedAt: (await application(app.id)).updatedAt,
  });
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(credits);
  expect(
    await db.qualificationGrant.count({
      where: { tutorId: "recovery-applicant-tutor" },
    }),
  ).toBe(0);
  expect(await application(app.id)).toMatchObject({
    status: "REJECTED",
    interviewCompletedAt: completedAt,
    interviewDurationMin: 30,
  });
});

it.each(["owner", "type", "reason"] as const)(
  "rolls back a repair whose exact service source has a corrupt %s",
  async (field) => {
    const app = await completedReview();
    await db.serviceHourAdjustment.update({
      where: { id: interviewHoursId(app.id, "recovery-chair-tutor") },
      data:
        field === "owner"
          ? { tutorId: "recovery-spare-tutor" }
          : field === "type"
            ? { type: "PUNISHMENT" }
            : { reason: "Synthetic unrelated adjustment occupying exact ID" },
    });
    const before = await state(app.id);
    await expect(
      caller("recovery-head").admin.assignInterviewers(
        await repairInput(app.id),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(app.id)).toEqual(before);
  },
);

it.each(["missing owner", "changed amount", "extra owner"] as const)(
  "does not approve retained service after its captured ledger changes (%s)",
  async (scenario) => {
    const app = await completedReview();
    await caller("recovery-head").admin.assignInterviewers(
      await repairInput(app.id),
    );
    await vote(app.id, replacementPanel);
    if (scenario === "missing owner")
      await db.serviceHourAdjustment.delete({
        where: { id: interviewHoursId(app.id, "recovery-chair-tutor") },
      });
    if (scenario === "changed amount")
      await db.serviceHourAdjustment.update({
        where: { id: interviewHoursId(app.id, "recovery-chair-tutor") },
        data: { amount: 0.75 },
      });
    if (scenario === "extra owner")
      await db.serviceHourAdjustment.create({
        data: {
          id: interviewHoursId(app.id, "recovery-spare-tutor"),
          tutorId: "recovery-spare-tutor",
          type: "EXTRA",
          reason: INTERVIEW_HOURS_REASON,
          amount: 0.5,
          month: "2026-09",
          schoolYear: "26-27",
          quarter: "Q1",
        },
      });
    const before = await state(app.id);
    await expect(
      caller("recovery-head").qualificationApplication.decide({
        id: app.id,
        accept: true,
        comment: "Synthetic retained ledger recheck",
        expectedUpdatedAt: before.application.updatedAt,
        retainRecordedService: true,
        completion: { completedAt, durationMin: 30, attendedTutorIds: [] },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(app.id)).toEqual(before);
  },
);

it("does not use an empty retained-service payload to record first interview hours", async () => {
  const app = await openReview();
  const before = await state(app.id);
  await expect(
    caller("recovery-chair").qualificationApplication.decide({
      id: app.id,
      accept: true,
      comment: "Synthetic missing prior service",
      expectedUpdatedAt: app.updatedAt,
      retainRecordedService: true,
      completion: { completedAt, durationMin: 30, attendedTutorIds: [] },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await state(app.id)).toEqual(before);
});

it("keeps the entire former-owner ledger across a second preserving panel repair", async () => {
  const app = await completedReview();
  const credits = await db.serviceHourAdjustment.findMany({
    orderBy: { id: "asc" },
  });
  await caller("recovery-head").admin.assignInterviewers(
    await repairInput(app.id),
  );
  await vote(app.id, replacementPanel);
  await caller("recovery-head").admin.assignInterviewers({
    ...(await repairInput(app.id)),
    repairReason: "Synthetic second panel repair",
  });
  const repaired = await application(app.id);
  expect(repaired.votes).toEqual([]);
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(credits);
  const audits = await db.auditLog.findMany({
    where: {
      entityId: app.id,
      action: "Repaired open qualification interview panel",
    },
  });
  expect(audits).toHaveLength(2);
  expect(
    audits.find(
      (item) =>
        (item.details as { reason?: string })?.reason ===
        "Synthetic second panel repair",
    )?.details,
  ).toMatchObject({
    effects: {
      retainedService: {
        credits: new ArrayContaining(
          credits.map(
            (row) =>
              new ObjectContaining({
                id: row.id,
                tutorId: row.tutorId,
                amount: row.amount,
              }),
          ),
        ),
      },
    },
  });
  await vote(app.id, replacementPanel);
  await expect(
    caller("recovery-head").qualificationApplication.decide({
      id: app.id,
      accept: true,
      comment: "Synthetic second repaired panel approval",
      expectedUpdatedAt: (await application(app.id)).updatedAt,
      retainRecordedService: true,
      completion: { completedAt, durationMin: 30, attendedTutorIds: [] },
    }),
  ).resolves.toEqual({ ok: true });
  expect(
    await db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(credits);
});
