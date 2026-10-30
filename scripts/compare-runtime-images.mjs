import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
const json = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function needsStorageComparison(files) {
  return files.some(
    (file) =>
      [
        "Dockerfile",
        ".dockerignore",
        ".github/workflows/docker-build.yml",
        "scripts/test_image_storage_metrics.py",
      ].includes(file) ||
      /^scripts\/(assemble-runtime|runtime-file-inventory|compare-runtime-images|image_storage_metrics)(\.|_)/.test(
        file,
      ),
  );
}

export function pinBase(source, digest) {
  source = source.replaceAll("\r\n", "\n");
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const matches = source.match(
    /^FROM node:22-alpine AS (deps|build|runner)$/gm,
  );
  assert.equal(
    matches?.length,
    3,
    "Review changed Node base/stages before comparing layouts",
  );
  return source.replace(
    /^FROM node:22-alpine AS /gm,
    `FROM node@${digest} AS `,
  );
}

export function withAppProbe(source) {
  source = source.replaceAll("\r\n", "\n");
  assert.equal(
    source.match(/^RUN npm run build$/gm)?.length,
    1,
    "Expected one common Next build",
  );
  // Only final-stage copies/assembly repeat. The expensive Next build stays a
  // shared cached step, avoiding independently generated BUILD_ID differences.
  return source.replace(
    /^RUN npm run build$/m,
    "RUN npm run build\nRUN printf '\\n// controlled-image-storage-probe\\n' >> /app/.next/standalone/server.js",
  );
}

export function runtimeConfig(image) {
  const keys = [
    "Cmd",
    "Entrypoint",
    "Env",
    "User",
    "WorkingDir",
    "ExposedPorts",
    "Volumes",
    "StopSignal",
    "Healthcheck",
    "Shell",
  ];
  return {
    architecture: image.Architecture,
    os: image.Os,
    config: Object.fromEntries(
      keys.map((key) => [key, image.Config[key] ?? null]),
    ),
  };
}

export function compareInventories(baseline, candidate) {
  const differences = [];
  const first = new Map(baseline.map((entry) => [entry.path, entry]));
  const second = new Map(candidate.map((entry) => [entry.path, entry]));
  for (const name of new Set([...first.keys(), ...second.keys()])) {
    if (JSON.stringify(first.get(name)) !== JSON.stringify(second.get(name)))
      differences.push(name);
  }
  return differences.sort();
}

export function baselineRevision(
  requested = process.env.STORAGE_BASE_REF,
  git = (args) => run("git", args),
) {
  // Manual runs have no event.before; compare against the actual first parent
  // instead of HEAD itself, which would silently skip every packaging change.
  const revision = requested || git(["rev-parse", "HEAD^"]).trim();
  assert.match(revision ?? "", /^[a-f0-9]{40}$/);
  assert.notEqual(
    revision,
    "0".repeat(40),
    "A real baseline commit is required",
  );
  git(["cat-file", "-e", `${revision}^{commit}`]);
  return revision;
}

function scope() {
  const revision = baselineRevision();
  const files = run("git", ["diff", "--name-only", revision, "HEAD", "--"])
    .trim()
    .split(/\r?\n/);
  const compare = needsStorageComparison(files);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `compare=${compare}\n`);
  console.log(JSON.stringify({ baselineRevision: revision, compare }));
}

function imageInventory(tag) {
  const name = `shbs-storage-inventory-${randomUUID()}`;
  try {
    return JSON.parse(
      run("docker", [
        "run",
        "--rm",
        "--name",
        name,
        "--read-only",
        "--network",
        "none",
        "--entrypoint",
        "node",
        "--mount",
        `type=bind,src=${path.join(root, "scripts/runtime-file-inventory.mjs")},dst=/tmp/inventory.mjs,readonly`,
        tag,
        "/tmp/inventory.mjs",
        "/app",
      ]),
    );
  } finally {
    // Only this task-owned inventory container, including after a client timeout.
    try {
      run("docker", ["rm", "-f", name], { stdio: "ignore" });
    } catch {
      /* --rm normally removed it */
    }
  }
}

function compare(output) {
  assert.equal(
    process.env.CI,
    "true",
    "Build comparison is restricted to an isolated CI job",
  );
  const revision = baselineRevision();
  const destination = path.resolve(output);
  const relative = path.relative(root, destination);
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Generated Dockerfiles must be outside the build context",
  );
  mkdirSync(destination); // A pre-existing output is never overwritten.
  const manifest = JSON.parse(
    run("docker", [
      "buildx",
      "imagetools",
      "inspect",
      "node:22-alpine",
      "--format",
      "{{json .Manifest}}",
    ]),
  );
  const base = manifest.manifests?.find(
    (item) =>
      item.platform?.os === "linux" && item.platform?.architecture === "amd64",
  );
  assert.ok(base, "Expected the Linux amd64 Node base manifest");
  const original = pinBase(
    run("git", ["show", `${revision}:Dockerfile`]),
    base.digest,
  );
  const candidate = pinBase(
    readFileSync(path.join(root, "Dockerfile"), "utf8"),
    base.digest,
  );
  const layouts = [
    { role: "baseline", tag: "shbs-storage-baseline:a", source: original },
    { role: "candidate", tag: "shbs-storage-candidate:a", source: candidate },
    {
      role: "baselineProbe",
      tag: "shbs-storage-baseline:b",
      source: withAppProbe(original),
    },
    {
      role: "candidateProbe",
      tag: "shbs-storage-candidate:b",
      source: withAppProbe(candidate),
    },
  ];
  for (const layout of layouts) {
    const file = path.join(destination, `${layout.role}.Dockerfile`);
    writeFileSync(file, layout.source);
    console.log(`Building controlled ${layout.role} layout`);
    run(
      "docker",
      [
        "buildx",
        "build",
        "--load",
        "--platform",
        "linux/amd64",
        "--file",
        file,
        "--tag",
        layout.tag,
        "--cache-from",
        "type=gha",
        ".",
      ],
      { stdio: "inherit", timeout: 420_000 },
    );
    layout.image = JSON.parse(
      run("docker", ["image", "inspect", layout.tag]),
    )[0];
    layout.inventory = imageInventory(layout.tag);
  }
  const [before, after, beforeProbe, afterProbe] = layouts;
  const checks = {
    applicationDifferences: compareInventories(
      before.inventory,
      after.inventory,
    ),
    probeDifferences: compareInventories(
      beforeProbe.inventory,
      afterProbe.inventory,
    ),
    baselineProbeChanges: compareInventories(
      before.inventory,
      beforeProbe.inventory,
    ),
    candidateProbeChanges: compareInventories(
      after.inventory,
      afterProbe.inventory,
    ),
  };
  json(path.join(destination, "file-equivalence.json"), checks);
  assert.deepEqual(
    checks.applicationDifferences,
    [],
    "Runtime /app content, links, modes or ownership changed",
  );
  assert.deepEqual(checks.probeDifferences, []);
  assert.deepEqual(checks.baselineProbeChanges, ["server.js"]);
  assert.deepEqual(checks.candidateProbeChanges, ["server.js"]);
  for (const layout of layouts.slice(1))
    assert.deepEqual(runtimeConfig(layout.image), runtimeConfig(before.image));
  const metricsFile = path.join(destination, "layer-metrics.json");
  run(
    "python3",
    [
      "scripts/image_storage_metrics.py",
      before.tag,
      beforeProbe.tag,
      after.tag,
      afterProbe.tag,
      metricsFile,
    ],
    { stdio: "inherit", timeout: 180_000 },
  );
  const metrics = JSON.parse(readFileSync(metricsFile, "utf8"));
  for (const layout of layouts) {
    const exported = metrics.images[layout.tag];
    assert.equal(
      exported.config_digest,
      layout.image.Id,
      "Tag identity changed during measurement",
    );
    assert.deepEqual(
      exported.layers.map((layer) => layer.diff_id),
      layout.image.RootFS.Layers,
    );
  }
  json(path.join(destination, "comparison.json"), {
    sourceRevision: run("git", ["rev-parse", "HEAD"]).trim(),
    baselineDockerfileRevision: revision,
    baseDigest: base.digest,
    platform: "linux/amd64",
    checks,
    images: layouts.map((layout) => ({
      role: layout.role,
      tag: layout.tag,
      id: layout.image.Id,
      dockerSizeBytes: layout.image.Size,
      inventoryCount: layout.inventory.length,
      inventorySha256: sha(layout.inventory),
      rootfsDiffIds: layout.image.RootFS.Layers,
    })),
    metrics,
    limitations:
      "Controlled same-build app-file probe; layer payload/chain proxies are not registry compression, actual production disk savings or a forecast of every release.",
  });
  assert.ok(
    after.image.Size <= before.image.Size,
    "Candidate single-image Docker size grew",
  );
  // Pair metric assertions are also enforced by the archive summarizer CLI.
  console.log(
    `Runtime file/config equivalence passed. Docker image bytes: ${before.image.Size} -> ${after.image.Size}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] === "scope" && process.argv.length === 3) scope();
    else if (process.argv[2] === "compare" && process.argv.length === 4)
      compare(process.argv[3]);
    else
      throw new Error(
        "Usage: node scripts/compare-runtime-images.mjs scope | compare FRESH_CI_OUTPUT_DIRECTORY",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
