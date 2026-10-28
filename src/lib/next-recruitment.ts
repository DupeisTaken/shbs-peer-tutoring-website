import { z } from "zod";
import { isSchoolYear, QUARTERS } from "~/lib/period";
import { isProgramTimeZone } from "~/lib/program-time";

const schoolYear = z.string().refine(isSchoolYear, "Invalid school year.");
const timeZone = z.string().max(100).refine(isProgramTimeZone);

/** Review evidence names the destination and mode revision, never just a moving 'next'. */
export const nextRecruitmentTargetSchema = z.object({
  sourceTermId: z.string().min(1),
  sourceSchoolYear: schoolYear,
  sourceQuarter: z.enum(QUARTERS),
  destinationSchoolYear: schoolYear,
  destinationQuarter: z.enum(QUARTERS),
  semesterMode: z.boolean(),
  modeRevision: z.number().int().nonnegative(),
}).strict();

export const nextRecruitmentPreparationEvidenceSchema = z.object({
  version: z.number().int().positive(),
  opensAt: z.date().nullable(),
  timeZone,
  target: nextRecruitmentTargetSchema,
}).strict();

const destinationWindowSchema = z.object({
  enabled: z.boolean(),
  opensAt: z.date().nullable(),
  closesAt: z.date().nullable(),
  previewUrl: z.string().nullable(),
}).strict();

/** A reused destination retains its switches, closing bounds and links exactly as reviewed. */
export const nextRecruitmentRefreshEvidenceSchema = z.object({
  target: nextRecruitmentTargetSchema,
  timeZone,
  // Optional only for reading old requests. Application requires equality with the
  // current complete snapshot, so legacy refreshes must be reviewed again.
  stagedFeatures: z.array(z.object({
    key: z.string(), enabled: z.boolean(), pendingEnabled: z.boolean().nullable(),
    revision: z.number().int().nonnegative(),
  }).strict()).optional(),
  preparations: z.object({
    tutor: nextRecruitmentPreparationEvidenceSchema.nullable(),
    tutee: nextRecruitmentPreparationEvidenceSchema.nullable(),
  }).strict(),
  destination: z.object({
    termId: z.string().min(1),
    tutor: destinationWindowSchema,
    tutee: destinationWindowSchema,
  }).strict().nullable(),
}).strict();

export const prepareNextRecruitmentSchema = z.object({
  audience: z.enum(["tutor", "tutee"]),
  expectedTarget: nextRecruitmentTargetSchema,
  expectedVersion: z.number().int().nonnegative(),
  expectedTimeZone: timeZone,
  // null is a reviewed clear; absence of a preparation has a different meaning.
  opensAt: z.date().nullable(),
}).strict();

export type NextRecruitmentTarget = z.infer<typeof nextRecruitmentTargetSchema>;
export type NextRecruitmentPreparationEvidence = z.infer<typeof nextRecruitmentPreparationEvidenceSchema>;
export type NextRecruitmentRefreshEvidence = z.infer<typeof nextRecruitmentRefreshEvidenceSchema>;
export type PrepareNextRecruitmentInput = z.infer<typeof prepareNextRecruitmentSchema>;

/** Explicit comparison also detects a mode change away and back to the same destination. */
export function sameNextRecruitmentTarget(a: NextRecruitmentTarget, b: NextRecruitmentTarget) {
  return a.sourceTermId === b.sourceTermId &&
    a.sourceSchoolYear === b.sourceSchoolYear && a.sourceQuarter === b.sourceQuarter &&
    a.destinationSchoolYear === b.destinationSchoolYear && a.destinationQuarter === b.destinationQuarter &&
    a.semesterMode === b.semesterMode && a.modeRevision === b.modeRevision;
}
