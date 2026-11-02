import { z } from "zod";
import { isProgramTimeZone } from "~/lib/program-time";

export const monthlyHoursMonth = z
  .string()
  .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export const monthlyHoursSettingsInput = z
  .object({
    enabled: z.boolean(),
    recipientUserIds: z
      .array(z.string().min(1).max(128))
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each staff account once.",
      ),
    dayOfMonth: z.number().int().min(1).max(28),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().max(100).refine(isProgramTimeZone),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const monthlyHoursGenerateInput = z
  .object({
    month: monthlyHoursMonth,
    expectedVersion: z.number().int().nonnegative(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedLatestRevision: z.number().int().nonnegative(),
    requestId: z.uuid(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type MonthlyHoursSettingsInput = z.infer<
  typeof monthlyHoursSettingsInput
>;
export type MonthlyHoursGenerateInput = z.infer<
  typeof monthlyHoursGenerateInput
>;
