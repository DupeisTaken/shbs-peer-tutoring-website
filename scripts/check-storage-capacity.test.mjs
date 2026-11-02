import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const bash = process.env.SHBS_TEST_BASH ?? "bash";
const GiB = 1073741824;

// Invoke the real Bash entrypoint with synthetic measurement commands. No test
// contacts a daemon, reads a production filesystem, or runs a deployment.
function preflight(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "shbs-storage-check-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("shbs-storage-check-"));
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(path.join(directory, "bin"));
  mkdirSync(path.join(directory, "disk with spaces"));
  mkdirSync(path.join(directory, "-disk"));
  copyFileSync(
    path.join(root, "scripts/check-storage-capacity.sh"),
    path.join(directory, "preflight.sh"),
  );
  writeFileSync(
    path.join(directory, ".env"),
    "$(touch ENV_WAS_EXECUTED)\nAUTH_SECRET=PRIVATE_SENTINEL\n",
  );
  const stubs = {
    df: `#!/usr/bin/env bash
printf 'df\\t' >> calls.log
printf '%s\\t' "$@" >> calls.log
printf '\\n' >> calls.log
case "$SCENARIO" in
  denied) echo PRIVATE_SENTINEL; echo PRIVATE_SENTINEL >&2; exit 1 ;;
  hanging) exec /usr/bin/sleep 30 ;;
  oversized) head -c 5000 /dev/zero | tr '\\0' x; exit 0 ;;
  newlines) head -c 5000 /dev/zero | tr '\\0' '\\n'; exit 0 ;;
  noheader) printf '%s %s\\n' "$DF_TOTAL" "$DF_AVAILABLE"; exit 0 ;;
  badheader) printf 'unrecognized columns\\n%s %s\\n' "$DF_TOTAL" "$DF_AVAILABLE"; exit 0 ;;
  extra) printf '1B-blocks Avail\\n1 1\\n2 2\\n'; exit 0 ;;
  garbage) printf '1B-blocks Avail\\nPRIVATE_SENTINEL\\n'; exit 0 ;;
  trailing) printf '1B-blocks Avail\\n%s %s\\nPRIVATE_SENTINEL\\n' "$DF_TOTAL" "$DF_AVAILABLE"; exit 0 ;;
  partialfail) printf '1B-blocks Avail\\n%s %s\\n' "$DF_TOTAL" "$DF_AVAILABLE"; exit 1 ;;
esac
if [[ "$1" = --block-size=1 && "$2" = --output=size,avail && "$3" = -- && $# = 4 ]]; then
  if [[ "$SCENARIO" = padded ]]; then
    printf '1B-blocks Avail\\n%s %s\\n' "$DF_TOTAL" "$DF_AVAILABLE"
    printf '%*s' "$DF_PADDING" ''
    exit 0
  fi
  [[ "$SCENARIO" != warnings ]] || echo PRIVATE_SENTINEL >&2
  printf '  1B-blocks  Avail\\n%s %s\\n' "$DF_TOTAL" "$DF_AVAILABLE"
elif [[ "$1" = --output=itotal,iavail && "$2" = -- && $# = 3 ]]; then
  case "$SCENARIO" in
    inodefail) echo PRIVATE_SENTINEL >&2; exit 1 ;;
    inodeoversized) head -c 5000 /dev/zero | tr '\\0' x; exit 0 ;;
    inodegarbage) printf 'Inodes IFree\\nPRIVATE_SENTINEL\\n'; exit 0 ;;
    inodeextra) printf 'Inodes IFree\\n1000 500\\n1000 500\\n'; exit 0 ;;
    inodeunsupported) printf 'Inodes IFree\\n- -\\n'; exit 0 ;;
    inodepartialfail) printf 'Inodes IFree\\n1000 500\\n'; exit 1 ;;
  esac
  [[ "$SCENARIO" != warnings ]] || echo PRIVATE_SENTINEL >&2
  printf 'Inodes IFree\\n%s %s\\n' "$DF_INODES" "$DF_IFREE"
else
  exit 90
fi
`,
    timeout: `#!/usr/bin/env bash
[[ "$1" = --signal=TERM && "$2" = --kill-after=1s && "$3" = 5s && "$4" = df ]] || exit 91
if [[ "$SCENARIO" = timeout ]]; then echo PRIVATE_SENTINEL; exit 124; fi
if [[ "$SCENARIO" = inodetimeout && "$5" = --output=itotal,iavail ]]; then echo PRIVATE_SENTINEL; exit 124; fi
exec /usr/bin/timeout "$@"
`,
    docker: "#!/usr/bin/env bash\necho DOCKER_WAS_CALLED >&2\nexit 92\n",
  };
  // Missing-tool cases expose only synthetic commands to command -v. Bash is
  // already running, and the helper must stop before executing any measurement.
  if (options.missingTool) stubs.head = "#!/usr/bin/env bash\nexit 93\n";
  for (const [name, source] of Object.entries(stubs)) {
    if (name === options.missingTool) continue;
    const file = path.join(directory, "bin", name);
    writeFileSync(file, source);
    chmodSync(file, 0o755);
  }
  const args = options.args ?? ["disk with spaces", "10"];
  const result = spawnSync(
    bash,
    [
      "--noprofile", "--norc", "-c",
      'if [[ -n "$MISSING_TOOL" ]]; then export PATH="$PWD/bin"; else export PATH="$PWD/bin:/usr/bin:/bin"; fi; exec "$BASH" ./preflight.sh "$@"',
      "storage-test", ...args,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        BASH_ENV: "",
        SCENARIO: options.scenario ?? "normal",
        MISSING_TOOL: options.missingTool ?? "",
        DF_PADDING: String(options.padding ?? 0),
        DF_TOTAL: String(options.total ?? 100 * GiB),
        DF_AVAILABLE: String(options.available ?? 30 * GiB),
        DF_INODES: String(options.inodes ?? 1000),
        DF_IFREE: String(options.ifree ?? 500),
        DOCKER_HOST: "ssh://never-contact.example.test",
        DOCKER_CONTEXT: "never-contact",
      },
    },
  );
  assert.ifError(result.error);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL|DOCKER_WAS_CALLED/);
  assert.equal(existsSync(path.join(directory, "ENV_WAS_EXECUTED")), false);
  assert.equal(existsSync(path.join(directory, "ARG_WAS_EXECUTED")), false);
  const calls = existsSync(path.join(directory, "calls.log"))
    ? readFileSync(path.join(directory, "calls.log"), "utf8")
        .trim().split("\n").map((line) => line.split("\t").filter(Boolean))
    : [];
  return { ...result, calls };
}

test("passes exactly at peak plus 20% reserve and handles a path with spaces", (t) => {
  const result = preflight(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /assessment=HEADROOM_OK/);
  assert.match(result.stdout, /required_available_bytes=32212254720/);
  assert.deepEqual(result.calls, [
    ["df", "--block-size=1", "--output=size,avail", "--", "disk with spaces"],
    ["df", "--output=itotal,iavail", "--", "disk with spaces"],
  ]);
});

test("fails one byte below the required reserve", (t) => {
  const result = preflight(t, { available: 30 * GiB - 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /assessment=INSUFFICIENT/);
});

test("uses ordinary-write available bytes, not total free/reserved capacity", (t) => {
  const result = preflight(t, { total: 41882943488, available: 3328741376 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /available_bytes=3328741376/);
  assert.match(result.stdout, /reserve_bytes=8376588698/);
});

test("keeps a minimum 5 GiB reserve on smaller filesystems", (t) => {
  const result = preflight(t, { total: 20 * GiB, available: 15 * GiB });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /reserve_bytes=5368709120/);
});

test("fails one byte below the minimum reserve", (t) => {
  assert.equal(preflight(t, { total: 20 * GiB, available: 15 * GiB - 1 }).status, 1);
});

test("rounds fractional 20% reserves up, never down", (t) => {
  assert.equal(preflight(t, { total: 100 * GiB + 1 }).status, 1);
});

test("accepts the rounded-up reserve boundary", (t) => {
  assert.equal(preflight(t, { total: 100 * GiB + 1, available: 30 * GiB + 1 }).status, 0);
});

test("rejects exhausted inodes even when byte headroom is sufficient", (t) => {
  const result = preflight(t, { ifree: 0 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /available_inodes=0/);
});

test("protects a leading-dash path with df's option terminator", (t) => {
  const result = preflight(t, { args: ["-disk", "10"] });
  assert.equal(result.status, 0);
  assert.equal(result.calls[0].at(-1), "-disk");
});

for (const scenario of ["denied", "timeout", "oversized", "newlines", "noheader", "badheader", "extra", "garbage", "trailing", "partialfail", "inodefail", "inodeoversized", "inodegarbage", "inodeextra", "inodeunsupported", "inodepartialfail", "inodetimeout"]) {
  test(`returns UNKNOWN without diagnostics for ${scenario} measurements`, (t) => {
    const result = preflight(t, { scenario });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /assessment=UNKNOWN/);
    assert.doesNotMatch(result.stdout, /HEADROOM_OK/);
    // A failed second observation must discard the successful byte observation.
    assert.equal(result.stdout, "");
    assert.equal(result.calls.length, scenario === "timeout" ? 0 : scenario === "inodetimeout" ? 1 : scenario.startsWith("inode") ? 2 : 1);
  });
}

for (const missingTool of ["df", "timeout", "head"]) {
  test(`returns UNKNOWN before measuring when ${missingTool} is missing`, (t) => {
    const result = preflight(t, { missingTool });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /assessment=UNKNOWN.*tool unavailable/);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.calls, []);
  });
}

test("terminates a genuinely hanging synthetic measurement within its time budget", (t) => {
  // The real timeout owns and terminates this fixture's sleep process; the test
  // never signals a shared runtime or searches for unrelated process names.
  const result = preflight(t, { scenario: "hanging" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /assessment=UNKNOWN/);
  assert.equal(result.stdout, "");
  assert.equal(result.calls.length, 1);
});

test("discards private diagnostics even when both observations succeed", (t) => {
  const result = preflight(t, { scenario: "warnings" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

for (const length of [4096, 4097]) {
  test(`handles a measurement at the ${length}-byte output boundary`, (t) => {
    const row = `1B-blocks Avail\n${100 * GiB} ${30 * GiB}\n`;
    const result = preflight(t, { scenario: "padded", padding: length - row.length });
    assert.equal(result.status, length === 4096 ? 0 : 2);
  });
}

for (const [name, values] of Object.entries({
  zeroTotal: { total: 0, available: 0 },
  negativeAvailable: { available: -1 },
  impossibleAvailable: { available: 101 * GiB },
  integerOverflow: { total: "9999999999999999" },
  oversizedInteger: { total: "9999999999999999999999999" },
  aboveSafeInteger: { total: "9007199254740992" },
  fractionalAvailable: { available: "32212254720.0" },
  unsupportedBytes: { total: "-", available: "-" },
  zeroInodes: { inodes: 0, ifree: 0 },
  impossibleInodes: { ifree: 1001 },
  negativeInodes: { ifree: -1 },
  aboveSafeInodes: { inodes: "9007199254740992", ifree: "9007199254740992" },
  oversizedInodes: { inodes: "9999999999999999999999999" },
})) {
  test(`fails closed for ${name}`, (t) => {
    assert.equal(preflight(t, values).status, 2);
  });
}

for (const args of [
  [], ["disk with spaces"], ["missing", "10"], ["disk with spaces", "10", "extra"],
  ...["0", "-1", "1.5", "01", "1048577", "999999999999999999", "1+1", "$(touch ARG_WAS_EXECUTED)"].map((peak) => ["disk with spaces", peak]),
]) {
  test(`rejects invalid arguments before measurements: ${JSON.stringify(args)}`, (t) => {
    const result = preflight(t, { args });
    assert.equal(result.status, 64);
    assert.deepEqual(result.calls, []);
  });
}

test("supports the largest permitted peak without arithmetic wraparound", (t) => {
  const result = preflight(t, { args: ["disk with spaces", "1048576"], total: "9007199254740991", available: "9007199254740991" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /peak_bytes=1125899906842624/);
  assert.match(result.stdout, /reserve_bytes=1801439850948199/);
  assert.match(result.stdout, /required_available_bytes=2927339757790823/);
});

test("supports the smallest peak and one remaining inode", (t) => {
  const result = preflight(t, { args: ["disk with spaces", "1"], total: 10 * GiB, available: 6 * GiB, ifree: 1 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /required_available_bytes=6442450944/);
  assert.match(result.stdout, /available_inodes=1\n/);
});

test("accepts the largest supported inode count without losing precision", (t) => {
  const result = preflight(t, { inodes: "9007199254740991", ifree: "9007199254740991" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /total_inodes=9007199254740991/);
  assert.match(result.stdout, /available_inodes=9007199254740991/);
});

test("treats zero available bytes as insufficient rather than an unreadable measurement", (t) => {
  const result = preflight(t, { available: 0 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /available_bytes=0\n/);
});
