/** Read-only security gap evidence. This module never authorizes reopening or cutover. */
import { operatorAssert, OperatorError } from "./operator-cli";
import { readDatabaseRecoveryMarker } from "./operator-marker";
import {
  acquireRecoverySchedulingFences,
  invalidateReconciledSchedulingMaintenance,
} from "./operator-maintenance";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { planHash, readOperatorPlan, writeOperatorJson } from "./operator-plan";
import {
  credentials,
  inspectCurrentEvidence,
  sitePlanSchema,
  siteStageReceiptSchema,
  validateStagedSite,
  withSealedSiteTarget,
  type OperatorSql,
  type SiteDependencies,
} from "./operator-site";
import { assertReviewedRecoverySchema } from "./operator-schema";
import { readReceiptGuardMetadata } from "./receipt-guard-metadata";
import {
  appendIdentityEvidence,
  assertIdentityAuthorityClosure,
  credentialRetirementOrder,
  IDENTITY_AUTHORITY_TABLES,
  IDENTITY_EVIDENCE_TABLES,
  IDENTITY_REFERENCE_TABLES,
  reconcileIdentityAuthority,
} from "./operator-identity";

const MAX_SECURITY_ROWS = 10_000;
// Positive projections keep contact details, passwords, token hashes and private
// reasons out of operator comparison evidence. Exact state is compared by ID.
const SECURITY_PROJECTIONS = [
  {
    table: "User",
    fields: [
      "id",
      "role",
      "tutorAccessRevoked",
      "tuteeMember",
      "crewStatus",
      "canTranslate",
      "suspendedAt",
      "mergedIntoId",
      "recoveryVoidedAt",
      "sessionVersion",
      "refreshAuthorityRevision",
      "tutorId",
      "studentId",
      "personId",
      "twoFactorEnabled",
    ],
  },
  {
    table: "Tutor",
    fields: ["id", "status", "personId", "historyIdentityRevision"],
  },
  {
    table: "Tutee",
    fields: ["id", "status", "personId", "historyIdentityRevision"],
  },
  {
    table: "Person",
    fields: [
      "id",
      "primaryUserId",
      "mergedIntoId",
      "resolutionState",
      "revision",
    ],
  },
  { table: "TutorProfileOwnership", fields: ["tutorId", "userId", "revision"] },
  {
    table: "StudentProfileOwnership",
    fields: ["tuteeId", "userId", "revision"],
  },
  {
    table: "SchoolDeparture",
    fields: [
      "userId",
      "effectiveAt",
      "confirmedAt",
      "revision",
      "observerRevoked",
      "tutorDerived",
    ],
  },
] as const;

// Every known capability-bearing table is an explicit cutover review surface.
// Counting all rows is conservative: this report never certifies a token dead
// merely because one timestamp or a completion marker looks terminal.
const CAPABILITY_TABLES = [
  "ViewerSignup",
  "RegistrationCode",
  "AccountInvitation",
  "CrewSignupVerification",
  "EmailVerificationCode",
  "PasswordResetToken",
  "StudentSignup",
  "StudentSurvey",
  "StudentSignupIntent",
  "StudentSignupNotice",
  "TuteeHistoryInvitation",
  "TuteeHistoryInvitationAttempt",
  "HistoricalRecordInvitation",
  "HistoricalRecordInvitationAttempt",
  "HistoricalRecordClaimReceipt",
  "StudentActionConfirmation",
  "SchoolHoursReport",
  "SessionCalendarToken",
  "CaptchaGrant",
  "CaptchaProof",
] as const;

type SecurityManifest = {
  version: 1;
  schemaFingerprint: string;
  security: Record<string, Record<string, unknown>[]>;
  credentials: {
    passwordBearingAccounts: string;
    capabilityRows: { table: string; count: string }[];
  };
  replay: { table: string; count: string }[];
};

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function securityManifest(db: OperatorSql): Promise<SecurityManifest> {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const schema =
      await db.query(`SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns WHERE table_schema='public'
      ORDER BY table_name, ordinal_position LIMIT 10001`);
    operatorAssert(schema.rows.length <= 10_000, "SECURITY_SCHEMA_TOO_LARGE");
    const security: SecurityManifest["security"] = {};
    let records = 0;
    for (const projection of SECURITY_PROJECTIONS) {
      const { rows } =
        await db.query(`SELECT ${projection.fields.map(quote).join(",")}
        FROM public.${quote(projection.table)} ORDER BY ${projection.fields.map(quote).join(",")} LIMIT ${MAX_SECURITY_ROWS + 1}`);
      records += rows.length;
      operatorAssert(
        records <= MAX_SECURITY_ROWS,
        "SECURITY_MANIFEST_TOO_LARGE",
      );
      // node-postgres timestamps are Date objects; normalize them before the
      // canonical hash so two different restriction timestamps cannot compare equal.
      security[projection.table] = JSON.parse(JSON.stringify(rows)) as Record<
        string,
        unknown
      >[];
    }
    const password = await db.query(
      'SELECT count(*)::text AS count FROM public."User" WHERE "passwordHash" IS NOT NULL',
    );
    const countTables = async (tables: readonly string[]) => {
      const counts: { table: string; count: string }[] = [];
      for (const table of tables) {
        const { rows } = await db.query(
          `SELECT count(*)::text AS count FROM public.${quote(table)}`,
        );
        const count = String(rows[0]?.count);
        operatorAssert(/^\d+$/.test(count), "INVALID_SECURITY_ROW_COUNT");
        counts.push({ table, count });
      }
      return counts;
    };
    const capabilityRows = await countTables(CAPABILITY_TABLES);
    const replay = await countTables([
      "EmailDelivery",
      "SessionNotice",
      "ScheduledProgramRefresh",
      "MonthlyHoursSchedule",
      "SchoolHoursSchedule",
    ]);
    const passwordBearingAccounts = String(password.rows[0]?.count);
    operatorAssert(
      /^\d+$/.test(passwordBearingAccounts),
      "INVALID_SECURITY_ROW_COUNT",
    );
    await db.query("COMMIT");
    return {
      version: 1,
      schemaFingerprint: planHash(schema.rows),
      security,
      credentials: { passwordBearingAccounts, capabilityRows },
      replay,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/** Caller controls isolated operator connections and must reseal after inspection. */
export async function inspectSiteSecurityReconciliation(
  source: OperatorSql,
  restored: OperatorSql,
) {
  // Serial reads keep this inspection bounded. Their fingerprints describe two
  // snapshots, not a cross-instance atomic checkpoint or an approved write plan.
  const current = await securityManifest(source);
  const checkpoint = await securityManifest(restored);
  const comparison = SECURITY_PROJECTIONS.map(({ table }) => ({
    table,
    currentRows: current.security[table]?.length ?? 0,
    restoredRows: checkpoint.security[table]?.length ?? 0,
    changed:
      planHash(current.security[table]) !==
      planHash(checkpoint.security[table]),
  }));
  return {
    version: 1,
    kind: "site-security-reconciliation-inspection",
    state: "BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW",
    fingerprint: planHash({ version: 1, current, checkpoint }),
    currentFingerprint: planHash(current),
    restoredFingerprint: planHash(checkpoint),
    schemaMatches: current.schemaFingerprint === checkpoint.schemaFingerprint,
    comparison,
    restoredCredentials: checkpoint.credentials,
    restoredReplaySurfaces: checkpoint.replay,
    blockers: [
      "RECONCILE_CURRENT_REVOCATIONS_RETIREMENTS_DEPARTURES_AND_INDEPENDENT_ACCESS",
      "REVIEW_MISSING_IDENTITIES_AND_FOREIGN_KEY_OWNERSHIP",
      "INVALIDATE_ALL_RESTORED_PASSWORDS_SESSIONS_AND_CAPABILITIES",
      "ROTATE_AUTH_SECRET_OR_ESTABLISH_NONREUSABLE_SESSION_EPOCHS",
      "RECONCILE_OUTBOUND_DELIVERY_DEADLINES_STORAGE_AND_EXTERNAL_EFFECTS",
      "REVIEW_APPLICATION_SCHEMA_AND_EXPLICIT_MANUAL_CUTOVER",
    ],
  };
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const siteReconciliationPlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-reconcile"),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    stagePlan: sitePlanSchema,
    stageReceipt: siteStageReceiptSchema,
    sourceFingerprint: digestSchema,
    restoredFingerprint: digestSchema,
    previousSigningKeyFingerprint: digestSchema,
    rotatedSigningKeyFingerprint: digestSchema,
    credentialGenerations: z
      .array(
        z
          .object({
            userId: z.string(),
            current: z.number().int().nonnegative().nullable(),
            checkpoint: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(10000),
    policyRevision: z.literal(1),
  })
  .strict();
export type SiteReconciliationPlan = z.infer<
  typeof siteReconciliationPlanSchema
>;
export interface RecoverySigningSecrets {
  previousAuthSecret: string;
  rotatedAuthSecret: string;
}
export function signingKeyFingerprint(secret: string) {
  operatorAssert(
    secret.length >= 32 && Buffer.byteLength(secret) <= 4096,
    "INVALID_RECOVERY_SIGNING_SECRET",
  );
  return createHash("sha256").update(secret).digest("hex");
}
export function assertRotatedSigningSecrets(
  secrets: RecoverySigningSecrets,
  expected?: {
    previousSigningKeyFingerprint: string;
    rotatedSigningKeyFingerprint: string;
  },
) {
  const previousSigningKeyFingerprint = signingKeyFingerprint(
    secrets.previousAuthSecret,
  );
  const rotatedSigningKeyFingerprint = signingKeyFingerprint(
    secrets.rotatedAuthSecret,
  );
  operatorAssert(
    previousSigningKeyFingerprint !== rotatedSigningKeyFingerprint,
    "RECOVERY_SIGNING_SECRET_MUST_ROTATE",
  );
  if (expected)
    operatorAssert(
      expected.previousSigningKeyFingerprint ===
        previousSigningKeyFingerprint &&
        expected.rotatedSigningKeyFingerprint === rotatedSigningKeyFingerprint,
      "RECOVERY_SIGNING_SECRET_MISMATCH",
    );
  return { previousSigningKeyFingerprint, rotatedSigningKeyFingerprint };
}

// Password hashes never enter this source projection. Every account receives a
// fresh generation and no password; credential setup remains a new authorization.
const ACCOUNT_FIELDS = [
  "id",
  "name",
  "firstName",
  "lastName",
  "preferredName",
  "legacyName",
  "alternativeNames",
  "profileVersion",
  "email",
  "username",
  "emailSecurity",
  "emailMessages",
  "emailInfo",
  "emailReviewRequests",
  "emailEventReminders",
  "emailSecondaryRecipients",
  "mustChangePassword",
  "twoFactorEnabled",
  "emailVerifiedAt",
  "role",
  "tuteeMember",
  "tutorAccessRevoked",
  "canTranslate",
  "crewStatus",
  "gradeLevel",
  "affiliation",
  "suspendedAt",
  "suspendedReason",
  "recoveryVoidedAt",
  "mergedIntoId",
  "tutorId",
  "studentId",
  "personId",
  "sessionVersion",
  "refreshAuthorityRevision",
  "createdAt",
] as const;
const OVERLAY_TABLES = [
  "Tutor",
  "Tutee",
  "Person",
  "TutorProfileOwnership",
  "StudentProfileOwnership",
  "SchoolDeparture",
  "SchoolDepartureEvent",
  "AccountEmail",
  "NotificationPreference",
  "ProgramSettings",
  "ProgramFeature",
  "EmailDelivery",
  "SessionNotice",
  "MessagePermission",
  "MessageRestriction",
  "TutorQualification",
  "QualificationGrant",
] as const;
const DIVERGENCE_AUTHORITIES = [
  "CourseGroup",
  "Subject",
  "SubjectLevel",
  "Term",
  "AcademicProfile",
  "PolicyDocument",
  "PolicyArchive",
  "PolicyAcceptance",
  "DisciplinaryCard",
  "StudentQuarterBlock",
  "TuteeRequestInvalidity",
  "LegacySignupDecline",
  // Permanent deny-only receipts must match exactly: the security overlay must
  // neither drop a stopped operation nor rewrite immutable closure evidence.
  "HistoricalInvitationOperationClosure",
  // Accepted/stop evidence is domain authority, never a security overlay or a
  // capability to expire. Every original receipt field participates in the hash.
  "TranslationIntentReceipt",
  "StudentRequestReview",
  "MessageTutorAssignment",
  "Pairing",
  "PairingTutee",
  "PairingGroup",
  "SessionPlan",
  "SessionPlanAssignment",
  "SessionPlanParticipant",
  "SessionPlanningRequest",
  "SessionPlanningOffer",
  "SessionPlanningResponse",
  "TutorApplication",
  "CrewApplication",
  "ApprovalRequest",
] as const;
export type OverlaySnapshot = {
  identityVersion: 0 | 1;
  accounts: Record<string, unknown>[];
  tables: Record<string, Record<string, unknown>[]>;
  schema: Record<string, unknown>[];
  trigger: Record<string, unknown>;
  capabilityFingerprints: Record<string, unknown>[];
  referenceIdentities: Record<string, string[]>;
  authorityFingerprints: Record<string, unknown>[];
};
const normalizeRows = (rows: Record<string, unknown>[]) =>
  JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
export async function readReconciliationSnapshot(
  db: OperatorSql,
): Promise<OverlaySnapshot> {
  const schema = await db.query(
    "SELECT table_name,column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position LIMIT 10001",
  );
  operatorAssert(schema.rows.length <= 10000, "SECURITY_SCHEMA_TOO_LARGE");
  const enums = await db.query(
    "SELECT t.typname AS type_name,e.enumlabel AS enum_label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder LIMIT 2001",
  );
  operatorAssert(enums.rows.length <= 2000, "SECURITY_SCHEMA_TOO_LARGE");
  const {
    identityVersion,
    legacySignupDecline,
    historicalInvitationOperationClosure,
    translationIntentReceipt,
  } = assertReviewedRecoverySchema(schema.rows, enums.rows);
  // Validate against known contracts before equality/hashing: identical weakened
  // guards on both databases must refuse automatic restore and rollback alike.
  const receiptGuards: Record<string, unknown>[] = [];
  for (const table of [
    ...(historicalInvitationOperationClosure
      ? ["HistoricalInvitationOperationClosure" as const]
      : []),
    ...(translationIntentReceipt ? ["TranslationIntentReceipt" as const] : []),
  ])
    receiptGuards.push({
      table: `${table}:guard`,
      fingerprint: planHash(await readReceiptGuardMetadata(db, table)),
    });
  const trigger =
    await db.query(`SELECT t.tgenabled,t.tgtype,p.proname,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(p.oid) AS function
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public."User"'::regclass AND t.tgname='account_session_version' AND NOT t.tgisinternal`);
  operatorAssert(
    trigger.rows.length === 1 &&
      trigger.rows[0]?.tgenabled === "O" &&
      Number(trigger.rows[0]?.tgtype) === 19 &&
      trigger.rows[0]?.proname === "advance_account_session_version",
    "INVALID_SESSION_GENERATION_TRIGGER",
  );
  const accountFields =
    identityVersion === 1
      ? [...ACCOUNT_FIELDS, "historyAccessRevision"]
      : ACCOUNT_FIELDS;
  const accounts = await db.query(
    `SELECT ${accountFields.map(quote).join(",")} FROM public."User" ORDER BY id LIMIT 10001`,
  );
  let count = accounts.rows.length;
  const tables: OverlaySnapshot["tables"] = {};
  for (const table of [
    ...OVERLAY_TABLES,
    ...(identityVersion === 1
      ? [...IDENTITY_AUTHORITY_TABLES, ...IDENTITY_EVIDENCE_TABLES]
      : []),
  ]) {
    const rows = await db.query(
      `SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text LIMIT 10001`,
    );
    count += rows.rows.length;
    operatorAssert(count <= 10000, "SECURITY_MANIFEST_TOO_LARGE");
    tables[table] = rows.rows.map((row) => row.row as Record<string, unknown>);
  }
  const referenceIdentities: Record<string, string[]> = {};
  if (identityVersion === 1)
    for (const table of IDENTITY_REFERENCE_TABLES) {
      const records = await db.query(
        `SELECT id FROM public.${quote(table)} ORDER BY id LIMIT 10001`,
      );
      count += records.rows.length;
      operatorAssert(count <= 10000, "SECURITY_MANIFEST_TOO_LARGE");
      referenceIdentities[table] = records.rows.map((row) => String(row.id));
    }
  const authorityFingerprints: Record<string, unknown>[] = [...receiptGuards];
  for (const table of [
    ...DIVERGENCE_AUTHORITIES.filter(
      (table) =>
        (table !== "LegacySignupDecline" || legacySignupDecline) &&
        (table !== "HistoricalInvitationOperationClosure" ||
          historicalInvitationOperationClosure) &&
        (table !== "TranslationIntentReceipt" || translationIntentReceipt),
    ),
    // A security overlay cannot restore historical financial/workflow records
    // while dropping the operational boundary that keeps them archive-only.
    ...(schema.rows.some((row) => row.table_name === "ImportedRecordProvenance")
      ? ["ImportedRecordProvenance"]
      : []),
    "StudentSurvey",
  ]) {
    const records = await db.query(
      `SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text LIMIT 10001`,
    );
    operatorAssert(records.rows.length <= 10000, "SECURITY_MANIFEST_TOO_LARGE");
    const values = records.rows.map((record) => {
      const row = record.row as Record<string, unknown>;
      if (table === "LegacySignupDecline")
        return Object.fromEntries(
          Object.entries(row).filter(
            ([field]) => !["clientKey", "inputHash"].includes(field),
          ),
        );
      if (table !== "StudentSurvey") return row;
      // These are separately invalidated bearer mechanics, not enrollment authority.
      return Object.fromEntries(
        Object.entries(row).filter(
          ([field]) =>
            ![
              "tokenHash",
              "expiresAt",
              "verificationAttempts",
              "emailCodeVersion",
              "lastLinkSentAt",
            ].includes(field),
        ),
      );
    });
    authorityFingerprints.push({ table, fingerprint: planHash(values) });
  }
  const capabilityFingerprints: Record<string, unknown>[] = [];
  for (const table of [
    ...new Set([
      ...CAPABILITY_TABLES,
      "EmailDelivery",
      "SessionNotice",
      "ScheduledProgramRefresh",
      "MonthlyHoursSchedule",
      "SchoolHoursSchedule",
      "SignupLease",
    ]),
  ]) {
    const size = await db.query(
      `SELECT count(*)::text AS count FROM public.${quote(table)}`,
    );
    operatorAssert(
      Number(size.rows[0]?.count) <= 10000,
      "SECURITY_MANIFEST_TOO_LARGE",
    );
    const digest = await db.query(
      `SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS fingerprint FROM public.${quote(table)} t`,
    );
    capabilityFingerprints.push({
      table,
      count: size.rows[0]?.count,
      fingerprint: digest.rows[0]?.fingerprint,
    });
  }
  return {
    identityVersion,
    accounts: normalizeRows(accounts.rows),
    tables,
    schema: [
      ...schema.rows,
      ...enums.rows.map((row) => ({ metadataKind: "enum", ...row })),
    ],
    trigger: trigger.rows[0],
    capabilityFingerprints,
    referenceIdentities,
    authorityFingerprints,
  };
}
async function sourceSnapshot(db: OperatorSql) {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await readReconciliationSnapshot(db);
    await db.query("COMMIT");
    return state;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
function byId(rows: Record<string, unknown>[], field = "id") {
  return new Map(rows.map((row) => [String(row[field]), row]));
}
function credentialGenerations(
  current: OverlaySnapshot,
  restored: OverlaySnapshot,
) {
  const now = byId(current.accounts),
    old = byId(restored.accounts);
  return [...new Set([...now.keys(), ...old.keys()])].sort().map((userId) => ({
    userId,
    current: now.has(userId) ? Number(now.get(userId)?.sessionVersion) : null,
    checkpoint: old.has(userId)
      ? Number(old.get(userId)?.sessionVersion)
      : null,
  }));
}
export function validateSecurityIdentityClosure(
  current: OverlaySnapshot,
  restored: OverlaySnapshot,
) {
  operatorAssert(
    planHash(current.schema) === planHash(restored.schema),
    "RECOVERY_SCHEMA_MISMATCH",
  );
  operatorAssert(
    planHash(current.trigger) === planHash(restored.trigger),
    "SESSION_GENERATION_TRIGGER_MISMATCH",
  );
  operatorAssert(
    planHash(current.authorityFingerprints) ===
      planHash(restored.authorityFingerprints),
    "CURRENT_AUTHORITY_REQUIRES_DOMAIN_RECONCILIATION",
  );
  const currentUsers = byId(current.accounts),
    restoredUsers = byId(restored.accounts);
  const userIds = new Set([...currentUsers.keys(), ...restoredUsers.keys()]);
  // Import a current-only account only when its complete referenced identity
  // closure already exists. Domain profile/person creation is never inferred.
  for (const table of ["Tutor", "Tutee"]) {
    const target = byId(restored.tables[table] ?? []);
    for (const row of current.tables[table] ?? [])
      operatorAssert(
        target.has(String(row.id)),
        "CURRENT_SECURITY_IDENTITY_NOT_IN_CHECKPOINT",
      );
  }
  const tutorIds = new Set(
    (restored.tables.Tutor ?? []).map((row) => String(row.id)),
  );
  const studentIds = new Set(
    (restored.tables.Tutee ?? []).map((row) => String(row.id)),
  );
  const personIds = new Set(
    [...(restored.tables.Person ?? []), ...(current.tables.Person ?? [])].map(
      (row) => String(row.id),
    ),
  );
  for (const row of current.accounts) {
    for (const [field, ids] of [
      ["tutorId", tutorIds],
      ["studentId", studentIds],
      ["personId", personIds],
      ["mergedIntoId", userIds],
    ] as const) {
      const value = row[field];
      operatorAssert(
        value === null || (typeof value === "string" && ids.has(value)),
        "SECURITY_IDENTITY_CLOSURE_MISSING",
      );
    }
    const old = restoredUsers.get(String(row.id));
    operatorAssert(
      !old?.mergedIntoId || old.mergedIntoId === row.mergedIntoId,
      "CONTRADICTORY_RETIRED_IDENTITY",
    );
    operatorAssert(
      !old?.recoveryVoidedAt || row.recoveryVoidedAt !== null,
      "CONTRADICTORY_VOIDED_IDENTITY",
    );
    const emailOwner = restored.accounts.find(
      (account) => account.email === row.email && account.id !== row.id,
    );
    operatorAssert(!emailOwner, "CONTRADICTORY_ACCOUNT_IDENTIFIER");
    for (const field of [
      "sessionVersion",
      "refreshAuthorityRevision",
      ...(current.identityVersion === 1 ? ["historyAccessRevision"] : []),
    ]) {
      const value = Math.max(Number(row[field]), Number(old?.[field] ?? -1));
      operatorAssert(
        Number.isSafeInteger(value) && value >= 0 && value < 2147483647,
        "RECOVERY_SECURITY_EPOCH_EXHAUSTED",
      );
    }
  }
  for (const row of restored.accounts)
    for (const field of [
      "sessionVersion",
      "refreshAuthorityRevision",
      ...(restored.identityVersion === 1 ? ["historyAccessRevision"] : []),
    ])
      operatorAssert(
        Number.isSafeInteger(Number(row[field])) &&
          Number(row[field]) >= 0 &&
          Number(row[field]) < 2147483647,
        "RECOVERY_SECURITY_EPOCH_EXHAUSTED",
      );
  for (const row of current.tables.AccountEmail ?? [])
    operatorAssert(
      userIds.has(String(row.userId)),
      "SECURITY_ALIAS_OWNER_MISSING",
    );
  for (const row of current.tables.MessageRestriction ?? [])
    operatorAssert(
      userIds.has(String(row.userId)),
      "SECURITY_MESSAGE_OWNER_MISSING",
    );
  for (const row of current.tables.MessagePermission ?? [])
    operatorAssert(
      (String(row.scope).startsWith("USER:") &&
        userIds.has(String(row.scope).slice(5))) ||
        /^ROLE:(HEAD|ADMIN|COORDINATOR|TUTOR|CREW|STUDENT|VIEWER)$/.test(
          String(row.scope),
        ),
      "SECURITY_MESSAGE_PERMISSION_SCOPE_INVALID",
    );
  for (const table of ["TutorQualification", "QualificationGrant"])
    for (const row of current.tables[table] ?? [])
      operatorAssert(
        tutorIds.has(String(row.tutorId)),
        "SECURITY_QUALIFICATION_OWNER_MISSING",
      );
  for (const [table, key, ids] of [
    ["TutorProfileOwnership", "tutorId", tutorIds],
    ["StudentProfileOwnership", "tuteeId", studentIds],
  ] as const)
    for (const row of current.tables[table] ?? [])
      operatorAssert(
        ids.has(String(row[key])) && userIds.has(String(row.userId)),
        "SECURITY_OWNERSHIP_CLOSURE_MISSING",
      );
  assertIdentityAuthorityClosure(current, restored);
}
export async function createSiteReconciliationPlan(
  input: { stagePlan: unknown; stageReceipt: unknown } & RecoverySigningSecrets,
  sourceUrl: string,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
): Promise<SiteReconciliationPlan> {
  const { plan, receipt } = await validateStagedSite(
    input.stagePlan,
    input.stageReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  const keys = assertRotatedSigningSecrets(input);
  const source = await dependencies.connect(sourceUrl);
  try {
    return await withSealedSiteTarget(
      plan,
      maintenanceUrl,
      dependencies,
      async (target) => {
        const current = await sourceSnapshot(source);
        const restored = await sourceSnapshot(target);
        validateSecurityIdentityClosure(current, restored);
        return {
          version: 1,
          kind: "site-reconcile",
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          stagePlan: plan,
          stageReceipt: receipt,
          sourceFingerprint: planHash(current),
          restoredFingerprint: planHash(restored),
          credentialGenerations: credentialGenerations(current, restored),
          ...keys,
          policyRevision: 1,
        };
      },
    );
  } finally {
    await source.close();
  }
}

async function updateFromRecord(
  db: OperatorSql,
  table: string,
  row: Record<string, unknown>,
  fields: readonly string[],
  key = "id",
) {
  const update = fields.filter((field) => field !== key);
  await db.query(
    `UPDATE public.${quote(table)} t SET ${update.map((field) => `${quote(field)}=s.${quote(field)}`).join(",")} FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb) s WHERE t.${quote(key)}=s.${quote(key)}`,
    [JSON.stringify(row)],
  );
}
async function replaceRows(
  db: OperatorSql,
  table: string,
  rows: Record<string, unknown>[],
) {
  await db.query(`DELETE FROM public.${quote(table)}`);
  for (const row of rows)
    await db.query(
      `INSERT INTO public.${quote(table)} SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb)`,
      [JSON.stringify(row)],
    );
}

/** Invalidate operational bearers without deleting immutable claim/attempt receipts. */
async function invalidateRestoredCapabilities(db: OperatorSql) {
  const expired = "'1970-01-01T00:00:00Z'::timestamp";
  for (const table of ["ViewerSignup", "CrewSignupVerification"])
    await db.query(
      `UPDATE public.${quote(table)} SET "codeHash"=gen_random_uuid()::text,"codeExpiresAt"=${expired}`,
    );
  await db.query(
    `UPDATE public."StudentSignup" SET "codeHash"=gen_random_uuid()::text,"expiresAt"=${expired}`,
  );
  await db.query(
    `UPDATE public."RegistrationCode" SET code=NULL,"emailCodeHash"=NULL,"emailCodeExpiresAt"=NULL,"expiresAt"=${expired}`,
  );
  await db.query(
    `UPDATE public."AccountInvitation" SET "codeHash"=gen_random_uuid()::text,"emailCodeHash"=NULL,"emailCodeExpiresAt"=NULL,"expiresAt"=${expired}`,
  );
  await db.query(
    `UPDATE public."EmailVerificationCode" SET "codeHash"=gen_random_uuid()::text,"consumedAt"=COALESCE("consumedAt",NOW()),"expiresAt"=${expired}`,
  );
  await db.query(
    `UPDATE public."PasswordResetToken" SET "tokenHash"=gen_random_uuid()::text,"consumedAt"=COALESCE("consumedAt",NOW()),"expiresAt"=${expired}`,
  );
  for (const table of ["StudentSurvey", "StudentSignupIntent"])
    await db.query(
      `UPDATE public.${quote(table)} SET "tokenHash"=gen_random_uuid()::text,"expiresAt"=${expired}`,
    );
  await db.query(
    `UPDATE public."StudentSignupNotice" SET "tokenHash"=NULL,state=CASE WHEN state='SENT' THEN state ELSE 'BLOCKED' END`,
  );
  for (const table of ["TuteeHistoryInvitation", "HistoricalRecordInvitation"])
    await db.query(
      `UPDATE public.${quote(table)} SET "tokenHash"=gen_random_uuid()::text,"setupCodeHash"=NULL,"setupCodeExpiresAt"=NULL,"expiresAt"=${expired}`,
    );
  await db.query(
    `UPDATE public."StudentActionConfirmation" SET "usedAt"=COALESCE("usedAt",NOW()),"expiresAt"=${expired}`,
  );
  await db.query(
    `UPDATE public."SessionCalendarToken" SET "revokedAt"=COALESCE("revokedAt",NOW())`,
  );
  await db.query(
    `UPDATE public."SchoolHoursReport" SET "linkRevokedAt"=COALESCE("linkRevokedAt",NOW())`,
  );
  await db.query('DELETE FROM public."CaptchaGrant"');
  await db.query('DELETE FROM public."CaptchaProof"');
  await db.query('DELETE FROM public."SignupLease"');
}
async function quarantineDeferredWork(db: OperatorSql) {
  // Accepted/uncertain transport evidence is retained. Nothing becomes pending.
  for (const table of ["EmailDelivery", "SessionNotice"])
    await db.query(
      `UPDATE public.${quote(table)} SET status=CASE WHEN status IN ('SENT','ACCEPTED','COMPLETED') THEN status WHEN status='SENDING' THEN 'UNCERTAIN_RECOVERY' ELSE 'CANCELLED_RECOVERY' END,"leaseUntil"=NULL,"attemptId"=NULL`,
    );
  await db.query(
    `UPDATE public."ScheduledProgramRefresh" SET state='CANCELLED',"blockedReason"='RECOVERY_QUARANTINE',version=version+1 WHERE state IN ('SCHEDULED','BLOCKED','FAILED')`,
  );
  for (const table of ["MonthlyHoursSchedule", "SchoolHoursSchedule"])
    await db.query(
      `UPDATE public.${quote(table)} SET enabled=false,"nextDueAt"=NULL,version=version+1`,
    );
  const scheduling = await db.query(
    "SELECT to_regclass('public.\"SchedulingDirtyEvent\"') IS NOT NULL AS dirty,to_regclass('public.\"SchedulingMaintenanceState\"') IS NOT NULL AS maintenance",
  );
  operatorAssert(
    scheduling.rows[0]?.dirty === scheduling.rows[0]?.maintenance,
    "INCOMPLETE_SCHEDULING_MAINTENANCE_SCHEMA",
  );
  if (scheduling.rows[0]?.dirty === true)
    await invalidateReconciledSchedulingMaintenance(db);
}

export const siteReconciliationReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-reconciliation-receipt"),
    planId: z.uuid(),
    planHash: digestSchema,
    stagePlanId: z.uuid(),
    targetName: sitePlanSchema.shape.targetName,
    state: z.literal("SECURITY_RECONCILED_SEALED"),
    sourceFingerprint: digestSchema,
    targetFingerprint: digestSchema,
    previousSigningKeyFingerprint: digestSchema,
    rotatedSigningKeyFingerprint: digestSchema,
    sourceEvidenceSha256: digestSchema,
    createdAt: z.iso.datetime(),
    policyRevision: z.literal(1),
    accountsReconciled: z.number().int().nonnegative(),
    accountsQuarantined: z.number().int().nonnegative(),
  })
  .strict();
export type SiteReconciliationReceipt = z.infer<
  typeof siteReconciliationReceiptSchema
>;

export async function applySiteReconciliation(
  data: unknown,
  sourceUrl: string,
  maintenanceUrl: string,
  input: RecoverySigningSecrets & { reason: string },
  dependencies: SiteDependencies,
): Promise<SiteReconciliationReceipt> {
  const parsed = siteReconciliationPlanSchema.safeParse(data);
  operatorAssert(parsed.success, "INVALID_RECONCILIATION_PLAN");
  const plan = parsed.data;
  operatorAssert(
    input.reason.trim().length > 0 && input.reason.length <= 1000,
    "INVALID_REASON",
  );
  assertRotatedSigningSecrets(input, plan);
  await validateStagedSite(
    plan.stagePlan,
    plan.stageReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  const base = join(plan.stageReceipt.evidenceDirectory, "reconciliations");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const evidence = join(base, plan.id);
  const source = await dependencies.connect(sourceUrl);
  try {
    const receipt = await withSealedSiteTarget(
      plan.stagePlan,
      maintenanceUrl,
      dependencies,
      async (target) => {
        const prior = siteReconciliationReceiptSchema.safeParse(
          await readDatabaseRecoveryMarker(target),
        );
        if (prior.success && prior.data.planId === plan.id) {
          operatorAssert(
            prior.data.planHash === planHash(plan),
            "RECONCILIATION_RECEIPT_MISMATCH",
          );
          return prior.data;
        }
        await mkdir(evidence, { recursive: false, mode: 0o700 });
        await writeOperatorJson(join(evidence, "intent.json"), {
          planHash: planHash(plan),
          reason: input.reason,
          startedAt: new Date().toISOString(),
        });
        await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const current = await readReconciliationSnapshot(source);
        operatorAssert(
          planHash(current) === plan.sourceFingerprint,
          "STALE_SOURCE_SECURITY_FINGERPRINT",
        );
        const exported = await source.query(
          "SELECT pg_export_snapshot() AS snapshot",
        );
        const snapshot = String(exported.rows[0]?.snapshot);
        operatorAssert(
          /^[a-fA-F0-9-]+$/.test(snapshot),
          "INVALID_EXPORTED_SOURCE_SNAPSHOT",
        );
        const sourceEvidencePath = join(
          evidence,
          "current-security-source.dump",
        );
        await dependencies.execute({
          tool: "pg_dump",
          args: ["--format=custom", "--no-password", `--snapshot=${snapshot}`],
          env: credentials(sourceUrl),
          outputPath: sourceEvidencePath,
        });
        const sourceEvidence = await inspectCurrentEvidence(sourceEvidencePath);
        await writeOperatorJson(join(evidence, "source-evidence.json"), {
          sourceFingerprint: plan.sourceFingerprint,
          ...sourceEvidence,
        });
        await target.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        try {
          const restored = await readReconciliationSnapshot(target);
          operatorAssert(
            planHash(restored) === plan.restoredFingerprint,
            "STALE_RESTORED_SECURITY_FINGERPRINT",
          );
          validateSecurityIdentityClosure(current, restored);
          operatorAssert(
            planHash(credentialGenerations(current, restored)) ===
              planHash(plan.credentialGenerations),
            "RECONCILIATION_GENERATION_EVIDENCE_MISMATCH",
          );
          const { finalState, sourceUsers } = await reconcileSecuritySnapshot(
            target,
            current,
            restored,
          );
          // A fresh source snapshot after fencing detects changes since the reviewed
          // snapshot; the isolated target commits no mutation when evidence changed.
          const freshness = await dependencies.connect(sourceUrl);
          try {
            operatorAssert(
              planHash(await sourceSnapshot(freshness)) ===
                plan.sourceFingerprint,
              "STALE_SOURCE_SECURITY_FINGERPRINT",
            );
          } finally {
            await freshness.close();
          }
          const receipt: SiteReconciliationReceipt = {
            version: 1,
            kind: "site-reconciliation-receipt",
            planId: plan.id,
            planHash: planHash(plan),
            stagePlanId: plan.stagePlan.id,
            targetName: plan.stagePlan.targetName,
            state: "SECURITY_RECONCILED_SEALED",
            sourceFingerprint: plan.sourceFingerprint,
            targetFingerprint: planHash(finalState),
            previousSigningKeyFingerprint: plan.previousSigningKeyFingerprint,
            rotatedSigningKeyFingerprint: plan.rotatedSigningKeyFingerprint,
            sourceEvidenceSha256: sourceEvidence.sha256,
            createdAt: new Date().toISOString(),
            policyRevision: 1,
            accountsReconciled: current.accounts.length,
            accountsQuarantined: restored.accounts.filter(
              (row) => !sourceUsers.has(String(row.id)),
            ).length,
          };
          // Database comments supply the transactional resume marker without adding
          // application schema or mutating immutable recovery/domain receipts.
          await target.query(
            `COMMENT ON DATABASE "${plan.stagePlan.targetName}" IS '${JSON.stringify(receipt).replaceAll("'", "''")}'`,
          );
          await target.query("COMMIT");
          await source.query("COMMIT");
          return receipt;
        } catch (error) {
          await target.query("ROLLBACK");
          await source.query("ROLLBACK");
          throw error;
        }
      },
    );
    await writeOperatorJson(join(evidence, "receipt.json"), receipt).catch(
      async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await readOperatorPlan(
          join(evidence, "receipt.json"),
          planHash(receipt),
        );
      },
    );
    return receipt;
  } catch (error) {
    const code =
      error instanceof OperatorError
        ? error.message
        : "SECURITY_RECONCILIATION_FAILED_SEALED";
    await writeOperatorJson(join(evidence, "failure.json"), {
      planId: plan.id,
      planHash: planHash(plan),
      state: code.includes("FENCE_REQUIRES")
        ? "FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION"
        : "FAILED_SEALED",
      code,
    }).catch(() => undefined);
    throw error instanceof OperatorError ? error : new OperatorError(code);
  } finally {
    await source.close();
  }
}

export async function reconcileSecuritySnapshot(
  target: OperatorSql,
  current: OverlaySnapshot,
  restored: OverlaySnapshot,
) {
  // Source-row triggers append dirty metadata. Take normal planning fences
  // before the first DML; final invalidation preserves every event.
  await acquireRecoverySchedulingFences(target);
  // Only this named trigger is disabled, transactionally on a sealed target.
  // Every guard, ownership trigger and immutable evidence trigger stays active.
  await target.query(
    'ALTER TABLE public."User" DISABLE TRIGGER account_session_version',
  );
  // Disable optional enqueueing while independent fields are copied. Final
  // settings are restored before commit; the target remains runtime fenced.
  await replaceRows(
    target,
    "ProgramSettings",
    current.tables.ProgramSettings ?? [],
  );
  await target.query(
    'UPDATE public."ProgramSettings" SET "emailNotificationsEnabled"=false',
  );
  const oldUsers = byId(restored.accounts);
  for (const account of current.accounts)
    if (!oldUsers.has(String(account.id)))
      await target.query(
        'INSERT INTO public."User" (id,email,name,role,"passwordHash","createdAt") VALUES ($1,$2,$3,\'VIEWER\',NULL,$4)',
        [account.id, account.email, account.name, account.createdAt],
      );
  const oldPeople = byId(restored.tables.Person ?? []);
  for (const person of current.tables.Person ?? [])
    if (!oldPeople.has(String(person.id)))
      await target.query(
        'INSERT INTO public."Person" (id,revision,"resolutionState","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5)',
        [
          person.id,
          person.revision,
          person.resolutionState,
          person.createdAt,
          person.updatedAt,
        ],
      );
  await appendIdentityEvidence(target, current, restored);
  // Release current profile links before assigning the exact current map;
  // this handles explicit retirements without inventing an identity merge.
  await target.query(
    'UPDATE public."User" SET "tutorId"=NULL,"studentId"=NULL WHERE "mergedIntoId" IS NULL',
  );
  await replaceRows(target, "TutorProfileOwnership", []);
  await replaceRows(target, "StudentProfileOwnership", []);
  await reconcileIdentityAuthority(target, current, ["HistoryRowOwnership"]);
  for (const table of ["Tutor", "Tutee", "Person"]) {
    const sourceRows = byId(current.tables[table] ?? []);
    const candidates =
      table === "Person"
        ? [
            ...(restored.tables[table] ?? []),
            ...(current.tables[table] ?? []).filter(
              (row) => !oldPeople.has(String(row.id)),
            ),
          ]
        : (restored.tables[table] ?? []);
    for (const old of candidates) {
      const row = sourceRows.get(String(old.id));
      if (row) {
        // Names/contact/lifecycle/preference values are independent facts;
        // source identity records themselves are never manufactured.
        await updateFromRecord(target, table, row, Object.keys(row));
      } else if (table !== "Person")
        await target.query(
          `UPDATE public.${quote(table)} SET status=$1 WHERE id=$2`,
          [table === "Tutor" ? "ARCHIVED" : "INACTIVE", old.id],
        );
    }
  }
  for (const account of credentialRetirementOrder(current.accounts)) {
    await updateFromRecord(
      target,
      "User",
      account,
      ACCOUNT_FIELDS.filter(
        (field) =>
          field !== "sessionVersion" && field !== "refreshAuthorityRevision",
      ),
    );
    await target.query(
      'UPDATE public."User" SET "passwordHash"=NULL WHERE id=$1',
      [account.id],
    );
  }
  const sourceUsers = byId(current.accounts);
  // Viewer requires a null Crew lifecycle. Retain nonnull Crew evidence as an
  // inactive Crew representation while voiding credentials and suspending access.
  for (const account of restored.accounts)
    if (!sourceUsers.has(String(account.id))) {
      await target.query(
        `UPDATE public."User" SET "passwordHash"=NULL,role=CASE WHEN "mergedIntoId" IS NOT NULL THEN role WHEN "crewStatus" IS NOT NULL THEN 'CREW'::public."Role" ELSE 'VIEWER'::public."Role" END,"recoveryVoidedAt"=COALESCE("recoveryVoidedAt",NOW()),"suspendedAt"=COALESCE("suspendedAt",NOW()),"tutorAccessRevoked"=true,"tuteeMember"=false,"canTranslate"=false,"crewStatus"=CASE WHEN "crewStatus" IS NULL THEN NULL ELSE 'INACTIVE'::public."CrewStatus" END,"sessionVersion"=$1,"refreshAuthorityRevision"=$2 WHERE id=$3`,
        [
          Number(account.sessionVersion) + 1,
          Number(account.refreshAuthorityRevision) + 1,
          account.id,
        ],
      );
    }
  for (const table of [
    "TutorProfileOwnership",
    "StudentProfileOwnership",
    "SchoolDeparture",
    "AccountEmail",
    "NotificationPreference",
    "ProgramSettings",
    "ProgramFeature",
  ] as const)
    await replaceRows(target, table, current.tables[table] ?? []);
  await replaceRows(
    target,
    "MessagePermission",
    current.tables.MessagePermission ?? [],
  );
  await replaceRows(
    target,
    "MessageRestriction",
    current.tables.MessageRestriction ?? [],
  );
  await replaceRows(target, "QualificationGrant", []);
  await replaceRows(
    target,
    "TutorQualification",
    current.tables.TutorQualification ?? [],
  );
  for (const row of current.tables.QualificationGrant ?? [])
    await target.query(
      'INSERT INTO public."QualificationGrant" SELECT * FROM jsonb_populate_record(NULL::public."QualificationGrant",$1::jsonb)',
      [JSON.stringify(row)],
    );
  await reconcileIdentityAuthority(target, current, IDENTITY_AUTHORITY_TABLES);
  // Departure history is append-only evidence: copy only missing exact IDs.
  const oldDeparture = byId(restored.tables.SchoolDepartureEvent ?? []);
  for (const row of current.tables.SchoolDepartureEvent ?? []) {
    const old = oldDeparture.get(String(row.id));
    operatorAssert(
      !old || planHash(old) === planHash(row),
      "CONTRADICTORY_DEPARTURE_EVIDENCE",
    );
    if (!old)
      await target.query(
        'INSERT INTO public."SchoolDepartureEvent" SELECT * FROM jsonb_populate_record(NULL::public."SchoolDepartureEvent",$1::jsonb)',
        [JSON.stringify(row)],
      );
  }
  for (const table of ["EmailDelivery", "SessionNotice"]) {
    const existing = byId(restored.tables[table] ?? []);
    for (const row of current.tables[table] ?? []) {
      if (existing.has(String(row.id)))
        await updateFromRecord(target, table, row, Object.keys(row));
      else
        await target.query(
          `INSERT INTO public.${quote(table)} SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb)`,
          [JSON.stringify(row)],
        );
    }
  }
  await invalidateRestoredCapabilities(target);
  await quarantineDeferredWork(target);
  const generations = await target.query(
    `SELECT id,"sessionVersion","refreshAuthorityRevision"${current.identityVersion === 1 ? ',"historyAccessRevision"' : ""} FROM public."User" ORDER BY id`,
  );
  for (const actual of generations.rows) {
    const old = oldUsers.get(String(actual.id)),
      now = sourceUsers.get(String(actual.id));
    const fields = [
      "sessionVersion",
      "refreshAuthorityRevision",
      ...(current.identityVersion === 1 ? ["historyAccessRevision"] : []),
    ];
    const values = fields.map((field) => {
      const value =
        Math.max(
          Number(actual[field]),
          Number(old?.[field] ?? -1),
          Number(now?.[field] ?? -1),
        ) + 1;
      operatorAssert(
        Number.isSafeInteger(value) && value <= 2147483647,
        "RECOVERY_SECURITY_EPOCH_EXHAUSTED",
      );
      return value;
    });
    await target.query(
      `UPDATE public."User" SET ${fields.map((field, index) => `${quote(field)}=$${index + 1}`).join(",")} WHERE id=$${fields.length + 1}`,
      [...values, actual.id],
    );
  }
  await target.query(
    'ALTER TABLE public."User" ENABLE TRIGGER account_session_version',
  );
  const finalState = await readReconciliationSnapshot(target);
  operatorAssert(
    planHash(finalState.trigger) === planHash(restored.trigger),
    "SESSION_GENERATION_TRIGGER_NOT_RESTORED",
  );
  for (const account of finalState.accounts) {
    const old = oldUsers.get(String(account.id)),
      now = sourceUsers.get(String(account.id));
    for (const field of [
      "sessionVersion",
      "refreshAuthorityRevision",
      ...(current.identityVersion === 1 ? ["historyAccessRevision"] : []),
    ])
      operatorAssert(
        Number(account[field]) >
          Math.max(Number(old?.[field] ?? -1), Number(now?.[field] ?? -1)),
        "SESSION_EPOCH_NOT_ADVANCED",
      );
  }
  const password = await target.query(
    'SELECT count(*)::text AS count FROM public."User" WHERE "passwordHash" IS NOT NULL',
  );
  operatorAssert(password.rows[0]?.count === "0", "RESTORED_PASSWORDS_REMAIN");

  return { finalState, oldUsers, sourceUsers };
}
