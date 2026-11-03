/** Explicit isolated acceptance/cutover. Production endpoints are never accepted. */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { encode, decode, type JWT } from "next-auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { isSessionCurrent } from "../auth/session-version";
import type { DomainDb } from "../transactions";
import { operatorAssert, OperatorError } from "./operator-cli";
import { readDatabaseRecoveryMarker as databaseMarker } from "./operator-marker";
import {
  databaseIdentity,
  planHash,
  readOperatorPlan,
  writeOperatorJson,
} from "./operator-plan";
import {
  credentials,
  inspectCurrentEvidence,
  withSealedSiteTarget,
  validateStagedSite,
  type OperatorSql,
  type SiteDependencies,
} from "./operator-site";
import {
  assertRotatedSigningSecrets,
  readReconciliationSnapshot,
  reconcileSecuritySnapshot,
  siteReconciliationPlanSchema,
  siteReconciliationReceiptSchema,
  signingKeyFingerprint,
  validateSecurityIdentityClosure,
  type RecoverySigningSecrets,
} from "./operator-reconcile";
import {
  nextCloneEvidenceSchema,
  runIsolatedNextClone,
  type NextCapabilityProofs,
} from "./operator-next";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z
  .object({
    host: z.string(),
    port: z.string(),
    database: z.string(),
    user: z.string(),
  })
  .strict();
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Use the same reviewed source endpoint/role, outside the database we fence. */
export async function connectSourceMaintenance(
  sourceUrl: string,
  dependencies: Pick<SiteDependencies, "connect">,
): Promise<OperatorSql> {
  const source = databaseIdentity(sourceUrl);
  const url = new URL(sourceUrl);
  url.pathname = "/postgres";
  const control = await dependencies.connect(url.toString());
  try {
    const identity = (
      await control.query(
        "SELECT current_database() AS database,current_user AS username",
      )
    ).rows[0];
    operatorAssert(
      identity?.database === "postgres" && identity.username === source.user,
      "CUTOVER_SOURCE_MAINTENANCE_ENDPOINT_MISMATCH",
    );
    return control;
  } catch (error) {
    await control.close().catch(() => undefined);
    throw error;
  }
}

/** Caller owns the sealed, quiescent transaction. The password trigger's new
 * essential mail is retained but cannot become SMTP work in this rehearsal. */
export async function setIsolatedAcceptancePassword(
  db: OperatorSql,
  userId: string,
  password: string,
) {
  const existing = await db.query(
    'SELECT id FROM public."EmailDelivery" ORDER BY id LIMIT 10001',
  );
  operatorAssert(
    existing.rows.length <= 10000,
    "ACCEPTANCE_MAIL_INVENTORY_TOO_LARGE",
  );
  const existingIds = existing.rows.map((row) => {
    operatorAssert(
      typeof row.id === "string",
      "ACCEPTANCE_MAIL_IDENTITY_INVALID",
    );
    return row.id;
  });
  // Match queue_account_email's current verified-recipient predicate and its
  // owning safe-context renderer, rather than guessing localized JSON details.
  const recipients = await db.query(
    `
    SELECT e.email,public.notification_email_context('security_changed',
      jsonb_build_object('changedFields',ARRAY['password']::text[])) AS context
    FROM public."AccountEmail" e JOIN public."User" u ON u.id=e."userId"
    WHERE u.id=$1 AND u."mergedIntoId" IS NULL AND e."verifiedAt" IS NOT NULL
      AND (e.email=u.email OR u."emailSecondaryRecipients")
    ORDER BY e.email LIMIT 10001`,
    [userId],
  );
  operatorAssert(
    existingIds.length + recipients.rows.length <= 10000,
    "ACCEPTANCE_MAIL_INVENTORY_TOO_LARGE",
  );
  const expected = new Map<string, unknown>();
  for (const row of recipients.rows) {
    operatorAssert(
      typeof row.email === "string" && !expected.has(row.email),
      "ACCEPTANCE_MAIL_RECIPIENT_INVALID",
    );
    expected.set(row.email, row.context);
  }
  const changed = await db.query(
    'UPDATE public."User" SET "passwordHash"=$1,"mustChangePassword"=false WHERE id=$2 AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL AND "suspendedAt" IS NULL RETURNING id',
    [hashPassword(password), userId],
  );
  operatorAssert(
    changed.rows.length === 1 && changed.rows[0]?.id === userId,
    "ACCEPTANCE_PASSWORD_ACCOUNT_CHANGED",
  );
  const created = await db.query(
    'SELECT to_jsonb(d) AS row FROM public."EmailDelivery" d WHERE NOT(id=ANY($1::text[])) ORDER BY id LIMIT 10001',
    [existingIds],
  );
  operatorAssert(
    created.rows.length === expected.size,
    "ACCEPTANCE_PASSWORD_MAIL_NOT_ATTRIBUTABLE",
  );
  const notices = new Map<string, Record<string, unknown>>();
  const seenRecipients = new Set<string>();
  for (const entry of created.rows) {
    const row = entry.row as Record<string, unknown> | null;
    operatorAssert(
      row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof row.id === "string" &&
        !notices.has(row.id) &&
        row.userId === userId &&
        row.category === "security" &&
        row.event === "security_changed" &&
        typeof row.recipient === "string" &&
        expected.has(row.recipient) &&
        !seenRecipients.has(row.recipient) &&
        row.status === "PENDING" &&
        row.attempts === 0 &&
        row.attemptId === null &&
        row.attemptStartedAt === null &&
        row.leaseUntil === null &&
        row.completedAt === null &&
        row.previousPrimary === false &&
        row.preferenceTopic === null &&
        row.destination === null &&
        row.sourceNotificationId === null &&
        row.requestKind === null &&
        row.monthlyHoursReportId === null &&
        row.schoolHoursReportId === null &&
        planHash({ context: row.context }) ===
          planHash({ context: expected.get(row.recipient) }),
      "ACCEPTANCE_PASSWORD_MAIL_NOT_ATTRIBUTABLE",
    );
    notices.set(row.id, row);
    seenRecipients.add(row.recipient);
  }
  if (notices.size > 0) {
    const quarantined = await db.query(
      'UPDATE public."EmailDelivery" d SET status=\'CANCELLED_RECOVERY\' WHERE id=ANY($1::text[]) AND status=\'PENDING\' AND attempts=0 AND "attemptId" IS NULL AND "attemptStartedAt" IS NULL AND "leaseUntil" IS NULL RETURNING to_jsonb(d) AS row',
      [[...notices.keys()]],
    );
    operatorAssert(
      quarantined.rows.length === notices.size,
      "ACCEPTANCE_PASSWORD_MAIL_QUARANTINE_FAILED",
    );
    const verified = new Set<string>();
    for (const entry of quarantined.rows) {
      const row = entry.row as Record<string, unknown> | null;
      operatorAssert(
        row !== null &&
          typeof row === "object" &&
          typeof row.id === "string" &&
          notices.has(row.id) &&
          !verified.has(row.id) &&
          planHash(row) ===
            planHash({ ...notices.get(row.id), status: "CANCELLED_RECOVERY" }),
        "ACCEPTANCE_PASSWORD_MAIL_QUARANTINE_FAILED",
      );
      verified.add(row.id);
    }
  }
  return { noticesQuarantined: notices.size };
}

/** Database connection fences must be changed from the maintenance database. */
export async function withReadOnlyAcceptanceApplication<T>(
  maintenance: OperatorSql,
  application: { database: string; user: string },
  applicationUrl: string,
  dependencies: Pick<SiteDependencies, "connect">,
  inspect: (app: OperatorSql) => Promise<T>,
): Promise<T> {
  let app: OperatorSql | undefined;
  try {
    await maintenance.query(
      `GRANT CONNECT ON DATABASE ${quote(application.database)} TO ${quote(application.user)}`,
    );
    await maintenance.query(
      `ALTER DATABASE ${quote(application.database)} ALLOW_CONNECTIONS true`,
    );
    app = await dependencies.connect(applicationUrl);
    await maintenance.query(
      `ALTER DATABASE ${quote(application.database)} ALLOW_CONNECTIONS false`,
    );
    return await inspect(app);
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await maintenance.query(
          `ALTER DATABASE ${quote(application.database)} ALLOW_CONNECTIONS false`,
        );
      } finally {
        await maintenance.query(
          `REVOKE CONNECT ON DATABASE ${quote(application.database)} FROM ${quote(application.user)}`,
        );
      }
    }
  }
}
const SALT = "authjs.session-token";
export function acceptanceAccountAllowed(
  account: Record<string, unknown> | undefined,
) {
  if (
    !account ||
    account.suspendedAt ||
    account.mergedIntoId ||
    account.recoveryVoidedAt ||
    account.twoFactorEnabled
  )
    return false;
  if (
    account.role === "TUTOR" &&
    (account.tutorAccessRevoked === true ||
      account.tutorStatus !== "ACTIVE" ||
      account.departurePresent === true)
  )
    return false;
  if (
    account.role === "CREW" &&
    (account.crewStatus !== "ACTIVE" || account.departurePresent === true)
  )
    return false;
  if (
    account.role === "STUDENT" &&
    (account.tuteeMember !== true || account.departurePresent === true)
  )
    return false;
  if (account.role === "VIEWER" && account.observerRevoked === true)
    return false;
  return [
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "TUTOR",
    "CREW",
    "STUDENT",
    "VIEWER",
  ].includes(String(account.role));
}
async function acceptanceAccount(db: OperatorSql, userId: string) {
  return (
    await db.query(
      `SELECT u.id,u."passwordHash",u."sessionVersion",to_jsonb(u)->'historyAccessRevision' AS "historyAccessRevision",u.role,u."tutorId",u."mergedIntoId",u."recoveryVoidedAt",u."suspendedAt",u."twoFactorEnabled",u."tutorAccessRevoked",u."crewStatus",u."tuteeMember",t.status AS "tutorStatus",(d."userId" IS NOT NULL) AS "departurePresent",d."observerRevoked"
    FROM public."User" u LEFT JOIN public."Tutor" t ON t.id=u."tutorId" LEFT JOIN public."SchoolDeparture" d ON d."userId"=u.id WHERE u.id=$1`,
      [userId],
    )
  ).rows[0];
}
export function assertIsolatedRehearsalIdentity(
  endpoint: ReturnType<typeof databaseIdentity>,
) {
  operatorAssert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.host) &&
      /^shbs_[a-z0-9_]+_test$/.test(endpoint.database),
    "CUTOVER_REQUIRES_ISOLATED_TEST_DATABASE",
  );
}
async function snapshot(db: OperatorSql) {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await readReconciliationSnapshot(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
async function saveDatabaseMarker(
  db: OperatorSql,
  database: string,
  value: unknown,
) {
  await db.query(
    `COMMENT ON DATABASE ${quote(database)} IS '${JSON.stringify(value).replaceAll("'", "''")}'`,
  );
}
async function writeReceiptOnce(path: string, value: unknown) {
  try {
    await writeOperatorJson(path, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await readOperatorPlan(path, planHash(value));
  }
}
async function assertReadOnlyApplicationRole(db: OperatorSql, user: string) {
  const role = await db.query(
    `SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS membership FROM pg_roles r WHERE rolname=$1`,
    [user],
  );
  const row = role.rows[0];
  operatorAssert(
    row?.rolcanlogin === true &&
      [
        "rolsuper",
        "rolcreatedb",
        "rolcreaterole",
        "rolreplication",
        "rolbypassrls",
        "membership",
      ].every((field) => row[field] === false),
    "ACCEPTANCE_APPLICATION_ROLE_MUST_BE_READ_ONLY",
  );
  const access = await db.query(
    `SELECT COALESCE(bool_and(has_table_privilege($1,c.oid,'SELECT')),false) AS can_read,
    COALESCE(bool_or(has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) AS can_write
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`,
    [user],
  );
  const create = await db.query(
    "SELECT has_schema_privilege($1,'public','CREATE') OR has_database_privilege($1,current_database(),'CREATE') AS can_create",
    [user],
  );
  operatorAssert(
    access.rows[0]?.can_read === true &&
      access.rows[0]?.can_write === false &&
      create.rows[0]?.can_create === false,
    "ACCEPTANCE_APPLICATION_ROLE_MUST_BE_READ_ONLY",
  );
}

export const siteAcceptancePlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-acceptance"),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    reconciliationPlan: siteReconciliationPlanSchema,
    reconciliationReceipt: siteReconciliationReceiptSchema,
    application: identity,
    acceptanceUserId: z.string().min(1).max(200),
    checkpointSessionVersion: z.number().int().nonnegative().nullable(),
    currentSessionVersion: z.number().int().nonnegative(),
  })
  .strict();
export const siteAcceptanceReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-acceptance-receipt"),
    planId: z.uuid(),
    planHash: digest,
    reconciliationReceiptHash: digest,
    state: z.literal("ACCEPTED_ISOLATED_READ_ONLY_SEALED"),
    targetFingerprint: digest,
    sourceFingerprint: digest,
    signingKeyFingerprint: digest,
    retiredSigningKeyFingerprints: z.array(digest).min(1).max(3),
    application: identity,
    createdAt: z.iso.datetime(),
    checks: z.array(z.string()).max(30),
    nextAcceptance: nextCloneEvidenceSchema.nullable(),
  })
  .strict();

async function validateReconciliation(
  data: z.infer<typeof siteReconciliationPlanSchema>,
  receipt: z.infer<typeof siteReconciliationReceiptSchema>,
  sourceUrl: string,
  maintenanceUrl: string,
) {
  await validateStagedSite(
    data.stagePlan,
    data.stageReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  operatorAssert(
    receipt.planId === data.id &&
      receipt.planHash === planHash(data) &&
      receipt.targetName === data.stagePlan.targetName,
    "RECONCILIATION_RECEIPT_MISMATCH",
  );
  await readOperatorPlan(
    join(
      data.stageReceipt.evidenceDirectory,
      "reconciliations",
      data.id,
      "receipt.json",
    ),
    planHash(receipt),
  );
}
export async function createSiteAcceptancePlan(
  input: {
    reconciliationPlan: unknown;
    reconciliationReceipt: unknown;
    applicationUrl: string;
    acceptanceUserId: string;
  },
  sourceUrl: string,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
) {
  const plan = siteReconciliationPlanSchema.parse(input.reconciliationPlan),
    receipt = siteReconciliationReceiptSchema.parse(
      input.reconciliationReceipt,
    );
  await validateReconciliation(plan, receipt, sourceUrl, maintenanceUrl);
  const app = databaseIdentity(input.applicationUrl);
  for (const endpoint of [
    plan.stagePlan.source,
    plan.stagePlan.maintenance,
    app,
  ])
    assertIsolatedRehearsalIdentity(endpoint);
  operatorAssert(
    app.host === plan.stagePlan.maintenance.host &&
      app.port === plan.stagePlan.maintenance.port &&
      app.database === plan.stagePlan.targetName &&
      app.user !== plan.stagePlan.maintenance.user &&
      app.user !== plan.stagePlan.source.user,
    "WRONG_ACCEPTANCE_APPLICATION_DATABASE",
  );
  return await withSealedSiteTarget(
    plan.stagePlan,
    maintenanceUrl,
    dependencies,
    async (target) => {
      operatorAssert(
        planHash(await snapshot(target)) === receipt.targetFingerprint,
        "STALE_RECONCILED_TARGET",
      );
      await assertReadOnlyApplicationRole(target, app.user);
      operatorAssert(
        acceptanceAccountAllowed(
          await acceptanceAccount(target, input.acceptanceUserId),
        ),
        "ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED",
      );
      const generations = plan.credentialGenerations.find(
        (row) => row.userId === input.acceptanceUserId,
      );
      operatorAssert(
        generations && generations.current !== null,
        "ACCEPTANCE_ACCOUNT_GENERATION_MISSING",
      );
      return siteAcceptancePlanSchema.parse({
        version: 1,
        kind: "site-acceptance",
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        reconciliationPlan: plan,
        reconciliationReceipt: receipt,
        application: app,
        acceptanceUserId: input.acceptanceUserId,
        checkpointSessionVersion: generations.checkpoint,
        currentSessionVersion: generations.current,
      });
    },
  );
}

/** A real loopback HTTP app exercises shared scrypt, Auth.js encrypted JWT and
 * live generation checks; its database role cannot run any worker/deferred write. */
async function runAcceptanceApplication(
  db: OperatorSql,
  userId: string,
  password: string,
  secrets: RecoverySigningSecrets,
  rejectedPasswords: readonly string[] = [],
  proof?: {
    checkpointAuthSecret?: string;
    checkpointSessionVersion: number | null;
    currentSessionVersion: number;
  },
) {
  const dbAdapter = {
    user: {
      async findUnique(args: { where: { id: string } }) {
        return (
          (
            await db.query(
              'SELECT "sessionVersion","mergedIntoId","recoveryVoidedAt",to_jsonb(u)->\'historyAccessRevision\' AS "historyAccessRevision" FROM public."User" u WHERE id=$1',
              [args.where.id],
            )
          ).rows[0] ?? null
        );
      },
    },
  } as unknown as Pick<DomainDb, "user">;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.url === "/session") {
          const token =
            request.headers.authorization?.replace(/^Bearer /, "") ?? "";
          let decoded: JWT | null = null;
          try {
            decoded = await decode({
              token,
              secret: secrets.rotatedAuthSecret,
              salt: SALT,
            });
          } catch {
            /* An old key is rejected. */
          }
          const live =
            decoded?.sub === userId
              ? await acceptanceAccount(db, userId)
              : undefined;
          response.statusCode =
            decoded?.sub === userId &&
            acceptanceAccountAllowed(live) &&
            decoded.role === live?.role &&
            decoded.tutorId === live?.tutorId &&
            (await isSessionCurrent(dbAdapter, decoded))
              ? 200
              : 401;
          response.end();
          return;
        }
        if (request.url === "/signin" && request.method === "POST") {
          let body = "";
          for await (const chunk of request) {
            body += String(chunk);
            if (body.length > 4096)
              throw new Error("Oversized synthetic signin");
          }
          const candidate = JSON.parse(body) as { password?: string };
          const account = await acceptanceAccount(db, userId);
          if (
            !acceptanceAccountAllowed(account) ||
            typeof account?.passwordHash !== "string" ||
            typeof candidate.password !== "string" ||
            !verifyPassword(candidate.password, account.passwordHash)
          ) {
            response.statusCode = 401;
            response.end();
            return;
          }
          const token = await encode({
            secret: secrets.rotatedAuthSecret,
            salt: SALT,
            token: {
              sub: userId,
              sessionVersion: Number(account.sessionVersion),
              role: account.role as "ADMIN",
              tutorId: account.tutorId as string | null,
            },
          });
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ token }));
          return;
        }
        response.statusCode = 404;
        response.end();
      } catch {
        response.statusCode = 500;
        response.end();
      }
    })();
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  try {
    const address = server.address();
    operatorAssert(
      address && typeof address !== "string",
      "ACCEPTANCE_SERVER_FAILED",
    );
    const origin = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${origin}/signin`, {
      method: "POST",
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(10000),
    });
    operatorAssert(login.status === 200, "FRESH_ACCEPTANCE_LOGIN_FAILED");
    for (const oldPassword of rejectedPasswords)
      operatorAssert(
        (
          await fetch(`${origin}/signin`, {
            method: "POST",
            body: JSON.stringify({ password: oldPassword }),
            signal: AbortSignal.timeout(10000),
          })
        ).status === 401,
        "OLD_PASSWORD_ACCEPTED",
      );
    const { token } = (await login.json()) as { token: string };
    operatorAssert(
      (
        await fetch(`${origin}/session`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        })
      ).status === 200,
      "FRESH_ACCEPTANCE_SESSION_FAILED",
    );
    const oldKeys = [
      {
        secret: secrets.previousAuthSecret,
        version: proof?.currentSessionVersion ?? 0,
      },
    ];
    if (
      proof?.checkpointAuthSecret &&
      proof.checkpointSessionVersion !== null
    ) {
      operatorAssert(
        signingKeyFingerprint(proof.checkpointAuthSecret) !==
          signingKeyFingerprint(secrets.rotatedAuthSecret),
        "CHECKPOINT_SIGNING_KEY_WAS_NOT_ROTATED",
      );
      oldKeys.push({
        secret: proof.checkpointAuthSecret,
        version: proof.checkpointSessionVersion,
      });
    }
    for (const { secret, version } of oldKeys) {
      const old = await encode({
        secret,
        salt: SALT,
        token: {
          sub: userId,
          sessionVersion: version,
          role: "ADMIN",
          tutorId: null,
        },
      });
      operatorAssert(
        (
          await fetch(`${origin}/session`, {
            headers: { authorization: `Bearer ${old}` },
            signal: AbortSignal.timeout(10000),
          })
        ).status === 401,
        "OLD_SIGNING_KEY_ACCEPTED",
      );
    }
    const current = (
      await db.query('SELECT "sessionVersion" FROM public."User" WHERE id=$1', [
        userId,
      ])
    ).rows[0];
    const stale = await encode({
      secret: secrets.rotatedAuthSecret,
      salt: SALT,
      token: {
        sub: userId,
        sessionVersion: Number(current?.sessionVersion) - 1,
        role: "ADMIN",
        tutorId: null,
      },
    });
    operatorAssert(
      (
        await fetch(`${origin}/session`, {
          headers: { authorization: `Bearer ${stale}` },
          signal: AbortSignal.timeout(10000),
        })
      ).status === 401,
      "STALE_GENERATION_ACCEPTED",
    );
    let denied = false;
    try {
      await db.query('UPDATE public."User" SET name=name WHERE id=$1', [
        userId,
      ]);
    } catch {
      denied = true;
    }
    operatorAssert(denied, "ACCEPTANCE_APPLICATION_CAN_WRITE");
    return [
      "FRESH_PASSWORD_LOGIN",
      "FRESH_JWT_SESSION",
      "OLD_CURRENT_SIGNING_KEY_REJECTED",
      ...(proof?.checkpointAuthSecret && proof.checkpointSessionVersion !== null
        ? ["OLD_CHECKPOINT_SIGNING_KEY_REJECTED"]
        : []),
      "STALE_GENERATION_REJECTED",
      "WORKER_AND_DEFERRED_WRITES_DENIED",
    ];
  } finally {
    await new Promise<void>((accept, reject) =>
      server.close((error) => (error ? reject(error) : accept())),
    );
  }
}

export async function applySiteAcceptance(
  data: unknown,
  sourceUrl: string,
  maintenanceUrl: string,
  input: RecoverySigningSecrets & {
    applicationUrl: string;
    freshPassword: string;
    reason: string;
    rejectedPasswords?: string[];
    checkpointAuthSecret?: string;
    nextRuntimeDirectory?: string;
    capabilityProofs?: NextCapabilityProofs;
  },
  dependencies: SiteDependencies,
) {
  const plan = siteAcceptancePlanSchema.parse(data);
  const reconciliation = plan.reconciliationPlan;
  for (const endpoint of [
    reconciliation.stagePlan.source,
    reconciliation.stagePlan.maintenance,
    plan.application,
  ])
    assertIsolatedRehearsalIdentity(endpoint);
  assertRotatedSigningSecrets(input, reconciliation);
  if (input.checkpointAuthSecret)
    operatorAssert(
      signingKeyFingerprint(input.checkpointAuthSecret) !==
        reconciliation.rotatedSigningKeyFingerprint,
      "CHECKPOINT_SIGNING_KEY_WAS_NOT_ROTATED",
    );
  operatorAssert(
    planHash(databaseIdentity(input.applicationUrl)) ===
      planHash(plan.application),
    "WRONG_ACCEPTANCE_APPLICATION_DATABASE",
  );
  operatorAssert(
    input.freshPassword.length >= 12 &&
      input.freshPassword.length <= 1024 &&
      input.reason.trim().length > 0 &&
      input.reason.length <= 1000,
    "INVALID_ACCEPTANCE_INPUT",
  );
  await validateReconciliation(
    reconciliation,
    plan.reconciliationReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  const evidence = join(
    reconciliation.stageReceipt.evidenceDirectory,
    "acceptance",
    plan.id,
  );
  await mkdir(dirname(evidence), { recursive: true, mode: 0o700 });
  const source = await dependencies.connect(sourceUrl);
  try {
    let receipt = await withSealedSiteTarget(
      reconciliation.stagePlan,
      maintenanceUrl,
      dependencies,
      async (target, maintenance) => {
        operatorAssert(
          planHash(await snapshot(source)) ===
            plan.reconciliationReceipt.sourceFingerprint,
          "STALE_SOURCE_SECURITY_FINGERPRINT",
        );
        const marker = await databaseMarker(target);
        const accepted = siteAcceptanceReceiptSchema.safeParse(marker);
        if (accepted.success && accepted.data.planId === plan.id) {
          operatorAssert(
            accepted.data.planHash === planHash(plan),
            "ACCEPTANCE_RECEIPT_MISMATCH",
          );
          return accepted.data;
        }
        const pending = z
          .object({
            kind: z.literal("site-acceptance-pending"),
            planId: z.uuid(),
            planHash: digest,
            targetFingerprint: digest,
          })
          .strict()
          .safeParse(marker);
        const resumed = pending.success && pending.data.planId === plan.id;
        operatorAssert(
          planHash(await snapshot(target)) ===
            (resumed
              ? pending.data.targetFingerprint
              : plan.reconciliationReceipt.targetFingerprint),
          "STALE_RECONCILED_TARGET",
        );
        if (resumed)
          operatorAssert(
            pending.data.planHash === planHash(plan),
            "ACCEPTANCE_RECEIPT_MISMATCH",
          );
        else {
          await mkdir(evidence, { recursive: false, mode: 0o700 });
          await writeOperatorJson(join(evidence, "intent.json"), {
            planHash: planHash(plan),
            reason: input.reason,
          });
        }
        await assertReadOnlyApplicationRole(target, plan.application.user);
        operatorAssert(
          acceptanceAccountAllowed(
            await acceptanceAccount(target, plan.acceptanceUserId),
          ),
          "ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED",
        );
        if (!resumed) {
          await target.query("BEGIN");
          try {
            await setIsolatedAcceptancePassword(
              target,
              plan.acceptanceUserId,
              input.freshPassword,
            );
            await saveDatabaseMarker(target, plan.application.database, {
              kind: "site-acceptance-pending",
              planId: plan.id,
              planHash: planHash(plan),
              targetFingerprint: planHash(
                await readReconciliationSnapshot(target),
              ),
            });
            await target.query("COMMIT");
          } catch (error) {
            await target.query("ROLLBACK");
            throw error;
          }
        }
        return await withReadOnlyAcceptanceApplication(
          maintenance,
          plan.application,
          input.applicationUrl,
          dependencies,
          async (app) => {
            const checks = await runAcceptanceApplication(
              app,
              plan.acceptanceUserId,
              input.freshPassword,
              input,
              input.rejectedPasswords,
              {
                checkpointAuthSecret: input.checkpointAuthSecret,
                checkpointSessionVersion: plan.checkpointSessionVersion,
                currentSessionVersion: plan.currentSessionVersion,
              },
            );
            const after = await snapshot(target);
            const acceptedReceipt = siteAcceptanceReceiptSchema.parse({
              version: 1,
              kind: "site-acceptance-receipt",
              planId: plan.id,
              planHash: planHash(plan),
              reconciliationReceiptHash: planHash(plan.reconciliationReceipt),
              state: "ACCEPTED_ISOLATED_READ_ONLY_SEALED",
              targetFingerprint: planHash(after),
              sourceFingerprint: plan.reconciliationReceipt.sourceFingerprint,
              signingKeyFingerprint:
                reconciliation.rotatedSigningKeyFingerprint,
              retiredSigningKeyFingerprints: [
                ...new Set([
                  reconciliation.previousSigningKeyFingerprint,
                  ...(input.checkpointAuthSecret
                    ? [signingKeyFingerprint(input.checkpointAuthSecret)]
                    : []),
                ]),
              ],
              application: plan.application,
              createdAt: new Date().toISOString(),
              checks,
              nextAcceptance: null,
            });
            await saveDatabaseMarker(
              target,
              plan.application.database,
              acceptedReceipt,
            );
            return acceptedReceipt;
          },
        );
      },
    );
    if (!receipt.nextAcceptance) {
      const account = await withSealedSiteTarget(
        reconciliation.stagePlan,
        maintenanceUrl,
        dependencies,
        async (target) => {
          operatorAssert(
            planHash(await snapshot(target)) === receipt.targetFingerprint,
            "STALE_ACCEPTED_TARGET",
          );
          return (
            await target.query(
              'SELECT email,username FROM public."User" WHERE id=$1',
              [plan.acceptanceUserId],
            )
          ).rows[0];
        },
      );
      operatorAssert(
        typeof account?.email === "string",
        "NEXT_ACCEPTANCE_ACCOUNT_MISSING",
      );
      const nextAcceptance = await runIsolatedNextClone(
        {
          templateDatabase: plan.application.database,
          mode: "after-recovery",
          authSecret: input.rotatedAuthSecret,
          userId: plan.acceptanceUserId,
          identifier:
            typeof account.username === "string"
              ? account.username
              : account.email,
          password: input.freshPassword,
          previousAuthSecret: input.previousAuthSecret,
          checkpointAuthSecret: input.checkpointAuthSecret,
          previousSessionVersion: plan.currentSessionVersion,
          checkpointSessionVersion: plan.checkpointSessionVersion,
          rejectedPasswords: input.rejectedPasswords,
          proofs: input.capabilityProofs,
          runtimeDirectory: input.nextRuntimeDirectory,
        },
        maintenanceUrl,
        dependencies,
      );
      receipt = { ...receipt, nextAcceptance };
      // Only a completed genuine app proof is externally accepted. A crash
      // before this marker is resumable and cannot authorize cutover.
      await withSealedSiteTarget(
        reconciliation.stagePlan,
        maintenanceUrl,
        dependencies,
        async (target) => {
          operatorAssert(
            planHash(await snapshot(source)) === receipt.sourceFingerprint,
            "STALE_SOURCE_SECURITY_FINGERPRINT",
          );
          operatorAssert(
            planHash(await snapshot(target)) === receipt.targetFingerprint,
            "STALE_ACCEPTED_TARGET",
          );
          await saveDatabaseMarker(target, plan.application.database, receipt);
        },
      );
    }
    await writeReceiptOnce(join(evidence, "receipt.json"), receipt);
    return receipt;
  } finally {
    await source.close();
  }
}

const pointerSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("isolated-recovery-deployment"),
    operationId: z.uuid(),
    target: identity,
    signingKeyFingerprint: digest,
    runtime: z.literal("READ_ONLY_NO_OUTBOUND"),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const siteCutoverPlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-isolated-cutover"),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    acceptancePlan: siteAcceptancePlanSchema,
    acceptanceReceipt: siteAcceptanceReceiptSchema,
    pointerPath: z.string(),
    expectedPointerHash: digest,
    previousTarget: identity,
    sourceConnectionLimit: z.number().int().min(-1),
  })
  .strict();
async function readPointer(path: string) {
  try {
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      operatorAssert(
        stat.isFile() && stat.size <= 1024 * 1024,
        "INVALID_DEPLOYMENT_POINTER",
      );
      return pointerSchema.parse(JSON.parse(await file.readFile("utf8")));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new OperatorError("INVALID_DEPLOYMENT_POINTER");
  }
}
async function publishPointer(
  path: string,
  expectedHash: string,
  value: z.infer<typeof pointerSchema>,
) {
  const absolute = resolve(path),
    lock = `${absolute}.lock`;
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  await mkdir(lock, { recursive: false, mode: 0o700 });
  try {
    operatorAssert(
      planHash(await readPointer(absolute)) === expectedHash,
      "STALE_DEPLOYMENT_POINTER",
    );
    const temp = join(lock, "pointer.json");
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, absolute);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function createIsolatedCutoverPlan(
  input: {
    acceptancePlan: unknown;
    acceptanceReceipt: unknown;
    pointerPath: string;
  },
  sourceUrl: string,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
) {
  const acceptance = siteAcceptancePlanSchema.parse(input.acceptancePlan),
    receipt = siteAcceptanceReceiptSchema.parse(input.acceptanceReceipt);
  operatorAssert(
    receipt.nextAcceptance !== null &&
      receipt.nextAcceptance.checks.includes(
        "NEXT_ORDINARY_CREDENTIALS_LOGIN",
      ) &&
      receipt.nextAcceptance.checks.includes(
        "NEXT_NOTIFICATION_WORKER_NO_RESTORED_DELIVERY_REPLAY",
      ),
    "GENUINE_NEXT_ACCEPTANCE_REQUIRED",
  );
  const reconcile = acceptance.reconciliationPlan;
  await validateReconciliation(
    reconcile,
    acceptance.reconciliationReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  operatorAssert(
    receipt.planHash === planHash(acceptance) &&
      receipt.planId === acceptance.id,
    "ACCEPTANCE_RECEIPT_MISMATCH",
  );
  await readOperatorPlan(
    join(
      reconcile.stageReceipt.evidenceDirectory,
      "acceptance",
      acceptance.id,
      "receipt.json",
    ),
    planHash(receipt),
  );
  const pointerPath = resolve(input.pointerPath),
    pointer = await readPointer(pointerPath);
  operatorAssert(
    pointer === null ||
      planHash(pointer.target) === planHash(reconcile.stagePlan.source),
    "DEPLOYMENT_POINTER_SOURCE_MISMATCH",
  );
  operatorAssert(
    pointer === null ||
      pointer.signingKeyFingerprint === reconcile.previousSigningKeyFingerprint,
    "DEPLOYMENT_POINTER_SIGNING_KEY_MISMATCH",
  );
  await withSealedSiteTarget(
    reconcile.stagePlan,
    maintenanceUrl,
    dependencies,
    async (target) => {
      operatorAssert(
        planHash(await snapshot(target)) === receipt.targetFingerprint,
        "STALE_ACCEPTED_TARGET",
      );
    },
  );
  const source = await dependencies.connect(sourceUrl);
  let sourceConnectionLimit: number;
  try {
    const state = (
      await source.query(
        "SELECT datallowconn,datconnlimit,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    operatorAssert(
      state?.datallowconn === true &&
        state.owner === reconcile.stagePlan.source.user,
      "CUTOVER_SOURCE_OPERATOR_MUST_OWN_DATABASE",
    );
    sourceConnectionLimit = Number(state.datconnlimit);
  } finally {
    await source.close();
  }
  return siteCutoverPlanSchema.parse({
    version: 1,
    kind: "site-isolated-cutover",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    acceptancePlan: acceptance,
    acceptanceReceipt: receipt,
    pointerPath,
    expectedPointerHash: planHash(pointer),
    previousTarget: reconcile.stagePlan.source,
    sourceConnectionLimit,
  });
}
export async function applyIsolatedCutover(
  data: unknown,
  sourceUrl: string,
  maintenanceUrl: string,
  input: RecoverySigningSecrets & { applicationUrl: string; reason: string },
  dependencies: SiteDependencies,
) {
  const plan = siteCutoverPlanSchema.parse(data),
    acceptance = plan.acceptancePlan,
    reconcile = acceptance.reconciliationPlan;
  operatorAssert(
    plan.acceptanceReceipt.nextAcceptance?.checks.includes(
      "NEXT_NOTIFICATION_WORKER_NO_RESTORED_DELIVERY_REPLAY",
    ),
    "GENUINE_NEXT_ACCEPTANCE_REQUIRED",
  );
  operatorAssert(
    planHash(plan.previousTarget) === planHash(reconcile.stagePlan.source),
    "CUTOVER_PREVIOUS_TARGET_MISMATCH",
  );
  operatorAssert(
    plan.acceptanceReceipt.planId === acceptance.id &&
      plan.acceptanceReceipt.planHash === planHash(acceptance),
    "ACCEPTANCE_RECEIPT_MISMATCH",
  );
  assertRotatedSigningSecrets(input, reconcile);
  for (const endpoint of [
    reconcile.stagePlan.source,
    reconcile.stagePlan.maintenance,
    acceptance.application,
  ])
    assertIsolatedRehearsalIdentity(endpoint);
  operatorAssert(
    planHash(databaseIdentity(input.applicationUrl)) ===
      planHash(acceptance.application) &&
      input.reason.trim().length > 0 &&
      input.reason.length <= 1000,
    "INVALID_CUTOVER_INPUT",
  );
  await validateReconciliation(
    reconcile,
    acceptance.reconciliationReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  await readOperatorPlan(
    join(
      reconcile.stageReceipt.evidenceDirectory,
      "acceptance",
      acceptance.id,
      "receipt.json",
    ),
    planHash(plan.acceptanceReceipt),
  );
  const existing = await readPointer(plan.pointerPath);
  const evidence = join(
    reconcile.stageReceipt.evidenceDirectory,
    "cutovers",
    plan.id,
  );
  if (existing?.operationId === plan.id) {
    operatorAssert(
      planHash(existing.target) === planHash(acceptance.application) &&
        existing.signingKeyFingerprint ===
          reconcile.rotatedSigningKeyFingerprint,
      "CUTOVER_RECEIPT_MISMATCH",
    );
    const receipt = siteCutoverReceiptSchema.parse({
      version: 1,
      kind: "site-isolated-cutover-receipt",
      planId: plan.id,
      planHash: planHash(plan),
      state: "ISOLATED_READ_ONLY_CUTOVER",
      pointerHash: planHash(existing),
      pointer: existing,
      previousTarget: plan.previousTarget,
      acceptanceReceiptHash: planHash(plan.acceptanceReceipt),
      createdAt: existing.createdAt,
    });
    await writeReceiptOnce(join(evidence, "receipt.json"), receipt);
    return receipt;
  }
  const source = await dependencies.connect(sourceUrl);
  let maintenance: OperatorSql | undefined;
  let sourceControl: OperatorSql | undefined;
  let published = false,
    sourceFenced = false,
    sourceTransaction = false;
  try {
    maintenance = await dependencies.connect(maintenanceUrl);
    sourceControl = await connectSourceMaintenance(sourceUrl, dependencies);
    await mkdir(dirname(evidence), { recursive: true, mode: 0o700 });
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    await writeReceiptOnce(join(evidence, "intent.json"), {
      planHash: planHash(plan),
      reason: input.reason,
    });
    const ownPids = [
      Number(
        (await source.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      ),
      Number(
        (await sourceControl.query("SELECT pg_backend_pid() AS pid")).rows[0]
          ?.pid,
      ),
    ];
    const sourceState = (
      await sourceControl.query(
        "SELECT datallowconn,datconnlimit,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
        [reconcile.stagePlan.source.database],
      )
    ).rows[0];
    operatorAssert(
      sourceState?.datallowconn === true &&
        sourceState.owner === reconcile.stagePlan.source.user &&
        Number(sourceState.datconnlimit) === plan.sourceConnectionLimit,
      "STALE_CUTOVER_SOURCE_CONFIGURATION",
    );
    sourceFenced = true;
    await sourceControl.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} CONNECTION LIMIT 0`,
    );
    await sourceControl.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} ALLOW_CONNECTIONS false`,
    );
    operatorAssert(
      (
        await sourceControl.query(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1 AND NOT(pid=ANY($2::int[]))",
          [reconcile.stagePlan.source.database, ownPids],
        )
      ).rows[0]?.count === "0",
      "CUTOVER_REQUIRES_QUIESCENT_SOURCE",
    );
    await source.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    sourceTransaction = true;
    await source.query("SET LOCAL lock_timeout='5s'");
    const tables = await source.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LIMIT 501",
    );
    operatorAssert(
      tables.rows.length > 0 && tables.rows.length <= 500,
      "TOO_MANY_TABLES",
    );
    await source.query(
      `LOCK TABLE ${tables.rows.map((row) => `public.${quote(String(row.tablename))}`).join(",")} IN SHARE MODE`,
    );
    await withSealedSiteTarget(
      reconcile.stagePlan,
      maintenanceUrl,
      dependencies,
      async (target) => {
        operatorAssert(
          planHash(await readReconciliationSnapshot(source)) ===
            plan.acceptanceReceipt.sourceFingerprint,
          "STALE_SOURCE_SECURITY_FINGERPRINT",
        );
        operatorAssert(
          planHash(await snapshot(target)) ===
            plan.acceptanceReceipt.targetFingerprint,
          "STALE_ACCEPTED_TARGET",
        );
        await assertReadOnlyApplicationRole(
          target,
          acceptance.application.user,
        );
      },
    );
    const pointer = pointerSchema.parse({
      version: 1,
      kind: "isolated-recovery-deployment",
      operationId: plan.id,
      target: acceptance.application,
      signingKeyFingerprint: reconcile.rotatedSigningKeyFingerprint,
      runtime: "READ_ONLY_NO_OUTBOUND",
      createdAt: new Date().toISOString(),
    });
    await maintenance.query(
      `GRANT CONNECT ON DATABASE ${quote(acceptance.application.database)} TO ${quote(acceptance.application.user)}`,
    );
    await maintenance.query(
      `ALTER DATABASE ${quote(acceptance.application.database)} ALLOW_CONNECTIONS true`,
    );
    const app = await dependencies.connect(input.applicationUrl);
    try {
      const identity = await app.query(
        "SELECT current_database() AS database,current_user AS username",
      );
      operatorAssert(
        identity.rows[0]?.database === acceptance.application.database &&
          identity.rows[0]?.username === acceptance.application.user,
        "CUTOVER_APPLICATION_ENDPOINT_MISMATCH",
      );
    } finally {
      await app.close();
    }
    await publishPointer(plan.pointerPath, plan.expectedPointerHash, pointer);
    published = true;
    await source.query("COMMIT");
    sourceTransaction = false;
    const receipt = {
      version: 1,
      kind: "site-isolated-cutover-receipt",
      planId: plan.id,
      planHash: planHash(plan),
      state: "ISOLATED_READ_ONLY_CUTOVER",
      pointerHash: planHash(pointer),
      pointer,
      previousTarget: plan.previousTarget,
      acceptanceReceiptHash: planHash(plan.acceptanceReceipt),
      createdAt: pointer.createdAt,
    };
    await writeReceiptOnce(join(evidence, "receipt.json"), receipt);
    return receipt;
  } finally {
    try {
      if (sourceTransaction)
        await source.query("ROLLBACK").catch(() => undefined);
      if (!published && maintenance)
        await maintenance.query(
          `ALTER DATABASE ${quote(acceptance.application.database)} ALLOW_CONNECTIONS false`,
        );
      if (!published && sourceFenced && sourceControl) {
        await sourceControl.query(
          `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} CONNECTION LIMIT ${plan.sourceConnectionLimit}`,
        );
        await sourceControl.query(
          `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} ALLOW_CONNECTIONS true`,
        );
      }
    } catch {
      throw new OperatorError(
        "STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION",
      );
    } finally {
      await maintenance?.close().catch(() => undefined);
      await sourceControl?.close().catch(() => undefined);
      await source.close();
    }
  }
}

export const siteCutoverReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-isolated-cutover-receipt"),
    planId: z.uuid(),
    planHash: digest,
    state: z.literal("ISOLATED_READ_ONLY_CUTOVER"),
    pointerHash: digest,
    pointer: pointerSchema,
    previousTarget: identity,
    acceptanceReceiptHash: digest,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const siteRollbackPlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-isolated-rollback"),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    cutoverPlan: siteCutoverPlanSchema,
    cutoverReceipt: siteCutoverReceiptSchema,
    rollbackMaintenance: identity,
    rollbackApplication: identity,
    rollbackConnectionLimit: z.number().int().min(-1),
    rollbackFencedConnectionLimit: z.number().int().min(-1),
    targetConnectionLimit: z.number().int().min(-1),
    currentSecurityFingerprint: digest,
    rollbackFingerprint: digest,
    previousSigningKeyFingerprint: digest,
    rotatedSigningKeyFingerprint: digest,
  })
  .strict();
export const siteRollbackReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-isolated-rollback-receipt"),
    planId: z.uuid(),
    planHash: digest,
    state: z.literal("ROLLED_BACK_WITH_NEWEST_SECURITY_READ_ONLY"),
    pointer: pointerSchema,
    pointerHash: digest,
    sourceEvidenceSha256: digest,
    currentSecurityFingerprint: digest,
    targetFingerprint: digest,
    previousSigningKeyFingerprint: digest,
    rotatedSigningKeyFingerprint: digest,
    checks: z.array(z.string()).max(30),
    createdAt: z.iso.datetime(),
    nextAcceptance: nextCloneEvidenceSchema,
  })
  .strict();
const rollbackPendingSchema = z
  .object({
    kind: z.literal("site-rollback-pending"),
    planId: z.uuid(),
    planHash: digest,
    targetFingerprint: digest,
    sourceEvidenceSha256: digest,
  })
  .strict();
async function validateCutover(
  plan: z.infer<typeof siteCutoverPlanSchema>,
  receipt: z.infer<typeof siteCutoverReceiptSchema>,
  sourceUrl: string,
  maintenanceUrl: string,
) {
  const reconcile = plan.acceptancePlan.reconciliationPlan;
  await validateReconciliation(
    reconcile,
    plan.acceptancePlan.reconciliationReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  operatorAssert(
    receipt.planHash === planHash(plan) &&
      receipt.planId === plan.id &&
      receipt.pointerHash === planHash(receipt.pointer),
    "CUTOVER_RECEIPT_MISMATCH",
  );
  await readOperatorPlan(
    join(
      reconcile.stageReceipt.evidenceDirectory,
      "cutovers",
      plan.id,
      "receipt.json",
    ),
    planHash(receipt),
  );
  operatorAssert(
    planHash(await readPointer(plan.pointerPath)) === receipt.pointerHash,
    "STALE_DEPLOYMENT_POINTER",
  );
}
export async function createIsolatedRollbackPlan(
  input: {
    cutoverPlan: unknown;
    cutoverReceipt: unknown;
    currentApplicationUrl: string;
    rollbackMaintenanceUrl: string;
    rollbackApplicationUrl: string;
  } & RecoverySigningSecrets,
  sourceUrl: string,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
) {
  const cutover = siteCutoverPlanSchema.parse(input.cutoverPlan),
    receipt = siteCutoverReceiptSchema.parse(input.cutoverReceipt);
  await validateCutover(cutover, receipt, sourceUrl, maintenanceUrl);
  const source = cutover.acceptancePlan.reconciliationPlan.stagePlan.source;
  const maintenance = databaseIdentity(input.rollbackMaintenanceUrl),
    application = databaseIdentity(input.rollbackApplicationUrl),
    current = databaseIdentity(input.currentApplicationUrl);
  for (const endpoint of [source, maintenance, application, current])
    assertIsolatedRehearsalIdentity(endpoint);
  operatorAssert(
    planHash(current) === planHash(receipt.pointer.target) &&
      maintenance.host === source.host &&
      maintenance.port === source.port &&
      application.host === source.host &&
      application.port === source.port &&
      application.database === source.database &&
      application.user !== source.user &&
      application.user !== maintenance.user,
    "WRONG_ROLLBACK_ENDPOINT",
  );
  // Retiring this exact task-owned role cannot affect an unrelated deployment.
  operatorAssert(
    /^shbs_recovery_owner_[a-f0-9]{12}$/.test(source.user),
    "ROLLBACK_REQUIRES_TASK_OWNED_SOURCE_ROLE",
  );
  const keys = assertRotatedSigningSecrets(input);
  operatorAssert(
    keys.previousSigningKeyFingerprint ===
      receipt.pointer.signingKeyFingerprint,
    "ROLLBACK_CURRENT_SIGNING_KEY_MISMATCH",
  );
  operatorAssert(
    !cutover.acceptanceReceipt.retiredSigningKeyFingerprints.includes(
      keys.rotatedSigningKeyFingerprint,
    ),
    "ROLLBACK_CANNOT_REUSE_RETIRED_SIGNING_KEY",
  );
  const currentDb = await dependencies.connect(input.currentApplicationUrl);
  let original: OperatorSql | undefined;
  try {
    const originalUrl = new URL(input.rollbackMaintenanceUrl);
    originalUrl.pathname = `/${source.database}`;
    const control = await dependencies.connect(input.rollbackMaintenanceUrl);
    try {
      operatorAssert(
        (
          await control.query(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0]?.rolsuper === true,
        "ISOLATED_ROLLBACK_REQUIRES_OPERATOR_SUPERUSER",
      );
      await control.query(
        `ALTER DATABASE ${quote(source.database)} ALLOW_CONNECTIONS true`,
      );
      original = await dependencies.connect(originalUrl.toString());
    } finally {
      await control.query(
        `ALTER DATABASE ${quote(source.database)} ALLOW_CONNECTIONS false`,
      );
      await control.close();
    }
    const newest = await snapshot(currentDb),
      old = await snapshot(original);
    validateSecurityIdentityClosure(newest, old);
    await assertReadOnlyApplicationRole(original, application.user);
    const originalLimit = (
      await original.query(
        "SELECT datconnlimit FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0]?.datconnlimit;
    const targetLimit = (
      await currentDb.query(
        "SELECT datconnlimit FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0]?.datconnlimit;
    return siteRollbackPlanSchema.parse({
      version: 1,
      kind: "site-isolated-rollback",
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      cutoverPlan: cutover,
      cutoverReceipt: receipt,
      rollbackMaintenance: maintenance,
      rollbackApplication: application,
      rollbackConnectionLimit: cutover.sourceConnectionLimit,
      rollbackFencedConnectionLimit: Number(originalLimit),
      targetConnectionLimit: Number(targetLimit),
      currentSecurityFingerprint: planHash(newest),
      rollbackFingerprint: planHash(old),
      ...keys,
    });
  } finally {
    await currentDb.close();
    await original?.close();
  }
}

export async function applyIsolatedRollback(
  data: unknown,
  sourceUrl: string,
  maintenanceUrl: string,
  input: RecoverySigningSecrets & {
    rollbackMaintenanceUrl: string;
    rollbackApplicationUrl: string;
    freshPassword: string;
    reason: string;
    nextRuntimeDirectory?: string;
  },
  dependencies: SiteDependencies,
) {
  const plan = siteRollbackPlanSchema.parse(data),
    cutover = plan.cutoverPlan,
    reconcile = cutover.acceptancePlan.reconciliationPlan;
  for (const endpoint of [
    reconcile.stagePlan.source,
    reconcile.stagePlan.maintenance,
    plan.rollbackMaintenance,
    plan.rollbackApplication,
  ])
    assertIsolatedRehearsalIdentity(endpoint);
  operatorAssert(
    /^shbs_recovery_owner_[a-f0-9]{12}$/.test(reconcile.stagePlan.source.user),
    "ROLLBACK_REQUIRES_TASK_OWNED_SOURCE_ROLE",
  );
  operatorAssert(
    plan.rollbackMaintenance.host === reconcile.stagePlan.source.host &&
      plan.rollbackMaintenance.port === reconcile.stagePlan.source.port &&
      plan.rollbackApplication.host === reconcile.stagePlan.source.host &&
      plan.rollbackApplication.port === reconcile.stagePlan.source.port &&
      plan.rollbackApplication.database ===
        reconcile.stagePlan.source.database &&
      plan.rollbackApplication.user !== reconcile.stagePlan.source.user &&
      plan.rollbackApplication.user !== plan.rollbackMaintenance.user,
    "WRONG_ROLLBACK_ENDPOINT",
  );
  assertRotatedSigningSecrets(input, plan);
  operatorAssert(
    !cutover.acceptanceReceipt.retiredSigningKeyFingerprints.includes(
      plan.rotatedSigningKeyFingerprint,
    ),
    "ROLLBACK_CANNOT_REUSE_RETIRED_SIGNING_KEY",
  );
  await validateReconciliation(
    reconcile,
    cutover.acceptancePlan.reconciliationReceipt,
    sourceUrl,
    maintenanceUrl,
  );
  await readOperatorPlan(
    join(
      reconcile.stageReceipt.evidenceDirectory,
      "cutovers",
      cutover.id,
      "receipt.json",
    ),
    planHash(plan.cutoverReceipt),
  );
  operatorAssert(
    planHash(databaseIdentity(input.rollbackMaintenanceUrl)) ===
      planHash(plan.rollbackMaintenance) &&
      planHash(databaseIdentity(input.rollbackApplicationUrl)) ===
        planHash(plan.rollbackApplication),
    "WRONG_ROLLBACK_ENDPOINT",
  );
  operatorAssert(
    input.reason.trim().length > 0 &&
      input.reason.length <= 1000 &&
      input.freshPassword.length >= 12 &&
      input.freshPassword.length <= 1024,
    "INVALID_ROLLBACK_INPUT",
  );
  const stageAdmin = await dependencies.connect(maintenanceUrl);
  let originalAdmin: OperatorSql | undefined;
  const latestUrl = new URL(maintenanceUrl);
  latestUrl.pathname = `/${reconcile.stagePlan.targetName}`;
  const rollbackUrl = new URL(input.rollbackMaintenanceUrl);
  rollbackUrl.pathname = `/${reconcile.stagePlan.source.database}`;
  let latest: OperatorSql | undefined, rollback: OperatorSql | undefined;
  let succeeded = false,
    fenced = false,
    stageLocked = false,
    originalLocked = false;
  const evidence = join(
    reconcile.stageReceipt.evidenceDirectory,
    "rollbacks",
    plan.id,
  );
  try {
    originalAdmin = await dependencies.connect(input.rollbackMaintenanceUrl);
    const marker = await databaseMarker(
      originalAdmin,
      reconcile.stagePlan.source.database,
    );
    const prepared = siteRollbackReceiptSchema.safeParse(marker),
      pending = rollbackPendingSchema.safeParse(marker);
    const resumed =
      (prepared.success && prepared.data.planId === plan.id) ||
      (pending.success && pending.data.planId === plan.id);
    const resumeMarker =
      prepared.success && prepared.data.planId === plan.id
        ? prepared.data
        : pending.success && pending.data.planId === plan.id
          ? pending.data
          : null;
    if (resumeMarker)
      operatorAssert(
        resumeMarker.planHash === planHash(plan),
        "ROLLBACK_RECEIPT_MISMATCH",
      );
    const existing = await readPointer(cutover.pointerPath);
    if (existing?.operationId === plan.id) {
      operatorAssert(
        prepared.success &&
          prepared.data.planHash === planHash(plan) &&
          prepared.data.pointerHash === planHash(existing),
        "ROLLBACK_RECEIPT_MISMATCH",
      );
      await writeReceiptOnce(join(evidence, "receipt.json"), prepared.data);
      succeeded = true;
      return prepared.data;
    }
    operatorAssert(
      planHash(existing) === plan.cutoverReceipt.pointerHash,
      "STALE_DEPLOYMENT_POINTER",
    );
    const stageLock = await stageAdmin.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`shbs-recovery:${reconcile.stagePlan.targetName}`],
    );
    operatorAssert(stageLock.rows[0]?.locked === true, "RECOVERY_TARGET_BUSY");
    stageLocked = true;
    const originalLock = await originalAdmin.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`shbs-recovery:${reconcile.stagePlan.source.database}`],
    );
    operatorAssert(
      originalLock.rows[0]?.locked === true,
      "RECOVERY_TARGET_BUSY",
    );
    originalLocked = true;
    await mkdir(dirname(evidence), { recursive: true, mode: 0o700 });
    if (!resumed) {
      await mkdir(evidence, { recursive: false, mode: 0o700 });
      await writeOperatorJson(join(evidence, "intent.json"), {
        planHash: planHash(plan),
        reason: input.reason,
      });
    }
    for (const [admin, name] of [
      [stageAdmin, reconcile.stagePlan.targetName],
      [originalAdmin, reconcile.stagePlan.source.database],
    ] as const) {
      const active = await admin.query(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1",
        [name],
      );
      operatorAssert(
        active.rows[0]?.count === "0",
        "ROLLBACK_REQUIRES_QUIESCENT_DATABASES",
      );
    }
    const role = await originalAdmin.query(
      "SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,(SELECT count(*)::text FROM pg_database WHERE datdba=r.oid) AS owned_databases FROM pg_roles r WHERE rolname=$1",
      [reconcile.stagePlan.source.user],
    );
    operatorAssert(
      role.rows[0]?.owned_databases === "1" &&
        [
          "rolsuper",
          "rolcreatedb",
          "rolcreaterole",
          "rolreplication",
          "rolbypassrls",
        ].every((key) => role.rows[0]?.[key] === false),
      "ROLLBACK_SOURCE_ROLE_NOT_EXCLUSIVELY_OWNED",
    );
    // Acquire operator connections before fencing; no application connection
    // survives the quiescence check. Both sites remain fenced on any failure.
    // A resumed operation may already have fenced either side. Only the
    // superuser/operator session is acquired during this brief opening.
    fenced = true;
    for (const admin of [stageAdmin, originalAdmin])
      operatorAssert(
        (
          await admin.query(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0]?.rolsuper === true,
        "ISOLATED_ROLLBACK_REQUIRES_OPERATOR_SUPERUSER",
      );
    if (!resumed) {
      operatorAssert(
        Number(
          (
            await stageAdmin.query(
              "SELECT datconnlimit FROM pg_database WHERE datname=$1",
              [reconcile.stagePlan.targetName],
            )
          ).rows[0]?.datconnlimit,
        ) === plan.targetConnectionLimit,
        "STALE_ROLLBACK_CONNECTION_LIMIT",
      );
      operatorAssert(
        Number(
          (
            await originalAdmin.query(
              "SELECT datconnlimit FROM pg_database WHERE datname=$1",
              [reconcile.stagePlan.source.database],
            )
          ).rows[0]?.datconnlimit,
        ) === plan.rollbackFencedConnectionLimit,
        "STALE_ROLLBACK_CONNECTION_LIMIT",
      );
    }
    // Connection limit0 excludes every normal application role while allowing
    // only the dedicated superuser's snapshot-bound pg_dump connection.
    await stageAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.targetName)} CONNECTION LIMIT 0`,
    );
    await originalAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} CONNECTION LIMIT 0`,
    );
    await stageAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.targetName)} ALLOW_CONNECTIONS true`,
    );
    latest = await dependencies.connect(latestUrl.toString());
    await originalAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} ALLOW_CONNECTIONS true`,
    );
    rollback = await dependencies.connect(rollbackUrl.toString());
    await latest.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const newest = await readReconciliationSnapshot(latest);
    operatorAssert(
      planHash(newest) === plan.currentSecurityFingerprint,
      "STALE_ROLLBACK_SECURITY_FINGERPRINT",
    );
    const exported = await latest.query(
      "SELECT pg_export_snapshot() AS snapshot",
    );
    const snapshotId = String(exported.rows[0]?.snapshot);
    operatorAssert(
      /^[a-fA-F0-9-]+$/.test(snapshotId),
      "INVALID_EXPORTED_SOURCE_SNAPSHOT",
    );
    const saved = join(evidence, "newest-security-source.dump");
    if (!resumed)
      await dependencies.execute({
        tool: "pg_dump",
        args: ["--format=custom", "--no-password", `--snapshot=${snapshotId}`],
        env: credentials(maintenanceUrl, reconcile.stagePlan.targetName),
        outputPath: saved,
      });
    const newestEvidence = await inspectCurrentEvidence(saved);
    // pg_dump needs a new connection: the snapshot-bound dump must finish before
    // ALLOW_CONNECTIONS=false, which rejects even a superuser's new connection.
    await stageAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.targetName)} ALLOW_CONNECTIONS false`,
    );
    await originalAdmin.query(
      `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} ALLOW_CONNECTIONS false`,
    );
    await latest.query("COMMIT");
    await latest.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    operatorAssert(
      planHash(await readReconciliationSnapshot(latest)) ===
        plan.currentSecurityFingerprint,
      "STALE_ROLLBACK_SECURITY_FINGERPRINT",
    );
    if (resumeMarker)
      operatorAssert(
        newestEvidence.sha256 === resumeMarker.sourceEvidenceSha256 &&
          planHash(await snapshot(rollback)) === resumeMarker.targetFingerprint,
        "STALE_ROLLBACK_TARGET",
      );
    if (!resumed) await rollback.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      if (!resumed) {
        const old = await readReconciliationSnapshot(rollback);
        operatorAssert(
          planHash(old) === plan.rollbackFingerprint,
          "STALE_ROLLBACK_TARGET",
        );
        validateSecurityIdentityClosure(newest, old);
        await reconcileSecuritySnapshot(rollback, newest, old);
        await assertReadOnlyApplicationRole(
          rollback,
          plan.rollbackApplication.user,
        );
        const userId = cutover.acceptancePlan.acceptanceUserId;
        operatorAssert(
          acceptanceAccountAllowed(await acceptanceAccount(rollback, userId)),
          "ROLLBACK_ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED",
        );
        await setIsolatedAcceptancePassword(
          rollback,
          userId,
          input.freshPassword,
        );
        await rollback.query(
          `ALTER ROLE ${quote(reconcile.stagePlan.source.user)} NOLOGIN`,
        );
        await rollback.query(
          `REVOKE CONNECT ON DATABASE ${quote(plan.rollbackApplication.database)} FROM PUBLIC`,
        );
        await rollback.query(
          `GRANT CONNECT ON DATABASE ${quote(plan.rollbackApplication.database)} TO ${quote(plan.rollbackApplication.user)}`,
        );
        await saveDatabaseMarker(rollback, plan.rollbackApplication.database, {
          kind: "site-rollback-pending",
          planId: plan.id,
          planHash: planHash(plan),
          targetFingerprint: planHash(
            await readReconciliationSnapshot(rollback),
          ),
          sourceEvidenceSha256: newestEvidence.sha256,
        });
        await rollback.query("COMMIT");
      }
      await latest.query("COMMIT");
    } catch (error) {
      if (!resumed) await rollback.query("ROLLBACK");
      await latest.query("ROLLBACK");
      throw error;
    }
    const final = await snapshot(rollback);
    const userId = cutover.acceptancePlan.acceptanceUserId;
    const account = (
      await rollback.query(
        'SELECT email,username FROM public."User" WHERE id=$1',
        [userId],
      )
    ).rows[0];
    operatorAssert(
      typeof account?.email === "string",
      "NEXT_ACCEPTANCE_ACCOUNT_MISSING",
    );
    // Clone the still-sealed return database only after releasing our own target
    // connection and advisory lock. Both real deployment endpoints stay fenced.
    await rollback.close();
    rollback = undefined;
    await originalAdmin.query("SELECT pg_advisory_unlock(hashtext($1))", [
      `shbs-recovery:${reconcile.stagePlan.source.database}`,
    ]);
    originalLocked = false;
    const nextAcceptance = await runIsolatedNextClone(
      {
        templateDatabase: plan.rollbackApplication.database,
        mode: "after-recovery",
        authSecret: input.rotatedAuthSecret,
        userId,
        identifier:
          typeof account.username === "string"
            ? account.username
            : account.email,
        password: input.freshPassword,
        previousAuthSecret: input.previousAuthSecret,
        runtimeDirectory: input.nextRuntimeDirectory,
      },
      input.rollbackMaintenanceUrl,
      dependencies,
    );
    const returnLock = await originalAdmin.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`shbs-recovery:${reconcile.stagePlan.source.database}`],
    );
    operatorAssert(returnLock.rows[0]?.locked === true, "RECOVERY_TARGET_BUSY");
    originalLocked = true;
    const returnState = (
      await originalAdmin.query(
        "SELECT datallowconn,(SELECT count(*)::text FROM pg_stat_activity WHERE datname=$1) AS sessions FROM pg_database WHERE datname=$1",
        [plan.rollbackApplication.database],
      )
    ).rows[0];
    operatorAssert(
      returnState?.datallowconn === false && returnState.sessions === "0",
      "ROLLBACK_TARGET_WAS_REOPENED",
    );
    await originalAdmin.query(
      `ALTER DATABASE ${quote(plan.rollbackApplication.database)} ALLOW_CONNECTIONS true`,
    );
    try {
      rollback = await dependencies.connect(rollbackUrl.toString());
    } finally {
      await originalAdmin.query(
        `ALTER DATABASE ${quote(plan.rollbackApplication.database)} ALLOW_CONNECTIONS false`,
      );
    }
    operatorAssert(
      planHash(await snapshot(rollback)) === planHash(final),
      "STALE_ROLLBACK_TARGET",
    );
    await originalAdmin.query(
      `ALTER DATABASE ${quote(plan.rollbackApplication.database)} CONNECTION LIMIT ${plan.rollbackConnectionLimit}`,
    );
    await originalAdmin.query(
      `ALTER DATABASE ${quote(plan.rollbackApplication.database)} ALLOW_CONNECTIONS true`,
    );
    const app = await dependencies.connect(input.rollbackApplicationUrl);
    let checks: string[];
    try {
      checks = await runAcceptanceApplication(
        app,
        cutover.acceptancePlan.acceptanceUserId,
        input.freshPassword,
        input,
      );
    } finally {
      await app.close();
    }
    const pointer =
      prepared.success && prepared.data.planId === plan.id
        ? prepared.data.pointer
        : pointerSchema.parse({
            version: 1,
            kind: "isolated-recovery-deployment",
            operationId: plan.id,
            target: plan.rollbackApplication,
            signingKeyFingerprint: plan.rotatedSigningKeyFingerprint,
            runtime: "READ_ONLY_NO_OUTBOUND",
            createdAt: new Date().toISOString(),
          });
    const receipt = siteRollbackReceiptSchema.parse({
      version: 1,
      kind: "site-isolated-rollback-receipt",
      planId: plan.id,
      planHash: planHash(plan),
      state: "ROLLED_BACK_WITH_NEWEST_SECURITY_READ_ONLY",
      pointer,
      pointerHash: planHash(pointer),
      sourceEvidenceSha256: newestEvidence.sha256,
      currentSecurityFingerprint: plan.currentSecurityFingerprint,
      targetFingerprint: planHash(final),
      previousSigningKeyFingerprint: plan.previousSigningKeyFingerprint,
      rotatedSigningKeyFingerprint: plan.rotatedSigningKeyFingerprint,
      checks,
      nextAcceptance,
      createdAt: pointer.createdAt,
    });
    await saveDatabaseMarker(
      rollback,
      plan.rollbackApplication.database,
      receipt,
    );
    await publishPointer(
      cutover.pointerPath,
      plan.cutoverReceipt.pointerHash,
      pointer,
    );
    succeeded = true;
    await writeReceiptOnce(join(evidence, "receipt.json"), receipt);
    return receipt;
  } finally {
    await latest?.close().catch(() => undefined);
    await rollback?.close().catch(() => undefined);
    let fenceFailed = false;
    try {
      if (!succeeded && fenced) {
        await stageAdmin
          .query(
            `ALTER DATABASE ${quote(reconcile.stagePlan.targetName)} ALLOW_CONNECTIONS false`,
          )
          .catch(() => {
            fenceFailed = true;
          });
        await originalAdmin
          ?.query(
            `ALTER DATABASE ${quote(reconcile.stagePlan.source.database)} ALLOW_CONNECTIONS false`,
          )
          .catch(() => {
            fenceFailed = true;
          });
      }
    } finally {
      if (stageLocked)
        await stageAdmin
          .query("SELECT pg_advisory_unlock(hashtext($1))", [
            `shbs-recovery:${reconcile.stagePlan.targetName}`,
          ])
          .catch(() => undefined);
      if (originalLocked)
        await originalAdmin
          ?.query("SELECT pg_advisory_unlock(hashtext($1))", [
            `shbs-recovery:${reconcile.stagePlan.source.database}`,
          ])
          .catch(() => undefined);
      await stageAdmin.close().catch(() => undefined);
      await originalAdmin?.close().catch(() => undefined);
    }
    if (fenceFailed)
      throw new OperatorError(
        "STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION",
      );
  }
}
