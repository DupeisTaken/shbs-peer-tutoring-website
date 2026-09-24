import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";

it.each([false, true])(
  "applies signup migration with existing participant prerequisites: %s",
  async (shared) => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !["/shbs_survey_first_test", "/shbs_shipping_test"].includes(url.pathname)
    )
      throw Error("Migration tests require the isolated signup database");
    const c = new pg.Client({ connectionString: url.href });
    await c.connect();
    try {
      // Transactional schema isolates DDL from all public fixtures and is always rolled back.
      await c.query(`BEGIN; CREATE SCHEMA signup_migration_test;
      SET LOCAL search_path TO signup_migration_test;
      CREATE TYPE "Role" AS ENUM ('TUTOR'${shared ? ", 'STUDENT'" : ""});
      CREATE TABLE "Tutee" (id TEXT PRIMARY KEY, "signedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "User" (id TEXT PRIMARY KEY);`);
      if (shared) {
        await c.query(`ALTER TABLE "Tutee" ADD COLUMN "intakeTermId" TEXT;
        ALTER TABLE "User" ADD COLUMN "studentId" TEXT;
        CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
        ALTER TABLE "User" ADD CONSTRAINT "User_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Tutee"(id) ON DELETE SET NULL ON UPDATE CASCADE;
        CREATE TABLE "PolicyAcceptance" (LIKE public."PolicyAcceptance" INCLUDING ALL);
        INSERT INTO "Tutee" (id, "intakeTermId") VALUES ('existing-student', 'term');
        INSERT INTO "User" (id, "studentId") VALUES ('existing-account', 'existing-student');
        INSERT INTO "PolicyAcceptance" (id,"userId",slug,revision,snapshot,signature) VALUES ('evidence','existing-account','tutee-policy','v1','{}','Existing signature');`);
      }
      await c.query(
        readFileSync(
          "prisma/migrations/20260908010000_survey_first_signup/migration.sql",
          "utf8",
        ),
      );
      expect(
        (await c.query(`SELECT count(*)::int n FROM "StudentSurvey"`)).rows[0],
      ).toEqual({ n: 0 });
      if (shared) {
        expect(
          (
            await c.query(
              `SELECT "studentId" FROM "User" WHERE id='existing-account'`,
            )
          ).rows[0],
        ).toEqual({ studentId: "existing-student" });
        expect(
          (
            await c.query(
              `SELECT signature FROM "PolicyAcceptance" WHERE id='evidence'`,
            )
          ).rows[0],
        ).toEqual({ signature: "Existing signature" });
        expect(
          (
            await c.query(
              `SELECT "signupSubmittedAt" IS NOT NULL AS backfilled FROM "Tutee" WHERE id='existing-student'`,
            )
          ).rows[0],
        ).toEqual({ backfilled: true });
      }
    } finally {
      await c.query("ROLLBACK");
      await c.end();
    }
  },
);
