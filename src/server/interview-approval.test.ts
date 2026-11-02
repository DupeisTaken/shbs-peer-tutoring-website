import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { Prisma } from "../../generated/prisma";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { fingerprint, queueProposal } from "~/server/approvals";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { interviewHoursId } from "~/server/interview-hours";
import { lockAccountProfile } from "~/server/account-profile";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import { reconcileApplication } from "~/server/tutors/application-status";
import { isSerializationFailure } from "~/server/auth/username-snapshot";

const session = (id = "chair"): Session => ({
  user: { id, name: `Synthetic ${id}`, email: `${id}@example.test` },
  role: "HEAD",
  tutorId: "forged-session-link",
  expires: "2099-01-01",
});
// Deliberately stale claims exercise current account role/link authorization.
const caller = (id = "chair") =>
  createCaller({ db, headers: new Headers(), session: session(id) });
const completedAt = new Date("2026-09-15T04:00:12.345Z");

/** Old requests retain their original Head-only authority as immutable evidence. */
async function legacyAcceptance(input: unknown) {
  const request = await queueProposal(session(), "tutor.decideInterview", input);
  const targets = request.targets as Record<string, Prisma.InputJsonValue>;
  delete targets.reviewPolicyVersion;
  targets.reviewAuthority = { category: "ACCOUNT_ACCESS", directRoles: ["HEAD"],
    requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  return db.approvalRequest.update({ where: { id: request.id },
    data: { targets, fingerprint: fingerprint(targets) } });
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
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
  await db.term.create({
    data: {
      name: "Approval Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["chair", "ADMIN"],
    ["head", "HEAD"],
    ["member", "TUTOR"],
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
        username: id,
        role,
        email: `${id}@example.test`,
        tutorId: `${id}-tutor`,
        emailVerifiedAt: new Date(),
      },
    });
  }
  await db.subject.create({
    data: { id: "subject", name: "Synthetic Mathematics" },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: "member-tutor",
      subjectId: "subject",
      approvedById: "head",
      grants: { create: { subjectId: "subject" } },
    },
  });
});
afterAll(() => db.$disconnect());

async function fixture() {
  const app = await db.tutorApplication.create({
    data: {
      name: "Synthetic Candidate",
      email: "candidate@example.test",
      status: "INTERVIEW",
      subjectIntents: { create: { subjectId: "subject" } },
      interviewers: {
        create: [
          { tutorId: "chair-tutor", isHead: true },
          { tutorId: "head-tutor" },
          { tutorId: "member-tutor" },
        ],
      },
      votes: {
        create: ["chair-tutor", "head-tutor", "member-tutor"].map(
          (tutorId) => ({ tutorId, accept: true, comment: "Reviewed" }),
        ),
      },
    },
  });
  const completion = {
    completedAt,
    durationMin: 45,
    attendedTutorIds: ["chair-tutor", "member-tutor"],
  };
  return {
    app,
    input: {
      applicationId: app.id,
      accept: true,
      comment: "Panel recommends admission",
      expectedUpdatedAt: app.updatedAt,
      completion,
    },
  };
}

async function outcome(applicationId: string) {
  return {
    app: await db.tutorApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        interviewers: { orderBy: { tutorId: "asc" } },
        votes: { orderBy: { tutorId: "asc" } },
      },
    }),
    credits: await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    }),
    codes: await db.registrationCode.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({
      where: { event: "interview_approved" },
      orderBy: { userId: "asc" },
    }),
  };
}

async function existingApplicant(options: { verified?: boolean } = {}) {
  const tutor = await db.tutor.create({
    data: {
      englishName: "Synthetic Returning Candidate",
      email: "candidate@example.test",
      username: "returning_candidate",
      status: "ACTIVE",
      gradeLevel: 10,
      gradeSchoolYear: "25-26",
    },
  });
  const account = await db.user.create({
    data: {
      username: "returning_candidate",
      email: "candidate@example.test",
      role: "TUTOR",
      tutorId: tutor.id,
      emailVerifiedAt: options.verified === false ? null : new Date(),
    },
  });
  return { tutor, account };
}

// Compare persisted domain evidence, not just the rejected RPC. Failed attempts
// may create their own audit entry, but cannot mutate any admission-owned state.
async function promotionState(applicationId: string) {
  return {
    ...(await outcome(applicationId)),
    users: await db.user.findMany({ orderBy: { id: "asc" } }),
    tutors: await db.tutor.findMany({ orderBy: { id: "asc" } }),
    academics: await db.academicProfile.findMany({
      orderBy: { userId: "asc" },
    }),
    academicConfirmations: await db.academicConfirmation.findMany({
      orderBy: { id: "asc" },
    }),
    history: await db.historicalAcademicRecord.findMany({
      orderBy: { id: "asc" },
    }),
    proposals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
    allNotices: await db.notification.findMany({ orderBy: { id: "asc" } }),
  };
}

it.each(["ADMIN", "HEAD"] as const)(
  "%s chair approval records service, admission, code and in-app notices immediately and exactly once",
  async (role) => {
    const { app, input } = await fixture();
    await db.user.update({ where: { id: "chair" }, data: { role } });
    await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
      ok: true,
    });
    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({
      status: "ACCEPTED",
      decidedByTutorId: "chair-tutor",
      decisionComment: input.comment,
      interviewCompletedAt: completedAt,
      interviewDurationMin: 45,
      interviewSchoolYear: "26-27",
      interviewQuarter: "Q1",
    });
    expect(saved.app.votes).toHaveLength(3);
    expect(saved.credits).toHaveLength(2);
    expect(
      saved.credits.every(
        (row) =>
          row.amount === 0.75 &&
          row.schoolYear === "26-27" &&
          row.quarter === "Q1",
      ),
    ).toBe(true);
    expect(saved.codes).toHaveLength(1);
    expect(saved.codes[0]).toMatchObject({
      applicationId: app.id,
      tutorId: saved.app.promotedTutorId,
      email: "candidate@example.test",
      kind: "TUTOR",
      usedAt: null,
    });
    expect(saved.notices.map((row) => row.userId)).toEqual(["chair", "head"]);
    expect(
      saved.notices.every(
        (row) =>
          row.inAppOnly &&
          row.link === `/admin/applications#application-${app.id}`,
      ),
    ).toBe(true);
    expect(await db.approvalRequest.count()).toBe(0);
    // A lost-response retry retains original credit/code/notification identities.
    await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
      ok: true,
    });
    expect(await outcome(app.id)).toEqual(saved);
  },
);

it("concurrent copies of chair approval commit one admission, credit set and notice set", async () => {
  const { app, input } = await fixture();
  await expect(
    Promise.all([
      caller().tutor.decideInterview(input),
      caller().tutor.decideInterview(input),
    ]),
  ).resolves.toEqual([{ ok: true }, { ok: true }]);
  const saved = await outcome(app.id);
  expect(saved.codes).toHaveLength(1);
  expect(saved.credits).toHaveLength(2);
  expect(saved.notices).toHaveLength(2);
});

it.each([
  "missing service",
  "missing vote",
  "minority",
  "non-chair",
  "demoted",
  "suspended",
  "revoked",
  "stale",
  "attendance",
  "future",
  "disabled hours",
] as const)(
  "rejects %s without partial admission, hours or notices",
  async (scenario) => {
    const { app, input } = await fixture();
    let actor = "chair";
    let submission: Parameters<
      ReturnType<typeof caller>["tutor"]["decideInterview"]
    >[0] = input;
    if (scenario === "missing service")
      submission = { ...input, completion: undefined };
    if (scenario === "missing vote")
      await db.interviewVote.delete({
        where: {
          applicationId_tutorId: {
            applicationId: app.id,
            tutorId: "member-tutor",
          },
        },
      });
    if (scenario === "minority")
      await db.interviewVote.updateMany({
        where: { applicationId: app.id },
        data: { accept: false },
      });
    if (scenario === "non-chair") actor = "head";
    if (scenario === "demoted")
      await db.user.update({
        where: { id: "chair" },
        data: { role: "COORDINATOR" },
      });
    if (scenario === "suspended")
      await db.user.update({
        where: { id: "chair" },
        data: { suspendedAt: new Date() },
      });
    if (scenario === "revoked")
      await db.user.update({
        where: { id: "chair" },
        data: { tutorAccessRevoked: true },
      });
    if (scenario === "stale")
      submission = { ...input, expectedUpdatedAt: new Date(0) };
    if (scenario === "attendance")
      submission = {
        ...input,
        completion: {
          ...input.completion,
          attendedTutorIds: ["coordinator-tutor"],
        },
      };
    if (scenario === "future")
      submission = {
        ...input,
        completion: {
          ...input.completion,
          completedAt: new Date(Date.now() + 86_400_000),
        },
      };
    if (scenario === "disabled hours")
      await db.programFeature.create({
        data: { key: "SERVICE_HOURS", enabled: false },
      });
    await expect(
      caller(actor).tutor.decideInterview(submission),
    ).rejects.toHaveProperty("code");
    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({
      status: "INTERVIEW",
      interviewCompletedAt: null,
      decidedAt: null,
      promotedTutorId: null,
    });
    expect(saved.credits).toEqual([]);
    expect(saved.codes).toEqual([]);
    expect(saved.notices).toEqual([]);
    expect(await db.approvalRequest.count()).toBe(0);
  },
);

it("a colliding credit ID preserves the unrelated adjustment and rolls back approval", async () => {
  const { app, input } = await fixture();
  const collision = await db.serviceHourAdjustment.create({
    data: {
      id: interviewHoursId(app.id, "chair-tutor"),
      tutorId: "coordinator-tutor",
      type: "EXTRA",
      amount: 2,
      month: "2026-09",
      schoolYear: "26-27",
      quarter: "Q1",
      reason: "Unrelated manual service",
    },
  });
  await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: null,
    promotedTutorId: null,
  });
  expect(saved.credits).toEqual([collision]);
  expect(saved.codes).toEqual([]);
  expect(saved.notices).toEqual([]);
});

it.each(["", "not-an-email"])(
  "refuses invalid legacy applicant contact %j before any approval writes",
  async (email) => {
    const { app, input } = await fixture();
    const current = await db.tutorApplication.update({
      where: { id: app.id },
      data: { email },
    });
    await expect(
      caller().tutor.decideInterview({
        ...input,
        expectedUpdatedAt: current.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({
      status: "INTERVIEW",
      interviewCompletedAt: null,
      promotedTutorId: null,
    });
    expect(saved.credits).toEqual([]);
    expect(saved.codes).toEqual([]);
    expect(saved.notices).toEqual([]);
  },
);

it("a mismatched outstanding legacy code cannot masquerade as successful registration setup", async () => {
  const { app, input } = await fixture();
  const unrelated = await db.registrationCode.create({
    data: {
      code: "ABCDE",
      applicationId: app.id,
      kind: "CREW",
      tutorId: "coordinator-tutor",
      email: "different@example.test",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: null,
    promotedTutorId: null,
  });
  expect(saved.credits).toEqual([]);
  expect(saved.codes).toEqual([unrelated]);
  expect(saved.notices).toEqual([]);
});

it.each([
  { problem: "missing plaintext", plaintext: null, attempts: 0 },
  { problem: "empty plaintext", plaintext: "", attempts: 0 },
  { problem: "whitespace plaintext", plaintext: " \t\n", attempts: 0 },
  { problem: "exhausted attempts", plaintext: "ABCDE", attempts: 10 },
])(
  "unusable exact codes with $problem cannot complete approval",
  async ({ plaintext, attempts }) => {
    const { app, input } = await fixture();
    const tutor = await db.tutor.create({
      data: {
        englishName: "Synthetic Candidate",
        email: "candidate@example.test",
        status: "PENDING",
      },
    });
    const code = await db.registrationCode.create({
      data: {
        code: plaintext,
        applicationId: app.id,
        kind: "TUTOR",
        tutorId: tutor.id,
        email: "candidate@example.test",
        attempts,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({
      status: "INTERVIEW",
      interviewCompletedAt: null,
      promotedTutorId: null,
    });
    expect(saved.credits).toEqual([]);
    expect(saved.codes).toEqual([code]);
    expect(saved.notices).toEqual([]);
    expect(
      (await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } })).status,
    ).toBe("PENDING");
  },
);

it("all writes including registration and notification roll back with the owning transaction", async () => {
  const { app, input } = await fixture();
  await expect(
    db.$transaction((tx) =>
      databaseScope.run(tx, async () => {
        await caller().tutor.decideInterview(input);
        expect(await tx.registrationCode.count()).toBe(1);
        expect(
          await tx.notification.count({
            where: { event: "interview_approved" },
          }),
        ).toBe(2);
        throw new Error("Synthetic failure after approval effects");
      }),
    ),
  ).rejects.toThrow("Synthetic failure after approval effects");
  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: null,
    promotedTutorId: null,
  });
  expect(saved.credits).toEqual([]);
  expect(saved.codes).toEqual([]);
  expect(saved.notices).toEqual([]);
  expect(await db.tutor.count()).toBe(4);
});

it("approval retains exact recorded hours but cannot overwrite them as a correction", async () => {
  const { app, input } = await fixture();
  await caller("head").interviewManagement.complete({
    applicationId: app.id,
    ...input.completion,
    reason: "Prior completion",
  });
  const recorded = await outcome(app.id);
  const reviewed = { ...input, expectedUpdatedAt: recorded.app.updatedAt };
  await expect(
    caller().tutor.decideInterview({
      ...reviewed,
      completion: { ...input.completion, durationMin: 90 },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await outcome(app.id)).toEqual(recorded);
  await caller().tutor.decideInterview(reviewed);
  expect((await outcome(app.id)).credits).toEqual(recorded.credits);
});

it("verified existing accounts reuse their identity while atomic approval adds participation without issuing a redundant code", async () => {
  const { app, input } = await fixture();
  const account = await db.user.create({
    data: {
      id: "candidate",
      username: "candidate",
      role: "STUDENT",
      email: "candidate@example.test",
      emailVerifiedAt: new Date(),
    },
  });
  await caller().tutor.decideInterview(input);
  const saved = await outcome(app.id);
  expect(saved.codes).toEqual([]);
  expect(saved.credits).toHaveLength(2);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    id: account.id,
    tutorId: saved.app.promotedTutorId,
    role: "TUTOR",
    tutorAccessRevoked: false,
  });
});

// Restriction tests use the real Head operation, preserving the distinction
// between a historical archive and an explicit revocation of current membership.
async function revokedApplicant() {
  const tutor = await db.tutor.create({
    data: {
      englishName: "Synthetic Restricted Candidate",
      email: "candidate@example.test",
      status: "ACTIVE",
    },
  });
  const user = await db.user.create({
    data: {
      username: "restricted_candidate",
      email: "candidate@example.test",
      role: "TUTOR",
      tutorId: tutor.id,
      emailVerifiedAt: new Date(),
    },
  });
  await caller("head").admin.setUserCanTutor({
    userId: user.id,
    canTutor: false,
  });
  return { tutor, user };
}

it.each(["ADMIN", "HEAD"] as const)(
  "%s interview approval cannot restore Head-revoked tutoring",
  async (role) => {
    const { app, input } = await fixture();
    const { tutor, user } = await revokedApplicant();
    await db.user.update({ where: { id: "chair" }, data: { role } });
    const before = await outcome(app.id);
    await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await outcome(app.id)).toEqual(before);
    expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
      tutorId: tutor.id,
      tutorAccessRevoked: true,
    });
    expect(
      await db.tutor.findUnique({ where: { id: tutor.id } }),
    ).toMatchObject({ status: "ARCHIVED" });
    expect(await db.approvalRequest.count()).toBe(0);

    await expect(promoteApplicantToTutor(app.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await outcome(app.id)).toEqual(before);

    // Explicit restoration remains Head-only and makes the same reviewed input usable.
    await caller("head").admin.setUserCanTutor({
      userId: user.id,
      canTutor: true,
    });
    await caller().tutor.decideInterview(input);
    const restored = await outcome(app.id);
    expect(restored.app).toMatchObject({
      status: "ACCEPTED",
      promotedTutorId: tutor.id,
    });
    expect(restored.credits).toHaveLength(2);
    expect(restored.notices).toHaveLength(2);
    expect(restored.codes).toEqual([]);
    await caller().tutor.decideInterview(input);
    expect(await outcome(app.id)).toEqual(restored);
  },
);

it.each([
  "unverified primary",
  "verified alias",
  "legacy email case",
  "current roster owner",
  "retained roster owner",
] as const)(
  "preserves revocation through %s evidence",
  async (representation) => {
    const { app, input } = await fixture();
    const { tutor, user } = await revokedApplicant();
    if (representation === "unverified primary")
      await db.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: null },
      });
    if (representation === "legacy email case")
      await db.user.update({
        where: { id: user.id },
        data: { email: "Candidate@Example.Test" },
      });
    if (
      [
        "verified alias",
        "current roster owner",
        "retained roster owner",
      ].includes(representation)
    )
      await db.user.update({
        where: { id: user.id },
        data: { email: "other-primary@example.test" },
      });
    if (representation === "verified alias") {
      await db.tutor.update({
        where: { id: tutor.id },
        data: { email: "other-primary@example.test" },
      });
      await db.accountEmail.upsert({
        where: { email: "candidate@example.test" },
        update: { verifiedAt: new Date() },
        create: {
          userId: user.id,
          email: "candidate@example.test",
          verifiedAt: new Date(),
        },
      });
    }
    if (representation === "retained roster owner") {
      const current = await db.tutor.create({
        data: { englishName: "Current Restricted Tutor", status: "ARCHIVED" },
      });
      await db.user.update({
        where: { id: user.id },
        data: { tutorId: current.id },
      });
      await db.tutorProfileOwnership.create({
        data: { tutorId: tutor.id, userId: user.id },
      });
    }
    const before = await outcome(app.id);
    await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await outcome(app.id)).toEqual(before);
    expect(
      await db.tutor.findUnique({ where: { id: tutor.id } }),
    ).toMatchObject({ status: "ARCHIVED" });
    expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
      tutorAccessRevoked: true,
    });
  },
);

it.each(["suspended", "retired", "departed"] as const)(
  "does not promote a %s applicant or issue a replacement invitation",
  async (restriction) => {
    const { app, input } = await fixture();
    await db.user.create({
      data: {
        email: "candidate@example.test",
        role: "STUDENT",
        emailVerifiedAt: null,
        ...(restriction === "suspended"
          ? { suspendedAt: new Date() }
          : restriction === "retired"
            ? { mergedIntoId: "head" }
            : {
                schoolDeparture: {
                  create: { reason: "TRANSFERRED", source: "HEAD" },
                },
              }),
      },
    });
    const before = await outcome(app.id);
    await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
      code: restriction === "retired" ? "CONFLICT" : "FORBIDDEN",
    });
    expect(await outcome(app.id)).toEqual(before);
    expect(await db.tutor.count()).toBe(4);
  },
);

it("admits a history-only account without mistaking its non-membership flag for a revoked tutor link", async () => {
  const { app, input } = await fixture();
  const user = await db.user.create({
    data: {
      username: "history_candidate",
      email: "candidate@example.test",
      role: "STUDENT",
      emailVerifiedAt: new Date(),
      tutorAccessRevoked: true,
    },
  });
  const history = await db.tutor.create({
    data: {
      englishName: "Historical Candidate",
      email: "candidate@example.test",
      status: "ARCHIVED",
    },
  });
  await db.tutorProfileOwnership.create({
    data: { tutorId: history.id, userId: user.id },
  });
  await caller().tutor.decideInterview(input);
  const saved = await outcome(app.id);
  expect(saved.app.status).toBe("ACCEPTED");
  expect(saved.app.promotedTutorId).toBe(history.id);
  expect(saved.codes).toEqual([]);
  expect(await db.user.findUnique({ where: { id: user.id } })).toMatchObject({
    tutorId: saved.app.promotedTutorId,
    tutorAccessRevoked: false,
  });
});

it("reactivates an ordinary archive without overriding names or manufacturing a restriction", async () => {
  const { app, input } = await fixture();
  const tutor = await db.tutor.create({
    data: {
      englishName: "Preserved Historical Name",
      email: "candidate@example.test",
      status: "ARCHIVED",
    },
  });
  await caller().tutor.decideInterview(input);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({
    englishName: "Preserved Historical Name",
    status: "ACTIVE",
  });
  expect((await outcome(app.id)).codes).toHaveLength(1);
});

it("rechecks a revocation committed while approval waits for the account lock", async () => {
  const { app, input } = await fixture();
  const { tutor, user } = await revokedApplicant();
  await caller("head").admin.setUserCanTutor({
    userId: user.id,
    canTutor: true,
  });
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const revocation = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, user.id);
    await tx.user.update({
      where: { id: user.id },
      data: { tutorAccessRevoked: true },
    });
    await tx.tutor.update({
      where: { id: tutor.id },
      data: { status: "ARCHIVED" },
    });
    locked();
    await hold;
  });
  await ready;
  const approval = caller()
    .tutor.decideInterview(input)
    .then(
      () => ({ accepted: true }),
      (error: unknown) => ({ error }),
    );
  try {
    // Observe a real blocked namespace write instead of depending on a sleep or
    // promise scheduling to claim that the competing transaction was exercised.
    await vi.waitFor(
      async () => {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND wait_event = 'advisory'
          AND query LIKE '%pg_advisory_xact_lock%'`;
        expect(Number(waiting[0]?.count)).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 20 },
    );
  } finally {
    release();
  }
  await revocation;
  expect(await approval).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect((await outcome(app.id)).app).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: null,
  });
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.serviceHourAdjustment.count()).toBe(0);
  expect(await db.tutor.findUnique({ where: { id: tutor.id } })).toMatchObject({
    status: "ARCHIVED",
  });
});

it.each(["review-admin", "head"])("%s can review an old pending decision-only acceptance without inventing service evidence", async (reviewerId) => {
  const { app, input } = await fixture();
  await db.user.create({ data: { id: "review-admin", role: "ADMIN", email: "review-admin@example.test" } });
  // Internal proposal construction stands in for a durable request from the old UI;
  // new direct RPC submissions without completion are rejected above.
  const legacy = {
    applicationId: input.applicationId,
    accept: input.accept,
    comment: input.comment,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  const request = await legacyAcceptance(legacy);
  await expect(
    caller().approval.decide({
      id: request.id,
      approve: true,
      note: "Requester cannot self-review as Admin",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller(reviewerId).approval.decide({
    id: request.id,
    approve: true,
    note: "Apply the recorded legacy proposal",
  });
  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "ACCEPTED",
    interviewCompletedAt: null,
    decidedByTutorId: "chair-tutor",
  });
  expect(saved.credits).toEqual([]);
  expect(saved.codes).toHaveLength(1);
  expect(saved.notices).toEqual([]);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
    state: "APPROVED", targets: request.targets, payload: request.payload, fingerprint: request.fingerprint,
  });
});

it("a superseded legacy proposal cannot replay over a new atomic chair approval", async () => {
  const { app, input } = await fixture();
  const legacy = {
    applicationId: input.applicationId,
    accept: input.accept,
    comment: input.comment,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  const request = await legacyAcceptance(legacy);
  await caller().tutor.decideInterview(input);
  const saved = await outcome(app.id);
  const management = (
    await caller("head").interviewManagement.options({
      completion: "ALL",
      applicationId: app.id,
    })
  ).applications.rows[0];
  expect(management).toMatchObject({
    status: "ACCEPTED",
    pendingDecision: false,
    registration: { state: "codeActive" },
    interviewDurationMin: 45,
  });
  expect((await caller().tutor.myInterviews())[0]).toMatchObject({
    status: "ACCEPTED",
    pendingDecision: false,
    myAwardedHours: 0.75,
  });
  await expect(
    caller("head").approval.decide({
      id: request.id,
      approve: true,
      note: "Attempt stale legacy replay",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await outcome(app.id)).toEqual(saved);
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .state,
  ).toBe("PENDING");
});

// Keep the original reproduction's complete observed outcome together so the
// regression identifies an implicit restoration and all accompanying side effects.
it("Admin chair approval preserves an applicant's Head-revoked tutoring access", async () => {
  const { app, input } = await fixture();
  const tutor = await db.tutor.create({
    data: {
      englishName: "Synthetic Restricted Candidate",
      email: "candidate@example.test",
      username: "restricted_candidate",
      status: "ACTIVE",
    },
  });
  const applicant = await db.user.create({
    data: {
      username: "restricted_candidate",
      email: "candidate@example.test",
      role: "TUTOR",
      tutorId: tutor.id,
      emailVerifiedAt: new Date(),
    },
  });
  // Establish the restriction through its real Head-only entry point, not an
  // arbitrary fixture flag: this also archives the retained tutor identity.
  await caller("head").admin.setUserCanTutor({
    userId: applicant.id,
    canTutor: false,
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: applicant.id } }),
  ).toMatchObject({ tutorId: tutor.id, tutorAccessRevoked: true });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
  ).toMatchObject({ status: "ARCHIVED" });

  let outcomeLabel = "rejected";
  try {
    await caller().tutor.decideInterview(input);
    outcomeLabel = "accepted";
  } catch {
    // Rejection is the desired behavior until Head explicitly restores access.
  }
  const result = await outcome(app.id);
  const applicantAfter = await db.user.findUniqueOrThrow({
    where: { id: applicant.id },
  });
  const tutorAfter = await db.tutor.findUniqueOrThrow({
    where: { id: tutor.id },
  });
  // A combined assertion exposes the complete observed outcome in one failure:
  // direct acceptance, cleared revocation, ACTIVE roster, credits and notices.
  expect({
    outcome: outcomeLabel,
    applicationStatus: result.app.status,
    completedAt: result.app.interviewCompletedAt,
    tutorAccessRevoked: applicantAfter.tutorAccessRevoked,
    tutorStatus: tutorAfter.status,
    credits: result.credits.length,
    codes: result.codes.length,
    notifications: result.notices.length,
    proposals: await db.approvalRequest.count(),
  }).toEqual({
    outcome: "rejected",
    applicationStatus: "INTERVIEW",
    completedAt: null,
    tutorAccessRevoked: true,
    tutorStatus: "ARCHIVED",
    credits: 0,
    codes: 0,
    notifications: 0,
    proposals: 0,
  });
});

it.each(["ADMIN", "HEAD"] as const)(
  "%s chair cannot restore independent Head revocation and rolls back every promotion effect",
  async (role) => {
    const { app, input } = await fixture();
    const { tutor, account } = await existingApplicant();
    await db.user.update({ where: { id: "chair" }, data: { role } });
    await caller("head").admin.setUserCanTutor({
      userId: account.id,
      canTutor: false,
    });
    const before = await promotionState(app.id);

    await expect(caller().tutor.decideInterview(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Tutoring access was revoked. Ask Head to restore tutoring access before approving this application.",
    });

    expect(await promotionState(app.id)).toEqual(before);
    expect(before.app).toMatchObject({
      status: "INTERVIEW",
      decidedAt: null,
      decidedByTutorId: null,
      decisionComment: null,
      interviewCompletedAt: null,
      interviewDurationMin: null,
      promotedTutorId: null,
    });
    expect(before.tutors.find((row) => row.id === tutor.id)).toMatchObject({
      status: "ARCHIVED",
    });
    expect(before.users.find((row) => row.id === account.id)).toMatchObject({
      tutorAccessRevoked: true,
    });
    expect(before.credits).toEqual([]);
    expect(before.codes).toEqual([]);
    expect(before.notices).toEqual([]);
    expect(before.proposals).toEqual([]);
  },
);

it("explicit Head restoration permits a fresh chair approval using the retained tutor identity", async () => {
  const { app, input } = await fixture();
  const { tutor, account } = await existingApplicant();
  await caller("head").admin.setUserCanTutor({
    userId: account.id,
    canTutor: false,
  });
  await expect(caller().tutor.decideInterview(input)).rejects.toHaveProperty(
    "code",
    "FORBIDDEN",
  );
  await caller("head").admin.setUserCanTutor({
    userId: account.id,
    canTutor: true,
  });
  const current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });

  await expect(
    caller().tutor.decideInterview({
      ...input,
      expectedUpdatedAt: current.updatedAt,
    }),
  ).resolves.toEqual({ ok: true });

  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "ACCEPTED",
    promotedTutorId: tutor.id,
  });
  expect(saved.credits).toHaveLength(2);
  expect(saved.notices).toHaveLength(2);
  expect(saved.codes).toEqual([]);
  expect(await db.tutor.count()).toBe(5);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    tutorId: tutor.id,
    tutorAccessRevoked: false,
  });
});

it("an identical accepted retry after later Head revocation is read-only and retains restriction", async () => {
  const { app, input } = await fixture();
  const { tutor, account } = await existingApplicant();
  await caller().tutor.decideInterview(input);
  await caller("head").admin.setUserCanTutor({
    userId: account.id,
    canTutor: false,
  });
  const restricted = await promotionState(app.id);

  await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
    ok: true,
  });

  expect(await promotionState(app.id)).toEqual(restricted);
  expect(restricted.app).toMatchObject({
    status: "ACCEPTED",
    promotedTutorId: tutor.id,
  });
  expect(restricted.users.find((row) => row.id === account.id)).toMatchObject({
    tutorAccessRevoked: true,
  });
  expect(restricted.tutors.find((row) => row.id === tutor.id)).toMatchObject({
    status: "ARCHIVED",
  });
});

it("Head review of a pending legacy acceptance cannot implicitly restore applicant access", async () => {
  const { app, input } = await fixture();
  const { account } = await existingApplicant();
  const request = await legacyAcceptance({
    applicationId: input.applicationId,
    accept: input.accept,
    comment: input.comment,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  await caller("head").admin.setUserCanTutor({
    userId: account.id,
    canTutor: false,
  });
  const before = await promotionState(app.id);

  await expect(
    caller("head").approval.decide({
      id: request.id,
      approve: true,
      note: "The applicant restriction is a separate Head decision",
    }),
  ).rejects.toHaveProperty("code", "FORBIDDEN");

  expect(await promotionState(app.id)).toEqual(before);
  expect(before.proposals[0]).toMatchObject({
    id: request.id,
    state: "PENDING",
  });
});

it.each(["verified", "unverified"] as const)(
  "shared promotion refuses a revoked %s account before creating historical records or invitations",
  async (verification) => {
    const app = await db.tutorApplication.create({
      data: {
        name: "Synthetic Returning Candidate",
        email: "candidate@example.test",
        status: "ACCEPTED",
      },
    });
    const { account } = await existingApplicant({
      verified: verification === "verified",
    });
    await caller("head").admin.setUserCanTutor({
      userId: account.id,
      canTutor: false,
    });
    const before = await promotionState(app.id);

    await expect(promoteApplicantToTutor(app.id)).rejects.toHaveProperty(
      "code",
      "FORBIDDEN",
    );

    expect(await promotionState(app.id)).toEqual(before);
  },
);

it.each([true, false])(
  "an email-matched roster's actual owner is respected with revoked=%s and outdated contact data",
  async (revoked) => {
    const { app, input } = await fixture();
    const { account } = await existingApplicant();
    // The roster retains the historical applicant email while its current owner
    // has a different mailbox. A missing email lookup never means an unowned tutor.
    await db.user.update({
      where: { id: account.id },
      data: { email: "new-owner-mail@example.test" },
    });
    if (revoked)
      await caller("head").admin.setUserCanTutor({
        userId: account.id,
        canTutor: false,
      });
    const before = await promotionState(app.id);

    await expect(caller().tutor.decideInterview(input)).rejects.toHaveProperty(
      "code",
      revoked ? "FORBIDDEN" : "CONFLICT",
    );

    expect(await promotionState(app.id)).toEqual(before);
  },
);

it.each([true, false])(
  "first admission preserves the account verification boundary when no tutor membership exists (verified=%s)",
  async (verified) => {
    const { app, input } = await fixture();
    const account = await db.user.create({
      data: {
        email: "candidate@example.test",
        username: "unlinked_candidate",
        role: "STUDENT",
        emailVerifiedAt: verified ? new Date() : null,
        // Historical setup and membership selection use this flag for no membership
        // as well as linked revocation. First admission follows registration's rule.
        tutorAccessRevoked: true,
      },
    });
    await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
      ok: true,
    });
    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({ status: "ACCEPTED" });
    expect(saved.credits).toHaveLength(2);
    expect(saved.codes).toHaveLength(verified ? 0 : 1);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      tutorId: verified ? saved.app.promotedTutorId : null,
      tutorAccessRevoked: !verified,
      username: "unlinked_candidate",
    });
    expect(await db.tutor.count()).toBe(5);
  },
);

it.each([true, false])(
  "a different email account cannot acquire an already owned tutor (owner revoked=%s)",
  async (revoked) => {
    const { app, input } = await fixture();
    const { account } = await existingApplicant();
    await db.user.update({
      where: { id: account.id },
      data: { email: "actual-owner@example.test" },
    });
    // Changing the primary address retains its verified alias. Release that
    // claim explicitly to model a reused mailbox with stale roster contact data,
    // while preserving the original account's authoritative tutor ownership.
    const formerEmail = await db.accountEmail.delete({
      where: { email: "candidate@example.test" },
    });
    expect(formerEmail.userId).toBe(account.id);
    await db.user.create({
      data: {
        email: "candidate@example.test",
        username: "different_candidate",
        role: "STUDENT",
        emailVerifiedAt: new Date(),
      },
    });
    if (revoked)
      await caller("head").admin.setUserCanTutor({
        userId: account.id,
        canTutor: false,
      });
    const before = await promotionState(app.id);

    await expect(caller().tutor.decideInterview(input)).rejects.toHaveProperty(
      "code",
      revoked ? "FORBIDDEN" : "CONFLICT",
    );

    expect(await promotionState(app.id)).toEqual(before);
  },
);

it("Head panel replacement can reverse an admission while preserving a later independent revocation", async () => {
  const { app, input } = await fixture();
  const { account, tutor } = await existingApplicant();
  await caller().tutor.decideInterview(input);
  await caller("head").admin.setUserCanTutor({
    userId: account.id,
    canTutor: false,
  });
  const accepted = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });

  await caller("head").admin.assignInterviewers({
    applicationId: app.id,
    tutorIds: ["chair-tutor", "head-tutor", "member-tutor"],
    headTutorId: "chair-tutor",
    expectedUpdatedAt: accepted.updatedAt,
  });

  const reset = await outcome(app.id);
  expect(reset.app).toMatchObject({
    status: "INTERVIEW",
    decidedAt: null,
    interviewCompletedAt: null,
  });
  expect(reset.app.votes).toEqual([]);
  expect(reset.credits).toEqual([]);
  expect(reset.codes).toEqual([]);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({ tutorId: tutor.id, tutorAccessRevoked: true });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
  ).toMatchObject({ status: "ARCHIVED" });
});

it.each([
  "status acceptance",
  "same-status reconciliation",
  "shared reconciliation",
  "audit undo",
] as const)(
  "%s cannot turn Head revocation into an implicit restoration",
  async (entryPoint) => {
    await db.programFeature.create({
      data: { key: "INTERVIEWS", enabled: false },
    });
    const { account } = await existingApplicant();
    const app = await db.tutorApplication.create({
      data: {
        name: "Synthetic Returning Candidate",
        email: "candidate@example.test",
        status:
          entryPoint === "same-status reconciliation" ||
          entryPoint === "shared reconciliation"
            ? "ACCEPTED"
            : "PENDING",
      },
    });
    await caller("head").admin.setUserCanTutor({
      userId: account.id,
      canTutor: false,
    });
    const audit =
      entryPoint === "audit undo"
        ? await db.auditLog.create({
            data: {
              action: "Historical application reversal",
              entity: "TutorApplication",
              entityId: app.id,
              undoData: {
                kind: "application.status",
                payload: {
                  id: app.id,
                  status: "ACCEPTED",
                  expectedUpdatedAt: app.updatedAt.toISOString(),
                },
              },
            },
          })
        : null;
    const before = await promotionState(app.id);

    const action =
      entryPoint === "audit undo"
        ? caller("head").admin.undoAudit({ id: audit!.id })
        : entryPoint === "shared reconciliation"
          ? reconcileApplication(db, app.id)
          : caller("head").admin.setApplicationStatus({
              id: app.id,
              status: "ACCEPTED",
              expectedUpdatedAt: app.updatedAt,
            });
    // Legacy undo refuses before dispatch because its evidence has no causal closure.
    await expect(action).rejects.toHaveProperty(
      "code",
      entryPoint === "audit undo" ? "PRECONDITION_FAILED" : "FORBIDDEN",
    );

    expect(await promotionState(app.id)).toEqual(before);
    if (audit)
      expect(
        await db.auditLog.findUniqueOrThrow({ where: { id: audit.id } }),
      ).toEqual(audit);
  },
);

it.each(["ARCHIVED", "OPTED_OUT"] as const)(
  "an unrestricted %s roster return reuses its account and preserves historical evidence",
  async (status) => {
    const { app, input } = await fixture();
    const { tutor, account } = await existingApplicant();
    await db.tutor.update({ where: { id: tutor.id }, data: { status } });

    await expect(caller().tutor.decideInterview(input)).resolves.toEqual({
      ok: true,
    });

    const saved = await outcome(app.id);
    expect(saved.app).toMatchObject({
      status: "ACCEPTED",
      promotedTutorId: tutor.id,
    });
    expect(saved.codes).toEqual([]);
    expect(await db.tutor.count()).toBe(5);
    expect(
      await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
    ).toMatchObject({ status: "ACTIVE" });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      username: "returning_candidate",
      tutorId: tutor.id,
      tutorAccessRevoked: false,
    });
    // ARCHIVED is historical evidence; a temporary OPTED_OUT state is not an
    // archive and must not manufacture one as a side effect of admission.
    expect(
      await db.historicalAcademicRecord.findMany({
        where: { tutorId: tutor.id },
      }),
    ).toEqual(
      status === "ARCHIVED"
        ? [expect.objectContaining({ rawGrade: "10", schoolYear: "25-26" })]
        : [],
    );
  },
);

it("an in-flight real Head revocation serializes with chair acceptance without restoring access", async () => {
  const { app, input } = await fixture();
  const { account, tutor } = await existingApplicant();
  let releaseRevocation!: () => void;
  let revocationReady!: (pid: number) => void;
  const release = new Promise<void>((resolve) => {
    releaseRevocation = resolve;
  });
  const ready = new Promise<number>((resolve) => {
    revocationReady = resolve;
  });
  const revoking = db.$transaction(
    async (tx) =>
      databaseScope.run(tx, async () => {
        const [backend] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        await caller("head").admin.setUserCanTutor({
          userId: account.id,
          canTutor: false,
        });
        revocationReady(backend!.pid);
        await release;
      }),
    { timeout: 10000 },
  );
  let accepting: Promise<unknown> | undefined;
  let observedWait = false;
  try {
    const writerPid = await Promise.race([
      ready,
      revoking.then(() => {
        throw new Error("Revocation completed before the test released it");
      }),
    ]);
    // Capture the result immediately so a rejected transaction never becomes an
    // unhandled promise while the test observes the real PostgreSQL wait.
    accepting = caller()
      .tutor.decideInterview(input)
      .then(
        (value) => ({ status: "fulfilled", value }),
        (reason: unknown) => ({ status: "rejected", reason }),
      );
    await vi.waitUntil(
      async () => {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND ${writerPid} = ANY(pg_blocking_pids(pid))
      ) AS waiting`;
        observedWait = row?.waiting === true;
        return observedWait;
      },
      { timeout: 3000, interval: 25 },
    );
  } finally {
    releaseRevocation();
    // Even a failed writer must not leave its competing transaction running
    // when the next test truncates the isolated database.
    const [writerResult] = await Promise.allSettled([revoking, accepting]);
    if (writerResult.status === "rejected") throw writerResult.reason;
  }
  expect(await accepting).toMatchObject({
    status: "rejected",
    reason: {
      code: "FORBIDDEN",
      message:
        "Tutoring access was revoked. Ask Head to restore tutoring access before approving this application.",
    },
  });
  expect(observedWait).toBe(true);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({ tutorAccessRevoked: true });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
  ).toMatchObject({ status: "ARCHIVED" });
  const saved = await outcome(app.id);
  expect(saved.app).toMatchObject({
    status: "INTERVIEW",
    interviewCompletedAt: null,
    promotedTutorId: null,
    decidedAt: null,
  });
  expect(saved.credits).toEqual([]);
  expect(saved.codes).toEqual([]);
  expect(saved.notices).toEqual([]);
  expect(await db.approvalRequest.count()).toBe(0);
}, 15000);

it.each(["ReadCommitted", "Serializable"] as const)(
  "%s promotion cannot miss a restriction committed while it waits for the account row lock",
  async (isolationLevel) => {
    const app = await db.tutorApplication.create({
      data: {
        name: "Synthetic Returning Candidate",
        email: "candidate@example.test",
        status: "ACCEPTED",
      },
    });
    const { account, tutor } = await existingApplicant();
    let releaseWriter!: () => void;
    let rowReady!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      rowReady = resolve;
    });
    const writing = db.$transaction(
      async (tx) => {
        // Existing credential/email writers can already own User through UPDATE.
        // Exercise the lock boundary directly; the preceding case covers the real
        // Head RPC and its namespace order independently.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${account.id} FOR UPDATE`;
        rowReady();
        await release;
        await tx.user.update({
          where: { id: account.id },
          data: { tutorAccessRevoked: true },
        });
        await tx.tutor.update({
          where: { id: tutor.id },
          data: { status: "ARCHIVED" },
        });
      },
      { timeout: 10000 },
    );
    let promotion: Promise<PromiseSettledResult<void>> | undefined;
    let pidReady!: (pid: number) => void;
    const promotingPid = new Promise<number>((resolve) => {
      pidReady = resolve;
    });
    try {
      await Promise.race([ready, writing]);
      promotion = db
        .$transaction(
          async (tx) => {
            const [backend] = await tx.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`;
            pidReady(backend!.pid);
            await promoteApplicantToTutor(app.id, tx);
          },
          { timeout: 10000, isolationLevel },
        )
        .then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
      const pid = await Promise.race([
        promotingPid,
        promotion.then(() => {
          throw new Error(
            "Promotion completed before its backend was observed",
          );
        }),
      ]);
      await vi.waitUntil(
        async () => {
          const [row] = await db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS waiting`;
          return row?.waiting === true;
        },
        { timeout: 3000, interval: 25 },
      );
    } finally {
      releaseWriter();
      const [writerResult] = await Promise.allSettled([writing, promotion]);
      if (writerResult.status === "rejected") throw writerResult.reason;
    }

    // READ COMMITTED rereads the authoritative restriction. A stale Serializable
    // snapshot may instead abort at the row fence; either result prevents a grant.
    const result = await promotion;
    expect(result).toMatchObject({ status: "rejected" });
    if (result?.status !== "rejected")
      throw new Error("The row-lock race must reject promotion");
    if (isolationLevel === "ReadCommitted") {
      expect(result.reason).toMatchObject({ code: "FORBIDDEN" });
    } else {
      // A timeout, unrelated validation error or database outage is not evidence
      // that Serializable isolation fenced the stale account snapshot correctly.
      expect(isSerializationFailure(result.reason)).toBe(true);
    }
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({ tutorAccessRevoked: true });
    expect(
      await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } }),
    ).toMatchObject({ status: "ARCHIVED" });
    expect((await outcome(app.id)).app.promotedTutorId).toBeNull();
    expect(await db.historicalAcademicRecord.count()).toBe(0);
    expect(await db.registrationCode.count()).toBe(0);
  },
  15000,
);

// Existing restrictions are independent of tutorAccessRevoked; the promotion
// boundary must preserve each even when that membership flag is false.
it.each(["suspended", "merged", "departed"] as const)(
  "promotion preserves an applicant's independent %s account restriction",
  async (restriction) => {
    const { app, input } = await fixture();
    const { account } = await existingApplicant();
    if (restriction === "departed") {
      await caller("head").departure.setState({
        userId: account.id,
        action: "GRADUATED",
        expectedRevision: 0,
        explanation: "Synthetic confirmed departure before admission",
      });
    } else {
      await db.user.update({
        where: { id: account.id },
        data:
          restriction === "suspended"
            ? { suspendedAt: new Date() }
            : { mergedIntoId: "head" },
      });
    }
    const before = await promotionState(app.id);
    const departureBefore = await db.schoolDeparture.findUnique({
      where: { userId: account.id },
    });
    await expect(caller().tutor.decideInterview(input)).rejects.toHaveProperty(
      "code",
      restriction === "merged" ? "CONFLICT" : "FORBIDDEN",
    );
    expect(await promotionState(app.id)).toEqual(before);
    expect(
      await db.schoolDeparture.findUnique({ where: { userId: account.id } }),
    ).toEqual(departureBefore);
  },
);
