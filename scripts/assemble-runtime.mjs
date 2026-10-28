import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function contains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function overlaps(first, second) {
  return contains(first, second) || contains(second, first);
}

function sourceDirectory(value) {
  const resolved = path.resolve(value);
  if (!lstatSync(resolved).isDirectory())
    throw new Error(`Source must be a real directory: ${resolved}`);
  return realpathSync(resolved);
}

function assertFreshOutput(output) {
  // Existing outputs (including dangling links) are never replaced. Require an
  // existing parent, and refuse writes through symlink/junction ancestors.
  try {
    lstatSync(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    for (let parent = path.dirname(output); ; parent = path.dirname(parent)) {
      const metadata = lstatSync(parent);
      if (metadata.isSymbolicLink() || !metadata.isDirectory())
        throw new Error(`Output parent must be a real directory: ${parent}`);
      if (parent === path.dirname(parent)) break;
    }
    return;
  }
  throw new Error(`Output already exists: ${output}`);
}

function inventory(root) {
  const entries = new Map();
  function visit(relative) {
    const source = path.join(root, relative);
    const metadata = lstatSync(source);
    const type = metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : metadata.isSymbolicLink()
          ? "symlink"
          : null;
    if (!type) throw new Error(`Unsupported filesystem object: ${source}`);
    entries.set(relative, { source, metadata, type });
    // Never resolve a symlink, even when its target is a directory or outside
    // the input tree. Runtime-absolute and dangling links remain unchanged.
    if (type === "directory") {
      for (const name of readdirSync(source).sort())
        visit(path.join(relative, name));
    }
  }
  visit("");
  return entries;
}

function overlay(base, addition) {
  const merged = new Map(base);
  for (const [relative, entry] of addition) {
    const previous = merged.get(relative);
    if (previous && previous.type !== entry.type)
      throw new Error(
        `Conflicting filesystem types at ${relative || "."}: ${previous.type} / ${entry.type}`,
      );
    merged.set(relative, entry);
  }
  return merged;
}

function materialize(entries, destination) {
  const directories = [];
  // Parents precede children in both source inventories. Every winning entry is
  // written once, so an output symlink can never become a traversal directory.
  for (const [relative, entry] of entries) {
    const target = path.join(destination, relative);
    if (entry.type === "directory") {
      mkdirSync(target);
      directories.push([target, entry.metadata]);
    } else if (entry.type === "symlink") {
      symlinkSync(readlinkSync(entry.source), target);
      lutimesSync(target, entry.metadata.atime, entry.metadata.mtime);
    } else {
      copyFileSync(entry.source, target, constants.COPYFILE_EXCL);
      chmodSync(target, entry.metadata.mode & 0o7777);
      utimesSync(target, entry.metadata.atime, entry.metadata.mtime);
    }
  }
  // Apply directory permissions last: read-only input modes must not prevent
  // child creation. Source timestamps also keep unchanged dependency trees stable.
  for (const [target, metadata] of directories.reverse()) {
    chmodSync(target, metadata.mode & 0o7777);
    utimesSync(target, metadata.atime, metadata.mtime);
  }
}

/** Assemble fresh disjoint trees; production dependencies win file collisions.
 * Sources must remain stable during assembly. Validation completes before output
 * creation; an I/O failure can leave a partial fresh output for the caller to inspect.
 */
export function assembleRuntime(
  standalonePath,
  productionModulesPath,
  outputPath,
) {
  const standalone = sourceDirectory(standalonePath);
  const productionModules = sourceDirectory(productionModulesPath);
  const output = path.resolve(outputPath);
  assertFreshOutput(output);
  const physicalOutput = path.join(
    realpathSync(path.dirname(output)),
    path.basename(output),
  );
  if (
    overlaps(standalone, productionModules) ||
    overlaps(standalone, physicalOutput) ||
    overlaps(productionModules, physicalOutput)
  )
    throw new Error("Source and output trees must not overlap");

  const source = inventory(standalone);
  const app = new Map();
  const tracedModules = new Map();
  for (const [relative, entry] of source) {
    if (relative === "node_modules") {
      if (entry.type !== "directory")
        throw new Error("Standalone node_modules must be a real directory");
      tracedModules.set("", entry);
    } else if (relative.startsWith(`node_modules${path.sep}`)) {
      tracedModules.set(relative.slice("node_modules".length + 1), entry);
    } else {
      app.set(relative, entry);
    }
  }
  const dependencies = overlay(tracedModules, inventory(productionModules));
  mkdirSync(output);
  const appPath = path.join(output, "app");
  const dependenciesPath = path.join(output, "dependencies", "node_modules");
  mkdirSync(path.dirname(dependenciesPath));
  materialize(app, appPath);
  materialize(dependencies, dependenciesPath);
  return { appPath, dependenciesPath };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 5) {
    console.error(
      "Usage: node scripts/assemble-runtime.mjs STANDALONE PRODUCTION_NODE_MODULES FRESH_OUTPUT",
    );
    process.exitCode = 64;
  } else {
    try {
      assembleRuntime(...process.argv.slice(2));
    } catch (error) {
      console.error(`Runtime assembly failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
