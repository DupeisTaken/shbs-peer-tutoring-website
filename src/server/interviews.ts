import { lockCatalogue } from "~/server/qualifications";
import { assertRequestProcessable } from "~/server/request-invalidity";
import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";
import { isInterviewChairRole } from "~/lib/interview-chair";

/** New panels, decisions and first completion require an Admin/Head chair.
 * A recorded completion may retain its historical chair for hour corrections;
 * every other panel and qualification requirement remains current. */
export async function validatePanel(
  tx: TransactionDb,
  applicationId: string,
  tutorIds: string[],
  chairId: string,
  options: { chairEligibility?: "current" | "recorded" } = {},
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
  const chair = tutors.find((t) => t.id === chairId);
  if (
    !chair ||
    (options.chairEligibility !== "recorded" &&
      !isInterviewChairRole(chair.user?.role))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select an Admin or Head panelist as chair.",
    });
  const subjects = await tx.applicationSubjectIntent.findMany({
    where: { applicationId },
    select: { subjectId: true },
  });
  await lockCatalogue(tx);
  const qualified = await tx.qualificationGrant.count({
    where: {
      qualification: { status: "APPROVED" },
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
  assertRequestProcessable(
    await tx.tutorApplication.findUniqueOrThrow({
      where: { id: applicationId },
      select: { invalidatedAt: true },
    }),
  );
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
      message: "Only the selected panel chair may break a tie.",
    });
  if (yes * 2 !== panel.length && accept !== yes * 2 > panel.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The decision must follow the panel majority.",
    });
}
