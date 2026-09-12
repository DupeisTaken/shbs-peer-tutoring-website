import { TRPCError } from "@trpc/server";
import type { StudentRequestReview } from "../../generated/prisma";
import { ownedStudentIds } from "./student-ownership";
import { requirePolicy } from "./policy-acceptance";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
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
    invalid(
      "There is no current manually managed enrollment to withdraw from.",
    );
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
    await lockEntity(tx, `legacy-student:${tuteeId}`);
    const { term } = await ownedLegacyParticipation(tx, userId, tuteeId);
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
    const managers = await tx.user.findMany({
      where: {
        role: { in: ["HEAD", "ADMIN", "COORDINATOR"] },
        suspendedAt: null,
      },
      select: { id: true },
    });
    await tx.notification.createMany({
      data: managers.map((u) => ({
        userId: u.id,
        title: "Student withdrawal awaiting review / 学生退出申请待审核",
        link: "/admin/tutee-requests",
      })),
    });
    return { ok: true };
  });
}

/** Recheck ownership and term at approval; preserve past attendance and block fresh intake. */
export async function approveLegacyStudentWithdrawal(
  tx: TransactionDb,
  review: StudentRequestReview,
) {
  const { term, user, student } = await ownedLegacyParticipation(
    tx,
    review.requestedByUserId,
    review.legacyTuteeId!,
  );
  if (term.id !== review.legacyIntakeTermId)
    invalid("This quarter ended. Decline this outdated withdrawal request.");
  await tx.studentQuarterBlock.upsert({
    where: {
      email_intakeTermId: { email: user.email, intakeTermId: term.id },
    },
    update: {},
    create: {
      email: user.email,
      intakeTermId: term.id,
      userId: user.id,
      legacyTuteeId: student.id,
    },
  });
  await tx.pairingTutee.deleteMany({
    where: { tuteeId: student.id, pairing: { termId: term.id } },
  });
  await tx.tutee.update({
    where: { id: student.id },
    data: { status: "INACTIVE" },
  });
  await tx.studentRequestReview.updateMany({
    where: {
      legacyTuteeId: student.id,
      legacyIntakeTermId: term.id,
      state: "PENDING",
      id: { not: review.id },
    },
    data: { state: "DENIED", resolvedAt: new Date() },
  });
}
