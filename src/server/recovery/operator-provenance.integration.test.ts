import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { recordCsv } from "~/lib/record-transfer";
import { propagateSlotAttendance } from "~/server/attendance-schedule";
import { reconsiderSessionFlag, syncSessionFlag } from "~/server/crew/flags";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import {
  assertMutableProgramRecords,
  importedRecordKey,
} from "~/server/imported-records";
import {
  clearInterviewHours,
  writeInterviewCompletion,
} from "~/server/interview-hours";
import { reconcileMeetingHours } from "~/server/meeting-hours";
import {
  generateSchoolHours,
  previewSchoolHours,
  reviewSchoolHoursBaseline,
  saveSchoolHoursSettings,
  schoolHoursBaselinePreview,
} from "~/server/school-hours";
import { reconcileApplication } from "~/server/tutors/application-status";
import { promoteApplicantToTutor } from "~/server/tutors/promote";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  captureRecoveryCheckpoint,
  inspectRecoveryCheckpoint,
} from "./checkpoint";
import { planHash } from "./operator-plan";
import {
  applyArchiveProvenanceFromOperator,
  extractProvenanceCandidatesFromFiles,
  previewArchiveProvenance,
  readArchiveProvenanceReceipt,
  type ProvenanceCandidateFile,
} from "./operator-provenance";

vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: () => true,
}));

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

const ROLLBACK = "rollback synthetic archive provenance fixture";

async function withRolledBackFixture(
  work: (tx: TransactionDb, prefix: string, actorId: string) => Promise<void>,
) {
  await expect(
    db.$transaction(
      async (tx) => {
        const prefix = `prov-${randomUUID().slice(0, 8)}-`;
        const actor = await tx.user.create({
          data: {
            id: `${prefix}head`,
            role: "HEAD",
            email: `${prefix}head@example.test`,
            name: "Synthetic Head",
          },
        });
        await work(tx, prefix, actor.id);
        throw new Error(ROLLBACK);
      },
      { timeout: 40_000 },
    ),
  ).rejects.toThrow(ROLLBACK);
}

describe("archive provenance reconciliation integration", () => {
  it("enforces typed recovery references for composite and scalar provenance changes, receipt immutability, and checkpoint coverage", async () => {
    await withRolledBackFixture(async (tx, prefix, actorId) => {
      const term = await tx.term.create({
        data: {
          id: `${prefix}old-term`,
          name: "Synthetic Past Term",
          schoolYear: "2023-2024",
          quarter: "Q1",
          active: false,
        },
      });
      const tutor = await tx.tutor.create({
        data: {
          id: `${prefix}tutor`,
          englishName: "Past Tutor",
          status: "GRADUATED",
        },
      });
      const tutee = await tx.tutee.create({
        data: {
          id: `${prefix}tutee`,
          englishName: "Past Tutee",
          status: "INACTIVE",
        },
      });
      const crewUser = await tx.user.create({
        data: {
          id: `${prefix}crew`,
          role: "CREW",
          crewStatus: "INACTIVE",
          email: `${prefix}crew@example.test`,
          name: "Past Crew",
        },
      });
      const pairing = await tx.pairing.create({
        data: {
          id: `${prefix}pair`,
          tutorId: tutor.id,
          termId: term.id,
          subject: "Mathematics",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 660,
        },
      });
      await tx.pairingTutee.create({
        data: { pairingId: pairing.id, tuteeId: tutee.id },
      });
      const session = await tx.session.create({
        data: {
          id: `${prefix}sess`,
          pairingId: pairing.id,
          tutorId: tutor.id,
          date: new Date("2023-10-01T10:00:00.000Z"),
          startMin: 600,
          endMin: 660,
          durationMin: 60,
          shFactor: 1,
          shCount: 1,
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      await tx.sessionTutee.create({
        data: { sessionId: session.id, tuteeId: tutee.id, status: "PRESENT" },
      });
      const app = await tx.tutorApplication.create({
        data: {
          id: `${prefix}app`,
          name: "Past Applicant",
          email: `${prefix}app@example.test`,
          type: "INITIAL",
          status: "ACCEPTED",
        },
      });
      await tx.interviewAssignment.create({
        data: { applicationId: app.id, tutorId: tutor.id, isHead: true },
      });
      const windowStart = new Date("2023-10-02T10:00:00.000Z");
      const patrol = await tx.patrol.create({
        data: {
          id: `${prefix}patrol`,
          crewUserId: crewUser.id,
          hours: 0.5,
          createdAt: windowStart,
          creditAwardedAt: windowStart,
        },
      });
      await tx.patrolCreditWindow.create({
        data: {
          crewUserId: crewUser.id,
          windowStart,
          patrolId: patrol.id,
        },
      });
      await tx.tuteeRequestInvalidity.create({
        data: {
          tuteeId: tutee.id,
          invalidatedById: actorId,
          invalidatedByName: "Synthetic Head",
          invalidReason: "Synthetic archive invalidity",
        },
      });

      const actionId = `${prefix}root`;
      await tx.recoveryAction.create({
        data: { id: actionId, kind: "DOMAIN_CHECKPOINT", before: {} },
      });
      await tx.recoveryTrackedEntity.createMany({
        data: [
          { actionId, entity: "Session", recordId: session.id },
          { actionId, entity: "TutorApplication", recordId: app.id },
          { actionId, entity: "Pairing", recordId: pairing.id },
          { actionId, entity: "User", recordId: crewUser.id },
          { actionId, entity: "Tutee", recordId: tutee.id },
        ],
      });

      const candidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-composite-recovery-refs",
        candidates: [
          {
            entity: "SessionTutee",
            key: { sessionId: session.id, tuteeId: tutee.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "InterviewAssignment",
            key: { applicationId: app.id, tutorId: tutor.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "PairingTutee",
            key: { pairingId: pairing.id, tuteeId: tutee.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "PatrolCreditWindow",
            key: {
              crewUserId: crewUser.id,
              windowStart: windowStart.toISOString(),
            },
            action: "MARK_IMPORTED",
          },
          {
            entity: "TuteeRequestInvalidity",
            key: { tuteeId: tutee.id },
            action: "MARK_IMPORTED",
          },
        ],
      };

      const preview = await previewArchiveProvenance(tx, candidates, {
        actorId,
      });
      expect(preview.applicable).toBe(true);
      expect(preview.coverage).toEqual({
        replicationMode: "origin",
        provenanceTriggerOk: true,
        receiptTriggerOk: true,
        receiptImmutableOk: true,
      });
      expect(preview.summary.trackedRecoveryRootCount).toBe(1);
      for (const item of preview.candidates) {
        expect(item.trackedRecoveryActionIds).toEqual([actionId]);
      }

      const applied = await applyArchiveProvenanceFromOperator(
        tx,
        {
          candidates,
          planHash: planHash(preview),
          expectedFingerprint: preview.fingerprint,
          reason: "Classify composite archive provenance",
          clientKey: randomUUID(),
        },
        { id: actorId },
      );
      expect(applied.summary.markedCount).toBe(5);

      const changes = await tx.recoveryChange.findMany({
        where: { actionId },
        orderBy: { id: "asc" },
      });
      const provenanceChanges = changes.filter(
        (c) => c.entity === "ImportedRecordProvenance",
      );
      expect(provenanceChanges).toHaveLength(5);
      expect(provenanceChanges.map((c) => c.recordKey)).toEqual(
        expect.arrayContaining([
          {
            entity: "SessionTutee",
            recordId: importedRecordKey(
              { sessionId: session.id, tuteeId: tutee.id },
              ["sessionId", "tuteeId"],
            ),
          },
          {
            entity: "InterviewAssignment",
            recordId: importedRecordKey(
              { applicationId: app.id, tutorId: tutor.id },
              ["applicationId", "tutorId"],
            ),
          },
          {
            entity: "PairingTutee",
            recordId: importedRecordKey(
              { pairingId: pairing.id, tuteeId: tutee.id },
              ["pairingId", "tuteeId"],
            ),
          },
          {
            entity: "PatrolCreditWindow",
            recordId: importedRecordKey(
              { crewUserId: crewUser.id, windowStart },
              ["crewUserId", "windowStart"],
            ),
          },
          {
            entity: "TuteeRequestInvalidity",
            recordId: importedRecordKey({ tuteeId: tutee.id }, ["tuteeId"]),
          },
        ]),
      );
      const receiptChange = changes.find(
        (c) => c.entity === "ArchiveProvenanceReceipt",
      );
      expect(receiptChange).toBeDefined();
      const event = await tx.recoveryEvent.findUniqueOrThrow({
        where: { id: provenanceChanges[0]!.eventId },
      });
      expect(event.kind).toBe("UNSUPPORTED");
      const fence = await tx.recoveryFence.findUniqueOrThrow({
        where: { actionId },
      });
      expect(fence.revision).toBeGreaterThanOrEqual(6);

      // Receipt immutability trigger rejects UPDATE and DELETE (use SAVEPOINT inside rolled-back tx).
      await tx.$executeRawUnsafe("SAVEPOINT immut_check");
      await expect(
        tx.$executeRaw`UPDATE "ArchiveProvenanceReceipt" SET reason = 'tampered' WHERE id = ${applied.receiptId}`,
      ).rejects.toThrow(/immutable/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT immut_check");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT immut_check");

      // Checkpoint coverage query passes with the new specialized triggers.
      const checkpoint = await captureRecoveryCheckpoint(
        tx,
        { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id },
        { id: actorId },
      );
      const inspected = await inspectRecoveryCheckpoint(tx, {
        checkpointId: checkpoint.checkpointId,
      });
      expect(inspected.coverage).toBe("COMPLETE");
    });
  });

  it("previews without writing and distinguishes exact imports from native late edits, live rows, and current reference config", async () => {
    await withRolledBackFixture(async (tx, prefix, actorId) => {
      await tx.term.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const activeTerm = await tx.term.create({
        data: {
          id: `${prefix}active-term`,
          name: "Active Term",
          schoolYear: "2026-2027",
          quarter: "Q1",
          active: true,
        },
      });
      const pastTerm = await tx.term.create({
        data: {
          id: `${prefix}past-term`,
          name: "Past Term",
          schoolYear: "2023-2024",
          quarter: "Q1",
          active: false,
        },
      });
      const activeSlot = await tx.timeSlot.create({
        data: {
          id: `${prefix}active-slot`,
          label: "Active Mon 10:00",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 660,
          active: true,
        },
      });
      const activeTutor = await tx.tutor.create({
        data: {
          id: `${prefix}active-tutor`,
          englishName: "Live Tutor",
          status: "ACTIVE",
        },
      });
      const pastTutor = await tx.tutor.create({
        data: {
          id: `${prefix}past-tutor`,
          englishName: "Archived Tutor",
          status: "GRADUATED",
        },
      });
      const pastPairing = await tx.pairing.create({
        data: {
          id: `${prefix}past-pair`,
          tutorId: pastTutor.id,
          termId: pastTerm.id,
          subject: "Physics",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 660,
        },
      });
      const exactSession = await tx.session.create({
        data: {
          id: `${prefix}exact-sess`,
          pairingId: pastPairing.id,
          tutorId: pastTutor.id,
          date: new Date("2023-10-05T10:00:00.000Z"),
          startMin: 600,
          endMin: 660,
          durationMin: 60,
          shFactor: 1,
          shCount: 1,
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      const editedSession = await tx.session.create({
        data: {
          id: `${prefix}edited-sess`,
          pairingId: pastPairing.id,
          tutorId: pastTutor.id,
          date: new Date("2023-10-06T10:00:00.000Z"),
          startMin: 600,
          endMin: 660,
          durationMin: 60,
          shFactor: 1,
          shCount: 2, // Drifted from original CSV shCount=1 (native late correction)
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });

      const extracted = extractProvenanceCandidatesFromFiles(
        [
          {
            name: "Session.csv",
            text: recordCsv(
              ["id", "tutorId", "shCount"],
              [
                { id: exactSession.id, tutorId: pastTutor.id, shCount: 1 },
                { id: editedSession.id, tutorId: pastTutor.id, shCount: 1 },
              ],
            ),
          },
          {
            name: "Tutor.csv",
            text: recordCsv(
              ["id", "status"],
              [{ id: activeTutor.id, status: "ACTIVE" }],
            ),
          },
          {
            name: "Term.csv",
            text: recordCsv(
              ["id", "active"],
              [{ id: activeTerm.id, active: true }],
            ),
          },
          {
            name: "TimeSlot.csv",
            text: recordCsv(
              ["id", "active"],
              [{ id: activeSlot.id, active: true }],
            ),
          },
        ],
        { format: "zip", evidenceLabel: "synthetic-mixed-preview" },
      );

      const provenanceCountBefore = await tx.importedRecordProvenance.count();
      const receiptCountBefore = await tx.archiveProvenanceReceipt.count();

      const preview = await previewArchiveProvenance(tx, extracted, {
        actorId,
        sourceRevision: "d0d6d00d",
      });
      expect(preview.applicable).toBe(false);
      expect(preview.sourceRevision).toBe("d0d6d00d");
      expect(await tx.importedRecordProvenance.count()).toBe(
        provenanceCountBefore,
      );
      expect(await tx.archiveProvenanceReceipt.count()).toBe(
        receiptCountBefore,
      );

      const byId = (id: string) =>
        preview.candidates.find((c) => c.recordId === id)!;
      expect(byId(exactSession.id)).toMatchObject({
        importValueMatch: "EXACT_MATCH",
        classificationKind: "EXACT_HISTORICAL_IMPORT",
        blockers: [],
      });
      expect(byId(editedSession.id)).toMatchObject({
        importValueMatch: "VALUE_MISMATCH",
        blockers: [
          expect.objectContaining({
            code: "SOURCE_VALUE_MISMATCH_WITH_IMPORT_EVIDENCE",
          }),
        ],
      });
      expect(byId(activeTutor.id)).toMatchObject({
        classificationKind: "NATIVE_LATE_CORRECTION_OR_LIVE",
        blockers: [
          expect.objectContaining({
            code: "ACTIVE_OR_LIVE_RECORD_CANNOT_BE_ARCHIVED",
          }),
        ],
      });
      expect(byId(activeTerm.id)).toMatchObject({
        classificationKind: "CURRENT_REFERENCE_CONFIGURATION",
        blockers: [
          expect.objectContaining({ code: "ACTIVE_REFERENCE_CONFIGURATION" }),
        ],
      });
      expect(byId(activeSlot.id)).toMatchObject({
        classificationKind: "CURRENT_REFERENCE_CONFIGURATION",
        blockers: [
          expect.objectContaining({ code: "ACTIVE_REFERENCE_CONFIGURATION" }),
        ],
      });

      await expect(
        applyArchiveProvenanceFromOperator(
          tx,
          {
            candidates: extracted,
            planHash: planHash(preview),
            expectedFingerprint: preview.fingerprint,
            sourceRevision: "d0d6d00d",
            reason: "Should fail because plan has blockers",
            clientKey: randomUUID(),
          },
          { id: actorId },
        ),
      ).rejects.toThrow("PROVENANCE_PLAN_BLOCKED");
    });
  });

  it("enforces actor authority, stale-hash rejection, idempotent replay, receipt projection, and audit trail", async () => {
    await withRolledBackFixture(async (tx, prefix, actorId) => {
      const coordinator = await tx.user.create({
        data: {
          id: `${prefix}coord`,
          role: "COORDINATOR",
          email: `${prefix}coord@example.test`,
          name: "Coordinator",
        },
      });
      const pastTerm = await tx.term.create({
        data: {
          id: `${prefix}term`,
          name: "Past Term",
          schoolYear: "2023-2024",
          quarter: "Q1",
          active: false,
        },
      });
      const pastTutor = await tx.tutor.create({
        data: {
          id: `${prefix}tutor`,
          englishName: "Past Tutor",
          status: "GRADUATED",
        },
      });
      const pairing = await tx.pairing.create({
        data: {
          id: `${prefix}pair`,
          tutorId: pastTutor.id,
          termId: pastTerm.id,
          subject: "Chemistry",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 690,
        },
      });
      const session = await tx.session.create({
        data: {
          id: `${prefix}sess`,
          pairingId: pairing.id,
          tutorId: pastTutor.id,
          date: new Date("2023-10-08T10:00:00.000Z"),
          startMin: 600,
          endMin: 690,
          durationMin: 90,
          shFactor: 1,
          shCount: 1.5,
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });

      const candidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-apply-checks",
        candidates: [
          {
            entity: "Session",
            key: { id: session.id },
            action: "MARK_IMPORTED",
          },
        ],
      };

      await expect(
        previewArchiveProvenance(tx, candidates, { actorId: coordinator.id }),
      ).rejects.toThrow("FORBIDDEN");

      const firstPreview = await previewArchiveProvenance(tx, candidates, {
        actorId,
      });
      expect(firstPreview.applicable).toBe(true);

      // Mutating the source row invalidates the reviewed fingerprint.
      await tx.session.update({
        where: { id: session.id },
        data: { comments: "Concurrent edit after preview" },
      });
      await expect(
        applyArchiveProvenanceFromOperator(
          tx,
          {
            candidates,
            planHash: planHash(firstPreview),
            expectedFingerprint: firstPreview.fingerprint,
            reason: "Stale attempt",
            clientKey: randomUUID(),
          },
          { id: actorId },
        ),
      ).rejects.toThrow("STALE_PROVENANCE_PLAN");

      // Re-preview after inspecting the updated state, then apply.
      const freshPreview = await previewArchiveProvenance(tx, candidates, {
        actorId,
      });
      const clientKey = randomUUID();
      const applyInput = {
        candidates,
        planHash: planHash(freshPreview),
        expectedFingerprint: freshPreview.fingerprint,
        reason: "Reviewed synthetic pretracking session",
        clientKey,
      };
      const receipt = await applyArchiveProvenanceFromOperator(tx, applyInput, {
        id: actorId,
      });
      expect(receipt.replayed).toBe(false);
      expect(receipt.summary.markedCount).toBe(1);

      // Exact retry replays idempotently without writing duplicates.
      const replay = await applyArchiveProvenanceFromOperator(tx, applyInput, {
        id: actorId,
      });
      expect(replay.replayed).toBe(true);
      expect(replay.receiptId).toBe(receipt.receiptId);

      // Reusing clientKey with different intent is refused.
      await expect(
        applyArchiveProvenanceFromOperator(
          tx,
          { ...applyInput, reason: "Different reason" },
          { id: actorId },
        ),
      ).rejects.toThrow("CLIENT_KEY_REUSED");

      // Source amount and tutor membership are preserved unchanged.
      expect(
        await tx.session.findUniqueOrThrow({ where: { id: session.id } }),
      ).toMatchObject({ shCount: 1.5, durationMin: 90 });
      expect(
        await tx.tutor.findUniqueOrThrow({ where: { id: pastTutor.id } }),
      ).toMatchObject({ status: "GRADUATED" });

      // Durable receipt & audit trail exist without exposing clientKey.
      const readBack = await readArchiveProvenanceReceipt(
        tx,
        receipt.receiptId,
        actorId,
      );
      expect(readBack).toMatchObject({
        receiptId: receipt.receiptId,
        actorId,
        fingerprint: freshPreview.fingerprint,
      });
      expect(JSON.stringify(readBack)).not.toContain(clientKey);
      const audit = await tx.auditLog.findFirstOrThrow({
        where: {
          entity: "ArchiveProvenanceReceipt",
          entityId: receipt.receiptId,
          operation: "recovery.archiveProvenance",
        },
      });
      expect(audit.userId).toBe(actorId);
    });
  });

  it("reconciles school ledger, opening, and committed overlaps without reversals, re-reporting, or silent archive release", async () => {
    await withRolledBackFixture(async (tx, prefix, actorId) => {
      // Clear any preexisting school-hours state inside this rolled-back transaction.
      await tx.emailDelivery.deleteMany({});
      await tx.schoolHoursReport.deleteMany({});
      await tx.schoolHoursSchedule.deleteMany({});
      await tx.session.deleteMany({});
      await tx.serviceHourAdjustment.deleteMany({});
      await tx.patrol.deleteMany({});
      await tx.importedRecordProvenance.deleteMany({});

      const pastTerm = await tx.term.create({
        data: {
          id: `${prefix}past-term`,
          name: "Past Term",
          schoolYear: "2023-2024",
          quarter: "Q1",
          active: false,
        },
      });
      const historicalTutor = await tx.tutor.create({
        data: {
          id: `${prefix}hist-tutor`,
          englishName: "Historical Tutor",
          status: "GRADUATED",
        },
      });
      const activeTutor = await tx.tutor.create({
        data: {
          id: `${prefix}live-tutor`,
          englishName: "Live Tutor",
          status: "ACTIVE",
        },
      });
      const crewUser = await tx.user.create({
        data: {
          id: `${prefix}hist-crew`,
          role: "CREW",
          crewStatus: "INACTIVE",
          email: `${prefix}hist-crew@example.test`,
          name: "Historical Crew",
        },
      });
      const pastPairing = await tx.pairing.create({
        data: {
          id: `${prefix}past-pair`,
          tutorId: historicalTutor.id,
          termId: pastTerm.id,
          subject: "Biology",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 720,
        },
      });
      const preSession = await tx.session.create({
        data: {
          id: `${prefix}pre-sess`,
          pairingId: pastPairing.id,
          tutorId: historicalTutor.id,
          date: new Date("2023-10-01T10:00:00.000Z"),
          startMin: 600,
          endMin: 720,
          durationMin: 120,
          shFactor: 1,
          shCount: 2,
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      const preAdjustment = await tx.serviceHourAdjustment.create({
        data: {
          id: `${prefix}pre-adj`,
          tutorId: historicalTutor.id,
          type: "EXTRA",
          amount: 1,
          reason: "Pretracking historical extra",
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      const prePatrol = await tx.patrol.create({
        data: {
          id: `${prefix}pre-patrol`,
          crewUserId: crewUser.id,
          hours: 0.5,
          createdAt: new Date("2023-10-02T10:00:00.000Z"),
          creditAwardedAt: new Date("2023-10-02T10:00:00.000Z"),
        },
      });
      const nativeAdj = await tx.serviceHourAdjustment.create({
        data: {
          id: `${prefix}live-adj`,
          tutorId: activeTutor.id,
          type: "EXTRA",
          amount: 3,
          reason: "Native live extra",
          month: "2026-10",
          schoolYear: "2026-2027",
          quarter: "Q1",
        },
      });

      // 1. Classify pretracking archive rows BEFORE opening review.
      const preCandidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-pre-opening-archive",
        candidates: [
          { entity: "Session", key: { id: preSession.id }, action: "MARK_IMPORTED" },
          {
            entity: "ServiceHourAdjustment",
            key: { id: preAdjustment.id },
            action: "MARK_IMPORTED",
          },
          { entity: "Patrol", key: { id: prePatrol.id }, action: "MARK_IMPORTED" },
        ],
      };
      const prePreview = await previewArchiveProvenance(tx, preCandidates, {
        actorId,
      });
      expect(prePreview.applicable).toBe(true);
      expect(prePreview.schoolHours.overlaps).toEqual([]);
      await applyArchiveProvenanceFromOperator(
        tx,
        {
          candidates: preCandidates,
          planHash: planHash(prePreview),
          expectedFingerprint: prePreview.fingerprint,
          reason: "Classify pretracking financial archive before opening review",
          clientKey: randomUUID(),
        },
        { id: actorId },
      );

      // Opening baseline excludes all 3 classified archive rows and retains liveTutor only.
      const opening = await schoolHoursBaselinePreview(tx);
      expect(opening.archivedSourceCount).toBe(3);
      expect(opening.participants.map((p) => p.beneficiaryId)).toEqual([
        `tutor:${activeTutor.id}`,
      ]);

      // Review opening baseline for activeTutor.
      await reviewSchoolHoursBaseline(
        tx,
        {
          expectedContentHash: opening.contentHash,
          expectedBaselineVersion: opening.baselineVersion,
          acknowledged: true,
          reason: "Synthetic opening review",
          participants: [
            {
              beneficiaryId: `tutor:${activeTutor.id}`,
              schoolAccountKey: `school:${activeTutor.id}`,
              earned: 0,
              extras: 0,
              deductions: 0,
              crew: 0,
              reviewed: true,
            },
          ],
        },
        actorId,
      );

      // 2. Attempting to classify a source already anchored in openingBaseline blocks.
      const openingOverlapCandidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-opening-overlap",
        candidates: [
          {
            entity: "ServiceHourAdjustment",
            key: { id: nativeAdj.id },
            action: "MARK_IMPORTED",
          },
        ],
      };
      const openingOverlapPreview = await previewArchiveProvenance(
        tx,
        openingOverlapCandidates,
        { actorId },
      );
      expect(openingOverlapPreview.applicable).toBe(false);
      expect(openingOverlapPreview.schoolHours.overlaps).toEqual([
        expect.objectContaining({
          stage: "OPENING",
          sourceKey: `adjustment:${nativeAdj.id}`,
          anchoredAmount: 3,
        }),
      ]);
      expect(openingOverlapPreview.candidates[0]?.blockers).toContainEqual(
        expect.objectContaining({ code: "OPENING_SCHOOL_HOURS_OVERLAP" }),
      );

      // 3. Issue a committed SchoolHoursReport, then verify committed overlap blocks MARK_IMPORTED.
      const settings = await tx.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      });
      await saveSchoolHoursSettings(
        tx,
        {
          enabled: true,
          recipientEmails: ["office@example.test"],
          timeZone: "Asia/Shanghai",
          includeStatistics: false,
          dateOverrides: {},
          expectedVersion: settings.version,
        },
        actorId,
      );
      const reportPreview = await previewSchoolHours(tx, "2026-10");
      await generateSchoolHours(
        tx,
        {
          month: "2026-10",
          expectedContentHash: reportPreview.contentHash,
          expectedVersion: reportPreview.configVersion,
          expectedBaselineVersion: reportPreview.baselineVersion,
          expectedHeadId: reportPreview.expectedHeadId,
          requestId: randomUUID(),
          reason: "Synthetic committed report",
        },
        actorId,
      );

      const committedOverlapPreview = await previewArchiveProvenance(
        tx,
        openingOverlapCandidates,
        { actorId },
      );
      expect(committedOverlapPreview.applicable).toBe(false);
      expect(committedOverlapPreview.schoolHours.overlaps).toEqual([
        expect.objectContaining({
          stage: "COMMITTED",
          sourceKey: `adjustment:${nativeAdj.id}`,
          anchoredAmount: 3,
        }),
      ]);
      expect(committedOverlapPreview.candidates[0]?.blockers).toContainEqual(
        expect.objectContaining({ code: "COMMITTED_SCHOOL_HOURS_OVERLAP" }),
      );

      // 4. Unanchored archive RELEASE_IMPORTED is blocked (no silent release into reportable credit).
      const silentReleaseCandidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-silent-release",
        candidates: [
          {
            entity: "Session",
            key: { id: preSession.id },
            action: "RELEASE_IMPORTED",
          },
        ],
      };
      const silentReleasePreview = await previewArchiveProvenance(
        tx,
        silentReleaseCandidates,
        { actorId },
      );
      expect(silentReleasePreview.applicable).toBe(false);
      expect(silentReleasePreview.candidates[0]?.blockers).toContainEqual(
        expect.objectContaining({ code: "SILENT_ARCHIVE_CREDIT_RELEASE" }),
      );

      // 5. Simulate a reimported committed source (triggers IMPORTED_SOURCE_REQUIRES_RECONCILIATION).
      await tx.importedRecordProvenance.create({
        data: { entity: "ServiceHourAdjustment", recordId: nativeAdj.id },
      });
      const blockedReport = await previewSchoolHours(tx, "2026-11");
      expect(blockedReport.blockers).toContainEqual(
        expect.objectContaining({
          code: "IMPORTED_SOURCE_REQUIRES_RECONCILIATION",
        }),
      );

      const releaseAnchoredCandidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-release-anchored",
        candidates: [
          {
            entity: "ServiceHourAdjustment",
            key: { id: nativeAdj.id },
            action: "RELEASE_IMPORTED",
          },
        ],
      };

      // If amount drifted, releasing is blocked (ANCHORED_SOURCE_DRIFT).
      await tx.serviceHourAdjustment.update({
        where: { id: nativeAdj.id },
        data: { amount: 5 },
      });
      const driftedPreview = await previewArchiveProvenance(
        tx,
        releaseAnchoredCandidates,
        { actorId },
      );
      expect(driftedPreview.applicable).toBe(false);
      expect(driftedPreview.candidates[0]?.blockers).toContainEqual(
        expect.objectContaining({ code: "ANCHORED_SOURCE_DRIFT" }),
      );

      // Restore exact committed amount (3): releasing clears the overlap cleanly with zero delta.
      await tx.serviceHourAdjustment.update({
        where: { id: nativeAdj.id },
        data: { amount: 3 },
      });
      const releasePreview = await previewArchiveProvenance(
        tx,
        releaseAnchoredCandidates,
        { actorId },
      );
      expect(releasePreview.applicable).toBe(true);
      await applyArchiveProvenanceFromOperator(
        tx,
        {
          candidates: releaseAnchoredCandidates,
          planHash: planHash(releasePreview),
          expectedFingerprint: releasePreview.fingerprint,
          reason: "Reconcile mistakenly reimported committed source",
          clientKey: randomUUID(),
        },
        { id: actorId },
      );
      const reconciledReport = await previewSchoolHours(tx, "2026-11");
      expect(reconciledReport.blockers).toEqual([]);
      expect(
        reconciledReport.rows.find(
          (r) => r.beneficiaryId === `tutor:${activeTutor.id}`,
        )?.hoursToAdd,
      ).toBe(0);
    });
  });

  it("verifies representative meeting, interview, patrol, attendance, and admission/discipline flows after operator classification", async () => {
    await withRolledBackFixture(async (tx, prefix, actorId) => {
      await tx.term.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const pastTerm = await tx.term.create({
        data: {
          id: `${prefix}past-term`,
          name: "Past Term",
          schoolYear: "2023-2024",
          quarter: "Q1",
          active: false,
        },
      });
      const activeTerm = await tx.term.create({
        data: {
          id: `${prefix}active-term`,
          name: "Active Term",
          schoolYear: "2026-2027",
          quarter: "Q1",
          active: true,
        },
      });
      const pastTutor = await tx.tutor.create({
        data: {
          id: `${prefix}tutor`,
          englishName: "Flow Tutor",
          status: "GRADUATED",
        },
      });
      const pastTutee = await tx.tutee.create({
        data: {
          id: `${prefix}tutee`,
          englishName: "Flow Tutee",
          status: "INACTIVE",
        },
      });
      const crewUser = await tx.user.create({
        data: {
          id: `${prefix}crew`,
          role: "CREW",
          crewStatus: "INACTIVE",
          email: `${prefix}crew@example.test`,
          name: "Flow Crew",
        },
      });
      const room = await tx.room.create({
        data: {
          id: `${prefix}room`,
          name: `${prefix}Room 101`,
        },
      });
      const pastSlot = await tx.timeSlot.create({
        data: {
          id: `${prefix}slot`,
          label: "Past Mon 10:00",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 660,
          active: false,
        },
      });

      // 1. Meeting fixtures (4 past unexcused meetings + existing deduction).
      const meetingIds: string[] = [];
      const attendanceIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const mtg = await tx.tutorMeeting.create({
          data: {
            id: `${prefix}mtg-${i}`,
            title: `Past Meeting ${i}`,
            date: new Date(`2023-10-0${i}T12:00:00.000Z`),
            termId: pastTerm.id,
          },
        });
        meetingIds.push(mtg.id);
        const att = await tx.meetingAttendance.create({
          data: {
            id: `${prefix}ma-${i}`,
            meetingId: mtg.id,
            tutorId: pastTutor.id,
            status: "UNEXCUSED_ABSENT",
          },
        });
        attendanceIds.push(att.id);
      }
      const mtgDeduction = await tx.serviceHourAdjustment.create({
        data: {
          id: `mtgabs_${meetingIds[3]!}_${pastTutor.id}`,
          tutorId: pastTutor.id,
          type: "PUNISHMENT",
          amount: 1,
          reason: "Pretracking meeting deduction",
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });

      // 2. Interview & admission fixtures.
      const sharedEmail = `${prefix}candidate@example.test`;
      const archivedApp = await tx.tutorApplication.create({
        data: {
          id: `${prefix}arch-app`,
          name: "Archived Candidate",
          email: sharedEmail,
          type: "INITIAL",
          status: "ACCEPTED",
        },
      });
      await tx.interviewAssignment.create({
        data: {
          applicationId: archivedApp.id,
          tutorId: pastTutor.id,
          isHead: true,
          attended: true,
        },
      });
      const interviewCredit = await tx.serviceHourAdjustment.create({
        data: {
          id: `interview_${archivedApp.id}_${pastTutor.id}`,
          tutorId: pastTutor.id,
          type: "EXTRA",
          amount: 0.5,
          reason: "Pretracking interview credit",
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      // A separate native INITIAL application with the same email (verifies
      // archived acceptance does not block revoking a native admission).
      const liveTutor = await tx.tutor.create({
        data: {
          id: `${prefix}live-admitted`,
          englishName: "Live Admitted",
          email: sharedEmail,
          status: "ACTIVE",
        },
      });
      const nativeApp = await tx.tutorApplication.create({
        data: {
          id: `${prefix}native-app`,
          name: "Live Admitted",
          email: sharedEmail,
          type: "INITIAL",
          status: "REJECTED",
          promotedTutorId: liveTutor.id,
        },
      });

      // 3. Patrol + Attendance + Flag fixtures.
      const pastPairing = await tx.pairing.create({
        data: {
          id: `${prefix}pair`,
          tutorId: pastTutor.id,
          termId: pastTerm.id,
          timeSlotId: pastSlot.id,
          roomId: room.id,
          subject: "English",
          dayOfWeek: 1,
          startMin: 600,
          endMin: 660,
        },
      });
      const pastSession = await tx.session.create({
        data: {
          id: `${prefix}sess`,
          pairingId: pastPairing.id,
          tutorId: pastTutor.id,
          timeSlotId: pastSlot.id,
          actualRoomId: room.id,
          date: new Date("2023-10-10T00:00:00.000Z"),
          startMin: 600,
          endMin: 660,
          durationMin: 60,
          shFactor: 1,
          shCount: 1,
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });
      await tx.sessionTutee.create({
        data: {
          sessionId: pastSession.id,
          tuteeId: pastTutee.id,
          status: "PRESENT",
        },
      });
      const patrolTime = new Date("2023-10-10T10:30:00.000Z");
      const pastPatrol = await tx.patrol.create({
        data: {
          id: `${prefix}patrol`,
          crewUserId: crewUser.id,
          hours: 0.5,
          createdAt: patrolTime,
          creditAwardedAt: patrolTime,
        },
      });
      const pastObs = await tx.patrolObservation.create({
        data: {
          id: `${prefix}obs`,
          patrolId: pastPatrol.id,
          roomId: room.id,
          headcount: "ZERO",
          observedAt: patrolTime,
        },
      });
      const pastFlag = await tx.sessionFlag.create({
        data: {
          id: `${prefix}flag`,
          sessionId: pastSession.id,
          tutorId: pastTutor.id,
          expected: 1,
          observed: 0,
          state: "PENALIZED",
        },
      });
      const flagDeduction = await tx.serviceHourAdjustment.create({
        data: {
          id: `flag:${pastFlag.id}`,
          tutorId: pastTutor.id,
          type: "PUNISHMENT",
          amount: 1,
          reason: "Pretracking flag penalty",
          month: "2023-10",
          schoolYear: "2023-2024",
          quarter: "Q1",
        },
      });

      // 4. Discipline removal fixture.
      const pastRemoval = await tx.tuteeRemovalRequest.create({
        data: {
          id: `${prefix}removal`,
          tuteeId: pastTutee.id,
          kind: "PUNISHMENT",
          state: "APPROVED",
          reason: "Pretracking discipline removal",
          resolvedAt: new Date("2023-10-15T10:00:00.000Z"),
        },
      });

      // Run the full reviewed operator classification workflow on all representative entities.
      const candidates: ProvenanceCandidateFile = {
        version: 1,
        kind: "archive-provenance-candidates",
        evidenceLabel: "synthetic-representative-flows",
        candidates: [
          ...meetingIds.map((id) => ({
            entity: "TutorMeeting",
            key: { id },
            action: "MARK_IMPORTED" as const,
          })),
          ...attendanceIds.map((id) => ({
            entity: "MeetingAttendance",
            key: { id },
            action: "MARK_IMPORTED" as const,
          })),
          {
            entity: "ServiceHourAdjustment",
            key: { id: mtgDeduction.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "TutorApplication",
            key: { id: archivedApp.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "InterviewAssignment",
            key: { applicationId: archivedApp.id, tutorId: pastTutor.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "ServiceHourAdjustment",
            key: { id: interviewCredit.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "Session",
            key: { id: pastSession.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "SessionTutee",
            key: { sessionId: pastSession.id, tuteeId: pastTutee.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "Patrol",
            key: { id: pastPatrol.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "PatrolObservation",
            key: { id: pastObs.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "SessionFlag",
            key: { id: pastFlag.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "ServiceHourAdjustment",
            key: { id: flagDeduction.id },
            action: "MARK_IMPORTED",
          },
          {
            entity: "TuteeRemovalRequest",
            key: { id: pastRemoval.id },
            action: "MARK_IMPORTED",
          },
        ],
      };

      const preview = await previewArchiveProvenance(tx, candidates, {
        actorId,
      });
      expect(preview.applicable).toBe(true);
      await applyArchiveProvenanceFromOperator(
        tx,
        {
          candidates,
          planHash: planHash(preview),
          expectedFingerprint: preview.fingerprint,
          reason: "Classify representative historical workflows",
          clientKey: randomUUID(),
        },
        { id: actorId },
      );

      // Verify Meeting flow: imported absences do not consume allowance, frozen deduction preserved, native edit blocked.
      const nativeMeeting = await tx.tutorMeeting.create({
        data: {
          id: `${prefix}native-mtg`,
          title: "Native Meeting",
          date: new Date("2023-10-20T12:00:00.000Z"),
          termId: pastTerm.id,
        },
      });
      await tx.meetingAttendance.create({
        data: {
          id: `${prefix}native-ma`,
          meetingId: nativeMeeting.id,
          tutorId: pastTutor.id,
          status: "UNEXCUSED_ABSENT",
        },
      });
      await reconcileMeetingHours(tx, pastTutor.id);
      const mtgAdjs = await tx.serviceHourAdjustment.findMany({
        where: { tutorId: pastTutor.id, id: { startsWith: "mtgabs_" } },
      });
      expect(mtgAdjs.map((a) => a.id)).toEqual([mtgDeduction.id]);
      await expect(
        assertMutableProgramRecords(tx, [
          { entity: "TutorMeeting", recordId: meetingIds[0]! },
        ]),
      ).rejects.toThrow("imported historical evidence");

      // Verify Interview flow: completion & hour clear blocked on imported interview/composite assignment.
      await expect(
        writeInterviewCompletion(
          tx,
          archivedApp.id,
          {
            interviewCompletedAt: null,
            interviewDurationMin: null,
            interviewSchoolYear: null,
            interviewQuarter: null,
            interviewers: [{ tutorId: pastTutor.id, attended: true }],
          },
          {
            durationMin: 30,
            completedAt: new Date("2023-10-12T10:00:00.000Z"),
            attendedTutorIds: [pastTutor.id],
          },
          [{ id: interviewCredit.id }],
        ),
      ).rejects.toThrow("imported historical evidence");
      await expect(
        clearInterviewHours(tx, archivedApp.id, [pastTutor.id]),
      ).rejects.toThrow("imported historical evidence");

      // Verify Patrol & Flag flow: imported flag/deduction stay frozen across reconsider & reconcile.
      await reconsiderSessionFlag(tx, pastSession.id);
      await syncSessionFlag(tx, pastSession.id);
      expect(
        await tx.sessionFlag.findUniqueOrThrow({ where: { id: pastFlag.id } }),
      ).toMatchObject({ state: "PENALIZED" });
      expect(
        await tx.serviceHourAdjustment.findUnique({
          where: { id: flagDeduction.id },
        }),
      ).not.toBeNull();

      // Verify Attendance flow: slot time change skips classified merged block and preserves shCount/durationMin.
      const updatedCount = await propagateSlotAttendance(
        tx,
        pastSlot.id,
        { startMin: 600, endMin: 720 },
        { id: actorId, name: "Synthetic Head" },
      );
      expect(updatedCount).toBe(0);
      expect(
        await tx.session.findUniqueOrThrow({ where: { id: pastSession.id } }),
      ).toMatchObject({ endMin: 660, durationMin: 60, shCount: 1 });

      // Verify Admission & Discipline flow: imported application cannot promote or reconcile,
      // separate native revocation is NOT blocked by archived acceptance, and imported removal does not auto-reinstate.
      await expect(
        promoteApplicantToTutor(archivedApp.id, tx),
      ).rejects.toThrow("imported historical evidence");
      await expect(reconcileApplication(tx, archivedApp.id)).rejects.toThrow(
        "imported historical evidence",
      );
      await reconcileApplication(tx, nativeApp.id);
      expect(
        await tx.tutor.findUniqueOrThrow({ where: { id: liveTutor.id } }),
      ).toMatchObject({ status: "ARCHIVED" });

      await syncPunishmentRemoval(tx, pastTutee.id);
      expect(
        await tx.tutee.findUniqueOrThrow({ where: { id: pastTutee.id } }),
      ).toMatchObject({ status: "INACTIVE" });

      // Active term preserved untouched.
      expect(
        await tx.term.findUniqueOrThrow({ where: { id: activeTerm.id } }),
      ).toMatchObject({ active: true });
    });
  });
});
