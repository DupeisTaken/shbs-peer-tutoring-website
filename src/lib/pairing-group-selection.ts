import {
  pairingGroupEligibility,
  type EligibilityPairing,
} from "./pairing-group-eligibility";

export const MAX_COMBINED_ASSIGNMENTS = 6;

export type CombineSelectableEntry = {
  id: string;
  pairings: readonly EligibilityPairing[];
  /** Empty-roster or needsRepair entries cannot participate in combine selection. */
  selectable: boolean;
};

export type CombineAdditionResult = {
  nextSelectedIds: string[];
  autoSelectedIds: string[];
};

export type CombineRemovalResult = {
  nextSelectedIds: string[];
  autoRemovedIds: string[];
};

export type CombineEntryOption = {
  enabled: boolean;
  /** Additional companion entries that will be auto-ticked when selecting this entry. */
  autoSelectedIds: string[];
};

function collectAxes(entries: readonly CombineSelectableEntry[]) {
  const subjects = new Set<string>();
  const students = new Set<string>();
  for (const entry of entries) {
    for (const pairing of entry.pairings) {
      subjects.add(pairing.subject);
      for (const { tuteeId } of pairing.tutees) {
        students.add(tuteeId);
      }
    }
  }
  return { subjects, students };
}

function hasSharedAxis(
  base: readonly CombineSelectableEntry[],
  candidate: CombineSelectableEntry,
) {
  const baseAxes = collectAxes(base);
  for (const pairing of candidate.pairings) {
    if (baseAxes.subjects.has(pairing.subject)) return true;
    for (const { tuteeId } of pairing.tutees) {
      if (baseAxes.students.has(tuteeId)) return true;
    }
  }
  return false;
}

function coversCell(
  entry: CombineSelectableEntry,
  tuteeId: string,
  subject: string,
) {
  return entry.pairings.some(
    (pairing) =>
      pairing.subject === subject &&
      pairing.tutees.some((student) => student.tuteeId === tuteeId),
  );
}

function assignmentCount(entries: readonly CombineSelectableEntry[]) {
  let total = 0;
  for (const entry of entries) total += entry.pairings.length;
  return total;
}

function entryPairings(entries: readonly CombineSelectableEntry[]) {
  return entries.flatMap((entry) => entry.pairings);
}

/**
 * Resolve adding `candidateId` to `selectedIds`.
 *
 * - When nothing is selected yet, ticking `candidateId` is permitted only if at
 *   least one valid partner/completion exists for it on the page.
 * - When one or more entries are already selected, `candidateId` must connect
 *   along at least one shared subject or student axis, and any missing cells in
 *   the resulting student × subject product are auto-completed minimally up to
 *   MAX_COMBINED_ASSIGNMENTS. Returns `null` when no lawful completion exists.
 */
export function resolveCombineAddition(
  entries: readonly CombineSelectableEntry[],
  selectedIds: readonly string[],
  candidateId: string,
): CombineAdditionResult | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const indexById = new Map(entries.map((entry, idx) => [entry.id, idx]));
  const candidate = byId.get(candidateId);
  if (!candidate?.selectable) return null;
  if (selectedIds.includes(candidateId)) {
    return { nextSelectedIds: [...selectedIds], autoSelectedIds: [] };
  }

  const selectedEntries = selectedIds
    .map((id) => byId.get(id))
    .filter((entry): entry is CombineSelectableEntry => !!entry?.selectable);

  if (selectedEntries.length === 0) {
    // Allow starting with `candidate` only if it can validly combine with at least one other entry.
    const hasPartner = entries.some(
      (other) =>
        other.id !== candidateId &&
        other.selectable &&
        resolveCombineAddition(entries, [candidateId], other.id) !== null,
    );
    return hasPartner
      ? { nextSelectedIds: [candidateId], autoSelectedIds: [] }
      : null;
  }

  if (!hasSharedAxis(selectedEntries, candidate)) return null;

  const seed = [...selectedEntries, candidate];
  const seedSize = assignmentCount(seed);
  if (seedSize > MAX_COMBINED_ASSIGNMENTS) return null;

  const seedEligibility = pairingGroupEligibility(entryPairings(seed));
  if (seedEligibility.eligible) {
    return {
      nextSelectedIds: seed.map((entry) => entry.id),
      autoSelectedIds: [],
    };
  }
  if (seedEligibility.reason !== "incompleteCoverage") return null;

  const seedAxes = collectAxes(seed);
  const selectablePool = entries.filter(
    (entry) =>
      entry.selectable &&
      entry.id !== candidateId &&
      !selectedIds.includes(entry.id),
  );

  type SearchSolution = {
    added: CombineSelectableEntry[];
    extraAxes: number;
    addedAssignments: number;
    orderKey: number[];
  };

  let best: SearchSolution | null = null;
  let budget = 256;

  const compareSolutions = (a: SearchSolution, b: SearchSolution) => {
    if (a.extraAxes !== b.extraAxes) return a.extraAxes - b.extraAxes;
    if (a.addedAssignments !== b.addedAssignments)
      return a.addedAssignments - b.addedAssignments;
    if (a.added.length !== b.added.length)
      return a.added.length - b.added.length;
    for (let i = 0; i < Math.min(a.orderKey.length, b.orderKey.length); i++) {
      if (a.orderKey[i]! !== b.orderKey[i]!)
        return a.orderKey[i]! - b.orderKey[i]!;
    }
    return 0;
  };

  const countExtraAxes = (added: readonly CombineSelectableEntry[]) => {
    const combinedAxes = collectAxes([...seed, ...added]);
    let extra = 0;
    for (const s of combinedAxes.subjects)
      if (!seedAxes.subjects.has(s)) extra++;
    for (const u of combinedAxes.students)
      if (!seedAxes.students.has(u)) extra++;
    return extra;
  };

  const search = (
    current: CombineSelectableEntry[],
    added: CombineSelectableEntry[],
    currentSize: number,
  ) => {
    if (budget <= 0) return;
    budget--;

    const eligibility = pairingGroupEligibility(entryPairings(current));
    if (eligibility.eligible) {
      const solution: SearchSolution = {
        added: [...added],
        extraAxes: countExtraAxes(added),
        addedAssignments: currentSize - seedSize,
        orderKey: added.map((entry) => indexById.get(entry.id) ?? 0),
      };
      if (!best || compareSolutions(solution, best) < 0) {
        best = solution;
      }
      return;
    }

    if (
      eligibility.reason !== "incompleteCoverage" ||
      currentSize >= MAX_COMBINED_ASSIGNMENTS
    ) {
      return;
    }

    // Branch only on entries covering the first missing (student, subject) cell,
    // since every valid completion must cover it.
    const firstMissing = eligibility.missing[0];
    const missingSubject = firstMissing?.subjects[0];
    if (!firstMissing || !missingSubject) return;

    const usedIds = new Set(current.map((entry) => entry.id));
    const covering = selectablePool.filter(
      (entry) =>
        !usedIds.has(entry.id) &&
        currentSize + entry.pairings.length <= MAX_COMBINED_ASSIGNMENTS &&
        coversCell(entry, firstMissing.tuteeId, missingSubject),
    );

    // Try entries that introduce no extra students/subjects first.
    covering.sort((a, b) => {
      const extraA = countExtraAxes([...added, a]);
      const extraB = countExtraAxes([...added, b]);
      if (extraA !== extraB) return extraA - extraB;
      return a.pairings.length - b.pairings.length;
    });

    for (const next of covering) {
      current.push(next);
      added.push(next);
      search(current, added, currentSize + next.pairings.length);
      added.pop();
      current.pop();
    }
  };

  search([...seed], [], seedSize);

  const solved = best as SearchSolution | null;
  if (!solved) return null;

  const autoSelectedIds = solved.added.map((entry) => entry.id);
  return {
    nextSelectedIds: [...seed.map((entry) => entry.id), ...autoSelectedIds],
    autoSelectedIds,
  };
}

/**
 * Resolve unticking `removeId` from `selectedIds` while keeping any multi-entry
 * selection lawful. When removing one side of an auto-completed pair breaks the
 * student × subject matrix, the largest valid subset preserving the tutor's
 * earliest-selected entries is kept.
 */
export function resolveCombineRemoval(
  entries: readonly CombineSelectableEntry[],
  selectedIds: readonly string[],
  removeId: string,
): CombineRemovalResult {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const remainingIds = selectedIds.filter(
    (id) => id !== removeId && byId.get(id)?.selectable,
  );

  if (remainingIds.length <= 1) {
    return { nextSelectedIds: remainingIds, autoRemovedIds: [] };
  }

  const remainingEntries = remainingIds.map((id) => byId.get(id)!);
  if (pairingGroupEligibility(entryPairings(remainingEntries)).eligible) {
    return { nextSelectedIds: remainingIds, autoRemovedIds: [] };
  }

  // remainingIds.length <= 5 (capped by MAX_COMBINED_ASSIGNMENTS = 6), so exact
  // subset selection over valid subsets is tiny and deterministic.
  let bestIndices: number[] | null = null;
  const n = remainingEntries.length;
  const totalMasks = 1 << n;
  for (let mask = 1; mask < totalMasks; mask++) {
    const indices: number[] = [];
    const subset: CombineSelectableEntry[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        indices.push(i);
        subset.push(remainingEntries[i]!);
      }
    }
    if (subset.length < 2) continue;
    if (!pairingGroupEligibility(entryPairings(subset)).eligible) continue;

    if (!bestIndices) {
      bestIndices = indices;
      continue;
    }
    if (indices.length > bestIndices.length) {
      bestIndices = indices;
      continue;
    }
    if (indices.length === bestIndices.length) {
      // Prefer keeping the tutor's earliest-selected anchor entries.
      for (let i = 0; i < indices.length; i++) {
        if (indices[i]! !== bestIndices[i]!) {
          if (indices[i]! < bestIndices[i]!) bestIndices = indices;
          break;
        }
      }
    }
  }

  const keptIds = bestIndices
    ? bestIndices.map((i) => remainingIds[i]!)
    : [remainingIds[0]!];
  const keptSet = new Set(keptIds);
  const autoRemovedIds = remainingIds.filter((id) => !keptSet.has(id));
  return { nextSelectedIds: keptIds, autoRemovedIds };
}

/**
 * Compute enabled/disabled status and auto-tick companions for every entry
 * given the current selection. Already-selected entries remain enabled so the
 * tutor can untick them anytime.
 */
export function combineSelectionOptions(
  entries: readonly CombineSelectableEntry[],
  selectedIds: readonly string[],
): Map<string, CombineEntryOption> {
  const selectedSet = new Set(selectedIds);
  const result = new Map<string, CombineEntryOption>();
  for (const entry of entries) {
    if (!entry.selectable) {
      result.set(entry.id, { enabled: false, autoSelectedIds: [] });
      continue;
    }
    if (selectedSet.has(entry.id)) {
      result.set(entry.id, { enabled: true, autoSelectedIds: [] });
      continue;
    }
    const addition = resolveCombineAddition(entries, selectedIds, entry.id);
    result.set(entry.id, {
      enabled: addition !== null,
      autoSelectedIds: addition?.autoSelectedIds ?? [],
    });
  }
  return result;
}
