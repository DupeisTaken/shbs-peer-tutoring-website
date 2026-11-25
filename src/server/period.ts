/**
 * Server-side helpers for the active program period (the "current" quarter). Exactly one Term
 * is active at a time; it scopes pairings and stamps the period onto sessions/adjustments so
 * service hours can be reported per semester. Pure period math lives in src/lib/period.ts.
 */
import { TRPCError } from "@trpc/server";

import type { PrismaClient } from "../../generated/prisma";
import {
  type Quarter,
  type Semester,
  quarterSemester,
  semesterLabel,
  semesterQuarters,
} from "~/lib/period";

export interface ActivePeriod {
  termId: string;
  schoolYear: string;
  quarter: Quarter;
  semester: Semester;
  name: string;
  signupOpensAt: Date | null;
  signupPreviewUrl: string | null;
  signupEnabled: boolean;
  signupClosesAt: Date | null;
  tutorSignupEnabled: boolean;
  tutorSignupOpensAt: Date | null;
  tutorSignupClosesAt: Date | null;
  tutorSignupPreviewUrl: string | null;
}

type TermClient = Pick<PrismaClient, "term">;

/** The current active term, or throw if none has been set up (seed creates one). */
export async function getActivePeriod(db: TermClient): Promise<ActivePeriod> {
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!term) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No active program period. Create or seed one first.",
    });
  }
  return {
    termId: term.id,
    schoolYear: term.schoolYear,
    quarter: term.quarter,
    semester: quarterSemester(term.quarter),
    name: term.name,
    signupEnabled: term.signupEnabled,
    signupClosesAt: term.signupClosesAt,
    tutorSignupEnabled: term.tutorSignupEnabled,
    tutorSignupOpensAt: term.tutorSignupOpensAt,
    tutorSignupClosesAt: term.tutorSignupClosesAt,
    tutorSignupPreviewUrl: term.tutorSignupPreviewUrl,
    signupOpensAt: term.signupOpensAt,
    signupPreviewUrl: term.signupPreviewUrl,
  };
}

/** Same as getActivePeriod but returns null instead of throwing (for read-only views). */
export async function getActivePeriodOrNull(
  db: TermClient,
): Promise<ActivePeriod | null> {
  const term = await db.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!term) return null;
  return {
    termId: term.id,
    schoolYear: term.schoolYear,
    quarter: term.quarter,
    semester: quarterSemester(term.quarter),
    name: term.name,
    signupEnabled: term.signupEnabled,
    signupClosesAt: term.signupClosesAt,
    tutorSignupEnabled: term.tutorSignupEnabled,
    tutorSignupOpensAt: term.tutorSignupOpensAt,
    tutorSignupClosesAt: term.tutorSignupClosesAt,
    tutorSignupPreviewUrl: term.tutorSignupPreviewUrl,
    signupOpensAt: term.signupOpensAt,
    signupPreviewUrl: term.signupPreviewUrl,
  };
}

/**
 * Active semester scope for live crew patrol totals.
 * Matches how tutor service hours reset across semester boundaries: Q1+Q2 accumulate in S1,
 * Q3+Q4 accumulate in S2, and crossing into a new semester (or school year) starts fresh at 0
 * while retaining historical Patrol rows for reports, history, and school-hours accounting.
 */
export async function getActiveSemesterPatrolScope(db: TermClient): Promise<{
  periodLabel: string;
  schoolYear: string;
  semester: Semester;
  termIds: string[];
} | null> {
  const active = await getActivePeriodOrNull(db);
  if (!active) return null;
  const terms = await db.term.findMany({
    where: {
      schoolYear: active.schoolYear,
      quarter: { in: semesterQuarters(active.semester) },
    },
    select: { id: true },
  });
  return {
    periodLabel: semesterLabel(active.schoolYear, active.semester),
    schoolYear: active.schoolYear,
    semester: active.semester,
    termIds: terms.map((term) => term.id),
  };
}
