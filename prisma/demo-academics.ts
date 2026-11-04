import type { PrismaClient } from "../generated/prisma";
import { normalizeGrade } from "../src/lib/academics";
import { lockAccountProfile } from "../src/server/account-profile";
import { confirmCurrentAccountAcademics } from "../src/server/academics";
import { lockEntity } from "../src/server/transactions";
import { assertDemoDatabase, seedId } from "./demo-support";
import {
  DEMO_CURRENT_TUTEE_KEYS,
  DEMO_SELF_SERVICE_KEYS,
} from "./demo-scenario-manifest";
export { DEMO_CURRENT_TUTEE_KEYS } from "./demo-scenario-manifest";

export const DEMO_ACADEMIC_SOURCE = "DEMO_ACADEMIC_CONFIRMATION";
export const DEMO_TUTOR_KEYS = [
  "alice",
  "bob",
  "carol",
  "david",
  "gina",
  "harold",
  "iris",
  "jason",
  "karen",
  "leo",
  "mona",
  "nora",
  "evan",
  "oscar",
  "pia",
  "reese",
  "chair",
] as const;
export const DEMO_STUDENT_KEYS = [
  ...DEMO_SELF_SERVICE_KEYS,
  "recalled",
  "withdrawn",
] as const;
const incompleteTutors = new Set<string>(["evan", "oscar"]);
const incompleteTutees = new Set<string>(["pending-kate", "pending-zoe"]);

/** Add missing fixture evidence without replaying the general seed. Real account
 * confirmations win, historical originals stay immutable, and no login is invented
 * for roster-only participants. Class-of is derived by the app from grade + year. */
export async function seedDemoAcademics(db: PrismaClient) {
  assertDemoDatabase(process.env.DATABASE_URL ?? "");
  const termId = seedId("term-2026-q1");
  const result = {
    confirmedAccounts: 0,
    datedTutees: 0,
    confirmedRosterTutors: 0,
  };
  const candidates = [
    ...DEMO_TUTOR_KEYS.filter((key) => !incompleteTutors.has(key)).map(
      (key) => ({
        userId: seedId(`user-${key}`),
        tutorId: seedId(`tutor-${key}`),
        studentId: null,
        fallbackGrade: key === "chair" ? 11 : null,
      }),
    ),
    ...DEMO_STUDENT_KEYS.filter((key) => !incompleteTutees.has(key)).map(
      (key) => ({
        userId: seedId(`student-user-${key}`),
        tutorId: null,
        studentId: seedId(`tutee-${key}`),
        fallbackGrade: null,
      }),
    ),
  ];
  for (const candidate of candidates) {
    await db.$transaction(async (tx) => {
      await lockEntity(tx, "program:period");
      const term = await tx.term.findFirst({ where: { active: true } });
      // A refreshed rehearsal belongs to its operator; do not invent a new grade/year.
      if (term?.id !== termId || term.schoolYear !== "26-27") return;
      await lockAccountProfile(tx, candidate.userId);
      const user = await tx.user.findUnique({
        where: { id: candidate.userId },
        include: {
          tutor: true,
          student: true,
          academicProfile: { include: { history: { take: 1 } } },
        },
      });
      if (
        !user ||
        user.mergedIntoId ||
        (candidate.tutorId && user.tutorId !== candidate.tutorId) ||
        (candidate.studentId && user.studentId !== candidate.studentId) ||
        user.academicProfile?.confirmedAt ||
        user.academicProfile?.history.length
      )
        return;
      const grade = normalizeGrade(
        user.tutor?.gradeLevel ??
          user.student?.gradeLevel ??
          candidate.fallbackGrade,
      ).gradeLevel;
      const graduated = user.tutor?.status === "GRADUATED";
      if (!graduated && grade === null) return;
      await confirmCurrentAccountAcademics(
        tx,
        user.id,
        {
          status: graduated ? "GRADUATED" : "REPORTED",
          gradeLevel: graduated ? null : grade,
          rawGrade: null,
          expectedSchoolYear: term.schoolYear,
          expectedProfileVersion: user.profileVersion,
          reason:
            "Synthetic demo academic details; grade and reference year reviewed together.",
        },
        { actorId: seedId("user-admin"), source: DEMO_ACADEMIC_SOURCE },
      );
      result.confirmedAccounts++;
    });
  }
  await db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    const term = await tx.term.findFirst({ where: { active: true } });
    if (term?.id !== termId || term.schoolYear !== "26-27") return;
    // Enrollment evidence is the academic source for accountless tutees. Only add
    // missing period metadata on these known current fixtures, never on archives.
    const dated = await tx.tutee.updateMany({
      where: {
        id: {
          in: DEMO_CURRENT_TUTEE_KEYS.filter(
            (key) => !incompleteTutees.has(key),
          ).map((key) => seedId(`tutee-${key}`)),
        },
        status: { in: ["ACTIVE", "PENDING"] },
        intakeTermId: null,
        historicalAcademics: { none: {} },
      },
      data: { intakeTermId: term.id },
    });
    result.datedTutees = dated.count;
    // These roster-only name-collision fixtures have no canonical account. Madonna
    // deliberately retains an undated grade as the roster-only incomplete example.
    const tutors = await tx.tutor.updateMany({
      where: {
        id: { in: [seedId("tutor-clash-a"), seedId("tutor-clash-b")] },
        status: "ACTIVE",
        user: null,
        gradeSchoolYear: null,
        gradeConfirmedAt: null,
        historicalAcademics: { none: {} },
      },
      data: { gradeSchoolYear: term.schoolYear, gradeConfirmedAt: new Date() },
    });
    result.confirmedRosterTutors = tutors.count;
  });
  return result;
}
