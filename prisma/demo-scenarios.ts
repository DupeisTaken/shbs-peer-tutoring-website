import { randomBytes } from "node:crypto";
import type { PrismaClient, Tutee } from "../generated/prisma";
import { surveyInput } from "../src/lib/student-signup";
import { hashPassword } from "../src/server/auth/password";
import { currentPolicy } from "../src/server/policy-acceptance";
import { lockEntity } from "../src/server/transactions";
import { DEMO_SCENARIO_TUTEES } from "./demo-scenario-manifest";
import { assertDemoDatabase, seedId } from "./demo-support";

const redundantCards = [
  [
    "card-umar-inv",
    "umar",
    "karen",
    "INVALID",
    "Late — but tutee had notified; flagged invalid.",
  ],
  [
    "card-bella-y1",
    "bella",
    "nora",
    "VALID",
    "Late submission of practice set.",
  ],
  ["card-gabe-y1", "gabe", "nora", "VALID", "Phone use during session."],
] as const;
const pendingIntake: Record<
  string,
  { contact: string; slots: string[]; second?: string }
> = {
  "pending-omar": {
    contact: "Email me; I reply within a day",
    slots: ["mon-a", "wed-a"],
    second: "precalc",
  },
  "pending-lily": {
    contact: "Call after 5pm",
    slots: ["fri-a"],
    second: "english",
  },
  "pending-raj": {
    contact: "WeChat / text 555-0188",
    slots: ["wed-b", "thu-b"],
    second: "compsci",
  },
  "pending-sara": { contact: "Email preferred", slots: ["tue-b"] },
  "pending-tom": {
    contact: "Text 555-0177",
    slots: ["fri-b"],
    second: "worldhistory",
  },
  "pending-uma": {
    contact: "Email; replies same day",
    slots: ["thu-a"],
    second: "biology",
  },
  "pending-victor": {
    contact: "Text 555-0199 evenings",
    slots: ["mon-b", "tue-a"],
    second: "physics",
  },
  "pending-wendy": { contact: "Email preferred", slots: ["tue-a"] },
};
function untouchedIntake(
  row: Tutee & { availabilities: { slotId: string }[] },
  fixture: (typeof DEMO_SCENARIO_TUTEES)[number],
) {
  const pending = pendingIntake[fixture.key];
  return (
    row.englishName === fixture.name &&
    row.gradeLevel === fixture.grade &&
    row.firstChoiceId === seedId(`course-${fixture.subject}`) &&
    row.secondChoiceId ===
      (pending?.second ? seedId(`course-${pending.second}`) : null) &&
    row.email === (pending ? `${fixture.key.slice(8)}@example.edu` : null) &&
    row.phone === null &&
    row.notes === null &&
    row.preferredContact === (pending?.contact ?? null) &&
    row.firstName === null &&
    row.lastName === null &&
    row.preferredName === null &&
    (row.legacyName === null || row.legacyName === fixture.name) &&
    row.alternativeNames === null &&
    !row.academicallyGraduated &&
    row.status === (pending ? "PENDING" : "ACTIVE") &&
    row.signedRulebook === !!pending &&
    row.signatureName === (pending ? fixture.name : null) &&
    (pending
      ? !!row.signedAt &&
        Math.abs(row.signedAt.getTime() - row.createdAt.getTime()) < 1_000
      : row.signedAt === null) &&
    JSON.stringify(row.availabilities.map((item) => item.slotId).sort()) ===
      JSON.stringify(
        (pending?.slots ?? []).map((slot) => seedId(`slot-${slot}`)).sort(),
      )
  );
}

/** Local fixture upgrade only. Existing proof/consent, credentials and operator
 * edits win; deviations are reported instead of forcing the advertised ratio. */
export async function seedDemoScenarios(db: PrismaClient) {
  assertDemoDatabase(process.env.DATABASE_URL ?? "");
  const result = {
    selfServiceCreated: 0,
    provenanceFilled: 0,
    redundantCardsRemoved: 0,
    deviations: [] as string[],
  };
  const termId = seedId("term-2026-q1");
  const term = await db.term.findFirst({ where: { active: true } });
  if (term?.id !== termId || term.schoolYear !== "26-27") {
    result.deviations.push(
      "The demo term changed; no scenario enrichment applied.",
    );
    return result;
  }
  const passwordHash = hashPassword("Password123!");
  for (const fixture of DEMO_SCENARIO_TUTEES) {
    if (fixture.source === "UNKNOWN") {
      const unknown = await db.tutee.findUnique({
        where: { id: seedId(`tutee-${fixture.key}`) },
      });
      if (
        !unknown ||
        !["ACTIVE", "PENDING"].includes(unknown.status) ||
        unknown.signupSource !== "UNKNOWN"
      )
        result.deviations.push(
          `${fixture.key}: unknown-source edge fixture is absent or changed`,
        );
      continue;
    }
    await db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      const currentTerm = await tx.term.findUnique({ where: { id: termId } });
      if (!currentTerm?.active || currentTerm.schoolYear !== "26-27") return;
      const id = seedId(`tutee-${fixture.key}`);
      await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${id} FOR UPDATE`;
      const row = await tx.tutee.findUnique({
        where: { id },
        include: {
          user: true,
          availabilities: true,
          pairings: { include: { pairing: true } },
        },
      });
      if (!row || !["ACTIVE", "PENDING"].includes(row.status)) {
        result.deviations.push(
          `${fixture.key}: current fixture is absent or inactive`,
        );
        return;
      }
      const surveys = await tx.studentSurvey.findMany({
        where: { tuteeId: id },
      });
      const ownership = await tx.studentProfileOwnership.findUnique({
        where: { tuteeId: id },
      });
      if (fixture.source === "STAFF") {
        if (row.signupSource === "STAFF") return;
        if (
          row.signupSource !== "UNKNOWN" ||
          surveys.length ||
          row.user ||
          ownership ||
          !untouchedIntake(row, fixture) ||
          (await tx.auditLog.count({ where: { entityId: id } }))
        ) {
          result.deviations.push(
            `${fixture.key}: staff provenance differs from the untouched fixture`,
          );
          return;
        }
        await tx.tutee.update({
          where: { id },
          data: { signupSource: "STAFF" },
        });
        result.provenanceFilled++;
        return;
      }
      const userId = seedId(`student-user-${fixture.key}`);
      const surveyId = seedId(`survey-${fixture.key}`);
      const existing = surveys.find((survey) => survey.id === surveyId);
      if (existing) {
        // Upgrade only provenance on old verified fixtures; accepted payloads and
        // dates remain their original evidence, including later operator edits.
        const payload = surveyInput.safeParse(existing.payload);
        const accepted =
          row.user &&
          (await tx.policyAcceptance.findUnique({
            where: {
              userId_slug_revision: {
                userId: row.user.id,
                slug: "tutee-policy",
                revision: existing.policyRevision,
              },
            },
          }));
        if (
          !payload.success ||
          !existing.confirmedAt ||
          row.user?.id !== userId ||
          ownership?.userId !== userId ||
          !accepted ||
          JSON.stringify(accepted.snapshot) !==
            JSON.stringify(existing.policySnapshot) ||
          payload.data.email !== existing.email ||
          existing.email !== row.user.email
        ) {
          result.deviations.push(
            `${fixture.key}: existing signup evidence needs review`,
          );
          return;
        }
        if (
          row.signupSource === "SELF_SERVICE" &&
          row.signupSubmittedAt?.getTime() === existing.submittedAt.getTime()
        )
          return;
        if (row.signupSource !== "UNKNOWN" || row.signupSubmittedAt) {
          result.deviations.push(
            `${fixture.key}: existing provenance or priority was changed`,
          );
          return;
        }
        await tx.tutee.update({
          where: { id },
          data: {
            signupSource: "SELF_SERVICE",
            signupSubmittedAt: existing.submittedAt,
          },
        });
        result.provenanceFilled++;
        return;
      }
      if (
        surveys.length ||
        row.user ||
        ownership ||
        row.signupSource !== "UNKNOWN" ||
        row.signupSubmittedAt ||
        !untouchedIntake(row, fixture) ||
        (row.intakeTermId && row.intakeTermId !== termId) ||
        (await tx.auditLog.count({ where: { entityId: id } })) ||
        (await tx.historicalAcademicRecord.count({ where: { tuteeId: id } }))
      ) {
        result.deviations.push(
          `${fixture.key}: existing identity/intake differs from the untouched fixture`,
        );
        return;
      }
      const email = `demo-${fixture.key}@example.test`;
      if (
        (await tx.user.count({
          where: {
            OR: [
              { id: userId },
              { email },
              { username: `demo${fixture.key.replaceAll("-", "")}` },
            ],
          },
        })) ||
        (await tx.accountEmail.count({ where: { email } }))
      ) {
        result.deviations.push(
          `${fixture.key}: synthetic account identity already exists`,
        );
        return;
      }
      const [firstName, ...last] = fixture.name.split(" ");
      const lastName = last.join(" ");
      const submittedAt = row.signedAt ?? row.createdAt;
      const confirmedAt = new Date(
        Math.max(
          submittedAt.getTime(),
          Math.min(Date.now(), submittedAt.getTime() + 60_000),
        ),
      );
      const policy = await currentPolicy(tx, "tutee-policy");
      const slotIds = [
        ...new Set([
          ...row.availabilities.map((item) => item.slotId),
          ...row.pairings.flatMap(({ pairing }) =>
            pairing.timeSlotId ? [pairing.timeSlotId] : [],
          ),
        ]),
      ];
      // Unmatched ordinary requests retain an explicit synthetic available block.
      if (!slotIds.length) slotIds.push(seedId("slot-mon-a"));
      const payload = surveyInput.parse({
        firstName,
        lastName,
        englishName: fixture.name,
        email,
        gradeLevel: fixture.grade,
        preferredContact: row.preferredContact ?? "Use the program inbox",
        firstChoiceId: row.firstChoiceId,
        ...(row.secondChoiceId ? { secondChoiceId: row.secondChoiceId } : {}),
        slotIds,
        signatureName: fixture.name,
        agreed: true,
        policyRevision: policy.revision,
      });
      await tx.user.create({
        data: {
          id: userId,
          email,
          username: `demo${fixture.key.replaceAll("-", "")}`,
          name: fixture.name,
          firstName,
          lastName,
          role: "STUDENT",
          tuteeMember: true,
          studentId: id,
          passwordHash,
          emailVerifiedAt: confirmedAt,
        },
      });
      await tx.studentProfileOwnership.create({
        data: { tuteeId: id, userId },
      });
      await tx.policyAcceptance.create({
        data: {
          id: seedId(`acceptance-${userId}-${policy.slug}-${policy.revision}`),
          userId,
          slug: policy.slug,
          revision: policy.revision,
          snapshot: policy.documents,
          signature: fixture.name,
          acceptedAt: submittedAt,
        },
      });
      await tx.studentSurvey.create({
        data: {
          id: surveyId,
          email,
          tuteeId: id,
          intakeTermId: termId,
          payload,
          policyRevision: policy.revision,
          policySnapshot: policy.documents,
          submittedAt,
          confirmedAt,
          expiresAt: confirmedAt,
          state: "OPEN",
          tokenHash: randomBytes(32).toString("hex"),
          firstAssignedAt: row.pairings.length
            ? new Date(
                Math.max(
                  confirmedAt.getTime(),
                  Math.min(
                    ...row.pairings.map(({ pairing }) =>
                      pairing.createdAt.getTime(),
                    ),
                  ),
                ),
              )
            : null,
        },
      });
      await tx.tutee.update({
        where: { id },
        data: {
          signupSource: "SELF_SERVICE",
          signupSubmittedAt: submittedAt,
          intakeTermId: termId,
          email,
          preferredContact: payload.preferredContact,
          firstName: row.firstName ?? firstName,
          lastName: row.lastName ?? lastName,
          signedRulebook: true,
          signatureName: row.signatureName ?? fixture.name,
          signedAt: row.signedAt ?? submittedAt,
        },
      });
      for (const slotId of slotIds)
        await tx.tuteeAvailability.upsert({
          where: { tuteeId_slotId: { tuteeId: id, slotId } },
          update: {},
          create: { tuteeId: id, slotId },
        });
      result.selfServiceCreated++;
      result.provenanceFilled++;
    });
  }
  for (const [key, tutee, tutor, status, reason] of redundantCards) {
    await db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      const currentTerm = await tx.term.findUnique({ where: { id: termId } });
      if (!currentTerm?.active || currentTerm.schoolYear !== "26-27") return;
      const id = seedId(key);
      await tx.$queryRaw`SELECT id FROM "DisciplinaryCard" WHERE id=${id} FOR UPDATE`;
      const card = await tx.disciplinaryCard.findUnique({ where: { id } });
      if (!card) return;
      const untouched =
        card.tuteeId === seedId(`tutee-${tutee}`) &&
        card.issuedByTutorId === seedId(`tutor-${tutor}`) &&
        card.color === "YELLOW" &&
        card.source === "TUTOR" &&
        card.reason === reason &&
        card.reviewStatus === status &&
        card.reviewNote === null &&
        card.sessionId === null &&
        card.reviewedById === seedId("user-admin") &&
        card.reviewedAt &&
        Math.abs(
          card.updatedAt.getTime() - card.reviewedAt.getTime() - 2 * 86_400_000,
        ) < 5_000;
      const referenced =
        (await tx.studentAppeal.count({ where: { cardId: id } })) ||
        (await tx.auditLog.count({
          where: { entityId: { in: [id, card.tuteeId] } },
        })) ||
        (await tx.approvalRequest.findMany({ select: { payload: true } })).some(
          (request) => JSON.stringify(request.payload).includes(id),
        );
      if (!untouched || referenced) {
        result.deviations.push(`${key}: changed or referenced card retained`);
        return;
      }
      result.redundantCardsRemoved += (
        await tx.disciplinaryCard.deleteMany({
          where: { id, updatedAt: card.updatedAt },
        })
      ).count;
    });
  }
  return result;
}
