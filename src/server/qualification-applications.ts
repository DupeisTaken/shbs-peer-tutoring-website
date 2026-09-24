import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";
import {
  approveQualification,
  eligibleSubjectIds,
  lockCatalogue,
} from "~/server/qualifications";
import { courseChoices } from "~/server/course-choices";
import { subjectOrderBy } from "~/lib/course-catalogue";
import { lockEntity } from "~/server/transactions";
import { validateInterviewDecision } from "~/server/interviews";
import { assertFeatureEnabled } from "~/server/program/features";
import { staleConflict } from "~/server/concurrency";
import { notifyTutors } from "~/server/notifications/create";

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
  },
) {
  assertQualificationReviewer(actor.role);
  await lockEntity(tx, `interview:${input.id}`);
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
  if (!["PENDING", "INTERVIEW"].includes(app.status))
    throw new TRPCError({
      code: "CONFLICT",
      message: "This qualification request has already been decided.",
    });
  if (app.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
    staleConflict();
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
  if (app.status === "INTERVIEW" || app.interviewers.length) {
    await assertFeatureEnabled(tx, "INTERVIEWS");
    chairId = app.interviewers.find((person) => person.isHead)?.tutorId ?? null;
    if (!chairId || chairId !== actor.tutorId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "The assigned Admin or Head chair must record the interview decision.",
      });
    await validateInterviewDecision(tx, app.id, input.accept, chairId);
  }
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
  await notifyTutors(
    [app.requestedTutorId],
    {
      title: input.accept
        ? "Qualification request approved"
        : "Qualification request rejected",
      body: input.comment,
      link: "/dashboard#qualification-requests",
    },
    tx,
  );
  return { ok: true };
}
