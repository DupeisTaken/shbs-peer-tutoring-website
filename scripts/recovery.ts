/** Host-only recovery entry point. Never import the Next server, shared db or workers. */
import "dotenv/config";
import { z } from "zod";
import {
  parseRecoveryCommand,
  OperatorError,
  operatorAssert,
  RECOVERY_HELP,
} from "../src/server/recovery/operator-cli";
import {
  databaseIdentity,
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

function requiredEnvironment(name: "DATABASE_URL" | "RECOVERY_DATABASE_URL") {
  const value = process.env[name];
  operatorAssert(value, `${name}_REQUIRED`);
  databaseIdentity(value);
  return value;
}
async function siteDependencies(): Promise<SiteDependencies> {
  const { Client } = await import("pg");
  return {
    execute: executeRecoveryTool,
    async connect(connectionString) {
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 60_000,
        application_name: "shbs-recovery-operator",
      });
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
  const [{ PrismaClient }, { PrismaPg }, { utcDatabaseUrl }] =
    await Promise.all([
      import("../generated/prisma"),
      import("@prisma/adapter-pg"),
      import("../src/server/database-url"),
    ]);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: utcDatabaseUrl(sourceUrl) }),
  });
  try {
    if (
      command.kind === "records.tables" ||
      command.kind === "records.inspect"
    ) {
      const inspector = await import("../src/server/recovery/record-inspector");
      const report = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return command.kind === "records.tables"
            ? inspector.listRecordTables(tx, { operator: true })
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
    if (command.kind === "admission.receipt") {
      const receipt = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await authorize(tx);
          return tx.recoveryReceipt.findUnique({
            where: { id: command.receiptId },
            select: {
              id: true,
              actionId: true,
              actorId: true,
              clientKey: true,
              reason: true,
              channel: true,
              fingerprint: true,
              createdAt: true,
            },
          });
        },
        { isolationLevel: "RepeatableRead", timeout: 60_000 },
      );
      operatorAssert(receipt, "RECEIPT_NOT_FOUND");
      console.info(
        JSON.stringify(
          { version: 1, kind: "admission-recovery-receipt", receipt },
          null,
          2,
        ),
      );
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
