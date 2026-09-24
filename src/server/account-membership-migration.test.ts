import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import pg from "pg";

it("migrates mixed legacy accounts without inventing or altering policy evidence", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Migration tests require isolated local shbs_shipping_test");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    // Transaction-scoped scratch schema keeps the application fixtures and migration ledger intact.
    await client.query('BEGIN; CREATE SCHEMA membership_migration_test; SET LOCAL search_path TO membership_migration_test');
    await client.query(`
      CREATE TYPE "Role" AS ENUM ('STUDENT','VIEWER','TUTOR','CREW','COORDINATOR','ADMIN','HEAD');
      CREATE TABLE "User" (id text PRIMARY KEY, role "Role", "tutorId" text, "studentId" text, "canTranslate" boolean DEFAULT false, "crewStatus" text);
      CREATE TABLE "PolicyAcceptance" ("userId" text, slug text, revision text);
      CREATE TABLE "RegistrationCode" ("usedAt" timestamp, "expiresAt" timestamp);
      INSERT INTO "User" (id,role,"tutorId","studentId","canTranslate") VALUES
        ('tutor','TUTOR','t1',null,false), ('manager','ADMIN',null,null,false),
        ('accepted','TUTOR','t2',null,false), ('student','STUDENT',null,'s1',false),
        ('viewer','VIEWER',null,null,false), ('translator','VIEWER',null,null,true);
      INSERT INTO "PolicyAcceptance" VALUES ('accepted','tutee-policy','exact-original');
      INSERT INTO "RegistrationCode" VALUES (null,'2099-01-01');
    `);
    await client.query(readFileSync(new URL("../../prisma/migrations/20260919010000_composable_memberships/migration.sql", import.meta.url), "utf8"));
    const users = (await client.query('SELECT * FROM "User" ORDER BY id')).rows as { id: string; role: string; tuteeMember: boolean; canTranslate: boolean }[];
    expect(users.find(user => user.id === "tutor")).toMatchObject({ tuteeMember: false });
    expect(users.find(user => user.id === "accepted")).toMatchObject({ tuteeMember: true });
    expect(users.find(user => user.id === "student")).toMatchObject({ tuteeMember: true });
    expect(users.find(user => user.id === "manager")).toMatchObject({ role: "ADMIN", canTranslate: false, tuteeMember: false });
    expect(users.find(user => user.id === "viewer")).toMatchObject({ role: "VIEWER" });
    expect(users.find(user => user.id === "translator")).toMatchObject({ role: "STUDENT", canTranslate: true });
    expect((await client.query('SELECT * FROM "PolicyAcceptance"')).rows).toEqual([{ userId: "accepted", slug: "tutee-policy", revision: "exact-original" }]);
    expect((await client.query('SELECT "expiresAt" <= CURRENT_TIMESTAMP AS expired FROM "RegistrationCode"')).rows[0]).toEqual({ expired: true });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
