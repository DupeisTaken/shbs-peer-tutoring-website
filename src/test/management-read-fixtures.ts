/** Synthetic private markers must never appear in an observer response or page. */
export const PRIVATE = "PRIVATE_MANAGEMENT_EVIDENCE";
export const date = new Date("2026-10-01T00:00:00Z");
export const sessionRow = {
  id: "session",
  date,
  updatedAt: date,
  tutorStatus: "TUTOR_ABSENT",
  tutorId: "tutor",
  comments: PRIVATE,
  tutorAbsentReason: PRIVATE,
  startMin: 900,
  endMin: 960,
  shCount: 1,
  mergeGroupId: null,
  submissionKey: PRIVATE,
  submissionPayloadHash: PRIVATE,
  tutor: {
    englishName: "Tutor One",
    email: PRIVATE,
    futurePrivateField: PRIVATE,
  },
  pairing: { subject: "Math", futureRelation: { value: PRIVATE } },
  tutees: [
    {
      sessionId: "session",
      tuteeId: "tutee",
      status: "EXCUSED_ABSENT",
      absenceReason: PRIVATE,
      tutee: { englishName: "Tutee One", phone: PRIVATE },
    },
  ],
  futurePrivateField: { nested: [PRIVATE] },
};
export const applicationRow = {
  id: "application",
  type: "INITIAL",
  name: "Applicant One",
  status: "ACCEPTED",
  email: PRIVATE,
  preferredContact: PRIVATE,
  decisionComment: PRIVATE,
  qualificationReason: PRIVATE,
  qualificationSnapshot: { notes: PRIVATE },
  policySnapshot: [{ body: PRIVATE }],
  policyRevision: PRIVATE,
  createdAt: date,
  updatedAt: date,
  interviewAt: null,
  subjectIntents: [
    {
      subjectId: "math",
      subject: { name: "Math", level: { name: "AP" } },
      taken: true,
      grade: PRIVATE,
      hasApScore: true,
      apScore: PRIVATE,
      selfStudied: true,
      selfStudyNote: PRIVATE,
      unknownEvidence: PRIVATE,
    },
  ],
  interviewers: [
    { isHead: true, tutor: { id: "tutor", englishName: "Tutor One" } },
  ],
  votes: [
    { accept: true, comment: PRIVATE, tutor: { englishName: "Tutor One" } },
  ],
  decidedByTutor: { englishName: "Tutor One" },
};
export const auditRow = {
  id: "audit",
  createdAt: date,
  userId: "staff",
  userName: "Staff One",
  kind: "DECISION",
  entity: "StudentAppeal",
  entityId: "appeal",
  operation: "student.decideAppeal",
  action: `Appeal upheld: ${PRIVATE}`,
  details: { before: [{ comments: PRIVATE }], appeal: { reason: PRIVATE } },
  undoData: { privateSnapshot: PRIVATE },
  undone: false,
};
