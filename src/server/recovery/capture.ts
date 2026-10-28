import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";

export const recoveryAccountSelect = {
  id: true,
  role: true,
  tutorId: true,
  studentId: true,
  tuteeMember: true,
  tutorAccessRevoked: true,
  crewStatus: true,
  canTranslate: true,
  mergedIntoId: true,
  suspendedAt: true,
  sessionVersion: true,
  recoveryVoidedAt: true,
} as const;

/** JSON evidence is purpose-specific; passwords and invitation proof are never serialized. */
export function recoveryJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function recoveryHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function trackRecoveryEntity(
  tx: TransactionDb,
  actionId: string,
  entity: string,
  recordId: string,
) {
  await tx.recoveryTrackedEntity.createMany({
    data: { actionId, entity, recordId },
    skipDuplicates: true,
  });
}

/** Transaction-local capture can only be selected by trusted domain code. */
export async function selectRecoveryEvent(
  tx: TransactionDb,
  actionId: string,
  kind: string,
) {
  await tx.$queryRaw`SELECT set_config('shbs.recovery_action', ${actionId}, true), set_config('shbs.recovery_kind', ${kind}, true)`;
}

export async function beginAdmissionRecoveryCapture(
  tx: TransactionDb,
  applicationId: string,
) {
  const application = await tx.tutorApplication.findUniqueOrThrow({
    where: { id: applicationId },
  });
  if (application.type !== "INITIAL" || application.status === "ACCEPTED")
    return null;
  const email = application.email.trim().toLowerCase();
  const tutor = await tx.tutor.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
      preferredAssignedBlocks: true,
      workloadPreferenceVersion: true,
    },
  });
  const account = await tx.user.findUnique({
    where: { email },
    select: recoveryAccountSelect,
  });
  const action = await tx.recoveryAction.create({
    data: {
      kind: "INITIAL_ADMISSION",
      applicationId,
      before: recoveryJson({
        application: {
          status: application.status,
          decisionComment: application.decisionComment,
          decidedAt: application.decidedAt,
          decidedByTutorId: application.decidedByTutorId,
          promotedTutorId: application.promotedTutorId,
        },
        tutor,
        account,
      }),
    },
  });
  await trackRecoveryEntity(tx, action.id, "TutorApplication", applicationId);
  if (tutor) await trackRecoveryEntity(tx, action.id, "Tutor", tutor.id);
  if (account) await trackRecoveryEntity(tx, action.id, "User", account.id);
  await selectRecoveryEvent(tx, action.id, "ADMISSION");
  return action.id;
}

export async function finishAdmissionRecoveryCapture(
  tx: TransactionDb,
  actionId: string | null,
) {
  if (!actionId) return;
  const action = await tx.recoveryAction.findUniqueOrThrow({
    where: { id: actionId },
  });
  const application = await tx.tutorApplication.findUniqueOrThrow({
    where: { id: action.applicationId },
  });
  const tutor = application.promotedTutorId
    ? await tx.tutor.findUnique({
        where: { id: application.promotedTutorId },
        select: { id: true, status: true },
      })
    : null;
  const account = tutor
    ? await tx.user.findUnique({
        where: { tutorId: tutor.id },
        select: recoveryAccountSelect,
      })
    : null;
  const codeChanges = await tx.recoveryChange.findMany({
    where: { actionId, entity: "RegistrationCode", operation: "INSERT" },
    select: { recordKey: true },
    take: 201,
  });
  const codeIds = codeChanges.flatMap((change) =>
    typeof change.recordKey === "object" &&
    change.recordKey &&
    "id" in change.recordKey &&
    typeof change.recordKey.id === "string"
      ? [change.recordKey.id]
      : [],
  );
  const codes = await tx.registrationCode.findMany({
    where: { id: { in: codeIds } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (tutor) await trackRecoveryEntity(tx, actionId, "Tutor", tutor.id);
  if (account) await trackRecoveryEntity(tx, actionId, "User", account.id);
  for (const code of codes)
    await trackRecoveryEntity(tx, actionId, "RegistrationCode", code.id);
  await tx.recoveryAction.update({
    where: { id: actionId },
    data: {
      after: recoveryJson({
        tutor,
        account,
        codeIds: codes.map((code) => code.id),
      }),
    },
  });
}

export async function registrationRecoveryAction(
  tx: TransactionDb,
  applicationId: string | null,
  registrationCodeId: string,
) {
  if (!applicationId) return null;
  // Bind the consumed key to its exact prospective issuance generation. Choosing
  // the latest application approval would wrongly adopt a previous cycle's key.
  const candidates = await tx.recoveryAction.findMany({
    where: { applicationId, kind: "INITIAL_ADMISSION" },
    select: { id: true },
    take: 101,
  });
  if (candidates.length > 100) return null;
  const creation = await tx.recoveryChange.findFirst({
    where: {
      actionId: { in: candidates.map((candidate) => candidate.id) },
      entity: "RegistrationCode",
      operation: "INSERT",
      recordKey: { path: ["id"], equals: registrationCodeId },
    },
    orderBy: { id: "desc" },
    select: { actionId: true },
  });
  const action = creation
    ? await tx.recoveryAction.findUnique({ where: { id: creation.actionId } })
    : null;
  if (
    !action?.after ||
    action.applicationId !== applicationId ||
    (await tx.recoveryReceipt.findUnique({ where: { actionId: action.id } }))
  )
    return null;
  await selectRecoveryEvent(tx, action.id, "REGISTRATION");
  return action.id;
}

export async function captureRegistrationBefore(
  tx: TransactionDb,
  actionId: string,
  account: unknown,
) {
  const [identity] = await tx.$queryRaw<
    Array<{ id: string; transactionId: string }>
  >`SELECT md5(${actionId} || ':' || txid_current()::text) AS id, txid_current()::text AS "transactionId"`;
  if (!identity)
    throw new Error("Registration transaction identity unavailable.");
  await tx.recoveryEvent.createMany({
    data: {
      ...identity,
      actionId,
      kind: "REGISTRATION",
      payload: recoveryJson({ beforeAccount: account }),
    },
    skipDuplicates: true,
  });
}

/** A retained voided login can only receive access from a fresh, unvoided
 * admission generation in the current acceptance transaction. */
export async function isFreshAdmissionCapture(
  tx: TransactionDb,
  applicationId: string,
) {
  const roots = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT ra.id FROM "RecoveryAction" ra WHERE ra.id=NULLIF(current_setting('shbs.recovery_action',true),'') AND ra."applicationId"=${applicationId} AND ra.kind='INITIAL_ADMISSION' AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" rr WHERE rr."actionId"=ra.id)`;
  return roots.length === 1;
}
