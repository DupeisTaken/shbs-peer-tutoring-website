/** Whole-site recovery stops at a sealed staging database. There is no live cutover here. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { compose, Transform, Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { operatorAssert, OperatorError } from "./operator-cli";
import {
  assertRegularFile,
  databaseIdentity,
  planHash,
  writeOperatorJson,
} from "./operator-plan";

const MAX_BACKUP_BYTES = 2 * 1024 ** 3;
const MAX_SQL_BYTES = 8 * 1024 ** 3;
const identitySchema = z
  .object({
    host: z.string(),
    port: z.string(),
    database: z.string(),
    user: z.string(),
  })
  .strict();
const checkpointSchema = z
  .object({
    database: z.string(),
    serverVersion: z.string(),
    tables: z
      .array(z.object({ table: z.string(), count: z.string() }).strict())
      .max(500),
  })
  .strict();
export const sitePlanSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("site-stage"),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    backup: z
      .object({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        sqlBytes: z.number().int().positive(),
      })
      .strict(),
    source: identitySchema,
    maintenance: identitySchema,
    targetName: z
      .string()
      .regex(/^shbs_recovery_[a-z0-9_]+$/)
      .max(63),
    evidenceDir: z.string(),
    checkpoint: checkpointSchema,
    cutover: z.literal("BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW"),
  })
  .strict();
export type SitePlan = z.infer<typeof sitePlanSchema>;
export interface OperatorSql {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}
export interface ToolRequest {
  tool: "pg_dump" | "psql";
  args: string[];
  env: NodeJS.ProcessEnv;
  input?: Readable;
  outputPath?: string;
}
export interface SiteDependencies {
  connect(url: string): Promise<OperatorSql>;
  execute(request: ToolRequest): Promise<void>;
}
function assertIsolatedEndpoint(
  source: SitePlan["source"],
  maintenance: SitePlan["maintenance"],
) {
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  operatorAssert(
    loopback(maintenance.host),
    "RECOVERY_REQUIRES_LOOPBACK_MAINTENANCE",
  );
  operatorAssert(
    !(loopback(source.host) && source.port === maintenance.port),
    "RECOVERY_REQUIRES_SEPARATE_POSTGRES_INSTANCE",
  );
  operatorAssert(
    source.user !== maintenance.user,
    "RECOVERY_REQUIRES_SEPARATE_OPERATOR_ROLE",
  );
}
function credentials(urlText: string, database?: string): NodeJS.ProcessEnv {
  const url = new URL(urlText);
  const identity = databaseIdentity(urlText);
  // Do not inherit PGOPTIONS, service files, shell hooks, or site credentials accidentally.
  return {
    NODE_ENV: "production",
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    PGHOST: identity.host,
    PGPORT: identity.port,
    PGUSER: identity.user,
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database ?? identity.database,
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c statement_timeout=600000 -c timezone=UTC",
    PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  };
}
export async function executeRecoveryTool(
  request: ToolRequest,
  executable: string = request.tool,
): Promise<void> {
  const child = spawn(executable, request.args, {
    env: request.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Consume diagnostics without exposing dump text, URLs, credentials or private rows.
  child.stderr.resume();
  const timeout = setTimeout(() => {
    child.kill();
  }, 10 * 60_000);
  const completed = new Promise<void>((accept, reject) => {
    child.once("error", () =>
      reject(new OperatorError("POSTGRES_TOOL_UNAVAILABLE")),
    );
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new OperatorError("POSTGRES_TOOL_FAILED")),
    );
  });
  const output = request.outputPath
    ? createWriteStream(request.outputPath, { flags: "wx", mode: 0o600 })
    : new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
  try {
    if (!request.input) child.stdin.end();
    await Promise.all([
      completed,
      pipeline(child.stdout, byteLimit(MAX_SQL_BYTES), output),
      ...(request.input ? [pipeline(request.input, child.stdin)] : []),
    ]);
  } catch {
    child.kill();
    throw new OperatorError("POSTGRES_TOOL_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}
function byteLimit(limit: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > limit ? new OperatorError("BACKUP_TOO_LARGE") : null, chunk);
    },
  });
}
export async function inspectLogicalBackup(
  path: string,
): Promise<SitePlan["backup"]> {
  const absolute = await realpath(resolve(path));
  operatorAssert(absolute.endsWith(".sql.gz"), "UNSUPPORTED_BACKUP_FORMAT");
  await assertRegularFile(absolute, MAX_BACKUP_BYTES);
  const hash = createHash("sha256");
  let bytes = 0;
  let sqlBytes = 0;
  let prefix = "";
  const compressed = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      sqlBytes += chunk.length;
      if (prefix.length < 512)
        prefix += chunk.toString("utf8").slice(0, 512 - prefix.length);
      done();
    },
  });
  try {
    await pipeline(
      createReadStream(absolute),
      compressed,
      createGunzip(),
      byteLimit(MAX_SQL_BYTES),
      sink,
    );
  } catch {
    throw new OperatorError("INVALID_OR_OVERSIZED_GZIP_BACKUP");
  }
  operatorAssert(
    prefix.includes("PostgreSQL database dump"),
    "UNSUPPORTED_BACKUP_FORMAT",
  );
  return { path: absolute, sha256: hash.digest("hex"), bytes, sqlBytes };
}
async function inspectCurrentEvidence(path: string) {
  await assertRegularFile(path, MAX_SQL_BYTES);
  const handle = await open(path, "r+");
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    operatorAssert(
      header.toString("ascii") === "PGDMP",
      "INVALID_CURRENT_SITE_EVIDENCE",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(path),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        bytes += chunk.length;
        done();
      },
    }),
  );
  return { path, bytes, sha256: hash.digest("hex") };
}
async function checkpoint(
  connection: OperatorSql,
): Promise<SitePlan["checkpoint"]> {
  // This transaction protects both metadata and counts from accidental helper writes.
  await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const { rows: identity } = await connection.query(
      "SELECT current_database() AS database, current_setting('server_version') AS version",
    );
    const { rows } = await connection.query(
      "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 501",
    );
    operatorAssert(rows.length <= 500, "TOO_MANY_TABLES");
    const tables: { table: string; count: string }[] = [];
    for (const row of rows) {
      const name = String(row.name);
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const result = await connection.query(
        `SELECT count(*)::text AS count FROM public.${quoted}`,
      );
      tables.push({ table: name, count: String(result.rows[0]?.count) });
    }
    await connection.query("COMMIT");
    return {
      database: String(identity[0]?.database),
      serverVersion: String(identity[0]?.version),
      tables,
    };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  }
}
async function assertTargetAbsent(connection: OperatorSql, name: string) {
  const existing = await connection.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [name],
  );
  operatorAssert(existing.rows.length === 0, "TARGET_DATABASE_ALREADY_EXISTS");
}
async function assertStagingSourceRole(
  connection: OperatorSql,
  sourceUser: string,
) {
  const result = await connection.query(
    "SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1",
    [sourceUser],
  );
  const role = result.rows[0];
  operatorAssert(
    role &&
      [
        "rolcanlogin",
        "rolsuper",
        "rolcreaterole",
        "rolcreatedb",
        "rolreplication",
        "rolbypassrls",
      ].every((key) => role[key] === false),
    "STAGING_SOURCE_ROLE_MUST_BE_NOLOGIN_AND_UNPRIVILEGED",
  );
}
export async function createSitePlan(
  input: { backup: string; targetName: string; evidenceDir: string },
  sourceUrl: string,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
): Promise<SitePlan> {
  const source = databaseIdentity(sourceUrl);
  const maintenance = databaseIdentity(maintenanceUrl);
  assertIsolatedEndpoint(source, maintenance);
  operatorAssert(
    /^shbs_recovery_[a-z0-9_]+$/.test(input.targetName) &&
      input.targetName.length <= 63 &&
      input.targetName !== source.database &&
      input.targetName !== maintenance.database,
    "INVALID_TARGET_NAME",
  );
  const backup = await inspectLogicalBackup(input.backup);
  const sourceDb = await dependencies.connect(sourceUrl);
  let snapshot: SitePlan["checkpoint"];
  try {
    snapshot = await checkpoint(sourceDb);
    operatorAssert(
      snapshot.database === source.database,
      "SOURCE_DATABASE_MISMATCH",
    );
  } finally {
    await sourceDb.close();
  }
  const maintenanceDb = await dependencies.connect(maintenanceUrl);
  try {
    await assertTargetAbsent(maintenanceDb, input.targetName);
    await assertStagingSourceRole(maintenanceDb, source.user);
  } finally {
    await maintenanceDb.close();
  }
  return {
    version: 1,
    kind: "site-stage",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    backup,
    source,
    maintenance,
    targetName: input.targetName,
    evidenceDir: resolve(input.evidenceDir),
    checkpoint: snapshot,
    cutover: "BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW",
  };
}
export async function stageSitePlan(
  data: unknown,
  sourceUrl: string,
  maintenanceUrl: string,
  reason: string,
  dependencies: SiteDependencies,
) {
  const result = sitePlanSchema.safeParse(data);
  operatorAssert(result.success, "INVALID_SITE_PLAN");
  const plan = result.data;
  operatorAssert(
    reason.trim().length > 0 && reason.length <= 1000,
    "INVALID_REASON",
  );
  operatorAssert(
    planHash(databaseIdentity(sourceUrl)) === planHash(plan.source) &&
      planHash(databaseIdentity(maintenanceUrl)) === planHash(plan.maintenance),
    "WRONG_DATABASE",
  );
  assertIsolatedEndpoint(plan.source, plan.maintenance);
  operatorAssert(
    plan.targetName !== plan.source.database &&
      plan.targetName !== plan.maintenance.database,
    "INVALID_TARGET_NAME",
  );
  const backup = await inspectLogicalBackup(plan.backup.path);
  operatorAssert(planHash(backup) === planHash(plan.backup), "BACKUP_CHANGED");
  const maintenance = await dependencies.connect(maintenanceUrl);
  const evidence = join(plan.evidenceDir, plan.id);
  let created = false;
  let sealed = false;
  try {
    await assertTargetAbsent(maintenance, plan.targetName);
    await assertStagingSourceRole(maintenance, plan.source.user);
    // A fresh evidence directory is the durable replay lock, outside either database.
    await mkdir(evidence, { recursive: false, mode: 0o700 });
    await writeOperatorJson(join(evidence, "intent.json"), {
      plan,
      planHash: planHash(plan),
      reason,
      startedAt: new Date().toISOString(),
    });
    // Preserve the complete current security state and evidence before touching staging.
    const currentDump = join(evidence, "current-site.dump");
    await dependencies.execute({
      tool: "pg_dump",
      args: ["--format=custom", "--no-password"],
      env: credentials(sourceUrl),
      outputPath: currentDump,
    });
    const currentEvidence = await inspectCurrentEvidence(currentDump);
    await writeOperatorJson(
      join(evidence, "current-evidence.json"),
      currentEvidence,
    );
    // Names have a strict grammar; values elsewhere use bound SQL parameters.
    await maintenance.query(
      `CREATE DATABASE "${plan.targetName}" TEMPLATE template0`,
    );
    created = true;
    await maintenance.query(
      `REVOKE CONNECT ON DATABASE "${plan.targetName}" FROM PUBLIC`,
    );
    const sql = compose(
      createReadStream(backup.path),
      createGunzip(),
      byteLimit(MAX_SQL_BYTES),
    ) as Readable;
    await dependencies.execute({
      tool: "psql",
      args: [
        "--no-psqlrc",
        "--no-password",
        "--set",
        "ON_ERROR_STOP=1",
        "--single-transaction",
      ],
      env: credentials(maintenanceUrl, plan.targetName),
      input: sql,
    });
    const restoredUrl = new URL(maintenanceUrl);
    restoredUrl.pathname = `/${plan.targetName}`;
    const staged = await dependencies.connect(restoredUrl.toString());
    let restored: SitePlan["checkpoint"];
    try {
      restored = await checkpoint(staged);
    } finally {
      await staged.close();
    }
    operatorAssert(
      restored.database === plan.targetName,
      "RESTORED_DATABASE_MISMATCH",
    );
    // Connection fencing is deliberate: normal Next startup migrates and starts writers.
    await maintenance.query(
      `ALTER DATABASE "${plan.targetName}" ALLOW_CONNECTIONS false`,
    );
    sealed = true;
    const receipt = {
      version: 1,
      kind: "site-stage-receipt",
      planId: plan.id,
      planHash: planHash(plan),
      targetName: plan.targetName,
      state: "SEALED_STAGING_ONLY",
      cutover: plan.cutover,
      createdAt: new Date().toISOString(),
      before: plan.checkpoint,
      restored,
      comparison: compareCheckpoints(plan.checkpoint, restored),
      currentEvidence,
      evidenceDirectory: evidence,
    };
    await writeOperatorJson(join(evidence, "receipt.json"), receipt);
    return receipt;
  } catch {
    // A failed restore remains evidence, never a half-restored site eligible for startup.
    if (created && !sealed) {
      try {
        await maintenance.query(
          `ALTER DATABASE "${plan.targetName}" ALLOW_CONNECTIONS false`,
        );
        sealed = true;
      } catch {
        /* Receipt explicitly reports a failed fence for operator intervention. */
      }
    }
    if (created)
      await writeOperatorJson(join(evidence, "failure.json"), {
        planId: plan.id,
        state: sealed
          ? "FAILED_SEALED"
          : "FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION",
        targetName: plan.targetName,
      }).catch(() => undefined);
    throw new OperatorError(
      created && !sealed
        ? "STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION"
        : "SITE_STAGE_FAILED_REVIEW_EVIDENCE",
    );
  } finally {
    await maintenance.close();
  }
}
export function compareCheckpoints(
  before: SitePlan["checkpoint"],
  restored: SitePlan["checkpoint"],
) {
  const left = new Map(before.tables.map((row) => [row.table, row.count]));
  const right = new Map(restored.tables.map((row) => [row.table, row.count]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .map((table) => ({
      table,
      before: left.get(table) ?? null,
      restored: right.get(table) ?? null,
      changed: left.get(table) !== right.get(table),
    }));
}
