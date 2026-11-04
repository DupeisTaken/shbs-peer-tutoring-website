export type RequestTab = "matching" | "assigned" | "reviews" | "processed";

/** Historical rows without explicit entry evidence must never be attributed to staff. */
export function signupSourceLabel(source: string | null | undefined) {
  return source === "STAFF"
    ? "manualSource"
    : source === "SELF_SERVICE"
      ? "selfServiceSource"
      : "unknownSource";
}

/** Explicit intake terms win; a legacy active signup needs current pairing evidence. */
export function isCurrentManualSignup(
  row: {
    status: string;
    intakeTermId: string | null;
    signupSubmittedAt: Date | null;
    firstChoiceId?: string | null;
    secondChoiceId?: string | null;
  },
  termId: string | undefined,
  hasCurrentPairing: boolean,
  retained: boolean,
) {
  if (!termId || (row.intakeTermId !== null && row.intakeTermId !== termId))
    return false;
  if (row.status === "PENDING") return true;
  if (row.status !== "ACTIVE") return false;
  return (
    retained ||
    (!!row.signupSubmittedAt && row.intakeTermId === termId) ||
    (hasCurrentPairing &&
      !!(row.signupSubmittedAt ?? row.firstChoiceId ?? row.secondChoiceId))
  );
}

/** Review work wins over the general Closed group. `processed` is retained as
 * the stored view key; grouping never changes lifecycle state or assignments. */
export function signupRequestGroup(
  state: string,
  subjects: readonly string[],
  assignedSubjects: readonly string[],
  options: { invalid?: boolean; needsReview?: boolean } = {},
): RequestTab {
  if (options.needsReview) return "reviews";
  if (state !== "OPEN" || options.invalid) return "processed";
  return subjects.length > 0 &&
    subjects.every((s) => assignedSubjects.includes(s))
    ? "assigned"
    : "matching";
}

/** Combine intake sources without changing their original submission priority. */
export function bySignupPriority<T extends { id: string; submittedAt: Date }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      +new Date(a.submittedAt) - +new Date(b.submittedAt) ||
      a.id.localeCompare(b.id),
  );
}
