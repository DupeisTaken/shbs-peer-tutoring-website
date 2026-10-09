import { enforceAssignmentQualification } from "./assignment-qualification";
import { createHash } from "node:crypto";
import { TRPCError, type AnyTRPCProcedure } from "@trpc/server";
import type { Session } from "next-auth";
import superjson from "superjson";
import { z } from "zod";
import { Prisma, ProgramFeatureKey } from "../../generated/prisma";
import {
  APPROVAL_OPERATIONS,
  classifyApproval,
  type ApprovalAuthority,
  humanizeOperation,
  proposalConfirmation,
} from "~/lib/approval-policy";
import { validateInterviewDecision } from "./interviews";
import { validateRoomBlockProposal } from "./room-block-proposals";
import { historicalApplyInput, lockHistoricalCorrections, previewHistoricalCorrections, verifyHistoricalPreview } from "./historical-academics";
import { db } from "./db";
import { inTransaction, lockEntity, type TransactionDb } from "./transactions";
import { announcementCandidates } from "./announcement-recipients";
import {
  announcementAudienceSchema,
  selectAnnouncementRecipients,
} from "~/lib/announcement-recipients";

export class ApprovalQueued extends Error {
  constructor(public readonly approvalId: string) {
    super("Submitted for admin approval. No live changes have been applied.");
  }
}

/** A slot's submitted attendance can include merged siblings now linked elsewhere. */
async function slotAttendance(client: TransactionDb, slotId: string) {
  const linked = await client.session.findMany({ where: { timeSlotId: slotId }, select: { id: true, mergeGroupId: true } });
  const blockIds = [...new Set(linked.map((session) => session.mergeGroupId ?? session.id))];
  return blockIds.length ? client.session.findMany({
    where: { OR: [{ id: { in: blockIds } }, { mergeGroupId: { in: blockIds } }] },
    select: { id: true, tutorId: true, startMin: true, endMin: true }, orderBy: { id: "asc" },
  }) : [];
}

/** The live tutor lifecycle is part of authority, not a claim supplied by the requester. */
export async function proposalAuthority(client: TransactionDb, operation: string, value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  // Catalogue restoration includes implicit archived offerings retained by group/level.
  // Lock before reading authority so proposal evidence and application see one catalogue.
  const catalogueOperation = ["admin.updateSubject", "admin.batchUpdateSubjects", "admin.updateSubjectLevel", "admin.saveCourseGroup"].includes(operation);
  if (catalogueOperation) {
    const { lockCatalogue } = await import("./qualifications");
    await lockCatalogue(client);
  }
  let restoresArchivedRecord = false;
  if (operation === "admin.updateSubject" && input.active === true && typeof input.id === "string")
    restoresArchivedRecord = (await client.subject.findUnique({ where: { id: input.id }, select: { active: true } }))?.active === false;
  if (operation === "admin.batchUpdateSubjects" && input.active === true && Array.isArray(input.ids))
    restoresArchivedRecord = await client.subject.count({ where: { id: { in: input.ids as string[] }, active: false } }) > 0;
  if (operation === "admin.updateSubjectLevel" && input.active === true && typeof input.id === "string")
    restoresArchivedRecord = (await client.subjectLevel.findUnique({ where: { id: input.id }, select: { active: true } }))?.active === false;
  if (operation === "admin.saveCourseGroup" && Array.isArray(input.offerings)) {
    const offerings = input.offerings as { subjectId?: string; levelId?: string | null }[];
    const previous = typeof input.id === "string" ? await client.subject.findMany({ where: { groupId: input.id } }) : [];
    const restoredIds = offerings.flatMap((offering) => {
      const id = offering.subjectId ?? previous.find((subject) => subject.levelId === offering.levelId)?.id;
      return id ? [id] : [];
    });
    restoresArchivedRecord = restoredIds.length > 0 && await client.subject.count({ where: { id: { in: restoredIds }, active: false } }) > 0;
  }
  const tutor = operation === "admin.updateTutor" && typeof input.id === "string"
    ? await client.tutor.findUnique({ where: { id: input.id }, select: { status: true } })
    : null;
  const card = operation === "admin.reviewCard" && typeof input.id === "string"
    ? await client.disciplinaryCard.findUnique({ where: { id: input.id }, select: { reviewStatus: true } })
    : null;
  const tuteeId = operation === "admin.assignTuteeToTutor" ? input.tuteeId : operation === "admin.setTuteeStatus" ? input.id : undefined;
  const tutee = typeof tuteeId === "string" ? await client.tutee.findUnique({ where: { id: tuteeId }, select: { status: true } }) : null;
  const news = operation === "home.updateNews" && typeof input.id === "string"
    ? await client.newsPost.findUnique({ where: { id: input.id }, select: { status: true } }) : null;
  const announcement = operation === "admin.updateAnnouncement" && typeof input.id === "string"
    ? await client.announcement.findUnique({ where: { id: input.id }, select: { active: true } }) : null;
  const interview = operation === "interviewManagement.complete" && typeof input.applicationId === "string"
    ? await client.tutorApplication.findUnique({ where: { id: input.applicationId }, select: { interviewCompletedAt: true } }) : null;
  const meetingId = operation === "admin.recordMeetingAttendance" ? input.meetingId : operation === "admin.deleteMeeting" ? input.id : undefined;
  const attendance = typeof meetingId === "string"
    ? await client.meetingAttendance.findMany({ where: { meetingId }, select: { tutorId: true, status: true } }) : [];
  const entries = Array.isArray(input.entries) ? input.entries as { tutorId?: unknown; status?: unknown }[] : [];
  const changesRecordedMeetingAttendance = entries.some((entry) => attendance.some((record) => record.tutorId === entry.tutorId && record.status !== entry.status));
  const slot = operation === "admin.updateTimeSlot" && typeof input.id === "string"
    ? await client.timeSlot.findUnique({ where: { id: input.id }, select: { startMin: true, endMin: true, active: true } }) : null;
  if (slot?.active === false && input.active === true) restoresArchivedRecord = true;
  const changesRecordedSlotAttendance = !!slot && (slot.startMin !== input.startMin || slot.endMin !== input.endMin) &&
    (await slotAttendance(client, String(input.id))).some((session) => session.startMin !== input.startMin || session.endMin !== input.endMin);
  const code = operation === "admin.revokeRegistrationCode" && typeof input.id === "string"
    ? await client.registrationCode.findUnique({ where: { id: input.id }, select: { kind: true } }) : null;
  return classifyApproval(operation, value, { currentTutorStatus: tutor?.status,
    currentCardReviewStatus: card?.reviewStatus, currentTuteeStatus: tutee?.status,
    currentNewsStatus: news?.status, currentAnnouncementActive: announcement?.active,
    interviewCompleted: !!interview?.interviewCompletedAt, changesRecordedMeetingAttendance,
    meetingHasAttendance: attendance.length > 0, changesRecordedSlotAttendance,
    currentRegistrationKind: code?.kind, restoresArchivedRecord });
}

/** Submission and replay both use current authority. An own factual school-departure
 * request is a separate participant workflow, never permission to edit another account. */
export function canRequestProposal(authority: ApprovalAuthority, role: string, userId: string, operation: string, value: unknown, participantSelfService = false) {
  if (authority.requesterRoles.includes(role)) return true;
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (operation === "departure.setState" && input.userId === userId &&
    ["GRADUATED", "TRANSFERRED", "RETURN"].includes(String(input.action))) return true;
  const membership = input.membership as { rank?: unknown } | undefined;
  return participantSelfService && operation === "admin.setMemberships" &&
    !["COORDINATOR", "ADMIN", "HEAD"].includes(role) &&
    input.userId === userId && membership?.rank === "NONE";
}

/** Only registered management mutations may be replayed. Reuse their Zod parsers so
 * invalid input cannot enter the queue and dates/defaults have exactly the usual meaning. */
export async function parseProposal(operation: string, input: unknown) {
  if (!Object.hasOwn(APPROVAL_OPERATIONS, operation))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action requires an administrator.",
    });
  const { appRouter } = await import("./api/root");
  const procedure = (
    appRouter._def.procedures as unknown as Record<string, AnyTRPCProcedure>
  )[operation];
  if (procedure?._def.type !== "mutation")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unknown approval operation.",
    });
  let parsed: unknown = input;
  try {
    for (const parser of procedure._def.inputs) {
      // Head reauthenticates role changes at application. Reuse the actual router schema
      // while excluding its credential field from durable requester evidence.
      const schema = operation === "admin.setUserRole" && parser instanceof z.ZodObject
        ? parser.omit({ confirmPassword: true }) : parser as z.ZodTypeAny;
      parsed = await schema.parseAsync(parsed);
    }
  } catch (cause) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Please check the proposed change.",
      cause,
    });
  }
  const serialized = superjson.serialize(parsed);
  if (JSON.stringify(serialized).length > 128_000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Split this proposal into smaller changes.",
    });
  return serialized as unknown as Prisma.InputJsonValue;
}

const idTables: Record<string, string> = {
  tutorId: "Tutor",
  tuteeId: "Tutee",
  userId: "User",
  roomId: "Room",
  timeSlotId: "TimeSlot",
  pairingId: "Pairing",
  sessionId: "Session",
  patrolId: "Patrol",
  applicationId: "TutorApplication",
  meetingId: "TutorMeeting",
  groupId: "CourseGroup",
  levelId: "SubjectLevel",
  subjectId: "Subject",
  postId: "NewsPost",
  sectionId: "LandingSection",
  pageId: "CustomPage",
  cardId: "DisciplinaryCard",
  appealId: "AccountAppeal",
  flagId: "SessionFlag",
  attendedTutorId: "Tutor",
};

/** Read global authority inputs in the same transaction as the proposed records. */
async function authoritySnapshot(client: TransactionDb) {
  return {
    version: 1,
    programSettings: await client.programSettings.findUnique({ where: { id: "program" } }),
    programFeatures: await client.programFeature.findMany({ orderBy: { key: "asc" } }),
    term: await client.term.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  };
}

/** Read the proposed targets and their related rosters as review evidence. Comparing this
 * snapshot at approval prevents silently applying a proposal after those records change.
 * Table names come exclusively from our fixed policy, never request input. */
export async function proposalTargets(
  client: TransactionDb,
  operation: string,
  payload: unknown,
  includeRoomBlockContext = false,
  includeAuthorityContext = false,
) {
  const input: unknown = superjson.deserialize(
    payload as Parameters<typeof superjson.deserialize>[0],
  );
  const fields = z.record(z.unknown()).parse(input);
  if (operation === "admin.updateTimeSlot" && includeAuthorityContext) {
    const { lockAttendanceSchedule } = await import("./attendance-schedule");
    await lockAttendanceSchedule(client, true);
  }
  if (operation === "messaging.moderate") {
    // Review authority does not grant access to legacy private deliveries. Reject before
    // collecting their sender/recipient metadata, as the live supervision handler does.
    const message = await client.directMessage.findFirst({
      where: { id: z.string().parse(fields.id), supervisable: true }, select: { id: true },
    });
    if (!message) throw new TRPCError({ code: "NOT_FOUND" });
  }
  if (operation === "historicalAcademics.correctBatch") {
    const { ticket, ...proposal } = historicalApplyInput.parse(input);
    verifyHistoricalPreview(proposal, ticket);
    await lockHistoricalCorrections(client, proposal);
    // Save exact named before/after records, original evidence and ownership. Rebuilding
    // this snapshot during approval rejects drift before any correction is appended.
    return JSON.parse(JSON.stringify({
      historicalAcademics: await previewHistoricalCorrections(client, proposal),
      ...(includeAuthorityContext ? { authorityContext: await authoritySnapshot(client) } : {}),
    })) as Record<string, Prisma.InputJsonValue>;
  }
  // A tutor may update intent while a staff proposal is pending. Lock the same
  // compound record as live writes before capturing/rechecking review evidence.
  if (operation === "subjectAvailability.setWillingness") {
    await lockEntity(client, `subject-willingness:${z.string().parse(fields.tutorId)}:${z.string().parse(fields.subjectId)}`);
  }
  const ids = new Map<string, Set<string>>();
  const primary =
    operation === "admin.reorderCatalogue" && fields.kind === "levels"
      ? "SubjectLevel"
      : APPROVAL_OPERATIONS[operation]!;
  const collect = (value: unknown, key = "") => {
    const table =
      key === "id" || key === "ids" || key === "requestId"
        ? primary
        : idTables[key.replace(/Ids$/, "Id")];
    if (typeof value === "string" && table) {
      const set = ids.get(table) ?? new Set<string>();
      set.add(value);
      ids.set(table, set);
    } else if (Array.isArray(value)) value.forEach((v) => collect(v, key));
    else if (value && typeof value === "object" && !(value instanceof Date))
      Object.entries(value).forEach(([k, v]) => collect(v, k));
  };
  collect(input);
  if (operation === "admin.updateTimeSlot" && includeAuthorityContext) {
    const sessions = await slotAttendance(client, z.string().parse(fields.id));
    if (sessions.length) {
      ids.set("Session", new Set(sessions.map((session) => session.id)));
      ids.set("Tutor", new Set(sessions.map((session) => session.tutorId)));
    }
  }
  if (includeAuthorityContext && primary === "TutorApplication" && ids.get("TutorApplication")?.size) {
    const assignments = await client.interviewAssignment.findMany({ where: { applicationId: { in: [...ids.get("TutorApplication")!] } }, select: { tutorId: true } });
    const tutors = ids.get("Tutor") ?? new Set<string>();
    for (const row of assignments) tutors.add(row.tutorId);
    if (tutors.size) ids.set("Tutor", tutors);
  }
  if (includeAuthorityContext && ids.get("TutorMeeting")?.size) {
    const participants = await client.meetingAttendance.findMany({ where: { meetingId: { in: [...ids.get("TutorMeeting")!] } }, select: { tutorId: true } });
    const tutors = ids.get("Tutor") ?? new Set<string>();
    for (const row of participants) tutors.add(row.tutorId);
    if (tutors.size) ids.set("Tutor", tutors);
  }
  if (primary === "TuteeRemovalRequest") {
    const removal = await client.tuteeRemovalRequest.findUnique({ where: { id: z.string().parse(fields.requestId) } });
    if (removal) ids.set("Tutee", new Set([removal.tuteeId]));
  }
  if (primary === "AccountAppeal") {
    const appeal = await client.accountAppeal.findUnique({ where: { id: z.string().parse(fields.appealId) } });
    if (appeal) ids.set("User", new Set([appeal.userId]));
  }
  // Student review decisions depend on the request and its current membership, not just the review row.
  if (primary === "StudentRequestReview") {
    const review = await client.studentRequestReview.findUnique({
      where: { id: z.string().parse(fields.id) },
    });
    if (review?.surveyId) ids.set("StudentSurvey", new Set([review.surveyId]));
    if (review?.pairingId) ids.set("Pairing", new Set([review.pairingId]));
    if (review?.legacyTuteeId)
      ids.set("Tutee", new Set([review.legacyTuteeId]));
  }
  const surveyIds = ids.get("StudentSurvey");
  if (surveyIds?.size) {
    const surveys = await client.studentSurvey.findMany({
      where: { id: { in: [...surveyIds] } },
      select: { tuteeId: true },
    });
    const tutees = ids.get("Tutee") ?? new Set<string>();
    for (const survey of surveys)
      if (survey.tuteeId) tutees.add(survey.tuteeId);
    if (tutees.size) ids.set("Tutee", tutees);
  }
  const targets: Record<string, unknown> = {};
  if (includeAuthorityContext) {
    // A versioned marker lets old immutable requests keep their original fingerprint.
    // Global settings and the complete period matter even for operations with no row ID.
    targets.authorityContext = await authoritySnapshot(client);
  }
  if (primary === "StudentAppeal") {
    const appeal = await client.studentAppeal.findUnique({ where: { id: z.string().parse(fields.id) } });
    if (appeal) {
      ids.set("DisciplinaryCard", new Set([appeal.cardId]));
      ids.set("Tutee", new Set([appeal.studentId]));
    }
  }
  const cards = ids.get("DisciplinaryCard");
  if (cards?.size) {
    const rows = await client.disciplinaryCard.findMany({ where: { id: { in: [...cards] } }, select: { tuteeId: true } });
    const tutees = ids.get("Tutee") ?? new Set<string>();
    for (const row of rows) tutees.add(row.tuteeId);
    ids.set("Tutee", tutees);
  }
  if (primary === "ProgramSettings") targets.programSettings = await client.programSettings.findUnique({ where: { id: "program" } });
  if (primary === "ProgramFeature") targets.programFeature = await client.programFeature.findMany({ where: { key: z.nativeEnum(ProgramFeatureKey).parse(fields.key) } });
  if (primary === "Term") targets.term = await client.term.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  if (operation === "messaging.restrict") targets.restriction = await client.messageRestriction.findUnique({ where: { userId: z.string().parse(fields.userId) } });
  if (primary === "Language") targets.languages = await client.language.findMany({ orderBy: { code: "asc" } });
  if (primary === "MessagePermission") targets.messagePermissions = await client.messagePermission.findMany({ orderBy: { scope: "asc" } });
  if (operation === "departure.setState") targets.departure = await client.schoolDeparture.findUnique({ where: { userId: z.string().parse(fields.userId) } });
  if (operation === "admin.updateAccountAcademics")
    targets.academic = await client.academicProfile.findUnique({ where: { userId: z.string().parse(fields.userId) } });
  // Approval consequences include the complete ordered catalogue and concrete eligibility.
  if (
    operation === "interviewManagement.qualify" ||
    operation === "admin.saveCourseGroup" ||
    operation === "admin.importCourseGroups" ||
    operation === "admin.reorderCatalogue"
  ) {
    targets.catalogue = await client.subject.findMany({
      orderBy: { id: "asc" },
    });
    targets.levels = await client.subjectLevel.findMany({
      orderBy: { id: "asc" },
    });
    targets.groups = await client.courseGroup.findMany({
      orderBy: { id: "asc" },
    });
  }
  // New block edit/removal requests retain a readable room identity. Older
  // immutable requests keep their original evidence shape during replay.
  if (includeRoomBlockContext && primary === "RoomUnavailability") {
    const block =
      typeof fields.id === "string"
        ? await client.roomUnavailability.findUnique({
            where: { id: fields.id },
            select: { roomId: true },
          })
        : null;
    const roomId =
      block?.roomId ??
      (typeof fields.roomId === "string" ? fields.roomId : null);
    targets.roomBlockContext = roomId
      ? await client.room.findUnique({
          where: { id: roomId },
          select: { id: true, name: true },
        })
      : null;
  }
  // Recipient identities/names are review evidence too. A changed filtered audience must
  // be proposed again, rather than silently expanding when an administrator approves it.
  if (operation === "admin.createAnnouncement") {
    const audience = announcementAudienceSchema.parse(fields.audience ?? {});
    targets.announcementRecipients = selectAnnouncementRecipients(
      await announcementCandidates(client),
      audience,
    )
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  if (primary === "SchoolCalendarDay")
    targets.calendar = await client.schoolCalendarDay.findMany({
      where: { date: z.string().parse(fields.date) },
    });
  if (primary === "StudentSettings")
    targets.settings = await client.studentSettings.findMany({
      where: { id: "program" },
    });
  // Review the content a translation decision will publish, including its live destination.
  if (primary === "TranslationDraft") {
    const draft = await client.translationDraft.findUnique({
      where: { id: z.string().parse(fields.id) },
    });
    if (draft)
      targets.destination = await proposalTargets(
        client,
        draft.operation,
        superjson.serialize(draft.payload),
      );
  }
  // Content editors identify rows by compound keys; include missing rows as empty evidence.
  if (primary === "HomeContent")
    targets.content = await client.homeContent.findMany({
      where: { key: z.string().parse(fields.key) },
      orderBy: { locale: "asc" },
    });
  if (primary === "MessageOverride")
    targets.translation = await client.messageOverride.findMany({
      where: {
        key: z.string().parse(fields.key),
        locale: z.string().parse(fields.locale),
      },
      orderBy: { id: "asc" },
    });
  if (primary === "PolicyDocument")
    targets.policy = await client.policyDocument.findMany({
      where: {
        slug: z.string().parse(fields.slug),
        locale: z.string().parse(fields.locale),
      },
      orderBy: { id: "asc" },
    });
  if (primary === "PageLayout")
    targets.layout = await client.pageLayout.findMany({
      where: { ownerKey: z.string().parse(fields.owner) },
    });
  for (const [table, values] of [...ids.entries()].sort()) {
    // User secrets and audit undo payloads are never proposal evidence.
    const fields =
      table === "User"
        ? ["admin.updateAccountProfile", "admin.updateAccountAcademics"].includes(operation)
          ? // Review both explicit links and the current alternative name without exposing credentials.
            "jsonb_build_object('id', t.id, 'name', t.name, 'alternativeNames', t.\"alternativeNames\", 'profileVersion', t.\"profileVersion\", 'role', t.role, 'tutorId', t.\"tutorId\", 'studentId', t.\"studentId\")"
          : "jsonb_build_object('id', t.id, 'name', t.name, 'role', t.role, 'tutorId', t.\"tutorId\", 'tutorAccessRevoked', t.\"tutorAccessRevoked\", 'tuteeMember', t.\"tuteeMember\", 'canTranslate', t.\"canTranslate\", 'crewStatus', t.\"crewStatus\", 'suspendedAt', t.\"suspendedAt\")"
        : table === "DirectMessage"
          ? "to_jsonb(t) - ARRAY['body','clientKey']::text[]"
          : table === "RegistrationCode"
            ? "jsonb_build_object('id', t.id, 'kind', t.kind, 'tutorId', t.\"tutorId\", 'applicationId', t.\"applicationId\", 'crewApplicationId', t.\"crewApplicationId\", 'label', t.label, 'issuedById', t.\"issuedById\", 'issuedByName', t.\"issuedByName\", 'expiresAt', t.\"expiresAt\", 'usedAt', t.\"usedAt\", 'usedByUserId', t.\"usedByUserId\", 'emailVerifiedAt', t.\"emailVerifiedAt\", 'createdAt', t.\"createdAt\")"
          : "to_jsonb(t) - ARRAY['passwordHash','tokenHash','codeHash','undoData','details','data','policySnapshot']::text[]";
    targets[table] = await client.$queryRaw(
      Prisma.sql`SELECT ${Prisma.raw(fields)} AS record FROM ${Prisma.raw('"' + table + '"')} t WHERE t.id IN (${Prisma.join([...values].sort())}) ORDER BY t.id`,
    );
  }
  if (operation === "subjectAvailability.setWillingness") {
    targets.willingness = await client.tutorSubjectWillingness.findUnique({
      where: { tutorId_subjectId: {
        tutorId: z.string().parse(fields.tutorId),
        subjectId: z.string().parse(fields.subjectId),
      } },
    });
  }
  // Child rows can change without touching their parent's updatedAt.
  for (const [parent, child, field] of [
    ["Pairing", "PairingTutee", "pairingId"],
    ["Session", "SessionTutee", "sessionId"],
    ["Session", "SessionFlag", "sessionId"],
    ["Patrol", "PatrolObservation", "patrolId"],
    ["TutorApplication", "InterviewAssignment", "applicationId"],
    ["TutorApplication", "InterviewVote", "applicationId"],
    ["TutorApplication", "ApplicationSubjectIntent", "applicationId"],
    ["Tutor", "TutorQualification", "tutorId"],
    ["Tutor", "QualificationGrant", "tutorId"],
    ["CourseGroup", "Subject", "groupId"],
    ["StudentSurvey", "StudentRequestReview", "surveyId"],
    ["Tutor", "Pairing", "tutorId"],
    ["Tutor", "TutorAvailability", "tutorId"],
    ["Tutor", "ServiceHourAdjustment", "tutorId"],
    ["Tutee", "PairingTutee", "tuteeId"],
    ["Tutee", "TuteeAvailability", "tuteeId"],
    ["Tutee", "TuteeRemovalRequest", "tuteeId"],
    ["Tutee", "DisciplinaryCard", "tuteeId"],
    ["TimeSlot", "Pairing", "timeSlotId"],
    ["Room", "RoomUnavailability", "roomId"],
    ["TutorMeeting", "MeetingAttendance", "meetingId"],
    ["NewsPost", "NewsTranslation", "postId"],
    ["LandingSection", "LandingSectionTranslation", "sectionId"],
  ] as const) {
    if (!includeAuthorityContext && (child === "ServiceHourAdjustment" || child === "TuteeRemovalRequest" || child === "DisciplinaryCard" || child === "SessionFlag")) continue;
    const values = ids.get(parent);
    if (values?.size)
      targets[`${parent}.${child}`] = await client.$queryRaw(
        Prisma.sql`SELECT to_jsonb(t) AS record FROM ${Prisma.raw('"' + child + '"')} t WHERE ${Prisma.raw('"' + field + '"')} IN (${Prisma.join([...values])}) ORDER BY to_jsonb(t)::text`,
      );
  }
  targets.period = await client.term.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, schoolYear: true, quarter: true },
  });
  return JSON.parse(JSON.stringify(targets)) as Record<string, Prisma.InputJsonValue>;
}

export function fingerprint(value: unknown) {
  // JSONB reorders nested object keys. New authority evidence uses a canonical digest;
  // old immutable fingerprints retain their original algorithm and evidence shape.
  const canonical = (item: unknown): unknown => Array.isArray(item)
    ? item.map(canonical) : item && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, next]) => [key, canonical(next)]))
      : item;
  const modern = value && typeof value === "object" && ("authorityContext" in value || "reviewAuthority" in value);
  return createHash("sha256").update(JSON.stringify(modern ? canonical(value) : value)).digest("hex");
}

export async function queueProposal(
  session: Session,
  operation: string,
  input: unknown,
  options: { participantSelfService?: boolean } = {},
) {
  // Identity challenges belong to the acting Head, never to persisted/requester payloads.
  if (operation === "admin.setMemberships") {
    const value = z.object({ userId: z.string(), membership: z.unknown() }).parse(input);
    input = value;
  }
  const payload = await parseProposal(operation, input);
  return inTransaction(db, async (tx) => {
    // Retry/double-click of the same unchanged proposal returns its existing request.
    await lockEntity(
      tx,
      `proposal:${session.user.id}:${operation}:${fingerprint(payload)}`,
    );
    const value: unknown = superjson.deserialize(
      payload as unknown as Parameters<typeof superjson.deserialize>[0],
    );
    if (operation === "admin.updateTimeSlot") {
      // Capture both requested authority and attendance after any in-flight writer
      // has committed, under the same locks that protect the eventual application.
      const { lockAttendanceApproval, lockAttendanceApprovalTarget } = await import("./attendance-approval");
      await lockAttendanceApproval(tx, operation, [session.user.id]);
      await lockAttendanceApprovalTarget(tx, operation, value);
    }
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, username: true, role: true, suspendedAt: true, mergedIntoId: true },
    });
    const authority = await proposalAuthority(tx, operation, value);
    if (!authority || actor.suspendedAt || actor.mergedIntoId ||
        !canRequestProposal(authority, actor.role, session.user.id, operation, value, options.participantSelfService))
      throw new TRPCError({ code: "FORBIDDEN", message: "Your current role cannot submit this change." });
    await validateRoomBlockProposal(tx, operation, value);
    const targets = await proposalTargets(tx, operation, payload, true, true);
    if (targets && typeof targets === "object" && !Array.isArray(targets))
      targets.reviewAuthority = JSON.parse(JSON.stringify(authority)) as Prisma.InputJsonValue;
    if (options.participantSelfService && targets && typeof targets === "object" && !Array.isArray(targets))
      targets.participantSelfService = true;
    const digest = fingerprint(targets);
    const existing = await tx.approvalRequest.findFirst({
      where: {
        requesterId: session.user.id,
        operation,
        payload: { equals: payload },
        fingerprint: digest,
        state: "PENDING",
      },
    });
    if (existing) return existing;
    await enforceAssignmentQualification(tx, session.user.id, operation, value);
    const confirmation = proposalConfirmation(operation, value);
    if (confirmation) {
      const { consumeStudentAction } = await import("./student-workflow");
      const ticket = z.object({ ticket: z.string() }).parse(value).ticket;
      await consumeStudentAction(
        tx,
        ticket,
        session.user.id,
        confirmation.action,
        confirmation.target,
      );
    }
    if (operation === "tutor.decideInterview") {
      const decision = z
        .object({ applicationId: z.string(), accept: z.boolean() })
        .parse(value);
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { tutorId: true },
      });
      const chair = actor.tutorId
        ? await tx.interviewAssignment.findUnique({
            where: {
              applicationId_tutorId: {
                applicationId: decision.applicationId,
                tutorId: actor.tutorId,
              },
            },
          })
        : null;
      if (!chair?.isHead)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only the assigned interview chair can propose its final decision.",
        });
      await validateInterviewDecision(
        tx,
        decision.applicationId,
        decision.accept,
        actor.tutorId,
      );
    }
    const requesterName = actor.name ?? actor.username ?? session.user.id;
    const request = await tx.approvalRequest.create({
      data: {
        requesterId: session.user.id,
        requesterName,
        operation,
        payload,
        targets,
        fingerprint: digest,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        userName: requesterName,
        action: `Requested approval: ${humanizeOperation(operation)}`,
        entity: "ApprovalRequest",
        entityId: request.id,
        kind: "SUBMISSION",
        operation,
        approvalId: request.id,
        details: { outcome: "PENDING", requesterId: session.user.id, requesterRole: actor.role, category: authority.category, before: targets },
      },
    });
    const reviewers = await tx.user.findMany({
      where: { role: { in: [...authority.reviewerRoles] }, suspendedAt: null, mergedIntoId: null },
      select: { id: true },
    });
    await tx.notification.createMany({
      data: reviewers.map((u) => ({
        userId: u.id,
        title: authority.reviewerRoles.length === 1 ? "Management change awaiting Head approval" : "Management change awaiting approval",
        body: `${requesterName}: ${humanizeOperation(operation)}`,
        link: `/admin/approvals?request=${request.id}`,
      })),
    });
    return request;
  });
}
