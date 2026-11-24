import { TRPCError } from "@trpc/server";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { ownedStudentIds } from "./student-ownership";
import { requirePolicy } from "./policy-acceptance";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "./transactions";
import { consumeStudentAction } from "./student-workflow";

function invalid(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

/** Legacy profiles use the same account ownership proof as survey-backed enrollment. */
export async function ownedLegacyParticipation(
  db: DomainDb,
  userId: string,
  tuteeId: string,
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.suspendedAt ||
    !(await ownedStudentIds(db, userId)).includes(tuteeId)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  const [term, student, survey] = await Promise.all([
    db.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    }),
    db.tutee.findUnique({
      where: { id: tuteeId },
      include: { pairings: { include: { pairing: true } } },
    }),
    db.studentSurvey.findUnique({ where: { tuteeId } }),
  ]);
  if (
    !term ||
    !student ||
    student.status === "INACTIVE" ||
    survey ||
    (student.intakeTermId !== term.id &&
      !(student.intakeTermId === null && user.studentId === student.id) &&
      !student.pairings.some((p) => p.pairing.termId === term.id))
  )
    invalid("There is no current enrollment to withdraw from.");
  if (!user.email)
    invalid(
      "Contact staff to add an account email before requesting withdrawal.",
    );
  return { user, student, term };
}

export async function applyLegacyStudentWithdrawal(
  db: DomainDb,
  userId: string,
  tuteeId: string,
  reason: string,
  ticket: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `legacy-student:${tuteeId}`);
    const { term, student } = await ownedLegacyParticipation(
      tx,
      userId,
      tuteeId,
    );
    await requirePolicy(tx, userId, "tutee-policy");
    await consumeStudentAction(
      tx,
      ticket,
      userId,
      "ABORT",
      `legacy:${tuteeId}`,
    );
    if (
      await tx.studentRequestReview.count({
        where: {
          legacyTuteeId: tuteeId,
          legacyIntakeTermId: term.id,
          kind: "STUDENT_ABORT",
          state: "PENDING",
        },
      })
    )
      invalid("Your withdrawal request is already awaiting review.");
    await tx.studentRequestReview.create({
      data: {
        legacyTuteeId: tuteeId,
        legacyIntakeTermId: term.id,
        kind: "STUDENT_ABORT",
        requestedByUserId: userId,
        reason,
      },
    });
    const { managementReviewers } = await import("./notifications/create");
    const managers = await managementReviewers(tx);
    await tx.notification.createMany({
      data: managers.map((u) => ({
        userId: u.id,
        title: "Withdrawal request awaiting review",
        ...notificationInAppEvent("student_withdrawal_pending", undefined, {
          en: `${student.englishName} requested to withdraw for ${term.name}. Tutoring continues until approved.`,
          zh: `${student.englishName} 申请退出 ${term.name} 的辅导，批准前继续进行。`,
        }),
        link: "/admin/tutee-requests",
      })),
    });
    return { ok: true };
  });
}

import { notificationInAppEvent } from "~/lib/notification-details";
