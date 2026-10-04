import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = nextRequire("./utils/get-root-dirs.js");
const nextPlugin = require("@next/eslint-plugin-next");

function fixture(t, router = "pages") {
  const directory = mkdtempSync(path.join(tmpdir(), "shbs lint glob-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const app of ["web", "staff"]) {
    mkdirSync(path.join(directory, app, router), { recursive: true });
    writeFileSync(
      path.join(
        directory,
        app,
        router,
        router === "pages" ? "index.jsx" : "page.jsx",
      ),
      "",
    );
  }
  writeFileSync(path.join(directory, "not-a-directory"), "");
  return directory;
}

function roots(directory, rootDir) {
  // Exercise Next's real normalization and module resolution, not a copied adapter.
  return getRootDirs({ cwd: directory, settings: { next: { rootDir } } })
    .map((entry) => path.resolve(entry))
    .sort();
}

test("Next resolves the pinned replacement and the lockfile excludes braces", () => {
  const replacement = nextRequire("fast-glob/package.json");
  assert.equal(replacement.name, "@shbs/next-lint-glob");
  assert.equal(replacement.dependencies.tinyglobby, "0.2.17");
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.equal(
    Object.keys(lock.packages).some((entry) =>
      /(?:^|\/)node_modules\/(braces|micromatch)$/.test(entry),
    ),
    false,
  );
});

test("unsupported upstream glob options fail loudly", () => {
  const { globSync } = nextRequire("fast-glob");
  for (const [pattern, options] of [
    ["src/*", undefined],
    ["src/*", { onlyDirectories: false }],
    ["src/*", { onlyDirectories: true, dot: true }],
    [["src/*"], { onlyDirectories: true }],
  ]) {
    assert.throws(() => globSync(pattern, options), TypeError);
  }
});

test("unconfigured Next roots retain the working directory", (t) => {
  const directory = fixture(t);
  assert.deepEqual(roots(directory), [directory]);
});

test("literal roots resolve the directory itself", (t) => {
  const directory = fixture(t);
  const web = path.join(directory, "web");
  assert.deepEqual(roots(directory, web), [web]);
});

test("wildcard roots include directories and exclude files", (t) => {
  const directory = fixture(t);
  assert.deepEqual(roots(directory, `${directory}/*`), [
    path.join(directory, "staff"),
    path.join(directory, "web"),
  ]);
});

test("brace alternatives and arrays find both application roots", (t) => {
  const directory = fixture(t);
  const expected = [path.join(directory, "staff"), path.join(directory, "web")];
  assert.deepEqual(roots(directory, `${directory}/{web,staff}`), expected);
  assert.deepEqual(
    roots(directory, [`${directory}/web`, `${directory}/staff`]),
    expected,
  );
});

test("missing roots produce an empty result", (t) => {
  const directory = fixture(t);
  assert.deepEqual(roots(directory, `${directory}/missing-*`), []);
});

test("Windows separators pass through Next's path normalization", (t) => {
  const directory = fixture(t);
  assert.deepEqual(roots(directory, `${directory}/web`.replaceAll("/", "\\")), [
    path.join(directory, "web"),
  ]);
});

test("relative root globs still resolve against the process working directory", () => {
  const result = roots(process.cwd(), "src/{app,server}");
  assert.deepEqual(
    result,
    [path.resolve("src/app"), path.resolve("src/server")].sort(),
  );
});

for (const router of ["pages", "app"]) {
  test(`Next's internal-link rule reports violations through globbed ${router} roots`, (t) => {
    const directory = fixture(t, router);
    const linter = new Linter();
    const config = {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "@next/next": nextPlugin },
      settings: { next: { rootDir: `${directory}/{web,staff}` } },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    };
    // A passing lint run alone could hide broken discovery; assert a real violation too.
    const messages = linter.verify(
      'const link = <a href="/">Home</a>;',
      config,
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, "@next/next/no-html-link-for-pages");
    assert.deepEqual(
      linter.verify(
        'const link = <a href="https://example.com/">External</a>;',
        config,
      ),
      [],
    );
  });
}
