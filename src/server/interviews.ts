import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

export const staffRank = (role: string | undefined) =>
  role === "HEAD" ? 3 : role === "ADMIN" ? 2 : role === "COORDINATOR" ? 1 : 0;
/** The chair is a highest-ranking staff panelist. Qualifications are explicit staff records. */
export async function validatePanel(
  tx: TransactionDb,
  applicationId: string,
  tutorIds: string[],
  chairId: string,
) {
  if (new Set(tutorIds).size < 3)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Assign at least three distinct interviewers.",
    });
  const tutors = await tx.tutor.findMany({
    where: { id: { in: tutorIds }, status: "ACTIVE" },
    include: { user: { select: { role: true, suspendedAt: true } } },
  });
  if (
    tutors.length !== tutorIds.length ||
    tutors.some((t) => !t.user || t.user.suspendedAt)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Every panelist needs an active tutor account.",
    });
  const rank = Math.max(...tutors.map((t) => staffRank(t.user?.role)));
  if (
    !rank ||
    staffRank(tutors.find((t) => t.id === chairId)?.user?.role) !== rank
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select a highest-ranking management member as panel chair.",
    });
  const subjects = await tx.applicationSubjectIntent.findMany({
    where: { applicationId },
    select: { subjectId: true },
  });
  const qualified = await tx.tutorQualification.count({
    where: {
      tutorId: { in: tutorIds },
      subjectId: { in: subjects.map((s) => s.subjectId) },
    },
  });
  if (!qualified)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The panel needs a staff-confirmed tutor qualified in an applicant subject.",
    });
}

/** Decisions cannot bypass missing votes or contradict the majority. Only the chair breaks ties. */
export async function validateInterviewDecision(
  tx: TransactionDb,
  applicationId: string,
  accept: boolean,
  actorTutorId: string | null,
) {
  const panel = await tx.interviewAssignment.findMany({
    where: { applicationId },
  });
  const chair = panel.find((p) => p.isHead);
  if (!chair)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Assign a valid interview panel first.",
    });
  await validatePanel(
    tx,
    applicationId,
    panel.map((p) => p.tutorId),
    chair.tutorId,
  );
  const votes = await tx.interviewVote.findMany({
    where: { applicationId, tutorId: { in: panel.map((p) => p.tutorId) } },
  });
  if (votes.length !== panel.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Every panelist must vote before the decision.",
    });
  const yes = votes.filter((v) => v.accept).length;
  if (yes * 2 === panel.length && actorTutorId !== chair.tutorId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the highest-ranking staff chair may break a tie.",
    });
  if (yes * 2 !== panel.length && accept !== yes * 2 > panel.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The decision must follow the panel majority.",
    });
}
