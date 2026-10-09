import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { academicSummary } from "~/lib/academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { legacyAcademicRecordId } from "~/lib/historical-academics";
import { historicalAcademicSnapshot } from "./historical-academics";
import { lockAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import { authenticateEmailAction } from "./auth/account-emails";
import { emailSender, isEmailDeliveryAvailable } from "./email/sender";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

const id = z.string().min(1).max(128);
export const historyPairInput = z.object({ tuteeId: id, userId: id });
export const historyLinkInput = historyPairInput.extend({
  fingerprint: z.string().length(64),
  reason: z.string().trim().min(10).max(1000),
  confirmPassword: z.string().max(1024).optional(),
});
export const historyInviteInput = z.object({
  tuteeId: id,
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  expectedUpdatedAt: z.date(),
  reason: z.string().trim().min(10).max(1000),
});
export const historyTokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const digest = historyTokenDigest;
export const historyAccountSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  emailVerifiedAt: true,
  academicProfile: true,
  profileVersion: true,
  mergedIntoId: true,
} as const;

/** Explicit retained ownership is separate from User.studentId (the current enrollment).
 * Do not fill the roster's current `user` relation: that would redirect profile writes. */
export async function historicalOwners(db: DomainDb, tuteeIds: string[]) {
  if (!tuteeIds.length)
    return new Map<string, Awaited<ReturnType<typeof ownerAccount>>>();
  const ownerships = await db.studentProfileOwnership.findMany({
    where: { tuteeId: { in: tuteeIds } },
  });
  const accounts = await db.user.findMany({
    where: { id: { in: ownerships.map((r) => r.userId) }, mergedIntoId: null },
    select: historyAccountSelect,
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return new Map(
    ownerships.map((row) => [row.tuteeId, byId.get(row.userId) ?? null]),
  );
}
const ownerAccount = (db: DomainDb, userId: string) =>
  db.user.findUnique({ where: { id: userId }, select: historyAccountSelect });

async function snapshot(db: DomainDb, input: z.infer<typeof historyPairInput>) {
  const [record, user, ownership, term] = await Promise.all([
    db.tutee.findUniqueOrThrow({
      where: { id: input.tuteeId },
      include: {
        user: { select: { id: true } },
        _count: { select: { sessions: true } },
      },
    }),
    db.user.findUniqueOrThrow({ where: { id: input.userId } }),
    db.studentProfileOwnership.findUnique({
      where: { tuteeId: input.tuteeId },
    }),
    db.term.findFirst({ where: { active: true }, select: { id: true } }),
  ]);
  if (
    user.mergedIntoId ||
    user.suspendedAt ||
    !user.emailVerifiedAt ||
    !user.passwordHash ||
    user.mustChangePassword
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_ACCOUNT_NOT_READY",
    });
  if (!isHistoricalTutee(record, term?.id ?? null))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_NOT_HISTORICAL",
    });
  const ownerIds = [
    ...new Set(
      [record.user?.id, ownership?.userId].filter((v): v is string => !!v),
    ),
  ];
  const conflict = ownerIds.some((ownerId) => ownerId !== user.id);
  // Current enrollment is managed by signup/merging, never moved by history correction.
  const currentConflict = !!record.user && record.user.id !== user.id;
  const fingerprint = digest(
    JSON.stringify([
      record.id,
      record.updatedAt,
      record._count.sessions,
      ownership?.userId,
      record.user?.id,
      user.id,
      user.profileVersion,
      user.studentId,
      term?.id,
    ]),
  );
  return { record, user, fingerprint, conflict, currentConflict, ownerIds };
}

export async function previewHistoryLink(
  db: DomainDb,
  input: z.infer<typeof historyPairInput>,
) {
  const value = await snapshot(db, input);
  return {
    fingerprint: value.fingerprint,
    conflict: value.conflict,
    currentConflict: value.currentConflict,
    alreadyLinked: value.ownerIds.length > 0 && !value.conflict,
    record: {
      id: value.record.id,
      name: value.record.englishName,
      sessions: value.record._count.sessions,
    },
    account: {
      id: value.user.id,
      name: value.user.name,
      email: value.user.email,
    },
  };
}

export async function requireHistoryManager(tx: DomainDb, actorId: string) {
  const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
  if (
    actor.mergedIntoId ||
    actor.suspendedAt ||
    !["HEAD", "ADMIN"].includes(actor.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "HISTORY_MANAGER_REQUIRED",
    });
  return actor;
}
const requireManager = requireHistoryManager;

/** Namespace → account → tutee locks match signup/merge ordering. The transaction only
 * changes ownership; current enrollment, academics, roles and every event row stay intact. */
export async function linkTuteeHistory(
  db: DomainDb,
  actorId: string,
  input: z.infer<typeof historyLinkInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    // Stable ordering also covers Head reauthentication during an ownership correction.
    for (const accountId of [...new Set([actorId, input.userId])].sort())
      await lockAccountProfile(tx, accountId);
    await lockEntity(tx, `tutee:${input.tuteeId}`);
    await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${input.tuteeId} FOR UPDATE`;
    const actor = await requireManager(tx, actorId);
    const value = await snapshot(tx, input);
    if (value.fingerprint !== input.fingerprint)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
    if (value.currentConflict)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_USE_MERGE" });
    if (value.conflict) {
      if (actor.role !== "HEAD")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "HISTORY_HEAD_REQUIRED",
        });
      await authenticateEmailAction(tx, actorId, input.confirmPassword ?? "");
    }
    await writeOwnership(
      tx,
      input.tuteeId,
      input.userId,
      actorId,
      input.reason,
      value.ownerIds,
      "STAFF",
    );
    return { ok: true };
  });
}

async function writeOwnership(
  tx: TransactionDb,
  tuteeId: string,
  userId: string,
  actorId: string,
  reason: string,
  previousOwners: string[],
  source: string,
) {
  await tx.studentProfileOwnership.upsert({
    where: { tuteeId },
    create: { tuteeId, userId },
    update: { userId },
  });
  // Any completed staff link/correction invalidates outstanding claim links.
  await tx.tuteeHistoryInvitation.deleteMany({ where: { tuteeId } });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      entity: "Tutee",
      entityId: tuteeId,
      operation: "tuteeHistory.link",
      kind: "ACTION",
      action: "Linked historical tutee records",
      details: { targetUserId: userId, previousOwners, reason, source },
    },
  });
}

/** A staff-reviewed, exact-record invitation is delivered before replacing its predecessor.
 * Account setup requires a separate email challenge. GET/scanner visits never claim records. */
export async function inviteTuteeHistory(
  db: DomainDb,
  actorId: string,
  input: z.infer<typeof historyInviteInput>,
) {
  const origin = process.env.AUTH_URL;
  if (!origin || !isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_EMAIL_UNAVAILABLE",
    });
  const url = new URL("/history/claim", origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "HISTORY_EMAIL_UNAVAILABLE",
    });
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockEntity(tx, `tutee:${input.tuteeId}`);
    await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${input.tuteeId} FOR UPDATE`;
    await requireManager(tx, actorId);
    const [record, ownership, term] = await Promise.all([
      tx.tutee.findUniqueOrThrow({
        where: { id: input.tuteeId },
        include: { user: { select: { id: true } } },
      }),
      tx.studentProfileOwnership.findUnique({
        where: { tuteeId: input.tuteeId },
      }),
      tx.term.findFirst({ where: { active: true }, select: { id: true } }),
    ]);
    if (record.user || ownership)
      throw new TRPCError({
        code: "CONFLICT",
        message: "HISTORY_ALREADY_OWNED",
      });
    if (!isHistoricalTutee(record, term?.id ?? null))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "HISTORY_NOT_HISTORICAL",
      });
    if (+record.updatedAt !== +input.expectedUpdatedAt)
      throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
    const token = randomBytes(32).toString("hex");
    url.searchParams.set("token", token);
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await emailSender.send({
      category: "SECURITY",
      to: input.email,
      subject: "Link your historical tutoring records / 关联历史学习记录",
      text: `The program team has reviewed your identity and invited you to link your past tutoring records:\n${url.href}\n\nSign in with your existing verified account, or use Create history-only account on this page and verify the separate email code. Then review and claim your records. The invitation expires in seven days and can be cancelled by staff. Account creation and claiming history do not enroll you or grant observer access. If your old email is unavailable, contact the program team for a reviewed replacement invitation.\n\n项目团队已核实你的身份并邀请你关联历史记录。请使用已有的已验证账号登录，或在页面选择创建仅供历史记录访问的账号并验证单独发送的邮箱验证码，然后确认关联。邀请七天内有效，管理人员可取消。创建账号和关联历史记录不会加入当前项目或授予观察员权限。如旧邮箱已无法使用，请联系项目团队核实后重新邀请。`,
    });
    const data = {
      email: input.email,
      tokenHash: digest(token),
      expectedUpdatedAt: record.updatedAt,
      expiresAt,
      issuedById: actorId,
      reason: input.reason,
      setupCodeHash: null,
      setupCodeExpiresAt: null,
      setupAttempts: 0,
      setupVerifiedAt: null,
      setupUserId: null,
    };
    await tx.tuteeHistoryInvitation.upsert({
      where: { tuteeId: input.tuteeId },
      create: { tuteeId: input.tuteeId, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        entity: "Tutee",
        entityId: input.tuteeId,
        kind: "ACTION",
        operation: "tuteeHistory.invite",
        action: "Invited a participant to link historical records",
      },
    });
    return { expiresAt };
  });
}

async function claimSnapshot(
  db: DomainDb,
  userId: string,
  token: string,
  tokenIsDigest = false,
) {
  const invite = await db.tuteeHistoryInvitation.findUnique({
    where: { tokenHash: tokenIsDigest ? token : digest(token) },
  });
  if (!invite || invite.expiresAt <= new Date())
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "HISTORY_INVITATION_INVALID",
    });
  const value = await snapshot(db, { tuteeId: invite.tuteeId, userId });
  const secondary = await db.accountEmail.findFirst({
    where: { userId, email: invite.email, verifiedAt: { not: null } },
  });
  if (value.user.email.toLowerCase() !== invite.email && !secondary)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "HISTORY_EMAIL_MISMATCH",
    });
  if (
    value.ownerIds.length ||
    +value.record.updatedAt !== +invite.expectedUpdatedAt
  )
    throw new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
  // Staff suspension/demotion after sending a link revokes its ability to grant ownership.
  await requireManager(db, invite.issuedById);
  return { invite, value };
}
export async function inspectHistoryClaim(
  db: DomainDb,
  userId: string,
  token: string,
  tokenIsDigest = false,
) {
  const { invite, value } = await claimSnapshot(
    db,
    userId,
    token,
    tokenIsDigest,
  );
  return {
    name: value.record.englishName,
    sessions: value.record._count.sessions,
    expiresAt: invite.expiresAt,
  };
}
export async function claimTuteeHistory(
  db: DomainDb,
  userId: string,
  token: string,
  tokenIsDigest = false,
) {
  return inTransaction(db, async (tx) => {
    await lockUsernameNamespace(tx);
    await lockAccountProfile(tx, userId);
    const { invite } = await claimSnapshot(tx, userId, token, tokenIsDigest);
    await lockEntity(tx, `tutee:${invite.tuteeId}`);
    await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${invite.tuteeId} FOR UPDATE`;
    const current = await claimSnapshot(tx, userId, token, tokenIsDigest);
    await writeOwnership(
      tx,
      invite.tuteeId,
      userId,
      userId,
      current.invite.reason,
      [],
      "INVITATION",
    );
    return { ok: true };
  });
}

/** Explicit pagination exposes all history without loading an entire multi-year archive. */
export async function tuteeHistoryDetails(
  db: DomainDb,
  tuteeId: string,
  page: number,
) {
  const [record, ownership, active, count, sessions] = await Promise.all([
    db.tutee.findUniqueOrThrow({
      where: { id: tuteeId },
      include: { user: { select: historyAccountSelect } },
    }),
    db.studentProfileOwnership.findUnique({ where: { tuteeId } }),
    db.term.findFirst({
      where: { active: true },
      select: { schoolYear: true },
    }),
    db.sessionTutee.count({ where: { tuteeId } }),
    db.sessionTutee.findMany({
      where: { tuteeId },
      orderBy: [{ session: { date: "desc" } }, { sessionId: "asc" }],
      skip: page * 50,
      take: 50,
      select: {
        status: true,
        session: {
          select: {
            id: true,
            date: true,
            schoolYear: true,
            quarter: true,
            startMin: true,
            endMin: true,
            pairing: { select: { subject: true } },
            tutor: { select: { englishName: true } },
          },
        },
      },
    }),
  ]);
  const owner =
    record.user ??
    (ownership ? await ownerAccount(db, ownership.userId) : null);
  const term = record.intakeTermId
    ? await db.term.findUnique({
        where: { id: record.intakeTermId },
        select: { name: true, schoolYear: true },
      })
    : null;
  const academicRecords = await db.historicalAcademicRecord.findMany({
    where: { tuteeId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const historicalAcademics = [];
  for (const id of new Set([
    legacyAcademicRecordId("TUTEE", tuteeId),
    ...academicRecords.map((row) => row.id),
  ])) {
    const evidence = await historicalAcademicSnapshot(db, id);
    historicalAcademics.push({
      recordId: evidence.recordId,
      original: evidence.original,
      current: evidence.current,
      revision: evidence.revision,
      correction: evidence.correction,
    });
  }
  // The deterministic enrollment record is first. Its original remains authoritative
  // after current-account mirrors advance; corrections are shown separately below it.
  const originalEnrollment = historicalAcademics[0]!.original;
  return {
    historicalAcademics,
    record: {
      id: record.id,
      name: record.englishName,
      alternativeNames: record.alternativeNames,
      gradeLevel: originalEnrollment.rawGrade,
      academicallyGraduated: originalEnrollment.academicallyGraduated,
      updatedAt: record.updatedAt,
    },
    owner:
      owner && !owner.mergedIntoId
        ? {
            id: owner.id,
            name: owner.name,
            username: owner.username,
            emailVerified: !!owner.emailVerifiedAt,
            academic: academicSummary(
              owner.academicProfile,
              active?.schoolYear,
            ),
          }
        : null,
    term,
    count,
    sessions,
    page,
  };
}
