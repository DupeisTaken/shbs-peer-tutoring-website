import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { utcDatabaseUrl } from "../src/server/database-url";
import { confirmCurrentAccountAcademics } from "../src/server/academics";
import { seedDemoAcademics } from "./demo-academics";
import { verifyDemoAcademicCoverage } from "./demo-academics-verification";
import { assertDemoDatabase, seedId } from "./demo-support";

const connectionString = process.env.DATABASE_URL ?? "";
assertDemoDatabase(connectionString);
assert.ok(
  new URL(connectionString).pathname.endsWith("_test"),
  "This edit-preservation probe requires a disposable shbs_*_test database, never the exploration demo.",
);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(connectionString) }),
});
async function snapshot() {
  // Only compare hashes in output; never serialize credentials or mailbox proofs.
  const evidence = [
    await db.academicProfile.findMany({ orderBy: { userId: "asc" } }),
    await db.academicConfirmation.findMany({ orderBy: { id: "asc" } }),
    await db.user.findMany({
      orderBy: { id: "asc" },
      select: { id: true, gradeLevel: true, profileVersion: true },
    }),
    await db.tutor.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        gradeLevel: true,
        gradeSchoolYear: true,
        gradeConfirmedAt: true,
      },
    }),
    await db.tutee.findMany({
      orderBy: { id: "asc" },
      select: { id: true, gradeLevel: true, intakeTermId: true },
    }),
    await db.historicalAcademicRecord.findMany({ orderBy: { id: "asc" } }),
    await db.historicalAcademicCorrection.findMany({ orderBy: { id: "asc" } }),
    await db.policyAcceptance.findMany({ orderBy: { id: "asc" } }),
    await db.studentSurvey.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        payload: true,
        policySnapshot: true,
        submittedAt: true,
        confirmedAt: true,
      },
    }),
    await db.schoolHoursReport.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        snapshot: true,
        sourceBaseline: true,
        contentHash: true,
      },
    }),
  ];
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
try {
  console.log("Academic coverage:", await verifyDemoAcademicCoverage(db));
  const before = await snapshot();
  assert.deepEqual(await seedDemoAcademics(db), {
    confirmedAccounts: 0,
    datedTutees: 0,
    confirmedRosterTutors: 0,
  });
  assert.equal(
    await snapshot(),
    before,
    "Selective repeat must not rewrite academic or frozen evidence",
  );
  const alice = await db.user.findUniqueOrThrow({
    where: { id: seedId("user-alice") },
    include: { academicProfile: true },
  });
  const grade = alice.academicProfile?.gradeLevel === 12 ? 9 : 12;
  await confirmCurrentAccountAcademics(
    db,
    alice.id,
    {
      status: "REPORTED",
      gradeLevel: grade,
      rawGrade: null,
      expectedSchoolYear: "26-27",
      expectedProfileVersion: alice.profileVersion,
      reason:
        "Disposable test: preserve an operator's academic edit during selective demo enrichment.",
    },
    { actorId: seedId("user-admin"), source: "DEMO_PRESERVATION_TEST" },
  );
  const edited = await snapshot();
  await seedDemoAcademics(db);
  assert.equal(
    await snapshot(),
    edited,
    "Selective enrichment must preserve the operator edit and frozen evidence",
  );
  assert.equal(
    (
      await db.academicProfile.findUniqueOrThrow({
        where: { userId: alice.id },
      })
    ).gradeLevel,
    grade,
  );
  console.log(
    "Academic enrichment verified: complete majority, idempotent repeat, operator edit retained, and report/policy/survey/history evidence unchanged.",
  );
} finally {
  await db.$disconnect();
}
