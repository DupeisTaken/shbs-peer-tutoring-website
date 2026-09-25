import { TRPCError } from "@trpc/server";
import { ALL_GRADES, isLatinPrimaryName, type ProfilePolicy } from "~/lib/profile-policy";
import type { DomainDb } from "~/server/transactions";

/** Missing settings preserve the existing program until an administrator chooses a policy. */
export async function getProfilePolicy(db: DomainDb): Promise<ProfilePolicy> {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" }, select: { requireLatinNames: true, offeredGrades: true },
  });
  return settings ?? { requireLatinNames: false, offeredGrades: [...ALL_GRADES] };
}

/** Existing primary names remain valid until changed; secondary names are never filtered. */
export async function assertPrimaryName(db: DomainDb, name: string, previousName?: string | null) {
  if (name.trim() === previousName?.trim()) return;
  if ((await getProfilePolicy(db)).requireLatinNames && !isLatinPrimaryName(name))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_LATIN_NAME_REQUIRED" });
}

/** Offered grades constrain new reports, not historical records or optional unknown values. */
export async function assertOfferedGrade(db: DomainDb, grade: number | null | undefined) {
  if (grade != null && !(await getProfilePolicy(db)).offeredGrades.includes(grade))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_GRADE_NOT_OFFERED" });
}
