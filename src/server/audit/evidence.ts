import { Prisma, type PrismaClient } from "../../../generated/prisma";
import { humanizeOperation, actionKind } from "~/lib/approval-policy";
import { SIGNUP_FIELDS } from "~/lib/signup-fields";
import {
  approvalScope, auditActorScope, auditCaptureScope, afterCommitScope,
  databaseScope, scopedDatabase, type AuditActor,
  flushCommittedEffects,
} from "~/server/db-scope";
import { inTransaction, type DomainDb, type TransactionDb } from "~/server/transactions";

type Row = Record<string, unknown>;
// Deliberately positive: adding a password/token/body field to a model cannot expose it.
const safeFields = new Set([
  "id", "role", "status", "state", "kind", "color", "reviewStatus", "active",
  "enabled", "name", "username", "englishName", "chineseName", "grade", "classYear",
  "firstName", "lastName", "preferredName", "alternativeNames", "gradeLevel", "rawGrade",
  "tuteeMember", "canTutor", "canTranslate", "crewStatus", "tutorAccessRevoked",
  "suspendedAt", "schoolDeparture", "createdAt", "updatedAt", "resolvedAt", "reviewedAt",
  "confirmedAt", "verificationDueAt", "firstAssignedAt", "eligibleAt", "usedAt", "expiresAt",
  "revokedAt", "resolvedById", "reviewedById", "requestedById", "userId", "tutorId", "tuteeId",
  "pairingId", "termId", "surveyId", "subjectId", "levelId", "applicationId", "removedPeriodKey",
  "schoolYear", "quarter", "dayOfWeek", "startMin", "endMin", "scheduleConfirmed",
  "tutorSignupOpen", "tuteeSignupOpen", "tutorSignupAccepting", "tuteeSignupAccepting",
  "tutorSignupOpensAt", "tutorSignupClosesAt", "tuteeSignupOpensAt", "tuteeSignupClosesAt",
  "signupEnabled", "signupOpensAt", "signupClosesAt", "tutorSignupEnabled", "pendingEnabled", "feature",
  "startDate", "endDate", "requireLatinNames", "requireLatinLegalNames", "usePreferredNames", "showAlternateNames",
  "captchaVersion", "academicallyGraduated", "reconfirmRequired", "usedByUserId", "issuedById", "crewApplicationId",
  "attempts", "consumedAt", "purpose", "twoFactorEnabled", "mustChangePassword", "sessionVersion", "verifiedAt", "emailVerifiedAt",
  "captchaEnabled", "emailNotificationsEnabled", "secondaryEmailBindingEnabled", "timeZone",
  "count", "points", "amount", "undone", "undoneAt", "attendanceConfirmed", "valid",
  "sessionId", "roomId", "actualRoomId", "timeSlotId", "meetingId", "primarySessionId", "mergeGroupId",
  "patrolId", "crewUserId", "observationId", "flagId", "adjustmentId", "assignmentId", "interviewerTutorId",
  "requestedTutorId", "requestedSubjectId", "promotedTutorId", "qualificationDecidedById", "recalledById",
  "createdById", "assignedById", "fromUserId", "toUserId", "batchId", "courseGroupId", "requestedByTutorId",
  "date", "month", "tutorStatus", "durationMin", "shFactor", "shCount", "hours", "online", "headcount",
  "creditAwardedAt", "windowStart", "observedAt", "expected", "observed", "excusedAt", "type",
  "interviewCompletedAt", "interviewDurationMin", "interviewSchoolYear", "interviewQuarter", "recalledAt",
  "ratingPreparedness", "ratingParticipation", "ratingUnderstanding", "ratingBehavior", "ratingProgress",
  "subject", "label", "title", "sortOrder", "builtIn", "slug", "languageCode", "locale", "pinned",
]);
const contactModels = new Set(["User", "Tutor", "Tutee", "AccountEmail"]);
const contactFields = new Set(["email", "phone", "preferredContact"]);
// Decision explanations belong to specific review records, never every field named
// reason/note. Participant appeals, messages and credential payloads stay private.
const decisionFields = new Map<string, ReadonlySet<string>>([
  ["ApprovalRequest", new Set(["reviewNote"])],
  ["CrewApplication", new Set(["decisionComment", "decidedByName", "decidedAt"])],
  ["DisciplinaryCard", new Set(["reason", "reviewNote"])],
  ["SessionFlag", new Set(["decisionNote"])],
  ["MeetingAttendance", new Set(["reason"])],
  ["ServiceHourAdjustment", new Set(["reason"])],
  ["StudentAppeal", new Set(["decision"])],
  ["MessageModeration", new Set(["reason"])],
  ["AcademicConfirmation", new Set(["reason"])],
  ["HistoricalAcademicCorrection", new Set(["reason", "evidence"])],
  ["RoomUnavailability", new Set(["reason"])],
]);
const modelEvidence = new Map(Prisma.dmmf.datamodel.models.map(model => [
  model.name.charAt(0).toLowerCase() + model.name.slice(1),
  { name: model.name, identityFields: model.primaryKey?.fields ?? model.fields.filter(field => field.isId).map(field => field.name),
    select: Object.fromEntries(model.fields.filter(field =>
    (safeFields.has(field.name) && (field.kind === "scalar" || field.kind === "enum") && field.type !== "Json" && !field.isList) ||
    (model.name === "ProgramSettings" && ["signupFields", "offeredGrades"].includes(field.name)) ||
    (contactModels.has(model.name) && contactFields.has(field.name)) ||
    (decisionFields.get(model.name)?.has(field.name) ?? false) ||
    (model.name === "ProgramFeature" && field.name === "key") ||
    (model.name === "Language" && field.name === "code")).map(field => [field.name, true])) },
]));

/** Evidence contains approved domain scalars only; nested payloads are never copied. */
export function safeAuditSnapshot(value: unknown, entity?: string): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Row;
  return Object.fromEntries(Object.entries(value as Row).flatMap<[string, Prisma.InputJsonValue | null]>(([key, item]) => {
    if (key === "offeredGrades" && Array.isArray(item)) {
      const grades: unknown[] = item;
      return [[key, grades.filter((grade): grade is number => typeof grade === "number" && Number.isInteger(grade))]];
    }
    if (key === "signupFields" && item && typeof item === "object" && !Array.isArray(item)) {
      const fields = item as Row;
      return [[key, Object.fromEntries((["tutor", "tutee"] as const).flatMap(form => {
        const stored = fields[form];
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
        return [[form, Object.fromEntries(SIGNUP_FIELDS[form].flatMap(field => {
          const state = (stored as Row)[field.key];
          return typeof state === "string" && ["hidden", "optional", "required"].includes(state) ? [[field.key, state]] : [];
        }))]];
      }))]];
    }
    // Established account/roster contacts are reviewable by authorized audit staff.
    // Challenge recipients and registration bindings remain outside this allowance.
    const decisionField = entity && decisionFields.get(entity)?.has(key);
    // This shared column also contains a participant's self-excuse. Only a record
    // explicitly marked as management attendance carries its free-text evidence.
    if (entity === "MeetingAttendance" && key === "reason" && record.excusedAt !== null) return [];
    if (!safeFields.has(key) && !(entity && contactModels.has(entity) && contactFields.has(key)) && !decisionField) return [];
    if (item instanceof Date) return [[key, item.toISOString()]];
    if (item === null || typeof item === "string" || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))) return [[key, item]];
    return [];
  }));
}

export async function recordDomainAudit(client: TransactionDb, args: {
  operation: string; entity: string; entityId?: string; action: string;
  before?: unknown; after?: unknown; reason?: string; originalActionId?: string;
  effects?: Prisma.InputJsonValue; system?: boolean; outcome?: string;
}) {
  const initiatingActor = auditActorScope.getStore();
  const actor = args.system ? undefined : initiatingActor;
  await client.auditLog.create({ data: {
    userId: actor?.id ?? null, userName: actor?.name ?? "System",
    action: args.action, entity: args.entity, entityId: args.entityId,
    operation: args.operation, approvalId: approvalScope.getStore(),
    details: {
      evidenceVersion: 1, actorRole: actor?.role ?? "SYSTEM", outcome: args.outcome ?? "APPLIED",
      before: safeAuditSnapshot(args.before, args.entity), after: safeAuditSnapshot(args.after, args.entity),
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.originalActionId ? { originalActionId: args.originalActionId } : {}),
      ...(args.effects ? { effects: args.effects } : {}),
      ...(args.system && initiatingActor ? { initiatingActorId: initiatingActor.id, initiatingActorRole: initiatingActor.role } : {}),
    },
  } });
}

/** Errors are recorded independently after rollback; exception messages may contain secrets. */
const recordedAttempts = new WeakSet<object>();
export function auditAttemptRecorded(error: unknown) {
  return !!error && typeof error === "object" && recordedAttempts.has(error);
}
export async function recordAuditAttempt(client: DomainDb, actor: AuditActor, operation: string, error: unknown) {
  if (auditAttemptRecorded(error)) return;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : "INTERNAL_SERVER_ERROR";
  const outcome = ["FORBIDDEN", "UNAUTHORIZED"].includes(code) ? "DENIED" : "FAILED";
  await databaseScope.exit(() => client.auditLog.create({ data: {
    userId: actor.id, userName: actor.name, operation,
    action: `${outcome === "DENIED" ? "Denied" : "Failed"}: ${humanizeOperation(operation)}`,
    entity: operation.split(".")[0]!, kind: "ATTEMPT", approvalId: approvalScope.getStore(),
    details: { evidenceVersion: 1, actorRole: actor.role, outcome, errorCode: code, applied: false },
  } }));
  if (error && typeof error === "object") recordedAttempts.add(error);
}

const writes = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const independentlyAudited = new Set(["approval", "recordTransfer", "accountCombine", "historicalAcademics", "tutorHistory"]);
// Credential rejection intentionally commits guessing counters, and a consumed proof
// stays consumed even if a subsequent password conflict occurs. Preserve those boundaries.
const credentialOperations = new Set([
  "account.requestSecondaryEmail", "account.confirmSecondaryEmail", "account.manageSecondaryEmail",
  "account.requestEmailChange", "account.confirmEmailChange", "account.requestPasswordChangeCode",
  "account.changePassword", "account.setTwoFactorEnabled",
]);
// These operations classify applied-state reversal from the current record. SSI
// keeps the authorization read valid until commit if another writer changes it.
const dynamicAuthorityOperations = new Set([
  "interviewManagement.complete", "admin.recordMeetingAttendance", "admin.deleteMeeting",
  "admin.setTuteeStatus", "admin.assignTuteeToTutor", "home.updateNews",
  "admin.updateAnnouncement", "admin.reviewCard",
]);
// Time-slot changes instead use the attendance schedule/target barriers before
// authority reads. ReadCommitted observes attendance committed while awaiting the
// barrier; an earlier Serializable snapshot could hide that newly applied state.
class ResolverFailed extends Error { constructor(readonly result: unknown) { super("Mutation rejected"); } }

/** Wrap exactly once. Existing approval locks/transactions compose via databaseScope; SMTP
 * effects wait for commit. Explicit transaction owners retain their isolation/retry contracts. */
export async function runAuditedMutation<T extends { ok: boolean }>(
  client: DomainDb, actor: AuditActor, operation: string,
  work: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  const credentialOwned = credentialOperations.has(operation);
  const owned = credentialOwned || independentlyAudited.has(operation.split(".")[0]!);
  const currentTransaction = databaseScope.getStore();
  const changes: Prisma.InputJsonObject[] = [];
  const queue = { effects: [] as Array<() => Promise<void>>, committed: false,
    onFailure: async () => {
      // A durable change remains successful even when its external delivery fails.
      await client.auditLog.create({ data: { userId: actor.id, userName: actor.name,
        entity: "EmailDelivery", operation, action: "Email delivery failed after committed change",
        details: { evidenceVersion: 1, actorRole: actor.role, outcome: "DELIVERY_FAILED", changeApplied: true },
      } });
    },
  };
  const cache = new WeakMap<object, object>();
  const capture = { delegate(name: string, delegate: object) {
    const cached = cache.get(delegate); if (cached) return cached;
    const proxy = new Proxy(delegate, { get(target, key) {
      const method = Reflect.get(target, key) as unknown;
      if (typeof method !== "function") return method;
      const invoke = (...args: unknown[]): unknown => Reflect.apply(method, target, args) as unknown;
      if (name === "auditLog" && key === "create") return (input: { data: Row }) => {
        const details = input.data.details;
        return invoke({ ...input, data: { ...input.data,
          approvalId: input.data.approvalId ?? approvalScope.getStore(),
          details: { evidenceVersion: 1, actorRole: input.data.userId == null ? "SYSTEM" : actor.role,
            ...(!details ? { detailAvailability: "Before/after details were not captured by this writer" } : {}),
            outcome: "APPLIED", ...(details && typeof details === "object" ? details : {}) },
        } });
      };
      if ((owned && !credentialOwned) || name === "auditLog" || !writes.has(String(key))) return invoke;
      return (input: Row = {}) => {
        // Prisma's batch transaction form accepts lazy promises. Start interception on
        // consumption too, so constructing [deleteMany(), createMany()] retains ordering.
        let pending: Promise<unknown> | undefined;
        const run = () => pending ??= (async () => {
        if (credentialOwned && !databaseScope.getStore()) {
          // Standalone proof consumption/counter writes get their own atomic evidence,
          // while existing helper transactions remain the owner of grouped writes.
          return inTransaction(client, tx => databaseScope.run(tx, async () => {
            const scoped = scopedDatabase(tx as PrismaClient);
            const inner = Reflect.get(scoped, name) as object;
            return Reflect.apply(Reflect.get(inner, key) as (...args: unknown[]) => unknown, inner, [input]);
          }));
        }
        const finder = Reflect.get(target, "findMany") as ((args: Row) => Promise<unknown[]>) | undefined;
        const unique = Reflect.get(target, "findUnique") as ((args: Row) => Promise<unknown>) | undefined;
        const model = modelEvidence.get(name);
        const selection = model && Object.keys(model.select).length ? { select: model.select } : {};
        const many = String(key).includes("Many");
        // Compound unique selectors are valid for findUnique, never findMany.
        const prior = input.where && !many && unique ? await unique.call(target, { where: input.where, ...selection }) : null;
        // Bulk evidence is complete, not a sample: every affected safe record must
        // remain reviewable even when catalogue/refresh writes exceed fifty rows.
        const before = many && !String(key).startsWith("create") && finder
          ? await finder.call(target, { where: input.where ?? {}, ...selection }) : prior ? [prior] : [];
        const result: unknown = await invoke(input);
        const rows: unknown[] = Array.isArray(result) ? result : result && typeof result === "object" && !("count" in result) ? [result] : [];
        const ids = before.flatMap(row => row && typeof row === "object" && "id" in row && typeof row.id === "string" ? [row.id] : []);
        const identities = before.flatMap(row => {
          if (!row || typeof row !== "object" || !model?.identityFields.length) return [];
          const fields = model.identityFields.map(field => [field, (row as Row)[field]] as const);
          return fields.every(([, value]) => value != null) ? [Object.fromEntries(fields)] : [];
        });
        const lookup = input.where ?? (rows[0] && typeof rows[0] === "object" && "id" in rows[0] ? { id: rows[0].id } : undefined);
        const post = !many && !String(key).startsWith("delete") && unique && lookup ? await unique.call(target, {
          where: lookup, ...selection,
        }) : null;
        const after = String(key).startsWith("delete") ? [] : post ? [post] : rows.length ? rows : (ids.length || identities.length) && finder ? await finder.call(target, { where: ids.length ? { id: { in: ids } } : { OR: identities }, ...selection }) : [];
        const snapshot = (row: unknown) => safeAuditSnapshot(row && typeof row === "object"
          ? { ...row, ...(name === "programFeature" ? { feature: (row as Row).key } : {}),
            ...(name === "language" ? { languageCode: (row as Row).code } : {}) } : row, model?.name);
        const change: Prisma.InputJsonObject = { entity: model?.name ?? name, write: String(key),
          before: before.map(snapshot), after: after.map(snapshot),
          affectedCount: result && typeof result === "object" && "count" in result && typeof result.count === "number" ? result.count : rows.length || 1,
          submittedSafeFields: (Array.isArray(input.data) ? input.data : [input.data]).map(snapshot),
          ...(before.length === 0 && after.length === 0 ? { detailAvailability: "No safe record snapshot available" } : {}),
        };
        changes.push(change);
        if (credentialOwned) {
          const audit = (databaseScope.getStore() ?? client).auditLog;
          await audit.create({ data: {
            userId: actor.id, userName: actor.name, operation, entity: model?.name ?? name,
            action: `Recorded account security state: ${humanizeOperation(operation)}`,
            details: { evidenceVersion: 1, actorRole: actor.role, outcome: "AUTH_STATE_RECORDED", change },
          } });
        }
        return result;
        })();
        return { then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
          catch: (reject: (error: unknown) => unknown) => run().catch(reject),
          finally: (callback: () => void) => run().finally(callback), [Symbol.toStringTag]: "PrismaPromise" };
      };
    } }); cache.set(delegate, proxy); return proxy;
  } };
  const execute = async (tx: TransactionDb) => databaseScope.run(tx, () =>
    auditActorScope.run(actor, () => auditCaptureScope.run(capture, async () => {
      const result = await work(scopedDatabase(tx as PrismaClient));
      if (!result.ok) throw new ResolverFailed(result);
      if (!owned) await tx.auditLog.create({ data: {
        userId: actor.id, userName: actor.name, operation, kind: actionKind(operation),
        action: humanizeOperation(operation), entity: operation.split(".")[0]!, approvalId: approvalScope.getStore(),
        details: { evidenceVersion: 1, actorRole: actor.role, outcome: changes.length ? "APPLIED" : "NO_CHANGE", changes },
      } });
      return result;
    } )));
  let result: T;
  try {
    if (owned) {
      const runOwned = () => auditActorScope.run(actor, () => auditCaptureScope.run(capture, () => work(scopedDatabase(client as PrismaClient))));
      // Credential mail has existing cleanup-on-failure semantics after its own commit.
      // Do not defer it beyond that cleanup boundary.
      result = currentTransaction || credentialOwned ? await runOwned() : await afterCommitScope.run(queue, runOwned);
      if (!result.ok) throw new ResolverFailed(result);
    } else if (currentTransaction) result = await execute(currentTransaction);
    else result = await afterCommitScope.run(queue, () => inTransaction(client, execute,
      dynamicAuthorityOperations.has(operation) ? { isolationLevel: "Serializable" } : undefined));
  } catch (error) {
    // A replay failure belongs to the outer approval attempt, never its rolled-back replay.
    if (!currentTransaction) {
      const failure = error instanceof ResolverFailed ? (error.result as { error?: unknown }).error : error;
      await recordAuditAttempt(client, actor, operation, failure);
    }
    if (error instanceof ResolverFailed) return error.result as T;
    throw error;
  }
  await afterCommitScope.run(queue, flushCommittedEffects);
  return result;
}
