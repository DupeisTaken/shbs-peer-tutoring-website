import { expect, it } from "vitest";
import {
  assignedBlocks,
  effectivePreferredMaximum,
  proposedAssignedCount,
  workloadWarning,
  type AssignedBlock,
} from "./tutor-workload";
const row = (
  id: string,
  fields: Partial<AssignedBlock> = {},
): AssignedBlock => ({
  id,
  tutorId: "tutor",
  termId: "term",
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 900,
  endMin: 960,
  ...fields,
});
it("counts explicit valid groups once and keeps independent matching clocks and quarters separate", () => {
  expect(
    assignedBlocks([
      row("math", { groupId: "shared" }),
      row("english", { groupId: "shared" }),
      row("math", { groupId: "shared" }),
      row("other", { termId: "other" }),
      row("later", { startMin: 960, endMin: 1020 }),
    ]),
  ).toHaveLength(3);
  expect(assignedBlocks([])).toEqual([]);
});
it("never merges unscheduled placeholder times", () => {
  expect(
    assignedBlocks([
      row("a", { scheduleConfirmed: false }),
      row("b", { scheduleConfirmed: false }),
      row("scheduled"),
    ]),
  ).toHaveLength(3);
});
it("projects joining, moving one shared member, replacing the sole member and empty-roster removal", () => {
  const shared = assignedBlocks([row("a", { groupId: "shared" }), row("b", { groupId: "shared" })]);
  expect(proposedAssignedCount(shared, [{ block: row("new", { groupId: "shared" }) }])).toBe(1);
  expect(
    proposedAssignedCount(shared, [
      { replacingPairingId: "a", block: row("a", { dayOfWeek: 2 }) },
    ]),
  ).toBe(2);
  expect(
    proposedAssignedCount(assignedBlocks([row("a")]), [
      { replacingPairingId: "a", block: row("a", { dayOfWeek: 2 }) },
    ]),
  ).toBe(1);
  expect(
    proposedAssignedCount(shared, [
      { replacingPairingId: "a" },
      { replacingPairingId: "b" },
    ]),
  ).toBe(0);
});
it("counts unscheduled explicit groups once, independent equal clocks separately, and invalid groups per assignment", () => {
  expect(assignedBlocks([
    row("a", { groupId: "shared", scheduleConfirmed: false }),
    row("b", { groupId: "shared", scheduleConfirmed: false }),
    row("independent-a"), row("independent-b"),
    row("invalid-a", { groupId: "invalid", groupValid: false }),
    row("invalid-b", { groupId: "invalid", groupValid: false }),
  ])).toHaveLength(5);
});
it("aggregates a two-subject unscheduled proposal instead of warning on each independent +1", () => {
  expect(
    proposedAssignedCount(
      [],
      [
        { block: row("a", { scheduleConfirmed: false }) },
        { block: row("b", { scheduleConfirmed: false }) },
      ],
    ),
  ).toBe(2);
});
it("distinguishes unset/zero and reached/over/proposed-over without warning on a no-increment join", () => {
  expect(workloadWarning(0, 1, null)).toBeNull();
  expect(workloadWarning(0, 0, 0)).toBe("reached");
  expect(workloadWarning(0, 1, 0)).toBe("proposedOver");
  expect(workloadWarning(2, 2, 2)).toBe("reached");
  expect(workloadWarning(3, 3, 2)).toBe("over");
  expect(workloadWarning(2, 3, 2)).toBe("proposedOver");
  expect(effectivePreferredMaximum("ACTIVE", null)).toBeNull();
  expect(effectivePreferredMaximum("OPTED_OUT", 4)).toBe(0);
});
