import { expect, it, vi } from "vitest";
import type { Quarter } from "~/lib/period";
import type { TransactionDb } from "./transactions";
import { captureMeetingHours, reconcileMeetingHours } from "./meeting-hours";
import type {
  MeetingDeduction,
  MeetingHoursAttendance,
} from "./meeting-hours-calculation";
import { assertMutableProgramRecords } from "./imported-records";

type Origin = { entity: string; recordId: string };
type OriginMatch = {
  entity: string;
  recordId: string | { in: readonly string[] };
};
type OriginQuery = {
  where: OriginMatch | { OR: OriginMatch[] };
  select?: Record<string, boolean>;
};
type StoredAdjustment = MeetingDeduction & { createdAt: Date };

const attendance = (
  id: string,
  quarter: Quarter = "Q1",
): MeetingHoursAttendance => ({
  id,
  meetingId: `meeting-${id}`,
  status: "UNEXCUSED_ABSENT",
  meeting: {
    date: new Date("2026-09-01T00:00:00Z"),
    term: { schoolYear: "26-27", quarter },
  },
});
const nativeRows = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const row = attendance(`native-${index}`);
    row.meeting.date = new Date(Date.UTC(2026, 8, 1 + index));
    return row;
  });
const deductionId = (row: MeetingHoursAttendance, tutorId = "tutor") =>
  `mtgabs_${row.meetingId}_${tutorId}`;
function storedDeduction(
  row: MeetingHoursAttendance,
  overrides: Partial<StoredAdjustment> = {},
): StoredAdjustment {
  return {
    id: deductionId(row),
    tutorId: "tutor",
    type: "PUNISHMENT",
    amount: 0.25,
    month: "2026-09",
    schoolYear: "26-27",
    quarter: "Q1",
    reason: "Synthetic retained deduction evidence",
    createdAt: new Date("2024-09-24T06:00:00.000Z"),
    ...overrides,
  };
}

function fixture(
  rows: readonly MeetingHoursAttendance[],
  origins: readonly Origin[] = [],
  stored: readonly StoredAdjustment[] = [],
) {
  const fixtureRows = structuredClone([...rows]);
  const adjustments = new Map(
    stored.map((row) => [row.id, structuredClone(row)]),
  );
  const matchingOrigins = ({ where }: OriginQuery) => {
    const clauses = "OR" in where ? where.OR : [where];
    return origins.filter((origin) =>
      clauses.some(
        (clause) =>
          clause.entity === origin.entity &&
          (typeof clause.recordId === "string"
            ? clause.recordId === origin.recordId
            : clause.recordId.in.includes(origin.recordId)),
      ),
    );
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    meetingAttendance: {
      findMany: vi.fn(async (_query: unknown) => {
        // This fixture models a database with ordinal ID collation. The pure
        // calculator separately proves it preserves other supplied tie orders.
        return structuredClone(fixtureRows).sort(
          (left, right) =>
            left.meeting.date.getTime() - right.meeting.date.getTime() ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        );
      }),
    },
    serviceHourAdjustment: {
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { tutorId: string; id: { in: string[] } };
        }) => {
          // Reject broad cleanup rather than letting a mock hide prefix deletion.
          if (!Array.isArray(where.id.in))
            throw new Error("Fixture requires exact adjustment IDs.");
          let count = 0;
          for (const id of where.id.in) {
            if (adjustments.get(id)?.tutorId !== where.tutorId) continue;
            if (adjustments.delete(id)) count++;
          }
          return { count };
        },
      ),
      create: vi.fn(async ({ data }: { data: MeetingDeduction }) => {
        // Model INSERT uniqueness: a new logical key cannot adopt existing debt.
        if (adjustments.has(data.id))
          throw Object.assign(new Error("Adjustment already exists."), {
            code: "P2002",
          });
        const created = {
          ...data,
          createdAt: new Date("2026-11-09T06:00:00.000Z"),
        };
        adjustments.set(data.id, created);
        return structuredClone(created);
      }),
    },
    importedRecordProvenance: {
      findMany: vi.fn(async (query: OriginQuery) => matchingOrigins(query)),
      findFirst: vi.fn(
        async (query: OriginQuery) => matchingOrigins(query)[0] ?? null,
      ),
    },
  };
  return {
    tx,
    db: tx as unknown as TransactionDb,
    rows: fixtureRows,
    adjustments,
  };
}
const expectNoEffects = (f: ReturnType<typeof fixture>) => {
  expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.serviceHourAdjustment.create).not.toHaveBeenCalled();
};

it.each(["unchanged", "new PRESENT"] as const)(
  "preserves complete noncanonical stored deductions after a neutral save (%s)",
  async (change) => {
    const rows = nativeRows(5);
    const fourth = storedDeduction(rows[3]!, { amount: 1.5 });
    const fifth = storedDeduction(rows[4]!, { amount: 0.875 });
    const f = fixture(rows, [], [fourth, fifth]);
    const before = await captureMeetingHours(f.db, "tutor");
    if (change === "new PRESENT")
      f.rows.push({ ...attendance("present"), status: "PRESENT" });

    await reconcileMeetingHours(f.db, "tutor", before);

    expectNoEffects(f);
    expect([...f.adjustments.values()]).toEqual([fourth, fifth]);
  },
);

it("does not repair an unchanged logical deduction whose stored target is missing", async () => {
  const f = fixture(nativeRows(4));
  const before = await captureMeetingHours(f.db, "tutor");
  expect(before.deductions).toHaveLength(1);
  f.rows.push({ ...attendance("present"), status: "PRESENT" });

  await reconcileMeetingHours(f.db, "tutor", before);

  expectNoEffects(f);
  expect(f.adjustments.size).toBe(0);
});

it("creates the native fourth Q1/Q2 absence while preserving orphan, manual and other-tutor rows", async () => {
  const fourth = attendance("fourth", "Q2");
  fourth.meeting.date = new Date("2026-09-30T06:00:00Z");
  const orphan = storedDeduction(attendance("missing-source"), { amount: 1.5 });
  const manual = storedDeduction(attendance("manual"), {
    id: "synthetic-manual-adjustment",
    amount: 0.75,
  });
  const otherTutor = storedDeduction(fourth, {
    id: deductionId(fourth, "another-tutor"),
    tutorId: "another-tutor",
    amount: 0.875,
  });
  const f = fixture(nativeRows(3), [], [orphan, manual, otherTutor]);
  const before = await captureMeetingHours(f.db, "tutor");
  expect(before.deductions).toEqual([]);
  f.rows.push(fourth);

  await reconcileMeetingHours(f.db, "tutor", before);

  expect(f.tx.meetingAttendance.findMany).toHaveBeenCalledWith({
    where: { tutorId: "tutor" },
    include: { meeting: { include: { term: true } } },
    orderBy: [{ meeting: { date: "asc" } }, { id: "asc" }],
  });
  expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.serviceHourAdjustment.create).toHaveBeenCalledTimes(1);
  expect(f.adjustments.get(deductionId(fourth))).toMatchObject({
    tutorId: "tutor",
    type: "PUNISHMENT",
    amount: 0.25,
    schoolYear: "26-27",
    quarter: "Q2",
  });
  for (const row of [orphan, manual, otherTutor])
    expect(f.adjustments.get(row.id)).toEqual(row);
  expect(f.adjustments.size).toBe(4);
});

it("excuses the first of five absences by deleting only the fourth deduction", async () => {
  const rows = nativeRows(5);
  const fourth = storedDeduction(rows[3]!);
  const fifth = storedDeduction(rows[4]!, { amount: 1.5 });
  const f = fixture(rows, [], [fourth, fifth]);
  const before = await captureMeetingHours(f.db, "tutor");
  f.rows[0]!.status = "EXCUSED_ABSENT";

  await reconcileMeetingHours(f.db, "tutor", before);

  expect(f.tx.serviceHourAdjustment.deleteMany).toHaveBeenCalledTimes(1);
  expect(f.tx.serviceHourAdjustment.deleteMany).toHaveBeenCalledWith({
    where: { tutorId: "tutor", id: { in: [fourth.id] } },
  });
  expect(f.tx.serviceHourAdjustment.create).not.toHaveBeenCalled();
  expect([...f.adjustments.values()]).toEqual([fifth]);
});

it("restores an early absence by creating only the newly required fourth deduction", async () => {
  const rows = nativeRows(5);
  rows[0]!.status = "EXCUSED_ABSENT";
  const fifth = storedDeduction(rows[4]!, { amount: 1.5 });
  const f = fixture(rows, [], [fifth]);
  const before = await captureMeetingHours(f.db, "tutor");
  f.rows[0]!.status = "UNEXCUSED_ABSENT";

  await reconcileMeetingHours(f.db, "tutor", before);

  expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.serviceHourAdjustment.create).toHaveBeenCalledTimes(1);
  expect(f.adjustments.get(deductionId(rows[3]!))).toMatchObject({
    amount: 0.25,
  });
  expect(f.adjustments.get(fifth.id)).toEqual(fifth);
  expect(f.adjustments.size).toBe(2);
});

it.each(["MeetingAttendance", "TutorMeeting"] as const)(
  "excludes imported %s sources from the native allowance and preserves their stored debt",
  async (entity) => {
    const archive = [0, 1, 2, 3].map((id) => attendance(`archive-${id}`));
    const retained = storedDeduction(archive[3]!, { amount: 1.5 });
    const origins = [
      ...archive.map((row) => ({
        entity,
        recordId: entity === "TutorMeeting" ? row.meetingId : row.id,
      })),
      { entity: "ServiceHourAdjustment", recordId: retained.id },
    ];
    const f = fixture([...archive, ...nativeRows(3)], origins, [retained]);
    const before = await captureMeetingHours(f.db, "tutor");
    expect(before.deductions).toEqual([]);
    const fourth = attendance("native-fourth", "Q2");
    fourth.meeting.date = new Date("2026-09-30T06:00:00Z");
    f.rows.push(fourth);

    await reconcileMeetingHours(f.db, "tutor", before);

    expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.serviceHourAdjustment.create).toHaveBeenCalledTimes(1);
    expect(f.adjustments.get(deductionId(fourth))).toMatchObject({
      amount: 0.25,
    });
    expect(f.adjustments.get(retained.id)).toEqual(retained);
    expect(f.adjustments.size).toBe(2);
  },
);

it.each([
  ["addition", true],
  ["addition", false],
  ["removal", true],
  ["removal", false],
  ["descriptor change", true],
  ["descriptor change", false],
] as const)(
  "refuses an archive-reserved %s before effects (target exists: %s)",
  async (change, sourceExists) => {
    const rows = nativeRows(4);
    const retained = storedDeduction(rows[3]!, { amount: 1.5 });
    const f = fixture(
      change === "addition" ? rows.slice(0, 3) : rows,
      [{ entity: "ServiceHourAdjustment", recordId: retained.id }],
      sourceExists ? [retained] : [],
    );
    const before = await captureMeetingHours(f.db, "tutor");
    if (change === "addition") f.rows.push(rows[3]!);
    else if (change === "removal") f.rows[0]!.status = "EXCUSED_ABSENT";
    else {
      f.rows[3]!.meeting.date = new Date("2026-10-01T06:00:00Z");
      f.rows[3]!.meeting.term!.quarter = "Q2";
    }

    const message: unknown = expect.stringMatching(
      /identifier belongs to imported history/,
    );
    await expect(
      reconcileMeetingHours(f.db, "tutor", before),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message,
    });

    expectNoEffects(f);
    expect([...f.adjustments.values()]).toEqual(sourceExists ? [retained] : []);
    expect(f.tx.importedRecordProvenance.findFirst).toHaveBeenCalledTimes(1);
    expect(f.tx.importedRecordProvenance.findFirst).toHaveBeenCalledWith({
      where: {
        entity: "ServiceHourAdjustment",
        recordId: { in: [retained.id] },
      },
      select: { recordId: true },
    });
  },
);

it.each([true, false])(
  "permits a neutral save with an unchanged archive reservation without repairing it (target exists: %s)",
  async (sourceExists) => {
    const rows = nativeRows(4);
    const retained = storedDeduction(rows[3]!, { amount: 1.5 });
    const f = fixture(
      rows,
      [{ entity: "ServiceHourAdjustment", recordId: retained.id }],
      sourceExists ? [retained] : [],
    );
    const before = await captureMeetingHours(f.db, "tutor");
    f.rows.push({ ...attendance("present"), status: "PRESENT" });

    await reconcileMeetingHours(f.db, "tutor", before);

    expectNoEffects(f);
    expect(f.tx.importedRecordProvenance.findFirst).not.toHaveBeenCalled();
    expect([...f.adjustments.values()]).toEqual(sourceExists ? [retained] : []);
  },
);

it("refuses an added key colliding with an existing unmarked adjustment without overwriting it", async () => {
  const rows = nativeRows(4);
  const retained = storedDeduction(rows[3]!, { amount: 1.5 });
  const f = fixture(rows.slice(0, 3), [], [retained]);
  const before = await captureMeetingHours(f.db, "tutor");
  f.rows.push(rows[3]!);

  await expect(
    reconcileMeetingHours(f.db, "tutor", before),
  ).rejects.toMatchObject({
    code: "P2002",
  });

  expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.serviceHourAdjustment.create).toHaveBeenCalledTimes(1);
  expect([...f.adjustments.values()]).toEqual([retained]);
});

it("rejects another tutor's before snapshot before reading or writing effects", async () => {
  const f = fixture(nativeRows(4));
  const before = await captureMeetingHours(f.db, "tutor");

  await expect(
    reconcileMeetingHours(f.db, "another-tutor", before),
  ).rejects.toThrow("Meeting-hours snapshot belongs to another tutor.");

  expect(f.tx.meetingAttendance.findMany).toHaveBeenCalledTimes(1);
  expect(f.tx.importedRecordProvenance.findMany).toHaveBeenCalledTimes(1);
  expect(f.tx.importedRecordProvenance.findFirst).not.toHaveBeenCalled();
  expectNoEffects(f);
});

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
