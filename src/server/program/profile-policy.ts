import { TRPCError } from "@trpc/server";
import { ALL_GRADES, isLatinPrimaryName, type ProfilePolicy } from "~/lib/profile-policy";
import type { DomainDb } from "~/server/transactions";

/** Missing settings preserve the existing program until an administrator chooses a policy. */
export async function getProfilePolicy(db: DomainDb): Promise<ProfilePolicy> {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" }, select: { requireLatinNames: true, requireLatinLegalNames: true, offeredGrades: true },
  });
  return settings ?? { requireLatinNames: false, requireLatinLegalNames: false, offeredGrades: [...ALL_GRADES] };
}

/** Existing preferred names remain valid until changed. */
export async function assertPrimaryName(db: DomainDb, name: string, previousName?: string | null) {
  if (name.trim() === previousName?.trim()) return;
  if ((await getProfilePolicy(db)).requireLatinNames && !isLatinPrimaryName(name))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_LATIN_NAME_REQUIRED" });
}

/** Legal names use the legacy alternativeNames column. Blank remains optional, and
 * unchanged historical values are preserved without treating them as verified identity. */
export async function assertLegalName(db: DomainDb, name: string | null | undefined, previousName?: string | null) {
  if (!name?.trim() || name.trim() === previousName?.trim()) return;
  if ((await getProfilePolicy(db)).requireLatinLegalNames && !isLatinPrimaryName(name))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_LATIN_LEGAL_NAME_REQUIRED" });
}

/** Offered grades constrain new reports, not historical records or optional unknown values. */
export async function assertOfferedGrade(db: DomainDb, grade: number | null | undefined) {
  if (grade != null && !(await getProfilePolicy(db)).offeredGrades.includes(grade))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_GRADE_NOT_OFFERED" });
}
