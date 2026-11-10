import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "./db";
import { createCaller } from "./api/root";
import { ApprovalQueued } from "./approvals";
import { declineLegacySignup } from "./legacy-signup-decline";
import { assertNoPublishedTuteeDeletion } from "./session-planning/deletion-guards";
import { assertStudentRequestAssignable } from "./student-request-state";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { classifyApproval } from "~/lib/approval-policy";

const termId = "decline-current";
const caller = (role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: `decline-${role}`,
        name: "Untrusted cookie name",
        email: `${role.toLowerCase()}@example.test`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: (["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "STUDENT"] as const).map(
      (role) => ({
        id: `decline-${role}`,
        role,
        name: `Stored ${role}`,
        email: `${role.toLowerCase()}@example.test`,
      }),
    ),
  });
  await db.term.createMany({
    data: [
      {
        id: termId,
        name: "Current",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
      {
        id: "decline-history",
        name: "History",
        schoolYear: "25-26",
        quarter: "Q4",
        active: false,
      },
    ],
  });
  await db.subject.create({
    data: { id: "decline-math", name: "Synthetic Mathematics" },
  });
  await db.timeSlot.create({
    data: {
      id: "decline-slot",
      label: "Known Monday",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.tutor.create({
    data: {
      id: "decline-tutor",
      englishName: "Synthetic Tutor",
      status: "ACTIVE",
    },
  });
  await db.tutorQualification.create({
    data: {
      tutorId: "decline-tutor",
      subjectId: "decline-math",
      status: "APPROVED",
      approvedById: "decline-ADMIN",
      grants: { create: { subjectId: "decline-math" } },
    },
  });
});
afterAll(() => db.$disconnect());

async function fixture(
  options: {
    source?: "SELF_SERVICE" | "STAFF" | "UNKNOWN";
    undated?: boolean;
    assigned?: boolean;
  } = {},
) {
  const row = await db.tutee.create({
    data: {
      id: "decline-source",
      englishName: "Known intake name",
      firstName: "Known",
      lastName: "Intake",
      email: "source@example.test",
      preferredContact: "Original contact",
      phone: "Synthetic phone",
      signupSource: options.source ?? "SELF_SERVICE",
      status: "PENDING",
      intakeTermId: options.undated ? null : termId,
      signupSubmittedAt: new Date("2026-10-01T01:02:03Z"),
      firstChoiceId: "decline-math",
      gradeLevel: "10",
      signedRulebook: true,
      signatureName: "Known signature",
      signedAt: new Date("2026-10-01T01:02:03Z"),
      availabilities: { create: { slotId: "decline-slot" } },
    },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: row.id, userId: "decline-STUDENT" },
  });
  await db.user.update({
    where: { id: "decline-STUDENT" },
    data: { studentId: row.id, tuteeMember: true },
  });
  for (const [id, period] of [
    ["decline-old-pairing", "decline-history"],
    ...(options.assigned ? [["decline-current-pairing", termId]] : []),
  ])
    await db.pairing.create({
      data: {
        id: id!,
        termId: period!,
        tutorId: "decline-tutor",
        subject: "Synthetic Mathematics",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
        tutees: { create: { tuteeId: row.id } },
      },
    });
  const source = await db.tutee.findUniqueOrThrow({ where: { id: row.id } });
  return {
    source,
    input: {
      id: source.id,
      expectedUpdatedAt: source.updatedAt,
      clientKey: randomUUID(),
    },
  };
}

async function proposal(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw new Error("Expected a retained Coordinator proposal");
}

it("retains the exact known intake, ownership and historical links while releasing current partial assignments", async () => {
  const { source, input } = await fixture({ assigned: true });
  const result = await caller().admin.declineSignup(input);
  expect(result.decline).toMatchObject({
    state: "DECLINED",
    termId,
    resolvedById: "decline-ADMIN",
    resolvedByName: "Stored ADMIN",
  });
  expect(result.decline.snapshot.source).toMatchObject({
    englishName: source.englishName,
    intakeTermId: termId,
    signupSubmittedAt: source.signupSubmittedAt!.toISOString(),
    signedRulebook: true,
    signatureName: "Known signature",
    preferredContact: "Original contact",
    firstChoice: { id: "decline-math", name: "Synthetic Mathematics" },
  });
  expect(result.decline.snapshot.availability).toEqual([
    {
      id: "decline-slot",
      label: "Known Monday",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  ]);
  expect(result.decline.snapshot.ownership).toMatchObject({
    userId: "decline-STUDENT",
    retainedOwnerId: "decline-STUDENT",
  });
  expect(
    result.decline.snapshot.pairings.map(({ id, removed }) => ({
      id,
      removed,
    })),
  ).toEqual([
    { id: "decline-current-pairing", removed: true },
    { id: "decline-old-pairing", removed: false },
  ]);
  const after = await db.tutee.findUniqueOrThrow({ where: { id: source.id } });
  expect(after).toEqual({
    ...source,
    status: "INACTIVE",
    updatedAt: after.updatedAt,
  });
  expect(
    await db.pairingTutee.findMany({ where: { tuteeId: source.id } }),
  ).toEqual([{ pairingId: "decline-old-pairing", tuteeId: source.id }]);
  expect(await db.pairing.count()).toBe(2);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "decline-STUDENT" } }),
  ).toMatchObject({ studentId: source.id, tuteeMember: true });
  expect(
    await db.studentProfileOwnership.findUnique({
      where: { tuteeId: source.id },
    }),
  ).toMatchObject({ userId: "decline-STUDENT" });
  expect(
    (await caller().admin.tutees()).find((row) => row.id === source.id),
  ).toMatchObject({ signupDecline: result.decline });
  const audits = await db.auditLog.findMany({
    where: { operation: "admin.declineSignup" },
  });
  expect(
    audits.some(
      (row) =>
        row.entity === "LegacySignupDecline" && row.userId === "decline-ADMIN",
    ),
  ).toBe(true);
});

it("keeps an undated source's unknown intake period separate from its known decision period", async () => {
  const { input } = await fixture({ undated: true });
  const result = await caller().admin.declineSignup(input);
  expect(result.decline.snapshot.source.intakeTermId).toBeNull();
  expect(result.decline.termId).toBe(termId);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: input.id } }))
      .intakeTermId,
  ).toBeNull();
});

it("replays an exact receipt after response loss without repeating the decision and rejects another intent", async () => {
  const { input } = await fixture();
  const first = await caller().admin.declineSignup(input);
  expect(await caller().admin.declineSignup(input)).toEqual(first);
  expect(await db.legacySignupDecline.count()).toBe(1);
  await expect(
    caller().admin.declineSignup({ ...input, clientKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().admin.declineSignup({ ...input, expectedUpdatedAt: new Date(0) }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("serializes simultaneous exact retries into one retained decision", async () => {
  const { input } = await fixture();
  const results = await Promise.all([
    caller().admin.declineSignup(input),
    caller().admin.declineSignup(input),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.legacySignupDecline.count()).toBe(1);
});

it("rolls back the decision, roster status and current detachment together", async () => {
  const { source, input } = await fixture({ assigned: true });
  await expect(
    db.$transaction(async (tx) => {
      await declineLegacySignup(tx, "decline-ADMIN", input);
      throw new Error("Synthetic rollback");
    }),
  ).rejects.toThrow("Synthetic rollback");
  expect(await db.legacySignupDecline.count()).toBe(0);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: source.id } }),
  ).toEqual(source);
  expect(await db.pairingTutee.count({ where: { tuteeId: source.id } })).toBe(
    2,
  );
});

it("preserves the original public-request review policy and applies only after Admin review", async () => {
  const { source, input } = await fixture({ assigned: true });
  const queued = await proposal(() =>
    caller("COORDINATOR").admin.declineSignup(input),
  );
  expect(queued.operation).toBe("admin.declineSignup");
  expect(await db.legacySignupDecline.count()).toBe(0);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: source.id } }),
  ).toEqual(source);
  await expect(
    caller("COORDINATOR").approval.decide({
      id: queued.id,
      approve: true,
      note: "Cannot review own proposal",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().approval.decide({
    id: queued.id,
    approve: true,
    note: "Reviewed retained source and affected current links",
  });
  expect(
    await db.legacySignupDecline.findUnique({ where: { tuteeId: source.id } }),
  ).toMatchObject({ resolvedById: "decline-ADMIN" });
});

it.each(["STAFF", "UNKNOWN"] as const)(
  "preserves reviewed Coordinator %s decline policy without direct write authority",
  async (source) => {
    const { source: before, input } = await fixture({ source });
    expect(classifyApproval("admin.declineSignup", input)).toEqual(
      classifyApproval("admin.deleteTutee", { id: input.id }),
    );
    const queued = await proposal(() =>
      caller("COORDINATOR").admin.declineSignup(input),
    );
    expect(queued.operation).toBe("admin.declineSignup");
    expect(await db.legacySignupDecline.count()).toBe(0);
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: input.id } }),
    ).toEqual(before);
    await expect(
      caller("COORDINATOR").approval.decide({
        id: queued.id,
        approve: true,
        note: "No direct decision authority",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller().approval.decide({
      id: queued.id,
      approve: true,
      note: "Admin reviewed retained legacy signup decline",
    });
    expect(
      await db.legacySignupDecline.findUniqueOrThrow({
        where: { tuteeId: input.id },
      }),
    ).toMatchObject({
      resolvedById: "decline-ADMIN",
      resolvedByName: "Stored ADMIN",
    });
    expect(
      (await db.tutee.findUniqueOrThrow({ where: { id: input.id } })).status,
    ).toBe("INACTIVE");
  },
);

it.each(["STAFF", "UNKNOWN", "SELF_SERVICE"] as const)(
  "refuses direct Coordinator execution for %s intake",
  async (source) => {
    const { source: before, input } = await fixture({ source, assigned: true });
    await expect(
      declineLegacySignup(db, "decline-COORDINATOR", input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.legacySignupDecline.count()).toBe(0);
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: input.id } }),
    ).toEqual(before);
    expect(await db.pairingTutee.count({ where: { tuteeId: input.id } })).toBe(
      2,
    );
  },
);

it("rechecks live execution authority after an initially admitted Admin has been demoted", async () => {
  const { source: before, input } = await fixture({
    source: "STAFF",
    assigned: true,
  });
  await db.user.update({
    where: { id: "decline-ADMIN" },
    data: { role: "COORDINATOR" },
  });
  await expect(
    declineLegacySignup(db, "decline-ADMIN", input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.legacySignupDecline.count()).toBe(0);
  expect(await db.tutee.findUniqueOrThrow({ where: { id: input.id } })).toEqual(
    before,
  );
  expect(await db.pairingTutee.count({ where: { tuteeId: input.id } })).toBe(2);
});

it("rejects approval drift when a legacy review appears without changing the roster version", async () => {
  const { input } = await fixture();
  const queued = await proposal(() =>
    caller("COORDINATOR").admin.declineSignup(input),
  );
  await db.studentRequestReview.create({
    data: {
      legacyTuteeId: input.id,
      legacyIntakeTermId: termId,
      kind: "STUDENT_ABORT",
      requestedByUserId: "decline-STUDENT",
      reason: "Independent pending request",
    },
  });
  await expect(
    caller().approval.decide({
      id: queued.id,
      approve: true,
      note: "Stale review",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.legacySignupDecline.count()).toBe(0);
});

it.each(["STUDENT_ABORT", "SCHEDULE_CONFLICT"] as const)(
  "retains a pending %s review rather than resolving it implicitly",
  async (kind) => {
    const { source, input } = await fixture();
    const review = await db.studentRequestReview.create({
      data: {
        legacyTuteeId: input.id,
        legacyIntakeTermId: termId,
        kind,
        requestedByUserId: "decline-STUDENT",
        reason: "Pending source-owned review",
      },
    });
    await expect(caller().admin.declineSignup(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      await db.studentRequestReview.findUniqueOrThrow({
        where: { id: review.id },
      }),
    ).toEqual(review);
    expect(
      await db.tutee.findUniqueOrThrow({ where: { id: input.id } }),
    ).toEqual(source);
  },
);

it("retains pending tutor-removal review authority", async () => {
  const { input } = await fixture();
  await db.tuteeRemovalRequest.create({
    data: { tuteeId: input.id, reason: "Pending tutor request" },
  });
  await expect(caller().admin.declineSignup(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(await db.legacySignupDecline.count()).toBe(0);
});

it.each(["source", "target"] as const)(
  "rejects an active consolidated execution %s",
  async (end) => {
    const { input } = await fixture();
    await db.participantConsolidation.create({
      data: {
        kind: "TUTEE",
        sourceId: end === "source" ? input.id : "other-source",
        targetId: end === "target" ? input.id : "other-target",
        active: true,
        receiptId: "synthetic-transfer",
        effectiveAt: new Date(),
      },
    });
    await expect(caller().admin.declineSignup(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(await db.legacySignupDecline.count()).toBe(0);
  },
);

it("preserves the separate attendance refusal and retained source", async () => {
  const { source, input } = await fixture({ assigned: true });
  await db.session.create({
    data: {
      id: "decline-attendance",
      pairingId: "decline-current-pairing",
      tutorId: "decline-tutor",
      date: new Date("2026-10-02"),
      startMin: 900,
      endMin: 960,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      tutees: { create: { tuteeId: input.id } },
    },
  });
  await expect(caller().admin.declineSignup(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message:
      "Cannot decline a signup with attendance history. Use its participation controls instead.",
  });
  expect(await db.legacySignupDecline.count()).toBe(0);
  expect(await db.tutee.findUniqueOrThrow({ where: { id: input.id } })).toEqual(
    source,
  );
  expect(await db.pairingTutee.count({ where: { tuteeId: input.id } })).toBe(2);
  expect(await db.sessionTutee.count({ where: { tuteeId: input.id } })).toBe(1);
});

it.each([
  { status: "SCHEDULED", originalDate: "2000-01-01" },
  { status: "SCHEDULED", originalDate: "2099-01-01" },
  { status: "CANCELLED", originalDate: "2000-01-01" },
  { status: "CANCELLED", originalDate: "2099-01-01" },
])(
  "uses caller-specific publication refusals for $status evidence on $originalDate without changing protected records",
  async ({ status, originalDate }) => {
    const { input } = await fixture({ assigned: true });
    await db.subject.create({
      data: { id: "decline-science", name: "Synthetic Science" },
    });
    const source = await db.tutee.update({
      where: { id: input.id },
      data: { secondChoiceId: "decline-science" },
    });
    const declineInput = { ...input, expectedUpdatedAt: source.updatedAt };
    await expect(
      assertNoPublishedTuteeDeletion(db, input.id),
    ).resolves.toBeUndefined();
    await expect(
      assertNoPublishedTuteeDeletion(db, input.id, "declineSignup"),
    ).resolves.toBeUndefined();
    // Stage retained guard evidence, not a normal publication workflow.
    await db.sessionPlan.create({
      data: {
        id: "decline-plan",
        generationKey: "decline-plan",
        tutorId: "decline-tutor",
        termId,
        originalDate,
        timeZone: "Asia/Shanghai",
        sourceFingerprint: "synthetic",
        participants: { create: { tuteeId: input.id, status } },
      },
    });
    const protectedRecords = async () => ({
      source: await db.tutee.findUniqueOrThrow({ where: { id: input.id } }),
      pairings: await db.pairingTutee.findMany({
        where: { tuteeId: input.id },
        orderBy: { pairingId: "asc" },
      }),
      ownership: await db.studentProfileOwnership.findUniqueOrThrow({
        where: { tuteeId: input.id },
      }),
      account: await db.user.findUniqueOrThrow({
        where: { id: "decline-STUDENT" },
      }),
      availability: await db.tuteeAvailability.findMany({
        where: { tuteeId: input.id },
        orderBy: { slotId: "asc" },
      }),
      publication: await db.sessionPlan.findUniqueOrThrow({
        where: { id: "decline-plan" },
        include: { participants: true },
      }),
      declines: await db.legacySignupDecline.findMany({
        where: { tuteeId: input.id },
      }),
      attendance: await db.sessionTutee.findMany({
        where: { tuteeId: input.id },
      }),
    });
    const before = await protectedRecords();
    for (const action of [
      {
        operation: "admin.declineSignup",
        invoke: () => caller("HEAD").admin.declineSignup(declineInput),
        message:
          "Cannot decline a signup with published dated-session records. Review its participation controls instead.",
      },
      {
        operation: "admin.deleteTutee",
        invoke: () => caller("HEAD").admin.deleteTutee({ id: input.id }),
        message:
          "Cannot delete a tutee with published dated-session records. Set them inactive and preserve the session history instead.",
      },
    ]) {
      const priorAudits = await db.auditLog.findMany({
        orderBy: { id: "asc" },
      });
      await expect(action.invoke()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: action.message,
      });
      expect(await protectedRecords()).toEqual(before);
      const afterAudits = await db.auditLog.findMany({
        orderBy: { id: "asc" },
      });
      const priorIds = new Set(priorAudits.map(({ id }) => id));
      expect(afterAudits.filter(({ id }) => priorIds.has(id))).toEqual(
        priorAudits,
      );
      const attempts = afterAudits.filter(({ id }) => !priorIds.has(id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        operation: action.operation,
        kind: "ATTEMPT",
        userId: "decline-HEAD",
        details: {
          outcome: "FAILED",
          errorCode: "BAD_REQUEST",
          applied: false,
        },
      });
    }
  },
);

it("rejects stale, historical, invalid and survey-backed inputs without creating decision evidence", async () => {
  const { input } = await fixture();
  await expect(
    caller().admin.declineSignup({ ...input, expectedUpdatedAt: new Date(0) }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await db.tuteeRequestInvalidity.create({
    data: {
      tuteeId: input.id,
      invalidatedAt: new Date(),
      invalidityVersion: 1,
    },
  });
  await expect(caller().admin.declineSignup(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await db.tuteeRequestInvalidity.deleteMany();
  const historical = await db.tutee.update({
    where: { id: input.id },
    data: { intakeTermId: "decline-history" },
  });
  await expect(
    caller().admin.declineSignup({
      ...input,
      expectedUpdatedAt: historical.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const current = await db.tutee.update({
    where: { id: input.id },
    data: { intakeTermId: termId },
  });
  await db.studentSurvey.create({
    data: {
      email: "source@example.test",
      intakeTermId: termId,
      tuteeId: input.id,
      payload: {},
      policyRevision: "synthetic",
      policySnapshot: {},
      tokenHash: "d".repeat(64),
      expiresAt: new Date("2099-01-01"),
    },
  });
  await expect(
    caller().admin.declineSignup({
      ...input,
      expectedUpdatedAt: current.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.legacySignupDecline.count()).toBe(0);
});

it("blocks legacy assignment/status aliases, raw roster reactivation and deletion after decline", async () => {
  const { input } = await fixture();
  await caller().admin.declineSignup(input);
  const source = await db.tutee.findUniqueOrThrow({ where: { id: input.id } });
  await expect(
    db.$transaction((tx) => assertStudentRequestAssignable(tx, input.id)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.setTuteeStatus({
      id: input.id,
      status: "PENDING",
      expectedUpdatedAt: source.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.assignSignup({
      tuteeId: input.id,
      expectedUpdatedAt: source.updatedAt,
      assignments: [
        {
          subject: "Synthetic Mathematics",
          subjectId: "decline-math",
          tutorId: "decline-tutor",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.assignTuteeToTutor({
      tuteeId: input.id,
      tutorId: "decline-tutor",
      termId,
      subject: "Synthetic Mathematics",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller().admin.deleteTutee({ id: input.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    db.tutee.update({ where: { id: input.id }, data: { status: "ACTIVE" } }),
  ).rejects.toThrow(/Declined signup/);
  await db.pairing.create({
    data: {
      id: "decline-new-pairing",
      termId,
      tutorId: "decline-tutor",
      subject: "Synthetic Mathematics",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await expect(
    db.pairingTutee.create({
      data: { pairingId: "decline-new-pairing", tuteeId: input.id },
    }),
  ).rejects.toThrow(/Declined signup/);
  await expect(
    db.tutee.update({
      where: { id: input.id },
      data: { notes: "Later authorized metadata correction" },
    }),
  ).resolves.toMatchObject({ status: "INACTIVE" });
  expect(await db.legacySignupDecline.count()).toBe(1);
});

it("withholds the entire decision property from observers and grants no participant decision access", async () => {
  const { input } = await fixture();
  await caller().admin.declineSignup(input);
  const observer = (await caller("VIEWER").admin.tutees()).find(
    (row) => row.id === input.id,
  );
  expect(observer).not.toHaveProperty("signupDecline");
  expect(JSON.stringify(observer)).not.toContain("Known signature");
  await expect(
    caller("STUDENT").admin.declineSignup(input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("allows a separately admitted new source without rewriting the retained declined profile", async () => {
  const { input } = await fixture();
  const decision = await caller().admin.declineSignup(input);
  const fresh = await db.tutee.create({
    data: {
      englishName: "Fresh intake",
      email: "source@example.test",
      status: "PENDING",
      signupSource: "SELF_SERVICE",
      intakeTermId: termId,
    },
  });
  await expect(
    db.$transaction((tx) => assertStudentRequestAssignable(tx, fresh.id)),
  ).resolves.toBeUndefined();
  expect(
    (
      await db.legacySignupDecline.findUniqueOrThrow({
        where: { tuteeId: input.id },
      })
    ).intakeSnapshot,
  ).toEqual(decision.decline.snapshot);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: input.id } })).status,
  ).toBe("INACTIVE");
});
