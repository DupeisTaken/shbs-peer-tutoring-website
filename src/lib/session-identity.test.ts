import { expect, it } from "vitest";
import { sessionIdentity } from "./session-identity";

const account = {
  user: { id: "reader", name: "Original name" },
  role: "TUTOR", tutorId: "participation", sessionVersion: 3, historyAccessRevision: 1,
};

it("separates corrected private access and same-account credential generations", () => {
  const before = sessionIdentity(account);
  expect(sessionIdentity({ ...account, historyAccessRevision: 2 })).not.toBe(before);
  expect(sessionIdentity({ ...account, sessionVersion: 4 })).not.toBe(before);
});

it("retains forms across display and expiration changes", () => {
  expect(sessionIdentity({ ...account, user: { ...account.user, name: "Changed" }, expires: "later" }))
    .toBe(sessionIdentity(account));
});

it.each([null, undefined, {}, { user: null }, { user: { id: 1 } }])(
  "conceals missing or invalid identities", (value) => {
    expect(sessionIdentity(value)).toBe("anonymous");
  },
);
