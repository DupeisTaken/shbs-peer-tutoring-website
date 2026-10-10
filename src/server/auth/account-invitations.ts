import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
  AccountInvitation,
  RegistrationCode,
  ViewerSignup,
  StudentSurvey,
} from "../../../generated/prisma";
import { db } from "~/server/db";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { emailOrigin } from "~/server/email/urls";
import { getFeatures } from "~/server/program/features";
import { lockAccountProfile } from "~/server/account-profile";
import { lockUsernameNamespace } from "./username";
import { hashPassword } from "./password";
import {
  generateRegistrationCode,
  normalizeRegCode,
  REG_CODE_ALPHABET,
  REG_CODE_LENGTH,
} from "./code";
import {
  hashCode,
  registrationCompletionProof,
  completeRegistration,
  codePrefill,
  MAX_CODE_ATTEMPTS,
  assertCrewRegistrationSource,
} from "./registration";
import { completeViewerSignup } from "./viewer-signup";
import {
  validSurvey,
  confirmSurvey,
  surveyInput,
} from "~/server/student-survey";
import {
  setupInvitation,
  completeHistoryAccount,
} from "~/server/history-account-setup";
import { notifyAdmins } from "~/server/notifications/create";
import { normalizeGrade } from "~/lib/academics";

/** Authorization remains source-owned. Only this recipient-delivered envelope is login proof;
 * staff-visible registration keys never authenticate a user. Source revisions prevent a stale
 * envelope surviving replacement, cancellation, profile changes or reissued verification. */
const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("staff"), id: z.string(), challenge: z.string() }),
  z.object({
    type: z.literal("viewer"),
    id: z.string(),
    challenge: z.string(),
    verifiedAt: z.string(),
  }),
  z.object({ type: z.literal("tutee"), tokenHash: z.string() }),
  z.object({
    type: z.literal("history"),
    tokenHash: z.string(),
    challenge: z.string(),
    verifiedAt: z.string(),
  }),
]);
export type InvitationSource = z.infer<typeof sourceSchema>;
const invalid = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });
const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "INVITATION_ACCOUNT_CHANGED" });
const TTL = 15 * 60_000;
const MAX_ATTEMPTS = 6;

/** Public invitation mutations bypass signed-in audit middleware. Capture lifecycle
 * state explicitly in their transaction, excluding all codes, proofs and addresses. */
function invitationEvidence(row: AccountInvitation | null) {
  return row
    ? {
        exists: true,
        kind: row.kind,
        displayed: row.displayedCode,
        verified: Boolean(row.verifiedAt),
        completed: Boolean(row.completedAt),
        loginUsed: Boolean(row.loginUsedAt),
        attempts: row.attempts,
        expiresAt: row.expiresAt.toISOString(),
        recipientId: row.completedUserId,
      }
    : { exists: false };
}
async function recordInvitationLifecycle(
  tx: TransactionDb,
  row: AccountInvitation,
  operation: string,
  before: AccountInvitation | null,
  userId?: string,
  outcome = "APPLIED",
) {
  const actor = userId
    ? await tx.user.findUnique({
        where: { id: userId },
        select: { name: true, role: true },
      })
    : null;
  await tx.auditLog.create({
    data: {
      userId: userId ?? null,
      userName: actor?.name ?? "Public registration",
      entity: "AccountInvitation",
      entityId: row.id,
      kind: "ACTION",
      operation,
      action: "Account invitation lifecycle changed",
      details: {
        actorRole: actor?.role ?? "PUBLIC",
        outcome,
        before: invitationEvidence(before),
        after: invitationEvidence(row),
        sourceType: sourceSchema.parse(row.source).type,
      },
    },
  });
}

/** The completed envelope locates a historical claim without storing its raw legacy token.
 * This only returns a source digest to server callers; normal staff/record checks still run. */
export async function historyInvitationDigest(
  client: DomainDb,
  invitationId: string,
  userId: string,
) {
  const row = await client.accountInvitation.findUnique({
    where: { id: invitationId },
  });
  if (!row?.completedAt || row.completedUserId !== userId) throw invalid();
  const source = sourceSchema.parse(row.source);
  if (source.type !== "history") throw invalid();
  return source.tokenHash;
}

/** Compatibility adapters accept the exact outstanding proof, never a posted account ID.
 * Viewer verification still issues a distinct emailed invitation before any account write. */
export async function issueViewerAccountInvitation(
  client: DomainDb,
  email: string,
  proof: string,
  display = false,
) {
  const row = await client.viewerSignup.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (
    !row?.verifiedAt ||
    row.usedAt ||
    row.codeExpiresAt <= new Date() ||
    !equal(
      proof,
      registrationCompletionProof(
        "viewer",
        row.id,
        row.codeHash,
        row.verifiedAt,
      ),
    )
  )
    throw invalid();
  return deliverAccountInvitation(client, {
    display,
    kind: "VIEWER",
    email: row.email,
    sourceKey: `viewer:${row.id}:${row.codeHash}:${row.verifiedAt.toISOString()}`,
    source: {
      type: "viewer",
      id: row.id,
      challenge: row.codeHash,
      verifiedAt: row.verifiedAt.toISOString(),
    },
  });
}

export async function issueHistoryAccountInvitation(
  client: DomainDb,
  input: { token: string; email: string; completionProof: string },
  display = false,
) {
  return inTransaction(client, async (tx) => {
    const { invite } = await setupInvitation(tx, input.token, input.email);
    if (
      !invite.setupVerifiedAt ||
      !invite.setupCodeHash ||
      !invite.setupCodeExpiresAt ||
      invite.setupCodeExpiresAt <= new Date() ||
      !equal(
        input.completionProof,
        registrationCompletionProof(
          "history",
          invite.tokenHash,
          invite.setupCodeHash,
          invite.setupVerifiedAt,
        ),
      )
    )
      throw invalid();
    return deliverAccountInvitation(tx, {
      display,
      kind: "HISTORY",
      email: invite.email,
      sourceKey: `history:${invite.tokenHash}:${invite.setupCodeHash}`,
      source: {
        type: "history",
        tokenHash: invite.tokenHash,
        challenge: invite.setupCodeHash,
        verifiedAt: invite.setupVerifiedAt.toISOString(),
      },
    });
  });
}

export async function issueSurveyAccountInvitation(
  client: DomainDb,
  token: string,
) {
  const survey = await validSurvey(client, token);
  return deliverAccountInvitation(client, {
    kind: "TUTEE",
    email: survey.email,
    sourceKey: `tutee:${survey.id}:${survey.tokenHash}`,
    source: { type: "tutee", tokenHash: survey.tokenHash },
  });
}

export async function invitationEmailOwner(client: DomainDb, email: string) {
  return client.user.findFirst({
    where: {
      OR: [
        { email },
        { emails: { some: { email, verifiedAt: { not: null } } } },
      ],
    },
  });
}

/** Read identity again after the credential lock. Alias transfer, account combination,
 * recovery and password rotation must revoke old proofs even on read-only previews. */
async function lockedInvitationOwner(
  tx: TransactionDb,
  row: AccountInvitation,
) {
  const candidate = await invitationEmailOwner(tx, row.email);
  if (candidate) await lockAccountProfile(tx, candidate.id);
  const owner = await invitationEmailOwner(tx, row.email);
  if (
    (owner?.id ?? null) !== row.accountId ||
    (owner?.sessionVersion ?? null) !== row.sessionVersion ||
    owner?.mergedIntoId
  )
    throw conflict();
  return owner;
}

function proofFor(row: AccountInvitation) {
  if (!row.verifiedAt) throw invalid();
  return registrationCompletionProof(
    "invitation",
    `account:${row.id}`,
    row.codeHash,
    row.verifiedAt,
  );
}
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function receiptKind(row: AccountInvitation) {
  const receipt = z.object({ kind: z.string() }).safeParse(row.receipt);
  return receipt.success ? receipt.data.kind : row.kind;
}
function receiptAcademicConfirmation(row: AccountInvitation) {
  const receipt = z
    .object({ academicConfirmationRequired: z.boolean() })
    .safeParse(row.receipt);
  return receipt.success && receipt.data.academicConfirmationRequired;
}

/** Validate live source authority under the same transaction as verification/redemption.
 * The source's own completion still performs its full domain checks before writing. */
async function sourceState(
  tx: TransactionDb,
  row: AccountInvitation,
): Promise<{
  source: InvitationSource;
  staff?: RegistrationCode;
  viewer?: ViewerSignup;
  survey?: StudentSurvey;
  history?: Awaited<ReturnType<typeof setupInvitation>>;
}> {
  const source = sourceSchema.parse(row.source);
  if (source.type === "staff") {
    await tx.$queryRaw`SELECT id FROM "RegistrationCode" WHERE id = ${source.id} FOR UPDATE`;
    const staff = await tx.registrationCode.findUnique({
      where: { id: source.id },
    });
    if (
      !staff ||
      staff.usedAt ||
      staff.expiresAt <= new Date() ||
      staff.attempts >= 10 ||
      staff.emailCodeHash !== source.challenge ||
      staff.pendingEmail !== row.email ||
      !staff.emailCodeExpiresAt ||
      staff.emailCodeExpiresAt <= new Date()
    )
      throw invalid();
    await assertCrewRegistrationSource(tx, staff);
    return { source, staff };
  }
  if (source.type === "viewer") {
    await tx.$queryRaw`SELECT id FROM "ViewerSignup" WHERE id = ${source.id} FOR UPDATE`;
    if (!(await getFeatures(tx)).VIEWER_SIGNUP) throw invalid();
    const viewer = await tx.viewerSignup.findUnique({
      where: { id: source.id },
    });
    if (
      viewer?.email !== row.email ||
      viewer.usedAt ||
      viewer.codeHash !== source.challenge ||
      viewer.verifiedAt?.toISOString() !== source.verifiedAt ||
      viewer.codeExpiresAt <= new Date()
    )
      throw invalid();
    return { source, viewer };
  }
  if (source.type === "tutee") {
    await tx.$queryRaw`SELECT id FROM "StudentSurvey" WHERE "tokenHash" = ${source.tokenHash} FOR UPDATE`;
    const survey = await validSurvey(tx, source.tokenHash, true);
    if (survey.email !== row.email) throw invalid();
    return { source, survey };
  }
  const history = await setupInvitation(tx, source.tokenHash, row.email, true);
  if (
    history.invite.setupCodeHash !== source.challenge ||
    history.invite.setupVerifiedAt?.toISOString() !== source.verifiedAt ||
    !history.invite.setupCodeExpiresAt ||
    history.invite.setupCodeExpiresAt <= new Date()
  )
    throw invalid();
  return { source, history };
}

/** SMTP failure rolls back the envelope and leaves the previous usable code intact.
 * Calls require an already validated source; sourceState rechecks it before publishing. */
export async function deliverAccountInvitation(
  client: DomainDb,
  input: {
    kind: string;
    email: string;
    source: InvitationSource;
    sourceKey: string;
    code?: string;
    display?: boolean;
  },
) {
  if (!input.display && !isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "SIGNUP_MAIL_FAILED",
    });
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `account-invitation:${input.sourceKey}`);
    const email = input.email.trim().toLowerCase();
    const prior = await tx.accountInvitation.findUnique({
      where: { sourceKey: input.sourceKey },
    });
    if (prior?.completedAt) throw invalid();
    if (
      prior &&
      ((input.display && prior.displayedCode) ||
        (!input.display &&
          !prior.displayedCode &&
          prior.createdAt > new Date(Date.now() - 60_000)))
    ) {
      if (prior.expiresAt <= new Date() || prior.attempts >= MAX_ATTEMPTS)
        throw invalid();
      await sourceState(tx, prior);
      await lockedInvitationOwner(tx, prior);
      return invitationReceipt(prior);
    }
    const owner = await invitationEmailOwner(tx, email);
    // Combined identities never acquire a fresh session or participation through a retired alias.
    if (owner?.mergedIntoId) throw conflict();
    // Staff and displayed invitations share the legacy five-character namespace.
    // Persist the winning nonce so retries recover the exact same code, including
    // when another invitation or the source email challenge occupied a candidate.
    let displayCodeNonce: number | null = null;
    let code = input.display ? "" : (input.code ?? generateRegistrationCode());
    if (input.display) {
      let found = false;
      for (let nonce = 0; nonce < 1000; nonce++) {
        const candidate = displayedInvitationCode(input.sourceKey, nonce);
        if (!/[A-Z]/.test(candidate) || !/[02-9]/.test(candidate)) continue;
        const candidateHash = hashCode(candidate);
        if (
          "challenge" in input.source &&
          candidateHash === input.source.challenge
        )
          continue;
        const staff = await tx.registrationCode.findUnique({
          where: { code: candidate },
          select: { id: true },
        });
        const invitation = await tx.accountInvitation.findFirst({
          where: { displayedCode: true, codeHash: candidateHash },
          select: { id: true },
        });
        if (staff || invitation) continue;
        code = candidate;
        displayCodeNonce = nonce;
        found = true;
        break;
      }
      if (!found)
        throw new Error("Could not generate a unique invitation code.");
    }
    // Viewer/history verification and invitation are deliberately distinct secrets.
    while (
      !input.display &&
      !input.code &&
      "challenge" in input.source &&
      hashCode(code) === input.source.challenge
    )
      code = generateRegistrationCode();
    const data = {
      kind: input.kind,
      email,
      source: input.source,
      codeHash: hashCode(code),
      displayedCode: Boolean(input.display),
      displayCodeNonce,
      emailCodeHash: null,
      emailCodeExpiresAt: null,
      expiresAt: new Date(Date.now() + TTL),
      accountId: owner?.id ?? null,
      sessionVersion: owner?.sessionVersion ?? null,
      attempts: 0,
      verifiedAt: input.display ? new Date() : null,
      loginUsedAt: null,
      createdAt: new Date(),
    };
    const row = await tx.accountInvitation.upsert({
      where: { sourceKey: input.sourceKey },
      create: { sourceKey: input.sourceKey, ...data },
      update: data,
    });
    const state = await sourceState(tx, row);
    const sourceExpiry = state.staff
      ? Math.min(+state.staff.expiresAt, +state.staff.emailCodeExpiresAt!)
      : state.viewer
        ? +state.viewer.codeExpiresAt
        : state.history
          ? Math.min(
              +state.history.invite.expiresAt,
              +state.history.invite.setupCodeExpiresAt!,
            )
          : state.survey
            ? Math.min(
                +state.survey.expiresAt,
                state.survey.verificationDueAt
                  ? +state.survey.verificationDueAt
                  : Infinity,
              )
            : +row.expiresAt;
    const expiresAt = new Date(Math.min(+row.expiresAt, sourceExpiry));
    const issued = await tx.accountInvitation.update({
      where: { id: row.id },
      data: { expiresAt },
    });
    await recordInvitationLifecycle(
      tx,
      issued,
      "accountInvitation.issue",
      prior,
    );
    if (input.display) return invitationReceipt(row);
    const url = `${emailOrigin()}/register?invitation=${encodeURIComponent(row.id)}`;
    await emailSender.send({
      category: "SECURITY",
      to: email,
      subject: "Your account invitation / 账号邀请码",
      text: `Your invitation code is ${code}. It expires at ${expiresAt.toISOString()} (UTC). Enter it at ${url}. If you already have an account, this signs you in without changing your password or memberships. Review any added access separately.\n\n您的邀请码是 ${code}，有效期至 ${expiresAt.toISOString()}（UTC）。请前往 ${url} 输入。已有账号可登录，密码和身份不会改变；新增权限须另行确认。`,
      presentation: {
        code,
        eyebrow: "ACCOUNT INVITATION",
        action: { label: "Review invitation / 查看邀请", url },
      },
    });
    return invitationReceipt(row);
  });
}

function displayedInvitationCode(
  sourceKey: string,
  nonce: number | null,
  storedCodeHash?: string,
) {
  const digest = registrationCompletionProof(
    "invitation",
    nonce === null ? `display:${sourceKey}` : `display:${sourceKey}:${nonce}`,
    "display",
    new Date(0),
  );
  const derive = (alphabet: string) => {
    let entropy = BigInt(`0x${digest}`);
    let code = "";
    for (let i = 0; i < REG_CODE_LENGTH; i++) {
      code += alphabet[Number(entropy % BigInt(alphabet.length))];
      entropy /= BigInt(alphabet.length);
    }
    return code;
  };
  const current =
    nonce === null
      ? digest.slice(0, 12).toUpperCase()
      : derive(REG_CODE_ALPHABET);
  if (storedCodeHash === undefined || equal(hashCode(current), storedCodeHash))
    return current;
  // Changing the alphabet changes the base conversion. Recover old five-character
  // receipts only when their persisted hash proves the original derivation; never
  // silently replace a recipient's code or guess a format from its nonce.
  if (nonce !== null) {
    const legacy = derive("23456789ABCDEFGHJKMNPQRSTUVWXYZ");
    if (equal(hashCode(legacy), storedCodeHash)) return legacy;
  }
  throw invalid();
}

function invitationReceipt(row: AccountInvitation) {
  return {
    invitationId: row.id,
    ...(row.displayedCode
      ? {
          code: displayedInvitationCode(
            row.sourceKey,
            row.displayCodeNonce,
            row.codeHash,
          ),
          proof: proofFor(row),
          email: row.email,
        }
      : {}),
  };
}

/** A displayed code is access authorization only. The original verified browser or
 * exact signed-in recipient can continue; everyone else must verify their mailbox. */
export async function enterDisplayedInvitation(
  client: DomainDb,
  input: { code: string; proof?: string; userId?: string },
) {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    const code = normalizeRegCode(input.code);
    const staff = await tx.registrationCode.findUnique({ where: { code } });
    const rows = await tx.accountInvitation.findMany({
      where: {
        codeHash: hashCode(code),
        displayedCode: true,
      },
      take: 2,
    });
    // Never choose a source by length or priority. An ambiguous legacy/imported
    // collision fails closed; normal issuance serializes both namespaces.
    if (staff && rows.length) throw invalid();
    if (staff) {
      if (
        staff.usedAt ||
        staff.expiresAt <= new Date() ||
        staff.attempts >= MAX_CODE_ATTEMPTS
      )
        throw invalid();
      return {
        kind: "staff" as const,
        invitationId: "",
        boundEmail: staff.email?.toLowerCase() ?? null,
        proof: undefined,
        email: undefined,
      };
    }
    const row = rows.length === 1 ? rows[0] : undefined;
    if (!row) throw invalid();
    const owner = await lockedInvitationOwner(tx, row);
    const authenticated = owner !== null && owner.id === input.userId;
    const verified =
      authenticated ||
      (input.proof !== undefined && equal(input.proof, proofFor(row)));
    // Recover a committed receipt without replaying its consumed source. Expired
    // receipts remain available only to the exact authenticated current recipient.
    if (
      row.completedAt &&
      verified &&
      (authenticated || row.expiresAt > new Date())
    )
      return {
        kind: "display" as const,
        invitationId: row.id,
        proof: proofFor(row),
        email: row.email,
      };
    if (
      row.completedAt ||
      row.expiresAt <= new Date() ||
      row.attempts >= MAX_ATTEMPTS
    )
      throw invalid();
    await sourceState(tx, row);
    return {
      kind: "display" as const,
      invitationId: row.id,
      ...(verified ? { proof: proofFor(row), email: row.email } : {}),
    };
  });
}

/** Optional delivery never rotates the invitation or loses the onscreen receipt. */
export async function emailDisplayedInvitation(
  client: DomainDb,
  input: { invitationId: string; proof: string },
) {
  if (!isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "SIGNUP_MAIL_FAILED",
    });
  const info = await inspectAccountInvitation(client, input);
  const row = await client.accountInvitation.findUniqueOrThrow({
    where: { id: input.invitationId },
  });
  if (!row.displayedCode || info.completed) throw invalid();
  const code = displayedInvitationCode(
    row.sourceKey,
    row.displayCodeNonce,
    row.codeHash,
  );
  const url = `${emailOrigin()}/register?invitation=${encodeURIComponent(row.id)}&code=${code}`;
  await emailSender.send({
    category: "SECURITY",
    to: row.email,
    subject: "Your account invitation / 账号邀请码",
    text: `Your invitation code is ${code}. Continue at ${url}. Expires ${row.expiresAt.toISOString()}. / 您的邀请码是 ${code}。请通过链接继续注册。`,
    presentation: {
      code,
      action: { label: "Continue to signup / 继续注册", url },
    },
  });
  return { ok: true };
}

export async function sendInvitationVerification(
  client: DomainDb,
  input: { invitationId: string; code: string; email: string },
) {
  if (!isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "SIGNUP_MAIL_FAILED",
    });
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `account-invitation-id:${input.invitationId}`);
    const row = await tx.accountInvitation.findUnique({
      where: { id: input.invitationId },
    });
    if (
      !row?.displayedCode ||
      row.completedAt ||
      row.expiresAt <= new Date() ||
      row.attempts >= MAX_ATTEMPTS ||
      row.email !== input.email.trim().toLowerCase() ||
      !equal(row.codeHash, hashCode(normalizeRegCode(input.code)))
    )
      throw invalid();
    await sourceState(tx, row);
    await lockedInvitationOwner(tx, row);
    let code = generateRegistrationCode();
    // The mailbox challenge must remain a different secret, including on resend.
    while (
      hashCode(code) === row.codeHash ||
      hashCode(code) === row.emailCodeHash
    )
      code = generateRegistrationCode();
    const expiresAt = new Date(Math.min(+row.expiresAt, Date.now() + TTL));
    await emailSender.send({
      category: "SECURITY",
      to: row.email,
      subject: "Verify your email / 验证邮箱",
      text: `Your email verification code is ${code}. / 您的邮箱验证码是 ${code}。`,
      presentation: { code },
    });
    const challenged = await tx.accountInvitation.update({
      where: { id: row.id },
      data: { emailCodeHash: hashCode(code), emailCodeExpiresAt: expiresAt },
    });
    await recordInvitationLifecycle(
      tx,
      challenged,
      "accountInvitation.challenge",
      row,
    );
    return { invitationId: row.id };
  });
}

/** Read data only after mailbox proof (or the exact authenticated recipient). */
export async function inspectAccountInvitation(
  client: DomainDb,
  input: {
    invitationId: string;
    proof?: string;
    userId?: string;
  },
) {
  return inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    const row = await tx.accountInvitation.findUnique({
      where: { id: input.invitationId },
    });
    if (!row?.verifiedAt) throw invalid();
    const owner = await lockedInvitationOwner(tx, row);
    const authenticated = owner && owner.id === input.userId;
    // A saved receipt remains readable by its exact current recipient after code expiry.
    // This never revives mailbox proof, an unfinished invitation or its login exchange.
    if (row.expiresAt <= new Date() && !(row.completedAt && authenticated))
      throw invalid();
    if (!authenticated && (!input.proof || !equal(input.proof, proofFor(row))))
      throw invalid();
    if (row.completedAt)
      return {
        kind: receiptKind(row),
        email: row.email,
        completed: true,
        academicConfirmationRequired: receiptAcademicConfirmation(row),
        needsPassword: false,
        existing: true,
        name: owner?.name ?? "",
        legacyName: null as string | null,
        firstName: "",
        lastName: "",
        preferredName: "",
        alternativeNames: "",
        gradeLevel: null as number | null,
        requiresSignIn: !authenticated,
        mfaRequired: Boolean(
          owner?.twoFactorEnabled && (await getFeatures(tx)).EMAIL_2FA,
        ),
        completionProof: proofFor(row),
      };
    const state = await sourceState(tx, row);
    const identity = owner
      ? {
          firstName: owner.firstName ?? "",
          lastName: owner.lastName ?? "",
          preferredName: owner.preferredName ?? "",
          alternativeNames: owner.alternativeNames ?? "",
          gradeLevel: owner.gradeLevel,
        }
      : state.staff
        ? await codePrefill(state.staff, tx)
        : state.viewer
          ? {
              firstName: state.viewer.firstName ?? "",
              lastName: state.viewer.lastName ?? "",
              preferredName: state.viewer.preferredName ?? "",
              alternativeNames: state.viewer.alternativeNames ?? "",
              gradeLevel: null,
            }
          : state.survey
            ? surveyInput.parse(state.survey.payload)
            : {
                firstName: "",
                lastName: "",
                preferredName: "",
                alternativeNames: "",
                gradeLevel: null,
              };
    const mfaRequired = Boolean(
      owner?.twoFactorEnabled && (await getFeatures(tx)).EMAIL_2FA,
    );
    const legacyName = "legacyName" in identity ? identity.legacyName : null;
    return {
      kind: owner && state.source.type === "viewer" ? "LOGIN" : row.kind,
      email: row.email,
      completed: false,
      academicConfirmationRequired: false,
      existing: Boolean(owner),
      name:
        owner?.name ??
        state.viewer?.name ??
        state.history?.record.englishName ??
        legacyName ??
        "",
      legacyName,
      firstName: identity.firstName ?? "",
      lastName: identity.lastName ?? "",
      preferredName: identity.preferredName ?? "",
      alternativeNames: identity.alternativeNames ?? "",
      gradeLevel: normalizeGrade(identity.gradeLevel).gradeLevel,
      needsPassword: !owner?.passwordHash,
      requiresSignIn: Boolean(owner?.passwordHash && !authenticated),
      mfaRequired,
      completionProof: proofFor(row),
    };
  });
}

/** Attempts commit even when incorrect. Verified proof is stable across a lost response;
 * the independent loginUsedAt boundary still allows exactly one session exchange. */
export async function verifyAccountInvitation(
  client: DomainDb,
  input: {
    invitationId: string;
    email: string;
    code: string;
  },
) {
  const result = await inTransaction(client, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `account-invitation-id:${input.invitationId}`);
    const row = await tx.accountInvitation.findUnique({
      where: { id: input.invitationId },
    });
    if (
      !row ||
      row.completedAt ||
      row.expiresAt <= new Date() ||
      row.attempts >= MAX_ATTEMPTS
    )
      return null;
    if (
      row.email !== input.email.trim().toLowerCase() ||
      (row.displayedCode &&
        (!row.emailCodeHash ||
          !row.emailCodeExpiresAt ||
          row.emailCodeExpiresAt <= new Date())) ||
      !equal(
        hashCode(normalizeRegCode(input.code)),
        row.displayedCode ? (row.emailCodeHash ?? "") : row.codeHash,
      )
    ) {
      const attempted = await tx.accountInvitation.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      await recordInvitationLifecycle(
        tx,
        attempted,
        "accountInvitation.verify",
        row,
        undefined,
        "DENIED",
      );
      return null;
    }
    const state = await sourceState(tx, row);
    await lockedInvitationOwner(tx, row);
    const verifiedAt = row.verifiedAt ?? new Date();
    if (state.staff)
      await tx.registrationCode.update({
        where: { id: state.staff.id },
        data: { emailVerifiedAt: verifiedAt },
      });
    const verified = await tx.accountInvitation.update({
      where: { id: row.id },
      data: { verifiedAt },
    });
    if (!row.verifiedAt)
      await recordInvitationLifecycle(
        tx,
        verified,
        "accountInvitation.verify",
        row,
      );
    return { proof: proofFor(verified) };
  });
  if (!result) throw invalid();
  return result;
}

/** Auth.js calls this purpose-specific verifier; no staff code, password replacement or
 * client-selected user ID can create a session. Enforced MFA uses the existing sign-in flow. */
export async function consumeInvitationLogin(
  invitationId: string,
  proof: string,
) {
  return db.$transaction(async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `account-invitation-id:${invitationId}`);
    const row = await tx.accountInvitation.findUnique({
      where: { id: invitationId },
    });
    if (
      !row?.verifiedAt ||
      row.expiresAt <= new Date() ||
      row.loginUsedAt ||
      !equal(proof, proofFor(row))
    )
      return null;
    if (!row.completedAt) await sourceState(tx, row);
    const owner = await lockedInvitationOwner(tx, row);
    if (
      !owner ||
      owner.mergedIntoId ||
      !owner.passwordHash ||
      owner.id !== row.accountId ||
      owner.sessionVersion !== row.sessionVersion
    )
      return null;
    if (owner.twoFactorEnabled && (await getFeatures(tx)).EMAIL_2FA)
      return null;
    const consumed = await tx.accountInvitation.update({
      where: { id: row.id },
      data: { loginUsedAt: new Date() },
    });
    await recordInvitationLifecycle(
      tx,
      consumed,
      "accountInvitation.login",
      row,
      owner.id,
    );
    return {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      sessionVersion: owner.sessionVersion,
    };
  });
}

export const invitationProfile = z.object({
  invitationId: z.string().min(1).max(128),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  preferredName: z.string().trim().max(100).optional(),
  alternativeNames: z.string().trim().max(200).optional(),
  gradeLevel: z.number().int().min(1).max(12).nullable().optional(),
  password: z.string().min(8).max(200).optional(),
  reviewed: z.literal(true),
});

/** The source write and completion receipt commit together. Retrying a lost successful
 * response returns its receipt and never rotates credentials or repeats membership writes. */
export async function redeemAccountInvitation(
  client: DomainDb,
  input: z.infer<typeof invitationProfile>,
  userId?: string,
  loginOnly = false,
) {
  return inTransaction(client, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `account-invitation-id:${input.invitationId}`);
    const row = await tx.accountInvitation.findUnique({
      where: { id: input.invitationId },
    });
    if (!row?.verifiedAt || !equal(input.proof, proofFor(row))) throw invalid();
    if (row.completedAt)
      return {
        ok: true,
        completed: true,
        kind: receiptKind(row),
        academicConfirmationRequired: receiptAcademicConfirmation(row),
      };
    if (row.expiresAt <= new Date() || row.attempts >= MAX_ATTEMPTS)
      throw invalid();
    const state = await sourceState(tx, row);
    const owner = await lockedInvitationOwner(tx, row);
    // Server sign-in may finish only an established account's Viewer request. Every
    // invitation that adds participation retains the explicit user review boundary.
    if (loginOnly && (!state.viewer || !owner?.passwordHash)) throw invalid();
    if (owner) {
      await lockAccountProfile(tx, owner.id);
      if (
        owner.mergedIntoId ||
        owner.id !== row.accountId ||
        owner.sessionVersion !== row.sessionVersion
      )
        throw conflict();
      // A genuinely unfinished account has no password; its mailbox proof completes setup.
      if (owner.passwordHash && owner.id !== userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "INVITATION_SIGN_IN_REQUIRED",
        });
      if (owner.suspendedAt && state.source.type !== "viewer")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "INVITATION_PARTICIPATION_RESTRICTED",
        });
    } else if (row.accountId) throw conflict();
    if (!owner?.passwordHash && !input.password)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "INVITATION_PASSWORD_REQUIRED",
      });
    // Complete genuinely missing credentials only. Existing passwords and forced-change
    // flags are not reset by accepting participation; deliberate recovery remains separate.
    if (owner && !owner.passwordHash)
      await tx.user.update({
        where: { id: owner.id },
        data: {
          passwordHash: hashPassword(input.password!),
          mustChangePassword: false,
          ...(row.email === owner.email ? { emailVerifiedAt: new Date() } : {}),
        },
      });
    // Accepting a code delivered to the canonical primary address proves that address,
    // even when credentials already exist. A verified alias never proves the primary.
    if (row.email === owner?.email && !owner.emailVerifiedAt)
      await tx.user.update({
        where: { id: owner.id },
        data: { emailVerifiedAt: new Date() },
      });
    let academicConfirmationRequired = false;
    if (state.staff) {
      const staff = state.staff;
      const result = await completeRegistration(
        staff,
        {
          ...input,
          authenticatedUserId: owner?.id,
          completionProof: registrationCompletionProof(
            "invitation",
            staff.id,
            staff.emailCodeHash!,
            staff.emailVerifiedAt!,
          ),
        },
        tx,
      );
      if (!result.ok) throw conflict();
      academicConfirmationRequired = Boolean(
        result.academicConfirmationRequired,
      );
    } else if (state.viewer) {
      if (owner) {
        await tx.viewerSignup.update({
          where: { id: state.viewer.id },
          data: { usedAt: new Date() },
        });
      } else {
        const result = await completeViewerSignup(
          row.email,
          input.password!,
          registrationCompletionProof(
            "viewer",
            state.viewer.id,
            state.viewer.codeHash,
            state.viewer.verifiedAt!,
          ),
          tx,
        );
        if (!result.ok) throw conflict();
        await notifyAdmins(
          {
            title: "New viewer account",
            body: "A new read-only viewer registered to follow the program.",
            link: "/admin/users",
          },
          undefined,
          tx,
        );
      }
    } else if (state.survey) {
      await confirmSurvey(tx, state.survey.tokenHash, input.password, {
        tokenIsDigest: true,
        authenticatedUserId: owner?.id,
      });
    } else if (state.history) {
      const invite = state.history.invite;
      if (!owner)
        await completeHistoryAccount(tx, {
          token: invite.tokenHash,
          tokenIsDigest: true,
          email: row.email,
          password: input.password!,
          completionProof: registrationCompletionProof(
            "history",
            invite.tokenHash,
            invite.setupCodeHash!,
            invite.setupVerifiedAt!,
          ),
        });
    }
    const account = await invitationEmailOwner(tx, row.email);
    if (!account) throw conflict();
    const resultKind = owner && state.viewer ? "LOGIN" : row.kind;
    const completed = await tx.accountInvitation.update({
      where: { id: row.id },
      data: {
        completedAt: new Date(),
        completedUserId: account.id,
        accountId: account.id,
        sessionVersion: account.sessionVersion,
        receipt: {
          kind: resultKind,
          userId: account.id,
          academicConfirmationRequired,
        },
      },
    });
    await recordInvitationLifecycle(
      tx,
      completed,
      "accountInvitation.redeem",
      row,
      account.id,
    );
    return {
      ok: true,
      completed: true,
      kind: resultKind,
      academicConfirmationRequired,
    };
  });
}
