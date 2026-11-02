import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);

test("legacy lint consumers resolve a callable matcher and its class/helpers", () => {
  for (const name of [
    "eslint",
    "@eslint/config-array",
    "@eslint/eslintrc",
    "eslint-plugin-import",
    "eslint-plugin-jsx-a11y",
    "eslint-plugin-react",
  ]) {
    const consumer = createRequire(require.resolve(name));
    const match = consumer("minimatch");
    assert.equal(typeof match, "function", name);
    assert.equal(match("src/example.ts", "**/*.{ts,tsx}"), true, name);
    assert.equal(match("src/example.js", "**/*.{ts,tsx}"), false, name);
    assert.equal(
      new match.Minimatch("**/*.ts", { dot: true }).match(".hidden/example.ts"),
      true,
      name,
    );
    assert.equal(match.makeRe("@app/*").test("@app/core"), true, name);
  }
});

test("TypeScript ESLint uses the patched named-export matcher", () => {
  const consumer = createRequire(
    require.resolve("@typescript-eslint/typescript-estree"),
  );
  assert.equal(consumer("minimatch/package.json").version, "11.0.1");
  assert.equal(consumer("minimatch").minimatch("config.ts", "*.ts"), true);
});

test("flat configuration still includes intended source files and excludes fixtures", () => {
  const linter = new Linter();
  const config = [
    {
      files: ["src/**/*.{js,jsx}"],
      ignores: ["**/*.test.js"],
      rules: { "no-unused-vars": "error" },
    },
  ];
  const source = "const unused = 1;";
  assert.equal(
    linter.verify(source, config, { filename: "src/example.js" })[0]?.ruleId,
    "no-unused-vars",
  );
  assert.deepEqual(
    linter.verify(source, config, { filename: "src/example.test.js" }),
    [],
  );
});

test("import rule retains glob exceptions instead of silently disabling violations", () => {
  const linter = new Linter();
  const config = [
    {
      plugins: { import: require("eslint-plugin-import") },
      rules: {
        "import/no-internal-modules": ["error", { forbid: ["private/**"] }],
      },
    },
  ];
  assert.equal(
    linter.verify('import value from "private/secret";', config)[0]?.ruleId,
    "import/no-internal-modules",
  );
  assert.deepEqual(
    linter.verify('import value from "public/api";', config),
    [],
  );
});
