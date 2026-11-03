import { z } from "zod";
import { lockAccountProfile } from "~/server/account-profile";
import { lockCatalogue } from "~/server/qualifications";
import { lockStudentRequestReview } from "~/server/request-invalidity";
import { currentStudentSignupPayload, studentSignupLocalAnswers } from "~/server/student-signup-answers";
import { assignedSignupSubjects, normalizeStudentSignupAnswers, restoreStudentSignupAnswers, studentSignupAnswersInput } from "~/server/student-signup-editor";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import type { CheckpointAdapter, CheckpointJournalChange } from "../checkpoint-contract";
import { createRecoveryWorkflowDraft } from "../workflow-draft";
import { tuteeCheckpointAdapter } from "./participant";
import { eligibilityBlocker, fieldsOnly, participantIdentity, preservedCheckpointChange } from "./shared";

const savedSchema = z.object({ version: z.literal(1), id: z.string(), intakeTermId: z.string(),
  tuteeId: z.string().nullable(), state: z.string(), bindingHash: z.string().nullable(),
  answers: studentSignupAnswersInput, participant: z.json().nullable() });
async function state(tx: TransactionDb, id: string) {
  const row = await tx.studentSurvey.findUniqueOrThrow({ where: { id } });
  const identity = row.tuteeId ? await participantIdentity(tx, "TUTEE", row.tuteeId) : null;
  const term = await tx.term.findUniqueOrThrow({ where: { id: row.intakeTermId }, select: { id: true, active: true } });
  return { row, identity, term, answers: studentSignupAnswersInput.parse(currentStudentSignupPayload(row)) };
}
function localChange(change: CheckpointJournalChange, sourceId: string, tuteeId: string | null) {
  const key = change.recordKey && typeof change.recordKey === "object" && !Array.isArray(change.recordKey) ? change.recordKey : {};
  if (key.id === sourceId && fieldsOnly(change, "StudentSurvey", ["currentPayload", "currentVersion", "editedAt", "state", "resolvedAt", "firstAssignedAt", "verificationDueAt", "confirmedAt", "publicSignupEmailConfirmedAt", "tokenHash", "verificationAttempts", "emailCodeVersion", "expiresAt", "lastLinkSentAt", "invalidReason", "invalidatedAt", "invalidatedById", "invalidatedByName", "invalidityVersion"])) return true;
  if (change.entity === "StudentSignupRevision" && change.operation === "INSERT" && key.surveyId === sourceId) return true;
  if (key.id === tuteeId && fieldsOnly(change, "Tutee", ["phone", "preferredContact", "firstChoiceId", "secondChoiceId", "updatedAt"])) return true;
  if (change.entity === "TuteeAvailability" && key.tuteeId === tuteeId && ["INSERT", "DELETE"].includes(change.operation)) return true;
  if (change.entity === "StudentRequestReview" && key.surveyId === sourceId && change.operation === "INSERT") return true;
  if (fieldsOnly(change, "StudentRequestReview", ["state", "resolvedAt", "resolvedByUserId"]) && key.surveyId === sourceId) return true;
  if (change.entity === "StudentQuarterBlock" && change.operation === "INSERT" && key.surveyId === sourceId) return true;
  return false;
}
export const studentWorkflowCheckpointAdapter: CheckpointAdapter = {
  id: "STUDENT_WORKFLOW", version: 1, sourceEntity: "StudentSurvey", directRoles: ["ADMIN", "HEAD"],
  async lock(tx, id, raw) {
    await lockCatalogue(tx);
    const current = await state(tx, id);
    await lockStudentRequestReview(tx, current.row);
    if (current.row.tuteeId) {
      const saved = raw ? savedSchema.parse(raw) : null;
      await tuteeCheckpointAdapter.lock(tx, current.row.tuteeId, saved?.participant ?? undefined);
      for (const ownerId of current.identity?.ownerIds ?? []) await lockAccountProfile(tx, ownerId);
    }
    await lockEntity(tx, "signup-fields");
  },
  async capture(tx, id) {
    const current = await state(tx, id);
    const participant = current.row.tuteeId ? await tuteeCheckpointAdapter.capture(tx, current.row.tuteeId) : null;
    return { snapshot: recoveryJson(savedSchema.parse({ version: 1, id, intakeTermId: current.row.intakeTermId,
      tuteeId: current.row.tuteeId, state: current.row.state,
      bindingHash: current.identity ? recoveryHash(current.identity.binding) : null,
      answers: studentSignupLocalAnswers(current.answers), participant: participant?.snapshot ?? null })), scope: participant?.scope ?? [] };
  },
  async inspect(tx, id, raw, context) {
    const saved = savedSchema.parse(raw);
    const current = await state(tx, id);
    const blockers: string[] = [];
    if (saved.id !== id || saved.intakeTermId !== current.row.intakeTermId || saved.tuteeId !== current.row.tuteeId || saved.bindingHash !== (current.identity ? recoveryHash(current.identity.binding) : null))
      blockers.push("Request source, grouping or exact ownership changed.");
    const terminal = current.row.state !== "OPEN" || !current.term.active || (!current.row.confirmedAt && !!current.row.verificationDueAt && current.row.verificationDueAt <= new Date());
    const remaining = context.changes.filter((change) => !localChange(change, id, saved.tuteeId) && !preservedCheckpointChange(change));
    let participantCurrent: unknown = null;
    let normalizationEvidence: unknown = null;
    if (terminal) {
      if (!saved.tuteeId || current.identity?.ownerIds.length !== 1) blockers.push("A fresh request draft requires one exact current or retained owner.");
      if (remaining.some((change) => !["PairingTutee", "Tutee", "TuteeRemovalRequest"].includes(change.entity))) blockers.push("Unsupported request descendants require review before creating an owner draft.");
    } else {
      const assigned = saved.tuteeId ? await assignedSignupSubjects(tx, saved.tuteeId, saved.intakeTermId) : { subjectIds: [], unresolved: false };
      let normalizedPreview: unknown = null;
      const validation = await eligibilityBlocker(async () => {
        normalizedPreview = await normalizeStudentSignupAnswers(tx, saved.answers, assigned.subjectIds, current.answers, "READ_ONLY");
      });
      const subjectIds = [...new Set([saved.answers.firstChoiceId, saved.answers.secondChoiceId,
        current.answers.firstChoiceId, current.answers.secondChoiceId, ...assigned.subjectIds].filter((value): value is string => !!value))];
      const slotIds = [...new Set([...saved.answers.slotIds, ...current.answers.slotIds])];
      const [configuration, subjects, slots, revisions] = await Promise.all([
        tx.programSettings.findUnique({ where: { id: "program" }, select: {
          signupFields: true, nameFields: true, nameFieldsVersion: true, requireLatinNames: true,
          requireLatinLegalNames: true, usePreferredNames: true, showAlternateNames: true,
          offeredGrades: true, updatedAt: true,
        } }),
        tx.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true, active: true, groupId: true, levelId: true }, orderBy: { id: "asc" } }),
        tx.timeSlot.findMany({ where: { id: { in: slotIds } }, select: { id: true, label: true, active: true, dayOfWeek: true, startMin: true, endMin: true }, orderBy: { id: "asc" } }),
        // Catalogue rows have no application revision. PostgreSQL tuple versions
        // invalidate an A→B→A edit without copying private data or taking locks.
        tx.$queryRaw<Array<{ entity: string; id: string; revision: string }>>`
          SELECT 'Subject' AS entity,id,xmin::text AS revision FROM "Subject" WHERE id=ANY(${subjectIds}::text[])
          UNION ALL SELECT 'TimeSlot',id,xmin::text FROM "TimeSlot" WHERE id=ANY(${slotIds}::text[])
          UNION ALL SELECT 'ProgramSettings',id,xmin::text FROM "ProgramSettings" WHERE id='program'
          ORDER BY entity,id`,
      ]);
      normalizationEvidence = { assigned, normalizedPreview, configuration, subjects, slots, revisions };
      if (validation) blockers.push(validation);
      if (current.row.invalidatedAt) blockers.push("Current request invalidity remains in effect; resolve it through its owning workflow.");
      if (saved.tuteeId && saved.participant) {
        const participant = await tuteeCheckpointAdapter.inspect(tx, saved.tuteeId, saved.participant, { ...context, changes: remaining });
        blockers.push(...participant.blockers);
        participantCurrent = participant.current;
      } else if (remaining.length) blockers.push("Unsupported unmaterialized request changes require a separate correction.");
    }
    return { current: recoveryJson({ request: { id, intakeTermId: current.row.intakeTermId, tuteeId: current.row.tuteeId,
      state: current.row.state, currentVersion: current.row.currentVersion, answers: current.answers,
      confirmedAt: current.row.confirmedAt, verificationDueAt: current.row.verificationDueAt, invalidityVersion: current.row.invalidityVersion,
      term: current.term, identity: current.identity }, participant: participantCurrent, normalizationEvidence }), blockers,
      warnings: terminal ? ["Restoration awaits the owner's new submission, current policy agreement and ordinary mailbox verification."] : [],
      effects: terminal ? ["Create a new owner-review draft from captured request-local answers; keep the original request closed."]
        : ["Append a compensating answer revision through current signup validation and restore supported captured assignment memberships."],
      preserved: ["Original signatures, accepted policies, submission priority, proof/deadline state and finalized decisions.", "Current account security, restrictions and ownership."],
      compensatedEventIds: terminal ? [] : context.events.filter((event) => context.changes.some((change) => change.eventId === event.id && !preservedCheckpointChange(change))).map((event) => event.id) };
  },
  async apply(tx, id, raw, actor, _reason, context) {
    const saved = savedSchema.parse(raw);
    const current = await state(tx, id);
    if (current.row.state !== "OPEN" || !current.term.active || (!current.row.confirmedAt && current.row.verificationDueAt && current.row.verificationDueAt <= new Date())) {
      if (!saved.tuteeId) throw new Error("Reviewed owner draft has no exact participant");
      return createRecoveryWorkflowDraft(tx, { actionId: context.actionId, sourceSurveyId: id, sourceTuteeId: saved.tuteeId, answers: saved.answers });
    }
    const revision = await restoreStudentSignupAnswers(tx, actor.id, { id, expectedVersion: current.row.currentVersion, answers: saved.answers }, context.actionId);
    const participant = saved.tuteeId && saved.participant
      ? await tuteeCheckpointAdapter.apply(tx, saved.tuteeId, saved.participant, actor, _reason, context) : null;
    return recoveryJson({ outcome: "APPLIED", sourceSurveyId: id, revision, participant });
  },
};
