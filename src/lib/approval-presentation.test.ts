import { expect, it } from "vitest";
import { approvalPresentation } from "./approval-presentation";
import {
  reviewCollection,
  reviewCollectionFieldEqual,
} from "./approval-review-collections";

it.each([
  [true, null, false, "stage", false],
  [true, false, true, "clear", null],
  [false, true, false, "clear", null],
  [true, false, false, "unchanged", false],
  [true, null, true, "unchanged", null],
  [false, false, true, "replace", true],
])(
  "describes effective %s / pending %s / requested %s without activating it",
  (effective, pending, requested, intent, result) => {
    const model = approvalPresentation(
      "program.setFeaturePending",
      { key: "CREW", enabled: requested },
      {
        reviewPresentation: {
          version: 1,
          feature: { key: "CREW", effective, pending, source: "default" },
        },
      },
    );
    expect(model.feature).toMatchObject({
      effective,
      pending,
      intent,
      source: "default",
    });
    expect(model.changes[0]).toMatchObject({
      before: pending,
      requested: result,
      hasBefore: true,
    });
  },
);

it("distinguishes a captured default, old absent-row evidence and missing evidence", () => {
  const input = { key: "CREW", enabled: false };
  const oldDefault = approvalPresentation("program.setFeaturePending", input, {
    programFeature: [],
  });
  expect(oldDefault.feature).toMatchObject({
    source: "uncapturedDefault",
    known: false,
    intent: "unknown",
  });
  expect(oldDefault.changes[0]?.hasBefore).toBe(false);
  expect(
    approvalPresentation("program.setFeaturePending", input, {}).feature
      ?.source,
  ).toBe("missing");
  const stored = approvalPresentation("program.setFeaturePending", input, {
    programFeature: [{ key: "CREW", enabled: true, pendingEnabled: null }],
  });
  expect(stored.feature).toMatchObject({
    source: "stored",
    known: true,
    intent: "stage",
  });
});

it("maps audience-specific recruitment columns without inventing omitted edits or a timezone", () => {
  const model = approvalPresentation(
    "program.setSignupWindow",
    {
      audience: "tutor",
      opensAt: null,
      previewUrl: "https://example.test/new",
    },
    {
      term: {
        name: "26–27 Q1",
        signupOpensAt: "WRONG",
        tutorSignupOpensAt: "2026-10-27T00:00:00Z",
        tutorSignupPreviewUrl: null,
      },
    },
  );
  expect(model.changes.map((field) => field.key)).toEqual([
    "opensAt",
    "previewUrl",
  ]);
  expect(model.changes[0]?.before).toBe("2026-10-27T00:00:00Z");
  expect(model.timeZone).toBeUndefined();
  expect(model.facts).toContainEqual({
    key: "recruitmentAudience",
    value: "tutor",
  });
});

it("compares restored recruitment dates with captured JSON instants without changing either value", () => {
  const opensAt = new Date("2026-10-27T01:00:00.000Z");
  const payload = {
    audience: "tutor",
    opensAt,
    closesAt: null,
    enabled: false,
    previewUrl: "  https://example.test/preview  ",
  };
  const targets = {
    term: {
      tutorSignupOpensAt: "2026-10-27T09:00:00+08:00",
      tutorSignupClosesAt: null,
      tutorSignupEnabled: false,
      tutorSignupPreviewUrl: "https://example.test/preview",
    },
  };
  const original = structuredClone(targets);
  const model = approvalPresentation(
    "program.setSignupWindow",
    payload,
    targets,
  );
  expect(model.unchanged.map((field) => field.key)).toEqual([
    "enabled",
    "opensAt",
    "closesAt",
  ]);
  expect(
    model.unchanged.find((field) => field.key === "opensAt"),
  ).toMatchObject({
    before: targets.term.tutorSignupOpensAt,
    requested: opensAt,
  });
  expect(model.changes.map((field) => field.key)).toEqual(["previewUrl"]);
  expect(targets).toEqual(original);
  expect(payload.opensAt).toBe(opensAt);
});

it("keeps changed, missing and invalid recruitment dates distinct", () => {
  const model = approvalPresentation(
    "program.setSignupWindow",
    { opensAt: new Date("2026-10-28T00:00:00Z"), closesAt: null },
    { term: { signupOpensAt: "2026-10-27T00:00:00.000Z" } },
  );
  expect(model.changes.map((field) => field.key)).toEqual([
    "opensAt",
    "closesAt",
  ]);
  expect(model.changes[1]).toMatchObject({
    before: undefined,
    requested: null,
    hasBefore: false,
  });
  const invalid = approvalPresentation(
    "program.setSignupWindow",
    { opensAt: "legacy invalid date" },
    { term: { signupOpensAt: "legacy invalid date" } },
  );
  expect(invalid.unchanged[0]).toMatchObject({
    before: "legacy invalid date",
    requested: "legacy invalid date",
  });
});

it.each([true, false])(
  "promotes only the linked participant and retains underlying decision %s",
  (approve) => {
    const targets = {
      StudentRequestReview: [
        {
          record: {
            id: "r",
            kind: "STUDENT_ABORT",
            surveyId: "s",
            reason: "Exact reason\n第二行",
          },
        },
      ],
      StudentSurvey: [{ record: { id: "s", tuteeId: "t" } }],
      Tutee: [
        { record: { id: "other", englishName: "Wrong person" } },
        { record: { id: "t", englishName: "Recorded Frank" } },
      ],
    };
    const original = structuredClone(targets);
    const model = approvalPresentation(
      "studentWorkflow.resolveReview",
      { id: "r", approve },
      targets,
    );
    expect(model.facts).toContainEqual({
      key: "participant",
      value: "Recorded Frank",
    });
    expect(model.facts).toContainEqual({
      key: "originalReason",
      value: "Exact reason\n第二行",
    });
    expect(model.outcome).toBe(
      approve ? "approveUnderlying" : "rejectUnderlying",
    );
    expect(targets).toEqual(original);
    expect(
      approvalPresentation(
        "studentWorkflow.resolveReview",
        { id: "unknown", approve },
        targets,
      ).facts[0]?.value,
    ).toBeUndefined();
  },
);

it.each(["localization.setString", "home.setContent"])(
  "surfaces exact publication text and locale for %s",
  (operation) => {
    const model = approvalPresentation(
      "translationReview.decide",
      { id: "draft", approve: true },
      {
        TranslationDraft: [
          {
            record: {
              id: "draft",
              operation,
              payload: {
                key: "greeting",
                locale: "zh",
                value: "第一行\n  second line\n",
              },
            },
          },
        ],
        destination: {
          [operation === "localization.setString" ? "translation" : "content"]:
            [
              { key: "greeting", locale: "en", value: "Wrong locale" },
              { key: "greeting", locale: "zh", value: "" },
            ],
        },
      },
    );
    expect(model.facts).toContainEqual({ key: "locale", value: "zh" });
    expect(model.changes).toEqual([
      {
        key: "value",
        requested: "第一行\n  second line\n",
        before: "",
        hasBefore: true,
      },
    ]);
  },
);

it("does not invent original publication text for absent destinations or unknown historical drafts", () => {
  const model = approvalPresentation(
    "translationReview.decide",
    { id: "d", approve: false },
    {
      TranslationDraft: [
        {
          id: "d",
          operation: "localization.setString",
          payload: { key: "x", locale: "en", value: "Exact" },
        },
      ],
      destination: { translation: [] },
    },
  );
  expect(model.changes[0]).toMatchObject({
    hasBefore: false,
    before: undefined,
  });
  expect(model.outcome).toBe("rejectPublicationOutcome");
});

it.each([
  ["home.setNewsTranslation", "NewsPost", "NewsTranslation", "postId"],
  [
    "home.setSectionTranslation",
    "LandingSection",
    "LandingSectionTranslation",
    "sectionId",
  ],
])(
  "names %s from only the exact captured target and locale",
  (operation, table, child, foreignKey) => {
    const proposed = {
      [foreignKey]: "target",
      locale: "zh",
      title: "新标题",
      body: "第一行\n  Preserve indentation\n",
    };
    const targets = {
      TranslationDraft: [
        { record: { id: "draft", operation, payload: proposed } },
      ],
      destination: {
        [table]: [
          { record: { id: "other", slug: "wrong" } },
          { record: { id: "target", slug: "recorded-target" } },
        ],
        [`${table}.${child}`]: [
          {
            record: {
              [foreignKey]: "other",
              locale: "zh",
              title: "Unrelated title",
              body: "Wrong text",
            },
          },
          {
            record: {
              [foreignKey]: "target",
              locale: "en",
              title: "Captured English",
              body: "Wrong locale",
            },
          },
          {
            record: {
              [foreignKey]: "target",
              locale: "zh",
              title: "  原标题\n",
              body: "",
            },
          },
        ],
      },
    };
    const original = structuredClone(targets);
    const model = approvalPresentation(
      "translationReview.decide",
      { id: "draft", approve: true },
      targets,
    );
    expect(model.facts).toContainEqual({
      key: "textDestination",
      value: "  原标题\n",
    });
    expect(model.changes).toEqual([
      {
        key: "title",
        requested: "新标题",
        before: "  原标题\n",
        hasBefore: true,
      },
      { key: "body", requested: proposed.body, before: "", hasBefore: true },
    ]);
    expect(targets).toEqual(original);
  },
);

it.each([null, "", "   ", undefined])(
  "falls back to a captured English title without inventing locale originals (%s)",
  (title) => {
    const model = approvalPresentation(
      "translationReview.decide",
      { id: "draft", approve: true },
      {
        TranslationDraft: [
          {
            id: "draft",
            operation: "home.setNewsTranslation",
            payload: {
              postId: "target",
              locale: "zh",
              title: "Proposed",
              body: "Raw\n  body",
            },
          },
        ],
        destination: {
          "NewsPost.NewsTranslation": [
            { postId: "other", locale: "zh", title: "Unrelated" },
            { postId: "target", locale: "en", title: "  Captured English  " },
            ...(title === undefined
              ? []
              : [{ postId: "target", locale: "zh", title, body: null }]),
          ],
        },
      },
    );
    expect(model.facts).toContainEqual({
      key: "textDestination",
      value: "  Captured English  ",
    });
    expect(model.changes[0]).toMatchObject({
      before: title,
      hasBefore: title !== undefined,
    });
    expect(model.changes[1]).toMatchObject({
      before: title === undefined ? undefined : null,
      hasBefore: title !== undefined,
    });
  },
);

it.each(["  原标题\n", "", null, undefined])(
  "maps the exact page-title locale to the proposed value field (%s)",
  (title) => {
    const titles = {
      en: "Captured English",
      ...(title === undefined ? {} : { zh: title }),
    };
    const model = approvalPresentation(
      "translationReview.decide",
      { id: "draft", approve: true },
      {
        TranslationDraft: [
          {
            id: "draft",
            operation: "home.setPageTitle",
            payload: { id: "page", locale: "zh", value: "  提议标题\n" },
          },
        ],
        destination: {
          CustomPage: [
            { record: { id: "unrelated", title: { zh: "Wrong page" } } },
            { record: { id: "page", slug: "captured-page", title: titles } },
          ],
        },
      },
    );
    expect(model.facts).toContainEqual({
      key: "textDestination",
      value:
        typeof title === "string" && title.trim() ? title : "Captured English",
    });
    expect(model.changes).toEqual([
      {
        key: "value",
        before: title,
        requested: "  提议标题\n",
        hasBefore: title !== undefined,
      },
    ]);
  },
);

it.each([
  [
    "home.setSectionTranslation",
    { sectionId: "target", locale: "zh", title: "New", body: "Exact body" },
    { LandingSection: [{ id: "target", slug: "captured-section" }] },
    "captured-section",
  ],
  [
    "home.setPageTitle",
    { id: "target", locale: "zh", value: "New" },
    { CustomPage: [{ id: "target", title: {} }] },
    "target",
  ],
  [
    "home.setNewsTranslation",
    { postId: "target", locale: "zh", title: "New", body: "Exact body" },
    {
      "NewsPost.NewsTranslation": [
        { postId: "other", locale: "en", title: "Unrelated" },
      ],
    },
    "target",
  ],
])(
  "uses captured slug/ID when %s has no usable title",
  (operation, payload, destination, expected) => {
    const model = approvalPresentation(
      "translationReview.decide",
      { id: "draft", approve: true },
      { TranslationDraft: [{ id: "draft", operation, payload }], destination },
    );
    expect(model.facts).toContainEqual({
      key: "textDestination",
      value: expected,
    });
    expect(
      model.changes.every(
        (field) => !field.hasBefore && field.before === undefined,
      ),
    ).toBe(true);
  },
);

it("isolates one attendance change with unchanged roster, preserving null/missing/false/zero", () => {
  const before = [
    { tuteeId: "a", status: "PRESENT", absenceReason: null },
    { tuteeId: "b", status: "UNEXCUSED_ABSENT", absenceReason: null },
  ];
  const requested = [
    before[0]!,
    { tuteeId: "b", status: "EXCUSED_ABSENT", absenceReason: "School event" },
  ];
  const model = reviewCollection(before, requested, "tuteeId")!;
  expect(model.counts).toEqual({
    changed: 1,
    unchanged: 1,
    added: 0,
    removed: 0,
  });
  expect(
    reviewCollection(before, [...before].reverse(), "tuteeId")?.counts
      .unchanged,
  ).toBe(2);
  expect(
    reviewCollection(
      [{ id: "a", n: 0, flag: false, value: null }],
      [{ id: "a", n: 0, flag: false }],
      "id",
    )?.counts.changed,
  ).toBe(1);
});

it("compares membership additions/removals by ID and declines ambiguous legacy shapes", () => {
  expect(reviewCollection(["a", "b"], ["b", "c"], "tuteeId")?.counts).toEqual({
    added: 1,
    removed: 1,
    changed: 0,
    unchanged: 1,
  });
  for (const before of [[{ missingId: "x" }], ["a", "a"], null])
    expect(reviewCollection(before, ["a"], "id")).toBeNull();
});

it("compares only owned patrol instants while preserving exact source types and text", () => {
  const stored = "2026-10-27T09:00:00+08:00";
  const restored = new Date("2026-10-27T01:00:00.000Z");
  const before = [{ id: "observation", observedAt: stored, headcount: "ONE" }];
  const requested = [
    { id: "observation", observedAt: restored, headcount: "ONE" },
  ];
  const collection = reviewCollection(before, requested, "id", ["observedAt"])!;
  expect(collection.counts).toEqual({
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 1,
  });
  expect(collection.rows[0]?.before).toBe(before[0]);
  expect(collection.rows[0]?.requested).toBe(requested[0]);
  expect(requested[0]?.observedAt).toBe(restored);
  expect(reviewCollection(before, requested, "id")?.counts.changed).toBe(1);
  expect(
    reviewCollectionFieldEqual(stored, restored, "observedAt", ["observedAt"]),
  ).toBe(true);
  expect(
    reviewCollectionFieldEqual(
      stored,
      new Date("2026-10-27T01:00:00.001Z"),
      "observedAt",
      ["observedAt"],
    ),
  ).toBe(false);
  expect(
    reviewCollectionFieldEqual(stored, restored, "note", ["observedAt"]),
  ).toBe(false);
  expect(
    reviewCollectionFieldEqual(
      null,
      undefined,
      "observedAt",
      ["observedAt"],
      true,
      false,
    ),
  ).toBe(false);
  expect(
    reviewCollectionFieldEqual("invalid old", "invalid new", "observedAt", [
      "observedAt",
    ]),
  ).toBe(false);
  const model = approvalPresentation(
    "corrections.correctPatrol",
    { id: "patrol", observations: requested },
    {
      Patrol: [{ id: "patrol" }],
      "Patrol.PatrolObservation": before.map((row) => ({
        ...row,
        patrolId: "patrol",
      })),
    },
  );
  expect(model.changes).toHaveLength(0);
  expect(model.unchanged[0]?.collection?.counts.unchanged).toBe(1);
});

it("compares a versioned merged attendance union and declines old incomplete membership claims", () => {
  const a = { tuteeId: "a", status: "PRESENT", absenceReason: null };
  const b = { tuteeId: "b", status: "UNEXCUSED_ABSENT", absenceReason: null };
  const payload = {
    id: "primary",
    tutees: [
      a,
      { ...b, status: "EXCUSED_ABSENT", absenceReason: "Recorded excuse" },
    ],
  };
  const targets = {
    reviewPresentation: { version: 1 },
    Session: [
      { id: "primary", mergeGroupId: "primary" },
      { id: "sibling", mergeGroupId: "primary" },
      { id: "unrelated", mergeGroupId: null },
    ],
    "Session.SessionTutee": [
      { ...a, sessionId: "primary" },
      { ...a, sessionId: "sibling" },
      { ...b, sessionId: "sibling" },
      { tuteeId: "other", sessionId: "unrelated", status: "PRESENT" },
    ],
  };
  const model = approvalPresentation(
    "corrections.correctAttendance",
    payload,
    targets,
  );
  expect(model.changes[0]?.collection?.counts).toEqual({
    added: 0,
    removed: 0,
    changed: 1,
    unchanged: 1,
  });
  expect(model.outcome).toBe("attendanceOutcome");
  expect(model.changes[0]?.collection?.rows.map((row) => row.id)).toEqual([
    "a",
    "b",
  ]);
  const legacy = approvalPresentation(
    "corrections.correctAttendance",
    payload,
    { ...targets, reviewPresentation: undefined },
  );
  expect(legacy.changes[0]?.collection).toBeNull();
  expect(legacy.changes[0]?.before).toEqual([a]);
  expect(legacy.changes[0]?.requested).toBe(payload.tutees);
  const conflict = approvalPresentation(
    "corrections.correctAttendance",
    payload,
    {
      ...targets,
      "Session.SessionTutee": [
        ...targets["Session.SessionTutee"],
        { ...a, sessionId: "sibling", status: "UNEXCUSED_ABSENT" },
      ],
    },
  );
  expect(conflict.changes[0]?.collection).toBeNull();
});
