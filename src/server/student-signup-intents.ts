import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma, StudentSignupIntent } from "../../generated/prisma";
import { surveyInput } from "~/lib/student-signup";
import type { z } from "zod";
import {
  studentSignupIntentDigest,
  studentSignupLocalAnswers,
} from "./student-signup-answers";
import {
  normalizeStudentSignupAnswers,
  assignedSignupSubjects,
  assertSignupEditPeriod,
} from "./student-signup-editor";
import { ownedStudentIds } from "./student-ownership";
import { currentPolicy } from "./policy-acceptance";
import { getSignupSettings } from "./program/signup-fields";
import { normalizeTuteeFields, missingTuteeFields } from "~/lib/signup-fields";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import { lockCatalogue } from "./qualifications";
import { lockUsernameNamespace } from "./auth/username";
import { lockStudentRequestReview } from "./request-invalidity";
import { lockAccountProfile } from "./account-profile";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import {
  confirmSurvey,
  assertIntakeEligibility,
  surveyEmailCode,
} from "./student-survey";
import { emailSender, isEmailDeliveryAvailable } from "./email/sender";
import { emailOrigin } from "./email/urls";
import { requireSchoolParticipation } from "./school-departure";
import { signupRejected } from "./signup-admission";

type Input = z.infer<typeof surveyInput>;
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export const studentSignupAdmissionLane = (key: string) =>
  `tutee-intent:${hashKey(key)}`;
const inputDigest = (input: Input) =>
  studentSignupIntentDigest(JSON.parse(JSON.stringify(input)));
const invalid = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });

async function emailOwner(db: DomainDb, email: string) {
  return db.user.findFirst({
    where: {
      OR: [
        { email },
        { emails: { some: { email, verifiedAt: { not: null } } } },
      ],
    },
  });
}
function receipt(row: StudentSignupIntent) {
  // A random accepted-intent key recovers only its own nonprivate acknowledgement.
  // It grants neither a mailbox proof nor account/record access.
  return { ok: true, emailSent: !!row.emailSentAt, intentId: row.id };
}
export async function recoverStudentSignupIntent(
  db: DomainDb,
  input: Input,
  clientKey: string,
  submittedByUserId?: string,
  ownAdmission = false,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `student-signup-intent:${hashKey(clientKey)}`);
    const row = await tx.studentSignupIntent.findUnique({
      where: { keyHash: hashKey(clientKey) },
    });
    if (!row) {
      if (
        !ownAdmission &&
        (await tx.signupLease.findFirst({
          where: {
            slot: `${studentSignupAdmissionLane(clientKey)}:1`,
            expiresAt: { gt: new Date() },
          },
          select: { slot: true },
        }))
      )
        signupRejected(5);
      return null;
    }
    if (
      row.inputHash !== inputDigest(input) ||
      (row.submittedByUserId && row.submittedByUserId !== submittedByUserId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "SIGNUP_RETRY_CHANGED",
      });
    return receipt(row);
  });
}

/** Save new demand immediately, but stage a replacement independently. The live request's
 * verification token, first priority and answers remain usable until an authorized review. */
export async function stageStudentSignupIntent(
  db: DomainDb,
  posted: Input,
  clientKey: string,
  submittedByUserId?: string,
) {
  if (!isEmailDeliveryAvailable("PROGRAM"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email delivery is unavailable. Contact the team.",
    });
  const result = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    await lockEntity(tx, `student-signup-intent:${hashKey(clientKey)}`);
    const prior = await recoverStudentSignupIntent(
      tx,
      posted,
      clientKey,
      submittedByUserId,
      true,
    );
    if (prior) return { prior, intent: null };
    const term = await tx.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!term || recruitmentStatus(recruitmentWindow(term, "tutee")) !== "open")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Tutee recruitment is currently closed. You can still preview the form.",
      });
    const account = await emailOwner(tx, posted.email);
    if (account) {
      await lockAccountProfile(tx, account.id);
      await requireSchoolParticipation(tx, account.id);
      if (account.mergedIntoId || account.suspendedAt)
        throw new TRPCError({ code: "FORBIDDEN" });
    }
    await lockEntity(tx, `student-survey:${posted.email}`);
    const owned = account ? await ownedStudentIds(tx, account.id) : [];
    const addresses = account
      ? [
          account.email,
          ...(
            await tx.accountEmail.findMany({
              where: { userId: account.id, verifiedAt: { not: null } },
              select: { email: true },
            })
          ).map((a) => a.email),
        ]
      : [posted.email];
    const candidates = await tx.studentSurvey.findMany({
      where: {
        intakeTermId: term.id,
        state: "OPEN",
        OR: [
          { email: { in: [...new Set([posted.email, ...addresses])] } },
          ...(owned.length ? [{ tuteeId: { in: owned } }] : []),
        ],
      },
      orderBy: { submittedAt: "asc" },
      take: 2,
    });
    if (candidates.length > 1)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Multiple current requests need staff review before replacement.",
      });
    let row = candidates[0] ?? null;
    if (row) {
      await lockStudentRequestReview(tx, row);
      row = await tx.studentSurvey.findUniqueOrThrow({ where: { id: row.id } });
    }
    await assertIntakeEligibility(tx, term.id, posted.email, account, row?.id);
    const locked = row?.tuteeId
      ? await assignedSignupSubjects(tx, row.tuteeId, row.intakeTermId)
      : { subjectIds: [], unresolved: false };
    const answers = await normalizeStudentSignupAnswers(
      tx,
      posted,
      locked.subjectIds,
    );
    const fields = (await getSignupSettings(tx)).tutee;
    const input = { ...normalizeTuteeFields(posted, fields), ...answers };
    if (missingTuteeFields(input, fields).length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Complete the required signup fields.",
      });
    const policy = await currentPolicy(tx, "tutee-policy");
    if (policy.revision !== input.policyRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The policy changed. Read the current policy before submitting.",
      });
    const receivedAt = new Date();
    row ??= await tx.studentSurvey.create({
      data: {
        email: input.email,
        intakeTermId: term.id,
        payload: {
          ...input,
          academicAccountId: account?.id ?? null,
          academicProfileVersion: account?.profileVersion ?? null,
        },
        policyRevision: policy.revision,
        policySnapshot: policy.documents,
        submittedAt: receivedAt,
        tokenHash: hashKey(randomBytes(32).toString("hex")),
        expiresAt: new Date(+receivedAt + 86400000),
      },
    });
    await assertSignupEditPeriod(tx, row);
    const expiresAt = new Date(
      Math.min(
        +receivedAt + 86400000,
        row.verificationDueAt ? +row.verificationDueAt : Infinity,
      ),
    );
    const intent = await tx.studentSignupIntent.create({
      data: {
        keyHash: hashKey(clientKey),
        inputHash: inputDigest(posted),
        email: input.email,
        submittedByUserId: submittedByUserId ?? null,
        accountId: account?.id ?? null,
        sessionVersion: account?.sessionVersion ?? null,
        surveyId: row.id,
        expectedVersion: row.currentVersion,
        payload: input,
        policySnapshot: policy.documents,
        tokenHash: hashKey(randomBytes(32).toString("hex")),
        expiresAt,
        receivedAt,
      },
    });
    return { intent, prior: null };
  });
  if (result.prior) return result.prior;
  const intent = result.intent;
  const sent = await sendStudentSignupIntent(db, intent);
  if (sent)
    await db.studentSignupIntent.updateMany({
      where: { id: intent.id, completedAt: null, tokenHash: intent.tokenHash },
      data: { emailSentAt: new Date() },
    });
  return receipt(
    await db.studentSignupIntent.findUniqueOrThrow({
      where: { id: intent.id },
    }),
  );
}

async function sendStudentSignupIntent(
  db: DomainDb,
  intent: StudentSignupIntent,
) {
  try {
    await emailSender.send({
      category: "PROGRAM",
      signup: true,
      to: intent.email,
      subject: "Tutoring signup — verify this submission",
      text: `Your email verification code is ${surveyEmailCode(intent.tokenHash)}. / 您的邮箱验证码是 ${surveyEmailCode(intent.tokenHash)}。\n\nThis code is for this exact submitted signup. Your previous request stays unchanged until you sign in and review this submission. Priority and existing assignments are preserved. / 此验证码仅用于本次提交。登录并确认前，原申请保持不变。\n\nVerify by ${intent.expiresAt.toISOString()}.\n${emailOrigin()}/tutee-signup/account?intent=${intent.id}`,
    });
    return true;
  } catch {
    return false;
  }
}

/** Source validation is request-specific and does not require the live survey token to rotate. */
export async function validStudentSignupIntent(db: DomainDb, id: string) {
  const intent = await db.studentSignupIntent.findUnique({ where: { id } });
  if (
    !intent ||
    intent.completedAt ||
    intent.expiresAt <= new Date() ||
    intent.attempts >= 6
  )
    throw invalid();
  const row = await db.studentSurvey.findUniqueOrThrow({
    where: { id: intent.surveyId },
  });
  await assertSignupEditPeriod(db, row);
  if (row.invalidatedAt && !row.confirmedAt) throw invalid();
  if (row.currentVersion !== intent.expectedVersion)
    throw new TRPCError({ code: "CONFLICT", message: "SIGNUP_INTENT_STALE" });
  const owner = await emailOwner(db, intent.email);
  if (
    intent.accountId &&
    (owner?.id !== intent.accountId ||
      owner.sessionVersion !== intent.sessionVersion)
  )
    throw invalid();
  return { intent, row };
}

export async function verifyStudentSignupIntent(
  db: DomainDb,
  id: string,
  email: string,
  code: string,
) {
  const verified = await inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `student-signup-intent-id:${id}`);
    const { intent } = await validStudentSignupIntent(tx, id);
    if (intent.email !== email) return false;
    if (surveyEmailCode(intent.tokenHash) !== code.trim().toUpperCase()) {
      await tx.studentSignupIntent.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    if (!intent.verifiedAt)
      await tx.studentSignupIntent.update({
        where: { id },
        data: { verifiedAt: new Date() },
      });
    return true;
  });
  if (!verified) throw invalid();
  return validStudentSignupIntent(db, id);
}

export async function resendStudentSignupIntent(
  db: DomainDb,
  id: string,
  email: string,
) {
  const intent = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    await lockEntity(tx, `student-signup-intent-id:${id}`);
    const source = await validStudentSignupIntent(tx, id);
    await lockStudentRequestReview(tx, source.row);
    const fresh = await validStudentSignupIntent(tx, id);
    if (fresh.intent.email !== email) throw invalid();
    return fresh.intent;
  });
  // Rotate only this staged challenge after delivery succeeds; original request proof is untouched.
  const replacement = {
    ...intent,
    tokenHash: hashKey(randomBytes(32).toString("hex")),
  };
  const sent = await sendStudentSignupIntent(db, replacement);
  if (sent)
    await inTransaction(db, async (tx) => {
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      await lockCatalogue(tx);
      await lockEntity(tx, `student-signup-intent-id:${id}`);
      const source = await validStudentSignupIntent(tx, id);
      await lockStudentRequestReview(tx, source.row);
      const fresh = await validStudentSignupIntent(tx, id);
      if (fresh.intent.tokenHash !== intent.tokenHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "SIGNUP_INTENT_STALE",
        });
      await tx.studentSignupIntent.update({
        where: { id },
        data: {
          tokenHash: replacement.tokenHash,
          attempts: 0,
          verifiedAt: null,
          emailSentAt: new Date(),
        },
      });
    });
  return { emailSent: sent };
}

/** Shared invitation redemption calls this only after exact mailbox proof and established
 * account authentication/MFA. Its source write commits with the existing envelope receipt. */
export async function completeStudentSignupIntent(
  tx: TransactionDb,
  id: string,
  authenticatedUserId?: string,
  password?: string,
) {
  await lockCatalogue(tx);
  const initial = await validStudentSignupIntent(tx, id);
  await lockStudentRequestReview(tx, initial.row);
  const { intent, row } = await validStudentSignupIntent(tx, id);
  if (!intent.verifiedAt) throw invalid();
  const owner = await emailOwner(tx, intent.email);
  if (owner) {
    await lockAccountProfile(tx, owner.id);
    if (owner.id !== authenticatedUserId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "INVITATION_SIGN_IN_REQUIRED",
      });
    await requireSchoolParticipation(tx, owner.id);
    if (
      row.confirmedAt &&
      (!row.tuteeId ||
        !(await ownedStudentIds(tx, owner.id)).includes(row.tuteeId))
    )
      throw new TRPCError({ code: "FORBIDDEN" });
  } else if (row.confirmedAt) throw invalid();
  await assertIntakeEligibility(
    tx,
    row.intakeTermId,
    intent.email,
    owner,
    row.id,
  );
  const posted = surveyInput.parse(intent.payload);
  const assigned = row.tuteeId
    ? await assignedSignupSubjects(tx, row.tuteeId, row.intakeTermId)
    : { subjectIds: [], unresolved: false };
  if (assigned.unresolved)
    throw new TRPCError({
      code: "CONFLICT",
      message: "SIGNUP_ASSIGNMENT_UNKNOWN",
    });
  if (owner?.suspendedAt || owner?.mergedIntoId)
    throw new TRPCError({ code: "FORBIDDEN" });
  // Stage-time checks do not authorize stale catalog/configuration at final review.
  const normalized = await normalizeStudentSignupAnswers(
    tx,
    posted,
    assigned.subjectIds,
  );
  const fields = (await getSignupSettings(tx)).tutee;
  // Normalize once for current answers, retaining locked hidden second choices. Staged
  // explicit consent stays exact evidence even if signature visibility changes meanwhile.
  const accepted = {
    ...normalizeTuteeFields(posted, fields),
    ...normalized,
    signatureName: posted.signatureName,
  };
  if (missingTuteeFields(accepted, fields).length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Complete the current required signup fields.",
    });
  const answers = studentSignupLocalAnswers(accepted) as Prisma.InputJsonObject;
  const selected = [accepted.firstChoiceId, accepted.secondChoiceId];
  if (assigned.subjectIds.some((subjectId) => !selected.includes(subjectId)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED",
    });
  // Each deliberate new intent records explicit consent, even when answers match.
  // Only the same accepted intent's response recovery is deduplicated.
  const version = row.currentVersion + 1;
  {
    await tx.studentSurvey.update({
      where: { id: row.id },
      data: {
        currentPayload: answers,
        currentVersion: version,
        editedAt: new Date(),
      },
    });
  }
  if (!row.confirmedAt)
    await confirmSurvey(tx, row.tokenHash, password, {
      tokenIsDigest: true,
      authenticatedUserId: owner?.id,
      verifiedSignupIntentId: intent.id,
    });
  const account = await emailOwner(tx, intent.email);
  if (!account) throw invalid();
  await tx.studentSignupRevision.create({
    data: {
      surveyId: row.id,
      expectedVersion: row.currentVersion,
      version,
      actorUserId: account.id,
      actorUserName: account.name,
      clientKey: randomUUID(),
      inputHash: intent.inputHash,
      answers,
      policyRevision: posted.policyRevision,
      policySnapshot: intent.policySnapshot as Prisma.InputJsonValue,
      signatureName: posted.signatureName,
      policyAcceptedAt: intent.receivedAt,
    },
  });
  const updated = await tx.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  if (updated.tuteeId) {
    await tx.tutee.update({
      where: { id: updated.tuteeId },
      data: {
        phone: accepted.phone ?? null,
        preferredContact: accepted.preferredContact,
        firstChoiceId: accepted.firstChoiceId,
        secondChoiceId: accepted.secondChoiceId ?? null,
      },
    });
    await tx.tuteeAvailability.deleteMany({
      where: { tuteeId: updated.tuteeId },
    });
    await tx.tuteeAvailability.createMany({
      data: accepted.slotIds.map((slotId) => ({
        tuteeId: updated.tuteeId!,
        slotId,
      })),
    });
  }
  await tx.policyAcceptance.upsert({
    where: {
      userId_slug_revision: {
        userId: account.id,
        slug: "tutee-policy",
        revision: posted.policyRevision,
      },
    },
    update: {},
    create: {
      userId: account.id,
      slug: "tutee-policy",
      revision: posted.policyRevision,
      snapshot: intent.policySnapshot as Prisma.InputJsonValue,
      signature: posted.signatureName,
      acceptedAt: intent.receivedAt,
    },
  });
  await tx.studentSignupIntent.update({
    where: { id },
    data: {
      completedAt: new Date(),
      completedUserId: account.id,
      resultVersion: version,
    },
  });
}
