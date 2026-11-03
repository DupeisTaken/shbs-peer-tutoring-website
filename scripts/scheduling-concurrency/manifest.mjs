import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  planClockCampaign,
  validateClockAdmissionBudget,
} from "../scheduling-profile/clock-admission.mjs";

export const primaryControl = "223a1b213a7a5167187b057d08a349d30f0087ad";
export const priorCandidate = "7a3c4d0e655bb4dbf0bbc08df77ecbfd88a92347";
export const nodeImage =
  "fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914";
// This actual anchor was admitted in run 41626762202 and verified in all 145
// reports. Reuse is possible only while the original complete interval is live.
const priorAnchor = "2026-11-03T11:20:59.961Z";

export function supplementClock(now = new Date()) {
  try {
    const clockAdmission = validateClockAdmissionBudget({
      anchor: priorAnchor,
      startedAt: now,
      timeoutMs: 75 * 60_000,
    });
    return {
      status: "ADMITTED",
      anchor: priorAnchor,
      clockAdmission,
      origin: "verified-original-interval",
    };
  } catch {
    return { ...planClockCampaign(now), origin: "fresh-declaration" };
  }
}

const reused = [
  "scripts/profile-scheduling-requests.ts",
  ...[
    "fixtures.ts",
    "scenarios.ts",
    "clock-admission.mjs",
    "metrics.ts",
    "parity.ts",
    "http.ts",
    "register-server-runtime.mjs",
    "server-runtime-hooks.mjs",
    "controlled-contention.ts",
    "contention-references.mjs",
    "contention-fence-witness.ts",
  ].map((n) => "scripts/scheduling-profile/" + n),
];
/** @param {string} root */
export function harnessHashes(root) {
  const paths = [
    ...reused,
    ...readdirSync(join(root, "scripts/scheduling-concurrency"), {
      withFileTypes: true,
    })
      .filter((x) => x.isFile())
      .map((x) => "scripts/scheduling-concurrency/" + x.name),
  ].sort();
  assert.ok(paths.includes("scripts/scheduling-concurrency/run.ts"));
  return Object.fromEntries(
    paths.map((p) => [
      p,
      createHash("sha256")
        .update(readFileSync(join(root, p)))
        .digest("hex"),
    ]),
  );
}
