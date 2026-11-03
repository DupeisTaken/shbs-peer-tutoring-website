import { describe, expect, it } from "vitest";
import {
  validateAdmissionRootChanges,
  type AdmissionRootChange,
  type AdmissionRootContext,
} from "./admission-root-policy";

const initial: AdmissionRootContext = {
  applicationId: "application",
  tutorId: "tutor",
  codeIds: ["code"],
  beforeAccount: null,
  afterAccount: null,
  beforeTutor: null,
};
function insert(
  entity: string,
  after: Record<string, unknown>,
): AdmissionRootChange {
  const recordKey = Object.fromEntries(
    Object.entries(after).filter(([key]) => key === "id" || key.endsWith("Id")),
  );
  return {
    entity,
    operation: "INSERT",
    recordKey,
    before: null,
    after,
    changedFields: null,
  };
}
function update(
  entity: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  changedFields = Object.keys(patch),
): AdmissionRootChange {
  const after = { ...before, ...patch };
  const recordKey = Object.fromEntries(
    Object.entries(after).filter(([key]) => key === "id" || key.endsWith("Id")),
  );
  return {
    entity,
    operation: "UPDATE",
    recordKey,
    before,
    after,
    changedFields,
  };
}
function newAdmission(): AdmissionRootChange[] {
  return [
    update(
      "TutorApplication",
      { id: "application", status: "INTERVIEW", promotedTutorId: null },
      { status: "ACCEPTED", promotedTutorId: "tutor" },
      ["status", "promotedTutorId", "decisionComment", "decidedAt"],
    ),
    insert("Person", {
      id: "fresh-person",
      primaryUserId: null,
      mergedIntoId: null,
      updatedAt: "2030-01-01",
    }),
    insert("Tutor", {
      id: "tutor",
      personId: "fresh-person",
      status: "ACTIVE",
      historyIdentityRevision: 0,
      preferredAssignedBlocks: 1,
      workloadPreferenceVersion: 0,
    }),
    insert("RegistrationCode", {
      id: "code",
      applicationId: "application",
      tutorId: "tutor",
      crewApplicationId: null,
      issuedById: null,
      usedAt: null,
      usedByUserId: null,
      expiresAt: "2030-02-01",
    }),
  ];
}
function existingAdmission(role = "STUDENT") {
  const changesRole = ["STUDENT", "VIEWER", "CREW"].includes(role);
  const context: AdmissionRootContext = {
    ...initial,
    codeIds: [],
    beforeAccount: {
      id: "account",
      studentId: "student",
      personId: "existing-person",
    },
    afterAccount: { id: "account", studentId: "student" },
  };
  const changes = newAdmission().filter(
    (change) => change.entity !== "RegistrationCode",
  );
  changes.push(
    update(
      "User",
      {
        id: "account",
        studentId: "student",
        personId: "existing-person",
        role,
        tutorId: null,
        tutorAccessRevoked: true,
        profileVersion: 0,
      },
      {
        role: changesRole ? "TUTOR" : role,
        tutorId: "tutor",
        tutorAccessRevoked: false,
      },
      changesRole
        ? ["role", "tutorId", "tutorAccessRevoked", "refreshAuthorityRevision"]
        : ["tutorId", "tutorAccessRevoked"],
    ),
    update(
      "Person",
      { id: "fresh-person", primaryUserId: null, mergedIntoId: null },
      { mergedIntoId: "existing-person" },
      ["mergedIntoId", "revision"],
    ),
    update(
      "Person",
      { id: "existing-person", primaryUserId: "account", mergedIntoId: null },
      {},
      ["revision"],
    ),
    update(
      "Tutor",
      {
        id: "tutor",
        personId: "fresh-person",
        status: "ACTIVE",
        historyIdentityRevision: 0,
      },
      { personId: "existing-person", historyIdentityRevision: 1 },
      [
        "personId",
        "historyIdentityRevision",
        "englishName",
        "username",
        "nameFieldsConfirmed",
      ],
    ),
    update(
      "User",
      { id: "account", personId: "existing-person", profileVersion: 0 },
      { profileVersion: 1 },
      ["profileVersion", "name", "username", "gradeLevel"],
    ),
    update("Tutee", { id: "student", personId: "existing-person" }, {}, [
      "englishName",
      "legacyName",
      "academicallyGraduated",
    ]),
    insert("AcademicProfile", {
      userId: "account",
      status: "UNKNOWN",
      confirmedAt: null,
    }),
    update(
      "AcademicProfile",
      { userId: "account", status: "UNKNOWN", confirmedAt: null },
      {},
      ["reconfirmRequired"],
    ),
    insert("HistoricalAcademicRecord", {
      id: "legacy-tutee:student",
      tutorId: null,
      tuteeId: "student",
    }),
  );
  return { changes, context };
}

describe("positive initial-admission root policy", () => {
  it("allows an ordinary new applicant's exact provisioning without inventing credentials", () => {
    expect(validateAdmissionRootChanges(newAdmission(), initial)).toEqual({
      supported: true,
      unsupportedChangeIndexes: [],
    });
  });

  it.each([
    "STUDENT",
    "VIEWER",
    "CREW",
    "ADMIN",
    "HEAD",
    "COORDINATOR",
    "TUTOR",
  ])(
    "allows a verified existing %s account and exact profile/academic/trigger mirrors",
    (role) => {
      const { changes, context } = existingAdmission(role);
      expect(validateAdmissionRootChanges(changes, context)).toEqual({
        supported: true,
        unsupportedChangeIndexes: [],
      });
    },
  );

  it("allows returning historical tutors, metadata initialization and immutable baseline preservation", () => {
    const context = {
      ...initial,
      beforeTutor: { id: "tutor", personId: null },
    };
    const changes = newAdmission().filter(
      (change) => change.entity !== "Tutor",
    );
    changes.push(
      insert("HistoricalAcademicRecord", {
        id: "legacy-tutor:tutor",
        tutorId: "tutor",
        tuteeId: null,
      }),
      update(
        "Tutor",
        { id: "tutor", status: "ARCHIVED", personId: null },
        { status: "ACTIVE", personId: "fresh-person" },
        ["status", "personId", "historyIdentityRevision", "updatedAt"],
      ),
      update(
        "HistoricalAcademicRecord",
        { id: "legacy-tutor:tutor", tutorId: "tutor", tuteeId: null },
        {},
      ),
    );
    expect(validateAdmissionRootChanges(changes, context).supported).toBe(true);
  });

  it.each([
    "Session",
    "SessionTutee",
    "DisciplinaryCard",
    "ServiceHourAdjustment",
    "AcademicConfirmation",
    "AccountEmail",
    "StudentProfileOwnership",
    "TutorProfileOwnership",
    "QualificationGrant",
    "AccountInvitation",
    "UnknownFutureTable",
  ])(
    "blocks %s even when it shares the trusted ADMISSION transaction",
    (entity) => {
      const changes = [
        ...newAdmission(),
        insert(entity, { id: "extra", tutorId: "tutor" }),
      ];
      expect(validateAdmissionRootChanges(changes, initial)).toEqual({
        supported: false,
        unsupportedChangeIndexes: [4],
      });
    },
  );

  it("blocks unrelated users, students, baseline records and source codes", () => {
    const { changes, context } = existingAdmission();
    const extras = [
      update("User", { id: "unrelated", personId: "existing-person" }, {}, [
        "name",
      ]),
      update("Tutee", { id: "unrelated", personId: "existing-person" }, {}, [
        "englishName",
      ]),
      insert("HistoricalAcademicRecord", {
        id: "legacy-tutee:unrelated",
        tutorId: null,
        tuteeId: "unrelated",
      }),
      insert("RegistrationCode", {
        id: "unrelated",
        applicationId: "application",
        tutorId: "tutor",
        crewApplicationId: null,
        usedAt: null,
        usedByUserId: null,
      }),
    ];
    expect(
      validateAdmissionRootChanges([...changes, ...extras], context)
        .unsupportedChangeIndexes,
    ).toEqual(extras.map((_, index) => changes.length + index));
  });

  it.each([
    "passwordHash",
    "sessionVersion",
    "twoFactorEnabled",
    "email",
    "emailVerifiedAt",
    "mustChangePassword",
    "suspendedAt",
    "mergedIntoId",
    "canTranslate",
    "crewStatus",
    "tuteeMember",
    "studentId",
    "recoveryVoidedAt",
  ])("blocks mixed account security/ownership changes to %s", (field) => {
    const { context } = existingAdmission();
    const change = update("User", { id: "account", tutorId: null }, {}, [
      "name",
      field,
    ]);
    expect(validateAdmissionRootChanges([change], context).supported).toBe(
      false,
    );
  });

  it.each(["HEAD", "ADMIN", "COORDINATOR", "CREW", "VIEWER"])(
    "does not adopt a role grant to %s",
    (role) => {
      const { context } = existingAdmission();
      const change = update(
        "User",
        { id: "account", role: "STUDENT" },
        { role },
        ["role", "refreshAuthorityRevision"],
      );
      expect(validateAdmissionRootChanges([change], context).supported).toBe(
        false,
      );
    },
  );

  it("rejects revocation bypass and an unattached authority epoch change", () => {
    const { context } = existingAdmission();
    const changes = [
      update(
        "User",
        { id: "account", tutorId: "tutor", tutorAccessRevoked: true },
        { tutorAccessRevoked: false },
      ),
      update("User", { id: "account", tutorId: null }, {}, [
        "refreshAuthorityRevision",
      ]),
    ];
    expect(
      validateAdmissionRootChanges(changes, context).unsupportedChangeIndexes,
    ).toEqual([0, 1]);
  });

  it("rejects established-group redirects and reassignments while allowing fresh-group relocation", () => {
    const { changes, context } = existingAdmission();
    expect(validateAdmissionRootChanges(changes, context).supported).toBe(true);
    const redirect = update(
      "Person",
      { id: "existing-person", primaryUserId: "account", mergedIntoId: null },
      { mergedIntoId: "fresh-person" },
      ["mergedIntoId", "revision"],
    );
    const reassign = update(
      "Tutee",
      { id: "student", personId: "existing-person" },
      { personId: "fresh-person" },
      ["personId", "historyIdentityRevision"],
    );
    // The reverse redirect forms a cycle with the otherwise valid fresh-group
    // relocation. That invalidates the whole root's identity context.
    const rejected = validateAdmissionRootChanges(
      [...changes, redirect, reassign],
      context,
    );
    expect(rejected.supported).toBe(false);
    expect(rejected.unsupportedChangeIndexes).toEqual(
      Array.from({ length: changes.length + 2 }, (_, index) => index),
    );
  });

  it("does not trust an arbitrary after-image or unrelated Person insert to establish ownership", () => {
    const { context } = existingAdmission();
    const changes = [
      update(
        "User",
        { id: "account", personId: null },
        { personId: "unproven" },
      ),
      insert("Person", {
        id: "unproven",
        primaryUserId: "unrelated-login",
        mergedIntoId: null,
      }),
      update(
        "Person",
        { id: "unknown-group", primaryUserId: null, mergedIntoId: null },
        {},
        ["revision"],
      ),
    ];
    expect(
      validateAdmissionRootChanges(changes, context).unsupportedChangeIndexes,
    ).toEqual([0, 1, 2]);
  });

  it("does not adopt a group from a later before-image after an unproven initial attachment", () => {
    const context: AdmissionRootContext = {
      ...initial,
      codeIds: [],
      beforeAccount: { id: "account", studentId: null, personId: null },
      afterAccount: { id: "account", studentId: null },
    };
    const changes = [
      update(
        "User",
        { id: "account", studentId: null, personId: null },
        { personId: "unproven-existing-group" },
      ),
      update(
        "User",
        { id: "account", studentId: null, personId: "unproven-existing-group" },
        {},
        ["name"],
      ),
      insert("Person", {
        id: "unrelated-fresh-person",
        primaryUserId: null,
        mergedIntoId: null,
      }),
    ];
    expect(
      validateAdmissionRootChanges(changes, context).unsupportedChangeIndexes,
    ).toEqual([0, 2]);
  });

  it("refuses cycles among otherwise freshly created directory groups", () => {
    const { changes, context } = existingAdmission();
    changes.push(
      insert("Person", {
        id: "second-fresh-person",
        primaryUserId: null,
        mergedIntoId: null,
      }),
      update(
        "Tutee",
        { id: "student", personId: null },
        { personId: "second-fresh-person" },
      ),
      update(
        "Person",
        { id: "second-fresh-person", primaryUserId: null, mergedIntoId: null },
        { mergedIntoId: "fresh-person" },
      ),
      update(
        "Person",
        {
          id: "fresh-person",
          primaryUserId: null,
          mergedIntoId: "existing-person",
        },
        { mergedIntoId: "second-fresh-person" },
      ),
    );
    expect(validateAdmissionRootChanges(changes, context).supported).toBe(
      false,
    );
  });

  it("does not reset directory review state or change an established primary login", () => {
    const { context } = existingAdmission();
    const changes = [
      update(
        "Person",
        { id: "existing-person", primaryUserId: "account", mergedIntoId: null },
        { primaryUserId: null },
      ),
      update(
        "Person",
        { id: "existing-person", primaryUserId: "account", mergedIntoId: null },
        {},
        ["resolutionState"],
      ),
    ];
    expect(
      validateAdmissionRootChanges(changes, context).unsupportedChangeIndexes,
    ).toEqual([0, 1]);
  });

  it("requires captured student scope rather than inferring it from a related current row", () => {
    const { context } = existingAdmission();
    context.beforeAccount = { id: "account" };
    context.afterAccount = { id: "account" };
    const change = update(
      "Tutee",
      { id: "student", personId: "existing-person" },
      {},
      ["englishName"],
    );
    expect(validateAdmissionRootChanges([change], context).supported).toBe(
      false,
    );
  });

  it("fails closed for missing column evidence, inconsistent visible deltas and unknown operations", () => {
    const base = update(
      "Tutor",
      { id: "tutor", status: "ARCHIVED" },
      { status: "ACTIVE" },
    );
    for (const change of [
      { ...base, changedFields: null },
      { ...base, changedFields: ["updatedAt"] },
      { ...base, changedFields: ["status", "status"] },
      { ...base, operation: "DELETE" },
      { ...base, recordKey: { id: "unrelated" } },
      { ...base, before: { id: "tutor", arbitrary: { secret: "private" } } },
    ])
      expect(validateAdmissionRootChanges([change], initial).supported).toBe(
        false,
      );
  });

  it("never invents missing original account provenance or adopts a different final account", () => {
    const { changes, context } = existingAdmission();
    expect(
      validateAdmissionRootChanges(changes, { ...context, beforeAccount: null })
        .supported,
    ).toBe(false);
    expect(
      validateAdmissionRootChanges(changes, {
        ...context,
        afterAccount: { id: "other-login" },
      }).supported,
    ).toBe(false);
    expect(validateAdmissionRootChanges([], initial).supported).toBe(false);
  });
});
