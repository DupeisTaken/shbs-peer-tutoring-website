import { APPROVAL_OPERATIONS } from "./approval-policy";
import type { ReviewField, ReviewRecord } from "./approval-review";
import { recordedEvidenceDiff } from "./recorded-evidence-diff";
import { auditReferenceEntity } from "./review-vocabulary";

export type ReviewFact = { key: string; value: unknown };
export type ReviewReference = {
  kind: "reviewReference";
  entity: string;
  id: string;
  name?: string;
  state: "recorded" | "missing" | "ambiguous";
  facts: ReviewFact[];
};
const referenceValues = new WeakSet<object>();
/** Only values projected by this adapter are references. A literal stored object
 * with the same keys remains exact evidence instead of impersonating a label. */
export function isReviewReference(value: unknown): value is ReviewReference {
  return (
    value !== null && typeof value === "object" && referenceValues.has(value)
  );
}

/** Each approved operation explicitly owns its contextual identifiers. Other
 * submitted business fields remain changes, including future schema additions.
 * This is a presentation inventory, never an execution/authority registry. */
export const approvalSummaryContexts: Record<string, readonly string[]> = {
  "studentWorkflow.headEditSignup": ["id"],
  "studentWorkflow.headUnassign": ["id", "pairingId"],
  "studentWorkflow.resolveSignupAppeal": ["id"],
  "program.setCalendarDay": ["date"],
  "program.setNameFields": ["accountType"],
  "program.removeCalendarDay": ["date"],
  "admin.reorderRooms": [],
  "admin.setApplicationInvalidity": ["id"],
  "admin.setSignupInvalidity": ["id"],
  "studentWorkflow.setRequestInvalidity": ["id"],
  "program.setCaptcha": [],
  "program.setProfilePolicy": [],
  "program.setSignupField": ["form", "field"],
  "program.setEmailNotifications": [],
  "program.setSecondaryEmailBinding": [],
  "program.setTimeZone": [],
  "monthlyHours.save": [],
  "program.setSignupWindow": ["recruitmentAudience", "periodName", "timeZone"],
  "program.prepareNextRecruitment": ["audience"],
  "program.setFeaturePending": ["feature", "effective", "pending"],
  "admin.refresh": [],
  "i18n.setLanguageEnabled": ["code"],
  "i18n.deleteLanguage": ["code"],
  "i18n.reorderLanguages": [],
  "messaging.setPermission": ["target"],
  "admin.updateAccountUsername": ["userId"],
  "admin.setUserRole": ["userId"],
  "admin.setUserCanTranslate": ["userId"],
  "admin.revokeRegistrationCode": ["id"],
  "messaging.moderate": ["id"],
  "messaging.restrict": ["userId"],
  "historicalAcademics.correctBatch": [],
  "departure.setState": ["userId"],
  "corrections.correctAttendance": ["id"],
  "corrections.correctPatrol": ["id"],
  "interviewManagement.qualify": ["tutorId", "subjectId"],
  "subjectAvailability.setWillingness": ["tutorId", "subjectId"],
  "interviewManagement.complete": ["applicationId"],
  "student.setCalendarDay": ["date"],
  "student.setFeedbackSettings": [],
  "student.decideAppeal": ["id"],
  "studentWorkflow.assign": ["id", "tutorId", "subjectId"],
  "studentWorkflow.resolveReview": [
    "id",
    "participant",
    "kind",
    "originalReason",
  ],
  "translationReview.decide": ["id", "textDestination", "locale"],
  "tutor.decideInterview": ["applicationId"],
  "home.setContent": ["key", "locale"],
  "home.setNewsTranslation": ["postId", "locale"],
  "home.setSectionTranslation": ["sectionId", "locale"],
  "home.setPageTitle": ["id", "locale"],
  "localization.setString": ["key", "locale"],
  "admin.saveCourseGroup": ["id"],
  "admin.reorderCatalogue": ["kind"],
  "admin.createSubjectLevel": [],
  "admin.updateSubjectLevel": ["id"],
  "admin.deleteSubjectLevel": ["id"],
  "admin.createPairing": [],
  "admin.updatePairing": ["id"],
  "admin.retryRoomAllocation": ["id"],
  "admin.autoAssignUnassignedRooms": [],
  "admin.setPairingRoom": ["id"],
  "admin.deletePairing": ["id"],
  "admin.setUserCanTutor": ["userId"],
  "admin.setMemberships": ["userId"],
  "admin.issueRegistrationCode": ["tutorId", "applicationId"],
  "admin.createTutor": [],
  "admin.updateTutor": ["id"],
  "admin.updateAccountProfile": ["userId"],
  "admin.updateAccountAcademics": ["userId", "expectedSchoolYear"],
  "admin.createTutee": [],
  "admin.updateTutee": ["id"],
  "admin.assignTuteeToTutor": ["tuteeId", "tutorId"],
  "admin.assignSignup": ["tuteeId", "tutorId"],
  "admin.setTuteeStatus": ["id"],
  "admin.deleteTutee": ["id"],
  "admin.createSubject": [],
  "admin.updateSubject": ["id"],
  "admin.deleteSubject": ["id"],
  "admin.batchUpdateSubjects": ["ids"],
  "admin.importSubjects": [],
  "admin.importCourseGroups": [],
  "admin.createTimeSlot": [],
  "admin.updateTimeSlot": ["id"],
  "admin.deleteTimeSlot": ["id"],
  "admin.createRoom": [],
  "admin.updateRoom": ["id"],
  "admin.deleteRoom": ["id"],
  "admin.createRoomUnavailability": ["roomId"],
  "admin.updateRoomUnavailability": ["id"],
  "admin.deleteRoomUnavailability": ["id"],
  "admin.createMeeting": [],
  "admin.deleteMeeting": ["id"],
  "admin.recordMeetingAttendance": ["meetingId"],
  "admin.createAdjustment": ["tutorId"],
  "admin.deleteAdjustment": ["id"],
  "admin.assignInterviewers": ["applicationId"],
  "admin.correctApplicationIdentity": ["id"],
  "admin.setApplicationStatus": ["id"],
  "admin.deleteApplication": ["id"],
  "admin.decideTutorRequest": ["requestId"],
  "admin.requeueTutorTutees": ["tutorId"],
  "admin.cancelTuteeOptOut": ["requestId"],
  "admin.reinstateTutee": ["requestId"],
  "admin.setCrewStatus": ["userId"],
  "admin.setPatrolOrder": [],
  "admin.decideCrewApplication": ["applicationId"],
  "admin.decideCrewRequest": ["requestId"],
  "admin.decideSessionFlag": ["flagId"],
  "admin.suspendUser": ["userId"],
  "admin.reinstateUser": ["userId"],
  "admin.decideAppeal": ["appealId"],
  "admin.upsertPolicy": ["slug", "locale"],
  "admin.deletePolicyLocale": ["slug", "locale"],
  "admin.createAnnouncement": [],
  "admin.updateAnnouncement": ["id"],
  "admin.deleteAnnouncement": ["id"],
  "admin.reviewCard": ["id"],
  "admin.undoAudit": ["id"],
  "home.createNews": [],
  "home.updateNews": ["id"],
  "home.removeNewsTranslation": ["postId", "locale"],
  "home.deleteNews": ["id"],
  "home.setImageAlt": ["id"],
  "home.createSection": [],
  "home.updateSection": ["id"],
  "home.reorderSections": [],
  "home.removeSectionTranslation": ["sectionId", "locale"],
  "home.deleteSection": ["id"],
  "home.setLayout": ["owner"],
  "home.createPage": [],
  "home.updatePage": ["id"],
  "home.reorderPages": [],
  "home.deletePage": ["id"],
};

const object = (value: unknown): ReviewRecord | undefined =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date)
    ? (value as ReviewRecord)
    : undefined;
const unpack = (value: unknown): ReviewRecord[] =>
  (Array.isArray(value) ? value : [value]).flatMap((value) => {
    const row = object(object(value)?.record ?? value);
    return row ? [row] : [];
  });
const aliases: Record<string, string> = {
  roomOrder: "Room",
  announcementRecipients: "Tutor",
  rooms: "Room",
  programCalendar: "ProgramCalendarDay",
  calendar: "SchoolCalendarDay",
  settings: "StudentSettings",
  programSettings: "ProgramSettings",
  monthlyHoursSchedule: "MonthlyHoursSchedule",
  programFeature: "ProgramFeature",
  languages: "Language",
  term: "Term",
  period: "Term",
  roomBlockContext: "Room",
  catalogue: "Subject",
  levels: "SubjectLevel",
  groups: "CourseGroup",
};
const foreignEntities: Record<string, string> = {
  includeTutorId: "Tutor",
  excludeTutorId: "Tutor",
  userId: "User",
  tutorId: "Tutor",
  tuteeId: "Tutee",
  studentId: "Tutee",
  requestedTutorId: "Tutor",
  requestedByTutorId: "Tutor",
  attendedTutorId: "Tutor",
  crewUserId: "User",
  senderId: "User",
  recipientId: "User",
  headTutorId: "Tutor",
  chairId: "Tutor",
  interviewerId: "Tutor",
  subjectId: "Subject",
  firstChoiceId: "Subject",
  secondChoiceId: "Subject",
  levelId: "SubjectLevel",
  groupId: "CourseGroup",
  timeSlotId: "TimeSlot",
  slotId: "TimeSlot",
  roomId: "Room",
  actualRoomId: "Room",
  termId: "Term",
  intakeTermId: "Term",
  pairingId: "Pairing",
  primaryPairingId: "Pairing",
  sessionId: "Session",
  patrolId: "Patrol",
  applicationId: "TutorApplication",
  crewApplicationId: "CrewApplication",
  meetingId: "TutorMeeting",
  postId: "NewsPost",
  sectionId: "LandingSection",
  pageId: "CustomPage",
  cardId: "DisciplinaryCard",
  appealId: "AccountAppeal",
  flagId: "SessionFlag",
  surveyId: "StudentSurvey",
  legacyTuteeId: "Tutee",
};
const identityFields: Record<string, readonly string[]> = {
  PatrolObservation: ["roomId", "observedAt", "headcount"],
  PairingGroup: ["tutorId", "termId", "primaryPairingId"],
  Pairing: [
    "tutorId",
    "subject",
    "dayOfWeek",
    "startMin",
    "endMin",
    "roomId",
    "roomMode",
    "termId",
  ],
  Session: ["tutorId", "pairingId", "date", "startMin", "endMin"],
  Patrol: ["crewUserId", "createdAt", "hours", "note"],
  TimeSlot: ["dayOfWeek", "startMin", "endMin"],
  Subject: ["levelId"],
  StudentSurvey: ["tuteeId", "state"],
  StudentRequestReview: [
    "surveyId",
    "legacyTuteeId",
    "pairingId",
    "kind",
    "reason",
  ],
  StudentSignupAppeal: ["surveyId", "reason"],
  TutorStatusRequest: ["tutorId", "kind", "reason"],
  CrewStatusRequest: ["userId", "kind", "reason"],
  StudentAppeal: ["studentId", "cardId", "reason"],
  AccountAppeal: ["userId", "reason"],
  TuteeRemovalRequest: ["tuteeId", "kind", "reason", "pairingId"],
  SessionFlag: ["tutorId", "sessionId", "expected", "observed"],
  DisciplinaryCard: ["tuteeId", "kind", "reason", "issuedAt"],
  RoomUnavailability: ["roomId", "dayOfWeek", "startMin", "endMin", "reason"],
  TutorMeeting: ["date", "startMin", "endMin"],
  ServiceHourAdjustment: ["tutorId", "month", "type", "amount", "reason"],
  RegistrationCode: [
    "kind",
    "label",
    "tutorId",
    "applicationId",
    "crewApplicationId",
    "expiresAt",
  ],
  TranslationDraft: ["operation", "state"],
  DirectMessage: ["senderId", "recipientId", "createdAt"],
  AuditLog: ["action", "operation", "entity", "entityId"],
};

/** Resolve only schema-owned joins in immutable targets. A typed entity key
 * prevents same-ID rows in different tables from borrowing one another's name.
 * New reference captures can supply missing FK labels; legacy requests stay
 * visibly incomplete, and conflicting captures never pick an arbitrary name. */
export function approvalReferences(
  operation: string,
  payload: unknown,
  targets: unknown,
) {
  const input = object(payload) ?? {};
  const evidence = object(targets) ?? {};
  const primary =
    operation === "admin.reorderCatalogue" && input.kind === "levels"
      ? "SubjectLevel"
      : APPROVAL_OPERATIONS[operation];
  const index = new Map<string, ReviewRecord[]>();
  const add = (entity: string, value: unknown) => {
    for (const row of unpack(value)) {
      const id = entity === "Language" ? row.code : row.id;
      if (typeof id !== "string") continue;
      const key = `${entity}:${id}`;
      const previous = index.get(key) ?? [];
      previous.push(row);
      index.set(key, previous);
    }
  };
  for (const [table, value] of Object.entries(evidence)) {
    // A child wrapper names its own table, never its parent. Do not recursively
    // search arbitrary nested user-authored payloads for apparent records.
    add(aliases[table] ?? table.split(".").at(-1)!, value);
  }
  const saved = object(evidence.reviewReferences);
  if (saved?.version === 1)
    for (const [entity, values] of Object.entries(object(saved.entities) ?? {}))
      add(entity, values);
  const draft =
    operation === "translationReview.decide"
      ? unpack(evidence.TranslationDraft).find((row) => row.id === input.id)
      : undefined;
  const locale =
    typeof input.locale === "string"
      ? input.locale
      : typeof object(draft?.payload)?.locale === "string"
        ? (object(draft?.payload)?.locale as string)
        : "en";
  const nonblank = (value: unknown): value is string =>
    typeof value === "string" && !!value.trim();
  const contentTitles = (entity: string, id: string) => {
    const child =
      entity === "NewsPost"
        ? "NewsTranslation"
        : entity === "LandingSection"
          ? "LandingSectionTranslation"
          : undefined;
    if (!child) return [];
    const foreignKey = entity === "NewsPost" ? "postId" : "sectionId";
    const translations = [
      ...unpack(evidence[`${entity}.${child}`]),
      ...(saved?.version === 1 ? unpack(object(saved.entities)?.[child]) : []),
    ].filter((row) => row[foreignKey] === id);
    const titles = (language: string) =>
      translations
        .filter((row) => row.locale === language)
        .map((row) => row.title)
        .filter(nonblank);
    const requested = titles(locale);
    return requested.length ? requested : titles("en");
  };
  const byId = (
    entity: string,
    id: string,
    ancestors: ReadonlySet<string>,
  ): ReviewReference => {
    const key = `${entity}:${id}`;
    const candidates = index.get(key) ?? [];
    const available = candidates.length > 0;
    const fields = [
      "englishName",
      "name",
      "title",
      "label",
      "slug",
      "username",
    ];
    const translatedTitles = contentTitles(entity, id);
    const named = translatedTitles.length
      ? translatedTitles
      : candidates.flatMap((row) => {
          const pageTitles =
            entity === "CustomPage" ? object(row.title) : undefined;
          const name = [
            ...(pageTitles ? [pageTitles[locale], pageTitles.en] : []),
            ...fields.map((key) => row[key]),
            ...(entity === "StudentSurvey"
              ? [
                  object(row.currentPayload)?.englishName,
                  object(row.payload)?.englishName,
                ]
              : []),
          ].find(nonblank);
          return name ? [name] : [];
        });
    // name/englishName are alternative schema-owned labels, not values to merge
    // across different versions. Compare each overlapping captured field.
    let ambiguous = new Set(named).size > 1;
    const merged: ReviewRecord = {};
    for (const row of candidates)
      for (const [field, value] of Object.entries(row)) {
        if (
          Object.hasOwn(merged, field) &&
          recordedEvidenceDiff(merged[field], value).size
        )
          ambiguous = true;
        else merged[field] = value;
      }
    const facts: ReviewFact[] = [];
    if (!ambiguous && !ancestors.has(key)) {
      const next = new Set(ancestors).add(key);
      for (const field of identityFields[entity] ?? []) {
        if (!Object.hasOwn(merged, field)) continue;
        const value = merged[field];
        const foreign =
          auditReferenceEntity(entity, field) ?? foreignEntities[field];
        facts.push({
          key: field,
          value:
            foreign && typeof value === "string"
              ? byId(foreign, value, next)
              : value,
        });
      }
      // Names and the exact participant roster together identify a pairing.
      if (entity === "Pairing") {
        const membership =
          evidence["Pairing.PairingTutee"] ??
          (saved?.version === 1
            ? object(saved.entities)?.PairingTutee
            : undefined);
        if (Array.isArray(membership))
          facts.push({
            key: "tuteeIds",
            value: unpack(membership)
              .filter((row) => row.pairingId === id)
              .map((row) =>
                typeof row.tuteeId === "string"
                  ? byId("Tutee", row.tuteeId, next)
                  : row.tuteeId,
              ),
          });
      }
    }
    const result: ReviewReference = {
      kind: "reviewReference",
      entity,
      id,
      ...(named[0] && !ambiguous ? { name: named[0] } : {}),
      state: ambiguous
        ? "ambiguous"
        : named.length || (available && facts.length)
          ? "recorded"
          : "missing",
      facts,
    };
    referenceValues.add(result);
    return result;
  };
  return (
    key: string,
    id: string,
    ownerEntity?: string,
  ): ReviewReference | null => {
    const singular = key.replace(/Ids$/, "Id");
    const owner = ownerEntity
      ? (aliases[ownerEntity] ?? ownerEntity.split(".").at(-1))
      : primary;
    const entity =
      (key === "code" || key === "codes") && owner === "Language"
        ? "Language"
        : key === "id" ||
            key === "ids" ||
            key === "requestId" ||
            (key === "appealId" &&
              [
                "AccountAppeal",
                "StudentAppeal",
                "StudentSignupAppeal",
              ].includes(owner ?? "")) ||
            (key === "applicationId" && owner === "CrewApplication")
          ? owner
          : (auditReferenceEntity(owner, singular) ??
            foreignEntities[singular]);
    return entity ? byId(entity, id, new Set()) : null;
  };
}

export function approvalSummary({
  operation,
  payload,
  facts,
  changes,
  unchanged,
  referenceFor,
}: {
  operation: string;
  payload: unknown;
  facts: ReviewFact[];
  changes: ReviewField[];
  unchanged: ReviewField[];
  referenceFor: ReturnType<typeof approvalReferences>;
}) {
  const input = object(payload) ?? {};
  const known = Object.hasOwn(approvalSummaryContexts, operation);
  const contexts = approvalSummaryContexts[operation] ?? [];
  const contextual = new Set(contexts);
  const summaryFacts = [...facts];
  for (const key of contexts)
    if (
      !summaryFacts.some((fact) => fact.key === key) &&
      Object.hasOwn(input, key)
    )
      summaryFacts.push({ key, value: input[key] });
  // Every changed/requested business value is visible in the collapsed sheet.
  // Contextual identifiers appear once above it, rather than looking like edits.
  const summaryChanges = changes.filter((field) => !contextual.has(field.key));
  const resolve = (key: string, value: unknown): unknown =>
    typeof value === "string"
      ? (referenceFor(key, value) ?? value)
      : Array.isArray(value)
        ? value.map((item) => resolve(key, item))
        : value;
  return {
    known,
    operationKey: operation.replaceAll(".", "_"),
    facts: summaryFacts.map(({ key, value }) => ({
      key,
      value: resolve(key, value),
    })),
    changes: summaryChanges,
    unchangedCount: unchanged.length,
    // Unknown old evidence and action requests cannot establish a no-op.
    noChange: summaryChanges.length === 0 && unchanged.length > 0,
  };
}
