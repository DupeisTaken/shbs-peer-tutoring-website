import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isHistoricalTutor } from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { accountHistoryReaderId, accountRetirementChain } from "./account-history";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { assignParticipantPerson } from "./person-identity";
import { supersededPairingIds } from "./participant-execution";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";

const id = z.string().min(1).max(128);
const entity = z.enum(["Tutor", "Tutee", "Notification", "StudentQuarterBlock", "EmailDelivery"]);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const historyCorrectionSelection = z.object({
  personId: id,
  sourceUserIds: z.array(id).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  recipientUserId: id.nullable(),
});
const decision = z.object({ entity, recordId: id, action: z.enum(["RETAIN", "ASSIGN", "QUARANTINE"]) });
export const historyCorrectionInput = historyCorrectionSelection.extend({
  decisions: z.array(decision),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1000), acknowledged: z.literal(true),
  operationId: z.string().uuid(), confirmPassword: z.string().min(1).max(1024),
});
type Selection = z.input<typeof historyCorrectionSelection>;
type Entity = z.infer<typeof entity>;
type Row = { entity: Entity; recordId: string; label: string; readerUserId: string | null; provenance: "REVIEW_REQUIRED"; assignable: boolean; deliveryStatus?: string; sourceNotificationId?: string | null };
const rowKey = (row: { entity: string; recordId: string }) => `${row.entity}:${row.recordId}`;

async function reviewer(db: DomainDb, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.mergedIntoId || actor.recoveryVoidedAt || actor.suspendedAt || !["ADMIN", "HEAD"].includes(actor.role))
    throw new TRPCError({ code: "FORBIDDEN" });
  return actor;
}

/** Inventory is intentionally conservative: older combines did not retain row
 * provenance. Neither names nor timing proves which retired source owned a row. */
async function plan(db: DomainDb, raw: Selection) {
  const input = historyCorrectionSelection.parse(raw);
  const [person, users, recipient, mappings] = await Promise.all([
    db.person.findUnique({ where: { id: input.personId } }),
    db.user.findMany({ where: { id: { in: input.sourceUserIds } }, orderBy: { id: "asc" } }),
    input.recipientUserId ? db.user.findUnique({ where: { id: input.recipientUserId }, include: { schoolDeparture: true } }) : null,
    db.retiredHistoryOwnership.findMany({ where: { sourceUserId: { in: input.sourceUserIds } }, orderBy: { sourceUserId: "asc" } }),
  ]);
  if (!person || person.mergedIntoId || users.length !== input.sourceUserIds.length || users.some((user) => !user.mergedIntoId || user.personId !== person.id))
    throw new TRPCError({ code: "CONFLICT", message: "Select original retired accounts from this current identity group." });
  // Suspended/departed accounts may own evidence; their existing restrictions
  // still govern reads and participation. This operation grants no capability.
  if (input.recipientUserId && (!recipient || recipient.mergedIntoId || recipient.recoveryVoidedAt || !recipient.emailVerifiedAt || !recipient.passwordHash || recipient.mustChangePassword))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Choose an existing verified account with completed credential setup, or quarantine history while account setup is completed." });
  const previousReaders = await Promise.all(users.map((user) => accountHistoryReaderId(db, user.id)));
  // Permanent terminals are inventory leads only, never an authorization fallback.
  const terminals = await Promise.all(users.map(async (user) => {
    try { return (await accountRetirementChain(db, user.id)).at(-1) ?? null; }
    catch { return null; }
  }));
  const candidateUserIds = [...new Set([...input.sourceUserIds, ...previousReaders, ...terminals].filter((value): value is string => !!value))].sort();
  const previousReceipts = await db.personHistoryCorrectionReceipt.findMany({ where: { sourceUserIds: { hasSome: input.sourceUserIds } }, select: { id: true } });
  const priorOverrides = await db.historyRowOwnership.findMany({
    where: { OR: [{ readerUserId: { in: candidateUserIds } }, { quarantineUserIds: { hasSome: candidateUserIds } }, { receiptId: { in: previousReceipts.map((row) => row.id) } }] },
    orderBy: [{ entity: "asc" }, { recordId: "asc" }],
  });
  const overrideIds = (kind: Entity) => priorOverrides.filter((row) => row.entity === kind).map((row) => row.recordId);
  const [tutors, tutees, ownerships, notifications, blocks, destinationPerson, initialDeliveries] = await Promise.all([
    db.tutor.findMany({ where: { OR: [{ personId: person.id }, { retainedOwner: { userId: { in: candidateUserIds } } }, { id: { in: overrideIds("Tutor") } }] }, include: { user: { select: { id: true } }, retainedOwner: true }, orderBy: { id: "asc" } }),
    db.tutee.findMany({ where: { OR: [{ personId: person.id }, { id: { in: overrideIds("Tutee") } }, { id: { in: (await db.studentProfileOwnership.findMany({ where: { userId: { in: candidateUserIds } }, select: { tuteeId: true } })).map((row) => row.tuteeId) } }] }, include: { user: { select: { id: true } } }, orderBy: { id: "asc" } }),
    db.studentProfileOwnership.findMany({ orderBy: { tuteeId: "asc" } }),
    db.notification.findMany({ where: { OR: [{ userId: { in: candidateUserIds } }, { id: { in: overrideIds("Notification") } }] }, orderBy: { id: "asc" } }),
    db.studentQuarterBlock.findMany({ where: { OR: [{ userId: { in: candidateUserIds } }, { id: { in: overrideIds("StudentQuarterBlock") } }] }, orderBy: { id: "asc" } }),
    recipient?.personId ? db.person.findUnique({ where: { id: recipient.personId } }) : null,
    db.emailDelivery.findMany({ where: { category: { in: ["messages", "info", "information", "review", "reminder"] }, OR: [{ userId: { in: candidateUserIds } }, { id: { in: overrideIds("EmailDelivery") } }, { sourceNotificationId: { in: overrideIds("Notification") } }] }, orderBy: { id: "asc" } }),
  ]);
  const linkedDeliveries = await db.emailDelivery.findMany({ where: { category: { in: ["messages", "info", "information", "review", "reminder"] }, sourceNotificationId: { in: notifications.map((row) => row.id) } } });
  const deliveries = [...new Map([...initialDeliveries, ...linkedDeliveries].map((row) => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (destinationPerson?.mergedIntoId) throw new TRPCError({ code: "CONFLICT", message: "The recipient's directory group needs reconciliation." });
  const term = await db.term.findFirst({ where: { active: true }, select: { id: true } });
  const assignments = term ? await db.pairing.findMany({ where: { termId: term.id, id: { notIn: await supersededPairingIds(db) }, OR: [{ tutorId: { in: tutors.map((row) => row.id) } }, { tutees: { some: { tuteeId: { in: tutees.map((row) => row.id) } } } }] }, select: { id: true, tutorId: true, tutees: { select: { tuteeId: true } } }, orderBy: { id: "asc" } }) : [];
  const override = new Map(priorOverrides.map((row) => [rowKey(row), row]));
  const rawOwnerIds = [...new Set([
    ...tutors.flatMap((row) => [row.user?.id, row.retainedOwner?.userId]),
    ...ownerships.map((row) => row.userId), ...notifications.map((row) => row.userId), ...blocks.map((row) => row.userId),
  ].filter((value): value is string => !!value))];
  const readerByOwner = new Map(await Promise.all(rawOwnerIds.map(async (ownerId) => [ownerId, await accountHistoryReaderId(db, ownerId)] as const)));
  const [effectiveOwnerships, readerGenerations] = await Promise.all([
    db.retiredHistoryOwnership.findMany({ where: { sourceUserId: { in: rawOwnerIds } }, orderBy: { sourceUserId: "asc" } }),
    db.user.findMany({ where: { id: { in: [...new Set([...rawOwnerIds, ...readerByOwner.values()].filter((value): value is string => !!value))] } }, select: { id: true, historyAccessRevision: true, mergedIntoId: true, recoveryVoidedAt: true }, orderBy: { id: "asc" } }),
  ]);
  const rows: Row[] = [
    ...tutors.map((row): Row => ({ entity: "Tutor", recordId: row.id, label: row.englishName, readerUserId: readerByOwner.get(row.user?.id ?? row.retainedOwner?.userId ?? "") ?? null, provenance: "REVIEW_REQUIRED", assignable: !row.user && isHistoricalTutor(row) && !assignments.some((assignment) => assignment.tutorId === row.id) })),
    ...tutees.map((row): Row => {
      const ownerId = row.user?.id ?? ownerships.find((owner) => owner.tuteeId === row.id)?.userId ?? null;
      return { entity: "Tutee", recordId: row.id, label: row.englishName, readerUserId: ownerId && readerByOwner.get(ownerId) === ownerId ? ownerId : null, provenance: "REVIEW_REQUIRED", assignable: !row.user && isHistoricalTutee(row, term?.id ?? null) && !assignments.some((assignment) => assignment.tutees.some((link) => link.tuteeId === row.id)) };
    }),
    // Reviewer-only inventory needs the original title to distinguish exact rows;
    // bodies and private event payloads stay out of this projection.
    ...notifications.map((row): Row => ({ entity: "Notification", recordId: row.id, label: row.title.trim() || (row.event ?? "Notification"), readerUserId: override.has(`Notification:${row.id}`) ? override.get(`Notification:${row.id}`)!.readerUserId : readerByOwner.get(row.userId) ?? null, provenance: "REVIEW_REQUIRED", assignable: true })),
    ...blocks.map((row): Row => ({ entity: "StudentQuarterBlock", recordId: row.id, label: row.intakeTermId, readerUserId: override.has(`StudentQuarterBlock:${row.id}`) ? override.get(`StudentQuarterBlock:${row.id}`)!.readerUserId : readerByOwner.get(row.userId ?? "") ?? null, provenance: "REVIEW_REQUIRED", assignable: true })),
    ...deliveries.map((row): Row => ({ entity: "EmailDelivery", recordId: row.id, label: row.category, readerUserId: override.has(`EmailDelivery:${row.id}`) ? override.get(`EmailDelivery:${row.id}`)!.readerUserId : row.userId, provenance: "REVIEW_REQUIRED", assignable: row.status === "PENDING" && !row.attemptStartedAt, deliveryStatus: row.status, sourceNotificationId: row.sourceNotificationId })),
  ].sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
  const snapshot = { person, users, recipient, mappings, tutors, tutees, ownerships: ownerships.filter((row) => tutees.some((source) => source.id === row.tuteeId)), notifications, blocks, deliveries, priorOverrides, destinationPerson, term, assignments, effectiveOwnerships, readerGenerations, effectiveRows: rows };
  return { input, person, recipient, users, candidateUserIds, snapshot, preview: {
    personId: person.id, fingerprint: digest({ action: "history-correction", input: { ...input, sourceUserIds: [...input.sourceUserIds].sort() }, snapshot }),
    sourceUsers: users.map((user, index) => ({ id: user.id, name: user.name ?? user.username ?? user.email, readerUserId: previousReaders[index] ?? null })),
    recipient: recipient ? { id: recipient.id, name: recipient.name ?? recipient.username ?? recipient.email, suspended: !!recipient.suspendedAt, departed: !!recipient.schoolDeparture?.reason } : null,
    rows,
  } };
}

export async function historyCorrectionInventory(db: DomainDb, input: Selection) { return (await plan(db, input)).preview; }
function result(receipt: { id: string; personId: string; destinationPersonId: string; sourceUserIds: string[] }) {
  return { ok: true as const, receiptId: receipt.id, personId: receipt.personId, destinationPersonId: receipt.destinationPersonId, sourceUserIds: receipt.sourceUserIds };
}
export async function historyCorrectionReceipt(db: DomainDb, actorId: string, operationId: string) {
  await reviewer(db, actorId);
  const receipt = await db.personHistoryCorrectionReceipt.findUnique({ where: { id: operationId } });
  return receipt?.actorId === actorId ? result(receipt) : null;
}

/** One exact correction owns access metadata only. No historical participant,
 * actor, signature, completed session, sent delivery or credential is rewritten. */
export async function correctPersonHistory(db: DomainDb, actorId: string, raw: z.input<typeof historyCorrectionInput>) {
  const input = historyCorrectionInput.parse(raw);
  const { confirmPassword: password, ...intent } = input;
  const inputHash = digest({ ...intent, sourceUserIds: [...intent.sourceUserIds].sort(), decisions: [...intent.decisions].sort((a, b) => rowKey(a).localeCompare(rowKey(b))) });
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    const saved = await tx.personHistoryCorrectionReceipt.findUnique({ where: { id: input.operationId } });
    if (saved) {
      await reviewer(tx, actorId);
      if (saved.actorId !== actorId || saved.inputHash !== inputHash) throw new TRPCError({ code: "CONFLICT", message: "This operation reference belongs to another reviewed correction." });
      return result(saved);
    }
    const initial = await plan(tx, input);
    for (const userId of [...new Set([actorId, ...initial.candidateUserIds, ...(input.recipientUserId ? [input.recipientUserId] : [])])].sort()) await lockEntity(tx, `account-profile:${userId}`);
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "Person", "AcademicProfile", "AccountEmail", "SchoolDeparture", "StudentProfileOwnership", "TutorProfileOwnership", "RetiredHistoryOwnership", "HistoryRowOwnership", "Notification", "StudentQuarterBlock", "EmailDelivery" IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await reviewer(tx, actorId);
    // A failed confirmation rejects this input; it does not revoke reviewer access.
    if (!verifyPasswordConfirmation(actorId, password, actor.passwordHash)) throw new TRPCError({ code: "BAD_REQUEST", message: "Password is incorrect." });
    const planned = await plan(tx, input);
    if (planned.preview.fingerprint !== input.fingerprint) throw new TRPCError({ code: "CONFLICT", message: "History or ownership changed. Reload and review the correction again." });
    const choices = new Map(input.decisions.map((row) => [rowKey(row), row]));
    if (choices.size !== input.decisions.length || choices.size !== planned.preview.rows.length || planned.preview.rows.some((row) => !choices.has(rowKey(row))))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Review one exact decision for every potentially affected original row." });
    for (const row of planned.preview.rows) {
      const action = choices.get(rowKey(row))!.action;
      if (row.entity === "EmailDelivery" && action === "ASSIGN")
        throw new TRPCError({ code: "BAD_REQUEST", message: "An existing email copy cannot be forwarded by history correction." });
      if ((action === "ASSIGN" && !planned.recipient) || (action !== "RETAIN" && !row.assignable))
        throw new TRPCError({ code: "CONFLICT", message: "Current participation must use the active transfer review. Assign history only to a verified recipient." });
      if (row.entity === "EmailDelivery" && row.assignable && row.sourceNotificationId) {
        const notice = planned.preview.rows.find((source) => source.entity === "Notification" && source.recordId === row.sourceNotificationId);
        const noticeAction = notice ? choices.get(rowKey(notice))!.action : null;
        const nextReader = noticeAction === "ASSIGN" ? input.recipientUserId : noticeAction === "QUARANTINE" ? null : notice?.readerUserId;
        if (notice && nextReader !== row.readerUserId && action !== "QUARANTINE")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Quarantine the exact pending email copy when its notification moves away from the stored recipient." });
      }
    }
    const destination = planned.snapshot.destinationPerson ?? await tx.person.create({ data: { primaryUserId: planned.recipient?.id ?? null, resolutionState: "REVIEW_REQUIRED" } });
    if (planned.recipient && !planned.recipient.personId) await tx.user.update({ where: { id: planned.recipient.id }, data: { personId: destination.id } });
    for (const user of planned.users) {
      await tx.retiredHistoryOwnership.upsert({ where: { sourceUserId: user.id },
        create: { sourceUserId: user.id, readerUserId: input.recipientUserId, state: input.recipientUserId ? "ASSIGNED" : "QUARANTINED", receiptId: input.operationId },
        update: { readerUserId: input.recipientUserId, state: input.recipientUserId ? "ASSIGNED" : "QUARANTINED", receiptId: input.operationId },
      });
      await tx.user.update({ where: { id: user.id }, data: { personId: destination.id } });
    }
    type RowEvidence = { entity: Entity; recordId: string; readerUserId: string | null; personId: string | null; quarantineUserIds: string[]; sourceUserIds: string[]; deliveryStatus?: string };
    const before: RowEvidence[] = [];
    const after: (RowEvidence & { action: string })[] = [];
    const changedReaders = new Set<string>();
    const changedRows = new Set<string>();
    const changedPersonIds = new Set([planned.person.id, destination.id]);
    for (const row of planned.preview.rows) {
      const action = choices.get(rowKey(row))!.action;
      const previousOverride = planned.snapshot.priorOverrides.find((source) => rowKey(source) === rowKey(row));
      const originalPersonId = row.entity === "Tutor" ? planned.snapshot.tutors.find((source) => source.id === row.recordId)?.personId ?? null
        : row.entity === "Tutee" ? planned.snapshot.tutees.find((source) => source.id === row.recordId)?.personId ?? null : null;
      before.push({ entity: row.entity, recordId: row.recordId, readerUserId: row.readerUserId, personId: originalPersonId, quarantineUserIds: previousOverride?.quarantineUserIds ?? [], sourceUserIds: previousOverride?.sourceUserIds ?? [], ...(row.deliveryStatus ? { deliveryStatus: row.deliveryStatus } : {}) });
      const readerUserId = action === "RETAIN" ? row.readerUserId : action === "ASSIGN" ? input.recipientUserId : null;
      const afterRow = { entity: row.entity, recordId: row.recordId, readerUserId, action, personId: originalPersonId, quarantineUserIds: previousOverride?.quarantineUserIds ?? [], sourceUserIds: previousOverride?.sourceUserIds ?? [], ...(row.deliveryStatus ? { deliveryStatus: action === "QUARANTINE" ? "CANCELLED" : row.deliveryStatus } : {}) };
      after.push(afterRow);
      // RETAIN freezes the actual old reader, even when the immutable raw owner
      // is a selected retired source whose effective mapping just changed.
      const originalOwnerId = row.entity === "Tutor" ? planned.snapshot.tutors.find((source) => source.id === row.recordId)?.retainedOwner?.userId
        : row.entity === "Tutee" ? planned.snapshot.ownerships.find((source) => source.tuteeId === row.recordId)?.userId
        : row.entity === "Notification" ? planned.snapshot.notifications.find((source) => source.id === row.recordId)?.userId
        : row.entity === "EmailDelivery" ? null
        : planned.snapshot.blocks.find((source) => source.id === row.recordId)?.userId;
      const retainedSourceChanged = action === "RETAIN" && !!originalOwnerId && input.sourceUserIds.includes(originalOwnerId);
      if (action === "RETAIN" && !retainedSourceChanged) continue;
      changedRows.add(rowKey(row));
      if (row.readerUserId) changedReaders.add(row.readerUserId);
      if (readerUserId) changedReaders.add(readerUserId);
      const quarantineUserIds = row.entity === "StudentQuarterBlock" && (action === "QUARANTINE" || (action === "RETAIN" && !readerUserId))
        ? [...new Set([...(previousOverride?.quarantineUserIds ?? []), row.readerUserId, input.recipientUserId].filter((value): value is string => !!value))] : [];
      afterRow.quarantineUserIds = quarantineUserIds;
      const sourceUserIds = row.entity === "Tutor" || row.entity === "Tutee"
        ? [...new Set([...(previousOverride?.sourceUserIds ?? []), ...(action === "RETAIN" ? originalOwnerId ? [originalOwnerId] : [] : input.sourceUserIds)])].sort()
        : previousOverride?.sourceUserIds ?? [];
      afterRow.sourceUserIds = sourceUserIds;
      await tx.historyRowOwnership.upsert({ where: { entity_recordId: { entity: row.entity, recordId: row.recordId } },
        create: { entity: row.entity, recordId: row.recordId, readerUserId, quarantineUserIds, sourceUserIds, receiptId: input.operationId },
        update: { readerUserId, quarantineUserIds, sourceUserIds, receiptId: input.operationId, revision: { increment: 1 } },
      });
      if (row.entity === "Tutor" || row.entity === "Tutee") {
        if (row.entity === "Tutor") {
          if (readerUserId) await tx.tutorProfileOwnership.upsert({ where: { tutorId: row.recordId }, create: { tutorId: row.recordId, userId: readerUserId }, update: { userId: readerUserId, revision: { increment: 1 } } });
          else await tx.tutorProfileOwnership.deleteMany({ where: { tutorId: row.recordId } });
        } else {
          if (readerUserId) await tx.studentProfileOwnership.upsert({ where: { tuteeId: row.recordId }, create: { tuteeId: row.recordId, userId: readerUserId }, update: { userId: readerUserId, revision: { increment: 1 } } });
          else await tx.studentProfileOwnership.deleteMany({ where: { tuteeId: row.recordId } });
        }
        // Quarantined rows receive an independent review group, not the recipient's.
        if (action !== "RETAIN") {
          const groupId = readerUserId ? destination.id : (await tx.person.create({ data: { resolutionState: "REVIEW_REQUIRED" } })).id;
          await assignParticipantPerson(tx, row.entity === "Tutor" ? "TUTOR" : "TUTEE", [row.recordId], groupId);
          afterRow.personId = groupId;
          if (originalPersonId) changedPersonIds.add(originalPersonId);
          changedPersonIds.add(groupId);
        }
      }
    }
    // Explicit epoch changes are honored by the DB credential trigger. Increment
    // previous readers too when a first per-row override revokes their old grant.
    await tx.user.updateMany({ where: { id: { in: [...changedReaders] }, mergedIntoId: null }, data: { historyAccessRevision: { increment: 1 } } });
    await tx.person.updateMany({ where: { id: { in: [...changedPersonIds] } }, data: { resolutionState: "REVIEW_REQUIRED", revision: { increment: 1 } } });
    const subjects = [
      ...[...changedPersonIds].map((recordId) => ({ entity: "Person", recordId })),
      ...[...new Set([...input.sourceUserIds, ...planned.preview.sourceUsers.flatMap((source) => source.readerUserId ? [source.readerUserId] : []), ...changedReaders, ...(input.recipientUserId ? [input.recipientUserId] : [])])].map((recordId) => ({ entity: "User", recordId })),
      ...planned.preview.rows.filter((row) => changedRows.has(rowKey(row))).map((row) => ({ entity: row.entity, recordId: row.recordId })),
    ];
    const receipt = await tx.personHistoryCorrectionReceipt.create({ data: { id: input.operationId, actorId, inputHash, personId: planned.person.id, destinationPersonId: destination.id, sourceUserIds: [...input.sourceUserIds].sort(), before: { sources: planned.preview.sourceUsers, rows: before }, after: { readerUserId: input.recipientUserId, rows: after }, subjects } });
    await tx.auditLog.create({ data: { userId: actorId, userName: actor.name ?? actor.username, entity: "Person", entityId: planned.person.id, operation: "personCombine.historyCorrection", action: "Corrected exact private history ownership", details: { receiptId: receipt.id, sourceUserIds: input.sourceUserIds, recipientUserId: input.recipientUserId, decisions: input.decisions, reason: input.reason, fingerprint: input.fingerprint } } });
    return result(receipt);
  });
}
