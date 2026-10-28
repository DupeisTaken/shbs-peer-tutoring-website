import { TRPCError } from "@trpc/server";
import { notificationInAppEvent } from "~/lib/notification-details";
import type { TransactionDb } from "~/server/transactions";
import {
  approveQualification,
  eligibleSubjectIds,
  lockCatalogue,
} from "~/server/qualifications";
import { courseChoices } from "~/server/course-choices";
import { subjectOrderBy } from "~/lib/course-catalogue";
import { validateInterviewDecision } from "~/server/interviews";
import { assertFeatureEnabled } from "~/server/program/features";
import { staleConflict } from "~/server/concurrency";
import { notifyAdmins, notifyTutors } from "~/server/notifications/create";
import {
  assertRequestProcessable,
  lockApplicationReview,
} from "~/server/request-invalidity";
import { lockUsernameNamespace } from "~/server/auth/username";
import {
  type InterviewService,
  interviewHourRows,
  sameInterviewCompletionEvidence,
  recordInterviewApprovalService,
} from "~/server/interview-hours";

export function assertQualificationReviewer(role: string) {
  if (role !== "ADMIN" && role !== "HEAD")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only Admin or Head may review qualification requests.",
    });
}

/** A variant is requestable only if it adds a subject or advances an already approved group. */
export async function qualificationOptions(db: TransactionDb, tutorId: string) {
  const [subjects, eligible] = await Promise.all([
    courseChoices(db),
    eligibleSubjectIds(db, tutorId),
  ]);
  const approved = new Set(eligible);
  const owned = subjects.filter((subject) => approved.has(subject.id));
  return subjects
    .filter(
      (subject) =>
        subject.active &&
        subject.level?.active !== false &&
        !approved.has(subject.id),
    )
    .flatMap((subject) => {
      const sameGroup = subject.groupId
        ? owned.filter((other) => other.groupId === subject.groupId)
        : [];
      const level = subject.level;
      if (
        sameGroup.length &&
        (!level ||
          sameGroup.some(
            (other) =>
              !other.level ||
              other.level.rank > level.rank ||
              (other.level.rank === level.rank && other.level.id >= level.id),
          ))
      )
        return [];
      return [
        {
          id: subject.id,
          name: subject.name,
          type: sameGroup.length
            ? ("HIGHER_LEVEL" as const)
            : ("ADDITIONAL_SUBJECT" as const),
        },
      ];
    });
}

/** Approval snapshots and status commit together. No account, membership or willingness changes. */
export async function decideQualificationApplication(
  tx: TransactionDb,
  actor: { id: string; role: string; tutorId: string | null },
  input: {
    id: string;
    accept: boolean;
    comment: string;
    expectedUpdatedAt: Date;
    completion?: InterviewService;
  },
) {
  assertQualificationReviewer(actor.role);
  // Match role/account changes' namespace-before-application lock order, then
  // re-read the chair account; a stale session cannot keep decision authority.
  await lockUsernameNamespace(tx);
  await lockApplicationReview(tx, input.id);
  const app = await tx.tutorApplication.findUniqueOrThrow({
    where: { id: input.id },
    include: { interviewers: true },
  });
  if (
    app.type === "INITIAL" ||
    !app.requestedTutorId ||
    !app.requestedSubjectId
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use the initial application workflow for this applicant.",
    });
  assertRequestProcessable(app);
  if (
    !["PENDING", "INTERVIEW"].includes(app.status) &&
    !(app.status === "ACCEPTED" && input.accept && input.completion)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This qualification request has already been decided.",
    });
  const currentActor = await tx.user.findUnique({
    where: { id: actor.id },
    select: {
      role: true,
      tutorId: true,
      suspendedAt: true,
      mergedIntoId: true,
      tutorAccessRevoked: true,
    },
  });
  if (!currentActor || currentActor.suspendedAt || currentActor.mergedIntoId)
    throw new TRPCError({ code: "FORBIDDEN" });
  assertQualificationReviewer(currentActor.role);
  // A revoked participation badge hides session.tutorId but must not enable self-review.
  if (
    actor.tutorId === app.requestedTutorId ||
    (await tx.user.count({
      where: { id: actor.id, tutorId: app.requestedTutorId },
    }))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Another Admin or Head must review your qualification request.",
    });
  let chairId: string | null = null;
  const hasPanel = app.status === "INTERVIEW" || app.interviewers.length > 0;
  // Direct review permits approval only; rejection must satisfy the chair and
  // completed panel-vote checks below, even when called outside the UI.
  if (!input.accept && !hasPanel)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "An interview is required before rejecting a qualification request.",
    });
  if (hasPanel) {
    await assertFeatureEnabled(tx, "INTERVIEWS");
    chairId = app.interviewers.find((person) => person.isHead)?.tutorId ?? null;
    if (
      !chairId ||
      chairId !== actor.tutorId ||
      currentActor.tutorId !== chairId ||
      currentActor.tutorAccessRevoked
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "The assigned Admin or Head chair must record the interview decision.",
      });
    await validateInterviewDecision(tx, app.id, input.accept, chairId);
    if (input.accept) {
      if (!input.completion)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Report interview duration, completion time and attendance before approving.",
        });
      if (
        app.status === "ACCEPTED" &&
        app.qualificationDecidedById === actor.id &&
        app.decidedByTutorId === chairId &&
        app.decisionComment === input.comment
      ) {
        const credits = await interviewHourRows(
          tx,
          app.id,
          app.interviewers.map((p) => p.tutorId),
        );
        if (sameInterviewCompletionEvidence(app, credits, input.completion))
          return { ok: true };
      }
    }
  }
  if (!["PENDING", "INTERVIEW"].includes(app.status))
    throw new TRPCError({
      code: "CONFLICT",
      message: "This qualification request has already been decided.",
    });
  if (app.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    staleConflict();
  if (hasPanel && input.accept && input.completion)
    await recordInterviewApprovalService(tx, app.id, app, input.completion);
  const snapshot: { id: string; name: string }[] = [];
  if (input.accept) {
    await lockCatalogue(tx);
    const subject = await tx.subject.findUniqueOrThrow({
      where: { id: app.requestedSubjectId },
    });
    if (!subject.active)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The requested subject is no longer offered.",
      });
    await approveQualification(
      tx,
      app.requestedTutorId,
      app.requestedSubjectId,
      actor.id,
    );
    // Copy the actual persisted source grant, even if another approval already created it.
    const grants = await tx.qualificationGrant.findMany({
      where: {
        tutorId: app.requestedTutorId,
        sourceSubjectId: app.requestedSubjectId,
      },
    });
    const subjects = await tx.subject.findMany({
      where: { id: { in: grants.map((grant) => grant.subjectId) } },
      orderBy: [...subjectOrderBy],
      select: { id: true, name: true },
    });
    snapshot.push(...subjects);
    if (!snapshot.length)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The approved qualification has no recorded grants.",
      });
  }
  await tx.tutorApplication.update({
    where: { id: app.id },
    data: {
      status: input.accept ? "ACCEPTED" : "REJECTED",
      decisionComment: input.comment,
      decidedAt: new Date(),
      decidedByTutorId: chairId,
      qualificationDecidedById: actor.id,
      qualificationSnapshot: snapshot,
    },
  });
  const requestedSubject = await tx.subject.findUnique({
    where: { id: app.requestedSubjectId },
    select: { name: true },
  });
  await notifyTutors(
    [app.requestedTutorId],
    {
      title: input.accept
        ? "Qualification request approved"
        : "Qualification request rejected",
      ...notificationInAppEvent(
        input.accept ? "qualification_approved" : "qualification_rejected",
        undefined,
        {
          en: `${app.name}'s qualification request${requestedSubject ? ` for ${requestedSubject.name}` : ""} was ${input.accept ? "approved" : "declined"}.`,
          zh: `${app.name} 的${requestedSubject ? ` ${requestedSubject.name} ` : ""}资格申请${input.accept ? "已获批准" : "未获批准"}。`,
        },
      ),
      body: input.comment,
      link: "/dashboard#qualification-requests",
    },
    tx,
  );
  if (hasPanel && input.accept)
    await notifyAdmins(
      {
        title: "Interview approved",
        ...notificationInAppEvent("interview_approved", undefined, {
          en: `${app.name}'s qualification interview was approved and the qualification changes were applied.`,
          zh: `${app.name} 的资格面试已获批准，资格变更已生效。`,
        }),
        link: `/admin/applications#application-${app.id}`,
        inAppOnly: true,
      },
      undefined,
      tx,
    );
  return { ok: true };
}
