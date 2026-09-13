import { expect, it } from "vitest";
import {
  applicablePolicySlugs,
  localizedSnapshot,
  policyActionTarget,
  policySnapshotDocuments,
} from "./policy-evidence";

it("uses participant capabilities independently of account role and separates ticket targets", () => {
  expect(
    applicablePolicySlugs({ studentId: "student", tutorId: "tutor" }),
  ).toEqual(["tutee-policy", "tutor-policy"]);
  expect(applicablePolicySlugs({ studentId: null, tutorId: null })).toEqual([]);
  expect(policyActionTarget("tutee-policy", "same-content")).not.toBe(
    policyActionTarget("tutor-policy", "same-content"),
  );
});
it("decodes exact historical text and versions, with locale then English fallback", () => {
  const snapshot = [
    {
      locale: "en",
      title: "Earlier rules",
      body: "Original **text**",
      version: "v1",
    },
    { locale: "zh", title: "旧守则", body: "当时的原文", version: null },
    { locale: "bad", title: 12, body: null },
  ];
  const before = JSON.stringify(snapshot);
  const parsed = policySnapshotDocuments(snapshot);
  expect(parsed).toHaveLength(2);
  expect(localizedSnapshot(parsed, "zh")?.body).toBe("当时的原文");
  expect(localizedSnapshot(parsed, "fr")?.version).toBe("v1");
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(policySnapshotDocuments({ legacy: "unrecognized evidence" })).toEqual(
    [],
  );
});
