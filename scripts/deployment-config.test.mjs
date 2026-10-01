import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";

const root = path.resolve(import.meta.dirname, "..");
const bash = process.env.SHBS_TEST_BASH ?? "bash";

// Execute the actual shell helper with an isolated .env and command boundary.
// Both engines are stubbed, so even a selection regression cannot contact Docker.
function runDatabase(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "shbs-database-binding-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "bin"));
  copyFileSync(
    path.join(root, "start-database.sh"),
    path.join(dir, "start-database.sh"),
  );
  writeFileSync(
    path.join(dir, ".env"),
    'DATABASE_URL="postgresql://postgres:synthetic-test-secret@localhost:55432/shbs_binding_test"\n',
  );
  const engine = `#!/usr/bin/env bash
printf '%s\\t' "$@" >> calls.log
printf '\\n' >> calls.log
case "$1" in
  info) exit "$STUB_INFO_EXIT" ;;
  ps) printf '%s' "$STUB_EXISTS" ;;
  inspect)
    if [ "$STUB_INSPECT_FAIL" = 1 ]; then exit 1; fi
    case "$3" in
      *PortBindings*) printf '%s' "$STUB_BINDINGS" ;;
      *NetworkMode*) printf '%s' "$STUB_NETWORK" ;;
      *State.Running*) printf '%s' "$STUB_RUNNING" ;;
      *) exit 80 ;;
    esac ;;
  run) echo synthetic-container ;;
  start) exit "$STUB_START_EXIT" ;;
  *) exit 81 ;;
esac
`;
  for (const name of ["docker", "podman", "nc"]) {
    const file = path.join(dir, "bin", name);
    writeFileSync(
      file,
      name === "nc"
        ? '#!/usr/bin/env bash\nexit "${STUB_PORT_BUSY:-1}"\n'
        : engine,
    );
    chmodSync(file, 0o755);
  }
  // Restrict executable lookup to stubs and Bash's tools, excluding host PATH.
  // Override only availability detection to exercise the Podman fallback safely.
  const wrapper = `export PATH="$PWD/bin:/usr/bin:/bin"
command() {
  if [ "$1" = -v ] && [ "$2" = docker ] && [ "$STUB_ENGINE" = podman ]; then return 1; fi
  builtin command "$@"
}
source ./start-database.sh
`;
  const result = spawnSync(bash, ["--noprofile", "--norc", "-c", wrapper], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      DB_BIND_ADDRESS: options.address ?? "",
      STUB_ENGINE: options.engine ?? "docker",
      STUB_EXISTS: options.exists ? "synthetic-container" : "",
      STUB_BINDINGS: options.bindings ?? "127.0.0.1:55432\n",
      STUB_NETWORK: options.network ?? "bridge",
      STUB_RUNNING: options.running ? "true" : "false",
      STUB_INSPECT_FAIL: options.inspectFail ? "1" : "0",
      STUB_START_EXIT: options.startFail ? "1" : "0",
      STUB_INFO_EXIT: options.daemonDown ? "1" : "0",
      STUB_PORT_BUSY: options.portBusy ? "0" : "1",
    },
  });
  assert.ifError(result.error);
  let calls = [];
  try {
    calls = readFileSync(path.join(dir, "calls.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.trimEnd().split("\t"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...result, calls };
}

for (const engine of ["docker", "podman"]) {
  test(`${engine}: default creation binds loopback and retains password authentication`, (t) => {
    const result = runDatabase(t, { engine });
    assert.equal(result.status, 0, result.stderr);
    const run = result.calls.find((call) => call[0] === "run");
    assert.ok(run);
    assert.equal(run[run.indexOf("-p") + 1], "127.0.0.1:55432:5432");
    assert.ok(run.includes("POSTGRES_PASSWORD=synthetic-test-secret"));
    assert.ok(run.includes("POSTGRES_USER=postgres"));
    assert.ok(run.includes("POSTGRES_DB=shbs_binding_test"));
    assert.ok(!run.some((arg) => /trust|host-network|publish-all/.test(arg)));
  });
}

for (const address of ["192.0.2.10", "0.0.0.0"]) {
  test(`remote publishing requires explicit ${address} opt-in`, (t) => {
    const result = runDatabase(t, { address });
    assert.equal(result.status, 0, result.stderr);
    const run = result.calls.find((call) => call[0] === "run");
    assert.equal(run[run.indexOf("-p") + 1], `${address}:55432:5432`);
    assert.match(result.stdout, /Warning: PostgreSQL will be published/);
  });
}

for (const address of [
  "localhost",
  "::",
  "127.0.0.1:1234",
  "999.0.0.1",
  "127.00.0.1",
  "127.0.0.1\n0.0.0.0",
]) {
  test(`refuses ambiguous or malformed bind address ${JSON.stringify(address)}`, (t) => {
    const result = runDatabase(t, { address });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /literal IPv4/);
    assert.deepEqual(result.calls, []);
  });
}

for (const bindings of [
  "0.0.0.0:55432\n",
  ":55432\n",
  "[::]:55432\n",
  "127.0.0.1:55432\n0.0.0.0:55432\n",
  "127.0.0.1:5432\n",
  "",
]) {
  for (const running of [false, true]) {
    test(`refuses ${running ? "running" : "stopped"} legacy/mismatched binding ${JSON.stringify(bindings)}`, (t) => {
      const result = runDatabase(t, { exists: true, bindings, running });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /does not match/);
      assert.ok(
        !result.calls.some((call) =>
          ["run", "start", "rm", "stop"].includes(call[0]),
        ),
      );
    });
  }
}

test("refuses host networking and inspection failures without mutating containers", (t) => {
  for (const options of [{ network: "host" }, { inspectFail: true }]) {
    const result = runDatabase(t, { exists: true, ...options });
    assert.equal(result.status, 1);
    assert.ok(
      !result.calls.some((call) =>
        ["run", "start", "rm", "stop"].includes(call[0]),
      ),
    );
  }
});

test("reuses a matching running container even though its port is already in use", (t) => {
  const result = runDatabase(t, {
    exists: true,
    running: true,
    portBusy: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already running/);
  assert.ok(!result.calls.some((call) => ["start", "run"].includes(call[0])));
});

test("starts a matching stopped container and reports startup failures accurately", (t) => {
  for (const startFail of [false, true]) {
    const result = runDatabase(t, { exists: true, startFail });
    assert.equal(result.status, startFail ? 1 : 0, result.stderr);
    assert.ok(result.calls.some((call) => call[0] === "start"));
    assert.ok(!result.calls.some((call) => call[0] === "run"));
    assert.equal(result.stdout.includes("was successfully created"), false);
    assert.equal(result.stdout.includes("started"), !startFail);
  }
});

test("preserves daemon-unavailable and occupied-port safeguards", (t) => {
  for (const options of [{ daemonDown: true }, { portBusy: true }]) {
    const result = runDatabase(t, options);
    assert.equal(result.status, 1);
    assert.ok(!result.calls.some((call) => ["run", "start"].includes(call[0])));
  }
});

test("production Compose publishes only the public web proxy", () => {
  const { services } = yaml.load(
    readFileSync(path.join(root, "docker-compose.yml"), "utf8"),
  );
  assert.equal(services.app.ports, undefined);
  assert.equal(services.db.ports, undefined);
  assert.deepEqual(services.caddy.ports, ["80:80", "443:443"]);
  for (const service of Object.values(services))
    assert.notEqual(service.network_mode, "host");
});

test("proxy policy preserves the single client-IP overwrite and separates enforced CSP from observation", () => {
  // These are config invariants, not a substitute for Caddy adaptation and live responses.
  const caddy = readFileSync(path.join(root, "Caddyfile"), "utf8");
  assert.equal(
    caddy.match(/header_up X-Signup-Client-IP \{remote_host\}/g)?.length,
    1,
  );
  assert.doesNotMatch(caddy, /header_up [+-]X-Signup-Client-IP/);
  assert.match(caddy, /header \{\s+defer/);
  assert.match(caddy, /Strict-Transport-Security "max-age=86400"/);
  assert.match(caddy, /X-Content-Type-Options "nosniff"/);
  assert.match(caddy, /Referrer-Policy "strict-origin-when-cross-origin"/);
  assert.match(caddy, /X-Frame-Options "DENY"/);
  assert.match(
    caddy,
    /Content-Security-Policy "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"/,
  );
  assert.match(
    caddy,
    /Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' https:\/\/o\.alicdn\.com;/,
  );
  assert.match(caddy, /-X-Powered-By/);
  assert.equal(caddy.match(/import browser_security_headers/g)?.length, 2);
  assert.match(
    caddy,
    /handle_errors \{\s+import browser_security_headers\s+respond "" \{err.status_code\}/,
  );
  assert.doesNotMatch(
    caddy,
    /(?:header_up|header_down) (?:[+-]?Cookie|[+-]?Set-Cookie)|tls internal/,
  );
});
