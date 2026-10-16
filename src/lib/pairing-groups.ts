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
};

const scheduleKey = (p: GroupablePairing) =>
  JSON.stringify([
    p.scheduleConfirmed,
    p.dayOfWeek,
    p.startMin,
    p.endMin,
    p.roomId ?? null,
    p.timeSlotId ?? null,
  ]);

/** Project only coherent groups. Management reassignment/schedule changes cannot
 * silently include an unrelated assignment in a tutor's next attendance draft. */
export function pairingEntries<T extends GroupablePairing>(
  pairings: readonly T[],
) {
  const visited = new Set<string>();
  const entries: {
    id: string;
    groupId: string | null;
    primary: T;
    pairings: T[];
  }[] = [];
  for (const pairing of pairings) {
    if (visited.has(pairing.id)) continue;
    const candidates = pairing.groupId
      ? pairings.filter((p) => p.groupId === pairing.groupId)
      : [pairing];
    const primary =
      candidates.find((p) => p.id === pairing.group?.primaryPairingId) ??
      candidates[0]!;
    const members = candidates.filter(
      (p) => p.scheduleConfirmed && scheduleKey(p) === scheduleKey(primary),
    );
    if (
      pairing.groupId &&
      members.length >= 2 &&
      members.some((p) => p.id === pairing.id)
    ) {
      members.forEach((p) => visited.add(p.id));
      entries.push({
        id: pairing.groupId,
        groupId: pairing.groupId,
        primary,
        pairings: [primary, ...members.filter((p) => p.id !== primary.id)],
      });
    } else {
      visited.add(pairing.id);
      entries.push({
        id: pairing.id,
        groupId: null,
        primary: pairing,
        pairings: [pairing],
      });
    }
  }
  return entries;
}
