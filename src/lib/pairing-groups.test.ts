import { expect, it } from "vitest";
import { pairingEntries } from "./pairing-groups";
const pairing = (id: string, groupId: string | null = "g") => ({
  id,
  groupId,
  group: { primaryPairingId: "b" },
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 900,
  endMin: 960,
  timeSlotId: "slot",
  roomId: "room",
});
it("places the saved primary first without duplicating grouped assignments", () => {
  const entries = pairingEntries([
    pairing("a"),
    pairing("b"),
    pairing("c", null),
  ]);
  expect(entries.map((e) => e.pairings.map((p) => p.id))).toEqual([
    ["b", "a"],
    ["c"],
  ]);
});
it("keeps singleton groups and unconfirmed assignments independent", () => {
  expect(pairingEntries([pairing("a")])[0]?.groupId).toBeNull();
  expect(
    pairingEntries([
      pairing("a"),
      { ...pairing("b"), scheduleConfirmed: false },
    ]).every((e) => e.groupId === null),
  ).toBe(true);
});
it("falls back when the old primary has been reassigned/deleted", () => {
  expect(
    pairingEntries([pairing("a"), pairing("c")])[0]?.pairings.map((p) => p.id),
  ).toEqual(["a", "c"]);
});
it.each(["dayOfWeek", "startMin", "endMin", "timeSlotId", "roomId"] as const)(
  "does not silently combine a divergent %s",
  (key) => {
    const changed = {
      ...pairing("a"),
      [key]: typeof pairing("a")[key] === "number" ? 2 : "changed",
    };
    const entries = pairingEntries([changed, pairing("b"), pairing("c")]);
    expect(entries.map((e) => e.pairings.map((p) => p.id))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  },
);
