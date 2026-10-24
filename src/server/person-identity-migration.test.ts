import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const migration = readFileSync(
  "prisma/migrations/20261021020000_person_identity/migration.sql",
  "utf8",
);

// Keep the pre-Person relationship constraints and representative business/evidence
// columns. StudentProfileOwnership deliberately has scalar, non-FK references in
// production; malformed legacy ownership must be rejected by the migration itself.
const legacySchema = `
  CREATE TABLE "Tutor" (
    id TEXT PRIMARY KEY, "englishName" TEXT NOT NULL, email TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE', "gradeLevel" INTEGER,
    "preferredAssignedBlocks" INTEGER, "workloadPreferenceVersion" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-09-01 08:00:00'
  );
  CREATE TABLE "Tutee" (
    id TEXT PRIMARY KEY, "englishName" TEXT NOT NULL, email TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE', "gradeLevel" TEXT,
    "intakeTermId" TEXT, "signupSubmittedAt" TIMESTAMP(3),
    "signedRulebook" BOOLEAN NOT NULL DEFAULT true, "signatureName" TEXT,
    "signedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-09-02 09:00:00'
  );
  CREATE TABLE "User" (
    id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE, "passwordHash" TEXT, "sessionVersion" INTEGER NOT NULL DEFAULT 4,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3) DEFAULT '2026-08-01 10:00:00',
    role TEXT NOT NULL DEFAULT 'STUDENT', "tuteeMember" BOOLEAN NOT NULL DEFAULT false,
    "tutorAccessRevoked" BOOLEAN NOT NULL DEFAULT false, "crewStatus" TEXT,
    "canTranslate" BOOLEAN NOT NULL DEFAULT false,
    "tutorId" TEXT UNIQUE REFERENCES "Tutor"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    "studentId" TEXT UNIQUE REFERENCES "Tutee"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    "mergedIntoId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-08-01 09:00:00',
    CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> id)
  );
  CREATE TABLE "StudentProfileOwnership" (
    "tuteeId" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE "TutorProfileOwnership" (
    "tutorId" TEXT PRIMARY KEY REFERENCES "Tutor"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE "Session" (
    id TEXT PRIMARY KEY, "tutorId" TEXT NOT NULL REFERENCES "Tutor"(id),
    "startMin" INTEGER NOT NULL, "endMin" INTEGER NOT NULL, "durationMin" INTEGER NOT NULL,
    "shFactor" INTEGER NOT NULL, "shCount" DOUBLE PRECISION NOT NULL,
    "schoolYear" TEXT NOT NULL, quarter TEXT NOT NULL, comments TEXT
  );
  CREATE TABLE "SessionTutee" (
    "sessionId" TEXT NOT NULL REFERENCES "Session"(id),
    "tuteeId" TEXT NOT NULL REFERENCES "Tutee"(id), status TEXT NOT NULL,
    "absenceReason" TEXT, PRIMARY KEY ("sessionId", "tuteeId")
  );
  CREATE TABLE "MeetingAttendance" (
    id TEXT PRIMARY KEY, "tutorId" TEXT NOT NULL REFERENCES "Tutor"(id),
    "meetingId" TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, "excusedAt" TIMESTAMP(3)
  );
  CREATE TABLE "ServiceHourAdjustment" (
    id TEXT PRIMARY KEY, "tutorId" TEXT NOT NULL REFERENCES "Tutor"(id),
    month TEXT NOT NULL, "schoolYear" TEXT NOT NULL, quarter TEXT NOT NULL,
    type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, reason TEXT
  );
  CREATE TABLE "PolicyAcceptance" (
    id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, slug TEXT NOT NULL,
    revision TEXT NOT NULL, snapshot JSONB NOT NULL, signature TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL, UNIQUE ("userId", slug, revision)
  );
`;

const sourceTables = [
  "User",
  "Tutor",
  "Tutee",
  "StudentProfileOwnership",
  "TutorProfileOwnership",
  "Session",
  "SessionTutee",
  "MeetingAttendance",
  "ServiceHourAdjustment",
  "PolicyAcceptance",
] as const;

async function sourceSnapshot(client: pg.Client) {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of sourceTables) {
    const result = await client.query<{ record: unknown }>(`
      SELECT to_jsonb(source) - 'personId' AS record FROM "${table}" source
      ORDER BY (to_jsonb(source) - 'personId')::text
    `);
    snapshot[table] = result.rows.map((row) => row.record);
  }
  return snapshot;
}

async function withLegacySchema(
  exercise: (client: pg.Client, schema: string) => Promise<void>,
) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Every case runs the actual migration in its own rollback-only namespace;
    // no application's Person rows, fixtures or schema are reset or cleaned up.
    await client.query("BEGIN");
    const schema = `person_backfill_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(legacySchema);
    await exercise(client, schema);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }
}

type Group = {
  primaryUserId: string | null;
  resolutionState: "GROUPED" | "REVIEW_REQUIRED";
  revision: number;
  mergedIntoId: string | null;
  members: string[];
};

async function groups(client: pg.Client) {
  const result = await client.query<Group>(`
    SELECT p."primaryUserId", p."resolutionState", p.revision, p."mergedIntoId",
      ARRAY(
        SELECT 'USER:' || id FROM "User" WHERE "personId" = p.id
        UNION ALL SELECT 'TUTOR:' || id FROM "Tutor" WHERE "personId" = p.id
        UNION ALL SELECT 'TUTEE:' || id FROM "Tutee" WHERE "personId" = p.id
        ORDER BY 1
      ) AS members
    FROM "Person" p ORDER BY members
  `);
  return result.rows;
}

function group(primaryUserId: string | null, ...members: string[]): Group {
  return {
    primaryUserId,
    resolutionState: "GROUPED",
    revision: 1,
    mergedIntoId: null,
    members: members.sort(),
  };
}

it("backfills only explicit populated components while preserving original business, ownership and historical evidence", async () => {
  await withLegacySchema(async (client) => {
    await client.query(`
      INSERT INTO "Tutor" (id, "englishName", email, status, "gradeLevel", "preferredAssignedBlocks") VALUES
        ('direct-tutor', 'Direct Tutor', 'direct-tutor@example.test', 'ACTIVE', 11, 2),
        ('retained-tutor', 'Retained Tutor', 'retained@example.test', 'ARCHIVED', 12, 0),
        ('chain-current-tutor', 'Current Tutor', 'current@example.test', 'ACTIVE', 10, 1),
        ('chain-old-tutor', 'Original Tutor', 'original@example.test', 'GRADUATED', 12, 0),
        ('accountless-tutor', 'Repeated Name', 'repeat@example.test', 'TRANSFERRED', 11, 0);
      INSERT INTO "Tutee" (id, "englishName", email, status, "gradeLevel", "intakeTermId",
        "signupSubmittedAt", "signatureName", "signedAt") VALUES
        ('direct-tutee', 'Direct Tutee', 'direct-tutee@example.test', 'ACTIVE', 'G11', 'term-current',
          '2026-09-01 06:00:00', 'Original Direct Signature', '2026-08-31 08:00:00'),
        ('retained-tutee', 'Retained Tutee', 'retained@example.test', 'INACTIVE', 'G10', 'term-old',
          '2025-09-01 06:00:00', 'Original Retained Signature', '2025-08-31 08:00:00'),
        ('chain-current-tutee', 'Current Tutee', 'current@example.test', 'ACTIVE', 'G10', 'term-current',
          '2026-09-02 06:00:00', 'Current Signature', '2026-09-01 08:00:00'),
        ('chain-old-tutee', 'Original Tutee', 'original@example.test', 'INACTIVE', 'G9', 'term-old',
          '2025-09-02 06:00:00', 'Original Signature', '2025-09-01 08:00:00'),
        ('accountless-tutee', 'Repeated Name', 'repeat@example.test', 'INACTIVE', 'G11', NULL,
          NULL, NULL, NULL),
        ('same-contact-tutee', 'Repeated Name', 'repeat@example.test', 'ACTIVE', 'G11', NULL,
          NULL, NULL, NULL);
      INSERT INTO "User" (id, name, email, username, "passwordHash", role, "tuteeMember",
        "crewStatus", "canTranslate", "tutorId", "studentId", "mergedIntoId") VALUES
        ('direct-owner', 'Current Identity', 'direct@example.test', 'direct', 'direct-hash', 'COORDINATOR',
          true, 'ACTIVE', true, 'direct-tutor', 'direct-tutee', NULL),
        ('retained-owner', 'Retained Identity', 'history@example.test', 'retained', 'retained-hash', 'STUDENT',
          false, NULL, false, NULL, NULL, NULL),
        ('chain-live', 'Survivor Identity', 'survivor@example.test', 'survivor', 'survivor-hash', 'TUTOR',
          true, NULL, false, 'chain-current-tutor', 'chain-current-tutee', NULL),
        ('chain-middle', 'Middle Identity', 'middle@example.test', 'middle', NULL, 'STUDENT',
          false, NULL, false, NULL, NULL, 'chain-live'),
        ('chain-oldest', 'Oldest Identity', 'oldest@example.test', 'oldest', NULL, 'STUDENT',
          false, NULL, false, NULL, NULL, 'chain-middle'),
        ('same-contact-login', 'Repeated Name', 'repeat@example.test', 'repeated', 'unrelated-hash', 'VIEWER',
          false, NULL, false, NULL, NULL, NULL),
        ('same-name-login', 'Repeated Name', 'other@example.test', 'other', 'other-hash', 'VIEWER',
          false, NULL, false, NULL, NULL, NULL);
      INSERT INTO "TutorProfileOwnership" VALUES
        ('direct-tutor', 'direct-owner', 2), ('retained-tutor', 'retained-owner', 7),
        ('chain-old-tutor', 'chain-oldest', 5);
      INSERT INTO "StudentProfileOwnership" VALUES
        ('direct-tutee', 'direct-owner', 3), ('retained-tutee', 'retained-owner', 9),
        ('chain-old-tutee', 'chain-middle', 6);
      INSERT INTO "Session" VALUES
        ('original-session', 'chain-old-tutor', 600, 650, 50, 2, 1.75, '25-26', 'Q1', 'Original comments'),
        ('direct-session', 'direct-tutor', 660, 710, 50, 1, 0.8, '26-27', 'Q1', 'Current comments');
      INSERT INTO "SessionTutee" VALUES
        ('original-session', 'chain-old-tutee', 'EXCUSED', 'Original absence reason'),
        ('direct-session', 'direct-tutee', 'PRESENT', NULL);
      INSERT INTO "MeetingAttendance" VALUES
        ('original-meeting-attendance', 'chain-old-tutor', 'original-meeting', 'EXCUSED',
          'Original meeting excuse', '2025-10-01 06:00:00');
      INSERT INTO "ServiceHourAdjustment" VALUES
        ('original-credit', 'chain-old-tutor', '2025-10', '25-26', 'Q1', 'EXTRA', 0.75, 'Original award'),
        ('retained-deduction', 'retained-tutor', '2025-10', '25-26', 'Q1', 'PUNISHMENT', 0.25, 'Original deduction');
      INSERT INTO "PolicyAcceptance" VALUES
        ('original-consent', 'chain-oldest', 'tutor-agreement', 'published-original',
          '{"content":"Original accepted text","locale":"zh","version":7}',
          'Original Signature', '2025-09-01 08:00:00'),
        ('direct-consent', 'direct-owner', 'tutee-agreement', 'published-current',
          '{"content":"Current accepted text","locale":"en","version":9}',
          'Direct Signature', '2026-09-01 08:00:00');
    `);
    const before = await sourceSnapshot(client);
    await client.query(migration);
    expect(await sourceSnapshot(client)).toEqual(before);

    const expected = [
      group("direct-owner", "USER:direct-owner", "TUTOR:direct-tutor", "TUTEE:direct-tutee"),
      group("retained-owner", "USER:retained-owner", "TUTOR:retained-tutor", "TUTEE:retained-tutee"),
      group("chain-live", "USER:chain-live", "USER:chain-middle", "USER:chain-oldest",
        "TUTOR:chain-current-tutor", "TUTOR:chain-old-tutor", "TUTEE:chain-current-tutee", "TUTEE:chain-old-tutee"),
      group("same-contact-login", "USER:same-contact-login"),
      group("same-name-login", "USER:same-name-login"),
      group(null, "TUTOR:accountless-tutor"),
      group(null, "TUTEE:accountless-tutee"),
      group(null, "TUTEE:same-contact-tutee"),
    ];
    const actual = await groups(client);
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expect.arrayContaining(expected));
    expect(actual.flatMap((row) => row.members)).toHaveLength(18);
    expect((await client.query('SELECT * FROM "PersonCombineReceipt"')).rows).toEqual([]);
  });
});

it("marks a legacy component with multiple live logins for review without choosing a primary or retiring credentials", async () => {
  await withLegacySchema(async (client) => {
    // Normal unique current links and consistent retained owners cannot produce
    // this ambiguity. Model a damaged legacy index explicitly to exercise the
    // migration's defensive REVIEW_REQUIRED branch, not a supported new write.
    await client.query(`
      ALTER TABLE "User" DROP CONSTRAINT "User_tutorId_key";
      INSERT INTO "Tutor" (id, "englishName") VALUES ('shared-legacy-tutor', 'Legacy Tutor');
      INSERT INTO "User" (id, email, "passwordHash", "tutorId") VALUES
        ('live-a', 'a@example.test', 'a-hash', 'shared-legacy-tutor'),
        ('live-b', 'b@example.test', 'b-hash', 'shared-legacy-tutor');
      INSERT INTO "User" (id, email, "mergedIntoId") VALUES
        ('retired-before-review', 'retired@example.test', 'live-a');
    `);
    const before = await sourceSnapshot(client);
    await client.query(migration);
    expect(await sourceSnapshot(client)).toEqual(before);
    expect(await groups(client)).toEqual([
      {
        ...group(null, "TUTOR:shared-legacy-tutor", "USER:live-a", "USER:live-b", "USER:retired-before-review"),
        resolutionState: "REVIEW_REQUIRED",
      },
    ]);
    expect((await client.query('SELECT * FROM "PersonCombineReceipt"')).rows).toEqual([]);
  });
});

it.each([
  {
    name: "a dangling scalar student owner",
    insert: `INSERT INTO "StudentProfileOwnership" VALUES ('legacy-tutee', 'missing-owner', 4)`,
    message: "Person backfill requires valid retained student ownership",
  },
  {
    name: "a dangling scalar student record",
    insert: `INSERT INTO "StudentProfileOwnership" VALUES ('missing-tutee', 'current-owner', 4)`,
    message: "Person backfill requires valid retained student ownership",
  },
  {
    name: "contradictory current and retained student owners",
    insert: `INSERT INTO "StudentProfileOwnership" VALUES ('legacy-tutee', 'other-owner', 4)`,
    message: "Person backfill requires reviewed current/retained student ownership",
  },
  {
    name: "contradictory current and retained tutor owners",
    insert: `INSERT INTO "TutorProfileOwnership" VALUES ('legacy-tutor', 'other-owner', 4)`,
    message: "Person backfill requires reviewed current/retained tutor ownership",
  },
])("rejects $name atomically", async ({ insert, message }) => {
  await withLegacySchema(async (client, schema) => {
    // The original tutor ownership guard prevents new contradictions. Omit that
    // trigger here to represent preexisting malformed data; retain its FK checks.
    await client.query(`
      INSERT INTO "Tutor" (id, "englishName") VALUES ('legacy-tutor', 'Original Tutor');
      INSERT INTO "Tutee" (id, "englishName") VALUES ('legacy-tutee', 'Original Tutee');
      INSERT INTO "User" (id, email, "passwordHash", "tutorId", "studentId") VALUES
        ('current-owner', 'current@example.test', 'original-hash', 'legacy-tutor', 'legacy-tutee'),
        ('other-owner', 'other@example.test', 'other-hash', NULL, NULL);
    `);
    await client.query(insert);
    const before = await sourceSnapshot(client);
    await client.query("SAVEPOINT person_migration");
    await expect(client.query(migration)).rejects.toMatchObject({
      code: "P0001",
      message,
    });
    // A failed migration cannot be followed by accidentally committed partial
    // writes. Recover only to inspect the exact pre-migration rows and catalog.
    await expect(client.query("SELECT 1")).rejects.toMatchObject({ code: "25P02" });
    await client.query("ROLLBACK TO SAVEPOINT person_migration");
    expect(await sourceSnapshot(client)).toEqual(before);
    expect(
      (await client.query(`SELECT to_regclass('"Person"') AS person,
        to_regclass('"PersonCombineReceipt"') AS receipt`)).rows,
    ).toEqual([{ person: null, receipt: null }]);
    expect(
      (await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name = 'personId'`, [schema])).rows,
    ).toEqual([]);
    expect(
      (await client.query(`SELECT t.typname FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = 'PersonResolutionState'`, [schema])).rows,
    ).toEqual([]);
  });
});
