import "server-only";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { normalizeGrade } from "~/lib/academics";

/**
 * Observer responses are a separate read model, not a copy of a staff record with
 * known secrets removed. Each procedure opts into fields and nested relations here;
 * new database columns/JSON/relation includes are private until explicitly reviewed.
 * Scalars cannot smuggle objects or arrays through an otherwise permitted field.
 */
const scalar = z
  .union([z.string(), z.number(), z.boolean(), z.date()])
  .nullish();
const hidden = z.unknown().transform(() => null);
function summary(fields: string, relations: z.ZodRawShape = {}, redacted = "") {
  return z.object({
    ...Object.fromEntries(
      fields
        .split(/\s+/)
        .filter(Boolean)
        .map((key) => [key, scalar]),
    ),
    ...Object.fromEntries(
      redacted
        .split(/\s+/)
        .filter(Boolean)
        .map((key) => [key, hidden]),
    ),
    ...relations,
  });
}
const list = (model: z.ZodTypeAny) => z.array(model);
const strings = z.array(z.string());
// Legacy roster/report grade strings may contain arbitrary input. Only recognized
// school-grade notation belongs in a summary; other academic text stays private.
const schoolGrade = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) =>
    normalizeGrade(value).gradeLevel === null ? null : value,
  );
const person = summary(
  "id englishName name username alternativeNames",
  {},
  "email",
);
const academic = summary(
  "status gradeLevel schoolYear confirmedAt expectedGraduationYear needsConfirmation",
  {},
  "rawGrade",
);
const account = summary(
  "id name username alternativeNames profileVersion tutorAccessRevoked suspendedAt emailVerifiedAt mustChangePassword",
  { academicProfile: academic.nullish() },
  "email",
);
const tutor = summary(
  "id firstName lastName englishName preferredName legacyName nameFieldsConfirmed alternativeNames username status gradeLevel academicallyGraduated gradeSchoolYear gradeConfirmedAt createdAt updatedAt",
  { user: account.nullish(), academic: academic.optional() },
  "email",
);
const slot = summary("id label dayOfWeek startMin endMin active createdAt");
const term = summary(
  "id schoolYear quarter name startDate endDate signupOpensAt signupEnabled signupClosesAt tutorSignupEnabled tutorSignupOpensAt tutorSignupClosesAt tutorSignupPreviewUrl signupPreviewUrl active createdAt",
);
const level = summary("id name prefix rank apScored active createdAt");
const group = summary("id name rank createdAt");
const subject = summary("id name baseName groupId levelId active createdAt", {
  level: level.nullish(),
  group: group.nullish(),
});
const room = summary("id name patrolOrder createdAt", {
  unavailabilities: list(
    summary("id roomId dayOfWeek startMin endMin createdAt", {}, "reason"),
  ).optional(),
});
const tutee = summary(
  "id englishName firstName lastName preferredName legacyName alternativeNames gradeLevel academicallyGraduated status firstChoiceId secondChoiceId signedRulebook signedAt createdAt updatedAt signupSource intakeTermId signupSubmittedAt historical",
  {
    gradeLevel: schoolGrade,
    user: account.nullish(),
    owner: account.nullish(),
    academic: academic.optional(),
    enrollmentPeriod: summary("schoolYear quarter").nullish(),
    firstChoice: subject.nullish(),
    secondChoice: subject.nullish(),
    availabilities: list(summary("tuteeId slotId", { slot })).optional(),
  },
  "email phone preferredContact notes signatureName bannedMatch",
);
const pairing = summary(
  "id subject dayOfWeek startMin endMin createdAt tutorId termId roomId timeSlotId scheduleConfirmed",
  {
    tutor,
    room: room.nullish(),
    term,
    timeSlot: slot.nullish(),
    tutees: list(summary("pairingId tuteeId", { tutee })),
  },
);
const session = summary(
  "id date tutorStatus startMin endMin ratingPreparedness ratingParticipation ratingUnderstanding ratingBehavior ratingProgress month schoolYear quarter durationMin shFactor shCount createdAt updatedAt mergeGroupId pairingId timeSlotId tutorId actualRoomId online",
  {
    tutor: person.optional(),
    pairing: summary("subject"),
    tutees: list(
      summary("sessionId tuteeId status", { tutee: person }, "absenceReason"),
    ),
  },
  "comments tutorAbsentReason",
);
const application = summary(
  "id name firstName lastName preferredName alternativeNames type requestedTutorId requestedSubjectId status createdAt updatedAt interviewAt interviewCompletedAt interviewDurationMin interviewSchoolYear interviewQuarter decidedAt decidedByTutorId recalledAt",
  {
    subjectIntents: list(
      summary(
        "id applicationId subjectId taken hasApScore selfStudied",
        {
          subject,
        },
        "grade apScore selfStudyNote",
      ),
    ),
    interviewers: list(
      summary("applicationId tutorId isHead attended createdAt", {
        tutor: person,
      }),
    ),
    votes: list(summary("accept", { tutor: person }, "comment")),
    decidedByTutor: person.nullish(),
  },
  "email preferredContact decisionComment qualificationReason",
);
const attendanceCounts = "present excused unexcused";
const hours = "earned extras punishments total";
const tutorHours = summary(`tutorId englishName active sessions ${hours}`);
const request = summary(
  "id kind createdAt eligibleAt approvable affectedTutees",
  { tutor: person },
  "reason",
);
const removal = summary(
  "id kind createdAt eligibleAt resolvedAt period tutorName subject",
  { tutee: person },
  "reason",
);
const window = summary("enabled opensAt closesAt previewUrl");
const policy = summary(
  "id slug locale title body version updatedAt archivedByName archivedAt",
  {
    updatedBy: person.nullish(),
  },
);

/** Published program prose is intentional: the publication workflow explicitly
 * includes Viewer oversight, even for announcements with a selected tutor audience. */
const announcement = summary(
  "id title body pinned active createdAt audienceRestricted",
  { createdBy: person, recipientTutorIds: strings, _count: summary("acks") },
);

/** Never derive this label from action, details, undoData, or their contents. Legacy
 * audit actions include appeal decisions and correction explanations verbatim. */
const audit = summary(
  "id createdAt userId userName kind operation entity entityId approvalId undone",
  {},
  "details undoData",
).transform((row) => ({
  ...row,
  action:
    row.kind === "DECISION"
      ? "Management decision"
      : row.kind === "SUBMISSION"
        ? "Management submission"
        : row.kind === "CANCELLATION"
          ? "Management cancellation"
          : "Management action",
}));

const report = summary("", {
  scope: summary("label schoolYear masked", {
    quarters: strings,
    window: summary("start end").nullable(),
  }),
  summary: summary("sessions", {
    hours: summary(hours),
    attendance: summary(attendanceCounts),
    counts: summary(
      "tutorsServed tuteesServed signups cards meetings applications removals statusRequests patrols flags",
    ),
  }),
  tutors: list(tutorHours),
  meetingStats: list(summary(`tutorId tutor ${attendanceCounts}`)),
  crewStats: list(summary("userId member patrols hours")),
  flags: list(summary("id date tutor subject expected observed state")),
  sessions: list(
    summary(
      "id date tutor subject tutorStatus shCount",
      {
        tutees: list(summary("name status")),
      },
      "comments",
    ),
  ),
  cards: list(
    summary("id date tutee color source reviewStatus issuedBy", {}, "reason"),
  ),
  meetings: list(summary(`id title date ${attendanceCounts}`)),
  adjustments: list(summary("id date tutor type amount", {}, "reason")),
  applications: list(summary("id date name status", {}, "contact")),
  signups: list(
    summary(
      "id date name grade status firstChoice secondChoice",
      { grade: schoolGrade },
      "contact",
    ),
  ),
  removals: list(summary("id date tutee kind state")),
  statusRequests: list(summary("id date tutor kind state")),
});

/** Complete inventory of observer-accessible management read models. Do not add a
 * passthrough model: every relation, array item and JSON object needs its own shape. */
export const managementReadModels = {
  "admin.tutors": list(tutor),
  "admin.tuteeStats": z.record(
    summary(
      `sessions ${attendanceCounts} validYellow validRed effectiveReds removalPending`,
    ),
  ),
  "admin.tutees": list(tutee),
  "admin.rooms": list(room),
  "admin.terms": list(term),
  "admin.subjects": list(subject),
  "admin.subjectEligibility": list(summary("tutorId subjectId")),
  "admin.courseGroups": list(group.extend({ subjects: list(subject) })),
  "admin.subjectLevels": list(level),
  "admin.timeSlots": list(slot),
  "admin.pairings": list(pairing),
  "admin.sessions": list(session),
  "admin.currentPeriod": summary(
    "termId schoolYear quarter semester name signupOpensAt signupPreviewUrl signupIsOpen",
    {
      recruitment: summary("", { tutor: window, tutee: window }),
      next: summary(
        "schoolYear quarter semester name crossesSemester crossesYear graduates",
      ),
    },
  ).nullable(),
  "admin.periods": list(summary("schoolYear quarter active")),
  "admin.periodSummary": summary("", {
    scope: summary("schoolYear label", { quarters: strings }),
    rows: list(tutorHours),
    totals: summary(`sessions ${hours} ${attendanceCounts}`),
  }),
  "admin.periodReport": report,
  "admin.meetings": list(
    summary("id title date createdAt termId", {
      attendances: list(
        summary(
          "id status excusedAt meetingId tutorId",
          { tutor: person },
          "reason",
        ),
      ),
    }),
  ),
  "admin.adjustments": list(
    summary(
      "id month schoolYear quarter type amount createdAt tutorId",
      { tutor: person },
      "reason",
    ),
  ),
  "admin.tutorApplications": list(application),
  "admin.tutorRequests": list(request),
  "admin.tuteeRemovalRequests": summary("", {
    pendingOptOuts: list(removal),
    finalized: list(removal),
  }),
  "admin.patrolOrder": list(summary("id name patrolOrder")),
  "admin.crewRoster": list(
    summary("id name tutor crewOnly status patrols hours"),
  ),
  "admin.crewSummary": summary(
    "patrols hours openFlags members openApplications openRequests",
  ),
  "admin.crewApplications": list(
    summary(
      "id name gradeLevel createdAt",
      {},
      "email preferredContact message",
    ),
  ),
  "admin.crewIssuedCodes": list(summary("id name expiresAt", {}, "code")),
  "admin.crewRequests": list(
    summary("id kind member eligibleAt approvable createdAt", {}, "reason"),
  ),
  "admin.sessionFlags": list(
    summary(
      "id expected observed createdAt tutor subject room date startMin endMin",
    ),
  ),
  "admin.registrationCodes": list(
    summary(
      "id kind issuedByName tutorName fromApplication createdAt expiresAt status",
      {},
      "code email label issuedByEmail",
    ),
  ),
  "admin.policies": list(policy),
  "admin.policyArchives": list(policy),
  "admin.announcements": list(announcement),
  "admin.announcementCandidates": list(
    summary("id name gradeLevel status activeTutees", { subjects: strings }),
  ),
  "admin.disciplinaryCards": list(
    summary(
      "id color source reviewStatus createdAt updatedAt",
      {
        tutee: person,
        issuedByTutor: person.nullish(),
        session: summary("date").nullish(),
      },
      "reason reviewNote",
    ),
  ),
  "admin.auditLog": list(audit),
  "admin.auditFilterOptions": summary("", {
    users: list(summary("id label username former")),
    operations: strings,
    entities: strings,
  }),
  "corrections.attendance": list(session),
  "corrections.patrols": list(
    summary(
      "id crewUserId termId hours createdAt updatedAt",
      {
        crewUser: person,
        observations: list(
          summary("id patrolId roomId headcount observedAt", { room }),
        ),
      },
      "note",
    ),
  ),
} satisfies Record<string, z.ZodTypeAny>;

export function projectManagementRead(path: string, data: unknown): unknown {
  const model = Object.hasOwn(managementReadModels, path)
    ? managementReadModels[path as keyof typeof managementReadModels]
    : undefined;
  if (!model)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This management read has no observer projection.",
    });
  const result = model.safeParse(data);
  // Output validation failures must not echo private data or Zod paths to callers.
  if (!result.success)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Management summary unavailable.",
    });
  return result.data;
}
