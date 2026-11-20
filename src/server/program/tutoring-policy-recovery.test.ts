import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

it("retains safe tutoring policy facts without copying reasons, private mail or capabilities", async () => {
  const [row] = await db.$queryRaw<{ planning: unknown; calendar: unknown }[]>`
    SELECT recovery_planning_safe_row(${JSON.stringify({
      id: "synthetic-participant", tutoringPauseSuppressed: true, calendarSuppressed: false,
      scheduleOverride: false, tokenHash: "synthetic-private-proof", recipientEmail: "synthetic@example.test",
      body: "Synthetic private message",
    })}::jsonb) AS planning,
    recovery_safe_row(${JSON.stringify({
      schedulingEffect: "PAUSE_REGULAR", reason: "Synthetic private staff context", tokenHash: "synthetic-proof",
    })}::jsonb) AS calendar`;
  expect(row?.planning).toEqual({ id: "synthetic-participant", tutoringPauseSuppressed: true, calendarSuppressed: false, scheduleOverride: false });
  expect(row?.calendar).toEqual({ schedulingEffect: "PAUSE_REGULAR" });
});

it("journals actual participant pause and restoration with both independent suppression causes", async () => {
  const rollback = new Error("Roll back synthetic recovery journal fixture");
  await expect(db.$transaction(async (tx) => {
    const prefix = `tutoring-policy-${randomUUID()}`;
    const term = await tx.term.create({ data: { id: `${prefix}-term`, schoolYear: prefix, quarter: "Q1", name: "Synthetic recovery term", active: false } });
    const tutor = await tx.tutor.create({ data: { id: `${prefix}-tutor`, englishName: "Synthetic tutor" } });
    const tutee = await tx.tutee.create({ data: { id: `${prefix}-tutee`, englishName: "Synthetic learner" } });
    const plan = await tx.sessionPlan.create({ data: {
      id: `${prefix}-plan`, generationKey: `${prefix}-generation`, tutorId: tutor.id, termId: term.id,
      originalDate: "2098-11-12", timeZone: "Asia/Shanghai", sourceFingerprint: "synthetic-roster",
    } });
    const participant = await tx.sessionPlanParticipant.create({ data: {
      id: `${prefix}-participant`, planId: plan.id, tuteeId: tutee.id, calendarSuppressed: true,
    } });
    const root = await tx.recoveryAction.create({ data: { kind: "SYNTHETIC_TUTORING_POLICY_TEST", before: {} } });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action',${root.id},true)`;
    await tx.sessionPlanParticipant.update({ where: { id: participant.id }, data: { tutoringPauseSuppressed: true } });
    await tx.sessionPlanParticipant.update({ where: { id: participant.id }, data: { tutoringPauseSuppressed: false } });
    const changes = await tx.recoveryChange.findMany({
      where: { actionId: root.id, entity: "SessionPlanParticipant", operation: "UPDATE" },
      orderBy: { id: "asc" },
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      before: { tutoringPauseSuppressed: false, calendarSuppressed: true },
      after: { tutoringPauseSuppressed: true, calendarSuppressed: true },
    });
    expect(changes[0]?.changedFields).toEqual(expect.arrayContaining(["tutoringPauseSuppressed"]));
    expect(changes[1]).toMatchObject({
      before: { tutoringPauseSuppressed: true, calendarSuppressed: true },
      after: { tutoringPauseSuppressed: false, calendarSuppressed: true },
    });
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
});

it("journals the calendar source's exact safe date identity, interval and effect without its private reason", async () => {
  const rollback = new Error("Rollback synthetic calendar source recovery");
  await expect(db.$transaction(async (tx) => {
    const date = "2096-02-13";
    const root = await tx.recoveryAction.create({ data: { kind: "SYNTHETIC_CALENDAR_POLICY_TEST", before: {} } });
    await tx.$queryRaw`SELECT set_config('shbs.recovery_action',${root.id},true)`;
    await tx.programCalendarDay.create({ data: { date, endDate: "2096-02-20", reason: "Synthetic private source reason", schedulingEffect: "PAUSE_REGULAR" } });
    await tx.programCalendarDay.update({ where: { date }, data: { endDate: "2096-02-18", active: false, version: { increment: 1 } } });
    const changes = await tx.recoveryChange.findMany({ where: { actionId: root.id, entity: "ProgramCalendarDay" }, orderBy: { id: "asc" } });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ recordKey: { date }, after: { date, endDate: "2096-02-20", schedulingEffect: "PAUSE_REGULAR", active: true, version: 1 } });
    expect(changes[1]).toMatchObject({ recordKey: { date }, before: { endDate: "2096-02-20", active: true }, after: { endDate: "2096-02-18", active: false, version: 2 } });
    for (const change of changes) {
      expect(change.before ?? {}).not.toHaveProperty("reason");
      expect(change.after ?? {}).not.toHaveProperty("reason");
    }
    const snapshots = await tx.recoveryChange.findMany({ where: { actionId: root.id, entity: "ProgramCalendarPolicyRevision" } });
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((change) => !JSON.stringify(change.after).includes("Synthetic private source reason"))).toBe(true);
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
});
