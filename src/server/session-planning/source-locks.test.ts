import { describe, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { lockPlanningSources } from "./source-locks";

type Statement = { sql: string; parameters: unknown[] };
function fixture({
  owners = [] as { userId: string }[],
  linked = [] as { id: string }[],
  beforeLock = async (_statement: Statement) => undefined,
} = {}) {
  const statements: Statement[] = [];
  const raw = {
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue(owners) },
    user: { findMany: vi.fn().mockResolvedValue(linked) },
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const statement = {
          sql: strings.join("?").replace(/\s+/g, " ").trim(),
          parameters,
        };
        statements.push(statement);
        await beforeLock(statement);
        return [];
      },
    ),
  };
  return { raw, statements, tx: raw as unknown as TransactionDb };
}

describe("batched planning source locks", () => {
  it("locks retained and direct accounts plus globally sorted source unions in the original order", async () => {
    const { tx, raw, statements } = fixture({
      owners: [
        { userId: "retained-z" },
        { userId: "shared" },
        { userId: "shared" },
      ],
      linked: [{ id: "direct-b" }, { id: "shared" }, { id: "direct-a" }],
    });
    const sources = Object.freeze([
      Object.freeze({
        tutorId: "tutor-z",
        tuteeIds: Object.freeze(["learner-z", "learner-a", "learner-z"]),
        pairingIds: Object.freeze(["pairing-z", "pairing-a"]),
      }),
      Object.freeze({
        tutorId: "tutor-a",
        tuteeIds: Object.freeze(["learner-a", "learner-b"]),
        pairingIds: Object.freeze(["pairing-b", "pairing-a"]),
      }),
      Object.freeze({ tutorId: "tutor-z", tuteeIds: [], pairingIds: [] }),
    ]);
    await expect(lockPlanningSources(tx, sources)).resolves.toBeUndefined();
    expect(
      raw.studentProfileOwnership.findMany,
    ).toHaveBeenCalledExactlyOnceWith({
      where: { tuteeId: { in: ["learner-a", "learner-b", "learner-z"] } },
      select: { userId: true },
    });
    expect(raw.user.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        OR: [
          { tutorId: { in: ["tutor-a", "tutor-z"] } },
          { studentId: { in: ["learner-a", "learner-b", "learner-z"] } },
        ],
      },
      select: { id: true },
    });
    expect(statements).toEqual([
      {
        sql: 'SELECT id FROM "User" WHERE id=ANY(?::text[]) ORDER BY id FOR SHARE',
        parameters: [["direct-a", "direct-b", "retained-z", "shared"]],
      },
      {
        sql: 'SELECT id FROM "Tutor" WHERE id=ANY(?::text[]) ORDER BY id FOR SHARE',
        parameters: [["tutor-a", "tutor-z"]],
      },
      {
        sql: 'SELECT id FROM "Tutee" WHERE id=ANY(?::text[]) ORDER BY id FOR SHARE',
        parameters: [["learner-a", "learner-b", "learner-z"]],
      },
      {
        sql: 'SELECT id FROM "Pairing" WHERE id=ANY(?::text[]) ORDER BY id FOR UPDATE',
        parameters: [["pairing-a", "pairing-b", "pairing-z"]],
      },
      {
        sql: 'SELECT "pairingId","tuteeId" FROM "PairingTutee" WHERE "pairingId"=ANY(?::text[]) ORDER BY "pairingId","tuteeId" FOR SHARE',
        parameters: [["pairing-a", "pairing-b", "pairing-z"]],
      },
    ]);
  });

  it("uses bound arrays even for opaque IDs that contain SQL punctuation", async () => {
    const unusual = "source'); SELECT 'still-data";
    const { tx, statements } = fixture({ owners: [{ userId: unusual }] });
    await lockPlanningSources(tx, [
      { tutorId: unusual, tuteeIds: [unusual], pairingIds: [unusual] },
    ]);
    expect(statements).toHaveLength(5);
    for (const statement of statements) {
      expect(statement.sql).not.toContain(unusual);
      expect(statement.parameters).toEqual([[unusual]]);
    }
  });

  it("does no work for no sources and handles empty child collections without inventing authority", async () => {
    const empty = fixture();
    await lockPlanningSources(empty.tx, []);
    expect(empty.raw.studentProfileOwnership.findMany).not.toHaveBeenCalled();
    expect(empty.raw.user.findMany).not.toHaveBeenCalled();
    expect(empty.raw.$queryRaw).not.toHaveBeenCalled();

    const sparse = fixture();
    await expect(
      lockPlanningSources(sparse.tx, [
        { tutorId: "tutor", tuteeIds: [], pairingIds: [] },
      ]),
    ).resolves.toBeUndefined();
    expect(sparse.statements.map((statement) => statement.parameters)).toEqual([
      [[]],
      [["tutor"]],
      [[]],
      [[]],
      [[]],
    ]);
  });

  it("waits for each lock before advancing to the next source table", async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const firstLockEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const userLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tx, statements } = fixture({
      beforeLock: async (statement) => {
        if (statement.sql.includes('FROM "User"')) {
          entered();
          await userLock;
        }
      },
    });
    const work = lockPlanningSources(tx, [
      { tutorId: "tutor", tuteeIds: ["learner"], pairingIds: ["pairing"] },
    ]);
    await firstLockEntered;
    expect(statements).toHaveLength(1);
    release();
    await work;
    expect(statements).toHaveLength(5);
  });

  it("propagates discovery and lock failures instead of treating them as absent sources", async () => {
    const discovery = fixture();
    discovery.raw.studentProfileOwnership.findMany.mockRejectedValue(
      new Error("ownership read failed"),
    );
    await expect(
      lockPlanningSources(discovery.tx, [
        { tutorId: "tutor", tuteeIds: [], pairingIds: [] },
      ]),
    ).rejects.toThrow("ownership read failed");
    expect(discovery.raw.user.findMany).not.toHaveBeenCalled();
    expect(discovery.raw.$queryRaw).not.toHaveBeenCalled();

    const failure = new Error("pairing lock failed");
    const locks = fixture({
      beforeLock: async (statement) => {
        if (statement.sql.includes('FROM "Pairing"')) throw failure;
      },
    });
    await expect(
      lockPlanningSources(locks.tx, [
        { tutorId: "tutor", tuteeIds: [], pairingIds: ["pairing"] },
      ]),
    ).rejects.toBe(failure);
    expect(locks.statements).toHaveLength(4);
    expect(
      locks.statements.some((statement) =>
        statement.sql.includes('FROM "PairingTutee"'),
      ),
    ).toBe(false);
  });
});
