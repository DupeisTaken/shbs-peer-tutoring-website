import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { planClockCampaign } from "./clock-admission.mjs";

void test("matrix declaration hashes each real control and the failed-jobs worker retains that declaration", () => {
  const root = mkdtempSync(join(tmpdir(), "profile-campaign-"));
  const script = new URL("./resume-campaign.mjs", import.meta.url);
  function checkout(name: string) {
    const cwd = join(root, name);
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    mkdirSync(join(cwd, "prisma/migrations/first"), { recursive: true });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "package-lock.json"), "{}");
    writeFileSync(join(cwd, "prisma/schema.prisma"), "model Fixture {}\n");
    writeFileSync(join(cwd, "prisma/migrations/first/migration.sql"), "SELECT 1;\n");
    writeFileSync(join(cwd, "src/fixture.ts"), "export default " + JSON.stringify(name));
    git("init", "--quiet");
    git("add", "src", "package-lock.json", "prisma");
    git("-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "synthetic fixture");
    return git("rev-parse", "HEAD");
  }
  try {
    const candidate = checkout(".");
    const baseline = checkout(".profile-baseline"), catalogBaseline = checkout(".profile-catalog");
    mkdirSync(join(root, "scripts/scheduling-profile"), { recursive: true });
    copyFileSync(new URL("./comparison-inputs.mjs", import.meta.url), join(root, "scripts/scheduling-profile/comparison-inputs.mjs"));
    const plan = planClockCampaign("2026-11-03T12:02:12.645Z");
    writeFileSync(join(root, "clock-admission.json"), JSON.stringify({ ...plan, revision: candidate, run: "42", attempt: "1" }));
    const env = { ...process.env, RUNNER_TEMP: root, GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1",
      GITHUB_REPOSITORY: "example/fixture", GITHUB_WORKFLOW_SHA: "e".repeat(40), CANDIDATE_SHA: candidate,
      PROFILE_NODE_IMAGE_ID: "sha256:" + "3".repeat(64),
      PROFILE_POSTGRES_IMAGE: "postgres@sha256:" + "2".repeat(64), PROFILE_NODE_IMAGE: "node@sha256:" + "1".repeat(64),
      SELECTION: JSON.stringify({ baseline, catalogBaseline, baselineSelectionSource: "explicit-cli", catalogBaselineSelectionSource: "reviewed-pr-catalog-baseline-file" }) };
    const run = (args: string[], overrides = {}) => execFileSync(process.execPath, args, {
      cwd: root, env: { ...env, ...overrides }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const declaration = JSON.parse(run([fileURLToPath(script)]).replace(/^campaign=/, "")) as {
      scenarios: Record<"catalog" | "warm", { comparisonSha256: string }>;
    };
    const hash = (name: string) => createHash("sha256").update(readFileSync(join(root, name))).digest("hex");
    assert.equal(declaration.scenarios.catalog.comparisonSha256, hash("catalog-inputs.json"));
    assert.equal(declaration.scenarios.warm.comparisonSha256, hash("baseline-inputs.json"));
    assert.notEqual(declaration.scenarios.catalog.comparisonSha256, declaration.scenarios.warm.comparisonSha256);
    const check = ["--input-type=module", "-e", `import {currentCampaign} from ${JSON.stringify(script.href)}; console.log(JSON.stringify(currentCampaign()))`];
    const resume = { PROFILE_CAMPAIGN: JSON.stringify(declaration), GITHUB_RUN_ATTEMPT: "2" };
    assert.deepEqual(JSON.parse(run(check, resume)), { ...declaration, currentAttempt: 2 });
    for (const changed of [{ GITHUB_RUN_ID: "43" }, { GITHUB_WORKFLOW_SHA: "b".repeat(40) }, { CANDIDATE_SHA: baseline }])
      assert.throws(() => run(check, { ...resume, ...changed }));
    writeFileSync(join(root, ".profile-baseline/src/fixture.ts"), "export default 'mutated'");
    assert.throws(() => run([fileURLToPath(script)]), /Baseline runtime source differs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
