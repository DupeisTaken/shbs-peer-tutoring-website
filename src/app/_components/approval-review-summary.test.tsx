/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ApprovalReviewDetails } from "./approval-review-details";
import { APPROVAL_OPERATIONS } from "~/lib/approval-policy";

afterEach(cleanup);

it.each(["en", "zh"])(
  "shows the captured recovery applicant and reason without technical hashes (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "recovery.voidAdmission",
      {
        actionId: "synthetic-admission",
        reason: "Review the mistaken admission",
        clientKey: "technical-retry-key",
        expectedFingerprint: "technical-evidence-hash",
      },
      {
        version: 1,
        actionId: "synthetic-admission",
        applicantName: "Synthetic Avery",
      },
      locale,
    );
    expect(screen.getByText("Synthetic Avery")).toBeTruthy();
    expect(
      screen.getByText(
        copy.approvals.review.recordId.replace("{id}", "synthetic-admission"),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(copy.auditEventDetails.presentation.fields.actionId),
    ).toBeTruthy();
    expect(screen.getByText("Review the mistaken admission")).toBeTruthy();
    expect(screen.queryByText("technical-retry-key")).toBeNull();
    expect(screen.queryByText("technical-evidence-hash")).toBeNull();
  },
);

function show(
  operation: string,
  payload: unknown,
  targets: unknown,
  locale = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <ApprovalReviewDetails
        operation={operation}
        payload={payload}
        targets={targets}
        summaryOnly
      />
    </NextIntlClientProvider>,
  );
}

it.each(["en", "zh"])(
  "keeps named assignment changes visible without opening the full review (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.updatePairing",
      {
        id: "pair",
        tutorId: "new-tutor",
        tuteeIds: ["kept", "added"],
        roomMode: "FIXED",
      },
      {
        Pairing: [
          {
            id: "pair",
            tutorId: "old-tutor",
            subject: "Physics",
            dayOfWeek: 2,
            startMin: 960,
            endMin: 1020,
            roomMode: "AUTO",
          },
        ],
        "Pairing.PairingTutee": [
          { pairingId: "pair", tuteeId: "kept" },
          { pairingId: "pair", tuteeId: "removed" },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            Tutor: [
              { id: "old-tutor", englishName: "Jordan Wu" },
              { id: "new-tutor", englishName: "Alex Chen" },
            ],
            Tutee: [
              { id: "kept", englishName: "Mina Li" },
              { id: "removed", englishName: "Sam Lee" },
              { id: "added", englishName: "Sam Lee" },
            ],
          },
        },
      },
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getAllByText("Jordan Wu").length).toBeGreaterThan(0);
    expect(summary.getByText("Alex Chen")).toBeTruthy();
    expect(summary.getByText("Physics")).toBeTruthy();
    expect(summary.getAllByText("Sam Lee").length).toBeGreaterThan(1);
    expect(summary.getAllByText(/removed/).length).toBeGreaterThan(0);
    expect(summary.getAllByText(/added/).length).toBeGreaterThan(0);
    expect(
      summary.getByText(copy.approvals.review.collectionState.added),
    ).toBeTruthy();
    expect(
      summary.getByText(copy.approvals.review.collectionState.removed),
    ).toBeTruthy();
    expect(
      summary.getByText(
        copy.auditEventDetails.presentation.enums.PairingRoomMode.FIXED,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "explains missing and conflicting historical identity instead of borrowing names (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.updatePairing",
      { id: "pair", tutorId: "new" },
      {
        Pairing: [{ id: "pair", tutorId: "missing" }],
        Tutor: [
          { id: "new", englishName: "First capture" },
          { id: "new", englishName: "Conflicting capture" },
        ],
        User: [{ id: "missing", name: "Wrong entity name" }],
      },
      locale,
    );
    const content = screen.getByRole("region", {
      name: copy.approvals.review.affected,
    }).textContent;
    expect(content).toContain(
      copy.approvals.review.referenceMissing.replace(
        "{entity}",
        copy.auditEventDetails.presentation.entities.Tutor,
      ),
    );
    expect(content).toContain(
      copy.approvals.review.referenceAmbiguous.replace(
        "{entity}",
        copy.auditEventDetails.presentation.entities.Tutor,
      ),
    );
    expect(content).not.toContain("Wrong entity name");
    expect(content).not.toContain("First capture");
    expect(content).toContain("missing");
    expect(content).toContain("new");
  },
);

it.each(["en", "zh"])(
  "keeps the primary account ID beside its captured name in upfront profile context (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const accountId = "synthetic-profile-account";
    show(
      "admin.updateAccountProfile",
      {
        userId: accountId,
        name: "Updated Account Name",
        firstName: "Updated",
        lastName: "Account",
        preferredName: null,
        alternativeNames: null,
        expectedProfileVersion: 0,
      },
      {
        User: [
          {
            record: {
              id: accountId,
              name: "Captured Account Name",
              firstName: "Captured",
              lastName: "Account",
              preferredName: null,
              alternativeNames: null,
            },
          },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            User: [
              {
                id: accountId,
                name: "Captured Account Name",
                username: "captured-account",
              },
            ],
          },
        },
      },
      locale,
    );
    const affected = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    const context = affected.getByText(copy.approvals.review.fields.userId, {
      selector: "dt",
    }).parentElement!;
    expect(within(context).getByText("Captured Account Name")).toBeTruthy();
    expect(
      within(context).getByText(
        copy.approvals.review.recordId.replace("{id}", accountId),
      ),
    ).toBeTruthy();
  },
);

it.each(["en", "zh"])(
  "keeps distinct learner IDs for same-name nested references in upfront assignment context (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const pairingId = "synthetic-pairing-context";
    const learnerIds = ["synthetic-learner-one", "synthetic-learner-two"];
    show(
      "admin.updatePairing",
      {
        id: pairingId,
        tutorId: "synthetic-tutor",
        timeSlotId: "synthetic-slot",
        subject: "Captured Physics",
        roomMode: "NONE",
        expectedRoomVersion: 0,
        tuteeIds: learnerIds,
      },
      {
        Pairing: [
          {
            record: {
              id: pairingId,
              tutorId: "synthetic-tutor",
              timeSlotId: "synthetic-slot",
              subject: "Captured Physics",
              roomMode: "NONE",
              dayOfWeek: 2,
              startMin: 900,
              endMin: 960,
            },
          },
        ],
        "Pairing.PairingTutee": learnerIds.map((tuteeId) => ({
          record: { pairingId, tuteeId },
        })),
        reviewReferences: {
          version: 1,
          entities: {
            Tutor: [{ id: "synthetic-tutor", englishName: "Captured Tutor" }],
            Tutee: learnerIds.map((id) => ({
              id,
              englishName: "Same Captured Name",
            })),
            TimeSlot: [
              {
                id: "synthetic-slot",
                label: "Captured Slot",
                dayOfWeek: 2,
                startMin: 900,
                endMin: 960,
              },
            ],
          },
        },
      },
      locale,
    );
    const affected = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    const context = affected.getByText(copy.approvals.review.fields.id, {
      selector: "dt",
    }).parentElement!;
    expect(within(context).getAllByText("Same Captured Name")).toHaveLength(2);
    for (const id of learnerIds)
      expect(
        within(context).getByText(
          copy.approvals.review.recordId.replace("{id}", id),
        ),
      ).toBeTruthy();
  },
);

it("preserves literal names and exact multiline changes, including an empty original", () => {
  const text = "PRESENT\n  Keep indentation.\n";
  show(
    "localization.setString",
    { key: "sample", locale: "en", value: text },
    { translation: [{ key: "sample", locale: "en", value: "" }] },
  );
  expect(
    screen.getByRole("region", { name: en.approvals.review.affected })
      .textContent,
  ).toContain(text);
  expect(screen.getByText(en.auditEventDetails.emptyString)).toBeTruthy();
});

it("identifies a captured no-op without claiming an action was applied", () => {
  show(
    "admin.updateRoom",
    { id: "room", name: "Unchanged" },
    { Room: [{ id: "room", name: "Unchanged" }] },
  );
  expect(screen.getByText(en.approvals.review.noFieldChanges)).toBeTruthy();
  expect(screen.queryByRole("definition")).not.toBeNull();
  expect(screen.queryByText(en.approvals.review.summaryChanges)).toBeNull();
});

it.each(["en", "zh"])(
  "names actual meeting-attendance entries and their schema-owned status (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.recordMeetingAttendance",
      {
        meetingId: "meeting",
        entries: [
          { tutorId: "present-tutor", status: "PRESENT" },
          { tutorId: "exempt-tutor", status: "EXEMPT" },
        ],
      },
      {
        TutorMeeting: [
          { record: { id: "meeting", title: "Synthetic meeting" } },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            Tutor: [
              { id: "present-tutor", englishName: "Present Tutor" },
              { id: "exempt-tutor", englishName: "Exempt Tutor" },
            ],
          },
        },
      },
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getByText("Present Tutor")).toBeTruthy();
    expect(summary.getByText("Exempt Tutor")).toBeTruthy();
    expect(
      summary.getByText(
        copy.auditEventDetails.presentation.enums.MeetingAttendanceStatus
          .EXEMPT,
      ),
    ).toBeTruthy();
    expect(
      summary.getAllByText(copy.approvals.review.fields.status).length,
    ).toBeGreaterThan(0);
    expect(summary.queryByText("tutorId")).toBeNull();
    expect(summary.queryByText("status")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "names the tutor and subject in the real signup-assignment payload (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.assignSignup",
      {
        tuteeId: "learner",
        assignments: [
          {
            tutorId: "assigned-tutor",
            subjectId: "assigned-subject",
            subject: "Exact requested subject",
          },
        ],
      },
      {
        Tutee: [
          { record: { id: "learner", englishName: "Synthetic Learner" } },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            Tutor: [{ id: "assigned-tutor", englishName: "Assigned Tutor" }],
            Subject: [{ id: "assigned-subject", name: "Captured Subject" }],
          },
        },
      },
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getByText("Assigned Tutor")).toBeTruthy();
    expect(summary.getByText("Captured Subject")).toBeTruthy();
    expect(summary.getByText("Exact requested subject")).toBeTruthy();
    expect(summary.queryByText("tutorId")).toBeNull();
    expect(summary.queryByText("subjectId")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "names submitted course-group offering and level references (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.saveCourseGroup",
      {
        id: "course-group",
        name: "Science",
        offerings: [
          {
            subjectId: "offering",
            levelId: "higher",
            baseName: "Exact base name",
          },
        ],
      },
      {
        CourseGroup: [{ record: { id: "course-group", name: "Science" } }],
        "CourseGroup.Subject": [
          {
            record: {
              id: "offering",
              groupId: "course-group",
              levelId: "higher",
              active: true,
            },
          },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            Subject: [
              {
                id: "offering",
                name: "Captured Offering",
                groupId: "course-group",
                levelId: "higher",
              },
            ],
            SubjectLevel: [
              { id: "higher", name: "Captured Higher Level", prefix: "HL" },
            ],
          },
        },
      },
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getByText("Captured Offering")).toBeTruthy();
    expect(
      summary.getAllByText("Captured Higher Level").length,
    ).toBeGreaterThan(0);
    expect(summary.getByText("Exact base name")).toBeTruthy();
    expect(
      summary.getByText(copy.approvals.review.fields.subjects),
    ).toBeTruthy();
    expect(summary.queryByText("subjectId")).toBeNull();
    expect(summary.queryByText("levelId")).toBeNull();
    expect(summary.queryByText("baseName")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "keeps similarly shaped arbitrary content blocks literal (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "home.setLayout",
      {
        owner: "home",
        blocks: [
          {
            id: "literal-id",
            tutorId: "literal-id",
            status: "PRESENT",
            type: "AUTO",
            offerings: [
              { subjectId: "literal-id", baseName: "literal base name" },
            ],
          },
        ],
      },
      {
        reviewReferences: {
          version: 1,
          entities: {
            Tutor: [
              { id: "literal-id", englishName: "Do not borrow this name" },
            ],
            Subject: [{ id: "literal-id", name: "Do not borrow this subject" }],
          },
        },
      },
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getByText("tutorId")).toBeTruthy();
    expect(summary.getByText("subjectId")).toBeTruthy();
    expect(summary.getByText("PRESENT")).toBeTruthy();
    expect(summary.getByText("AUTO")).toBeTruthy();
    expect(summary.queryByText("Do not borrow this name")).toBeNull();
    expect(summary.queryByText("Do not borrow this subject")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "localizes authoritative signup answers and their captured choices without translating literal answers (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const contact = "PRESENT\n  Exact contact text";
    show(
      "studentWorkflow.headEditSignup",
      {
        id: "signup",
        expectedVersion: 2,
        clientKey: "synthetic-client-key",
        signedTicket: "PRIVATE_SYNTHETIC_TICKET",
        releaseChangedAssignments: true,
        answers: {
          englishName: "ACTIVE",
          firstName: "Mina",
          lastName: "Lin",
          preferredName: null,
          alternativeNames: "原样保留",
          phone: "",
          preferredContact: contact,
          gradeLevel: "10",
          firstChoiceId: "first-subject",
          secondChoiceId: "second-subject",
          slotIds: ["available-slot"],
        },
      },
      {
        StudentSurvey: [
          {
            record: {
              id: "signup",
              payload: { englishName: "Original Learner" },
            },
          },
        ],
        reviewReferences: {
          version: 1,
          entities: {
            Subject: [
              { id: "first-subject", name: "First Captured Subject" },
              { id: "second-subject", name: "Second Captured Subject" },
            ],
            TimeSlot: [
              {
                id: "available-slot",
                label: "Captured Availability",
                dayOfWeek: 3,
                startMin: 900,
                endMin: 960,
              },
            ],
          },
        },
      },
      locale,
    );
    const region = screen.getByRole("region", {
      name: copy.approvals.review.affected,
    });
    const summary = within(region);
    expect(summary.getByText(copy.signupEditing.title)).toBeTruthy();
    expect(
      summary.getByText(copy.signupFields.labels.firstSubject),
    ).toBeTruthy();
    expect(
      summary.getByText(copy.signupFields.labels.secondSubject),
    ).toBeTruthy();
    expect(
      summary.getByText(copy.signupFields.labels.availability),
    ).toBeTruthy();
    expect(summary.getByText(copy.personName.firstName)).toBeTruthy();
    expect(summary.getByText("First Captured Subject")).toBeTruthy();
    expect(summary.getByText("Second Captured Subject")).toBeTruthy();
    expect(summary.getByText("Captured Availability")).toBeTruthy();
    expect(summary.getByText("ACTIVE")).toBeTruthy();
    expect(region.textContent).toContain(contact);
    expect(summary.getByText(copy.auditEventDetails.emptyString)).toBeTruthy();
    expect(summary.getByText(copy.approvals.review.emptyValue)).toBeTruthy();
    expect(region.textContent).not.toContain("PRIVATE_SYNTHETIC_TICKET");
    expect(summary.queryByText("firstChoiceId")).toBeNull();
    expect(summary.queryByText("slotIds")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "localizes fixed subject-import rows while preserving imported names (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.importSubjects",
      { subjects: [{ name: "ACTIVE", level: "Imported level name" }] },
      {},
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(summary.getByText(copy.approvals.review.fields.name)).toBeTruthy();
    expect(summary.getByText(copy.approvals.review.fields.level)).toBeTruthy();
    expect(summary.getByText("ACTIVE")).toBeTruthy();
    expect(summary.getByText("Imported level name")).toBeTruthy();
    expect(summary.queryByText("name")).toBeNull();
    expect(summary.queryByText("level")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "localizes course-group imports including their nested offerings (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.importCourseGroups",
      {
        groups: [
          {
            name: "PRESENT",
            offerings: [
              {
                baseName: "Exact imported base",
                level: "Imported Higher Level",
              },
              { baseName: "Unlevelled offering", level: null },
            ],
          },
        ],
      },
      {},
      locale,
    );
    const summary = within(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    );
    expect(
      summary.getByText(
        copy.auditEventDetails.presentation.entities.CourseGroup,
      ),
    ).toBeTruthy();
    expect(
      summary.getByText(copy.approvals.review.fields.subjects),
    ).toBeTruthy();
    expect(summary.getByText("PRESENT")).toBeTruthy();
    expect(summary.getByText("Exact imported base")).toBeTruthy();
    expect(summary.getByText("Imported Higher Level")).toBeTruthy();
    expect(summary.getByText(copy.approvals.review.emptyValue)).toBeTruthy();
    expect(summary.queryByText("groups")).toBeNull();
    expect(summary.queryByText("offerings")).toBeNull();
    expect(summary.queryByText("baseName")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "names the exact reviewed pairing targets in bulk room allocation (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.autoAssignUnassignedRooms",
      { targets: [{ id: "reviewed-pairing", expectedRoomVersion: 7 }] },
      {
        reviewReferences: {
          version: 1,
          entities: {
            Pairing: [
              {
                id: "reviewed-pairing",
                tutorId: "reviewed-tutor",
                subject: "Exact Captured Physics",
                dayOfWeek: 4,
                startMin: 900,
                endMin: 960,
              },
            ],
            Tutor: [{ id: "reviewed-tutor", englishName: "Reviewed Tutor" }],
          },
        },
      },
      locale,
    );
    const region = screen.getByRole("region", {
      name: copy.approvals.review.affected,
    });
    const summary = within(region);
    expect(
      summary.getByText(copy.approvals.review.entities.Pairing),
    ).toBeTruthy();
    expect(summary.getByText("Reviewed Tutor")).toBeTruthy();
    expect(summary.getByText("Exact Captured Physics")).toBeTruthy();
    expect(region.textContent).toContain("reviewed-pairing");
    expect(summary.queryByText("targets")).toBeNull();
    expect(summary.queryByText("expectedRoomVersion")).toBeNull();
  },
);

it.each(["en", "zh"])(
  "localizes allowed messaging groups and distinguishes empty permissions from resetting an override (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    const view = show(
      "messaging.setPermission",
      {
        target: { type: "USER", userId: "account" },
        groups: ["CURRENT_TUTORS", "ALL_USERS"],
        reason: "Exact review reason",
      },
      {},
      locale,
    );
    expect(screen.getByText(copy.messaging.groups.CURRENT_TUTORS)).toBeTruthy();
    expect(screen.getByText(copy.messaging.groups.ALL_USERS)).toBeTruthy();
    expect(screen.queryByText("CURRENT_TUTORS")).toBeNull();
    view.unmount();
    const empty = show(
      "messaging.setPermission",
      {
        target: { type: "USER", userId: "account" },
        groups: [],
        reason: "Exact review reason",
      },
      {},
      locale,
    );
    expect(screen.getByText(copy.approvals.review.none)).toBeTruthy();
    expect(screen.queryByText(copy.messaging.inherit)).toBeNull();
    empty.unmount();
    const inherited = show(
      "messaging.setPermission",
      {
        target: { type: "USER", userId: "account" },
        groups: null,
        reason: "Exact review reason",
      },
      {},
      locale,
    );
    expect(screen.getByText(copy.messaging.inherit)).toBeTruthy();
    inherited.unmount();
    show(
      "messaging.setPermission",
      {
        target: { type: "ROLE", role: "TUTOR" },
        groups: null,
        reason: "Exact review reason",
      },
      {},
      locale,
    );
    expect(screen.getByText(copy.messaging.resetDefault)).toBeTruthy();
  },
);

it.each(["en", "zh"])(
  "calls a subject-level rank its display order (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(
      "admin.createSubjectLevel",
      { name: "Higher Level", prefix: "HL", rank: 0, apScored: false },
      {},
      locale,
    );
    expect(
      screen.getByText(copy.auditEventDetails.presentation.fields.sortOrder),
    ).toBeTruthy();
    expect(screen.queryByText(copy.approvals.review.fields.rank)).toBeNull();
  },
);

it.each(Object.keys(APPROVAL_OPERATIONS))(
  "can render legacy missing evidence for %s",
  (operation) => {
    const errors: unknown[] = [];
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh}
        timeZone="Asia/Shanghai"
        onError={(error) => errors.push(error)}
      >
        <ApprovalReviewDetails
          operation={operation}
          payload={{}}
          targets={{}}
          summaryOnly
        />
      </NextIntlClientProvider>,
    );
    expect(errors).toEqual([]);
  },
);
