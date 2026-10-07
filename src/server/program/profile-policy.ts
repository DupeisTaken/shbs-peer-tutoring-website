import { TRPCError } from "@trpc/server";
import { ALL_GRADES, isLatinPrimaryName, type ProfilePolicy } from "~/lib/profile-policy";
import type { DomainDb } from "~/server/transactions";
import { personNameSchema } from "~/lib/person-name";

/** Domain writers use the same rules even when invoked outside a tRPC router. */
export function parsePersonNames(input: unknown) {
  const result = personNameSchema.safeParse(input);
  if (!result.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.error.issues.some(
        (issue) => issue.message === "PROFILE_LATIN_NAME_REQUIRED",
      )
        ? "PROFILE_LATIN_NAME_REQUIRED"
        : "Enter your first name and review the name fields.",
    });
  return result.data;
}

/** Unconfigured programs use preferred names; explicit saved choices remain authoritative. */
export async function getProfilePolicy(db: DomainDb): Promise<ProfilePolicy> {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
    select: {
      offeredGrades: true,
      usePreferredNames: true,
      showAlternateNames: true,
    },
  });
  // The old booleans remain in the wire shape for older clients. Script rules are now fixed.
  return {
    requireLatinNames: true,
    requireLatinLegalNames: false,
    usePreferredNames: settings?.usePreferredNames ?? true,
    showAlternateNames: settings?.showAlternateNames ?? false,
    offeredGrades: settings?.offeredGrades ?? [...ALL_GRADES],
  };
}

/** Unstructured historical names remain valid until explicitly changed. */
export async function assertPrimaryName(
  db: DomainDb,
  name: string,
  previousName?: string | null,
) {
  if (name.trim() === previousName?.trim()) return;
  void db;
  if (!isLatinPrimaryName(name))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "PROFILE_LATIN_NAME_REQUIRED",
    });
}

/** Offered grades constrain new reports, not historical records or optional unknown values. */
export async function assertOfferedGrade(db: DomainDb, grade: number | null | undefined) {
  if (grade != null && !(await getProfilePolicy(db)).offeredGrades.includes(grade))
    throw new TRPCError({ code: "BAD_REQUEST", message: "PROFILE_GRADE_NOT_OFFERED" });
}
