import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { preservedRecoveryChange } from "../independent-changes";
import type { CheckpointJournalChange } from "../checkpoint-contract";

export function fieldsOnly(
  change: CheckpointJournalChange,
  entity: string,
  allowed: readonly string[],
) {
  return (
    change.entity === entity &&
    change.operation === "UPDATE" &&
    Array.isArray(change.changedFields) &&
    change.changedFields.length > 0 &&
    change.changedFields.every(
      (field) => typeof field === "string" && allowed.includes(field),
    )
  );
}
/** These facts remain live. Preserving them never grants access or copies a
 * signature; current eligibility is separately checked before activation. */
export function preservedCheckpointChange(change: CheckpointJournalChange) {
  if (preservedRecoveryChange(change)) return true;
  if (
    fieldsOnly(change, "User", [
      "tutorAccessRevoked",
      "sessionVersion",
      "refreshAuthorityRevision",
      "suspendedAt",
      "suspendedReason",
    ])
  )
    return true;
  if (
    change.operation === "INSERT" &&
    [
      "PolicyAcceptance",
      "AcademicConfirmation",
      "HistoricalAcademicRecord",
      "SchoolDepartureEvent",
    ].includes(change.entity)
  )
    return true;
  if (
    fieldsOnly(change, "AcademicProfile", [
      "status",
      "gradeLevel",
      "schoolYear",
      "confirmedAt",
      "reconfirmRequired",
      "updatedAt",
    ])
  )
    return true;
  if (
    change.entity === "AccountEmail" &&
    ["INSERT", "DELETE"].includes(change.operation)
  )
    return true;
  if (change.entity === "StudentActionConfirmation")
    return (
      ["INSERT", "DELETE"].includes(change.operation) ||
      fieldsOnly(change, "StudentActionConfirmation", ["usedAt", "expiresAt"])
    );
  return false;
}
export async function eligibilityBlocker(
  work: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    if (
      error instanceof TRPCError &&
      ["FORBIDDEN", "PRECONDITION_FAILED", "BAD_REQUEST", "CONFLICT"].includes(
        error.code,
      )
    )
      return error.message;
    throw error;
  }
}

/** Exact sources own restoration. Person metadata supplies a monotonic conflict
 * fence, never additional accounts, participants, consent or history authority. */
export async function participantIdentity(
  tx: TransactionDb,
  kind: "TUTOR" | "TUTEE",
  sourceId: string,
) {
  const source =
    kind === "TUTOR"
      ? await tx.tutor.findUniqueOrThrow({
          where: { id: sourceId },
          select: { id: true, personId: true, historyIdentityRevision: true },
        })
      : await tx.tutee.findUniqueOrThrow({
          where: { id: sourceId },
          select: { id: true, personId: true, historyIdentityRevision: true },
        });
  const direct = await tx.user.findMany({
    where: kind === "TUTOR" ? { tutorId: sourceId } : { studentId: sourceId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const retained =
    kind === "TUTOR"
      ? await tx.tutorProfileOwnership.findUnique({
          where: { tutorId: sourceId },
          select: { userId: true },
        })
      : await tx.studentProfileOwnership.findUnique({
          where: { tuteeId: sourceId },
          select: { userId: true },
        });
  const person = source.personId
    ? await tx.person.findUnique({
        where: { id: source.personId },
        select: {
          id: true,
          revision: true,
          mergedIntoId: true,
          primaryUserId: true,
          resolutionState: true,
        },
      })
    : null;
  const ownerIds = [
    ...new Set([
      ...direct.map((owner) => owner.id),
      ...(retained ? [retained.userId] : []),
    ]),
  ].sort();
  const owners = await tx.user.findMany({
    where: { id: { in: ownerIds } },
    select: {
      id: true,
      role: true,
      tutorId: true,
      studentId: true,
      tuteeMember: true,
      mergedIntoId: true,
      suspendedAt: true,
      tutorAccessRevoked: true,
      recoveryVoidedAt: true,
      sessionVersion: true,
      academicProfile: {
        select: {
          status: true,
          gradeLevel: true,
          schoolYear: true,
          reconfirmRequired: true,
          confirmedAt: true,
        },
      },
      schoolDeparture: {
        select: { reason: true, revision: true, observerRevoked: true },
      },
    },
    orderBy: { id: "asc" },
  });
  return { binding: { source, direct, retained, person }, owners, ownerIds };
}
export function snapshotObject(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Unsupported checkpoint snapshot.",
    });
  return value;
}
