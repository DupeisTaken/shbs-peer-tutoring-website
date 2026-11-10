import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { importedRecordKey } from "./imported-records";
import {
  clearInterviewHours,
  interviewHoursId,
  writeInterviewCompletion,
} from "./interview-hours";

const applicationId = "synthetic-interview";
const tutorId = "synthetic-panelist";
const completedAt = new Date("2026-09-01T06:00:00Z");
const evidence = {
  interviewCompletedAt: completedAt,
  interviewDurationMin: 30,
  interviewSchoolYear: "26-27",
  interviewQuarter: "Q1" as const,
  interviewers: [{ tutorId, attended: true }],
};
const input = { completedAt, durationMin: 60, attendedTutorIds: [tutorId] };
const credit = {
  id: interviewHoursId(applicationId, tutorId),
  tutorId,
  type: "EXTRA",
  reason: "Completed interview service",
};
function fixture(imported: { entity: string; recordId: string } | null = null) {
  const tx = {
    tutorApplication: { update: vi.fn(async () => ({})) },
    interviewAssignment: {
      findMany: vi.fn(async () => [{ applicationId, tutorId }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    serviceHourAdjustment: {
      findMany: vi.fn(async () => [credit]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    importedRecordProvenance: {
      findFirst: vi.fn(
        async (query: {
          where: { OR: { entity: string; recordId: string }[] };
        }) =>
          imported &&
          query.where.OR.some(
            (row) =>
              row.entity === imported.entity &&
              row.recordId === imported.recordId,
          )
            ? imported
            : null,
      ),
    },
  };
  return { tx, db: tx as unknown as TransactionDb };
}

it.each([
  { entity: "TutorApplication", recordId: applicationId },
  {
    entity: "InterviewAssignment",
    recordId: importedRecordKey({ applicationId, tutorId }, [
      "applicationId",
      "tutorId",
    ]),
  },
  { entity: "ServiceHourAdjustment", recordId: credit.id },
])(
  "refuses native award rebuild and clearing for imported $entity evidence",
  async (imported) => {
    const f = fixture(imported);
    await expect(
      writeInterviewCompletion(f.db, applicationId, evidence, input, [credit]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      clearInterviewHours(f.db, applicationId, [tutorId]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.tutorApplication.update).not.toHaveBeenCalled();
    expect(f.tx.interviewAssignment.updateMany).not.toHaveBeenCalled();
    expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
  },
);

it("checks the logical credit ID even when its imported source row has been deleted", async () => {
  const f = fixture({ entity: "ServiceHourAdjustment", recordId: credit.id });
  f.tx.serviceHourAdjustment.findMany.mockResolvedValue([]);
  await expect(
    writeInterviewCompletion(f.db, applicationId, evidence, input, []),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    f.tx.importedRecordProvenance.findFirst.mock.calls[0]?.[0].where.OR,
  ).toContainEqual({
    entity: "ServiceHourAdjustment",
    recordId: credit.id,
  });
  expect(f.tx.serviceHourAdjustment.createMany).not.toHaveBeenCalled();
});

it("preserves native completion replacements and explicit credit clearing", async () => {
  const f = fixture();
  await writeInterviewCompletion(f.db, applicationId, evidence, input, [
    credit,
  ]);
  expect(f.tx.tutorApplication.update).toHaveBeenCalledWith({
    where: { id: applicationId },
    data: {
      interviewCompletedAt: completedAt,
      interviewDurationMin: 60,
      interviewSchoolYear: "26-27",
      interviewQuarter: "Q1",
    },
  });
  expect(f.tx.serviceHourAdjustment.createMany).toHaveBeenCalledWith({
    data: [expect.objectContaining({ id: credit.id, amount: 1, tutorId })],
  });
  await clearInterviewHours(f.db, applicationId, [tutorId]);
  expect(f.tx.serviceHourAdjustment.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: [credit.id] } },
  });
});
