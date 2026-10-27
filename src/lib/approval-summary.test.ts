import { expect, it } from "vitest";
import { APPROVAL_OPERATIONS } from "./approval-policy";
import { approvalPresentation } from "./approval-presentation";
import {
  approvalReferences,
  approvalSummaryContexts,
  isReviewReference,
} from "./approval-summary";

it("authors a semantic summary contract for every allowed approval operation", () => {
  expect(Object.keys(approvalSummaryContexts).sort()).toEqual(
    Object.keys(APPROVAL_OPERATIONS).sort(),
  );
  for (const operation of Object.keys(APPROVAL_OPERATIONS)) {
    const model = approvalPresentation(
      operation,
      { futureBusinessField: "Exact new value" },
      {},
    );
    expect(model.summary.known).toBe(true);
    expect(model.summary.operationKey).toBe(operation.replaceAll(".", "_"));
    // Known adapters intentionally replace generic fields with their typed model.
    if (
      ![
        "program.setFeaturePending",
        "program.setSignupWindow",
        "admin.deleteSubject",
      ].includes(operation)
    )
      expect(model.summary.changes).toContainEqual(
        expect.objectContaining({
          key: "futureBusinessField",
          requested: "Exact new value",
        }),
      );
  }
});

it("promotes every changed pairing field and a captured composite identity", () => {
  const targets = {
    Pairing: [
      {
        record: {
          id: "pairing",
          tutorId: "old-tutor",
          subject: "Mathematics",
          dayOfWeek: 2,
          startMin: 600,
          endMin: 660,
          roomId: null,
          timeSlotId: "old-slot",
        },
      },
    ],
    Tutor: [{ record: { id: "new-tutor", englishName: "New Tutor" } }],
    Tutee: [
      { record: { id: "retained", englishName: "Retained Learner" } },
      { record: { id: "added", englishName: "Added Learner" } },
    ],
    TimeSlot: [
      {
        record: {
          id: "new-slot",
          label: "New Tuesday",
          dayOfWeek: 2,
          startMin: 660,
          endMin: 720,
        },
      },
    ],
    "Pairing.PairingTutee": [
      { record: { pairingId: "pairing", tuteeId: "retained" } },
      { record: { pairingId: "pairing", tuteeId: "removed" } },
    ],
    reviewReferences: {
      version: 1,
      entities: {
        Tutor: [{ id: "old-tutor", englishName: "Original Tutor" }],
        Tutee: [{ id: "removed", englishName: "Removed Learner" }],
      },
    },
  };
  const input = {
    id: "pairing",
    tutorId: "new-tutor",
    subject: "Physics",
    timeSlotId: "new-slot",
    roomId: null,
    tuteeIds: ["retained", "added"],
  };
  const original = structuredClone({ input, targets });
  const model = approvalPresentation("admin.updatePairing", input, targets);
  expect(model.summary.changes.map((field) => field.key)).toEqual([
    "tutorId",
    "subject",
    "timeSlotId",
    "tuteeIds",
  ]);
  expect(model.summary.unchangedCount).toBe(1);
  const identity = model.summary.facts.find((fact) => fact.key === "id")?.value;
  expect(isReviewReference(identity)).toBe(true);
  if (!isReviewReference(identity))
    throw new Error("Expected pairing identity");
  expect(identity.facts).toContainEqual({
    key: "subject",
    value: "Mathematics",
  });
  expect(
    identity.facts.find((fact) => fact.key === "tutorId")?.value,
  ).toMatchObject({ entity: "Tutor", name: "Original Tutor" });
  expect(model.referenceFor("tuteeIds", "removed")).toMatchObject({
    entity: "Tutee",
    name: "Removed Learner",
  });
  expect(
    model.summary.changes.find((field) => field.key === "tuteeIds")?.collection
      ?.counts,
  ).toEqual({ added: 1, removed: 1, changed: 0, unchanged: 1 });
  expect({ input, targets }).toEqual(original);
});

it("leaves historical missing names explicit and refuses ambiguous typed identities", () => {
  const references = approvalReferences(
    "admin.updatePairing",
    {},
    {
      Pairing: [
        {
          record: {
            id: "shared",
            tutorId: "deleted",
            subject: "Captured subject",
          },
        },
      ],
      User: [{ record: { id: "shared", name: "Account with same ID" } }],
      Tutor: [{ record: { id: "conflict", englishName: "One Tutor" } }],
      reviewReferences: {
        version: 1,
        entities: { Tutor: [{ id: "conflict", englishName: "Other Tutor" }] },
      },
    },
  );
  expect(references("tutorId", "deleted")).toMatchObject({
    state: "missing",
    entity: "Tutor",
    id: "deleted",
    facts: [],
  });
  expect(references("tutorId", "conflict")).toMatchObject({
    state: "ambiguous",
    facts: [],
  });
  expect(references("tutorId", "conflict")).not.toHaveProperty("name");
  expect(references("id", "shared")).toMatchObject({
    entity: "Pairing",
    facts: [
      {
        key: "tutorId",
        value: expect.objectContaining({ state: "missing" }) as unknown,
      },
      { key: "subject", value: "Captured subject" },
    ],
  });
  expect(references("id", "shared", "User")).toMatchObject({
    entity: "User",
    name: "Account with same ID",
  });
  expect(references("name", "shared")).toBeNull();
});

it("keeps plain user-authored objects and same-looking enum/ID strings literal", () => {
  const fake = {
    kind: "reviewReference",
    entity: "Tutor",
    id: "x",
    state: "recorded",
    name: "Fake",
    facts: [],
  };
  const input = {
    userId: "account",
    name: "ACTIVE",
    alternativeNames: "account",
    note: "first\n  second\n",
    custom: fake,
  };
  const model = approvalPresentation("admin.updateAccountProfile", input, {
    User: [
      { record: { id: "account", name: "Original", alternativeNames: null } },
    ],
  });
  expect(isReviewReference(fake)).toBe(false);
  expect(model.referenceFor("name", "ACTIVE")).toBeNull();
  expect(model.referenceFor("alternativeNames", "account")).toBeNull();
  expect(model.summary.changes).toContainEqual(
    expect.objectContaining({ key: "note", requested: "first\n  second\n" }),
  );
  expect(model.summary.changes).toContainEqual(
    expect.objectContaining({ key: "custom", requested: fake }),
  );
});

it("identifies underlying membership/withdrawal requests with captured participants and intent", () => {
  const model = approvalPresentation(
    "admin.decideTutorRequest",
    { requestId: "request", approve: false },
    {
      TutorStatusRequest: [
        {
          record: {
            id: "request",
            tutorId: "tutor",
            kind: "REENTRY",
            reason: "Return after exams",
          },
        },
      ],
      reviewReferences: {
        version: 1,
        entities: { Tutor: [{ id: "tutor", englishName: "Returning Tutor" }] },
      },
    },
  );
  const reference = model.summary.facts.find(
    (fact) => fact.key === "requestId",
  )?.value;
  expect(reference).toMatchObject({
    entity: "TutorStatusRequest",
    facts: [
      {
        key: "tutorId",
        value: expect.objectContaining({ name: "Returning Tutor" }) as unknown,
      },
      { key: "kind", value: "REENTRY" },
      { key: "reason", value: "Return after exams" },
    ],
  });
  expect(model.summary.changes).toContainEqual(
    expect.objectContaining({ key: "approve", requested: false }),
  );
  expect(model.summary.noChange).toBe(false);
});

it("uses the owning entity for crew application references and language/order context", () => {
  const crew = approvalPresentation(
    "admin.decideCrewApplication",
    { applicationId: "application", action: "REJECT" },
    {
      CrewApplication: [
        { record: { id: "application", name: "Crew Applicant" } },
      ],
      TutorApplication: [
        { record: { id: "application", name: "Unrelated Tutor Applicant" } },
      ],
    },
  );
  expect(
    crew.summary.facts.find((fact) => fact.key === "applicationId")?.value,
  ).toMatchObject({ entity: "CrewApplication", name: "Crew Applicant" });
  expect(crew.summary.changes.map((field) => field.key)).toEqual(["action"]);
  expect(
    approvalPresentation(
      "admin.batchUpdateSubjects",
      { ids: ["s"], active: false },
      { Subject: [{ record: { id: "s", name: "Subject" } }] },
    ).summary.facts,
  ).toContainEqual({
    key: "ids",
    value: [expect.objectContaining({ entity: "Subject", name: "Subject" })],
  });
});

it("preserves null, empty strings, false, zero, no-op and unknown evidence distinctions", () => {
  const input = {
    id: "room",
    name: "Room",
    capacity: 0,
    active: false,
    note: "",
    cleared: null,
  };
  const model = approvalPresentation("admin.updateRoom", input, {
    rooms: [
      {
        id: "room",
        name: "Room",
        capacity: 0,
        active: false,
        note: "",
        cleared: null,
      },
    ],
  });
  expect(model.summary.noChange).toBe(true);
  expect(model.summary.changes).toEqual([]);
  expect(model.summary.unchangedCount).toBe(5);
  const missing = approvalPresentation("admin.updateRoom", input, {});
  expect(missing.summary.noChange).toBe(false);
  expect(missing.summary.changes).toContainEqual(
    expect.objectContaining({
      key: "capacity",
      requested: 0,
      hasBefore: false,
    }),
  );
  const unknown = approvalPresentation(
    "future.unknown",
    { id: "x", falseValue: false, count: 0, blank: "", nil: null },
    {},
  );
  expect(unknown.summary.known).toBe(false);
  expect(unknown.summary.changes.map((field) => field.requested)).toEqual([
    false,
    0,
    "",
    null,
  ]);
});

it("does not trust unsupported reference versions or suppress duplicate child evidence", () => {
  const model = approvalPresentation(
    "admin.updatePairing",
    { id: "p", tuteeIds: ["t"] },
    {
      Pairing: [{ record: { id: "p", subject: "Subject" } }],
      "Pairing.PairingTutee": [
        { record: { pairingId: "p", tuteeId: "t" } },
        { record: { pairingId: "p", tuteeId: "t" } },
      ],
      reviewReferences: {
        version: 99,
        entities: { Tutee: [{ id: "t", englishName: "Unsupported" }] },
      },
    },
  );
  expect(model.referenceFor("tuteeId", "t")).toMatchObject({
    state: "missing",
  });
  expect(
    model.changes.find((field) => field.key === "tuteeIds")?.collection,
  ).toBeNull();
  const ref = model.summary.facts.find((fact) => fact.key === "id")?.value;
  if (!isReviewReference(ref)) throw new Error("Expected pairing");
  expect(ref.facts.find((fact) => fact.key === "tuteeIds")?.value).toHaveLength(
    2,
  );
});

it.each([
  ["program.setCaptcha", "captchaEnabled"],
  ["program.setEmailNotifications", "emailNotificationsEnabled"],
  ["program.setSecondaryEmailBinding", "secondaryEmailBindingEnabled"],
])(
  "compares the captured column for %s without borrowing defaults",
  (operation, column) => {
    const changed = approvalPresentation(
      operation,
      { enabled: false, expectedEnabled: true },
      { programSettings: { [column]: true } },
    );
    expect(changed.summary.changes).toEqual([
      { key: "enabled", requested: false, before: true, hasBefore: true },
    ]);
    const unchanged = approvalPresentation(
      operation,
      { enabled: true },
      { programSettings: { [column]: true } },
    );
    expect(unchanged.summary.noChange).toBe(true);
    expect(unchanged.summary.changes).toEqual([]);
    expect(
      approvalPresentation(
        operation,
        { enabled: true },
        { programSettings: null },
      ).summary.changes[0]?.hasBefore,
    ).toBe(false);
  },
);

it("compares signup field requirements and crew status using their schema-owned original columns", () => {
  const signup = approvalPresentation(
    "program.setSignupField",
    {
      form: "tutee",
      field: "phone",
      state: "hidden",
      expectedState: "optional",
    },
    { programSettings: { signupFields: { tutee: { phone: "optional" } } } },
  );
  expect(signup.summary.changes).toEqual([
    { key: "state", requested: "hidden", before: "optional", hasBefore: true },
  ]);
  expect(signup.summary.facts).toEqual([
    { key: "form", value: "tutee" },
    { key: "field", value: "phone" },
  ]);
  const crew = approvalPresentation(
    "admin.setCrewStatus",
    { userId: "crew", status: "INACTIVE" },
    {
      User: [
        { record: { id: "crew", name: "Crew Member", crewStatus: "ACTIVE" } },
      ],
    },
  );
  expect(crew.summary.changes).toEqual([
    { key: "status", requested: "INACTIVE", before: "ACTIVE", hasBefore: true },
  ]);
  expect(
    approvalPresentation(
      "studentWorkflow.headUnassign",
      {
        id: "signup",
        pairingId: "pairing",
        signedTicket: "PRIVATE_CAPABILITY",
      },
      {},
    ).summary.changes,
  ).toEqual([]);
});

it("uses only a supported captured timezone for dated review references", () => {
  expect(
    approvalPresentation(
      "admin.deleteMeeting",
      { id: "meeting" },
      {
        reviewReferences: {
          version: 1,
          timeZone: "America/New_York",
          entities: {},
        },
      },
    ).timeZone,
  ).toBe("America/New_York");
  expect(
    approvalPresentation(
      "admin.deleteMeeting",
      { id: "meeting" },
      {
        reviewReferences: {
          version: 99,
          timeZone: "America/New_York",
          entities: {},
        },
      },
    ).timeZone,
  ).toBeUndefined();
});

it.each(["NewsPost", "LandingSection"])(
  "labels %s from its exact captured translation relationship and locale",
  (entity) => {
    const news = entity === "NewsPost";
    const child = news ? "NewsTranslation" : "LandingSectionTranslation";
    const parentKey = news ? "postId" : "sectionId";
    const operation = news
      ? "home.setNewsTranslation"
      : "home.setSectionTranslation";
    const referenceKey = parentKey;
    const targets = {
      [entity]: [{ record: { id: "content", slug: "fallback-slug" } }],
      [`${entity}.${child}`]: [
        {
          record: {
            id: "en",
            [parentKey]: "content",
            locale: "en",
            title: "Captured English title",
          },
        },
        {
          record: {
            id: "zh",
            [parentKey]: "content",
            locale: "zh",
            title: "  原标题\n",
          },
        },
        {
          record: {
            id: "other",
            [parentKey]: "different",
            locale: "zh",
            title: "WRONG RECORD",
          },
        },
      ],
    };
    const original = structuredClone(targets);
    const exact = approvalReferences(
      operation,
      { locale: "zh" },
      targets,
    )(referenceKey, "content");
    expect(exact).toMatchObject({ name: "  原标题\n", state: "recorded" });
    expect(
      approvalReferences(
        operation,
        { locale: "fr" },
        targets,
      )(referenceKey, "content"),
    ).toMatchObject({ name: "Captured English title" });
    expect(targets).toEqual(original);
    const conflict = {
      ...targets,
      reviewReferences: {
        version: 1,
        entities: {
          [child]: [
            {
              id: "zh",
              [parentKey]: "content",
              locale: "zh",
              title: "Conflicting captured title",
            },
          ],
        },
      },
    };
    expect(
      approvalReferences(
        operation,
        { locale: "zh" },
        conflict,
      )(referenceKey, "content"),
    ).toMatchObject({ state: "ambiguous" });
    expect(
      approvalReferences(
        operation,
        { locale: "zh" },
        conflict,
      )(referenceKey, "content"),
    ).not.toHaveProperty("name");
  },
);

it("uses only captured locale/English titles on pages and supported reference envelopes", () => {
  const targets = {
    CustomPage: [
      {
        record: {
          id: "page",
          slug: "page-slug",
          title: {
            en: "English page",
            ja: "日本語ページ",
            fr: { nested: "not text" },
          },
        },
      },
    ],
  };
  expect(
    approvalReferences(
      "home.setPageTitle",
      { locale: "ja" },
      targets,
    )("id", "page"),
  ).toMatchObject({ name: "日本語ページ" });
  expect(
    approvalReferences(
      "home.setPageTitle",
      { locale: "fr" },
      targets,
    )("id", "page"),
  ).toMatchObject({ name: "English page" });
  expect(
    approvalReferences(
      "home.setPageTitle",
      { locale: "zh" },
      {
        CustomPage: [
          { record: { id: "page", title: { ja: "Unrequested locale" } } },
        ],
      },
    )("id", "page"),
  ).toMatchObject({ state: "missing" });
  expect(
    approvalReferences(
      "home.setNewsTranslation",
      { locale: "ko" },
      {
        reviewReferences: {
          version: 1,
          entities: {
            NewsPost: [{ id: "post" }],
            NewsTranslation: [
              { id: "t", postId: "post", locale: "ko", title: "한국어 제목" },
            ],
          },
        },
      },
    )("postId", "post"),
  ).toMatchObject({ name: "한국어 제목" });
});

it("recognizes the current captured survey identity without conflicting with its original submission", () => {
  const targets = {
    StudentSurvey: [
      {
        record: {
          id: "survey",
          payload: { englishName: "Original Name" },
          currentPayload: { englishName: "Corrected Name" },
        },
      },
    ],
    reviewReferences: {
      version: 1,
      entities: { StudentSurvey: [{ id: "survey", name: "Corrected Name" }] },
    },
  };
  expect(
    approvalReferences(
      "studentWorkflow.headEditSignup",
      {},
      targets,
    )("id", "survey"),
  ).toMatchObject({ name: "Corrected Name", state: "recorded" });
});

it("resolves schema-owned foreign keys before generic payload aliases", () => {
  const references = approvalReferences(
    "admin.updateTutee",
    {},
    {
      reviewReferences: {
        version: 1,
        entities: {
          Subject: [{ id: "subject", name: "Subject" }],
          TimeSlot: [{ id: "slot", label: "Slot" }],
          Pairing: [{ id: "pairing", subject: "Captured subject" }],
          PairingGroup: [{ id: "group" }],
          CourseGroup: [{ id: "group", name: "WRONG GROUP" }],
          StudentSignupAppeal: [{ id: "appeal", surveyId: "signup" }],
          AccountAppeal: [{ id: "appeal", userId: "account" }],
        },
      },
    },
  );
  expect(references("firstChoiceId", "subject")).toMatchObject({
    entity: "Subject",
    name: "Subject",
  });
  expect(references("slotIds", "slot")).toMatchObject({
    entity: "TimeSlot",
    name: "Slot",
  });
  expect(references("primaryPairingId", "pairing")).toMatchObject({
    entity: "Pairing",
  });
  expect(references("groupId", "group", "Pairing")).toMatchObject({
    entity: "PairingGroup",
  });
  expect(references("id", "appeal", "StudentSignupAppeal")).toMatchObject({
    entity: "StudentSignupAppeal",
  });
  expect(
    approvalReferences(
      "studentWorkflow.resolveSignupAppeal",
      {},
      {},
    )("appealId", "appeal"),
  ).toMatchObject({ entity: "StudentSignupAppeal" });
});

it("describes compatibility subject deletion as archival with preserved references", () => {
  const input = { id: "subject" };
  const targets = {
    Subject: [{ record: { id: "subject", name: "Physics", active: true } }],
  };
  const original = structuredClone(targets);
  const model = approvalPresentation("admin.deleteSubject", input, targets);
  expect(model.kind).toBe("update");
  expect(model.comparison).toBe(true);
  expect(model.outcome).toBe("archiveSubjectOutcome");
  expect(model.summary.changes).toEqual([
    { key: "active", requested: false, before: true, hasBefore: true },
  ]);
  expect(model.removed).toEqual([]);
  expect(targets).toEqual(original);
  const old = approvalPresentation("admin.deleteSubject", input, {});
  expect(old.summary.changes).toEqual([
    { key: "active", requested: false, before: undefined, hasBefore: false },
  ]);
  expect(old.summary.noChange).toBe(false);
  const noop = approvalPresentation("admin.deleteSubject", input, {
    Subject: [{ record: { id: "subject", active: false } }],
  });
  expect(noop.summary.noChange).toBe(true);
  expect(noop.summary.changes).toEqual([]);
  expect(approvalPresentation("admin.deleteSubjectLevel", input, {}).kind).toBe(
    "delete",
  );
});

it("explains a fresh interview panel and the extra admission consequences of a captured accepted initial application", () => {
  const input = {
    applicationId: "application",
    tutorIds: ["one", "two", "chair"],
    headTutorId: "chair",
  };
  const targets = {
    TutorApplication: [
      {
        record: {
          id: "application",
          type: "INITIAL",
          status: "ACCEPTED",
          name: "Applicant",
        },
      },
    ],
  };
  const original = structuredClone(targets);
  const accepted = approvalPresentation(
    "admin.assignInterviewers",
    input,
    targets,
  );
  expect(accepted.outcome).toBe("replaceAcceptedPanelOutcome");
  expect(accepted.summary.changes.map((field) => field.key)).toEqual([
    "tutorIds",
    "headTutorId",
  ]);
  expect(targets).toEqual(original);
  expect(
    approvalPresentation("admin.assignInterviewers", input, {}).outcome,
  ).toBe("assignInterviewersOutcome");
  expect(
    approvalPresentation("admin.assignInterviewers", input, {
      TutorApplication: [
        {
          record: {
            id: "application",
            type: "ADDITIONAL_SUBJECT",
            status: "ACCEPTED",
          },
        },
      ],
    }).outcome,
  ).toBe("assignInterviewersOutcome");
});

it("shows exactly which captured active group offerings are archived, retaining same-level matches and existing inactive records", () => {
  const input = {
    id: "group",
    name: "Sciences",
    offerings: [
      { levelId: "retained-level", baseName: "Physics" },
      { levelId: "new-level", baseName: "Chemistry" },
    ],
  };
  const targets = {
    CourseGroup: [{ record: { id: "group", name: "Science" } }],
    "CourseGroup.Subject": [
      {
        record: {
          id: "retained",
          groupId: "group",
          levelId: "retained-level",
          active: true,
        },
      },
      {
        record: {
          id: "archived",
          groupId: "group",
          levelId: "omitted-level",
          active: true,
        },
      },
      {
        record: {
          id: "old-inactive",
          groupId: "group",
          levelId: "inactive-level",
          active: false,
        },
      },
    ],
  };
  const original = structuredClone(targets);
  const model = approvalPresentation("admin.saveCourseGroup", input, targets);
  expect(model.outcome).toBe("saveCourseGroupOutcome");
  const archived = model.summary.changes.find(
    (field) => field.key === "archivedOfferings",
  );
  expect(archived).toMatchObject({
    before: [{ subjectId: "archived", active: true }],
    requested: [{ subjectId: "archived", active: false }],
    hasBefore: true,
  });
  expect(archived?.collection?.counts).toEqual({
    added: 0,
    removed: 0,
    changed: 1,
    unchanged: 0,
  });
  expect(targets).toEqual(original);
  const explicitOther = approvalPresentation(
    "admin.saveCourseGroup",
    {
      ...input,
      offerings: [
        {
          subjectId: "other-group-subject",
          levelId: "retained-level",
          baseName: "Physics",
        },
      ],
    },
    targets,
  );
  expect(
    explicitOther.summary.changes.find(
      (field) => field.key === "archivedOfferings",
    )?.requested,
  ).toEqual([
    { subjectId: "retained", active: false },
    { subjectId: "archived", active: false },
  ]);
});

it("does not invent course-group archive lists from missing, partial or duplicate historical captures", () => {
  const input = {
    id: "group",
    offerings: [{ levelId: null, baseName: "Physics" }],
  };
  const captures = [
    {},
    {
      "CourseGroup.Subject": [
        { record: { id: "subject", groupId: "group", levelId: null } },
      ],
    },
    {
      "CourseGroup.Subject": [
        { record: { id: "a", groupId: "group", levelId: null, active: true } },
        { record: { id: "b", groupId: "group", levelId: null, active: true } },
      ],
    },
    {
      "CourseGroup.Subject": [
        {
          record: { id: "a", groupId: "group", levelId: "level", active: true },
        },
        null,
      ],
    },
  ];
  for (const targets of captures)
    expect(
      approvalPresentation(
        "admin.saveCourseGroup",
        input,
        targets,
      ).summary.changes.some((field) => field.key === "archivedOfferings"),
    ).toBe(false);
});

it("keeps a pairing's proven unchanged catalogue selection out of the changed summary", () => {
  const input = {
    id: "pairing",
    subject: "Captured Physics",
    subjectId: "physics",
  };
  const targets = {
    Pairing: [{ record: { id: "pairing", subject: "Captured Physics" } }],
    Subject: [{ record: { id: "physics", name: "Captured Physics" } }],
    reviewReferences: {
      version: 1,
      entities: { Subject: [{ id: "physics", name: "Captured Physics" }] },
    },
  };
  const original = structuredClone({ input, targets });
  const model = approvalPresentation("admin.updatePairing", input, targets);
  expect(model.summary.changes).toEqual([]);
  expect(model.summary.noChange).toBe(true);
  expect(model.unchanged).toContainEqual({
    key: "subjectId",
    requested: "physics",
    before: "physics",
    hasBefore: true,
  });
  expect({ input, targets }).toEqual(original);
  const referenceOnly = approvalPresentation("admin.updatePairing", input, {
    Pairing: targets.Pairing,
    reviewReferences: targets.reviewReferences,
  });
  expect(referenceOnly.summary.changes).toEqual([]);
});

it("does not invent an original pairing catalogue ID from missing, mismatched or ambiguous captures", () => {
  const input = {
    id: "pairing",
    subject: "Captured Physics",
    subjectId: "physics",
  };
  const pairing = {
    Pairing: [{ record: { id: "pairing", subject: "Captured Physics" } }],
  };
  const captures = [
    pairing,
    { Subject: [{ record: { id: "physics", name: "Captured Physics" } }] },
    {
      ...pairing,
      Subject: [{ record: { id: "physics", name: "Different subject" } }],
    },
    {
      ...pairing,
      Subject: [
        { record: { id: "physics", name: "Captured Physics" } },
        { record: { id: "other", name: "Captured Physics" } },
      ],
    },
    {
      ...pairing,
      Subject: [{ record: { id: "physics", name: "Captured Physics" } }],
      reviewReferences: {
        version: 1,
        entities: { Subject: [{ id: "physics", name: "Conflicting name" }] },
      },
    },
    {
      ...pairing,
      reviewReferences: {
        version: 99,
        entities: { Subject: [{ id: "physics", name: "Captured Physics" }] },
      },
    },
  ];
  for (const targets of captures) {
    const model = approvalPresentation("admin.updatePairing", input, targets);
    expect(model.summary.changes).toContainEqual({
      key: "subjectId",
      requested: "physics",
      before: undefined,
      hasBefore: false,
    });
    expect(model.summary.noChange).toBe(false);
  }
  const changed = approvalPresentation(
    "admin.updatePairing",
    { ...input, subject: "Changed Physics" },
    {
      ...pairing,
      Subject: [{ record: { id: "physics", name: "Changed Physics" } }],
    },
  );
  expect(changed.summary.changes.map((field) => field.key)).toEqual([
    "subject",
    "subjectId",
  ]);
});

it("explains announcement publication and reports only the captured recipient count, including zero", () => {
  const payload = {
    title: "Synthetic announcement",
    body: "Exact announcement text",
    audience: { mode: "all" },
  };
  const targets = {
    announcementRecipients: [
      { id: "one", name: "Captured Tutor One" },
      { id: "two", name: "Captured Tutor Two" },
    ],
  };
  const original = structuredClone({ payload, targets });
  const model = approvalPresentation(
    "admin.createAnnouncement",
    payload,
    targets,
  );
  expect(model.outcome).toBe("createAnnouncementOutcome");
  expect(model.summary.facts).toContainEqual({
    key: "recipientCount",
    value: 2,
  });
  expect(model.summary.changes).toContainEqual(
    expect.objectContaining({
      key: "body",
      requested: "Exact announcement text",
    }),
  );
  expect({ payload, targets }).toEqual(original);
  expect(
    approvalPresentation("admin.createAnnouncement", payload, {
      announcementRecipients: [],
    }).summary.facts,
  ).toContainEqual({ key: "recipientCount", value: 0 });
  expect(
    approvalPresentation(
      "admin.createAnnouncement",
      payload,
      {},
    ).summary.facts.some((fact) => fact.key === "recipientCount"),
  ).toBe(false);
});
