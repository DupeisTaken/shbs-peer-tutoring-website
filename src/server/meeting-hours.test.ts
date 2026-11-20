import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import type { Prisma } from "../../generated/prisma";
import { reconcileMeetingHours } from "./meeting-hours";
import { assertMutableProgramRecords } from "./imported-records";

const attendance = (id: string, quarter = "Q1") => ({
  id,
  meetingId: `meeting-${id}`,
  status: "UNEXCUSED_ABSENT",
  meeting: {
    date: new Date("2026-09-01T00:00:00Z"),
    term: { schoolYear: "26-27", quarter },
  },
});
function fixture(
  rows: ReturnType<typeof attendance>[],
  origins: { entity: string; recordId: string }[] = [],
  adjustments: { id: string }[] = [],
) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    meetingAttendance: { findMany: vi.fn(async () => rows) },
    serviceHourAdjustment: {
      findMany: vi.fn(async () => adjustments),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
    },
    importedRecordProvenance: {
      findMany: vi.fn(
        async (query: Prisma.ImportedRecordProvenanceFindManyArgs) => {
          void query;
          return origins;
        },
      ),
      findFirst: vi.fn(async () => origins[0] ?? null),
    },
  };
  return { tx, db: tx as unknown as TransactionDb };
}

it("keeps imported absences and deductions frozen when current attendance changes", async () => {
  const imported = [0, 1, 2, 3].map((id) => attendance(`archive-${id}`));
  const current = [0, 1, 2].map((id) => attendance(`current-${id}`));
  const deductionId = "mtgabs_meeting-archive-3_tutor";
  const f = fixture(
    [...imported, ...current],
    [
      ...imported.map((row) => ({
        entity: "MeetingAttendance",
        recordId: row.id,
      })),
      { entity: "ServiceHourAdjustment", recordId: deductionId },
    ],
    [{ id: deductionId }],
  );
  await reconcileMeetingHours(f.db, "tutor");
  expect(f.tx.serviceHourAdjustment.create).not.toHaveBeenCalled();
  expect(f.tx.serviceHourAdjustment.deleteMany).toHaveBeenCalledWith({
    where: {
      tutorId: "tutor",
      id: { startsWith: "mtgabs_", notIn: [deductionId] },
    },
  });
});

it("still shares the native absence allowance across both quarters of a semester", async () => {
  const rows = [0, 1, 2].map((id) => attendance(`q1-${id}`));
  const f = fixture([...rows, attendance("q2", "Q2")]);
  await reconcileMeetingHours(f.db, "tutor");
  expect(f.tx.serviceHourAdjustment.create.mock.calls).toMatchObject([
    [
      {
        data: {
          id: "mtgabs_meeting-q2_tutor",
          amount: 0.25,
          schoolYear: "26-27",
          quarter: "Q2",
        },
      },
    ],
  ]);
});

it("does not turn attendance on an imported meeting into native deductions", async () => {
  const rows = [0, 1, 2, 3].map((id) => attendance(`old-${id}`));
  const f = fixture(
    rows,
    rows.map((row) => ({
      entity: "TutorMeeting",
      recordId: row.meetingId,
    })),
  );
  await reconcileMeetingHours(f.db, "tutor");
  expect(f.tx.serviceHourAdjustment.create).not.toHaveBeenCalled();
});

it.each([true, false])(
  "rejects an archive-owned deduction identifier before rebuilding native deductions (source exists: %s)",
  async (sourceExists) => {
    const id = "mtgabs_meeting-native-3_tutor";
    const f = fixture(
      [0, 1, 2, 3].map((id) => attendance(`native-${id}`)),
      [{ entity: "ServiceHourAdjustment", recordId: id }],
      sourceExists ? [{ id }] : [],
    );
    await expect(reconcileMeetingHours(f.db, "tutor")).rejects.toThrow(
      /identifier belongs to imported history/,
    );
    expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.serviceHourAdjustment.create).not.toHaveBeenCalled();
    const query = f.tx.importedRecordProvenance.findMany.mock.calls[0]?.[0];
    const amendment = query?.where?.OR?.find(
      (row) => row.entity === "ServiceHourAdjustment",
    );
    expect(query?.select).toEqual({ entity: true, recordId: true });
    expect(
      amendment?.recordId && typeof amendment.recordId === "object"
        ? amendment.recordId.in
        : [],
    ).toContain(id);
  },
);

it("requires reviewed recovery before native meeting actions change archive evidence", async () => {
  const f = fixture(
    [],
    [{ entity: "MeetingAttendance", recordId: "original" }],
  );
  await expect(
    assertMutableProgramRecords(f.db, [
      { entity: "MeetingAttendance", recordId: "original" },
    ]),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const native = fixture([]);
  await expect(
    assertMutableProgramRecords(native.db, [
      { entity: "TutorMeeting", recordId: "current" },
    ]),
  ).resolves.toBeUndefined();
});
