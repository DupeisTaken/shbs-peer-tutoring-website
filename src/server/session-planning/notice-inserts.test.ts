import { expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma";
import { insertSessionNotices } from "./notice-inserts";

type Intent = Prisma.SessionNoticeCreateManyInput;
function notice(dedupeKey: string, changes: Partial<Intent> = {}): Intent {
  return {
    dedupeKey,
    recipientUserId: "synthetic-recipient",
    recipientEmail: "recipient@example.test",
    event: "schedule_updated",
    context: { isActionable: false, subjectLabel: "Synthetic Math" },
    ...changes,
  };
}

function fixture(existing: Intent[] = []) {
  const stored = new Map(existing.map((intent) => [intent.dedupeKey, intent]));
  const reads = {
    findMany: vi.fn(
      async ({ where }: { where: { dedupeKey: { in: string[] } } }) =>
        where.dedupeKey.in
          .filter((key) => stored.has(key))
          .map((dedupeKey) => ({ dedupeKey })),
    ),
    createMany: vi.fn(async ({ data }: { data: Intent[] }) => {
      for (const intent of data) {
        if (stored.has(intent.dedupeKey))
          throw new Error("Synthetic duplicate notice key");
        stored.set(intent.dedupeKey, intent);
      }
      return { count: data.length };
    }),
  };
  return {
    stored,
    reads,
    tx: { sessionNotice: reads } as unknown as Parameters<
      typeof insertSessionNotices
    >[0],
  };
}

it("does no database work for an empty fanout", async () => {
  const { tx, reads } = fixture();
  await insertSessionNotices(tx, []);
  expect(reads.findMany).not.toHaveBeenCalled();
  expect(reads.createMany).not.toHaveBeenCalled();
});

it.each(["PENDING", "SENDING", "SENT", "FAILED", "BLOCKED"])(
  "preserves an existing %s receipt, including its content and attempt state",
  async (status) => {
    const retained = notice("retained", {
      id: "retained-receipt",
      status,
      recipientEmail: "original@example.test",
      context: { isActionable: true, stage: "B" },
      attempts: status === "FAILED" ? 5 : 2,
      attemptId: "original-attempt",
      attemptStartedAt: new Date("2026-10-30"),
      availableAt: new Date("2026-10-31"),
      leaseUntil: status === "SENDING" ? new Date("2026-11-01") : null,
      acceptedAt: status === "SENT" ? new Date("2026-10-31") : null,
      completedAt: status === "SENT" ? new Date("2026-10-31") : null,
      lastError: status === "FAILED" ? "Synthetic retained failure" : null,
    });
    const original = structuredClone(retained);
    const { tx, reads, stored } = fixture([retained]);
    await insertSessionNotices(tx, [
      notice("retained", {
        recipientEmail: "replacement@example.test",
        context: { isActionable: false, stage: "C" },
        status: "PENDING",
        attempts: 0,
      }),
    ]);
    expect(stored.get("retained")).toBe(retained);
    expect(stored.get("retained")).toEqual(original);
    expect(reads.createMany).not.toHaveBeenCalled();
  },
);

it("keeps the first intent per key and the original order of distinct recipients", async () => {
  const first = Object.freeze(
    notice("same", { recipientUserId: "first-user" }),
  );
  const other = Object.freeze(notice("other"));
  const replacement = Object.freeze(
    notice("same", { recipientUserId: "different-user" }),
  );
  const intents = Object.freeze([first, other, replacement]);
  const { tx, reads, stored } = fixture();
  await insertSessionNotices(tx, intents);
  expect([...stored.values()]).toEqual([first, other]);
  expect(stored.get("same")).toBe(first);
  expect(reads.findMany).toHaveBeenCalledExactlyOnceWith({
    where: { dedupeKey: { in: ["same", "other"] } },
    select: { dedupeKey: true },
  });
  expect(reads.createMany).toHaveBeenCalledExactlyOnceWith({
    data: [first, other],
  });
});

it("replays a saved intent without replacing its original destination or context", async () => {
  const first = notice("event", { recipientEmail: "first@example.test" });
  const { tx, reads, stored } = fixture();
  await insertSessionNotices(tx, [first]);
  await insertSessionNotices(tx, [
    notice("event", { recipientEmail: "later@example.test", attempts: 0 }),
  ]);
  expect(stored.get("event")).toBe(first);
  expect(reads.createMany).toHaveBeenCalledTimes(1);
});

it("forwards creation defaults unchanged and never broadly suppresses unique errors", async () => {
  const intent = notice("new");
  const { tx, reads } = fixture();
  await insertSessionNotices(tx, [intent]);
  const call = reads.createMany.mock.calls[0]![0];
  expect(call).toEqual({ data: [intent] });
  expect(call.data[0]).toBe(intent);
  expect(call).not.toHaveProperty("skipDuplicates");
  for (const field of [
    "id",
    "status",
    "attempts",
    "createdAt",
    "updatedAt",
    "availableAt",
  ])
    expect(call.data[0]).not.toHaveProperty(field);
});

it.each([500, 501, 1001])(
  "bounds all read and write batches to 500 for %i distinct keys",
  async (count) => {
    const intents = Array.from({ length: count }, (_, index) =>
      notice(`event-${index}`),
    );
    const { tx, reads, stored } = fixture();
    await insertSessionNotices(tx, intents);
    expect(stored.size).toBe(count);
    expect(reads.findMany).toHaveBeenCalledTimes(Math.ceil(count / 500));
    expect(reads.createMany).toHaveBeenCalledTimes(Math.ceil(count / 500));
    expect(
      reads.findMany.mock.calls.flatMap(([call]) => call.where.dedupeKey.in),
    ).toEqual(intents.map((intent) => intent.dedupeKey));
    expect(reads.createMany.mock.calls.flatMap(([call]) => call.data)).toEqual(
      intents,
    );
    expect(
      reads.findMany.mock.calls.every(
        ([call]) => call.where.dedupeKey.in.length <= 500,
      ),
    ).toBe(true);
    expect(
      reads.createMany.mock.calls.every(([call]) => call.data.length <= 500),
    ).toBe(true);
  },
);

it("filters existing receipts across read boundaries before chunking the remaining writes", async () => {
  const intents = Array.from({ length: 1001 }, (_, index) =>
    notice(`event-${index}`),
  );
  const existing = intents.filter((_, index) => index % 5 === 0);
  const existingKeys = new Set(existing.map((intent) => intent.dedupeKey));
  const { tx, reads, stored } = fixture(existing);
  await insertSessionNotices(tx, intents);
  expect(
    reads.findMany.mock.calls.map(([call]) => call.where.dedupeKey.in.length),
  ).toEqual([500, 500, 1]);
  expect(reads.createMany.mock.calls.map(([call]) => call.data.length)).toEqual(
    [500, 300],
  );
  expect(reads.createMany.mock.calls.flatMap(([call]) => call.data)).toEqual(
    intents.filter((intent) => !existingKeys.has(intent.dedupeKey)),
  );
  expect(stored.size).toBe(1001);
  for (const retained of existing)
    expect(stored.get(retained.dedupeKey)).toBe(retained);
});

it("propagates a failed existence read before any insert can start", async () => {
  const failure = new Error("Synthetic existence read failure");
  const { tx, reads } = fixture();
  reads.findMany.mockRejectedValueOnce(failure);
  await expect(insertSessionNotices(tx, [notice("event")])).rejects.toBe(
    failure,
  );
  expect(reads.createMany).not.toHaveBeenCalled();
});

it("does not treat a failed later read chunk as a set of missing receipts", async () => {
  const failure = new Error("Synthetic later read failure");
  const { tx, reads } = fixture();
  reads.findMany.mockResolvedValueOnce([]).mockRejectedValueOnce(failure);
  await expect(
    insertSessionNotices(
      tx,
      Array.from({ length: 1001 }, (_, index) => notice(`event-${index}`)),
    ),
  ).rejects.toBe(failure);
  expect(reads.findMany).toHaveBeenCalledTimes(2);
  expect(reads.createMany).not.toHaveBeenCalled();
});

it.each(["P2002", "P2003"])(
  "propagates unique/FK insert failure %s without skipping or continuing",
  async (code) => {
    const failure = Object.assign(new Error("Synthetic insert failure"), {
      code,
    });
    const { tx, reads } = fixture();
    reads.createMany.mockRejectedValueOnce(failure);
    await expect(
      insertSessionNotices(
        tx,
        Array.from({ length: 501 }, (_, index) => notice(`event-${index}`)),
      ),
    ).rejects.toBe(failure);
    expect(reads.createMany).toHaveBeenCalledTimes(1);
    expect(reads.createMany.mock.calls[0]![0]).not.toHaveProperty(
      "skipDuplicates",
    );
  },
);

it("propagates a later insert failure so the caller can roll back the whole transaction", async () => {
  const failure = new Error("Synthetic second insert failure");
  const { tx, reads } = fixture();
  const originalInsert = reads.createMany.getMockImplementation()!;
  reads.createMany
    .mockImplementationOnce(originalInsert)
    .mockRejectedValueOnce(failure);
  await expect(
    insertSessionNotices(
      tx,
      Array.from({ length: 1001 }, (_, index) => notice(`event-${index}`)),
    ),
  ).rejects.toBe(failure);
  expect(reads.createMany).toHaveBeenCalledTimes(2);
});
