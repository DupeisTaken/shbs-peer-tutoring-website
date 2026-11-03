import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockAccountProfile } from "~/server/account-profile-lock";
import { studentSignupAnswersInput } from "~/server/student-signup-state";
import { studentSignupLocalAnswers } from "~/server/student-signup-answers";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { recoveryHash, recoveryJson } from "./capture";
import type { CheckpointActor } from "./checkpoint-contract";
import { participantIdentity } from "./adapters/shared";
import { notifyUsers, notificationData } from "~/server/notifications/core";
import { withRecoveryDeliverySource } from "./delivery-effects";

const id = z.string().min(1).max(200);
async function owner(tx: TransactionDb, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (!user || user.suspendedAt || user.mergedIntoId || user.recoveryVoidedAt)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current active account must review this draft.",
    });
  return user;
}
async function exactOwner(
  tx: TransactionDb,
  sourceTuteeId: string,
  userId: string,
  bindingHash: string,
) {
  const identity = await participantIdentity(tx, "TUTEE", sourceTuteeId);
  if (
    identity.ownerIds.length !== 1 ||
    identity.ownerIds[0] !== userId ||
    recoveryHash(identity.binding) !== bindingHash
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Draft source ownership or grouping changed. Management must review a new draft.",
    });
}

/** Trusted checkpoint compensation creates a review draft, never a new signed
 * application. A participant must still submit through ordinary current intake. */
export async function createRecoveryWorkflowDraft(
  tx: TransactionDb,
  input: {
    actionId: string;
    sourceSurveyId: string;
    sourceTuteeId: string;
    answers: unknown;
  },
) {
  const identity = await participantIdentity(tx, "TUTEE", input.sourceTuteeId);
  if (identity.ownerIds.length !== 1)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A fresh request draft requires one exact current or retained owner.",
    });
  const [trusted] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT checkpoint.id FROM "RecoveryCheckpoint" checkpoint JOIN "RecoveryAction" action ON action.id=checkpoint."actionId"
    WHERE checkpoint."actionId"=${input.actionId}
    AND ((checkpoint.adapter='STUDENT_WORKFLOW' AND checkpoint."sourceId"=${input.sourceSurveyId})
      OR (checkpoint.adapter='PROGRAM_REFRESH' AND EXISTS(SELECT 1 FROM jsonb_array_elements(action."before"->'surveys') row WHERE row->>'id'=${input.sourceSurveyId})))
    AND checkpoint."actionId"=NULLIF(current_setting('shbs.recovery_compensating',true),'')`;
  if (!trusted)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Reviewed recovery transaction required.",
    });
  const answers = studentSignupAnswersInput.parse(
    studentSignupLocalAnswers(input.answers),
  );
  const draft = await tx.recoveryWorkflowDraft.create({
    data: {
      actionId: input.actionId,
      sourceSurveyId: input.sourceSurveyId,
      sourceTuteeId: input.sourceTuteeId,
      ownerUserId: identity.ownerIds[0]!,
      ownerBindingHash: recoveryHash(identity.binding),
      answers: recoveryJson(answers),
    },
  });
  await withRecoveryDeliverySource(
    tx,
    {
      entity: "StudentSurvey",
      recordId: input.sourceSurveyId,
      actionId: input.actionId,
    },
    () =>
      notifyUsers(
        [draft.ownerUserId],
        {
          ...notificationData("recovery_workflow_draft"),
          link: `/signup?recoveryDraft=${encodeURIComponent(draft.id)}`,
          inAppOnly: true,
        },
        tx,
      ),
  );
  return {
    outcome: "AWAITING_OWNER_ACTION",
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    version: draft.version,
    destination: `/signup?recoveryDraft=${encodeURIComponent(draft.id)}`,
    requiredAction:
      "Review and submit a new request with current policy agreement and fresh mailbox verification.",
  };
}

export async function readRecoveryWorkflowDraft(
  db: DomainDb,
  input: { draftId: string },
  actor: CheckpointActor,
) {
  return inTransaction(
    db,
    async (tx) => {
      await owner(tx, actor.id);
      const draft = await tx.recoveryWorkflowDraft.findUnique({
        where: { id: id.parse(input.draftId) },
      });
      if (draft?.ownerUserId !== actor.id)
        throw new TRPCError({ code: "NOT_FOUND" });
      await exactOwner(tx, draft.sourceTuteeId, actor.id, draft.ownerBindingHash);
      if (draft.state === "CONSUMED")
        return {
          draftId: draft.id,
          state: draft.state,
          version: draft.version,
          sourceSurveyId: draft.sourceSurveyId,
          submittedSurveyId: draft.submittedSurveyId,
          answers: null,
        };
      return {
        draftId: draft.id,
        state: draft.state,
        version: draft.version,
        sourceSurveyId: draft.sourceSurveyId,
        submittedSurveyId: null,
        answers: studentSignupAnswersInput.parse(draft.answers),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** This receipt consumes only the draft. It does not verify a mailbox, accept a
 * policy, activate participation or change the ordinary signup's proof/deadline. */
export async function consumeRecoveryWorkflowDraft(
  db: DomainDb,
  input: {
    draftId: string;
    expectedVersion: number;
    surveyId: string;
  },
  actor: CheckpointActor,
) {
  const parsed = z
    .object({
      draftId: id,
      expectedVersion: z.number().int().positive(),
      surveyId: id,
    })
    .strict()
    .parse(input);
  return inTransaction(
    db,
    async (tx) => {
      await lockEntity(tx, "program:period");
      await lockAccountProfile(tx, actor.id);
      await lockEntity(tx, `recovery-workflow-draft:${parsed.draftId}`);
      const user = await owner(tx, actor.id);
      const draft = await tx.recoveryWorkflowDraft.findUnique({
        where: { id: parsed.draftId },
      });
      if (draft?.ownerUserId !== actor.id)
        throw new TRPCError({ code: "NOT_FOUND" });
      await exactOwner(tx, draft.sourceTuteeId, actor.id, draft.ownerBindingHash);
      if (draft.state === "CONSUMED") {
        if (
          draft.submittedSurveyId !== parsed.surveyId ||
          draft.version !== parsed.expectedVersion + 1
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Draft adoption belongs to another submission.",
          });
        const submitted = await tx.studentSurvey.findUniqueOrThrow({
          where: { id: parsed.surveyId },
          select: { confirmedAt: true },
        });
        return {
          draftId: draft.id,
          surveyId: parsed.surveyId,
          version: draft.version,
          replayed: true,
          verificationRequired: !submitted.confirmedAt,
        };
      }
      if (draft.version !== parsed.expectedVersion)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Draft changed. Review it again.",
        });
      const survey = await tx.studentSurvey.findUniqueOrThrow({
        where: { id: parsed.surveyId },
      });
      const alias = await tx.accountEmail.findUnique({
        where: { email: survey.email.trim().toLowerCase() },
      });
      const ownedEmail =
        (user.email.trim().toLowerCase() ===
          survey.email.trim().toLowerCase() &&
          user.emailVerifiedAt !== null) ||
        (alias?.userId === actor.id && alias.verifiedAt !== null);
      const term = await tx.term.findUnique({
        where: { id: survey.intakeTermId },
        select: { active: true },
      });
      if (
        !ownedEmail ||
        survey.id === draft.sourceSurveyId ||
        survey.submittedAt < draft.createdAt ||
        survey.state !== "OPEN" ||
        !term?.active
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Submit a new ordinary request from your verified account mailbox before adopting this draft.",
        });
      const updated = await tx.recoveryWorkflowDraft.updateMany({
        where: {
          id: draft.id,
          state: "PENDING_OWNER_REVIEW",
          version: parsed.expectedVersion,
        },
        data: {
          state: "CONSUMED",
          version: { increment: 1 },
          submittedSurveyId: survey.id,
          consumedAt: new Date(),
        },
      });
      if (updated.count !== 1)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Draft adoption changed. Read its receipt.",
        });
      return {
        draftId: draft.id,
        surveyId: survey.id,
        version: draft.version + 1,
        replayed: false,
        verificationRequired: !survey.confirmedAt,
      };
    },
    { isolationLevel: "Serializable" },
  );
}
