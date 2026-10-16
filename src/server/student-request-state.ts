import { requireStudentSchoolParticipation } from "./school-departure";
import { notificationData } from "./notifications/create";
import type { NotificationEvent } from "~/lib/notification-events";
import {
  assertRequestProcessable,
  lockLegacySignupReview,
  lockStudentRequestReview,
} from "./request-invalidity";
import { recordDomainAudit } from "./audit/evidence";
import { TRPCError } from "@trpc/server";
import type { StudentSurvey } from "../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

export const VERIFICATION_WEEK_MS = 7 * 24 * 60 * 60_000;

export async function notifyRequest(
  tx: TransactionDb,
  row: StudentSurvey,
  event: NotificationEvent,
) {
  const links = row.tuteeId
    ? await tx.pairingTutee.findMany({
        where: { tuteeId: row.tuteeId },
        select: { pairing: { select: { tutorId: true } } },
      })
    : [];
  const owner = row.tuteeId
    ? await tx.studentProfileOwnership.findUnique({
        where: { tuteeId: row.tuteeId },
      })
    : null;
  const users = await tx.user.findMany({
    where: {
      suspendedAt: null,
      mergedIntoId: null,
      OR: [
        { role: { in: ["HEAD", "ADMIN"] } },
        ...(owner
          ? [{ id: owner.userId }]
          : row.tuteeId
            ? [{ studentId: row.tuteeId }]
            : []),
        { tutorId: { in: links.map((l) => l.pairing.tutorId) } },
      ],
    },
    select: { id: true, role: true, email: true },
  });
  await tx.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      ...notificationData(event),
      link: ["HEAD", "ADMIN"].includes(user.role)
        ? "/admin/requests"
        : user.id === owner?.userId || user.email === row.email
          ? "/student"
          : "/dashboard",
    })),
  });
}

/** Terminal transitions keep evidence, remove roster membership, and cannot be undone. */
export async function closeStudentRequest(
  tx: TransactionDb,
  row: StudentSurvey,
  state: "DISQUALIFIED" | "RECALLED" | "ABORTED",
  now = new Date(),
) {
  if (row.state !== "OPEN")
    throw new TRPCError({
      code: "CONFLICT",
      message: "This request is already processed.",
    });
  const events = {
    RECALLED: "student_request_recalled",
    DISQUALIFIED: "student_request_expired",
    ABORTED: "student_withdrawal_approved",
  } as const;
  await notifyRequest(tx, row, events[state]);
  await tx.studentSurvey.update({
    where: { id: row.id },
    data: { state, resolvedAt: now },
  });
  if (row.tuteeId) {
    await tx.pairingTutee.deleteMany({ where: { tuteeId: row.tuteeId } });
    await tx.tutee.updateMany({
      where: { id: row.tuteeId },
      data: { status: "INACTIVE" },
    });
  }
  await tx.studentRequestReview.updateMany({
    where: { surveyId: row.id, state: "PENDING" },
    data: { state: "DENIED", resolvedAt: now },
  });
}

/** Run both periodically and before workflow reads/writes; downtime never extends a deadline. */
export async function expireStudentRequests(db: DomainDb, now = new Date()) {
  const due = await db.studentSurvey.findMany({
    where: {
      state: "OPEN",
      confirmedAt: null,
      verificationDueAt: { lte: now },
    },
    select: { id: true, email: true },
  });
  let count = 0;
  for (const item of due) {
    count += await inTransaction(db, async (tx) => {
      await lockEntity(tx, `student-survey:${item.email}`);
      const row = await tx.studentSurvey.findUniqueOrThrow({
        where: { id: item.id },
      });
      if (
        row.state !== "OPEN" ||
        row.confirmedAt ||
        !row.verificationDueAt ||
        row.verificationDueAt > now
      )
        return 0;
      const links = row.tuteeId
        ? await tx.pairingTutee.findMany({
            where: { tuteeId: row.tuteeId },
            select: { pairingId: true },
          })
        : [];
      const tutee = row.tuteeId
        ? await tx.tutee.findUnique({
            where: { id: row.tuteeId },
            select: { status: true },
          })
        : null;
      await closeStudentRequest(tx, row, "DISQUALIFIED", now);
      await recordDomainAudit(tx, {
        operation: "system.expireStudentRequest",
        entity: "StudentSurvey",
        entityId: row.id,
        action: "Expired unverified student request",
        system: true,
        before: row,
        after: { id: row.id, state: "DISQUALIFIED", resolvedAt: now },
        reason: "Verification deadline passed without confirmation",
        effects: {
          tuteeId: row.tuteeId,
          beforeStatus: tutee?.status ?? null,
          afterStatus: row.tuteeId ? "INACTIVE" : null,
          removedPairingIds: links.map((link) => link.pairingId),
          pendingReviews: "DENIED",
        },
      });
      return 1;
    });
  }
  return count;
}

/** All legacy assignment/status entrypoints must honor terminal survey state too. */
export async function assertStudentRequestAssignable(
  tx: TransactionDb,
  tuteeId: string,
) {
  await requireStudentSchoolParticipation(tx, tuteeId);
  const row = await tx.studentSurvey.findUnique({ where: { tuteeId } });
  if (!row) {
    // Share the legacy review lock, including the first flag when no metadata row exists.
    await lockLegacySignupReview(tx, tuteeId);
    const invalidity = await tx.tuteeRequestInvalidity.findUnique({
      where: { tuteeId },
    });
    if (invalidity) assertRequestProcessable(invalidity);
    // Manual withdrawals are terminal for their quarter just like survey withdrawals.
    const term = await tx.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (
      term &&
      (await tx.studentRequestReview.findFirst({
        where: {
          legacyTuteeId: tuteeId,
          legacyIntakeTermId: term.id,
          kind: "STUDENT_ABORT",
          state: "APPROVED",
        },
      }))
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This tutee withdrew from the current quarter and cannot be reassigned.",
      });
    return;
  }
  await lockStudentRequestReview(tx, row);
  const current = await tx.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  assertRequestProcessable(current);
  if (
    current.state !== "OPEN" ||
    (!current.confirmedAt &&
      current.verificationDueAt &&
      current.verificationDueAt <= new Date())
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This request is closed or its verification deadline has passed. A new submission is required.",
    });
}

export async function stampStudentAssignment(
  tx: TransactionDb,
  tuteeId: string,
) {
  const now = new Date();
  await tx.studentSurvey.updateMany({
    where: { tuteeId, state: "OPEN", firstAssignedAt: null },
    data: {
      firstAssignedAt: now,
      verificationDueAt: new Date(+now + VERIFICATION_WEEK_MS),
    },
  });
}
