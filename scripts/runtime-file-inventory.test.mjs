import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inventory } from "./runtime-file-inventory.mjs";

const script = path.join(import.meta.dirname, "runtime-file-inventory.mjs");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "shbs-runtime-inventory-"));
  const owned = realpathSync(directory);
  t.after(() => {
    assert.equal(realpathSync(directory), owned);
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("shbs-runtime-inventory-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "app with spaces");
  mkdirSync(root);
  return { directory, root };
}

function put(root, relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function link(t, target, destination, type) {
  try {
    symlinkSync(target, destination, type);
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    t.skip(
      "Symlink creation is unavailable on this host; Linux CI must cover it.",
    );
    return false;
  }
}

test("inventories the root and all descendants in canonical portable order", async (t) => {
  const f = fixture(t);
  put(f.root, "z.txt", "last");
  put(f.root, "a/child.txt", "nested");
  mkdirSync(path.join(f.root, "empty"));
  const entries = await inventory(f.root);
  assert.deepEqual(
    entries.map(({ path: relative }) => relative),
    ["", "a", "a/child.txt", "empty", "z.txt"],
  );
  const root = entries[0];
  const metadata = lstatSync(f.root);
  assert.deepEqual(root, {
    path: "",
    type: "directory",
    mode: metadata.mode & 0o7777,
    uid: metadata.uid,
    gid: metadata.gid,
  });
  assert.deepEqual(entries.at(-1), {
    path: "z.txt",
    type: "file",
    mode: lstatSync(path.join(f.root, "z.txt")).mode & 0o7777,
    uid: metadata.uid,
    gid: metadata.gid,
    size: 4,
    sha256: sha256("last"),
  });
  assert.ok(entries.every(({ path: relative }) => !relative.includes("\\")));
});

test("hashes exact binary bytes, empty files and UTF-8 content without changing files", async (t) => {
  const f = fixture(t);
  const cases = [
    ["empty", Buffer.alloc(0)],
    ["binary", Buffer.from([0, 255, 10, 13, 128])],
    ["中文.txt", Buffer.from("你好\n")],
  ];
  const before = new Map();
  for (const [name, bytes] of cases) {
    const file = put(f.root, name, bytes);
    const metadata = lstatSync(file);
    before.set(name, {
      bytes: readFileSync(file),
      mode: metadata.mode,
      mtime: metadata.mtimeMs,
    });
  }
  const entries = await inventory(f.root);
  for (const [name, bytes] of cases) {
    const entry = entries.find((candidate) => candidate.path === name);
    assert.equal(entry.size, bytes.length);
    assert.equal(entry.sha256, sha256(bytes));
    const file = path.join(f.root, name);
    const metadata = lstatSync(file);
    assert.deepEqual(
      {
        bytes: readFileSync(file),
        mode: metadata.mode,
        mtime: metadata.mtimeMs,
      },
      before.get(name),
    );
  }
});

test("hashes multi-chunk files with bounded fixture memory", async (t) => {
  const f = fixture(t);
  const file = path.join(f.root, "large.bin");
  const chunk = Buffer.alloc(64 * 1024, 0xa5);
  const expected = createHash("sha256");
  const descriptor = openSync(file, "wx");
  try {
    for (let index = 0; index < 48; index++) {
      writeSync(descriptor, chunk);
      expected.update(chunk);
    }
  } finally {
    closeSync(descriptor);
  }
  const entry = (await inventory(f.root)).find(
    (candidate) => candidate.path === "large.bin",
  );
  assert.equal(entry.size, 48 * chunk.length);
  assert.equal(entry.sha256, expected.digest("hex"));
});

test(
  "captures executable and directory permissions without changing them",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t);
    const file = put(f.root, "bin/cli", "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o751);
    chmodSync(path.dirname(file), 0o750);
    const entries = await inventory(f.root);
    assert.equal(entries.find((entry) => entry.path === "bin/cli").mode, 0o751);
    assert.equal(entries.find((entry) => entry.path === "bin").mode, 0o750);
    assert.equal(lstatSync(file).mode & 0o7777, 0o751);
  },
);

test("reports raw relative, dangling and external links without following them", async (t) => {
  const f = fixture(t);
  put(f.root, "pkg/index.js", "module");
  const external = path.join(f.directory, "external");
  put(external, "private.txt", "must stay outside the inventory");
  if (!link(t, "pkg/index.js", path.join(f.root, "relative"), "file")) return;
  if (!link(t, "missing", path.join(f.root, "dangling"), "file")) return;
  if (!link(t, external, path.join(f.root, "external"), "dir")) return;
  // A cycle would recurse indefinitely if the inventory dereferenced links.
  if (!link(t, ".", path.join(f.root, "cycle"), "dir")) return;
  const entries = await inventory(f.root);
  for (const [name, target] of [
    ["relative", "pkg/index.js"],
    ["dangling", "missing"],
    ["external", external],
    ["cycle", "."],
  ]) {
    const entry = entries.find((candidate) => candidate.path === name);
    assert.equal(entry.type, "symlink");
    assert.equal(entry.target, target);
    assert.equal(Object.hasOwn(entry, "size"), false);
    assert.equal(Object.hasOwn(entry, "sha256"), false);
  }
  assert.equal(
    entries.some((entry) => entry.path.endsWith("private.txt")),
    false,
  );
  assert.equal(
    readFileSync(path.join(external, "private.txt"), "utf8"),
    "must stay outside the inventory",
  );
});

test("excludes timestamps while detecting same-size content changes", async (t) => {
  const f = fixture(t);
  const file = put(f.root, "file", "first");
  const first = await inventory(f.root);
  utimesSync(file, new Date("2020-01-01"), new Date("2020-01-01"));
  utimesSync(f.root, new Date("2021-01-01"), new Date("2021-01-01"));
  assert.deepEqual(await inventory(f.root), first);
  writeFileSync(file, "other");
  const changed = await inventory(f.root);
  assert.equal(changed.find((entry) => entry.path === "file").size, 5);
  assert.notDeepEqual(changed, first);
  assert.ok(
    changed.every(
      (entry) => !Object.keys(entry).some((key) => /time/i.test(key)),
    ),
  );
});

test("empty roots are valid and repeated inventories are identical", async (t) => {
  const f = fixture(t);
  const first = await inventory(f.root);
  assert.equal(first.length, 1);
  assert.equal(first[0].path, "");
  assert.deepEqual(await inventory(f.root), first);
});

test("rejects missing, file and symlink roots", async (t) => {
  const f = fixture(t);
  await assert.rejects(inventory(path.join(f.directory, "missing")), {
    code: "ENOENT",
  });
  const file = put(f.directory, "file", "sentinel");
  await assert.rejects(
    inventory(file),
    /Inventory root must be a real directory/,
  );
  const alias = path.join(f.directory, "alias");
  if (!link(t, f.root, alias, "dir")) return;
  await assert.rejects(
    inventory(alias),
    /Inventory root must be a real directory/,
  );
});

test(
  "rejects unsupported filesystem objects without hanging or returning partial evidence",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t);
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path.join(f.root, "unsupported.sock"), resolve);
    });
    try {
      await assert.rejects(inventory(f.root), /Unsupported filesystem object/);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test("CLI emits only canonical JSON on stdout and clear failures on stderr", async (t) => {
  const f = fixture(t);
  put(f.root, "server.js", "server");
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  };
  const result = run(f.root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify(await inventory(f.root))}\n`);
  const missing = run(path.join(f.directory, "missing"));
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /Runtime inventory failed:/);
  const usage = run();
  assert.equal(usage.status, 64);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /Usage:/);
});
