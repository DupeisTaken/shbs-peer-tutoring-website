import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  rawMigrationSafetyFiles,
  teardownSafetyCases,
} from "./database-safety-cases";

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const runner = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const root = process.cwd();
const registration = teardownSafetyCases[1];
const accountEmails = teardownSafetyCases[2];
const safeUrl = "postgresql://postgres@127.0.0.1:1/shbs_shipping_test";
type LedgerEntry = { file: string; operation: string };
type TestReport = {
  success: boolean;
  testResults: Array<{
    name: string;
    status: string;
    message: string;
    assertionResults: Array<{ status: string; failureMessages: string[] }>;
  }>;
};

async function probe(
  files: readonly string[],
  databaseUrl: string,
  namePattern?: string,
) {
  const parent = resolve(root, ".validation");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "database-safety-"));
  const owned = await realpath(directory);
  try {
    const reportFile = join(directory, "report.json");
    const emptyEnv = join(directory, "empty.env");
    await writeFile(emptyEnv, "");
    await writeFile(join(directory, "sentinel"), "synthetic-account\n");
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv))
      if (key.startsWith("VITEST") || key === "DOTENV_CONFIG_OVERRIDE")
        delete childEnv[key];
    Object.assign(childEnv, {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      DOTENV_CONFIG_PATH: emptyEnv,
      SHBS_TEST_SAFETY_DIRECTORY: directory,
      NO_COLOR: "1",
    });
    let exitCode = 0;
    try {
      await runFile(
        process.execPath,
        [
          runner,
          "run",
          ...files,
          "--config",
          "src/test/database-safety.vitest.config.ts",
          // The default bundler writes .vite-temp into shared node_modules.
          "--configLoader",
          "runner",
          "--maxWorkers=1",
          "--reporter=json",
          "--outputFile",
          reportFile,
          ...(namePattern ? ["--testNamePattern", namePattern] : []),
        ],
        {
          cwd: root,
          env: childEnv,
          windowsHide: true,
          shell: false,
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    } catch (error) {
      // Expected guard failures exit 1. A timeout, signal or startup error must
      // fail this parent, never masquerade as a successfully refused target.
      if (!(error instanceof Error) || !("code" in error) || error.code !== 1)
        throw error;
      exitCode = 1;
    }
    const report = JSON.parse(await readFile(reportFile, "utf8")) as TestReport;
    const ledgerFile = join(directory, "ledger.jsonl");
    const ledger = existsSync(ledgerFile)
      ? (await readFile(ledgerFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as LedgerEntry)
      : [];
    return {
      report,
      ledger,
      exitCode,
      sentinelSurvived: existsSync(join(directory, "sentinel")),
    };
  } finally {
    // Delete only the exact directory this probe created under its local cache.
    expect(await realpath(directory)).toBe(owned);
    expect((await lstat(directory)).isSymbolicLink()).toBe(false);
    expect(dirname(resolve(directory))).toBe(parent);
    expect(basename(directory)).toMatch(/^database-safety-/);
    await rm(directory, { recursive: true, force: true });
  }
}

function expectRefused(
  result: Awaited<ReturnType<typeof probe>>,
  files: readonly string[],
  message: RegExp,
  disconnects: boolean,
) {
  expect(result.exitCode).toBe(1);
  expect(result.report.success).toBe(false);
  expect(
    result.report.testResults
      .map(({ name }) =>
        name
          .replaceAll("\\", "/")
          .replace(root.replaceAll("\\", "/") + "/", ""),
      )
      .sort(),
  ).toEqual([...files].sort());
  for (const suite of result.report.testResults) {
    expect(suite.status, suite.name).toBe("failed");
    expect(suite.assertionResults.length, suite.name).toBeGreaterThan(0);
    const failures = suite.assertionResults.filter(
      ({ status }) => status === "failed",
    );
    // A refused beforeAll marks its children skipped, but still runs afterAll.
    // Require the real guard error and per-file disconnect evidence below.
    expect(
      [
        suite.message,
        ...failures.flatMap(({ failureMessages }) => failureMessages),
      ].join("\n"),
      suite.name,
    ).toMatch(message);
    for (const failure of failures)
      expect(failure.failureMessages.join("\n")).toMatch(message);
  }
  expect(result.sentinelSurvived).toBe(true);
  expect(
    result.ledger.filter(({ operation }) => operation !== "disconnect"),
  ).toEqual([]);
  expect(result.ledger).toHaveLength(disconnects ? files.length : 0);
  if (disconnects)
    expect(new Set(result.ledger.map(({ file }) => file)).size).toBe(
      files.length,
    );
}

it("real failed-setup/teardown lifecycles preserve refused targets, while permitted cleanup still executes", async () => {
  // Children run serially, each with explicit synthetic URLs and no real driver.
  // Cover every confirmed unsafe teardown, including formerly unguarded suites.
  const cases = teardownSafetyCases.map(([file]) => file);
  const names = teardownSafetyCases
    .map(([, name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  expectRefused(
    await probe(
      cases,
      "postgresql://postgres@127.0.0.1:1/synthetic_demo",
      names,
    ),
    cases,
    /explicit local PostgreSQL \*_test/,
    true,
  );

  // A valid generic *_test target still cannot bypass a narrower suite allowlist.
  const narrowFiles = [registration[0], accountEmails[0]];
  expectRefused(
    await probe(
      narrowFiles,
      "postgresql://postgres@127.0.0.1:1/other_test",
      `${registration[1]}|${accountEmails[1]}`,
    ),
    narrowFiles,
    /Dedicated local test database required|isolated local shbs_shipping_test/,
    true,
  );

  expectRefused(
    await probe(
      rawMigrationSafetyFiles,
      `${safeUrl}?%68ost=remote.example.test`,
    ),
    rawMigrationSafetyFiles,
    /explicit local PostgreSQL \*_test/,
    false,
  );

  // Positive control uses the same registration hook/body/cleanup as above.
  const permitted = await probe([registration[0]], safeUrl, registration[1]);
  expect(permitted.exitCode).toBe(0);
  expect(permitted.report.success).toBe(true);
  expect(permitted.report.testResults).toHaveLength(1);
  expect(
    permitted.report.testResults[0]?.assertionResults.filter(
      ({ status }) => status === "passed",
    ),
  ).toHaveLength(1);
  expect(permitted.sentinelSurvived).toBe(false);
  expect(permitted.ledger.map(({ operation }) => operation)).toEqual([
    "query",
    "execute",
    "user.createMany",
    "execute",
    "disconnect",
  ]);
}, 240_000);
