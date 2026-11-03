import assert from "node:assert/strict";
import type { PrismaClient } from "../generated/prisma";
import { academicSummary, normalizeGrade } from "../src/lib/academics";
import { graduationYear } from "../src/lib/period";
import {
  DEMO_ACADEMIC_SOURCE,
  DEMO_CURRENT_TUTEE_KEYS,
  DEMO_STUDENT_KEYS,
  DEMO_TUTOR_KEYS,
} from "./demo-academics";
import { seedId } from "./demo-support";

export async function verifyDemoAcademicCoverage(db: PrismaClient) {
  const term = await db.term.findUniqueOrThrow({
    where: { id: seedId("term-2026-q1") },
  });
  const users = await db.user.findMany({
    where: {
      id: {
        in: [
          ...DEMO_TUTOR_KEYS.map((key) => seedId(`user-${key}`)),
          ...DEMO_STUDENT_KEYS.map((key) => seedId(`student-user-${key}`)),
        ],
      },
    },
    include: {
      academicProfile: {
        include: { history: { where: { source: DEMO_ACADEMIC_SOURCE } } },
      },
      tutor: true,
    },
  });
  assert.equal(users.length, DEMO_TUTOR_KEYS.length + DEMO_STUDENT_KEYS.length);
  const completed = users.filter((user) => {
    const summary = academicSummary(user.academicProfile, term.schoolYear);
    return (
      !summary.needsConfirmation &&
      ["REPORTED", "GRADUATED"].includes(summary.status)
    );
  });
  assert.ok(completed.length / users.length >= 0.8);
  for (const id of [
    seedId("user-evan"),
    seedId("user-oscar"),
    seedId("student-user-pending-kate"),
  ]) {
    const user = users.find((candidate) => candidate.id === id);
    assert.ok(user);
    assert.equal(
      academicSummary(user.academicProfile, term.schoolYear).needsConfirmation,
      true,
    );
  }
  for (const user of completed) {
    const profile = user.academicProfile!;
    assert.ok(
      profile.history.length <= 1,
      "Repeat seeding must not append duplicate academic confirmations",
    );
    if (user.tutor) {
      assert.equal(user.tutor.gradeLevel, profile.gradeLevel);
      assert.equal(user.tutor.gradeSchoolYear, profile.schoolYear);
      assert.equal(
        user.tutor.gradeConfirmedAt?.getTime(),
        profile.confirmedAt?.getTime(),
      );
      assert.equal(
        user.tutor.academicallyGraduated,
        profile.status === "GRADUATED",
      );
    }
  }
  for (const id of [seedId("user-alice"), seedId("student-user-emma")]) {
    const user = completed.find((candidate) => candidate.id === id);
    assert.ok(user);
    const summary = academicSummary(user.academicProfile, term.schoolYear);
    assert.equal(summary.status, "REPORTED");
    assert.equal(
      summary.expectedGraduationYear,
      graduationYear(summary.gradeLevel!, term.schoolYear),
    );
  }
  const tutees = await db.tutee.findMany({
    where: {
      id: { in: DEMO_CURRENT_TUTEE_KEYS.map((key) => seedId(`tutee-${key}`)) },
      status: { in: ["ACTIVE", "PENDING"] },
    },
    include: { user: { include: { academicProfile: true } } },
  });
  const dated = tutees.filter((tutee) =>
    tutee.user
      ? !academicSummary(tutee.user.academicProfile, term.schoolYear)
          .needsConfirmation
      : tutee.intakeTermId === term.id &&
        normalizeGrade(tutee.gradeLevel).gradeLevel !== null,
  );
  assert.ok(
    dated.length / tutees.length >= 0.8,
    "Most current tutees must display grade, reference year and class-of",
  );
  const tutors = await db.tutor.findMany({
    where: {
      id: {
        in: [...DEMO_TUTOR_KEYS, "madonna", "clash-a", "clash-b"].map((key) =>
          seedId(`tutor-${key}`),
        ),
      },
      status: { notIn: ["GRADUATED", "ARCHIVED"] },
    },
    include: { user: { include: { academicProfile: true } } },
  });
  const completeTutors = tutors.filter((tutor) =>
    tutor.user
      ? !academicSummary(tutor.user.academicProfile, term.schoolYear)
          .needsConfirmation
      : tutor.gradeLevel !== null &&
        tutor.gradeSchoolYear === term.schoolYear &&
        tutor.gradeConfirmedAt !== null,
  );
  assert.ok(completeTutors.length / tutors.length >= 0.8);
  return {
    completeAccounts: completed.length,
    participantAccounts: users.length,
    completeCurrentTutees: dated.length,
    currentTutees: tutees.length,
    completeCurrentTutors: completeTutors.length,
    currentTutors: tutors.length,
  };
}
