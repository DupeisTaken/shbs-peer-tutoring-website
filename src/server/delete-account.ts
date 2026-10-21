import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { lockAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";
import { recordAudit } from "./audit/log";

export const deleteAccountInput = z.object({
  userId: z.string().cuid(),
  fingerprint: z.string().length(64),
  confirmPassword: z.string().min(1).max(1024),
});

const blockerMessages = {
  self: "You cannot delete your own account.",
  head: "Transfer leadership before deleting the head account.",
  combined:
    "Combined account history must be retained. Update the surviving account's memberships instead.",
  tutorHistory:
    "Retained tutor history must be preserved. Review historical ownership before deleting this account.",
  studentHistory:
    "Retained tutee ownership must be preserved. Review historical ownership before deletion, or use Combine Accounts instead to retire a duplicate while retaining access.",
  intake:
    "Complete or withdraw the account's unconfirmed tutee intake before deleting its login.",
} as const;

/** Signup is not an eligibility gate. This projection describes existing cascade/detach
 * behavior, without exposing credentials or guessing ownership from contact details. */
export async function previewDeleteAccount(
  db: DomainDb,
  actorId: string,
  userId: string,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { emails: { orderBy: { email: "asc" } } },
  });
  if (!user)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "An account no longer exists.",
    });
  const person = user.personId
    ? await db.person.findUnique({
        where: { id: user.personId },
        select: {
          id: true,
          revision: true,
          resolutionState: true,
          _count: {
            select: { users: true, tutors: true, tutees: true, receipts: true },
          },
        },
      })
    : null;
  const [
    combined,
    tutors,
    students,
    notifications,
    emails,
    credentials,
    deliveries,
    crewRequests,
    appeals,
    acknowledgements,
    academicProfiles,
    academics,
    currentDepartures,
    departures,
    patrols,
    observations,
    creditWindows,
    messages,
    policies,
    audits,
    approvals,
    studentRequests,
    quarterBlocks,
    intake,
  ] = await Promise.all([
    db.user.count({ where: { mergedIntoId: userId } }),
    db.tutorProfileOwnership.findMany({
      where: { userId },
      select: { tutorId: true },
      orderBy: { tutorId: "asc" },
    }),
    db.studentProfileOwnership.findMany({
      where: { userId },
      select: { tuteeId: true },
      orderBy: { tuteeId: "asc" },
    }),
    db.notification.count({ where: { userId } }),
    db.accountEmail.count({ where: { userId } }),
    Promise.all([
      db.passwordResetToken.count({ where: { userId } }),
      db.emailVerificationCode.count({ where: { userId } }),
      db.studentActionConfirmation.count({ where: { userId } }),
    ]).then((values) => values.reduce((sum, value) => sum + value, 0)),
    db.emailDelivery.count({ where: { userId } }),
    db.crewStatusRequest.count({ where: { userId } }),
    db.accountAppeal.count({ where: { userId } }),
    db.announcementAck.count({ where: { userId } }),
    db.academicProfile.count({ where: { userId } }),
    db.academicConfirmation.count({ where: { userId } }),
    db.schoolDeparture.count({ where: { userId } }),
    db.schoolDepartureEvent.count({ where: { userId } }),
    db.patrol.count({ where: { crewUserId: userId } }),
    db.patrolObservation.count({ where: { patrol: { crewUserId: userId } } }),
    db.patrolCreditWindow.count({ where: { crewUserId: userId } }),
    db.directMessage.count({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    }),
    db.policyAcceptance.count({ where: { userId } }),
    db.auditLog.count({ where: { userId } }),
    db.approvalRequest.count({
      where: { OR: [{ requesterId: userId }, { reviewerId: userId }] },
    }),
    db.studentRequestReview.count({ where: { requestedByUserId: userId } }),
    db.studentQuarterBlock.count({ where: { userId } }),
    // This is the existing email-bound intake dependency, not historical ownership.
    db.studentSurvey.count({
      where: {
        email: { in: user.emails.map((address) => address.email) },
        state: "OPEN",
        confirmedAt: null,
      },
    }),
  ]);
  const blockers: (keyof typeof blockerMessages)[] = [];
  if (userId === actorId) blockers.push("self");
  if (user.role === "HEAD") blockers.push("head");
  if (
    user.mergedIntoId ||
    combined ||
    (person &&
      (person.resolutionState === "REVIEW_REQUIRED" ||
        person._count.receipts > 0 ||
        person._count.users > 1 ||
        person._count.tutors > (user.tutorId ? 1 : 0) ||
        person._count.tutees > (user.studentId ? 1 : 0)))
  )
    blockers.push("combined");
  if (tutors.length) blockers.push("tutorHistory");
  // Student ownership deliberately has scalar IDs, so an ordinary User delete
  // cannot rely on a foreign key to prevent an inaccessible retained archive.
  if (students.length) blockers.push("studentHistory");
  if (intake) blockers.push("intake");
  const removed = {
    emails,
    credentials,
    notifications,
    deliveries,
    crewRequests,
    appeals,
    acknowledgements,
    academicProfiles,
    academics,
    currentDepartures,
    departures,
    patrols,
    observations,
    creditWindows,
  };
  const retained = {
    tutors: new Set([
      ...tutors.map((owner) => owner.tutorId),
      ...(user.tutorId ? [user.tutorId] : []),
    ]).size,
    students: new Set([
      ...students.map((owner) => owner.tuteeId),
      ...(user.studentId ? [user.studentId] : []),
    ]).size,
    messages,
    policies,
    audits,
    approvals,
    studentRequests,
    quarterBlocks,
  };
  // Bind account/credentials and every displayed consequence. Namespace/table fences
  // keep writers from adding a signup or changing these counts after validation.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        user,
        person,
        tutors,
        students,
        removed,
        retained,
        blockers,
      }),
    )
    .digest("hex");
  return {
    target: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      tutorId: user.tutorId,
      studentId: user.studentId,
    },
    fingerprint,
    blockers,
    removed,
    retained,
  };
}

/** Namespace → leadership → sorted account advisory locks → table fences → User
 * rows matches signup/profile writers and combine. Audit and deletion share the
 * caller's existing transaction, or one owned here when invoked independently. */
export async function deleteAccount(
  db: DomainDb,
  actorId: string,
  input: z.infer<typeof deleteAccountInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    const accountIds = [...new Set([actorId, input.userId])].sort();
    for (const id of accountIds) await lockEntity(tx, `account-profile:${id}`);
    // Take fences before row locks, avoiding a row/table upgrade inversion. Counted
    // scalar evidence lacks FK guards; the same fence protects concurrent additions.
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "AccountEmail", "StudentProfileOwnership", "TutorProfileOwnership", "AcademicProfile", "AcademicConfirmation", "SchoolDeparture", "SchoolDepartureEvent", "Patrol", "PatrolObservation", "PatrolCreditWindow", "EmailVerificationCode", "PasswordResetToken", "StudentActionConfirmation", "Notification", "EmailDelivery", "CrewStatusRequest", "AccountAppeal", "AnnouncementAck", "PolicyAcceptance", "DirectMessage", "AuditLog", "ApprovalRequest", "StudentRequestReview", "StudentQuarterBlock", "StudentSurvey" IN SHARE ROW EXCLUSIVE MODE`;
    for (const id of accountIds) await lockAccountProfile(tx, id);
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== "HEAD" || actor.suspendedAt || actor.mergedIntoId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the current active Head can delete accounts.",
      });
    if (
      !verifyPasswordConfirmation(
        actorId,
        input.confirmPassword,
        actor.passwordHash,
      )
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Password is incorrect.",
      });
    const preview = await previewDeleteAccount(tx, actorId, input.userId);
    if (preview.blockers.length) {
      const first = preview.blockers[0]!;
      throw new TRPCError({
        code:
          first === "self"
            ? "BAD_REQUEST"
            : first === "head"
              ? "FORBIDDEN"
              : "CONFLICT",
        message: preview.blockers.map((key) => blockerMessages[key]).join(" "),
      });
    }
    if (input.fingerprint !== preview.fingerprint)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Account details or dependencies changed. Review deletion again before confirming.",
      });
    if (preview.target.tutorId)
      await tx.user.update({
        where: { id: input.userId },
        data: { tutorId: null },
      });
    await tx.studentActionConfirmation.deleteMany({
      where: { userId: input.userId },
    });
    // The preview has excluded reviewed groups. A lone account's presentation
    // identity must not turn ordinary deletion into a foreign-key failure.
    await tx.person.updateMany({
      where: { primaryUserId: input.userId },
      data: { primaryUserId: null },
    });
    await tx.user.delete({ where: { id: input.userId } });
    await recordAudit(
      {
        userId: actorId,
        userName: actor.name ?? actor.username,
        entity: "User",
        entityId: input.userId,
        operation: "admin.deleteUser",
        role: actor.role,
        action: `Deleted account ${preview.target.name ?? preview.target.email}`,
        before: preview.target,
        after: null,
        effects: { removed: preview.removed, retained: preview.retained },
      },
      tx,
    );
    return { ok: true };
  });
}
