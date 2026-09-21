import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";

it("migrates exact eligibility and every dependent ID without guessing groups from labels", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw Error("Use an isolated local test database");
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query(`BEGIN; CREATE SCHEMA course_migration_test; SET LOCAL search_path TO course_migration_test;
      CREATE TABLE "SubjectLevel" (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE "Subject" (id TEXT PRIMARY KEY, name TEXT, "levelId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "TutorQualification" ("tutorId" TEXT, "subjectId" TEXT, "approvedById" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("tutorId","subjectId"));
      CREATE TABLE "References" (id TEXT PRIMARY KEY, "subjectId" TEXT REFERENCES "Subject"(id), kind TEXT);
      INSERT INTO "SubjectLevel" VALUES ('standard','Standard'),('ap','AP');
      INSERT INTO "Subject" (id,name,"levelId") VALUES ('plain','Calculus','standard'),('ap','AP Calculus AB','ap'),('legacy','Physics','ap'),('no-level','Study skills',null);
      INSERT INTO "TutorQualification" ("tutorId","subjectId","approvedById") VALUES ('tutor','ap','staff'),('old-tutor','removed-subject','staff');
      INSERT INTO "References" VALUES ('tutee','plain','firstChoice'),('intent','ap','applicationIntent'),('survey','legacy','survey'),('pairing','no-level','pairing');`);
    const before = (
      await client.query('SELECT * FROM "References" ORDER BY id')
    ).rows;
    const names = (
      await client.query('SELECT id,name FROM "Subject" ORDER BY id')
    ).rows;
    await client.query(
      readFileSync(
        "prisma/migrations/20260919010000_course_groups_qualification_grants/migration.sql",
        "utf8",
      ),
    );
    expect(
      (await client.query('SELECT * FROM "References" ORDER BY id')).rows,
    ).toEqual(before);
    expect(
      (await client.query('SELECT id,name FROM "Subject" ORDER BY id')).rows,
    ).toEqual(names);
    expect(
      (
        await client.query(
          'SELECT "subjectId" FROM "QualificationGrant" ORDER BY "subjectId"',
        )
      ).rows,
    ).toEqual([{ subjectId: "ap" }, { subjectId: "removed-subject" }]);
    expect(
      (await client.query('SELECT DISTINCT status FROM "TutorQualification"'))
        .rows,
    ).toEqual([{ status: "APPROVED" }]);
    expect(
      (
        await client.query(
          'SELECT count(DISTINCT "groupId")::int count FROM "Subject"',
        )
      ).rows[0],
    ).toEqual({ count: 4 });
    expect(
      (await client.query('SELECT "baseName" FROM "Subject" WHERE id = \'ap\''))
        .rows[0],
    ).toEqual({ baseName: "Calculus AB" });
    await client.query(
      'DELETE FROM "TutorQualification" WHERE "tutorId" = \'tutor\'',
    );
    expect(
      (await client.query('SELECT "tutorId" FROM "QualificationGrant"')).rows,
    ).toEqual([{ tutorId: "old-tutor" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
