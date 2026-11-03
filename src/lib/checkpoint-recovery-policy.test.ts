import { expect, it } from "vitest";
import {
  classifyApproval,
  COORDINATOR_DIRECT_OPERATIONS,
} from "./approval-policy";

it("routes ordinary checkpoint restoration through current Admin/Head review", () => {
  expect(classifyApproval("recovery.restoreCheckpoint")).toEqual({
    category: "REVERSAL",
    directRoles: ["ADMIN", "HEAD"],
    requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"],
    reviewerRoles: ["ADMIN", "HEAD"],
  });
  expect(COORDINATOR_DIRECT_OPERATIONS.has("recovery.captureCheckpoint")).toBe(
    true,
  );
});
it("retains Head-only refresh reversal authority from trusted context rather than a requester claim", () => {
  expect(
    classifyApproval(
      "recovery.restoreCheckpoint",
      { adapter: "PARTICIPANT_TUTOR" },
      { checkpointRequiresHead: true },
    ),
  ).toMatchObject({
    directRoles: ["HEAD"],
    requesterRoles: ["ADMIN", "HEAD"],
    reviewerRoles: ["HEAD"],
  });
  expect(
    classifyApproval("recovery.restoreCheckpoint", {
      checkpointRequiresHead: true,
    }),
  ).toMatchObject({ directRoles: ["ADMIN", "HEAD"] });
});
