import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleRuntime } from "./assemble-runtime.mjs";

const script = path.join(import.meta.dirname, "assemble-runtime.mjs");

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "shbs-runtime-assembly-"));
  const owned = realpathSync(directory);
  t.after(() => {
    // Delete only this fixture's original directory, never a replaced link or
    // a computed ancestor. No application files or shared caches are touched.
    assert.equal(realpathSync(directory), owned);
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("shbs-runtime-assembly-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const standalone = path.join(directory, "standalone");
  const production = path.join(directory, "production");
  mkdirSync(standalone);
  mkdirSync(production);
  return {
    directory,
    standalone,
    production,
    output: path.join(directory, "runtime output"),
  };
}

function put(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function link(t, target, destination, type) {
  try {
    symlinkSync(target, destination, type);
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    t.skip(
      "This host cannot create the symlink fixture; Linux CI must cover it.",
    );
    return false;
  }
}

// Include directory entries, modes, times and raw link targets. Never dereference
// a link while comparing inputs or checking dependency stability across releases.
function inventory(root) {
  const result = [];
  function visit(relative) {
    const file = path.join(root, relative);
    const metadata = lstatSync(file);
    const type = metadata.isDirectory()
      ? "directory"
      : metadata.isSymbolicLink()
        ? "symlink"
        : "file";
    result.push({
      relative,
      type,
      mode: metadata.mode & 0o7777,
      mtime: metadata.mtimeMs,
      value:
        type === "symlink"
          ? readlinkSync(file)
          : type === "file"
            ? readFileSync(file, "hex")
            : null,
    });
    if (type === "directory")
      for (const name of readdirSync(file).sort())
        visit(path.join(relative, name));
  }
  visit("");
  return result;
}

test("separates app assets and merges production winners with traced-only dependencies", (t) => {
  const f = fixture(t);
  put(f.standalone, "server.js", "server");
  put(f.standalone, ".next/server/route.js", "route");
  put(f.standalone, "node_modules/shared/index.js", "traced version");
  put(
    f.standalone,
    "node_modules/shared/traced-only.js",
    "required traced file",
  );
  put(f.standalone, "node_modules/only-traced/index.js", "traced package");
  put(f.production, "shared/index.js", "production version");
  put(f.production, "only-production/index.js", "production package");
  const before = [inventory(f.standalone), inventory(f.production)];

  const result = assembleRuntime(f.standalone, f.production, f.output);
  assert.equal(
    readFileSync(path.join(result.appPath, "server.js"), "utf8"),
    "server",
  );
  assert.equal(
    readFileSync(path.join(result.appPath, ".next/server/route.js"), "utf8"),
    "route",
  );
  assert.equal(existsSync(path.join(result.appPath, "node_modules")), false);
  for (const [relative, expected] of [
    ["shared/index.js", "production version"],
    ["shared/traced-only.js", "required traced file"],
    ["only-traced/index.js", "traced package"],
    ["only-production/index.js", "production package"],
  ])
    assert.equal(
      readFileSync(path.join(result.dependenciesPath, relative), "utf8"),
      expected,
    );
  assert.deepEqual([inventory(f.standalone), inventory(f.production)], before);
});

test("supports standalone trees without dependencies and preserves empty directories", (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.standalone, "empty-assets"));
  mkdirSync(path.join(f.production, "empty-package"));
  const result = assembleRuntime(f.standalone, f.production, f.output);
  assert.deepEqual(readdirSync(path.join(result.appPath, "empty-assets")), []);
  assert.deepEqual(
    readdirSync(path.join(result.dependenciesPath, "empty-package")),
    [],
  );
});

test(
  "preserves executable modes and takes production permissions at collisions",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    chmodSync(put(f.standalone, "server.js", "server"), 0o750);
    chmodSync(put(f.standalone, "node_modules/pkg/cli.js", "traced"), 0o644);
    chmodSync(put(f.production, "pkg/cli.js", "production"), 0o755);
    chmodSync(path.join(f.production, "pkg"), 0o750);
    const result = assembleRuntime(f.standalone, f.production, f.output);
    assert.equal(
      lstatSync(path.join(result.appPath, "server.js")).mode & 0o777,
      0o750,
    );
    assert.equal(
      lstatSync(path.join(result.dependenciesPath, "pkg/cli.js")).mode & 0o777,
      0o755,
    );
    assert.equal(
      lstatSync(path.join(result.dependenciesPath, "pkg")).mode & 0o777,
      0o750,
    );
  },
);

test("preserves relative, dangling and external link targets without copying their contents", (t) => {
  const f = fixture(t);
  put(f.standalone, "node_modules/pkg/cli.js", "traced cli");
  mkdirSync(path.join(f.standalone, "node_modules/.bin"));
  if (
    !link(
      t,
      "../pkg/cli.js",
      path.join(f.standalone, "node_modules/.bin/cli"),
      "file",
    )
  )
    return;
  if (
    !link(
      t,
      "missing-runtime-target",
      path.join(f.standalone, "dangling"),
      "file",
    )
  )
    return;
  const external = put(
    f.directory,
    "external/private.txt",
    "external sentinel",
  );
  if (
    !link(
      t,
      path.dirname(external),
      path.join(f.standalone, "external-link"),
      "dir",
    )
  )
    return;
  const before = inventory(f.standalone);
  const result = assembleRuntime(f.standalone, f.production, f.output);
  assert.equal(
    readlinkSync(path.join(result.dependenciesPath, ".bin/cli")),
    "../pkg/cli.js",
  );
  assert.equal(
    readlinkSync(path.join(result.appPath, "dangling")),
    "missing-runtime-target",
  );
  assert.equal(
    readlinkSync(path.join(result.appPath, "external-link")),
    path.dirname(external),
  );
  assert.deepEqual(inventory(f.standalone), before);
  assert.equal(
    inventory(result.appPath).some(({ relative }) =>
      relative.endsWith("private.txt"),
    ),
    false,
  );
  assert.equal(readFileSync(external, "utf8"), "external sentinel");
});

test("production links replace traced links while retaining their literal targets", (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.standalone, "node_modules"));
  if (
    !link(
      t,
      "traced-target",
      path.join(f.standalone, "node_modules/tool"),
      "file",
    )
  )
    return;
  if (!link(t, "production-target", path.join(f.production, "tool"), "file"))
    return;
  const result = assembleRuntime(f.standalone, f.production, f.output);
  assert.equal(
    readlinkSync(path.join(result.dependenciesPath, "tool")),
    "production-target",
  );
});

for (const tracedDirectory of [false, true]) {
  test(`rejects ${tracedDirectory ? "directory/file" : "file/directory"} conflicts before creating output`, (t) => {
    const f = fixture(t);
    if (tracedDirectory) {
      put(f.standalone, "node_modules/conflict/child", "traced");
      put(f.production, "conflict", "production");
    } else {
      put(f.standalone, "node_modules/conflict", "traced");
      put(f.production, "conflict/child", "production");
    }
    const before = [inventory(f.standalone), inventory(f.production)];
    assert.throws(
      () => assembleRuntime(f.standalone, f.production, f.output),
      /Conflicting filesystem types/,
    );
    assert.equal(existsSync(f.output), false);
    assert.deepEqual(
      [inventory(f.standalone), inventory(f.production)],
      before,
    );
  });
}

test("rejects symlink/directory conflicts without writing through the link", (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.standalone, "node_modules"));
  const external = path.join(f.directory, "external");
  mkdirSync(external);
  if (
    !link(t, external, path.join(f.standalone, "node_modules/conflict"), "dir")
  )
    return;
  put(f.production, "conflict/escaped.txt", "must not escape");
  assert.throws(
    () => assembleRuntime(f.standalone, f.production, f.output),
    /Conflicting filesystem types/,
  );
  assert.equal(existsSync(f.output), false);
  assert.deepEqual(readdirSync(external), []);
});

test("rejects an existing output without changing its files", (t) => {
  const f = fixture(t);
  put(f.output, "keep.txt", "owned by somebody else");
  const before = inventory(f.output);
  assert.throws(
    () => assembleRuntime(f.standalone, f.production, f.output),
    /Output already exists/,
  );
  assert.deepEqual(inventory(f.output), before);
});

test("rejects existing dangling output links", (t) => {
  const f = fixture(t);
  if (!link(t, "missing-output", f.output, "file")) return;
  assert.throws(
    () => assembleRuntime(f.standalone, f.production, f.output),
    /Output already exists/,
  );
  assert.equal(readlinkSync(f.output), "missing-output");
});

test("rejects output ancestors that redirect writes through a link", (t) => {
  const f = fixture(t);
  const external = path.join(f.directory, "external");
  mkdirSync(external);
  const alias = path.join(f.directory, "alias");
  if (!link(t, external, alias, "dir")) return;
  assert.throws(
    () =>
      assembleRuntime(f.standalone, f.production, path.join(alias, "fresh")),
    /Output parent must be a real directory/,
  );
  assert.deepEqual(readdirSync(external), []);
});

for (const target of ["standalone", "production"]) {
  test(`rejects output nested in the ${target} source`, (t) => {
    const f = fixture(t);
    const before = [inventory(f.standalone), inventory(f.production)];
    assert.throws(
      () =>
        assembleRuntime(
          f.standalone,
          f.production,
          path.join(f[target], "output"),
        ),
      /must not overlap/,
    );
    assert.deepEqual(
      [inventory(f.standalone), inventory(f.production)],
      before,
    );
  });
}

test("rejects overlapping source trees", (t) => {
  const f = fixture(t);
  const nested = path.join(f.standalone, "node_modules");
  mkdirSync(nested);
  assert.throws(
    () => assembleRuntime(f.standalone, nested, f.output),
    /must not overlap/,
  );
  assert.equal(existsSync(f.output), false);
});

test("rejects source roots that are files or symbolic links", (t) => {
  const f = fixture(t);
  const file = put(f.directory, "not-a-directory", "input sentinel");
  assert.throws(
    () => assembleRuntime(file, f.production, f.output),
    /Source must be a real directory/,
  );
  assert.equal(readFileSync(file, "utf8"), "input sentinel");
  const alias = path.join(f.directory, "source-alias");
  if (!link(t, f.standalone, alias, "dir")) return;
  assert.throws(
    () => assembleRuntime(alias, f.production, f.output),
    /Source must be a real directory/,
  );
  assert.equal(existsSync(f.output), false);
});

test("does not create missing output parents", (t) => {
  const f = fixture(t);
  const absent = path.join(f.directory, "missing-parent");
  assert.throws(
    () =>
      assembleRuntime(f.standalone, f.production, path.join(absent, "output")),
    { code: "ENOENT" },
  );
  assert.equal(existsSync(absent), false);
});

test("rejects a linked top-level standalone node_modules rather than traversing it", (t) => {
  const f = fixture(t);
  if (!link(t, f.production, path.join(f.standalone, "node_modules"), "dir"))
    return;
  assert.throws(
    () => assembleRuntime(f.standalone, f.production, f.output),
    /node_modules must be a real directory/,
  );
  assert.equal(existsSync(f.output), false);
});

test(
  "rejects unsupported filesystem objects before writing output",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t);
    const socket = path.join(f.production, "unsupported.sock");
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    try {
      assert.throws(
        () => assembleRuntime(f.standalone, f.production, f.output),
        /Unsupported filesystem object/,
      );
      assert.equal(existsSync(f.output), false);
    } finally {
      // Close only the synthetic socket created by this individual test.
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test("app-only edits leave dependency inventory unchanged; dependency edits change it", (t) => {
  const f = fixture(t);
  put(f.standalone, "server.js", "release one");
  put(f.standalone, "node_modules/traced/index.js", "traced dependency");
  put(f.production, "pkg/index.js", "dependency one");
  const first = assembleRuntime(f.standalone, f.production, f.output);
  put(f.standalone, "server.js", "release two");
  const second = assembleRuntime(
    f.standalone,
    f.production,
    path.join(f.directory, "second"),
  );
  assert.notDeepEqual(inventory(first.appPath), inventory(second.appPath));
  assert.deepEqual(
    inventory(first.dependenciesPath),
    inventory(second.dependenciesPath),
  );
  put(f.production, "pkg/index.js", "dependency two");
  const third = assembleRuntime(
    f.standalone,
    f.production,
    path.join(f.directory, "third"),
  );
  assert.notDeepEqual(
    inventory(second.dependenciesPath),
    inventory(third.dependenciesPath),
  );
});

test("CLI assembles paths with spaces and fails clearly for invalid invocations", (t) => {
  const f = fixture(t);
  put(f.standalone, "server.js", "server");
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  };
  assert.equal(run().status, 64);
  const result = run(f.standalone, f.production, f.output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(path.join(f.output, "app/server.js"), "utf8"),
    "server",
  );
  const repeated = run(f.standalone, f.production, f.output);
  assert.equal(repeated.status, 1);
  assert.match(
    repeated.stderr,
    /Runtime assembly failed: Output already exists/,
  );
});
