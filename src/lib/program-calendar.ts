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
    reason: z.string().trim().min(1).max(300),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const programCalendarRemove = z
  .object({
    date: programCalendarDate,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
