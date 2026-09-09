import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { assertDemoDatabase, seedId } from "./demo-support";
import {
  validatePanel,
  validateInterviewDecision,
} from "../src/server/interviews";
import { requirePolicy } from "../src/server/policy-acceptance";
import { z } from "zod";
import { surveyInput } from "../src/server/student-survey";

const connectionString = process.env.DATABASE_URL!;
assertDemoDatabase(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  // Use actual workflow validators, not merely row counts: visible records must be actionable.
  for (const key of ["fiona", "george", "hana"]) {
    const id = seedId(`app-${key}`);
    const panel = await db.interviewAssignment.findMany({
      where: { applicationId: id },
    });
    await validatePanel(
      db,
      id,
      panel.map((p) => p.tutorId),
      seedId("tutor-carol"),
    );
    await validateInterviewDecision(
      db,
      id,
      key !== "hana",
      seedId("tutor-carol"),
    );
    const application = await db.tutorApplication.findUniqueOrThrow({
      where: { id },
    });
    assert.ok(application.interviewCompletedAt);
    for (const member of panel) {
      assert.ok(member.attended);
      const credit = await db.serviceHourAdjustment.findUniqueOrThrow({
        where: { id: `interview_${id}_${member.tutorId}` },
      });
      assert.equal(credit.amount, application.interviewDurationMin! / 60);
    }
    if (application.decidedAt)
      assert.ok(application.decidedAt >= application.interviewCompletedAt);
  }
  for (const delegate of [
    db.room,
    db.tutorMeeting,
    db.tutorStatusRequest,
    db.tuteeRemovalRequest,
  ] as const) {
    const rows = await (delegate.findMany as () => Promise<{ id: string }[]>)();
    for (const row of rows) z.string().cuid().parse(row.id);
  }
  for (const key of ["emma", "frank", "grace", "pending-kate"]) {
    const userId = seedId(`student-user-${key}`);
    const ownership = await db.studentProfileOwnership.findUniqueOrThrow({
      where: { tuteeId: seedId(`tutee-${key}`) },
    });
    assert.equal(ownership.userId, userId);
    await requirePolicy(db, userId, "tutee-policy");
  }
  assert.ok(
    await db.studentSurvey.count({
      where: { state: "OPEN", tuteeId: null, confirmedAt: null },
    }),
  );
  for (const survey of await db.studentSurvey.findMany()) {
    const payload = surveyInput.parse(survey.payload);
    if (survey.tuteeId) {
      const profile = await db.tutee.findUniqueOrThrow({
        where: { id: survey.tuteeId },
      });
      assert.equal(profile.firstChoiceId, payload.firstChoiceId);
      assert.equal(profile.secondChoiceId, payload.secondChoiceId ?? null);
    }
  }
  assert.ok(
    await db.studentRequestReview.count({ where: { state: "PENDING" } }),
  );
  assert.ok(await db.studentAppeal.count({ where: { state: "PENDING" } }));
  assert.ok(await db.translationDraft.count({ where: { state: "PENDING" } }));
  assert.ok(await db.studentFeedback.count());
  assert.ok(await db.studentQuarterBlock.count());
  assert.ok(await db.directMessage.count());
  for (const message of await db.directMessage.findMany())
    z.string().uuid().parse(message.clientKey);
  assert.equal(await db.user.count({ where: { role: "HEAD" } }), 1);
  assert.equal(await db.term.count({ where: { active: true } }), 1);
  console.log(
    "Demo verified: API-valid identities, legal interview panels and outcomes, student ownership/consent, modern queues and singleton leadership/term.",
  );
} finally {
  await db.$disconnect();
}
