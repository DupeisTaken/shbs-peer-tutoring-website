import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

/** Explicit allowlist of CSV-importable domain tables that can hold
 * ImportedRecordProvenance (excludes reference-only User). */
export const PROVENANCE_RECORD_TABLES = [
  "SubjectLevel",
  "CourseGroup",
  "Subject",
  "Term",
  "Tutor",
  "Tutee",
  "TuteeRequestInvalidity",
  "HistoricalAcademicRecord",
  "Room",
  "TimeSlot",
  "RoomUnavailability",
  "TutorAvailability",
  "TuteeAvailability",
  "TutorSubjectWillingness",
  "PairingGroup",
  "Pairing",
  "PairingTutee",
  "Session",
  "SessionTutee",
  "TutorMeeting",
  "MeetingAttendance",
  "ServiceHourAdjustment",
  "TutorApplication",
  "ApplicationSubjectIntent",
  "InterviewAssignment",
  "InterviewVote",
  "TutorStatusRequest",
  "TuteeRemovalRequest",
  "CrewApplication",
  "CrewStatusRequest",
  "Patrol",
  "PatrolObservation",
  "PatrolCreditWindow",
  "SessionFlag",
  "DisciplinaryCard",
  "StudentSurvey",
  "StudentSignupRevision",
  "StudentSignupAppeal",
  "StudentRequestReview",
  "StudentQuarterBlock",
  "LegacySignupDecline",
  "StudentProfileOwnership",
  "PolicyAcceptance",
  "StudentFeedback",
  "StudentAppeal",
  "TutorQualification",
  "QualificationGrant",
  "AcademicProfile",
  "AcademicConfirmation",
  "SchoolCalendarDay",
  "Announcement",
  "AnnouncementAck",
] as const;

export type ProvenanceRecordTable = (typeof PROVENANCE_RECORD_TABLES)[number];

export type ProvenanceKey = Record<string, string | number | boolean>;

export type ProvenanceKeyKind = "SCALAR_ID" | "SINGLE_KEY" | "COMPOSITE_KEY";

export type ProvenanceRecoveryReference = {
  entity: string;
  recordId: string;
};

const provenanceTableSet = new Set<string>(PROVENANCE_RECORD_TABLES);

export function isProvenanceRecordTable(
  entity: string,
): entity is ProvenanceRecordTable {
  return provenanceTableSet.has(entity);
}

export function provenanceKeyKind(keys: readonly string[]): ProvenanceKeyKind {
  if (keys.length === 1 && keys[0] === "id") return "SCALAR_ID";
  if (keys.length === 1) return "SINGLE_KEY";
  return "COMPOSITE_KEY";
}

/** Stable local provenance identity, preserving scalar ID compatibility and
 * canonical field order/types for composite keys. Only primary keys are stored. */
export function importedRecordKey(
  row: Record<string, unknown>,
  keys: readonly string[],
) {
  if (keys.length === 1 && keys[0] === "id") return String(row.id);
  return JSON.stringify(
    [...keys]
      .sort()
      .map((key) => [
        key,
        row[key] instanceof Date ? row[key].toISOString() : row[key],
      ]),
  );
}

/** Validate and normalize an explicit primary key object against its expected
 * primary-key fields, returning both the typed key and canonical recordId. */
export function normalizeProvenanceKey(
  key: Record<string, unknown>,
  expectedFields: readonly string[],
  dateFields: ReadonlySet<string> = new Set(),
): { key: ProvenanceKey; recordId: string; keyKind: ProvenanceKeyKind } {
  const actual = Object.keys(key).sort();
  const expected = [...expectedFields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error("PROVENANCE_KEY_FIELDS_MISMATCH");
  }
  const normalized: ProvenanceKey = {};
  for (const field of expected) {
    const value = key[field];
    if (dateFields.has(field)) {
      if (value instanceof Date) {
        if (!Number.isFinite(value.getTime()))
          throw new Error("INVALID_PROVENANCE_KEY_VALUE");
        normalized[field] = value.toISOString();
      } else if (typeof value === "string" && value.length > 0) {
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime()))
          throw new Error("INVALID_PROVENANCE_KEY_VALUE");
        normalized[field] = parsed.toISOString();
      } else {
        throw new Error("INVALID_PROVENANCE_KEY_VALUE");
      }
      continue;
    }
    if (typeof value === "string") {
      if (value.length === 0 || value.length > 512)
        throw new Error("INVALID_PROVENANCE_KEY_VALUE");
      normalized[field] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      normalized[field] = value;
    } else if (typeof value === "boolean") {
      normalized[field] = value;
    } else {
      throw new Error("INVALID_PROVENANCE_KEY_VALUE");
    }
  }
  return {
    key: normalized,
    recordId: importedRecordKey(normalized, expectedFields),
    keyKind: provenanceKeyKind(expectedFields),
  };
}

/** Parse a persisted ImportedRecordProvenance.recordId back into a typed key
 * object when given the model's explicit primary-key fields. */
export function parseImportedRecordKey(
  recordId: string,
  expectedFields: readonly string[],
  dateFields: ReadonlySet<string> = new Set(),
): ProvenanceKey {
  if (expectedFields.length === 1 && expectedFields[0] === "id") {
    return normalizeProvenanceKey({ id: recordId }, expectedFields, dateFields)
      .key;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordId);
  } catch {
    throw new Error("INVALID_PROVENANCE_KEY_VALUE");
  }
  if (!Array.isArray(parsed)) throw new Error("INVALID_PROVENANCE_KEY_VALUE");
  const key: Record<string, unknown> = {};
  for (const pair of parsed) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string"
    ) {
      throw new Error("INVALID_PROVENANCE_KEY_VALUE");
    }
    key[pair[0]] = pair[1];
  }
  const normalized = normalizeProvenanceKey(key, expectedFields, dateFields);
  if (normalized.recordId !== recordId)
    throw new Error("NON_CANONICAL_PROVENANCE_KEY");
  return normalized.key;
}

/** Derive typed recovery references directly from an entity + normalized primary
 * key, mirroring SQL `imported_provenance_references` before DB parent lookups. */
export function directProvenanceRecoveryReferences(
  entity: ProvenanceRecordTable,
  key: ProvenanceKey,
  recordId: string,
): ProvenanceRecoveryReference[] {
  const refs: ProvenanceRecoveryReference[] = [];
  const seen = new Set<string>();
  const add = (targetEntity: string, targetRecordId: unknown) => {
    if (typeof targetRecordId !== "string" || !targetRecordId) return;
    const token = `${targetEntity}\0${targetRecordId}`;
    if (seen.has(token)) return;
    seen.add(token);
    refs.push({ entity: targetEntity, recordId: targetRecordId });
  };
  add("ImportedRecordProvenance", JSON.stringify({ entity, recordId }));
  if (typeof key.id === "string") {
    add(entity, key.id);
    if (entity === "ServiceHourAdjustment" && key.id.startsWith("flag:")) {
      add("SessionFlag", key.id.slice(5));
    }
    return refs;
  }
  switch (entity) {
    case "SessionTutee":
      add("Session", key.sessionId);
      add("Tutee", key.tuteeId);
      break;
    case "PairingTutee":
      add("Pairing", key.pairingId);
      add("Tutee", key.tuteeId);
      break;
    case "InterviewAssignment":
    case "InterviewVote":
      add("TutorApplication", key.applicationId);
      add("Tutor", key.tutorId);
      break;
    case "TutorAvailability":
      add("Tutor", key.tutorId);
      add("TimeSlot", key.slotId);
      break;
    case "TuteeAvailability":
      add("Tutee", key.tuteeId);
      add("TimeSlot", key.slotId);
      break;
    case "TutorSubjectWillingness":
    case "TutorQualification":
      add("Tutor", key.tutorId);
      add("Subject", key.subjectId);
      break;
    case "QualificationGrant":
      add("Tutor", key.tutorId);
      add("Subject", key.sourceSubjectId);
      add("Subject", key.subjectId);
      break;
    case "PatrolCreditWindow":
      add("User", key.crewUserId);
      break;
    case "AnnouncementAck":
      add("Announcement", key.announcementId);
      add("User", key.userId);
      break;
    case "TuteeRequestInvalidity":
    case "LegacySignupDecline":
    case "StudentProfileOwnership":
      add(entity, key.tuteeId);
      add("Tutee", key.tuteeId);
      break;
    case "AcademicProfile":
      add(entity, key.userId);
      add("User", key.userId);
      break;
    case "SchoolCalendarDay":
      add(entity, key.date);
      break;
  }
  return refs;
}

/** Native management mutations never rewrite archive evidence as a side effect.
 * A separate reviewed archive correction/recovery is required for those rows. */
export async function assertMutableProgramRecords(
  tx: Pick<TransactionDb, "importedRecordProvenance">,
  records: { entity: string; recordId: string }[],
) {
  if (!records.length) return;
  const imported = await tx.importedRecordProvenance.findFirst({
    where: { OR: records },
    select: { entity: true },
  });
  if (imported)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This action includes imported historical evidence. Its recorded source values are preserved. Use an operator-reviewed archive recovery to correct or remove it.",
    });
}

export async function isImportedProgramRecord(
  tx: Pick<TransactionDb, "importedRecordProvenance">,
  entity: string,
  recordId: string,
) {
  return !!(await tx.importedRecordProvenance.findUnique({
    where: { entity_recordId: { entity, recordId } },
    select: { recordId: true },
  }));
}
