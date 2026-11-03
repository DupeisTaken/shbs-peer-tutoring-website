import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const wrapper = readFileSync(fileURLToPath(new URL("../run-scheduling-profile-ci.sh", import.meta.url)), "utf8");
// Windows may explicitly use Git for Windows' POSIX shell, never the WSL launcher.
// Hosted runs exercise the actual Alpine /bin/sh; no application/DB is launched.
const shell = process.env.PROFILE_POSIX_SHELL ?? "/bin/sh";
const posix = process.platform !== "win32" || Boolean(process.env.PROFILE_POSIX_SHELL);
const options = { skip: posix ? false : "Requires local POSIX /bin/sh; exercised by the supported Linux helper gate", timeout: 5_000 };
type Event = { phase: string; event: string; attempt: number; elapsedSeconds: number; budgetSeconds: number; exitCode: number | null };
type Terminal = { status: string; exitCode: number; lastPhase: string; firstFailedBootstrapAttempt: null | { attempt: number; exitCode: number; elapsedSeconds: number; budgetSeconds: number } };

function run(mode: string, revision = "head", initialClock = 1000) {
  assert.doesNotMatch(wrapper, /\r/, "The actual POSIX wrapper must retain LF line endings");
  const shellPath = (path: string) => process.platform === "win32"
    ? path.replaceAll("\\", "/").replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`)
    : path;
  const root = mkdtempSync(join(tmpdir(), "scheduling-wrapper-"));
  const bin = join(root, "bin"), evidence = join(root, "evidence");
  mkdirSync(bin);
  mkdirSync(evidence);
  const clock = join(root, "clock"), trace = join(root, "trace"), timeoutLog = join(root, "timeouts");
  writeFileSync(clock, `${initialClock}\n`);
  writeFileSync(trace, "");
  writeFileSync(timeoutLog, "");
  const script = join(root, "wrapper.sh");
  // Only redirect this owned test copy's artifact directory. All command and
  // failure-control flow remains the actual wrapper source being reviewed.
  writeFileSync(script, wrapper.replaceAll("/evidence", shellPath(evidence)));
  const executable = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
    chmodSync(path, 0o755);
  };
  executable("date", 'cat "$STUB_CLOCK"');
  executable("timeout", 'printf "%s %s\\n" "$1" "$2" >> "$STUB_TIMEOUTS"\nshift\n"$@"');
  executable("apk", `
count=0
[ ! -f "$STUB_APK_COUNT" ] || count=$(cat "$STUB_APK_COUNT")
count=$((count + 1))
printf '%s\\n' "$count" > "$STUB_APK_COUNT"
printf 'apk\\n' >> "$STUB_TRACE"
case "$STUB_MODE:$count" in
  timeout-first:1) printf '1030\\n' > "$STUB_CLOCK"; exit 124 ;;
  timeout-both:*) printf '%s\\n' "$((1000 + count * 30))" > "$STUB_CLOCK"; exit 124 ;;
  fail-first:1|fail-first-npm-failure:1) printf '1001\\n' > "$STUB_CLOCK"; exit 17 ;;
  permanent:*) exit 18 ;;
  no-retry-time:1) printf '1090\\n' > "$STUB_CLOCK"; exit 17 ;;
esac
`);
  executable("npm", `
case "$*" in ci) label=npm-install ;; *) label=npm-migrate ;; esac
printf '%s\\n' "$label" >> "$STUB_TRACE"
case "$STUB_MODE:$label" in npm-failure:npm-install|fail-first-npm-failure:npm-install) exit 23 ;; esac
if [ "$STUB_MODE:$label" = migration-failure:npm-migrate ]; then exit 24; fi
`);
  executable("npx", 'printf "npx\\n" >> "$STUB_TRACE"');
  executable("node", `
case "$*" in
  -p*) printf 'comparison-read\\n' >> "$STUB_TRACE"; printf 'true\\n'; exit 0 ;;
  *scripts/profile-scheduling-requests.ts*) label=measurement ;;
  *comparison-inputs.mjs*) label=overlay ;;
  *metrics.integration.ts*) label=metrics ;;
  *controlled-contention.integration.ts*) label=controlled ;;
  *) label=helpers ;;
esac
printf '%s\\n' "$label" >> "$STUB_TRACE"
if [ "$STUB_MODE:$label" = measurement-failure:measurement ]; then exit 25; fi
if [ "$STUB_MODE:$label" = helper-failure:helpers ]; then exit 26; fi
`);
  try {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    // Set PATH inside POSIX sh: Git for Windows normalizes a native process's
    // inherited Windows PATH before -c, which would otherwise hide our stubs.
    const result = spawnSync(shell, ["-c", 'PATH="$1:/usr/bin:/bin"; export PATH; exec /bin/sh "$2"',
      "wrapper-test", shellPath(bin), shellPath(script)], {
      encoding: "utf8", timeout: 4_000, maxBuffer: 128 * 1024,
      env: { ...inherited, NODE_ENV: "test", PATH: `${shellPath(bin)}:/usr/bin:/bin`,
        PROFILE_REVISION: revision, PROFILE_SCENARIO: "cold", PROFILE_MODE: "latency",
        PROFILE_PARTITION_INDEX: "0", PROFILE_PARTITION_COUNT: "5", PROFILE_SAMPLES: "20",
        PROFILE_DEADLINE: "1300", PROFILE_ANCHOR: "synthetic-anchor-not-for-logs",
        PROFILE_SCHEMA_MANIFEST: "", DATABASE_URL: "postgres://synthetic-secret@example.invalid/test",
        STUB_MODE: mode, STUB_CLOCK: shellPath(clock), STUB_TRACE: shellPath(trace), STUB_TIMEOUTS: shellPath(timeoutLog),
        STUB_APK_COUNT: shellPath(join(root, "apk-count")),
        // no-retry-time uses the same initial 85s allowance as no-time-left tests.
        ...(mode === "no-retry-time" ? { PROFILE_DEADLINE: "1100" } : {}),
      },
    });
    assert.ifError(result.error);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret|synthetic-anchor-not-for-logs/);
    const terminal = JSON.parse(readFileSync(join(evidence, `${revision}-phase-status.json`), "utf8")) as Terminal;
    let events: Event[] = [];
    try { events = readFileSync(join(evidence, `${revision}-phase-events.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((line: string) => JSON.parse(line) as Event); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const failure = result.status === 0 ? null : JSON.parse(readFileSync(join(evidence, `${revision}-command-exit.json`), "utf8")) as Terminal;
    return { status: result.status, stderr: result.stderr, terminal, failure, events,
      trace: readFileSync(trace, "utf8").trim().split("\n").filter(Boolean),
      timeouts: readFileSync(timeoutLog, "utf8").trim().split("\n").filter(Boolean) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("a full first 30s apk timeout gets exactly one bounded recovery attempt", options, () => {
  const result = run("timeout-first");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.terminal.status, "PASS");
  assert.equal(result.terminal.lastPhase, "shared-measurement");
  assert.deepEqual(result.terminal.firstFailedBootstrapAttempt,
    { phase: "bootstrap-packages", attempt: 1, exitCode: 124, elapsedSeconds: 30, budgetSeconds: 30 });
  const attempts = result.events.filter((event) => event.phase === "bootstrap-packages" && event.event === "finish");
  assert.deepEqual(attempts.map(({ attempt, exitCode, budgetSeconds, elapsedSeconds }) => ({ attempt, exitCode, budgetSeconds, elapsedSeconds })), [
    { attempt: 1, exitCode: 124, budgetSeconds: 30, elapsedSeconds: 30 },
    { attempt: 2, exitCode: 0, budgetSeconds: 30, elapsedSeconds: 0 },
  ]);
  assert.equal(result.trace.filter((label) => label === "apk").length, 2);
  assert.equal(result.failure, null);
});

void test("a fast first bootstrap failure is retained after successful recovery", options, () => {
  const result = run("fail-first");
  assert.equal(result.status, 0);
  assert.equal(result.terminal.firstFailedBootstrapAttempt?.exitCode, 17);
  assert.equal(result.terminal.firstFailedBootstrapAttempt?.elapsedSeconds, 1);
  assert.equal(result.trace.filter((label) => label === "apk").length, 2);
});

void test("permanent bootstrap failure runs twice and preserves original and terminal failures", options, () => {
  const result = run("permanent");
  assert.equal(result.status, 18);
  assert.equal(result.failure?.lastPhase, "bootstrap-packages");
  assert.equal(result.failure?.firstFailedBootstrapAttempt?.exitCode, 18);
  assert.deepEqual(result.trace, ["apk", "apk"]);
});

void test("two bootstrap timeouts retain both 30s attempts without extending the 60s phase cap", options, () => {
  const result = run("timeout-both");
  assert.equal(result.status, 124);
  const attempts = result.events.filter((event) => event.phase === "bootstrap-packages" && event.event === "finish");
  assert.deepEqual(attempts.map((event) => event.elapsedSeconds), [30, 30]);
  assert.deepEqual(attempts.map((event) => event.budgetSeconds), [30, 30]);
  assert.deepEqual(attempts.map((event) => event.exitCode), [124, 124]);
  assert.equal(result.failure?.firstFailedBootstrapAttempt?.attempt, 1);
  assert.deepEqual(result.trace, ["apk", "apk"]);
});

void test("a later terminal failure still retains the first recovered bootstrap failure", options, () => {
  const result = run("fail-first-npm-failure");
  assert.equal(result.status, 23);
  assert.equal(result.failure?.lastPhase, "dependency-install");
  assert.equal(result.failure?.firstFailedBootstrapAttempt?.exitCode, 17);
  assert.equal(result.events.filter((event) => event.phase === "dependency-install" && event.event === "start").length, 1);
});

void test("no shared time left prevents even the first bootstrap attempt", options, () => {
  const result = run("success", "head", 1300);
  assert.equal(result.status, 124);
  assert.equal(result.failure?.lastPhase, "bootstrap-packages");
  assert.equal(result.failure?.firstFailedBootstrapAttempt, null);
  assert.deepEqual(result.trace, []);
});

void test("loss of remaining shared time after failure prevents a retry", options, () => {
  const result = run("no-retry-time");
  assert.equal(result.status, 124);
  assert.equal(result.failure?.firstFailedBootstrapAttempt?.exitCode, 17);
  assert.deepEqual(result.trace, ["apk"]);
});

for (const [mode, exitCode, phase] of [
  ["npm-failure", 23, "dependency-install"], ["migration-failure", 24, "initial-migrations"],
  ["helper-failure", 26, "helper-regressions"], ["measurement-failure", 25, "shared-measurement"],
] as const) {
  void test(`${phase} failures propagate without retry`, options, () => {
    const result = run(mode);
    assert.equal(result.status, exitCode);
    assert.equal(result.failure?.lastPhase, phase);
    assert.equal(result.terminal.firstFailedBootstrapAttempt, null);
    assert.equal(result.events.filter((event) => event.phase === phase && event.event === "start").length, 1);
    assert.equal(result.trace.filter((label) => label === "apk").length, 1);
  });
}

void test("base control, overlay and both harness calls have explicit phases with unchanged individual caps", options, () => {
  const result = run("success", "base");
  assert.equal(result.status, 0);
  const phases = result.events.filter((event) => event.event === "start");
  assert.deepEqual(phases.map((event) => event.phase), ["bootstrap-packages", "dependency-install", "helper-regressions",
    "initial-migrations", "comparison-inspection", "native-measurement", "comparison-overlay", "client-generation",
    "overlay-migrations", "schema-agreement", "metrics-integration", "shared-measurement"]);
  assert.equal(phases.find((event) => event.phase === "dependency-install")?.budgetSeconds, 90);
  assert.equal(phases.find((event) => event.phase === "native-measurement")?.budgetSeconds, 90);
  assert.equal(phases.find((event) => event.phase === "shared-measurement")?.budgetSeconds, 150);
  assert.equal(result.trace.filter((label) => label === "measurement").length, 2);
  assert.equal(result.trace.filter((label) => label === "npm-migrate").length, 2);
});

void test("a supervised POSIX timeout reports the shell status retained by the wrapper", options, () => {
  // The wrapper waits for timeout and reads $?. Keep this shell alive too:
  // ash can exec its last command, exposing a signal directly to Node instead.
  const probe = [
    "PATH=/usr/bin:/bin; export PATH",
    'timeout 1 /bin/sh -c "echo child-started; exec sleep 3"',
    "status=$?",
    'printf "shell-status=%s\\n" "$status"',
    'exit "$status"',
  ].join("; ");
  const result = spawnSync(shell, ["-c", probe], { encoding: "utf8", timeout: 4_000, maxBuffer: 4096 });
  assert.ifError(result.error);
  const details = JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.signal, null, details);
  assert.ok(result.status === 124 || result.status === 143, details);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ["child-started", `shell-status=${result.status}`], details);
});
