import { expect, it } from "vitest";
import { approvalPresentation } from "./approval-presentation";

it("shows exact before and requested recipient labels in schedule approval evidence", () => {
  const recipientLabels = { "school@example.test": "School office" };
  const requested = { "school@example.test": "Principal" };
  const model = approvalPresentation(
    "schoolHours.save",
    {
      recipientEmails: ["school@example.test"],
      recipientLabels: requested,
      expectedVersion: 4,
    },
    {
      schoolHoursSchedule: {
        id: "program",
        recipientEmails: ["school@example.test"],
        recipientLabels,
        version: 4,
      },
    },
  );
  expect(model.summary.changes).toEqual([
    expect.objectContaining({
      key: "recipientLabels",
      before: recipientLabels,
      requested,
      hasBefore: true,
    }),
  ]);
});
