import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assignmentIdentity,
  isAssignmentOperation,
  isAssignableTutor,
} from "~/lib/assignment-qualification";
import { lockCatalogue } from "~/server/qualifications";
import { type TransactionDb, lockEntity } from "~/server/transactions";

const ACTION = "ASSIGNMENT_OVERRIDE";
const inputShape = z.object({
  id: z.string().optional(),
  tuteeId: z.string().optional(),
  tutorId: z.string().optional(),
  subjectId: z.string().optional(),
  subject: z.string().optional(),
  overrideTicket: z.string().optional(),
  tuteeIds: z.array(z.string()).optional(),
  assignments: z
    .array(
      z.object({
        tutorId: z.string(),
        subject: z.string(),
        subjectId: z.string().optional(),
      }),
    )
    .optional(),
});

export function overrideTarget(operation: string, input: unknown) {
  return createHash("sha256")
    .update(`${operation}:${assignmentIdentity(input)}`)
    .digest("hex");
}

/** Validate current catalogue/active-tutor state and inspect only persisted approved grants.
 * The catalogue lock serializes this check with qualification revocation and approval. */
export async function assignmentMismatches(
  tx: TransactionDb,
  operation: string,
  value: unknown,
) {
  if (!isAssignmentOperation(operation)) return [];
  await lockCatalogue(tx);
  const input = inputShape.parse(value);
  if (operation === "admin.updatePairing") {
    const current = await tx.pairing.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        tutorId: true,
        subject: true,
        tutees: { select: { tuteeId: true } },
      },
    });
    // Historical pairings remain editable for scheduling/removing students; only a new
    // tutor/course assignment or additional student needs renewed qualification evidence.
    if (
      current.tutorId === input.tutorId &&
      current.subject === input.subject &&
      !(input.tuteeIds ?? []).some(
        (id) => !current.tutees.some((row) => row.tuteeId === id),
      )
    )
      return [];
  }
  let selections = input.assignments ?? [
    {
      tutorId: input.tutorId!,
      subject: input.subject,
      subjectId: input.subjectId,
    },
  ];
  if (
    operation === "admin.assignTuteeToTutor" &&
    !input.subject &&
    !input.subjectId
  ) {
    const tutee = await tx.tutee.findUnique({
      where: { id: input.tuteeId },
      select: { firstChoiceId: true },
    });
    selections = [
      {
        tutorId: input.tutorId!,
        subjectId: tutee?.firstChoiceId ?? undefined,
        subject: undefined,
      },
    ];
  }
  const mismatches: {
    tutorId: string;
    tutorName: string;
    subjectId: string;
    subjectName: string;
  }[] = [];
  for (const selection of selections) {
    const subject = selection.subjectId
      ? await tx.subject.findUnique({
          where: { id: selection.subjectId },
          include: { level: true },
        })
      : selection.subject
        ? await tx.subject.findUnique({
            where: { name: selection.subject },
            include: { level: true },
          })
        : null;
    const tutor = await tx.tutor.findUnique({
      where: { id: selection.tutorId },
      include: { user: { select: { tutorAccessRevoked: true } } },
    });
    if (
      !subject?.active ||
      subject.level?.active === false ||
      !tutor ||
      !isAssignableTutor(tutor) ||
      (selection.subject && selection.subject !== subject.name)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Choose an active catalogue subject and tutor. Refresh if the subject changed.",
      });
    if (
      !(await tx.qualificationGrant.count({
        where: {
          tutorId: tutor.id,
          subjectId: subject.id,
          qualification: { status: "APPROVED" },
        },
      }))
    )
      mismatches.push({
        tutorId: tutor.id,
        tutorName: tutor.englishName,
        subjectId: subject.id,
        subjectName: subject.name,
      });
  }
  return mismatches;
}

export async function prepareAssignmentOverride(
  tx: TransactionDb,
  userId: string,
  operation: string,
  input: unknown,
) {
  await lockEntity(tx, `assignment-confirmation:${userId}`);
  const mismatches = await assignmentMismatches(tx, operation, input);
  // Every new opening invalidates earlier unused acknowledgements, including a cancelled popup.
  await tx.studentActionConfirmation.deleteMany({
    where: { userId, action: ACTION, usedAt: null },
  });
  if (!mismatches.length) return { mismatches, ticket: null };
  const now = Date.now();
  const ticket = await tx.studentActionConfirmation.create({
    data: {
      // Bind the exact displayed mismatches as well: a newly revoked grant or a renamed /
      // replaced legacy catalogue entry must never reuse an earlier acknowledgement.
      userId,
      action: ACTION,
      target: overrideTarget(operation, { input, mismatches }),
      readyAt: new Date(now + 3000),
      expiresAt: new Date(now + 5 * 60_000),
    },
    select: { id: true, readyAt: true },
  });
  return { mismatches, ticket };
}

/** Runs inside the live assignment or proposal transaction: one-use evidence cannot bypass
 * permissions, scheduling rules, stale request checks, or a different assignment payload. */
export async function enforceAssignmentQualification(
  tx: TransactionDb,
  userId: string,
  operation: string,
  input: unknown,
) {
  if (!isAssignmentOperation(operation)) return;
  const mismatches = await assignmentMismatches(tx, operation, input);
  if (!mismatches.length) return;
  const ticket = inputShape.parse(input).overrideTicket;
  const now = new Date();
  const claimed = ticket
    ? await tx.studentActionConfirmation.updateMany({
        where: {
          id: ticket,
          userId,
          action: ACTION,
          target: overrideTarget(operation, { input, mismatches }),
          usedAt: null,
          readyAt: { lte: now },
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      })
    : { count: 0 };
  if (!claimed.count)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This tutor has no approved qualification for the selected subject. Open the warning, wait three seconds, and explicitly confirm this assignment.",
    });
}
