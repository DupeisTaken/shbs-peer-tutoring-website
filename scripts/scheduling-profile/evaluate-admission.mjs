import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectComparisonInputs } from "./comparison-inputs.mjs";
import { evaluateDependencyAdmission } from "./dependency-admission.mjs";

/** @param {string} name */
function requireEnv(name) {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}`);
  return value;
}

/** @param {string} cwd */
const gitRevision = (cwd) =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** @param {Record<string, string>} outputs */
function writeGitHubOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  if (outputPath) appendFileSync(outputPath, lines);
  else process.stdout.write(lines);
}

/** @param {string} markdown */
function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, markdown);
}

/** Evaluate scheduling-profile admission early against immutable checkouts
 * before clock deferral or Docker pulls, emitting concise diagnostics and
 * distinct NOT_APPLICABLE / BLOCKED receipts. */
export function runAdmissionEvaluation() {
  const selected = /** @type {{
    baseline: string,
    catalogBaseline: string,
    manifest?: string | null,
    admissionManifest?: string | null,
    admissionManifestFileSha256?: string | null,
    baselineSelectionSource?: string,
  }} */ (JSON.parse(requireEnv("SELECTION")));
  const candidateRevision = requireEnv("CANDIDATE_SHA");
  const candidateRoot = resolve(".");
  const baselineRoot = resolve(".profile-baseline");
  const catalogRoot =
    selected.catalogBaseline && selected.catalogBaseline !== selected.baseline
      ? resolve(".profile-catalog")
      : baselineRoot;

  assert.equal(gitRevision(candidateRoot), candidateRevision, "Candidate checkout revision mismatch");
  assert.equal(gitRevision(baselineRoot), selected.baseline, "Baseline checkout revision mismatch");
  if (catalogRoot !== baselineRoot) {
    assert.equal(gitRevision(catalogRoot), selected.catalogBaseline, "Catalog baseline checkout revision mismatch");
  }

  let report = evaluateDependencyAdmission({
    baselineRoot,
    candidateRoot,
    baselineRevision: selected.baseline,
    candidateRevision,
    admissionManifestPath: selected.admissionManifest || null,
  });

  if (report.status === "ELIGIBLE" && selected.catalogBaseline === candidateRevision) {
    report = {
      ...report,
      status: "BLOCKED",
      disposition: "BLOCKED_SELF_CONTROL",
      summary: "Catalog baseline cannot match candidate revision; select an independent immutable control.",
    };
  }

  // When eligible on dependencies, dry-run comparison-inputs early so schema or
  // migration mismatches fail immediately before clock deferral or image pulls.
  if (report.status === "ELIGIBLE") {
    const reviewedManifest = selected.manifest
      ? /** @type {unknown} */ (JSON.parse(readFileSync(resolve(candidateRoot, selected.manifest), "utf8")))
      : undefined;
    try {
      inspectComparisonInputs(baselineRoot, candidateRoot, reviewedManifest);
      if (catalogRoot !== baselineRoot) {
        inspectComparisonInputs(catalogRoot, candidateRoot, reviewedManifest);
      }
    } catch (error) {
      report = {
        ...report,
        status: "BLOCKED",
        disposition: "BLOCKED_COMPARISON_INPUTS",
        summary: `Comparison input validation failed: ${error instanceof Error ? error.message.slice(0, 600) : String(error)}`,
      };
    }
  }

  const receipt = {
    ...report,
    admissionManifestFileSha256: selected.admissionManifestFileSha256 ?? null,
    baselineSelectionSource: selected.baselineSelectionSource ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  const receiptPath = resolve(process.env.ADMISSION_RECEIPT_PATH || "scheduling-profile-admission.json");
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

  writeGitHubOutputs({
    status: report.status,
    disposition: report.disposition,
  });

  if (report.status === "NOT_APPLICABLE") {
    writeStepSummary(
      `### Scheduling profile: Not applicable (non-scheduling dependency change)\n\n` +
      `- **Status:** \`NOT_APPLICABLE\` (\`${report.disposition}\`)\n` +
      `- **Measured:** \`false\` — **no benchmark ran; this is NOT a measured PASS.**\n` +
      `- **Control baseline:** \`${report.baselineRevision}\`\n` +
      `- **Admission manifest:** \`${report.admissionManifestPath}\`\n` +
      `- **Changed packages:** ${report.changedPackages.map((pkg) => `\`${pkg}\``).join(", ")}\n` +
      `- **Scheduling closure verified unchanged:** ${report.schedulingClosureCount} locked packages\n` +
      `- **Reason:** ${"reason" in report && report.reason ? report.reason : ""}\n`,
    );
    return receipt;
  }

  if (report.status === "BLOCKED") {
    const detailLines = [
      `### Scheduling profile blocked at admission`,
      ``,
      `- **Status:** \`BLOCKED\` (\`${report.disposition}\`)`,
      `- **Measured:** \`false\` — no profile workers or aggregate ran.`,
      `- **Control baseline:** \`${report.baselineRevision}\``,
      `- **Reason:** ${report.summary}`,
    ];
    if (report.blockingFiles.length > 0) {
      detailLines.push(`- **Blocking files:** ${report.blockingFiles.map((f) => `\`${f}\``).join(", ")}`);
    }
    if (report.blockingPackages.length > 0) {
      detailLines.push(`- **Blocking packages:** ${report.blockingPackages.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (report.disposition === "BLOCKED_LOCKFILE_MISMATCH") {
      detailLines.push(
        `- **Expected manifest hashes:**`,
        `  - \`baselineRevision\`: \`${report.baselineRevision}\``,
        `  - \`baselinePackageJsonSha256\`: \`${report.baselinePackageJsonSha256}\``,
        `  - \`candidatePackageJsonSha256\`: \`${report.candidatePackageJsonSha256}\``,
        `  - \`baselineDependencyLockSha256\`: \`${report.baselineDependencyLockSha256}\``,
        `  - \`candidateDependencyLockSha256\`: \`${report.candidateDependencyLockSha256}\``,
        `  - \`changedPackages\`: \`${JSON.stringify(report.changedPackages)}\``,
      );
    }
    writeStepSummary(detailLines.join("\n") + "\n");
    process.stderr.write(`[scheduling-profile admission] ${report.disposition}: ${report.summary}\n`);
    process.exitCode = 1;
    return receipt;
  }

  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAdmissionEvaluation();
}
