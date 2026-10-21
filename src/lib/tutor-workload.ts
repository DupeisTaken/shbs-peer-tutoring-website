/** Current-quarter workload estimates assignments, never historical attendance.
 * Only an explicit valid teaching group shares a planned block. Matching clocks
 * never imply grouping; a valid group counts once even before choosing a time. */
export type AssignedBlock = {
  id: string;
  tutorId: string;
  termId: string;
  groupId?: string | null;
  /** Readers mark incomplete or incoherent legacy groups false until repaired. */
  groupValid?: boolean;
  scheduleConfirmed: boolean;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};
export type WorkloadBlock = { key: string; pairingIds: string[] };
export function assignedBlockKey(block: AssignedBlock): string {
  return block.groupId && block.groupValid !== false
    ? JSON.stringify(["group", block.termId, block.groupId])
    : JSON.stringify(["pairing", block.termId, block.id]);
}
export function assignedBlocks(pairings: AssignedBlock[]): WorkloadBlock[] {
  const blocks = new Map<string, string[]>();
  for (const pairing of pairings) {
    const key = assignedBlockKey(pairing);
    const ids = blocks.get(key) ?? [];
    if (!ids.includes(pairing.id)) ids.push(pairing.id);
    blocks.set(key, ids);
  }
  return [...blocks].map(([key, pairingIds]) => ({ key, pairingIds }));
}
export type WorkloadProposal = {
  /** Remove only this pairing's membership: siblings retain their old block. */
  replacingPairingId?: string;
  block?: Omit<AssignedBlock, "tutorId">;
};
export function proposedAssignedCount(
  blocks: WorkloadBlock[],
  proposals: WorkloadProposal[],
) {
  const replacing = new Set(
    proposals.flatMap((proposal) =>
      proposal.replacingPairingId ? [proposal.replacingPairingId] : [],
    ),
  );
  const keys = new Set(
    blocks
      .filter((block) => block.pairingIds.some((id) => !replacing.has(id)))
      .map((block) => block.key),
  );
  for (const proposal of proposals)
    if (proposal.block)
      keys.add(assignedBlockKey({ ...proposal.block, tutorId: "" }));
  return keys.size;
}
/** Inactivity is also enforced in PostgreSQL; this explicit read rule labels it correctly. */
export function effectivePreferredMaximum(
  status: string,
  saved: number | null,
): number | null {
  return status === "ACTIVE" ? saved : 0;
}
export function workloadWarning(
  current: number,
  proposed: number,
  preferred: number | null,
) {
  if (preferred === null) return null;
  if (proposed > preferred && proposed > current)
    return "proposedOver" as const;
  if (current > preferred) return "over" as const;
  if (current === preferred) return "reached" as const;
  return null;
}
