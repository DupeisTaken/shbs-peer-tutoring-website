import { expect, it, vi } from "vitest";
import { readContinuationPairingIds } from "./publication-continuations";

function fixture(members: readonly string[] = []) {
  const membership = new Set(members);
  const findMany = vi.fn(
    async (input: {
      where: { pairingId: { in: string[] } };
      select: { pairingId: true };
    }) =>
      input.where.pairingId.in
        .filter((id) => membership.has(id))
        .map((pairingId) => ({ pairingId })),
  );
  const tx = {
    studentContinuationPairing: { findMany },
  } as unknown as Parameters<typeof readContinuationPairingIds>[0];
  return { tx, findMany, membership };
}

it("returns an empty set without a database read for empty input", async () => {
  const { tx, findMany } = fixture(["unrelated"]);
  expect(await readContinuationPairingIds(tx, [])).toEqual(new Set());
  expect(findMany).not.toHaveBeenCalled();
});

it.each([
  { label: "ordinary", members: [] },
  { label: "fully continuing", members: ["first", "second"] },
  { label: "partially continuing", members: ["second"] },
])("returns exact $label group membership", async ({ members }) => {
  const { tx, findMany } = fixture([...members, "unrelated"]);
  expect(await readContinuationPairingIds(tx, ["first", "second"])).toEqual(
    new Set(members),
  );
  expect(findMany).toHaveBeenCalledExactlyOnceWith({
    where: { pairingId: { in: ["first", "second"] } },
    select: { pairingId: true },
  });
});

it("deduplicates frozen input and bounds each read to 500 distinct pairing IDs", async () => {
  const ids = Array.from({ length: 1001 }, (_, index) => `pairing-${index}`);
  const members = [ids[0]!, ids[499]!, ids[500]!, ids[1000]!];
  const { tx, findMany } = fixture([...members, "unrelated"]);
  const input = Object.freeze([...ids, ...ids]);
  expect(await readContinuationPairingIds(tx, input)).toEqual(new Set(members));
  expect(findMany).toHaveBeenCalledTimes(3);
  expect(
    findMany.mock.calls.map(([query]) => query.where.pairingId.in.length),
  ).toEqual([500, 500, 1]);
  expect(
    findMany.mock.calls.flatMap(([query]) => query.where.pairingId.in),
  ).toEqual(ids);
  expect(input).toEqual([...ids, ...ids]);
});

it("propagates a later batch failure instead of returning partial membership", async () => {
  const { tx, findMany } = fixture();
  const error = new Error("Synthetic membership read failure");
  findMany.mockResolvedValueOnce([{ pairingId: "pairing-0" }]);
  findMany.mockRejectedValueOnce(error);
  await expect(
    readContinuationPairingIds(
      tx,
      Array.from({ length: 1001 }, (_, index) => `pairing-${index}`),
    ),
  ).rejects.toBe(error);
  expect(findMany).toHaveBeenCalledTimes(2);
});

it("rereads membership on every call and returns independently owned sets", async () => {
  const { tx, findMany, membership } = fixture(["first"]);
  const first = await readContinuationPairingIds(tx, ["first", "second"]);
  first.add("caller-only");
  membership.delete("first");
  membership.add("second");
  const second = await readContinuationPairingIds(tx, ["first", "second"]);
  expect(second).toEqual(new Set(["second"]));
  expect(first).toEqual(new Set(["first", "caller-only"]));
  expect(second).not.toBe(first);
  expect(findMany).toHaveBeenCalledTimes(2);
});
