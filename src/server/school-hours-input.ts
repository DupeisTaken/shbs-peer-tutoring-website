import { z } from "zod";
import { isProgramTimeZone } from "~/lib/program-time";

export const schoolHoursMonth = z
  .string()
  .regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export const schoolHoursFollowupInput = z
  .object({
    id: z.string().min(1).max(128),
    requestId: z.uuid(),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    expectedLinkVersion: z.number().int().positive(),
  })
  .strict();
export type SchoolHoursFollowupInput = z.infer<typeof schoolHoursFollowupInput>;
export const schoolHoursComponentsSchema = z.object({
  earned: z.number().finite().nonnegative(),
  extras: z.number().finite().nonnegative(),
  deductions: z.number().finite().nonnegative(),
  crew: z.number().finite().nonnegative(),
});
export type SchoolHoursComponents = z.infer<typeof schoolHoursComponentsSchema>;
const schoolHoursMailbox = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

/** Keep labels separate from delivery addresses, including for older callers. */
export const schoolHoursRecipientLabelsSchema = z
  .record(z.string(), z.string().trim().max(80))
  .superRefine((labels, context) => {
    const entries = Object.keys(labels);
    if (entries.length > 100)
      context.addIssue({ code: "custom", message: "Select up to 100 labels." });
    const seen = new Set<string>();
    for (const email of entries) {
      const mailbox = schoolHoursMailbox.safeParse(email);
      if (!mailbox.success)
        context.addIssue({
          code: "custom",
          path: [email],
          message: "Use a valid mailbox for each label.",
        });
      else if (seen.has(mailbox.data))
        context.addIssue({
          code: "custom",
          path: [email],
          message: "Select each mailbox once.",
        });
      else seen.add(mailbox.data);
    }
  })
  .transform((labels) =>
    Object.fromEntries(
      Object.entries(labels)
        .filter(([, label]) => label.length > 0)
        .map(([email, label]) => [email.trim().toLowerCase(), label]),
    ),
  );
export const schoolHoursSettingsInput = z
  .object({
    enabled: z.boolean(),
    recipientEmails: z
      .array(schoolHoursMailbox)
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Select each mailbox once.",
      ),
    recipientLabels: schoolHoursRecipientLabelsSchema.optional(),
    timeZone: z.string().max(100).refine(isProgramTimeZone),
    includeStatistics: z.boolean(),
    dateOverrides: z
      .record(
        schoolHoursMonth,
        z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/),
      )
      .refine(
        (overrides) =>
          Object.entries(overrides).every(
            ([month, date]) => date.slice(0, 7) === month,
          ),
        "Choose a send date within its report month.",
      )
      .refine(
        (overrides) =>
          Object.values(overrides).every((date) => {
            const value = new Date(`${date}:00Z`);
            return (
              Number.isFinite(value.getTime()) &&
              value.toISOString().slice(0, 16) === date
            );
          }),
        "Choose a valid local calendar date and time.",
      ),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((input, context) => {
    for (const email of Object.keys(input.recipientLabels ?? {}))
      if (!input.recipientEmails.includes(email))
        context.addIssue({
          code: "custom",
          path: ["recipientLabels", email],
          message: "Only configured recipients can have a label.",
        });
  });
export type SchoolHoursSettingsInput = z.infer<typeof schoolHoursSettingsInput>;
export const schoolHoursBaselineInput = z
  .object({
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedBaselineVersion: z.number().int().nonnegative(),
    acknowledged: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
    participants: z
      .array(
        schoolHoursComponentsSchema.extend({
          beneficiaryId: z.string().min(1).max(200),
          schoolAccountKey: z.string().trim().min(1).max(200),
          reviewed: z.literal(true),
        }),
      )
      .min(1)
      .max(2000)
      .refine(
        (rows) =>
          new Set(rows.map((row) => row.beneficiaryId)).size === rows.length,
      ),
  })
  .strict();
export type SchoolHoursBaselineInput = z.infer<typeof schoolHoursBaselineInput>;
export const schoolHoursGenerateInput = z
  .object({
    month: schoolHoursMonth,
    expectedVersion: z.number().int().nonnegative(),
    expectedBaselineVersion: z.number().int().nonnegative(),
    expectedHeadId: z.string().nullable(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.uuid(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type SchoolHoursGenerateInput = z.infer<typeof schoolHoursGenerateInput>;

const signedComponents = z.object({
  earned: z.number().finite(),
  extras: z.number().finite(),
  deductions: z.number().finite(),
  crew: z.number().finite(),
});
export const schoolHoursRowSchema = z.object({
  beneficiaryId: z.string(),
  exportName: z.string(),
  schoolAccountKey: z.string(),
  nameParts: z.object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    preferredName: z.string().nullable(),
    alternativeNames: z.string().nullable(),
    legacyName: z.string().nullable(),
    confirmed: z.boolean(),
  }),
  current: schoolHoursComponentsSchema,
  previous: schoolHoursComponentsSchema,
  change: signedComponents,
  tutoringChange: z.number(),
  crewChange: z.number(),
  hoursToAdd: z.number(),
  monthAmount: z.number(),
  previousEditionAmount: z.number().nullable(),
  previousMonthAmount: z.number().nullable(),
  monthComparison: z.number().nullable(),
  unchanged: z.boolean(),
  priorEditions: z
    .array(
      z.object({
        revision: z.number().int().positive(),
        monthAmount: z.number().finite(),
        correctionToCurrent: z.number().finite(),
      }),
    )
    .default([]),
});
export const schoolHoursSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  month: schoolHoursMonth,
  revision: z.number().int().positive(),
  generatedAt: z.string(),
  timeZone: z.string(),
  predecessorId: z.string().nullable(),
  supersedesId: z.string().nullable(),
  includeStatistics: z.boolean(),
  rows: z.array(schoolHoursRowSchema),
  totals: z.object({
    people: z.number(),
    tutoringChange: z.number(),
    crewChange: z.number(),
    hoursToAdd: z.number(),
    monthAmount: z.number(),
  }),
});
export type SchoolHoursSnapshot = z.infer<typeof schoolHoursSnapshotSchema>;
