import { afterAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  beginAdmissionRecoveryCapture,
  finishAdmissionRecoveryCapture,
} from "./capture";
import {
  applyAdmissionRecovery,
  applyAdmissionRecoveryFromOperator,
  inspectAdmissionRecovery,
} from "./admission";
import { reconcileApplication } from "~/server/tutors/application-status";
import {
  completeRegistration,
  hashCode,
  registrationCompletionProof,
} from "~/server/auth/registration";
import { stampStudentAssignment } from "~/server/student-request-state";
import { updateAccountProfile } from "~/server/account-profile";
import { readNextRecruitment } from "~/server/program/next-recruitment";
import { scheduleProgramRefresh } from "~/server/program/scheduled-refresh";

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
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
      id: "term",
      name: "Recovery Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.user.createMany({
    data: [
      { id: "admin", role: "ADMIN", email: "admin@example.test" },
      { id: "head", role: "HEAD", email: "head@example.test" },
      {
        id: "coordinator",
        role: "COORDINATOR",
        email: "coordinator@example.test",
      },
    ],
  });
});
afterAll(() => db.$disconnect());

async function admission(options: { existingStudent?: boolean } = {}) {
  if (options.existingStudent) {
    await db.tutee.create({
      data: {
        id: "prior-student",
        englishName: "Prior Candidate",
        status: "ACTIVE",
      },
    });
    await db.user.create({
      data: {
        id: "prior-user",
        role: "STUDENT",
        email: "candidate@example.test",
        firstName: "Synthetic",
        lastName: "Candidate",
        name: "Synthetic Candidate",
        studentId: "prior-student",
        tuteeMember: true,
        emailVerifiedAt: new Date(),
        passwordHash: "unchanged-independent-credential",
      },
    });
  }
  const application = await db.tutorApplication.create({
    data: {
      name: "Synthetic Candidate",
      firstName: "Synthetic",
      lastName: "Candidate",
      email: "candidate@example.test",
      status: "INTERVIEW",
      interviewCompletedAt: new Date("2026-09-18T03:00:00Z"),
      interviewDurationMin: 45,
    },
  });
  const actionId = await db.$transaction(async (tx) => {
    const action = await beginAdmissionRecoveryCapture(tx, application.id);
    await tx.tutorApplication.update({
      where: { id: application.id },
      data: {
        status: "ACCEPTED",
        decidedAt: new Date(),
        decisionComment: "Approved",
      },
    });
    await reconcileApplication(tx, application.id);
    await finishAdmissionRecoveryCapture(tx, action);
    return action!;
  });
  const current = await db.tutorApplication.findUniqueOrThrow({
    where: { id: application.id },
  });
  return {
    actionId,
    applicationId: application.id,
    tutorId: current.promotedTutorId!,
  };
}

async function register(applicationId: string) {
  const pending = await db.registrationCode.findFirstOrThrow({
    where: { applicationId, usedAt: null, expiresAt: { gt: new Date() } },
  });
  const verifiedAt = new Date();
  const row = await db.registrationCode.update({
    where: { id: pending.id },
    data: {
      pendingEmail: "candidate@example.test",
      emailCodeHash: hashCode("0123"),
      emailCodeExpiresAt: new Date(Date.now() + 600000),
      emailVerifiedAt: verifiedAt,
    },
  });
  const recipient = await db.user.findUnique({
    where: { email: "candidate@example.test" },
    select: { id: true },
  });
  const result = await completeRegistration(
    row,
    {
      firstName: "Synthetic",
      lastName: "Candidate",
      password: "SyntheticPassword123!",
      gradeLevel: null,
      completionProof: registrationCompletionProof(
        "invitation",
        row.id,
        row.emailCodeHash!,
        verifiedAt,
      ),
      // The production invitation wrapper resolves the mailbox-proved recipient
      // and supplies this internal account identity, including unfinished logins.
      authenticatedUserId: recipient?.id,
    },
    db,
  );
  expect(result.ok).toBe(true);
  return db.user.findUniqueOrThrow({
    where: { email: "candidate@example.test" },
  });
}

async function assignment(tutorId: string, suffix = "one", tuteeId?: string) {
  const student = tuteeId ?? "student-" + suffix;
  if (!tuteeId)
    await db.tutee.create({
      data: {
        id: student,
        englishName: "Independent student " + suffix,
        status: "ACTIVE",
      },
    });
  const pairing = await db.$transaction((tx) =>
    tx.pairing.create({
      data: {
        tutorId,
        termId: "term",
        subject: "Synthetic Mathematics",
        roomMode: "NONE",
        dayOfWeek: 1,
        startMin: 600,
        endMin: 660,
        tutees: { create: { tuteeId: student } },
      },
    }),
  );
  return { pairingId: pairing.id, tuteeId: student };
}
const intent = (
  plan: Awaited<ReturnType<typeof inspectAdmissionRecovery>>,
) => ({
  actionId: plan.actionId,
  expectedFingerprint: plan.fingerprint,
  clientKey: randomUUID(),
  reason: "Voiding mistaken initial admission",
});

it("preserves a real later profile edit and its mirrors without keeping private values in the journal", async () => {
  const source = await admission({ existingStudent: true });
  await updateAccountProfile(
    db,
    "prior-user",
    { firstName: "Corrected", lastName: "Candidate" },
    { management: true },
  );
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 1,
    websiteEligible: true,
  });
  expect(plan.events.at(-1)?.disposition).toBe("PRESERVED");
  const changes = await db.recoveryChange.findMany({
    where: { actionId: source.actionId, entity: "User", operation: "UPDATE" },
  });
  expect(
    changes.some(
      (change) =>
        Array.isArray(change.changedFields) &&
        change.changedFields.includes("firstName"),
    ),
  ).toBe(true);
  expect(
    JSON.stringify(changes, (_key, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    ),
  ).not.toContain("Corrected");
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "prior-user" } }),
  ).toMatchObject({
    firstName: "Corrected",
    role: "STUDENT",
    passwordHash: "unchanged-independent-credential",
  });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: "prior-student" } }),
  ).toMatchObject({ firstName: "Corrected" });
});

it("preserves independent staff access, security changes and suspension after registration", async () => {
  const source = await admission();
  const user = await register(source.applicationId);
  const suspendedAt = new Date("2026-10-27T01:00:00Z");
  await db.user.update({
    where: { id: user.id },
    data: {
      role: "COORDINATOR",
      passwordHash: "new-independent-password",
      canTranslate: true,
      suspendedAt,
      twoFactorEnabled: true,
    },
  });
  const independentEpoch = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).refreshAuthorityRevision;
  expect(independentEpoch).toBeGreaterThan(user.refreshAuthorityRevision);
  expect(await db.recoveryChange.findFirst({ where: {
    actionId: source.actionId, entity: "User", changedFields: { array_contains: ["refreshAuthorityRevision"] },
  } })).not.toBeNull();
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 2,
    websiteEligible: false,
  });
  await expect(
    applyAdmissionRecovery(db, intent(plan), { id: "admin" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await applyAdmissionRecoveryFromOperator(db, intent(plan), { id: "admin" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({
    role: "COORDINATOR",
    passwordHash: "new-independent-password",
    canTranslate: true,
    suspendedAt,
    twoFactorEnabled: true,
    tutorAccessRevoked: true,
    recoveryVoidedAt: null,
    refreshAuthorityRevision: independentEpoch,
  });
});

it("requires the schedule table journal even when no schedule rows exist", async () => {
  const source = await admission();
  expect(await inspectAdmissionRecovery(db, source)).toMatchObject({ coverage: "COMPLETE", websiteEligible: true });
  await db.$executeRawUnsafe('ALTER TABLE "ScheduledProgramRefresh" DISABLE TRIGGER recovery_change_journal');
  try {
    const plan = await inspectAdmissionRecovery(db, source);
    expect(plan).toMatchObject({ coverage: "UNKNOWN", websiteEligible: false });
    expect(plan.blockers.join(" ")).toContain("ScheduledProgramRefresh");
  } finally {
    await db.$executeRawUnsafe('ALTER TABLE "ScheduledProgramRefresh" ENABLE TRIGGER recovery_change_journal');
  }
});

it("journals a related approved schedule as unsupported work instead of compensating past it", async () => {
  const source = await admission({ existingStudent: true });
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: "head" }, data: { role: "ADMIN" } });
    await tx.user.update({ where: { id: "prior-user" }, data: { role: "HEAD" } });
  });
  const snapshot = await readNextRecruitment(db);
  const scheduled = await scheduleProgramRefresh(db, {
    confirm: "REFRESH", expectedTermId: "term", expectedPreparation: snapshot.refreshEvidence,
    expectedScheduleVersion: 0, executeAt: new Date(Date.now() + 3_600_000),
  }, { id: "prior-user" });
  const change = await db.recoveryChange.findFirstOrThrow({ where: {
    actionId: source.actionId, entity: "ScheduledProgramRefresh", operation: "INSERT",
  } });
  expect(change.recordKey).toMatchObject({ id: scheduled.id, authorizedById: "prior-user" });
  expect(change.after).not.toHaveProperty("expectedPreparation");
  expect(change.after).not.toHaveProperty("authorizedByName");
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({ coverage: "UNKNOWN", websiteEligible: false });
  await expect(applyAdmissionRecoveryFromOperator(db, intent(plan), { id: "admin" }))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await db.scheduledProgramRefresh.findUniqueOrThrow({ where: { id: scheduled.id } })).state).toBe("SCHEDULED");
});

it("voids admission-only credentials even after an independent password change", async () => {
  const source = await admission();
  const user = await register(source.applicationId);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: "replacement-admission-password" },
  });
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan.coverage).toBe("COMPLETE");
  await applyAdmissionRecoveryFromOperator(db, intent(plan), { id: "admin" });
  const voided = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(voided.passwordHash).toBeNull();
  expect(voided.recoveryVoidedAt).not.toBeNull();
});

it("preserves a later learning-partner account edit without treating that login as admission access", async () => {
  const source = await admission();
  await db.tutee.create({
    data: { id: "independent-learner", englishName: "Learner" },
  });
  await db.user.create({
    data: {
      id: "learner-login",
      email: "learner@example.test",
      role: "STUDENT",
      studentId: "independent-learner",
      tuteeMember: true,
      passwordHash: "learner-password",
    },
  });
  await assignment(source.tutorId, "learner", "independent-learner");
  await db.user.update({
    where: { id: "learner-login" },
    data: { name: "Corrected Learner", emailMessages: true },
  });
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan.coverage).toBe("COMPLETE");
  expect(plan.effects.accountIds).not.toContain("learner-login");
  await applyAdmissionRecoveryFromOperator(db, intent(plan), { id: "admin" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "learner-login" } }),
  ).toMatchObject({
    name: "Corrected Learner",
    emailMessages: true,
    passwordHash: "learner-password",
    recoveryVoidedAt: null,
  });
});

it("accepts an already revoked source code without restoring its authorization", async () => {
  const source = await admission();
  const code = await db.registrationCode.findFirstOrThrow({
    where: { applicationId: source.applicationId },
  });
  await db.registrationCode.update({
    where: { id: code.id },
    data: { expiresAt: new Date(0) },
  });
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 1,
    websiteEligible: true,
  });
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    (
      await db.registrationCode.findUniqueOrThrow({ where: { id: code.id } })
    ).expiresAt.getTime(),
  ).toBe(0);
});

it("refuses an independently extended authorization and mixed unsupported edits", async () => {
  const source = await admission();
  const code = await db.registrationCode.findFirstOrThrow({
    where: { applicationId: source.applicationId },
  });
  await db.registrationCode.update({
    where: { id: code.id },
    data: { expiresAt: new Date(code.expiresAt.getTime() + 86400000) },
  });
  expect((await inspectAdmissionRecovery(db, source)).coverage).toBe("UNKNOWN");
  await db.$transaction(async (tx) => {
    await tx.tutor.update({
      where: { id: source.tutorId },
      data: { englishName: "Corrected", status: "PENDING" },
    });
  });
  const plan = await inspectAdmissionRecovery(db, source);
  await expect(
    applyAdmissionRecoveryFromOperator(db, intent(plan), { id: "admin" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("keeps preference changes in history while enforcing the inactive tutor workload rule", async () => {
  const source = await admission();
  await db.tutor.update({
    where: { id: source.tutorId },
    data: {
      preferredAssignedBlocks: 3,
      workloadPreferenceVersion: { increment: 1 },
    },
  });
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({ coverage: "COMPLETE", dependentEventCount: 1 });
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } }),
  ).toMatchObject({ status: "ARCHIVED", preferredAssignedBlocks: 0 });
  expect(
    await db.recoveryChange.count({
      where: {
        actionId: source.actionId,
        after: { path: ["preferredAssignedBlocks"], equals: 3 },
      },
    }),
  ).toBeGreaterThan(0);
});

it("voids a zero-descendant admission, retaining interview facts and expiring its exact codes", async () => {
  const source = await admission();
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    websiteEligible: true,
    dependentEventCount: 0,
  });
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.tutorApplication.findUniqueOrThrow({
      where: { id: source.applicationId },
    }),
  ).toMatchObject({
    status: "INTERVIEW",
    interviewDurationMin: 45,
    decisionComment: null,
  });
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } }),
  ).toMatchObject({ status: "ARCHIVED" });
  expect(
    (
      await db.registrationCode.findFirstOrThrow({
        where: { applicationId: source.applicationId },
      })
    ).expiresAt.getTime(),
  ).toBe(0);
  expect(await db.recoveryReceipt.count()).toBe(1);
});

it("voids one real registration event, permanently fences its new login and preserves immutable evidence", async () => {
  const source = await admission();
  const user = await register(source.applicationId);
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 1,
    websiteEligible: true,
  });
  expect(JSON.stringify(plan)).not.toContain(user.passwordHash);
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  const voided = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(voided.passwordHash).toBeNull();
  expect(voided.recoveryVoidedAt).not.toBeNull();
  expect(voided.sessionVersion).toBeGreaterThan(user.sessionVersion);
  await expect(
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: "cannot-revive" },
    }),
  ).rejects.toThrow();
  await expect(
    db.user.update({
      where: { id: user.id },
      data: { recoveryVoidedAt: null },
    }),
  ).rejects.toThrow();
  await expect(db.recoveryReceipt.deleteMany()).rejects.toThrow();
  expect(
    await db.auditLog.count({ where: { operation: "recovery.voidAdmission" } }),
  ).toBe(1);
});

it("restores existing student access while preserving its credentials, membership and account", async () => {
  const source = await admission({ existingStudent: true });
  const plan = await inspectAdmissionRecovery(db, source);
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "prior-user" } }),
  ).toMatchObject({
    role: "STUDENT",
    studentId: "prior-student",
    tuteeMember: true,
    tutorId: null,
    recoveryVoidedAt: null,
    passwordHash: "unchanged-independent-credential",
  });
});

it("counts a multirow assignment as one event and preserves an independently assigned student's ACTIVE state", async () => {
  const source = await admission();
  await db.tutor.create({
    data: {
      id: "independent-tutor",
      englishName: "Other tutor",
      status: "ACTIVE",
    },
  });
  const other = await assignment("independent-tutor", "shared");
  await db.user.create({
    data: {
      id: "student-account",
      role: "STUDENT",
      email: "student@example.test",
      studentId: other.tuteeId,
      tuteeMember: true,
      passwordHash: "student-password",
    },
  });
  const own = await assignment(source.tutorId, "own", other.tuteeId);
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({ coverage: "COMPLETE", dependentEventCount: 1 });
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.pairingTutee.count({ where: { pairingId: own.pairingId } }),
  ).toBe(0);
  expect(
    await db.pairingTutee.count({ where: { pairingId: other.pairingId } }),
  ).toBe(1);
  expect(
    await db.messageTutorAssignment.count({
      where: { tuteeId: other.tuteeId, tutorId: source.tutorId },
    }),
  ).toBe(0);
  expect(
    await db.messageTutorAssignment.count({
      where: { tuteeId: other.tuteeId, tutorId: "independent-tutor" },
    }),
  ).toBe(1);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: other.tuteeId } }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: "student-account" } }),
  ).toMatchObject({ passwordHash: "student-password", recoveryVoidedAt: null });
});

it("requires the trusted operator route for two logical descendants even when input forges a CLI flag", async () => {
  const source = await admission();
  await register(source.applicationId);
  await assignment(source.tutorId);
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 2,
    websiteEligible: false,
  });
  const input = { ...intent(plan), cli: true };
  await expect(
    applyAdmissionRecovery(db, input, { id: "admin" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.recoveryReceipt.count()).toBe(0);
  await applyAdmissionRecoveryFromOperator(db, input, { id: "admin" });
  expect((await db.recoveryReceipt.findFirstOrThrow()).channel).toBe(
    "OPERATOR",
  );
});

it("invalidates a preview when a new descendant commits", async () => {
  const source = await admission();
  const plan = await inspectAdmissionRecovery(db, source);
  await assignment(source.tutorId);
  await expect(
    applyAdmissionRecovery(db, intent(plan), { id: "admin" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("observes change-away-and-back and blocks unsupported downstream history", async () => {
  const source = await admission();
  const before = await inspectAdmissionRecovery(db, source);
  await db.tutor.update({
    where: { id: source.tutorId },
    data: { status: "PENDING" },
  });
  await db.tutor.update({
    where: { id: source.tutorId },
    data: { status: "ACTIVE" },
  });
  const after = await inspectAdmissionRecovery(db, source);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.coverage).toBe("UNKNOWN");
  await expect(
    applyAdmissionRecoveryFromOperator(db, intent(after), { id: "head" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("replays the durable receipt after response loss and rejects key reuse with another intent", async () => {
  const source = await admission();
  const input = intent(await inspectAdmissionRecovery(db, source));
  const applied = await applyAdmissionRecovery(db, input, { id: "admin" });
  expect(await applyAdmissionRecovery(db, input, { id: "admin" })).toEqual({
    ...applied,
    replayed: true,
  });
  await expect(
    applyAdmissionRecovery(
      db,
      { ...input, reason: "A changed reason cannot reuse this key" },
      { id: "admin" },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.recoveryReceipt.count()).toBe(1);
});

it("rolls back both compensation and receipt on a transaction failure, permitting a safe retry", async () => {
  const source = await admission();
  const input = intent(await inspectAdmissionRecovery(db, source));
  await expect(
    db.$transaction(async (tx) => {
      await applyAdmissionRecovery(tx, input, { id: "admin" });
      throw new Error("synthetic transaction failure");
    }),
  ).rejects.toThrow("synthetic transaction failure");
  expect(await db.recoveryReceipt.count()).toBe(0);
  expect(
    (
      await db.tutorApplication.findUniqueOrThrow({
        where: { id: source.applicationId },
      })
    ).status,
  ).toBe("ACCEPTED");
  await applyAdmissionRecovery(db, input, { id: "admin" });
});

it("checks current authority rather than accepting a coordinator or demoted account", async () => {
  const source = await admission();
  const input = intent(await inspectAdmissionRecovery(db, source));
  await expect(
    applyAdmissionRecovery(db, input, { id: "coordinator" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "admin" }, data: { role: "VIEWER" } });
  await expect(
    applyAdmissionRecoveryFromOperator(db, input, { id: "admin" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("does not fabricate provenance for legacy admissions", async () => {
  await expect(
    inspectAdmissionRecovery(db, { actionId: "legacy-audit-id" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("allows a fresh independent admission generation to reauthorize retained credentials without restoring the old password", async () => {
  const first = await admission();
  const oldUser = await register(first.applicationId);
  await applyAdmissionRecovery(
    db,
    intent(await inspectAdmissionRecovery(db, first)),
    { id: "admin" },
  );
  const second = await admission();
  const restored = await register(second.applicationId);
  expect(restored.id).toBe(oldUser.id);
  expect(restored.recoveryVoidedAt).toBeNull();
  expect(restored.passwordHash).not.toBeNull();
  expect(restored.passwordHash).not.toBe(oldUser.passwordHash);
  expect(restored.sessionVersion).toBeGreaterThan(oldUser.sessionVersion);
  const plan = await inspectAdmissionRecovery(db, second);
  expect(plan.coverage).toBe("COMPLETE");
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: oldUser.id } }))
      .recoveryVoidedAt,
  ).not.toBeNull();
});

it("serializes competing applies into a single compensation and immutable receipt", async () => {
  const source = await admission();
  const input = intent(await inspectAdmissionRecovery(db, source));
  const results = await Promise.allSettled([
    applyAdmissionRecovery(db, input, { id: "admin" }),
    applyAdmissionRecovery(db, input, { id: "admin" }),
  ]);
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(await db.recoveryReceipt.count()).toBe(1);
  expect(
    await db.auditLog.count({ where: { operation: "recovery.voidAdmission" } }),
  ).toBe(1);
  expect(
    (
      await db.tutorApplication.findUniqueOrThrow({
        where: { id: source.applicationId },
      })
    ).status,
  ).toBe("INTERVIEW");
});

it("does not poison a preserved student's future independent assignments after void", async () => {
  const source = await admission();
  const own = await assignment(source.tutorId);
  await applyAdmissionRecovery(
    db,
    intent(await inspectAdmissionRecovery(db, source)),
    { id: "admin" },
  );
  await db.tutor.create({
    data: {
      id: "future-tutor",
      englishName: "Future independent tutor",
      status: "ACTIVE",
    },
  });
  await assignment("future-tutor", "future", own.tuteeId);
  expect(await db.pairingTutee.count({ where: { tuteeId: own.tuteeId } })).toBe(
    1,
  );
});

it("keeps finalized source and monotonic journal evidence immutable", async () => {
  const source = await admission();
  await expect(
    db.recoveryAction.update({
      where: { id: source.actionId },
      data: { before: { fabricated: true } },
    }),
  ).rejects.toThrow();
  await expect(
    db.recoveryAction.update({
      where: { id: source.actionId },
      data: { after: { fabricated: true } },
    }),
  ).rejects.toThrow();
  await expect(
    db.recoveryEvent.deleteMany({ where: { actionId: source.actionId } }),
  ).rejects.toThrow();
  await expect(
    db.recoveryChange.deleteMany({ where: { actionId: source.actionId } }),
  ).rejects.toThrow();
  await expect(
    db.recoveryTrackedEntity.deleteMany({
      where: { actionId: source.actionId },
    }),
  ).rejects.toThrow();
});

it("legacy reconciliation does not confuse an additional qualification with an independent initial admission", async () => {
  const source = await admission();
  await db.subject.create({
    data: { id: "additional-subject", name: "Independent subject" },
  });
  await db.tutorApplication.create({
    data: {
      name: "Independent subject review",
      email: "candidate@example.test",
      type: "ADDITIONAL_SUBJECT",
      requestedTutorId: source.tutorId,
      requestedSubjectId: "additional-subject",
      qualificationReason: "Independent subject qualification",
      status: "ACCEPTED",
      qualificationDecidedById: "head",
      qualificationSnapshot: {},
      decidedAt: new Date(),
      decisionComment: "Approved subject",
    },
  });
  const link = await assignment(source.tutorId);
  await db.$transaction(async (tx) => {
    await tx.tutorApplication.update({
      where: { id: source.applicationId },
      data: { status: "INTERVIEW" },
    });
    await reconcileApplication(tx, source.applicationId);
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } }))
      .status,
  ).toBe("ARCHIVED");
  expect(
    await db.pairingTutee.count({ where: { pairingId: link.pairingId } }),
  ).toBe(0);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: link.tuteeId } })).status,
  ).toBe("PENDING");
});

it("legacy reconciliation preserves ACTIVE students with another qualifying current assignment", async () => {
  const source = await admission();
  await db.tutor.create({
    data: {
      id: "other-active",
      englishName: "Independent tutor",
      status: "ACTIVE",
    },
  });
  const own = await assignment(source.tutorId);
  const other = await assignment("other-active", "other", own.tuteeId);
  await db.$transaction(async (tx) => {
    await tx.tutorApplication.update({
      where: { id: source.applicationId },
      data: { status: "INTERVIEW" },
    });
    await reconcileApplication(tx, source.applicationId);
  });
  expect(
    await db.pairingTutee.count({ where: { pairingId: own.pairingId } }),
  ).toBe(0);
  expect(
    await db.pairingTutee.count({ where: { pairingId: other.pairingId } }),
  ).toBe(1);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: own.tuteeId } })).status,
  ).toBe("ACTIVE");
});

it("restores the first-assignment verification clock only when its causal assignments are all released", async () => {
  const source = await admission();
  await db.tutee.create({
    data: {
      id: "clock-student",
      englishName: "Clock student",
      status: "ACTIVE",
    },
  });
  await db.studentSurvey.create({
    data: {
      id: "clock-survey",
      tuteeId: "clock-student",
      email: "clock@example.test",
      intakeTermId: "term",
      payload: {},
      policyRevision: "synthetic",
      policySnapshot: {},
      tokenHash: "synthetic-clock-token",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.$transaction(async (tx) => {
    await tx.pairing.create({
      data: {
        tutorId: source.tutorId,
        termId: "term",
        subject: "Clock test",
        roomMode: "NONE",
        dayOfWeek: 1,
        startMin: 600,
        endMin: 660,
        tutees: { create: { tuteeId: "clock-student" } },
      },
    });
    await stampStudentAssignment(tx, "clock-student");
  });
  expect(
    (
      await db.studentSurvey.findUniqueOrThrow({
        where: { id: "clock-survey" },
      })
    ).firstAssignedAt,
  ).not.toBeNull();
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 1,
    effects: { verificationClockIds: ["clock-survey"] },
  });
  await applyAdmissionRecovery(db, intent(plan), { id: "admin" });
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: "clock-survey" } }),
  ).toMatchObject({ firstAssignedAt: null, verificationDueAt: null });
});

it("binds same-application reapproval to its fresh authorization generation", async () => {
  const source = await admission();
  const user = await register(source.applicationId);
  const oldCode = await db.registrationCode.findFirstOrThrow({
    where: { applicationId: source.applicationId },
  });
  await applyAdmissionRecovery(
    db,
    intent(await inspectAdmissionRecovery(db, source)),
    { id: "admin" },
  );
  const nextActionId = await db.$transaction(async (tx) => {
    const actionId = await beginAdmissionRecoveryCapture(
      tx,
      source.applicationId,
    );
    await tx.tutorApplication.update({
      where: { id: source.applicationId },
      data: { status: "ACCEPTED" },
    });
    await reconcileApplication(tx, source.applicationId);
    await finishAdmissionRecoveryCapture(tx, actionId);
    return actionId!;
  });
  const nextPlan = await inspectAdmissionRecovery(db, {
    actionId: nextActionId,
  });
  expect(nextPlan.effects.registrationCodeCount).toBe(1);
  const restored = await register(source.applicationId);
  expect(restored.id).toBe(user.id);
  const registered = await inspectAdmissionRecovery(db, {
    actionId: nextActionId,
  });
  expect(registered).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 1,
  });
  await assignment(source.tutorId, "readmission");
  const assigned = await inspectAdmissionRecovery(db, {
    actionId: nextActionId,
  });
  expect(assigned).toMatchObject({
    coverage: "COMPLETE",
    dependentEventCount: 2,
  });
  await applyAdmissionRecoveryFromOperator(db, intent(assigned), {
    id: "admin",
  });
  expect(
    (
      await db.registrationCode.findUniqueOrThrow({ where: { id: oldCode.id } })
    ).usedAt?.toISOString(),
  ).toBe(oldCode.usedAt?.toISOString());
});

it("journals transitions INTO tracked identities using new foreign keys as well as old ones", async () => {
  await db.tutor.create({
    data: { id: "unrelated", englishName: "Unrelated tutor", status: "ACTIVE" },
  });
  const unrelated = await assignment("unrelated", "unrelated");
  await db.user.create({
    data: {
      id: "unrelated-user",
      role: "STUDENT",
      email: "unrelated@example.test",
    },
  });
  const source = await admission();
  const before = await inspectAdmissionRecovery(db, source);
  await db.pairing.update({
    where: { id: unrelated.pairingId },
    data: { tutorId: source.tutorId },
  });
  await db.user.update({
    where: { id: "unrelated-user" },
    data: { tutorId: source.tutorId },
  });
  const after = await inspectAdmissionRecovery(db, source);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.coverage).toBe("UNKNOWN");
  expect(
    await db.recoveryChange.count({
      where: {
        actionId: source.actionId,
        entity: "User",
        operation: "UPDATE",
        recordKey: { path: ["id"], equals: "unrelated-user" },
      },
    }),
  ).toBeGreaterThan(0);
  expect(
    await db.recoveryChange.count({
      where: {
        actionId: source.actionId,
        entity: "Pairing",
        operation: "UPDATE",
        recordKey: { path: ["id"], equals: unrelated.pairingId },
      },
    }),
  ).toBeGreaterThan(0);
});

it("does not label a second independent admission as the first root's own source event", async () => {
  const first = await admission();
  const second = await admission();
  const firstPlan = await inspectAdmissionRecovery(db, first);
  expect(
    firstPlan.events.filter((event) => event.kind === "ADMISSION"),
  ).toHaveLength(1);
  expect(firstPlan).toMatchObject({
    coverage: "UNKNOWN",
    dependentEventCount: 1,
  });
  expect(firstPlan.events.some((event) => event.kind === "UNSUPPORTED")).toBe(
    true,
  );
  await expect(
    applyAdmissionRecoveryFromOperator(db, intent(firstPlan), { id: "admin" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    (
      await db.tutorApplication.findUniqueOrThrow({
        where: { id: second.applicationId },
      })
    ).status,
  ).toBe("ACCEPTED");
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: second.tutorId } }))
      .status,
  ).toBe("ACTIVE");
});

it("does not invent committed events for composite inserts skipped by ON CONFLICT", async () => {
  const source = await admission();
  const link = await assignment(source.tutorId);
  const before = await inspectAdmissionRecovery(db, source);
  await db.pairingTutee.createMany({
    data: { pairingId: link.pairingId, tuteeId: link.tuteeId },
    skipDuplicates: true,
  });
  const after = await inspectAdmissionRecovery(db, source);
  expect(after.dependentEventCount).toBe(before.dependentEventCount);
  expect(after.fingerprint).toBe(before.fingerprint);
});

it("fails closed when an origin journal trigger is changed to replica-only", async () => {
  const source = await admission();
  await db.$executeRawUnsafe(
    'ALTER TABLE "Tutor" ENABLE REPLICA TRIGGER recovery_change_journal',
  );
  try {
    const plan = await inspectAdmissionRecovery(db, source);
    expect(plan.coverage).toBe("UNKNOWN");
    expect(plan.blockers.join(" ")).toContain("Tutor");
  } finally {
    await db.$executeRawUnsafe(
      'ALTER TABLE "Tutor" ENABLE TRIGGER recovery_change_journal',
    );
  }
});

it("fails closed for a replica session even when every trigger is present", async () => {
  const source = await admission();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const plan = await inspectAdmissionRecovery(tx, source);
    expect(plan.coverage).toBe("UNKNOWN");
    expect(plan.blockers.join(" ")).toContain("origin database session");
  });
});

it("rejects a stale Serializable snapshot after a separately committed descendant", async () => {
  const source = await admission();
  const preview = await inspectAdmissionRecovery(db, source);
  let createdPairingId = "";
  await expect(
    db.$transaction(
      async (tx) => {
        // Establish the old snapshot without touching the namespace fence. The raw
        // assignment writer participates through the journal's persistent tuple.
        await tx.recoveryAction.findUniqueOrThrow({
          where: { id: source.actionId },
        });
        createdPairingId = (await assignment(source.tutorId, "concurrent"))
          .pairingId;
        return applyAdmissionRecovery(tx, intent(preview), { id: "admin" });
      },
      { isolationLevel: "Serializable" },
    ),
  ).rejects.toThrow();
  expect(await db.recoveryReceipt.count()).toBe(0);
  expect(
    await db.pairingTutee.count({ where: { pairingId: createdPairingId } }),
  ).toBe(1);
  expect(
    (
      await db.tutorApplication.findUniqueOrThrow({
        where: { id: source.applicationId },
      })
    ).status,
  ).toBe("ACCEPTED");
  await applyAdmissionRecovery(
    db,
    intent(await inspectAdmissionRecovery(db, source)),
    { id: "admin" },
  );
});
