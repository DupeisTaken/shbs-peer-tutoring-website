import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { verifyPasswordConfirmation } from "./auth/password-confirmation";
import { lockCatalogue } from "./qualifications";
import { lockSessionPlanning } from "./session-planning";
import { allocateRoom, allocationData } from "./room-allocation";
import { assertTutorScheduleCohortAvailable } from "./tutor-scheduling";
import { pairingEntries } from "~/lib/pairing-groups";
import { executionAssignments, supersededPairingIds } from "./participant-execution";
import { executionSourceIds } from "./participant-execution";
import { syncPunishmentRemoval } from "./discipline/removal";
import { participantSourceRestrictions } from "./participant-source-restrictions";
import { standingFromCounts } from "~/lib/discipline";
import { quarterBlockAccountWhere } from "./history-row-ownership";
import { lockStudentRequestExecution, recordStudentRequestExecution, studentRequestExecutionAssignments } from "./student-request-execution";

const id = z.string().min(1).max(128);
const ids = z.array(id).max(100).refine((rows) => new Set(rows).size === rows.length, "Select distinct sources.");
export const personParticipationSelection = z.object({
  personId: id,
  retainedUserId: id,
  activeTutorId: id.nullable(),
  activeTuteeId: id.nullable(),
  tutorIds: ids.default([]),
  tuteeIds: ids.default([]),
  /** Explicit preference decisions; omitted means keep the active profile's choices. */
  willingnessSourceTutorId: id.optional(),
  availabilitySourceTutorId: id.optional(),
  acknowledgeHistoryAccessCorrection: z.boolean().default(false),
});
export const personParticipationInput = personParticipationSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: z.string().uuid(),
  reason: z.string().trim().min(10).max(1000),
  acknowledged: z.literal(true),
  confirmPassword: z.string().min(1).max(1024),
});
type Selection = z.input<typeof personParticipationSelection>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function conflict(message: string): never { throw new TRPCError({ code: "CONFLICT", message }); }
const resultSchema = z.object({ ok: z.literal(true), receiptId: id, personId: id, retainedUserId: id, tutorId: id.nullable(), tuteeId: id.nullable(), successorPairingIds: z.array(id) });

async function reviewer(db: DomainDb, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || !["ADMIN", "HEAD"].includes(actor.role) || actor.suspendedAt || actor.mergedIntoId || actor.recoveryVoidedAt)
    throw new TRPCError({ code: "FORBIDDEN" });
  return actor;
}

async function plan(db: DomainDb, raw: Selection) {
  const input = personParticipationSelection.parse(raw);
  if (!input.tutorIds.length && !input.tuteeIds.length) conflict("Select at least one participation source to merge.");
  if (!input.tutorIds.length && input.activeTutorId !== null) conflict("A tutor target requires its exact selected source set.");
  if (!input.tuteeIds.length && input.activeTuteeId !== null) conflict("A student target requires its exact selected source set.");
  if (input.tutorIds.length && (!input.activeTutorId || !input.tutorIds.includes(input.activeTutorId))) conflict("Choose the active tutor from the selected sources.");
  if (input.tuteeIds.length && (!input.activeTuteeId || !input.tuteeIds.includes(input.activeTuteeId))) conflict("Choose the active tutee from the selected sources.");
  const [person, users, tutors, tutees, retiredPairings] = await Promise.all([
    db.person.findUnique({ where: { id: input.personId } }),
    db.user.findMany({ where: { personId: input.personId }, include: { schoolDeparture: true, emails: true }, orderBy: { id: "asc" } }),
    db.tutor.findMany({ where: { id: { in: input.tutorIds } }, include: { user: true, retainedOwner: true, availabilities: { include: { slot: true } }, subjectWillingness: true }, orderBy: { id: "asc" } }),
    db.tutee.findMany({ where: { id: { in: input.tuteeIds } }, include: { user: true }, orderBy: { id: "asc" } }),
    supersededPairingIds(db),
  ]);
  if (!person || person.mergedIntoId) conflict("Open the current identity group before reviewing participation.");
  if (tutors.length !== input.tutorIds.length || tutees.length !== input.tuteeIds.length || [...tutors, ...tutees].some((row) => row.personId !== person.id)) conflict("Every participation source must belong to the reviewed identity group.");
  const retained = users.find((row) => row.id === input.retainedUserId);
  if (!retained || retained.mergedIntoId || retained.suspendedAt || retained.recoveryVoidedAt || retained.schoolDeparture?.reason || !retained.emailVerifiedAt || !retained.passwordHash || retained.mustChangePassword) conflict("Choose a current verified participant account with completed credential setup.");
  if (input.activeTutorId && retained.tutorId && !input.tutorIds.includes(retained.tutorId)) conflict("Include the retained account's current tutor profile.");
  if (input.activeTuteeId && retained.studentId && !input.tuteeIds.includes(retained.studentId)) conflict("Include the retained account's current student profile.");
  if (input.activeTutorId && retained.tutorAccessRevoked) conflict("Resolve the retained account's tutor access restriction through its owning workflow.");
  if (input.activeTuteeId && !retained.tuteeMember) conflict("The retained account must explicitly accept student participation before transfer.");
  if (retained.role === "VIEWER") conflict("A read-only account cannot execute participation.");
  for (const source of [...tutors, ...tutees]) {
    const owner = source.user && users.find((row) => row.id === source.user!.id);
    if (source.user && !owner) conflict("A source owner is outside the reviewed group.");
  }
  for (const chosen of [input.willingnessSourceTutorId, input.availabilitySourceTutorId]) if (chosen && !input.tutorIds.includes(chosen)) conflict("Choose preference evidence from the selected tutor sources.");
  const sourceRestrictions = await Promise.all([...input.tutorIds.map((sourceId) => participantSourceRestrictions(db, "TUTOR", sourceId)), ...input.tuteeIds.map((sourceId) => participantSourceRestrictions(db, "TUTEE", sourceId))]);
  const sourceTutors = input.tutorIds.filter((value) => value !== input.activeTutorId);
  const sourceTutees = input.tuteeIds.filter((value) => value !== input.activeTuteeId);
  const cardSources = new Set<string>();
  for (const tuteeId of input.tuteeIds) for (const sourceId of await executionSourceIds(db, "TUTEE", tuteeId)) cardSources.add(sourceId);
  const cards = await db.disciplinaryCard.findMany({ where: { tuteeId: { in: [...cardSources] }, reviewStatus: { in: ["VALID", "PENDING"] } }, select: { id: true, tuteeId: true, color: true, reviewStatus: true }, orderBy: { id: "asc" } });
  const discipline = standingFromCounts({ validYellow: cards.filter((row) => row.color === "YELLOW" && row.reviewStatus === "VALID").length, validRed: cards.filter((row) => row.color === "RED" && row.reviewStatus === "VALID").length, pendingYellow: cards.filter((row) => row.color === "YELLOW" && row.reviewStatus === "PENDING").length, pendingRed: cards.filter((row) => row.color === "RED" && row.reviewStatus === "PENDING").length });
  const initialPairings = await db.pairing.findMany({ where: { id: { notIn: retiredPairings }, term: { active: true }, OR: [{ tutorId: { in: sourceTutors } }, { tutees: { some: { tuteeId: { in: sourceTutees } } } }] }, select: { id: true, groupId: true } });
  // Whole teaching groups move together; partial clones would multiply room reservations.
  const pairings = await db.pairing.findMany({ where: { OR: [{ id: { in: initialPairings.map((row) => row.id) } }, { groupId: { in: initialPairings.flatMap((row) => row.groupId ? [row.groupId] : []) } }] }, include: { tutees: { select: { tuteeId: true }, orderBy: { tuteeId: "asc" } }, group: true }, orderBy: { id: "asc" } });
  const requestExecutions = await db.studentRequestExecutionAssignment.findMany({ where: { pairingId: { in: pairings.map((row) => row.id) } }, orderBy: [{ surveyId: "asc" }, { pairingId: "asc" }] });
  let [planExecutions, participantExecutions, historyAccess] = await Promise.all([
    db.sessionPlanExecution.findMany({ where: { OR: [{ tutorId: { in: input.tutorIds } }, ...pairings.map((row) => ({ assignments: { array_contains: [{ targetPairingId: row.id }] } }))] }, orderBy: { planId: "asc" } }),
    db.sessionParticipantExecution.findMany({ where: { tuteeId: { in: input.tuteeIds } }, orderBy: { participantId: "asc" } }),
    db.historyRowOwnership.findMany({ where: { OR: [{ entity: "Tutor", recordId: { in: input.tutorIds } }, { entity: "Tutee", recordId: { in: input.tuteeIds } }] }, orderBy: [{ entity: "asc" }, { recordId: "asc" }] }),
  ]);
  const mappedParticipants = await db.sessionPlanParticipant.findMany({ where: { id: { in: participantExecutions.filter((row) => input.tuteeIds.includes(row.tuteeId)).map((row) => row.participantId) } }, select: { planId: true } });
  const accessChanges = sourceRestrictions.flatMap((source) => {
    const overlay = historyAccess.find((row) => row.entity === (source.kind === "TUTOR" ? "Tutor" : "Tutee") && row.recordId === source.sourceId);
    const previousReaderUserId = overlay ? overlay.readerUserId : source.retained?.userId ?? source.direct?.id ?? null;
    return previousReaderUserId === retained.id ? [] : [{ kind: source.kind, id: source.sourceId, previousReaderUserId, readerUserId: retained.id, revision: overlay?.revision ?? 0 }];
  });
  const previousReaders = await db.user.findMany({ where: { id: { in: accessChanges.flatMap((row) => row.previousReaderUserId ? [row.previousReaderUserId] : []) } }, orderBy: { id: "asc" } });
  const executionPlanIds = [...new Set([...mappedParticipants.map((row) => row.planId), ...planExecutions.filter((row) => input.tutorIds.includes(row.tutorId) || executionAssignments.parse(row.assignments).some((mapping) => pairings.some((pairing) => pairing.id === mapping.targetPairingId))).map((row) => row.planId)])];
  const activeTerm = await db.term.findFirst({ where: { active: true }, select: { id: true } });
  const learnerOwners = input.tuteeIds.length ? await db.studentProfileOwnership.findMany({ where: { tuteeId: { in: input.tuteeIds } }, select: { userId: true } }) : [];
  const applicableAccounts = input.tuteeIds.length ? [...new Set([retained.id, ...tutees.flatMap((row) => row.user ? [row.user.id] : []), ...learnerOwners.map((row) => row.userId)])] : [];
  const blockAccountPredicates = await Promise.all(applicableAccounts.map((userId) => quarterBlockAccountWhere(db, userId)));
  const exactEmails = input.tuteeIds.length ? [...new Set([...tutees.flatMap((row) => row.email ? [row.email] : []), ...users.filter((row) => applicableAccounts.includes(row.id)).flatMap((row) => [row.email, ...row.emails.filter((email) => email.verifiedAt).map((email) => email.email)])])] : [];
  const [qualifications, grants, mappings, surveys, ownerships, plans, pendingTutor, pendingRemoval, restrictions, continuations] = await Promise.all([
    db.tutorQualification.findMany({ where: { tutorId: { in: input.tutorIds } }, orderBy: [{ tutorId: "asc" }, { subjectId: "asc" }] }),
    db.qualificationGrant.findMany({ where: { tutorId: { in: input.tutorIds }, qualification: { status: "APPROVED" } }, orderBy: [{ tutorId: "asc" }, { sourceSubjectId: "asc" }, { subjectId: "asc" }] }),
    db.participantConsolidation.findMany({ where: { OR: [{ kind: "TUTOR", sourceId: { in: input.tutorIds } }, { kind: "TUTEE", sourceId: { in: input.tuteeIds } }] }, orderBy: [{ kind: "asc" }, { sourceId: "asc" }] }),
    db.studentSurvey.findMany({ where: { OR: [{ tuteeId: { in: [...cardSources, ...pairings.flatMap((row) => row.tutees.map((member) => member.tuteeId))] } }, { id: { in: requestExecutions.map((row) => row.surveyId) } }] }, orderBy: { id: "asc" } }),
    db.studentProfileOwnership.findMany({ where: { tuteeId: { in: input.tuteeIds } }, orderBy: { tuteeId: "asc" } }),
    db.sessionPlan.findMany({ where: { OR: [{ id: { in: executionPlanIds } }, { tutorId: { in: input.tutorIds } }, { participants: { some: { tuteeId: { in: input.tuteeIds } } } }, { assignments: { some: { pairingId: { in: pairings.map((row) => row.id) } } } }], cohorts: { some: { status: "SCHEDULED" } } }, include: { assignments: true, continuationMembers: true, participants: true, cohorts: true, requests: { include: { offers: { include: { responses: true } } } } }, orderBy: { id: "asc" } }),
    db.tutorStatusRequest.findMany({ where: { tutorId: { in: sourceTutors }, state: "PENDING" }, orderBy: { id: "asc" } }),
    db.tuteeRemovalRequest.findMany({ where: { tuteeId: { in: sourceTutees }, state: "PENDING" }, orderBy: { id: "asc" } }),
    activeTerm && input.tuteeIds.length ? db.studentQuarterBlock.findMany({ where: { intakeTermId: activeTerm.id, OR: [{ legacyTuteeId: { in: input.tuteeIds } }, { email: { in: exactEmails } }, ...blockAccountPredicates] }, orderBy: { id: "asc" } }) : Promise.resolve([]),
    db.studentContinuationAssignment.findMany({ where: { OR: [{ tutorId: { in: sourceTutors } }, { tuteeId: { in: sourceTutees } }] }, orderBy: { id: "asc" } }),
  ]);
  [planExecutions, participantExecutions] = await Promise.all([
    db.sessionPlanExecution.findMany({ where: { planId: { in: plans.map((row) => row.id) } }, orderBy: { planId: "asc" } }),
    db.sessionParticipantExecution.findMany({ where: { participantId: { in: plans.flatMap((row) => row.participants.map((participant) => participant.id)) } }, orderBy: { participantId: "asc" } }),
  ]);
  const responseExecutions = await db.sessionResponseExecution.findMany({ where: { responseId: { in: plans.flatMap((row) => row.requests.flatMap((request) => request.offers.flatMap((offer) => offer.responses.map((response) => response.id)))) } }, orderBy: { responseId: "asc" } });
  // Resolve exact request authority before any successor exists. Released maps
  // suppress fallback even if another request retains the canonical roster row.
  const requestAssignments = (await Promise.all(surveys.filter((survey) => survey.state === "OPEN").map((survey) => studentRequestExecutionAssignments(db, survey)))).flat();
  const blockers: { code: "INACTIVE_SOURCE" | "TUTOR_REQUEST" | "TUTEE_REMOVAL_REQUEST" | "STUDENT_QUARTER_BLOCK" | "UNCONFIRMED_SURVEY" | "ALREADY_CONSOLIDATED" | "QUALIFICATION_CONFLICT" | "DUPLICATE_COMMITMENT" | "HISTORY_ACCESS_REVIEW" | "SOURCE_RESTRICTION"; kind: string; id: string; reason: string }[] = [];
  for (const source of sourceRestrictions) for (const restriction of source.blockers) blockers.push({ code: "SOURCE_RESTRICTION", kind: source.kind, id: source.sourceId, reason: `${restriction.reason}: ${restriction.userId}` });
  for (const row of accessChanges) if (!input.acknowledgeHistoryAccessCorrection) blockers.push({ code: "HISTORY_ACCESS_REVIEW", kind: row.kind, id: row.id, reason: "Explicitly acknowledge the displayed history access correction before moving operational ownership." });
  for (const kind of ["TUTOR", "TUTEE"] as const) {
    const targetId = kind === "TUTOR" ? input.activeTutorId : input.activeTuteeId;
    const selected = kind === "TUTOR" ? tutors : tutees;
    for (const row of selected) {
      const previous = mappings.find((mapping) => mapping.kind === kind && mapping.sourceId === row.id && mapping.active);
      const restoring = row.id === targetId && previous && selected.some((candidate) => candidate.id === previous.targetId && candidate.status === "ACTIVE");
      if (row.status !== "ACTIVE" && !restoring) blockers.push({ code: "INACTIVE_SOURCE", kind, id: row.id, reason: "Choose an active source or explicitly restore its prior consolidated source as the active profile." });
    }
  }
  for (const row of pendingTutor) blockers.push({ code: "TUTOR_REQUEST", kind: "TUTOR_REQUEST", id: row.id, reason: "Resolve the original lifecycle request without resetting its cooldown." });
  for (const row of pendingRemoval) blockers.push({ code: "TUTEE_REMOVAL_REQUEST", kind: "TUTEE_REMOVAL_REQUEST", id: row.id, reason: "Resolve the original removal request before changing its execution profile." });
  for (const row of restrictions) blockers.push({ code: "STUDENT_QUARTER_BLOCK", kind: "STUDENT_QUARTER_BLOCK", id: row.id, reason: "A current withdrawal restriction needs its owning workflow review." });
  for (const row of surveys) if (row.tuteeId && cardSources.has(row.tuteeId) && row.state === "OPEN" && !row.confirmedAt) blockers.push({ code: "UNCONFIRMED_SURVEY", kind: "STUDENT_SURVEY", id: row.id, reason: "Complete original mailbox proof; transfer cannot confirm intake." });
  for (const row of mappings.filter((mapping) => mapping.active && mapping.sourceId !== (mapping.kind === "TUTOR" ? input.activeTutorId : input.activeTuteeId))) blockers.push({ code: "ALREADY_CONSOLIDATED", kind: row.kind, id: row.sourceId, reason: "This source already executes through another active profile. Select its current target." });
  for (const qualification of qualifications.filter((row) => sourceTutors.includes(row.tutorId) && row.status === "APPROVED")) {
    const current = qualifications.find((row) => row.tutorId === input.activeTutorId && row.subjectId === qualification.subjectId);
    if (current && current.status !== "APPROVED") blockers.push({ code: "QUALIFICATION_CONFLICT", kind: "QUALIFICATION", id: `${qualification.tutorId}:${qualification.subjectId}`, reason: "An approved source conflicts with the chosen active profile's qualification decision." });
  }
  for (const published of plans) {
    const activeIds = published.participants.filter((row) => row.status === "SCHEDULED").map((row) => { const currentId = participantExecutions.find((mapping) => mapping.participantId === row.id)?.tuteeId ?? row.tuteeId; return sourceTutees.includes(currentId) ? input.activeTuteeId! : currentId; });
    if (new Set(activeIds).size !== activeIds.length) blockers.push({ code: "DUPLICATE_COMMITMENT", kind: "SESSION_PLAN", id: published.id, reason: "Two separate published commitments would become one learner. Resolve their exact commitments before transfer." });
  }
  const commitments = plans.flatMap((published) => {
    const currentTutorId = planExecutions.find((row) => row.planId === published.id)?.tutorId ?? published.tutorId;
    const actorKey = (kind: "TUTOR" | "TUTEE", sourceId: string) => (kind === "TUTOR" ? input.tutorIds : input.tuteeIds).includes(sourceId) ? `USER:${retained.id}` : `${kind}:${sourceId}`;
    const people = new Set([actorKey("TUTOR", currentTutorId), ...published.participants.filter((row) => row.status === "SCHEDULED").map((row) => actorKey("TUTEE", participantExecutions.find((mapping) => mapping.participantId === row.id)?.tuteeId ?? row.tuteeId))]);
    return [...published.cohorts.filter((row) => row.status === "SCHEDULED").map((row) => ({ id: row.id, planId: published.id, startsAt: row.startsAt, endsAt: row.endsAt, people })), ...published.requests.filter((row) => row.status === "PENDING").flatMap((request) => request.offers.filter((offer) => offer.id === request.currentOfferId).map((offer) => ({ id: offer.id, planId: published.id, startsAt: offer.startsAt, endsAt: offer.endsAt, people })))];
  });
  for (let left = 0; left < commitments.length; left++) for (let right = left + 1; right < commitments.length; right++) {
    const a = commitments[left]!, b = commitments[right]!;
    if (a.planId !== b.planId && a.startsAt < b.endsAt && b.startsAt < a.endsAt && [...a.people].some((person) => b.people.has(person))) blockers.push({ code: "DUPLICATE_COMMITMENT", kind: "SESSION_PLAN", id: b.planId, reason: "The selected identity has overlapping published commitments. Resolve the exact schedules through their existing consent workflow." });
  }
  const state = { person, users, tutors, tutees, pairings, qualifications, grants, mappings, surveys, ownerships, plans, pendingTutor, pendingRemoval, restrictions, continuations, planExecutions, participantExecutions, responseExecutions, historyAccess, previousReaders, cards, requestExecutions, requestAssignments, sourceRestrictions };
  return { input, retained, sourceTutors, sourceTutees, ...state, preview: {
    personId: person.id, retainedUserId: retained.id, activeTutorId: input.activeTutorId, activeTuteeId: input.activeTuteeId,
    discipline: { validYellow: discipline.validYellow, validRed: discipline.validRed, willRemove: discipline.removalPending },
    accessChanges,
    sourceRestrictions: sourceRestrictions.filter((source) => source.blockers.length),
    fingerprint: hash({ action: "participation-transfer", input, state }), canTransfer: blockers.length === 0, blockers,
    sources: [...tutors.map((row) => ({ kind: "TUTOR" as const, id: row.id, name: row.englishName })), ...tutees.map((row) => ({ kind: "TUTEE" as const, id: row.id, name: row.englishName }))],
    assignments: pairings.map((row) => ({ id: row.id, tutorId: row.tutorId, tuteeIds: row.tutees.map((item) => item.tuteeId), termId: row.termId, subject: row.subject, dayOfWeek: row.dayOfWeek, startMin: row.startMin, endMin: row.endMin, roomId: row.roomId })),
    publishedWork: plans.map((row) => ({ planId: row.id, originalDate: row.originalDate, cohorts: row.cohorts.map((cohort) => ({ id: cohort.id, status: cohort.status, startsAt: cohort.startsAt })), responses: row.requests.flatMap((request) => request.offers.flatMap((offer) => offer.responses.map((response) => ({ id: response.id, state: response.state, deadline: response.deadline, deliveredAt: response.deliveredAt })))) })),
    preferences: {
      willingnessSourceTutorId: input.willingnessSourceTutorId ?? input.activeTutorId,
      availabilitySourceTutorId: input.availabilitySourceTutorId ?? input.activeTutorId,
      willingness: (tutors.find((row) => row.id === (input.willingnessSourceTutorId ?? input.activeTutorId))?.subjectWillingness ?? []).map((row) => ({ subjectId: row.subjectId, willing: row.willing })),
      availability: (tutors.find((row) => row.id === (input.availabilitySourceTutorId ?? input.activeTutorId))?.availabilities ?? []).map((row) => ({ slotId: row.slotId, dayOfWeek: row.slot.dayOfWeek, startMin: row.slot.startMin, endMin: row.slot.endMin })),
    },
    qualificationTuples: grants.map((row) => ({ tutorId: row.tutorId, sourceSubjectId: row.sourceSubjectId, subjectId: row.subjectId })),
    intake: tutees.map((row) => ({ tuteeId: row.id, intakeTermId: row.intakeTermId, submittedAt: row.signupSubmittedAt, surveys: surveys.filter((survey) => survey.tuteeId === row.id).map((survey) => ({ id: survey.id, intakeTermId: survey.intakeTermId, submittedAt: survey.submittedAt, firstAssignedAt: survey.firstAssignedAt })) })),
  } };
}

export async function previewPersonParticipationTransfer(db: DomainDb, input: Selection) { return (await plan(db, input)).preview; }

export async function personParticipationTransferReceipt(db: DomainDb, actorId: string, operationId: string) {
  await reviewer(db, actorId);
  const row = await db.personParticipationTransferReceipt.findUnique({ where: { id: operationId } });
  return row?.actorId === actorId ? resultSchema.parse(row.result) : null;
}

/** Transfers only reviewed operational execution. Original source profiles,
 * published evidence, signatures, actors and completed attendance are retained. */
export async function transferPersonParticipation(db: DomainDb, actorId: string, raw: z.input<typeof personParticipationInput>) {
  const input = personParticipationInput.parse(raw);
  const { confirmPassword, ...intent } = input;
  const inputHash = hash(intent);
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "program:leadership");
    await lockCatalogue(tx);
    await lockSessionPlanning(tx);
    const saved = await tx.personParticipationTransferReceipt.findUnique({ where: { id: input.operationId } });
    if (saved) {
      await reviewer(tx, actorId);
      if (saved.actorId !== actorId || saved.inputHash !== inputHash) conflict("This operation reference belongs to another reviewed intent.");
      return resultSchema.parse(saved.result);
    }
    const initial = await plan(tx, input);
    for (const userId of [...new Set([actorId, ...initial.users.map((row) => row.id), ...initial.previousReaders.map((row) => row.id), ...initial.sourceRestrictions.flatMap((row) => row.sourceUserIds)])].sort()) await lockEntity(tx, `account-profile:${userId}`);
    await tx.$executeRaw`LOCK TABLE "User", "Tutor", "Tutee", "Person", "StudentProfileOwnership", "TutorProfileOwnership", "Pairing", "PairingTutee", "PairingGroup", "TutorQualification", "QualificationGrant", "StudentSurvey", "TutorStatusRequest", "TuteeRemovalRequest", "StudentQuarterBlock", "ParticipantConsolidation", "PairingExecutionSuccessor", "SessionPlanExecution", "SessionParticipantExecution", "SessionResponseExecution", "HistoryRowOwnership", "StudentRequestExecutionAssignment" IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await reviewer(tx, actorId);
    if (!verifyPasswordConfirmation(actorId, confirmPassword, actor.passwordHash)) throw new TRPCError({ code: "FORBIDDEN", message: "Password is incorrect." });
    const current = await plan(tx, input);
    if (current.preview.fingerprint !== input.fingerprint) conflict("Participation changed. Reload and review the exact transfer again.");
    if (!current.preview.canTransfer) conflict("Resolve the displayed participation decisions before transferring work.");
    const { sourceTutors, sourceTutees, retained, pairings, plans } = current;
    const now = new Date();
    const tutor = (sourceId: string) => sourceTutors.includes(sourceId) ? input.activeTutorId! : sourceId;
    const tutee = (sourceId: string) => sourceTutees.includes(sourceId) ? input.activeTuteeId! : sourceId;
    await lockStudentRequestExecution(tx, [...new Set(pairings.flatMap((row) => row.tutees.map((member) => tutee(member.tuteeId))))]);
    const pairingIds = new Map(pairings.map((row) => [row.id, randomUUID()]));
    const groupIds = new Map(pairings.flatMap((row) => row.groupId ? [row.groupId] : []).map((groupId) => [groupId, randomUUID()]));
    const entries = pairingEntries(pairings);
    const schedules = entries.map((entry) => ({ preservedPlanIds: plans.map((published) => published.id), memberIds: entry.pairings.map((row) => row.id), termId: entry.primary.termId, tutorId: tutor(entry.primary.tutorId), tuteeIds: [...new Set(entry.pairings.flatMap((row) => row.tutees.map((person) => tutee(person.tuteeId))))], dayOfWeek: entry.primary.dayOfWeek, startMin: entry.primary.startMin, endMin: entry.primary.endMin, scheduleConfirmed: entry.primary.scheduleConfirmed }));
    await assertTutorScheduleCohortAvailable(tx, schedules);
    const allocations = new Map<string, Awaited<ReturnType<typeof allocateRoom>>>();
    for (const [index, entry] of entries.entries()) {
      const allocation = await allocateRoom(tx, { ...schedules[index]!, excludePairingIds: pairings.map((row) => row.id) }, { roomMode: entry.primary.roomMode === "LEGACY" ? undefined : entry.primary.roomMode, roomId: entry.primary.roomId }, entry.primary, { preserveLegacy: true });
      for (const row of entry.pairings) allocations.set(row.id, allocation);
    }
    // Copy the approved concrete snapshot, retaining its original reviewer/time.
    // Calling approveQualification here would silently derive new inherited grants.
    for (const row of current.qualifications.filter((qualification) => sourceTutors.includes(qualification.tutorId) && qualification.status === "APPROVED")) {
      await tx.tutorQualification.upsert({ where: { tutorId_subjectId: { tutorId: input.activeTutorId!, subjectId: row.subjectId } }, create: { ...row, tutorId: input.activeTutorId! }, update: {} });
      for (const grant of current.grants.filter((item) => item.tutorId === row.tutorId && item.sourceSubjectId === row.subjectId)) {
        await tx.qualificationGrant.upsert({ where: { tutorId_sourceSubjectId_subjectId: { tutorId: input.activeTutorId!, sourceSubjectId: grant.sourceSubjectId, subjectId: grant.subjectId } }, create: { ...grant, tutorId: input.activeTutorId! }, update: {} });
        const tuple = { targetTutorId: input.activeTutorId!, sourceTutorId: row.tutorId, sourceSubjectId: grant.sourceSubjectId, subjectId: grant.subjectId };
        await tx.qualificationTransferGrant.upsert({ where: { targetTutorId_sourceTutorId_sourceSubjectId_subjectId: tuple }, create: { ...tuple, approvedById: row.approvedById, approvedAt: row.createdAt, grantedAt: grant.grantedAt, receiptId: input.operationId }, update: { active: true, revision: { increment: 1 }, receiptId: input.operationId } });
      }
    }
    if (input.willingnessSourceTutorId && input.willingnessSourceTutorId !== input.activeTutorId) {
      const source = current.tutors.find((row) => row.id === input.willingnessSourceTutorId)!;
      await tx.tutorSubjectWillingness.deleteMany({ where: { tutorId: input.activeTutorId! } });
      await tx.tutorSubjectWillingness.createMany({ data: source.subjectWillingness.map((row) => ({ ...row, tutorId: input.activeTutorId! })) });
    }
    if (input.availabilitySourceTutorId && input.availabilitySourceTutorId !== input.activeTutorId) {
      const source = current.tutors.find((row) => row.id === input.availabilitySourceTutorId)!;
      await tx.tutorAvailability.deleteMany({ where: { tutorId: input.activeTutorId! } });
      await tx.tutorAvailability.createMany({ data: source.availabilities.map((row) => ({ slotId: row.slotId, tutorId: input.activeTutorId! })) });
    }
    for (const assignment of current.requestAssignments) {
      const survey = current.surveys.find((row) => row.id === assignment.surveyId)!;
      await recordStudentRequestExecution(tx, survey, assignment.pairingId, assignment.tuteeId, input.operationId);
    }
    for (const [sourceId, targetId] of groupIds) {
      const group = pairings.find((row) => row.groupId === sourceId)!.group!;
      await tx.pairingGroup.create({ data: { id: targetId, tutorId: tutor(group.tutorId), termId: group.termId, primaryPairingId: pairingIds.get(group.primaryPairingId)! } });
    }
    for (const row of pairings) {
      const { id: sourceId, tutees: roster, group: _group, ...fields } = row;
      void _group;
      const successorId = pairingIds.get(sourceId)!;
      await tx.pairing.create({ data: { ...fields, ...allocationData(allocations.get(sourceId)!), id: successorId, tutorId: tutor(row.tutorId), groupId: row.groupId ? groupIds.get(row.groupId)! : null } });
      // Reviewed source bindings are persisted before physical membership so a
      // canonical profile's closed own request never bypasses the DB guard.
      for (const binding of current.requestAssignments.filter((assignment) => assignment.pairingId === sourceId)) {
        await tx.studentRequestExecutionAssignment.create({ data: { surveyId: binding.surveyId, pairingId: successorId, tuteeId: tutee(binding.tuteeId), sourceTuteeId: binding.sourceTuteeId, receiptId: input.operationId } });
      }
      await tx.pairingTutee.createMany({ data: [...new Set(roster.map((person) => tutee(person.tuteeId)))].map((tuteeId) => ({ pairingId: successorId, tuteeId })) });
      await tx.pairingExecutionSuccessor.create({ data: { sourcePairingId: sourceId, targetPairingId: successorId, receiptId: input.operationId, effectiveAt: now } });
      await tx.studentRequestExecutionAssignment.updateMany({ where: { pairingId: sourceId, releasedAt: null }, data: { releasedAt: now, revision: { increment: 1 } } });
    }
    for (const published of plans) {
      const previousPlan = current.planExecutions.find((row) => row.planId === published.id);
      const previousAssignments = new Map(previousPlan ? executionAssignments.parse(previousPlan.assignments).map((row) => [row.sourcePairingId, row.targetPairingId]) : []);
      const assignments = published.assignments.map((row) => { const currentId = previousAssignments.get(row.pairingId) ?? row.pairingId; return { sourcePairingId: row.pairingId, targetPairingId: pairingIds.get(currentId) ?? currentId }; });
      const executorId = tutor(previousPlan?.tutorId ?? published.tutorId);
      await tx.sessionPlanExecution.upsert({ where: { planId: published.id }, create: { planId: published.id, tutorId: executorId, assignments, receiptId: input.operationId }, update: { tutorId: executorId, assignments, revision: { increment: 1 }, receiptId: input.operationId } });
      for (const participant of published.participants.filter((row) => row.status === "SCHEDULED")) {
        const currentId = current.participantExecutions.find((row) => row.participantId === participant.id)?.tuteeId ?? participant.tuteeId;
        if (input.tuteeIds.includes(currentId)) {
          const originalPairingIds = published.assignments.filter((row) => z.array(z.string()).parse(row.tuteeIds).includes(participant.tuteeId) || published.continuationMembers.some((member) => member.pairingId === row.pairingId && member.tuteeId === participant.tuteeId && !member.releasedAt)).map((row) => previousAssignments.get(row.pairingId) ?? row.pairingId);
          const sourceSurveyIds = [...new Set(current.requestAssignments.filter((binding) => binding.tuteeId === currentId && originalPairingIds.includes(binding.pairingId)).map((binding) => binding.surveyId))].sort();
          await tx.sessionParticipantExecution.upsert({ where: { participantId: participant.id }, create: { participantId: participant.id, tuteeId: tutee(currentId), sourceSurveyIds, receiptId: input.operationId }, update: { tuteeId: tutee(currentId), revision: { increment: 1 }, receiptId: input.operationId } });
        }
      }
      for (const response of published.requests.filter((row) => row.status === "PENDING").flatMap((request) => request.offers.filter((offer) => offer.id === request.currentOfferId).flatMap((offer) => offer.responses))) {
        const previousResponse = current.responseExecutions.find((row) => row.responseId === response.id);
        const [kind, sourceId] = previousResponse ? [previousResponse.profileKind.toLowerCase(), previousResponse.profileId] : response.actorKey.split(":");
        const selected = kind === "tutor" ? input.tutorIds.includes(sourceId!) : kind === "tutee" && input.tuteeIds.includes(sourceId!);
        if (!selected) continue;
        await tx.sessionResponseExecution.upsert({ where: { responseId: response.id }, create: { responseId: response.id, userId: retained.id, profileKind: kind === "tutor" ? "TUTOR" : "TUTEE", profileId: kind === "tutor" ? tutor(sourceId!) : tutee(sourceId!), receiptId: input.operationId }, update: { userId: retained.id, profileId: kind === "tutor" ? tutor(sourceId!) : tutee(sourceId!), revision: { increment: 1 }, receiptId: input.operationId } });
        if (response.state !== "PENDING") continue;
        // Keep transport-admitted/sent evidence. A pending envelope can be replaced,
        // but its response's delivery/deadline clocks are never reset.
        const notices = await tx.sessionNotice.findMany({ where: { responseId: response.id, status: { in: ["PENDING", "BLOCKED", "FAILED"] }, attemptStartedAt: null } });
        for (const notice of notices) {
          await tx.sessionNotice.update({ where: { id: notice.id }, data: { status: "CANCELLED", leaseUntil: null, completedAt: now } });
          await tx.sessionNotice.create({ data: { dedupeKey: `${notice.dedupeKey}:transfer:${input.operationId}`, requestId: notice.requestId, offerId: notice.offerId, responseId: notice.responseId, recipientUserId: retained.id, recipientEmail: retained.email, event: notice.event, context: json(notice.context), priority: notice.priority } });
        }
      }
      await tx.sessionPlanCohort.updateMany({ where: { planId: published.id, status: "SCHEDULED" }, data: { version: { increment: 1 } } });
      await tx.sessionPlanningRequest.updateMany({ where: { planId: published.id, status: { in: ["PENDING", "SPLIT_REQUESTED"] } }, data: { version: { increment: 1 } } });
    }
    // Move only operational pointers. Retained sources preserve private history,
    // while immutable source actor IDs and profile data are never copied/relabelled.
    for (const kind of ["TUTOR", "TUTEE"] as const) {
      const targetId = kind === "TUTOR" ? input.activeTutorId : input.activeTuteeId;
      if (targetId) await tx.participantConsolidation.updateMany({ where: { kind, sourceId: targetId, active: true }, data: { active: false, revision: { increment: 1 }, receiptId: input.operationId, effectiveAt: now } });
      for (const sourceId of kind === "TUTOR" ? sourceTutors : sourceTutees) await tx.participantConsolidation.upsert({ where: { kind_sourceId: { kind, sourceId } }, create: { kind, sourceId, targetId: targetId!, receiptId: input.operationId, effectiveAt: now }, update: { targetId: targetId!, active: true, revision: { increment: 1 }, receiptId: input.operationId, effectiveAt: now } });
    }
    for (const source of current.sourceRestrictions) {
      const entity = source.kind === "TUTOR" ? "Tutor" as const : "Tutee" as const;
      const existing = current.historyAccess.find((row) => row.entity === entity && row.recordId === source.sourceId);
      const activeId = source.kind === "TUTOR" ? input.activeTutorId : input.activeTuteeId;
      const lineage = source.sourceId === activeId ? current.sourceRestrictions.filter((row) => row.kind === source.kind).flatMap((row) => row.sourceUserIds) : source.sourceUserIds;
      const sourceUserIds = [...new Set([...(existing?.sourceUserIds ?? []), ...lineage])].sort();
      await tx.historyRowOwnership.upsert({ where: { entity_recordId: { entity, recordId: source.sourceId } }, create: { entity, recordId: source.sourceId, readerUserId: retained.id, sourceUserIds, quarantineUserIds: [], receiptId: input.operationId }, update: { readerUserId: retained.id, sourceUserIds, revision: { increment: 1 }, receiptId: input.operationId } });
    }
    if (input.activeTutorId) {
      await tx.user.updateMany({ where: { tutorId: { in: input.tutorIds } }, data: { tutorId: null } });
      for (const tutorId of input.tutorIds) await tx.tutorProfileOwnership.upsert({ where: { tutorId }, create: { tutorId, userId: retained.id }, update: { userId: retained.id, revision: { increment: 1 } } });
      await tx.user.update({ where: { id: retained.id }, data: { tutorId: input.activeTutorId } });
      await tx.tutor.update({ where: { id: input.activeTutorId }, data: { status: "ACTIVE" } });
      await tx.tutor.updateMany({ where: { id: { in: sourceTutors } }, data: { status: "ARCHIVED", preferredAssignedBlocks: 0 } });
    }
    if (input.activeTuteeId) {
      await tx.user.updateMany({ where: { studentId: { in: input.tuteeIds } }, data: { studentId: null } });
      for (const tuteeId of input.tuteeIds) await tx.studentProfileOwnership.upsert({ where: { tuteeId }, create: { tuteeId, userId: retained.id }, update: { userId: retained.id, revision: { increment: 1 } } });
      await tx.user.update({ where: { id: retained.id }, data: { studentId: input.activeTuteeId } });
      await tx.tutee.update({ where: { id: input.activeTuteeId }, data: { status: "ACTIVE" } });
      await tx.tutee.updateMany({ where: { id: { in: sourceTutees } }, data: { status: "INACTIVE" } });
      await syncPunishmentRemoval(tx, input.activeTuteeId);
    }
    const affectedUsers = [...new Set([...current.users.map((row) => row.id), ...current.previousReaders.map((row) => row.id)])];
    await tx.user.updateMany({ where: { id: { in: affectedUsers }, mergedIntoId: null }, data: { historyAccessRevision: { increment: 1 } } });
    await tx.sessionCalendarToken.updateMany({ where: { userId: { in: affectedUsers }, revokedAt: null }, data: { revokedAt: now } });
    await tx.person.update({ where: { id: input.personId }, data: { revision: { increment: 1 }, resolutionState: "REVIEW_REQUIRED" } });
    const result = { ok: true as const, receiptId: input.operationId, personId: input.personId, retainedUserId: retained.id, tutorId: input.activeTutorId, tuteeId: input.activeTuteeId, successorPairingIds: [...pairingIds.values()] };
    const subjects = [{ entity: "Person", recordId: input.personId }, ...affectedUsers.map((recordId) => ({ entity: "User", recordId })), ...input.tutorIds.map((recordId) => ({ entity: "Tutor", recordId })), ...input.tuteeIds.map((recordId) => ({ entity: "Tutee", recordId })), ...[...pairingIds.keys(), ...pairingIds.values()].map((recordId) => ({ entity: "Pairing", recordId })), ...plans.map((row) => ({ entity: "SessionPlan", recordId: row.id }))];
    await tx.personParticipationTransferReceipt.create({ data: { id: input.operationId, actorId, inputHash, personId: input.personId, retainedUserId: retained.id, selection: json(current.preview), result, subjects } });
    await tx.auditLog.create({ data: { userId: actorId, userName: actor.name ?? actor.username, operation: "personCombine.transferParticipation", entity: "Person", entityId: input.personId, action: "Transferred reviewed participation execution", details: { receiptId: input.operationId, fingerprint: input.fingerprint, reason: input.reason, subjects } } });
    return result;
  });
}

