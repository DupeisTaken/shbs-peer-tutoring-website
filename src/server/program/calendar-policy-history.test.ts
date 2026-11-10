import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { assertCalendarPolicyHistoryIntegrity, readRegularTutoringPausedAt } from "./calendar-policy-history";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());

it("captures raw semantic writes and deletion without treating reason/editor changes as policy", async () => {
  const rollback = new Error("Rollback synthetic policy history");
  await expect(db.$transaction(async (tx) => {
    const date = "2097-02-13";
    await tx.programCalendarDay.create({ data: { date, endDate: "2097-02-20", reason: "Synthetic private reason" } });
    const history = () => tx.programCalendarPolicyRevision.findMany({ where: { date }, orderBy: { id: "asc" } });
    expect(await history()).toHaveLength(1);
    await tx.programCalendarDay.update({ where: { date }, data: { reason: "Reason-only edit", version: { increment: 1 } } });
    expect(await history()).toHaveLength(1);
    await tx.programCalendarDay.update({ where: { date }, data: { schedulingEffect: "PAUSE_REGULAR", version: { increment: 1 } } });
    await tx.programCalendarDay.update({ where: { date }, data: { endDate: "2097-02-19", version: { increment: 1 } } });
    await tx.programCalendarDay.delete({ where: { date } });
    const rows = await history();
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => [row.endDate, row.schedulingEffect, row.active])).toEqual([
      ["2097-02-20", "NOTICE", true], ["2097-02-20", "PAUSE_REGULAR", true],
      ["2097-02-19", "PAUSE_REGULAR", true], ["2097-02-19", "PAUSE_REGULAR", false],
    ]);
    expect(rows.every((row) => !Object.hasOwn(row, "reason"))).toBe(true);
    await tx.$executeRawUnsafe("SAVEPOINT immutable_policy_history");
    await expect(tx.programCalendarPolicyRevision.update({ where: { id: rows[0]!.id }, data: { active: false } })).rejects.toThrow();
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT immutable_policy_history");
    await expect(tx.programCalendarPolicyRevision.delete({ where: { id: rows[0]!.id } })).rejects.toThrow();
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT immutable_policy_history");
    await tx.programCalendarDay.create({ data: { date, endDate: "2097-02-20", reason: "Synthetic restored source", schedulingEffect: "PAUSE_REGULAR" } });
    await tx.$executeRawUnsafe('TRUNCATE "ProgramCalendarDay"');
    const afterTruncate = await history();
    expect(afterTruncate.at(-1)).toMatchObject({ date, endDate: "2097-02-20", schedulingEffect: "PAUSE_REGULAR", active: false });
    expect(afterTruncate).toHaveLength(6);
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
});

it("fails closed for missing semantic capture, truncate, immutable and journal guards", async () => {
  const rollback = new Error("Rollback synthetic policy integrity checks");
  await expect(db.$transaction(async (tx) => {
    for (const [table, trigger] of [
      ["ProgramCalendarDay", "tutoring_policy_revision"],
      ["ProgramCalendarDay", "tutoring_policy_revision_truncated"],
      ["ProgramCalendarPolicyRevision", "tutoring_policy_history_immutable"],
      ["ProgramCalendarPolicyRevision", "recovery_change_journal"],
    ]) {
      await tx.$executeRawUnsafe("SAVEPOINT intact_history_guards");
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
      await expect(assertCalendarPolicyHistoryIntegrity(tx)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(readRegularTutoringPausedAt(tx, "2097-02-13", new Date("2097-02-13T00:00:00Z"))).rejects.toMatchObject({ code: "CONFLICT" });
      const [state] = await tx.$queryRaw<{ valid: boolean }[]>`SELECT scheduling_verify_maintenance_triggers() AS valid`;
      expect(state?.valid).toBe(false);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT intact_history_guards");
    }
    await tx.programCalendarDay.create({ data: { date: "2097-03-13", endDate: "2097-03-14", reason: "Synthetic active policy", schedulingEffect: "PAUSE_REGULAR" } });
    await tx.$executeRawUnsafe('TRUNCATE "ProgramCalendarPolicyRevision"');
    await expect(assertCalendarPolicyHistoryIntegrity(tx)).rejects.toMatchObject({ code: "CONFLICT" });
    // Existing offline fixture/backup resets clear both source and history. They
    // are not operational record edits and do not expose a runtime history writer.
    await tx.$executeRawUnsafe('TRUNCATE "ProgramCalendarDay", "ProgramCalendarPolicyRevision"');
    await expect(assertCalendarPolicyHistoryIntegrity(tx)).resolves.toBeUndefined();
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
});

it("uses intentionally pinned semantic history for the actual start boundary, shortened ranges and overlaps", async () => {
  const rollback = new Error("Rollback synthetic historical policy clock");
  await expect(db.$transaction(async (tx) => {
    const date = "2097-02-13";
    // Fixture timestamps describe synthetic historical events. Production writers
    // have no backdating parameter and always use the database capture clock.
    await tx.programCalendarPolicyRevision.createMany({ data: [
      { date, endDate: "2097-02-20", schedulingEffect: "PAUSE_REGULAR", active: true, version: 1, effectiveAt: new Date("2097-02-01T00:00:00Z") },
      { date, endDate: "2097-02-14", schedulingEffect: "PAUSE_REGULAR", active: true, version: 2, effectiveAt: new Date("2097-02-16T08:00:00Z") },
      { date, endDate: "2097-02-14", schedulingEffect: "PAUSE_REGULAR", active: false, version: 3, effectiveAt: new Date("2097-02-18T00:00:00Z") },
      { date: "2097-02-15", endDate: "2097-02-20", schedulingEffect: "PAUSE_REGULAR", active: true, version: 1, effectiveAt: new Date("2097-02-17T00:00:00Z") },
    ] });
    expect(await readRegularTutoringPausedAt(tx, "2097-02-16", new Date("2097-02-16T07:50:00Z"))).toBe(true);
    expect(await readRegularTutoringPausedAt(tx, "2097-02-16", new Date("2097-02-16T08:01:00Z"))).toBe(false);
    expect(await readRegularTutoringPausedAt(tx, "2097-02-16", new Date("2097-02-19T00:00:00Z"))).toBe(true);
    expect(await readRegularTutoringPausedAt(tx, "2097-02-16", new Date("2097-02-01T00:00:00Z"))).toBe(false);
    throw rollback;
  }, { timeout: 15_000 })).rejects.toBe(rollback);
});
