/** Database-injected review state and fences; no notice dispatch or web startup. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { staleConflict } from "~/server/concurrency";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { lockEntity, type TransactionDb } from "~/server/transactions";

/** Reasons are required even when clearing a flag, so both directions remain explainable. */
export const requestInvalidityInput = z.object({
  id: z.string().min(1).max(128),
  invalid: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  expectedInvalidityVersion: z.number().int().nonnegative(),
});
export const emptyRequestInvalidity = {
  isInvalid: false,
  invalidReason: null,
  invalidatedAt: null,
  invalidatedById: null,
  invalidatedByName: null,
  invalidityVersion: 0,
};
export type Invalidity = {
  invalidReason: string | null;
  invalidatedAt: Date | null;
  invalidatedById: string | null;
  invalidatedByName: string | null;
  invalidityVersion: number;
};

/** Return review text only to authorized staff; a badge alone is safe for read-only lists. */
export function requestInvalidity(row: Invalidity, privateDetails = true) {
  return {
    isInvalid: !!row.invalidatedAt,
    invalidReason: privateDetails ? row.invalidReason : null,
    invalidatedAt: privateDetails ? row.invalidatedAt : null,
    invalidatedById: privateDetails ? row.invalidatedById : null,
    invalidatedByName: privateDetails ? row.invalidatedByName : null,
    invalidityVersion: privateDetails ? row.invalidityVersion : 0,
  };
}

export function assertRequestProcessable(row: { invalidatedAt: Date | null }) {
  if (row.invalidatedAt)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This request is flagged as invalid. Clear its flag before processing it.",
    });
}

/** Advisory locks order requests, but cannot refresh an existing Serializable snapshot.
 * Locking the source row afterwards makes PostgreSQL reject stale approval/processing
 * snapshots when a flag committed while the caller waited. Keep the lock through writes. */
async function lockCurrentReviewRow(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (isSerializationFailure(error)) staleConflict();
    throw error;
  }
}

export async function lockApplicationReview(tx: TransactionDb, id: string) {
  await lockEntity(tx, `interview:${id}`);
  await lockCurrentReviewRow(
    () =>
      tx.$queryRaw`SELECT id FROM "TutorApplication" WHERE id = ${id} FOR UPDATE`,
  );
}

export async function lockStudentRequestReview(
  tx: TransactionDb,
  row: { id: string; email: string },
) {
  await lockEntity(tx, `student-survey:${row.email}`);
  await lockCurrentReviewRow(
    () =>
      tx.$queryRaw`SELECT id FROM "StudentSurvey" WHERE id = ${row.id} FOR UPDATE`,
  );
}

export async function lockLegacySignupReview(tx: TransactionDb, id: string) {
  await lockEntity(tx, `tutee:${id}`);
  await lockCurrentReviewRow(
    () => tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${id} FOR UPDATE`,
  );
}

/** Deletion is not a way around a flagged public request's retained review evidence. */
export async function assertTuteeInvalidityCleared(
  tx: TransactionDb,
  tuteeId: string,
) {
  const survey = await tx.studentSurvey.findUnique({
    where: { tuteeId },
    select: { id: true, email: true },
  });
  if (survey) {
    await lockStudentRequestReview(tx, survey);
    assertRequestProcessable(
      await tx.studentSurvey.findUniqueOrThrow({ where: { id: survey.id } }),
    );
  } else {
    await lockLegacySignupReview(tx, tuteeId);
    const review = await tx.tuteeRequestInvalidity.findUnique({
      where: { tuteeId },
    });
    if (review) assertRequestProcessable(review);
  }
}

