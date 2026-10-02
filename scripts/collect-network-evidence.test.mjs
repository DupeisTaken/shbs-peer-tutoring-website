import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const bash = process.env.SHBS_TEST_BASH ?? "bash";
const container = "a".repeat(64);
const network = "b".repeat(64);
const image = `sha256:${"c".repeat(64)}`;

// Exercise the real collector with a sealed command PATH. Unexpected commands
// fail, and Docker/ss are always fixtures: tests cannot query the host or network.
function collect(t, scenario = "normal", directory = "private") {
  const dir = mkdtempSync(path.join(tmpdir(), "shbs-network-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "bin"));
  mkdirSync(path.join(dir, "private"));
  copyFileSync(
    path.join(root, "scripts/collect-network-evidence.sh"),
    path.join(dir, "collector.sh"),
  );
  writeFileSync(
    path.join(dir, ".env"),
    "$(touch ENV_WAS_EXECUTED)\nAUTH_SECRET=PRIVATE_SENTINEL\n",
  );
  const docker = `#!/usr/bin/env bash
printf '%s\\t' "$@" >> calls.log
printf '\\n' >> calls.log
[[ "$1" = --host && "$2" = unix:///var/run/docker.sock ]] || exit 90
[[ -z "\${DOCKER_CONTEXT:-}\${DOCKER_HOST:-}\${DOCKER_TLS_VERIFY:-}\${DOCKER_CERT_PATH:-}\${DOCKER_TLS:-}" ]] || exit 91
shift 2
if [[ "$SCENARIO" = denied ]]; then echo PRIVATE_SENTINEL; echo PRIVATE_SENTINEL >&2; exit 1; fi
case "$1 $2" in
  'version --format') echo '28.0.0' ;;
  'ps --all')
    case "$SCENARIO" in
      empty) exit 0 ;;
      invalid) echo '--malicious-argument' ;;
      many) for i in {1..13}; do echo '${container}'; done ;;
      oversized) head -c 70000 /dev/zero | tr '\\0' x ;;
      newlines) head -c 70000 /dev/zero | tr '\\0' '\\n' ;;
      *) echo '${container}' ;;
    esac ;;
  'inspect --type')
    [[ "$3" = container && "$4" = --format && "$6" = '${container}' ]] || exit 92
    if [[ "$5" = '{{.Image}}' ]]; then
      [[ "$SCENARIO" != badimage ]] || { echo '--invalid-image'; exit 0; }
      echo '${image}'
    else
      echo 'project="shbs" service="db" network_mode="bridge" effective_ports={"5432/tcp":null} mounts=type="volume",name="shbs_db-data",destination="/var/lib/postgresql/data";'
    fi ;;
  'image inspect')
    [[ "$3" = --format && "$5" = '${image}' ]] || exit 93
    echo 'digests=["example/app@sha256:synthetic"] revision="synthetic-source"' ;;
  'network ls')
    if [[ "$SCENARIO" = manynetworks ]]; then
      for i in {1..9}; do echo '${network}'; done
    elif [[ "$SCENARIO" = invalidnetwork ]]; then echo '--bad-network';
    elif [[ "$SCENARIO" = emptynetworks ]]; then exit 0;
    else echo '${network}'; fi ;;
  'network inspect')
    [[ "$3" = --format && "$5" = '${network}' ]] || exit 94
    echo 'name="shbs_default" driver="bridge" ipv6=false gateway_mode_ipv4="nat"' ;;
  *) exit 95 ;;
esac
`;
  const stubs = {
    docker,
    ip: `#!/usr/bin/env bash
printf '%s\\t' ip "$@" >> calls.log
printf '\\n' >> calls.log
[[ "$SCENARIO" != addressfail ]] || { echo PRIVATE_SENTINEL; exit 1; }
echo 'synthetic-interface-route'
`,
    ss: `#!/usr/bin/env bash
printf '%s\\t' ss "$@" >> calls.log
printf '\\n' >> calls.log
[[ "$SCENARIO" != listenerfail ]] || { echo PRIVATE_SENTINEL; exit 1; }
echo 'LISTEN 0 128 127.0.0.1:22 *:*'
`,
    timeout: `#!/usr/bin/env bash
[[ "$1" = --signal=TERM && "$2" = --kill-after=1s && "$3" = 8s ]] || exit 96
if [[ "$SCENARIO" = timeout ]]; then echo PRIVATE_SENTINEL; exit 124; fi
exec /usr/bin/timeout "$@"
`,
  };
  for (const [name, content] of Object.entries(stubs)) {
    const file = path.join(dir, "bin", name);
    writeFileSync(file, content);
    chmodSync(file, 0o755);
  }
  // Advance Bash's clock at the first budget check without sleeping or changing
  // the collector. All other cases execute the file in a normal child shell.
  const wrapper = `export PATH="$PWD/bin:/usr/bin:/bin"
if [[ "$SCENARIO" = budget ]]; then
  set -T
  trap '[[ "$BASH_COMMAND" != remaining=* ]] || SECONDS=$((started + 121))' DEBUG
  source ./collector.sh "$1"
else
  bash ./collector.sh "$1"
fi
`;
  const result = spawnSync(
    bash,
    ["--noprofile", "--norc", "-c", wrapper, "collector-test", directory],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        SCENARIO: scenario,
        DOCKER_HOST: "ssh://never-contact.example.test",
        DOCKER_CONTEXT: "never-contact",
        DOCKER_TLS: "1",
        DOCKER_TLS_VERIFY: "1",
        DOCKER_CERT_PATH: "/never-read",
      },
    },
  );
  assert.ifError(result.error);
  const runs = readdirSync(path.join(dir, "private"));
  const evidence = runs.length
    ? path.join(dir, "private", runs[0], "evidence.txt")
    : null;
  const report = evidence ? readFileSync(evidence, "utf8") : "";
  const calls = existsSync(path.join(dir, "calls.log"))
    ? readFileSync(path.join(dir, "calls.log"), "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => line.split("\t").filter(Boolean))
    : [];
  assert.doesNotMatch(
    report + result.stdout + result.stderr,
    /PRIVATE_SENTINEL/,
  );
  assert.equal(existsSync(path.join(dir, "ENV_WAS_EXECUTED")), false);
  return { ...result, report, calls, evidence };
}

test("captures both IP families and selected actual mappings, mounts and image identity", (t) => {
  const result = collect(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.report, /collection_incomplete=0/);
  assert.match(result.report, /VERDICT: OPERATOR VERIFICATION PENDING/);
  assert.match(
    result.report,
    /Cloud\/firewall\/SSH\/runtime proxy configuration\/external reachability: NOT COLLECTED/,
  );
  assert.match(result.report, /shbs_db-data/);
  assert.match(result.report, /synthetic-source/);
  assert.deepEqual(
    result.calls.filter((c) => c[0] === "ss"),
    [
      ["ss", "-4", "-lntup"],
      ["ss", "-6", "-lntup"],
    ],
  );
  assert.deepEqual(
    result.calls.filter((c) => c[0] === "ip"),
    [
      ["ip", "-brief", "address", "show"],
      ["ip", "-4", "route", "show"],
      ["ip", "-6", "route", "show"],
    ],
  );
  assert.doesNotMatch(result.stdout, /shbs_db-data|synthetic-source|LISTEN/);
  if (process.platform !== "win32") {
    assert.equal(statSync(result.evidence).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(result.evidence)).mode & 0o777, 0o700);
  }
  // Assert the command boundary too: full configuration must never be emitted.
  for (const call of result.calls.filter((c) => !["ss", "ip"].includes(c[0]))) {
    assert.deepEqual(call.slice(0, 2), [
      "--host",
      "unix:///var/run/docker.sock",
    ]);
    assert.doesNotMatch(
      call.join(" "),
      /\.Env|{{\s*(?:json\s+)?\.Config\s*}}|json \.Labels|json \.Options/,
    );
    assert.ok(
      ["version", "ps", "inspect", "image", "network"].includes(call[2]),
    );
    if (call[2] === "image") assert.equal(call[3], "inspect");
    if (call[2] === "network") assert.ok(["ls", "inspect"].includes(call[3]));
  }
});

for (const scenario of [
  "denied",
  "listenerfail",
  "addressfail",
  "timeout",
  "budget",
  "empty",
  "invalid",
  "badimage",
  "oversized",
  "newlines",
  "many",
  "manynetworks",
  "invalidnetwork",
  "emptynetworks",
]) {
  test(`records ${scenario} as an explicit collection gap without leaking failed output`, (t) => {
    const result = collect(t, scenario);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.report, /UNAVAILABLE/);
    assert.match(result.report, /collection_incomplete=1/);
    assert.match(result.report, /VERDICT: OPERATOR VERIFICATION PENDING/);
    assert.ok(result.report.length < 100_000);
    assert.equal(
      result.calls.some(
        (c) =>
          c.includes("--malicious-argument") ||
          c.includes("--bad-network") ||
          c.includes("--invalid-image"),
      ),
      false,
    );
    if (scenario === "budget") {
      assert.match(result.report, /collection time budget exhausted/);
      assert.deepEqual(result.calls, []);
    }
    if (scenario === "many")
      assert.equal(result.calls.filter((c) => c[2] === "image").length, 12);
    if (scenario === "manynetworks")
      assert.equal(
        result.calls.filter((c) => c[2] === "network" && c[3] === "inspect")
          .length,
        8,
      );
  });
}

test("rejects missing output directories before collecting anything", (t) => {
  const result = collect(t, "normal", "missing");
  assert.equal(result.status, 64);
  assert.deepEqual(result.calls, []);
  assert.equal(result.evidence, null);
});
