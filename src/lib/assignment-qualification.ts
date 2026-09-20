/** These are the only management operations that can introduce a tutor/course assignment. */
export const assignmentOperations = [
  "admin.createPairing",
  "admin.updatePairing",
  "admin.assignSignup",
  "admin.assignTuteeToTutor",
  "studentWorkflow.assign",
] as const;
export type AssignmentOperation = (typeof assignmentOperations)[number];
export const isAssignmentOperation = (value: string): value is AssignmentOperation =>
  assignmentOperations.some((operation) => operation === value);

export type QualificationOption = { id: string; englishName: string };
export type RecordedGrant = { tutorId: string; subjectId: string };

/** A roster tutor need not have a login. An explicitly revoked linked membership, however,
 * must not be mistaken for active participation merely because its historical link remains. */
export function isAssignableTutor(tutor: {
  status: string; user?: { tutorAccessRevoked: boolean } | null;
}) {
  return tutor.status === "ACTIVE" && !tutor.user?.tutorAccessRevoked;
}

/** Grants have already been filtered to approved sources by the server. Never infer rank. */
export function groupAssignmentTutors<T extends QualificationOption>(
  tutors: T[], subjectId: string, grants: RecordedGrant[],
) {
  const qualifiedIds = new Set(grants.filter((g) => g.subjectId === subjectId).map((g) => g.tutorId));
  return {
    qualified: tutors.filter((tutor) => qualifiedIds.has(tutor.id)),
    unqualified: tutors.filter((tutor) => !qualifiedIds.has(tutor.id)),
  };
}

/** Stable identity includes the complete assignment, including schedule and request version.
 * Confirmation tokens are evidence, not part of the assignment being acknowledged. */
export function assignmentIdentity(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).filter(([key, val]) => !["ticket", "overrideTicket"].includes(key) && val !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)]),
    );
    return item;
  };
  return JSON.stringify(normalize(value));
}
