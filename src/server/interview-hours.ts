import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DomainDb } from "~/server/transactions";
import { monthKey } from "~/lib/service-hours";

export const interviewCompletionInput = z.object({
  applicationId: z.string(),
  durationMin: z.number().int().min(1).max(480),
  completedAt: z.coerce.date(),
  attendedTutorIds: z.array(z.string()).min(1),
  reason: z.string().trim().min(1).max(1000),
  expectedUpdatedAt: z.coerce.date().optional(),
});

type Completion = z.infer<typeof interviewCompletionInput>;
type CompletionEvidence = {
  interviewCompletedAt: Date | null;
  interviewDurationMin: number | null;
  interviewSchoolYear: string | null;
  interviewQuarter: string | null;
  interviewers: { tutorId: string; attended: boolean }[];
};
type CreditEvidence = {
  tutorId: string;
  amount: number;
  month: string;
  schoolYear: string;
  quarter: string;
};

/** A receipt is exact applied evidence, including its actual credits. Matching only
 * the form fields could turn a missing/manual credit into a Coordinator write. */
export function sameInterviewCompletionEvidence(
  before: CompletionEvidence,
  credits: CreditEvidence[],
  input: Completion,
) {
  return (
    new Set(input.attendedTutorIds).size === input.attendedTutorIds.length &&
    input.attendedTutorIds.every((id) =>
      before.interviewers.some((p) => p.tutorId === id),
    ) &&
    before.interviewCompletedAt?.getTime() === input.completedAt.getTime() &&
    before.interviewDurationMin === input.durationMin &&
    before.interviewers.every(
      (p) => p.attended === input.attendedTutorIds.includes(p.tutorId),
    ) &&
    credits.length === input.attendedTutorIds.length &&
    credits.every(
      (row) =>
        input.attendedTutorIds.includes(row.tutorId) &&
        row.amount === input.durationMin / 60 &&
        row.month === monthKey(input.completedAt) &&
        row.schoolYear === before.interviewSchoolYear &&
        row.quarter === before.interviewQuarter,
    )
  );
}

/** Advisory classification only outside a transaction. The management middleware
 * rechecks this under the source review lock before granting the receipt path. */
export async function isAppliedInterviewCompletion(
  db: DomainDb,
  value: unknown,
) {
  const parsed = interviewCompletionInput.safeParse(value);
  if (!parsed.success) return false;
  const before = await db.tutorApplication.findUnique({
    where: { id: parsed.data.applicationId },
    include: { interviewers: true },
  });
  if (
    !before?.interviewCompletedAt ||
    before.invalidatedAt ||
    before.status === "RECALLED"
  )
    return false;
  const credits = await interviewHourRows(
    db,
    parsed.data.applicationId,
    before.interviewers.map((p) => p.tutorId),
  );
  return sameInterviewCompletionEvidence(before, credits, parsed.data);
}

export const INTERVIEW_HOURS_REASON = "Completed interview service";
export const interviewHoursId = (applicationId: string, tutorId: string) =>
  `interview_${applicationId}_${tutorId}`;

/** Legacy IDs have no source foreign key. Check both the exact panel-derived ID
 * and its owner/shape; a prefix can also match another application's credits. */
export async function interviewHourRows(
  db: DomainDb,
  applicationId: string,
  tutorIds: string[],
) {
  const owners = new Map(
    tutorIds.map((id) => [interviewHoursId(applicationId, id), id]),
  );
  const rows = await db.serviceHourAdjustment.findMany({
    where: { id: { in: [...owners.keys()] } },
  });
  for (const row of rows) {
    if (
      row.tutorId !== owners.get(row.id) ||
      row.type !== "EXTRA" ||
      row.reason !== INTERVIEW_HOURS_REASON
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "An interview credit identifier belongs to another adjustment. Review it before recording hours.",
      });
  }
  return rows;
}

/** Call while holding the application's review lock, before discarding its panel. */
export async function clearInterviewHours(
  db: DomainDb,
  applicationId: string,
  tutorIds: string[],
) {
  const rows = await interviewHourRows(db, applicationId, tutorIds);
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
}
