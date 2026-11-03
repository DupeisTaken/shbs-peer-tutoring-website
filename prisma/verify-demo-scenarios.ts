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
  // Prove the narrow cleanup actually removes a pristine legacy fixture first.
  // Then simulate an operator's review and edits to both intake source paths.
  // This test database deliberately retains the edits for inspection.
  const cardId = seedId("card-bella-y1");
  assert.equal(await db.disciplinaryCard.count({ where: { id: cardId } }), 0);
  const createRedundantCard = () =>
    db.disciplinaryCard.create({
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
  await createRedundantCard();
  const cleaned = await seedDemoScenarios(db);
  assert.deepEqual(cleaned, {
    selfServiceCreated: 0,
    provenanceFilled: 0,
    redundantCardsRemoved: 1,
    deviations: [],
  });
  assert.equal(await db.disciplinaryCard.count({ where: { id: cardId } }), 0);
  assert.equal(
    await snapshot(),
    before,
    "Pristine card cleanup must leave all other evidence untouched",
  );
  await createRedundantCard();
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
  const changedSelfServiceId = seedId("tutee-henry");
  await db.user.update({
    where: { id: seedId("student-user-henry") },
    data: { email: "operator-henry@example.test" },
  });
  await db.tutee.update({
    where: { id: changedSelfServiceId },
    data: {
      preferredContact: "Operator changed a self-service contact preference.",
    },
  });
  // This unassigned self-service fixture has no attendance or historical evidence
  // to discard. Its retained account, survey and consent must not recreate it.
  const deletedSelfServiceId = seedId("tutee-pending-lily");
  assert.equal(
    await db.pairingTutee.count({ where: { tuteeId: deletedSelfServiceId } }),
    0,
  );
  assert.equal(
    await db.sessionTutee.count({ where: { tuteeId: deletedSelfServiceId } }),
    0,
  );
  assert.equal(
    await db.sessionPlanParticipant.count({
      where: { tuteeId: deletedSelfServiceId },
    }),
    0,
  );
  assert.equal(
    await db.historicalAcademicRecord.count({
      where: { tuteeId: deletedSelfServiceId },
    }),
    0,
  );
  await db.tutee.delete({ where: { id: deletedSelfServiceId } });
  const changed = await snapshot();
  const preserved = await seedDemoScenarios(db);
  assert.ok(
    preserved.deviations.some((item) => item.startsWith("pending-tom:")),
  );
  assert.ok(
    preserved.deviations.some((item) => item.startsWith("card-bella-y1:")),
  );
  assert.ok(preserved.deviations.some((item) => item.startsWith("henry:")));
  assert.ok(
    preserved.deviations.some((item) => item.startsWith("pending-lily:")),
  );
  assert.equal(
    await db.tutee.count({ where: { id: deletedSelfServiceId } }),
    0,
  );
  assert.equal(
    (
      await db.user.findUniqueOrThrow({
        where: { id: seedId("student-user-henry") },
      })
    ).email,
    "operator-henry@example.test",
  );
  assert.equal(
    (await db.tutee.findUniqueOrThrow({ where: { id: changedSelfServiceId } }))
      .preferredContact,
    "Operator changed a self-service contact preference.",
  );
  assert.equal(preserved.selfServiceCreated, 0);
  assert.equal(preserved.redundantCardsRemoved, 0);
  assert.equal(
    await snapshot(),
    changed,
    "Edited intake/card and frozen account/report/consent evidence must survive enrichment",
  );
  console.log(
    "Scenario enrichment verified: 70/30 manifest, evidence-backed provenance, pristine cleanup, idempotence, and preservation of edited/deleted self-service fixtures and edited staff intake/cards.",
  );
} finally {
  await db.$disconnect();
}
