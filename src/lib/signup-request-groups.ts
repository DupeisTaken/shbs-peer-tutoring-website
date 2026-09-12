export type RequestTab = "matching" | "assigned" | "reviews" | "processed";

/** Empty or partially assigned requests still need matching; terminal state wins. */
export function signupRequestGroup(
  state: string,
  subjects: readonly string[],
  assignedSubjects: readonly string[],
): Exclude<RequestTab, "reviews"> {
  if (state !== "OPEN") return "processed";
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
