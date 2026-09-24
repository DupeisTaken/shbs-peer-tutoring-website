import { describe, expect, it } from "vitest";
import {
  SIGNUP_FIELDS,
  signupSettings,
  normalizeTuteeFields,
  missingTuteeFields,
  normalizeTutorSubject,
  missingTutorSubject,
} from "./signup-fields";

describe("signup field invariants", () => {
  it("locks essentials for both forms even if persisted JSON attempts to override them", () => {
    const settings = signupSettings({
      tutor: {
        name: "hidden",
        email: "optional",
        policy: "hidden",
        firstSubject: "optional",
        custom: "required",
      },
      tutee: { name: "hidden", policy: "optional" },
    });
    for (const form of ["tutor", "tutee"] as const) {
      for (const field of SIGNUP_FIELDS[form].filter((field) => field.locked))
        expect(settings[form][field.key]).toBe("required");
      expect(settings[form].custom).toBeUndefined();
    }
  });
  it("preserves original defaults and ignores malformed persisted states", () => {
    expect(signupSettings({ tutee: { phone: "bad" } })).toEqual(
      signupSettings(null),
    );
    expect(signupSettings(null).tutee).toMatchObject({
      phone: "optional",
      preferredContact: "required",
      availability: "required",
    });
  });
  it("discards hidden tutee values and never lets them block a submission", () => {
    const fields = signupSettings({
      tutee: {
        preferredContact: "hidden",
        availability: "hidden",
        signatureName: "hidden",
        secondSubject: "hidden",
        phone: "required",
      },
    }).tutee;
    const input = {
      preferredContact: "stale",
      slotIds: ["stale"],
      signatureName: "stale",
      secondChoiceId: "stale",
      phone: "   ",
    };
    const normalized = normalizeTuteeFields(input, fields);
    expect(normalized).toMatchObject({
      preferredContact: "",
      slotIds: [],
      signatureName: "",
      secondChoiceId: undefined,
    });
    expect(missingTuteeFields(normalized, fields)).toEqual(["phone"]);
    expect(input.preferredContact).toBe("stale");
    expect(
      missingTuteeFields(
        { preferredContact: "", signatureName: "", slotIds: [] },
        fields,
      ),
    ).toEqual(["phone"]);
  });
  it.each([true, false])(
    "accepts an explicit %s answer to a required qualification question",
    (answer) => {
      const fields = signupSettings({ tutor: { taken: "required" } }).tutor;
      expect(
        missingTutorSubject(
          { subjectId: "math", taken: answer },
          fields,
          false,
        ),
      ).toEqual([]);
      expect(missingTutorSubject({ subjectId: "math" }, fields, false)).toEqual(
        ["taken"],
      );
    },
  );
  it("requires details only for affirmative visible parents and AP-eligible subjects", () => {
    const fields = signupSettings({
      tutor: {
        taken: "hidden",
        grade: "required",
        hasApScore: "required",
        apScore: "required",
        selfStudyNote: "required",
      },
    }).tutor;
    const row = {
      subjectId: "math",
      taken: true,
      grade: "old",
      hasApScore: true,
      apScore: "",
      selfStudied: false,
    };
    const ordinary = normalizeTutorSubject(row, fields, false);
    expect(ordinary).toMatchObject({
      taken: undefined,
      grade: undefined,
      hasApScore: undefined,
      apScore: undefined,
    });
    expect(missingTutorSubject(ordinary, fields, false)).toEqual([]);
    expect(
      missingTutorSubject(
        normalizeTutorSubject(row, fields, true),
        fields,
        true,
      ),
    ).toEqual(["apScore"]);
  });
});
