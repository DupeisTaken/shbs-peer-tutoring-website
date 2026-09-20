import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import pg from "pg";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("preserves initial applications and enforces qualification ownership, uniqueness and immutable decisions", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Scratch schema is transaction-local and rolled back; existing fixtures/migration ledger survive.
    await client.query('BEGIN; CREATE SCHEMA qualification_application_migration_test; SET LOCAL search_path TO qualification_application_migration_test');
    await client.query(`
      CREATE TYPE "TutorApplicationStatus" AS ENUM ('PENDING','INTERVIEW','ACCEPTED','REJECTED');
      CREATE TABLE "Tutor" (id text PRIMARY KEY);
      CREATE TABLE "Subject" (id text PRIMARY KEY);
      CREATE TABLE "TutorApplication" (id text PRIMARY KEY, status "TutorApplicationStatus" NOT NULL DEFAULT 'PENDING', "createdAt" timestamp DEFAULT now(), "decidedAt" timestamp, "decisionComment" text, "decidedByTutorId" text, "interviewDurationMin" integer);
      INSERT INTO "Tutor" VALUES ('existing-tutor'); INSERT INTO "Subject" VALUES ('subject');
      INSERT INTO "TutorApplication" (id,status) VALUES ('legacy','ACCEPTED');
    `);
    await client.query(readFileSync(new URL("../../prisma/migrations/20260919073000_additional_qualification_applications/migration.sql", import.meta.url), "utf8"));
    expect((await client.query('SELECT type, "requestedTutorId", "qualificationSnapshot" FROM "TutorApplication" WHERE id=\'legacy\'')).rows).toEqual([{ type: "INITIAL", requestedTutorId: null, qualificationSnapshot: null }]);
    await client.query(`INSERT INTO "TutorApplication" (id,type,"requestedTutorId","requestedSubjectId","qualificationReason") VALUES ('request','HIGHER_LEVEL','existing-tutor','subject','Evidence')`);
    async function rejected(sql: string) {
      await client.query("SAVEPOINT rejected_statement");
      await expect(client.query(sql)).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT rejected_statement");
    }
    await rejected(`INSERT INTO "TutorApplication" (id,type,"requestedTutorId","requestedSubjectId","qualificationReason") VALUES ('duplicate','HIGHER_LEVEL','existing-tutor','subject','Evidence')`);
    await rejected(`INSERT INTO "TutorApplication" (id,type) VALUES ('unowned','ADDITIONAL_SUBJECT')`);
    await rejected(`UPDATE "TutorApplication" SET status='ACCEPTED' WHERE id='request'`);
    await client.query(`UPDATE "TutorApplication" SET status='ACCEPTED', "qualificationDecidedById"='reviewer', "decidedAt"=now(), "decisionComment"='Approved', "qualificationSnapshot"='[{"id":"subject","name":"Original name"}]'::jsonb WHERE id='request'`);
    await rejected(`UPDATE "TutorApplication" SET status='PENDING' WHERE id='request'`);
    await rejected(`UPDATE "TutorApplication" SET "qualificationSnapshot"='[]'::jsonb WHERE id='request'`);
    await rejected(`DELETE FROM "TutorApplication" WHERE id='request'`);
    await rejected(`DELETE FROM "Tutor" WHERE id='existing-tutor'`);
    await client.query(`UPDATE "TutorApplication" SET "interviewDurationMin"=45 WHERE id='request'`);
    await client.query(`DELETE FROM "TutorApplication" WHERE id='legacy'`);
    expect((await client.query('SELECT id FROM "TutorApplication"')).rows).toEqual([{ id: "request" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
