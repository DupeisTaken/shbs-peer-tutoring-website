import { createHash } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: sendEmail },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { ApprovalQueued } from "~/server/approvals";
import { assertStudentRequestAssignable } from "~/server/student-request-state";
import {
  assertRequestProcessable,
  lockApplicationReview,
  requestInvalidityInput,
} from "~/server/request-invalidity";
import {
  validSurvey,
  resendSurvey,
  surveyInput,
} from "~/server/student-survey";
import {
  studentRequestRows,
  assignStudentRequest,
  prepareStudentAction,
} from "~/server/student-workflow";
import { reconcileApplication } from "~/server/tutors/application-status";
import { approveQualification } from "~/server/qualifications";
import { safeAuditSnapshot } from "~/server/audit/evidence";

const token = "a".repeat(64);
const caller = (role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: `invalid-${role.toLowerCase()}`,
        name: "Untrusted cookie name",
        email: `${role.toLowerCase()}@example.test`,
      },
      role,
      tutorId:
        role === "TUTOR" || role === "HEAD"
          ? `invalid-${role.toLowerCase()}-tutor`
          : null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const flag = (id: string, expectedInvalidityVersion = 0, invalid = true) => ({
  id,
  invalid,
  expectedInvalidityVersion,
  reason: invalid
    ? "  Synthetic duplicate request  "
    : "Reviewed corrected entry",
});
async function application(
  status: "PENDING" | "INTERVIEW" | "ACCEPTED" = "PENDING",
) {
  return db.tutorApplication.create({
    data: {
      name: "Synthetic Applicant",
      email: "applicant@example.test",
      status,
      policyRevision: "original-policy",
      policySnapshot: { original: true },
      policyAcceptedAt: new Date("2026-09-01"),
    },
  });
}
async function survey(tuteeId?: string) {
  return db.studentSurvey.create({
    data: {
      email: "student@example.test",
      intakeTermId: "invalid-term",
      tuteeId,
      submittedAt: new Date("2026-09-01"),
      expiresAt: new Date("2099-01-01"),
      payload: surveyInput.parse({
        englishName: "Synthetic Student",
        email: "student@example.test",
        preferredContact: "Email",
        firstChoiceId: "invalid-subject",
        slotIds: [],
        signatureName: "Synthetic Student",
        agreed: true,
        policyRevision: "original-policy",
      }),
      policyRevision: "original-policy",
      policySnapshot: { original: true },
      tokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
}
async function queued(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw Error("Expected a queued proposal");
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.tutor.createMany({
    data: [
      {
        id: "invalid-head-tutor",
        englishName: "Synthetic Head",
        status: "ACTIVE",
      },
      {
        id: "invalid-tutor-tutor",
        englishName: "Synthetic Tutor",
        status: "ACTIVE",
      },
    ],
  });
  await db.user.createMany({
    data: (
      ["ADMIN", "HEAD", "COORDINATOR", "VIEWER", "TUTOR", "STUDENT"] as const
    ).map((role) => ({
      id: `invalid-${role.toLowerCase()}`,
      role,
      name: `Stored ${role}`,
      email: `${role.toLowerCase()}@example.test`,
      tutorId:
        role === "TUTOR" || role === "HEAD"
          ? `invalid-${role.toLowerCase()}-tutor`
          : null,
    })),
  });
  await db.term.create({
    data: {
      id: "invalid-term",
      name: "Synthetic term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({
    data: {
      id: "invalid-subject",
      name: "Synthetic Mathematics",
      active: true,
    },
  });
  await db.$transaction((tx) =>
    approveQualification(
      tx,
      "invalid-tutor-tutor",
      "invalid-subject",
      "invalid-head",
    ),
  );
  sendEmail.mockClear();
});
afterAll(() => db.$disconnect());

it("requires a bounded nonblank reason and an explicit nonnegative revision in both directions", () => {
  for (const invalid of [true, false]) {
    expect(
      requestInvalidityInput.safeParse({
        ...flag("entry", 0, invalid),
        reason: " \n ",
      }).success,
    ).toBe(false);
    expect(
      requestInvalidityInput.safeParse({
        ...flag("entry", 0, invalid),
        reason: "x".repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      requestInvalidityInput.safeParse({
        ...flag("entry", 0, invalid),
        expectedInvalidityVersion: -1,
      }).success,
    ).toBe(false);
  }
});

it("flags and clears a public tutor application without changing original evidence or lifecycle", async () => {
  const app = await application("ACCEPTED");
  const userCount = await db.user.count();
  const tutorCount = await db.tutor.count();
  await caller().admin.setApplicationInvalidity(flag(app.id));
  const marked = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  expect(marked).toMatchObject({
    status: "ACCEPTED",
    policySnapshot: app.policySnapshot,
    policyAcceptedAt: app.policyAcceptedAt,
    invalidReason: "Synthetic duplicate request",
    invalidatedById: "invalid-admin",
    invalidatedByName: "Stored ADMIN",
    invalidityVersion: 1,
  });
  await expect(reconcileApplication(db, app.id)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await caller().admin.setApplicationInvalidity(flag(app.id, 1, false));
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }),
  ).toMatchObject({
    status: "ACCEPTED",
    invalidReason: null,
    invalidatedAt: null,
    invalidatedById: null,
    invalidityVersion: 2,
  });
  expect(await db.user.count()).toBe(userCount);
  expect(await db.tutor.count()).toBe(tutorCount);
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
  expect(
    await db.auditLog.findFirst({
      where: {
        operation: "admin.setApplicationInvalidity",
        action: "Cleared public request invalid flag",
      },
    }),
  ).toMatchObject({
    details: {
      reason: "Reviewed corrected entry",
      before: { invalidReason: "Synthetic duplicate request" },
      after: { invalidReason: null },
    },
  });
});

it("rejects stale writes and concurrent duplicate submissions without overwriting the reason", async () => {
  const app = await application();
  const results = await Promise.allSettled([
    caller().admin.setApplicationInvalidity(flag(app.id)),
    caller().admin.setApplicationInvalidity({
      ...flag(app.id),
      reason: "Competing reason",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(
    (await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }))
      .invalidityVersion,
  ).toBe(1);
  await expect(
    caller().admin.setApplicationInvalidity(flag(app.id, 0, false)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("retains coordinator review and rejects unauthorized or out-of-scope changes", async () => {
  const app = await application();
  for (const role of ["VIEWER", "TUTOR", "STUDENT"] as const)
    await expect(
      caller(role).admin.setApplicationInvalidity(flag(app.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const request = await queued(() =>
    caller("COORDINATOR").admin.setApplicationInvalidity(flag(app.id)),
  );
  expect(
    (await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }))
      .invalidatedAt,
  ).toBeNull();
  await caller().approval.decide({
    id: request.id,
    approve: true,
    note: "Reviewed duplicate evidence",
  });
  expect(
    (await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }))
      .invalidatedById,
  ).toBe("invalid-admin");
  const qualification = await db.tutorApplication.create({
    data: {
      type: "ADDITIONAL_SUBJECT",
      name: "Existing tutor",
      email: "additional@example.test",
      requestedTutorId: "invalid-tutor-tutor",
      requestedSubjectId: "invalid-subject",
      qualificationReason: "Add another subject",
    },
  });
  await expect(
    caller().admin.setApplicationInvalidity(flag(qualification.id)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("blocks tutor status, interview processing, deletion and masks review details for observers", async () => {
  const app = await application("INTERVIEW");
  await db.interviewAssignment.create({
    data: {
      applicationId: app.id,
      tutorId: "invalid-head-tutor",
      isHead: true,
    },
  });
  await caller().admin.setApplicationInvalidity(flag(app.id));
  const current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: app.id },
  });
  await expect(
    caller("HEAD").admin.setApplicationStatus({
      id: app.id,
      status: "REJECTED",
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller("HEAD").tutor.setInterviewTime({
      applicationId: app.id,
      interviewAt: new Date(),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller("HEAD").tutor.castInterviewVote({
      applicationId: app.id,
      accept: true,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller("HEAD").tutor.decideInterview({
      applicationId: app.id,
      accept: true,
      comment: "Reviewed",
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().interviewManagement.complete({
      applicationId: app.id,
      durationMin: 30,
      completedAt: new Date(0),
      attendedTutorIds: ["invalid-head-tutor"],
      reason: "Completed",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.deleteApplication({ id: app.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const view = (await caller("VIEWER").admin.tutorApplications()).find(
    (row) => row.id === app.id,
  );
  expect(view).toMatchObject({ isInvalid: true });
  for (const field of [
    "invalidReason",
    "invalidatedAt",
    "invalidatedById",
    "invalidatedByName",
    "invalidityVersion",
  ])
    expect(view).not.toHaveProperty(field);
  expect(JSON.stringify(view)).not.toContain("Synthetic duplicate request");
});

it("preserves tutee priority and payload, hides staff metadata from participant projections and removes actionable counts", async () => {
  const row = await survey();
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
  const marked = await db.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(marked).toMatchObject({
    state: "OPEN",
    submittedAt: row.submittedAt,
    payload: row.payload,
    policySnapshot: row.policySnapshot,
    invalidityVersion: 1,
  });
  expect((await caller().studentWorkflow.adminRequests())[0]).toMatchObject({
    isInvalid: true,
    invalidReason: "Synthetic duplicate request",
  });
  expect((await studentRequestRows(db))[0]).toMatchObject({
    isInvalid: false,
    invalidReason: null,
    invalidatedAt: null,
    invalidityVersion: 0,
  });
  expect(await caller().admin.activitySummary()).toMatchObject({
    unverified: 0,
    matching: 0,
    intakeRows: [],
  });
  await expect(validSurvey(db, token)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    caller().studentWorkflow.resend({ id: row.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await resendSurvey(db, row.email, false);
  expect(sendEmail).not.toHaveBeenCalled();
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id, 1, false));
  expect((await validSurvey(db, token)).id).toBe(row.id);
  expect(await caller().admin.activitySummary()).toMatchObject({
    unverified: 1,
  });
});

it("rejects flagged tutee assignment before consuming its confirmation and permits it after clear", async () => {
  const row = await survey();
  const ticket = await prepareStudentAction(
    db,
    "invalid-admin",
    "ASSIGN",
    row.id,
  );
  await db.studentActionConfirmation.update({
    where: { id: ticket.id },
    data: { readyAt: new Date(0) },
  });
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
  await expect(
    assignStudentRequest(
      db,
      row.id,
      "invalid-admin",
      ticket.id,
      "invalid-subject",
      "invalid-tutor-tutor",
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    (
      await db.studentActionConfirmation.findUniqueOrThrow({
        where: { id: ticket.id },
      })
    ).usedAt,
  ).toBeNull();
  expect(await db.pairing.count()).toBe(0);
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id, 1, false));
  await assignStudentRequest(
    db,
    row.id,
    "invalid-admin",
    ticket.id,
    "invalid-subject",
    "invalid-tutor-tutor",
  );
  expect(await db.pairing.count()).toBe(1);
});

it("gates materialized survey assignment aliases and status activation", async () => {
  const tutee = await db.tutee.create({
    data: {
      englishName: "Synthetic Student",
      status: "PENDING",
      signupSource: "SELF_SERVICE",
      intakeTermId: "invalid-term",
    },
  });
  const row = await survey(tutee.id);
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
  await expect(
    db.$transaction((tx) => assertStudentRequestAssignable(tx, tutee.id)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.setTuteeStatus({
      id: tutee.id,
      status: "ACTIVE",
      expectedUpdatedAt: tutee.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.assignSignup({
      tuteeId: tutee.id,
      expectedUpdatedAt: tutee.updatedAt,
      assignments: [
        {
          subject: "Synthetic Mathematics",
          subjectId: "invalid-subject",
          tutorId: "invalid-tutor-tutor",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.deleteTutee({ id: tutee.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.pairing.count()).toBe(0);
});

it("supports proven legacy public requests but never fabricates review ownership for manual or modern rows", async () => {
  const legacy = await db.tutee.create({
    data: {
      englishName: "Legacy Public",
      status: "PENDING",
      signupSource: "SELF_SERVICE",
      intakeTermId: "invalid-term",
    },
  });
  await caller().admin.setSignupInvalidity(flag(legacy.id));
  expect(
    (await caller().admin.tutees()).find((row) => row.id === legacy.id),
  ).toMatchObject({
    isInvalid: true,
    invalidReason: "Synthetic duplicate request",
  });
  const observer = (await caller("VIEWER").admin.tutees()).find(
    (row) => row.id === legacy.id,
  );
  expect(observer).toMatchObject({ isInvalid: true });
  for (const field of [
    "invalidReason",
    "invalidatedAt",
    "invalidatedById",
    "invalidatedByName",
    "invalidityVersion",
  ])
    expect(observer).not.toHaveProperty(field);
  await expect(
    db.$transaction((tx) => assertStudentRequestAssignable(tx, legacy.id)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.deleteTutee({ id: legacy.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await caller().admin.activitySummary()).toMatchObject({ matching: 0 });
  await caller().admin.setSignupInvalidity(flag(legacy.id, 1, false));
  await db.$transaction((tx) => assertStudentRequestAssignable(tx, legacy.id));
  const manual = await db.tutee.create({
    data: { englishName: "Manual", signupSource: "STAFF" },
  });
  await expect(
    caller().admin.setSignupInvalidity(flag(manual.id)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await survey(legacy.id);
  await expect(
    caller().admin.setSignupInvalidity(flag(legacy.id, 2)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("does not replay an absent legacy-review snapshot after another reviewer flags and clears it", async () => {
  const row = await db.tutee.create({
    data: {
      englishName: "Legacy Public",
      status: "PENDING",
      signupSource: "SELF_SERVICE",
    },
  });
  const proposal = await queued(() =>
    caller("COORDINATOR").admin.setSignupInvalidity(flag(row.id)),
  );
  await caller().admin.setSignupInvalidity(flag(row.id));
  await caller().admin.setSignupInvalidity(flag(row.id, 1, false));
  await expect(
    caller("HEAD").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Review outdated snapshot",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await db.tuteeRequestInvalidity.findUniqueOrThrow({
        where: { tuteeId: row.id },
      })
    ).invalidityVersion,
  ).toBe(2);
});

it("clearing a terminal tutee flag never reopens the request or erases audit evidence", async () => {
  const row = await survey();
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
  await db.studentSurvey.update({
    where: { id: row.id },
    data: { state: "RECALLED", resolvedAt: new Date() },
  });
  await expect(
    caller().studentWorkflow.setRequestInvalidity(flag(row.id, 1)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id, 1, false));
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    state: "RECALLED",
    invalidityVersion: 2,
    invalidatedAt: null,
  });
  expect(
    safeAuditSnapshot(
      { invalidReason: "Synthetic reason", payload: { private: true } },
      "StudentSurvey",
    ),
  ).toEqual({ invalidReason: "Synthetic reason" });
  expect(
    safeAuditSnapshot({ invalidReason: "Unrelated private reason" }, "User"),
  ).toEqual({});
});

it("rejects an old roster activation proposal after the linked survey is flagged and cleared", async () => {
  const tutee = await db.tutee.create({
    data: {
      englishName: "Synthetic Student",
      status: "PENDING",
      signupSource: "SELF_SERVICE",
      intakeTermId: "invalid-term",
    },
  });
  const row = await survey(tutee.id);
  const proposal = await queued(() =>
    caller("COORDINATOR").admin.setTuteeStatus({
      id: tutee.id,
      status: "ACTIVE",
      expectedUpdatedAt: tutee.updatedAt,
    }),
  );
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
  await caller().studentWorkflow.setRequestInvalidity(flag(row.id, 1, false));
  await expect(
    caller().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Old activation evidence",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } })).status,
  ).toBe("PENDING");
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it.each(["survey", "legacy"] as const)(
  "rejects a stale Serializable %s assignment snapshot after a concurrent flag commits",
  async (source) => {
    const tutee = await db.tutee.create({
      data: {
        englishName: "Previously assigned public student",
        status: "ACTIVE",
        signupSource: "SELF_SERVICE",
        intakeTermId: "invalid-term",
        firstChoiceId: "invalid-subject",
        updatedAt: new Date("2026-09-01"),
      },
    });
    const row = source === "survey" ? await survey(tutee.id) : null;
    if (row)
      await db.studentSurvey.update({
        where: { id: row.id },
        data: {
          firstAssignedAt: new Date("2026-09-02"),
          confirmedAt: new Date("2026-09-02"),
        },
      });
    const snapshot = gate(),
      proceed = gate();
    // Approval replay reads evidence before entering its handler. Reproduce that exact
    // stable snapshot, then commit the flag before the processing guard acquires its lock.
    // No source stamp changes on already-assigned surveys, so a write elsewhere cannot
    // substitute for explicitly fencing the source row.
    const attempt = db.$transaction(
      async (tx) => {
        await tx.tutee.findUniqueOrThrow({ where: { id: tutee.id } });
        snapshot.release();
        await proceed.promise;
        await assertStudentRequestAssignable(tx, tutee.id);
        await tx.pairing.create({
          data: {
            tutorId: "invalid-tutor-tutor",
            termId: "invalid-term",
            subject: "Synthetic Mathematics",
            dayOfWeek: 1,
            startMin: 960,
            endMin: 1020,
            tutees: { create: { tuteeId: tutee.id } },
          },
        });
      },
      { isolationLevel: "Serializable", timeout: 10000 },
    );
    const outcome = attempt.then(
      () => null,
      (error: unknown) => {
        snapshot.release();
        return error;
      },
    );
    await snapshot.promise;
    try {
      if (row)
        await caller().studentWorkflow.setRequestInvalidity(flag(row.id));
      else await caller().admin.setSignupInvalidity(flag(tutee.id));
    } finally {
      proceed.release();
    }
    expect(await outcome).toMatchObject({ code: "CONFLICT" });
    expect(await db.pairing.count()).toBe(0);
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } })).status,
    ).toBe("ACTIVE");
  },
);

it("rejects a stale Serializable interview snapshot before writing a child vote", async () => {
  const app = await application("INTERVIEW");
  const snapshot = gate(),
    proceed = gate();
  const attempt = db.$transaction(
    async (tx) => {
      await tx.tutorApplication.findUniqueOrThrow({ where: { id: app.id } });
      snapshot.release();
      await proceed.promise;
      await lockApplicationReview(tx, app.id);
      assertRequestProcessable(
        await tx.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }),
      );
      await tx.interviewVote.create({
        data: {
          applicationId: app.id,
          tutorId: "invalid-head-tutor",
          accept: true,
        },
      });
    },
    { isolationLevel: "Serializable", timeout: 10000 },
  );
  const outcome = attempt.then(
    () => null,
    (error: unknown) => {
      snapshot.release();
      return error;
    },
  );
  await snapshot.promise;
  try {
    await caller().admin.setApplicationInvalidity(flag(app.id));
  } finally {
    proceed.release();
  }
  expect(await outcome).toMatchObject({ code: "CONFLICT" });
  expect(await db.interviewVote.count()).toBe(0);
});
