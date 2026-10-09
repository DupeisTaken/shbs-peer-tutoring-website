/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ApprovalReviewDetails } from "./approval-review-details";

afterEach(cleanup);
it.each(["en", "zh"])("localizes known signup field request values (%s)", (locale) => {
  show("program.setSignupField", { form: "tutee", field: "phone", state: "required", expectedState: "optional" }, {}, locale);
  const copy = locale === "en" ? en : zh;
  expect(screen.getByText(copy.signupFields.tutee)).toBeTruthy();
  expect(screen.getByText(copy.signupFields.labels.phone)).toBeTruthy();
  expect(screen.getByText(copy.signupFields.required)).toBeTruthy();
  expect(screen.queryByText("expectedState")).toBeNull();
});
it("retains unknown signup field values and unrelated literal text", () => {
  show("program.setSignupField", { form: "legacy", field: "retiredField", state: "retiredState", reason: "required" });
  for (const value of ["legacy", "retiredField", "retiredState", "required"]) expect(screen.getByText(value)).toBeTruthy();
});
it.each(["GRADUATED", "TRANSFERRED", "RETURN", "REVOKE", "RESTORE"])(
  "preserves readable departure actions and their consequences (%s)",
  (action) => {
    show("departure.setState", {
      userId: "person",
      action,
      expectedRevision: 5,
      explanation: "Request details",
    });
    expect(
      screen.getByText(
        en.approvals.review.values[
          action as keyof typeof en.approvals.review.values
        ],
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        action === "RETURN"
          ? en.schoolDeparture.returnHelp
          : ["REVOKE", "RESTORE"].includes(action)
            ? en.schoolDeparture.accessHelp
            : en.schoolDeparture.consequences,
      ),
    ).toBeTruthy();
    expect(screen.getByText(en.schoolDeparture.retained)).toBeTruthy();
    expect(screen.queryByText("Expected Revision")).toBeNull();
  },
);
function show(
  operation: string,
  payload: unknown,
  targets: unknown = {},
  locale = "en",
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? en : zh}
    >
      <ApprovalReviewDetails
        operation={operation}
        payload={payload}
        targets={targets}
      />
    </NextIntlClientProvider>,
  );
}
it("places the old and requested values together and keeps unchanged fields out of the change list", () => {
  show(
    "admin.updateRoom",
    { id: "room", name: "Quiet study", active: true },
    { Room: [{ record: { id: "room", name: "Science room", active: true } }] },
  );
  const requested = within(
    screen.getByRole("region", { name: "What is requested" }),
  );
  expect(requested.getByText("At submission")).toBeTruthy();
  expect(requested.getByText("Science room")).toBeTruthy();
  expect(requested.getByText("Quiet study")).toBeTruthy();
  expect(requested.queryByText("Active")).toBeNull();
  expect(screen.getByText("Unchanged submitted values (1)")).toBeTruthy();
});
it.each(["en", "zh"])(
  "explains a requested rejection instead of showing false (%s)",
  (locale) => {
    show(
      "studentWorkflow.resolveReview",
      { id: "review", approve: false, ticket: "private-ticket" },
      {},
      locale,
    );
    expect(
      screen.getByText(
        locale === "en" ? "Reject the underlying request" : "拒绝原申请",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("false")).toBeNull();
    expect(screen.queryByText("private-ticket")).toBeNull();
    expect(screen.queryByText("At submission")).toBeNull();
  },
);
it("retains literal text that happens to match a record ID or enum", () => {
  show(
    "admin.updateRoom",
    { id: "room", name: "ACTIVE", reason: "room" },
    { Room: [{ record: { id: "room", name: "Old" } }] },
  );
  expect(screen.getByText("ACTIVE")).toBeTruthy();
  expect(screen.getByText("room")).toBeTruthy();
});
it("separates cleared values from missing historical values", () => {
  show(
    "admin.updateRoom",
    { id: "room", name: "", capacity: 0 },
    { Room: [{ record: { id: "room", name: "Old" } }] },
  );
  expect(screen.getByText("Not set")).toBeTruthy();
  expect(screen.getByText("Not recorded in this request")).toBeTruthy();
  expect(screen.getByText("0")).toBeTruthy();
});
it("makes deletion explicit even when the payload contains only an ID", () => {
  show(
    "admin.deleteRoom",
    { id: "room" },
    { Room: [{ record: { id: "room", name: "Science room" } }] },
  );
  expect(
    screen.getByText("This request deletes the record shown below."),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "What is requested" })).getByText(
      "Science room",
    ),
  ).toBeTruthy();
});
it("keeps room block times human-readable and shows the saved room", () => {
  show(
    "admin.updateRoomUnavailability",
    {
      id: "block",
      dayOfWeek: 2,
      startMin: 780,
      endMin: 840,
      reason: "Assembly",
    },
    {
      roomBlockContext: { id: "room", name: "Science room" },
      RoomUnavailability: [
        {
          record: {
            id: "block",
            roomId: "room",
            dayOfWeek: 1,
            startMin: 720,
            endMin: 780,
          },
        },
      ],
    },
  );
  const requested = within(
    screen.getByRole("region", { name: "What is requested" }),
  );
  expect(requested.getByText("Science room")).toBeTruthy();
  expect(requested.getByText("12:00–13:00")).toBeTruthy();
  expect(requested.getByText("13:00–14:00")).toBeTruthy();
});
it("formats nested membership choices, dates and known enum values without JSON or booleans", () => {
  show(
    "admin.setMemberships",
    {
      userId: "account",
      membership: { rank: "COORDINATOR", translator: true, crew: false },
    },
    { User: [{ record: { id: "account", name: "Alex" } }] },
  );
  const requested = within(
    screen.getByRole("region", { name: "What is requested" }),
  );
  expect(requested.getByText("Coordinator")).toBeTruthy();
  expect(requested.getByText("Yes")).toBeTruthy();
  expect(requested.getByText("No")).toBeTruthy();
  expect(requested.queryByText(/true|false/)).toBeNull();
});
it("keeps unknown operation fields readable without dropping the request", () => {
  show(
    "legacy.doSomething",
    { id: "old-id", customField: "Retained evidence" },
    null,
  );
  expect(screen.getByText("Record ID: old-id")).toBeTruthy();
  expect(screen.getByText("Retained evidence")).toBeTruthy();
  expect(screen.getByText("Custom Field")).toBeTruthy();
});
