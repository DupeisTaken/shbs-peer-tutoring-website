import { expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { reconsiderSessionFlag, syncSessionFlag } from "./flags";
import { importedRecordKey } from "~/server/imported-records";

type Origin = { entity: string; recordId: string };
function fixture(
  origins: Origin[] = [],
  existing: { id: string; state: string } | null = null,
  merged = false,
) {
  const session = {
    id: "primary",
    tutorId: "tutor",
    date: new Date("2026-09-01T00:00:00Z"),
    startMin: 600,
    endMin: 660,
    online: false,
    actualRoomId: "room",
    mergeGroupId: merged ? "primary" : null,
  };
  type Filter = { entity: string; recordId: string | { in: string[] } };
  const findOrigins = ({ where }: { where: { OR: Filter[] } }) =>
    origins.filter((origin) =>
      where.OR.some(
        (filter) =>
          filter.entity === origin.entity &&
          (typeof filter.recordId === "string"
            ? filter.recordId === origin.recordId
            : filter.recordId.in.includes(origin.recordId)),
      ),
    );
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    session: {
      findUnique: vi.fn(async () => session),
      findMany: vi.fn(async () => [{ id: "primary" }, { id: "sibling" }]),
    },
    sessionFlag: {
      findUnique: vi.fn(async () => existing),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    serviceHourAdjustment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    sessionTutee: {
      findMany: vi.fn(async () => [
        { sessionId: "primary", tuteeId: "one" },
        { sessionId: merged ? "sibling" : "primary", tuteeId: "two" },
      ]),
    },
    programSettings: { findUnique: vi.fn(async () => ({ timeZone: "UTC" })) },
    patrolObservation: {
      findMany: vi.fn(async () => [
        {
          id: "observation",
          patrolId: "patrol",
          headcount: "ZERO",
          observedAt: new Date("2026-09-01T10:15:00Z"),
        },
      ]),
    },
    importedRecordProvenance: {
      findFirst: vi.fn(
        async (args: Parameters<typeof findOrigins>[0]) =>
          findOrigins(args)[0] ?? null,
      ),
      findMany: vi.fn(async (args: Parameters<typeof findOrigins>[0]) =>
        findOrigins(args),
      ),
    },
  };
  return { tx, db: tx as unknown as TransactionDb };
}

it("retains native crew discrepancy detection", async () => {
  const f = fixture();
  expect(await syncSessionFlag(f.db, "primary")).toEqual({ flagged: true });
  expect(f.tx.sessionFlag.create).toHaveBeenCalledExactlyOnceWith({
    data: { sessionId: "primary", tutorId: "tutor", expected: 2, observed: 0 },
  });
});

it.each(["Patrol", "PatrolObservation"])(
  "does not turn an imported %s into new native discrepancy work",
  async (entity) => {
    const f = fixture([
      { entity, recordId: entity === "Patrol" ? "patrol" : "observation" },
    ]);
    expect(await syncSessionFlag(f.db, "primary")).toEqual({ flagged: false });
    expect(f.tx.sessionFlag.create).not.toHaveBeenCalled();
    expect(f.tx.sessionFlag.update).not.toHaveBeenCalled();
  },
);

it.each(["Session", "SessionTutee", "SessionFlag", "ServiceHourAdjustment"])(
  "preserves imported %s evidence during native reconsideration",
  async (entity) => {
    const f = fixture(
      [
        {
          entity,
          recordId:
            entity === "Session"
              ? "primary"
              : entity === "SessionTutee"
                ? importedRecordKey({ sessionId: "primary", tuteeId: "one" }, [
                    "sessionId",
                    "tuteeId",
                  ])
                : entity === "SessionFlag"
                  ? "decision"
                  : "flag:decision",
        },
      ],
      { id: "decision", state: "PENALIZED" },
    );
    await reconsiderSessionFlag(f.db, "primary");
    expect(f.tx.serviceHourAdjustment.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.sessionFlag.update).not.toHaveBeenCalled();
    expect(f.tx.sessionFlag.delete).not.toHaveBeenCalled();
    expect(f.tx.patrolObservation.findMany).not.toHaveBeenCalled();
  },
);

it.each(["Session", "SessionTutee"])(
  "preserves the whole merged block when only a sibling has imported %s evidence",
  async (entity) => {
    const f = fixture(
      [
        {
          entity,
          recordId:
            entity === "Session"
              ? "sibling"
              : importedRecordKey({ sessionId: "sibling", tuteeId: "two" }, [
                  "sessionId",
                  "tuteeId",
                ]),
        },
      ],
      null,
      true,
    );
    expect(await syncSessionFlag(f.db, "primary")).toEqual({ flagged: false });
    expect(f.tx.sessionFlag.create).not.toHaveBeenCalled();
    expect(f.tx.patrolObservation.findMany).not.toHaveBeenCalled();
  },
);

it("still reconsiders native reviewed penalties when actual evidence changes", async () => {
  const f = fixture([], { id: "decision", state: "PENALIZED" });
  await reconsiderSessionFlag(f.db, "primary");
  expect(f.tx.serviceHourAdjustment.deleteMany).toHaveBeenCalledWith({
    where: { id: "flag:decision" },
  });
  expect(f.tx.sessionFlag.update.mock.calls).toMatchObject([
    [
      {
        where: { id: "decision" },
        data: { state: "PENDING", resolvedAt: null },
      },
    ],
  ]);
});
