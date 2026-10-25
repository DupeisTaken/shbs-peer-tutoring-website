import { expect, it } from "vitest";
import { surveyInput } from "./student-signup";

const intake = {
  englishName: "  Alex Lin  ",
  email: "Alex@Example.test",
  firstChoiceId: "mathematics",
  agreed: true,
  policyRevision: "current-policy",
};

it.each([null, { unexpected: "nested input" }])(
  "rejects an oversized slot list before accumulating element errors (%j)",
  (invalidSlot) => {
    // GHSA-mrhx-c7xc-m3w5: 101 small values are enough to prove early rejection
    // at the actual public intake boundary, without a resource-intensive payload.
    const result = surveyInput.safeParse({
      ...intake,
      slotIds: Array.from({ length: 101 }, () => invalidSlot),
    });
    expect(result.success).toBe(false);
    if (result.success)
      throw new Error("Oversized intake unexpectedly accepted");
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        code: "too_big",
        path: ["slotIds"],
        maximum: 100,
      }),
    ]);
  },
);

it("accepts the slot limit and preserves normalization and omitted-field defaults", () => {
  const slotIds = Array.from({ length: 100 }, (_, index) => `slot-${index}`);
  expect(surveyInput.parse({ ...intake, slotIds })).toMatchObject({
    englishName: "Alex Lin",
    email: "alex@example.test",
    preferredContact: "",
    signatureName: "",
    slotIds,
  });
  expect(surveyInput.parse(intake).slotIds).toEqual([]);
});

it("still rejects invalid elements within the size limit", () => {
  const result = surveyInput.safeParse({ ...intake, slotIds: ["valid", null] });
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Invalid slot unexpectedly accepted");
  expect(result.error.issues).toEqual([
    expect.objectContaining({ code: "invalid_type", path: ["slotIds", 1] }),
  ]);
});
