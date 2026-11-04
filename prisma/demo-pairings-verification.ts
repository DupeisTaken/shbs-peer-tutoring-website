import assert from "node:assert/strict";
import { pairingGroupEligibility } from "../src/lib/pairing-group-eligibility";
import { readPairingGroups } from "../src/server/pairing-groups";
import type { DomainDb } from "../src/server/transactions";
import { DEMO_LESSONS, demoAssignmentId } from "./demo-pairings";

/** Verify assignment identity independently of the lesson's presentation grouping. */
export async function verifyDemoPairingCoverage(db: DomainDb) {
  const term = await db.term.findFirstOrThrow({ where: { active: true } });
  const pairings = await db.pairing.findMany({
    where: { termId: term.id },
    include: { tutees: { include: { tutee: true } } },
  });
  assert.equal(pairings.length, 26, "The current demo has 26 student-course assignments");
  assert.equal(pairings.filter((row) => !row.groupId).length, 2);
  assert.equal(new Set(pairings.flatMap((row) => row.groupId ? [row.groupId] : [])).size, 10);
  assert.equal(await db.pairingGroup.count({ where: { termId: term.id } }), 10);
  for (const lesson of DEMO_LESSONS) {
    assert.ok(await db.qualificationGrant.count({
      where: {
        tutorId: lesson.tutorId,
        subjectId: lesson.subjectId,
        qualification: { status: "APPROVED" },
      },
    }), `${lesson.subject}: an approved exact teaching grant is required`);
    const subject = await db.subject.findUniqueOrThrow({ where: { id: lesson.subjectId } });
    assert.equal(subject.active, true);
    const members = lesson.tuteeIds.map((tuteeId) => {
      const pairing = pairings.find((row) => row.id === demoAssignmentId(lesson.id, tuteeId));
      assert.ok(pairing, `${lesson.subject}: missing assignment for ${tuteeId}`);
      assert.equal(pairing.tutorId, lesson.tutorId);
      assert.equal(pairing.subject, subject.name);
      assert.deepEqual(pairing.tutees.map((row) => row.tuteeId), [tuteeId]);
      const student = pairing.tutees[0]!.tutee;
      assert.ok([student.firstChoiceId, student.secondChoiceId].includes(lesson.subjectId));
      return pairing;
    });
    const view = await readPairingGroups(db, lesson.tutorId);
    if (members.length > 1) {
      assert.equal(pairingGroupEligibility(members).eligible, true);
      assert.ok(members[0]!.groupId);
      assert.ok(members.every((row) => row.groupId === members[0]!.groupId));
      const group = view.groups.find((row) => row.id === members[0]!.groupId);
      assert.ok(group);
      assert.equal(group.groupStatus, "scheduled");
      assert.equal(group.groupEligibility?.eligible, true);
      assert.deepEqual([...group.pairingIds].sort(), members.map((row) => row.id).sort());
    } else {
      assert.equal(members[0]!.groupId, null);
      assert.equal(view.groups.length, 0);
    }
    assert.ok(members.every((row) => row.scheduleConfirmed));
    assert.equal(new Set(members.map((row) => JSON.stringify([
      row.dayOfWeek, row.startMin, row.endMin, row.roomId, row.timeSlotId,
    ]))).size, 1, `${lesson.subject}: one coherent lesson schedule`);
  }
  return { assignments: 26, groups: 10, standaloneLessons: 2 };
}
