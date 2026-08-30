/**
 * Server-side helpers for the active program period (the "current" quarter). Exactly one Term
 * is active at a time; it scopes pairings and stamps the period onto sessions/adjustments so
 * service hours can be reported per semester. Pure period math lives in src/lib/period.ts.
 */
import { TRPCError } from "@trpc/server";

import type { PrismaClient } from "../../generated/prisma";
import { type Quarter, type Semester, quarterSemester } from "~/lib/period";

export interface ActivePeriod {
  termId: string;
  schoolYear: string;
  quarter: Quarter;
  semester: Semester;
  name: string;
  signupOpensAt: Date | null;
  signupPreviewUrl: string | null;
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
    signupOpensAt: term.signupOpensAt,
    signupPreviewUrl: term.signupPreviewUrl,
  };
}

/** Same as getActivePeriod but returns null instead of throwing (for read-only views). */
export async function getActivePeriodOrNull(db: TermClient): Promise<ActivePeriod | null> {
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
    signupOpensAt: term.signupOpensAt,
    signupPreviewUrl: term.signupPreviewUrl,
  };
}
