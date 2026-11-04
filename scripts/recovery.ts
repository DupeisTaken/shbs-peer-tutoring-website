/** Host-only recovery entry point. Never import the Next server, shared db or workers. */
import "dotenv/config";
import { z } from "zod";
import {
  configureUtcPgTimestamps,
  utcDatabaseUrl,
} from "../src/server/database-url";
import {
  parseRecoveryCommand,
  OperatorError,
  operatorAssert,
  RECOVERY_HELP,
  type RecoveryCommand,
} from "../src/server/recovery/operator-cli";
import {
  databaseIdentity,
  postgresClientUrl,
  planHash,
  readOperatorPlan,
  writeOperatorJson,
} from "../src/server/recovery/operator-plan";
import {
  createSitePlan,
  stageSitePlan,
  executeRecoveryTool,
  type SiteDependencies,
} from "../src/server/recovery/operator-site";
import {
  createSiteReconciliationPlan,
  applySiteReconciliation,
} from "../src/server/recovery/operator-reconcile";
import {
  createSiteAcceptancePlan,
  applySiteAcceptance,
  createIsolatedCutoverPlan,
  applyIsolatedCutover,
  createIsolatedRollbackPlan,
  applyIsolatedRollback,
} from "../src/server/recovery/operator-cutover";
import type { TransactionDb } from "../src/server/transactions";

const admissionFileSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("admission-recovery"),
    createdAt: z.iso.datetime(),
    source: z
      .object({
        host: z.string(),
        port: z.string(),
        database: z.string(),
        user: z.string(),
      })
      .strict(),
    actorId: z.string().min(1).max(100),
    actionId: z.string().min(1).max(100),
    fingerprint: z.string().min(1),
    preview: z.unknown(),
  })
  .strict();
const checkpointFileSchema = admissionFileSchema
  .omit({ actionId: true, kind: true })
  .extend({
    kind: z.literal("scoped-checkpoint-recovery"),
    checkpointId: z.string().min(1).max(200),
  })
  .strict();

function requiredEnvironment(name: string) {
  const value = process.env[name];
  operatorAssert(value, `${name}_REQUIRED`);
  databaseIdentity(value);
  return value;
}
function secretEnvironment(name: string) {
  const value = process.env[name];
  operatorAssert(value, `${name}_REQUIRED`);
  return value;
}
function signingSecrets() {
  return {
    previousAuthSecret: secretEnvironment("RECOVERY_PREVIOUS_AUTH_SECRET"),
    rotatedAuthSecret: secretEnvironment("RECOVERY_ROTATED_AUTH_SECRET"),
  };
}
async function runSitePhase(
  command: Extract<RecoveryCommand, { kind: `site.${string}` }>,
  sourceUrl: string,
) {
  const maintenanceUrl = requiredEnvironment("RECOVERY_DATABASE_URL");
  const dependencies = await siteDependencies();
  if (command.kind === "site.plan" || command.kind === "site.stage")
    throw new OperatorError("INVALID_SITE_PHASE");
  const previous = await readOperatorPlan(command.plan, command.planHash);
  if ("receipt" in command) {
    const receipt = await readOperatorPlan(
      command.receipt,
      command.receiptHash,
    );
    let plan;
    switch (command.kind) {
      case "site.reconcile-plan":
        plan = await createSiteReconciliationPlan(
          { stagePlan: previous, stageReceipt: receipt, ...signingSecrets() },
          sourceUrl,
          maintenanceUrl,
          dependencies,
        );
        break;
      case "site.acceptance-plan":
        operatorAssert(command.actorId, "ACTOR_ID_REQUIRED");
        plan = await createSiteAcceptancePlan(
          {
            reconciliationPlan: previous,
            reconciliationReceipt: receipt,
            applicationUrl: requiredEnvironment("RECOVERY_APPLICATION_URL"),
            acceptanceUserId: command.actorId,
          },
          sourceUrl,
          maintenanceUrl,
          dependencies,
        );
        break;
      case "site.cutover-plan":
        operatorAssert(command.pointerPath, "POINTER_PATH_REQUIRED");
        plan = await createIsolatedCutoverPlan(
          {
            acceptancePlan: previous,
            acceptanceReceipt: receipt,
            pointerPath: command.pointerPath,
          },
          sourceUrl,
          maintenanceUrl,
          dependencies,
        );
        break;
      case "site.rollback-plan":
        plan = await createIsolatedRollbackPlan(
          {
            cutoverPlan: previous,
            cutoverReceipt: receipt,
            ...signingSecrets(),
            currentApplicationUrl: requiredEnvironment(
              "RECOVERY_APPLICATION_URL",
            ),
            rollbackMaintenanceUrl: requiredEnvironment(
              "RECOVERY_ROLLBACK_DATABASE_URL",
            ),
            rollbackApplicationUrl: requiredEnvironment(
              "RECOVERY_ROLLBACK_APPLICATION_URL",
            ),
          },
          sourceUrl,
          maintenanceUrl,
          dependencies,
        );
        break;
    }
    await writeOperatorJson(command.out, plan);
    console.info(
      JSON.stringify(
        { plan, planHash: planHash(plan), planFile: command.out },
        null,
        2,
      ),
    );
    return;
  }
  const input = { ...signingSecrets(), reason: command.reason };
  let receipt;
  switch (command.kind) {
    case "site.reconcile":
      receipt = await applySiteReconciliation(
        previous,
        sourceUrl,
        maintenanceUrl,
        input,
        dependencies,
      );
      break;
    case "site.acceptance":
      receipt = await applySiteAcceptance(
        previous,
        sourceUrl,
        maintenanceUrl,
        {
          ...input,
          applicationUrl: requiredEnvironment("RECOVERY_APPLICATION_URL"),
          freshPassword: secretEnvironment("RECOVERY_FRESH_TEST_PASSWORD"),
          ...(process.env.RECOVERY_CHECKPOINT_AUTH_SECRET
            ? {
                checkpointAuthSecret:
                  process.env.RECOVERY_CHECKPOINT_AUTH_SECRET,
              }
            : {}),
        },
        dependencies,
      );
      break;
    case "site.cutover":
      receipt = await applyIsolatedCutover(
        previous,
        sourceUrl,
        maintenanceUrl,
        {
          ...input,
          applicationUrl: requiredEnvironment("RECOVERY_APPLICATION_URL"),
        },
        dependencies,
      );
      break;
    case "site.rollback":
      receipt = await applyIsolatedRollback(
        previous,
        sourceUrl,
        maintenanceUrl,
        {
          ...input,
          rollbackMaintenanceUrl: requiredEnvironment(
            "RECOVERY_ROLLBACK_DATABASE_URL",
          ),
          rollbackApplicationUrl: requiredEnvironment(
            "RECOVERY_ROLLBACK_APPLICATION_URL",
          ),
          freshPassword: secretEnvironment("RECOVERY_FRESH_TEST_PASSWORD"),
        },
        dependencies,
      );
      break;
  }
  console.info(
    JSON.stringify({ receipt, receiptHash: planHash(receipt) }, null, 2),
  );
}
async function siteDependencies(): Promise<SiteDependencies> {
  const { Client } = await import("pg");
  return {
    execute: executeRecoveryTool,
    async connect(connectionString) {
      const client = new Client({
        // Enforce the shared timestamp policy before the first trigger/default;
        // runtime-only options never enter the reviewed database identity.
        connectionString: utcDatabaseUrl(postgresClientUrl(connectionString)),
        connectionTimeoutMillis: 10_000,
        statement_timeout: 60_000,
        application_name: "shbs-recovery-operator",
      });
      configureUtcPgTimestamps(client);
      try {
        await client.connect();
      } catch (error) {
        await client.end().catch(() => undefined);
        throw error;
      }
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
}

async function main() {
  const command = parseRecoveryCommand(process.argv.slice(2));
  if (command.kind === "help") {
    console.info(RECOVERY_HELP);
    return;
  }
  const sourceUrl = requiredEnvironment("DATABASE_URL");
  switch (command.kind) {
    case "site.reconcile-plan":
    case "site.reconcile":
    case "site.acceptance-plan":
    case "site.acceptance":
    case "site.cutover-plan":
    case "site.cutover":
    case "site.rollback-plan":
    case "site.rollback":
      await runSitePhase(command, sourceUrl);
      return;
  }
  if (command.kind === "site.plan" || command.kind === "site.stage") {
    const maintenanceUrl = requiredEnvironment("RECOVERY_DATABASE_URL");
    const dependencies = await siteDependencies();
    if (command.kind === "site.plan") {
      const plan = await createSitePlan(
        command,
        sourceUrl,
        maintenanceUrl,
        dependencies,
      );
      await writeOperatorJson(command.out, plan);
      console.info(
        JSON.stringify(
          { plan, planHash: planHash(plan), planFile: command.out },
          null,
          2,
        ),
      );
    } else {
      const data = await readOperatorPlan(command.plan, command.planHash);
      const receipt = await stageSitePlan(
        data,
        sourceUrl,
        maintenanceUrl,
        command.reason,
        dependencies,
      );
      console.info(JSON.stringify(receipt, null, 2));
    }
    return;
  }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("../generated/prisma"),
    import("@prisma/adapter-pg"),
  ]);
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: utcDatabaseUrl(postgresClientUrl(sourceUrl)),
    }),
  });
  try {
    if (
      command.kind === "records.tables" ||
      command.kind === "records.inspect" ||
      command.kind === "records.dependencies"
    ) {
      const inspector = await import("../src/server/recovery/record-inspector");
      const report = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return command.kind === "records.tables"
            ? inspector.listRecordTables(tx, { operator: true })
            : command.kind === "records.dependencies"
              ? inspector.inspectRecoveryEvidence(
                  tx,
                  { operator: true },
                  command,
                )
              : inspector.inspectRecords(tx, { operator: true }, command);
        },
        { isolationLevel: "RepeatableRead", timeout: 60_000 },
      );
      console.info(
        JSON.stringify(
          {
            version: 1,
            kind: command.kind,
            generatedAt: new Date().toISOString(),
            report,
          },
          null,
          2,
        ),
      );
      return;
    }
    const authorize = async (tx: TransactionDb) => {
      const actor = await tx.user.findUnique({
        where: { id: command.actorId },
        select: {
          role: true,
          suspendedAt: true,
          mergedIntoId: true,
          recoveryVoidedAt: true,
        },
      });
      operatorAssert(
        actor &&
          ["HEAD", "ADMIN"].includes(actor.role) &&
          !actor.suspendedAt &&
          !actor.mergedIntoId &&
          !actor.recoveryVoidedAt,
        "FORBIDDEN",
      );
    };
    if (
      command.kind === "admission.receipt" ||
      command.kind === "checkpoint.receipt"
    ) {
      const receipt = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await authorize(tx);
          const { readRecoveryReceipt } =
            await import("../src/server/recovery/receipt");
          return readRecoveryReceipt(tx, command.receiptId, command.actorId);
        },
        { isolationLevel: "RepeatableRead", timeout: 60_000 },
      );
      operatorAssert(receipt, "RECEIPT_NOT_FOUND");
      console.info(
        JSON.stringify({ version: 1, kind: command.kind, receipt }, null, 2),
      );
      return;
    }
    if (
      command.kind === "checkpoint.capture" ||
      command.kind === "checkpoint.inspect" ||
      command.kind === "checkpoint.compare" ||
      command.kind === "checkpoint.apply"
    ) {
      const recovery = await import("../src/server/recovery/checkpoint");
      const inspect = (checkpointId: string) =>
        db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            await authorize(tx);
            return recovery.inspectRecoveryCheckpoint(tx, { checkpointId });
          },
          { isolationLevel: "RepeatableRead", timeout: 60_000 },
        );
      if (
        command.kind === "checkpoint.capture" ||
        command.kind === "checkpoint.inspect"
      ) {
        const checkpointId =
          command.kind === "checkpoint.inspect"
            ? command.checkpointId
            : (
                await recovery.captureRecoveryCheckpoint(
                  db,
                  recovery.captureCheckpointInput.parse({
                    adapter: command.adapter,
                    sourceId: command.sourceId,
                  }),
                  { id: command.actorId },
                )
              ).checkpointId;
        const preview = await inspect(checkpointId);
        const plan = checkpointFileSchema.parse({
          version: 1,
          kind: "scoped-checkpoint-recovery",
          createdAt: new Date().toISOString(),
          source: databaseIdentity(sourceUrl),
          actorId: command.actorId,
          checkpointId,
          fingerprint: preview.fingerprint,
          preview,
        });
        if (command.out) await writeOperatorJson(command.out, plan);
        console.info(
          JSON.stringify(
            {
              plan,
              planHash: planHash(plan),
              ...(command.out ? { planFile: command.out } : {}),
            },
            null,
            2,
          ),
        );
        return;
      }
      const parsed = checkpointFileSchema.safeParse(
        await readOperatorPlan(command.plan, command.planHash),
      );
      operatorAssert(parsed.success, "INVALID_CHECKPOINT_PLAN");
      const plan = parsed.data;
      operatorAssert(
        planHash(plan.source) === planHash(databaseIdentity(sourceUrl)),
        "WRONG_DATABASE",
      );
      operatorAssert(plan.actorId === command.actorId, "PLAN_ACTOR_MISMATCH");
      if (command.kind === "checkpoint.compare") {
        const current = await inspect(plan.checkpointId);
        console.info(
          JSON.stringify(
            {
              version: 1,
              kind: "scoped-checkpoint-comparison",
              checkpointId: plan.checkpointId,
              changed: plan.fingerprint !== current.fingerprint,
              checkpoint: plan.preview,
              current,
            },
            null,
            2,
          ),
        );
      } else {
        const receipt = await recovery.applyRecoveryCheckpointFromOperator(
          db,
          {
            checkpointId: plan.checkpointId,
            expectedFingerprint: plan.fingerprint,
            reason: command.reason,
            clientKey: command.clientKey,
          },
          { id: command.actorId },
        );
        console.info(
          JSON.stringify(
            { version: 1, kind: "scoped-checkpoint-receipt", receipt },
            null,
            2,
          ),
        );
      }
      return;
    }
    const recovery = await import("../src/server/recovery/admission");
    const inspect = async (actionId: string) =>
      db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await authorize(tx);
          return recovery.inspectAdmissionRecovery(tx, { actionId });
        },
        { isolationLevel: "RepeatableRead", timeout: 60_000 },
      );
    if (command.kind === "admission.inspect") {
      const preview = await inspect(command.actionId);
      const plan = {
        version: 1,
        kind: "admission-recovery",
        createdAt: new Date().toISOString(),
        source: databaseIdentity(sourceUrl),
        actorId: command.actorId,
        actionId: command.actionId,
        fingerprint: preview.fingerprint,
        preview,
      };
      if (command.out) await writeOperatorJson(command.out, plan);
      console.info(
        JSON.stringify(
          {
            plan,
            planHash: planHash(plan),
            ...(command.out ? { planFile: command.out } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }
    const parsed = admissionFileSchema.safeParse(
      await readOperatorPlan(command.plan, command.planHash),
    );
    operatorAssert(parsed.success, "INVALID_ADMISSION_PLAN");
    const plan = parsed.data;
    operatorAssert(
      planHash(plan.source) === planHash(databaseIdentity(sourceUrl)),
      "WRONG_DATABASE",
    );
    operatorAssert(plan.actorId === command.actorId, "PLAN_ACTOR_MISMATCH");
    if (command.kind === "admission.compare") {
      const current = await inspect(plan.actionId);
      console.info(
        JSON.stringify(
          {
            version: 1,
            kind: "admission-checkpoint-comparison",
            actionId: plan.actionId,
            changed: current.fingerprint !== plan.fingerprint,
            checkpointFingerprint: plan.fingerprint,
            currentFingerprint: current.fingerprint,
            checkpoint: plan.preview,
            current,
          },
          null,
          2,
        ),
      );
      return;
    }
    // Only the trusted host route imports this adapter; callers cannot provide a role.
    const receipt = await recovery.applyAdmissionRecoveryFromOperator(
      db,
      {
        actionId: plan.actionId,
        expectedFingerprint: plan.fingerprint,
        reason: command.reason,
        clientKey: command.clientKey,
      },
      { id: command.actorId },
    );
    console.info(
      JSON.stringify(
        { version: 1, kind: "admission-recovery-receipt", receipt },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  // Driver/tool error messages can embed secrets or private SQL. Emit stable codes only.
  const code =
    error instanceof OperatorError
      ? error.code
      : error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,99}$/.test(error.code)
        ? error.code
        : "RECOVERY_COMMAND_FAILED";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
}
