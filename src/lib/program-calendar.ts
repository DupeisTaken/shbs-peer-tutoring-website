import { z } from "zod";

/** Dates are program-local labels, independent of attendance instants or school-day counting. */
export const programCalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (date) =>
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    "Choose a valid calendar date.",
  );
export const programCalendarWrite = z
  .object({
    date: programCalendarDate,
    endDate: programCalendarDate.optional(),
    reason: z.string().trim().min(1).max(300),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .refine((range) => !range.endDate || range.endDate >= range.date, {
    message: "The ending date must be on or after the starting date.",
    path: ["endDate"],
  })
  // Older callers and queued proposals still describe one inclusive calendar day.
  .transform((range) => ({ ...range, endDate: range.endDate ?? range.date }));
export const programCalendarRemove = z
  .object({
    date: programCalendarDate,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
