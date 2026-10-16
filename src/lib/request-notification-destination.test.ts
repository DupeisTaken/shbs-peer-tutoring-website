import { expect, it } from "vitest";
import {
  requestBoardTarget,
  requestStaffDestination,
} from "./request-notification-destination";
import { notificationDestination } from "~/server/email/urls";
it.each(["application", "survey", "signup"] as const)(
  "uses the authorized source workflow for %s without a public token",
  (kind) => {
    const path = requestStaffDestination({ kind, id: "source_123" });
    expect(path).toContain(
      kind === "application"
        ? "/admin/applications#application-source_123"
        : `/admin/requests#request-${kind}-source_123`,
    );
    expect(path).not.toContain("token");
    expect(
      notificationDestination(
        "info",
        "request_invalidity_appeal_pending",
        path,
        "ADMIN",
      ),
    ).toBe(path);
    expect(
      notificationDestination(
        "info",
        "request_invalidity_appeal_pending",
        path,
        "STUDENT",
      ),
    ).toBe("/");
  },
);
it("recognizes only bounded explicit source hashes", () => {
  expect(requestBoardTarget("#request-survey-source_123")).toEqual({
    kind: "survey",
    id: "source_123",
  });
  expect(requestBoardTarget("#request-signup-legacy_123")).toEqual({
    kind: "signup",
    id: "legacy_123",
  });
  for (const invalid of [
    "#request-survey-",
    "#request-user-123",
    "#request-survey-%3Cscript%3E",
    "#request-survey-" + "a".repeat(129),
    "#request-survey-123?token=secret",
  ])
    expect(requestBoardTarget(invalid)).toBeNull();
});
