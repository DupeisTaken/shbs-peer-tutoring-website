/** Opt-in journal/compensation rehearsal; the supplied database is never reset. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { z } from "zod";
import { PrismaClient, type Prisma } from "../generated/prisma";
import { RECOVERY_EVIDENCE } from "../src/lib/recovery-evidence";
import { hashPassword } from "../src/server/auth/password";
import { utcDatabaseUrl } from "../src/server/database-url";
import { assertIsolatedTestDatabase } from "../src/test/database-guard";

const adminUrl = process.env.SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL;

const cliPlanSchema = z.object({
  plan: z.object({
    kind: z.literal("admission-recovery"),
    actionId: z.string(),
    actorId: z.string(),
    fingerprint: z.string(),
    preview: z.object({
      coverage: z.enum(["COMPLETE", "UNKNOWN"]),
      dependentEventCount: z.number(),
      websiteEligible: z.boolean(),
      events: z.array(z.object({ id: z.string(), disposition: z.string() })),
    }),
  }),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const cliComparisonSchema = z.object({
  kind: z.literal("admission-checkpoint-comparison"),
  changed: z.boolean(),
});
const cliAppliedSchema = z.object({
  kind: z.literal("admission-recovery-receipt"),
  receipt: z.object({
    actionId: z.string(),
    receiptId: z.string(),
    replayed: z.boolean(),
  }),
});
type CliCommandWitness = {
  caseId: string;
  exitCode: number;
  outputKind?: string;
  errorCode?: "CONFLICT" | "FORBIDDEN";
};
type CliWitness = {
  version: 1;
  kind: "actual-admission-cli-lifecycle";
  status: "RUNNING" | "PASSED" | "FAILED";
  checkoutSha: string;
  sourceSha256: Record<string, string>;
  migrationCount: number;
  commands: CliCommandWitness[];
  checks?: Record<string, string | number | boolean>;
  failedCase?: string;
  cleanup: {
    childSettled: boolean;
    temporaryFilesRemoved: boolean;
    ownedDatabaseDropped: boolean;
  };
};

/** A single exact child handle owns cancellation, output bounds and settlement.
 * Never release database cleanup while this CLI could still use its connection. */
function cliRunner(cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal) {
  let active: { stop: () => void; settled: Promise<void> } | undefined;
  return {
    async run(
      argv: string[],
    ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
      assert.ok(!active && !signal.aborted, "CLI_CHILD_UNAVAILABLE");
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          "./scripts/scheduling-profile/register-server-runtime.mjs",
          "scripts/recovery.ts",
          ...argv,
        ],
        { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure: string | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (code: string) => {
        if (failure) return;
        failure = code;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      };
      const onAbort = () => stop("CLI_CHILD_CANCELLED");
      const deadline = setTimeout(() => stop("CLI_CHILD_TIMEOUT"), 30_000);
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > 256 * 1024) stop("CLI_STDOUT_LIMIT");
        else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 256 * 1024) stop("CLI_STDERR_LIMIT");
        else stderr.push(chunk);
      });
      child.once("error", () => stop("CLI_CHILD_START_FAILED"));
      const result = new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
      }>((fulfill, reject) => {
        child.once("close", (exitCode) => {
          clearTimeout(deadline);
          clearTimeout(killTimer);
          signal.removeEventListener("abort", onAbort);
          active = undefined;
          if (failure) reject(new Error(failure));
          else
            fulfill({
              exitCode,
              stdout: Buffer.concat(stdout).toString("utf8"),
              stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
      });
      active = {
        stop: onAbort,
        settled: result.then(
          () => undefined,
          () => undefined,
        ),
      };
      // The signal may have changed between the pre-spawn check and listener.
      if (signal.aborted) onAbort();
      return result;
    },
    async close() {
      const owned = active;
      if (owned) {
        owned.stop();
        await owned.settled;
      }
    },
  };
}

function object(value: Prisma.JsonValue) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value;
}

void test(
  "committed PostgreSQL journal transfer and actual recovery CLI lifecycle",
  {
    skip: !adminUrl,
    timeout: 180_000,
  },
  async (t) => {
    assert.ok(adminUrl);
    assertIsolatedTestDatabase(adminUrl);
    const name = `shbs_transfer_journal_${randomBytes(6).toString("hex")}_test`;
    const ownedUrl = new URL(adminUrl);
    ownedUrl.pathname = `/${name}`;
    assertIsolatedTestDatabase(ownedUrl.toString());
    const admin = new Client({
      connectionString: utcDatabaseUrl(adminUrl),
      connectionTimeoutMillis: 5000,
    });
    await admin.connect();
    let created = false;
    let client: PrismaClient | undefined;
    let migrationCount = 0;
    let runner: ReturnType<typeof cliRunner> | undefined;
    let cliTempDirectory: string | undefined;
    let cliWitness: CliWitness | undefined;
    let lifecycleSettled = Promise.resolve();
    const globalClient = globalThis as typeof globalThis & {
      prisma?: PrismaClient;
      prismaDatabaseUrl?: string;
    };
    const previousClient = globalClient.prisma;
    const previousClientUrl = globalClient.prismaDatabaseUrl;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    try {
      // Only the generated database is disposable. No migration or cleanup targets
      // the supplied maintenance database, and cleanup never terminates backends.
      assert.match(name, /^shbs_transfer_journal_[a-f0-9]{12}_test$/);
      await admin.query(
        `CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`,
      );
      created = true;
      const migrationClient = new Client({
        connectionString: utcDatabaseUrl(ownedUrl.toString()),
        connectionTimeoutMillis: 5000,
      });
      await migrationClient.connect();
      try {
        const root = resolve(import.meta.dirname, "../prisma/migrations");
        const migrations = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        migrationCount = migrations.length;
        for (const migration of migrations)
          await migrationClient.query(
            await readFile(join(root, migration, "migration.sql"), "utf8"),
          );
      } finally {
        await migrationClient.end();
      }
      client = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: utcDatabaseUrl(ownedUrl.toString()),
          max: 2,
        }),
      });
      const database = client;
      // Legacy helpers importing the shared client also stay inside this owned DB.
      // Import runtime modules only after binding it; no module or journal is mocked.
      globalClient.prisma = database;
      globalClient.prismaDatabaseUrl = ownedUrl.toString();
      process.env.DATABASE_URL = ownedUrl.toString();
      const { currentPolicy } = await import("../src/server/policy-acceptance");
      const { approveQualification } =
        await import("../src/server/qualifications");
      const {
        previewPersonParticipationTransfer,
        transferPersonParticipation,
      } = await import("../src/server/person-participation");
      const {
        captureRecoveryCheckpoint,
        inspectRecoveryCheckpoint,
        applyRecoveryCheckpoint,
        applyRecoveryCheckpointFromOperator,
      } = await import("../src/server/recovery/checkpoint");
      const password = "Synthetic-fixed-room-journal-460!";
      const passwordHash = hashPassword(password);

      async function seed(quarter: "Q1" | "Q2") {
        const prefix = `room-journal-${randomUUID()}`;
        return database.$transaction(
          async (tx) => {
            await tx.term.updateMany({
              where: { active: true },
              data: { active: false },
            });
            const term = await tx.term.create({
              data: {
                name: prefix,
                schoolYear: "26-27",
                quarter,
                active: true,
              },
            });
            const person = await tx.person.create({ data: {} });
            const actor = await tx.user.create({
              data: {
                email: `${prefix}-admin@example.test`,
                role: "ADMIN",
                passwordHash,
              },
            });
            const tutors = await Promise.all(
              ["source", "target"].map((suffix) =>
                tx.tutor.create({
                  data: {
                    personId: person.id,
                    englishName: `${prefix}-${suffix}`,
                    status: "ACTIVE",
                  },
                }),
              ),
            );
            const [source, target] = tutors;
            assert.ok(source && target);
            const accounts = [];
            for (const tutor of tutors)
              accounts.push(
                await tx.user.create({
                  data: {
                    personId: person.id,
                    email: `${tutor.id}@example.test`,
                    role: "TUTOR",
                    tutorId: tutor.id,
                    emailVerifiedAt: new Date(),
                    passwordHash,
                    academicProfile: {
                      create: {
                        status: "NOT_APPLICABLE",
                        reconfirmRequired: false,
                      },
                    },
                  },
                }),
              );
            const learner = await tx.tutee.create({
              data: {
                englishName: `${prefix}-learner`,
                status: "ACTIVE",
                intakeTermId: term.id,
                signedRulebook: true,
                signedAt: new Date(),
                signatureName: "Synthetic explicit agreement",
              },
            });
            const owner = await tx.user.create({
              data: {
                email: `${learner.id}@example.test`,
                role: "STUDENT",
                studentId: learner.id,
                tuteeMember: true,
                emailVerifiedAt: new Date(),
                academicProfile: {
                  create: {
                    status: "NOT_APPLICABLE",
                    reconfirmRequired: false,
                  },
                },
              },
            });
            for (const [slug, owners] of [
              ["tutor-policy", accounts],
              ["tutee-policy", [owner]],
            ] as const) {
              await tx.policyDocument.upsert({
                where: { slug_locale: { slug, locale: "en" } },
                create: {
                  slug,
                  locale: "en",
                  title: "Synthetic policy",
                  body: "Synthetic journal participation agreement",
                },
                update: {},
              });
              const policy = await currentPolicy(tx, slug);
              for (const user of owners)
                await tx.policyAcceptance.create({
                  data: {
                    userId: user.id,
                    slug,
                    revision: policy.revision,
                    snapshot: policy.documents,
                    signature: "Synthetic explicit agreement",
                  },
                });
            }
            const subject = await tx.subject.create({
              data: { name: `${prefix}-mathematics` },
            });
            await approveQualification(tx, source.id, subject.id, actor.id);
            const room = await tx.room.create({
              data: { name: `${prefix}-fixed-room` },
            });
            const pairing = await tx.pairing.create({
              data: {
                tutorId: source.id,
                termId: term.id,
                subject: subject.name,
                dayOfWeek: 2,
                startMin: 600,
                endMin: 645,
                scheduleConfirmed: true,
                roomMode: "FIXED",
                roomId: room.id,
                tutees: { create: { tuteeId: learner.id } },
              },
            });
            const retained = accounts.find(
              (user) => user.tutorId === target.id,
            )!;
            const selection = {
              personId: person.id,
              retainedUserId: retained.id,
              activeTutorId: target.id,
              activeTuteeId: null,
              tutorIds: [source.id, target.id],
              tuteeIds: [],
              acknowledgeHistoryAccessCorrection: true,
            };
            return {
              actor,
              source,
              target,
              accounts,
              learner,
              term,
              room,
              pairing,
              selection,
            };
          },
          { timeout: 30_000 },
        );
      }
      async function checkpoints(f: Awaited<ReturnType<typeof seed>>) {
        // Each API call owns and commits its transaction before the transfer.
        const roots = [];
        for (const tutor of [f.source, f.target]) {
          const checkpoint = await captureRecoveryCheckpoint(
            database,
            { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id },
            f.actor,
          );
          const preview = await inspectRecoveryCheckpoint(database, checkpoint);
          assert.equal(
            preview.coverage,
            "COMPLETE",
            preview.blockers.join(" "),
          );
          assert.equal(preview.websiteEligible, true);
          roots.push(checkpoint);
        }
        return roots;
      }
      async function intent(f: Awaited<ReturnType<typeof seed>>) {
        const preview = await previewPersonParticipationTransfer(
          database,
          f.selection,
        );
        assert.equal(
          preview.canTransfer,
          true,
          JSON.stringify(preview.blockers),
        );
        return {
          ...f.selection,
          fingerprint: preview.fingerprint,
          operationId: randomUUID(),
          reason:
            "Reviewed exact fixed-room transfer and immutable recovery descendants",
          acknowledged: true as const,
          confirmPassword: password,
        };
      }
      async function state(
        f: Awaited<ReturnType<typeof seed>>,
        actionIds: string[],
        operationId: string,
      ) {
        return database.$transaction(async (tx) => ({
          pairings: await tx.pairing.findMany({
            where: { termId: f.term.id },
            orderBy: { id: "asc" },
          }),
          edges: await tx.pairingExecutionSuccessor.findMany({
            where: { receiptId: operationId },
            orderBy: { sourcePairingId: "asc" },
          }),
          transfer: await tx.personParticipationTransferReceipt.findUnique({
            where: { id: operationId },
          }),
          users: await tx.user.findMany({
            where: { id: { in: f.accounts.map((user) => user.id) } },
            select: { id: true, tutorId: true },
            orderBy: { id: "asc" },
          }),
          changes: await tx.recoveryChange.findMany({
            where: { actionId: { in: actionIds } },
            orderBy: { id: "asc" },
          }),
          events: await tx.recoveryEvent.findMany({
            where: { actionId: { in: actionIds } },
            orderBy: { id: "asc" },
          }),
          fences: await tx.recoveryFence.findMany({
            where: { actionId: { in: actionIds } },
            orderBy: { actionId: "asc" },
          }),
          receipts: await tx.recoveryReceipt.findMany({
            where: { actionId: { in: actionIds } },
            orderBy: { id: "asc" },
          }),
        }));
      }

      await t.test(
        "separate committed capture and transfer preserve per-root grouping while both channels fail closed",
        async () => {
          const f = await seed("Q1");
          const roots = await checkpoints(f);
          const input = await intent(f);
          const result = await transferPersonParticipation(
            database,
            f.actor.id,
            input,
          );
          assert.equal(result.successorPairingIds.length, 1);
          const successorId = result.successorPairingIds[0]!;
          const snapshot = await state(
            f,
            roots.map((root) => root.actionId),
            input.operationId,
          );
          assert.deepEqual(
            snapshot.pairings.find((row) => row.id === f.pairing.id),
            f.pairing,
          );
          assert.equal(
            snapshot.pairings.find((row) => row.id === successorId)?.roomId,
            f.room.id,
          );
          const transactionIds = new Set<string>();
          for (const [index, root] of roots.entries()) {
            const checkpoint =
              await database.recoveryCheckpoint.findUniqueOrThrow({
                where: { id: root.checkpointId },
              });
            const events = snapshot.events.filter(
              (event) =>
                event.actionId === root.actionId &&
                event.transactionId !== checkpoint.captureTransactionId,
            );
            assert.equal(
              events.length,
              1,
              "One transfer transaction is one later event per root, regardless of row count.",
            );
            const event = events[0]!;
            transactionIds.add(event.transactionId);
            const changes = snapshot.changes.filter(
              (row) => row.actionId === root.actionId,
            );
            assert.ok(changes.length > 1);
            assert.ok(changes.every((row) => row.eventId === event.id));
            assert.equal(
              snapshot.fences.find((row) => row.actionId === root.actionId)
                ?.revision,
              changes.length,
            );
            const edge = changes.find(
              (row) =>
                row.entity === "PairingExecutionSuccessor" &&
                object(row.recordKey).sourcePairingId === f.pairing.id,
            );
            assert.ok(
              edge,
              "Both the original and executing tutor roots must see the exact transfer edge.",
            );
            if (index === 1) {
              // The target root already tracks Tutor B. The source-only root need
              // not see the provisional insertion before the edge connects its work.
              const pairingChanges = changes.filter(
                (row) =>
                  row.entity === "Pairing" &&
                  object(row.recordKey).id === successorId,
              );
              const inserted = pairingChanges.find(
                (row) => row.operation === "INSERT",
              );
              const reserved = pairingChanges.find(
                (row) =>
                  row.operation === "UPDATE" &&
                  object(row.before).scheduleConfirmed === false &&
                  object(row.after).scheduleConfirmed === true,
              );
              assert.ok(inserted && reserved);
              assert.equal(object(inserted.after).roomId, null);
              assert.equal(object(inserted.after).roomMode, "NONE");
              assert.equal(object(inserted.after).scheduleConfirmed, false);
              assert.equal(object(inserted.after).groupId, null);
              assert.equal(object(reserved.after).roomId, f.room.id);
              assert.equal(object(reserved.after).roomMode, "FIXED");
              assert.ok(inserted.id < edge.id && edge.id < reserved.id);
            }
            const preview = await inspectRecoveryCheckpoint(database, root);
            assert.equal(preview.dependentEventCount, 1);
            assert.equal(preview.coverage, "UNKNOWN");
            assert.equal(preview.websiteEligible, false);
            assert.ok(
              preview.blockers.includes(
                "Unsupported participant descendant changes require a separate correction.",
              ),
            );
            assert.deepEqual(
              await state(
                f,
                roots.map((item) => item.actionId),
                input.operationId,
              ),
              snapshot,
              "Preview must be read-only.",
            );
            for (const apply of [
              applyRecoveryCheckpoint,
              applyRecoveryCheckpointFromOperator,
            ]) {
              await assert.rejects(
                () =>
                  apply(
                    database,
                    {
                      checkpointId: root.checkpointId,
                      expectedFingerprint: preview.fingerprint,
                      clientKey: randomUUID(),
                      reason:
                        "Synthetic unsupported transfer must remain blocked",
                    },
                    f.actor,
                  ),
                (error: unknown) =>
                  error instanceof Error &&
                  "code" in error &&
                  error.code === "PRECONDITION_FAILED",
              );
              assert.deepEqual(
                await state(
                  f,
                  roots.map((item) => item.actionId),
                  input.operationId,
                ),
                snapshot,
                "Neither website nor operator refusal may compensate bookings or commit a fence/receipt.",
              );
            }
          }
          assert.equal(
            transactionIds.size,
            1,
            "Both roots identify the same committed transfer transaction.",
          );
        },
      );

      await t.test(
        "failed roster validation rolls provisional bookings and their journal/fence changes back atomically",
        async () => {
          const f = await seed("Q2");
          const roots = await checkpoints(f);
          // This existing roster guard rejects only after successor preparation.
          // Its original closed request is evidence, not consent to assign again.
          await database.studentSurvey.create({
            data: {
              tuteeId: f.learner.id,
              state: "ABORTED",
              email: `${f.learner.id}@example.test`,
              intakeTermId: f.term.id,
              payload: {},
              policyRevision: "original",
              policySnapshot: {},
              tokenHash: randomUUID(),
              expiresAt: new Date("2099-01-01T00:00:00Z"),
              confirmedAt: new Date(),
            },
          });
          const input = await intent(f);
          const before = await state(
            f,
            roots.map((root) => root.actionId),
            input.operationId,
          );
          await assert.rejects(
            () => transferPersonParticipation(database, f.actor.id, input),
            /closed or expired student request/i,
          );
          assert.deepEqual(
            await state(
              f,
              roots.map((root) => root.actionId),
              input.operationId,
            ),
            before,
            "An aborted transfer must leave no provisional target, edge, event, journal row, fence increment or receipt.",
          );
        },
      );
      await t.test(
        "actual admission CLI refuses stale or demoted intent and durably retries one longer-chain restore",
        { timeout: 120_000 },
        async (cliTest) => {
          let settleLifecycle!: () => void;
          lifecycleSettled = new Promise<void>((fulfill) => {
            settleLifecycle = fulfill;
          });
          let caseId = "SETUP";
          try {
            const cwd = await realpath(resolve(import.meta.dirname, ".."));
            assert.ok(
              (await realpath(process.cwd())) === cwd,
              "CLI_CHECKOUT_MISMATCH",
            );
            const sourcePaths = [
              "scripts/recovery-transfer-journal-postgres.test.ts",
              "scripts/recovery.ts",
              "scripts/scheduling-profile/register-server-runtime.mjs",
              "scripts/scheduling-profile/server-runtime-hooks.mjs",
              "src/server/recovery/operator-cli.ts",
              "src/server/recovery/admission.ts",
              "src/server/recovery/capture.ts",
              "src/server/recovery/receipt.ts",
              "src/lib/recovery-evidence.ts",
              "src/server/tutors/application-status.ts",
              "src/server/tutors/promote.ts",
              ".github/workflows/recovery-rehearsal.yml",
            ];
            cliTempDirectory = await mkdtemp(
              join(await realpath(tmpdir()), "shbs-recovery-cli-"),
            );
            const dotenvPath = join(cliTempDirectory, "empty.env");
            await writeFile(dotenvPath, "", { mode: 0o600, flag: "wx" });
            const env: NodeJS.ProcessEnv = {
              PATH: process.env.PATH,
              ...(process.platform === "win32"
                ? { SystemRoot: process.env.SystemRoot }
                : {}),
              NODE_ENV: "test",
              DATABASE_URL: ownedUrl.toString(),
              AUTH_SECRET: "synthetic-recovery-cli-witness-only-714-minimum-32",
              DOTENV_CONFIG_PATH: dotenvPath,
              DOTENV_CONFIG_QUIET: "true",
              TZ: "UTC",
            };
            const revision = spawnSync("git", ["rev-parse", "HEAD"], {
              cwd,
              env,
              shell: false,
              encoding: "utf8",
              timeout: 5_000,
              maxBuffer: 1024,
            });
            const checkoutSha = revision.stdout?.trim();
            assert.ok(
              revision.status === 0 && /^[a-f0-9]{40}$/.test(checkoutSha),
              "CLI_CHECKOUT_IDENTITY_FAILED",
            );
            assert.ok(
              !process.env.GITHUB_SHA || process.env.GITHUB_SHA === checkoutSha,
              "CLI_HOSTED_CHECKOUT_MISMATCH",
            );
            const sourceSha256: Record<string, string> = {};
            for (const path of sourcePaths)
              sourceSha256[path] = createHash("sha256")
                .update(await readFile(join(cwd, path)))
                .digest("hex");
            cliWitness = {
              version: 1,
              kind: "actual-admission-cli-lifecycle",
              status: "RUNNING",
              checkoutSha,
              sourceSha256,
              migrationCount,
              commands: [],
              cleanup: {
                childSettled: false,
                temporaryFilesRemoved: false,
                ownedDatabaseDropped: false,
              },
            };
            const witness = cliWitness;
            runner = cliRunner(
              cwd,
              env,
              AbortSignal.any([t.signal, cliTest.signal]),
            );
            const commands = runner;
            const {
              beginAdmissionRecoveryCapture,
              finishAdmissionRecoveryCapture,
            } = await import("../src/server/recovery/capture");
            const { reconcileApplication } =
              await import("../src/server/tutors/application-status");
            const { applyAdmissionRecovery } =
              await import("../src/server/recovery/admission");

            // Both transfer fixtures own Admin actors. Refuse an unexpected Head
            // rather than borrowing/demoting authority owned by another scenario.
            assert.ok(
              (await database.user.count({ where: { role: "HEAD" } })) === 0,
              "CLI_UNEXPECTED_FIXTURE_HEAD",
            );
            const prefix = `cli-admission-${randomUUID()}`;
            const privateBeforeSentinel =
              "SYNTHETIC_PRIVATE_RECOVERY_BEFORE_714";
            const actor = await database.user.create({
              data: { email: `${prefix}-head@example.test`, role: "HEAD" },
            });
            const originalApplication = await database.tutorApplication.create({
              data: {
                name: "Synthetic Candidate",
                firstName: "Synthetic",
                lastName: "Candidate",
                email: `${prefix}@example.test`,
                status: "INTERVIEW",
                decisionComment: privateBeforeSentinel,
                interviewCompletedAt: new Date("2026-09-18T03:00:00Z"),
                interviewDurationMin: 45,
              },
            });
            // Commit the real capture/reconciliation before any child connects.
            // No outer transaction, test reset hook or fabricated journal row is used.
            const actionId = await database.$transaction(
              async (tx) => {
                const action = await beginAdmissionRecoveryCapture(
                  tx,
                  originalApplication.id,
                );
                assert.ok(action, "CLI_ADMISSION_CAPTURE_MISSING");
                await tx.tutorApplication.update({
                  where: { id: originalApplication.id },
                  data: {
                    status: "ACCEPTED",
                    decidedAt: new Date(),
                    decisionComment: "Synthetic reviewed admission",
                  },
                });
                await reconcileApplication(tx, originalApplication.id);
                await finishAdmissionRecoveryCapture(tx, action);
                return action;
              },
              { timeout: 30_000 },
            );
            const admittedApplication =
              await database.tutorApplication.findUniqueOrThrow({
                where: { id: originalApplication.id },
              });
            const promotedTutorId = admittedApplication.promotedTutorId;
            assert.ok(promotedTutorId, "CLI_ADMITTED_TUTOR_MISSING");
            const tutorId = promotedTutorId;
            const admittedTutor = await database.tutor.findUniqueOrThrow({
              where: { id: tutorId },
            });
            assert.ok(admittedTutor.personId, "CLI_ADMITTED_PERSON_MISSING");
            assert.ok(
              (await database.user.count({ where: { tutorId } })) === 0,
              "CLI_ADMISSION_MUST_REMAIN_ACCOUNTLESS",
            );
            const reason = "Synthetic reviewed CLI admission correction";
            const clientKey = randomUUID();
            let receiptJson = "";
            const plan0Path = join(cliTempDirectory, "checkpoint.json");
            const plan1Path = join(cliTempDirectory, "reviewed.json");
            const same = (actual: unknown, expected: unknown) => {
              assert.ok(
                isDeepStrictEqual(actual, expected),
                "CLI_DATABASE_STATE_CHANGED",
              );
            };
            async function unrelated() {
              return database.$transaction(async (tx) => ({
                users: await tx.user.findMany({
                  where: { id: { not: actor.id } },
                  orderBy: { id: "asc" },
                }),
                tutors: await tx.tutor.findMany({
                  where: { id: { not: tutorId } },
                  orderBy: { id: "asc" },
                }),
                people: await tx.person.findMany({
                  where: { id: { not: admittedTutor.personId! } },
                  orderBy: { id: "asc" },
                }),
                applications: await tx.tutorApplication.findMany({
                  where: { id: { not: originalApplication.id } },
                  orderBy: { id: "asc" },
                }),
                codes: await tx.registrationCode.findMany({
                  where: {
                    OR: [
                      { applicationId: null },
                      { applicationId: { not: originalApplication.id } },
                    ],
                  },
                  orderBy: { id: "asc" },
                }),
                terms: await tx.term.findMany({ orderBy: { id: "asc" } }),
                learners: await tx.tutee.findMany({ orderBy: { id: "asc" } }),
                pairings: await tx.pairing.findMany({ orderBy: { id: "asc" } }),
                pairingLearners: await tx.pairingTutee.findMany({
                  orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
                }),
                edges: await tx.pairingExecutionSuccessor.findMany({
                  orderBy: { sourcePairingId: "asc" },
                }),
                transfers: await tx.personParticipationTransferReceipt.findMany(
                  { orderBy: { id: "asc" } },
                ),
                actions: await tx.recoveryAction.findMany({
                  where: { id: { not: actionId } },
                  orderBy: { id: "asc" },
                }),
                events: await tx.recoveryEvent.findMany({
                  where: { actionId: { not: actionId } },
                  orderBy: { id: "asc" },
                }),
                changes: await tx.recoveryChange.findMany({
                  where: { actionId: { not: actionId } },
                  orderBy: { id: "asc" },
                }),
                fences: await tx.recoveryFence.findMany({
                  where: { actionId: { not: actionId } },
                  orderBy: { actionId: "asc" },
                }),
                receipts: await tx.recoveryReceipt.findMany({
                  where: { actionId: { not: actionId } },
                  orderBy: { id: "asc" },
                }),
              }));
            }
            async function state() {
              return database.$transaction(async (tx) => ({
                application: await tx.tutorApplication.findUniqueOrThrow({
                  where: { id: originalApplication.id },
                }),
                tutor: await tx.tutor.findUniqueOrThrow({
                  where: { id: tutorId },
                }),
                codes: await tx.registrationCode.findMany({
                  where: { applicationId: originalApplication.id },
                  orderBy: { id: "asc" },
                }),
                action: await tx.recoveryAction.findUniqueOrThrow({
                  where: { id: actionId },
                }),
                events: await tx.recoveryEvent.findMany({
                  where: { actionId },
                  orderBy: { id: "asc" },
                }),
                changes: await tx.recoveryChange.findMany({
                  where: { actionId },
                  orderBy: { id: "asc" },
                }),
                tracked: await tx.recoveryTrackedEntity.findMany({
                  where: { actionId },
                  orderBy: [{ entity: "asc" }, { recordId: "asc" }],
                }),
                fence: await tx.recoveryFence.findUnique({
                  where: { actionId },
                }),
                receipts: await tx.recoveryReceipt.findMany({
                  where: { actionId },
                  orderBy: { id: "asc" },
                }),
                reversals: await tx.auditLog.findMany({
                  where: {
                    entityId: originalApplication.id,
                    operation: "recovery.voidAdmission",
                    kind: "REVERSAL",
                  },
                  orderBy: { id: "asc" },
                }),
              }));
            }
            const unrelatedBefore = await unrelated();
            async function invoke(
              id: string,
              argv: string[],
              errorCode?: "CONFLICT" | "FORBIDDEN",
            ) {
              caseId = id;
              const result = await commands.run(argv);
              assert.ok(
                result.exitCode === (errorCode ? 1 : 0),
                "CLI_EXIT_MISMATCH",
              );
              if (errorCode) {
                const failure = z
                  .object({ error: z.literal(errorCode) })
                  .strict()
                  .parse(JSON.parse(result.stderr));
                assert.ok(
                  result.stdout.trim() === "",
                  "CLI_FAILURE_STDOUT_UNEXPECTED",
                );
                witness.commands.push({
                  caseId: id,
                  exitCode: 1,
                  errorCode: failure.error,
                });
                return {};
              }
              assert.ok(
                result.stderr.trim() === "",
                "CLI_SUCCESS_STDERR_UNEXPECTED",
              );
              if (id === "C10_RECEIPT") receiptJson = result.stdout;
              const output: unknown = JSON.parse(result.stdout);
              const outputKind = z.enum([
                "admission-recovery",
                "admission-checkpoint-comparison",
                "admission-recovery-receipt",
                "admission.receipt",
              ]);
              const kind = z
                .object({
                  kind: outputKind.optional(),
                  plan: z.object({ kind: outputKind }).optional(),
                })
                .parse(output);
              witness.commands.push({
                caseId: id,
                exitCode: 0,
                outputKind: kind.kind ?? kind.plan?.kind,
              });
              return output;
            }
            async function readOnly(id: string, argv: string[]) {
              const before = await state();
              const principalBefore = await database.user.findUniqueOrThrow({
                where: { id: actor.id },
              });
              const output = await invoke(id, argv);
              same(await state(), before);
              same(
                await database.user.findUniqueOrThrow({
                  where: { id: actor.id },
                }),
                principalBefore,
              );
              return output;
            }
            const inspectArgs = (verb: string, path: string) => [
              "admission",
              verb,
              "--action-id",
              actionId,
              "--actor-id",
              actor.id,
              "--out",
              path,
            ];
            const compareArgs = (path: string, hash: string) => [
              "admission",
              "compare",
              "--plan",
              path,
              "--plan-hash",
              hash,
              "--actor-id",
              actor.id,
            ];
            const restoreArgs = (
              path: string,
              hash: string,
              intentReason = reason,
            ) => [
              "admission",
              "restore",
              "--plan",
              path,
              "--plan-hash",
              hash,
              "--actor-id",
              actor.id,
              "--reason",
              intentReason,
              "--client-key",
              clientKey,
            ];

            const plan0 = cliPlanSchema.parse(
              await readOnly(
                "C01_CHECKPOINT",
                inspectArgs("checkpoint", plan0Path),
              ),
            );
            assert.ok(
              plan0.plan.actionId === actionId &&
                plan0.plan.actorId === actor.id,
              "CLI_PLAN_BINDING_MISMATCH",
            );
            assert.ok(
              plan0.plan.preview.dependentEventCount === 0 &&
                plan0.plan.preview.coverage === "COMPLETE",
              "CLI_INITIAL_PLAN_INVALID",
            );
            caseId = "COMMITTED_NAME_EDITS";
            const name1 = "RevisedSynthetic";
            const name2 = "PreservedCandidate";
            // The installed display-name trigger derives englishName from these
            // explicit parts; editing its derived label alone can be a no-op.
            await database.tutor.update({
              where: { id: tutorId },
              data: { firstName: name1 },
            });
            await database.tutor.update({
              where: { id: tutorId },
              data: { lastName: name2 },
            });
            const chain = await state();
            assert.ok(
              chain.tutor.firstName === name1 && chain.tutor.lastName === name2,
              "CLI_NAME_EDITS_NOT_COMMITTED",
            );
            const rootEvents = chain.events.filter(
              (event) => event.kind === "ADMISSION",
            );
            const laterEvents = chain.events.filter(
              (event) => event.kind !== "ADMISSION",
            );
            assert.ok(
              rootEvents.length === 1 && laterEvents.length === 2,
              "CLI_EVENT_COUNT_INVALID",
            );
            assert.ok(
              new Set(chain.events.map((event) => event.transactionId)).size ===
                3,
              "CLI_EVENTS_NOT_SEPARATELY_COMMITTED",
            );
            assert.ok(
              laterEvents.every((event) =>
                chain.changes.some(
                  (change) =>
                    change.eventId === event.id &&
                    change.entity === "Tutor" &&
                    object(change.recordKey).id === tutorId,
                ),
              ),
              "CLI_REAL_TUTOR_JOURNAL_MISSING",
            );
            const changed = cliComparisonSchema.parse(
              await readOnly(
                "C02_COMPARE_STALE",
                compareArgs(plan0Path, plan0.planHash),
              ),
            );
            assert.ok(changed.changed, "CLI_STALE_COMPARISON_MISSING");
            await invoke(
              "C03_STALE_RESTORE",
              restoreArgs(plan0Path, plan0.planHash),
              "CONFLICT",
            );
            same(await state(), chain);
            const plan1 = cliPlanSchema.parse(
              await readOnly("C04_INSPECT", inspectArgs("inspect", plan1Path)),
            );
            assert.ok(
              plan1.plan.preview.coverage === "COMPLETE" &&
                plan1.plan.preview.dependentEventCount === 2 &&
                !plan1.plan.preview.websiteEligible,
              "CLI_LONGER_PLAN_INVALID",
            );
            assert.ok(
              laterEvents.every((event) =>
                plan1.plan.preview.events.some(
                  (item) =>
                    item.id === event.id && item.disposition === "PRESERVED",
                ),
              ),
              "CLI_PRESERVATION_PLAN_MISSING",
            );
            const current = cliComparisonSchema.parse(
              await readOnly(
                "C05_COMPARE_CURRENT",
                compareArgs(plan1Path, plan1.planHash),
              ),
            );
            assert.ok(!current.changed, "CLI_CURRENT_COMPARISON_CHANGED");
            caseId = "WEBSITE_CONTROL";
            await assert.rejects(
              () =>
                applyAdmissionRecovery(
                  database,
                  {
                    actionId,
                    expectedFingerprint: plan1.plan.fingerprint,
                    reason,
                    clientKey,
                  },
                  actor,
                ),
              (error: unknown) =>
                error instanceof Error &&
                "code" in error &&
                error.code === "PRECONDITION_FAILED",
            );
            same(await state(), chain);

            await database.user.update({
              where: { id: actor.id },
              data: { role: "VIEWER" },
            });
            await invoke(
              "C06_DEMOTED_RESTORE",
              restoreArgs(plan1Path, plan1.planHash),
              "FORBIDDEN",
            );
            same(await state(), chain);
            await database.user.update({
              where: { id: actor.id },
              data: { role: "HEAD" },
            });
            const restoredAuthority = cliComparisonSchema.parse(
              await readOnly(
                "C07_COMPARE_RESTORED_HEAD",
                compareArgs(plan1Path, plan1.planHash),
              ),
            );
            assert.ok(
              !restoredAuthority.changed,
              "CLI_AUTHORITY_CONTROL_CHANGED_SOURCE",
            );
            const applied = cliAppliedSchema.parse(
              await invoke(
                "C08_RESTORE",
                restoreArgs(plan1Path, plan1.planHash),
              ),
            );
            assert.ok(
              !applied.receipt.replayed &&
                applied.receipt.actionId === actionId,
              "CLI_FIRST_RESTORE_INVALID",
            );
            const restored = await state();
            assert.ok(
              restored.application.status === originalApplication.status &&
                restored.application.promotedTutorId ===
                  originalApplication.promotedTutorId &&
                restored.application.decisionComment ===
                  originalApplication.decisionComment &&
                restored.application.decidedAt === null,
              "CLI_APPLICATION_NOT_RESTORED",
            );
            same(
              restored.application.interviewCompletedAt,
              originalApplication.interviewCompletedAt,
            );
            assert.ok(
              restored.application.interviewDurationMin ===
                originalApplication.interviewDurationMin,
              "CLI_INTERVIEW_FACT_CHANGED",
            );
            assert.ok(
              restored.tutor.status === "ARCHIVED" &&
                restored.tutor.firstName === name1 &&
                restored.tutor.lastName === name2 &&
                restored.tutor.englishName === chain.tutor.englishName,
              "CLI_TUTOR_COMPENSATION_INVALID",
            );
            assert.ok(
              chain.codes.length === 1 &&
                restored.codes.length === 1 &&
                restored.codes[0]!.id === chain.codes[0]!.id &&
                restored.codes[0]!.usedAt === null &&
                restored.codes[0]!.expiresAt.getTime() === 0,
              "CLI_EXACT_UNUSED_GRANT_NOT_REVOKED",
            );
            assert.ok(
              restored.receipts.length === 1 &&
                restored.receipts[0]!.id === applied.receipt.receiptId &&
                restored.receipts[0]!.channel === "OPERATOR" &&
                restored.reversals.length === 1,
              "CLI_DURABLE_RECEIPT_OR_AUDIT_INVALID",
            );

            const replayed = cliAppliedSchema.parse(
              await invoke(
                "C09_EXACT_RETRY",
                restoreArgs(plan1Path, plan1.planHash),
              ),
            );
            assert.ok(
              replayed.receipt.replayed &&
                replayed.receipt.receiptId === applied.receipt.receiptId &&
                replayed.receipt.actionId === actionId,
              "CLI_DURABLE_RETRY_IDENTITY_CHANGED",
            );
            const retried = await state();
            // Exact retry deliberately acquires the fence, but must not compensate
            // domain state again or mint another immutable receipt/reversal audit.
            const { fence: restoredFence, ...restoredDomain } = restored;
            const { fence: retriedFence, ...retriedDomain } = retried;
            same(retriedDomain, restoredDomain);
            assert.ok(restoredFence, "CLI_RESTORED_FENCE_MISSING");
            assert.ok(
              retriedFence?.revision === restoredFence.revision + 1,
              "CLI_RETRY_FENCE_DELTA_INVALID",
            );
            const receiptOutput = await readOnly("C10_RECEIPT", [
              "admission",
              "receipt",
              "--receipt-id",
              applied.receipt.receiptId,
              "--actor-id",
              actor.id,
            ]);
            const receiptEnvelope = z
              .object({
                version: z.literal(1),
                kind: z.literal("admission.receipt"),
                // Close every nested object as well as the envelope. A future
                // raw-evidence field must fail this real CLI privacy boundary.
                receipt: z
                  .object({
                    version: z.literal(1),
                    id: z.literal(applied.receipt.receiptId),
                    actionId: z.literal(actionId),
                    actorId: z.literal(actor.id),
                    reason: z.literal(reason),
                    channel: z.literal("OPERATOR"),
                    createdAt: z.iso.datetime(),
                    fingerprint: z.literal(plan1.plan.fingerprint),
                    evidenceVersion: z.literal(1),
                    checkpoint: z.null(),
                    result: z.null(),
                    authorityScope: z
                      .object({
                        restorationRoles: z.tuple([
                          z.literal("ADMIN"),
                          z.literal("HEAD"),
                        ]),
                        credentialRestoration: z.literal(false),
                      })
                      .strict(),
                    effects: z
                      .object({
                        registrationCodeCount: z.literal(1),
                        tutorId: z.literal(tutorId),
                        accountIds: z.array(z.string()).length(0),
                        pairingIds: z.array(z.string()).length(0),
                        tuteeIds: z.array(z.string()).length(0),
                        verificationClockIds: z.array(z.string()).length(0),
                        messageLinkIds: z.array(z.string()).length(0),
                      })
                      .strict(),
                    preserved: z.tuple([
                      z.literal(RECOVERY_EVIDENCE.preserveHistory),
                      z.literal(RECOVERY_EVIDENCE.preserveIdentity),
                      z.literal(RECOVERY_EVIDENCE.preserveLaterEdits),
                    ]),
                    deliveries: z
                      .object({
                        version: z.literal(1),
                        effects: z.array(z.never()).length(0),
                      })
                      .strict(),
                  })
                  .strict(),
              })
              .strict()
              .parse(receiptOutput);
            const receipt = receiptEnvelope.receipt;
            assert.ok(
              receipt.id === applied.receipt.receiptId &&
                receipt.actionId === actionId &&
                receipt.actorId === actor.id &&
                receipt.channel === "OPERATOR" &&
                receipt.evidenceVersion === 1,
              "CLI_RECEIPT_PROJECTION_INVALID",
            );
            const grantCode = chain.codes[0]?.code;
            assert.ok(
              grantCode && receiptJson.length > 0,
              "CLI_PRIVATE_RECEIPT_CONTROL_MISSING",
            );
            assert.ok(
              [grantCode, clientKey, privateBeforeSentinel].every(
                (value) => !receiptJson.includes(value),
              ),
              "CLI_RECEIPT_PRIVATE_VALUE_EXPOSED",
            );
            await invoke(
              "C11_KEY_REUSE_CONFLICT",
              restoreArgs(
                plan1Path,
                plan1.planHash,
                "A changed synthetic reason cannot reuse the same key",
              ),
              "CONFLICT",
            );
            same(await state(), retried);
            same(await unrelated(), unrelatedBefore);
            assert.ok(
              (await database.user.count({ where: { tutorId } })) === 0,
              "CLI_RESTORE_CREATED_ACCOUNT",
            );
            witness.checks = {
              coverage: "COMPLETE",
              dependentEventCount: 2,
              distinctCommittedTransactions: 3,
              websiteEligible: false,
              websiteDenied: true,
              staleDenied: true,
              demotedActorDenied: true,
              restoredActorRole: "HEAD",
              channel: "OPERATOR",
              receiptCount: 1,
              reversalAuditCount: 1,
              sameReceiptIdentity: true,
              retryReplayed: true,
              retryFenceDelta: 1,
              unrelatedFixtureRowsPreserved: true,
              accountless: true,
              interviewPreserved: true,
              separatelyCommittedNamesPreserved: true,
              grantRevoked: true,
              readCommandsPure: true,
              receiptProjectionClosed: true,
              receiptKnownSecretsAbsent: true,
              cliCommandCount: witness.commands.length,
              cliCasesSkipped: 0,
            };
            assert.ok(witness.commands.length === 11, "CLI_CASE_COUNT_INVALID");
            witness.status = "PASSED";
          } catch {
            if (cliWitness) {
              cliWitness.status = "FAILED";
              cliWitness.failedCase = caseId;
            }
            // Neither assertion diffs nor raw driver/CLI errors may expose plans,
            // synthetic grant secrets, row data or inherited local configuration.
            throw new Error(`CLI_LIFECYCLE_FAILED:${caseId}`);
          } finally {
            try {
              await runner?.close();
              if (cliWitness) cliWitness.cleanup.childSettled = true;
            } finally {
              settleLifecycle();
            }
          }
        },
      );
    } finally {
      await runner?.close();
      // node:test cancellation can settle its test handle before an async
      // callback's finally completes. Await our owned callback before dropping DB.
      await lifecycleSettled;
      await client?.$disconnect();
      globalClient.prisma = previousClient;
      globalClient.prismaDatabaseUrl = previousClientUrl;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      try {
        if (created) {
          assert.match(name, /^shbs_transfer_journal_[a-f0-9]{12}_test$/);
          assert.notEqual(name, new URL(adminUrl).pathname.slice(1));
          await admin.query(`DROP DATABASE "${name}"`);
          if (cliWitness) cliWitness.cleanup.ownedDatabaseDropped = true;
        }
      } finally {
        try {
          if (cliTempDirectory) {
            const ownedTemp = await realpath(cliTempDirectory);
            const temporaryRoot = await realpath(tmpdir());
            assert.ok(
              dirname(ownedTemp) === temporaryRoot &&
                ownedTemp.startsWith(join(temporaryRoot, "shbs-recovery-cli-")),
              "CLI_TEMP_OWNERSHIP_INVALID",
            );
            await rm(ownedTemp, { recursive: true });
            if (cliWitness) cliWitness.cleanup.temporaryFilesRemoved = true;
          }
        } finally {
          await admin.end();
          if (cliWitness && process.env.SHBS_RECOVERY_TEST_ARTIFACT_DIR) {
            if (!Object.values(cliWitness.cleanup).every(Boolean))
              cliWitness.status = "FAILED";
            const artifactDirectory = resolve(
              process.env.SHBS_RECOVERY_TEST_ARTIFACT_DIR,
            );
            assert.ok(
              artifactDirectory ===
                resolve(
                  import.meta.dirname,
                  "../.validation/recovery-rehearsal",
                ),
              "CLI_ARTIFACT_DIRECTORY_INVALID",
            );
            await mkdir(artifactDirectory, { recursive: true });
            await writeFile(
              join(artifactDirectory, "w115-cli-witness.json"),
              `${JSON.stringify(cliWitness, null, 2)}\n`,
              { mode: 0o600, flag: "wx" },
            );
          }
        }
      }
    }
  },
);
