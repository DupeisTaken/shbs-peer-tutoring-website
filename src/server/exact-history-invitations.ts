import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HistoricalRecordInvitation } from "../../generated/prisma";
import { isHistoricalTutor } from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { lockAccountProfile } from "./account-profile";
import { lockUsernameNamespace } from "./auth/username";
import { afterCommitDatabase, afterCommitScope, databaseScope, deferUntilCommit } from "./db-scope";
import { emailSender, isEmailDeliveryAvailable } from "./email/sender";
import { historyInvitationScope } from "./email/required-notice-details";
import { personGraph, syncParticipantPerson } from "./person-identity";
import { historyInvitationReceipt, historyTokenDigest as digest, requireHistoryManager, supersedeHistoryInvitationAttempts, type HistoryInvitationReceipt } from "./tutee-history";
import { inTransaction, lockEntity, type DomainDb, type TransactionDb } from "./transactions";

const exactSource = z.object({ kind: z.enum(["TUTOR", "TUTEE"]), id: z.string().min(1).max(128) }).strict();
export const exactHistorySources = z.array(exactSource).min(1).max(50).refine(
  (rows) => new Set(rows.map((row) => `${row.kind}:${row.id}`)).size === rows.length,
  "HISTORY_DUPLICATE_SOURCE",
).transform((rows) => rows.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)));
export type ExactHistorySource = z.infer<typeof exactSource>;
export const exactHistoryPreviewInput = z.object({
  sources: exactHistorySources,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});
export const exactHistoryInviteInput = exactHistoryPreviewInput.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000),
  operationId: z.string().uuid(),
});
type PreviewInput = z.infer<typeof exactHistoryPreviewInput>;
type InviteInput = z.infer<typeof exactHistoryInviteInput>;
type Block = "GROUP_REVIEW_REQUIRED" | "NOT_HISTORICAL" | "CURRENT_WORK" | "ACCOUNT_CONFLICT" | "ACCOUNT_NOT_READY";
const stale = () => new TRPCError({ code: "CONFLICT", message: "HISTORY_STALE" });
const invalid = () => new TRPCError({ code: "NOT_FOUND", message: "HISTORY_INVITATION_INVALID" });
const scopeKey = (sources: ExactHistorySource[]) => digest(JSON.stringify(exactHistorySources.parse(sources)));

/** Freeze exact source IDs and their ownership/group generations. Directory expansion
 * is evidence for conflict detection only; it never expands the invitation's grants. */
async function sourceSnapshot(db: DomainDb, sources: ExactHistorySource[]) {
  const graph = await personGraph(db, sources);
  const term = await db.term.findFirst({ where: { active: true }, select: { id: true } });
  const tutors = sources.filter((r) => r.kind === "TUTOR").map((r) => r.id);
  const tutees = sources.filter((r) => r.kind === "TUTEE").map((r) => r.id);
  const [assignments, tutorRequests, tuteeRequests, interviews, registrations, studentRequests, qualificationRequests, intakes] = await Promise.all([
    term ? db.pairing.findMany({ where: { termId: term.id, OR: [{ tutorId: { in: tutors } }, { tutees: { some: { tuteeId: { in: tutees } } } }] }, select: { id: true }, orderBy: { id: "asc" } }) : [],
    db.tutorStatusRequest.findMany({ where: { tutorId: { in: tutors }, state: "PENDING" }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tuteeRemovalRequest.findMany({ where: { tuteeId: { in: tutees }, state: "PENDING" }, select: { id: true }, orderBy: { id: "asc" } }),
    db.interviewAssignment.findMany({ where: { tutorId: { in: tutors }, application: { status: { in: ["PENDING", "INTERVIEW"] } } }, select: { tutorId: true, applicationId: true }, orderBy: [{ tutorId: "asc" }, { applicationId: "asc" }] }),
    db.registrationCode.findMany({ where: { tutorId: { in: tutors }, usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true }, orderBy: { id: "asc" } }),
    db.studentRequestReview.findMany({ where: { legacyTuteeId: { in: tutees }, state: "PENDING" }, select: { id: true }, orderBy: { id: "asc" } }),
    db.tutorApplication.findMany({ where: { requestedTutorId: { in: tutors }, status: { in: ["PENDING", "INTERVIEW"] } }, select: { id: true }, orderBy: { id: "asc" } }),
    db.studentSurvey.findMany({ where: { tuteeId: { in: tutees }, state: "OPEN", confirmedAt: null }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  const blocked = new Set<Block>();
  const records = sources.map((source) => {
    const record = source.kind === "TUTOR" ? graph.tutors.find((r) => r.id === source.id)! : graph.tutees.find((r) => r.id === source.id)!;
    if (!(source.kind === "TUTOR" ? isHistoricalTutor(record) : isHistoricalTutee(record, term?.id ?? null))) blocked.add("NOT_HISTORICAL");
    return { ...source, name: record.englishName, personId: record.personId };
  });
  // Multiple sources require one already-reviewed directory group. Selecting rows
  // is not itself authority to group previously unrelated people.
  if (graph.persons.some((r) => r.resolutionState !== "GROUPED" || r.mergedIntoId) ||
      (sources.length > 1 && (!records[0]?.personId || records.some((r) => r.personId !== records[0]!.personId)))) blocked.add("GROUP_REVIEW_REQUIRED");
  const live = graph.users.filter((r) => !r.mergedIntoId);
  if (live.length > 1) blocked.add("ACCOUNT_CONFLICT");
  if ([assignments, tutorRequests, tuteeRequests, interviews, registrations, studentRequests, qualificationRequests, intakes].some((rows) => rows.length)) blocked.add("CURRENT_WORK");
  // Include every graph member and monotonic person/source/ownership generation.
  // Add-remove and owner A→B→A cannot revive an old token, even if labels match.
  const fingerprint = digest(JSON.stringify({
    sources, term: term?.id,
    persons: graph.persons.map((r) => [r.id, r.revision, r.resolutionState, r.mergedIntoId, r.primaryUserId]),
    users: graph.users.map((r) => [r.id, r.personId, r.mergedIntoId, r.tutorId, r.studentId]),
    tutors: graph.tutors.map((r) => [r.id, r.personId, r.historyIdentityRevision, r.updatedAt, r.status, r.user?.id, r.retainedOwner]),
    tutees: graph.tutees.map((r) => [r.id, r.personId, r.historyIdentityRevision, r.updatedAt, r.status, r.intakeTermId, r.user?.id]),
    ownership: graph.ownership, assignments, tutorRequests, tuteeRequests, interviews, registrations, studentRequests, qualificationRequests, intakes,
  }));
  return { sources: records.map(({ kind, id, name }) => ({ kind, id, name })), fingerprint, blocked, live };
}

async function recipientSnapshot(db: DomainDb, email: string) {
  const address = await db.accountEmail.findUnique({ where: { email }, include: { user: { include: { person: { include: { users: { where: { mergedIntoId: null }, select: { id: true }, orderBy: { id: "asc" } } } } } } } });
  const user = address?.user ?? null;
  const ready = !user || (!!address?.verifiedAt && !!user.emailVerifiedAt && !!user.passwordHash && !user.mustChangePassword && !user.suspendedAt && !user.mergedIntoId);
  const conflict = (user?.person?.users.length ?? 0) > 1;
  return { user, ready, conflict, evidence: address && [address.email, address.createdAt, address.verifiedAt, user?.id, user?.sessionVersion, user?.email, user?.emailVerifiedAt, user?.suspendedAt, user?.mustChangePassword, user?.mergedIntoId, user?.person?.id, user?.person?.revision, user?.person?.resolutionState, user?.person?.mergedIntoId, user?.person?.users] };
}

async function invitationPreview(db: DomainDb, actorId: string, input: PreviewInput) {
  const actor = await requireHistoryManager(db, actorId);
  const source = await sourceSnapshot(db, input.sources);
  const recipient = await recipientSnapshot(db, input.email);
  if (!recipient.ready) source.blocked.add("ACCOUNT_NOT_READY");
  if (source.live.some((r) => r.id !== recipient.user?.id)) source.blocked.add("ACCOUNT_CONFLICT");
  if (recipient.conflict) source.blocked.add("ACCOUNT_CONFLICT");
  if (recipient.user?.person?.resolutionState === "REVIEW_REQUIRED" || recipient.user?.person?.mergedIntoId) source.blocked.add("GROUP_REVIEW_REQUIRED");
  return { source, recipient, actor, fingerprint: digest(JSON.stringify([source.fingerprint, input.email, recipient.evidence, actor.id, actor.role, actor.sessionVersion])) };
}

export async function previewExactHistoryInvitation(db: DomainDb, actorId: string, input: PreviewInput) {
  const value = await invitationPreview(db, actorId, input);
  return { fingerprint: value.fingerprint, sources: value.source.sources, blocked: [...value.source.blocked], canInvite: value.source.blocked.size === 0 };
}

/** Period → namespace → leadership → sorted accounts → sorted sources matches combine/claim.
 * All invitation source mutations use the namespace; row locks also fence roster edits. */
async function lockScope(tx: TransactionDb, sources: ExactHistorySource[], accountIds: string[], email?: string) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockEntity(tx, "program:leadership");
  if (email) {
    const recipient = await tx.accountEmail.findUnique({ where: { email }, select: { userId: true } });
    if (recipient) accountIds = [...accountIds, recipient.userId];
  }
  for (const id of [...new Set(accountIds)].sort()) await lockAccountProfile(tx, id);
  for (const source of exactHistorySources.parse(sources)) {
    await lockEntity(tx, `${source.kind.toLowerCase()}:${source.id}`);
    if (source.kind === "TUTOR") await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${source.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${source.id} FOR UPDATE`;
  }
}

async function predecessorFingerprint(db: DomainDb, invite: HistoricalRecordInvitation | null) {
  const envelopes = invite ? await db.accountInvitation.findMany({ where: { kind: "HISTORY", source: { path: ["tokenHash"], equals: invite.tokenHash } }, orderBy: { id: "asc" } }) : [];
  return digest(JSON.stringify([invite, envelopes]));
}

/** Operation receipts are actor-bound and survive replacements. An unknown response
 * is recovered by this read, never by another delivery or a mutable latest-only row. */
export async function exactHistoryInvitationReceipt(db: DomainDb, actorId: string, operationId: string) {
  await requireHistoryManager(db, actorId);
  const attempt = await db.historicalRecordInvitationAttempt.findUnique({ where: { id: operationId } });
  if (attempt?.issuedById !== actorId) return null;
  const live = attempt.status === "PUBLISHED" ? await db.historicalRecordInvitation.findUnique({ where: { scopeKey: attempt.scopeKey } }) : null;
  const receipt = historyInvitationReceipt(attempt);
  if (attempt.status === "PUBLISHED" && (live?.tokenHash !== attempt.tokenHash || live?.claimedAt)) Object.assign(receipt, { status: "SUPERSEDED", expiresAt: null });
  return { ...receipt, email: attempt.email };
}

export async function exactHistoryInvitationStatus(db: DomainDb, actorId: string, sources: ExactHistorySource[]) {
  return inTransaction(db, async (tx) => {
    await lockScope(tx, sources, [actorId]);
    await requireHistoryManager(tx, actorId);
    const key = scopeKey(sources);
    const [invitation, attempt] = await Promise.all([
      tx.historicalRecordInvitation.findUnique({ where: { scopeKey: key } }),
      tx.historicalRecordInvitationAttempt.findFirst({ where: { scopeKey: key }, orderBy: { sequence: "desc" } }),
    ]);
    if (!invitation && !attempt) return null;
    return {
      revision: digest(JSON.stringify([await predecessorFingerprint(tx, invitation), attempt && [attempt.id, attempt.sequence, attempt.status]])),
      invitation: invitation && !invitation.claimedAt ? { email: invitation.email, expiresAt: invitation.expiresAt } : null,
      attempt: attempt ? { ...historyInvitationReceipt(attempt), email: attempt.email } : null,
    };
  });
}

export async function cancelExactHistoryInvitation(db: DomainDb, actorId: string, input: { sources: ExactHistorySource[]; revision: string }) {
  return inTransaction(db, async (tx) => {
    await lockScope(tx, input.sources, [actorId]);
    const current = await exactHistoryInvitationStatus(tx, actorId, input.sources);
    if (!current) return { cancelled: false };
    if (!current?.invitation && current?.attempt?.status !== "UNCERTAIN") return { cancelled: false };
    if (current.revision !== input.revision) throw stale();
    const key = scopeKey(input.sources);
    await tx.historicalRecordInvitationAttempt.updateMany({ where: { scopeKey: key, status: "ADMITTED" }, data: { status: "SUPERSEDED", settledAt: new Date() } });
    await tx.historicalRecordInvitation.deleteMany({ where: { scopeKey: key } });
    await tx.auditLog.create({ data: { userId: actorId, entity: "HistoricalRecordInvitation", entityId: key, operation: "tuteeHistory.cancelExactInvitation", kind: "ACTION", action: "Cancelled exact historical invitation", details: { sources: input.sources } } });
    return { cancelled: true };
  });
}

export async function inviteExactHistory(db: DomainDb, actorId: string, input: InviteInput): Promise<HistoryInvitationReceipt> {
  const owner = afterCommitScope.getStore();
  if (((!("$connect" in db) || typeof db.$connect !== "function") || databaseScope.getStore()) && (!owner?.database || owner.committed)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "HISTORY_DELIVERY_COMMIT_REQUIRED" });
  const inputHash = digest(JSON.stringify({ ...input, sources: exactHistorySources.parse(input.sources) }));
  // Even an explicit duplicate mutation is read-only after its first admission.
  const previous = await db.historicalRecordInvitationAttempt.findUnique({ where: { id: input.operationId } });
  if (previous) {
    if (previous.issuedById !== actorId || previous.inputHash !== inputHash) throw stale();
    return (await exactHistoryInvitationReceipt(db, actorId, input.operationId))!;
  }
  const origin = process.env.AUTH_URL;
  if (!origin || !isEmailDeliveryAvailable("SECURITY")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "HISTORY_EMAIL_UNAVAILABLE" });
  const url = new URL("/history/claim", origin);
  if (!["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "HISTORY_EMAIL_UNAVAILABLE" });
  const token = randomBytes(32).toString("hex");
  url.searchParams.set("token", token);
  const key = scopeKey(input.sources);
  const deliveryDb = afterCommitDatabase(db);
  const admitted = await inTransaction(db, async (tx) => {
    await lockScope(tx, input.sources, [actorId], input.email);
    const existing = await tx.historicalRecordInvitationAttempt.findUnique({ where: { id: input.operationId } });
    if (existing) {
      if (existing.issuedById !== actorId || existing.inputHash !== inputHash) throw stale();
      return { attempt: existing, fresh: false };
    }
    const review = await invitationPreview(tx, actorId, input);
    if (review.fingerprint !== input.fingerprint) throw stale();
    if (review.source.blocked.size) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `HISTORY_${[...review.source.blocked][0]}` });
    const predecessor = await tx.historicalRecordInvitation.findUnique({ where: { scopeKey: key } });
    await tx.historicalRecordInvitationAttempt.updateMany({ where: { scopeKey: key, status: "ADMITTED" }, data: { status: "SUPERSEDED", settledAt: new Date() } });
    const attempt = await tx.historicalRecordInvitationAttempt.create({ data: {
      id: input.operationId, inputHash, scopeKey: key, sources: input.sources,
      tokenHash: digest(token), scopeFingerprint: review.source.fingerprint,
      predecessorFingerprint: await predecessorFingerprint(tx, predecessor), email: input.email,
      recipientId: review.recipient.user?.id, recipientSessionVersion: review.recipient.user?.sessionVersion,
      recipientFingerprint: review.recipient.user ? digest(JSON.stringify(review.recipient.evidence)) : null,
      issuedById: actorId, issuedBySessionVersion: review.actor.sessionVersion,
      reason: input.reason, expiresAt: new Date(Date.now() + 7 * 86400000),
    } });
    await tx.auditLog.create({ data: { userId: actorId, entity: "HistoricalRecordInvitation", entityId: key, operation: "tuteeHistory.inviteExact", kind: "ACTION", action: "Admitted exact historical invitation", details: { attemptId: attempt.id, sources: input.sources, reason: input.reason, outcome: "DELIVERY_ADMITTED", changeApplied: false } } });
    return { attempt, fresh: true };
  });
  if (!admitted.fresh) return (await exactHistoryInvitationReceipt(deliveryDb, actorId, input.operationId))!;
  const receipt = historyInvitationReceipt(admitted.attempt);
  const scope = historyInvitationScope(exactHistorySources.parse(admitted.attempt.sources));
  const recover = async () => {
    try { Object.assign(receipt, await exactHistoryInvitationReceipt(deliveryDb, actorId, input.operationId) ?? { status: "SUPERSEDED", expiresAt: null }); }
    catch { Object.assign(receipt, { status: "UNCERTAIN", expiresAt: null }); }
  };
  const deliver = async () => {
    try {
      await emailSender.send({ category: "SECURITY", to: input.email,
        subject: "Link your historical tutoring records / 关联历史辅导记录",
        text: `${scope.en}\n${scope.zh}\n\nThe program team has reviewed an exact set of your historical Tutor/Tutee records:\n${url.href}\n\nSign in with your verified account, or create a history-only account using the separate email verification code. Review and explicitly claim the listed records. This invitation expires in seven days. It does not enroll you, grant current participation, or accept policies for you.\n\n项目团队已核实指定的历史辅导伙伴／学习伙伴记录。请使用已验证账号登录，或通过单独的邮箱验证码创建仅供历史访问的账号，然后核对并确认关联列出的记录。邀请七天内有效，不会加入当前项目或代为接受政策。` });
    } catch {
      try {
        await inTransaction(deliveryDb, async (tx) => {
          const failed = await tx.historicalRecordInvitationAttempt.updateMany({ where: { id: input.operationId, status: "ADMITTED" }, data: { status: "DELIVERY_FAILED", settledAt: new Date() } });
          if (failed.count) await tx.auditLog.create({ data: { userId: actorId, entity: "HistoricalRecordInvitation", entityId: key, operation: "tuteeHistory.inviteExactDelivery", kind: "ACTION", action: "Exact historical invitation delivery failed", details: { attemptId: input.operationId, outcome: "DELIVERY_FAILED", changeApplied: false } } });
        });
      } catch { /* The durable read below owns an uncertain settlement. */ }
      await recover();
      return;
    }
    try {
      await inTransaction(deliveryDb, async (tx) => {
        await lockScope(tx, input.sources, [actorId], input.email);
        const attempt = await tx.historicalRecordInvitationAttempt.findUniqueOrThrow({ where: { id: input.operationId } });
        if (attempt.status !== "ADMITTED") return;
        let current = false;
        try {
          const review = await invitationPreview(tx, actorId, input);
          const predecessor = await tx.historicalRecordInvitation.findUnique({ where: { scopeKey: key } });
          current = !review.source.blocked.size && review.fingerprint === input.fingerprint && attempt.expiresAt > new Date() && (await predecessorFingerprint(tx, predecessor)) === attempt.predecessorFingerprint;
        } catch (error) { if (!(error instanceof TRPCError)) throw error; }
        if (current) {
          const data = { tokenHash: attempt.tokenHash, sources: exactHistorySources.parse(attempt.sources), scopeFingerprint: attempt.scopeFingerprint, email: attempt.email, recipientId: attempt.recipientId, recipientSessionVersion: attempt.recipientSessionVersion, recipientFingerprint: attempt.recipientFingerprint, issuedById: actorId, issuedBySessionVersion: attempt.issuedBySessionVersion, reason: attempt.reason, expiresAt: attempt.expiresAt, setupCodeHash: null, setupCodeExpiresAt: null, setupAttempts: 0, setupVerifiedAt: null, setupUserId: null, claimedAt: null, claimedUserId: null };
          await tx.historicalRecordInvitation.upsert({ where: { scopeKey: key }, create: { scopeKey: key, ...data }, update: data });
        }
        await tx.historicalRecordInvitationAttempt.update({ where: { id: input.operationId }, data: { status: current ? "PUBLISHED" : "SUPERSEDED", settledAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actorId, entity: "HistoricalRecordInvitation", entityId: key, operation: "tuteeHistory.inviteExactDelivery", kind: "ACTION", action: current ? "Published accepted exact historical invitation" : "Exact historical invitation superseded", details: { attemptId: input.operationId, outcome: current ? "PUBLISHED" : "SUPERSEDED", changeApplied: current } } });
      });
    } catch { /* Never replay an externally accepted delivery or uncertain commit. */ }
    await recover();
  };
  if (!deferUntilCommit(deliver)) await deliver();
  return receipt;
}

/** The setup adapter locates a grant by its secret digest, never by source ID. */
export async function exactSetupInvitation(tx: TransactionDb, tokenHash: string, email: string) {
  const before = await tx.historicalRecordInvitation.findUnique({ where: { tokenHash } });
  if (!before) return null;
  const sources = exactHistorySources.parse(before.sources);
  await lockScope(tx, sources, [before.issuedById, ...[before.recipientId, before.setupUserId].filter((id): id is string => !!id)]);
  const invite = await tx.historicalRecordInvitation.findUnique({ where: { tokenHash } });
  if (!invite || invite.claimedAt || invite.expiresAt <= new Date()) throw invalid();
  if (invite.email !== email) throw new TRPCError({ code: "FORBIDDEN", message: "HISTORY_EMAIL_MISMATCH" });
  const actor = await requireHistoryManager(tx, invite.issuedById);
  if (actor.sessionVersion !== invite.issuedBySessionVersion) throw stale();
  const value = await sourceSnapshot(tx, sources);
  if (value.fingerprint !== invite.scopeFingerprint || value.blocked.size) throw stale();
  const recipient = await recipientSnapshot(tx, email);
  const expectedUser = invite.recipientId ?? invite.setupUserId;
  if (!recipient.ready || (recipient.user?.id ?? null) !== expectedUser || (invite.recipientId && recipient.user?.sessionVersion !== invite.recipientSessionVersion)) throw stale();
  if (recipient.user && (recipient.conflict || recipient.user.person?.resolutionState === "REVIEW_REQUIRED" || recipient.user.person?.mergedIntoId || digest(JSON.stringify(recipient.evidence)) !== invite.recipientFingerprint)) throw stale();
  if (value.live.some((r) => r.id !== expectedUser)) throw stale();
  return { invite, record: { englishName: value.sources[0]!.name }, sources: value.sources, kind: "EXACT" as const };
}

/** Credential setup binds the new recipient once, after its identity initialization.
 * Later group or credential changes need a new staff review, including A→B→A. */
export async function bindExactHistoryRecipient(tx: TransactionDb, key: string, userId: string) {
  const invite = await tx.historicalRecordInvitation.findUniqueOrThrow({ where: { scopeKey: key } });
  const recipient = await recipientSnapshot(tx, invite.email);
  if (recipient.user?.id !== userId || !recipient.ready) throw stale();
  await tx.historicalRecordInvitation.update({ where: { scopeKey: key }, data: { recipientId: userId, recipientSessionVersion: recipient.user.sessionVersion, recipientFingerprint: digest(JSON.stringify(recipient.evidence)) } });
}

/** Both invitation formats consume ownership once; their separate durable receipt
 * supports read recovery without retaining a reusable legacy grant or replaying writes. */
export async function writeHistoricalClaimReceipt(tx: TransactionDb, input: { tokenHash: string; sources: ExactHistorySource[]; userId: string; email: string; expiresAt: Date }) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { sessionVersion: true } });
  await tx.historicalRecordClaimReceipt.create({ data: { ...input, sources: exactHistorySources.parse(input.sources), sessionVersion: user.sessionVersion } });
}

async function inspectClaimReceipt(tx: TransactionDb, userId: string, tokenHash: string) {
  const receipt = await tx.historicalRecordClaimReceipt.findUnique({ where: { tokenHash } });
  if (!receipt) return null;
  await lockScope(tx, exactHistorySources.parse(receipt.sources), [userId]);
  const recipient = await recipientSnapshot(tx, receipt.email);
  if (receipt.userId !== userId || recipient.user?.id !== userId || !recipient.ready || recipient.user.sessionVersion !== receipt.sessionVersion) throw invalid();
  const sources = [];
  for (const source of exactHistorySources.parse(receipt.sources)) {
    const record = source.kind === "TUTOR"
      ? await tx.tutor.findUnique({ where: { id: source.id }, select: { englishName: true } })
      : await tx.tutee.findUnique({ where: { id: source.id }, select: { englishName: true } });
    const owner = source.kind === "TUTOR"
      ? await tx.tutorProfileOwnership.findUnique({ where: { tutorId: source.id } })
      : await tx.studentProfileOwnership.findUnique({ where: { tuteeId: source.id } });
    if (!record || owner?.userId !== userId) throw invalid();
    sources.push({ ...source, name: record.englishName });
  }
  const [tutorSessions, tuteeSessions] = await Promise.all([
    tx.session.count({ where: { tutorId: { in: sources.filter((r) => r.kind === "TUTOR").map((r) => r.id) } } }),
    tx.sessionTutee.count({ where: { tuteeId: { in: sources.filter((r) => r.kind === "TUTEE").map((r) => r.id) } } }),
  ]);
  return { name: sources[0]!.name, sessions: tutorSessions + tuteeSessions, expiresAt: receipt.expiresAt, sources, claimed: true };
}

export async function inspectExactHistoryClaim(db: DomainDb, userId: string, tokenHash: string) {
  return inTransaction(db, async (tx) => {
    const receipt = await inspectClaimReceipt(tx, userId, tokenHash);
    if (receipt) return receipt;
    const before = await tx.historicalRecordInvitation.findUnique({ where: { tokenHash } });
    if (!before) return null;
    if (before.claimedAt) throw invalid();
    const value = await exactSetupInvitation(tx, tokenHash, before.email);
    if (!value) throw invalid();
    if ((value.invite.recipientId ?? value.invite.setupUserId) !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "HISTORY_EMAIL_MISMATCH" });
    const [tutorSessions, tuteeSessions] = await Promise.all([
      tx.session.count({ where: { tutorId: { in: value.sources.filter((r) => r.kind === "TUTOR").map((r) => r.id) } } }),
      tx.sessionTutee.count({ where: { tuteeId: { in: value.sources.filter((r) => r.kind === "TUTEE").map((r) => r.id) } } }),
    ]);
    return { name: value.record.englishName, sessions: tutorSessions + tuteeSessions, expiresAt: value.invite.expiresAt, sources: value.sources, claimed: false };
  });
}

export async function claimExactHistory(db: DomainDb, userId: string, tokenHash: string) {
  return inTransaction(db, async (tx) => {
    const before = await tx.historicalRecordInvitation.findUnique({ where: { tokenHash } });
    if (!before) return null;
    if (before.claimedAt) {
      await inspectExactHistoryClaim(tx, userId, tokenHash);
      return { ok: true };
    }
    await lockScope(tx, exactHistorySources.parse(before.sources), [userId, before.issuedById]);
    const current = await tx.historicalRecordInvitation.findUnique({ where: { tokenHash } });
    if (current?.claimedAt) {
      await inspectExactHistoryClaim(tx, userId, tokenHash);
      return { ok: true };
    }
    const value = await exactSetupInvitation(tx, tokenHash, before.email);
    if (!value) throw invalid();
    if ((value.invite.recipientId ?? value.invite.setupUserId) !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "HISTORY_EMAIL_MISMATCH" });
    // Validate the complete scope before its first ownership write. Later writes
    // intentionally advance the same fences, so no partially revalidated grant.
    for (const source of value.sources) {
      if (source.kind === "TUTOR") await tx.tutorProfileOwnership.upsert({ where: { tutorId: source.id }, create: { tutorId: source.id, userId }, update: { userId, revision: { increment: 1 } } });
      else {
        await tx.studentProfileOwnership.upsert({ where: { tuteeId: source.id }, create: { tuteeId: source.id, userId }, update: { userId, revision: { increment: 1 } } });
        await supersedeHistoryInvitationAttempts(tx, source.id);
        await tx.tuteeHistoryInvitation.deleteMany({ where: { tuteeId: source.id } });
      }
      await syncParticipantPerson(tx, source.kind, source.id, userId);
    }
    await writeHistoricalClaimReceipt(tx, { tokenHash, sources: value.sources.map(({ kind, id }) => ({ kind, id })), userId, email: before.email, expiresAt: before.expiresAt });
    await tx.historicalRecordInvitation.update({ where: { tokenHash }, data: { claimedAt: new Date(), claimedUserId: userId } });
    await tx.historicalRecordInvitationAttempt.updateMany({ where: { scopeKey: before.scopeKey, status: "ADMITTED" }, data: { status: "SUPERSEDED", settledAt: new Date() } });
    await tx.auditLog.create({ data: { userId, entity: "HistoricalRecordInvitation", entityId: before.scopeKey, operation: "tuteeHistory.claimExact", kind: "ACTION", action: "Claimed exact historical records", details: { sources: value.sources, issuedById: before.issuedById, reason: before.reason } } });
    return { ok: true };
  });
}
