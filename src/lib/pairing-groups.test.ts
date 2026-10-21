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
  subject: "Chemistry",
  tutees: [{ tuteeId: "student" }],
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
it("preserves singleton and mixed-schedule groups as repairable evidence", () => {
  expect(pairingEntries([pairing("a")])[0]).toMatchObject({ groupId: "g", groupStatus: "needsRepair" });
  expect(
    pairingEntries([
      pairing("a"),
      { ...pairing("b"), scheduleConfirmed: false },
    ])[0],
  ).toMatchObject({ groupId: "g", groupStatus: "needsRepair" });
});
it("falls back when the old primary has been reassigned/deleted", () => {
  expect(
    pairingEntries([pairing("a"), pairing("c")])[0]?.pairings.map((p) => p.id),
  ).toEqual(["a", "c"]);
});
it.each(["dayOfWeek", "startMin", "endMin", "timeSlotId", "roomId"] as const)(
  "flags a divergent %s without hiding group membership",
  (key) => {
    const changed = {
      ...pairing("a"),
      [key]: typeof pairing("a")[key] === "number" ? 2 : "changed",
    };
    const entries = pairingEntries([changed, pairing("b"), pairing("c")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ groupStatus: "needsRepair" });
    expect(entries[0]?.pairings.map((p) => p.id)).toEqual(["b", "a", "c"]);
  },
);

it("projects an awaiting group once without treating retained placeholder clocks or rooms as a booking", () => {
  const entries = pairingEntries([
    { ...pairing("a"), scheduleConfirmed: false, timeSlotId: null, dayOfWeek: 2, roomId: null },
    { ...pairing("b"), scheduleConfirmed: false, timeSlotId: null },
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ groupId: "g", groupStatus: "awaiting", groupEligibility: { eligible: true } });
});

it("flags incomplete coverage for repair without inventing or dropping an assignment", () => {
  const rows = [
    { ...pairing("a"), subject: "Chemistry", tutees: [{ tuteeId: "A" }] },
    { ...pairing("b"), subject: "Mathematics", tutees: [{ tuteeId: "A" }, { tuteeId: "B" }] },
  ];
  const entry = pairingEntries(rows)[0]!;
  expect(entry.groupStatus).toBe("needsRepair");
  expect(entry.groupEligibility?.missing).toEqual([{ tuteeId: "B", subjects: ["Chemistry"] }]);
  expect(entry.pairings).toHaveLength(2);
  expect(rows[0]!.tutees).toEqual([{ tuteeId: "A" }]);
});
