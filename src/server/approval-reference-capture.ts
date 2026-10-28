import { Prisma } from "../../generated/prisma";
import { getProgramTimeZone } from "./program/time-zone";
import type { TransactionDb } from "./transactions";
import { APPROVAL_OPERATIONS } from "~/lib/approval-policy";

type Row = Record<string, unknown>;
type ReferenceTable = {
  columns: readonly string[];
  key?: string;
  extra?: Record<string, string>;
};

/** This is a display-only allowlist, separate from authority evidence. Never use
 * broad model serialization here: credentials, contact data, message bodies and
 * private request text are neither labels nor scheduling references. */
const referenceTables: Record<string, ReferenceTable> = {
  User: { columns: ["id", "name", "username", "tutorId", "studentId"] },
  Tutor: { columns: ["id", "englishName", "username"] },
  Tutee: { columns: ["id", "englishName", "firstChoiceId", "secondChoiceId"] },
  Subject: { columns: ["id", "name", "groupId", "levelId"] },
  SubjectLevel: { columns: ["id", "name", "prefix"] },
  CourseGroup: { columns: ["id", "name"] },
  Room: { columns: ["id", "name"] },
  TimeSlot: { columns: ["id", "label", "dayOfWeek", "startMin", "endMin"] },
  Term: { columns: ["id", "name", "schoolYear", "quarter"] },
  Pairing: {
    columns: [
      "id",
      "tutorId",
      "subject",
      "timeSlotId",
      "roomId",
      "roomMode",
      "dayOfWeek",
      "startMin",
      "endMin",
      "termId",
      "groupId",
    ],
  },
  PairingGroup: { columns: ["id", "tutorId", "termId", "primaryPairingId"] },
  Session: {
    columns: [
      "id",
      "tutorId",
      "pairingId",
      "date",
      "startMin",
      "endMin",
      "timeSlotId",
      "actualRoomId",
      "online",
      "mergeGroupId",
      "schoolYear",
      "quarter",
    ],
  },
  Patrol: { columns: ["id", "crewUserId", "termId", "createdAt"] },
  TutorMeeting: { columns: ["id", "title", "date", "termId"] },
  TutorApplication: {
    columns: [
      "id",
      "name",
      "requestedTutorId",
      "requestedSubjectId",
      "promotedTutorId",
      "interviewAt",
    ],
  },
  CrewApplication: { columns: ["id", "name"] },
  TutorStatusRequest: { columns: ["id", "tutorId", "kind"] },
  CrewStatusRequest: { columns: ["id", "userId", "kind"] },
  TuteeRemovalRequest: {
    columns: ["id", "tuteeId", "pairingId", "requestedByTutorId", "kind"],
  },
  StudentRequestReview: {
    columns: ["id", "surveyId", "legacyTuteeId", "pairingId", "kind"],
  },
  StudentSurvey: {
    columns: ["id", "tuteeId", "intakeTermId"],
    extra: {
      name: "coalesce(t.\"currentPayload\", t.payload)->>'englishName'",
      firstName: "coalesce(t.\"currentPayload\", t.payload)->>'firstName'",
      lastName: "coalesce(t.\"currentPayload\", t.payload)->>'lastName'",
    },
  },
  StudentSignupAppeal: { columns: ["id", "surveyId"] },
  StudentAppeal: { columns: ["id", "studentId", "cardId"] },
  AccountAppeal: { columns: ["id", "userId"] },
  SessionFlag: { columns: ["id", "sessionId", "tutorId"] },
  DisciplinaryCard: {
    columns: ["id", "tuteeId", "issuedByTutorId", "sessionId", "color"],
  },
  ServiceHourAdjustment: {
    columns: ["id", "tutorId", "month", "schoolYear", "quarter"],
  },
  RegistrationCode: {
    columns: [
      "id",
      "label",
      "kind",
      "tutorId",
      "applicationId",
      "crewApplicationId",
    ],
  },
  DirectMessage: { columns: ["id", "senderId", "recipientId", "createdAt"] },
  Announcement: { columns: ["id", "title"] },
  HomeImage: { columns: ["id", "alt"] },
  CustomPage: { columns: ["id", "slug", "title"] },
  NewsPost: { columns: ["id"] },
  NewsTranslation: { columns: ["id", "postId", "locale", "title"] },
  LandingSection: { columns: ["id", "slug"] },
  LandingSectionTranslation: {
    columns: ["id", "sectionId", "locale", "title"],
  },
  PolicyDocument: { columns: ["id", "slug", "locale", "title"] },
  Language: { key: "code", columns: ["code", "label"] },
  AuditLog: {
    columns: ["id", "action", "entity", "entityId", "operation", "createdAt"],
  },
};

// Only actual model relationships are traversed. Arbitrary JSON, user-authored
// strings, undo instructions and similarly named IDs are not a graph schema.
const relations: Record<string, Record<string, string>> = {
  User: { tutorId: "Tutor", studentId: "Tutee" },
  Tutee: { firstChoiceId: "Subject", secondChoiceId: "Subject" },
  Subject: { levelId: "SubjectLevel", groupId: "CourseGroup" },
  Pairing: {
    tutorId: "Tutor",
    roomId: "Room",
    timeSlotId: "TimeSlot",
    termId: "Term",
    groupId: "PairingGroup",
  },
  PairingGroup: {
    tutorId: "Tutor",
    termId: "Term",
    primaryPairingId: "Pairing",
  },
  PairingTutee: { pairingId: "Pairing", tuteeId: "Tutee" },
  Session: {
    tutorId: "Tutor",
    pairingId: "Pairing",
    actualRoomId: "Room",
    timeSlotId: "TimeSlot",
    mergeGroupId: "Session",
  },
  SessionTutee: { sessionId: "Session", tuteeId: "Tutee" },
  SessionFlag: { sessionId: "Session", tutorId: "Tutor" },
  Patrol: { crewUserId: "User", termId: "Term" },
  PatrolObservation: { patrolId: "Patrol", roomId: "Room" },
  TutorMeeting: { termId: "Term" },
  MeetingAttendance: { meetingId: "TutorMeeting", tutorId: "Tutor" },
  TutorApplication: {
    requestedTutorId: "Tutor",
    requestedSubjectId: "Subject",
    promotedTutorId: "Tutor",
  },
  InterviewAssignment: { applicationId: "TutorApplication", tutorId: "Tutor" },
  InterviewVote: { applicationId: "TutorApplication", tutorId: "Tutor" },
  ApplicationSubjectIntent: {
    applicationId: "TutorApplication",
    subjectId: "Subject",
  },
  TutorQualification: { tutorId: "Tutor", subjectId: "Subject" },
  QualificationGrant: {
    tutorId: "Tutor",
    sourceSubjectId: "Subject",
    subjectId: "Subject",
  },
  TutorStatusRequest: { tutorId: "Tutor" },
  CrewStatusRequest: { userId: "User" },
  TuteeRemovalRequest: {
    tuteeId: "Tutee",
    pairingId: "Pairing",
    requestedByTutorId: "Tutor",
  },
  StudentRequestReview: {
    surveyId: "StudentSurvey",
    legacyTuteeId: "Tutee",
    pairingId: "Pairing",
  },
  StudentSurvey: { tuteeId: "Tutee", intakeTermId: "Term" },
  StudentSignupAppeal: { surveyId: "StudentSurvey" },
  StudentAppeal: { studentId: "Tutee", cardId: "DisciplinaryCard" },
  AccountAppeal: { userId: "User" },
  DisciplinaryCard: {
    tuteeId: "Tutee",
    issuedByTutorId: "Tutor",
    sessionId: "Session",
  },
  ServiceHourAdjustment: { tutorId: "Tutor" },
  RegistrationCode: {
    tutorId: "Tutor",
    applicationId: "TutorApplication",
    crewApplicationId: "CrewApplication",
  },
  DirectMessage: { senderId: "User", recipientId: "User" },
  RoomUnavailability: { roomId: "Room" },
  TutorAvailability: { tutorId: "Tutor", slotId: "TimeSlot" },
  TuteeAvailability: { tuteeId: "Tutee", slotId: "TimeSlot" },
  NewsTranslation: { postId: "NewsPost" },
  LandingSectionTranslation: { sectionId: "LandingSection" },
};
const aliases: Record<string, string> = {
  term: "Term",
  period: "Term",
  catalogue: "Subject",
  levels: "SubjectLevel",
  groups: "CourseGroup",
  roomOrder: "Room",
  roomBlockContext: "Room",
  languages: "Language",
  policy: "PolicyDocument",
  announcementRecipients: "Tutor",
};
const referenceChildren: Record<
  string,
  { table: string; parentKey: string; columns: string[] }
> = {
  Pairing: {
    table: "PairingTutee",
    parentKey: "pairingId",
    columns: ["pairingId", "tuteeId"],
  },
  Session: {
    table: "SessionTutee",
    parentKey: "sessionId",
    columns: ["sessionId", "tuteeId"],
  },
  NewsPost: {
    table: "NewsTranslation",
    parentKey: "postId",
    columns: ["id", "postId", "locale", "title"],
  },
  LandingSection: {
    table: "LandingSectionTranslation",
    parentKey: "sectionId",
    columns: ["id", "sectionId", "locale", "title"],
  },
};
const requestedRelations: Record<string, string> = {
  tutorId: "Tutor",
  headTutorId: "Tutor",
  attendedTutorId: "Tutor",
  includeTutorId: "Tutor",
  excludeTutorId: "Tutor",
  tuteeId: "Tutee",
  userId: "User",
  studentId: "Tutee",
  roomId: "Room",
  actualRoomId: "Room",
  timeSlotId: "TimeSlot",
  slotId: "TimeSlot",
  pairingId: "Pairing",
  sessionId: "Session",
  patrolId: "Patrol",
  applicationId: "TutorApplication",
  crewApplicationId: "CrewApplication",
  meetingId: "TutorMeeting",
  groupId: "CourseGroup",
  levelId: "SubjectLevel",
  subjectId: "Subject",
  firstChoiceId: "Subject",
  secondChoiceId: "Subject",
  postId: "NewsPost",
  sectionId: "LandingSection",
  pageId: "CustomPage",
  cardId: "DisciplinaryCard",
  appealId: "AccountAppeal",
  flagId: "SessionFlag",
  termId: "Term",
  intakeTermId: "Term",
};
// These containers are validated domain structures, unlike arbitrary layout,
// content, policy or user-authored JSON. Only their declared FK names are read.
const requestedContainers: Record<string, readonly string[]> = {
  "studentWorkflow.assign": ["assignments"],
  "studentWorkflow.headEditSignup": ["answers"],
  "admin.assignSignup": ["assignments"],
  "admin.recordMeetingAttendance": ["entries"],
  "corrections.correctAttendance": ["tutees"],
  "corrections.correctPatrol": ["observations"],
  "admin.autoAssignUnassignedRooms": ["targets"],
  "admin.saveCourseGroup": ["offerings"],
  "admin.importSubjects": ["rows"],
  "admin.importCourseGroups": ["groups", "rows", "offerings"],
  "admin.createAnnouncement": ["audience"],
  "admin.updateAnnouncement": ["audience"],
};
const row = (value: unknown): Row | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
const rows = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).flatMap((value) => {
    const record = row(row(value)?.record ?? value);
    return record ? [record] : [];
  });

/** Follow only requested/captured relationships, including removed participants
 * and replaced references. The result is immutable evidence and is fingerprinted:
 * a changed saved label requires a fresh review, just like other captured facts. */
export async function captureReviewReferences(
  client: TransactionDb,
  operation: string,
  input: Row,
  targets: Row,
) {
  const wanted = new Map<string, Set<string>>();
  const visited = new Map<string, Set<string>>();
  const entities: Record<string, Row[]> = {};
  const add = (table: string, value: unknown) => {
    if (
      !Object.hasOwn(referenceTables, table) ||
      typeof value !== "string" ||
      !value
    )
      return;
    const ids = wanted.get(table) ?? new Set<string>();
    ids.add(value);
    wanted.set(table, ids);
  };
  const inspect = (table: string, record: Row) => {
    add(table, record[referenceTables[table]?.key ?? "id"]);
    for (const [field, destination] of Object.entries(relations[table] ?? {}))
      add(destination, record[field]);
    // An audit row's fixed entity name can identify a safe display descriptor;
    // neither its details nor its executable undo payload is traversed.
    if (table === "AuditLog" && typeof record.entity === "string")
      add(record.entity, record.entityId);
  };
  const inspectEvidence = (evidence: Row) => {
    for (const [key, value] of Object.entries(evidence)) {
      if (key === "destination") {
        const destination = row(value);
        if (destination) inspectEvidence(destination);
        continue;
      }
      if (key === "authorityContext") {
        const context = row(value);
        for (const term of rows(context?.term)) inspect("Term", term);
        continue;
      }
      const table = aliases[key] ?? key.split(".").at(-1)!;
      if (referenceTables[table] || relations[table])
        for (const record of rows(value)) inspect(table, record);
    }
  };
  const primary =
    operation === "admin.reorderCatalogue" && input.kind === "levels"
      ? "SubjectLevel"
      : APPROVAL_OPERATIONS[operation];
  const automaticRoomIntent =
    [
      "admin.createPairing",
      "admin.updatePairing",
      "admin.setPairingRoom",
    ].includes(operation) && input.roomMode === "AUTO";
  const inspectInput = (value: unknown, root = false) => {
    for (const inputRow of rows(value)) {
      for (const [key, value] of Object.entries(inputRow)) {
        // Automatic allocation approves intent, not an ignored room candidate.
        // The old room still enters through the saved Pairing relationship.
        if (root && automaticRoomIntent && key === "roomId") continue;
        const singular = key.replace(/Ids$/, "Id");
        const destination =
          operation === "admin.decideCrewApplication" &&
          singular === "applicationId"
            ? "CrewApplication"
            : requestedRelations[singular];
        if (destination) {
          for (const id of Array.isArray(value) ? value : [value])
            add(destination, id);
        } else if (
          ((root && ["id", "ids", "requestId"].includes(key)) ||
            (operation === "admin.autoAssignUnassignedRooms" &&
              key === "id")) &&
          primary
        ) {
          for (const id of Array.isArray(value) ? value : [value])
            add(primary, id);
        } else if ((requestedContainers[operation] ?? []).includes(key)) {
          inspectInput(value);
        }
      }
    }
  };
  inspectInput(input, true);
  inspectEvidence(targets);
  for (;;) {
    let read = false;
    for (const [table, ids] of [...wanted].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const seen = visited.get(table) ?? new Set<string>();
      const pending = [...ids].filter((id) => !seen.has(id)).sort();
      if (!pending.length) continue;
      read = true;
      pending.forEach((id) => seen.add(id));
      visited.set(table, seen);
      const config = referenceTables[table]!;
      const fields = [
        ...config.columns.flatMap((field) => [`'${field}'`, `t."${field}"`]),
        ...Object.entries(config.extra ?? {}).flatMap(([field, expression]) => [
          `'${field}'`,
          expression,
        ]),
      ];
      // Keep parameter counts bounded without scanning unrelated model rows.
      for (let start = 0; start < pending.length; start += 500) {
        const captured = await client.$queryRaw<{ record: Row }[]>(Prisma.sql`
          SELECT ${Prisma.raw(`jsonb_build_object(${fields.join(", ")})`)} AS record
          FROM ${Prisma.raw(`"${table}"`)} t
          WHERE ${Prisma.raw(`t."${config.key ?? "id"}"`)} IN (${Prisma.join(pending.slice(start, start + 500))})
          ORDER BY ${Prisma.raw(`t."${config.key ?? "id"}"`)}
        `);
        entities[table] = [
          ...(entities[table] ?? []),
          ...captured.map(({ record }) => record),
        ];
        captured.forEach(({ record }) => inspect(table, record));
        if (table === "Session" && captured.length) {
          // A flag or sibling ID may enter the graph before the primary block.
          // Follow only that exact block, never the tutor's unrelated attendance.
          const siblings = await client.session.findMany({
            where: {
              mergeGroupId: {
                in: captured.map(({ record }) => String(record.id)),
              },
            },
            select: { id: true },
          });
          siblings.forEach((sibling) => add("Session", sibling.id));
        }
        const child = referenceChildren[table];
        if (child && captured.length) {
          const projection = child.columns
            .flatMap((field) => [`'${field}'`, `t."${field}"`])
            .join(", ");
          const children = await client.$queryRaw<{ record: Row }[]>(Prisma.sql`
            SELECT ${Prisma.raw(`jsonb_build_object(${projection})`)} AS record
            FROM ${Prisma.raw(`"${child.table}"`)} t
            WHERE ${Prisma.raw(`t."${child.parentKey}"`)} IN (${Prisma.join(captured.map(({ record }) => String(record.id)))})
          `);
          entities[child.table] = [
            ...(entities[child.table] ?? []),
            ...children.map(({ record }) => record),
          ];
          // Child display rows are already selected safely; mark their IDs read
          // so the direct-ID discovery path cannot duplicate localized titles.
          const childSeen = visited.get(child.table) ?? new Set<string>();
          for (const { record } of children) {
            if (typeof record.id === "string") childSeen.add(record.id);
            inspect(child.table, record);
          }
          visited.set(child.table, childSeen);
        }
      }
    }
    if (!read) break;
  }
  return JSON.parse(
    JSON.stringify({
      version: 1,
      timeZone: await getProgramTimeZone(client),
      entities: Object.fromEntries(
        Object.entries(entities)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([table, records]) => [
            table,
            [
              ...new Map(
                records.map((record) => [JSON.stringify(record), record]),
              ).values(),
            ].sort((a, b) =>
              JSON.stringify(a).localeCompare(JSON.stringify(b)),
            ),
          ]),
      ),
    }),
  ) as Prisma.InputJsonValue;
}
