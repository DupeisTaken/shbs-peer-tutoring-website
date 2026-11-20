const terminalStates: Record<
  string,
  { field: string; values: readonly string[] }
> = {
  TutorApplication: {
    field: "status",
    values: ["ACCEPTED", "REJECTED", "RECALLED"],
  },
  CrewApplication: { field: "status", values: ["ACCEPTED", "REJECTED"] },
  TutorQualification: { field: "status", values: ["APPROVED", "REJECTED"] },
  TutorStatusRequest: {
    field: "state",
    values: ["APPROVED", "DENIED", "RECALLED"],
  },
  TuteeRemovalRequest: {
    field: "state",
    values: ["APPROVED", "DENIED", "RECALLED", "REINSTATED"],
  },
  CrewStatusRequest: {
    field: "state",
    values: ["APPROVED", "DENIED", "RECALLED"],
  },
  StudentRequestReview: {
    field: "state",
    values: ["APPROVED", "DENIED", "RECALLED", "REINSTATED"],
  },
  StudentSignupAppeal: { field: "state", values: ["ACCEPTED", "REJECTED"] },
  StudentAppeal: { field: "state", values: ["UPHELD", "REJECTED"] },
  SessionFlag: {
    field: "state",
    values: ["DISMISSED", "WARNED", "PENALIZED", "ESCALATED"],
  },
  StudentSurvey: {
    field: "state",
    values: ["RECALLED", "DISQUALIFIED", "ABORTED", "INVALID_REJECTED"],
  },
  DisciplinaryCard: { field: "reviewStatus", values: ["VALID", "INVALID"] },
};

function timestamp(value: unknown) {
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" || typeof value === "number"
    ? new Date(value).getTime()
    : Number.NaN;
}

/** Archive admission is separate from normal creation defaults. Run only for
 * new IDs: an identical export/reimport must not reclassify current native work. */
export function historicalImportError(
  table: string,
  row: Record<string, unknown>,
  now = new Date(),
): string | null {
  if (
    table === "Tutor" &&
    !["GRADUATED", "OPTED_OUT", "ARCHIVED", "TRANSFERRED"].includes(
      String(row.status),
    )
  )
    return "Historical tutors require an explicit inactive status (GRADUATED, OPTED_OUT, ARCHIVED or TRANSFERRED). Use the tutor workflow for current participation.";
  if (table === "Tutee" && row.status !== "INACTIVE")
    return "Historical tutees require status=INACTIVE. Use the signup or roster workflow for current participation.";
  const terminal = terminalStates[table];
  if (terminal && !terminal.values.includes(String(row[terminal.field])))
    return `Historical ${table} records require an explicit completed ${terminal.field} (${terminal.values.join(", ")}). Use the current workflow for pending work.`;
  if (table === "TutorMeeting" && timestamp(row.date) > now.getTime())
    return "Historical meetings must be in the past. Create upcoming meetings in Meetings so obligations and reminders are intentional.";
  if (
    table === "Patrol" &&
    ["createdAt", "creditAwardedAt"].some(
      (field) => row[field] != null && timestamp(row[field]) > now.getTime(),
    )
  )
    return "Historical patrol timestamps must be in the past. Submit current observations through Patrol.";
  if (
    table === "PatrolObservation" &&
    row.observedAt != null &&
    timestamp(row.observedAt) > now.getTime()
  )
    return "Historical patrol observations must be in the past. Submit current observations through Patrol.";
  if (table === "Announcement" && row.active !== false)
    return "Historical announcements require active=false. Publish current announcements through Announcements.";
  return null;
}
