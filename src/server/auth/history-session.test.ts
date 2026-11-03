import { expect, it } from "vitest";
import { authConfig } from "./config";
import { sessionIdentity } from "~/lib/session-identity";

it("exposes only token-owned access generations, ignoring supplied session updates", () => {
  // Auth.js declares the combined database/JWT callback intersection, although
  // this application uses only JWT sessions. Exercise that actual callback.
  const input = {
    session: {
      user: { id: "reader" }, expires: "2099-01-01", role: "TUTOR", tutorId: "tutor",
      sessionVersion: 900, historyAccessRevision: 900,
    },
    token: {
      sub: "reader", role: "TUTOR", tutorId: "tutor",
      sessionVersion: 8, historyAccessRevision: 3,
    },
    newSession: { sessionVersion: 900, historyAccessRevision: 900 }, trigger: "update",
  } as Parameters<typeof authConfig.callbacks.session>[0];
  const session = authConfig.callbacks.session(input);
  expect(session).toMatchObject({ sessionVersion: 8, historyAccessRevision: 3 });
  expect(sessionIdentity(session)).toBe(JSON.stringify(["reader", "TUTOR", "tutor", 8, 3]));
});
