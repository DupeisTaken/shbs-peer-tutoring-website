import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it.each([
  { saved: null, audited: false, alternate: false },
  { saved: false, audited: false, alternate: false },
  { saved: false, audited: true, alternate: false },
  { saved: true, audited: true, alternate: false },
  { saved: false, audited: false, alternate: true },
])(
  "upgrades untouched defaults and preserves audited choices: %j",
  async ({ saved, audited, alternate }) => {
    assertIsolatedTestDatabase(process.env.DATABASE_URL);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      // Rehearse both real migrations in a rollback-only schema, with the old
      // identity columns and snapshots. No shared application records are touched.
      await client.query(`BEGIN;
        CREATE SCHEMA preferred_names_migration_test;
        SET LOCAL search_path TO preferred_names_migration_test;
        CREATE TABLE "ProgramSettings" (id TEXT PRIMARY KEY);
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, "tutorId" TEXT,
          "studentId" TEXT, "alternativeNames" TEXT, username TEXT,
          "profileVersion" INTEGER DEFAULT 0, "updatedAt" TIMESTAMP DEFAULT '2026-01-01');
        CREATE TABLE "Tutor" (id TEXT PRIMARY KEY, "englishName" TEXT,
          "firstName" TEXT, "lastName" TEXT, "alternativeNames" TEXT);
        CREATE TABLE "Tutee" (id TEXT PRIMARY KEY, "englishName" TEXT,
          "alternativeNames" TEXT, "signatureName" TEXT);
        CREATE TABLE "ViewerSignup" (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE "CrewApplication" (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE "TutorApplication" (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY, "userName" TEXT, operation TEXT, details JSONB);
        INSERT INTO "AuditLog" VALUES ('audit', 'Alexander Chen', 'program.setProfilePolicy',
          '{"after":{"requireLatinNames":true}}');
        INSERT INTO "TutorApplication" VALUES ('application', 'Alexander Chen');`);
      await client.query(
        readFileSync(
          "prisma/migrations/20260930010000_four_name_fields/migration.sql",
          "utf8",
        ),
      );
      if (saved !== null)
        await client.query(
          'INSERT INTO "ProgramSettings" (id, "usePreferredNames", "showAlternateNames") VALUES (\'program\', $1, $2)',
          [saved, alternate],
        );
      if (audited)
        await client.query('UPDATE "AuditLog" SET details = $1', [
          JSON.stringify({
            after: { usePreferredNames: saved, showAlternateNames: alternate },
          }),
        ]);
      await client.query(`
        INSERT INTO "User" (id, name, "firstName", "lastName", "preferredName", username)
          VALUES ('person', 'Alexander Chen', 'Alexander', 'Chen', 'Alex', 'stablehandle');
        INSERT INTO "Tutor" (id, "englishName", "firstName", "lastName", "preferredName")
          VALUES ('tutor', 'Alexander Chen', 'Alexander', 'Chen', 'Alex');
        INSERT INTO "Tutor" (id, "englishName", "firstName", "lastName", "nameFieldsConfirmed")
          VALUES ('legacy', '王小明', 'Wrong', 'Guess', false);
        INSERT INTO "Tutee" (id, "englishName", "firstName", "lastName", "preferredName", "signatureName")
          VALUES ('tutee', 'Alexander Chen', 'Alexander', 'Chen', 'Alex', 'Alexander signature');`);
      const sourceBefore = (await client.query('SELECT * FROM "User"'))
        .rows[0] as Record<string, unknown>;
      const snapshotBefore = (
        await client.query('SELECT * FROM "TutorApplication"')
      ).rows;
      const auditBefore = (await client.query('SELECT * FROM "AuditLog"')).rows;

      await client.query(
        readFileSync(
          "prisma/migrations/20261007010000_preferred_names_default/migration.sql",
          "utf8",
        ),
      );
      const effective = audited ? saved : true;
      const label = effective ? "Alex Chen" : "Alexander Chen";
      expect((await client.query('SELECT * FROM "User"')).rows[0]).toEqual({
        ...sourceBefore,
        name: label,
      });
      expect(
        (
          await client.query(
            'SELECT "englishName" FROM "Tutor" WHERE id=\'tutor\'',
          )
        ).rows[0],
      ).toEqual({ englishName: label });
      expect(
        (
          await client.query(
            'SELECT "englishName", "signatureName" FROM "Tutee"',
          )
        ).rows[0],
      ).toEqual({ englishName: label, signatureName: "Alexander signature" });
      expect(
        (
          await client.query(
            'SELECT "englishName", "nameFieldsConfirmed" FROM "Tutor" WHERE id=\'legacy\'',
          )
        ).rows[0],
      ).toEqual({ englishName: "王小明", nameFieldsConfirmed: false });
      expect(
        (await client.query('SELECT * FROM "TutorApplication"')).rows,
      ).toEqual(snapshotBefore);
      expect((await client.query('SELECT * FROM "AuditLog"')).rows).toEqual(
        auditBefore,
      );
      expect(
        (
          await client.query(
            'SELECT "usePreferredNames", "showAlternateNames" FROM "ProgramSettings" WHERE id=\'program\'',
          )
        ).rows,
      ).toEqual(
        saved === null
          ? []
          : [{ usePreferredNames: effective, showAlternateNames: alternate }],
      );
      expect(
        (
          await client.query(
            'INSERT INTO "ProgramSettings" (id) VALUES (\'default-check\') RETURNING "usePreferredNames", "showAlternateNames"',
          )
        ).rows[0],
      ).toEqual({ usePreferredNames: true, showAlternateNames: false });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
