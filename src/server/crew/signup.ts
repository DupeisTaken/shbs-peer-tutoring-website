import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma, type CrewSignupVerification } from "../../../generated/prisma";
import { optionalPersonNameFields } from "~/lib/person-name";
import { recordAudit } from "~/server/audit/log";
import { deliverAccountInvitation } from "~/server/auth/account-invitations";
import { generateRegistrationCode } from "~/server/auth/code";
import {
  hashCode,
  issueRegistrationCode,
  registrationCompletionProof,
  MAX_CODE_ATTEMPTS,
} from "~/server/auth/registration";
import { lockUsernameNamespace } from "~/server/auth/username";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { notifyAdmins } from "~/server/notifications/create";
import { getFeatures } from "~/server/program/features";
import {
  assertOfferedGrade,
  assertPrimaryName,
} from "~/server/program/profile-policy";
import { acceptPublicApplication } from "~/server/public-application-intake";
import {
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export const CREW_CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 6;
const invalid = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "SIGNUP_CREW_INVALID" });

export const crewApplicationInput = z.object({
  ...optionalPersonNameFields,
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  gradeLevel: z.number().int().min(1).max(12).nullable().optional(),
  preferredContact: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
});
type ApplicationInput = z.infer<typeof crewApplicationInput>;
type Receipt = Awaited<ReturnType<typeof deliverAccountInvitation>>;
export type CrewApplicationResult = {
  status: "PENDING" | "REJECTED" | "ACCEPTED" | "NOT_FOUND";
  statusProof: string;
  invitationState?: "AVAILABLE" | "USED" | "EXPIRED" | "UNAVAILABLE";
  invitation?: Receipt;
};

const normalizedEmail = (email: string) => email.trim().toLowerCase();
/** Optional application text stores whitespace-only answers as absent values. */
function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}
async function assertEnabled(client: DomainDb) {
  if (!(await getFeatures(client)).CREW)
    throw new TRPCError({ code: "FORBIDDEN", message: "CREW_DISABLED" });
}
function statusProof(row: CrewSignupVerification) {
  if (!row.verifiedAt) throw invalid();
  // Binding the exact application prevents proof for an earlier/no application from
  // locating a subsequently submitted record, even when the email is unchanged.
  return registrationCompletionProof(
    "crew",
    `${row.id}:${row.applicationId ?? "none"}`,
    row.codeHash,
    row.verifiedAt,
  );
}
function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Both new and returning applicants receive the same mailbox response. Drafts and
 * challenge replacements roll back on failed delivery; existing staff envelopes are
 * not changed until the replacement challenge has actually been verified. */
export async function stageCrewVerification(
  client: DomainDb,
  emailInput: string,
  draft?: ApplicationInput,
  resend = false,
) {
  if (!isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "SIGNUP_MAIL_FAILED",
    });
  const email = normalizedEmail(emailInput);
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await assertEnabled(tx);
    const prior = await tx.crewSignupVerification.findUnique({
      where: { email },
    });
    const stagedDraft =
      draft ??
      (resend && prior?.draft
        ? crewApplicationInput.parse(prior.draft)
        : undefined);
    const application =
      resend && prior
        ? prior.applicationId
          ? await tx.crewApplication.findUnique({
              where: { id: prior.applicationId },
              select: { id: true },
            })
          : null
        : await tx.crewApplication.findFirst({
            where: {
              email: { equals: email, mode: "insensitive" },
              ...(draft ? { status: "PENDING" as const } : {}),
            },
            orderBy: { createdAt: draft ? "asc" : "desc" },
            select: { id: true },
          });
    if (stagedDraft && !application) {
      await assertPrimaryName(tx, stagedDraft.name);
      await assertOfferedGrade(tx, stagedDraft.gradeLevel);
    }
    const keys = application
      ? await tx.registrationCode.findMany({
          where: { crewApplicationId: application.id, code: { not: null } },
          select: { code: true },
        })
      : [];
    let code = generateRegistrationCode();
    while (
      hashCode(code) === prior?.codeHash ||
      keys.some((key) => key.code === code)
    )
      code = generateRegistrationCode();
    const data = {
      applicationId: application?.id ?? null,
      draft:
        stagedDraft && !application
          ? (JSON.parse(
              JSON.stringify(crewApplicationInput.parse(stagedDraft)),
            ) as Prisma.InputJsonValue)
          : Prisma.DbNull,
      codeHash: hashCode(code),
      codeExpiresAt: new Date(Date.now() + CREW_CODE_TTL_MINUTES * 60_000),
      verifiedAt: null,
      attempts: 0,
    };
    await tx.crewSignupVerification.upsert({
      where: { email },
      create: { email, ...data },
      update: data,
    });
    // Bound cleanup never removes durable applications or a current live challenge.
    await tx.$executeRaw`DELETE FROM "CrewSignupVerification" WHERE id IN (
      SELECT id FROM "CrewSignupVerification" WHERE "codeExpiresAt" < ${new Date(Date.now() - 7 * 24 * 60 * 60_000)}
      LIMIT 100 FOR UPDATE SKIP LOCKED
    )`;
    await emailSender.send({
      category: "SECURITY",
      signup: true,
      to: email,
      subject: "Verify your crew application email / 验证工作人员申请邮箱",
      text: `Your crew application verification code is ${code}. It expires in ${CREW_CODE_TTL_MINUTES} minutes. This verifies your mailbox; crew access still requires approval.\n\n工作人员申请邮箱验证码为 ${code}，有效期 ${CREW_CODE_TTL_MINUTES} 分钟。此步骤仅验证邮箱，工作人员权限仍须审批。`,
      presentation: { code, eyebrow: "EMAIL VERIFICATION" },
    });
    return { ok: true as const };
  });
}

/** A verified draft joins the original idempotent intake transaction. Name/grade
 * policy is rechecked only for a new durable application; retries preserve the
 * existing answers, priority and one admin notification. */
export async function verifyCrewApplication(
  client: DomainDb,
  input: { email: string; code: string },
  headers: Headers,
) {
  const result = await inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await assertEnabled(tx);
    const email = normalizedEmail(input.email);
    await tx.$queryRaw`SELECT id FROM "CrewSignupVerification" WHERE email = ${email} FOR UPDATE`;
    let row = await tx.crewSignupVerification.findUnique({ where: { email } });
    if (!row || row.codeExpiresAt <= new Date() || row.attempts >= MAX_ATTEMPTS)
      return null;
    if (!equal(hashCode(input.code), row.codeHash)) {
      await tx.crewSignupVerification.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      return null;
    }
    const draft = row.draft ? crewApplicationInput.parse(row.draft) : null;
    if (draft && !row.applicationId) {
      await acceptPublicApplication(
        tx,
        { kind: "crew", email, headers },
        async (acceptedEmail) => {
          await assertPrimaryName(tx, draft.name);
          await assertOfferedGrade(tx, draft.gradeLevel);
          await tx.crewApplication.create({
            data: {
              ...draft,
              email: acceptedEmail,
              gradeLevel: draft.gradeLevel ?? null,
              preferredContact: optionalText(draft.preferredContact),
              message: optionalText(draft.message),
            },
          });
          await notifyAdmins(
            {
              title: "New crew application",
              body: `${draft.name} applied to join the crew.`,
              link: "/admin/crew",
            },
            undefined,
            tx,
          );
        },
      );
      const application = await tx.crewApplication.findFirstOrThrow({
        where: {
          email: { equals: email, mode: "insensitive" },
          status: "PENDING",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      row = await tx.crewSignupVerification.update({
        where: { id: row.id },
        data: { applicationId: application.id, draft: Prisma.DbNull },
      });
    }
    row = await tx.crewSignupVerification.update({
      where: { id: row.id },
      data: { verifiedAt: row.verifiedAt ?? new Date(), draft: Prisma.DbNull },
    });
    return applicationStatus(tx, row);
  });
  // Wrong guesses commit their attempt count before the public error is thrown.
  if (!result) throw invalid();
  return result;
}

/** Explicit, mailbox-proved refresh may recover/mint a receipt, so this is used
 * only by a mutation. Email alone never returns application status or its code. */
export async function crewApplicationStatus(
  client: DomainDb,
  input: { email: string; statusProof: string },
) {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await assertEnabled(tx);
    const row = await tx.crewSignupVerification.findUnique({
      where: { email: normalizedEmail(input.email) },
    });
    if (
      !row?.verifiedAt ||
      row.codeExpiresAt <= new Date() ||
      row.attempts >= MAX_ATTEMPTS ||
      !equal(input.statusProof, statusProof(row))
    )
      throw invalid();
    return applicationStatus(tx, row);
  });
}

async function applicationStatus(
  tx: TransactionDb,
  verification: CrewSignupVerification,
): Promise<CrewApplicationResult> {
  const proof = statusProof(verification);
  const application = verification.applicationId
    ? await tx.crewApplication.findUnique({
        where: { id: verification.applicationId },
      })
    : null;
  if (!application || normalizedEmail(application.email) !== verification.email)
    return { status: "NOT_FOUND", statusProof: proof };
  if (application.status !== "ACCEPTED")
    return { status: application.status, statusProof: proof };
  const result = { status: "ACCEPTED" as const, statusProof: proof };
  const active = await tx.registrationCode.findFirst({
    where: {
      crewApplicationId: application.id,
      kind: "CREW",
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_CODE_ATTEMPTS },
    },
    orderBy: { createdAt: "desc" },
  });
  const candidate =
    active ??
    (await tx.registrationCode.findFirst({
      where: { crewApplicationId: application.id, kind: "CREW" },
      orderBy: { createdAt: "desc" },
    }));
  if (!candidate) return { ...result, invitationState: "UNAVAILABLE" };
  await tx.$queryRaw`SELECT id FROM "RegistrationCode" WHERE id = ${candidate.id} FOR UPDATE`;
  // A legacy OTP writer/attempt counter can touch this row without the namespace
  // fence. Always re-read after its row lock rather than overwriting a stale grant.
  const grant = await tx.registrationCode.findUnique({
    where: { id: candidate.id },
  });
  if (
    !grant ||
    normalizedEmail(grant.email ?? "") !== verification.email ||
    grant.crewApplicationId !== application.id ||
    grant.kind !== "CREW"
  )
    return { ...result, invitationState: "UNAVAILABLE" };
  if (grant.usedAt) return { ...result, invitationState: "USED" };
  if (grant.expiresAt <= new Date())
    return { ...result, invitationState: "EXPIRED" };
  if (grant.attempts >= MAX_CODE_ATTEMPTS)
    return { ...result, invitationState: "UNAVAILABLE" };
  // Proof comes from the actual emailed crew challenge. Merely sending another
  // challenge leaves outstanding staff/mail envelopes untouched until verification.
  await tx.registrationCode.update({
    where: { id: grant.id },
    data: {
      pendingEmail: verification.email,
      emailCodeHash: verification.codeHash,
      emailCodeExpiresAt: new Date(
        Math.min(+grant.expiresAt, +verification.codeExpiresAt),
      ),
      emailVerifiedAt: verification.verifiedAt,
      ...(grant.emailCodeHash !== verification.codeHash
        ? { emailCodeAttempts: 0 }
        : {}),
    },
  });
  const invitation = await deliverAccountInvitation(tx, {
    display: true,
    kind: "CREW",
    email: verification.email,
    sourceKey: `crew:${application.id}:${grant.id}:${verification.codeHash}:${verification.verifiedAt!.toISOString()}`,
    source: { type: "staff", id: grant.id, challenge: verification.codeHash },
  });
  return { ...result, invitationState: "AVAILABLE", invitation };
}

/** Decisions, durable code issuance and audit commit together. All crew decision,
 * revoke, status and redemption paths acquire the invitation namespace first;
 * this prevents opposing application/code row locks from deadlocking. */
export async function decideCrewApplication(
  client: DomainDb,
  input: {
    applicationId: string;
    action: "ACCEPT" | "REJECT";
    comment?: string;
  },
  actor: { id: string; name: string | null },
) {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await assertEnabled(tx);
    // Leadership transfer has its own lock, so hold this actor row through the
    // decision rather than assuming the invitation namespace freezes Head authority.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
    if (currentActor?.role !== "HEAD" || currentActor.suspendedAt)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only Head may decide crew participation.",
      });
    await tx.$queryRaw`SELECT id FROM "CrewApplication" WHERE id = ${input.applicationId} FOR UPDATE`;
    const application = await tx.crewApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
    });
    if (application.status !== "PENDING")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This application is already decided.",
      });
    const issued =
      input.action === "ACCEPT"
        ? await issueRegistrationCode(
            {
              email: application.email,
              kind: "CREW",
              crewApplicationId: application.id,
              label: `${application.name} (crew)`,
              issuedById: actor.id,
              issuedByName: actor.name,
            },
            tx,
          )
        : null;
    await tx.crewApplication.update({
      where: { id: application.id },
      data: {
        status: input.action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
        decisionComment: optionalText(input.comment),
        decidedByName: actor.name,
        decidedAt: new Date(),
      },
    });
    await recordAudit(
      {
        userId: actor.id,
        userName: actor.name,
        action: `${input.action === "ACCEPT" ? "Accepted" : "Rejected"} crew application from ${application.name}`,
        entity: "CrewApplication",
        entityId: application.id,
      },
      tx,
    );
    return { ok: true, code: issued?.code ?? null };
  });
}
