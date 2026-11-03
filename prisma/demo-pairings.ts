import { assertDemoDatabase, seedId } from "./demo-support";
import { inTransaction, lockEntity, type DomainDb } from "../src/server/transactions";
import { lockPlannedRoomSchedule } from "../src/server/room-bookings";
import { readPairingGroups, savePairingGroups } from "../src/server/pairing-groups";
import { approveQualification, lockCatalogue } from "../src/server/qualifications";
import { assignmentMismatches } from "../src/server/assignment-qualification";

/** Twelve teaching blocks, each composed of the same singleton assignments made by Select tutor. */
export const DEMO_LESSONS = [
  { id: seedId("pairing-alice-math"), tutorId: seedId("tutor-alice"), subjectId: seedId("course-math"), subject: "Mathematics", day: 1, start: "15:30", end: "16:30", roomId: seedId("room-a101"), slotId: seedId("slot-mon-a"), tuteeIds: [seedId("tutee-emma"), seedId("tutee-frank"), seedId("tutee-liam")] },
  { id: seedId("pairing-bob-physics"), tutorId: seedId("tutor-bob"), subjectId: seedId("course-physics"), subject: "Physics", day: 3, start: "16:00", end: "17:00", roomId: seedId("room-b201"), slotId: seedId("slot-wed-a"), tuteeIds: [seedId("tutee-grace"), seedId("tutee-peter")] },
  { id: seedId("pairing-carol-english"), tutorId: seedId("tutor-carol"), subjectId: seedId("course-english"), subject: "English", day: 5, start: "15:00", end: "16:15", roomId: seedId("room-library"), slotId: seedId("slot-fri-a"), tuteeIds: [seedId("tutee-henry"), seedId("tutee-ivy"), seedId("tutee-jack")] },
  { id: seedId("pairing-david-chem"), tutorId: seedId("tutor-david"), subjectId: seedId("course-chemistry"), subject: "Chemistry", day: 2, start: "15:30", end: "16:30", roomId: seedId("room-lab1"), slotId: seedId("slot-tue-a"), tuteeIds: [seedId("tutee-mia"), seedId("tutee-olivia")] },
  { id: seedId("pairing-gina-apcalc"), tutorId: seedId("tutor-gina"), subjectId: seedId("course-apcalc"), subject: "AP Calculus BC", day: 4, start: "16:45", end: "17:45", roomId: seedId("room-a102"), slotId: seedId("slot-thu-b"), tuteeIds: [seedId("tutee-noah"), seedId("tutee-tina")] },
  { id: seedId("pairing-harold-apenglit"), tutorId: seedId("tutor-harold"), subjectId: seedId("course-apenglit"), subject: "AP English Literature", day: 1, start: "16:45", end: "17:45", roomId: seedId("room-a103"), slotId: seedId("slot-mon-b"), tuteeIds: [seedId("tutee-rachel")] },
  { id: seedId("pairing-iris-spanish"), tutorId: seedId("tutor-iris"), subjectId: seedId("course-spanish"), subject: "Spanish", day: 2, start: "16:45", end: "17:45", roomId: seedId("room-b202"), slotId: seedId("slot-tue-b"), tuteeIds: [seedId("tutee-quinn"), seedId("tutee-will")] },
  { id: seedId("pairing-jason-apcs"), tutorId: seedId("tutor-jason"), subjectId: seedId("course-apcs"), subject: "AP Computer Science A", day: 3, start: "17:15", end: "18:15", roomId: seedId("room-a101"), slotId: seedId("slot-wed-b"), tuteeIds: [seedId("tutee-vera"), seedId("tutee-yuki")] },
  { id: seedId("pairing-karen-econ"), tutorId: seedId("tutor-karen"), subjectId: seedId("course-economics"), subject: "Economics", day: 4, start: "16:45", end: "17:45", roomId: seedId("room-a103"), slotId: seedId("slot-thu-b"), tuteeIds: [seedId("tutee-umar")] },
  { id: seedId("pairing-leo-apush"), tutorId: seedId("tutor-leo"), subjectId: seedId("course-apush"), subject: "AP US History", day: 5, start: "16:30", end: "17:30", roomId: seedId("room-b201"), slotId: seedId("slot-fri-b"), tuteeIds: [seedId("tutee-xena"), seedId("tutee-sam")] },
  { id: seedId("pairing-mona-precalc"), tutorId: seedId("tutor-mona"), subjectId: seedId("course-precalc"), subject: "Precalculus", day: 2, start: "15:30", end: "16:30", roomId: seedId("room-a102"), slotId: seedId("slot-tue-a"), tuteeIds: [seedId("tutee-faye"), seedId("tutee-cory"), seedId("tutee-hana")] },
  { id: seedId("pairing-nora-apbio"), tutorId: seedId("tutor-nora"), subjectId: seedId("course-apbio"), subject: "AP Biology", day: 4, start: "16:45", end: "17:45", roomId: seedId("room-lab1"), slotId: seedId("slot-thu-b"), tuteeIds: [seedId("tutee-bella"), seedId("tutee-eli"), seedId("tutee-gabe")] },
];

/** Keep the original lesson ID as the primary, so historical Session foreign keys survive. */
export function demoAssignmentId(primaryId: string, tuteeId: string): string {
  const lesson = DEMO_LESSONS.find((row) => row.id === primaryId);
  return lesson?.tuteeIds[0] === tuteeId
    ? primaryId
    : seedId(`assignment:${primaryId}:${tuteeId}`);
}

const minutes = (clock: string) => {
  const [hour = 0, minute = 0] = clock.split(":").map(Number);
  return hour * 60 + minute;
};

/** Selective conversion of authored current lessons, never a reset of an explored database.
 * Session and published plan snapshots are immutable here. Ordinary future publication uses
 * exactly the same reconciliation as a tutor saving Combine/split; explicit agreements skip. */
export async function seedDemoPairings(db: DomainDb) {
  assertDemoDatabase(process.env.DATABASE_URL ?? "");
  const result = {
    convertedLessons: 0, createdAssignments: 0, approvedQualifications: 0,
    deviations: [] as string[],
  };
  const termId = seedId("term-2026-q1");
  for (const lesson of DEMO_LESSONS) {
    await inTransaction(db, async (tx) => {
      const skip = (reason: string) => { result.deviations.push(`${lesson.subject}: ${reason}`); };
      await lockEntity(tx, "program:period");
      await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${lesson.tutorId} FOR UPDATE`;
      await lockPlannedRoomSchedule(tx);
      await lockEntity(tx, "session-planning");
      await lockCatalogue(tx);
      await tx.$queryRaw`SELECT id FROM "Pairing" WHERE "tutorId"=${lesson.tutorId} AND "termId"=${termId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT t.id FROM "Tutee" t JOIN "PairingTutee" p ON p."tuteeId"=t.id WHERE p."pairingId"=${lesson.id} ORDER BY t.id FOR UPDATE OF t`;
      const term = await tx.term.findUnique({ where: { id: termId } });
      if (!term?.active || term.schoolYear !== "26-27" || term.quarter !== "Q1" ||
          await tx.term.count({ where: { active: true } }) !== 1) {
        skip("fixture period is no longer current"); return;
      }
      const rows = await tx.pairing.findMany({
        where: { tutorId: lesson.tutorId, termId },
        include: { tutees: { include: { tutee: true } }, group: true },
      });
      const primary = rows.find((row) => row.id === lesson.id);
      const subject = await tx.subject.findUnique({ where: { id: lesson.subjectId }, include: { level: true } });
      const tutor = await tx.tutor.findUnique({ where: { id: lesson.tutorId }, include: { user: { include: { schoolDeparture: true } } } });
      const slot = await tx.timeSlot.findUnique({ where: { id: lesson.slotId } });
      if (!primary || !subject?.active || subject.level?.active === false || tutor?.status !== "ACTIVE" ||
          tutor.user?.tutorAccessRevoked || tutor.user?.schoolDeparture?.reason || !slot?.active) {
        skip("assignment, active tutor, course or slot is missing"); return;
      }
      const ids = lesson.tuteeIds.map((id) => demoAssignmentId(lesson.id, id));
      const converted = primary.groupId !== null || rows.some((row) => ids.slice(1).includes(row.id));
      const mode = lesson.id === seedId("pairing-bob-physics") ? "AUTO"
        : lesson.id === seedId("pairing-carol-english") ? "NONE"
        : "FIXED";
      const expectedMode = !converted && lesson.id === seedId("pairing-david-chem") ? "LEGACY" : mode;
      const correctSchedule = (row: (typeof rows)[number]) =>
        row.subject === subject.name && row.scheduleConfirmed &&
        row.dayOfWeek === lesson.day && row.startMin === minutes(lesson.start) &&
        row.endMin === minutes(lesson.end) && row.timeSlotId === lesson.slotId &&
        row.roomMode === expectedMode && !row.roomNeedsAssignment && row.roomShortageKey === null &&
        (mode === "AUTO" ? row.roomId !== null : row.roomId === (mode === "NONE" ? null : lesson.roomId));
      if (slot.dayOfWeek !== lesson.day || slot.startMin !== minutes(lesson.start) || slot.endMin !== minutes(lesson.end) ||
          !correctSchedule(primary) || rows.some((row) => !ids.includes(row.id))) {
        skip("authored schedule, room, course or tutor assignments changed"); return;
      }
      if (converted) {
        const intact = rows.length === ids.length && rows.every((row) =>
          correctSchedule(row) && row.groupId === primary.groupId &&
          row.group?.primaryPairingId === primary.id && row.roomId === primary.roomId &&
          row.tutees.length === 1 && demoAssignmentId(lesson.id, row.tutees[0]!.tuteeId) === row.id);
        if (!intact) skip("saved group or singleton roster changed; retained without repair");
        return;
      }
      if (primary.roomVersion !== 0 || rows.length !== 1 ||
          primary.tutees.length !== lesson.tuteeIds.length ||
          primary.tutees.some(({ tuteeId, tutee }) => !lesson.tuteeIds.includes(tuteeId) ||
            tutee.status !== "ACTIVE" || tutee.firstChoiceId !== lesson.subjectId)) {
        skip("authored roster, request choice or scheduling version changed"); return;
      }
      if (await tx.pairingGroup.count({ where: { tutorId: lesson.tutorId, termId } }) ||
          await tx.pairing.count({ where: { id: { in: ids.slice(1) } } }) ||
          await tx.auditLog.count({ where: { entityId: lesson.id } })) {
        skip("another saved group or assignment occupies the fixture identity"); return;
      }
      // Do not revive a revoked approval or silently expand an existing approval snapshot.
      const approval = await tx.tutorQualification.findUnique({
        where: { tutorId_subjectId: { tutorId: lesson.tutorId, subjectId: lesson.subjectId } },
        include: { grants: true },
      });
      if (approval && (approval.status !== "APPROVED" || !approval.grants.some((grant) => grant.subjectId === lesson.subjectId))) {
        skip("qualification approval or grant was changed"); return;
      }
      // Existing published ordinary plans are retained. Negotiation/continuation evidence and
      // explicit reschedules are user work, so conversion must not invalidate those contracts.
      if (await tx.sessionPlan.count({ where: {
        assignments: { some: { pairingId: lesson.id } },
        OR: [
          { requests: { some: {} } }, { suggestions: { some: {} } },
          { cohorts: { some: { startsAt: { gt: new Date() }, rescheduled: true } } },
          { participants: { some: { scheduleOverride: true } } },
        ],
      } }) || await tx.studentContinuationAssignment.count({ where: {
        OR: [{ sourcePairingId: lesson.id }, { targetPairingId: lesson.id }],
      } }) || await tx.pairingCreationRequest.count({ where: { pairingId: lesson.id } })) {
        skip("planning agreement or assignment workflow evidence exists"); return;
      }
      await tx.$queryRaw`SELECT id FROM "StudentRequestReview" WHERE "pairingId"=${lesson.id} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TuteeRemovalRequest" WHERE "pairingId"=${lesson.id} ORDER BY id FOR UPDATE`;
      const reviews = await tx.studentRequestReview.findMany({ where: { pairingId: lesson.id } });
      const removals = await tx.tuteeRemovalRequest.findMany({ where: { pairingId: lesson.id } });
      const frank = lesson.id === seedId("pairing-alice-math");
      const grace = lesson.id === seedId("pairing-bob-physics");
      const will = lesson.id === seedId("pairing-iris-spanish");
      if (reviews.some((review) => {
        const key = frank ? "frank" : grace ? "grace" : "";
        return !key || review.id !== seedId(`review-${key}`) || review.surveyId !== seedId(`survey-${key}`) ||
          review.kind !== (frank ? "STUDENT_ABORT" : "SCHEDULE_CONFLICT") ||
          review.requestedByUserId !== seedId(frank ? "student-user-frank" : "user-bob") ||
          review.reason !== "A new required class conflicts with this tutoring schedule. Please review the next step." ||
          review.state !== "PENDING" || review.resolvedAt !== null || review.resolvedByUserId !== null ||
          review.legacyTuteeId !== null || review.legacyIntakeTermId !== null;
      }) || removals.some((removal) => !will || removal.id !== seedId("trr-will-pending") ||
        removal.tuteeId !== seedId("tutee-will") || removal.kind !== "VOLUNTARY" || removal.state !== "PENDING" ||
        removal.requestedByTutorId !== lesson.tutorId || removal.reason !== "Family is moving; wants to stop after this week." ||
        removal.resolvedAt !== null || removal.resolvedById !== null || removal.resolvedByName !== null ||
        removal.removedPeriodKey !== null || removal.pairingSnapshot !== null || removal.eligibleAt === null)) {
        skip("review or removal context was changed"); return;
      }
      if (!approval) {
        await approveQualification(tx, lesson.tutorId, lesson.subjectId, seedId("user-admin"));
        result.approvedQualifications++;
      }
      const mismatches = await assignmentMismatches(tx, "admin.assignTuteeToTutor", {
        tutorId: lesson.tutorId, subjectId: lesson.subjectId,
      });
      if (mismatches.length) throw new Error(`Demo qualification did not grant ${subject.name}`);
      if (ids.length === 1) return;
      for (const tuteeId of lesson.tuteeIds.slice(1)) {
        await tx.pairing.create({ data: {
          id: demoAssignmentId(lesson.id, tuteeId), subject: subject.name,
          tutorId: lesson.tutorId, termId, createdAt: primary.createdAt,
          dayOfWeek: primary.dayOfWeek, startMin: primary.startMin, endMin: primary.endMin,
          scheduleConfirmed: false, roomMode: primary.roomMode, roomId: primary.roomId,
          tutees: { create: { tuteeId } },
        } });
      }
      await tx.pairingTutee.deleteMany({ where: { pairingId: lesson.id, tuteeId: { in: lesson.tuteeIds.slice(1) } } });
      const snapshot = await readPairingGroups(tx, lesson.tutorId);
      await savePairingGroups(tx, lesson.tutorId, {
        snapshot: snapshot.snapshot,
        groups: [{ pairingIds: ids, slotId: lesson.slotId }],
      });
      if (frank && reviews.length) await tx.studentRequestReview.update({
        where: { id: seedId("review-frank") },
        data: { pairingId: demoAssignmentId(lesson.id, seedId("tutee-frank")) },
      });
      if (will && removals.length) await tx.tuteeRemovalRequest.update({
        where: { id: seedId("trr-will-pending") },
        data: { pairingId: demoAssignmentId(lesson.id, seedId("tutee-will")) },
      });
      result.convertedLessons++;
      result.createdAssignments += ids.length - 1;
    });
  }
  return result;
}
