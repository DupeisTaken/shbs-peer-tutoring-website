import { TRPCError } from "@trpc/server";
import { isHistoricalTutee } from "~/lib/tutee-history";
import {
  hashCode,
  freshEmailCode,
  registrationCompletionProof,
} from "./auth/registration";
import { hashPassword } from "./auth/password";
import { lockUsernameNamespace } from "./auth/username";
import { emailSender, isEmailDeliveryAvailable } from "./email/sender";
import {
  historyTokenDigest,
  requireHistoryManager,
  historyInvitationFingerprint,
  historyInvitationReceipt,
  supersedeHistoryInvitationAttempts,
} from "./tutee-history";
import { lockAccountProfile } from "./account-profile";
import { exactSetupInvitation, bindExactHistoryRecipient } from "./exact-history-invitations";
import { initializePersonSource } from "./person-source-initialization";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

const MAX_ATTEMPTS = 6;
const invalid = () =>
  new TRPCError({ code: "NOT_FOUND", message: "HISTORY_INVITATION_INVALID" });
const taken = () =>
  new TRPCError({ code: "CONFLICT", message: "HISTORY_EMAIL_TAKEN" });

/** No public name search: the staff-reviewed token and recipient address must both match.
 * Recheck issuer, record freshness and ownership on every step, including retries. */
export async function setupInvitation(
  tx: TransactionDb,
  token: string,
  email: string,
  tokenIsDigest = false,
) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  // Additive adapter: existing Tutee rows keep their original tokens, challenges
  // and proof purpose; typed grants are found only by the same secret digest.
  const tokenHash = tokenIsDigest ? token : historyTokenDigest(token);
  const exact = await exactSetupInvitation(tx, tokenHash, email);
  if (exact) return exact;
  const invite = await tx.tuteeHistoryInvitation.findUnique({
    where: { tokenHash },
  });
  if (!invite || invite.expiresAt <= new Date()) throw invalid();
  if (email !== invite.email)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "HISTORY_EMAIL_MISMATCH",
    });
  await lockEntity(tx, `tutee:${invite.tuteeId}`);
  await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${invite.tuteeId} FOR UPDATE`;
  const [record, owner, term] = await Promise.all([
    tx.tutee.findUnique({
      where: { id: invite.tuteeId },
      include: { user: { select: { id: true } } },
    }),
    tx.studentProfileOwnership.findUnique({
      where: { tuteeId: invite.tuteeId },
    }),
    tx.term.findFirst({ where: { active: true }, select: { id: true } }),
  ]);
  if (
    !record ||
    record.user ||
    owner ||
    +record.updatedAt !== +invite.expectedUpdatedAt
  )
    throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
  if (!isHistoricalTutee(record, term?.id ?? null))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_NOT_HISTORICAL",
    });
  await requireHistoryManager(tx, invite.issuedById);
  return { invite, record, kind: "LEGACY" as const };
}

/** Shared challenge state never changes a grant's frozen source list. */
async function updateSetup(
  tx: TransactionDb,
  value: Awaited<ReturnType<typeof setupInvitation>>,
  data: {
    setupCodeHash?: string;
    setupCodeExpiresAt?: Date;
    setupAttempts?: number | { increment: number };
    setupVerifiedAt?: Date | null;
    setupUserId?: string;
  },
) {
  if (value.kind === "EXACT")
    await tx.historicalRecordInvitation.update({ where: { scopeKey: value.invite.scopeKey }, data });
  else
    await tx.tuteeHistoryInvitation.update({ where: { tuteeId: value.invite.tuteeId }, data });
}

export async function startHistoryAccount(
  db: DomainDb,
  input: { token: string; email: string },
) {
  if (!isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_EMAIL_UNAVAILABLE",
    });
  return inTransaction(db, async (tx) => {
    const value = await setupInvitation(tx, input.token, input.email);
    const { invite } = value;
    if (invite.setupUserId) throw taken();
    // A persisted cooldown limits delivery even across app instances. Failed mail rolls back,
    // preserving the previous challenge; resending deliberately invalidates its completion proof.
    if (
      invite.setupCodeExpiresAt &&
      +invite.setupCodeExpiresAt - 14 * 60000 > Date.now()
    )
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "HISTORY_RATE_LIMIT",
      });
    const code = freshEmailCode([invite.setupCodeHash]);
    await emailSender.send({
      category: "SECURITY",
      to: invite.email,
      subject: "Verify historical access / 验证历史记录访问",
      text: `Your email verification code (4 digits) / 邮箱验证码（4 位数字） is ${code}. It expires in 15 minutes. This only sets up a personal login; it does not enroll you in the program.\n\n历史记录访问验证码：${code}，15 分钟内有效。此步骤仅用于设置个人登录账号，不会加入当前项目。`,
      presentation: {
        code,
        codePurpose: "verification",
        eyebrow: "EMAIL VERIFICATION",
      },
    });
    await updateSetup(tx, value, {
        setupCodeHash: hashCode(code),
        setupCodeExpiresAt: new Date(Date.now() + 15 * 60000),
        setupAttempts: 0,
        setupVerifiedAt: null,
    });
    return { ok: true };
  });
}

export async function verifyHistoryAccount(
  db: DomainDb,
  input: { token: string; email: string; code: string },
) {
  const result = await inTransaction(db, async (tx) => {
    const value = await setupInvitation(tx, input.token, input.email);
    const { invite } = value;
    if (
      !invite.setupCodeHash ||
      !invite.setupCodeExpiresAt ||
      invite.setupCodeExpiresAt <= new Date()
    )
      return { error: "HISTORY_CODE_EXPIRED" } as const;
    if (invite.setupAttempts >= MAX_ATTEMPTS)
      return { error: "HISTORY_CODE_ATTEMPTS" } as const;
    if (invite.setupCodeHash !== hashCode(input.code)) {
      await updateSetup(tx, value, { setupAttempts: { increment: 1 } });
      return { error: "HISTORY_CODE_MISMATCH" } as const;
    }
    // Repeated successful verification returns the same proof, including after a lost response.
    const verifiedAt = invite.setupVerifiedAt ?? new Date();
    await updateSetup(tx, value, {
        setupVerifiedAt: verifiedAt,
        ...(!invite.setupVerifiedAt
          ? { setupCodeExpiresAt: new Date(+verifiedAt + 15 * 60_000) }
          : {}),
    });
    return {
      completionProof: registrationCompletionProof(
        "history",
        invite.tokenHash,
        invite.setupCodeHash,
        verifiedAt,
      ),
    };
  });
  // Wrong-code attempts must commit before returning an error; throwing inside would undo them.
  if ("error" in result)
    throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
  return result;
}

export async function completeHistoryAccount(
  db: DomainDb,
  input: {
    token: string;
    email: string;
    completionProof: string;
    password: string;
    tokenIsDigest?: true;
  },
) {
  return inTransaction(db, async (tx) => {
    const value = await setupInvitation(
      tx,
      input.token,
      input.email,
      input.tokenIsDigest,
    );
    const { invite, record } = value;
    if (
      !invite.setupVerifiedAt ||
      !invite.setupCodeHash ||
      !invite.setupCodeExpiresAt ||
      invite.setupCodeExpiresAt <= new Date() ||
      invite.setupAttempts >= MAX_ATTEMPTS ||
      registrationCompletionProof(
        "history",
        invite.tokenHash,
        invite.setupCodeHash,
        invite.setupVerifiedAt,
      ) !== input.completionProof
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "HISTORY_CODE_EXPIRED",
      });
    if (invite.setupUserId) {
      const existing = await tx.user.findUnique({
        where: { id: invite.setupUserId },
      });
      if (!existing || existing.mergedIntoId || existing.email !== invite.email)
        throw taken();
      return { ok: true }; // Receipt retry never overwrites credentials or capabilities.
    }
    if (await tx.accountEmail.findUnique({ where: { email: invite.email } }))
      throw taken();
    // STUDENT is the neutral non-management rank; tuteeMember and studentId grant participation.
    // Use the exact reviewed archive label, preserving legacy names without inventing name parts
    // or current academics/consent. The database's shared email claim trigger arbitrates races.
    const user = await tx.user.create({
      data: {
        email: invite.email,
        name: record.englishName,
        legacyName: record.englishName,
        passwordHash: hashPassword(input.password),
        emailVerifiedAt: new Date(),
        role: "STUDENT",
        tuteeMember: false,
        tutorAccessRevoked: true,
      },
    });
    await initializePersonSource(tx, { kind: "USER", id: user.id });
    if (!user.name?.trim()) {
      const { ensureUserUsername } = await import("./auth/username");
      await ensureUserUsername(user.id, tx, { namelessIdentity: true });
    }
    await updateSetup(tx, value, { setupUserId: user.id });
    if (value.kind === "EXACT")
      await bindExactHistoryRecipient(tx, value.invite.scopeKey, user.id);
    await tx.auditLog.create({
      data: {
        userId: user.id,
        entity: "User",
        entityId: user.id,
        kind: "ACTION",
        operation: "tuteeHistory.completeAccount",
        action: "Created verified history-only login",
        details: {
          ...(value.kind === "LEGACY" ? { tuteeId: value.invite.tuteeId } : { sources: value.sources }),
          issuedById: invite.issuedById,
          reason: invite.reason,
        },
      },
    });
    return { ok: true };
  }).catch((error: unknown) => {
    // Other signup/alias writers may race outside this invitation's namespace lock.
    // The database registry remains authoritative; report the same recoverable conflict.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      throw taken();
    throw error;
  });
}

/** Staff may see delivery metadata, never a token, OTP or password. Cancellation removes only
 * the outstanding grant, preserving accounts and ownership already explicitly established. */
export async function historyInvitationStatus(db: DomainDb, tuteeId: string) {
  return inTransaction(db, async (tx) => {
    // Reconciliation must not combine a predecessor from before publication with
    // a terminal receipt from afterward. These read locks compose with cancellation.
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `tutee:${tuteeId}`);
    const [invitation, attempt] = await Promise.all([
      tx.tuteeHistoryInvitation.findUnique({ where: { tuteeId } }),
      tx.tuteeHistoryInvitationAttempt.findFirst({
        where: { tuteeId },
        orderBy: { sequence: "desc" },
      }),
    ]);
    if (!invitation && !attempt) return null;
    return {
      invitation: invitation
        ? { email: invitation.email, expiresAt: invitation.expiresAt }
        : null,
      attempt: attempt
        ? { ...historyInvitationReceipt(attempt), email: attempt.email }
        : null,
      // Cancellation approves the displayed live grant AND latest delivery intent.
      // Publication or a later admission invalidates a stale editor's cancellation.
      revision: historyTokenDigest(
        JSON.stringify([
          await historyInvitationFingerprint(tx, invitation),
          attempt && [attempt.id, attempt.sequence, attempt.status],
        ]),
      ),
    };
  });
}
export async function cancelHistoryInvitation(
  db: DomainDb,
  actorId: string,
  input: { tuteeId: string; revision: string },
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockAccountProfile(tx, actorId);
    await lockEntity(tx, `tutee:${input.tuteeId}`);
    await requireHistoryManager(tx, actorId);
    const current = await historyInvitationStatus(tx, input.tuteeId);
    if (!current?.invitation && current?.attempt?.status !== "UNCERTAIN")
      return { cancelled: false };
    if (current && current.revision !== input.revision)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
    const superseded = await supersedeHistoryInvitationAttempts(
      tx,
      input.tuteeId,
    );
    const removed = await tx.tuteeHistoryInvitation.deleteMany({
      where: { tuteeId: input.tuteeId },
    });
    if (removed.count || superseded.count)
      await tx.auditLog.create({
        data: {
          userId: actorId,
          entity: "Tutee",
          entityId: input.tuteeId,
          kind: "ACTION",
          operation: "tuteeHistory.cancelInvitation",
          action: "Cancelled historical record invitation",
        },
      });
    return { cancelled: removed.count === 1 || superseded.count > 0 };
  });
}
