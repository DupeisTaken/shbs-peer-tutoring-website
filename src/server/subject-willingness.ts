import { TRPCError } from "@trpc/server";
import { eligibleSubjectIds } from "~/server/qualifications";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";

/** Intent never implies approval, and approval never manufactures intent. */
export async function willingSubjectIds(db: DomainDb, tutorId: string) {
  const rows = await db.tutorSubjectWillingness.findMany({
    where: { tutorId, willing: true },
    select: { subjectId: true },
    orderBy: { subjectId: "asc" },
  });
  return rows.map((row) => row.subjectId);
}

/** Subject eligibility for matching; callers still enforce timetable and capacity. */
export async function availableSubjectIds(db: DomainDb, tutorId: string) {
  const tutor = await db.tutor.findUnique({
    where: { id: tutorId },
    select: { status: true, user: { select: { tutorAccessRevoked: true } } },
  });
  if (tutor?.status !== "ACTIVE" || tutor.user?.tutorAccessRevoked) return [];
  const [eligible, willing] = await Promise.all([
    eligibleSubjectIds(db, tutorId),
    willingSubjectIds(db, tutorId),
  ]);
  const approvals = new Set(eligible);
  const subjects = await db.subject.findMany({
    where: {
      id: { in: willing.filter((id) => approvals.has(id)) },
      active: true,
      // Legacy level-less subjects remain usable; an archived level hides its variants.
      OR: [{ levelId: null }, { level: { active: true } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return subjects.map((subject) => subject.id);
}

/** Approval replay composes with its enclosing transaction. No qualification writes. */
export async function recordSubjectWillingness(
  db: DomainDb,
  input: { tutorId: string; subjectId: string; willing: boolean },
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(
      tx,
      `subject-willingness:${input.tutorId}:${input.subjectId}`,
    );
    const [tutor, subject] = await Promise.all([
      tx.tutor.findUnique({
        where: { id: input.tutorId },
        select: { id: true },
      }),
      tx.subject.findUnique({
        where: { id: input.subjectId },
        select: { active: true, level: { select: { active: true } } },
      }),
    ]);
    if (!tutor || !subject)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tutor or subject not found.",
      });
    if (input.willing && (!subject.active || subject.level?.active === false))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose an active subject.",
      });
    const row = await tx.tutorSubjectWillingness.upsert({
      where: {
        tutorId_subjectId: {
          tutorId: input.tutorId,
          subjectId: input.subjectId,
        },
      },
      create: input,
      update: { willing: input.willing },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        entity: "TutorSubjectWillingness",
        entityId: input.tutorId,
        action: `Recorded subject willingness: ${input.subjectId} = ${input.willing}`,
      },
    });
    return row;
  });
}
