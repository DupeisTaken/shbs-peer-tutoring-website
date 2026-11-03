import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function regularRuntimeSource(root, relative) {
  assert.ok(typeof relative === "string" && relative.length > 0 &&
    !relative.includes("\\") && !relative.startsWith("/") &&
    relative.split("/").every((part) => part && part !== "." && part !== ".."),
  "Runtime source must have a canonical relative path");
  const base = path.resolve(root);
  for (let parent = base; ; parent = path.dirname(parent)) {
    const metadata = lstatSync(parent);
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), "Runtime source root and ancestors must be real directories");
    if (parent === path.dirname(parent)) break;
  }
  let current = base;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const metadata = lstatSync(current);
    assert.ok(!metadata.isSymbolicLink(), "Runtime sources and their parents must not be symbolic links");
    assert.ok(index === parts.length - 1 ? metadata.isFile() : metadata.isDirectory(),
      "Runtime source must be a regular file under real directories");
  }
  const physical = path.relative(realpathSync(base), realpathSync(current));
  assert.ok(physical && physical !== ".." && !physical.startsWith(`..${path.sep}`) && !path.isAbsolute(physical),
    "Runtime source must stay inside its repository");
  return current;
}

// TypeScript is loaded only for graph inspection. Packaging scope detection needs
// no npm installation; the scoped CI comparison installs locked tools first.
export function runtimeImports(source, fileName) {
  const ts = require("typescript");
  const emitted = ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  }).outputText;
  return ts.preProcessFile(emitted, true, true).importedFiles.map((entry) => entry.fileName);
}

export function runtimeCliGraph(root, entry) {
  const files = new Set(["package.json", "tsconfig.json"]);
  const packages = new Set(["tsx"]);
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    // Generated client artifacts are shipped whole and verified by image smoke.
    if (file.startsWith("generated/")) return;
    const source = readFileSync(regularRuntimeSource(root, file), "utf8");
    for (const specifier of runtimeImports(source, file)) {
      if (isBuiltin(specifier)) continue;
      if (!specifier.startsWith(".") && !specifier.startsWith("~/")) {
        packages.add(specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/"));
        continue;
      }
      const base = specifier.startsWith("~/") ? `src/${specifier.slice(2)}`
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      assert.ok(!base.startsWith("../"), `CLI import escapes the repository: ${file} -> ${specifier}`);
      if (base.startsWith("generated/")) { visit(base); continue; }
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`]
        .find((candidate) => existsSync(path.join(root, candidate)) && lstatSync(path.join(root, candidate)).isFile());
      assert.ok(resolved, `Cannot resolve CLI import: ${file} -> ${specifier}`);
      visit(resolved);
    }
  };
  visit(entry);
  return { files, packages };
}

export function requiredOperatorFiles(root) {
  const manifest = JSON.parse(readFileSync(regularRuntimeSource(root, "package.json"), "utf8"));
  const files = new Set();
  for (const command of ["admin:create", "identity:reconcile", "recovery"]) {
    const match = /^tsx (scripts\/[\w-]+\.ts)$/.exec(manifest.scripts[command]);
    assert.ok(match, `Review the runtime launcher for ${command}`);
    const graph = runtimeCliGraph(root, match[1]);
    for (const dependency of graph.packages)
      assert.ok(Object.hasOwn(manifest.dependencies, dependency), `${command} requires production dependency ${dependency}`);
    for (const forbidden of ["src/env.js", "src/server/db.ts"])
      assert.ok(!graph.files.has(forbidden), `${command} must keep its database-only environment contract: ${forbidden}`);
    for (const file of graph.files) files.add(file);
  }
  return files;
}
