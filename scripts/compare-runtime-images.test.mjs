import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMeasuredIdentity,
  baselineRevision,
  buildIdentity,
  compareInventories,
  needsStorageComparison,
  pinBase,
  runtimeConfig,
  withAppProbe,
} from "./compare-runtime-images.mjs";

const dockerfile =
  "FROM node:22-alpine AS deps\nFROM deps AS runtime-deps\nFROM node:22-alpine AS build\nRUN npm run build\nFROM node:22-alpine AS runner\n";

const configDigest = `sha256:${"a".repeat(64)}`;
const manifestDigest = `sha256:${"b".repeat(64)}`;
const differentDigest = `sha256:${"c".repeat(64)}`;
const layerIds = [`sha256:${"d".repeat(64)}`, `sha256:${"e".repeat(64)}`];
const buildMetadata = {
  "containerimage.config.digest": configDigest,
  "containerimage.digest": manifestDigest,
};
const measuredImage = (id) => ({ Id: id, RootFS: { Layers: [...layerIds] } });
const exportedImage = () => ({
  config_digest: configDigest,
  layers: layerIds.map((diff_id) => ({ diff_id })),
});

test("build metadata binds both classic config IDs and containerd manifest IDs", () => {
  for (const id of [configDigest, manifestDigest]) {
    const image = measuredImage(id);
    const identity = buildIdentity(buildMetadata, image);
    assert.deepEqual(identity, { configDigest, manifestDigest });
    assert.doesNotThrow(() =>
      assertMeasuredIdentity(image, identity, exportedImage(), measuredImage(id)),
    );
  }
});

test("missing, malformed or unrelated build identities fail closed", () => {
  for (const metadata of [
    undefined,
    {},
    { ...buildMetadata, "containerimage.config.digest": "sha256:short" },
    { ...buildMetadata, "containerimage.digest": undefined },
    { ...buildMetadata, "containerimage.digest": `sha256:${"A".repeat(64)}` },
  ])
    assert.throws(() => buildIdentity(metadata, measuredImage(manifestDigest)));
  assert.throws(
    () => buildIdentity(buildMetadata, measuredImage(differentDigest)),
    /Loaded image identity does not match/,
  );
});

test("the archive must match the build config even when layer IDs match", () => {
  const image = measuredImage(manifestDigest);
  const identity = buildIdentity(buildMetadata, image);
  for (const digest of [differentDigest, manifestDigest, undefined]) {
    assert.throws(
      () =>
        assertMeasuredIdentity(
          image,
          identity,
          { ...exportedImage(), config_digest: digest },
          image,
        ),
      /Exported config identity does not match/,
    );
  }
  assert.throws(
    () => assertMeasuredIdentity(image, identity, undefined, image),
    /Exported config identity does not match/,
  );
});

test("retargeted tags are rejected even when exported config and layers match", () => {
  const image = measuredImage(manifestDigest);
  const identity = buildIdentity(buildMetadata, image);
  for (const current of [
    measuredImage(differentDigest),
    measuredImage(configDigest),
    undefined,
  ]) {
    assert.throws(
      () => assertMeasuredIdentity(image, identity, exportedImage(), current),
      /Tag identity changed during measurement/,
    );
  }
});

test("exported layer order, membership and count remain bound to inspection", () => {
  const image = measuredImage(manifestDigest);
  const identity = buildIdentity(buildMetadata, image);
  for (const diffIds of [
    [...layerIds].reverse(),
    [differentDigest, layerIds[1]],
    [layerIds[0]],
    [...layerIds, differentDigest],
  ]) {
    assert.throws(
      () =>
        assertMeasuredIdentity(
          image,
          identity,
          {
            ...exportedImage(),
            layers: diffIds.map((diff_id) => ({ diff_id })),
          },
          image,
        ),
      /Exported layer identities changed/,
    );
  }
});

test("distinct comparison tags may legitimately share the same immutable image", () => {
  // Equal baseline/candidate layouts are valid zero-growth measurements, not
  // evidence of tag corruption. Each role must still pass the full binding.
  for (const role of ["baseline", "candidate"]) {
    const image = measuredImage(manifestDigest);
    assert.doesNotThrow(
      () =>
        assertMeasuredIdentity(
          image,
          buildIdentity(buildMetadata, image),
          exportedImage(),
          image,
        ),
      role,
    );
  }
});

test("manual comparisons use the first parent or an explicit immutable baseline", () => {
  const revision = "b".repeat(40);
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return `${revision}\n`;
  };
  assert.equal(baselineRevision("", git), revision);
  assert.deepEqual(calls, [
    ["rev-parse", "HEAD^"],
    ["cat-file", "-e", `${revision}^{commit}`],
  ]);
  calls.length = 0;
  assert.equal(baselineRevision(revision, git), revision);
  assert.deepEqual(calls, [["cat-file", "-e", `${revision}^{commit}`]]);
  assert.throws(() => baselineRevision("HEAD", git));
  assert.throws(() => baselineRevision("0".repeat(40), git));
  assert.throws(() =>
    baselineRevision(revision, () => {
      throw new Error("missing commit");
    }),
  );
});
test("comparisons share an explicit base and change only an inert post-build app file", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const pinned = pinBase(dockerfile, digest);
  assert.equal(pinned.match(new RegExp(`node@${digest}`, "g")).length, 3);
  assert.ok(pinned.includes("FROM deps AS runtime-deps"));
  const probe = withAppProbe(pinned);
  assert.ok(probe.includes("RUN npm run build\nRUN printf"));
  assert.ok(probe.includes("/app/.next/standalone/server.js"));
  assert.equal(probe.match(/RUN npm run build/g).length, 1);
});
test("unreviewed base/layout changes fail closed", () => {
  assert.throws(() => pinBase(dockerfile, "node:latest"));
  assert.throws(() =>
    pinBase(
      dockerfile.replace("AS runner", "AS web"),
      `sha256:${"a".repeat(64)}`,
    ),
  );
  assert.throws(() => withAppProbe("RUN npm run build\nRUN npm run build"));
  assert.throws(() => withAppProbe("RUN npm run other-build"));
});
test("runtime inventory comparison detects content, mode, link and missing-file changes", () => {
  const before = [
    { path: "x", type: "file", sha256: "a", mode: 0o755 },
    { path: "link", type: "symlink", target: "x" },
  ];
  assert.deepEqual(compareInventories(before, [...before].reverse()), []);
  for (const changed of [
    { ...before[0], sha256: "b" },
    { ...before[0], mode: 0o644 },
  ])
    assert.deepEqual(compareInventories(before, [changed, before[1]]), ["x"]);
  assert.deepEqual(
    compareInventories(before, [before[0], { ...before[1], target: "other" }]),
    ["link"],
  );
  assert.deepEqual(compareInventories(before, []), ["link", "x"]);
});
test("runtime config comparison excludes labels but retains behavior and architecture", () => {
  const first = {
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "nextjs",
      Entrypoint: ["./entrypoint.sh"],
      Labels: { source: "a" },
    },
  };
  assert.deepEqual(
    runtimeConfig(first),
    runtimeConfig({
      ...first,
      Config: { ...first.Config, Labels: { source: "b" } },
    }),
  );
  assert.notDeepEqual(
    runtimeConfig(first),
    runtimeConfig({ ...first, Config: { ...first.Config, User: "root" } }),
  );
  assert.notDeepEqual(
    runtimeConfig(first),
    runtimeConfig({ ...first, Architecture: "arm64" }),
  );
});
test("application-only edits skip duplicate packaging comparison while packaging helpers trigger it", () => {
  assert.equal(
    needsStorageComparison(["src/app/page.tsx", "docs/guides/deployment.md"]),
    false,
  );
  for (const file of [
    "Dockerfile",
    ".dockerignore",
    ".github/workflows/docker-build.yml",
    "scripts/test_image_storage_metrics.py",
    "scripts/assemble-runtime.mjs",
    "scripts/runtime-file-inventory.test.mjs",
    "scripts/image_storage_metrics.py",
  ])
    assert.equal(needsStorageComparison([file]), true, file);
});
