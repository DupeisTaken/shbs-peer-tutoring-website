import { z } from "zod";

const knownDate = z.iso.datetime();
const choice = z.object({ id: z.string(), name: z.string() });

/** Known source values at the decision, separate from later canonical profile mirrors. */
export const legacySignupDeclineSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    id: z.string(),
    englishName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    preferredName: z.string().nullable(),
    legacyName: z.string().nullable(),
    alternativeNames: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    preferredContact: z.string().nullable(),
    notes: z.string().nullable(),
    gradeLevel: z.string().nullable(),
    academicallyGraduated: z.boolean(),
    signupSource: z.enum(["SELF_SERVICE", "STAFF", "UNKNOWN"]),
    intakeTermId: z.string().nullable(),
    signupSubmittedAt: knownDate.nullable(),
    createdAt: knownDate,
    status: z.enum(["PENDING", "ACTIVE"]),
    firstChoice: choice.nullable(),
    secondChoice: choice.nullable(),
    signedRulebook: z.boolean(),
    signatureName: z.string().nullable(),
    signedAt: knownDate.nullable(),
  }),
  decisionPeriod: z.object({
    id: z.string(),
    name: z.string(),
    schoolYear: z.string(),
    quarter: z.string(),
  }),
  availability: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      dayOfWeek: z.number().int(),
      startMin: z.number().int(),
      endMin: z.number().int(),
    }),
  ),
  ownership: z.object({
    userId: z.string().nullable(),
    retainedOwnerId: z.string().nullable(),
    personId: z.string().nullable(),
    historyIdentityRevision: z.number().int().nonnegative(),
  }),
  pairings: z.array(
    z.object({
      id: z.string(),
      termId: z.string(),
      subject: z.string(),
      tutorId: z.string(),
      tutorName: z.string(),
      dayOfWeek: z.number().int(),
      startMin: z.number().int(),
      endMin: z.number().int(),
      scheduleConfirmed: z.boolean(),
      removed: z.boolean(),
    }),
  ),
});

export type LegacySignupDeclineSnapshot = z.infer<
  typeof legacySignupDeclineSnapshotSchema
>;
export type LegacySignupDeclineView = {
  state: "DECLINED";
  termId: string;
  resolvedAt: Date;
  resolvedById: string;
  resolvedByName: string | null;
  snapshot: LegacySignupDeclineSnapshot;
};

/** Explicit private projection excludes the retry key and its intent hash. */
export function legacySignupDeclineView(row: {
  termId: string;
  resolvedAt: Date;
  resolvedById: string;
  resolvedByName: string | null;
  intakeSnapshot: unknown;
}): LegacySignupDeclineView {
  return {
    state: "DECLINED",
    termId: row.termId,
    resolvedAt: row.resolvedAt,
    resolvedById: row.resolvedById,
    resolvedByName: row.resolvedByName,
    snapshot: legacySignupDeclineSnapshotSchema.parse(row.intakeSnapshot),
  };
}
