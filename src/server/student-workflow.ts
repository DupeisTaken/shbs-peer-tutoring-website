import { createHash, randomUUID } from "node:crypto";
import { confirmationDelayMs } from "~/lib/confirmation-timing";
import {
  notificationList,
  notificationSchedule,
} from "~/lib/notification-facts";
import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { requireStudentSchoolParticipation } from "./school-departure";
import { executionParticipantId, executionPairingId, supersededPairingIds } from "./participant-execution";
import { admitStudentRequestExecution, releaseStudentRequestExecution, studentRequestExecutionAssignments } from "./student-request-execution";
import { currentStudentSignupPayload } from "./student-signup-answers";
import { synchronizeStudentSignupAnswers } from "./student-signup-revisions";
import { lockCatalogue } from "./qualifications";
import { withRecoveryDeliverySource, type RecoveryDeliverySource } from "./recovery/delivery-effects";
import {
  assertRequestProcessable,
  lockStudentRequestReview,
  requestInvalidity,
} from "~/server/request-invalidity";
import { findAccountPolicy } from "./policy-acceptance";
import { enforceAssignmentQualification } from "./assignment-qualification";
import { applyQuarterWithdrawal, lockQuarterWithdrawalScope } from "./student-quarter-withdrawal";
import { TRPCError } from "@trpc/server";
import { approvalScope } from "./db-scope";
import { ownedStudentIds } from "./student-ownership";
import type { DomainDb, TransactionDb } from "./transactions";
import { inTransaction, lockEntity } from "./transactions";
import {
  currentPolicy,
  publishedPolicy,
  requirePolicy,
} from "./policy-acceptance";
import {
  applicablePolicySlugs,
  policyActionTarget,
  type PolicySlug,
} from "~/lib/policy-evidence";
import {
  materializeStudent,
  surveyInput,
  resendSurveyResult,
} from "./student-survey";
import {
  closeStudentRequest,
  expireStudentRequests,
  notifyRequest,
  studentScheduleDetail,
  stampStudentAssignment,
} from "./student-request-state";

function fail(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}
export const actionNames = [
  "RECALL",
  "ABORT",
  "SURVEY_ABORT",
  "SCHEDULE",
  "APPROVE",
  "DENY",
  "POLICY",
  "ASSIGN",
  "SIGNUP_EDIT",
  "SIGNUP_UNASSIGN",
  "SIGNUP_APPEAL",
] as const;
export type StudentAction = (typeof actionNames)[number];

// Old servers cannot consume this internal action as ordinary ABORT proof.
// The versioned ID preserves its exact-receipt contract after proof collection.
const surveyAbortProofAction = "SURVEY_ABORT_V1";
function isReceiptBoundAbortTicket(ticket: string) {
  return /^survey-abort-v1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    ticket,
  );
}

export async function prepareStudentAction(
  db: DomainDb,
  userId: string,
  action: StudentAction,
  target: string,
) {
  const now = Date.now();
  // Bound ticket storage and make every popup opening start a fresh deliberate delay.
  await db.studentActionConfirmation.deleteMany({
    where: { userId, expiresAt: { lt: new Date(now) } },
  });
  const ticket = await db.studentActionConfirmation.create({
    data: {
      ...(action === "SURVEY_ABORT"
        ? { id: `survey-abort-v1:${randomUUID()}` }
        : {}),
      userId,
      action: action === "SURVEY_ABORT" ? surveyAbortProofAction : action,
      target,
      readyAt: new Date(now + confirmationDelayMs[action]),
      expiresAt: new Date(now + 30 * 60_000),
    },
    select: { id: true, readyAt: true, expiresAt: true },
  });
  return { ...ticket, serverNow: new Date() };
}

/** Cancelling a local review can remove only the caller's unused proof. A submitted
 * proof survives dialog handoff and is consumed atomically by the actual operation. */
export function cancelStudentAction(db: DomainDb, userId: string, id: string) {
  return db.studentActionConfirmation.deleteMany({
    where: { id, userId, usedAt: null },
  });
}

export async function consumeStudentAction(
  tx: TransactionDb,
  id: string,
  userId: string,
  action: StudentAction,
  target: string,
) {
  if (action === "SURVEY_ABORT" && !isReceiptBoundAbortTicket(id))
    fail(
      "Read the confirmation and wait for its timer before confirming. Reopen it if it expired.",
    );
  const now = new Date();
  const claimed = await tx.studentActionConfirmation.updateMany({
    where: {
      id,
      userId,
      action: action === "SURVEY_ABORT" ? surveyAbortProofAction : action,
      target,
      readyAt: { lte: now },
      expiresAt: { gt: now },
      usedAt: null,
    },
    data: { usedAt: now },
  });
  if (!claimed.count)
    fail(
      "Read the confirmation and wait for its timer before confirming. Reopen it if it expired.",
    );
}

async function lockedRequest(tx: TransactionDb, id: string) {
  const initial = await tx.studentSurvey.findUnique({ where: { id } });
  if (!initial) throw new TRPCError({ code: "NOT_FOUND" });
  await lockStudentRequestReview(tx, initial);
  await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${initial.intakeTermId} FOR SHARE`;
  const row = await tx.studentSurvey.findUniqueOrThrow({ where: { id } });
  const term = await tx.term.findUnique({ where: { id: row.intakeTermId } });
  if (!term?.active || row.state !== "OPEN")
    fail(
      "This request is processed or belongs to an ended quarter. It cannot be reactivated.",
    );
  if (
    !row.confirmedAt &&
    row.verificationDueAt &&
    row.verificationDueAt <= new Date()
  )
    fail("The verification deadline passed. Submit a new request.");
  return row;
}

async function ownedRequest(tx: TransactionDb, userId: string, id: string) {
  const row = await lockedRequest(tx, id);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.suspendedAt ||
    !row.confirmedAt ||
    !row.tuteeId ||
    !(await ownedStudentIds(tx, userId)).includes(row.tuteeId)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  await requirePolicy(tx, userId, "tutee-policy");
  return row;
}

export async function acceptStudentPolicy(
  db: DomainDb,
  userId: string,
  revision: string,
  ticket: string,
  slug: PolicySlug = "tutee-policy",
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `policy:${slug}`);
    const policy = await currentPolicy(tx, slug);
    if (policy.revision !== revision)
      fail("The policy changed again. Reload and read the latest version.");
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      "POLICY",
      policyActionTarget(slug, revision),
    );
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      user.role === "VIEWER" ||
      (slug !== "tutee-policy" &&
        !applicablePolicySlugs(user).includes(slug)) ||
      user.suspendedAt
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    await tx.policyAcceptance.upsert({
      where: { userId_slug_revision: { userId, slug: policy.slug, revision } },
      update: {},
      create: {
        userId,
        slug: policy.slug,
        revision,
        snapshot: policy.documents,
        signature: user.name ?? user.email,
        acceptedAt: new Date(),
      },
    });
    if (slug === "tutee-policy")
      await tx.user.update({
        where: { id: userId },
        data: { tuteeMember: true },
      });
    return { ok: true };
  });
}

export async function studentPolicyStatus(
  db: DomainDb,
  userId: string,
  tuteeEntry = false,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      studentId: true,
      tutorId: true,
      tuteeMember: true,
      role: true,
      suspendedAt: true,
      schoolDeparture: true,
    },
  });
  if (
    !user ||
    user.suspendedAt ||
    user.role === "VIEWER" ||
    user.schoolDeparture?.reason
  )
    return null;
  // An unpublished membership must not hide another membership's published review.
  // Only publication absence is a setup state; database errors still propagate.
  const missingSlugs: PolicySlug[] = [];
  for (const slug of tuteeEntry
    ? ["tutee-policy" as const]
    : applicablePolicySlugs(user)) {
    const policy = await publishedPolicy(db, slug);
    if (!policy) {
      missingSlugs.push(slug);
      continue;
    }
    const acceptance = await findAccountPolicy(
      db,
      userId,
      policy.slug,
      policy.revision,
    );
    if (!acceptance || (tuteeEntry && !user.tuteeMember))
      return { state: "review" as const, ...policy };
  }
  if (missingSlugs.length)
    return {
      state: "setup" as const,
      missingSlugs,
      canManagePolicies: ["HEAD", "ADMIN", "COORDINATOR"].includes(user.role),
    };
  return null;
}

export async function assignStudentRequest(
  db: DomainDb,
  id: string,
  userId: string,
  ticket: string,
  subjectId: string,
  tutorId: string,
  overrideTicket?: string,
) {
  await expireStudentRequests(db);
  const result = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await enforceAssignmentQualification(tx, userId, "studentWorkflow.assign", {
      id,
      ticket,
      subjectId,
      tutorId,
      overrideTicket,
    });
    const row = await lockedRequest(tx, id);
    assertRequestProcessable(row);
    await consumeStudentAction(tx, ticket, userId, "ASSIGN", id);
    const input = surveyInput.parse(currentStudentSignupPayload(row));
    if (![input.firstChoiceId, input.secondChoiceId].includes(subjectId))
      fail("Choose a subject requested in this survey.");
    const subject = await tx.subject.findUnique({ where: { id: subjectId } });
    const tutor = await tx.tutor.findUnique({ where: { id: tutorId } });
    if (!subject?.active || tutor?.status !== "ACTIVE")
      fail("Choose an active subject and tutor.");
    const source = await materializeStudent(tx, row);
    await requireStudentSchoolParticipation(tx, source.id);
    const student = await tx.tutee.findUniqueOrThrow({ where: { id: await executionParticipantId(tx, "TUTEE", source.id) } });
    await requireStudentSchoolParticipation(tx, student.id);
    await preserveHistoricalAcademics(tx, "TUTEE", student.id);
    const existing = await tx.pairingTutee.findFirst({
      where: {
        tuteeId: student.id,
        pairingId: { notIn: await supersededPairingIds(tx) },
        pairing: { termId: row.intakeTermId, subject: subject.name },
      },
    });
    if (existing) fail("This subject is already assigned. Refresh the page.");
    const pairing = await tx.pairing.create({
      data: {
        tutorId,
        termId: row.intakeTermId,
        subject: subject.name,
        scheduleConfirmed: false,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
      },
    });
    await admitStudentRequestExecution(tx, { ...row, tuteeId: source.id }, pairing.id, student.id);
    await tx.pairingTutee.create({ data: { pairingId: pairing.id, tuteeId: student.id } });
    await tx.tutee.update({
      where: { id: student.id },
      data: { status: "ACTIVE" },
    });
    await stampStudentAssignment(tx, source.id);
    await notifyRequest(
      tx,
      { ...row, tuteeId: source.id },
      "student_assignment_updated",
      {
        en: `Tutee ${student.englishName} is assigned to ${tutor.englishName} for ${subject.name}. The weekly schedule is awaiting confirmation.`,
        zh: `学习伙伴 ${student.englishName} 已分配给辅导伙伴 ${tutor.englishName}，科目为 ${subject.name}。每周辅导时间待确认。`,
      },
      undefined,
      { entity: "Tutee", recordId: student.id },
    );
    return { email: row.email, needsVerification: !row.confirmedAt };
  });
  // The durable assignment/deadline survive SMTP failure. Management can retry explicitly.
  if (result.needsVerification && !approvalScope.getStore()) {
    const delivery = await resendSurveyResult(db, result.email, false);
    // Keep the receipt identity: the outer audit owner settles it after commit.
    return Object.assign(delivery, { ok: true });
  }
  // Approval's decision owner sends after its encompassing transaction commits.
  return { ok: true, emailSent: result.needsVerification ? null : true };
}

export async function editStudentAvailability(
  db: DomainDb,
  userId: string,
  id: string,
  slotIds: string[],
  expectedVersion?: number,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockCatalogue(tx);
    const row = await ownedRequest(tx, userId, id);
    const ids = [...new Set(slotIds)];
    await tx.$queryRaw`SELECT id FROM "TimeSlot" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
    if (
      !ids.length ||
      (await tx.timeSlot.count({
        where: { id: { in: ids }, active: true },
      })) !== ids.length
    )
      fail("Choose active availability slots.");
    const old = await tx.tuteeAvailability.findMany({
      where: { tuteeId: row.tuteeId! },
    });
    if (old.length === ids.length && old.every((s) => ids.includes(s.slotId)))
      return { ok: true };
    if (expectedVersion !== undefined && row.currentVersion !== expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This changed since you loaded it — refresh and try again.",
      });
    await tx.tuteeAvailability.deleteMany({ where: { tuteeId: row.tuteeId! } });
    await tx.tuteeAvailability.createMany({
      data: ids.map((slotId) => ({ tuteeId: row.tuteeId!, slotId })),
    });
    // Original survey evidence stays untouched; only the current availability and edit marker change.
    await tx.studentSurvey.update({
      where: { id },
      data: { editedAt: new Date() },
    });
    await synchronizeStudentSignupAnswers(tx, row, userId, { slotIds: ids });
    const slots = await tx.timeSlot.findMany({
      where: {
        id: { in: [...new Set([...ids, ...old.map((slot) => slot.slotId)])] },
      },
    });
    const added = slots.filter(
      (slot) =>
        ids.includes(slot.id) &&
        !old.some((previous) => previous.slotId === slot.id),
    );
    const removed = slots.filter((slot) => !ids.includes(slot.id));
    const student = await tx.tutee.findUnique({
      where: { id: row.tuteeId! },
      select: { englishName: true },
    });
    await notifyRequest(tx, row, "student_availability_updated", {
      en: `${student?.englishName ?? "Tutee"} updated availability. Added: ${notificationList(added.map((slot) => notificationSchedule(slot, "en"))) || "none"}. Removed: ${notificationList(removed.map((slot) => notificationSchedule(slot, "en"))) || "none"}.`,
      zh: `${student?.englishName ?? "学习伙伴"}更新了可用时间。新增：${notificationList(added.map((slot) => notificationSchedule(slot, "zh"))) || "无"}。移除：${notificationList(removed.map((slot) => notificationSchedule(slot, "zh"))) || "无"}。`,
    });
    return { ok: true };
  });
}

export async function recallStudentRequest(
  db: DomainDb,
  userId: string,
  id: string,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    const { withAutomaticRecoveryCheckpoint } =
      await import("~/server/recovery/checkpoint");
    return withAutomaticRecoveryCheckpoint(
      tx,
      { adapter: "STUDENT_WORKFLOW", sourceId: id },
      { id: userId },
      async () => {
        const row = await ownedRequest(tx, userId, id);
        await consumeStudentAction(tx, ticket, userId, "RECALL", id);
        if ((await studentRequestExecutionAssignments(tx, row)).length)
          fail(
            "You have a tutor assignment. Apply to leave this quarter instead.",
          );
        await closeStudentRequest(tx, row, "RECALLED");
        return { ok: true };
      },
    );
  });
}

export async function applyStudentAbort(
  db: DomainDb,
  userId: string,
  id: string,
  reason: string,
  ticket: string,
) {
  const reasonHash = studentAbortReasonHash(reason);
  const accepted = await studentAbortReceipt(
    db,
    userId,
    id,
    reasonHash,
    ticket,
  );
  if (accepted.status === "ACCEPTED")
    return { ok: true, reviewId: accepted.reviewId };
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockEntity(tx, `student-abort:${ticket}`);
    const receipt = await readStudentAbortReceipt(
      tx,
      userId,
      id,
      reasonHash,
      ticket,
    );
    // The existing review is the receipt, even after a later decision or rollover.
    // An ordinary transport retry can only return this exact accepted operation.
    if (receipt.status === "ACCEPTED")
      return { ok: true, reviewId: receipt.reviewId };
    const row = await ownedRequest(tx, userId, id);
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      isReceiptBoundAbortTicket(ticket) ? "SURVEY_ABORT" : "ABORT",
      id,
    );
    if (!(await studentRequestExecutionAssignments(tx, row)).length)
      fail("This request is unassigned. Use recall instead.");
    if (
      await tx.studentRequestReview.count({
        where: { surveyId: id, kind: "STUDENT_ABORT", state: "PENDING" },
      })
    )
      fail("Your application is already awaiting review.");
    const review = await tx.studentRequestReview.create({
      data: {
        id: studentAbortReviewId(userId, id, reasonHash, ticket),
        surveyId: id,
        kind: "STUDENT_ABORT",
        requestedByUserId: userId,
        reason: reason.trim(),
      },
    });
    await notifyRequest(
      tx,
      row,
      "student_withdrawal_pending",
      undefined,
      undefined,
      { entity: "StudentRequestReview", recordId: review.id },
    );
    return { ok: true, reviewId: review.id };
  });
}

function studentAbortReasonHash(reason: string) {
  return createHash("sha256").update(reason.trim()).digest("hex");
}

/** Domain-separated identity binds the receipt to this actor, source, ticket and
 * exact normalized intent. Old cuid reviews never masquerade as new receipts. */
function studentAbortReviewId(
  userId: string,
  id: string,
  reasonHash: string,
  ticket: string,
) {
  return `student-abort:${createHash("sha256")
    .update(JSON.stringify([userId, id, ticket, reasonHash]))
    .digest("hex")}`;
}

async function readStudentAbortReceipt(
  tx: TransactionDb,
  userId: string,
  id: string,
  reasonHash: string,
  ticket: string,
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  const row = await tx.studentSurvey.findUnique({ where: { id } });
  if (
    !user ||
    user.suspendedAt ||
    user.mergedIntoId ||
    user.recoveryVoidedAt ||
    user.role === "VIEWER" ||
    !row?.tuteeId ||
    !row.confirmedAt ||
    !(await ownedStudentIds(tx, userId)).includes(row.tuteeId)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  const review = await tx.studentRequestReview.findUnique({
    where: { id: studentAbortReviewId(userId, id, reasonHash, ticket) },
  });
  if (
    review?.surveyId === id &&
    review.kind === "STUDENT_ABORT" &&
    review.requestedByUserId === userId &&
    studentAbortReasonHash(review.reason) === reasonHash
  )
    return { status: "ACCEPTED" as const, reviewId: review.id };
  const proof = await tx.studentActionConfirmation.findUnique({
    where: { id: ticket },
  });
  const versioned = isReceiptBoundAbortTicket(ticket);
  const boundUnused =
    proof?.userId === userId &&
    proof.target === id &&
    proof.action === (versioned ? surveyAbortProofAction : "ABORT") &&
    !proof.usedAt;
  // Every accepted versioned proof commits its exact receipt. Missing or expired
  // unused proof cannot be consumed later, including after a lost retirement reply.
  if (versioned && (!proof || (boundUnused && proof.expiresAt <= new Date())))
    return { status: "NOT_ACCEPTED" as const };
  // Old consumed/deleted tickets have no durable exact-receipt contract.
  return { status: "UNCONFIRMED" as const, canRetire: boundUnused };
}

/** Read-only reconciliation never expires requests, consumes tickets or submits
 * another review. The lock waits for an already admitted same-ticket write. */
export function studentAbortReceipt(
  db: DomainDb,
  userId: string,
  id: string,
  reasonHash: string,
  ticket: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `student-abort:${ticket}`);
    return readStudentAbortReceipt(tx, userId, id, reasonHash, ticket);
  });
}

/** The tutor may inspect only original requests owning this exact current member.
 * Survey signatures, contact details and policy evidence never leave this read. */
export async function studentScheduleRequestSources(db: DomainDb, tutorId: string, tuteeId: string, pairingId: string) {
  const member = await db.pairingTutee.findFirst({ where: {
    pairingId, tuteeId, pairing: { tutorId, term: { active: true } },
    tutee: { status: { not: "INACTIVE" } },
  }, select: { pairing: { select: { termId: true } } } });
  if (!member || (await supersededPairingIds(db)).includes(pairingId)) throw new TRPCError({ code: "FORBIDDEN" });
  const maps = await db.studentRequestExecutionAssignment.findMany({ where: { pairingId, tuteeId } });
  const direct = await db.studentSurvey.findUnique({ where: { tuteeId }, select: { id: true } });
  const possible = await db.studentSurvey.findMany({ where: {
    id: { in: [...maps.map((mapping) => mapping.surveyId), ...(direct ? [direct.id] : [])] },
    state: "OPEN", intakeTermId: member.pairing.termId,
  }, include: { reviews: { where: { state: "PENDING", kind: "SCHEDULE_CONFLICT" }, select: { pairingId: true } } }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }] });
  const term = await db.term.findUniqueOrThrow({ where: { id: member.pairing.termId }, select: { name: true } });
  const sources = [];
  for (const row of possible) {
    if (!(await studentRequestExecutionAssignments(db, row)).some((assignment) => assignment.pairingId === pairingId && assignment.tuteeId === tuteeId)) continue;
    const payload = currentStudentSignupPayload(row);
    let pending = false;
    for (const review of row.reviews) if (review.pairingId && await executionPairingId(db, review.pairingId) === pairingId) pending = true;
    sources.push({ surveyId: row.id, sourceTuteeId: row.tuteeId!, name: typeof payload.englishName === "string" ? payload.englishName : "—", termId: row.intakeTermId, termName: term.name, submittedAt: row.submittedAt, pending, verified: !!row.confirmedAt, verificationDueAt: row.verificationDueAt, editedAt: row.editedAt });
  }
  // A released or closed survey never turns into a new legacy request.
  return { sources, legacy: !maps.length && !direct };
}

export async function applyScheduleRejection(
  db: DomainDb,
  userId: string,
  tutorId: string,
  tuteeId: string,
  pairingId: string,
  reason: string,
  ticket: string,
  surveyId?: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    const choices = await studentScheduleRequestSources(tx, tutorId, tuteeId, pairingId);
    if (!surveyId && choices.sources.length > 1) fail("Select the original request for this shared assignment.");
    const selected = surveyId ? choices.sources.find((source) => source.surveyId === surveyId) : choices.sources[0];
    if (surveyId && !selected) throw new TRPCError({ code: "FORBIDDEN" });
    if (!selected && !choices.legacy) fail("No open original request owns this assignment.");
    if (!selected) {
      await lockEntity(tx, `legacy-student:${tuteeId}`);
      await consumeStudentAction(
        tx,
        ticket,
        userId,
        "SCHEDULE",
        `${pairingId}:${tuteeId}`,
      );
      const link = await tx.pairingTutee.findFirst({
        where: {
          pairingId,
          tuteeId,
          tutee: { status: { not: "INACTIVE" } },
          pairing: { tutorId, term: { active: true } },
        },
        select: { pairing: { select: { termId: true } } },
      });
      if (!link) throw new TRPCError({ code: "FORBIDDEN" });
      if (
        await tx.studentRequestReview.count({
          where: { legacyTuteeId: tuteeId, pairingId, state: "PENDING" },
        })
      )
        fail("A schedule review is already pending.");
      const review = await tx.studentRequestReview.create({
        data: {
          legacyTuteeId: tuteeId,
          legacyIntakeTermId: link.pairing.termId,
          kind: "SCHEDULE_CONFLICT",
          requestedByUserId: userId,
          pairingId,
          reason,
        },
      });
      await notifyLegacySchedule(
        tx,
        tuteeId,
        userId,
        "student_schedule_review_pending",
        pairingId,
        undefined,
        { entity: "StudentRequestReview", recordId: review.id },
      );
      return { ok: true };
    }
    const row = await lockedRequest(tx, selected.surveyId);
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      "SCHEDULE",
      `${pairingId}:${tuteeId}${surveyId ? `:${surveyId}` : ""}`,
    );
    if (!(await studentRequestExecutionAssignments(tx, row)).some((assignment) => assignment.pairingId === pairingId && assignment.tuteeId === tuteeId)) throw new TRPCError({ code: "CONFLICT" });
    if (selected.pending) fail("A schedule review is already pending.");
    if (
      await tx.studentRequestReview.count({
        where: {
          surveyId: row.id,
          pairingId,
          kind: "SCHEDULE_CONFLICT",
          state: "PENDING",
        },
      })
    )
      fail("A schedule review is already pending.");
    const review = await tx.studentRequestReview.create({
      data: {
        surveyId: row.id,
        kind: "SCHEDULE_CONFLICT",
        pairingId,
        requestedByUserId: userId,
        reason,
      },
    });
    await notifyRequest(
      tx,
      row,
      "student_schedule_review_pending",
      undefined,
      pairingId,
      { entity: "StudentRequestReview", recordId: review.id },
    );
    return { ok: true };
  });
}

export async function resolveStudentReview(
  db: DomainDb,
  userId: string,
  id: string,
  approve: boolean,
  ticket: string,
) {
  await expireStudentRequests(db);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    const initial = await tx.studentRequestReview.findUniqueOrThrow({
      where: { id },
    });
    const { withAutomaticRecoveryCheckpoint } =
      await import("~/server/recovery/checkpoint");
    if (approve && initial.kind === "STUDENT_ABORT") {
      // Prelock the complete aggregate before recovery creates its tracking
      // fences. Capture and mutation share this exact authoritative scope.
      const scope = await lockQuarterWithdrawalScope(tx, { reviewId: id });
      return withAutomaticRecoveryCheckpoint(
        tx,
        { adapter: "STUDENT_QUARTER_WITHDRAWAL", sourceId: id },
        { id: userId },
        async () => {
          await consumeStudentAction(tx, ticket, userId, "APPROVE", id);
          await applyQuarterWithdrawal(tx, scope, { actorId: userId, now: new Date() });
          for (const profile of scope.manual) await notifyLegacySchedule(
            tx, profile.id, scope.owner!.id, "student_withdrawal_approved", undefined,
            scope.term!.id, { entity: "StudentRequestReview", recordId: id },
          );
          return { ok: true };
        },
      );
    }
    return withAutomaticRecoveryCheckpoint(
      tx,
      initial.surveyId
        ? { adapter: "STUDENT_WORKFLOW", sourceId: initial.surveyId }
        : { adapter: "PARTICIPANT_TUTEE", sourceId: initial.legacyTuteeId! },
      { id: userId },
      async () => {
        if (!initial.surveyId) {
          await lockEntity(tx, `legacy-student:${initial.legacyTuteeId!}`);
          const review = await tx.studentRequestReview.findUniqueOrThrow({
            where: { id },
          });
          if (review.state !== "PENDING")
            fail("This application has already been processed.");
          await consumeStudentAction(
            tx,
            ticket,
            userId,
            approve ? "APPROVE" : "DENY",
            id,
          );
          if (approve) {
            if (!review.pairingId || (await supersededPairingIds(tx)).includes(review.pairingId) ||
              await tx.studentRequestExecutionAssignment.count({ where: { pairingId: review.pairingId, tuteeId: review.legacyTuteeId!, releasedAt: null } }))
              fail("This assignment now has exact request ownership. Decline this outdated review and review its current original request.");
            const requester = await tx.user.findUnique({
              where: { id: review.requestedByUserId },
              select: { tutorId: true },
            });
            if (!requester?.tutorId)
              fail(
                "The tutor assignment changed. Decline this outdated application.",
              );
            await preserveHistoricalAcademics(
              tx,
              "TUTEE",
              review.legacyTuteeId!,
            );
            const detached = await tx.pairingTutee.deleteMany({
              where: {
                pairingId: review.pairingId,
                tuteeId: review.legacyTuteeId!,
                pairing: {
                  tutorId: requester.tutorId,
                  termId: review.legacyIntakeTermId!,
                  term: { active: true },
                },
              },
            });
            if (!detached.count)
              fail(
                "The tutor assignment changed. Decline this outdated application.",
              );
            if (!(await tx.pairingTutee.count({ where: { tuteeId: review.legacyTuteeId!, pairingId: { notIn: await supersededPairingIds(tx) }, pairing: { term: { active: true } } } })))
              await tx.tutee.update({ where: { id: review.legacyTuteeId! }, data: { status: "PENDING" } });
          }
          await tx.studentRequestReview.update({
            where: { id },
            data: {
              state: approve ? "APPROVED" : "DENIED",
              resolvedAt: new Date(),
              resolvedByUserId: userId,
            },
          });
          await notifyLegacySchedule(
            tx,
            review.legacyTuteeId!,
            review.requestedByUserId,
            review.kind === "STUDENT_ABORT"
              ? approve
                ? "student_withdrawal_approved"
                : "student_withdrawal_declined"
              : approve
                ? "student_schedule_review_approved"
                : "student_schedule_review_declined",
            review.kind === "SCHEDULE_CONFLICT" ? review.pairingId : undefined,
            review.legacyIntakeTermId,
            { entity: "StudentRequestReview", recordId: id },
          );
          return { ok: true };
        }
        const row = await lockedRequest(tx, initial.surveyId);
        const review = await tx.studentRequestReview.findUniqueOrThrow({
          where: { id },
        });
        if (review.state !== "PENDING")
          fail("This application has already been processed.");
        await consumeStudentAction(
          tx,
          ticket,
          userId,
          approve ? "APPROVE" : "DENY",
          id,
        );
        // Every decision, including a denial, is the exact source of its notices.
        // Journal it first; subsequent domain validation rolls back this transaction.
        await tx.studentRequestReview.update({
          where: { id },
          data: {
            state: approve ? "APPROVED" : "DENIED",
            resolvedAt: new Date(),
            resolvedByUserId: userId,
          },
        });
        if (approve) {
          const requester = await tx.user.findUnique({
            where: { id: review.requestedByUserId },
            select: { tutorId: true },
          });
          const currentPairingId = review.pairingId ? await executionPairingId(tx, review.pairingId) : null;
          const member = (await studentRequestExecutionAssignments(tx, row)).find((assignment) => assignment.pairingId === currentPairingId);
          // A successor retains the original tutor as evidence after the original
          // login loses its live pointer; unrelated request assignments survive.
          const sourceTutorId = currentPairingId && currentPairingId !== review.pairingId
            ? (await tx.pairing.findUnique({ where: { id: review.pairingId! }, select: { tutorId: true } }))?.tutorId
            : requester?.tutorId;
          if (
            !sourceTutorId || !member ||
            !(await tx.pairingTutee.count({
              where: {
                pairingId: member.pairingId,
                tuteeId: member.tuteeId,
                pairing: { tutorId: await executionParticipantId(tx, "TUTOR", sourceTutorId), term: { active: true } },
              },
            }))
          )
            fail(
              "This tutor assignment changed after the application was submitted. Decline this outdated application and review the current assignment.",
            );
          await notifyRequest(
            tx,
            row,
            "student_schedule_review_approved",
            undefined,
            member.pairingId,
            { entity: "StudentRequestReview", recordId: id },
          );
          await preserveHistoricalAcademics(tx, "TUTEE", member.tuteeId);
          await releaseStudentRequestExecution(tx, row, { pairingId: member.pairingId, unassignedStatus: "PENDING" });
        } else
          await notifyRequest(
            tx,
            row,
            review.kind === "STUDENT_ABORT"
              ? "student_withdrawal_declined"
              : "student_schedule_review_declined",
            undefined,
            review.kind === "SCHEDULE_CONFLICT" ? review.pairingId : undefined,
            { entity: "StudentRequestReview", recordId: id },
          );
        return { ok: true };
      },
    );
  });
}

async function notifyLegacySchedule(
  tx: TransactionDb,
  tuteeId: string,
  tutorUserId: string,
  event: NotificationEvent,
  pairingId?: string | null,
  termId?: string | null,
  recoverySource?: RecoveryDeliverySource,
) {
  const student = await tx.tutee.findUnique({
    where: { id: tuteeId },
    select: { englishName: true },
  });
  const { managementNotificationRecipients } =
    await import("./notifications/create");
  const managers = await managementNotificationRecipients(tx, event);
  const users = await tx.user.findMany({
    where: {
      suspendedAt: null,
      mergedIntoId: null,
      OR: [
        { id: { in: managers.map((manager) => manager.id) } },
        { id: tutorUserId },
        { studentId: tuteeId },
      ],
    },
    select: { id: true, role: true, tutorId: true },
  });
  const detail = pairingId
    ? await studentScheduleDetail(
        tx,
        pairingId,
        student?.englishName ?? "—",
        event,
      )
    : undefined;
  const period =
    event.startsWith("student_withdrawal_") && termId
      ? await tx.term.findUnique({
          where: { id: termId },
          select: { name: true },
        })
      : null;
  await withRecoveryDeliverySource(
    tx,
    recoverySource ?? { entity: "Tutee", recordId: tuteeId },
    () =>
      tx.notification.createMany({
        data: users.map((user) => ({
          userId: user.id,
          ...notificationData(
            event,
            undefined,
            detail ??
              (student
                ? namedNotificationDetail(
                    event,
                    `${student.englishName}${period ? ` (${period.name})` : ""}`,
                  )
                : undefined),
          ),
          link: ["HEAD", "ADMIN"].includes(user.role)
            ? "/admin/requests"
            : user.tutorId
              ? "/dashboard"
              : "/student",
        })),
      }),
  );
}

/** Whitelist workflow data; token hashes and policy snapshots never enter management/client lists. */
export async function studentRequestRows(
  db: DomainDb,
  email?: string,
  userId?: string,
  includeStaffReview = false,
) {
  await expireStudentRequests(db);
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!term) return [];
  const owned = userId ? await ownedStudentIds(db, userId) : null;
  const [rows, subjects, profiles] = await Promise.all([
    db.studentSurvey.findMany({
      where: {
        intakeTermId: term.id,
        ...(owned ? { tuteeId: { in: owned } } : email ? { email } : {}),
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      include: {
        reviews: { orderBy: { createdAt: "desc" } },
        signupAppeals: { orderBy: { createdAt: "desc" } },
      },
    }),
    db.subject.findMany({ select: { id: true, name: true } }),
    db.tutee.findMany({
      where: {
        intakeTermId: term.id,
        ...(owned ? { id: { in: owned } } : email ? { email } : {}),
      },
      include: {
        user: { select: { username: true } },
        availabilities: { include: { slot: true } },
        pairings: {
          where: { pairing: { termId: term.id } },
          include: {
            pairing: {
              include: {
                tutor: {
                  select: {
                    englishName: true,
                    user: { select: { username: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  const slots = await db.timeSlot.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
  });
  const reviewPairings = await db.pairing.findMany({
    where: {
      id: {
        in: rows.flatMap((row) =>
          row.reviews.flatMap((r) => (r.pairingId ? [r.pairingId] : [])),
        ),
      },
    },
    select: {
      id: true,
      subject: true,
      tutor: { select: { englishName: true } },
    },
  });
  const execution = await Promise.all(rows.map(async (row) => ({ id: row.id, assignments: row.state === "OPEN" ? await studentRequestExecutionAssignments(db, row) : [] })));
  const currentPairings = await db.pairing.findMany({
    where: { id: { in: execution.flatMap((row) => row.assignments.map((assignment) => assignment.pairingId)) } },
    include: { tutor: { select: { englishName: true, user: { select: { username: true } } } } },
  });
  return rows.map((row) => {
    const input = surveyInput.parse(currentStudentSignupPayload(row));
    const profile = profiles.find((p) => p.id === row.tuteeId);
    return {
      id: row.id,
      ...requestInvalidity(row, includeStaffReview),
      invalidityVersion: row.invalidityVersion,
      canAppeal:
        !!row.invalidatedAt &&
        row.state === "OPEN" &&
        !row.signupAppeals.some(
          (a) => a.invalidityVersion === row.invalidityVersion,
        ),
      appeal: (() => {
        // A resolved acceptance remains visible after clearing increments the flag
        // version. Reflagged requests show only their new current appeal generation.
        const a = row.invalidatedAt
          ? row.signupAppeals.find(
              (a) => a.invalidityVersion === row.invalidityVersion,
            )
          : row.signupAppeals[0];
        return a
          ? {
              id: a.id,
              reason: a.reason,
              state: a.state,
              createdAt: a.createdAt,
            }
          : null;
      })(),
      email: row.email,
      name: input.englishName,
      // Current rendering may use a linked handle without rewriting intake evidence.
      username: profile?.user?.username ?? null,
      contact: input.preferredContact,
      tuteeId: row.tuteeId,
      submittedAt: row.submittedAt,
      state: row.state,
      confirmedAt: row.confirmedAt,
      editedAt: row.editedAt,
      currentVersion: row.currentVersion,
      firstAssignedAt: row.firstAssignedAt,
      verificationDueAt: row.verificationDueAt,
      lastLinkSentAt: row.lastLinkSentAt,
      subjects: [
        input.firstChoiceId,
        ...(input.secondChoiceId ? [input.secondChoiceId] : []),
      ].map(
        (id) =>
          subjects.find((s) => s.id === id) ?? {
            id,
            name: "Unavailable / 已停用",
          },
      ),
      slots: profile
        ? profile.availabilities.map((a) => a.slot)
        : slots.filter((s) => input.slotIds.includes(s.id)),
      pairings: currentPairings.filter((pairing) => execution.find((source) => source.id === row.id)?.assignments.some((assignment) => assignment.pairingId === pairing.id)),
      reviews: row.reviews.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason: r.reason,
        state: r.state,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        pairingId: r.pairingId,
        assignment: reviewPairings.find((p) => p.id === r.pairingId) ?? null,
      })),
    };
  });
}
import {
  notificationData,
  namedNotificationDetail,
} from "./notifications/create";
import type { NotificationEvent } from "~/lib/notification-events";
