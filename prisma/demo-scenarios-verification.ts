import assert from "node:assert/strict";
import type { PrismaClient } from "../generated/prisma";
import { academicSummary, normalizeGrade } from "../src/lib/academics";
import { surveyInput } from "../src/lib/student-signup";
import {
  DEMO_CURRENT_TUTOR_KEYS,
  DEMO_SCENARIO_TUTEES,
  DEMO_TUTOR_EDGE_REASONS,
} from "./demo-scenario-manifest";
import { seedId } from "./demo-support";

/** Verify the displayed roles, not unrelated row totals. Ordinary fixtures must
 * actually have complete academic/provenance evidence and no special review state. */
export async function verifyDemoScenarios(db: PrismaClient) {
  const counts = { ordinary: 0, edge: 0, selfService: 0, staff: 0, unknown: 0 };
  for (const fixture of DEMO_SCENARIO_TUTEES) {
    const id = seedId(`tutee-${fixture.key}`);
    const row = await db.tutee.findUniqueOrThrow({
      where: { id },
      include: { user: { include: { academicProfile: true } } },
    });
    assert.ok(["ACTIVE", "PENDING"].includes(row.status));
    assert.equal(row.signupSource, fixture.source);
    if (fixture.source === "SELF_SERVICE") {
      counts.selfService++;
      const survey = await db.studentSurvey.findUniqueOrThrow({
        where: { id: seedId(`survey-${fixture.key}`) },
      });
      const payload = surveyInput.parse(survey.payload);
      assert.equal(survey.tuteeId, id);
      assert.equal(survey.intakeTermId, seedId("term-2026-q1"));
      assert.ok(survey.confirmedAt && survey.confirmedAt >= survey.submittedAt);
      assert.equal(
        row.signupSubmittedAt?.getTime(),
        survey.submittedAt.getTime(),
      );
      assert.equal(payload.email, survey.email);
      assert.equal(payload.firstChoiceId, row.firstChoiceId);
      assert.equal(payload.secondChoiceId ?? null, row.secondChoiceId);
      assert.ok(row.user?.emailVerifiedAt);
      assert.equal(row.user.email, survey.email);
      const owner = await db.studentProfileOwnership.findUniqueOrThrow({
        where: { tuteeId: id },
      });
      assert.equal(owner.userId, row.user.id);
      const acceptance = await db.policyAcceptance.findUniqueOrThrow({
        where: {
          userId_slug_revision: {
            userId: row.user.id,
            slug: "tutee-policy",
            revision: survey.policyRevision,
          },
        },
      });
      assert.deepEqual(acceptance.snapshot, survey.policySnapshot);
      assert.equal(payload.policyRevision, survey.policyRevision);
      assert.equal(acceptance.signature, payload.signatureName);
      assert.ok(acceptance.acceptedAt <= survey.confirmedAt);
      if (survey.firstAssignedAt)
        assert.ok(survey.firstAssignedAt >= survey.submittedAt);
      if (!["emma", "frank", "grace", "pending-kate"].includes(fixture.key)) {
        assert.ok(row.user.firstName && row.user.lastName);
        assert.equal(
          `${row.user.firstName} ${row.user.lastName}`,
          fixture.name,
        );
        assert.equal(row.email, payload.email);
        assert.equal(row.preferredContact, payload.preferredContact);
        assert.equal(row.signatureName, payload.signatureName);
        assert.equal(row.signedAt?.getTime(), survey.submittedAt.getTime());
        assert.equal(row.signedRulebook, true);
      }
    } else {
      counts[fixture.source === "STAFF" ? "staff" : "unknown"]++;
      assert.equal(await db.studentSurvey.count({ where: { tuteeId: id } }), 0);
    }
    if (fixture.edge) {
      counts.edge++;
      const special =
        row.signupSource === "UNKNOWN" ||
        (row.user &&
          academicSummary(row.user.academicProfile, "26-27")
            .needsConfirmation) ||
        (await db.disciplinaryCard.count({ where: { tuteeId: id } })) ||
        (await db.tuteeRemovalRequest.count({
          where: { tuteeId: id, state: "PENDING" },
        })) ||
        (await db.studentRequestReview.count({
          where: { survey: { tuteeId: id }, state: "PENDING" },
        }));
      assert.ok(special, `${fixture.key} needs observable edge-case evidence`);
      if (fixture.key === "frank") {
        assert.ok(
          await db.studentAppeal.count({
            where: { studentId: id, state: "PENDING" },
          }),
        );
        assert.ok(
          await db.studentRequestReview.count({
            where: {
              survey: { tuteeId: id },
              kind: "STUDENT_ABORT",
              state: "PENDING",
            },
          }),
        );
      } else if (fixture.key === "grace")
        assert.ok(
          await db.studentRequestReview.count({
            where: {
              survey: { tuteeId: id },
              kind: "SCHEDULE_CONFLICT",
              state: "PENDING",
            },
          }),
        );
      else if (["mia", "noah", "eli", "cory"].includes(fixture.key))
        assert.ok(await db.disciplinaryCard.count({ where: { tuteeId: id } }));
      else if (fixture.key === "will")
        assert.ok(
          await db.tuteeRemovalRequest.count({
            where: { tuteeId: id, state: "PENDING" },
          }),
        );
      else if (fixture.key === "pending-kate")
        assert.equal(
          academicSummary(row.user?.academicProfile, "26-27").needsConfirmation,
          true,
        );
    } else {
      counts.ordinary++;
      assert.equal(
        await db.disciplinaryCard.count({ where: { tuteeId: id } }),
        0,
        `${fixture.key} has unexpected discipline`,
      );
      assert.equal(
        await db.tuteeRemovalRequest.count({
          where: { tuteeId: id, state: "PENDING" },
        }),
        0,
      );
      assert.equal(
        await db.studentAppeal.count({
          where: { studentId: id, state: "PENDING" },
        }),
        0,
      );
      assert.equal(
        await db.studentRequestReview.count({
          where: { survey: { tuteeId: id }, state: "PENDING" },
        }),
        0,
      );
      assert.equal(
        await db.sessionTutee.count({
          where: { tuteeId: id, status: "UNEXCUSED_ABSENT" },
        }),
        0,
      );
      if (row.user)
        assert.equal(
          academicSummary(row.user.academicProfile, "26-27").needsConfirmation,
          false,
        );
      else {
        assert.ok(normalizeGrade(row.gradeLevel).gradeLevel);
        assert.equal(row.intakeTermId, seedId("term-2026-q1"));
      }
    }
  }
  for (const key of DEMO_CURRENT_TUTOR_KEYS) {
    const id = seedId(`tutor-${key}`);
    const row = await db.tutor.findUniqueOrThrow({
      where: { id },
      include: { user: { include: { academicProfile: true } } },
    });
    assert.ok(!["GRADUATED", "ARCHIVED"].includes(row.status));
    if (DEMO_TUTOR_EDGE_REASONS[key]) {
      counts.edge++;
      const special =
        row.status !== "ACTIVE" ||
        (row.user
          ? academicSummary(row.user.academicProfile, "26-27").needsConfirmation
          : !row.gradeSchoolYear) ||
        (key.startsWith("clash-") &&
          row.lastName === "Kim" &&
          row.username?.startsWith("akim27")) ||
        (await db.tutorStatusRequest.count({
          where: { tutorId: id, state: "PENDING" },
        })) ||
        (await db.sessionFlag.count({
          where: { tutorId: id, state: "PENDING" },
        })) ||
        (await db.serviceHourAdjustment.count({
          where: { tutorId: id, schoolYear: "26-27", type: "PUNISHMENT" },
        }));
      assert.ok(special, `${key} needs observable edge-case evidence`);
      if (key === "alice")
        assert.ok(
          await db.sessionFlag.count({
            where: { tutorId: id, state: "PENDING" },
          }),
        );
      if (["bob", "karen"].includes(key))
        assert.ok(
          await db.serviceHourAdjustment.count({
            where: { tutorId: id, schoolYear: "26-27", type: "PUNISHMENT" },
          }),
        );
      if (["leo", "oscar"].includes(key))
        assert.ok(
          await db.tutorStatusRequest.count({
            where: { tutorId: id, state: "PENDING" },
          }),
        );
      if (["evan", "oscar"].includes(key))
        assert.equal(
          academicSummary(row.user?.academicProfile, "26-27").needsConfirmation,
          true,
        );
      if (key === "madonna") {
        assert.equal(row.lastName, "");
        assert.equal(row.gradeSchoolYear, null);
      }
      if (key.startsWith("clash-")) {
        assert.equal(row.lastName, "Kim");
        assert.equal(row.username, key === "clash-a" ? "akim27" : "akim27b");
      }
    } else {
      counts.ordinary++;
      assert.equal(row.status, "ACTIVE");
      assert.equal(
        await db.tutorStatusRequest.count({
          where: { tutorId: id, state: "PENDING" },
        }),
        0,
      );
      assert.equal(
        await db.sessionFlag.count({
          where: { tutorId: id, state: "PENDING" },
        }),
        0,
      );
      assert.equal(
        await db.serviceHourAdjustment.count({
          where: { tutorId: id, schoolYear: "26-27", type: "PUNISHMENT" },
        }),
        0,
      );
      assert.equal(
        academicSummary(row.user?.academicProfile, "26-27").needsConfirmation,
        false,
      );
    }
  }
  assert.deepEqual(counts, {
    ordinary: 42,
    edge: 18,
    selfService: 30,
    staff: 10,
    unknown: 2,
  });
  return counts;
}
