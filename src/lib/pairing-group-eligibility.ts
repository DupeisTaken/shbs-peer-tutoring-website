/** Pairing stores a subject label, not a catalogue ID. Compare that stored value
 * exactly: aliases, case changes and whitespace must never invent missing work. */
export type EligibilityPairing = {
  id?: string;
  subject: string;
  tutees: readonly { tuteeId: string }[];
};

export type PairingGroupEligibility = {
  eligible: boolean;
  reason: "size" | "emptyRoster" | "incompleteCoverage" | null;
  missing: { tuteeId: string; subjects: string[] }[];
  emptyPairingIds: string[];
};

/** A combined lesson is the complete student × subject product. Rows may split
 * one subject across students; repeated rows never supply another subject. */
export function pairingGroupEligibility(
  pairings: readonly EligibilityPairing[],
): PairingGroupEligibility {
  const subjects = [...new Set(pairings.map((pairing) => pairing.subject))].sort();
  const coverage = new Map<string, Set<string>>();
  const emptyPairingIds: string[] = [];
  for (const pairing of pairings) {
    if (!pairing.tutees.length) emptyPairingIds.push(pairing.id ?? "");
    for (const { tuteeId } of pairing.tutees) {
      const selected = coverage.get(tuteeId) ?? new Set<string>();
      selected.add(pairing.subject);
      coverage.set(tuteeId, selected);
    }
  }
  const missing = [...coverage]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([tuteeId, selected]) => {
      const absent = subjects.filter((subject) => !selected.has(subject));
      return absent.length ? [{ tuteeId, subjects: absent }] : [];
    });
  const reason =
    pairings.length < 2 || pairings.length > 6
      ? "size"
      : emptyPairingIds.length
        ? "emptyRoster"
        : missing.length
          ? "incompleteCoverage"
          : null;
  return { eligible: reason === null, reason, missing, emptyPairingIds };
}
