import { describe, expect, it, vi } from "vitest";
import {
  assertProgramRoomOrder,
  programRoomOrder,
  reorderProgramRooms,
  roomOrderInput,
} from "./room-order";
import type { DomainDb, TransactionDb } from "./transactions";

const LEGACY_IDS = [
  "legacy-room-2",
  "2",
  "00000000-0000-4000-8000-000000000002",
  "c123456789012345678901234",
];

function createFakeTx(currentIds: string[]) {
  const updates: { id: string; programOrder: number }[] = [];
  const lockCalls: unknown[] = [];
  const tx = {
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      lockCalls.push(args);
      return 0;
    }),
    room: {
      findMany: vi.fn(async () => currentIds.map((id) => ({ id }))),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { programOrder: number };
        }) => {
          updates.push({ id: where.id, programOrder: data.programOrder });
          return { id: where.id, programOrder: data.programOrder };
        },
      ),
    },
  };
  return {
    tx: tx as unknown as TransactionDb,
    updates,
    lockCalls,
    findMany: tx.room.findMany,
  };
}

describe("roomOrderInput", () => {
  it("accepts opaque legacy, numeric, UUID and CUID room IDs", () => {
    const parsed = roomOrderInput.parse({
      ids: [...LEGACY_IDS].reverse(),
      expectedIds: LEGACY_IDS,
    });
    expect(parsed).toEqual({
      ids: [...LEGACY_IDS].reverse(),
      expectedIds: LEGACY_IDS,
    });
  });

  it("rejects empty IDs, duplicates, oversized lists and unknown fields", () => {
    expect(
      roomOrderInput.safeParse({
        ids: [""],
        expectedIds: [""],
      }).success,
    ).toBe(false);

    expect(
      roomOrderInput.safeParse({
        ids: ["legacy-room-2", "legacy-room-2"],
        expectedIds: ["legacy-room-2", "2"],
      }).success,
    ).toBe(false);

    const tooMany = Array.from({ length: 501 }, (_, i) => `room-${i}`);
    expect(
      roomOrderInput.safeParse({
        ids: tooMany,
        expectedIds: tooMany,
      }).success,
    ).toBe(false);

    expect(
      roomOrderInput.safeParse({
        ids: ["legacy-room-2"],
        expectedIds: ["legacy-room-2"],
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("assertProgramRoomOrder and reorderProgramRooms", () => {
  it("persists sequential programOrder for mixed legacy and CUID room IDs", async () => {
    const { tx, updates, lockCalls, findMany } = createFakeTx(LEGACY_IDS);
    const db = {
      $transaction: async <T>(fn: (client: TransactionDb) => Promise<T>) =>
        fn(tx),
    } as unknown as DomainDb;

    const desired = [...LEGACY_IDS].reverse();
    const result = await reorderProgramRooms(db, {
      ids: desired,
      expectedIds: LEGACY_IDS,
    });

    expect(result).toEqual({ ids: desired });
    expect(lockCalls).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [...programRoomOrder],
      select: { id: true },
    });
    expect(updates).toEqual(
      desired.map((id, programOrder) => ({ id, programOrder })),
    );
  });

  it("rejects stale expectedIds and unknown room IDs without writing", async () => {
    const { tx, updates } = createFakeTx(LEGACY_IDS);

    await expect(
      assertProgramRoomOrder(tx, {
        ids: LEGACY_IDS,
        expectedIds: [...LEGACY_IDS].reverse(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      assertProgramRoomOrder(tx, {
        ids: [
          "legacy-room-2",
          "2",
          "00000000-0000-4000-8000-000000000002",
          "unknown-room",
        ],
        expectedIds: LEGACY_IDS,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(updates).toHaveLength(0);
  });
});
