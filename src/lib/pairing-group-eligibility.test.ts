import { expect, it } from "vitest";
import { pairingGroupEligibility } from "./pairing-group-eligibility";

const row = (subject: string, ...tuteeIds: string[]) => ({
  subject,
  tutees: tuteeIds.map((tuteeId) => ({ tuteeId })),
});

it.each([
  [row("Chemistry", "A"), row("Chemistry", "B")],
  [row("Chemistry", "A"), row("Mathematics", "A")],
  [row("Chemistry", "A"), row("Mathematics", "A"), row("Chemistry", "B"), row("Mathematics", "B")],
  [row("Chemistry", "A", "B"), row("Mathematics", "A", "B")],
  [row("Chemistry", "A", "B"), row("Mathematics", "A"), row("Mathematics", "B")],
])("allows complete coverage with split or compressed rosters: %j", (...rows) => {
  expect(pairingGroupEligibility(rows)).toMatchObject({ eligible: true, reason: null, missing: [] });
});

it("identifies exactly which student lacks which subject", () => {
  expect(pairingGroupEligibility([
    row("Chemistry", "A"), row("Mathematics", "A"), row("Mathematics", "B"),
  ])).toEqual({
    eligible: false, reason: "incompleteCoverage",
    missing: [{ tuteeId: "B", subjects: ["Chemistry"] }], emptyPairingIds: [],
  });
});

it("unions subject coverage by stable student ID and does not let duplicate rows fabricate it", () => {
  const result = pairingGroupEligibility([
    row("Chemistry", "A"), row("Chemistry", "A"),
    row("Mathematics", "A", "B"),
  ]);
  expect(result.missing).toEqual([{ tuteeId: "B", subjects: ["Chemistry"] }]);
});

it.each(["chemistry", "Chemistry ", "Chem"])(
  "never equates legacy subject label %s with Chemistry", (subject) => {
    expect(pairingGroupEligibility([
      row("Chemistry", "A"), row(subject, "B"),
    ]).eligible).toBe(false);
  },
);

it("retains empty-roster and size failures as explicit repair evidence", () => {
  expect(pairingGroupEligibility([row("Chemistry", "A")]).reason).toBe("size");
  expect(pairingGroupEligibility([
    { ...row("Chemistry", "A"), id: "populated" },
    { ...row("Chemistry"), id: "empty" },
  ])).toMatchObject({ eligible: false, reason: "emptyRoster", emptyPairingIds: ["empty"] });
  expect(pairingGroupEligibility(Array.from({ length: 7 }, () => row("Chemistry", "A"))).reason).toBe("size");
});
