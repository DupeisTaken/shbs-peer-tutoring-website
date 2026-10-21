import {
  pairingGroupEligibility,
  type PairingGroupEligibility,
} from "./pairing-group-eligibility";

/** A reusable group is a current plan. Session.mergeGroupId remains a separate saved snapshot. */
export type GroupablePairing = {
  id: string;
  groupId?: string | null;
  group?: { primaryPairingId: string } | null;
  scheduleConfirmed: boolean;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  roomId?: string | null;
  timeSlotId?: string | null;
  subject?: string;
  // Schedule-only readers may omit coverage; operational readers provide the
  // actual current student IDs so incomplete groups can be flagged for repair.
  tutees?: readonly unknown[];
};

const scheduleKey = (p: GroupablePairing) =>
  JSON.stringify([
    p.dayOfWeek,
    p.startMin,
    p.endMin,
    p.roomId ?? null,
    p.timeSlotId ?? null,
  ]);

function hasCoverage<T extends GroupablePairing>(
  pairing: T,
): pairing is T & {
  subject: string;
  tutees: readonly { tuteeId: string }[];
} {
  return (
    typeof pairing.subject === "string" &&
    Array.isArray(pairing.tutees) &&
    pairing.tutees.every(
      (row: unknown) =>
        typeof row === "object" && row !== null && "tuteeId" in row &&
        typeof row.tuteeId === "string",
    )
  );
}

export type PairingGroupStatus = "scheduled" | "awaiting" | "needsRepair";

/** Preserve explicit membership, including plans awaiting a time and legacy
 * invalid groups. Never hide a partial group or project just its coherent subset
 * as a complete lesson; operational callers must honor the repair flag. */
export function pairingEntries<T extends GroupablePairing>(
  pairings: readonly T[],
) {
  const visited = new Set<string>();
  const entries: {
    id: string;
    groupId: string | null;
    primary: T;
    pairings: T[];
    groupStatus: PairingGroupStatus | null;
    groupEligibility: PairingGroupEligibility | null;
  }[] = [];
  for (const pairing of pairings) {
    if (visited.has(pairing.id)) continue;
    const candidates = pairing.groupId
      ? pairings.filter((p) => p.groupId === pairing.groupId)
      : [pairing];
    const primary =
      candidates.find((p) => p.id === pairing.group?.primaryPairingId) ??
      candidates[0]!;
    const groupEligibility = pairing.groupId && candidates.every(hasCoverage)
      ? pairingGroupEligibility(candidates)
      : null;
    const awaiting = candidates.every((p) => !p.scheduleConfirmed && !p.timeSlotId);
    const scheduled = candidates.every(
      (p) => p.scheduleConfirmed && scheduleKey(p) === scheduleKey(primary),
    );
    const groupStatus: PairingGroupStatus | null = !pairing.groupId ? null
      : candidates.length < 2 || candidates.length > 6 ||
          groupEligibility?.eligible === false || (!awaiting && !scheduled)
        ? "needsRepair"
        : awaiting ? "awaiting" : "scheduled";
    candidates.forEach((p) => visited.add(p.id));
    entries.push({
      id: pairing.groupId ?? pairing.id,
      groupId: pairing.groupId ?? null,
      primary,
      pairings: [primary, ...candidates.filter((p) => p.id !== primary.id)],
      groupStatus,
      groupEligibility,
    });
  }
  return entries;
}
