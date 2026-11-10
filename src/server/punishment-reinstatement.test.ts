import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import { captureRecoveryCheckpoint, withAutomaticRecoveryCheckpoint } from "~/server/recovery/checkpoint";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
assertIsolatedTestDatabase(process.env.DATABASE_URL);

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " + tables.map(({ tablename }) =>
      '"' + tablename.replaceAll('"', '""') + '"',
    ).join(",") + " CASCADE",
  );
});

afterAll(async () => { await db.$disconnect(); });

it.each([false, true])(
  "audit: an upheld card appeal restores punishment removal after harmless notes edit=%s",
  async (editNotes) => {
    const term = await db.term.create({ data: {
      schoolYear: "26-27", quarter: "Q2", name: "Synthetic reinstatement period", active: true,
    } });
    const tutor = await db.tutor.create({ data: {
      englishName: "Synthetic reinstatement tutor", status: "ACTIVE",
    } });
    const learner = await db.tutee.create({ data: {
      englishName: "Synthetic reinstatement learner", status: "ACTIVE",
    } });
    const reviewer = await db.user.create({ data: {
      email: "synthetic-reinstatement-head@example.test", name: "Synthetic Head", role: "HEAD",
    } });
    const pairing = await db.pairing.create({ data: {
      tutorId: tutor.id, termId: term.id, subject: "Synthetic mathematics",
      dayOfWeek: 1, startMin: 900, endMin: 945, scheduleConfirmed: true,
      roomMode: "NONE", tutees: { create: { tuteeId: learner.id } },
    } });
    const firstCard = await db.disciplinaryCard.create({ data: {
      tuteeId: learner.id, color: "RED", source: "AUTO", reason: "Synthetic absence one", reviewStatus: "VALID",
    } });
    await db.disciplinaryCard.create({ data: {
      tuteeId: learner.id, color: "RED", source: "AUTO", reason: "Synthetic absence two", reviewStatus: "VALID",
    } });
    expect(await syncPunishmentRemoval(db, learner.id)).toEqual({ removed: true });
    const removal = await db.tuteeRemovalRequest.findFirstOrThrow({ where: {
      tuteeId: learner.id, kind: "PUNISHMENT", state: "APPROVED",
    } });
    const removed = await db.tutee.findUniqueOrThrow({ where: { id: learner.id } });
    expect(removed.status).toBe("INACTIVE");
    expect(removed.updatedAt.getTime()).toBe(removal.resolvedAt!.getTime());

    const head = createCaller({ db, headers: new Headers(), session: {
      user: { id: reviewer.id }, role: "HEAD", tutorId: null,
      expires: new Date(Date.now() + 60_000).toISOString(),
    } });
    if (editNotes) {
      // A real allowed profile write keeps the exact same participation status.
      await head.admin.updateTutee({
        id: learner.id, englishName: removed.englishName, status: "INACTIVE",
        expectedUpdatedAt: removed.updatedAt, notes: "Corrected synthetic contact note only",
      });
      const edited = await db.tutee.findUniqueOrThrow({ where: { id: learner.id } });
      expect(edited.status).toBe("INACTIVE");
      expect(edited.notes).toBe("Corrected synthetic contact note only");
      expect(edited.updatedAt.getTime()).not.toBe(removal.resolvedAt!.getTime());
    }
    const appeal = await db.studentAppeal.create({ data: {
      studentId: learner.id, cardId: firstCard.id, body: "Synthetic evidence overturns absence one",
    } });
    await head.student.decideAppeal({
      id: appeal.id, expectedUpdatedAt: appeal.updatedAt, overturn: true,
      reason: "Reviewed synthetic evidence; absence one was excused",
    });
    expect(await db.disciplinaryCard.findUniqueOrThrow({ where: { id: firstCard.id } }))
      .toMatchObject({ reviewStatus: "INVALID" });
    expect(await db.studentAppeal.findUniqueOrThrow({ where: { id: appeal.id } }))
      .toMatchObject({ state: "UPHELD" });
    expect(await db.tutee.findUniqueOrThrow({ where: { id: learner.id } }))
      .toMatchObject({ status: "ACTIVE" });
    expect(await db.pairingTutee.count({ where: { pairingId: pairing.id, tuteeId: learner.id } }))
      .toBe(1);
    expect(await db.tuteeRemovalRequest.findUniqueOrThrow({ where: { id: removal.id } }))
      .toMatchObject({ state: "REINSTATED" });
  },
  20000,
);

async function removedLearner(options: { legacy?: boolean; card?: boolean; attendance?: boolean; overlap?: boolean; owner?: boolean; survey?: boolean; mixed?: boolean } = {}) {
  const term = await db.term.create({ data: { schoolYear: "26-27", quarter: "Q2", name: "Synthetic period", active: true } });
  const tutor = await db.tutor.create({ data: { englishName: "Synthetic tutor", status: "ACTIVE" } });
  const learner = await db.tutee.create({ data: {
    englishName: "Synthetic learner", status: "ACTIVE", intakeTermId: term.id,
    signupSource: "STAFF", signupSubmittedAt: new Date("2026-09-01T01:00:00Z"),
  } });
  const owner = options.owner ? await db.user.create({ data: {
    email: "synthetic-owner@example.test", name: learner.englishName,
    role: "STUDENT", tuteeMember: true, studentId: learner.id,
  } }) : null;
  const survey = options.survey ? await db.studentSurvey.create({ data: {
    email: "synthetic-survey@example.test", intakeTermId: term.id, tuteeId: learner.id,
    payload: {}, policyRevision: "synthetic-v1", policySnapshot: {}, tokenHash: "synthetic-token",
    expiresAt: new Date(Date.now() + 86_400_000), confirmedAt: new Date(),
  } }) : null;
  const reviewer = await db.user.create({ data: { email: "synthetic-head@example.test", name: "Synthetic Head", role: "HEAD" } });
  const head = createCaller({ db, headers: new Headers(), session: {
    user: { id: reviewer.id }, role: "HEAD", tutorId: null, expires: new Date(Date.now() + 60_000).toISOString(),
  } });
  const pairing = await db.pairing.create({ data: {
    tutorId: tutor.id, termId: term.id, subject: "Synthetic custom subject", roomMode: "NONE",
    scheduleConfirmed: true, dayOfWeek: 1, startMin: 900, endMin: 945,
    tutees: { create: { tuteeId: learner.id } },
  } });
  // Both joins must exist before the real removal so its journal binds both
  // originals; a later conflict must not erase the still-eligible assignment.
  const otherTutor = options.mixed ? await db.tutor.create({ data: {
    englishName: "Synthetic second original tutor", status: "ACTIVE",
  } }) : null;
  const otherPairing = otherTutor ? await db.pairing.create({ data: {
    tutorId: otherTutor.id, termId: term.id, subject: "Synthetic second original subject", roomMode: "NONE",
    scheduleConfirmed: true, dayOfWeek: 2, startMin: 960, endMin: 1005,
    tutees: { create: { tuteeId: learner.id } },
  } }) : null;
  const session = await db.session.create({ data: {
    pairingId: pairing.id, tutorId: tutor.id, date: new Date("2026-10-01T00:00:00Z"),
    startMin: 900, endMin: 945, month: "2026-10", schoolYear: "26-27", quarter: "Q2",
    durationMin: 45, shFactor: 1, shCount: 0.75,
    ratingPreparedness: 3, ratingParticipation: 3, ratingUnderstanding: 3, ratingBehavior: 3, ratingProgress: 3,
    tutees: { create: { tuteeId: learner.id, status: "PRESENT" } },
  } });
  const otherSession = otherPairing ? await db.session.create({ data: {
    pairingId: otherPairing.id, tutorId: otherPairing.tutorId, date: new Date("2026-10-02T00:00:00Z"),
    startMin: 960, endMin: 1005, month: "2026-10", schoolYear: "26-27", quarter: "Q2",
    durationMin: 45, shFactor: 1, shCount: 0.75,
    tutees: { create: { tuteeId: learner.id, status: "PRESENT" } },
  } }) : null;
  const card = await db.disciplinaryCard.create({ data: { tuteeId: learner.id, color: "RED", source: "AUTO", reviewStatus: "VALID" } });
  const second = await db.disciplinaryCard.create({ data: {
    tuteeId: learner.id, color: "RED", source: "AUTO", reviewStatus: options.card ? "PENDING" : "VALID",
  } });
  const older = options.overlap ? await captureRecoveryCheckpoint(db,
    { adapter: "PARTICIPANT_TUTEE", sourceId: learner.id }, { id: reviewer.id }) : null;
  if (options.legacy) {
    const now = new Date();
    await db.tutee.update({ where: { id: learner.id }, data: { status: "INACTIVE", updatedAt: now } });
    await db.pairingTutee.deleteMany({ where: { tuteeId: learner.id } });
    await db.tuteeRemovalRequest.create({ data: {
      tuteeId: learner.id, kind: "PUNISHMENT", state: "APPROVED", resolvedAt: now, removedPeriodKey: "26-27 Q2",
      pairingSnapshot: { status: "ACTIVE", pairingIds: [pairing.id] },
    } });
  } else if (options.attendance) await db.$transaction((tx) => withAutomaticRecoveryCheckpoint(
    tx, { adapter: "ATTENDANCE", sourceId: session.id }, { id: reviewer.id },
    () => syncPunishmentRemoval(tx, learner.id),
  ), { timeout: 20000 });
  else if (options.card) await head.admin.reviewCard({
    id: second.id, expectedUpdatedAt: second.updatedAt, reviewStatus: "VALID", reviewNote: "Synthetic card reviewed",
  });
  else expect(await syncPunishmentRemoval(db, learner.id)).toEqual({ removed: true });
  const removal = await db.tuteeRemovalRequest.findFirstOrThrow({ where: { tuteeId: learner.id, state: "APPROVED" } });
  const removed = await db.tutee.findUniqueOrThrow({ where: { id: learner.id } });
  expect(removed.updatedAt).toEqual(removal.resolvedAt);
  const edit = async (changes: { status?: "ACTIVE" | "PENDING" | "INACTIVE"; notes?: string; phone?: string }) => {
    const current = await db.tutee.findUniqueOrThrow({ where: { id: learner.id } });
    await head.admin.updateTutee({ id: current.id, englishName: current.englishName,
      status: changes.status ?? current.status, expectedUpdatedAt: current.updatedAt, ...changes });
  };
  const uphold = async () => {
    const appeal = await db.studentAppeal.create({ data: { studentId: learner.id, cardId: card.id, body: "Synthetic appeal evidence" } });
    await head.student.decideAppeal({ id: appeal.id, expectedUpdatedAt: appeal.updatedAt,
      overturn: true, reason: "Verified synthetic evidence overturns the absence" });
    expect(await db.disciplinaryCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({ reviewStatus: "INVALID" });
    expect(await db.studentAppeal.findUniqueOrThrow({ where: { id: appeal.id } })).toMatchObject({ state: "UPHELD" });
  };
  const expectOutcome = async (status: "ACTIVE" | "PENDING" | "INACTIVE", reinstated = false) => {
    const current = await db.tutee.findUniqueOrThrow({ where: { id: learner.id } });
    expect(current).toMatchObject({ status, signupSource: learner.signupSource,
      intakeTermId: learner.intakeTermId, signupSubmittedAt: learner.signupSubmittedAt });
    expect(await db.pairingTutee.count({ where: { pairingId: pairing.id, tuteeId: learner.id } }))
      .toBe(reinstated && status === "ACTIVE" ? 1 : 0);
    expect(await db.tuteeRemovalRequest.findUniqueOrThrow({ where: { id: removal.id } }))
      .toMatchObject({ state: reinstated ? "REINSTATED" : "APPROVED" });
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
    if (otherSession) expect(await db.session.findUniqueOrThrow({ where: { id: otherSession.id } })).toEqual(otherSession);
    expect(await db.sessionTutee.findUniqueOrThrow({ where: { sessionId_tuteeId: { sessionId: session.id, tuteeId: learner.id } } }))
      .toMatchObject({ status: "PRESENT" });
  };
  return { term, tutor, learner, owner, survey, reviewer, head, pairing, otherPairing, older, removed, removal, edit, uphold, expectOutcome };
}

it.each([false, true])("interprets offset-free database removal evidence as UTC under a non-UTC host, notes edit=%s", async (editNotes) => {
  vi.stubEnv("TZ", "Asia/Shanghai");
  try {
    const f = await removedLearner();
    const anchor = await db.recoveryChange.findFirstOrThrow({ where: {
      entity: "Tutee", operation: "UPDATE",
      recordKey: { path: ["id"], equals: f.learner.id },
      AND: [
        { before: { path: ["status"], equals: "ACTIVE" } },
        { after: { path: ["status"], equals: "INACTIVE" } },
      ],
    } });
    const journal = anchor.after as { updatedAt: string };
    // PostgreSQL TIMESTAMP(3) journal snapshots omit a timezone. Prisma's same
    // stored instant is UTC; interpreting that string in the host zone is wrong.
    expect(journal.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/);
    expect(new Date(journal.updatedAt + "Z")).toEqual(f.removal.resolvedAt);
    expect(new Date(journal.updatedAt)).not.toEqual(f.removal.resolvedAt);
    if (editNotes) await f.edit({ notes: "Synthetic harmless note under a non-UTC host" });
    await f.uphold();
    await f.expectOutcome("ACTIVE", true);
  } finally {
    vi.unstubAllEnvs();
  }
}, 20000);

it("restores a contact-only edit under an outer CARD checkpoint and stays idempotent", async () => {
  const f = await removedLearner({ card: true });
  expect(await db.recoveryCheckpoint.count({ where: { adapter: "CARD" } })).toBe(1);
  await f.edit({ phone: "Synthetic office extension" });
  await f.uphold();
  await f.expectOutcome("ACTIVE", true);
  expect(await syncPunishmentRemoval(db, f.learner.id)).toEqual({ removed: false });
  expect(await db.pairingTutee.count({ where: { tuteeId: f.learner.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { operation: "system.reconcilePunishmentRemoval", entityId: f.removal.id } })).toBe(1);
}, 20000);

it("recognizes a nested punishment consequence under the ordinary ATTENDANCE checkpoint shape", async () => {
  const f = await removedLearner({ attendance: true });
  expect(await db.recoveryCheckpoint.count({ where: { adapter: "ATTENDANCE" } })).toBe(1);
  await f.edit({ notes: "Synthetic harmless note after attendance action" });
  await f.uphold();
  await f.expectOutcome("ACTIVE", true);
}, 20000);

it("uses the owning removal root when an older overlapping checkpoint was compensated", async () => {
  const f = await removedLearner({ overlap: true });
  await db.recoveryReceipt.create({ data: { actionId: f.older!.actionId, actorId: f.reviewer.id,
    clientKey: randomUUID(), inputHash: "a".repeat(64), fingerprint: "b".repeat(64),
    reason: "Synthetic unrelated older compensation", channel: "SYNTHETIC", evidence: {} } });
  await f.edit({ notes: "Synthetic harmless later note" });
  await f.uphold();
  await f.expectOutcome("ACTIVE", true);
}, 20000);

it.each(["PENDING", "ACTIVE", "AWAY_BACK"] as const)("preserves a later real Head status decision: %s", async (decision) => {
  const f = await removedLearner();
  await f.edit({ status: decision === "ACTIVE" ? "ACTIVE" : "PENDING" });
  if (decision === "AWAY_BACK") await f.edit({ status: "INACTIVE" });
  await f.uphold();
  await f.expectOutcome(decision === "AWAY_BACK" ? "INACTIVE" : decision);
}, 20000);

it("detects raw status away-and-back even when updatedAt stays identical", async () => {
  const f = await removedLearner();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Tutee" SET status='PENDING' WHERE id=${f.learner.id}`;
    await tx.$executeRaw`UPDATE "Tutee" SET status='INACTIVE', "updatedAt"=${f.removed.updatedAt} WHERE id=${f.learner.id}`;
  });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it.each([false, true])("withholds historical removal without prospective proof, profile edit=%s", async (edit) => {
  const f = await removedLearner({ legacy: true });
  if (edit) await f.edit({ notes: "Synthetic legacy profile correction" });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it("withholds ambiguous or malformed prospective approval evidence", async () => {
  const f = await removedLearner();
  const approval = await db.recoveryChange.findFirstOrThrow({ where: {
    entity: "TuteeRemovalRequest", operation: "UPDATE", recordKey: { path: ["id"], equals: f.removal.id },
  } });
  // Append an unsupported synthetic claim; never edit immutable real evidence.
  await db.recoveryChange.create({ data: { actionId: approval.actionId, eventId: approval.eventId,
    entity: approval.entity, operation: "UPDATE", recordKey: { id: f.removal.id },
    before: { tuteeId: f.learner.id, state: "PENDING" }, after: { tuteeId: f.learner.id, state: "APPROVED" } } });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it("withholds a compensated root whose later writes no longer acquire descendants", async () => {
  const f = await removedLearner();
  const approval = await db.recoveryChange.findFirstOrThrow({ where: {
    entity: "TuteeRemovalRequest", operation: "UPDATE", recordKey: { path: ["id"], equals: f.removal.id },
  } });
  await db.recoveryReceipt.create({ data: { actionId: approval.actionId, actorId: f.reviewer.id,
    clientKey: randomUUID(), inputHash: "a".repeat(64), fingerprint: "b".repeat(64),
    reason: "Synthetic reviewed compensation", channel: "SYNTHETIC", evidence: {} } });
  const count = await db.recoveryChange.count({ where: { actionId: approval.actionId } });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Tutee" SET status='PENDING' WHERE id=${f.learner.id}`;
    await tx.$executeRaw`UPDATE "Tutee" SET status='INACTIVE', "updatedAt"=${f.removed.updatedAt} WHERE id=${f.learner.id}`;
  });
  expect(await db.recoveryChange.count({ where: { actionId: approval.actionId } })).toBe(count);
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it.each([false, true])("rejects snapshot substitution even after original snapshot is restored=%s", async (back) => {
  const f = await removedLearner();
  const other = await db.pairing.create({ data: { tutorId: f.tutor.id, termId: f.term.id,
    subject: "Synthetic independent subject", dayOfWeek: 2, startMin: 900, endMin: 945, roomMode: "NONE" } });
  await db.tuteeRemovalRequest.update({ where: { id: f.removal.id }, data: {
    pairingSnapshot: { status: "ACTIVE", pairingIds: [other.id] },
  } });
  if (back) await db.tuteeRemovalRequest.update({ where: { id: f.removal.id }, data: {
    pairingSnapshot: { status: "ACTIVE", pairingIds: [f.pairing.id] },
  } });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
  expect(await db.pairingTutee.count({ where: { pairingId: other.id } })).toBe(0);
}, 20000);

it.each(["request", "schedule", "identity", "ownership"] as const)("keeps a later %s away-and-back decision", async (decision) => {
  const f = await removedLearner();
  if (decision === "request") {
    await db.tuteeRemovalRequest.update({ where: { id: f.removal.id }, data: { state: "REINSTATED" } });
    await db.tuteeRemovalRequest.update({ where: { id: f.removal.id }, data: { state: "APPROVED" } });
  } else if (decision === "schedule") {
    await db.pairing.update({ where: { id: f.pairing.id }, data: { dayOfWeek: 2 } });
    await db.pairing.update({ where: { id: f.pairing.id }, data: { dayOfWeek: 1 } });
  } else if (decision === "identity") {
    const person = await db.person.create({ data: {} });
    await db.tutee.update({ where: { id: f.learner.id }, data: { personId: person.id } });
    await db.tutee.update({ where: { id: f.learner.id }, data: { personId: null } });
  } else {
    await db.studentProfileOwnership.create({ data: { tuteeId: f.learner.id, userId: f.reviewer.id } });
    await db.studentProfileOwnership.delete({ where: { tuteeId: f.learner.id } });
  }
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it.each(["policy", "payload"] as const)("rejects immutable signup %s substitution without inventing a later participation decision", async (field) => {
  const f = await removedLearner({ survey: true });
  const original = await db.studentSurvey.findUniqueOrThrow({ where: { id: f.survey!.id } });
  const recordedChanges = await db.recoveryChange.count();
  await expect(db.studentSurvey.update({
    where: { id: original.id },
    data: field === "policy" ? { policyRevision: "synthetic-v2" } : { payload: { syntheticChangedAnswer: true } },
  })).rejects.toThrow("Original student signup and policy evidence cannot be changed");
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  // A rejected immutable write rolls back its journal too. It cannot become an
  // independent decision that suppresses an otherwise eligible restoration.
  expect(await db.recoveryChange.count()).toBe(recordedChanges);
  await f.uphold();
  await f.expectOutcome("ACTIVE", true);
}, 20000);

it.each(["ABORTED", "DISQUALIFIED", "INVALID", "EXPIRED"] as const)("keeps an independent signup boundary: %s", async (boundary) => {
  const f = await removedLearner({ survey: true });
  await db.studentSurvey.update({ where: { id: f.survey!.id }, data:
    boundary === "INVALID" ? { invalidatedAt: new Date() } : boundary === "EXPIRED" ?
      { confirmedAt: null, verificationDueAt: new Date("2000-01-01T00:00:00Z") } : { state: boundary },
  });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it.each(["review", "block"] as const)("keeps a later approved withdrawal %s with unchanged INACTIVE status", async (boundary) => {
  const f = await removedLearner();
  if (boundary === "review") await db.studentRequestReview.create({ data: {
    legacyTuteeId: f.learner.id, legacyIntakeTermId: f.term.id,
    requestedByUserId: f.reviewer.id, kind: "STUDENT_ABORT", state: "APPROVED",
    reason: "Synthetic independently reviewed withdrawal",
  } });
  else await db.studentQuarterBlock.create({ data: {
    email: "synthetic-block@example.test", legacyTuteeId: f.learner.id, intakeTermId: f.term.id,
  } });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it("keeps a real school departure after removal without any new Tutee timestamp", async () => {
  const f = await removedLearner({ owner: true });
  await f.head.departure.setState({ userId: f.owner!.id, action: "TRANSFERRED", expectedRevision: 0,
    explanation: "Synthetic confirmed school transfer" });
  expect((await db.tutee.findUniqueOrThrow({ where: { id: f.learner.id } })).updatedAt).toEqual(f.removed.updatedAt);
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it("does not restore an old punishment into a later period", async () => {
  const f = await removedLearner();
  await db.term.update({ where: { id: f.term.id }, data: { active: false } });
  await db.term.create({ data: { schoolYear: "26-27", quarter: "Q3", name: "Synthetic next period", active: true } });
  await f.uphold();
  await f.expectOutcome("INACTIVE");
}, 20000);

it.each(["archived tutor", "schedule conflict"] as const)("restores PENDING without reenrollment after %s", async (boundary) => {
  const f = await removedLearner();
  if (boundary === "archived tutor") await db.tutor.update({ where: { id: f.tutor.id }, data: { status: "ARCHIVED" } });
  else await db.pairing.create({ data: { tutorId: f.tutor.id, termId: f.term.id, subject: "Synthetic independent block",
    dayOfWeek: 1, startMin: 900, endMin: 945, scheduleConfirmed: true, roomMode: "NONE" } });
  await f.uphold();
  await f.expectOutcome("PENDING", true);
}, 20000);

it("restores the eligible original while skipping a conflicting original assignment", async () => {
  const f = await removedLearner({ mixed: true });
  const originalPairings: unknown = expect.arrayContaining([f.pairing.id, f.otherPairing!.id]);
  expect(f.removal.pairingSnapshot).toEqual({
    status: "ACTIVE", pairingIds: originalPairings,
  });
  expect(await db.pairingTutee.count({ where: { tuteeId: f.learner.id } })).toBe(0);
  const conflicting = await db.pairing.create({ data: {
    tutorId: f.otherPairing!.tutorId, termId: f.term.id, subject: "Synthetic independent conflicting block",
    dayOfWeek: f.otherPairing!.dayOfWeek, startMin: f.otherPairing!.startMin, endMin: f.otherPairing!.endMin,
    scheduleConfirmed: true, roomMode: "NONE",
  } });
  await f.edit({ notes: "Synthetic harmless note while reviewing two originals" });
  await f.uphold();
  // The common assertion also preserves intake priority and both completed
  // sessions' hours; only the eligible original roster join returns.
  await f.expectOutcome("ACTIVE", true);
  expect(await db.pairingTutee.findMany({ where: { tuteeId: f.learner.id }, select: { pairingId: true } }))
    .toEqual([{ pairingId: f.pairing.id }]);
  expect(await db.pairingTutee.count({ where: {
    tuteeId: f.learner.id, pairingId: { in: [f.otherPairing!.id, conflicting.id] },
  } })).toBe(0);
}, 20000);
