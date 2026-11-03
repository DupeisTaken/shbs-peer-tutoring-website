import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { utcDatabaseUrl } from "../src/server/database-url";
import { seedDemoScenarios } from "./demo-scenarios";
import { verifyDemoScenarios } from "./demo-scenarios-verification";
import { assertDemoDatabase, seedId } from "./demo-support";

const connectionString = process.env.DATABASE_URL ?? "";
assertDemoDatabase(connectionString);
assert.ok(
  new URL(connectionString).pathname.endsWith("_test"),
  "Scenario edit probes require a disposable shbs_*_test database.",
);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(connectionString) }),
});
async function snapshot() {
  // Credentials are compared only in memory; this digest and its source rows are never printed.
  const rows = [
    await db.user.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        username: true,
        passwordHash: true,
        name: true,
        profileVersion: true,
      },
    }),
    await db.tutee.findMany({ orderBy: { id: "asc" } }),
    await db.studentSurvey.findMany({ orderBy: { id: "asc" } }),
    await db.policyAcceptance.findMany({ orderBy: { id: "asc" } }),
    await db.schoolHoursReport.findMany({ orderBy: { id: "asc" } }),
    await db.historicalAcademicRecord.findMany({ orderBy: { id: "asc" } }),
    await db.disciplinaryCard.findMany({ orderBy: { id: "asc" } }),
  ];
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
try {
  console.log("Scenario coverage:", await verifyDemoScenarios(db));
  const before = await snapshot();
  const repeated = await seedDemoScenarios(db);
  assert.deepEqual(repeated, {
    selfServiceCreated: 0,
    provenanceFilled: 0,
    redundantCardsRemoved: 0,
    deviations: [],
  });
  assert.equal(await snapshot(), before);
  // Simulate an untouched old card, then an operator's review, and an intake edit.
  // This test database deliberately retains the edits for inspection.
  const cardId = seedId("card-bella-y1");
  assert.equal(await db.disciplinaryCard.count({ where: { id: cardId } }), 0);
  await db.disciplinaryCard.create({
    data: {
      id: cardId,
      tuteeId: seedId("tutee-bella"),
      issuedByTutorId: seedId("tutor-nora"),
      color: "YELLOW",
      source: "TUTOR",
      reason: "Late submission of practice set.",
      reviewStatus: "VALID",
      reviewedById: seedId("user-admin"),
      reviewedAt: new Date(Date.now() - 2 * 86_400_000),
    },
  });
  await db.disciplinaryCard.update({
    where: { id: cardId },
    data: { reviewNote: "Operator reviewed this fixture; retain it." },
  });
  await db.tutee.update({
    where: { id: seedId("tutee-pending-tom") },
    data: {
      signupSource: "UNKNOWN",
      preferredContact: "Operator changed the contact preference.",
    },
  });
  const changed = await snapshot();
  const preserved = await seedDemoScenarios(db);
  assert.ok(
    preserved.deviations.some((item) => item.startsWith("pending-tom:")),
  );
  assert.ok(
    preserved.deviations.some((item) => item.startsWith("card-bella-y1:")),
  );
  assert.equal(
    await snapshot(),
    changed,
    "Edited intake/card and frozen account/report/consent evidence must survive enrichment",
  );
  console.log(
    "Scenario enrichment verified: 70/30 manifest, evidence-backed provenance, idempotence, and edited intake/card preservation.",
  );
} finally {
  await db.$disconnect();
}
