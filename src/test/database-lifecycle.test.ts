import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  rawMigrationSafetyFiles,
  teardownSafetyCases,
} from "./database-safety-cases";
import { createDatabaseSafetyFake } from "./fixtures/database-safety-model";
import type { SafetyErrorsReceipt } from "./fixtures/database-safety-reporter";

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
const sharedGuard =
  "Database tests require an explicit local PostgreSQL *_test database.";
const registrationGuard = "Dedicated local test database required";
const accountEmailGuard = "Use the isolated local shbs_shipping_test database.";
const relativeFile = (file: string) =>
  relative(root, file).replaceAll("\\", "/");
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
  sourceVariant?: "without-cleanup-guard" | "unexpected-cleanup-error",
) {
  const parent = resolve(root, ".validation");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "database-safety-"));
  const owned = await realpath(directory);
  try {
    let selectedFiles = [...files];
    let originalHash: string | undefined;
    if (sourceVariant) {
      // Mutation controls operate ONLY on a newly owned source copy. Rebase its
      // relative imports to the original auth modules without editing that tree.
      const original = await readFile(resolve(root, accountEmails[0]), "utf8");
      const normalized = original.replaceAll("\r\n", "\n");
      const guardedCleanup =
        "afterAll(async () => {\n  try {\n    assertAccountEmailTestDatabase();";
      expect(normalized.split(guardedCleanup)).toHaveLength(2);
      expect(
        normalized.split("assertAccountEmailTestDatabase();"),
      ).toHaveLength(3);
      const replacement =
        sourceVariant === "without-cleanup-guard"
          ? "afterAll(async () => {\n  try {"
          : 'afterAll(async () => {\n  try {\n    throw new TypeError("Synthetic unexpected cleanup failure");';
      let copy = normalized
        .replace(guardedCleanup, replacement)
        .replaceAll('from "./', 'from "~/server/auth/');
      if (sourceVariant === "unexpected-cleanup-error") {
        // Put both setup and teardown failures on the module: the standard JSON
        // reporter exposes only the first, while our receipt must retain both.
        copy = copy
          .replace("afterAll, beforeEach,", "afterAll, beforeAll,")
          .replace("beforeEach(async () => {", "beforeAll(async () => {");
      }
      originalHash = createHash("sha256").update(original).digest("hex");
      expect(copy.split("assertAccountEmailTestDatabase();")).toHaveLength(2);
      const copyPath = join(directory, "account-emails.control.test.ts");
      await writeFile(copyPath, copy);
      selectedFiles = [relative(root, copyPath).replaceAll("\\", "/")];
      await writeFile(
        join(directory, "source-mutation.json"),
        JSON.stringify(
          {
            variant: sourceVariant,
            original: accountEmails[0],
            sourceCopy: selectedFiles[0],
            originalSha256: originalHash,
            copySha256: createHash("sha256").update(copy).digest("hex"),
            removed: guardedCleanup,
            replacement,
            importRebase: 'from "./ → from "~/server/auth/',
            copyNewlines:
              "normalized to LF; original raw bytes remain unchanged",
            setupTimingChange:
              sourceVariant === "unexpected-cleanup-error"
                ? "beforeEach → beforeAll (isolated multiple-error control)"
                : "none",
            trackedFilesEdited: false,
          },
          null,
          2,
        ) + "\n",
      );
    }
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
    if (sourceVariant) childEnv.SHBS_TEST_SAFETY_SOURCE_VARIANT = sourceVariant;
    else delete childEnv.SHBS_TEST_SAFETY_SOURCE_VARIANT;
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    try {
      const output = await runFile(
        process.execPath,
        [
          runner,
          "run",
          ...selectedFiles,
          "--config",
          "src/test/database-safety.vitest.config.ts",
          // The default bundler writes .vite-temp into shared node_modules.
          "--configLoader",
          "runner",
          "--maxWorkers=1",
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
      stdout = output.stdout;
      stderr = output.stderr;
    } catch (error) {
      if (error instanceof Error) {
        if ("stdout" in error && typeof error.stdout === "string")
          stdout = error.stdout;
        if ("stderr" in error && typeof error.stderr === "string")
          stderr = error.stderr;
      }
      // Expected guard failures exit 1. A timeout, signal or startup error must
      // fail this parent, never masquerade as a successfully refused target.
      if (!(error instanceof Error) || !("code" in error) || error.code !== 1)
        throw error;
      exitCode = 1;
    } finally {
      await writeFile(join(directory, "stdout.log"), stdout);
      await writeFile(join(directory, "stderr.log"), stderr);
    }
    const report = JSON.parse(await readFile(reportFile, "utf8")) as TestReport;
    const errors = JSON.parse(
      await readFile(join(directory, "errors.json"), "utf8"),
    ) as SafetyErrorsReceipt;
    const ledgerFile = join(directory, "ledger.jsonl");
    const ledger = existsSync(ledgerFile)
      ? (await readFile(ledgerFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as LedgerEntry)
      : [];
    if (originalHash) {
      const afterHash = createHash("sha256")
        .update(await readFile(resolve(root, accountEmails[0])))
        .digest("hex");
      await writeFile(
        join(directory, "source-mutation-after.json"),
        JSON.stringify(
          {
            originalSha256Before: originalHash,
            originalSha256After: afterHash,
            unchanged: originalHash === afterHash,
          },
          null,
          2,
        ) + "\n",
      );
      expect(afterHash).toBe(originalHash);
    }
    const result = {
      files: selectedFiles,
      report,
      errors,
      ledger,
      exitCode,
      sentinelSurvived: existsSync(join(directory, "sentinel")),
    };
    await writeFile(
      join(directory, "probe-result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    return result;
  } finally {
    const evidence = process.env.SHBS_TEST_SAFETY_EVIDENCE_DIRECTORY;
    if (evidence) {
      const archive = join(evidence, basename(directory));
      await mkdir(archive, { recursive: true });
      for (const filename of [
        "report.json",
        "errors.json",
        "probe-result.json",
        "stdout.log",
        "stderr.log",
        "ledger.jsonl",
        "sentinel",
        "source-mutation.json",
        "source-mutation-after.json",
        "account-emails.control.test.ts",
      ]) {
        if (existsSync(join(directory, filename)))
          await copyFile(join(directory, filename), join(archive, filename));
      }
    }
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
  messages: string | ReadonlyMap<string, string>,
  disconnects: boolean,
) {
  expect(result.exitCode).toBe(1);
  expect(result.report.success).toBe(false);
  expect(result.errors.reason).toBe("failed");
  expect(result.errors.unhandledErrors).toEqual([]);
  expect(
    result.report.testResults.map(({ name }) => relativeFile(name)).sort(),
  ).toEqual([...files].sort());
  expect(
    result.errors.modules.map(({ file }) => relativeFile(file)).sort(),
  ).toEqual([...files].sort());
  for (const module of result.errors.modules) {
    const file = relativeFile(module.file);
    const expected =
      typeof messages === "string" ? messages : messages.get(file);
    if (!expected) throw new Error(`Missing expected guard for ${file}`);
    const errors = [
      ...module.errors,
      ...module.suites.flatMap((suite) => suite.errors),
      ...module.tests.flatMap((test) => test.errors),
    ];
    expect(errors.length, file).toBeGreaterThan(0);
    for (const error of errors) {
      if (
        error.name !== "Error" ||
        error.message !== expected ||
        error.hasCause ||
        error.hasNestedErrors
      )
        throw new Error(
          `Unexpected lifecycle error in ${file}: ${error.name}: ${error.message}`,
        );
    }
    const suite = result.report.testResults.find(
      ({ name }) => relativeFile(name) === file,
    );
    expect(suite?.status, file).toBe("failed");
    expect(suite?.assertionResults.length, file).toBeGreaterThan(0);
    if (suite?.message) expect(suite.message, file).toBe(expected);
    for (const assertion of suite?.assertionResults ?? [])
      for (const failure of assertion.failureMessages)
        expect(failure.split("\n")[0], file).toBe(`Error: ${expected}`);
  }
  const queries = result.ledger.filter(
    ({ operation }) => operation !== "disconnect",
  );
  if (queries.length)
    throw new Error(
      `Refused target dispatched database operation: ${queries.map(({ operation }) => operation).join(", ")}`,
    );
  expect(result.sentinelSurvived).toBe(true);
  expect(result.ledger.map(({ file }) => relativeFile(file)).sort()).toEqual(
    disconnects ? [...files].sort() : [],
  );
  for (const module of result.errors.modules) {
    // beforeEach failures belong to cases; afterAll failures belong to the
    // module. These two suites also fail beforeAll, so both hook errors must
    // survive reporting. Setup guard text alone never proves safe teardown.
    const beforeAll = [
      "src/server/api/routers/scoping.test.ts",
      "src/server/api/routers/time-slots.test.ts",
    ].includes(relativeFile(module.file));
    expect(
      module.errors.length,
      `Missing teardown guard evidence: ${module.file}`,
    ).toBe(disconnects ? (beforeAll ? 2 : 1) : 0);
  }
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
    sharedGuard,
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
    new Map([
      [registration[0], registrationGuard],
      [accountEmails[0], accountEmailGuard],
    ]),
    true,
  );

  expectRefused(
    await probe(
      rawMigrationSafetyFiles,
      `${safeUrl}?%68ost=remote.example.test`,
    ),
    rawMigrationSafetyFiles,
    sharedGuard,
    false,
  );

  // Positive control uses the same registration hook/body/cleanup as above.
  const permitted = await probe([registration[0]], safeUrl, registration[1]);
  expect(permitted.exitCode).toBe(0);
  expect(permitted.errors.reason).toBe("passed");
  expect(permitted.errors.unhandledErrors).toEqual([]);
  for (const module of permitted.errors.modules) {
    expect(module.errors).toEqual([]);
    expect(module.suites.flatMap((suite) => suite.errors)).toEqual([]);
    expect(module.tests.flatMap((test) => test.errors)).toEqual([]);
  }
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

it("detects removal of the real account-email teardown guard in an isolated source copy", async () => {
  const result = await probe(
    [accountEmails[0]],
    "postgresql://postgres@127.0.0.1:1/synthetic_demo",
    accountEmails[1],
    "without-cleanup-guard",
  );
  expect(() => expectRefused(result, result.files, sharedGuard, true)).toThrow(
    "Refused target dispatched database operation",
  );
  expect(result.sentinelSurvived).toBe(false);
  expect(result.ledger.map(({ operation }) => operation)).toEqual([
    "transaction",
    "person.findMany",
    "person.updateMany",
    "user.deleteMany",
    "person.deleteMany",
    "disconnect",
  ]);
}, 60_000);

it("rejects an unexpected teardown error hidden behind a beforeAll guard in JSON", async () => {
  const result = await probe(
    [accountEmails[0]],
    "postgresql://postgres@127.0.0.1:1/synthetic_demo",
    accountEmails[1],
    "unexpected-cleanup-error",
  );
  // Prove this is the hidden second module error, not a startup/filter failure.
  expect(result.report.testResults[0]?.message).toBe(sharedGuard);
  expect(
    result.errors.modules[0]?.errors.map(({ message }) => message),
  ).toEqual([sharedGuard, "Synthetic unexpected cleanup failure"]);
  expect(() => expectRefused(result, result.files, sharedGuard, true)).toThrow(
    "TypeError: Synthetic unexpected cleanup failure",
  );
  expect(result.sentinelSurvived).toBe(true);
  expect(result.ledger.map(({ operation }) => operation)).toEqual([
    "disconnect",
  ]);
}, 60_000);

it("models transaction reads, arrays and writes without treating unsupported calls as refusals", async () => {
  let sentinel = true;
  const operations: string[] = [];
  const fake = createDatabaseSafetyFake((operation, writes) => {
    operations.push(operation);
    if (writes) sentinel = false;
  });
  await expect(
    fake.$transaction(async (tx) => tx.person.findMany()),
  ).resolves.toEqual([{ id: "synthetic-person" }]);
  await expect(
    fake.$transaction([Promise.resolve(1), Promise.resolve(2)]),
  ).resolves.toEqual([1, 2]);
  expect(sentinel).toBe(true);
  const unsupported = Reflect.get(fake, "$missing") as () => Promise<unknown>;
  await expect(unsupported()).rejects.toThrow(
    "Unsupported fake database operation: $missing",
  );
  expect(sentinel).toBe(true);
  await expect(
    fake.$transaction(async (tx) => tx.user.deleteMany()),
  ).resolves.toEqual({ count: 1 });
  expect(sentinel).toBe(false);
  expect(operations).toEqual([
    "transaction",
    "person.findMany",
    "transaction",
    "unsupported.$missing",
    "transaction",
    "user.deleteMany",
  ]);
});
