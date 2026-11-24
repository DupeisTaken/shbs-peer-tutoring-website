import { expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import { INTERVIEW_HOURS_REASON } from "~/server/interview-hours";
import {
  assertAdjustmentDeletionAllowed,
  inspectInterviewAdjustmentSource,
  INTERVIEW_ADJUSTMENT_AMBIGUITY_MESSAGE,
} from "~/server/interview-adjustment-source";

// Underscores permit two different exact application/participant pairs to spell
// the same old source ID. Model returned evidence rows instead of inventing
// impossible simultaneous canonical credits in a real integration fixture.
const adjustment = {
  id: "interview_source_with_under_owner_tutor",
  tutorId: "owner_tutor",
  type: "EXTRA" as const,
  reason: INTERVIEW_HOURS_REASON,
};
const firstClaim = {
  adjustmentId: adjustment.id,
  applicationId: "source_with_under",
  recordedTutorId: "owner_tutor",
  canonicalShape: true,
};
const secondClaim = {
  adjustmentId: adjustment.id,
  applicationId: "source",
  recordedTutorId: "with_under_owner_tutor",
  canonicalShape: true,
};
const applications = ["source", "source_with_under"].map((id) => ({
  id,
  interviewCompletedAt: new Date("2026-09-15T04:00:37.456Z"),
  invalidatedAt: null,
  status: "INTERVIEW",
}));

function evidenceDb(
  typed: (typeof firstClaim)[],
  legacy: Omit<typeof firstClaim, "canonicalShape">[],
) {
  return {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(typed)
      .mockResolvedValueOnce(legacy),
    tutorApplication: { findMany: vi.fn().mockResolvedValue(applications) },
    serviceHourAdjustment: {
      findUnique: vi.fn().mockResolvedValue(adjustment),
    },
  } as unknown as DomainDb;
}

it.each([
  {
    label: "two exact typed receipts",
    typed: [firstClaim, secondClaim],
    legacy: [],
  },
  {
    label: "an exact typed receipt and a completed legacy mapping",
    typed: [firstClaim],
    legacy: [secondClaim],
  },
])(
  "refuses $label that claim the same key instead of choosing its current owner",
  async ({ typed, legacy }) => {
    const observed = await inspectInterviewAdjustmentSource(
      evidenceDb(typed, legacy),
      adjustment,
    );
    expect(observed).toEqual({
      kind: "CONFLICTING_INTERVIEW",
      applicationId: null,
      applicationIds: ["source", "source_with_under"],
      canDelete: false,
      correctionApplicationId: null,
    });
    await expect(
      assertAdjustmentDeletionAllowed(evidenceDb(typed, legacy), adjustment.id),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: INTERVIEW_ADJUSTMENT_AMBIGUITY_MESSAGE,
    });
  },
);
