/** Root capture is a transaction label, not permission to adopt every write in
 * that transaction. This policy covers only the ordinary initial promotion. */
export type AdmissionRootChange = {
  entity: string;
  operation: string;
  recordKey: unknown;
  before: unknown;
  after: unknown;
  changedFields: unknown;
};
export type CapturedAdmissionAccount = {
  id: string;
  studentId?: string | null;
  personId?: string | null;
};
export type AdmissionRootContext = {
  applicationId: string;
  tutorId: string;
  codeIds: readonly string[];
  beforeAccount: CapturedAdmissionAccount | null;
  afterAccount: CapturedAdmissionAccount | null;
  beforeTutor?: { id: string; personId?: string | null } | null;
};
export type AdmissionRootValidation = {
  supported: boolean;
  unsupportedChangeIndexes: number[];
};
type Row = Record<string, unknown>;
const names = [
  "firstName",
  "lastName",
  "preferredName",
  "alternativeNames",
  "legacyName",
];
const tutorFields = [
  ...names,
  "englishName",
  "nameFieldsConfirmed",
  "username",
  "personId",
  "historyIdentityRevision",
  "updatedAt",
  "status",
  "gradeLevel",
  "academicallyGraduated",
  "gradeSchoolYear",
  "gradeConfirmedAt",
];
const userFields = [
  ...names,
  "name",
  "username",
  "personId",
  "profileVersion",
  "updatedAt",
  "gradeLevel",
  "tutorId",
  "tutorAccessRevoked",
  "role",
  "refreshAuthorityRevision",
];
const studentFields = [
  ...names,
  "englishName",
  "personId",
  "historyIdentityRevision",
  "updatedAt",
  "academicallyGraduated",
];
function row(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length <= 200 &&
    entries.every(
      ([, item]) =>
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)) ||
        (typeof item === "string" && item.length <= 2048),
    )
    ? (value as Row)
    : null;
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}
function delta(change: AdmissionRootChange, allowed: readonly string[]) {
  const before = row(change.before);
  const after = row(change.after);
  const fields = change.changedFields;
  if (
    !before ||
    !after ||
    !Array.isArray(fields) ||
    fields.length > 200 ||
    new Set(fields).size !== fields.length ||
    !fields.every(
      (field: unknown) => typeof field === "string" && allowed.includes(field),
    )
  )
    return false;
  // Redacted values cannot establish the full delta. Require column-name
  // coverage as well as consistency with every visible projected difference.
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].every(
    (field) =>
      JSON.stringify(before[field]) === JSON.stringify(after[field]) ||
      (allowed.includes(field) && fields.includes(field)),
  );
}
function identity(
  change: AdmissionRootChange,
  field: string,
  expected: string,
) {
  const key = row(change.recordKey);
  const before = row(change.before);
  const after = row(change.after);
  return (
    key?.[field] === expected &&
    after?.[field] === expected &&
    (change.operation === "INSERT"
      ? change.before === null
      : before?.[field] === expected)
  );
}
function inserted(change: AdmissionRootChange, fields: readonly string[]) {
  const after = row(change.after);
  return (
    change.operation === "INSERT" &&
    change.before === null &&
    change.changedFields === null &&
    after !== null &&
    Object.keys(after).every((field) => fields.includes(field))
  );
}

/** Changes must retain ascending journal order. Context must come from captured
 * source evidence, never current names, email matches or ownership. Missing legacy
 * metadata only blocks cases needing it. */
export function validateAdmissionRootChanges(
  changes: readonly AdmissionRootChange[],
  context: AdmissionRootContext,
): AdmissionRootValidation {
  const accountId = context.beforeAccount?.id;
  const studentId = context.beforeAccount?.studentId;
  let contextValid =
    id(context.applicationId) &&
    id(context.tutorId) &&
    context.codeIds.length <= 200 &&
    context.codeIds.every(id) &&
    new Set(context.codeIds).size === context.codeIds.length &&
    (!context.beforeAccount || id(context.beforeAccount.id)) &&
    (!context.afterAccount || id(context.afterAccount.id)) &&
    (!context.afterAccount ||
      context.beforeAccount?.id === context.afterAccount.id) &&
    (!context.beforeTutor || context.beforeTutor.id === context.tutorId) &&
    (context.afterAccount?.studentId === undefined ||
      context.beforeAccount?.studentId === undefined ||
      context.afterAccount.studentId === context.beforeAccount.studentId);
  const exactSubject = (change: AdmissionRootChange) =>
    change.entity === "User"
      ? accountId
      : change.entity === "Tutor"
        ? context.tutorId
        : change.entity === "Tutee"
          ? studentId
          : undefined;
  const subjectGroups = new Set(
    changes.flatMap((change) => {
      const subject = exactSubject(change);
      const group = row(change.after)?.personId;
      return subject &&
        row(change.recordKey)?.id === subject &&
        row(change.after)?.id === subject &&
        id(group)
        ? [group]
        : [];
    }),
  );
  const freshPersons = new Set(
    changes
      .filter(
        (change) =>
          change.entity === "Person" &&
          inserted(change, [
            "id",
            "primaryUserId",
            "mergedIntoId",
            "updatedAt",
          ]) &&
          id(row(change.after)?.id) &&
          subjectGroups.has(row(change.after)!.id as string) &&
          row(change.after)?.mergedIntoId === null &&
          (row(change.after)?.primaryUserId === null ||
            row(change.after)?.primaryUserId === accountId),
      )
      .map((change) => row(change.after)!.id as string),
  );
  const createdTutor = changes.some(
    (change) =>
      change.entity === "Tutor" &&
      change.operation === "INSERT" &&
      identity(change, "id", context.tutorId),
  );
  const existingGroups = new Set<string>();
  for (const candidate of [
    context.beforeAccount?.personId,
    context.beforeTutor?.personId,
  ])
    if (id(candidate)) existingGroups.add(candidate);
  // Only before-images of the exact captured subjects can prove an existing
  // directory group. An arbitrary after-image cannot introduce a new target.
  const seenSubjects = new Set<string>();
  for (const change of changes) {
    const subject = exactSubject(change);
    const reference = `${change.entity}:${subject}`;
    if (
      !subject ||
      seenSubjects.has(reference) ||
      row(change.recordKey)?.id !== subject
    )
      continue;
    seenSubjects.add(reference);
    if (row(change.before)?.id === subject) {
      const previous = row(change.before)?.personId;
      if (id(previous)) existingGroups.add(previous);
      const captured =
        change.entity === "User"
          ? context.beforeAccount
          : change.entity === "Tutor"
            ? context.beforeTutor
            : null;
      if (captured?.personId !== undefined && previous !== captured.personId)
        contextValid = false;
      if (
        change.entity === "User" &&
        studentId !== undefined &&
        row(change.before)?.studentId !== studentId
      )
        contextValid = false;
    }
  }
  const knownGroup = (value: unknown) =>
    id(value) && (freshPersons.has(value) || existingGroups.has(value));
  const redirects = new Map<string, string>();
  for (const change of changes) {
    if (
      change.entity !== "Person" ||
      !Array.isArray(change.changedFields) ||
      !change.changedFields.includes("mergedIntoId")
    )
      continue;
    const after = row(change.after);
    if (id(after?.id) && id(after.mergedIntoId)) {
      if (
        redirects.has(after.id) &&
        redirects.get(after.id) !== after.mergedIntoId
      )
        contextValid = false;
      redirects.set(after.id, after.mergedIntoId);
    }
  }
  for (const source of redirects.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = source;
    while (current) {
      if (visited.has(current)) {
        contextValid = false;
        break;
      }
      visited.add(current);
      current = redirects.get(current);
    }
  }
  function permittedGroupChange(change: AdmissionRootChange) {
    const fields = change.changedFields;
    if (!Array.isArray(fields) || !fields.includes("personId")) return true;
    const before = row(change.before);
    const after = row(change.after);
    if (
      !before ||
      !after ||
      !Object.hasOwn(before, "personId") ||
      !knownGroup(after.personId)
    )
      return false;
    // Initialization and relocation out of a newly-created group are supported;
    // moving an established source between groups needs the identity workflow.
    return (
      before.personId === null ||
      before.personId === after.personId ||
      (id(before.personId) && freshPersons.has(before.personId))
    );
  }
  function supported(change: AdmissionRootChange): boolean {
    const before = row(change.before);
    const after = row(change.after);
    if (!after) return false;
    const fields = Array.isArray(change.changedFields)
      ? change.changedFields
      : [];
    if (change.entity === "TutorApplication")
      return (
        change.operation === "UPDATE" &&
        identity(change, "id", context.applicationId) &&
        delta(change, [
          "status",
          "decisionComment",
          "decidedAt",
          "decidedByTutorId",
          "promotedTutorId",
          "updatedAt",
        ]) &&
        after?.status === "ACCEPTED" &&
        (!fields.includes("promotedTutorId") ||
          after.promotedTutorId === context.tutorId)
      );
    if (change.entity === "Tutor") {
      if (!identity(change, "id", context.tutorId)) return false;
      if (change.operation === "INSERT")
        return (
          inserted(change, [
            "id",
            "personId",
            "status",
            "preferredAssignedBlocks",
            "workloadPreferenceVersion",
            "historyIdentityRevision",
            "updatedAt",
          ]) &&
          after?.status === "ACTIVE" &&
          knownGroup(after.personId)
        );
      return (
        (createdTutor || context.beforeTutor?.id === context.tutorId) &&
        change.operation === "UPDATE" &&
        delta(change, tutorFields) &&
        permittedGroupChange(change) &&
        (!fields.includes("status") || after?.status === "ACTIVE")
      );
    }
    if (change.entity === "User") {
      if (
        !accountId ||
        change.operation !== "UPDATE" ||
        !identity(change, "id", accountId) ||
        !delta(change, userFields) ||
        !permittedGroupChange(change)
      )
        return false;
      if (
        fields.includes("tutorId") &&
        (!(before?.tutorId === null || before?.tutorId === context.tutorId) ||
          after?.tutorId !== context.tutorId)
      )
        return false;
      if (
        fields.includes("tutorAccessRevoked") &&
        (before?.tutorId !== null || after?.tutorAccessRevoked !== false)
      )
        return false;
      if (
        fields.includes("role") &&
        (!["STUDENT", "VIEWER", "CREW"].includes(String(before?.role)) ||
          after?.role !== "TUTOR")
      )
        return false;
      return (
        !fields.includes("refreshAuthorityRevision") || fields.includes("role")
      );
    }
    if (change.entity === "Tutee")
      return (
        id(studentId) &&
        change.operation === "UPDATE" &&
        identity(change, "id", studentId) &&
        delta(change, studentFields) &&
        permittedGroupChange(change)
      );
    if (change.entity === "RegistrationCode")
      return (
        id(after?.id) &&
        context.codeIds.includes(after.id) &&
        identity(change, "id", after.id) &&
        inserted(change, [
          "id",
          "tutorId",
          "applicationId",
          "crewApplicationId",
          "issuedById",
          "usedByUserId",
          "expiresAt",
          "usedAt",
        ]) &&
        after.applicationId === context.applicationId &&
        after.tutorId === context.tutorId &&
        after.crewApplicationId === null &&
        after.usedAt === null &&
        after.usedByUserId === null
      );
    if (change.entity === "AcademicProfile") {
      if (!accountId || !identity(change, "userId", accountId)) return false;
      return (
        inserted(change, ["userId", "status", "confirmedAt"]) ||
        (change.operation === "UPDATE" &&
          delta(change, [
            "status",
            "gradeLevel",
            "rawGrade",
            "schoolYear",
            "confirmedAt",
            "reconfirmRequired",
          ]))
      );
    }
    if (change.entity === "HistoricalAcademicRecord") {
      const tutorBaseline =
        after?.id === `legacy-tutor:${context.tutorId}` &&
        after?.tutorId === context.tutorId &&
        after?.tuteeId === null;
      const studentBaseline =
        id(studentId) &&
        after?.id === `legacy-tutee:${studentId}` &&
        after?.tuteeId === studentId &&
        after?.tutorId === null;
      return (
        (tutorBaseline || studentBaseline) &&
        id(after?.id) &&
        identity(change, "id", after.id) &&
        (inserted(change, ["id", "tutorId", "tuteeId"]) ||
          (change.operation === "UPDATE" && delta(change, [])))
      );
    }
    if (change.entity === "Person") {
      if (
        !id(after?.id) ||
        !identity(change, "id", after.id) ||
        !knownGroup(after.id)
      )
        return false;
      if (change.operation === "INSERT") return freshPersons.has(after.id);
      if (
        change.operation !== "UPDATE" ||
        !delta(change, [
          "primaryUserId",
          "mergedIntoId",
          "revision",
          "updatedAt",
          "resolutionState",
        ])
      )
        return false;
      if (
        fields.includes("resolutionState") &&
        after.resolutionState !== "REVIEW_REQUIRED"
      )
        return false;
      if (
        fields.includes("mergedIntoId") &&
        (!freshPersons.has(after.id) ||
          before?.mergedIntoId !== null ||
          !knownGroup(after.mergedIntoId) ||
          after.mergedIntoId === after.id)
      )
        return false;
      if (
        fields.includes("primaryUserId") &&
        !(
          (before?.primaryUserId === null &&
            accountId &&
            after.primaryUserId === accountId) ||
          (freshPersons.has(after.id) &&
            before?.primaryUserId === accountId &&
            after.primaryUserId === null &&
            knownGroup(after.mergedIntoId))
        )
      )
        return false;
      return true;
    }
    return false;
  }
  const unsupportedChangeIndexes = changes.flatMap((change, index) =>
    contextValid && supported(change) ? [] : [index],
  );
  return {
    supported:
      contextValid &&
      changes.length > 0 &&
      unsupportedChangeIndexes.length === 0,
    unsupportedChangeIndexes,
  };
}
