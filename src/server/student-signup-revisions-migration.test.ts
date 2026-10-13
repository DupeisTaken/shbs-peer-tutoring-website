import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import pg from "pg";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("adds current answers and immutable retry evidence without rewriting original signups or identity uniqueness", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/shbs_shipping_test")
    throw new Error("Use shbs_shipping_test");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    // Isolate migration compatibility from real application fixtures and its migration ledger.
    await client.query(
      "BEGIN; CREATE SCHEMA student_signup_revisions_test; SET LOCAL search_path TO student_signup_revisions_test",
    );
    await client.query(`
      CREATE TABLE "StudentSurvey" (
        id text PRIMARY KEY, email text NOT NULL, "intakeTermId" text NOT NULL,
        state text NOT NULL DEFAULT 'OPEN', payload jsonb NOT NULL,
        "policyRevision" text NOT NULL, "policySnapshot" jsonb NOT NULL
      );
      CREATE UNIQUE INDEX "StudentSurvey_one_open_request" ON "StudentSurvey"(email, "intakeTermId") WHERE state = 'OPEN';
      INSERT INTO "StudentSurvey" VALUES ('original', 'owner@example.test', 'term', 'OPEN', '{"englishName":"Original", "signatureName":"Original Signature"}', 'original-policy', '[{"body":"Original policy"}]');
    `);
    await client.query(
      readFileSync(
        new URL(
          "../../prisma/migrations/20261014010000_student_signup_revisions/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT "currentPayload", "currentVersion", payload, "policyRevision", "policySnapshot" FROM "StudentSurvey"',
        )
      ).rows,
    ).toEqual([
      {
        currentPayload: null,
        currentVersion: 0,
        payload: {
          englishName: "Original",
          signatureName: "Original Signature",
        },
        policyRevision: "original-policy",
        policySnapshot: [{ body: "Original policy" }],
      },
    ]);

    const rejects = async (sql: string, code: string) => {
      await client.query("SAVEPOINT rejected_write");
      await expect(client.query(sql)).rejects.toMatchObject({ code });
      await client.query("ROLLBACK TO SAVEPOINT rejected_write");
    };
    await rejects(`UPDATE "StudentSurvey" SET "currentVersion" = 1`, "23514");
    await rejects(`UPDATE "StudentSurvey" SET "currentVersion" = -1`, "23514");
    await rejects(
      `UPDATE "StudentSurvey" SET "currentPayload" = '[]', "currentVersion" = 1`,
      "23514",
    );
    await rejects(
      `UPDATE "StudentSurvey" SET "currentPayload" = '{}', "currentVersion" = 0`,
      "23514",
    );
    await rejects(
      `UPDATE "StudentSurvey" SET payload = '{"signatureName":"Replacement"}'`,
      "P0001",
    );
    await rejects(
      `UPDATE "StudentSurvey" SET "policyRevision" = 'replacement'`,
      "P0001",
    );
    await rejects(
      `UPDATE "StudentSurvey" SET "policySnapshot" = '[]'`,
      "P0001",
    );
    await rejects(
      `INSERT INTO "StudentSurvey" (id,email,"intakeTermId",payload,"policyRevision","policySnapshot") VALUES ('duplicate','owner@example.test','term','{}','policy','[]')`,
      "23505",
    );

    await client.query(
      `UPDATE "StudentSurvey" SET "currentPayload" = '{"englishName":"Current"}', "currentVersion" = 1`,
    );
    const createRevision = (
      id: string,
      version = 1,
      key = "00000000-0000-4000-8000-000000000001",
    ) =>
      `INSERT INTO "StudentSignupRevision" (id,"surveyId","expectedVersion",version,"actorUserId","clientKey","inputHash",answers) VALUES ('${id}','original',${version - 1},${version},'original-owner','${key}','${"a".repeat(64)}','{"englishName":"Current"}')`;
    await client.query(createRevision("receipt"));
    await rejects(
      createRevision(
        "duplicate-version",
        1,
        "00000000-0000-4000-8000-000000000002",
      ),
      "23505",
    );
    await rejects(createRevision("duplicate-key", 2), "23505");
    await rejects(`UPDATE "StudentSignupRevision" SET answers = '{}'`, "P0001");
    await rejects(`DELETE FROM "StudentSignupRevision"`, "P0001");
    await rejects(
      `INSERT INTO "StudentSignupRevision" (id,"surveyId","expectedVersion",version,"actorUserId","clientKey","inputHash",answers,"policyRevision") VALUES ('partial-consent','original',1,2,'original-owner','00000000-0000-4000-8000-000000000002','${"b".repeat(64)}','{}','invented')`,
      "23514",
    );
    expect(
      (
        await client.query(
          'SELECT payload, "currentPayload" FROM "StudentSurvey"',
        )
      ).rows,
    ).toEqual([
      {
        payload: {
          englishName: "Original",
          signatureName: "Original Signature",
        },
        currentPayload: { englishName: "Current" },
      },
    ]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
