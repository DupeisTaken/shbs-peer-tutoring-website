/** Operator-only reviewed archive provenance reconciliation workflow.
 * Never imports Next, environment loading, or shared application DB singletons. */
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma";
import {
  decodeRecordCell,
  parseRecordCsv,
  TRANSFER_MAX_BYTES,
  TRANSFER_MAX_ROWS,
  type TransferFile,
} from "~/lib/record-transfer";
import { readRecordArchive } from "~/lib/record-transfer-archive";
import { lockAccountProfile } from "~/server/account-profile-lock";
import { lockAttendanceSchedule } from "~/server/attendance-schedule-lock";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import {
  directProvenanceRecoveryReferences,
  isProvenanceRecordTable,
  normalizeProvenanceKey,
  type ProvenanceKey,
  type ProvenanceKeyKind,
  type ProvenanceRecordTable,
  type ProvenanceRecoveryReference,
} from "~/server/imported-records";
import { historicalImportError } from "~/server/record-transfer-boundary";
import { lockImportedSessionSources } from "~/server/record-transfer-session-lock";
import { lockApplicationReview } from "~/server/request-review";
import {
  schoolHoursCarrySchema,
  schoolHoursComponentsSchema,
  type SchoolHoursComponents,
} from "~/server/school-hours-input";
import {
  quantizeSchoolHours,
  sumSchoolHoursCarry,
} from "~/server/school-hours-posting";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { OperatorError, operatorAssert } from "./operator-cli";
import { canonicalJson, planHash } from "./operator-plan";
import { RECORD_PRIMARY_KEYS } from "./record-catalog";

const MAX_CANDIDATES = 2_000;
const SCHOOL_HOURS_LOCK = "school-hours-chain";
const SCHOOL_HOURS_KEYS = ["earned", "extras", "deductions", "crew"] as const;

const DATE_KEY_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  PatrolCreditWindow: new Set(["windowStart"]),
};

const REFERENCE_CONFIGURATION_TABLES = new Set<string>([
  "SubjectLevel",
  "CourseGroup",
  "Subject",
  "Term",
  "Room",
  "TimeSlot",
  "RoomUnavailability",
  "SchoolCalendarDay",
]);

const FINANCIAL_TABLES = new Set<string>([
  "Session",
  "ServiceHourAdjustment",
  "Patrol",
]);

const SAFE_SUMMARY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Session: [
    "id",
    "tutorId",
    "pairingId",
    "mergeGroupId",
    "timeSlotId",
    "date",
    "startMin",
    "endMin",
    "durationMin",
    "shCount",
    "shFactor",
    "tutorStatus",
    "online",
  ],
  SessionTutee: ["sessionId", "tuteeId", "status", "createdAt"],
  ServiceHourAdjustment: [
    "id",
    "tutorId",
    "type",
    "amount",
    "month",
    "schoolYear",
    "quarter",
    "createdById",
    "createdAt",
  ],
  Patrol: ["id", "crewUserId", "hours", "creditAwardedAt", "createdAt"],
  PatrolObservation: ["id", "patrolId", "roomId", "headcount", "observedAt"],
  PatrolCreditWindow: [
    "crewUserId",
    "windowStart",
    "patrolId",
    "creditAwardedAt",
  ],
  SessionFlag: ["id", "sessionId", "tutorId", "expected", "observed", "state", "createdAt"],
  TutorMeeting: ["id", "date", "termId", "createdAt"],
  MeetingAttendance: ["id", "meetingId", "tutorId", "status", "excusedAt"],
  TutorApplication: [
    "id",
    "type",
    "status",
    "promotedTutorId",
    "requestedTutorId",
    "interviewCompletedAt",
    "createdAt",
  ],
  ApplicationSubjectIntent: ["id", "applicationId", "subjectId", "taken"],
  InterviewAssignment: ["applicationId", "tutorId", "isHead", "attended"],
  InterviewVote: ["applicationId", "tutorId", "accept", "createdAt"],
  Tutor: ["id", "status", "personId", "createdAt"],
  Tutee: ["id", "status", "termId", "personId", "createdAt"],
  TuteeRemovalRequest: [
    "id",
    "tuteeId",
    "pairingId",
    "kind",
    "state",
    "createdAt",
  ],
  DisciplinaryCard: [
    "id",
    "tuteeId",
    "sessionId",
    "color",
    "source",
    "reviewStatus",
    "createdAt",
  ],
  Pairing: ["id", "tutorId", "termId", "timeSlotId", "roomId", "groupId"],
  PairingGroup: ["id", "termId", "tutorId", "primaryPairingId"],
  PairingTutee: ["pairingId", "tuteeId"],
  Term: ["id", "schoolYear", "quarter", "active", "startDate", "endDate"],
  TimeSlot: ["id", "label", "dayOfWeek", "startMin", "endMin", "active"],
  Subject: ["id", "name", "levelId", "groupId", "active"],
  CourseGroup: ["id", "name", "rank"],
  SubjectLevel: ["id", "name", "rank"],
  Room: ["id", "name"],
  RoomUnavailability: ["id", "roomId", "date", "startMin", "endMin"],
  SchoolCalendarDay: ["date", "schoolYear", "quarter", "isSchoolDay"],
  TutorQualification: ["tutorId", "subjectId", "status"],
  QualificationGrant: ["tutorId", "sourceSubjectId", "subjectId", "grantedAt"],
  Announcement: ["id", "active", "pinned", "createdAt"],
  AnnouncementAck: ["announcementId", "userId", "ackedAt"],
};

const dmmfModels = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(
      model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => [field.name, field]),
    ),
  ]),
);

const scalarValueSchema = z.union([
  z.string().min(1).max(512),
  z.number().finite(),
  z.boolean(),
]);

export const provenanceActionSchema = z.enum([
  "MARK_IMPORTED",
  "RELEASE_IMPORTED",
]);
export type ProvenanceAction = z.infer<typeof provenanceActionSchema>;

export const provenanceCandidateSchema = z
  .object({
    entity: z.string().min(1).max(100),
    key: z.record(z.string().min(1).max(100), scalarValueSchema),
    action: provenanceActionSchema.default("MARK_IMPORTED"),
    expectedColumnNames: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/))
      .min(1)
      .max(200)
      .optional(),
    expectedRowHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (
      (item.expectedColumnNames && !item.expectedRowHash) ||
      (!item.expectedColumnNames && item.expectedRowHash)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "expectedColumnNames and expectedRowHash must be provided together.",
      });
    }
  });

export const provenanceCandidateFileSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("archive-provenance-candidates"),
    evidenceLabel: z.string().trim().min(1).max(200),
    sourceRevision: z.string().trim().min(1).max(120).optional(),
    extractedFrom: z
      .object({
        format: z.enum(["zip", "csv"]),
        fileCount: z.number().int().positive(),
        skippedTables: z.array(z.string().max(100)).max(20),
      })
      .strict()
      .optional(),
    candidates: z.array(provenanceCandidateSchema).min(1).max(MAX_CANDIDATES),
  })
  .strict();

export type ProvenanceCandidateFile = z.infer<
  typeof provenanceCandidateFileSchema
>;

export type ProvenanceBlocker = {
  code: string;
  message: string;
};

export type SchoolHoursOverlap = {
  stage: "OPENING" | "COMMITTED";
  sourceKey: string;
  entity: "Session" | "ServiceHourAdjustment" | "Patrol";
  recordId: string;
  beneficiaryId: string;
  anchoredOwnerKind: "user" | "tutor";
  anchoredOwnerId: string;
  anchoredComponent: (typeof SCHOOL_HOURS_KEYS)[number];
  anchoredAmount: number;
  currentAmount: number | null;
  currentBeneficiaryId: string | null;
  headReportId: string | null;
};

export type ProvenanceCandidatePreview = {
  entity: ProvenanceRecordTable;
  keyKind: ProvenanceKeyKind;
  key: ProvenanceKey;
  recordId: string;
  requestedAction: ProvenanceAction;
  proposedAction: ProvenanceAction | "NO_OP";
  exists: boolean;
  currentProvenance: {
    marked: boolean;
    importedAt: string | null;
  };
  currentRowHash: string | null;
  safeSummary: Record<string, unknown> | null;
  importValueMatch:
    | "EXACT_MATCH"
    | "VALUE_MISMATCH"
    | "NO_IMPORT_HASH_PROVIDED"
    | "ROW_MISSING";
  classificationKind:
    | "EXACT_HISTORICAL_IMPORT"
    | "NATIVE_LATE_CORRECTION_OR_LIVE"
    | "CURRENT_REFERENCE_CONFIGURATION"
    | "MISSING_RECORD";
  nativeSignals: string[];
  recoveryReferences: ProvenanceRecoveryReference[];
  trackedRecoveryActionIds: string[];
  automationEffects: string[];
  warnings: string[];
  blockers: ProvenanceBlocker[];
};

export type ArchiveProvenancePreview = {
  version: 1;
  evidenceLabel: string;
  sourceRevision: string | null;
  schemaRevision: {
    latestMigration: string | null;
    appliedMigrationCount: number;
  };
  coverage: {
    replicationMode: string;
    provenanceTriggerOk: boolean;
    receiptTriggerOk: boolean;
    receiptImmutableOk: boolean;
  };
  summary: {
    totalCandidates: number;
    markCount: number;
    releaseCount: number;
    noOpCount: number;
    blockedCount: number;
    trackedRecoveryRootCount: number;
  };
  schoolHours: {
    headReportId: string | null;
    baselineVersion: number;
    scheduleEnabled: boolean;
    beforeContentHash: string;
    afterContentHash: string;
    beforeBlockers: Array<{
      code: string;
      beneficiaryId?: string;
      message: string;
    }>;
    afterBlockers: Array<{
      code: string;
      beneficiaryId?: string;
      message: string;
    }>;
    overlaps: SchoolHoursOverlap[];
    beneficiaryImpacts: Array<{
      beneficiaryId: string;
      reviewed: boolean;
      before: SchoolHoursComponents;
      after: SchoolHoursComponents;
      alreadyReported: SchoolHoursComponents | null;
      beforeRawChange: number | null;
      afterRawChange: number | null;
      beforeHoursToAdd: number | null;
      afterHoursToAdd: number | null;
    }>;
  };
  blockers: ProvenanceBlocker[];
  applicable: boolean;
  fingerprint: string;
  candidates: ProvenanceCandidatePreview[];
};

const schoolSourceSchema = z.object({
  key: z.string(),
  beneficiaryId: z.string(),
  component: z.enum(SCHOOL_HOURS_KEYS),
  value: z.number().finite().nonnegative(),
  ownerKind: z.enum(["user", "tutor"]),
  ownerId: z.string(),
});
const schoolPersonSchema = z.object({
  beneficiaryId: z.string(),
  schoolAccountKey: z.string(),
  components: schoolHoursComponentsSchema,
  carryHours: schoolHoursCarrySchema.default("0"),
  provenanceUserIds: z.array(z.string()),
  provenanceTutorIds: z.array(z.string()),
});
const schoolBaselineSchema = z.object({
  people: z.array(schoolPersonSchema),
  sources: z.array(schoolSourceSchema),
  consumedOpeningIds: z.array(z.string()).optional(),
});
type SchoolBaseline = z.infer<typeof schoolBaselineSchema>;
type SchoolPerson = z.infer<typeof schoolPersonSchema>;
type SchoolBlocker = { code: string; beneficiaryId?: string; message: string };

const emptyBaseline = (): SchoolBaseline => ({ people: [], sources: [] });
const parseBaseline = (value: unknown): SchoolBaseline =>
  value == null ? emptyBaseline() : schoolBaselineSchema.parse(value);
const zeroComponents = (): SchoolHoursComponents => ({
  earned: 0,
  extras: 0,
  deductions: 0,
  crew: 0,
});
const sumDec = (...values: number[]) =>
  values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toNumber();
const minusDec = (left: number, right: number) =>
  new Prisma.Decimal(left).minus(right).toNumber();
const sha256 = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

function quoteIdent(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Normalize a scalar/list/JSON field value identically for offline CSV rows
 * and live PostgreSQL rows so exact-value hashes match without leaking PII. */
export function canonicalFieldValue(
  entity: string,
  fieldName: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;
  const model = dmmfModels.get(entity);
  const field = model?.get(fieldName);
  if (!field) return value;
  if (field.isList) {
    let list: unknown[];
    if (Array.isArray(value)) list = value;
    else if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        list = Array.isArray(parsed) ? parsed : [value];
      } catch {
        list = [value];
      }
    } else list = [value];
    return list.map((item) =>
      canonicalScalarValue(field.type, item),
    );
  }
  return canonicalScalarValue(field.type, value);
}

function scalarString(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return canonicalJson(value);
}

function canonicalScalarValue(type: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "Boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "t") return true;
      if (value === "false" || value === "f") return false;
      return Boolean(value);
    case "Int":
    case "BigInt": {
      const text = scalarString(value);
      const n = typeof value === "number" ? value : Number(text);
      return Number.isFinite(n) ? Math.trunc(n) : text;
    }
    case "Float":
    case "Decimal": {
      const text = scalarString(value);
      try {
        return new Prisma.Decimal(text).toString();
      } catch {
        return text;
      }
    }
    case "DateTime": {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "string") {
        // PostgreSQL to_jsonb(timestamp) emits ISO without trailing Z (UTC session).
        const normalized =
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
            ? `${value}Z`
            : value;
        const date = new Date(normalized);
        return Number.isFinite(date.getTime()) ? date.toISOString() : value;
      }
      return scalarString(value);
    }
    case "Json": {
      if (typeof value === "string") {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }
      return value;
    }
    default:
      return scalarString(value);
  }
}

export function computeSelectedColumnsHash(
  entity: string,
  row: Record<string, unknown>,
  columnNames: readonly string[],
): string {
  const sorted = [...columnNames].sort();
  return planHash(
    sorted.map((col) => [col, canonicalFieldValue(entity, col, row[col])]),
  );
}

/** Offline extraction of explicit candidate keys + privacy-preserving row hashes
 * from original Program Records CSV/ZIP import files. Never queries a database
 * and never infers origin from names, dates, status, totals, or emails. */
export function extractProvenanceCandidatesFromFiles(
  files: readonly TransferFile[],
  options: {
    format: "zip" | "csv";
    evidenceLabel: string;
    sourceRevision?: string;
  },
): ProvenanceCandidateFile {
  const label = options.evidenceLabel.trim();
  operatorAssert(label.length > 0 && label.length <= 200, "INVALID_EVIDENCE_LABEL");
  const candidates: ProvenanceCandidateFile["candidates"] = [];
  const seen = new Set<string>();
  const skippedTables: string[] = [];

  for (const file of files) {
    const entity = file.name.replace(/\.csv$/, "");
    if (entity === "User") {
      skippedTables.push("User");
      continue;
    }
    operatorAssert(
      isProvenanceRecordTable(entity),
      "UNSUPPORTED_IMPORT_TABLE",
    );
    const model = dmmfModels.get(entity);
    const pkFields = RECORD_PRIMARY_KEYS[entity];
    operatorAssert(model && pkFields?.length, "UNSUPPORTED_IMPORT_TABLE");
    const [headers, ...rows] = parseRecordCsv(file.text);
    operatorAssert(headers && headers.length > 0, "INVALID_IMPORT_CSV");
    const uniqueHeaders = new Set(headers);
    operatorAssert(uniqueHeaders.size === headers.length, "DUPLICATE_CSV_COLUMN");
    for (const col of headers)
      operatorAssert(model.has(col), "UNKNOWN_IMPORT_COLUMN");
    for (const pk of pkFields)
      operatorAssert(uniqueHeaders.has(pk), "MISSING_PRIMARY_KEY_COLUMN");
    const sortedColumns = [...headers].sort();
    const dateFields = DATE_KEY_FIELDS[entity] ?? new Set<string>();

    for (const rawRow of rows) {
      operatorAssert(
        rawRow.length === headers.length,
        "INVALID_IMPORT_CSV",
      );
      operatorAssert(
        candidates.length < MAX_CANDIDATES,
        "TOO_MANY_CANDIDATES",
      );
      const decoded: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        decoded[headers[i]!] = decodeRecordCell(rawRow[i] ?? "");
      }
      const rawKey: Record<string, unknown> = {};
      for (const pk of pkFields) {
        rawKey[pk] = canonicalFieldValue(entity, pk, decoded[pk]);
      }
      let normalized: ReturnType<typeof normalizeProvenanceKey>;
      try {
        normalized = normalizeProvenanceKey(rawKey, pkFields, dateFields);
      } catch {
        throw new OperatorError("INVALID_PRIMARY_KEY_VALUE");
      }
      const dedupeKey = `${entity}\0${normalized.recordId}`;
      operatorAssert(!seen.has(dedupeKey), "DUPLICATE_CANDIDATE_KEY");
      seen.add(dedupeKey);
      candidates.push({
        entity,
        key: normalized.key,
        action: "MARK_IMPORTED",
        expectedColumnNames: sortedColumns,
        expectedRowHash: computeSelectedColumnsHash(
          entity,
          decoded,
          sortedColumns,
        ),
      });
    }
  }
  operatorAssert(candidates.length > 0, "NO_PROVENANCE_CANDIDATES");
  candidates.sort((a, b) => {
    const entityCmp = a.entity.localeCompare(b.entity);
    if (entityCmp !== 0) return entityCmp;
    const pkA = RECORD_PRIMARY_KEYS[a.entity]!;
    const pkB = RECORD_PRIMARY_KEYS[b.entity]!;
    const keyA = normalizeProvenanceKey(
      a.key,
      pkA,
      DATE_KEY_FIELDS[a.entity],
    ).recordId;
    const keyB = normalizeProvenanceKey(
      b.key,
      pkB,
      DATE_KEY_FIELDS[b.entity],
    ).recordId;
    return keyA.localeCompare(keyB);
  });
  return provenanceCandidateFileSchema.parse({
    version: 1,
    kind: "archive-provenance-candidates",
    evidenceLabel: label,
    ...(options.sourceRevision ? { sourceRevision: options.sourceRevision } : {}),
    extractedFrom: {
      format: options.format,
      fileCount: files.length,
      skippedTables: [...new Set(skippedTables)].sort(),
    },
    candidates,
  });
}

/** Read a local ZIP archive or single <Entity>.csv file with bounded size checks. */
export async function extractProvenanceCandidatesFromPath(
  inputPath: string,
  options: { evidenceLabel?: string; sourceRevision?: string } = {},
): Promise<ProvenanceCandidateFile> {
  const resolved = resolve(inputPath);
  const info = await stat(resolved);
  operatorAssert(
    info.isFile() && info.size > 0 && info.size <= TRANSFER_MAX_BYTES,
    "INVALID_IMPORT_INPUT",
  );
  const ext = extname(resolved).toLowerCase();
  operatorAssert(ext === ".zip" || ext === ".csv", "UNSUPPORTED_IMPORT_FORMAT");
  const file = await open(resolved, "r");
  let bytes: Buffer;
  try {
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  operatorAssert(bytes.length <= TRANSFER_MAX_BYTES, "INVALID_IMPORT_INPUT");
  const label = options.evidenceLabel ?? basename(resolved);
  if (ext === ".zip") {
    let files: TransferFile[];
    try {
      files = readRecordArchive(new Uint8Array(bytes));
    } catch {
      throw new OperatorError("INVALID_IMPORT_ARCHIVE");
    }
    return extractProvenanceCandidatesFromFiles(files, {
      format: "zip",
      evidenceLabel: label,
      sourceRevision: options.sourceRevision,
    });
  }
  const name = basename(resolved);
  operatorAssert(/^[A-Za-z]+\.csv$/.test(name), "INVALID_IMPORT_FILENAME");
  const text = bytes.toString("utf8");
  const parsed = parseRecordCsv(text);
  operatorAssert(
    parsed.length - 1 <= TRANSFER_MAX_ROWS,
    "TOO_MANY_CANDIDATES",
  );
  return extractProvenanceCandidatesFromFiles([{ name, text }], {
    format: "csv",
    evidenceLabel: label,
    sourceRevision: options.sourceRevision,
  });
}

type ValidatedCandidate = {
  entity: ProvenanceRecordTable;
  key: ProvenanceKey;
  keyKind: ProvenanceKeyKind;
  recordId: string;
  pkFields: readonly string[];
  action: ProvenanceAction;
  expectedColumnNames?: readonly string[];
  expectedRowHash?: string;
};

function validateCandidates(raw: ProvenanceCandidateFile): ValidatedCandidate[] {
  const parsed = provenanceCandidateFileSchema.parse(raw);
  const seen = new Set<string>();
  const validated: ValidatedCandidate[] = [];
  for (const item of parsed.candidates) {
    operatorAssert(
      isProvenanceRecordTable(item.entity),
      "UNSUPPORTED_PROVENANCE_ENTITY",
    );
    const pkFields = RECORD_PRIMARY_KEYS[item.entity];
    const model = dmmfModels.get(item.entity);
    operatorAssert(pkFields?.length && model, "UNSUPPORTED_PROVENANCE_ENTITY");
    if (item.expectedColumnNames) {
      const colSet = new Set(item.expectedColumnNames);
      operatorAssert(
        colSet.size === item.expectedColumnNames.length,
        "DUPLICATE_EXPECTED_COLUMN",
      );
      for (const col of item.expectedColumnNames)
        operatorAssert(model.has(col), "UNKNOWN_EXPECTED_COLUMN");
    }
    let normalized: ReturnType<typeof normalizeProvenanceKey>;
    try {
      normalized = normalizeProvenanceKey(
        item.key,
        pkFields,
        DATE_KEY_FIELDS[item.entity],
      );
    } catch {
      throw new OperatorError("INVALID_CANDIDATE_KEY");
    }
    const token = `${item.entity}\0${normalized.recordId}`;
    operatorAssert(!seen.has(token), "DUPLICATE_CANDIDATE_KEY");
    seen.add(token);
    validated.push({
      entity: item.entity,
      key: normalized.key,
      keyKind: normalized.keyKind,
      recordId: normalized.recordId,
      pkFields,
      action: item.action,
      expectedColumnNames: item.expectedColumnNames,
      expectedRowHash: item.expectedRowHash,
    });
  }
  validated.sort((a, b) => {
    const cmp = a.entity.localeCompare(b.entity);
    return cmp !== 0 ? cmp : a.recordId.localeCompare(b.recordId);
  });
  return validated;
}

async function fetchRowByKey(
  tx: TransactionDb,
  entity: ProvenanceRecordTable,
  key: ProvenanceKey,
  pkFields: readonly string[],
): Promise<Record<string, unknown> | null> {
  const model = dmmfModels.get(entity);
  operatorAssert(model, "UNSUPPORTED_PROVENANCE_ENTITY");
  const clauses = pkFields.map((field) => {
    const meta = model.get(field);
    const val = key[field];
    const colSql = Prisma.raw(quoteIdent(field));
    if (meta?.type === "DateTime") {
      return Prisma.sql`${colSql} = ${new Date(String(val))}`;
    }
    return Prisma.sql`${colSql} = ${val}`;
  });
  const tableSql = Prisma.raw(`public.${quoteIdent(entity)}`);
  const rows = await tx.$queryRaw<Array<{ row: Record<string, unknown> }>>(
    Prisma.sql`SELECT to_jsonb(t) AS row FROM ${tableSql} t WHERE ${Prisma.join(clauses, " AND ")} LIMIT 1`,
  );
  return rows[0]?.row ?? null;
}

function buildSafeSummary(
  entity: ProvenanceRecordTable,
  row: Record<string, unknown>,
  pkFields: readonly string[],
): Record<string, unknown> {
  const fields = SAFE_SUMMARY_FIELDS[entity] ?? pkFields;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(row, field)) {
      out[field] = canonicalFieldValue(entity, field, row[field]);
    }
  }
  return out;
}

function fullRowHash(
  entity: ProvenanceRecordTable,
  row: Record<string, unknown>,
): string {
  const model = dmmfModels.get(entity);
  const cols = model ? [...model.keys()].sort() : Object.keys(row).sort();
  return computeSelectedColumnsHash(entity, row, cols);
}

/** Resolve exact typed recovery references for a candidate, including immediate
 * parent rows in the database, mirroring SQL `imported_provenance_references`. */
async function resolveTypedRecoveryReferences(
  tx: TransactionDb,
  candidate: ValidatedCandidate,
  row: Record<string, unknown> | null,
): Promise<ProvenanceRecoveryReference[]> {
  const refs = directProvenanceRecoveryReferences(
    candidate.entity,
    candidate.key,
    candidate.recordId,
  );
  const seen = new Set(refs.map((r) => `${r.entity}\0${r.recordId}`));
  const add = (entity: string, recordId: unknown) => {
    if (typeof recordId !== "string" || !recordId) return;
    const token = `${entity}\0${recordId}`;
    if (seen.has(token)) return;
    seen.add(token);
    refs.push({ entity, recordId });
  };

  if (candidate.entity === "Session" && row) {
    add("Session", row.mergeGroupId);
    add("Pairing", row.pairingId);
    add("Tutor", row.tutorId);
    const tutees = await tx.sessionTutee.findMany({
      where: { sessionId: candidate.recordId },
      select: { tuteeId: true },
    });
    for (const item of tutees) add("Tutee", item.tuteeId);
  } else if (candidate.entity === "SessionTutee") {
    const session = await tx.session.findUnique({
      where: { id: String(candidate.key.sessionId) },
      select: { mergeGroupId: true, pairingId: true, tutorId: true },
    });
    if (session) {
      add("Session", session.mergeGroupId);
      add("Pairing", session.pairingId);
      add("Tutor", session.tutorId);
    }
  } else if (candidate.entity === "PairingTutee") {
    const pairing = await tx.pairing.findUnique({
      where: { id: String(candidate.key.pairingId) },
      select: { tutorId: true, termId: true },
    });
    if (pairing) {
      add("Tutor", pairing.tutorId);
      add("Term", pairing.termId);
    }
  } else if (candidate.entity === "SessionFlag" && row) {
    add("Session", row.sessionId);
    add("Tutor", row.tutorId);
  } else if (candidate.entity === "ServiceHourAdjustment") {
    if (row) add("Tutor", row.tutorId);
    if (candidate.recordId.startsWith("flag:")) {
      const flagId = candidate.recordId.slice(5);
      add("SessionFlag", flagId);
      const flag = await tx.sessionFlag.findUnique({
        where: { id: flagId },
        select: { sessionId: true },
      });
      if (flag) add("Session", flag.sessionId);
    } else if (candidate.recordId.startsWith("interview_")) {
      const matches = await tx.$queryRaw<
        Array<{ app_id: string; tutor_id: string }>
      >(Prisma.sql`
        SELECT a.id AS app_id, t.id AS tutor_id
        FROM "TutorApplication" a
        JOIN "Tutor" t ON t.id = substring(${candidate.recordId} FROM length('interview_' || a.id || '_') + 1)
        WHERE ${candidate.recordId} LIKE 'interview_' || a.id || '_%'
      `);
      for (const m of matches) {
        add("TutorApplication", m.app_id);
        add("Tutor", m.tutor_id);
      }
    } else if (candidate.recordId.startsWith("mtgabs_")) {
      const matches = await tx.$queryRaw<
        Array<{ meeting_id: string; tutor_id: string }>
      >(Prisma.sql`
        SELECT m.id AS meeting_id, t.id AS tutor_id
        FROM "TutorMeeting" m
        JOIN "Tutor" t ON t.id = substring(${candidate.recordId} FROM length('mtgabs_' || m.id || '_') + 1)
        WHERE ${candidate.recordId} LIKE 'mtgabs_' || m.id || '_%'
      `);
      for (const m of matches) {
        add("TutorMeeting", m.meeting_id);
        add("Tutor", m.tutor_id);
      }
    }
  } else if (candidate.entity === "MeetingAttendance" && row) {
    add("TutorMeeting", row.meetingId);
    add("Tutor", row.tutorId);
  } else if (candidate.entity === "Patrol" && row) {
    add("User", row.crewUserId);
  } else if (candidate.entity === "PatrolObservation" && row) {
    add("Patrol", row.patrolId);
  } else if (candidate.entity === "PatrolCreditWindow" && row) {
    add("Patrol", row.patrolId);
  } else if (candidate.entity === "ApplicationSubjectIntent" && row) {
    add("TutorApplication", row.applicationId);
  } else if (candidate.entity === "DisciplinaryCard" && row) {
    add("Tutee", row.tuteeId);
    add("Session", row.sessionId);
  } else if (candidate.entity === "TuteeRemovalRequest" && row) {
    add("Tutee", row.tuteeId);
    add("Pairing", row.pairingId);
  } else if (candidate.entity === "TutorStatusRequest" && row) {
    add("Tutor", row.tutorId);
  } else if (candidate.entity === "CrewStatusRequest" && row) {
    add("User", row.userId);
  } else if (candidate.entity === "Pairing" && row) {
    add("Tutor", row.tutorId);
    add("Term", row.termId);
  } else if (candidate.entity === "StudentSurvey" && row) {
    add("Tutee", row.tuteeId);
    add("Term", row.intakeTermId);
  } else if (candidate.entity === "StudentRequestReview" && row) {
    add("StudentSurvey", row.surveyId);
    add("Tutee", row.legacyTuteeId);
    add("Pairing", row.pairingId);
  } else if (candidate.entity === "StudentQuarterBlock" && row) {
    add("StudentSurvey", row.surveyId);
    add("Tutee", row.legacyTuteeId);
    add("User", row.userId);
  } else if (candidate.entity === "StudentProfileOwnership" && row) {
    add("User", row.userId);
  } else if (candidate.entity === "HistoricalAcademicRecord" && row) {
    add("Tutor", row.tutorId);
    add("Tutee", row.tuteeId);
  } else if (candidate.entity === "AcademicConfirmation" && row) {
    add("User", row.userId);
  } else if (candidate.entity === "StudentAppeal" && row) {
    add("Tutee", row.studentId);
    add("DisciplinaryCard", row.cardId);
  } else if (candidate.entity === "StudentFeedback" && row) {
    add("Tutee", row.studentId);
    add("Session", row.sessionId);
  }

  refs.sort((a, b) => {
    const cmp = a.entity.localeCompare(b.entity);
    return cmp !== 0 ? cmp : a.recordId.localeCompare(b.recordId);
  });
  return refs;
}

function describeAutomationEffects(
  entity: ProvenanceRecordTable,
  proposedAction: ProvenanceAction | "NO_OP",
  recordId: string,
): string[] {
  if (proposedAction === "NO_OP")
    return ["No provenance write; current workflow and reporting boundaries remain unchanged."];
  const effects: string[] = [];
  if (proposedAction === "MARK_IMPORTED") {
    switch (entity) {
      case "Session":
        effects.push(
          "Excludes session hours from School Month Reports and opening review while preserving stored shCount and roster/history visibility.",
          "Freezes propagateSlotAttendance, reconcileFlag, and reconsiderSessionFlag across the session's merged block.",
        );
        break;
      case "SessionTutee":
        effects.push(
          "Freezes propagateSlotAttendance, reconcileFlag, and reconsiderSessionFlag across the parent session's merged block.",
        );
        break;
      case "ServiceHourAdjustment":
        effects.push(
          "Excludes adjustment from School Month Reports and opening review while preserving stored amount and roster/history visibility.",
        );
        if (recordId.startsWith("mtgabs_"))
          effects.push(
            "Preserves frozen meeting-absence deduction in reconcileMeetingHours and blocks native recreation on the same logical key.",
          );
        else if (recordId.startsWith("interview_"))
          effects.push(
            "Blocks native writeInterviewCompletion and clearInterviewHours on the linked interview.",
          );
        else if (recordId.startsWith("flag:"))
          effects.push(
            "Freezes flag reconsideration and reconciliation for the linked SessionFlag's merged block.",
          );
        break;
      case "Patrol":
        effects.push(
          "Excludes patrol hours from School Month Reports and opening review while preserving stored hours and crew history.",
          "Excludes patrol observations from SessionFlag discrepancy matching.",
        );
        break;
      case "PatrolObservation":
        effects.push(
          "Excludes observation from SessionFlag discrepancy matching in reconcileFlag.",
        );
        break;
      case "SessionFlag":
        effects.push(
          "Freezes reconcileFlag and reconsiderSessionFlag across the linked session's merged block.",
        );
        break;
      case "TutorMeeting":
      case "MeetingAttendance":
        effects.push(
          "Skips imported attendance in reconcileMeetingHours (never consumes the 3-absence semester allowance or generates new deductions).",
          "Blocks native deleteMeeting and recordMeetingAttendance mutations.",
        );
        break;
      case "TutorApplication":
        effects.push(
          "Blocks native promoteApplicantToTutor, reconcileApplication, writeInterviewCompletion, and clearInterviewHours.",
          "Excludes imported INITIAL acceptance from blocking revocation of a separate native admission.",
        );
        break;
      case "InterviewAssignment":
        effects.push(
          "Blocks native writeInterviewCompletion and clearInterviewHours on the linked interview.",
        );
        break;
      case "TuteeRemovalRequest":
        effects.push(
          "Prevents syncPunishmentRemoval from auto-reinstating the tutee or restoring pairings after later card reviews.",
        );
        break;
      default:
        effects.push(
          `Marks ${entity} as archive-imported evidence while preserving stored values and current memberships.`,
        );
        break;
    }
  } else {
    if (FINANCIAL_TABLES.has(entity)) {
      effects.push(
        "Removes archive marker so an already-anchored opening/committed source resumes matching its school-hours baseline without manufacturing a reversal or new credit.",
      );
    } else {
      effects.push(
        `Removes archive provenance marker on ${entity}; native maintenance guards no longer treat this row as imported evidence.`,
      );
    }
  }
  return effects;
}

type SchoolHoursData = {
  config: {
    enabled: boolean;
    baselineVersion: number;
    headReportId: string | null;
    openingBaseline: unknown;
  } | null;
  head: { id: string; sourceBaseline: unknown } | null;
  users: Array<{
    id: string;
    tutorId: string | null;
    mergedIntoId: string | null;
  }>;
  tutors: Array<{
    id: string;
    retainedOwner: { userId: string } | null;
  }>;
  sessions: Array<{ id: string; tutorId: string; shCount: number }>;
  adjustments: Array<{
    id: string;
    tutorId: string;
    type: string;
    amount: number;
  }>;
  patrols: Array<{ id: string; crewUserId: string; hours: number }>;
  importedFinancial: Array<{ entity: string; recordId: string }>;
};

async function loadSchoolHoursData(tx: TransactionDb): Promise<SchoolHoursData> {
  const [config, users, tutors, sessions, adjustments, patrols, importedFinancial] =
    await Promise.all([
      tx.schoolHoursSchedule.findUnique({
        where: { id: "program" },
        select: {
          enabled: true,
          baselineVersion: true,
          headReportId: true,
          openingBaseline: true,
        },
      }),
      tx.user.findMany({
        select: { id: true, tutorId: true, mergedIntoId: true },
      }),
      tx.tutor.findMany({
        select: { id: true, retainedOwner: { select: { userId: true } } },
      }),
      tx.session.findMany({
        select: { id: true, tutorId: true, shCount: true },
        orderBy: { id: "asc" },
      }),
      tx.serviceHourAdjustment.findMany({
        select: { id: true, tutorId: true, type: true, amount: true },
        orderBy: { id: "asc" },
      }),
      tx.patrol.findMany({
        select: { id: true, crewUserId: true, hours: true },
        orderBy: { id: "asc" },
      }),
      tx.importedRecordProvenance.findMany({
        where: {
          entity: { in: ["Session", "ServiceHourAdjustment", "Patrol"] },
        },
        select: { entity: true, recordId: true },
      }),
    ]);
  const head = config?.headReportId
    ? await tx.schoolHoursReport.findUniqueOrThrow({
        where: { id: config.headReportId },
        select: { id: true, sourceBaseline: true },
      })
    : null;
  return {
    config,
    head,
    users,
    tutors,
    sessions,
    adjustments,
    patrols,
    importedFinancial,
  };
}

function evaluateSchoolHoursState(
  data: SchoolHoursData,
  importedKeysSet: ReadonlySet<string>,
) {
  const importedSourceKeys = new Set<string>();
  for (const key of importedKeysSet) {
    const idx = key.indexOf(":");
    const entity = key.slice(0, idx);
    const id = key.slice(idx + 1);
    const prefix =
      entity === "Session"
        ? "session"
        : entity === "Patrol"
          ? "patrol"
          : "adjustment";
    importedSourceKeys.add(`${prefix}:${id}`);
  }
  const userMap = new Map(data.users.map((u) => [u.id, u]));
  const tutorMap = new Map(data.tutors.map((t) => [t.id, t]));
  const rootUser = (id: string): string | null => {
    const seen = new Set<string>();
    let user = userMap.get(id);
    while (user?.mergedIntoId) {
      if (seen.has(user.id)) return null;
      seen.add(user.id);
      user = userMap.get(user.mergedIntoId);
    }
    return user?.id ?? null;
  };
  const tutorKey = (id: string): string | null => {
    const tutor = tutorMap.get(id);
    if (!tutor) return null;
    const owners = data.users
      .filter((u) => u.tutorId === id)
      .map((u) => u.id);
    if (tutor.retainedOwner) owners.push(tutor.retainedOwner.userId);
    const roots = [...new Set(owners.map(rootUser))];
    if (roots.includes(null) || roots.length > 1) return null;
    return roots[0] ? `user:${roots[0]}` : `tutor:${id}`;
  };
  const resolveBeneficiary = (id: string): string | null =>
    id.startsWith("user:")
      ? rootUser(id.slice(5))
        ? `user:${rootUser(id.slice(5))}`
        : null
      : id.startsWith("tutor:")
        ? tutorKey(id.slice(6))
        : null;

  const blockers: SchoolBlocker[] = [];
  const archivedSourceKeys = new Set<string>();
  const componentTotals = new Map<
    string,
    Record<(typeof SCHOOL_HOURS_KEYS)[number], Prisma.Decimal>
  >();
  const sources: SchoolBaseline["sources"] = [];

  const addSource = (
    kind: "user" | "tutor",
    ownerId: string,
    key: string,
    component: (typeof SCHOOL_HOURS_KEYS)[number],
    value: number,
  ) => {
    const beneficiaryId =
      kind === "user" ? resolveBeneficiary(`user:${ownerId}`) : tutorKey(ownerId);
    if (!beneficiaryId) {
      blockers.push({
        code: "OWNERSHIP_CONFLICT",
        message: "A source has missing or conflicting explicit ownership.",
      });
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      blockers.push({
        code: "SOURCE_VALUE_INVALID",
        beneficiaryId,
        message: "A stored credit or deduction has an invalid amount.",
      });
      return;
    }
    let totals = componentTotals.get(beneficiaryId);
    if (!totals) {
      totals = {
        earned: new Prisma.Decimal(0),
        extras: new Prisma.Decimal(0),
        deductions: new Prisma.Decimal(0),
        crew: new Prisma.Decimal(0),
      };
      componentTotals.set(beneficiaryId, totals);
    }
    totals[component] = totals[component].plus(value);
    sources.push({
      key,
      beneficiaryId,
      component,
      value,
      ownerKind: kind,
      ownerId,
    });
  };

  for (const row of data.sessions) {
    const key = `session:${row.id}`;
    if (importedKeysSet.has(`Session:${row.id}`)) archivedSourceKeys.add(key);
    else addSource("tutor", row.tutorId, key, "earned", row.shCount);
  }
  for (const row of data.adjustments) {
    const key = `adjustment:${row.id}`;
    if (importedKeysSet.has(`ServiceHourAdjustment:${row.id}`))
      archivedSourceKeys.add(key);
    else
      addSource(
        "tutor",
        row.tutorId,
        key,
        row.type === "EXTRA" ? "extras" : "deductions",
        row.amount,
      );
  }
  for (const row of data.patrols) {
    const key = `patrol:${row.id}`;
    if (importedKeysSet.has(`Patrol:${row.id}`)) archivedSourceKeys.add(key);
    else addSource("user", row.crewUserId, key, "crew", row.hours);
  }

  sources.sort((a, b) => a.key.localeCompare(b.key));
  const currentPeople = new Map<string, SchoolHoursComponents>();
  for (const [id, totals] of componentTotals.entries()) {
    currentPeople.set(id, {
      earned: totals.earned.toNumber(),
      extras: totals.extras.toNumber(),
      deductions: totals.deductions.toNumber(),
      crew: totals.crew.toNumber(),
    });
  }

  const opening = parseBaseline(data.config?.openingBaseline);
  const committed = data.head
    ? parseBaseline(data.head.sourceBaseline)
    : emptyBaseline();

  for (const source of [...committed.sources, ...opening.sources]) {
    if (
      importedSourceKeys.has(source.key) &&
      !blockers.some(
        (b) =>
          b.code === "IMPORTED_SOURCE_REQUIRES_RECONCILIATION" &&
          b.beneficiaryId === source.beneficiaryId,
      )
    ) {
      blockers.push({
        code: "IMPORTED_SOURCE_REQUIRES_RECONCILIATION",
        beneficiaryId: source.beneficiaryId,
        message:
          "Previously reviewed school-reporting evidence was restored as an archive. Reconcile its reporting boundary before issuing.",
      });
    }
  }

  const resolvePerson = (person: SchoolPerson) => {
    const direct = resolveBeneficiary(person.beneficiaryId);
    if (direct) return direct;
    const roots = [
      ...new Set(
        person.provenanceUserIds
          .map((id) => resolveBeneficiary(`user:${id}`))
          .filter((id): id is string => !!id),
      ),
    ];
    return roots.length === 1 ? roots[0]! : null;
  };
  const consumedOpeningIds = new Set(
    committed.consumedOpeningIds ??
      committed.people.map((person) => person.beneficiaryId),
  );
  const previous = new Map<string, SchoolPerson>();
  for (const person of [
    ...committed.people,
    ...opening.people.filter(
      (person) => !consumedOpeningIds.has(person.beneficiaryId),
    ),
  ]) {
    const id = resolvePerson(person);
    if (!id) {
      blockers.push({
        code: "OWNER_MISSING",
        beneficiaryId: person.beneficiaryId,
        message:
          "A previously reported participant lost its ownership evidence. Restore or reconcile the account first.",
      });
      continue;
    }
    const existing = previous.get(id);
    if (existing && existing.schoolAccountKey !== person.schoolAccountKey) {
      blockers.push({
        code: "ACCOUNT_MAPPING_CONFLICT",
        beneficiaryId: id,
        message: "Combined account balances have different school identifiers.",
      });
    }
    if (existing) {
      for (const k of SCHOOL_HOURS_KEYS)
        existing.components[k] = sumDec(
          existing.components[k],
          person.components[k],
        );
      existing.carryHours = sumSchoolHoursCarry([
        existing.carryHours,
        person.carryHours,
      ]);
    } else {
      previous.set(id, {
        ...person,
        beneficiaryId: id,
        components: { ...person.components },
      });
    }
  }

  const sourceMap = new Map(sources.map((s) => [s.key, s]));
  for (const source of data.head ? committed.sources : opening.sources) {
    const next = sourceMap.get(source.key);
    const oldOwner = resolveBeneficiary(source.beneficiaryId);
    if (next && oldOwner !== next.beneficiaryId) {
      blockers.push({
        code: "SOURCE_OWNER_CHANGED",
        beneficiaryId: next.beneficiaryId,
        message:
          "A previously reported source moved to another owner. Reconcile ownership first.",
      });
    }
    if (
      !next &&
      !(source.ownerKind === "user"
        ? userMap.has(source.ownerId)
        : tutorMap.has(source.ownerId))
    ) {
      blockers.push({
        code: "OWNER_MISSING",
        beneficiaryId: source.beneficiaryId,
        message:
          "A source owner disappeared together with reported evidence. Restore or reconcile the account first.",
      });
    }
  }

  const ids = [
    ...new Set([...currentPeople.keys(), ...previous.keys()]),
  ].sort();
  for (const id of ids) {
    if (!previous.has(id)) {
      blockers.push({
        code: "BASELINE_REQUIRED",
        beneficiaryId: id,
        message:
          "Review this participant's school identifier and opening already-reported balances.",
      });
    }
  }

  const contentHash = sha256({
    baselineVersion: data.config?.baselineVersion ?? 0,
    head: data.head?.id ?? null,
    people: ids.map((id) => ({
      beneficiaryId: id,
      current: currentPeople.get(id) ?? zeroComponents(),
      previous: previous.get(id)?.components ?? null,
      carryHours: previous.get(id)?.carryHours ?? "0",
    })),
    sources,
    archivedSourceKeys: [...archivedSourceKeys].sort(),
    blockers,
  });

  return {
    opening,
    committed,
    previous,
    currentPeople,
    sources,
    archivedSourceKeys,
    blockers,
    contentHash,
    resolveBeneficiary,
    tutorKey,
  };
}

function rawChangeFor(
  live: SchoolHoursComponents,
  old: SchoolPerson | undefined,
): { rawChange: number | null; hoursToAdd: number | null } {
  if (!old) return { rawChange: null, hoursToAdd: null };
  const earned = minusDec(live.earned, old.components.earned);
  const extras = minusDec(live.extras, old.components.extras);
  const deductions = minusDec(live.deductions, old.components.deductions);
  const crew = minusDec(live.crew, old.components.crew);
  const tutoringChange = minusDec(sumDec(earned, extras), deductions);
  const rawChange = sumDec(tutoringChange, crew);
  const { hoursToAdd } = quantizeSchoolHours(rawChange, old.carryHours);
  return { rawChange, hoursToAdd };
}

async function checkRecoveryCoverage(tx: TransactionDb) {
  const [replication] = await tx.$queryRaw<
    Array<{ mode: string }>
  >`SELECT current_setting('session_replication_role') AS mode`;
  const triggers = await tx.$queryRaw<
    Array<{ tableName: string; triggerName: string; valid: boolean }>
  >`
    SELECT c.relname AS "tableName", t.tgname AS "triggerName",
      (
        t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal
        AND t.tgconstraint = 0
        AND NOT t.tgdeferrable
        AND NOT t.tginitdeferred
        AND t.tgqual IS NULL
        AND t.tgattr::text = ''
        AND t.tgnargs = 0
        AND (
          (c.relname = 'ImportedRecordProvenance' AND t.tgname = 'recovery_change_journal' AND t.tgtype = 29 AND t.tgfoid = to_regprocedure('recovery_capture_imported_provenance()'))
          OR (c.relname = 'ArchiveProvenanceReceipt' AND t.tgname = 'recovery_change_journal' AND t.tgtype = 29 AND t.tgfoid = to_regprocedure('recovery_capture_archive_provenance_receipt()'))
          OR (c.relname = 'ArchiveProvenanceReceipt' AND t.tgname = 'archive_provenance_receipt_immutable' AND t.tgtype = 27 AND t.tgfoid = to_regprocedure('archive_provenance_receipt_immutable()'))
        )
      ) AS valid
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('ImportedRecordProvenance', 'ArchiveProvenanceReceipt')
      AND t.tgname IN ('recovery_change_journal', 'archive_provenance_receipt_immutable')
  `;
  const has = (table: string, trigger: string) =>
    triggers.some(
      (row) => row.tableName === table && row.triggerName === trigger && row.valid,
    );
  return {
    replicationMode: replication?.mode ?? "unknown",
    provenanceTriggerOk: has("ImportedRecordProvenance", "recovery_change_journal"),
    receiptTriggerOk: has("ArchiveProvenanceReceipt", "recovery_change_journal"),
    receiptImmutableOk: has(
      "ArchiveProvenanceReceipt",
      "archive_provenance_receipt_immutable",
    ),
  };
}

async function readSchemaRevision(tx: TransactionDb) {
  const rows = await tx.$queryRaw<
    Array<{ migration_name: string }>
  >`SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC`;
  return {
    latestMigration: rows[0]?.migration_name ?? null,
    appliedMigrationCount: rows.length,
  };
}

async function authorizeOperator(tx: TransactionDb, actorId: string) {
  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      name: true,
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  operatorAssert(
    user &&
      ["HEAD", "ADMIN"].includes(user.role) &&
      !user.suspendedAt &&
      !user.mergedIntoId &&
      !user.recoveryVoidedAt,
    "FORBIDDEN",
  );
  return user;
}

/** Read-only preview of a fixed explicit candidate set. Computes current row
 * hashes, typed scalar/composite keys, native/reference distinctions, recovery
 * references, automation effects, and school-hours ledger overlap without writes. */
export async function previewArchiveProvenance(
  tx: TransactionDb,
  rawCandidates: ProvenanceCandidateFile,
  options: {
    actorId: string;
    sourceRevision?: string;
    now?: Date;
  },
): Promise<ArchiveProvenancePreview> {
  await authorizeOperator(tx, options.actorId);
  const parsedFile = provenanceCandidateFileSchema.parse(rawCandidates);
  const validated = validateCandidates(parsedFile);
  const now = options.now ?? new Date();

  const [coverage, schemaRevision, schoolData, activeTerms] = await Promise.all([
    checkRecoveryCoverage(tx),
    readSchemaRevision(tx),
    loadSchoolHoursData(tx),
    tx.term.findMany({
      where: { active: true },
      select: { id: true, schoolYear: true },
    }),
  ]);
  const activeTermIds = new Set(activeTerms.map((t) => t.id));
  const activeSchoolYears = new Set(activeTerms.map((t) => t.schoolYear));

  const existingProvenanceRows = await tx.importedRecordProvenance.findMany({
    where: {
      OR: validated.map((c) => ({ entity: c.entity, recordId: c.recordId })),
    },
    select: { entity: true, recordId: true, importedAt: true },
  });
  const existingProvenanceMap = new Map(
    existingProvenanceRows.map((row) => [
      `${row.entity}\0${row.recordId}`,
      row.importedAt.toISOString(),
    ]),
  );

  // Batch-check which candidates are requested to be marked in this same batch
  // (e.g., for mixed-origin merged-session warnings).
  const batchMarkingSessions = new Set(
    validated
      .filter((c) => c.entity === "Session" && c.action === "MARK_IMPORTED")
      .map((c) => c.recordId),
  );

  const beforeSchoolKeys = new Set(
    schoolData.importedFinancial.map((row) => `${row.entity}:${row.recordId}`),
  );
  const beforeSchool = evaluateSchoolHoursState(schoolData, beforeSchoolKeys);

  const openingSourcesMap = new Map(
    beforeSchool.opening.sources.map((s) => [s.key, s]),
  );
  const committedSourcesMap = new Map(
    beforeSchool.committed.sources.map((s) => [s.key, s]),
  );

  const topBlockers: ProvenanceBlocker[] = [];
  if (coverage.replicationMode !== "origin") {
    topBlockers.push({
      code: "REPLICATION_MODE_NOT_ORIGIN",
      message: "Recovery requires PostgreSQL session_replication_role = origin.",
    });
  }
  if (
    !coverage.provenanceTriggerOk ||
    !coverage.receiptTriggerOk ||
    !coverage.receiptImmutableOk
  ) {
    topBlockers.push({
      code: "MISSING_PROVENANCE_RECOVERY_COVERAGE",
      message:
        "ImportedRecordProvenance and ArchiveProvenanceReceipt require active typed recovery and immutability triggers.",
    });
  }

  const overlaps: SchoolHoursOverlap[] = [];
  const candidatePreviews: ProvenanceCandidatePreview[] = [];
  const simulatedSchoolKeys = new Set(beforeSchoolKeys);
  const affectedBeneficiaries = new Set<string>();
  const allTrackedRoots = new Set<string>();

  for (const candidate of validated) {
    const row = await fetchRowByKey(
      tx,
      candidate.entity,
      candidate.key,
      candidate.pkFields,
    );
    const markedAt =
      existingProvenanceMap.get(`${candidate.entity}\0${candidate.recordId}`) ??
      null;
    const marked = markedAt !== null;
    const proposedAction: ProvenanceAction | "NO_OP" =
      candidate.action === "MARK_IMPORTED"
        ? marked
          ? "NO_OP"
          : "MARK_IMPORTED"
        : marked
          ? "RELEASE_IMPORTED"
          : "NO_OP";

    const currentRowHash = row ? fullRowHash(candidate.entity, row) : null;
    const safeSummary = row
      ? buildSafeSummary(candidate.entity, row, candidate.pkFields)
      : null;

    let importValueMatch: ProvenanceCandidatePreview["importValueMatch"];
    if (!row) importValueMatch = "ROW_MISSING";
    else if (candidate.expectedColumnNames && candidate.expectedRowHash) {
      const liveSelectedHash = computeSelectedColumnsHash(
        candidate.entity,
        row,
        candidate.expectedColumnNames,
      );
      importValueMatch =
        liveSelectedHash === candidate.expectedRowHash
          ? "EXACT_MATCH"
          : "VALUE_MISMATCH";
    } else {
      importValueMatch = "NO_IMPORT_HASH_PROVIDED";
    }

    const nativeSignals: string[] = [];
    const warnings: string[] = [];
    const blockers: ProvenanceBlocker[] = [];

    if (!row) {
      if (proposedAction === "MARK_IMPORTED") {
        blockers.push({
          code: "RECORD_NOT_FOUND",
          message: `Cannot mark missing ${candidate.entity} record as imported.`,
        });
      } else {
        warnings.push(
          "Source record is not currently present in the database; only its provenance marker exists.",
        );
      }
    }

    if (importValueMatch === "VALUE_MISMATCH") {
      nativeSignals.push("IMPORT_VALUE_MISMATCH");
      blockers.push({
        code: "SOURCE_VALUE_MISMATCH_WITH_IMPORT_EVIDENCE",
        message:
          "Current database row values do not match the original import file hash (possible native late correction or non-matching native record).",
      });
    }

    let classificationKind: ProvenanceCandidatePreview["classificationKind"] =
      !row
        ? "MISSING_RECORD"
        : REFERENCE_CONFIGURATION_TABLES.has(candidate.entity)
          ? "CURRENT_REFERENCE_CONFIGURATION"
          : "EXACT_HISTORICAL_IMPORT";

    if (row && proposedAction === "MARK_IMPORTED") {
      const boundaryError = historicalImportError(candidate.entity, row, now);
      if (boundaryError) {
        classificationKind = "NATIVE_LATE_CORRECTION_OR_LIVE";
        nativeSignals.push("HISTORICAL_BOUNDARY_VIOLATION");
        blockers.push({
          code: "ACTIVE_OR_LIVE_RECORD_CANNOT_BE_ARCHIVED",
          message: boundaryError,
        });
      }
      if (REFERENCE_CONFIGURATION_TABLES.has(candidate.entity)) {
        warnings.push(
          "Reference configuration table: verify this row is historical archive setup, not current program configuration.",
        );
        const activeRef = await isActiveReferenceConfiguration(
          tx,
          candidate.entity,
          row,
          activeTermIds,
          activeSchoolYears,
          now,
        );
        if (activeRef) {
          nativeSignals.push("ACTIVE_REFERENCE_CONFIG");
          blockers.push({
            code: "ACTIVE_REFERENCE_CONFIGURATION",
            message: `Cannot classify active/current ${candidate.entity} reference configuration as a historical archive import.`,
          });
        }
      }
      const parentCheck = await checkLiveParentBoundaries(
        tx,
        candidate,
        row,
        activeTermIds,
        batchMarkingSessions,
        now,
      );
      nativeSignals.push(...parentCheck.signals);
      warnings.push(...parentCheck.warnings);
      blockers.push(...parentCheck.blockers);
      if (parentCheck.isLiveNative) {
        classificationKind = "NATIVE_LATE_CORRECTION_OR_LIVE";
      }
    }

    // Native AuditLog history signal (never used to infer origin, only to flag native corrections).
    const nativeAuditCount = await tx.auditLog.count({
      where: {
        entity: candidate.entity,
        entityId: candidate.recordId,
        operation: {
          notIn: ["recordTransfer.import", "recovery.archiveProvenance"],
        },
      },
    });
    if (nativeAuditCount > 0) {
      nativeSignals.push("NATIVE_AUDIT_HISTORY");
      if (
        classificationKind === "EXACT_HISTORICAL_IMPORT" &&
        importValueMatch !== "EXACT_MATCH"
      ) {
        classificationKind = "NATIVE_LATE_CORRECTION_OR_LIVE";
      }
      warnings.push(
        `Found ${nativeAuditCount} non-import audit log entries for this key; verify it is not a native late correction.`,
      );
    }

    // Typed recovery references and live tracked recovery roots.
    const recoveryReferences = await resolveTypedRecoveryReferences(
      tx,
      candidate,
      row,
    );
    const trackedRows = recoveryReferences.length
      ? await tx.recoveryTrackedEntity.findMany({
          where: {
            OR: recoveryReferences.map((ref) => ({
              entity: ref.entity,
              recordId: ref.recordId,
            })),
          },
          select: { actionId: true },
        })
      : [];
    const trackedRecoveryActionIds = [
      ...new Set(trackedRows.map((r) => r.actionId)),
    ].sort();
    for (const rootId of trackedRecoveryActionIds) allTrackedRoots.add(rootId);
    if (trackedRecoveryActionIds.length > 0) {
      nativeSignals.push("TRACKED_BY_RECOVERY_ROOT");
      warnings.push(
        `Linked to ${trackedRecoveryActionIds.length} recovery root(s); provenance changes will journal UNSUPPORTED consequences and advance their recovery fence.`,
      );
    }

    // School-hours ledger overlap checks for financial sources.
    if (FINANCIAL_TABLES.has(candidate.entity)) {
      const entity = candidate.entity as
        | "Session"
        | "ServiceHourAdjustment"
        | "Patrol";
      const prefix =
        entity === "Session"
          ? "session"
          : entity === "Patrol"
            ? "patrol"
            : "adjustment";
      const sourceKey = `${prefix}:${candidate.recordId}`;
      const committedSource = committedSourcesMap.get(sourceKey) ?? null;
      const openingSource = openingSourcesMap.get(sourceKey) ?? null;
      const anchored = committedSource ?? openingSource;
      const currentAmount = row
        ? Number(
            entity === "Session"
              ? row.shCount
              : entity === "Patrol"
                ? row.hours
                : row.amount,
          )
        : null;
      const currentBeneficiaryId = row
        ? entity === "Patrol"
          ? beforeSchool.resolveBeneficiary(`user:${String(row.crewUserId)}`)
          : beforeSchool.tutorKey(String(row.tutorId))
        : null;
      if (currentBeneficiaryId) affectedBeneficiaries.add(currentBeneficiaryId);
      if (anchored) {
        const anchoredOwner = beforeSchool.resolveBeneficiary(
          anchored.beneficiaryId,
        );
        if (anchoredOwner) affectedBeneficiaries.add(anchoredOwner);
        overlaps.push({
          stage: committedSource ? "COMMITTED" : "OPENING",
          sourceKey,
          entity,
          recordId: candidate.recordId,
          beneficiaryId: anchoredOwner ?? anchored.beneficiaryId,
          anchoredOwnerKind: anchored.ownerKind,
          anchoredOwnerId: anchored.ownerId,
          anchoredComponent: anchored.component,
          anchoredAmount: anchored.value,
          currentAmount,
          currentBeneficiaryId,
          headReportId: committedSource ? schoolData.head?.id ?? null : null,
        });
      }

      if (proposedAction === "MARK_IMPORTED") {
        if (committedSource) {
          blockers.push({
            code: "COMMITTED_SCHOOL_HOURS_OVERLAP",
            message:
              "Source is anchored in a committed SchoolHoursReport; classifying it as imported would erase or conflict with a committed anchor.",
          });
        } else if (openingSource) {
          blockers.push({
            code: "OPENING_SCHOOL_HOURS_OVERLAP",
            message:
              "Source is anchored in the reviewed SchoolHoursSchedule opening baseline; reconcile the opening ledger explicitly before classifying.",
          });
        } else {
          simulatedSchoolKeys.add(`${entity}:${candidate.recordId}`);
        }
      } else if (proposedAction === "RELEASE_IMPORTED") {
        if (!anchored) {
          blockers.push({
            code: "SILENT_ARCHIVE_CREDIT_RELEASE",
            message:
              "Cannot release an unanchored archived financial source into reportable school credit without explicit school-ledger reconciliation.",
          });
        } else {
          const anchoredOwner = beforeSchool.resolveBeneficiary(
            anchored.beneficiaryId,
          );
          const componentMatches =
            entity === "Session"
              ? anchored.component === "earned"
              : entity === "Patrol"
                ? anchored.component === "crew"
                : anchored.component ===
                  (row?.type === "EXTRA" ? "extras" : "deductions");
          if (
            !row ||
            currentAmount === null ||
            !new Prisma.Decimal(currentAmount).eq(anchored.value) ||
            !anchoredOwner ||
            currentBeneficiaryId !== anchoredOwner ||
            !componentMatches
          ) {
            blockers.push({
              code: "ANCHORED_SOURCE_DRIFT",
              message:
                "Archived source no longer matches its anchored school-hours owner, component, or amount; releasing it would manufacture a reversal or re-report changed hours.",
            });
          } else {
            simulatedSchoolKeys.delete(`${entity}:${candidate.recordId}`);
          }
        }
      }
    }

    candidatePreviews.push({
      entity: candidate.entity,
      keyKind: candidate.keyKind,
      key: candidate.key,
      recordId: candidate.recordId,
      requestedAction: candidate.action,
      proposedAction,
      exists: row !== null,
      currentProvenance: { marked, importedAt: markedAt },
      currentRowHash,
      safeSummary,
      importValueMatch,
      classificationKind,
      nativeSignals: [...new Set(nativeSignals)].sort(),
      recoveryReferences,
      trackedRecoveryActionIds,
      automationEffects: describeAutomationEffects(
        candidate.entity,
        proposedAction,
        candidate.recordId,
      ),
      warnings,
      blockers,
    });
  }

  const afterSchool = evaluateSchoolHoursState(schoolData, simulatedSchoolKeys);

  // Verify simulation never introduces a new school-hours blocker or manufactures a signed reversal.
  const beforeBlockerKeys = new Set(
    beforeSchool.blockers.map((b) => `${b.code}\0${b.beneficiaryId ?? ""}`),
  );
  for (const blocker of afterSchool.blockers) {
    if (!beforeBlockerKeys.has(`${blocker.code}\0${blocker.beneficiaryId ?? ""}`)) {
      topBlockers.push({
        code: "SCHOOL_HOURS_REVERSAL_OR_BLOCKER_INTRODUCED",
        message: `Proposed provenance changes would introduce school-hours blocker ${blocker.code}.`,
      });
    }
  }

  const beneficiaryImpacts: ArchiveProvenancePreview["schoolHours"]["beneficiaryImpacts"] =
    [];
  for (const beneficiaryId of [...affectedBeneficiaries].sort()) {
    const beforeLive =
      beforeSchool.currentPeople.get(beneficiaryId) ?? zeroComponents();
    const afterLive =
      afterSchool.currentPeople.get(beneficiaryId) ?? zeroComponents();
    const oldBefore = beforeSchool.previous.get(beneficiaryId);
    const oldAfter = afterSchool.previous.get(beneficiaryId);
    const beforeDelta = rawChangeFor(beforeLive, oldBefore);
    const afterDelta = rawChangeFor(afterLive, oldAfter);
    beneficiaryImpacts.push({
      beneficiaryId,
      reviewed: Boolean(oldAfter),
      before: beforeLive,
      after: afterLive,
      alreadyReported: oldAfter?.components ?? null,
      beforeRawChange: beforeDelta.rawChange,
      afterRawChange: afterDelta.rawChange,
      beforeHoursToAdd: beforeDelta.hoursToAdd,
      afterHoursToAdd: afterDelta.hoursToAdd,
    });
    if (
      beforeDelta.rawChange !== null &&
      afterDelta.rawChange !== null &&
      afterDelta.rawChange < 0 &&
      afterDelta.rawChange < beforeDelta.rawChange
    ) {
      topBlockers.push({
        code: "SCHOOL_HOURS_SIGNED_REVERSAL_MANUFACTURED",
        message: `Proposed provenance changes would manufacture a negative school-hours reversal for ${beneficiaryId}.`,
      });
    }
  }

  const markCount = candidatePreviews.filter(
    (c) => c.proposedAction === "MARK_IMPORTED",
  ).length;
  const releaseCount = candidatePreviews.filter(
    (c) => c.proposedAction === "RELEASE_IMPORTED",
  ).length;
  const noOpCount = candidatePreviews.filter(
    (c) => c.proposedAction === "NO_OP",
  ).length;
  const blockedCount = candidatePreviews.filter(
    (c) => c.blockers.length > 0,
  ).length;

  const applicable = topBlockers.length === 0 && blockedCount === 0;
  const sourceRevision =
    options.sourceRevision ?? parsedFile.sourceRevision ?? null;

  const fingerprint = planHash({
    version: 1,
    evidenceLabel: parsedFile.evidenceLabel,
    sourceRevision,
    schemaRevision,
    coverage,
    schoolHours: {
      headReportId: schoolData.head?.id ?? null,
      baselineVersion: schoolData.config?.baselineVersion ?? 0,
      scheduleEnabled: schoolData.config?.enabled ?? false,
      beforeContentHash: beforeSchool.contentHash,
      afterContentHash: afterSchool.contentHash,
      overlaps,
    },
    topBlockers,
    candidates: candidatePreviews.map((c) => ({
      entity: c.entity,
      recordId: c.recordId,
      requestedAction: c.requestedAction,
      proposedAction: c.proposedAction,
      exists: c.exists,
      currentProvenance: c.currentProvenance,
      currentRowHash: c.currentRowHash,
      importValueMatch: c.importValueMatch,
      trackedRecoveryActionIds: c.trackedRecoveryActionIds,
      blockers: c.blockers,
    })),
  });

  return {
    version: 1,
    evidenceLabel: parsedFile.evidenceLabel,
    sourceRevision,
    schemaRevision,
    coverage,
    summary: {
      totalCandidates: candidatePreviews.length,
      markCount,
      releaseCount,
      noOpCount,
      blockedCount,
      trackedRecoveryRootCount: allTrackedRoots.size,
    },
    schoolHours: {
      headReportId: schoolData.head?.id ?? null,
      baselineVersion: schoolData.config?.baselineVersion ?? 0,
      scheduleEnabled: schoolData.config?.enabled ?? false,
      beforeContentHash: beforeSchool.contentHash,
      afterContentHash: afterSchool.contentHash,
      beforeBlockers: beforeSchool.blockers,
      afterBlockers: afterSchool.blockers,
      overlaps,
      beneficiaryImpacts,
    },
    blockers: topBlockers,
    applicable,
    fingerprint,
    candidates: candidatePreviews,
  };
}

async function isActiveReferenceConfiguration(
  tx: TransactionDb,
  entity: ProvenanceRecordTable,
  row: Record<string, unknown>,
  activeTermIds: ReadonlySet<string>,
  activeSchoolYears: ReadonlySet<string>,
  now: Date,
): Promise<boolean> {
  if (row.active === true) return true;
  if (entity === "Term") return activeTermIds.has(String(row.id));
  if (entity === "TimeSlot") {
    if (!activeTermIds.size) return false;
    const used = await tx.pairing.count({
      where: {
        timeSlotId: String(row.id),
        termId: { in: [...activeTermIds] },
      },
    });
    return used > 0;
  }
  if (entity === "Room") {
    if (!activeTermIds.size) return false;
    const used = await tx.pairing.count({
      where: { roomId: String(row.id), termId: { in: [...activeTermIds] } },
    });
    return used > 0;
  }
  if (entity === "Subject") {
    if (!activeTermIds.size) return false;
    const used = await tx.pairing.count({
      where: {
        subject: String(row.name),
        termId: { in: [...activeTermIds] },
      },
    });
    return used > 0;
  }
  if (entity === "CourseGroup") {
    const subjects = await tx.subject.findMany({
      where: { groupId: String(row.id) },
      select: { name: true },
    });
    if (!subjects.length || !activeTermIds.size) return false;
    const used = await tx.pairing.count({
      where: {
        subject: { in: subjects.map((s) => s.name) },
        termId: { in: [...activeTermIds] },
      },
    });
    return used > 0;
  }
  if (entity === "SubjectLevel") {
    const subjects = await tx.subject.findMany({
      where: { levelId: String(row.id) },
      select: { name: true },
    });
    if (!subjects.length || !activeTermIds.size) return false;
    const used = await tx.pairing.count({
      where: {
        subject: { in: subjects.map((s) => s.name) },
        termId: { in: [...activeTermIds] },
      },
    });
    return used > 0;
  }
  if (entity === "RoomUnavailability") {
    const dt =
      typeof row.date === "string" || row.date instanceof Date
        ? new Date(row.date)
        : null;
    return !!dt && Number.isFinite(dt.getTime()) && dt.getTime() >= now.getTime();
  }
  if (entity === "SchoolCalendarDay") {
    if (typeof row.schoolYear === "string" && activeSchoolYears.has(row.schoolYear))
      return true;
    if (typeof row.date === "string") {
      const today = now.toISOString().slice(0, 10);
      return row.date >= today;
    }
  }
  return false;
}

async function checkLiveParentBoundaries(
  tx: TransactionDb,
  candidate: ValidatedCandidate,
  row: Record<string, unknown>,
  activeTermIds: ReadonlySet<string>,
  batchMarkingSessions: ReadonlySet<string>,
  now: Date,
): Promise<{
  isLiveNative: boolean;
  signals: string[];
  warnings: string[];
  blockers: ProvenanceBlocker[];
}> {
  const signals: string[] = [];
  const warnings: string[] = [];
  const blockers: ProvenanceBlocker[] = [];
  let isLiveNative = false;

  if (candidate.entity === "Session") {
    const pairing =
      typeof row.pairingId === "string"
        ? await tx.pairing.findUnique({
            where: { id: row.pairingId },
            select: { termId: true },
          })
        : null;
    if (pairing && activeTermIds.has(pairing.termId)) {
      isLiveNative = true;
      signals.push("ACTIVE_TERM_SESSION");
      blockers.push({
        code: "ACTIVE_TERM_RECORD_CANNOT_BE_ARCHIVED",
        message:
          "Session belongs to an active term; classify only historical archive sessions.",
      });
    }
    const blockPrimary = String(row.mergeGroupId ?? row.id);
    const siblings = await tx.session.findMany({
      where: { OR: [{ id: blockPrimary }, { mergeGroupId: blockPrimary }] },
      select: { id: true },
    });
    if (siblings.length > 1) {
      const otherIds = siblings
        .map((s) => s.id)
        .filter((id) => id !== candidate.recordId);
      const otherImported = await tx.importedRecordProvenance.findMany({
        where: { entity: "Session", recordId: { in: otherIds } },
        select: { recordId: true },
      });
      const markedSet = new Set([
        ...otherImported.map((r) => r.recordId),
        ...batchMarkingSessions,
      ]);
      if (otherIds.some((id) => !markedSet.has(id))) {
        signals.push("MIXED_ORIGIN_MERGED_BLOCK");
        warnings.push(
          "Merged session block contains unclassified sibling sessions; classifying this session freezes slot propagation and flag reconsideration for the whole merged block.",
        );
      }
    }
  } else if (candidate.entity === "SessionTutee") {
    const session = await tx.session.findUnique({
      where: { id: String(candidate.key.sessionId) },
      select: { pairing: { select: { termId: true } } },
    });
    if (session?.pairing && activeTermIds.has(session.pairing.termId)) {
      isLiveNative = true;
      signals.push("ACTIVE_TERM_SESSION");
      blockers.push({
        code: "ACTIVE_TERM_RECORD_CANNOT_BE_ARCHIVED",
        message:
          "SessionTutee belongs to a session in an active term; classify only historical archive records.",
      });
    }
  } else if (candidate.entity === "Pairing" || candidate.entity === "PairingGroup") {
    if (typeof row.termId === "string" && activeTermIds.has(row.termId)) {
      isLiveNative = true;
      signals.push("ACTIVE_TERM_PAIRING");
      blockers.push({
        code: "ACTIVE_TERM_RECORD_CANNOT_BE_ARCHIVED",
        message: `${candidate.entity} belongs to an active term and cannot be archived.`,
      });
    }
  } else if (candidate.entity === "PairingTutee") {
    const pairing = await tx.pairing.findUnique({
      where: { id: String(candidate.key.pairingId) },
      select: { termId: true },
    });
    if (pairing && activeTermIds.has(pairing.termId)) {
      isLiveNative = true;
      signals.push("ACTIVE_TERM_PAIRING");
      blockers.push({
        code: "ACTIVE_TERM_RECORD_CANNOT_BE_ARCHIVED",
        message: "PairingTutee belongs to an active term and cannot be archived.",
      });
    }
  } else if (candidate.entity === "MeetingAttendance") {
    const meeting = await tx.tutorMeeting.findUnique({
      where: { id: String(row.meetingId) },
      select: { date: true },
    });
    if (meeting && meeting.date.getTime() > now.getTime()) {
      isLiveNative = true;
      signals.push("UPCOMING_MEETING_ATTENDANCE");
      blockers.push({
        code: "ACTIVE_OR_LIVE_RECORD_CANNOT_BE_ARCHIVED",
        message: "MeetingAttendance belongs to an upcoming meeting.",
      });
    }
  } else if (
    candidate.entity === "InterviewAssignment" ||
    candidate.entity === "InterviewVote" ||
    candidate.entity === "ApplicationSubjectIntent"
  ) {
    const appId =
      candidate.entity === "ApplicationSubjectIntent"
        ? String(row.applicationId)
        : String(candidate.key.applicationId);
    const app = await tx.tutorApplication.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    if (app && !["ACCEPTED", "REJECTED", "RECALLED"].includes(app.status)) {
      isLiveNative = true;
      signals.push("PENDING_APPLICATION_CHILD");
      blockers.push({
        code: "ACTIVE_OR_LIVE_RECORD_CANNOT_BE_ARCHIVED",
        message: `${candidate.entity} belongs to an active/pending TutorApplication.`,
      });
    }
  } else if (
    candidate.entity === "TutorQualification" ||
    candidate.entity === "QualificationGrant"
  ) {
    const tutor = await tx.tutor.findUnique({
      where: { id: String(candidate.key.tutorId) },
      select: { status: true },
    });
    if (tutor?.status === "ACTIVE") {
      isLiveNative = true;
      signals.push("ACTIVE_TUTOR_MEMBERSHIP");
      blockers.push({
        code: "ACTIVE_MEMBERSHIP_RECORD_CANNOT_BE_ARCHIVED",
        message: `${candidate.entity} belongs to an ACTIVE tutor; preserve current memberships.`,
      });
    }
  }

  return { isLiveNative, signals, warnings, blockers };
}

async function acquireSharedWriterFences(
  tx: TransactionDb,
  candidates: readonly ValidatedCandidate[],
  actorId: string,
) {
  const hasAttendance = candidates.some(
    (c) => c.entity === "Session" || c.entity === "SessionTutee",
  );
  const hasFinancial = candidates.some((c) => FINANCIAL_TABLES.has(c.entity));

  // Canonical global lock order matching checkpoint.ts, school-hours.ts, and record-transfer.ts.
  if (hasAttendance) await lockAttendanceSchedule(tx, false);
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockAccountProfile(tx, actorId);
  if (hasFinancial) await lockEntity(tx, SCHOOL_HOURS_LOCK);
  await lockEntity(tx, "program-record-transfer");

  const meetingIds = new Set<string>();
  const meetingTutorIds = new Set<string>();
  const applicationIds = new Set<string>();
  const sessionIds = new Set<string>();
  const tuteeIds = new Set<string>();
  const tutorIds = new Set<string>();

  for (const c of candidates) {
    if (c.entity === "TutorMeeting") meetingIds.add(c.recordId);
    else if (c.entity === "MeetingAttendance") {
      const row = await tx.meetingAttendance.findUnique({
        where: { id: c.recordId },
        select: { meetingId: true, tutorId: true },
      });
      if (row) {
        meetingIds.add(row.meetingId);
        meetingTutorIds.add(row.tutorId);
      }
    } else if (c.entity === "ServiceHourAdjustment") {
      const row = await tx.serviceHourAdjustment.findUnique({
        where: { id: c.recordId },
        select: { tutorId: true },
      });
      if (row && c.recordId.startsWith("mtgabs_")) {
        meetingTutorIds.add(row.tutorId);
      }
      if (c.recordId.startsWith("flag:")) {
        const flag = await tx.sessionFlag.findUnique({
          where: { id: c.recordId.slice(5) },
          select: { sessionId: true },
        });
        if (flag) sessionIds.add(flag.sessionId);
      } else if (c.recordId.startsWith("interview_")) {
        const apps = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "TutorApplication" WHERE ${c.recordId} LIKE 'interview_' || id || '_%'
        `);
        for (const a of apps) applicationIds.add(a.id);
      }
    } else if (c.entity === "TutorApplication") {
      applicationIds.add(c.recordId);
    } else if (
      c.entity === "InterviewAssignment" ||
      c.entity === "InterviewVote"
    ) {
      applicationIds.add(String(c.key.applicationId));
    } else if (c.entity === "ApplicationSubjectIntent") {
      const row = await tx.applicationSubjectIntent.findUnique({
        where: { id: c.recordId },
        select: { applicationId: true },
      });
      if (row) applicationIds.add(row.applicationId);
    } else if (c.entity === "Session") {
      sessionIds.add(c.recordId);
    } else if (c.entity === "SessionTutee") {
      sessionIds.add(String(c.key.sessionId));
      tuteeIds.add(String(c.key.tuteeId));
    } else if (c.entity === "SessionFlag") {
      const row = await tx.sessionFlag.findUnique({
        where: { id: c.recordId },
        select: { sessionId: true },
      });
      if (row) sessionIds.add(row.sessionId);
    } else if (c.entity === "PatrolObservation") {
      // PatrolObservation carries room/time evidence without a direct session FK.
    } else if (c.entity === "Tutee") {
      tuteeIds.add(c.recordId);
    } else if (c.entity === "TuteeRemovalRequest") {
      const row = await tx.tuteeRemovalRequest.findUnique({
        where: { id: c.recordId },
        select: { tuteeId: true },
      });
      if (row) tuteeIds.add(row.tuteeId);
    } else if (c.entity === "DisciplinaryCard") {
      const row = await tx.disciplinaryCard.findUnique({
        where: { id: c.recordId },
        select: { tuteeId: true },
      });
      if (row) tuteeIds.add(row.tuteeId);
    } else if (c.entity === "Tutor") {
      tutorIds.add(c.recordId);
    }
  }

  for (const id of [...meetingIds].sort())
    await lockEntity(tx, `meeting-record:${id}`);
  for (const id of [...meetingTutorIds].sort())
    await lockEntity(tx, `meeting-hours:${id}`);
  for (const id of [...applicationIds].sort())
    await lockApplicationReview(tx, id);
  if (sessionIds.size) await lockImportedSessionSources(tx, sessionIds, []);
  for (const id of [...tuteeIds].sort()) await lockEntity(tx, `tutee:${id}`);
  for (const id of [...tutorIds].sort())
    await lockEntity(tx, `membership:tutor:${id}`);
}

export type AppliedProvenanceReceipt = {
  version: 1;
  receiptId: string;
  actorId: string;
  planHash: string;
  fingerprint: string;
  reason: string;
  channel: string;
  createdAt: string;
  replayed: boolean;
  summary: {
    markedCount: number;
    releasedCount: number;
    noOpCount: number;
    entityCounts: Record<string, number>;
  };
  subjects: ProvenanceRecoveryReference[];
};

const receiptEvidenceSchema = z.object({
  version: z.literal(1),
  evidenceLabel: z.string(),
  sourceRevision: z.string().nullable(),
  markedCount: z.number().int().min(0),
  releasedCount: z.number().int().min(0),
  noOpCount: z.number().int().min(0),
  entityCounts: z.record(z.string(), z.number().int().min(0)),
});

function projectReceipt(
  row: {
    id: string;
    actorId: string;
    planHash: string;
    fingerprint: string;
    reason: string;
    channel: string;
    evidence: unknown;
    subjects: unknown;
    createdAt: Date;
  },
  replayed: boolean,
): AppliedProvenanceReceipt {
  const parsedEvidence = receiptEvidenceSchema.safeParse(row.evidence);
  const subjects = z
    .array(z.object({ entity: z.string(), recordId: z.string() }))
    .safeParse(row.subjects);
  return {
    version: 1,
    receiptId: row.id,
    actorId: row.actorId,
    planHash: row.planHash,
    fingerprint: row.fingerprint,
    reason: row.reason,
    channel: row.channel,
    createdAt: row.createdAt.toISOString(),
    replayed,
    summary: parsedEvidence.success
      ? {
          markedCount: parsedEvidence.data.markedCount,
          releasedCount: parsedEvidence.data.releasedCount,
          noOpCount: parsedEvidence.data.noOpCount,
          entityCounts: parsedEvidence.data.entityCounts,
        }
      : { markedCount: 0, releasedCount: 0, noOpCount: 0, entityCounts: {} },
    subjects: subjects.success ? subjects.data : [],
  };
}

/** Apply an explicitly operator-reviewed archive provenance plan inside a
 * Serializable transaction with shared writer fences, fresh hash/authority
 * verification, idempotent receipt persistence, and zero mutation to source
 * amounts or current memberships. */
export async function applyArchiveProvenanceFromOperator(
  db: DomainDb,
  input: {
    candidates: ProvenanceCandidateFile;
    planHash: string;
    expectedFingerprint: string;
    sourceRevision?: string;
    reason: string;
    clientKey: string;
  },
  actor: { id: string },
): Promise<AppliedProvenanceReceipt> {
  const parsedFile = provenanceCandidateFileSchema.parse(input.candidates);
  const validated = validateCandidates(parsedFile);
  const reason = input.reason.trim();
  operatorAssert(reason.length >= 1 && reason.length <= 1000, "INVALID_REASON");
  operatorAssert(
    /^[a-f0-9]{64}$/.test(input.planHash),
    "INVALID_PLAN_HASH",
  );
  operatorAssert(
    /^[a-f0-9]{64}$/.test(input.expectedFingerprint),
    "INVALID_FINGERPRINT",
  );
  operatorAssert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.clientKey,
    ),
    "INVALID_CLIENT_KEY",
  );

  const inputHash = planHash({
    version: 1,
    planHash: input.planHash,
    expectedFingerprint: input.expectedFingerprint,
    reason,
    candidates: validated.map((c) => ({
      entity: c.entity,
      recordId: c.recordId,
      action: c.action,
      expectedRowHash: c.expectedRowHash ?? null,
    })),
  });

  return inTransaction(
    db,
    async (tx) => {
      await acquireSharedWriterFences(tx, validated, actor.id);
      const user = await authorizeOperator(tx, actor.id);

      const existing = await tx.archiveProvenanceReceipt.findUnique({
        where: {
          actorId_clientKey: { actorId: actor.id, clientKey: input.clientKey },
        },
      });
      if (existing) {
        operatorAssert(existing.inputHash === inputHash, "CLIENT_KEY_REUSED");
        return projectReceipt(existing, true);
      }

      const fresh = await previewArchiveProvenance(tx, parsedFile, {
        actorId: actor.id,
        sourceRevision: input.sourceRevision,
      });
      operatorAssert(
        fresh.fingerprint === input.expectedFingerprint,
        "STALE_PROVENANCE_PLAN",
      );
      operatorAssert(
        fresh.applicable && fresh.blockers.length === 0,
        "PROVENANCE_PLAN_BLOCKED",
      );

      let markedCount = 0;
      let releasedCount = 0;
      let noOpCount = 0;
      const entityCounts: Record<string, number> = {};
      const subjectMap = new Map<string, ProvenanceRecoveryReference>();

      for (const item of fresh.candidates) {
        if (item.proposedAction === "NO_OP") {
          noOpCount++;
          continue;
        }
        entityCounts[item.entity] = (entityCounts[item.entity] ?? 0) + 1;
        for (const ref of item.recoveryReferences) {
          subjectMap.set(`${ref.entity}\0${ref.recordId}`, ref);
        }
        if (item.proposedAction === "MARK_IMPORTED") {
          await tx.importedRecordProvenance.create({
            data: { entity: item.entity, recordId: item.recordId },
          });
          markedCount++;
        } else {
          await tx.importedRecordProvenance.delete({
            where: {
              entity_recordId: {
                entity: item.entity,
                recordId: item.recordId,
              },
            },
          });
          releasedCount++;
        }
      }

      const subjects = [...subjectMap.values()].sort((a, b) => {
        const cmp = a.entity.localeCompare(b.entity);
        return cmp !== 0 ? cmp : a.recordId.localeCompare(b.recordId);
      });

      const evidence = {
        version: 1 as const,
        evidenceLabel: fresh.evidenceLabel,
        sourceRevision: fresh.sourceRevision,
        schemaRevision: fresh.schemaRevision,
        markedCount,
        releasedCount,
        noOpCount,
        entityCounts,
        schoolHoursBeforeHash: fresh.schoolHours.beforeContentHash,
        schoolHoursAfterHash: fresh.schoolHours.afterContentHash,
      };

      const receipt = await tx.archiveProvenanceReceipt.create({
        data: {
          actorId: actor.id,
          clientKey: input.clientKey,
          inputHash,
          planHash: input.planHash,
          fingerprint: fresh.fingerprint,
          reason,
          channel: "OPERATOR",
          evidence,
          subjects,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          userName: user.name,
          action: "Reconciled archive provenance",
          entity: "ArchiveProvenanceReceipt",
          entityId: receipt.id,
          operation: "recovery.archiveProvenance",
          details: {
            receiptId: receipt.id,
            evidenceLabel: fresh.evidenceLabel,
            planHash: input.planHash,
            fingerprint: fresh.fingerprint,
            markedCount,
            releasedCount,
            noOpCount,
            entityCounts,
          },
        },
      });

      return projectReceipt(receipt, false);
    },
    { isolationLevel: "Serializable" },
  );
}

/** Read-only safe projection of a durable archive provenance receipt. */
export async function readArchiveProvenanceReceipt(
  tx: TransactionDb,
  receiptId: string,
  actorId: string,
): Promise<AppliedProvenanceReceipt | null> {
  await authorizeOperator(tx, actorId);
  const row = await tx.archiveProvenanceReceipt.findUnique({
    where: { id: receiptId },
  });
  return row ? projectReceipt(row, false) : null;
}
