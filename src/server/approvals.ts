import { createHash } from "node:crypto";
import { TRPCError, type AnyTRPCProcedure } from "@trpc/server";
import type { Session } from "next-auth";
import superjson from "superjson";
import { z } from "zod";
import { Prisma } from "../../generated/prisma";
import {
  APPROVAL_OPERATIONS,
  humanizeOperation,
  proposalConfirmation,
} from "~/lib/approval-policy";
import { validateInterviewDecision } from "./interviews";
import { db } from "./db";
import { inTransaction, lockEntity, type TransactionDb } from "./transactions";

export class ApprovalQueued extends Error {
  constructor(public readonly approvalId: string) {
    super("Submitted for admin approval. No live changes have been applied.");
  }
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
      parsed = await (parser as z.ZodTypeAny).parseAsync(parsed);
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
  levelId: "SubjectLevel",
  subjectId: "Subject",
  postId: "NewsPost",
  sectionId: "LandingSection",
  pageId: "CustomPage",
  cardId: "DisciplinaryCard",
};

/** Read the proposed targets and their related rosters as review evidence. Comparing this
 * snapshot at approval prevents silently applying a proposal after those records change.
 * Table names come exclusively from our fixed policy, never request input. */
export async function proposalTargets(
  client: TransactionDb,
  operation: string,
  payload: unknown,
) {
  const input: unknown = superjson.deserialize(
    payload as Parameters<typeof superjson.deserialize>[0],
  );
  const fields = z.record(z.unknown()).parse(input);
  const ids = new Map<string, Set<string>>();
  const primary = APPROVAL_OPERATIONS[operation]!;
  const collect = (value: unknown, key = "") => {
    const table =
      key === "id" || key === "ids"
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
        ? "jsonb_build_object('id', t.id, 'name', t.name, 'role', t.role, 'tutorId', t.\"tutorId\", 'crewStatus', t.\"crewStatus\", 'suspendedAt', t.\"suspendedAt\")"
        : "to_jsonb(t) - ARRAY['passwordHash','tokenHash','codeHash','undoData','details','data','policySnapshot']::text[]";
    targets[table] = await client.$queryRaw(
      Prisma.sql`SELECT ${Prisma.raw(fields)} AS record FROM ${Prisma.raw('"' + table + '"')} t WHERE t.id IN (${Prisma.join([...values].sort())}) ORDER BY t.id`,
    );
  }
  // Child rows can change without touching their parent's updatedAt.
  for (const [parent, child, field] of [
    ["Pairing", "PairingTutee", "pairingId"],
    ["Session", "SessionTutee", "sessionId"],
    ["Patrol", "PatrolObservation", "patrolId"],
    ["TutorApplication", "InterviewAssignment", "applicationId"],
    ["TutorApplication", "InterviewVote", "applicationId"],
    ["TutorApplication", "ApplicationSubjectIntent", "applicationId"],
    ["Tutor", "TutorQualification", "tutorId"],
    ["StudentSurvey", "StudentRequestReview", "surveyId"],
    ["Tutor", "Pairing", "tutorId"],
    ["Tutor", "TutorAvailability", "tutorId"],
    ["Tutee", "PairingTutee", "tuteeId"],
    ["Tutee", "TuteeAvailability", "tuteeId"],
    ["TimeSlot", "Pairing", "timeSlotId"],
    ["Room", "RoomUnavailability", "roomId"],
    ["TutorMeeting", "MeetingAttendance", "meetingId"],
    ["NewsPost", "NewsTranslation", "postId"],
    ["LandingSection", "LandingSectionTranslation", "sectionId"],
  ] as const) {
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
  return JSON.parse(JSON.stringify(targets)) as Prisma.InputJsonValue;
}

export function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function queueProposal(
  session: Session,
  operation: string,
  input: unknown,
) {
  const payload = await parseProposal(operation, input);
  return inTransaction(db, async (tx) => {
    // Retry/double-click of the same unchanged proposal returns its existing request.
    await lockEntity(
      tx,
      `proposal:${session.user.id}:${operation}:${fingerprint(payload)}`,
    );
    const targets = await proposalTargets(tx, operation, payload);
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
    const value = superjson.deserialize(
      payload as unknown as Parameters<typeof superjson.deserialize>[0],
    );
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
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, username: true },
    });
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
      },
    });
    const reviewers = await tx.user.findMany({
      where: { role: { in: ["HEAD", "ADMIN"] }, suspendedAt: null },
      select: { id: true },
    });
    await tx.notification.createMany({
      data: reviewers.map((u) => ({
        userId: u.id,
        title: "Coordinator change awaiting approval",
        body: `${requesterName}: ${humanizeOperation(operation)}`,
        link: `/admin/approvals?request=${request.id}`,
      })),
    });
    return request;
  });
}
