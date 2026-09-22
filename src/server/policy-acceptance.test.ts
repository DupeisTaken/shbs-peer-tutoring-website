import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { publicSignupPolicy } from "./policy-acceptance";
const client = (findMany: unknown) =>
  ({ policyDocument: { findMany } }) as TransactionDb;
it.each([
  { documents: [] },
  { documents: [{ locale: "en", body: " ", title: "Draft", version: 1 }] },
])("reports unpublished policy as setup state", async ({ documents }) => {
  expect(
    await publicSignupPolicy(
      client(vi.fn().mockResolvedValue(documents)),
      "tutee-policy",
      "en",
    ),
  ).toBeNull();
});
it("falls back to published English and preserves the acceptance revision", async () => {
  const documents = [
    { locale: "en", body: "Reviewed policy", title: "Policy", version: 1 },
  ];
  expect(
    await publicSignupPolicy(
      client(vi.fn().mockResolvedValue(documents)),
      "tutor-policy",
      "zh",
    ),
  ).toMatchObject({ ...documents[0], revision: expect.any(String) as unknown });
});
it("does not disguise real database failures as missing configuration", async () => {
  await expect(
    publicSignupPolicy(
      client(vi.fn().mockRejectedValue(new Error("offline"))),
      "tutor-policy",
    ),
  ).rejects.toThrow("offline");
});
