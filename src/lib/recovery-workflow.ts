import { z } from "zod";
import type { surveyInput } from "./student-signup";

export const recoveryDraftReference = z
  .object({
    draftId: z.string().min(1).max(200),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type RecoverySignupDraft = {
  draftId: string;
  version: number;
  answers: Omit<
    z.infer<typeof surveyInput>,
    | "email"
    | "preferredLatinName"
    | "signatureName"
    | "agreed"
    | "policyRevision"
    | "secondChoiceId"
  > & { secondChoiceId?: string };
};
