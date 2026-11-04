import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const bash = process.env.SHBS_TEST_BASH ?? "bash";
const timestamp = "20261103-030000";
const sql = "-- PostgreSQL database dump\nSELECT 1;\n-- PostgreSQL database dump complete\n";
const day = 24 * 60 * 60 * 1000;
const oldName = "fixture-daily-20260101-030000-AAAAAAAAAA.sql.gz";

// The real entrypoint runs in its own synthetic project. Only these wrappers
// are on PATH: a missed stub cannot reach Docker, SSH, AWS or a real remote.
function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "shbs-backup-test-"));
  const backup = path.join(directory, "backups with spaces");
  const children = new Set();
  t.after(async () => {
    // Release only this fixture's bounded barriers before removing owned files.
    writeFileSync(path.join(directory, "release"), "release\n");
    await Promise.all([...children].map((child) => child.done));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("shbs-backup-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(path.join(directory, "scripts"));
  mkdirSync(path.join(directory, "bin"));
  if (options.createBackup !== false) mkdirSync(backup);
  copyFileSync(path.join(root, "scripts/backup.sh"), path.join(directory, "scripts/backup.sh"));
  writeFileSync(path.join(directory, ".env"), [
    "POSTGRES_DB='fixture'",
    "POSTGRES_USER='fixture_user'",
    "BACKUP_DIR='backups with spaces'",
    `BACKUP_RCLONE_REMOTE='${options.uploads?.includes("rclone") ? "fixture:daily" : ""}'`,
    `BACKUP_S3_URI='${options.uploads?.includes("aws") ? "s3://fixture/daily/" : ""}'`,
    `BACKUP_SCP_DEST='${options.uploads?.includes("scp") ? "fixture@invalid.example:/daily/" : ""}'`,
    "",
  ].join("\n"));
  const stubs = {};
  for (const command of ["bash", "dirname", "mkdir", "rm", "rmdir", "awk", "find"]) {
    stubs[command] = `#!/bin/bash\nexec /usr/bin/${command} "$@"\n`;
  }
  stubs.date = `#!/bin/bash
[[ $# = 1 && "$1" = +%Y%m%d-%H%M%S ]] || exit 90
printf '${timestamp}\\n'
`;
  stubs.mktemp = `#!/bin/bash
[[ $# = 1 && "$1" = */.backup.lock/dump.partial.XXXXXXXXXX ]] || exit 91
if [[ "$SCENARIO" = collision ]]; then
  target="\${1%XXXXXXXXXX}AAAAAAAAAA"
  (set -C; : > "$target") || exit 92
  printf '%s\\n' "$target"
else
  exec /usr/bin/mktemp "$@"
fi
`;
  stubs.docker = `#!/bin/bash
printf 'docker\\n' >> calls.log
[[ $# = 8 && "$1" = compose && "$2" = exec && "$3" = -T && "$4" = db && "$5" = pg_dump && "$6" = -U && "$7" = fixture_user && "$8" = fixture ]] || exit 94
if [[ "$SCENARIO" = barrier ]]; then
  : > ready
  for ((attempt=0; attempt<500; attempt++)); do
    [[ ! -e release ]] || break
    /usr/bin/sleep 0.02
  done
  [[ -e release ]] || exit 95
fi
case "$SCENARIO" in
  dump-fail) printf '%s\\n' '-- PostgreSQL database dump' 'partial'; exit 4 ;;
  empty) exit 0 ;;
  incomplete) printf '%s\\n' '-- PostgreSQL database dump' 'SELECT 1;'; exit 0 ;;
  reversed) printf '%s\\n' '-- PostgreSQL database dump complete' '-- PostgreSQL database dump'; exit 0 ;;
  term) kill -TERM "$PPID" ;;
  killed) printf '%s\\n' '-- PostgreSQL database dump'; kill -KILL "$PPID"; exit 0 ;;
esac
printf '%s\\n' '-- PostgreSQL database dump' 'SELECT 1;' '-- PostgreSQL database dump complete'
`;
  stubs.gzip = `#!/bin/bash
if [[ $# = 0 ]]; then
  printf 'compress\\n' >> calls.log
  case "$SCENARIO" in
    compress-fail) /usr/bin/cat >/dev/null; printf 'partial'; exit 5 ;;
    invalid-gzip) /usr/bin/cat >/dev/null; printf 'not a gzip stream'; exit 0 ;;
    truncated-gzip) /usr/bin/gzip | /usr/bin/head -c 12; exit 0 ;;
  esac
elif [[ $# = 3 && "$2" = -- && "$3" = */.backup.lock/dump.partial.* ]]; then
  case "$1" in
    -t) printf 'integrity\\n' >> calls.log ;;
    -cd) printf 'framing\\n' >> calls.log ;;
    *) exit 96 ;;
  esac
else
  exit 97
fi
exec /usr/bin/gzip "$@"
`;
  stubs.ln = `#!/bin/bash
[[ $# = 4 && "$1" = -T && "$2" = -- && "$3" = */.backup.lock/dump.partial.* && "$4" = */fixture-daily-${timestamp}-*.sql.gz ]] || exit 98
/usr/bin/gzip -t -- "$3" || exit 99
printf 'publish\\n' >> calls.log
/usr/bin/ln "$@" || exit $?
if [[ "$SCENARIO" = current-old ]]; then /usr/bin/touch -t 200001010000 "$4"; fi
`;
  for (const tool of ["rclone", "aws", "scp"]) {
    if (options.missingTool === tool) continue;
    const contract = tool === "rclone"
      ? '[[ $# = 3 && "$1" = copy && "$3" = fixture:daily ]]; file="$2"'
      : tool === "aws"
        ? '[[ $# = 4 && "$1" = s3 && "$2" = cp && "$4" = s3://fixture/daily/ ]]; file="$3"'
        : '[[ $# = 2 && "$2" = fixture@invalid.example:/daily/ ]]; file="$1"';
    stubs[tool] = `#!/bin/bash
set -e
${contract}
[[ "$file" = */fixture-daily-${timestamp}-*.sql.gz && -f "$file" ]]
/usr/bin/gzip -t -- "$file"
printf '${tool}\\n' >> calls.log
# Each configured transfer must precede deletion of the expired owned fixture.
[[ ! -e require-old || -f "$BACKUP_DIR/${oldName}" ]]
[[ "$SCENARIO" != ${tool}-fail ]]
`;
  }
  for (const [command, source] of Object.entries(stubs)) {
    const file = path.join(directory, "bin", command);
    writeFileSync(file, source);
    chmodSync(file, 0o755);
  }
  const args = ["--noprofile", "--norc", "-c", 'export PATH="$PWD/bin"; exec "$BASH" ./scripts/backup.sh'];
  function settings(scenario) {
    return {
      cwd: directory,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("BASH_FUNC_"))),
        BASH_ENV: "",
        ENV: "",
        SCENARIO: scenario,
        DOCKER_HOST: "ssh://never-contact.invalid.example",
        DOCKER_CONTEXT: "never-contact",
      },
      timeout: 15_000,
    };
  }
  function run(scenario = "normal") {
    const result = spawnSync(bash, args, { ...settings(scenario), encoding: "utf8" });
    assert.ifError(result.error);
    return result;
  }
  function start(scenario) {
    const child = spawn(bash, args, settings(scenario));
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const tracked = { done: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
    }) };
    children.add(tracked);
    return tracked.done;
  }
  function seed(name = oldName, age = 20 * day, contents = gzipSync(sql)) {
    const file = path.join(backup, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    const date = new Date(Date.now() - age);
    utimesSync(file, date, date);
    return file;
  }
  return {
    directory, backup, run, start, seed,
    files: () => readdirSync(backup).filter((name) => name.endsWith(".sql.gz")),
    calls: () => existsSync(path.join(directory, "calls.log"))
      ? readFileSync(path.join(directory, "calls.log"), "utf8").trim().split(/\r?\n/)
      : [],
  };
}

function assertClean(f) {
  assert.equal(existsSync(path.join(f.backup, ".backup.lock")), false);
  assert.equal(readdirSync(f.backup).some((name) => name.startsWith("dump.partial.")), false);
}

async function waitFor(file) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(file)) {
    assert.ok(Date.now() < deadline, `Timed out waiting for fixture barrier ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const scenario of ["dump-fail", "compress-fail", "invalid-gzip", "truncated-gzip", "empty", "incomplete", "reversed"]) {
  test(`${scenario} preserves recovery points and publishes no final backup`, (t) => {
    const f = fixture(t, { uploads: ["rclone", "aws", "scp"] });
    const old = f.seed();
    const original = readFileSync(old);
    const result = f.run(scenario);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(f.files(), [oldName]);
    assert.deepEqual(readFileSync(old), original);
    assert.equal(f.calls().includes("publish"), false);
    assert.equal(f.calls().some((call) => ["rclone", "aws", "scp"].includes(call)), false);
    assertClean(f);
  });
}

test("publishes validated private output atomically with unique same-second names", (t) => {
  const f = fixture(t, { createBackup: false });
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  const firstName = f.files()[0];
  assert.match(firstName, /^fixture-daily-20261103-030000-[A-Za-z0-9]{10}\.sql\.gz$/);
  const firstBytes = readFileSync(path.join(f.backup, firstName));
  assert.equal(gunzipSync(firstBytes).toString(), sql);
  if (process.platform !== "win32") assert.equal(statSync(f.backup).mode & 0o777, 0o700);
  assert.deepEqual(f.calls().filter((call) => call !== "docker" && call !== "compress"), ["integrity", "framing", "publish"]);
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(f.files().length, 2);
  assert.deepEqual(readFileSync(path.join(f.backup, firstName)), firstBytes);
  for (const name of f.files()) {
    assert.equal(gunzipSync(readFileSync(path.join(f.backup, name))).toString(), sql);
    if (process.platform !== "win32") assert.equal(statSync(path.join(f.backup, name)).mode & 0o777, 0o600);
  }
  assertClean(f);
});

test("a publication collision cannot overwrite an existing recovery point", (t) => {
  const f = fixture(t);
  const name = `fixture-daily-${timestamp}-AAAAAAAAAA.sql.gz`;
  const original = Buffer.from("existing recovery evidence");
  const existing = f.seed(name, 0, original);
  const result = f.run("collision");
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.files(), [name]);
  assert.deepEqual(readFileSync(existing), original);
  assertClean(f);
});

test("a colliding directory cannot absorb publication or permit retention", (t) => {
  const f = fixture(t);
  const old = f.seed();
  const collision = path.join(f.backup, `fixture-daily-${timestamp}-AAAAAAAAAA.sql.gz`);
  mkdirSync(collision);
  const result = f.run("collision");
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(collision), []);
  assert.ok(existsSync(old));
  assertClean(f);
});

test("a colliding directory symlink cannot redirect publication", { skip: process.platform === "win32" && "Windows symlinks require optional developer/admin privileges" }, (t) => {
  const f = fixture(t);
  const old = f.seed();
  const target = path.join(f.directory, "unowned-directory");
  mkdirSync(target);
  symlinkSync(target, path.join(f.backup, `fixture-daily-${timestamp}-AAAAAAAAAA.sql.gz`), "dir");
  const result = f.run("collision");
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(target), []);
  assert.ok(existsSync(old));
  assertClean(f);
});

for (const database of ["../outside", "fixture/name", "fixture\nname", "fixture\rname"]) {
  test(`rejects database filename separators ${JSON.stringify(database)} before dumping`, (t) => {
    const f = fixture(t);
    const env = path.join(f.directory, ".env");
    // Construct control bytes after Bash parses the source line. Git Bash can
    // normalize physical CR bytes in script input before the guard sees them.
    const encodedDatabase = database.replaceAll("\\", "\\\\").replaceAll("'", "\\'")
      .replaceAll("\n", "\\n").replaceAll("\r", "\\r");
    writeFileSync(env, readFileSync(env, "utf8") + `POSTGRES_DB=$'${encodedDatabase}'\n`);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /POSTGRES_DB cannot contain path separators or line breaks/);
    assert.deepEqual(f.calls(), []);
    assert.deepEqual(f.files(), []);
    assertClean(f);
  });
}

for (const tool of ["rclone", "aws", "scp"]) {
  test(`${tool} upload failure keeps validated local output and all prior backups`, (t) => {
    const f = fixture(t, { uploads: ["rclone", "aws", "scp"] });
    const old = f.seed();
    writeFileSync(path.join(f.directory, "require-old"), "required\n");
    const result = f.run(`${tool}-fail`);
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(old));
    assert.equal(f.files().length, 2);
    for (const name of f.files()) assert.equal(gunzipSync(readFileSync(path.join(f.backup, name))).toString(), sql);
    const order = ["rclone", "aws", "scp"];
    assert.deepEqual(f.calls().filter((call) => order.includes(call)), order.slice(0, order.indexOf(tool) + 1));
    assertClean(f);
  });

  test(`missing configured ${tool} fails before dump or rotation`, (t) => {
    const f = fixture(t, { uploads: [tool], missingTool: tool });
    const old = f.seed();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${tool} is not installed`));
    assert.deepEqual(f.calls(), []);
    assert.deepEqual(f.files(), [oldName]);
    assert.ok(existsSync(old));
    assertClean(f);
  });
}

test("successful uploads precede narrowly owned rotation and preserve recovery holds", (t) => {
  const f = fixture(t, { uploads: ["rclone", "aws", "scp"] });
  const expired = f.seed();
  writeFileSync(path.join(f.directory, "require-old"), "required\n");
  const preserved = [
    f.seed("fixture-daily-20260102-030000-AAAAAAAAAA.sql.gz", 15 * day - 60_000),
    f.seed("fixture-daily-20260103-030000-AAAAAAAAAA.sql.gz", -day),
    f.seed("other-daily-20260101-030000-AAAAAAAAAA.sql.gz"),
    f.seed("fixture-20260101-030000.sql.gz"),
    f.seed("fixture-before-RELEASE.sql.gz"),
    f.seed("fixture-daily-not-owned.sql.gz"),
    f.seed("recovery-hold/fixture-daily-20260101-030000-AAAAAAAAAA.sql.gz"),
    f.seed("operator-evidence.txt", 20 * day, "private evidence\n"),
    f.seed(".env.backup", 20 * day, "synthetic configuration\n"),
    f.seed("unowned.partial", 20 * day, "partial evidence\n"),
  ];
  const held = f.seed("fixture-daily-20260104-030000-AAAAAAAAAA.sql.gz");
  writeFileSync(`${held}.hold`, "Release recovery point; retain until reviewed.\n");
  preserved.push(held, `${held}.hold`);
  const directoryHeld = f.seed("fixture-daily-20260105-030000-AAAAAAAAAA.sql.gz");
  mkdirSync(`${directoryHeld}.hold`);
  preserved.push(directoryHeld, `${directoryHeld}.hold`);
  const boundaryExpired = f.seed("fixture-daily-20260106-030000-AAAAAAAAAA.sql.gz", 15 * day + 60_000);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls().filter((call) => ["rclone", "aws", "scp"].includes(call)), ["rclone", "aws", "scp"]);
  assert.equal(existsSync(expired), false);
  assert.equal(existsSync(boundaryExpired), false);
  for (const file of preserved) assert.ok(existsSync(file), `Expected preservation of ${file}`);
  assertClean(f);
});

test("retention preserves the current publication even if its mtime appears expired", (t) => {
  const f = fixture(t);
  const expired = f.seed();
  const result = f.run("current-old");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(expired), false);
  const files = f.files();
  assert.equal(files.length, 1);
  assert.match(files[0], /^fixture-daily-20261103-030000-[A-Za-z0-9]{10}\.sql\.gz$/);
  const current = path.join(f.backup, files[0]);
  assert.ok(statSync(current).mtimeMs < Date.now() - 15 * day);
  assert.equal(gunzipSync(readFileSync(current)).toString(), sql);
  assertClean(f);
});

test("dangling holds and archive symlinks remain outside rotation", { skip: process.platform === "win32" && "Windows symlinks require optional developer/admin privileges" }, (t) => {
  const f = fixture(t);
  const held = f.seed();
  symlinkSync("missing-release-review", `${held}.hold`);
  const target = f.seed("recovery-hold/symlink-target.sql.gz");
  const archiveLink = path.join(f.backup, "fixture-daily-20260107-030000-AAAAAAAAAA.sql.gz");
  symlinkSync(target, archiveLink);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(held));
  assert.ok(readdirSync(f.backup).includes(`${oldName}.hold`));
  assert.ok(lstatSync(archiveLink).isSymbolicLink());
  assert.equal(gunzipSync(readFileSync(target)).toString(), sql);
  assertClean(f);
});

test("concurrent runs cannot publish or clean the active owner's private staging", async (t) => {
  const f = fixture(t);
  const first = f.start("barrier");
  await waitFor(path.join(f.directory, "ready"));
  const lock = path.join(f.backup, ".backup.lock");
  const partials = readdirSync(lock);
  assert.equal(partials.length, 1);
  assert.match(partials[0], /^dump\.partial\.[A-Za-z0-9]{10}$/);
  assert.deepEqual(f.files(), []);
  if (process.platform !== "win32") {
    assert.equal(statSync(lock).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(lock, partials[0])).mode & 0o777, 0o600);
  }
  const second = f.run();
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Backup lock exists or cannot be created/);
  assert.deepEqual(readdirSync(lock), partials);
  assert.equal(f.calls().filter((call) => call === "docker").length, 1);
  assert.deepEqual(f.files(), []);
  writeFileSync(path.join(f.directory, "release"), "release\n");
  const result = await first;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.files().length, 1);
  assertClean(f);
});

test("TERM cleans owned staging, preserves unrelated evidence and permits retry", (t) => {
  const f = fixture(t);
  f.seed();
  const unowned = f.seed("another-run.partial", 0, "do not remove\n");
  const result = f.run("term");
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.files(), [oldName]);
  assert.equal(readFileSync(unowned, "utf8"), "do not remove\n");
  assertClean(f);
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.files().length, 1);
  assert.equal(readFileSync(unowned, "utf8"), "do not remove\n");
  assertClean(f);
});

test("abrupt interruption leaves a fail-closed lock and retry never sweeps its artifacts", (t) => {
  const f = fixture(t);
  f.seed();
  const result = f.run("killed");
  assert.notEqual(result.status, 0);
  const lock = path.join(f.backup, ".backup.lock");
  assert.ok(existsSync(lock));
  const artifacts = readdirSync(lock).map((name) => [name, readFileSync(path.join(lock, name))]);
  assert.equal(artifacts.length, 1);
  assert.deepEqual(f.files(), [oldName]);
  const retry = f.run();
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /Inspect the owner before retrying/);
  assert.deepEqual(readdirSync(lock).map((name) => [name, readFileSync(path.join(lock, name))]), artifacts);
  assert.deepEqual(f.files(), [oldName]);
});
