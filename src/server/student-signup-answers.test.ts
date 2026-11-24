import { expect, it } from "vitest";
import {
  currentStudentSignupPayload,
  effectiveStudentSignupEditedAt,
  nextStudentSignupEditedAt,
  studentSignupAnswersEqual,
  studentSignupIntentDigest,
} from "./student-signup-answers";

const original = {
  englishName: "Original Student",
  firstChoiceId: "math",
  slotIds: ["monday"],
  email: "owner@example.test",
  signatureName: "Original Signature",
  agreed: true,
  policyRevision: "original-policy",
  academicAccountId: "original-owner",
  academicProfileVersion: 4,
};

it("keeps legacy original answers without sharing its mutable object", () => {
  const current = currentStudentSignupPayload({ payload: original });
  expect(current).toEqual(original);
  expect(current).not.toBe(original);
  current.englishName = "Draft";
  expect(original.englishName).toBe("Original Student");
});

it("reads current local answers while retaining identity, signature and original policy evidence", () => {
  const current = currentStudentSignupPayload({
    payload: original,
    currentPayload: {
      englishName: "Corrected Request Name",
      firstChoiceId: "science",
      phone: "Synthetic contact",
      slotIds: ["tuesday"],
      email: "another-owner@example.test",
      signatureName: "Replacement Signature",
      agreed: false,
      policyRevision: "invented-policy",
      academicAccountId: "another-owner",
      academicProfileVersion: 99,
      arbitraryAccountGrant: true,
    },
  });
  expect(current).toEqual({
    ...original,
    englishName: "Corrected Request Name",
    firstChoiceId: "science",
    phone: "Synthetic contact",
    slotIds: ["tuesday"],
  });
  expect(original.firstChoiceId).toBe("math");
});

it("retains explicit clearing and never fabricates an omitted original signature", () => {
  expect(
    currentStudentSignupPayload({
      payload: { preferredName: "Original", phone: "Original" },
      currentPayload: {
        preferredName: "",
        phone: "",
        signatureName: "Invented",
      },
    }),
  ).toEqual({ preferredName: "", phone: "" });
});

it("clears omitted normalized optional and hidden fields without resurrecting original answers", () => {
  const current = currentStudentSignupPayload({
    payload: {
      ...original,
      secondChoiceId: "science",
      phone: "Old phone",
      gradeLevel: "10",
      preferredName: "Old preferred name",
    },
    currentPayload: {
      englishName: "Current",
      firstChoiceId: "math",
      slotIds: [],
    },
  });
  expect(current).toEqual({
    email: original.email,
    signatureName: original.signatureName,
    agreed: original.agreed,
    policyRevision: original.policyRevision,
    academicAccountId: original.academicAccountId,
    academicProfileVersion: original.academicProfileVersion,
    englishName: "Current",
    firstChoiceId: "math",
    slotIds: [],
  });
});

it.each([[], "text", 1, false])(
  "rejects malformed current answers: %j",
  (currentPayload) => {
    expect(() =>
      currentStudentSignupPayload({ payload: original, currentPayload }),
    ).toThrow();
  },
);

it("gives the same normalized intent a stable digest across object property order", () => {
  const first = {
    surveyId: "request-1",
    expectedVersion: 2,
    answers: { firstChoiceId: "math", slotIds: ["monday", "tuesday"] },
  };
  const reordered = {
    answers: { slotIds: ["monday", "tuesday"], firstChoiceId: "math" },
    expectedVersion: 2,
    surveyId: "request-1",
  };
  expect(studentSignupIntentDigest(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(studentSignupIntentDigest(first)).toBe(
    studentSignupIntentDigest(reordered),
  );
});

it("binds a retry to its exact request, draft version, answers and explicit policy consent", () => {
  const intent = {
    surveyId: "request-1",
    expectedVersion: 2,
    answers: { slotIds: ["monday", "tuesday"] },
  };
  const hash = studentSignupIntentDigest(intent);
  for (const changed of [
    { ...intent, surveyId: "request-2" },
    { ...intent, expectedVersion: 3 },
    { ...intent, answers: { slotIds: ["tuesday", "monday"] } },
    { ...intent, answers: { slotIds: ["monday"] } },
    {
      ...intent,
      consent: {
        policyRevision: "new-policy",
        signatureName: "Explicit Signature",
      },
    },
  ])
    expect(studentSignupIntentDigest(changed)).not.toBe(hash);
});

it.each([NaN, Infinity, -Infinity])(
  "rejects non-JSON intent numbers: %s",
  (value) => {
    expect(() => studentSignupIntentDigest({ value })).toThrow(TypeError);
  },
);

it("compares signup answers semantically across slot order, blank optionals and non-answer metadata", () => {
  expect(
    studentSignupAnswersEqual(original, {
      englishName: "Original Student",
      firstChoiceId: "math",
      slotIds: ["monday"],
      phone: "",
      gradeLevel: "",
      preferredName: null,
      alternativeNames: null,
      preferredContact: "",
      secondChoiceId: "",
    }),
  ).toBe(true);
  expect(
    studentSignupAnswersEqual(
      { ...original, slotIds: ["monday", "tuesday"] },
      { ...original, slotIds: ["tuesday", "monday", "tuesday"] },
    ),
  ).toBe(true);
  expect(
    studentSignupAnswersEqual(original, {
      ...original,
      preferredContact: "WeChat",
    }),
  ).toBe(false);
  expect(
    studentSignupAnswersEqual(original, {
      ...original,
      slotIds: ["tuesday"],
    }),
  ).toBe(false);
});

it("computes next editedAt only when answers diverge from the original submission and change", () => {
  const firstEdit = new Date("2026-10-10T00:00:00Z");
  const secondEdit = new Date("2026-10-12T00:00:00Z");
  const initialRow = {
    payload: original,
    currentPayload: null as Record<string, unknown> | null,
    editedAt: null as Date | null,
  };
  // Initial confirmation with identical answers is not an edit.
  expect(
    nextStudentSignupEditedAt(
      initialRow,
      {
        englishName: "Original Student",
        firstChoiceId: "math",
        slotIds: ["monday"],
      },
      firstEdit,
    ),
  ).toBeNull();
  // A real change stamps editedAt.
  const changed = {
    englishName: "Original Student",
    firstChoiceId: "math",
    preferredContact: "WeChat",
    slotIds: ["monday"],
  };
  expect(nextStudentSignupEditedAt(initialRow, changed, firstEdit)).toEqual(
    firstEdit,
  );
  // A no-op re-save preserves the prior edit timestamp without bumping it.
  const editedRow = {
    payload: original,
    currentPayload: changed,
    editedAt: firstEdit,
  };
  expect(nextStudentSignupEditedAt(editedRow, changed, secondEdit)).toEqual(
    firstEdit,
  );
  // Reverting back to the original submission clears editedAt.
  expect(
    nextStudentSignupEditedAt(
      editedRow,
      {
        englishName: "Original Student",
        firstChoiceId: "math",
        slotIds: ["monday"],
      },
      secondEdit,
    ),
  ).toBeNull();
});

it("suppresses historical false-positive editedAt when current answers match the original payload", () => {
  const stamped = new Date("2026-10-10T00:00:00Z");
  expect(
    effectiveStudentSignupEditedAt({
      payload: original,
      currentPayload: {
        englishName: "Original Student",
        firstChoiceId: "math",
        slotIds: ["monday"],
      },
      editedAt: stamped,
    }),
  ).toBeNull();
  expect(
    effectiveStudentSignupEditedAt({
      payload: original,
      currentPayload: {
        englishName: "Original Student",
        firstChoiceId: "math",
        slotIds: ["tuesday"],
      },
      editedAt: stamped,
    }),
  ).toEqual(stamped);
  // Pre-revision legacy rows with currentPayload=null retain their recorded edit marker.
  expect(
    effectiveStudentSignupEditedAt({
      payload: original,
      currentPayload: null,
      editedAt: stamped,
    }),
  ).toEqual(stamped);
});

it.each([undefined, new Date(0), 1n])(
  "rejects non-JSON values rather than hashing a colliding representation: %s",
  (value) => {
    expect(() => studentSignupIntentDigest({ value })).toThrow(TypeError);
  },
);
