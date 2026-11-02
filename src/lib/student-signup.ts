import { z } from "zod";
import { optionalPersonNameFields } from "./person-name";
import { preferredLatinNameSchema } from "./username";

// Shared intake schemas have no server orchestration imports, avoiding invitation/editor cycles.
export const surveyInput = z.object({
  // Optional for retained intents; fresh public submissions require this fence.
  expectedTermId: z.string().min(1).optional(),
  ...optionalPersonNameFields,
  englishName: z.string().trim().max(200),
  preferredLatinName: preferredLatinNameSchema,
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40).optional(),
  preferredContact: z.string().trim().max(200).default(""),
  gradeLevel: z.string().trim().max(40).optional(),
  firstChoiceId: z.string().min(1),
  secondChoiceId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  slotIds: z.array(z.string().min(1)).max(100).default([]),
  signatureName: z.string().trim().max(120).default(""),
  agreed: z.literal(true),
  policyRevision: z.string().min(1),
});
export const surveyToken = z.string().regex(/^[a-f0-9]{64}$/);
