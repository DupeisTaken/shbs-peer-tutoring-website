import type { AgendaCohort } from "~/app/_components/session-agenda";

/** Synthetic dated roster: the second learner has moved to a different cohort. */
export const attendanceOccurrence = {
  id: "cohort-synthetic",
  planId: "plan-synthetic",
  version: 7,
  date: "2026-10-26",
  startMin: 900,
  endMin: 945,
  startsAt: new Date("2026-10-26T07:00:00Z"),
  endsAt: new Date("2026-10-26T07:45:00Z"),
  roomId: "room",
  roomName: "A101",
  online: false,
  kind: "REGULAR",
  rescheduled: false,
  schoolClosed: false,
  unavailable: false,
  status: "SCHEDULED",
  subjects: ["Mathematics", "Physics"],
  pairingIds: ["a", "b"],
  primaryPairingId: "a",
  tutorId: "tutor",
  tutorName: "Synthetic Tutor",
  tutees: [{ id: "remaining", name: "Remaining Learner" }],
  needsAttendance: true,
  canRecordAttendance: true,
} satisfies AgendaCohort;
