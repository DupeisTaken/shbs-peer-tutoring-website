import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { queueProposal } from "~/server/approvals";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { interviewHoursId } from "~/server/interview-hours";
import { lockAccountProfile } from "~/server/account-profile";
import { promoteApplicantToTutor } from "~/server/tutors/promote";

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

it("an old pending decision-only acceptance remains Head-reviewed and invents no service evidence", async () => {
  const { app, input } = await fixture();
  // Internal proposal construction stands in for a durable request from the old UI;
  // new direct RPC submissions without completion are rejected above.
  const legacy = {
    applicationId: input.applicationId,
    accept: input.accept,
    comment: input.comment,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  const request = await queueProposal(
    session(),
    "tutor.decideInterview",
    legacy,
  );
  await expect(
    caller().approval.decide({
      id: request.id,
      approve: true,
      note: "Not Head",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller("head").approval.decide({
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
});

it("a superseded legacy proposal cannot replay over a new atomic chair approval", async () => {
  const { app, input } = await fixture();
  const legacy = {
    applicationId: input.applicationId,
    accept: input.accept,
    comment: input.comment,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  const request = await queueProposal(
    session(),
    "tutor.decideInterview",
    legacy,
  );
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
