import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DomainDb, TransactionDb } from "~/server/transactions";
import { monthKey } from "~/lib/service-hours";
import { QUARTERS, type Quarter } from "~/lib/period";
import { getActivePeriod } from "~/server/period";
import { assertFeatureEnabled } from "~/server/program/features";
import {
  assertMutableProgramRecords,
  importedRecordKey,
} from "~/server/imported-records";
import { recordDomainAudit } from "~/server/audit/evidence";
import { staleConflict } from "~/server/concurrency";

export const interviewServiceInput = z.object({
  durationMin: z.number().int().min(1).max(480),
  completedAt: z.coerce.date(),
  attendedTutorIds: z.array(z.string()).min(1),
});
export type InterviewService = z.infer<typeof interviewServiceInput>;
export const interviewCompletionInput = interviewServiceInput.extend({
  applicationId: z.string(),
  reason: z.string().trim().min(1).max(1000),
  expectedUpdatedAt: z.coerce.date().optional(),
});

export type CompletionEvidence = {
  interviewCompletedAt: Date | null;
  interviewDurationMin: number | null;
  interviewSchoolYear: string | null;
  interviewQuarter: Quarter | null;
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
  input: InterviewService,
  eligibleTutorIds = before.interviewers.map((person) => person.tutorId),
) {
  return (
    input.attendedTutorIds.length > 0 &&
    new Set(input.attendedTutorIds).size === input.attendedTutorIds.length &&
    input.attendedTutorIds.every((id) => eligibleTutorIds.includes(id)) &&
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

export type InterviewCompletionReview =
  "FIRST_COMPLETION" | "EXACT_RECEIPT" | "CORRECTION";

/** Call with one validated source context. Exact full-ledger receipts are
 * read-only even without their original version; changing any recorded service
 * requires the version that the actor actually reviewed. */
export function reviewInterviewCompletion(
  before: CompletionEvidence & { updatedAt: Date },
  context: { credits: CreditEvidence[]; eligibleTutorIds: string[] },
  input: InterviewService & { expectedUpdatedAt?: Date },
): InterviewCompletionReview {
  if (
    sameInterviewCompletionEvidence(
      before,
      context.credits,
      input,
      context.eligibleTutorIds,
    )
  )
    return "EXACT_RECEIPT";
  if (
    (before.interviewCompletedAt && !input.expectedUpdatedAt) ||
    (input.expectedUpdatedAt &&
      input.expectedUpdatedAt.getTime() !== before.updatedAt.getTime())
  )
    staleConflict();
  return before.interviewCompletedAt ? "CORRECTION" : "FIRST_COMPLETION";
}

/** Read-only preflight for authority/proposal admission. Mutation callers repeat
 * the same review under their source lock; classification never takes locks or
 * grants a receipt exception to paused/recalled records. */
export async function inspectInterviewCompletionReview(
  db: DomainDb,
  value: unknown,
): Promise<InterviewCompletionReview | null> {
  const parsed = interviewCompletionInput.safeParse(value);
  if (!parsed.success) return null;
  const before = await db.tutorApplication.findUnique({
    where: { id: parsed.data.applicationId },
    include: { interviewers: true },
  });
  if (!before) return null;
  const context = await interviewServiceContext(db, before.id, before);
  const review = reviewInterviewCompletion(before, context, parsed.data);
  // Keep the recorded-change guard above these exclusions: an ineligible target
  // must not turn an omitted/stale correction version into a queued request.
  if (before.invalidatedAt || before.status === "RECALLED") return null;
  return review;
}

/** A repaired qualification panel reviews the earlier interview; it does not
 * acquire the former panel's attendance or earn another award. Historical source
 * owners may be absent from today's panel, including every earlier attendee. */
export function sameRetainedInterviewServiceEvidence(
  before: CompletionEvidence,
  credits: CreditEvidence[],
  input: InterviewService,
) {
  return (
    !!before.interviewCompletedAt &&
    before.interviewCompletedAt <= new Date() &&
    typeof before.interviewDurationMin === "number" &&
    Number.isInteger(before.interviewDurationMin) &&
    before.interviewDurationMin >= 1 &&
    before.interviewDurationMin <= 480 &&
    !!before.interviewSchoolYear &&
    !!before.interviewQuarter &&
    before.interviewCompletedAt.getTime() === input.completedAt.getTime() &&
    before.interviewDurationMin === input.durationMin &&
    new Set(input.attendedTutorIds).size === input.attendedTutorIds.length &&
    input.attendedTutorIds.every((id) =>
      before.interviewers.some(
        (person) => person.tutorId === id && person.attended,
      ),
    ) &&
    before.interviewers.every(
      (person) =>
        person.attended === input.attendedTutorIds.includes(person.tutorId) &&
        person.attended ===
          credits.some((row) => row.tutorId === person.tutorId),
    ) &&
    credits.length > 0 &&
    new Set(credits.map((row) => row.tutorId)).size === credits.length &&
    credits.every(
      (row) =>
        row.amount === input.durationMin / 60 &&
        row.month === monthKey(input.completedAt) &&
        row.schoolYear === before.interviewSchoolYear &&
        row.quarter === before.interviewQuarter,
    )
  );
}

/** The retained path is deliberately read-only. Its caller authorizes only an
 * additional/higher qualification decision and holds the application lock. */
export async function retainRecordedInterviewService(
  tx: TransactionDb,
  applicationId: string,
  before: CompletionEvidence,
  input: InterviewService,
) {
  await assertFeatureEnabled(tx, "SERVICE_HOURS");
  await assertRecordedInterviewService(tx, applicationId, before, input);
}

/** Also usable before a preserving repair: an incomplete historical award must
 * not be laundered into a new audited receipt. This function performs reads only. */
export async function assertRecordedInterviewService(
  tx: TransactionDb,
  applicationId: string,
  before: CompletionEvidence,
  input: InterviewService,
) {
  const { credits } = await interviewServiceContext(tx, applicationId, before);
  if (!sameRetainedInterviewServiceEvidence(before, credits, input))
    serviceConflict();
  return credits;
}

function serviceConflict(): never {
  throw new TRPCError({
    code: "CONFLICT",
    message:
      "Recorded interview service changed or is incomplete. Reload and review its recorded attendance and source credits.",
  });
}

/** The latest authorized service receipt owns both the source ledger and the
 * original participation candidates. A later voting panel cannot create physical
 * attendance. Repairs carry this candidate set forward without changing service. */
export async function interviewServiceContext(
  db: DomainDb,
  applicationId: string,
  before: CompletionEvidence,
) {
  let eligibleTutorIds = before.interviewers.map((person) => person.tutorId);
  const receipts = await db.auditLog.findMany({
    where: {
      entity: "TutorApplication",
      entityId: applicationId,
      OR: [
        {
          operation: "interviewService.record",
          details: { path: ["effects", "interviewServiceVersion"], equals: 1 },
        },
        {
          operation: "admin.assignInterviewers",
          details: { path: ["effects", "panelRepairVersion"], equals: 1 },
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, details: true },
  });
  const candidates: {
    revision: number;
    source: boolean;
    snapshot: z.infer<typeof interviewServiceSnapshot> | undefined;
  }[] = [];
  for (const receipt of receipts) {
    const source = recordedServiceReceipt.safeParse(receipt.details);
    if (source.success)
      candidates.push({
        revision: source.data.effects.sourceRevision,
        source: true,
        snapshot: source.data.effects,
      });
    else {
      const repair = panelRepairServiceReceipt.safeParse(receipt.details);
      if (!repair.success) serviceConflict();
      const retained = repair.data.effects.retainedService;
      let snapshot: z.infer<typeof interviewServiceSnapshot> | undefined;
      if (retained.completedAt) {
        const parsed = interviewServiceSnapshot.safeParse({
          eligibleTutorIds:
            retained.eligibleTutorIds ??
            repair.data.effects.previousPanel.map((person) => person.tutorId),
          completion: {
            completedAt: retained.completedAt,
            durationMin: retained.durationMin,
            schoolYear: retained.schoolYear,
            quarter: retained.quarter,
          },
          credits: retained.credits,
        });
        if (!parsed.success) serviceConflict();
        snapshot = parsed.data;
      }
      candidates.push({
        revision: retained.sourceRevision,
        source: false,
        snapshot,
      });
    }
  }
  // Database now() is transaction-start time, not source-lock application order.
  // A monotonic revision, allocated under that lock, survives reversed/tied audit
  // timestamps. Reading every exact-source receipt also avoids hiding the max.
  const sourceRevision = candidates.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.revision),
    0,
  );
  if (!before.interviewCompletedAt) {
    const credits = await interviewHourRows(
      db,
      applicationId,
      eligibleTutorIds,
    );
    if (credits.length) serviceConflict();
    return {
      eligibleTutorIds,
      attendedTutorIds: [] as string[],
      credits,
      sourceRevision,
    };
  }
  const latest = candidates.filter(
    (candidate) => candidate.revision === sourceRevision && candidate.snapshot,
  );
  // Revisionless receipts predate this protocol. Their prior timestamp ordering
  // remains a compatibility fallback; new same-revision source/repair receipts
  // must describe one identical source snapshot.
  const chosen =
    sourceRevision === 0
      ? latest[0]
      : (latest.find((candidate) => candidate.source) ?? latest[0]);
  const snapshot = chosen?.snapshot;
  if (sourceRevision > 0 && !snapshot) serviceConflict();
  if (
    sourceRevision > 0 &&
    snapshot &&
    latest.some(
      (candidate) =>
        candidate.snapshot &&
        serviceSnapshotKey(candidate.snapshot) !== serviceSnapshotKey(snapshot),
    )
  )
    serviceConflict();
  if (snapshot) eligibleTutorIds = snapshot.eligibleTutorIds;
  if (new Set(eligibleTutorIds).size !== eligibleTutorIds.length)
    serviceConflict();
  const credits = await interviewHourRows(db, applicationId, [
    ...new Set([
      ...eligibleTutorIds,
      ...before.interviewers.map((person) => person.tutorId),
    ]),
  ]);
  const currentIntersection = before.interviewers
    .filter((person) => person.attended)
    .map((person) => person.tutorId);
  const captured = {
    completedAt: before.interviewCompletedAt,
    durationMin: before.interviewDurationMin ?? 0,
    attendedTutorIds: currentIntersection,
  };
  if (
    !sameRetainedInterviewServiceEvidence(before, credits, captured) ||
    credits.some((row) => !eligibleTutorIds.includes(row.tutorId))
  )
    serviceConflict();
  if (snapshot) {
    if (
      snapshot.completion.completedAt !==
        before.interviewCompletedAt.toISOString() ||
      snapshot.completion.durationMin !== before.interviewDurationMin ||
      snapshot.completion.schoolYear !== before.interviewSchoolYear ||
      snapshot.completion.quarter !== before.interviewQuarter ||
      snapshot.credits.length !== credits.length ||
      new Set(snapshot.credits.map((row) => row.id)).size !==
        snapshot.credits.length ||
      snapshot.credits.some(
        (old) =>
          old.id !== interviewHoursId(applicationId, old.tutorId) ||
          !credits.some(
            (row) =>
              row.id === old.id &&
              row.tutorId === old.tutorId &&
              row.type === old.type &&
              row.reason === old.reason &&
              row.amount === old.amount &&
              row.month === old.month &&
              row.schoolYear === old.schoolYear &&
              row.quarter === old.quarter,
          ),
      )
    )
      serviceConflict();
  }
  return {
    eligibleTutorIds,
    attendedTutorIds: credits.map((row) => row.tutorId),
    credits,
    sourceRevision,
  };
}

function serviceSnapshotKey(
  snapshot: z.infer<typeof interviewServiceSnapshot>,
) {
  return JSON.stringify({
    eligibleTutorIds: [...snapshot.eligibleTutorIds].sort(),
    completion: snapshot.completion,
    credits: [...snapshot.credits].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/** Both management completion and chair approval use the same source-owned credit
 * write. Callers hold the application lock and enforce their distinct authority. */
export async function writeInterviewCompletion(
  tx: TransactionDb,
  applicationId: string,
  before: CompletionEvidence,
  input: InterviewService,
  credits: { id: string; tutorId: string }[],
) {
  await assertMutableInterviewSources(
    tx,
    applicationId,
    [
      ...before.interviewers.map((row) => row.tutorId),
      ...input.attendedTutorIds,
    ],
    credits.map((row) => row.id),
  );
  const context = await interviewServiceContext(tx, applicationId, before);
  if (context.sourceRevision >= Number.MAX_SAFE_INTEGER) serviceConflict();
  if (
    credits.length !== context.credits.length ||
    new Set(credits.map((row) => row.id)).size !== credits.length ||
    credits.some(
      (old) =>
        !context.credits.some(
          (row) => row.id === old.id && row.tutorId === old.tutorId,
        ),
    )
  )
    serviceConflict();
  if (
    !Number.isFinite(input.completedAt.getTime()) ||
    input.completedAt > new Date() ||
    !Number.isInteger(input.durationMin) ||
    input.durationMin < 1 ||
    input.durationMin > 480 ||
    input.attendedTutorIds.length === 0 ||
    new Set(input.attendedTutorIds).size !== input.attendedTutorIds.length ||
    input.attendedTutorIds.some((id) => !context.eligibleTutorIds.includes(id))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Attendance must name original interview participants, with a valid past completion and duration.",
    });
  // Historical inactivity does not erase attendance, but a deleted tutor cannot
  // receive a new FK-backed credit. Detect it before changing any source rows.
  if (
    (await tx.tutor.count({
      where: { id: { in: input.attendedTutorIds } },
    })) !== input.attendedTutorIds.length
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "An original interview participant no longer exists. Review that historical identity before correcting service.",
    });
  const period =
    before.interviewSchoolYear && before.interviewQuarter
      ? {
          schoolYear: before.interviewSchoolYear,
          quarter: before.interviewQuarter,
        }
      : await getActivePeriod(tx);
  await tx.tutorApplication.update({
    where: { id: applicationId },
    data: {
      interviewCompletedAt: input.completedAt,
      interviewDurationMin: input.durationMin,
      interviewSchoolYear: period.schoolYear,
      interviewQuarter: period.quarter,
    },
  });
  await tx.interviewAssignment.updateMany({
    where: { applicationId },
    data: { attended: false },
  });
  await tx.interviewAssignment.updateMany({
    where: { applicationId, tutorId: { in: input.attendedTutorIds } },
    data: { attended: true },
  });
  await tx.serviceHourAdjustment.deleteMany({
    where: { id: { in: credits.map((row) => row.id) } },
  });
  await tx.serviceHourAdjustment.createMany({
    data: input.attendedTutorIds.map((tutorId) => ({
      id: interviewHoursId(applicationId, tutorId),
      tutorId,
      month: monthKey(input.completedAt),
      schoolYear: period.schoolYear,
      quarter: period.quarter,
      type: "EXTRA" as const,
      amount: input.durationMin / 60,
      reason: INTERVIEW_HOURS_REASON,
    })),
  });
  const effects = {
    interviewServiceVersion: 1,
    sourceRevision: context.sourceRevision + 1,
    eligibleTutorIds: context.eligibleTutorIds,
    completion: {
      completedAt: input.completedAt.toISOString(),
      durationMin: input.durationMin,
      schoolYear: period.schoolYear,
      quarter: period.quarter,
    },
    credits: input.attendedTutorIds.map((tutorId) => ({
      id: interviewHoursId(applicationId, tutorId),
      tutorId,
      type: "EXTRA" as const,
      amount: input.durationMin / 60,
      month: monthKey(input.completedAt),
      schoolYear: period.schoolYear,
      quarter: period.quarter,
      reason: INTERVIEW_HOURS_REASON,
    })),
  };
  // Every authorized writer, including direct chair approval, advances the source
  // receipt in the same transaction. A correction supersedes earlier repair data;
  // a first completion after an initial-panel reset supersedes its old receipt.
  await recordDomainAudit(tx, {
    operation: "interviewService.record",
    entity: "TutorApplication",
    entityId: applicationId,
    action: "Recorded interview service evidence",
    effects,
  });
  return effects;
}

/** Chair approval may record first service or retain an exact prior recording;
 * it never becomes an alternate path around Head review of hour corrections. */
export async function recordInterviewApprovalService(
  tx: TransactionDb,
  applicationId: string,
  before: CompletionEvidence,
  input: InterviewService,
) {
  await assertFeatureEnabled(tx, "SERVICE_HOURS");
  if (input.completedAt > new Date())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Record completion only after the interview.",
    });
  if (
    input.attendedTutorIds.length === 0 ||
    new Set(input.attendedTutorIds).size !== input.attendedTutorIds.length ||
    input.attendedTutorIds.some(
      (id) => !before.interviewers.some((p) => p.tutorId === id),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Attendance must name assigned panelists only.",
    });
  const { credits } = await interviewServiceContext(tx, applicationId, before);
  if (before.interviewCompletedAt || credits.length) {
    if (sameInterviewCompletionEvidence(before, credits, input)) return;
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Interview service was already recorded. Use the management correction workflow before approving.",
    });
  }
  await writeInterviewCompletion(tx, applicationId, before, input, credits);
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
  try {
    const context = await interviewServiceContext(
      db,
      parsed.data.applicationId,
      before,
    );
    return sameInterviewCompletionEvidence(
      before,
      context.credits,
      parsed.data,
      context.eligibleTutorIds,
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "CONFLICT") return false;
    throw error;
  }
}

export const INTERVIEW_HOURS_REASON = "Completed interview service";
export const interviewHoursId = (applicationId: string, tutorId: string) =>
  `interview_${applicationId}_${tutorId}`;

/** Imported completion/panel evidence never authorizes a native award rebuild.
 * Retained logical IDs also fence a deleted archive credit from being reissued. */
async function assertMutableInterviewSources(
  db: DomainDb,
  applicationId: string,
  tutorIds: string[],
  existingCreditIds: string[] = [],
) {
  const panel = await db.interviewAssignment.findMany({
    where: { applicationId },
    select: { applicationId: true, tutorId: true },
  });
  await assertMutableProgramRecords(db, [
    { entity: "TutorApplication", recordId: applicationId },
    ...panel.map((row) => ({
      entity: "InterviewAssignment",
      recordId: importedRecordKey(row, ["applicationId", "tutorId"]),
    })),
    ...[
      ...new Set([
        ...existingCreditIds,
        ...tutorIds.map((tutorId) => interviewHoursId(applicationId, tutorId)),
      ]),
    ].map((recordId) => ({ entity: "ServiceHourAdjustment", recordId })),
  ]);
}

const sourceCredit = z.object({
  id: z.string(),
  tutorId: z.string(),
  type: z.literal("EXTRA"),
  amount: z.number(),
  month: z.string(),
  schoolYear: z.string(),
  quarter: z.enum(QUARTERS),
  reason: z.literal(INTERVIEW_HOURS_REASON),
});
const originalParticipants = z
  .array(z.string())
  .min(1)
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length);
const sourceRevisionInput = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .optional()
  .default(0);
const interviewServiceSnapshot = z.object({
  eligibleTutorIds: originalParticipants,
  completion: z.object({
    completedAt: z.iso.datetime(),
    durationMin: z.number().int().min(1).max(480),
    schoolYear: z.string().min(1),
    quarter: z.enum(QUARTERS),
  }),
  credits: z.array(sourceCredit).min(1),
});
const recordedServiceReceipt = z.object({
  effects: interviewServiceSnapshot.extend({
    interviewServiceVersion: z.literal(1),
    sourceRevision: sourceRevisionInput,
  }),
});
const panelRepairServiceReceipt = z.object({
  effects: z.object({
    panelRepairVersion: z.literal(1),
    previousPanel: z.array(z.object({ tutorId: z.string() })),
    retainedService: z.object({
      sourceRevision: sourceRevisionInput,
      eligibleTutorIds: originalParticipants.optional(),
      completedAt: z.iso.datetime().nullable(),
      durationMin: z.number().int().min(1).max(480).nullable(),
      schoolYear: z.string().nullable(),
      quarter: z.enum(QUARTERS).nullable(),
      credits: z.array(sourceCredit),
    }),
  }),
});

/** Legacy IDs have no source foreign key. A prefix finds departed historical
 * owners too, but only a canonical source ID and owner/shape establish ownership.
 * Exact current-panel IDs still catch collisions with unrelated adjustments. */
export async function interviewHourRows(
  db: DomainDb,
  applicationId: string,
  tutorIds: string[],
) {
  const owners = new Map(
    tutorIds.map((id) => [interviewHoursId(applicationId, id), id]),
  );
  const candidates = await db.serviceHourAdjustment.findMany({
    where: {
      OR: [
        { id: { in: [...owners.keys()] } },
        { id: { startsWith: `interview_${applicationId}_` } },
      ],
    },
  });
  const rows = candidates.filter(
    (row) =>
      owners.has(row.id) ||
      row.id === interviewHoursId(applicationId, row.tutorId),
  );
  for (const row of rows) {
    if (
      row.id !== interviewHoursId(applicationId, row.tutorId) ||
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
  await assertMutableInterviewSources(
    db,
    applicationId,
    [...new Set([...tutorIds, ...rows.map((row) => row.tutorId)])],
    rows.map((row) => row.id),
  );
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
}
