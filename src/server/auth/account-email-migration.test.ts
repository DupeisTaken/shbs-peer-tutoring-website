import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it.each([false, true])(
  "account-email backfill is atomic with normalized collisions=%s",
  async (collision) => {
    assertIsolatedTestDatabase(process.env.DATABASE_URL);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      // Minimal legacy schema with real shipped SQL; the outer rollback retains no fixtures.
      await client.query(`BEGIN; CREATE SCHEMA account_email_backfill_test;
      SET LOCAL search_path TO account_email_backfill_test;
      CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_CHANGE','PASSWORD_CHANGE','LOGIN_2FA');
      CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE, "emailVerifiedAt" TIMESTAMP,
        "passwordHash" TEXT, "twoFactorEnabled" BOOLEAN, name TEXT, "alternativeNames" TEXT, role TEXT, "suspendedAt" TIMESTAMP);
      CREATE TABLE "ProgramSettings" (id TEXT PRIMARY KEY);
      CREATE TABLE "PasswordResetToken" ("userId" TEXT, "consumedAt" TIMESTAMP);
      CREATE TABLE "EmailVerificationCode" ("userId" TEXT, "targetEmail" TEXT, "consumedAt" TIMESTAMP, purpose "VerificationPurpose");
      CREATE TABLE "Notification" ("userId" TEXT, link TEXT);
      INSERT INTO "User" (id,email,"emailVerifiedAt") VALUES ('one',' Owner@Example.Test ','2026-09-01'),('two','other@example.test',NULL);
      INSERT INTO "PasswordResetToken" VALUES ('one',NULL),('two',NULL);`);
      if (collision)
        await client.query(
          `UPDATE "User" SET email='owner@example.test' WHERE id='two'`,
        );
      await client.query("SAVEPOINT before_migration");
      // Replace only transaction delimiters to exercise the complete body within our rollback.
      const migration = readFileSync(
        "prisma/migrations/20260916010000_account_emails/migration.sql",
        "utf8",
      )
        .replace(/^BEGIN;\s*$/m, "")
        .replace(/^COMMIT;\s*$/m, "");
      if (collision) {
        await expect(client.query(migration)).rejects.toMatchObject({
          code: "23505",
        });
        await client.query("ROLLBACK TO SAVEPOINT before_migration");
        expect(
          (
            await client.query(
              `SELECT to_regclass('"AccountEmail"') AS registry`,
            )
          ).rows[0],
        ).toEqual({ registry: null });
        expect(
          (await client.query(`SELECT email FROM "User" WHERE id='one'`))
            .rows[0],
        ).toEqual({ email: " Owner@Example.Test " });
      } else {
        await client.query(migration);
        expect(
          (
            await client.query(
              'SELECT email, "userId", "verifiedAt" IS NOT NULL AS verified FROM "AccountEmail" ORDER BY "userId"',
            )
          ).rows,
        ).toEqual([
          { email: "owner@example.test", userId: "one", verified: true },
          { email: "other@example.test", userId: "two", verified: false },
        ]);
        expect(
          (
            await client.query(
              'SELECT "targetEmail" FROM "PasswordResetToken" ORDER BY "userId"',
            )
          ).rows,
        ).toEqual([
          { targetEmail: "owner@example.test" },
          { targetEmail: "other@example.test" },
        ]);
        expect(
          (await client.query('SELECT email FROM "User" ORDER BY id')).rows,
        ).toEqual([
          { email: "owner@example.test" },
          { email: "other@example.test" },
        ]);
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);

it("releases only legacy unverified secondary claims and revokes their grants", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Roll back a private schema so this upgrade test never changes shared fixtures.
    await client.query(`BEGIN; CREATE SCHEMA account_email_upgrade_test;
      SET LOCAL search_path TO account_email_upgrade_test;
      CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE "AccountEmail" (email TEXT PRIMARY KEY, "userId" TEXT, "verifiedAt" TIMESTAMP);
      CREATE TABLE "PasswordResetToken" ("userId" TEXT, "targetEmail" TEXT, "consumedAt" TIMESTAMP);
      CREATE TABLE "EmailVerificationCode" ("userId" TEXT, "targetEmail" TEXT, "consumedAt" TIMESTAMP);
      INSERT INTO "User" VALUES ('owner', 'primary@example.test');
      INSERT INTO "AccountEmail" VALUES ('primary@example.test', 'owner', NULL), ('verified@example.test', 'owner', NOW()), ('pending@example.test', 'owner', NULL);
      INSERT INTO "PasswordResetToken" VALUES ('owner', 'pending@example.test', NULL), ('owner', 'primary@example.test', NULL);
      INSERT INTO "EmailVerificationCode" VALUES ('owner', 'pending@example.test', NULL), ('owner', 'verified@example.test', NULL);`);
    const original = readFileSync(
      "prisma/migrations/20260916010000_account_emails/migration.sql",
      "utf8",
    );
    const revoke = original.slice(
      original.indexOf("CREATE FUNCTION revoke_removed_email()"),
      original.indexOf("-- Queue in the same transaction"),
    );
    await client.query(revoke);
    const migration = readFileSync(
      "prisma/migrations/20260918140000_release_pending_email_claims/migration.sql",
      "utf8",
    );
    await client.query(migration);
    await client.query(migration); // Rerunning the cleanup is harmless.
    expect(
      (await client.query('SELECT email FROM "AccountEmail" ORDER BY email'))
        .rows,
    ).toEqual([
      { email: "primary@example.test" },
      { email: "verified@example.test" },
    ]);
    for (const table of ["PasswordResetToken", "EmailVerificationCode"]) {
      expect(
        (
          await client.query(
            `SELECT "targetEmail", "consumedAt" IS NOT NULL AS revoked FROM "${table}" ORDER BY "targetEmail"`,
          )
        ).rows,
      ).toEqual([
        { targetEmail: "pending@example.test", revoked: true },
        {
          targetEmail:
            table === "PasswordResetToken"
              ? "primary@example.test"
              : "verified@example.test",
          revoked: false,
        },
      ]);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
