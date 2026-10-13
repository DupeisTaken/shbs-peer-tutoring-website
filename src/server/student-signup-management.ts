import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { lockCatalogue } from "./qualifications";
import { lockStudentRequestReview } from "./request-invalidity";
import { assertSignupEditPeriod } from "./student-signup-editor";
import { consumeStudentAction } from "./student-workflow";
import {
  currentStudentSignupPayload,
  studentSignupLocalAnswers,
  studentSignupIntentDigest,
} from "./student-signup-answers";
import { recordDomainAudit } from "./audit/evidence";
import type { Prisma } from "../../generated/prisma";

export const headSignupUnassignInput = z
  .object({
    id: z.string().min(1).max(128),
    pairingId: z.string().min(1).max(128),
    expectedVersion: z.number().int().nonnegative(),
    clientKey: z.string().uuid(),
    signedTicket: z.string().min(1).max(128),
  })
  .strict();

/** Current public requests require Head for discretionary removals/course changes. Historical
 * repairs and domain-owned withdrawal, schedule and discipline transitions keep their own rules. */
async function currentPublicSignup(db: DomainDb, tuteeId: string) {
  const survey = await db.studentSurvey.findUnique({ where: { tuteeId } });
  if (survey)
    return (
      survey.state === "OPEN" &&
      !!(
        await db.term.findUnique({
          where: { id: survey.intakeTermId },
          select: { active: true },
        })
      )?.active
    );
  const profile = await db.tutee.findUnique({
    where: { id: tuteeId },
    select: { signupSource: true, intakeTermId: true, status: true },
  });
  if (profile?.signupSource !== "SELF_SERVICE" || profile.status === "INACTIVE")
    return false;
  return (
    !profile.intakeTermId ||
    !!(
      await db.term.findUnique({
        where: { id: profile.intakeTermId },
        select: { active: true },
      })
    )?.active
  );
}

export async function discretionarySignupChange(
  db: DomainDb,
  operation: string,
  raw: unknown,
) {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (
    (operation === "admin.updatePairing" ||
      operation === "admin.deletePairing") &&
    typeof input.id === "string"
  ) {
    const pairing = await db.pairing.findUnique({
      where: { id: input.id },
      select: {
        subject: true,
        tutees: { select: { tuteeId: true } },
        term: { select: { active: true } },
      },
    });
    if (!pairing?.term.active) return false;
    const retained = Array.isArray(input.tuteeIds) ? input.tuteeIds : [];
    for (const { tuteeId } of pairing.tutees)
      if (
        (operation === "admin.deletePairing" ||
          pairing.subject !== input.subject ||
          !retained.includes(tuteeId)) &&
        (await currentPublicSignup(db, tuteeId))
      )
        return true;
  }
  if (
    ["admin.updateTutee", "admin.setTuteeStatus", "admin.deleteTutee"].includes(
      operation,
    ) &&
    typeof input.id === "string" &&
    (await currentPublicSignup(db, input.id))
  ) {
    if (operation === "admin.deleteTutee") return true;
    const row = await db.tutee.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        firstChoiceId: true,
        secondChoiceId: true,
        pairings: {
          where: { pairing: { term: { active: true } } },
          select: { pairingId: true },
        },
      },
    });
    return (
      (input.status === "INACTIVE" && row.pairings.length > 0) ||
      (input.firstChoiceId !== undefined &&
        input.firstChoiceId !== row.firstChoiceId) ||
      (input.secondChoiceId !== undefined &&
        input.secondChoiceId !== row.secondChoiceId)
    );
  }
  return false;
}

/** Called again inside the write transaction; middleware classification alone is not a fence. */
export async function assertHeadDiscretionarySignupChange(
  tx: TransactionDb,
  userId: string,
  operation: string,
  input: unknown,
) {
  if (!(await discretionarySignupChange(tx, operation, input))) return;
  const actor = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, suspendedAt: true, mergedIntoId: true },
  });
  if (actor.role !== "HEAD" || actor.suspendedAt || actor.mergedIntoId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only Head can unassign public signup requests or change their assigned subjects.",
    });
  // Legacy profile tools cannot strand an assignment outside the source choices.
  // The dedicated Head editor explicitly reviews and releases affected links.
  if (
    operation === "admin.updateTutee" &&
    input &&
    typeof input === "object" &&
    "id" in input &&
    typeof input.id === "string"
  ) {
    const posted = input as Record<string, unknown>;
    const source = await tx.studentSurvey.findUnique({
      where: { tuteeId: input.id },
    });
    if (source) {
      const profile = await tx.tutee.findUniqueOrThrow({
        where: { id: input.id },
      });
      const selected = [
        posted.firstChoiceId === undefined
          ? profile.firstChoiceId
          : posted.firstChoiceId,
        posted.secondChoiceId === undefined
          ? profile.secondChoiceId
          : posted.secondChoiceId,
      ];
      const catalog = await tx.subject.findMany({
        where: {
          id: {
            in: selected.filter((v): v is string => typeof v === "string"),
          },
        },
        select: { name: true },
      });
      const assignments = await tx.pairingTutee.findMany({
        where: { tuteeId: input.id, pairing: { termId: source.intakeTermId } },
        select: { pairing: { select: { subject: true } } },
      });
      if (
        assignments.some(
          ({ pairing }) => !catalog.some((s) => s.name === pairing.subject),
        )
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Use the Head signup editor to change assigned choices and confirm which assignments to release.",
        });
    }
  }
}

export async function unassignStudentSignup(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof headSignupUnassignInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    const source = await tx.studentSurvey.findUniqueOrThrow({
      where: { id: input.id },
    });
    await lockStudentRequestReview(tx, source);
    const row = await tx.studentSurvey.findUniqueOrThrow({
      where: { id: input.id },
    });
    const actor = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (actor.role !== "HEAD" || actor.suspendedAt || actor.mergedIntoId)
      throw new TRPCError({ code: "FORBIDDEN" });
    const inputHash = studentSignupIntentDigest({
      operation: "headUnassign",
      id: input.id,
      pairingId: input.pairingId,
      expectedVersion: input.expectedVersion,
    });
    const prior = await tx.studentSignupRevision.findUnique({
      where: {
        surveyId_actorUserId_clientKey: {
          surveyId: row.id,
          actorUserId: userId,
          clientKey: input.clientKey,
        },
      },
    });
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "SIGNUP_RETRY_CHANGED",
        });
      return { ok: true, version: prior.version };
    }
    await assertSignupEditPeriod(tx, row);
    if (row.currentVersion !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This changed since you loaded it — refresh and try again.",
      });
    const pairing = await tx.pairing.findUnique({
      where: { id: input.pairingId },
      select: { termId: true },
    });
    if (
      !row.tuteeId ||
      pairing?.termId !== row.intakeTermId ||
      !(await tx.pairingTutee.findUnique({
        where: {
          pairingId_tuteeId: {
            pairingId: input.pairingId,
            tuteeId: row.tuteeId,
          },
        },
      }))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "The assignment changed. Reload the request.",
      });
    await consumeStudentAction(
      tx,
      input.signedTicket,
      userId,
      "SIGNUP_UNASSIGN",
      `${row.id}:${input.pairingId}`,
    );
    await tx.pairingTutee.delete({
      where: {
        pairingId_tuteeId: { pairingId: input.pairingId, tuteeId: row.tuteeId },
      },
    });
    if (
      !(await tx.pairingTutee.count({
        where: { tuteeId: row.tuteeId, pairing: { termId: row.intakeTermId } },
      }))
    )
      await tx.tutee.update({
        where: { id: row.tuteeId },
        data: { status: "PENDING" },
      });
    await tx.studentRequestReview.updateMany({
      where: {
        surveyId: row.id,
        pairingId: input.pairingId,
        kind: "SCHEDULE_CONFLICT",
        state: "PENDING",
      },
      data: {
        state: "DENIED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
      },
    });
    const version = row.currentVersion + 1;
    const answers = studentSignupLocalAnswers(
      currentStudentSignupPayload(row),
    ) as Prisma.InputJsonObject;
    await tx.studentSignupRevision.create({
      data: {
        surveyId: row.id,
        expectedVersion: row.currentVersion,
        version,
        actorUserId: userId,
        actorUserName: actor.name,
        clientKey: input.clientKey,
        inputHash,
        answers,
      },
    });
    await tx.studentSurvey.update({
      where: { id: row.id },
      data: {
        currentPayload: answers,
        currentVersion: version,
        editedAt: new Date(),
      },
    });
    await recordDomainAudit(tx, {
      operation: "studentWorkflow.headUnassign",
      entity: "StudentSurvey",
      entityId: row.id,
      action: "Head released current signup assignment",
      before: { currentVersion: row.currentVersion },
      after: { currentVersion: version },
      effects: {
        removedPairingId: input.pairingId,
        sessionsPreserved: true,
        priorityPreserved: true,
      },
    });
    return { ok: true, version };
  });
}
