import { z } from "zod";

export const ALL_GRADES = Array.from({ length: 12 }, (_, index) => index + 1);
export const profilePolicySchema = z.object({
  requireLatinNames: z.boolean(),
  offeredGrades: z.array(z.number().int().min(1).max(12)).min(1).max(12)
    .refine((grades) => new Set(grades).size === grades.length, "Choose each grade once.")
    .transform((grades) => [...grades].sort((a, b) => a - b)),
});
export type ProfilePolicy = z.infer<typeof profilePolicySchema>;

/** Latin is a script, not ASCII: retain accents and decomposed accents without admitting
 * mixed-script lookalikes, numbers or punctuation other than name separators. */
export function isLatinPrimaryName(name: string) {
  return /^(?:\p{Script=Latin}\p{M}*)+(?:[ '\u2019\u02bc-]+(?:\p{Script=Latin}\p{M}*)+)*$/u.test(name.trim().normalize("NFC"));
}
