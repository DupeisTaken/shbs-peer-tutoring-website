import { Prisma, $Enums } from "../../../generated/prisma";
import type { DomainDb } from "../transactions";
import { RECORD_PRIMARY_KEYS } from "./record-catalog";

export type RecordKey = Record<string, string | number | boolean>;
export type InspectorAuthority = { userId: string } | { operator: true };
export type OmissionReason = "restricted" | "relation" | "size" | "unsupported";
export type RecordTable = {
  name: string;
  keyFields: string[];
  available: boolean;
  fields: Array<{
    name: string;
    type: string;
    readable: boolean;
    reason?: OmissionReason;
  }>;
};
export type InspectedRecord = {
  key: RecordKey;
  reference: { table: string; key: RecordKey };
  fields: Record<string, unknown>;
  omitted: Array<{ field: string; reason: OmissionReason }>;
};
export type InspectRecordsInput = {
  table: string;
  key?: RecordKey;
  cursor?: string;
  limit?: number;
};
export type InspectedRecords = {
  table: RecordTable;
  rows: InspectedRecord[];
  nextCursor: string | null;
};

export class RecordInspectorError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "RecordInspectorError";
  }
}

/** Positive, model-specific policies: schema additions never become readable by default.
 * In particular, no credential, private message, consent evidence or arbitrary JSON
 * snapshot is selected. Unsupported tables expose schema metadata, never row existence.
 */
const fieldPolicies: Record<string, string> = {
  AuditLog:
    "id userId userName action entity entityId operation kind approvalId undone undoneAt createdAt",
  RecoveryAction: "id kind applicationId createdAt",
  RecoveryEvent: "id actionId transactionId kind createdAt",
  RecoveryTrackedEntity: "actionId entity recordId",
  RecoveryFence: "actionId revision",
  RecoveryChange: "id actionId eventId entity operation createdAt",
  RecoveryReceipt: "id actionId actorId channel createdAt",
  TutorApplication:
    "id identityRevision invalidatedAt invalidatedById invalidatedByName invalidityVersion firstName lastName preferredName alternativeNames type requestedTutorId requestedSubjectId qualificationDecidedById recalledAt recalledById interviewCompletedAt interviewDurationMin interviewSchoolYear interviewQuarter promotedTutorId name email preferredContact contactVerified status interviewAt decidedAt decidedByTutorId createdAt updatedAt",
  RegistrationCode:
    "id kind email tutorId applicationId crewApplicationId label issuedById issuedByName expiresAt emailVerifiedAt usedAt usedByUserId attempts createdAt",
  AccountInvitation:
    "id kind email expiresAt attempts verifiedAt accountId loginUsedAt completedAt completedUserId createdAt",
  ApprovalRequest:
    "id requesterId requesterName operation state reviewerId reviewerName createdAt reviewedAt",
  ViewerSignup:
    "id firstName lastName preferredName alternativeNames email name affiliation attempts verifiedAt usedAt createdAt",
  AccountAppeal: "id userId state decidedByName decidedAt createdAt",
  TutorStatusRequest:
    "id tutorId kind state eligibleAt createdAt resolvedAt resolvedById resolvedByName",
  TuteeRemovalRequest:
    "id tuteeId kind pairingId requestedByTutorId state eligibleAt removedPeriodKey createdAt resolvedAt resolvedById resolvedByName",
  CrewApplication:
    "id firstName lastName preferredName alternativeNames name email gradeLevel preferredContact status decidedByName decidedAt createdAt",
  CrewStatusRequest:
    "id userId kind state eligibleAt createdAt resolvedAt resolvedById resolvedByName",
  ApplicationIdentityOriginal: "applicationId submittedAt",
  ApplicationIdentityCorrection:
    "id applicationId revision actorId actorName approvalId appliedUpdatedAt createdAt",
  DisciplinaryCard:
    "id tuteeId color source reviewStatus reviewedAt reviewedById issuedByTutorId sessionId createdAt updatedAt",
  Announcement:
    "id title pinned active audienceRestricted createdById createdAt",
  AnnouncementAck: "announcementId userId ackedAt",
  StudentSurvey:
    "id invalidatedAt invalidatedById invalidatedByName invalidityVersion email intakeTermId currentVersion submittedAt expiresAt confirmedAt state tuteeId firstAssignedAt verificationDueAt editedAt resolvedAt lastLinkSentAt",
  StudentSignupRevision:
    "id surveyId expectedVersion version actorUserId actorUserName createdAt",
  StudentSignupIntent:
    "id email submittedByUserId accountId surveyId expectedVersion attempts expiresAt receivedAt emailSentAt verifiedAt completedAt completedUserId resultVersion",
  StudentSignupAppeal:
    "id surveyId invalidityVersion actorUserId state createdAt resolvedAt resolvedByUserId",
  StudentSignupNotice:
    "id surveyId invalidityVersion kind recipientEmail accountId state attempts createdAt lastAttemptAt sentAt",
  TuteeRequestInvalidity:
    "tuteeId invalidatedAt invalidatedById invalidatedByName invalidityVersion",
  StudentRequestReview:
    "id surveyId legacyTuteeId legacyIntakeTermId kind requestedByUserId pairingId state createdAt resolvedAt resolvedByUserId",
  StudentQuarterBlock:
    "id email intakeTermId surveyId legacyTuteeId userId createdAt",
  StudentProfileOwnership: "tuteeId userId revision",
  Person:
    "id revision primaryUserId resolutionState mergedIntoId createdAt updatedAt",
  PersonCombineReceipt: "id actorId personId outcome createdAt",
  TutorProfileOwnership: "tutorId userId revision",
  TuteeHistoryInvitation:
    "tuteeId email expectedUpdatedAt issuedById expiresAt createdAt setupCodeExpiresAt setupAttempts setupVerifiedAt setupUserId",
  HistoricalRecordInvitation:
    "scopeKey email recipientId issuedById expiresAt createdAt setupCodeExpiresAt setupAttempts setupVerifiedAt setupUserId claimedAt claimedUserId",
  StudentSettings: "id shareFeedbackWithTutors",
  StudentAppeal: "id studentId cardId state decidedById createdAt updatedAt",
  TranslationDraft:
    "id authorId operation state reviewedById createdAt updatedAt",
  AcademicConfirmation:
    "id userId status gradeLevel rawGrade schoolYear confirmedAt actorId source",
  HistoricalAcademicRecord:
    "id tutorId tuteeId rawGrade academicallyGraduated schoolYear source originalConfirmedAt recordedAt",
  HistoricalAcademicCorrection:
    "id recordId revision rawGrade schoolYear actorId actorName approvalId method correctedAt",
  User: "id personId studentId name firstName lastName preferredName legacyName alternativeNames profileVersion email username mergedIntoId recoveryVoidedAt role tuteeMember tutorAccessRevoked canTranslate crewStatus gradeLevel suspendedAt tutorId createdAt updatedAt",
  Language: "code name nativeName enabled order createdAt updatedAt",
  ProgramFeature: "key enabled updatedAt",
  SubjectLevel: "id name order active createdAt updatedAt",
  Term: "id name schoolYear quarter startDate endDate active scheduleConfirmed tutorSignupOpen tuteeSignupOpen createdAt updatedAt",
  NextRecruitmentPreparation:
    "sourceTermId audience targetTermId createdAt updatedAt",
  Tutor:
    "id personId username name englishName chineseName firstName lastName preferredName alternativeNames email grade gradeLevel classYear status canTutor createdAt updatedAt",
  CourseGroup: "id name active order createdAt updatedAt",
  Subject: "id name levelId courseGroupId active order createdAt updatedAt",
  TutorSubjectWillingness: "tutorId subjectId willing updatedAt",
  Tutee:
    "id name firstName lastName preferredName alternativeNames email grade gradeLevel classYear status subjectId termId createdAt updatedAt",
  TimeSlot: "id termId dayOfWeek startMin endMin active createdAt updatedAt",
  TutorAvailability: "tutorId slotId",
  TuteeAvailability: "tuteeId slotId",
  Room: "id name capacity active order programOrder createdAt updatedAt",
  RoomUnavailability: "id roomId date startMin endMin createdAt updatedAt",
  Pairing:
    "id tutorId tuteeId subjectId timeSlotId roomId termId groupId status active createdAt updatedAt roomVersion roomMode roomNeedsAssignment",
  PairingGroup:
    "id termId subjectId timeSlotId tutorId roomId createdAt updatedAt",
  PairingTutee: "pairingId tuteeId createdAt",
  Session:
    "id pairingId tutorId date status roomId actualRoomId timeSlotId durationMin shFactor shCount attendanceConfirmed createdAt updatedAt",
  SessionTutee:
    "sessionId tuteeId status ratingPreparedness ratingParticipation createdAt updatedAt",
  TutorMeeting:
    "id title date startMin endMin durationMin termId createdAt updatedAt",
  MeetingAttendance:
    "id meetingId tutorId status hours excusedAt createdAt updatedAt",
  ServiceHourAdjustment:
    "id tutorId amount hours termId createdById createdAt updatedAt",
  Patrol: "id crewUserId date observedAt createdAt updatedAt",
  PatrolCreditWindow:
    "crewUserId windowStart patrolId creditAwardedAt createdAt",
  PatrolObservation:
    "id patrolId roomId sessionId headcount expected observed createdAt updatedAt",
  SessionFlag:
    "id sessionId observationId patrolId status type resolvedAt resolvedById createdAt updatedAt",
  ApplicationSubjectIntent:
    "id applicationId subjectId willing createdAt updatedAt",
  InterviewAssignment: "applicationId tutorId createdAt",
  InterviewVote: "applicationId tutorId vote createdAt updatedAt",
  TutorQualification: "tutorId subjectId createdAt updatedAt",
  QualificationGrant:
    "tutorId sourceSubjectId subjectId applicationId createdAt updatedAt",
  SchoolCalendarDay: "date schoolYear quarter isSchoolDay createdAt updatedAt",
  ProgramCalendarDay: "date active createdAt updatedAt",
  ProgramSettings:
    "id timeZone requireLatinNames requireLatinLegalNames usePreferredNames showAlternateNames currentTermId createdAt updatedAt",
  AcademicProfile: "userId gradeLevel classYear version updatedAt",
  SchoolDeparture: "userId confirmedAt confirmedById createdAt updatedAt",
  MessageOverride: "id locale key value status createdAt updatedAt",
  HomeContent: "key locale value updatedAt",
  NewsPost: "id title slug publishedAt active createdAt updatedAt",
  NewsTranslation: "id newsPostId locale title body createdAt updatedAt",
  HomeImage: "id url alt order active createdAt updatedAt",
  LandingSection: "id key type order active createdAt updatedAt",
  LandingSectionTranslation:
    "id sectionId locale title body createdAt updatedAt",
  CustomPage: "id slug title body published active createdAt updatedAt",
};

const models = Prisma.dmmf.datamodel.models;
// Prisma 7's runtime datamodel strips both primary-key flags and enum definitions.
// Generated enum exports retain Prisma's value names and declaration order.
const enumValues: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    Object.entries($Enums as Record<string, Record<string, string>>).map(
      ([name, values]) => [name, Object.values(values)],
    ),
  );
function modelFor(name: string) {
  const model = models.find((candidate) => candidate.name === name);
  if (!model) throw new RecordInspectorError("BAD_REQUEST", "Unknown table.");
  return model;
}
type Model = ReturnType<typeof modelFor>;
function primaryFields(model: Model) {
  return [...(RECORD_PRIMARY_KEYS[model.name] ?? [])];
}
function metadata(model: Model): RecordTable {
  const allowed = new Set((fieldPolicies[model.name] ?? "").split(" "));
  const keyFields = primaryFields(model);
  // Even a single unsafe identity disables browsing, filtering and pagination.
  const available =
    keyFields.length > 0 && keyFields.every((key) => allowed.has(key));
  return {
    name: model.name,
    keyFields,
    available,
    fields: model.fields.map((field) => {
      const readable =
        available &&
        field.kind !== "object" &&
        field.type !== "Json" &&
        allowed.has(field.name);
      return {
        name: field.name,
        type: field.type,
        readable,
        ...(!readable
          ? {
              reason:
                field.kind === "object"
                  ? ("relation" as const)
                  : available
                    ? ("restricted" as const)
                    : ("unsupported" as const),
            }
          : {}),
      };
    }),
  };
}

/** The caller supplies identity, never a session role. Each request rechecks the
 * persisted account; a retired, suspended or demoted account loses access immediately.
 * Operator authority is only constructed by the trusted host CLI, never HTTP input.
 */
async function authorize(db: DomainDb, authority: InspectorAuthority) {
  if ("operator" in authority && authority.operator === true) return;
  if (!("userId" in authority))
    throw new RecordInspectorError(
      "FORBIDDEN",
      "Administrator access required.",
    );
  // SchoolDeparture retires participation, not an independently retained staff role.
  // mergedIntoId is the permanent login-retirement marker used by authentication.
  const account = await db.user.findUnique({
    where: { id: authority.userId },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (
    !account ||
    account.suspendedAt ||
    account.mergedIntoId ||
    account.recoveryVoidedAt ||
    !["ADMIN", "HEAD"].includes(account.role)
  ) {
    throw new RecordInspectorError(
      "FORBIDDEN",
      "Administrator access required.",
    );
  }
}

export async function listRecordTables(
  db: DomainDb,
  authority: InspectorAuthority,
): Promise<RecordTable[]> {
  await authorize(db, authority);
  return models.map(metadata).sort((a, b) => a.name.localeCompare(b.name));
}

function validatedKey(
  model: Model,
  input: unknown,
): { persisted: Record<string, unknown>; key: RecordKey } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new RecordInspectorError(
      "BAD_REQUEST",
      "An exact primary key object is required.",
    );
  const value = input as Record<string, unknown>;
  const keys = primaryFields(model);
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new RecordInspectorError(
      "BAD_REQUEST",
      "Supply every primary key field and no other fields.",
    );
  const persisted: Record<string, unknown> = {};
  const key: RecordKey = {};
  for (const name of keys) {
    const field = model.fields.find((candidate) => candidate.name === name)!;
    const item = value[name];
    const valid =
      field.type === "Int" || field.type === "Float"
        ? typeof item === "number" &&
          Number.isFinite(item) &&
          (field.type !== "Int" || Number.isInteger(item))
        : field.type === "Boolean"
          ? typeof item === "boolean"
          : typeof item === "string" && item.length > 0 && item.length <= 1024;
    if (!valid)
      throw new RecordInspectorError(
        "BAD_REQUEST",
        "Invalid primary key value.",
      );
    if (
      field.kind === "enum" &&
      !enumValues[field.type]?.includes(item as string)
    )
      throw new RecordInspectorError(
        "BAD_REQUEST",
        "Invalid enum primary key value.",
      );
    key[name] = item as string | number | boolean;
    if (field.type === "BigInt") {
      if (
        !/^-?(0|[1-9]\d*)$/.test(item as string) ||
        (item as string).length > 20
      )
        throw new RecordInspectorError(
          "BAD_REQUEST",
          "BigInt keys require a decimal string.",
        );
      persisted[name] = BigInt(item as string);
      if (
        (persisted[name] as bigint) < -9223372036854775808n ||
        (persisted[name] as bigint) > 9223372036854775807n
      )
        throw new RecordInspectorError(
          "BAD_REQUEST",
          "BigInt key is outside the persisted range.",
        );
    } else if (field.type === "DateTime") {
      const date = new Date(item as string);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== item)
        throw new RecordInspectorError(
          "BAD_REQUEST",
          "Date keys require an ISO timestamp.",
        );
      persisted[name] = date;
    } else persisted[name] = item;
  }
  return { persisted, key };
}

/** Read only through trusted generated model/field metadata and bound Prisma values.
 * Lexicographic primary-key pagination also handles compound keys without offsets.
 * This module intentionally has no Next, env, auth, shared db or domain-runtime imports.
 */
export async function inspectRecords(
  db: DomainDb,
  authority: InspectorAuthority,
  input: InspectRecordsInput,
): Promise<InspectedRecords> {
  await authorize(db, authority);
  const model = modelFor(input.table);
  const table = metadata(model);
  if (!table.available)
    throw new RecordInspectorError(
      "FORBIDDEN",
      "This table exposes metadata only; no approved row policy is available.",
    );
  const limit = input.limit ?? 25;
  const maxLimit =
    "operator" in authority && authority.operator === true ? 100 : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit)
    throw new RecordInspectorError(
      "BAD_REQUEST",
      `Page size must be between 1 and ${maxLimit}.`,
    );
  let where: Record<string, unknown> = {};
  if (input.key !== undefined) where = validatedKey(model, input.key).persisted;
  if (input.cursor) {
    if (input.key || input.cursor.length > 8192)
      throw new RecordInspectorError("BAD_REQUEST", "Invalid cursor.");
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      );
    } catch {
      throw new RecordInspectorError("BAD_REQUEST", "Invalid cursor.");
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("table" in decoded) ||
      decoded.table !== model.name ||
      !("key" in decoded)
    )
      throw new RecordInspectorError("BAD_REQUEST", "Invalid cursor.");
    const after = validatedKey(model, decoded.key).persisted;
    where = {
      OR: table.keyFields.flatMap((name, index) => {
        const field = model.fields.find(
          (candidate) => candidate.name === name,
        )!;
        let comparison: unknown = { gt: after[name] };
        // Prisma enum/boolean filters do not provide `gt`. Their finite domain
        // supplies the next values while preserving the database's enum order.
        if (field.kind === "enum") {
          const values = enumValues[field.type]!;
          const remaining = values.slice(
            values.indexOf(after[name] as string) + 1,
          );
          if (!remaining.length) return [];
          comparison = { in: remaining };
        } else if (field.type === "Boolean") {
          if (after[name] === true) return [];
          comparison = true;
        }
        return [
          {
            ...Object.fromEntries(
              table.keyFields.slice(0, index).map((key) => [key, after[key]]),
            ),
            [name]: comparison,
          },
        ];
      }),
    };
  }
  const selected = table.fields.filter((field) => field.readable);
  const delegateName = model.name[0]!.toLowerCase() + model.name.slice(1);
  const delegate = (
    db as unknown as Record<
      string,
      { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
    >
  )[delegateName];
  if (!delegate)
    throw new RecordInspectorError("BAD_REQUEST", "Table is unavailable.");
  const results = await delegate.findMany({
    where,
    select: Object.fromEntries(selected.map((field) => [field.name, true])),
    orderBy: table.keyFields.map((field) => ({ [field]: "asc" })),
    take: limit + 1,
  });
  const rows = results.slice(0, limit).map((result): InspectedRecord => {
    const fields: Record<string, unknown> = {};
    const omitted = table.fields
      .filter((field) => !field.readable)
      .map((field) => ({ field: field.name, reason: field.reason! }));
    for (const field of selected) {
      const value = result[field.name];
      if (
        typeof value === "string" &&
        value.length > 32768 &&
        !table.keyFields.includes(field.name)
      )
        omitted.push({ field: field.name, reason: "size" });
      else
        fields[field.name] =
          value instanceof Date
            ? value.toISOString()
            : typeof value === "bigint"
              ? value.toString()
              : value;
    }
    const key = Object.fromEntries(
      table.keyFields.map((name) => [name, fields[name]]),
    ) as RecordKey;
    return { key, reference: { table: model.name, key }, fields, omitted };
  });
  const last = rows.at(-1);
  return {
    table,
    rows,
    nextCursor:
      results.length > limit && last
        ? Buffer.from(JSON.stringify(last.reference)).toString("base64url")
        : null,
  };
}
