import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "../../generated/prisma";
import { env } from "~/env";
import {
  decodeRecordCell,
  parseRecordCsv,
  recordCsv,
  TRANSFER_MAX_BYTES,
  TRANSFER_MAX_ROWS,
  type TransferFile,
} from "~/lib/record-transfer";
import type { TransactionDb } from "~/server/transactions";
import { canonicalUsername } from "~/server/auth/username";
import { reservePatrolEvidence } from "~/server/crew/patrol-credit";

// Explicit domain allowlist, in dependency order. Never expand this to every database table:
// executable approvals, account privileges, credentials and private messages are not archives.
export const RECORD_TABLES = [
  "User",
  "SubjectLevel",
  "CourseGroup",
  "Subject",
  "Term",
  "Tutor",
  "Tutee",
  "Room",
  "TimeSlot",
  "RoomUnavailability",
  "TutorAvailability",
  "TuteeAvailability",
  "TutorSubjectWillingness",
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
  "StudentRequestReview",
  "StudentQuarterBlock",
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
type Table = (typeof RECORD_TABLES)[number];
type Column = {
  table: Table;
  name: string;
  type: string;
  nullable: boolean;
  defaulted: boolean;
  primary: boolean;
  enumValues: string[] | null;
};
type Row = Record<string, unknown>;
export type TransferSummary = {
  table: string;
  created: number;
  skipped: number;
}[];
const identifier = (name: string) =>
  Prisma.raw('"' + name.replaceAll('"', '""') + '"');
function fail(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Schema metadata comes from the deployed DB, so nullability, enums and primary keys match
 * migrations. Only allowlisted tables and validated columns ever enter SQL identifiers. */
async function catalogue(tx: TransactionDb) {
  const columns = await tx.$queryRaw<Column[]>(Prisma.sql`
    SELECT c.relname AS "table", a.attname AS name, t.typname AS type,
      NOT a.attnotnull AS nullable, a.atthasdef AS defaulted,
      EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS "primary",
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid) AS "enumValues"
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='public' AND c.relname IN (${Prisma.join(RECORD_TABLES)})
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  return new Map(
    RECORD_TABLES.map((table) => [
      table,
      columns.filter(
        (c) =>
          c.table === table &&
          (table !== "User" || ["id", "email", "name"].includes(c.name)) &&
          !(table === "StudentSurvey" && c.name === "tokenHash"),
      ),
    ]),
  );
}

function parseValue(cell: string, column: Column): unknown {
  const value = decodeRecordCell(cell);
  if (value === null) {
    if (!column.nullable) fail(`${column.name} cannot be null.`);
    return null;
  }
  if (column.enumValues) {
    if (!column.enumValues.includes(value))
      fail(`${column.name}: choose ${column.enumValues.join(", ")}.`);
    return value;
  }
  if (column.type === "bool") {
    if (!["true", "false"].includes(value))
      fail(`${column.name}: use true or false.`);
    return value === "true";
  }
  if (["int4", "float8"].includes(column.type)) {
    const n = Number(value);
    if (
      !value.trim() ||
      !Number.isFinite(n) ||
      (column.type === "int4" &&
        (!Number.isInteger(n) || n < -2147483648 || n > 2147483647))
    )
      fail(`${column.name}: invalid number.`);
    return n;
  }
  if (column.type === "timestamp" || column.type === "timestamptz") {
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value))
    )
      fail(`${column.name}: use an ISO timestamp with Z or an offset.`);
    const datePart = value.slice(0, 10);
    if (
      new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) !== datePart
    )
      fail(`${column.name}: invalid calendar date.`);
    return new Date(value).toISOString();
  }
  if (column.type === "jsonb" || column.type === "_text") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      fail(`${column.name}: invalid JSON.`);
    }
    if (
      column.type === "_text" &&
      (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string"))
    )
      fail(`${column.name}: use a JSON array of strings.`);
    return parsed;
  }
  if (column.primary && !value.trim())
    fail(`${column.name}: an ID is required.`);
  return value;
}

export async function exportRecords(tx: TransactionDb, templates = false) {
  const schema = await catalogue(tx);
  const files: TransferFile[] = [];
  let total = 0,
    bytes = 0;
  for (const table of RECORD_TABLES) {
    const columns = schema.get(table)!;
    const names = columns.map((c) => c.name);
    // JSONB provides consistent ISO timestamp/list representations independent of pg parsers.
    const result = templates
      ? []
      : await tx.$queryRaw<{ row: Row }[]>(Prisma.sql`
      SELECT to_jsonb(records) AS row FROM (SELECT ${Prisma.join(columns.map((c) => (c.type === "jsonb" ? Prisma.sql`${identifier(c.name)}::text AS ${identifier(c.name)}` : identifier(c.name))))}
      FROM ${identifier(table)} ORDER BY ${Prisma.join(columns.filter((c) => c.primary).map((c) => identifier(c.name)))}
      LIMIT ${TRANSFER_MAX_ROWS - total + 1}) records`);
    total += result.length;
    if (total > TRANSFER_MAX_ROWS)
      fail(
        "Export exceeds 5,000 records. Ask an operator for a database backup.",
      );
    // PostgreSQL timestamp-without-zone JSON lacks Z; the project's DB stores UTC.
    for (const { row } of result)
      for (const c of columns) {
        const value = row[c.name];
        if (c.type === "timestamp" && typeof value === "string")
          row[c.name] = new Date(value + "Z").toISOString();
      }
    const text = recordCsv(
      names,
      result.map((r) => r.row),
    );
    bytes += Buffer.byteLength(text);
    if (bytes > TRANSFER_MAX_BYTES)
      fail("Export exceeds 5 MiB. Ask an operator for a database backup.");
    files.push({ name: `${table}.csv`, text });
  }
  return { files, total };
}

/** Validate and insert in one rollback-capable transaction. A preview calls the same code and
 * deliberately rolls back: DB uniqueness/FKs are checked, with no partial imports or side effects. */
export async function applyRecords(tx: TransactionDb, files: TransferFile[]) {
  const schema = await catalogue(tx);
  const summary: TransferSummary = [];
  let count = 0;
  const byTable = new Map<Table, { columns: Column[]; rows: string[][] }>();
  const inserted: { table: Table; row: Row; line: number }[] = [];
  for (const file of files) {
    const table = file.name.slice(0, -4) as Table;
    const columns = schema.get(table);
    if (!columns) fail(`${file.name}: unsupported record type.`);
    const [header, ...rows] = parseRecordCsv(file.text);
    if (
      !header?.length ||
      new Set(header).size !== header.length ||
      header.some((h) => !columns.some((c) => c.name === h))
    )
      fail(
        `${file.name}: unknown or duplicate columns. Download the templates for column names.`,
      );
    const required = columns.filter(
      (c) => c.primary || (!c.nullable && !c.defaulted),
    );
    if (rows.length && required.some((c) => !header.includes(c.name)))
      fail(
        `${file.name}: required columns: ${required.map((c) => c.name).join(", ")}.`,
      );
    byTable.set(table, {
      columns: header.map((h) => columns.find((c) => c.name === h)!),
      rows,
    });
    count += rows.length;
  }
  if (count > TRANSFER_MAX_ROWS)
    fail("Import at most 5,000 records at a time.");
  if (!count) fail("The selected CSV files contain no records.");
  for (const table of RECORD_TABLES) {
    const file = byTable.get(table);
    if (!file?.rows.length) continue;
    const result = { table, created: 0, skipped: 0 };
    summary.push(result);
    const keys = schema
      .get(table)!
      .filter((c) => c.primary)
      .map((c) => c.name);
    const seen = new Set<string>();
    for (const [index, cells] of file.rows.entries()) {
      try {
        if (cells.length !== file.columns.length)
          fail("The number of cells must match the header.");
        const row = Object.fromEntries(
          file.columns.map((c, i) => [c.name, parseValue(cells[i]!, c)]),
        );
        // JSON null and SQL NULL have different meanings. jsonb_populate_record alone
        // collapses them; retain explicit JSON nulls in both comparison and insertion.
        const jsonNulls = new Set(
          file.columns.flatMap((c, i) =>
            c.type === "jsonb" &&
            row[c.name] === null &&
            decodeRecordCell(cells[i]!) !== null
              ? [c.name]
              : [],
          ),
        );
        const key = JSON.stringify(keys.map((k) => row[k]));
        if (seen.has(key)) fail("Duplicate primary key in this file.");
        seen.add(key);
        // Compare typed JSON through PostgreSQL so equivalent dates/JSON key order are equal.
        const existing = await tx.$queryRaw<{ matches: boolean }[]>(Prisma.sql`
          SELECT ${Prisma.join(
            file.columns.map(
              (c) =>
                Prisma.sql`current_row.${identifier(c.name)} IS NOT DISTINCT FROM incoming.${identifier(c.name)}`,
            ),
            " AND ",
          )} AS matches
          FROM ${identifier(table)} current_row,
          LATERAL (SELECT ${Prisma.join(file.columns.map((c) => (jsonNulls.has(c.name) ? Prisma.sql`'null'::jsonb AS ${identifier(c.name)}` : Prisma.sql`r.${identifier(c.name)}`)))}
            FROM jsonb_populate_record(NULL::${identifier(table)}, ${JSON.stringify(row)}::jsonb) r) incoming
          WHERE ${Prisma.join(
            keys.map(
              (k) =>
                Prisma.sql`current_row.${identifier(k)} = ${row[k] as string}`,
            ),
            " AND ",
          )}`);
        if (existing.length) {
          if (!existing[0]!.matches)
            fail(
              "This ID already exists with different values. Existing records are never overwritten.",
            );
          result.skipped++;
          continue;
        }
        if (table === "User")
          fail(
            "Account reference not found. Create/link accounts through the normal account workflow first.",
          );
        validateDomainRow(table, row);
        if (table === "Tutor") {
          if (typeof row.username === "string")
            await canonicalUsername(tx, row.username, {
              tutorUsername: row.username,
            });
          if (typeof row.email === "string") {
            const account = await tx.user.findFirst({
              where: { email: { equals: row.email, mode: "insensitive" } },
              select: { id: true },
            });
            const secondary = await tx.accountEmail.findFirst({
              where: { email: { equals: row.email, mode: "insensitive" } },
              select: { email: true },
            });
            if (account || secondary)
              fail(
                "This email belongs to an account. Reconcile its tutor profile through account management before importing.",
              );
          }
        }
        if (table === "Pairing" || table === "Session") {
          const active =
            table === "Pairing"
              ? await tx.term.findUnique({
                  where: { id: String(row.termId) },
                  select: { active: true },
                })
              : await tx.pairing.findUnique({
                  where: { id: String(row.pairingId) },
                  select: {
                    term: {
                      select: { active: true, schoolYear: true, quarter: true },
                    },
                    tutorId: true,
                  },
                });
          if (
            !active ||
            ("term" in active ? active.term.active : active.active)
          )
            fail(
              "Historical pairings/sessions require an existing inactive term.",
            );
          if ("tutorId" in active && active.tutorId !== row.tutorId)
            fail("Session tutor must match its pairing.");
          if (
            "term" in active &&
            (row.schoolYear !== active.term.schoolYear ||
              row.quarter !== active.term.quarter)
          )
            fail(
              "Session schoolYear and quarter must match its pairing's term.",
            );
        }
        // Original links can never be revived by an archive, even on a fresh database.
        if (table === "StudentSurvey")
          row.tokenHash = randomBytes(32).toString("hex");
        const names = Object.keys(row);
        await tx.$executeRaw(Prisma.sql`INSERT INTO ${identifier(table)} (${Prisma.join(names.map(identifier))})
          SELECT ${Prisma.join(names.map((name) => (jsonNulls.has(name) ? Prisma.sql`'null'::jsonb` : identifier(name))))} FROM jsonb_populate_record(NULL::${identifier(table)}, ${JSON.stringify(row)}::jsonb)`);
        result.created++;
        inserted.push({ table, row, line: index + 2 });
      } catch (error) {
        const detail =
          error instanceof TRPCError ? error.message : databaseError(error);
        fail(`${table}.csv, row ${index + 2}: ${detail}`);
      }
    }
  }
  // These historical links are scalar-only in Prisma. Validate the live references explicitly;
  // denormalized actor snapshots remain allowed to refer to accounts that were later deleted.
  const references: Partial<Record<Table, Record<string, Table>>> = {
    Tutee: { intakeTermId: "Term" },
    StudentSurvey: { intakeTermId: "Term", tuteeId: "Tutee" },
    StudentProfileOwnership: { tuteeId: "Tutee", userId: "User" },
    PolicyAcceptance: { userId: "User" },
    StudentFeedback: { studentId: "Tutee", sessionId: "Session" },
    StudentAppeal: { studentId: "Tutee", cardId: "DisciplinaryCard" },
    TutorQualification: { tutorId: "Tutor", subjectId: "Subject" },
  };
  for (const { table, row, line } of inserted) {
    if (table === "PatrolCreditWindow") {
      const patrol = await tx.patrol.findUniqueOrThrow({ where: { id: String(row.patrolId) }, select: { crewUserId: true } });
      if (patrol.crewUserId !== row.crewUserId)
        fail(`${table}.csv, row ${line}: credit owner must match the patrol author.`);
    }
    for (const [field, target] of Object.entries(references[table] ?? {})) {
      if (row[field] == null) continue;
      const found = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM ${identifier(target)} WHERE id=${row[field]}`,
      );
      if (!found.length)
        fail(
          `${table}.csv, row ${line}: ${field} references a missing ${target} record.`,
        );
    }
    if (table === "StudentProfileOwnership") {
      const linked = await tx.user.findUnique({
        where: { studentId: row.tuteeId as string },
        select: { id: true },
      });
      if (linked && linked.id !== row.userId)
        fail(
          `${table}.csv, row ${line}: this student profile belongs to another account.`,
        );
    }
  }
  // Older archives have no credit ledger. Preserve their awarded hours and timestamps,
  // but reserve their evidence just as the migration does; restoring cannot reopen credit.
  const patrolIds = [...new Set(inserted.flatMap(({ table, row }) =>
    table === "Patrol" ? [String(row.id)] : table === "PatrolObservation" ? [String(row.patrolId)] : [],
  ))];
  if (patrolIds.length) {
    const patrols = await tx.patrol.findMany({
      where: { id: { in: patrolIds }, hours: { gt: 0 } }, include: { observations: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const patrol of patrols) {
      if (!patrol.creditAwardedAt)
        await tx.$executeRaw`UPDATE "Patrol" SET "creditAwardedAt" = "createdAt" WHERE id = ${patrol.id} AND "creditAwardedAt" IS NULL`;
      await reservePatrolEvidence(tx, patrol, patrol.observations.length ? patrol.observations : [{ observedAt: patrol.createdAt }], true);
    }
  }
  return summary;
}

function databaseError(error: unknown) {
  // Driver errors can echo private values. Keep the diagnostic actionable without raw SQL.
  const message = error instanceof Error ? error.message : "";
  if (/23505|unique constraint|duplicate key/i.test(message))
    return "A unique value already belongs to another record; check IDs, names and email addresses.";
  if (/23503|foreign key/i.test(message))
    return "A referenced record is missing. Include its CSV or use an existing ID.";
  return "The row violates a database constraint. Check required values and referenced IDs.";
}

function validateDomainRow(table: Table, row: Row) {
  if (table === "Term" && row.active === true)
    fail("Imported terms must be inactive (active=false).");
  for (const field of ["englishName", "name", "title"])
    if (field in row && typeof row[field] === "string" && !row[field].trim())
      fail(`${field} cannot be empty.`);
  if (
    "schoolYear" in row &&
    row.schoolYear !== null &&
    (typeof row.schoolYear !== "string" ||
      !/^\d{2}-\d{2}$/.test(row.schoolYear))
  )
    fail("schoolYear must use YY-YY.");
  if ("month" in row && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.month)))
    fail("month must use YYYY-MM.");
  if (
    "startMin" in row &&
    (!(Number(row.startMin) >= 0) ||
      !(Number(row.endMin) > Number(row.startMin)) ||
      Number(row.endMin) > 1440)
  )
    fail("Times must satisfy 0 <= startMin < endMin <= 1440.");
  if (
    "dayOfWeek" in row &&
    (Number(row.dayOfWeek) < 1 || Number(row.dayOfWeek) > 7)
  )
    fail("dayOfWeek must be between 1 and 7.");
  for (const field of ["amount", "hours", "shCount", "shFactor", "durationMin"])
    if (field in row && Number(row[field]) < 0)
      fail(`${field} cannot be negative.`);
  if (
    table === "Session" &&
    (new Date(String(row.date)).getTime() > Date.now() ||
      Number(row.durationMin) !== Number(row.endMin) - Number(row.startMin))
  )
    fail(
      "Sessions must be in the past and durationMin must match start/end times.",
    );
  for (const [field, value] of Object.entries(row))
    if (
      field.startsWith("rating") &&
      value !== null &&
      (Number(value) < 1 || Number(value) > 5)
    )
      fail(`${field} must be between 1 and 5.`);
}

/** Preview tickets bind exact bytes, actor and expiry; preview cannot authorize edited files. */
export function previewTicket(
  files: TransferFile[],
  actorId: string,
  expires = Date.now() + 15 * 60_000,
) {
  const hash = createHmac(
    "sha256",
    env.AUTH_SECRET ?? "local-development-record-transfer",
  )
    .update(JSON.stringify([actorId, expires, files]))
    .digest("hex");
  return `${expires}.${hash}`;
}
export function verifyPreviewTicket(
  files: TransferFile[],
  actorId: string,
  ticket: string,
) {
  const expires = Number(ticket.split(".")[0]);
  const expected = previewTicket(files, actorId, expires);
  if (
    !Number.isFinite(expires) ||
    expires < Date.now() ||
    ticket.length !== expected.length ||
    !timingSafeEqual(Buffer.from(ticket), Buffer.from(expected))
  )
    fail("The preview expired or the files changed. Preview the files again.");
}
