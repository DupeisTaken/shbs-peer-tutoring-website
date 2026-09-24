import { TRPCError } from "@trpc/server";
import { inheritedSubjectIds } from "~/lib/course-catalogue";
import {
  lockEntity,
  type TransactionDb,
  type DomainDb,
} from "~/server/transactions";

/** Catalogue writes and approvals share this lock so each snapshot has one coherent order. */
export const lockCatalogue = (tx: TransactionDb) =>
  lockEntity(tx, "course-catalogue");

export async function approveQualification(
  tx: TransactionDb,
  tutorId: string,
  subjectId: string,
  approvedById: string,
) {
  await lockCatalogue(tx);
  await tx.tutor.findUniqueOrThrow({ where: { id: tutorId } });
  const source = await tx.subject.findUniqueOrThrow({
    where: { id: subjectId },
    include: { level: true },
  });
  if (!source.active || source.level?.active === false)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active subject and level.",
    });
  const existing = await tx.tutorQualification.findUnique({
    where: { tutorId_subjectId: { tutorId, subjectId } },
  });
  // Retrying an existing approval must not silently expand its historical grant set.
  if (existing?.status === "APPROVED") return existing;
  const offerings = source.groupId
    ? await tx.subject.findMany({
        where: { groupId: source.groupId },
        include: { level: true },
      })
    : [source];
  const qualification = await tx.tutorQualification.upsert({
    where: { tutorId_subjectId: { tutorId, subjectId } },
    update: { status: "APPROVED", approvedById, createdAt: new Date() },
    create: { tutorId, subjectId, approvedById, status: "APPROVED" },
  });
  await tx.qualificationGrant.deleteMany({
    where: { tutorId, sourceSubjectId: subjectId },
  });
  await tx.qualificationGrant.createMany({
    data: inheritedSubjectIds(source, offerings).map((id) => ({
      tutorId,
      sourceSubjectId: subjectId,
      subjectId: id,
    })),
  });
  return qualification;
}

/** Shared by interview panels, assignment checks, availability and tutor detail projections. */
export async function eligibleSubjectIds(db: DomainDb, tutorId: string) {
  const grants = await db.qualificationGrant.findMany({
    where: { tutorId, qualification: { status: "APPROVED" } },
    select: { subjectId: true },
    distinct: ["subjectId"],
  });
  return grants.map((grant) => grant.subjectId);
}

export async function assertQualified(
  tx: TransactionDb,
  tutorId: string,
  subjectId: string,
) {
  await lockCatalogue(tx);
  if (!(await tx.tutor.count({ where: { id: tutorId, status: "ACTIVE" } })))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active tutor.",
    });
  if (
    !(await tx.qualificationGrant.count({
      where: { tutorId, subjectId, qualification: { status: "APPROVED" } },
    }))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose a tutor with an approved qualification for this subject.",
    });
}

export async function assertQualifiedByName(
  tx: TransactionDb,
  tutorId: string,
  name: string,
) {
  const subject = await tx.subject.findUnique({ where: { name } });
  if (!subject?.active)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active catalogue subject.",
    });
  await assertQualified(tx, tutorId, subject.id);
}
