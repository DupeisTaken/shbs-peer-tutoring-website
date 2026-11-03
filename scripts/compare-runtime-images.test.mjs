import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMeasuredIdentity,
  baselineRevision,
  buildIdentity,
  compareInventories,
  identityDiagnostics,
  needsStorageComparison,
  pinBase,
  runtimeConfig,
  withAppProbe,
  withCommonOperatorPayload,
} from "./compare-runtime-images.mjs";

const dockerfile =
  "FROM node:22-alpine AS deps\nFROM deps AS runtime-deps\nFROM node:22-alpine AS build\nRUN npm run build\nFROM node:22-alpine AS runner\n";

const operatorLayout = (copies = "") => `FROM build AS runtime-files
COPY --from=runtime-deps /app/node_modules /runtime-production/node_modules
RUN node scripts/assemble-runtime.mjs .next/standalone /runtime-production/node_modules /runtime-output
${copies}
FROM node:22-alpine AS runner
COPY --from=runtime-files --chown=nextjs:nodejs /runtime-output/app ./
ENV NODE_ENV=production
`;
const sourceCopy = (file) => `COPY --from=build /app/${file} /runtime-output/app/${file}`;

test("common operator payload adds exact current files to the historical prepared layer only", () => {
  const oldFile = "src/server/program/continuation-opening.ts";
  const newFile = "src/server/history-row-ownership.ts";
  const baseline = operatorLayout(sourceCopy(oldFile));
  const candidate = operatorLayout([sourceCopy(oldFile), sourceCopy(newFile), sourceCopy("messages/en.json")].join("\n"));
  const result = withCommonOperatorPayload(baseline, candidate);
  assert.deepEqual(result.addedFiles, ["messages/en.json", newFile]);
  const [prepared, runner] = result.source.split("FROM node:22-alpine AS runner");
  assert.ok(prepared.includes(sourceCopy(newFile)));
  assert.ok(prepared.includes(sourceCopy("messages/en.json")));
  assert.equal(runner, baseline.split("FROM node:22-alpine AS runner")[1]);
  assert.equal(result.source.match(new RegExp(sourceCopy(oldFile), "g")).length, 1);
  assert.deepEqual(withCommonOperatorPayload(result.source, candidate).addedFiles, []);
});

test("equal and removed operator payloads do not rewrite the baseline or conceal removals", () => {
  const baseline = operatorLayout(sourceCopy("src/server/history-row-ownership.ts"));
  for (const candidate of [baseline, operatorLayout()])
    assert.deepEqual(withCommonOperatorPayload(baseline, candidate), { source: baseline, addedFiles: [] });
});

test("existing runner files are not duplicated to inflate the historical baseline", () => {
  const file = "src/server/history-row-ownership.ts";
  const candidate = operatorLayout(sourceCopy(file));
  for (const copy of [
    `COPY --from=build --chown=nextjs:nodejs /app/${file} ./${file}`,
    `COPY --from=build --chown=nextjs:nodejs /app/src/server/other.ts \\\n      /app/${file} ./src/server/`,
    "COPY --from=build --chown=nextjs:nodejs /app/src ./src",
  ]) {
    const baseline = operatorLayout() + copy + "\n";
    assert.deepEqual(withCommonOperatorPayload(baseline, candidate), { source: baseline, addedFiles: [] });
  }
});

test("operator payload normalization rejects broad, redirected, duplicate and unshipped copies", () => {
  const exact = sourceCopy("src/server/history-row-ownership.ts");
  for (const invalid of [
    "COPY --from=build /app/src /runtime-output/app/src",
    sourceCopy("src/server/*.ts"),
    sourceCopy("src/../private.ts"),
    exact.replace("/runtime-output/app/src/", "/runtime-output/app/other/"),
    exact.replace("/runtime-output/app/", "/elsewhere/"),
    exact + "\n" + exact,
    "COPY --from=build /app/src/a.ts /app/src/b.ts /runtime-output/app/src/",
  ]) assert.throws(() => withCommonOperatorPayload(operatorLayout(), operatorLayout(invalid)));
  assert.throws(() => withCommonOperatorPayload(operatorLayout(), operatorLayout(exact).replace("COPY --from=runtime-files", "# omitted COPY --from=runtime-files")));
  assert.throws(() => withCommonOperatorPayload(dockerfile, operatorLayout(exact)));
});

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
  manifest_digests: [manifestDigest],
  layers: layerIds.map((diff_id) => ({ diff_id })),
});

test("build metadata binds both classic config IDs and containerd manifest IDs", () => {
  for (const id of [configDigest, manifestDigest]) {
    const image = measuredImage(id);
    const identity = buildIdentity(buildMetadata, image);
    const exported = exportedImage();
    delete exported.manifest_digests; // Classic Docker archives have no OCI proof.
    assert.deepEqual(identity, { configDigest, manifestDigest });
    assert.deepEqual(
      assertMeasuredIdentity(image, identity, exported, measuredImage(id)),
      { configDigest, manifestDigest },
    );
  }
});

test("missing, malformed or unrelated build identities fail closed", () => {
  for (const metadata of [
    undefined,
    {},
    { ...buildMetadata, "containerimage.config.digest": null },
    { ...buildMetadata, "containerimage.config.digest": undefined },
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

test("containerd --load metadata binds the config through an authenticated manifest", () => {
  const metadata = { "containerimage.digest": manifestDigest };
  const image = measuredImage(manifestDigest);
  const identity = buildIdentity(metadata, image);
  assert.deepEqual(identity, { configDigest: null, manifestDigest });
  assert.deepEqual(
    assertMeasuredIdentity(image, identity, exportedImage(), image),
    { configDigest, manifestDigest },
  );
  assert.throws(
    () => buildIdentity(metadata, measuredImage(configDigest)),
    /Loaded image identity does not match/,
  );
});

test("a deferred config cannot be trusted without the build's exact manifest proof", () => {
  const image = measuredImage(manifestDigest);
  const identity = buildIdentity(
    { "containerimage.digest": manifestDigest }, image,
  );
  for (const proofs of [undefined, [], [differentDigest], manifestDigest]) {
    assert.throws(
      () =>
        assertMeasuredIdentity(
          image, identity, { ...exportedImage(), manifest_digests: proofs }, image,
        ),
      /Exported manifest identity does not match/,
    );
  }
  assert.throws(
    () =>
      assertMeasuredIdentity(
        image, identity, { ...exportedImage(), config_digest: undefined }, image,
      ),
    /Exported config identity does not match/,
  );
});

test("diagnostics expose only selected valid digests or fixed missing/invalid markers", () => {
  const privateValue = "PRIVATE_SENTINEL";
  const metadata = {
    ...buildMetadata,
    "containerimage.config.digest": privateValue,
    "buildx.build.provenance": { secret: privateValue },
  };
  assert.deepEqual(identityDiagnostics(metadata, { Id: privateValue }), {
    configDigest: "invalid",
    manifestDigest,
    imageId: "invalid",
  });
  assert.deepEqual(identityDiagnostics(undefined, undefined), {
    configDigest: "missing",
    manifestDigest: "missing",
    imageId: "missing",
  });
  assert.deepEqual(identityDiagnostics(buildMetadata, measuredImage(manifestDigest)), {
    configDigest, manifestDigest, imageId: manifestDigest,
  });
  assert.throws(
    () => buildIdentity(metadata, measuredImage(manifestDigest)),
    (error) => !String(error).includes(privateValue),
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
  for (const metadata of [
    buildMetadata, { "containerimage.digest": manifestDigest },
  ]) {
    const identity = buildIdentity(metadata, image);
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
  }
});

test("exported layer order, membership and count remain bound to inspection", () => {
  const image = measuredImage(manifestDigest);
  for (const metadata of [
    buildMetadata, { "containerimage.digest": manifestDigest },
  ]) {
    const identity = buildIdentity(metadata, image);
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
