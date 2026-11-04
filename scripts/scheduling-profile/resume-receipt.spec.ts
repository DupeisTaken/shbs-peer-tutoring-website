import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createClockAdmission } from "./clock-admission.mjs";
import { artifactInventoryHash } from "./resume-artifacts.mjs";
import { readReceipt, sealReceipt } from "./resume-receipt.mjs";

const anchor = "2026-11-03T12:02:12.645Z";
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function identity() {
  return {
    version: 1,
    repository: "synthetic-proof/local-copy",
    runId: "123",
    workflowSha: "a".repeat(40),
    campaignAttempt: 1,
    attempt: 1,
    candidateRevision: "b".repeat(40),
    baselineRevision: "c".repeat(40),
    anchor,
    nodeImage: `node@sha256:${"d".repeat(64)}`,
    nodeImageId: `sha256:${"3".repeat(64)}`,
    postgresImage: `sha256:${"e".repeat(64)}`,
    candidateSchemaSha256: "f".repeat(64),
    dependencyLockSha256: "1".repeat(64),
    comparisonSha256: sha("{}\n"),
    reportSchemaVersion: 3,
    partitionProtocolVersion: 1,
    slot: {
      scenario: "contention",
      mode: "latency",
      partition: 4,
      partitionCount: 10,
      samples: 40,
    },
    syntheticProof:
      "TEST ONLY: re-enveloped fixture copy, never original provider provenance",
  };
}
function archive() {
  return {
    repository: "synthetic-proof/local-copy",
    runId: "123",
    attempt: 1,
    artifactId: "456",
    name: "scheduling-profile-contention-latency-part-4-1",
    archiveSha256: "2".repeat(64),
    archiveSize: 1024,
  };
}
function report() {
  return {
    schemaVersion: 3,
    partitionProtocolVersion: 1,
    status: "PASS",
    revision: "c".repeat(40),
    mode: "latency",
    transport: "http",
    captureSchema: "shared",
    partition: {
      index: 4,
      count: 10,
      start: 16,
      end: 20,
      totalSamples: 40,
      warmupRounds: 1,
    },
    samplingComplete: false,
    partitionComplete: true,
    latencyComparisonEligible: false,
    fixture: {
      anchor,
      clockAdmission: createClockAdmission(anchor, anchor),
      scenarios: ["contention"],
      samples: 40,
      privateHugeFixture: "must never enter compact metadata",
    },
    databaseClock: { startedAt: anchor, finishedAt: anchor },
    startedAt: anchor,
    finishedAt: anchor,
    elapsedMs: 0,
    timeoutMs: 150_000,
    profileRunner: { id: "123-1-contention-latency-4", name: "not retained" },
    receipts: Array.from({ length: 4 }, () => ({
      privateGraph: "not retained",
    })),
    metrics: {
      samples: [
        { status: "succeeded", censored: false, elapsedIsLowerBound: false },
      ],
      operations: { dishonestSummary: { unfinished: 999 } },
    },
    phaseTimings: [{ status: "completed", elapsedIsLowerBound: false }],
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scheduling-resume-receipt-"));
  const directory = join(root, "worker");
  await mkdir(directory);
  const write = (name: string, value: unknown) =>
    writeFile(
      join(directory, name),
      typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
    );
  await write("anchor.txt", `${anchor}\n`);
  await write("node-image.txt", `${identity().nodeImageId}\n`);
  await write("comparison-inputs.json", "{}\n");
  await write("base-latency.json", report());
  await write("base-phase-status.json", {
    schemaVersion: 1,
    status: "PASS",
    exitCode: 0,
  });
  await write(
    "base-phase-events.jsonl",
    `${JSON.stringify({ event: "start", original: true })}\n${JSON.stringify({ event: "finish", original: true })}\n`,
  );
  return {
    root,
    directory,
    write,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

void test("seal binds compact raw counts and exact telemetry, reader returns selector artifact without raw graphs", async () => {
  const f = await fixture();
  try {
    const sealed = await sealReceipt(f.directory, identity());
    const value = await readReceipt(f.directory, archive());
    const base = record(value.reports.base);
    assert.equal(
      value.identitySha256,
      sha(await readFile(join(f.directory, "resume-identity.json"))),
    );
    assert.equal(value.identitySha256, sealed.identitySha256);
    assert.equal(value.inventorySha256, artifactInventoryHash(value.files));
    assert.deepEqual(value.identity.files, value.files);
    assert.deepEqual(value.identity.reports, value.reports);
    assert.equal(value.files["resume-identity.json"], undefined);
    assert.equal(base.fileSha256, value.files["base-latency.json"]);
    assert.equal(base.receiptCount, 4);
    assert.equal(
      base.unfinishedSampleCount,
      0,
      "raw samples override dishonest summary counters",
    );
    assert.equal(base.hasFailure, false);
    assert.equal(base.cleanupErrorCount, 0);
    assert.equal(base.incompletePhaseCount, 0);
    assert.deepEqual(base.profileRunner, {
      id: "123-1-contention-latency-4",
    });
    assert.equal(base.metrics, undefined);
    assert.equal(base.receipts, undefined);
    assert.equal(record(base.fixture).privateHugeFixture, undefined);
    assert.deepEqual(record(value.phaseFiles.base).events, [
      { event: "start", original: true },
      { event: "finish", original: true },
    ]);
    assert.equal(value.archiveSha256, archive().archiveSha256);
    await assert.rejects(
      sealReceipt(f.directory, identity()),
      /already sealed/,
    );
  } finally {
    await f.close();
  }
});

void test("failed report presence and actual partial counts remain visible instead of becoming retryable zero measurements", async () => {
  const f = await fixture();
  try {
    const raw = {
      ...report(),
      status: "FAIL",
      failure: null,
      cleanupErrors: ["failure"],
      metrics: {
        samples: [
          { status: "unfinished", censored: true, elapsedIsLowerBound: true },
          { status: "failed", censored: false, elapsedIsLowerBound: false },
        ],
      },
      phaseTimings: [
        { status: "failed", elapsedIsLowerBound: false },
        { status: "unfinished", elapsedIsLowerBound: true },
      ],
    };
    await f.write("head-latency.json", raw);
    await f.write("head-command-exit.json", {
      status: "FAIL",
      exitCode: 1,
      lastPhase: "dependency-install",
      elapsedSeconds: 145,
      budgetSeconds: 90,
    });
    const sealed = await sealReceipt(f.directory, identity());
    const value = await readReceipt(f.directory, archive());
    const head = record(value.reports.head);
    assert.ok(
      value.files["head-latency.json"],
      "failed-arm raw measurement must remain in inventory",
    );
    assert.deepEqual(value.reports.head, sealed.reports.head);
    assert.equal(head.status, "FAIL");
    assert.equal(
      head.hasFailure,
      true,
      "own failure field counts even when null",
    );
    assert.equal(head.cleanupErrorCount, 1);
    assert.equal(head.unfinishedSampleCount, 1);
    assert.equal(head.censoredSampleCount, 1);
    assert.equal(head.incompletePhaseCount, 2);
    assert.equal(
      record(record(value.phaseFiles.head).exit).elapsedSeconds,
      145,
      "overshoot telemetry is preserved exactly",
    );
  } finally {
    await f.close();
  }
});

void test("streamed inventory rejects changed, removed and added bytes after sealing", async () => {
  for (const mutation of ["changed", "removed", "added"]) {
    const f = await fixture();
    try {
      await sealReceipt(f.directory, identity());
      if (mutation === "changed")
        await f.write("base-latency.json", '{"changed":true}\n');
      if (mutation === "removed")
        await rm(join(f.directory, "base-latency.json"));
      if (mutation === "added") await f.write("extra.log", "new evidence\n");
      await assert.rejects(
        readReceipt(f.directory, archive()),
        /inventory mismatch/,
      );
    } finally {
      await f.close();
    }
  }
});

void test("missing legacy envelope fails closed and cannot be repaired by the reader", async () => {
  const f = await fixture();
  try {
    await assert.rejects(readReceipt(f.directory, archive()), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(f.directory, "resume-identity.json")), {
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});

void test("inventory treats special object-property filenames as hashed file data", async () => {
  const f = await fixture();
  try {
    await f.write("__proto__", "retained file\n");
    await sealReceipt(f.directory, identity());
    const value = await readReceipt(f.directory, archive());
    assert.equal(Object.hasOwn(value.files, "__proto__"), true);
    assert.equal(value.files.__proto__, sha("retained file\n"));
    await f.write("__proto__", "changed file\n");
    await assert.rejects(
      readReceipt(f.directory, archive()),
      /inventory mismatch/,
    );
  } finally {
    await f.close();
  }
});

void test("reader verifies archive binding and compact report bindings", async () => {
  const f = await fixture();
  try {
    await sealReceipt(f.directory, identity());
    for (const patch of [
      { repository: "other/repo" },
      { runId: "789" },
      { attempt: 2 },
      { name: "wrong" },
      { archiveSha256: "bad" },
      { archiveSize: 0 },
    ])
      await assert.rejects(
        readReceipt(f.directory, { ...archive(), ...patch }),
      );
    const path = join(f.directory, "resume-identity.json");
    const bytes = await readFile(path);
    for (const kind of ["missing", "wrong-hash", "extra"]) {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      const envelope = record(parsed);
      const summaries = record(envelope.reports);
      if (kind === "missing") delete summaries.base;
      if (kind === "wrong-hash")
        record(summaries.base).fileSha256 = "9".repeat(64);
      if (kind === "extra") summaries.surprise = {};
      await writeFile(path, JSON.stringify(envelope));
      await assert.rejects(
        readReceipt(f.directory, archive()),
        /compact report|Compact report/,
      );
    }
  } finally {
    await f.close();
  }
});

void test("seal refuses caller supplied evidence, malformed reports and oversized metadata without publishing an envelope", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      sealReceipt(f.directory, { ...identity(), files: {} }),
      /must not supply/,
    );
    await assert.rejects(
      sealReceipt(f.directory, { ...identity(), reports: {} }),
      /must not supply/,
    );
    await f.write("base-latency.json", "not JSON");
    await assert.rejects(sealReceipt(f.directory, identity()));
    await assert.rejects(access(join(f.directory, "resume-identity.json")), {
      code: "ENOENT",
    });
    await f.write("base-latency.json", report());
    await f.write("base-phase-status.json", " ".repeat(256 * 1024 + 1));
    await assert.rejects(
      sealReceipt(f.directory, identity()),
      /metadata exceeds/,
    );
    await assert.rejects(access(join(f.directory, "resume-identity.json")), {
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});

void test("inventory rejects directory links without following outside evidence", async (context) => {
  const f = await fixture();
  try {
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "private.log"), "not artifact evidence");
    try {
      await symlink(
        outside,
        join(f.directory, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("Host does not permit test links");
        return;
      }
      throw error;
    }
    await assert.rejects(sealReceipt(f.directory, identity()), /links/);
    assert.equal(
      await readFile(join(outside, "private.log"), "utf8"),
      "not artifact evidence",
    );
    assert.equal(
      (await lstat(join(f.directory, "linked"))).isSymbolicLink(),
      true,
    );
  } finally {
    await f.close();
  }
});

// These are copies of historical bytes, wrapped ONLY as synthetic reader proof.
// The original archives/directories remain unsealed and cannot enter production reuse.
for (const name of [
  "profile-f3db-contention-4",
  "negotiation-f3db-preflight",
]) {
  void test(`synthetic re-envelope of copied genuine ${name} bytes preserves compact evidence`, async (context) => {
    const source = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../.validation/complete-recovery",
      name,
    );
    try {
      await access(source);
    } catch {
      context.skip("Local historical evidence is not present");
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "scheduling-genuine-copy-"));
    try {
      const directory = join(root, "synthetic-copy");
      await cp(source, directory, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      assert.ok(
        !(await readdir(directory)).includes("resume-identity.json"),
        "Historical source must remain unsealed",
      );
      const binding = identity();
      binding.anchor = (
        await readFile(join(directory, "anchor.txt"), "utf8")
      ).trim();
      binding.nodeImageId = (
        await readFile(join(directory, "node-image.txt"), "utf8")
      ).trim();
      binding.comparisonSha256 = sha(
        await readFile(join(directory, "comparison-inputs.json")),
      );
      if (name === "negotiation-f3db-preflight")
        binding.slot = {
          scenario: "negotiation",
          mode: "diagnostic",
          partition: 0,
          partitionCount: 1,
          samples: 3,
        };
      const sealed = await sealReceipt(directory, binding);
      const value = await readReceipt(directory, {
        ...archive(),
        name: `scheduling-profile-${binding.slot.scenario}-${binding.slot.mode}-part-${binding.slot.partition}-1`,
      });
      const base = record(value.reports.base);
      assert.equal(value.identity.syntheticProof, identity().syntheticProof);
      assert.equal(base.status, "PASS");
      assert.equal(base.hasFailure, false);
      assert.equal(
        base.receiptCount,
        name === "profile-f3db-contention-4" ? 4 : 3,
      );
      assert.equal(base.unfinishedSampleCount, 0);
      assert.equal(base.censoredSampleCount, 0);
      assert.ok(JSON.stringify(value.reports).length < 10_000);
      assert.equal(
        sealed.files[`base-${binding.slot.mode}.json`],
        base.fileSha256,
      );
      if (name === "profile-f3db-contention-4") {
        assert.equal(value.reports.head, undefined);
        assert.equal(
          record(record(value.phaseFiles.head).status).status,
          "FAIL",
        );
        assert.equal(
          record(record(value.phaseFiles.head).exit).lastPhase,
          "dependency-install",
        );
      } else {
        const head = record(value.reports.head);
        assert.equal(head.status, "PASS");
        assert.equal(head.receiptCount, 3);
      }
      await assert.rejects(access(join(source, "resume-identity.json")), {
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
