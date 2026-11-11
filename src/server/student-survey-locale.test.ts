import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { surveyDeliveryLocale } from "./student-survey";

const queries = {
  user: { findUnique: vi.fn() },
  studentProfileOwnership: { findUnique: vi.fn() },
};
const client = queries as unknown as Parameters<typeof surveyDeliveryLocale>[0];
const row = {
  tuteeId: null,
  email: "captured@example.test",
  emailLocale: "en",
  payload: { academicAccountId: "captured-account" },
};
const account = {
  email: row.email,
  emailLocale: "zh",
  mergedIntoId: null,
  emails: [],
};
beforeEach(() => {
  queries.user.findUnique.mockReset().mockResolvedValue(account);
  queries.studentProfileOwnership.findUnique
    .mockReset()
    .mockResolvedValue(null);
});

it("uses the captured account's current choice for an unconfirmed request without a roster", async () => {
  expect(await surveyDeliveryLocale(client, row)).toBe("zh");
  expect(queries.studentProfileOwnership.findUnique).not.toHaveBeenCalled();
  expect(queries.user.findUnique).toHaveBeenCalledWith({
    where: { id: "captured-account" },
    select: {
      email: true,
      emailLocale: true,
      mergedIntoId: true,
      emails: {
        where: { email: row.email, verifiedAt: { not: null } },
        select: { email: true },
      },
    },
  });
  expect(row.emailLocale).toBe("en");
});

it("accepts a currently verified alias of the exact captured account", async () => {
  queries.user.findUnique.mockResolvedValue({
    ...account,
    email: "primary@example.test",
    emails: [{ email: row.email }],
  });
  expect(await surveyDeliveryLocale(client, row)).toBe("zh");
});

it.each([
  null,
  { ...account, mergedIntoId: "another-account" },
  { ...account, email: "different@example.test", emails: [] },
])(
  "retains the source language when captured ownership is unavailable or changed (%j)",
  async (user) => {
    queries.user.findUnique.mockResolvedValue(user);
    expect(await surveyDeliveryLocale(client, row)).toBe("en");
  },
);

it("prefers explicit roster ownership over earlier intake account metadata", async () => {
  queries.studentProfileOwnership.findUnique.mockResolvedValue({
    userId: "retained-owner",
  });
  expect(
    await surveyDeliveryLocale(client, { ...row, tuteeId: "explicit-roster" }),
  ).toBe("zh");
  expect(queries.studentProfileOwnership.findUnique).toHaveBeenCalledWith({
    where: { tuteeId: "explicit-roster" },
    select: { userId: true },
  });
  expect(queries.user.findUnique).toHaveBeenCalledOnce();
  expect(queries.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "retained-owner" } }),
  );
});

it.each([
  { payload: null },
  { payload: [] },
  { payload: {} },
  { payload: { academicAccountId: 7 } },
])(
  "never discovers an account by an unbound destination or malformed payload (%j)",
  async ({ payload }) => {
    expect(await surveyDeliveryLocale(client, { ...row, payload })).toBe("en");
    expect(queries.user.findUnique).not.toHaveBeenCalled();
  },
);
