import { TRPCError } from "@trpc/server";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { generateRegistrationCode } from "./auth/code";
import { hashCode, registrationCompletionProof } from "./auth/registration";
import { hashPassword } from "./auth/password";
import { lockUsernameNamespace } from "./auth/username";
import { emailSender, isEmailDeliveryAvailable } from "./email/sender";
import { historyTokenDigest, requireHistoryManager } from "./tutee-history";
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
async function setupInvitation(
  tx: TransactionDb,
  token: string,
  email: string,
) {
  await lockUsernameNamespace(tx);
  const invite = await tx.tuteeHistoryInvitation.findUnique({
    where: { tokenHash: historyTokenDigest(token) },
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
  return { invite, record };
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
    const { invite } = await setupInvitation(tx, input.token, input.email);
    if (
      invite.setupUserId ||
      (await tx.accountEmail.findUnique({ where: { email: invite.email } }))
    )
      throw taken();
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
    const code = generateRegistrationCode();
    await emailSender.send({
      category: "SECURITY",
      to: invite.email,
      subject: "Verify historical access / 验证历史记录访问",
      text: `Your historical-access verification code is ${code}. It expires in 15 minutes. This only sets up a personal login; it does not enroll you in the program.\n\n历史记录访问验证码：${code}，15 分钟内有效。此步骤仅用于设置个人登录账号，不会加入当前项目。`,
      presentation: { code, eyebrow: "EMAIL VERIFICATION" },
    });
    await tx.tuteeHistoryInvitation.update({
      where: { tuteeId: invite.tuteeId },
      data: {
        setupCodeHash: hashCode(code),
        setupCodeExpiresAt: new Date(Date.now() + 15 * 60000),
        setupAttempts: 0,
        setupVerifiedAt: null,
      },
    });
    return { ok: true };
  });
}

export async function verifyHistoryAccount(
  db: DomainDb,
  input: { token: string; email: string; code: string },
) {
  const result = await inTransaction(db, async (tx) => {
    const { invite } = await setupInvitation(tx, input.token, input.email);
    if (
      !invite.setupCodeHash ||
      !invite.setupCodeExpiresAt ||
      invite.setupCodeExpiresAt <= new Date()
    )
      return { error: "HISTORY_CODE_EXPIRED" } as const;
    if (invite.setupAttempts >= MAX_ATTEMPTS)
      return { error: "HISTORY_CODE_ATTEMPTS" } as const;
    if (invite.setupCodeHash !== hashCode(input.code)) {
      await tx.tuteeHistoryInvitation.update({
        where: { tuteeId: invite.tuteeId },
        data: { setupAttempts: { increment: 1 } },
      });
      return { error: "HISTORY_CODE_MISMATCH" } as const;
    }
    // Repeated successful verification returns the same proof, including after a lost response.
    const verifiedAt = invite.setupVerifiedAt ?? new Date();
    await tx.tuteeHistoryInvitation.update({
      where: { tuteeId: invite.tuteeId },
      data: { setupVerifiedAt: verifiedAt },
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
  },
) {
  return inTransaction(db, async (tx) => {
    const { invite, record } = await setupInvitation(
      tx,
      input.token,
      input.email,
    );
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
    await tx.tuteeHistoryInvitation.update({
      where: { tuteeId: invite.tuteeId },
      data: { setupUserId: user.id },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        entity: "User",
        entityId: user.id,
        kind: "ACTION",
        operation: "tuteeHistory.completeAccount",
        action: "Created verified history-only login",
        details: {
          tuteeId: invite.tuteeId,
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
  return db.tuteeHistoryInvitation
    .findUnique({
      where: { tuteeId },
      select: { email: true, expiresAt: true, tokenHash: true },
    })
    .then((row) =>
      row
        ? {
            email: row.email,
            expiresAt: row.expiresAt,
            revision: historyTokenDigest(`revision:${row.tokenHash}`),
          }
        : null,
    );
}
export async function cancelHistoryInvitation(
  db: DomainDb,
  actorId: string,
  input: { tuteeId: string; revision: string },
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `tutee:${input.tuteeId}`);
    await requireHistoryManager(tx, actorId);
    const current = await historyInvitationStatus(tx, input.tuteeId);
    if (current && current.revision !== input.revision)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
    const removed = await tx.tuteeHistoryInvitation.deleteMany({
      where: { tuteeId: input.tuteeId },
    });
    if (removed.count)
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
    return { cancelled: removed.count === 1 };
  });
}
