import { z } from "zod";

/** Rank grants management authority only; participation and translation are explicit capabilities. */
export const membershipSchema = z.object({
  rank: z.enum(["NONE", "COORDINATOR", "ADMIN", "HEAD"]),
  viewer: z.boolean(),
  tutor: z.boolean(),
  tutee: z.boolean(),
  translator: z.boolean(),
  crew: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.viewer && (value.rank !== "NONE" || value.tutor || value.tutee || value.translator || value.crew))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Viewer cannot be combined with any other badge." });
});
export type AccountMembership = z.infer<typeof membershipSchema>;

export function accountMembership(user: {
  role: string | null;
  tutorId?: string | null;
  tutorStatus?: string | null;
  tutor?: { status: string } | null;
  tuteeMember?: boolean;
  tutorAccessRevoked?: boolean;
  canTranslate?: boolean;
  crewStatus?: string | null;
}): AccountMembership {
  return {
    rank: user.role === "HEAD" || user.role === "ADMIN" || user.role === "COORDINATOR" ? user.role : "NONE",
    viewer: user.role === "VIEWER",
    tutor: !!user.tutorId && !user.tutorAccessRevoked && (user.tutorStatus ?? user.tutor?.status) !== "ARCHIVED",
    tutee: user.tuteeMember ?? false,
    translator: user.canTranslate ?? false,
    crew: user.crewStatus != null,
  };
}

/** Tutor already communicates participation; keep its accepted tutee membership without a duplicate badge. */
export function membershipBadges(value: AccountMembership): string[] {
  return [
    ...(value.rank === "NONE" ? [] : [value.rank]),
    ...(value.viewer ? ["VIEWER"] : []),
    ...(value.tutor ? ["TUTOR"] : value.tutee ? ["STUDENT"] : []),
    ...(value.translator ? ["TRANSLATOR"] : []),
    ...(value.crew ? ["CREW"] : []),
  ];
}
