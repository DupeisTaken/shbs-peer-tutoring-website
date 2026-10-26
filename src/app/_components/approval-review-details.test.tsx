/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ApprovalReviewDetails } from "./approval-review-details";

afterEach(cleanup);
it.each(["en", "zh"])(
  "renders offset-free captured UTC dates in the program zone (%s)",
  (locale) => {
    show(
      "corrections.correctAttendance",
      { id: "session", date: new Date("2026-10-25T01:00:00Z") },
      { Session: [{ id: "session", date: "2026-10-25T00:00:00" }] },
      locale,
    );
    expect(screen.getAllByText(/8:00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9:00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/12:00 AM/)).toBeNull();
  },
);

it.each(["en", "zh"])(
  "does not show unchanged restored patrol timestamps as changed fields (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const stored = "2026-10-27T09:00:00+08:00";
    const restored = new Date("2026-10-27T01:00:00.000Z");
    show(
      "corrections.correctPatrol",
      {
        id: "patrol",
        observations: [
          {
            id: "changed",
            observedAt: restored,
            headcount: "TWO",
            roomId: "room",
          },
          {
            id: "stable",
            observedAt: restored,
            headcount: "ONE",
            roomId: "room",
          },
        ],
      },
      {
        Patrol: [{ id: "patrol" }],
        "Patrol.PatrolObservation": [
          {
            id: "changed",
            patrolId: "patrol",
            observedAt: stored,
            headcount: "ONE",
            roomId: "room",
          },
          {
            id: "stable",
            patrolId: "patrol",
            observedAt: stored,
            headcount: "ONE",
            roomId: "room",
          },
        ],
      },
      locale,
      true,
    );
    const requested = within(
      screen.getByRole("region", { name: copy.approvals.review.requested }),
    );
    expect(
      requested.getByText(
        locale === "en"
          ? "1 changed · 0 added · 0 removed · 1 unchanged rows"
          : "已更改 1 行 · 已添加 0 行 · 已移除 0 行 · 未更改 1 行",
      ),
    ).toBeTruthy();
    expect(
      requested.getByRole("heading", {
        name: copy.approvals.review.fields.headcount,
      }),
    ).toBeTruthy();
    expect(
      requested.queryByRole("heading", {
        name: copy.approvals.review.fields.observedAt,
      }),
    ).toBeNull();
  },
);

it.each(["en", "zh"])(
  "shows a merged attendance correction without inventing roster additions (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "corrections.correctAttendance",
      {
        id: "primary",
        tutees: [
          { tuteeId: "a", status: "PRESENT", absenceReason: null },
          {
            tuteeId: "b",
            status: "EXCUSED_ABSENT",
            absenceReason: "Recorded excuse",
          },
        ],
      },
      {
        reviewPresentation: { version: 1 },
        Session: [
          { id: "primary", mergeGroupId: "primary" },
          { id: "sibling", mergeGroupId: "primary" },
        ],
        "Session.SessionTutee": [
          {
            sessionId: "primary",
            tuteeId: "a",
            status: "PRESENT",
            absenceReason: null,
          },
          {
            sessionId: "sibling",
            tuteeId: "b",
            status: "UNEXCUSED_ABSENT",
            absenceReason: null,
          },
        ],
      },
      locale,
      true,
    );
    const requested = within(
      screen.getByRole("region", { name: copy.approvals.review.requested }),
    );
    expect(
      requested.getByText(
        locale === "en"
          ? "1 changed · 0 added · 0 removed · 1 unchanged rows"
          : "已更改 1 行 · 已添加 0 行 · 已移除 0 行 · 未更改 1 行",
      ),
    ).toBeTruthy();
    expect(
      requested.queryByText(copy.approvals.review.collectionState.added),
    ).toBeNull();
    expect(
      screen.getByText(copy.approvals.review.attendanceOutcome),
    ).toBeTruthy();
  },
);

it.each(["en", "zh"])(
  "renders immutable next-period approval evidence and an explicit clear (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const target = {
      sourceTermId: "old-source",
      sourceSchoolYear: "26-27",
      sourceQuarter: "Q4",
      destinationSchoolYear: "27-28",
      destinationQuarter: "Q1",
      semesterMode: false,
      modeRevision: 7,
    };
    show(
      "program.prepareNextRecruitment",
      {
        audience: "tutor",
        opensAt: null,
        expectedTarget: target,
        expectedVersion: 3,
      },
      {
        nextRecruitment: {
          audience: "tutor",
          currentName: "26-27 Q4",
          nextName: "27-28 Q1",
          target,
          timeZone: "Asia/Shanghai",
          preparation: {
            target,
            version: 3,
            opensAt: "2027-09-01T01:00:00.000Z",
            timeZone: "Asia/Shanghai",
          },
          destinationClosesAt: null,
        },
      },
      locale,
    );
    expect(screen.getByText("26-27 Q4")).toBeTruthy();
    expect(screen.getByText("27-28 Q1")).toBeTruthy();
    expect(screen.getByText(copy.nextRecruitment.proposedOpening)).toBeTruthy();
    expect(screen.getByText(copy.nextRecruitment.noRestriction)).toBeTruthy();
    expect(screen.queryByText(copy.nextRecruitment.tutee)).toBeNull();
    expect(screen.queryByText("Expected Target")).toBeNull();
  },
);

it("does not invent next-period evidence for a legacy refresh request", () => {
  show("admin.refresh", { confirm: "REFRESH", expectedTermId: "legacy" }, {});
  expect(screen.getByText(en.approvals.review.unavailable)).toBeTruthy();
  expect(screen.queryByText(en.nextRecruitment.noRestriction)).toBeNull();
});

it.each(["en", "zh"])(
  "shows the captured refresh consequences and academic reconfirmation in the Head review (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const target = {
      sourceTermId: "historical-source",
      sourceSchoolYear: "26-27",
      sourceQuarter: "Q3",
      destinationSchoolYear: "27-28",
      destinationQuarter: "Q1",
      semesterMode: true,
      modeRevision: 4,
    };
    const snapshot = {
      target,
      currentName: "26-27 S2",
      nextName: "27-28 S1",
      timeZone: "Asia/Shanghai",
      preparations: { tutor: null, tutee: null },
      refreshEvidence: { destination: null },
    };
    show(
      "admin.refresh",
      { confirm: "REFRESH" },
      { nextRecruitment: snapshot },
      locale,
    );
    expect(screen.getByText(copy.admin.program.effectTutees)).toBeTruthy();
    expect(screen.getByText(copy.admin.program.effectPairings)).toBeTruthy();
    expect(screen.getByText(copy.admin.program.effectReactivate)).toBeTruthy();
    expect(screen.getByText(copy.nextRecruitment.graduationHelp)).toBeTruthy();
    expect(
      screen.getByText(copy.nextRecruitment.academicReconfirm),
    ).toBeTruthy();
    expect(screen.getByText(copy.nextRecruitment.historyHelp)).toBeTruthy();
    expect(screen.queryByText(copy.admin.program.effectAgeUp)).toBeNull();
    expect(
      screen.getByText(
        copy.admin.program.effectHoursReset.replace("{semester}", "S1"),
      ),
    ).toBeTruthy();
  },
);
it.each(["en", "zh"])(
  "localizes name-policy roles/requirements and preserves ordered room names (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "program.setNameFields",
      {
        accountType: "STUDENT",
        states: {
          firstName: "hidden",
          lastName: "optional",
          preferredName: "optional",
          alternativeNames: "optional",
        },
        expectedVersion: 0,
      },
      { programSettings: null },
      locale,
    );
    expect(screen.getByText(copy.admin.users.roles.STUDENT)).toBeTruthy();
    expect(
      screen.getAllByText(copy.personName.firstName).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(copy.signupFields.hidden)).toBeTruthy();
    expect(screen.queryByText("Expected Version")).toBeNull();
    cleanup();
    show(
      "admin.reorderRooms",
      { ids: ["b", "a"], expectedIds: ["a", "b"] },
      {
        roomOrder: [
          { id: "a", name: "Original Alpha", programOrder: 0 },
          { id: "b", name: "Original Beta", programOrder: 1 },
        ],
      },
      locale,
    );
    expect(screen.getByText(copy.roomOrder.title)).toBeTruthy();
    expect(screen.getAllByText("Original Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Original Beta").length).toBeGreaterThan(0);
    expect(screen.queryByText("Expected Ids")).toBeNull();
  },
);
it.each(["en", "zh"])(
  "names invalid-flag proposals and hides their version evidence (%s)",
  (locale) => {
    show(
      "admin.setApplicationInvalidity",
      {
        id: "application-1",
        invalid: true,
        reason: "Duplicate public submission.",
        expectedInvalidityVersion: 2,
      },
      {
        TutorApplication: [
          {
            record: {
              id: "application-1",
              name: "Taylor Student",
              invalidityVersion: 2,
            },
          },
        ],
      },
      locale,
    );
    const copy = locale === "en" ? en : zh;
    expect(screen.getByText(copy.approvals.review.fields.invalid)).toBeTruthy();
    expect(screen.getByText("Duplicate public submission.")).toBeTruthy();
    expect(screen.queryByText("Expected Invalidity Version")).toBeNull();
    expect(screen.queryByText("Invalidity Version")).toBeNull();
  },
);
it.each(["en", "zh"])(
  "localizes known signup field request values (%s)",
  (locale) => {
    show(
      "program.setSignupField",
      {
        form: "tutee",
        field: "phone",
        state: "required",
        expectedState: "optional",
      },
      {},
      locale,
    );
    const copy = locale === "en" ? en : zh;
    expect(screen.getByText(copy.signupFields.tutee)).toBeTruthy();
    expect(screen.getByText(copy.signupFields.labels.phone)).toBeTruthy();
    expect(screen.getByText(copy.signupFields.required)).toBeTruthy();
    expect(screen.queryByText("expectedState")).toBeNull();
  },
);
it("retains unknown signup field values and unrelated literal text", () => {
  show("program.setSignupField", {
    form: "legacy",
    field: "retiredField",
    state: "retiredState",
    reason: "required",
  });
  for (const value of ["legacy", "retiredField", "retiredState", "required"])
    expect(screen.getByText(value)).toBeTruthy();
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
  compact = false,
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
        compact={compact}
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
  "promotes the actual STUDENT_ABORT identity, reason and underlying outcome (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const reason = "Unable to continue this period.\n本学期无法继续。";
    show(
      "studentWorkflow.resolveReview",
      { id: "review", approve: false },
      {
        StudentRequestReview: [
          {
            record: {
              id: "review",
              kind: "STUDENT_ABORT",
              surveyId: "survey",
              reason,
            },
          },
        ],
        StudentSurvey: [{ record: { id: "survey", tuteeId: "student" } }],
        Tutee: [
          { record: { id: "unrelated", englishName: "Unrelated person" } },
          { record: { id: "student", englishName: "Captured Student" } },
        ],
      },
      locale,
    );
    const affected = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(affected.getByText("Captured Student")).toBeTruthy();
    expect(
      affected.getByText(copy.approvals.review.values.STUDENT_ABORT),
    ).toBeTruthy();
    expect(
      affected.getByText((_, element) => element?.textContent === reason),
    ).toBeTruthy();
    expect(
      affected.getByText(copy.approvals.review.rejectUnderlying),
    ).toBeTruthy();
    expect(affected.queryByText("Unrelated person")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "uses person-name labels for profile changes (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.updateAccountProfile",
      {
        userId: "person",
        firstName: "New",
        lastName: "Family",
        preferredName: "Preferred",
        alternativeNames: "另一个名字",
      },
      {
        User: [
          {
            record: {
              id: "person",
              name: "Captured Person",
              firstName: "Old",
              lastName: "Old family",
              preferredName: null,
              alternativeNames: null,
            },
          },
        ],
      },
      locale,
    );
    for (const key of [
      "firstName",
      "lastName",
      "preferredName",
      "alternativeNames",
    ] as const)
      expect(
        screen.getByRole("heading", { name: copy.personName[key] }),
      ).toBeTruthy();
  },
);

it.each(["en", "zh"])(
  "keeps exact multiline publication text and recorded empty values in compact confirmation (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const proposed = "第一行\n  Indented second line\n";
    show(
      "translationReview.decide",
      { id: "draft", approve: true },
      {
        TranslationDraft: [
          {
            record: {
              id: "draft",
              operation: "localization.setString",
              payload: { key: "public.welcome", locale: "zh", value: proposed },
            },
          },
        ],
        destination: {
          translation: [
            { key: "public.welcome", locale: "en", value: "Wrong locale" },
            { key: "public.welcome", locale: "zh", value: "" },
          ],
        },
      },
      locale,
      true,
    );
    expect(
      screen.getByText((_, element) => element?.textContent === proposed),
    ).toBeTruthy();
    expect(screen.getByText(copy.approvals.review.emptyValue)).toBeTruthy();
    expect(screen.queryByText(copy.approvals.review.unavailable)).toBeNull();
    expect(screen.queryByText("Wrong locale")).toBeNull();
    expect(screen.getByText(copy.approvals.review.publishOutcome)).toBeTruthy();
    expect(screen.queryByText(copy.approvals.review.evidence)).toBeNull();
  },
);

it.each(["en", "zh"])(
  "distinguishes absent publication evidence from a recorded empty destination (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "translationReview.decide",
      { id: "draft", approve: false },
      {
        TranslationDraft: [
          {
            record: {
              id: "draft",
              operation: "home.setContent",
              payload: {
                key: "welcome",
                locale: "zh",
                value: "Exact publication",
              },
            },
          },
        ],
        destination: { content: [] },
      },
      locale,
      true,
    );
    expect(screen.getByText(copy.approvals.review.unavailable)).toBeTruthy();
    expect(screen.queryByText(copy.approvals.review.emptyValue)).toBeNull();
    expect(
      screen.getByText(copy.approvals.review.rejectPublicationOutcome),
    ).toBeTruthy();
  },
);

it.each(["en", "zh"])(
  "explains staged and cleared feature overrides using captured default evidence (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    for (const pending of [null, false]) {
      show(
        "program.setFeaturePending",
        { key: "CREW", enabled: pending === null ? false : true },
        {
          reviewPresentation: {
            version: 1,
            feature: {
              key: "CREW",
              effective: true,
              pending,
              source: "default",
            },
          },
        },
        locale,
      );
      expect(
        screen.getByText(copy.approvals.review.featureSource.default),
      ).toBeTruthy();
      expect(
        screen.getByText(
          copy.approvals.review.featureOutcome[
            pending === null ? "stage" : "clear"
          ],
        ),
      ).toBeTruthy();
      expect(
        screen.getAllByText(copy.approvals.review.noPending).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(copy.admin.program.features.name.CREW),
      ).toBeTruthy();
      cleanup();
    }
  },
);

it.each(["en", "zh"])(
  "distinguishes a known empty membership list from uncaptured children (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    for (const captured of [true, false]) {
      show(
        "admin.updatePairing",
        { id: "pairing", tuteeIds: ["student"] },
        {
          Pairing: [{ record: { id: "pairing" } }],
          Tutee: [{ record: { id: "student", englishName: "New member" } }],
          ...(captured ? { "Pairing.PairingTutee": [] } : {}),
        },
        locale,
        true,
      );
      const requested = within(
        screen.getByRole("region", { name: copy.approvals.review.requested }),
      );
      if (captured) {
        expect(
          requested.getByText(copy.approvals.review.collectionState.added),
        ).toBeTruthy();
        expect(
          requested.queryByText(copy.approvals.review.unavailable),
        ).toBeNull();
      } else {
        expect(
          requested.getByText(copy.approvals.review.unavailable),
        ).toBeTruthy();
        expect(
          requested.queryByText(copy.approvals.review.collectionState.added),
        ).toBeNull();
      }
      cleanup();
    }
  },
);

it.each(["en", "zh"])(
  "collapses the proposed-change section without hiding affected identity or changing its evidence (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.updateRoom",
      { id: "room", name: "New room" },
      { Room: [{ record: { id: "room", name: "Original room" } }] },
      locale,
    );
    const toggle = screen.getByRole("button", {
      name: `${copy.approvals.review.requested} ${copy.approvals.review.collapse}`,
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: copy.approvals.review.fields.name,
      }),
    ).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("New room")).toBeTruthy();
    expect(screen.getAllByText("Original room").length).toBeGreaterThan(0);
  },
);
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
      screen.getAllByText(
        locale === "en" ? "Reject the underlying request" : "拒绝原申请",
      ).length,
    ).toBeGreaterThan(0);
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
    within(screen.getByRole("region", { name: "Affected record" })).getByText(
      "This request deletes the record shown below.",
    ),
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
