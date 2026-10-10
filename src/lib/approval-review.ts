import { APPROVAL_OPERATIONS } from "./approval-policy";

export type ReviewRecord = Record<string, unknown>;
export type ReviewField = {
  key: string;
  requested: unknown;
  before: unknown;
  hasBefore: boolean;
};
const record = (value: unknown): ReviewRecord | null =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date)
    ? (value as ReviewRecord)
    : null;

/** Concurrency and confirmation evidence is not part of the requested business change. */
export const reviewTechnicalFields = new Set([
  "expectedUpdatedAt",
  "expectedRevision",
  "expectedProfileVersion",
  "expectedVersion",
  "expectedPolicy",
  "expectedState",
  "expectedEnabled",
  "expectedTimeZone",
  "expectedTermId",
  "expectedFingerprint",
  "ticket",
  "overrideTicket",
  "confirmPassword",
  "passwordHash",
  "tokenHash",
  "codeHash",
  "fingerprint",
  "profileVersion",
  "createdAt",
  "updatedAt",
]);
const targetKeys = new Set([
  "id",
  "userId",
  "requestId",
  "applicationId",
  "appealId",
  "flagId",
  "sessionId",
  "patrolId",
  "postId",
  "sectionId",
  "pageId",
  "cardId",
]);
const tableAliases: Record<string, string> = {
  Room: "rooms",
  SchoolCalendarDay: "calendar",
  StudentSettings: "settings",
  HomeContent: "content",
  MessageOverride: "translation",
  PolicyDocument: "policy",
  PageLayout: "layout",
  ProgramSettings: "programSettings",
  Language: "languages",
};
// Only operations that write record fields directly get an automatic field comparison.
// A decision/action's input must never be mistaken for its resulting database state.
const comparable = new Set([
  "admin.updateRoom",
  "admin.updateTutor",
  "admin.updateTutee",
  "admin.updateSubject",
  "admin.updateSubjectLevel",
  "admin.updatePairing",
  "admin.updateAccountProfile",
  "admin.updateAccountUsername",
  "admin.setUserRole",
  "program.setTimeZone",
  "program.setProfilePolicy",
  "i18n.setLanguageEnabled",
  "admin.setMemberships",
  "admin.setTuteeStatus",
  "admin.setCrewStatus",
  "admin.updateAnnouncement",
  "admin.reviewCard",
  "admin.upsertPolicy",
  "admin.saveCourseGroup",
  "student.setCalendarDay",
  "student.setFeedbackSettings",
  "home.updateNews",
  "home.updateSection",
  "home.updatePage",
  "home.setContent",
  "home.setLayout",
  "localization.setString",
  "corrections.correctAttendance",
  "corrections.correctPatrol",
  "admin.updateTimeSlot",
  "subjectAvailability.setWillingness",
]);

function equal(a: unknown, b: unknown): boolean {
  // JSON evidence stores dates as strings. Object key order is not a change; array order is.
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  const left = record(a),
    right = record(b);
  return (
    !!left &&
    !!right &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && equal(left[key], right[key]),
    )
  );
}

/** Pure presentation over immutable submission evidence: no current-record lookups,
 * mutation of the payload, or guesses when an older request lacks a snapshot. */
export function approvalReview(
  operation: string,
  payload: unknown,
  targets: unknown,
) {
  const input = record(payload) ?? {};
  const evidence = record(targets) ?? {};
  const groups = Object.entries(evidence).flatMap(([table, value]) => {
    const rows = (Array.isArray(value) ? value : [value])
      .map((item) => record(record(item)?.record ?? item))
      .filter((item): item is ReviewRecord => !!item);
    return rows.length ? [{ table, rows }] : [];
  });
  const table = APPROVAL_OPERATIONS[operation];
  const primaryRows =
    groups.find((group) => group.table === table)?.rows ??
    groups.find((group) => group.table === tableAliases[table ?? ""])?.rows ??
    [];
  const target = Object.entries(input).find(([key]) => targetKeys.has(key));
  // Match the primary table and exact ID/compound key. Related records are context only.
  const primary = target
    ? primaryRows.find((row) => row.id === target[1])
    : primaryRows.find((row) =>
        ["key", "code", "locale", "slug", "date"].every(
          (key) => input[key] === undefined || row[key] === input[key],
        ),
      );
  const verb = operation.split(".").at(-1) ?? "";
  const kind =
    verb.startsWith("create") || verb === "issueRegistrationCode"
      ? ("create" as const)
      : verb.startsWith("delete")
        ? ("delete" as const)
        : comparable.has(operation)
          ? ("update" as const)
          : ("action" as const);
  const context: { key: string; value: unknown }[] = [];
  const changes: ReviewField[] = [];
  const unchanged: ReviewField[] = [];
  for (const [key, requested] of Object.entries(input)) {
    if (reviewTechnicalFields.has(key) || requested === undefined) continue;
    // Academic confirmation derives its result from the current program year.
    // The legacy schoolYear input is ignored by the executor; the expected year
    // is review context, never a promised direct edit to AcademicProfile.
    if (operation === "admin.updateAccountAcademics") {
      if (key === "schoolYear") continue;
      if (key === "expectedSchoolYear") {
        context.push({ key: "expectedSchoolYear", value: requested });
        continue;
      }
    }
    if (targetKeys.has(key)) {
      context.push({ key, value: requested });
      continue;
    }
    if (key === "reason" && operation.startsWith("corrections.")) {
      context.push({ key: "requestReason", value: requested });
      continue;
    }
    if (
      operation === "admin.setMemberships" &&
      key === "membership" &&
      record(requested)
    ) {
      // These capabilities are stored under different column names. Only derive
      // values justified by the snapshot; an active tutor identity also depends
      // on roster status, which older User evidence does not necessarily include.
      const previous: ReviewRecord = {};
      if (typeof primary?.role === "string") {
        previous.rank = ["HEAD", "ADMIN", "COORDINATOR"].includes(primary.role)
          ? primary.role
          : "NONE";
        previous.viewer = primary.role === "VIEWER";
      }
      if (typeof primary?.tuteeMember === "boolean")
        previous.tutee = primary.tuteeMember;
      if (typeof primary?.canTranslate === "boolean")
        previous.translator = primary.canTranslate;
      if (primary && Object.hasOwn(primary, "crewStatus"))
        previous.crew = primary.crewStatus !== null;
      if (primary?.tutorId === null || primary?.tutorAccessRevoked === true)
        previous.tutor = false;
      for (const [capability, value] of Object.entries(
        requested as ReviewRecord,
      )) {
        const field = {
          key: capability,
          requested: value,
          before: previous[capability],
          hasBefore: Object.hasOwn(previous, capability),
        };
        (field.hasBefore && equal(field.before, value)
          ? unchanged
          : changes
        ).push(field);
      }
      continue;
    }
    let source = primary;
    if (
      operation === "subjectAvailability.setWillingness" &&
      key === "willing"
    ) {
      const willingness = record(evidence.willingness);
      source =
        willingness &&
        willingness.tutorId === input.tutorId &&
        willingness.subjectId === input.subjectId
          ? willingness
          : undefined;
    }
    let hasBefore = kind === "update" && !!source && Object.hasOwn(source, key);
    let before = hasBefore ? source?.[key] : undefined;
    // Collection writes keep their old values in child snapshots, not the parent.
    // Compare only the submitted columns and only children of the exact target.
    const child =
      operation === "admin.updatePairing" && key === "tuteeIds"
        ? {
            table: "Pairing.PairingTutee",
            foreignKey: "pairingId",
            identity: "tuteeId",
          }
        : operation === "corrections.correctAttendance" && key === "tutees"
          ? {
              table: "Session.SessionTutee",
              foreignKey: "sessionId",
              identity: "tuteeId",
            }
          : operation === "corrections.correctPatrol" && key === "observations"
            ? {
                table: "Patrol.PatrolObservation",
                foreignKey: "patrolId",
                identity: "id",
              }
            : null;
    if (
      child &&
      Array.isArray(requested) &&
      Array.isArray(evidence[child.table])
    ) {
      const rows = (
        groups.find((group) => group.table === child.table)?.rows ?? []
      ).filter((row) => row[child.foreignKey] === input.id);
      hasBefore = true;
      before =
        key === "tuteeIds"
          ? rows.map((row) => row.tuteeId)
          : rows.map((row) => {
              const submitted = requested
                .map(record)
                .find((item) => item?.[child.identity] === row[child.identity]);
              // Removed children still need a readable identity and their old values.
              return submitted
                ? Object.fromEntries(
                    Object.keys(submitted).map((field) => [field, row[field]]),
                  )
                : row;
            });
    }
    const field = {
      key,
      requested,
      before,
      hasBefore,
    };
    const comparisonValue = (value: unknown) =>
      child && Array.isArray(value)
        ? [...(value as unknown[])].sort((left: unknown, right: unknown) =>
            String(record(left)?.[child.identity] ?? left).localeCompare(
              String(record(right)?.[child.identity] ?? right),
            ),
          )
        : value;
    (hasBefore &&
    equal(comparisonValue(field.before), comparisonValue(requested))
      ? unchanged
      : changes
    ).push(field);
  }
  const names = new Map<string, string>();
  const references = new Map<string, ReviewRecord>();
  for (const { rows } of groups)
    for (const row of rows) {
      const name = [
        row.englishName,
        row.name,
        row.title,
        record(row.payload)?.englishName,
      ].find(
        (value): value is string => typeof value === "string" && !!value.trim(),
      );
      if (typeof row.id === "string" && name) names.set(row.id, name);
      if (typeof row.id === "string") references.set(row.id, row);
    }
  // Surface the reason/type of an underlying request beside its identity, rather
  // than forcing the reviewer into the full evidence disclosure to find its intent.
  if (
    kind === "action" &&
    primary &&
    ["approve", "accept", "overturn", "action"].some((key) =>
      Object.hasOwn(input, key),
    )
  ) {
    for (const key of ["kind", "reason"]) {
      if (
        primary[key] !== undefined &&
        primary[key] !== null &&
        primary[key] !== ""
      )
        context.push({
          key: key === "reason" ? "originalReason" : key,
          value: primary[key],
        });
    }
  }
  const removed =
    kind === "delete" && primary
      ? Object.entries(primary).filter(
          ([key]) => key !== "id" && !reviewTechnicalFields.has(key),
        )
      : [];
  return {
    kind,
    context,
    changes,
    unchanged,
    groups,
    names,
    references,
    removed,
    hasRemovalSnapshot: !!primary,
  };
}
