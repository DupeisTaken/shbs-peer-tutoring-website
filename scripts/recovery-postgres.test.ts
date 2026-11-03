/** Opt-in staging rehearsal. The caller owns two already running isolated clusters. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import {
  databaseIdentity,
  postgresClientUrl,
} from "../src/server/recovery/operator-plan";
import {
  createSitePlan,
  executeRecoveryTool,
  stageSitePlan,
  withSealedSiteTarget,
  type SiteDependencies,
} from "../src/server/recovery/operator-site";
import { applySiteReconciliation, createSiteReconciliationPlan, inspectSiteSecurityReconciliation } from "../src/server/recovery/operator-reconcile";
import { applyIsolatedCutover, applyIsolatedRollback, applySiteAcceptance, createIsolatedCutoverPlan, createIsolatedRollbackPlan, createSiteAcceptancePlan } from "../src/server/recovery/operator-cutover";
import {hashPassword} from "../src/server/auth/password";

const sourceAdminUrl = process.env.SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL;
const stagingAdminUrl = process.env.SHBS_RECOVERY_TEST_STAGING_ADMIN_URL;

/** Compare every public row without publishing credentials or private evidence. */
async function rowFingerprints(client: Client) {
  const tables = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const fingerprints: Record<string, string> = {};
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    for (const { name } of tables.rows) {
      const table = `"${name.replaceAll('"', '""')}"`;
      const rows = await client.query<{ rows: unknown }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM public.${table} t`,
      );
      fingerprints[name] = createHash("sha256")
        .update(JSON.stringify(rows.rows[0]?.rows))
        .digest("hex");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return fingerprints;
}

void test(
  "real migrated PostgreSQL restore preserves exact checkpoint values and every source row",
  { skip: !sourceAdminUrl || !stagingAdminUrl, timeout: 360_000 },
  async (t) => {
    assert.ok(sourceAdminUrl && stagingAdminUrl);
    const sourceIdentity = databaseIdentity(sourceAdminUrl);
    const stageIdentity = databaseIdentity(stagingAdminUrl);
    for (const identity of [sourceIdentity, stageIdentity]) {
      assert.ok(
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(identity.host),
      );
      assert.match(identity.database, /^shbs_[a-z0-9_]+_test$/);
    }
    assert.notEqual(
      sourceIdentity.port,
      stageIdentity.port,
      "Two separately owned PostgreSQL instances are required.",
    );
    const suffix = randomBytes(6).toString("hex");
    const role = `shbs_recovery_owner_${suffix}`;
    const stageApplicationRole=`shbs_recovery_accept_${suffix}`;
    const rollbackApplicationRole=`shbs_recovery_return_${suffix}`;
    const sourceName = `shbs_recovery_source_${suffix}_test`;
    const targetName = `shbs_recovery_stage_${suffix}_test`;
    const password = randomBytes(24).toString("hex");
    const checkpointAuthSecret=randomBytes(48).toString("hex");
    const oldIndependentPassword="Synthetic-original-login-493!";
    const dir = await mkdtemp(join(tmpdir(), "shbs-recovery-pg-"));
    const sourceAdmin = new Client({
      connectionString: postgresClientUrl(sourceAdminUrl),
    });
    const stageAdmin = new Client({
      connectionString: postgresClientUrl(stagingAdminUrl),
    });
    await sourceAdmin.connect();
    try {
      await stageAdmin.connect();
    } catch (error) {
      await sourceAdmin.end();
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    const clients: Client[] = [];
    let sourceRole = false;
    let targetRole = false;
    let sourceCreated = false;
    t.after(async () => {
      // Only fresh random fixture identifiers are ever dropped. No supplied database is reset.
      for (const client of clients) await client.end().catch(() => undefined);
      assert.match(sourceName, /^shbs_recovery_source_[a-f0-9]{12}_test$/);
      assert.match(targetName, /^shbs_recovery_stage_[a-f0-9]{12}_test$/);
      const failures: string[] = [];
      try {
        await stageAdmin
          .query(`DROP DATABASE IF EXISTS "${targetName}"`)
          .catch(() => {
            failures.push("target database");
          });
        if (sourceCreated)
          await sourceAdmin.query(`DROP DATABASE "${sourceName}"`).catch(() => {
            failures.push("source fixture database");
          });
        if (targetRole)
          await stageAdmin.query(`DROP ROLE "${role}"`).catch(() => {
            failures.push("target fixture role");
          });
        await stageAdmin.query(`DROP ROLE IF EXISTS "${stageApplicationRole}"`).catch(()=>{failures.push("stage acceptance role");});
        await sourceAdmin.query(`DROP ROLE IF EXISTS "${rollbackApplicationRole}"`).catch(()=>{failures.push("rollback acceptance role");});
        if (sourceRole)
          await sourceAdmin.query(`DROP ROLE "${role}"`).catch(() => {
            failures.push("source fixture role");
          });
      } finally {
        await sourceAdmin.end();
        await stageAdmin.end();
        await rm(dir, { recursive: true, force: true });
      }
      assert.deepEqual(
        failures,
        [],
        "Owned integration fixture cleanup must complete.",
      );
    });
    // Random hex password and strictly generated identifiers cannot introduce SQL syntax.
    await sourceAdmin.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    );
    sourceRole = true;
    await stageAdmin.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    targetRole = true;
    await sourceAdmin.query(
      `CREATE DATABASE "${sourceName}" OWNER "${role}" TEMPLATE template0`,
    );
    sourceCreated = true;
    const sourceUrl = new URL(sourceAdminUrl);
    sourceUrl.pathname = `/${sourceName}`;
    sourceUrl.username = role;
    sourceUrl.password = password;
    const app = new Client({
      connectionString: postgresClientUrl(sourceUrl.toString()),
    });
    clients.push(app);
    await app.connect();
    // Exercise the committed schema, enum types, constraints and triggers. This
    // fixture owns a fresh database; no supplied maintenance database is migrated.
    const migrationsRoot = resolve(import.meta.dirname, "../prisma/migrations");
    const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      await app.query(
        await readFile(
          join(migrationsRoot, migration, "migration.sql"),
          "utf8",
        ),
      );
    }
    const identityInstalled=(await app.query<{present:boolean}>("SELECT to_regclass('public.\"RetiredHistoryOwnership\"') IS NOT NULL AS present")).rows[0]?.present===true;
    await app.query(`INSERT INTO "Person" (id,"updatedAt") VALUES ('source-person',NOW()),('reader-person',NOW())`);
    await app.query(`INSERT INTO "Tutor" (id, "englishName", status, "updatedAt") VALUES
      ('checkpoint-tutor', 'Synthetic tutor 教员', 'ACTIVE', '2026-01-01T00:00:00Z'),
      ('qualified-active-tutor','Independent qualified tutor','ACTIVE','2026-01-01T00:00:00Z')`);
    await app.query(`INSERT INTO "User" (id, name, email, role, "passwordHash", "tutorId", "crewStatus", "canTranslate") VALUES
      ('checkpoint', 'Synthetic checkpoint 检查点', 'checkpoint@example.test', 'TUTOR', 'synthetic-old-password-hash', 'checkpoint-tutor', 'ACTIVE', false),
      ('independent', 'Independent account', 'independent@example.test', 'VIEWER', $1, NULL, NULL, false),
      ('retired', 'Retired account evidence', 'retired@example.test', 'VIEWER', 'synthetic-retired-password-hash', NULL, NULL, false),
      ('backup-only', 'Deleted after checkpoint', 'backup-only@example.test', 'ADMIN', 'synthetic-backup-only-password-hash', NULL, NULL, true)`,[hashPassword(oldIndependentPassword)]);
    await app.query(`UPDATE "User" SET username=id,"emailVerifiedAt"='2026-01-01'; UPDATE "User" SET "personId"='source-person' WHERE id='retired'`);
    await app.query(`INSERT INTO "ServiceHourAdjustment" (id, month, "schoolYear", quarter, type, amount, reason, "tutorId") VALUES
      ('checkpoint-hours', '2026-01', '25-26', 'Q1', 'EXTRA', 1.25, 'Synthetic immutable history', 'checkpoint-tutor')`);
    await app.query(`INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt") VALUES
      ('checkpoint-reset', 'checkpoint', 'synthetic-reset-hash', '2099-01-01T00:00:00Z')`);
    await app.query(`INSERT INTO "RegistrationCode" (id, code, "expiresAt") VALUES
      ('checkpoint-code', 'ABCDE', '2099-01-01T00:00:00Z')`);
    await app.query(`INSERT INTO "SessionCalendarToken" (id, "userId", "tokenHash") VALUES
      ('checkpoint-calendar', 'checkpoint', 'synthetic-calendar-hash')`);
    await app.query(`INSERT INTO "EmailDelivery" (id,"userId",category,event,recipient) VALUES
      ('checkpoint-outbound','independent','info','program_update','independent@example.test'),
      ('synthetic-worker-control','independent','security','security_changed','independent@example.test')`);
    await app.query(`
      INSERT INTO "Subject" (id,name,"baseName") VALUES ('synthetic-subject','Synthetic subject','Synthetic subject');
      INSERT INTO "Subject" (id,name,"baseName") VALUES ('independent-subject','Independent approved subject','Independent approved subject');
      INSERT INTO "TutorQualification" ("tutorId","subjectId","approvedById",status) VALUES ('checkpoint-tutor','synthetic-subject','independent','APPROVED');
      INSERT INTO "TutorQualification" ("tutorId","subjectId","approvedById",status) VALUES ('qualified-active-tutor','independent-subject','independent','APPROVED');
      INSERT INTO "QualificationGrant" ("tutorId","sourceSubjectId","subjectId") VALUES ('checkpoint-tutor','synthetic-subject','synthetic-subject');
      INSERT INTO "QualificationGrant" ("tutorId","sourceSubjectId","subjectId") VALUES ('qualified-active-tutor','independent-subject','independent-subject');
      INSERT INTO "MessagePermission" (scope,groups,"updatedAt") VALUES ('USER:independent',ARRAY['MANAGEMENT'],NOW());
      INSERT INTO "MessageRestriction" ("userId",restricted,"updatedAt") VALUES ('independent',false,NOW());
      INSERT INTO "ViewerSignup" (id,email,name,affiliation,"codeHash","codeExpiresAt") VALUES ('viewer-proof','viewer@example.test','Synthetic viewer','Synthetic','old-viewer-proof','2099-01-01');
      INSERT INTO "CrewSignupVerification" (id,email,"codeHash","codeExpiresAt") VALUES ('crew-proof','crew@example.test','old-crew-proof','2099-01-01');
      INSERT INTO "EmailVerificationCode" (id,"userId","codeHash","expiresAt") VALUES ('email-proof','independent','old-email-proof','2099-01-01');
      INSERT INTO "AccountInvitation" (id,kind,email,"sourceKey",source,"codeHash","expiresAt") VALUES ('account-proof','VIEWER','independent@example.test','synthetic-source','{}','old-account-proof','2099-01-01');
      INSERT INTO "StudentSignup" (email,name,"codeHash","expiresAt") VALUES ('student@example.test','Synthetic student','old-student-proof','2099-01-01');
      INSERT INTO "StudentSurvey" (id,email,"intakeTermId",payload,"policyRevision","policySnapshot","tokenHash","expiresAt") VALUES ('survey-proof','student@example.test','synthetic-term','{}','synthetic-policy','{}','old-survey-proof','2099-01-01');
      INSERT INTO "StudentSignupIntent" (id,"keyHash","inputHash",email,"surveyId","expectedVersion",payload,"policySnapshot","tokenHash","expiresAt") VALUES ('intent-proof','synthetic-key','synthetic-input','student@example.test','survey-proof',0,'{}','{}','old-intent-proof','2099-01-01');
      INSERT INTO "StudentSignupNotice" (id,"surveyId","invalidityVersion",kind,"tokenHash") VALUES ('notice-proof','survey-proof',0,'SYNTHETIC','old-notice-proof');
      INSERT INTO "Tutee" (id,"englishName","updatedAt") VALUES ('historical-tutee','Synthetic history','2026-01-01');
      INSERT INTO "TuteeHistoryInvitation" ("tuteeId","tokenHash",email,"expectedUpdatedAt","issuedById",reason,"expiresAt") VALUES ('historical-tutee','old-tutee-proof','student@example.test','2026-01-01','independent','Synthetic','2099-01-01');
      INSERT INTO "TuteeHistoryInvitationAttempt" (id,"tuteeId","tokenHash","predecessorFingerprint",email,"expectedUpdatedAt","issuedById",reason,"expiresAt") VALUES ('history-attempt','historical-tutee','old-attempt-proof','synthetic-predecessor','student@example.test','2026-01-01','independent','Synthetic','2099-01-01');
      INSERT INTO "HistoricalRecordInvitation" ("scopeKey","tokenHash",sources,"scopeFingerprint",email,"issuedById","issuedBySessionVersion",reason,"expiresAt") VALUES ('history-scope','old-history-proof','[]','synthetic-scope','independent@example.test','independent',0,'Synthetic','2099-01-01');
      INSERT INTO "HistoricalRecordInvitationAttempt" (id,"scopeKey","inputHash","tokenHash",sources,"scopeFingerprint","predecessorFingerprint",email,"issuedById","issuedBySessionVersion",reason,"expiresAt") VALUES ('typed-history-attempt','history-scope','synthetic-input','old-typed-attempt-proof','[]','synthetic-scope','synthetic-predecessor','independent@example.test','independent',0,'Synthetic','2099-01-01');
      INSERT INTO "HistoricalRecordClaimReceipt" ("tokenHash",sources,"userId","sessionVersion",email,"expiresAt") VALUES ('old-claim-proof','[]','independent',0,'independent@example.test','2099-01-01');
      INSERT INTO "StudentActionConfirmation" (id,"userId",action,target,"readyAt","expiresAt") VALUES ('confirmation-proof','independent','SYNTHETIC','synthetic','2026-01-01','2099-01-01');
      INSERT INTO "CaptchaGrant" ("tokenHash",action,"identityHash",scene,version,"expiresAt") VALUES ('old-captcha-proof','synthetic','synthetic','synthetic',1,'2099-01-01');
      INSERT INTO "CaptchaProof" (key,"expiresAt") VALUES ('old-captcha-key','2099-01-01');
      INSERT INTO "SignupLease" (slot,owner,"expiresAt") VALUES ('synthetic-slot','synthetic-owner','2099-01-01');
      INSERT INTO "SchoolHoursSchedule" (id,enabled,"updatedAt") VALUES ('program',true,NOW());
      INSERT INTO "SchoolHoursReport" (id,"scheduleId",month,revision,"configVersion","baselineVersion","timeZone",snapshot,"sourceBaseline","intendedRecipients","contentHash","generationKey","generationHash","linkTokenHash") VALUES ('school-report','program','2026-01',1,0,0,'Asia/Shanghai','{}','{}','{}','synthetic-content','synthetic-generation','synthetic-hash','old-school-link');
      INSERT INTO "MonthlyHoursSchedule" (id,enabled,"updatedAt") VALUES ('program',true,NOW());
      INSERT INTO "Term" (id,"schoolYear",quarter,name) VALUES ('synthetic-term','25-26','Q1','Synthetic quarter');
      INSERT INTO "ScheduledProgramRefresh" (id,"sourceTermId","sourceSchoolYear","sourceQuarter","destinationSchoolYear","destinationQuarter","semesterMode","executeAt","timeZone","expectedPreparation","authorizedById","authorityRevision","updatedAt") VALUES ('synthetic-refresh','synthetic-term','25-26','Q1','25-26','Q2',false,'2026-01-01','Asia/Shanghai','{}','independent',0,NOW());
      INSERT INTO "SessionNotice" (id,"dedupeKey","recipientUserId","recipientEmail",event,context,"updatedAt") VALUES ('synthetic-session-notice','synthetic-dedupe','independent','independent@example.test','synthetic','{}',NOW());
    `);
    const checkpointRows = await rowFingerprints(app);
    const plain = join(dir, "checkpoint.sql");
    await executeRecoveryTool({
      tool: "pg_dump",
      args: ["--no-password"],
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PGHOST: sourceIdentity.host.replace(/^\[(.*)\]$/, "$1"),
        PGPORT: sourceIdentity.port,
        PGDATABASE: sourceName,
        PGUSER: role,
        PGPASSWORD: password,
        PGCONNECT_TIMEOUT: "10",
      },
      outputPath: plain,
    });
    const backup = join(dir, "checkpoint.sql.gz");
    await pipeline(
      createReadStream(plain),
      createGzip(),
      createWriteStream(backup, { flags: "wx", mode: 0o600 }),
    );
    await app.query(`UPDATE "User" SET name='Later independent contact edit',
      "passwordHash"='synthetic-new-password-hash', "suspendedAt"='2026-02-01T00:00:00Z',
      "suspendedReason"='Synthetic suspension', "tutorAccessRevoked"=true,
      "crewStatus"='INACTIVE' WHERE id='checkpoint'`);
    await app.query(
      `UPDATE "User" SET role='ADMIN', "canTranslate"=true WHERE id='independent'`,
    );
    await app.query(
      `UPDATE "User" SET "mergedIntoId"='independent', "passwordHash"=NULL WHERE id='retired'`,
    );
    await app.query(
      `UPDATE "Tutor" SET status='ARCHIVED', "preferredAssignedBlocks"=0 WHERE id='checkpoint-tutor'`,
    );
    await app.query(
      `DELETE FROM "RegistrationCode" WHERE id='checkpoint-code'`,
    );
    await app.query(
      `UPDATE "SessionCalendarToken" SET "revokedAt"='2026-02-01T00:00:00Z' WHERE id='checkpoint-calendar'`,
    );
    await app.query(
      `UPDATE "EmailDelivery" SET status='SENT', "completedAt"='2026-02-01T00:00:00Z' WHERE id='checkpoint-outbound'`,
    );
    await app.query(`INSERT INTO "SchoolDeparture" ("userId", source, "observerRevoked", "tutorDerived") VALUES
      ('checkpoint', 'SYNTHETIC_REHEARSAL', true, true)`);
    await app.query(`INSERT INTO "User" (id, name, email, role) VALUES
      ('later', 'Independent later record', 'later@example.test', 'VIEWER')`);
    await app.query(`UPDATE "User" SET "personId"='reader-person',username='later',"emailVerifiedAt"='2026-01-01' WHERE id='later'`);
    await app.query('DELETE FROM "User" WHERE id=\'backup-only\'');
    await app.query('UPDATE "User" SET "passwordHash"=NULL WHERE id=\'independent\'');
    await app.query('ALTER TABLE "User" DISABLE TRIGGER account_session_version');
    await app.query('UPDATE "User" SET "sessionVersion"=1000 WHERE id=\'independent\'');
    await app.query('ALTER TABLE "User" ENABLE TRIGGER account_session_version');
    await app.query(`UPDATE "TutorQualification" SET status='REJECTED' WHERE "tutorId"='checkpoint-tutor' AND "subjectId"='synthetic-subject'; DELETE FROM "QualificationGrant" WHERE "tutorId"='checkpoint-tutor' AND "subjectId"='synthetic-subject'; UPDATE "MessageRestriction" SET restricted=true WHERE "userId"='independent'; UPDATE "MessagePermission" SET groups=ARRAY[]::text[] WHERE scope='USER:independent'`);
    if(identityInstalled)await app.query(`
      INSERT INTO "PersonHistoryCorrectionReceipt" (id,"actorId","inputHash","personId","destinationPersonId","sourceUserIds",before,after,subjects) VALUES ('synthetic-history-correction','independent','synthetic-input','source-person','reader-person',ARRAY['retired'],'{"readerUserId":"independent"}','{"readerUserId":"later"}','[{"entity":"Person","recordId":"source-person"},{"entity":"Person","recordId":"reader-person"},{"entity":"User","recordId":"retired"},{"entity":"User","recordId":"later"},{"entity":"Tutee","recordId":"historical-tutee"}]');
      UPDATE "RetiredHistoryOwnership" SET "readerUserId"='later',"receiptId"='synthetic-history-correction',"updatedAt"=NOW() WHERE "sourceUserId"='retired';
      INSERT INTO "HistoryRowOwnership" (entity,"recordId","readerUserId","sourceUserIds","receiptId") VALUES ('Tutee','historical-tutee','later',ARRAY['retired'],'synthetic-history-correction');
      INSERT INTO "StudentProfileOwnership" ("tuteeId","userId") VALUES ('historical-tutee','later');
      UPDATE "User" SET "personId"='reader-person' WHERE id='retired';
    `);
    const sourceBefore = await rowFingerprints(app);
    const evidenceDir = join(dir, "evidence");
    await mkdir(evidenceDir, { mode: 0o700 });
    const dependencies: SiteDependencies = {
      execute: executeRecoveryTool,
      async connect(connectionString) {
        const client = new Client({
          connectionString: postgresClientUrl(connectionString),
          connectionTimeoutMillis: 10_000,
        });
        await client.connect();
        return {
          async query(sql, values) {
            const result = await client.query<Record<string, unknown>>(
              sql,
              values,
            );
            return { rows: result.rows };
          },
          async close() {
            await client.end();
          },
        };
      },
    };
    const plan = await createSitePlan(
      { backup, targetName, evidenceDir },
      sourceUrl.toString(),
      stagingAdminUrl,
      dependencies,
    );
    const receipt = await stageSitePlan(
      plan,
      sourceUrl.toString(),
      stagingAdminUrl,
      "Synthetic isolated integration rehearsal",
      dependencies,
    );
    assert.equal(receipt.state, "SEALED_STAGING_ONLY");
    assert.deepEqual(await stageSitePlan(plan,sourceUrl.toString(),stagingAdminUrl,"Same-intent completed stage resume",dependencies),receipt);
    assert.deepEqual(
      receipt.comparison.find((entry) => entry.table === "User"),
      { table: "User", before: "4", restored: "4", changed: false },
    );
    assert.deepEqual(
      await rowFingerprints(app),
      sourceBefore,
      "Every source row, including current security state and later work, must remain unchanged.",
    );
    const target = await stageAdmin.query<{ datallowconn: boolean }>(
      "SELECT datallowconn FROM pg_database WHERE datname=$1",
      [targetName],
    );
    assert.equal(target.rows[0]?.datallowconn, false);
    // Explicit operator inspection on the isolated target. No application,
    // worker, migration runner or delivery process is ever started here.
    let inspected = false;
    let securityInspection:
      Awaited<ReturnType<typeof inspectSiteSecurityReconciliation>> | undefined;
    await stageAdmin.query(
      `ALTER DATABASE "${targetName}" ALLOW_CONNECTIONS true`,
    );
    try {
      const targetUrl = new URL(stagingAdminUrl);
      targetUrl.pathname = `/${targetName}`;
      const restored = new Client({
        connectionString: postgresClientUrl(targetUrl.toString()),
      });
      await restored.connect();
      try {
        assert.deepEqual(
          await rowFingerprints(restored),
          checkpointRows,
          "Every restored row must equal the exact checkpoint, including historical values.",
        );
        const values =
          await restored.query(`SELECT name, role, "crewStatus", "canTranslate",
          "suspendedAt", "tutorAccessRevoked", "sessionVersion",
          ("passwordHash"='synthetic-old-password-hash') AS "oldCredentialPresent"
          FROM "User" WHERE id='checkpoint'`);
        assert.deepEqual(values.rows, [
          {
            name: "Synthetic checkpoint 检查点",
            role: "TUTOR",
            crewStatus: "ACTIVE",
            canTranslate: false,
            suspendedAt: null,
            tutorAccessRevoked: false,
            sessionVersion: 0,
            oldCredentialPresent: true,
          },
        ]);
        const history = await restored.query(
          `SELECT amount, reason FROM "ServiceHourAdjustment" WHERE id='checkpoint-hours'`,
        );
        assert.deepEqual(history.rows, [
          { amount: 1.25, reason: "Synthetic immutable history" },
        ]);
        const retired = await restored.query(
          `SELECT "mergedIntoId" FROM "User" WHERE id='retired'`,
        );
        assert.equal(retired.rows[0]?.mergedIntoId, null);
        const readOnlyAdapter = (client: Client) => ({
          async query(sql: string, values?: unknown[]) {
            const { rows } = await client.query<Record<string, unknown>>(
              sql,
              values,
            );
            return { rows };
          },
          async close() {
            /* Caller owns these already open fixture connections. */
          },
        });
        securityInspection = await inspectSiteSecurityReconciliation(
          readOnlyAdapter(app),
          readOnlyAdapter(restored),
        );
        assert.equal(securityInspection.schemaMatches, true);
        assert.equal(
          securityInspection.state,
          "BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW",
        );
        for (const table of ["User", "Tutor", "SchoolDeparture"]) {
          assert.equal(
            securityInspection.comparison.find((entry) => entry.table === table)
              ?.changed,
            true,
          );
        }
        assert.equal(
          securityInspection.restoredCredentials.passwordBearingAccounts,
          "4",
        );
        assert.notEqual(
          securityInspection.currentFingerprint,
          securityInspection.restoredFingerprint,
        );
        assert.deepEqual(
          await rowFingerprints(restored),
          checkpointRows,
          "Security inspection must never reconcile, mutate or delete restored evidence.",
        );
        inspected = true;
      } finally {
        await restored.end();
      }
    } finally {
      await stageAdmin.query(
        `ALTER DATABASE "${targetName}" ALLOW_CONNECTIONS false`,
      );
    }
    assert.equal(inspected, true);
    assert.deepEqual(await rowFingerprints(app), sourceBefore);
    const fence = await stageAdmin.query<{ datallowconn: boolean }>(
      "SELECT datallowconn FROM pg_database WHERE datname=$1",
      [targetName],
    );
    assert.equal(fence.rows[0]?.datallowconn, false);
    const currentEvidence = await readFile(
      join(receipt.evidenceDirectory, "current-site.dump"),
    );
    assert.equal(currentEvidence.subarray(0, 5).toString("ascii"), "PGDMP");
    await stageAdmin.query(`CREATE ROLE "${stageApplicationRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    await sourceAdmin.query(`CREATE ROLE "${rollbackApplicationRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    await app.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${rollbackApplicationRole}"`);
    await withSealedSiteTarget(plan,stagingAdminUrl,dependencies,async target=>{
      await target.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${stageApplicationRole}"`);
    });
    const signing={previousAuthSecret:randomBytes(48).toString("hex"),rotatedAuthSecret:randomBytes(48).toString("hex")};
    const reconciliationInput={stagePlan:plan,stageReceipt:receipt,...signing};
    const failedPlan=await createSiteReconciliationPlan(reconciliationInput,sourceUrl.toString(),stagingAdminUrl,dependencies);
    const failureDependencies:SiteDependencies={...dependencies,async connect(url){
      const db=await dependencies.connect(url);
      return {...db,async query(sql,values){if(new URL(url).pathname===`/${targetName}`&&sql==='UPDATE public."ProgramSettings" SET "emailNotificationsEnabled"=false')throw new Error("Synthetic failure after named trigger disable");return await db.query(sql,values);}};
    }};
    await assert.rejects(applySiteReconciliation(failedPlan,sourceUrl.toString(),stagingAdminUrl,{...signing,reason:"Synthetic transactional failure fencing"},failureDependencies),/SECURITY_RECONCILIATION_FAILED_SEALED/);
    assert.equal((await stageAdmin.query('SELECT datallowconn FROM pg_database WHERE datname=$1',[targetName])).rows[0]?.datallowconn,false);
    await withSealedSiteTarget(plan,stagingAdminUrl,dependencies,async target=>{
      assert.equal((await target.query('SELECT tgenabled FROM pg_trigger WHERE tgrelid=\'public."User"\'::regclass AND tgname=\'account_session_version\'')).rows[0]?.tgenabled,"O","Rollback must restore the exact named trigger enable state.");
    });
    const staleReconciliation=await createSiteReconciliationPlan(reconciliationInput,sourceUrl.toString(),stagingAdminUrl,dependencies);
    await app.query('UPDATE "User" SET "emailInfo"=true WHERE id=\'independent\'');
    await assert.rejects(applySiteReconciliation(staleReconciliation,sourceUrl.toString(),stagingAdminUrl,{...signing,reason:"Synthetic stale-source rejection"},dependencies),/STALE_SOURCE_SECURITY_FINGERPRINT/);
    const sourceBeforeReconciliation=await rowFingerprints(app);
    const reconciliationPlan=await createSiteReconciliationPlan(reconciliationInput,sourceUrl.toString(),stagingAdminUrl,dependencies);
    const reconciliationReceipt=await applySiteReconciliation(reconciliationPlan,sourceUrl.toString(),stagingAdminUrl,{...signing,reason:"Synthetic reviewed security reconciliation"},dependencies);
    assert.equal(reconciliationReceipt.state,"SECURITY_RECONCILED_SEALED");
    assert.equal(reconciliationReceipt.accountsQuarantined,1);
    assert.deepEqual(await applySiteReconciliation(reconciliationPlan,sourceUrl.toString(),stagingAdminUrl,{...signing,reason:"Same-intent synthetic resume"},dependencies),reconciliationReceipt);
    await withSealedSiteTarget(plan,stagingAdminUrl,dependencies,async target=>{
      const account=(await target.query('SELECT role,"canTranslate","sessionVersion","emailInfo","passwordHash" FROM "User" WHERE id=\'independent\'')).rows[0];
      assert.equal(account?.role,"ADMIN");assert.equal(account?.canTranslate,true);assert.equal(account?.emailInfo,true);
      assert.ok(Number(account?.sessionVersion)>1000);assert.equal(account?.passwordHash,null);
      const retired=(await target.query('SELECT "mergedIntoId","passwordHash" FROM "User" WHERE id=\'retired\'')).rows[0];
      assert.equal(retired?.mergedIntoId,"independent");assert.equal(retired?.passwordHash,null);
      const quarantined=(await target.query('SELECT "recoveryVoidedAt","suspendedAt","passwordHash","tutorAccessRevoked","canTranslate" FROM "User" WHERE id=\'backup-only\'')).rows[0];
      assert.ok(quarantined?.recoveryVoidedAt);assert.ok(quarantined?.suspendedAt);assert.equal(quarantined?.passwordHash,null);assert.equal(quarantined?.tutorAccessRevoked,true);assert.equal(quarantined?.canTranslate,false);
      const later=(await target.query('SELECT name,"passwordHash" FROM "User" WHERE id=\'later\'')).rows[0];
      assert.equal(later?.name,"Independent later record");assert.equal(later?.passwordHash,null);
      const contact=(await target.query('SELECT name,"suspendedAt","tutorAccessRevoked","crewStatus" FROM "User" WHERE id=\'checkpoint\'')).rows[0];
      assert.equal(contact?.name,"Later independent contact edit");assert.ok(contact?.suspendedAt);assert.equal(contact?.tutorAccessRevoked,true);assert.equal(contact?.crewStatus,"INACTIVE");
      for(const [table,condition] of [
        ['ViewerSignup','"codeExpiresAt">NOW()'],['CrewSignupVerification','"codeExpiresAt">NOW()'],
        ['StudentSignup','"expiresAt">NOW()'],['RegistrationCode','code IS NOT NULL OR "expiresAt">NOW()'],
        ['AccountInvitation','"expiresAt">NOW()'],['EmailVerificationCode','"consumedAt" IS NULL'],
        ['PasswordResetToken','"consumedAt" IS NULL'],['StudentSurvey','"expiresAt">NOW()'],['StudentSignupIntent','"expiresAt">NOW()'],
        ['StudentSignupNotice','"tokenHash" IS NOT NULL'],['TuteeHistoryInvitation','"expiresAt">NOW()'],
        ['HistoricalRecordInvitation','"expiresAt">NOW()'],['StudentActionConfirmation','"usedAt" IS NULL'],
        ['SessionCalendarToken','"revokedAt" IS NULL'],['SchoolHoursReport','"linkRevokedAt" IS NULL'],
        ['CaptchaGrant','TRUE'],['CaptchaProof','TRUE'],['SignupLease','TRUE'],
      ] as const) {
        const proof=await target.query(`SELECT count(*)::text AS count FROM "${table}" WHERE ${condition}`);
        assert.equal(proof.rows[0]?.count,"0",`${table} must not retain a usable pre-restore capability.`);
      }
      assert.equal((await target.query('SELECT status FROM "EmailDelivery" WHERE id=\'checkpoint-outbound\'')).rows[0]?.status,"SENT");
      assert.equal((await target.query('SELECT status FROM "SessionNotice" WHERE id=\'synthetic-session-notice\'')).rows[0]?.status,"CANCELLED_RECOVERY");
      assert.equal((await target.query('SELECT state FROM "ScheduledProgramRefresh" WHERE id=\'synthetic-refresh\'')).rows[0]?.state,"CANCELLED");
      assert.equal((await target.query('SELECT enabled FROM "SchoolHoursSchedule" WHERE id=\'program\'')).rows[0]?.enabled,false);
      assert.equal((await target.query('SELECT restricted FROM "MessageRestriction" WHERE "userId"=\'independent\'')).rows[0]?.restricted,true);
      assert.deepEqual((await target.query('SELECT groups FROM "MessagePermission" WHERE scope=\'USER:independent\'')).rows[0]?.groups,[]);
      assert.equal((await target.query('SELECT status FROM "TutorQualification" WHERE "tutorId"=\'checkpoint-tutor\' AND "subjectId"=\'synthetic-subject\'')).rows[0]?.status,"REJECTED");
      assert.equal((await target.query('SELECT count(*)::text AS count FROM "QualificationGrant" WHERE "tutorId"=\'checkpoint-tutor\' AND "subjectId"=\'synthetic-subject\'')).rows[0]?.count,"0");
      assert.equal((await target.query('SELECT status FROM "TutorQualification" WHERE "tutorId"=\'qualified-active-tutor\' AND "subjectId"=\'independent-subject\'')).rows[0]?.status,"APPROVED");
      assert.equal((await target.query('SELECT count(*)::text AS count FROM "QualificationGrant" g JOIN "TutorQualification" q ON q."tutorId"=g."tutorId" AND q."subjectId"=g."sourceSubjectId" JOIN "Tutor" t ON t.id=g."tutorId" JOIN "Subject" s ON s.id=g."subjectId" WHERE g."tutorId"=\'qualified-active-tutor\' AND g."subjectId"=\'independent-subject\' AND q.status=\'APPROVED\' AND t.status=\'ACTIVE\' AND s.active')).rows[0]?.count,"1");
      if(identityInstalled) {
        assert.equal((await target.query('SELECT "readerUserId" FROM "RetiredHistoryOwnership" WHERE "sourceUserId"=\'retired\'')).rows[0]?.readerUserId,"later");
        assert.equal((await target.query('SELECT "readerUserId" FROM "HistoryRowOwnership" WHERE entity=\'Tutee\' AND "recordId"=\'historical-tutee\'')).rows[0]?.readerUserId,"later");
        assert.equal((await target.query('SELECT "mergedIntoId" FROM "User" WHERE id=\'retired\'')).rows[0]?.mergedIntoId,"independent","Private reader correction must never rewrite permanent credential retirement.");
        assert.ok(Number((await target.query('SELECT "historyAccessRevision" FROM "User" WHERE id=\'later\'')).rows[0]?.historyAccessRevision)>0);
        assert.equal((await target.query('SELECT count(*)::text AS count FROM "PersonHistoryCorrectionReceipt" WHERE id=\'synthetic-history-correction\'')).rows[0]?.count,"1");
      }
      for(const table of ['TuteeHistoryInvitationAttempt','HistoricalRecordInvitationAttempt','HistoricalRecordClaimReceipt'])
        assert.equal((await target.query(`SELECT count(*)::text AS count FROM "${table}"`)).rows[0]?.count,"1","Immutable proof/claim history must remain.");
    });
    assert.deepEqual(await rowFingerprints(app),sourceBeforeReconciliation);
    const applicationUrl=new URL(stagingAdminUrl);applicationUrl.pathname=`/${targetName}`;applicationUrl.username=stageApplicationRole;applicationUrl.password=password;
    const acceptancePlan=await createSiteAcceptancePlan({reconciliationPlan,reconciliationReceipt,applicationUrl:applicationUrl.toString(),acceptanceUserId:"independent"},sourceUrl.toString(),stagingAdminUrl,dependencies);
    const acceptanceReceipt=await applySiteAcceptance(acceptancePlan,sourceUrl.toString(),stagingAdminUrl,{...signing,checkpointAuthSecret,rejectedPasswords:[oldIndependentPassword],applicationUrl:applicationUrl.toString(),freshPassword:"Synthetic-new-login-493!",reason:"Isolated native auth and worker acceptance"},dependencies);
    assert.equal(acceptanceReceipt.state,"ACCEPTED_ISOLATED_READ_ONLY_SEALED");
    assert.ok(checkpointAuthSecret!==signing.previousAuthSecret);
    assert.ok(acceptanceReceipt.checks.includes("OLD_CHECKPOINT_SIGNING_KEY_REJECTED"));
    assert.ok(acceptanceReceipt.checks.includes("OLD_CURRENT_SIGNING_KEY_REJECTED"));
    assert.deepEqual(await applySiteAcceptance(acceptancePlan,sourceUrl.toString(),stagingAdminUrl,{...signing,applicationUrl:applicationUrl.toString(),freshPassword:"Synthetic-new-login-493!",reason:"Same-intent acceptance receipt resume"},dependencies),acceptanceReceipt);
    const pointerPath=join(dir,"isolated-deployment.json");
    const cutoverPlan=await createIsolatedCutoverPlan({acceptancePlan,acceptanceReceipt,pointerPath},sourceUrl.toString(),stagingAdminUrl,dependencies);
    await app.end();
    let lateSourceWriterRejected=false;
    const cutoverRaceDependencies:SiteDependencies={...dependencies,async connect(url){
      if(databaseIdentity(url).user===stageApplicationRole&&databaseIdentity(url).database===targetName) {
        let late:Awaited<ReturnType<SiteDependencies["connect"]>>|undefined;
        try{late=await dependencies.connect(sourceUrl.toString());await late.query('UPDATE "User" SET "suspendedAt"=NOW() WHERE id=\'independent\'');}
        catch{lateSourceWriterRejected=true;}
        finally{await late?.close();}
        assert.equal(lateSourceWriterRejected,true,"A late source writer must not cross the cutover source connection fence.");
      }
      return await dependencies.connect(url);
    }};
    const cutoverReceipt=await applyIsolatedCutover(cutoverPlan,sourceUrl.toString(),stagingAdminUrl,{...signing,applicationUrl:applicationUrl.toString(),reason:"Synthetic exact-target cutover"},cutoverRaceDependencies);
    assert.equal(cutoverReceipt.state,"ISOLATED_READ_ONLY_CUTOVER");
    assert.deepEqual(await applyIsolatedCutover(cutoverPlan,sourceUrl.toString(),stagingAdminUrl,{...signing,applicationUrl:applicationUrl.toString(),reason:"Same-intent cutover receipt resume"},dependencies),cutoverReceipt);
    assert.equal(JSON.parse(await readFile(pointerPath,"utf8")).target.database,targetName);
    assert.equal(lateSourceWriterRejected,true);
    const sourceReviewUrl=new URL(sourceAdminUrl);sourceReviewUrl.pathname=`/${sourceName}`;
    await sourceAdmin.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS true`);
    const sourceReview=new Client({connectionString:postgresClientUrl(sourceReviewUrl.toString())});
    try{await sourceReview.connect();await sourceAdmin.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS false`);assert.deepEqual(await rowFingerprints(sourceReview),sourceBeforeReconciliation,"Source rows stay intact through accepted isolated cutover.");}
    finally{await sourceReview.end();await sourceAdmin.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS false`);}
    // A new revocation after cutover must survive rollback. Reopening the old
    // pointer alone would silently revive this independent translator grant.
    const newestUrl=new URL(stagingAdminUrl);newestUrl.pathname=`/${targetName}`;
    const newest=await dependencies.connect(newestUrl.toString());
    try{await newest.query('UPDATE "User" SET "canTranslate"=false WHERE id=\'independent\'');}finally{await newest.close();}
    const rollbackApplicationUrl=new URL(sourceAdminUrl);rollbackApplicationUrl.pathname=`/${sourceName}`;rollbackApplicationUrl.username=rollbackApplicationRole;rollbackApplicationUrl.password=password;
    const rollbackSigning={previousAuthSecret:signing.rotatedAuthSecret,rotatedAuthSecret:randomBytes(48).toString("hex")};
    const rollbackPlan=await createIsolatedRollbackPlan({cutoverPlan,cutoverReceipt,currentApplicationUrl:applicationUrl.toString(),rollbackMaintenanceUrl:sourceAdminUrl,rollbackApplicationUrl:rollbackApplicationUrl.toString(),...rollbackSigning},sourceUrl.toString(),stagingAdminUrl,dependencies);
    const rollbackReceipt=await applyIsolatedRollback(rollbackPlan,sourceUrl.toString(),stagingAdminUrl,{...rollbackSigning,rollbackMaintenanceUrl:sourceAdminUrl,rollbackApplicationUrl:rollbackApplicationUrl.toString(),freshPassword:"Synthetic-rollback-login-493!",reason:"Synthetic rollback preserves newest revocation"},dependencies);
    assert.equal(rollbackReceipt.state,"ROLLED_BACK_WITH_NEWEST_SECURITY_READ_ONLY");
    assert.deepEqual(await applyIsolatedRollback(rollbackPlan,sourceUrl.toString(),stagingAdminUrl,{...rollbackSigning,rollbackMaintenanceUrl:sourceAdminUrl,rollbackApplicationUrl:rollbackApplicationUrl.toString(),freshPassword:"Synthetic-rollback-login-493!",reason:"Same-intent rollback receipt resume"},dependencies),rollbackReceipt);
    assert.equal(JSON.parse(await readFile(pointerPath,"utf8")).target.database,sourceName);
    const rolledBack=await dependencies.connect(rollbackApplicationUrl.toString());
    try {
      assert.equal((await rolledBack.query('SELECT "canTranslate" FROM "User" WHERE id=\'independent\'')).rows[0]?.canTranslate,false);
      assert.equal((await rolledBack.query('SELECT amount FROM "ServiceHourAdjustment" WHERE id=\'checkpoint-hours\'')).rows[0]?.amount,1.25);
      assert.ok(Number((await rolledBack.query('SELECT "sessionVersion" FROM "User" WHERE id=\'independent\'')).rows[0]?.sessionVersion)>1002);
    } finally {await rolledBack.close();}
    assert.equal((await stageAdmin.query('SELECT datallowconn FROM pg_database WHERE datname=$1',[targetName])).rows[0]?.datallowconn,false);
    // CI artifacts contain an explicit allowlist only. Raw dumps, connection
    // URLs, credentials, row values and operator evidence never leave tmpdir.
    const artifacts = process.env.SHBS_RECOVERY_TEST_ARTIFACT_DIR;
    if (artifacts) {
      const summary = {
        version: 1,
        kind: "synthetic-postgres-restoration-rehearsal",
        state: rollbackReceipt.state,
        cutover: cutoverReceipt.state,
        migrationsApplied: migrations.length,
        restoredTableCount: Object.keys(checkpointRows).length,
        backupSha256: plan.backup.sha256,
        currentEvidenceSha256: receipt.currentEvidence.sha256,
        checks: {
          nativeDumpAndRestore: true,
          exactRestoredRows: true,
          immutableHistoryPreserved: true,
          allSourceRowsPreserved: true,
          independentLaterSecurityStatePreservedOnSource: true,
          staleRestoredCredentialsDetected: true,
          finalTargetFenceVerified: true,
          currentSecurityReconciled:true,allBearerFamiliesInvalidated:true,
          namedSessionTriggerRestored:true,epochsAdvancedPastBothSnapshots:true,
          realHttpFreshAuthentication:true,oldJwtSigningKeysRejected:true,
          readOnlyWorkersCannotWrite:true,isolatedPointerCutover:true,
          lateSourceWriterRejectedAtPublication:true,
          rollbackPreservesNewestRevocation:true,
        },
        limitations: [
          "Acceptance uses a real isolated HTTP authentication harness and SELECT-only PostgreSQL role; it does not start Next or production workers.",
          "Cutover/rollback are restricted to isolated synthetic test databases and identity-only deployment pointers. No production deployment was changed.",
        ],
        comparison: receipt.comparison,
        securityInspection,
        reconciliationReceipt,acceptanceReceipt,cutoverReceipt,rollbackReceipt,
      };
      await mkdir(resolve(artifacts), { recursive: true, mode: 0o700 });
      await writeFile(
        join(resolve(artifacts), "receipt.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await writeFile(
        join(resolve(artifacts), "report.html"),
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic PostgreSQL restoration rehearsal</title><style>body{max-width:70rem;margin:3rem auto;padding:0 1rem;font:16px/1.6 system-ui;color:#17212b}pre{white-space:pre-wrap;background:#f3f5f7;padding:1rem}</style><h1>Synthetic PostgreSQL restoration rehearsal</h1><p>Native PostgreSQL restore verified exact checkpoint rows and immutable history. Security reconciliation preserved current grants and revocations, invalidated old capabilities, advanced credential epochs, restored the named trigger, and quarantined deferred work.</p><p>Real loopback HTTP authentication accepted fresh credentials and rejected old signing keys and stale sessions. Explicit read-only pointer cutover and rollback retained the newest revocation. Both operations used isolated synthetic databases; no production deployment changed.</p><pre>${JSON.stringify(summary, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></html>`,
        { flag: "wx", mode: 0o600 },
      );
    }
  },
);
