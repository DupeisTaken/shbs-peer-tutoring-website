/** Real Next/Auth.js smoke on an owned disposable writable clone, never the target. */
import { randomBytes, createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer, type Socket } from "node:net";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { encode } from "next-auth/jwt";
import { z } from "zod";
import { sessionIdentity } from "../../lib/session-identity";
import { operatorAssert, OperatorError } from "./operator-cli";
import { databaseIdentity, planHash } from "./operator-plan";
import { requireIdleRecoveryDatabase, type OperatorSql, type SiteDependencies } from "./operator-site";

export interface NextCapabilityProofs {
  registrationCode?: string;
  surveyToken?: string;
  calendarToken?: string;
  schoolReportToken?: string;
  historyToken?: string;
  resetToken?: string;
  viewer?: { email: string; code: string };
  crew?: { email: string; code: string };
  loginCode?: { userId: string; code: string };
}
export interface NextCloneRequest {
  templateDatabase: string;
  authSecret: string;
  userId: string;
  identifier: string;
  password: string;
  mode: "before-recovery" | "after-recovery";
  runtimeDirectory?: string;
  expectedCheckoutSha?: string;
  previousAuthSecret?: string;
  checkpointAuthSecret?: string;
  previousSessionVersion?: number;
  checkpointSessionVersion?: number | null;
  rejectedPasswords?: string[];
  proofs?: NextCapabilityProofs;
  observeWorkersMs?: number;
}
export interface NextCloneEvidence {
  scope: "DISPOSABLE_WRITABLE_NEXT_CLONE";
  runtimeBuildId: string;
  serverSha256: string;
  checkoutSha: string;
  checks: string[];
  workerObservationMs: number;
  syntheticTransportConnections: number;
  restoredQueueBeforeFingerprint: string;
  restoredQueueAfterFingerprint: string;
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const nextCloneEvidenceSchema = z
  .object({
    scope: z.literal("DISPOSABLE_WRITABLE_NEXT_CLONE"),
    checkoutSha: z.string().regex(/^[a-f0-9]{40}$/),
    runtimeBuildId: z.string().min(1).max(200),
    serverSha256: z.string().regex(/^[a-f0-9]{64}$/),
    checks: z.array(z.string()).max(40),
    workerObservationMs: z.number().int().min(0).max(90000),
    syntheticTransportConnections: z.number().int().nonnegative(),
    restoredQueueBeforeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    restoredQueueAfterFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
const childEnv = (
  databaseUrl: string,
  secret: string,
  origin: string,
  smtpPort: number,
): NodeJS.ProcessEnv => ({
  // Production email URL checks require HTTPS. This reserved synthetic origin
  // appears only in inert message bodies; all probes and SMTP stay on loopback.
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl,
  AUTH_SECRET: secret,
  AUTH_URL: "https://recovery.example.test",
  AUTH_TRUST_HOST: "true",
  AUTH_BOOTSTRAP_ADMIN_EMAILS: "",
  HOSTNAME: "127.0.0.1",
  PORT: new URL(origin).port,
  NEXT_TELEMETRY_DISABLED: "1",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(smtpPort),
  SMTP_USER: "synthetic@example.test",
  SMTP_PASSWORD: randomBytes(24).toString("hex"),
  EMAIL_FROM: "synthetic@example.test",
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
});
async function availablePort() {
  const server = createNetServer();
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  operatorAssert(
    address && typeof address !== "string",
    "NEXT_ACCEPTANCE_PORT_UNAVAILABLE",
  );
  const port = address.port;
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}
const QUEUE_TABLES = [
  "EmailDelivery",
  "SessionNotice",
  "StudentSignupNotice",
  "ScheduledProgramRefresh",
  "MonthlyHoursSchedule",
  "SchoolHoursSchedule",
] as const;
type QueueTable = (typeof QUEUE_TABLES)[number];
const QUEUE_DIAGNOSTIC_FIELDS = new Set([
  "status",
  "state",
  "attempts",
  "attemptId",
  "attemptStartedAt",
  "leaseUntil",
  "availableAt",
  "completedAt",
  "createdAt",
  "updatedAt",
  "sentAt",
  "lastAttemptAt",
  "lastError",
  "version",
  "enabled",
  "nextDueAt",
  "nextMonth",
  "lastGenerationError",
  "blockedReason",
  "executedAt",
]);
export type NextQueueSnapshot = {
  table: QueueTable;
  rows: Record<string, unknown>[];
}[];

/** Row identities stay internal; diagnostics expose counts and column names only. */
export function nextQueueDifferences(
  before: NextQueueSnapshot,
  after: NextQueueSnapshot,
) {
  const tableRows = (snapshot: NextQueueSnapshot, table: QueueTable) => {
    const entries = snapshot.filter((entry) => entry.table === table);
    operatorAssert(
      entries.length === 1,
      "NEXT_ACCEPTANCE_QUEUE_SNAPSHOT_INVALID",
    );
    const rows = new Map<string, Record<string, unknown>>();
    for (const row of entries[0]!.rows) {
      operatorAssert(
        typeof row.id === "string" && !rows.has(row.id),
        "NEXT_ACCEPTANCE_QUEUE_IDENTITY_INVALID",
      );
      rows.set(row.id, row);
    }
    return rows;
  };
  return QUEUE_TABLES.map((table) => {
    const old = tableRows(before, table);
    const current = tableRows(after, table);
    let added = 0,
      removed = 0,
      changed = 0;
    const changedFields = new Set<string>();
    for (const id of old.keys()) if (!current.has(id)) removed++;
    for (const [id, row] of current) {
      const previous = old.get(id);
      if (!previous) {
        added++;
        continue;
      }
      if (planHash(previous) === planHash(row)) continue;
      changed++;
      for (const field of new Set([
        ...Object.keys(previous),
        ...Object.keys(row),
      ])) {
        const value = (record: Record<string, unknown>) =>
          Object.hasOwn(record, field)
            ? { value: record[field] }
            : { absent: true };
        if (planHash(value(previous)) !== planHash(value(row)))
          changedFields.add(
            QUEUE_DIAGNOSTIC_FIELDS.has(field) ? field : "[other column]",
          );
      }
    }
    return {
      table,
      before: old.size,
      after: current.size,
      added,
      removed,
      changed,
      changedFields: [...changedFields].sort(),
    };
  });
}

async function queueState(
  db: OperatorSql,
  excludedDeliveryId?: string,
): Promise<NextQueueSnapshot> {
  const result: NextQueueSnapshot = [];
  for (const table of QUEUE_TABLES) {
    const rows = await db.query(
      `SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ${table === "EmailDelivery" && excludedDeliveryId ? "WHERE id<>$1" : ""} ORDER BY to_jsonb(t)::text LIMIT 10001`,
      table === "EmailDelivery" && excludedDeliveryId
        ? [excludedDeliveryId]
        : [],
    );
    operatorAssert(
      rows.rows.length <= 10000,
      "NEXT_ACCEPTANCE_QUEUE_TOO_LARGE",
    );
    result.push({
      table,
      rows: rows.rows.map((row) => {
        operatorAssert(
          row.row !== null &&
            typeof row.row === "object" &&
            !Array.isArray(row.row),
          "NEXT_ACCEPTANCE_QUEUE_SNAPSHOT_INVALID",
        );
        return row.row as Record<string, unknown>;
      }),
    });
  }
  return result;
}
class Cookies {
  readonly values = new Map<string, string>();
  absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const first = header.split(";", 1)[0] ?? "";
      const equals = first.indexOf("=");
      if (equals > 0)
        this.values.set(first.slice(0, equals), first.slice(equals + 1));
    }
  }
  header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
async function boundedJsonResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  operatorAssert(reader, "NEXT_ACCEPTANCE_INVALID_RESPONSE");
  try {
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_JSON_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OperatorError("NEXT_ACCEPTANCE_RESPONSE_TOO_LARGE");
      }
      parts.push(part.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(parts),
    );
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError("NEXT_ACCEPTANCE_INVALID_RESPONSE");
  } finally {
    reader.releaseLock();
  }
}
export async function readNextJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const data = await boundedJsonResponse(response);
  operatorAssert(
    data !== null && typeof data === "object" && !Array.isArray(data),
    "NEXT_ACCEPTANCE_INVALID_RESPONSE",
  );
  return data as Record<string, unknown>;
}
const applicationSessionSchema = z.looseObject({
  user: z.looseObject({
    id: z.string().min(1).max(200),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  }),
  role: z.enum([
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "TUTOR",
    "CREW",
    "STUDENT",
    "VIEWER",
  ]),
  tutorId: z.string().min(1).max(200).nullable(),
  sessionVersion: z.number().int().min(0).max(2147483647),
  historyAccessRevision: z.number().int().min(0).max(2147483647),
  expires: z.iso.datetime(),
});
/** Auth.js returns JSON null for no cookie, an invalid key or a revoked epoch.
 * Every non-null response must be a genuine application session, not an error
 * payload accidentally counted as proof that an old credential was rejected. */
export async function readNextApplicationSession(response: Response) {
  operatorAssert(
    response.status === 200,
    "NEXT_ACCEPTANCE_SESSION_ROUTE_FAILED",
  );
  operatorAssert(
    /^application\/json\s*(?:;|$)/i.test(
      response.headers.get("content-type") ?? "",
    ),
    "NEXT_ACCEPTANCE_INVALID_RESPONSE",
  );
  const data = await boundedJsonResponse(response);
  if (data === null) return null;
  const parsed = applicationSessionSchema.safeParse(data);
  operatorAssert(parsed.success, "NEXT_ACCEPTANCE_INVALID_RESPONSE");
  return parsed.data;
}
async function signin(origin: string, input: Record<string, string>) {
  const jar = new Cookies();
  const csrf = await fetch(`${origin}/api/auth/csrf`, {
    signal: AbortSignal.timeout(15000),
  });
  jar.absorb(csrf);
  operatorAssert(csrf.ok, "NEXT_ACCEPTANCE_CSRF_FAILED");
  const value = await readNextJsonObject(csrf);
  operatorAssert(
    typeof value.csrfToken === "string",
    "NEXT_ACCEPTANCE_CSRF_FAILED",
  );
  const response = await fetch(`${origin}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: jar.header(),
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      ...input,
      csrfToken: value.csrfToken,
      callbackUrl: `${origin}/`,
    }),
    signal: AbortSignal.timeout(20000),
  });
  operatorAssert(response.status < 500, "NEXT_ACCEPTANCE_CALLBACK_FAILED");
  jar.absorb(response);
  await response.arrayBuffer();
  const session = await fetch(`${origin}/api/auth/session`, {
    headers: { Cookie: jar.header() },
    signal: AbortSignal.timeout(15000),
  });
  const data = await readNextApplicationSession(session);
  return {
    jar,
    session: data,
    userId: data?.user.id ?? null,
  };
}
async function rpc(
  origin: string,
  procedure: string,
  input: unknown,
  method: "GET" | "POST",
  jar?: Cookies,
  predicate?: (data: Record<string, unknown>) => boolean,
) {
  const encoded = JSON.stringify({ json: input });
  const response = await fetch(
    `${origin}/api/trpc/${procedure}${method === "GET" ? `?input=${encodeURIComponent(encoded)}` : ""}`,
    {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(jar ? { Cookie: jar.header() } : {}),
      },
      ...(method === "POST" ? { body: encoded } : {}),
      signal: AbortSignal.timeout(20000),
    },
  );
  operatorAssert(response.status < 500, "NEXT_ACCEPTANCE_APPLICATION_ERROR");
  const body = await readNextJsonObject(response),
    result = body.result as
      { data?: { json?: Record<string, unknown> } } | undefined;
  return (
    response.ok &&
    result !== undefined &&
    body.error === undefined &&
    (!predicate || predicate(result.data?.json ?? {}))
  );
}
const unescapeHtml = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
async function resetThroughActualForm(
  origin: string,
  token: string,
  db: OperatorSql,
) {
  const page = await fetch(
    `${origin}/reset-password?token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(20000) },
  );
  const html = await page.text();
  operatorAssert(
    html.length <= 4 * 1024 * 1024,
    "NEXT_ACCEPTANCE_RESPONSE_TOO_LARGE",
  );
  operatorAssert(page.ok, "NEXT_ACCEPTANCE_RESET_PAGE_FAILED");
  const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(
    (match) => (match[1] ?? "").includes('name="token"'),
  );
  if (!form) {
    operatorAssert(
      /invalid|expired|unavailable|失效|过期/i.test(html),
      "NEXT_ACCEPTANCE_RESET_FORM_MISSING",
    );
    return false;
  }
  const data = new FormData();
  for (const input of form[1]!.matchAll(/<input\b[^>]*>/g)) {
    const attributes = Object.fromEntries(
      [...input[0].matchAll(/([\w:$.-]+)="([^"]*)"/g)].map((match) => [
        match[1]!,
        unescapeHtml(match[2]!),
      ]),
    );
    if (attributes.type === "hidden" && attributes.name)
      data.set(attributes.name, attributes.value ?? "");
  }
  operatorAssert(
    [...data.keys()].some((key) => key.startsWith("$ACTION")),
    "NEXT_ACCEPTANCE_SERVER_ACTION_MISSING",
  );
  data.set("token", token);
  data.set("password", "Synthetic-reset-proof-493!");
  data.set("confirm", "Synthetic-reset-proof-493!");
  const before = (
    await db.query(
      'SELECT "passwordHash","sessionVersion" FROM public."User" WHERE id=\'checkpoint\'',
    )
  ).rows[0];
  const posted = await fetch(
    `${origin}/reset-password?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { Origin: origin },
      body: data,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    },
  );
  await posted.arrayBuffer();
  operatorAssert(posted.status < 400, "NEXT_ACCEPTANCE_RESET_ACTION_FAILED");
  const after = (
    await db.query(
      'SELECT "passwordHash","sessionVersion" FROM public."User" WHERE id=\'checkpoint\'',
    )
  ).rows[0];
  return (
    typeof after?.passwordHash === "string" &&
    after.passwordHash !== before?.passwordHash &&
    Number(after.sessionVersion) > Number(before?.sessionVersion)
  );
}

async function checkCapabilities(
  origin: string,
  proofs: NextCapabilityProofs,
  expected: boolean,
  jar: Cookies,
  db: OperatorSql,
) {
  const checks: string[] = [];
  const check = (name: string, actual: boolean) => {
    operatorAssert(
      actual === expected,
      `NEXT_CAPABILITY_${name}_${expected ? "WAS_NOT_VALID" : "WAS_REVIVED"}`,
    );
    checks.push(`${name}_${expected ? "VALID_BEFORE" : "REJECTED_AFTER"}`);
  };
  if (proofs.registrationCode)
    check(
      "REGISTRATION",
      await rpc(
        origin,
        "registration.check",
        { code: proofs.registrationCode },
        "POST",
      ),
    );
  if (proofs.surveyToken)
    check(
      "SURVEY",
      await rpc(
        origin,
        "tutee.inspectSurvey",
        { token: proofs.surveyToken },
        "GET",
      ),
    );
  if (proofs.calendarToken) {
    const response = await fetch(
      `${origin}/api/session-calendar/${encodeURIComponent(proofs.calendarToken)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    const text = await response.text();
    operatorAssert(
      [200, 404].includes(response.status),
      "NEXT_ACCEPTANCE_CALENDAR_ROUTE_FAILED",
    );
    check(
      "CALENDAR",
      response.status === 200 && text.includes("BEGIN:VCALENDAR"),
    );
  }
  if (proofs.schoolReportToken) {
    const response = await fetch(
      `${origin}/reports/service-hours/${encodeURIComponent(proofs.schoolReportToken)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    const text = await response.text();
    operatorAssert(
      [200, 404, 410].includes(response.status),
      "NEXT_ACCEPTANCE_REPORT_ROUTE_FAILED",
    );
    check(
      "SCHOOL_REPORT",
      response.status === 200 &&
        text.includes("Download CSV") &&
        !text.includes("Report unavailable"),
    );
  }
  if (proofs.historyToken)
    check(
      "HISTORY",
      await rpc(
        origin,
        "tuteeHistory.inspectClaim",
        { token: proofs.historyToken },
        "GET",
        jar,
      ),
    );
  if (proofs.viewer)
    check(
      "VIEWER_OTP",
      await rpc(origin, "viewer.verify", proofs.viewer, "POST"),
    );
  if (proofs.crew)
    check(
      "CREW_OTP",
      await rpc(
        origin,
        "crew.verifyApplication",
        proofs.crew,
        "POST",
        undefined,
        (data) => data.status === "PENDING",
      ),
    );
  if (proofs.loginCode) {
    const result = await signin(origin, {
      intent: "login_2fa",
      ...proofs.loginCode,
    });
    check("LOGIN_OTP", result.userId === proofs.loginCode.userId);
  }
  if (proofs.resetToken)
    check(
      "PASSWORD_RESET",
      await resetThroughActualForm(origin, proofs.resetToken, db),
    );
  return checks;
}

/** The caller supplies a trusted build produced for this checkout. Child env is
 * allowlisted and SMTP is constrained to an owned loopback rejection sink. */
export async function runIsolatedNextClone(
  request: NextCloneRequest,
  maintenanceUrl: string,
  dependencies: SiteDependencies,
): Promise<NextCloneEvidence> {
  const endpoint = databaseIdentity(maintenanceUrl);
  operatorAssert(
    loopback(endpoint.host) &&
      /^shbs_[a-z0-9_]+_test$/.test(endpoint.database) &&
      /^shbs_recovery_[a-z0-9_]+_test$/.test(request.templateDatabase),
    "NEXT_ACCEPTANCE_REQUIRES_ISOLATED_TEST_DATABASE",
  );
  const runtime = await realpath(
    resolve(
      request.runtimeDirectory ??
        join(import.meta.dirname, "../../../.next/standalone"),
    ),
  ).catch(() => {
    throw new OperatorError("NEXT_ACCEPTANCE_RUNTIME_REQUIRED");
  });
  const entry = join(runtime, "server.js");
  operatorAssert(
    (await stat(entry)).isFile(),
    "NEXT_ACCEPTANCE_RUNTIME_REQUIRED",
  );
  operatorAssert(
    !(await readdir(runtime)).some((name) => /^\.env(?:\.|$)/.test(name)),
    "NEXT_ACCEPTANCE_RUNTIME_CONTAINS_ENV_FILE",
  );
  const runtimeBuildId = (
    await readFile(join(runtime, ".next/BUILD_ID"), "utf8")
  ).trim();
  operatorAssert(
    runtimeBuildId.length > 0 && runtimeBuildId.length <= 200,
    "NEXT_ACCEPTANCE_INVALID_BUILD_ID",
  );
  const serverSha256 = createHash("sha256")
    .update(await readFile(entry))
    .digest("hex");
  // The trusted build job records its checked-out SHA. The caller independently
  // supplies the expected revision, so a runtime cannot certify its own origin.
  const checkoutSha =
    request.expectedCheckoutSha ??
    process.env.RECOVERY_REHEARSAL_CHECKOUT_SHA ??
    process.env.GITHUB_SHA;
  operatorAssert(
    typeof checkoutSha === "string" && /^[a-f0-9]{40}$/.test(checkoutSha),
    "NEXT_ACCEPTANCE_CHECKOUT_REVISION_REQUIRED",
  );
  const build = z
    .object({
      version: z.literal(1),
      checkoutSha: z.string(),
      runtimeBuildId: z.string(),
      serverSha256: z.string(),
    })
    .strict()
    .parse(
      JSON.parse(
        await readFile(join(runtime, ".recovery-checkout.json"), "utf8"),
      ),
    );
  operatorAssert(
    build.checkoutSha === checkoutSha &&
      build.runtimeBuildId === runtimeBuildId &&
      build.serverSha256 === serverSha256,
    "NEXT_ACCEPTANCE_BUILD_REVISION_MISMATCH",
  );
  const suffix = randomBytes(8).toString("hex"),
    database = `shbs_recovery_next_${suffix}_test`,
    role = `shbs_recovery_next_${suffix}`,
    password = randomBytes(32).toString("hex");
  const admin = await dependencies.connect(maintenanceUrl);
  let clone: OperatorSql | undefined,
    child: ChildProcess | undefined,
    closed: Promise<void> | undefined;
  let createdRole = false,
    createdDatabase = false,
    locked = false;
  const sockets = new Set<Socket>();
  let transportConnections = 0;
  const sink = createNetServer((socket) => {
    sockets.add(socket);
    transportConnections++;
    socket.on("close", () => sockets.delete(socket));
    socket.end("421 Synthetic recovery transport; no external delivery\r\n");
  });
  let sinkListening = false;
  try {
    const lock = await admin.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [`shbs-recovery:${request.templateDatabase}`],
    );
    operatorAssert(lock.rows[0]?.locked === true, "RECOVERY_TARGET_BUSY");
    locked = true;
    await requireIdleRecoveryDatabase(admin, request.templateDatabase, "NEXT_CLONE_REQUIRES_SEALED_IDLE_TEMPLATE", { sealed: true });
    await admin.query(
      `CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    );
    createdRole = true;
    await admin.query(
      `CREATE DATABASE ${quote(database)} TEMPLATE ${quote(request.templateDatabase)} ALLOW_CONNECTIONS true CONNECTION LIMIT 20`,
    );
    createdDatabase = true;
    const adminClone = new URL(maintenanceUrl);
    adminClone.pathname = `/${database}`;
    clone = await dependencies.connect(adminClone.toString());
    await clone.query(
      `REVOKE CONNECT ON DATABASE ${quote(database)} FROM PUBLIC`,
    );
    await clone.query(
      `GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(role)}`,
    );
    await clone.query(`GRANT USAGE ON SCHEMA public TO ${quote(role)}`);
    await clone.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${quote(role)}`,
    );
    await clone.query(
      `GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quote(role)}`,
    );
    const before = await queueState(clone);
    await new Promise<void>((accept, reject) => {
      sink.once("error", reject);
      sink.listen(0, "127.0.0.1", accept);
    });
    sinkListening = true;
    const smtpAddress = sink.address();
    operatorAssert(
      smtpAddress && typeof smtpAddress !== "string",
      "NEXT_ACCEPTANCE_TRANSPORT_UNAVAILABLE",
    );
    const port = await availablePort(),
      origin = `http://127.0.0.1:${port}`;
    const appUrl = new URL(maintenanceUrl);
    appUrl.pathname = `/${database}`;
    appUrl.username = role;
    appUrl.password = password;
    child = spawn(process.execPath, [entry], {
      cwd: runtime,
      env: childEnv(
        appUrl.toString(),
        request.authSecret,
        origin,
        smtpAddress.port,
      ),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.resume();
    child.stderr?.resume();
    let exited = false;
    closed = new Promise<void>((accept) => {
      child!.once("error", () => {
        exited = true;
        accept();
      });
      child!.once("exit", () => {
        exited = true;
        accept();
      });
    });
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${origin}/api/auth/csrf`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.status === 200) {
          await response.arrayBuffer();
          ready = true;
          break;
        }
      } catch {
        /* Bounded startup polling. */
      }
      await delay(250);
    }
    operatorAssert(ready, "NEXT_ACCEPTANCE_SERVER_START_FAILED");
    const afterStartup =
      request.mode === "after-recovery" ? await queueState(clone) : undefined;
    const login = await signin(origin, {
      identifier: request.identifier,
      password: request.password,
    });
    operatorAssert(
      login.userId === request.userId,
      "NEXT_ORDINARY_CREDENTIALS_LOGIN_FAILED",
    );
    const checks = ["NEXT_ORDINARY_CREDENTIALS_LOGIN", "NEXT_AUTH_JS_SESSION"];
    const cookie = [...login.jar.values.keys()]
      .find((name) => /(?:^|-)authjs\.session-token(?:\.0)?$/.test(name))
      ?.replace(/\.0$/, "");
    operatorAssert(cookie, "NEXT_SESSION_COOKIE_MISSING");
    const current = (
      await clone.query(
        'SELECT "sessionVersion","historyAccessRevision" FROM public."User" WHERE id=$1',
        [request.userId],
      )
    ).rows[0];
    operatorAssert(
      current &&
        Number.isSafeInteger(current.sessionVersion) &&
        Number.isSafeInteger(current.historyAccessRevision),
      "NEXT_CURRENT_GENERATION_MISSING",
    );
    const payload = {
      sub: request.userId,
      sessionVersion: Number(current.sessionVersion),
      historyAccessRevision: Number(current.historyAccessRevision),
    };
    const tokenSession = async (
      secret: string,
      tokenPayload: typeof payload,
    ) => {
      const token = await encode({ secret, salt: cookie, token: tokenPayload });
      const response = await fetch(`${origin}/api/auth/session`, {
        headers: { Cookie: `${cookie}=${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return readNextApplicationSession(response);
    };
    const positive = await tokenSession(request.authSecret, payload);
    operatorAssert(
      positive?.user.id === request.userId &&
        positive.sessionVersion === payload.sessionVersion &&
        positive.historyAccessRevision === current.historyAccessRevision,
      "NEXT_SIGNED_CURRENT_TOKEN_CONTROL_FAILED",
    );
    operatorAssert(
      await rpc(origin, "tuteeHistory.myRecords", undefined, "GET", login.jar),
      "NEXT_PROTECTED_HISTORY_POSITIVE_CONTROL_FAILED",
    );
    checks.push(
      "NEXT_SIGNED_CURRENT_TOKEN_POSITIVE_CONTROL",
      "NEXT_PROTECTED_HISTORY_READ",
    );
    for (const rejected of request.rejectedPasswords ?? []) {
      operatorAssert(
        (
          await signin(origin, {
            identifier: request.identifier,
            password: rejected,
          })
        ).userId === null,
        "NEXT_OLD_PASSWORD_ACCEPTED",
      );
      checks.push("NEXT_OLD_PASSWORD_REJECTED");
    }
    if (request.mode === "after-recovery") {
      const keys = [
        {
          secret: request.previousAuthSecret,
          version: request.previousSessionVersion ?? 0,
          label: "CURRENT",
        },
        {
          secret: request.checkpointAuthSecret,
          version: request.checkpointSessionVersion ?? 0,
          label: "CHECKPOINT",
        },
      ];
      // Compare against the successful current payload above. A negative changes
      // exactly one input, preventing wrong-cookie/epoch errors from faking proof.
      for (const key of keys)
        if (key.secret) {
          operatorAssert(
            (await tokenSession(key.secret, payload)) === null,
            `NEXT_OLD_${key.label}_JWT_ACCEPTED`,
          );
          checks.push(`NEXT_OLD_${key.label}_JWT_REJECTED`);
        }
      operatorAssert(
        (await tokenSession(request.authSecret, {
          ...payload,
          sessionVersion: payload.sessionVersion - 1,
        })) === null,
        "NEXT_STALE_GENERATION_ACCEPTED",
      );
      checks.push("NEXT_STALE_GENERATION_REJECTED");
    } else {
      checks.push("NEXT_CHECKPOINT_JWT_VALID_BEFORE");
    }
    if (request.proofs)
      checks.push(
        ...(await checkCapabilities(
          origin,
          request.proofs,
          request.mode === "before-recovery",
          login.jar,
          clone,
        )),
      );
    // The history revision is server-owned. Exercise its protected-query and
    // cache-identity boundary through genuine sessions, rather than treating
    // /api/auth/session (which refreshes this field) as a stale-history denial.
    await clone.query(
      'UPDATE public."User" SET "historyAccessRevision"="historyAccessRevision"+1 WHERE id=$1',
      [request.userId],
    );
    operatorAssert(
      !(await rpc(
        origin,
        "tuteeHistory.myRecords",
        undefined,
        "GET",
        login.jar,
      )),
      "NEXT_OLD_HISTORY_SESSION_ACCEPTED",
    );
    const renewed = await signin(origin, {
      identifier: request.identifier,
      password: request.password,
    });
    operatorAssert(
      renewed.userId === request.userId &&
        Number(renewed.session?.historyAccessRevision) ===
          payload.historyAccessRevision + 1 &&
        sessionIdentity(renewed.session) !== sessionIdentity(login.session),
      "NEXT_HISTORY_SESSION_IDENTITY_DID_NOT_CHANGE",
    );
    operatorAssert(
      await rpc(
        origin,
        "tuteeHistory.myRecords",
        undefined,
        "GET",
        renewed.jar,
      ),
      "NEXT_RENEWED_HISTORY_READ_FAILED",
    );
    checks.push("NEXT_COMBINED_HISTORY_AND_SESSION_EPOCH_PROTECTED_READ");
    const afterProbes =
      request.mode === "after-recovery" ? await queueState(clone) : undefined;
    const controlId = `next-control-${suffix}`;
    if (request.mode === "after-recovery")
      await clone.query(
        `INSERT INTO public."EmailDelivery" (id,"userId",category,event,recipient) SELECT $1,id,'security','security_changed',email FROM public."User" WHERE id=$2`,
        [controlId, request.userId],
      );
    const observation =
      request.observeWorkersMs ??
      (request.mode === "after-recovery" ? 65000 : 3000);
    operatorAssert(
      Number.isSafeInteger(observation) &&
        observation >= 0 &&
        observation <= 90000,
      "INVALID_NEXT_WORKER_OBSERVATION",
    );
    await delay(observation);
    const after = await queueState(
      clone,
      request.mode === "after-recovery" ? controlId : undefined,
    );
    if (request.mode === "after-recovery") {
      if (planHash(before) !== planHash(after)) {
        // These are observation windows, not claims about which concurrent
        // worker or request caused a change. Keep the pre-launch baseline and
        // complete inventory assertion authoritative; never log row values/IDs.
        console.error(
          JSON.stringify({
            kind: "recovery-next-queue-difference",
            windows: [
              {
                phase: "SERVER_STARTUP",
                tables: nextQueueDifferences(before, afterStartup!),
              },
              {
                phase: "AUTHENTICATION_AND_CAPABILITY_PROBES",
                tables: nextQueueDifferences(afterStartup!, afterProbes!),
              },
              {
                phase: "WORKER_OBSERVATION",
                tables: nextQueueDifferences(afterProbes!, after),
              },
              { phase: "OVERALL", tables: nextQueueDifferences(before, after) },
            ],
          }),
        );
      }
      operatorAssert(
        planHash(before) === planHash(after),
        "NEXT_RESTORED_WORK_WAS_REPLAYED",
      );
      const control = (
        await clone.query(
          'SELECT attempts FROM public."EmailDelivery" WHERE id=$1',
          [controlId],
        )
      ).rows[0];
      operatorAssert(
        Number(control?.attempts) > 0 && transportConnections > 0,
        "NEXT_NOTIFICATION_WORKER_CONTROL_DID_NOT_RUN",
      );
      checks.push(
        "NEXT_NOTIFICATION_WORKER_NO_RESTORED_DELIVERY_REPLAY",
        "NEXT_RESTORED_QUEUE_INVENTORY_UNCHANGED",
      );
    } else {
      const control = (
        await clone.query(
          "SELECT attempts,status FROM public.\"EmailDelivery\" WHERE id='synthetic-worker-control'",
        )
      ).rows[0];
      operatorAssert(
        Number(control?.attempts) > 0 && transportConnections > 0,
        "NEXT_POSITIVE_WORKER_CONTROL_DID_NOT_RUN",
      );
      checks.push("NEXT_POSITIVE_DUE_WORKER_CONTROL");
    }
    return {
      scope: "DISPOSABLE_WRITABLE_NEXT_CLONE",
      checkoutSha,
      runtimeBuildId,
      serverSha256,
      checks,
      workerObservationMs: observation,
      syntheticTransportConnections: transportConnections,
      restoredQueueBeforeFingerprint: planHash(before),
      restoredQueueAfterFingerprint: planHash(after),
    };
  } finally {
    if (child && closed) {
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        closed.then(() => true),
        delay(10000).then(() => false),
      ]);
      if (!stopped) {
        child.kill("SIGKILL");
        await closed;
      }
    }
    for (const socket of sockets) socket.destroy();
    if (sinkListening)
      await new Promise<void>((accept) => sink.close(() => accept()));
    await clone?.close().catch(() => undefined);
    // Only the exact fresh generated clone/role can be removed by this helper.
    operatorAssert(
      /^shbs_recovery_next_[a-f0-9]{16}_test$/.test(database) &&
        /^shbs_recovery_next_[a-f0-9]{16}$/.test(role),
      "INVALID_OWNED_NEXT_FIXTURE",
    );
    try {
      if (createdDatabase)
        await admin.query(`DROP DATABASE ${quote(database)} WITH (FORCE)`);
      if (createdRole) await admin.query(`DROP ROLE ${quote(role)}`);
    } finally {
      if (locked)
        await admin
          .query("SELECT pg_advisory_unlock(hashtext($1))", [
            `shbs-recovery:${request.templateDatabase}`,
          ])
          .catch(() => undefined);
      await admin.close();
    }
  }
}
