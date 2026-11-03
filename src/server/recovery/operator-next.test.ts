import { describe, expect, it } from "vitest";
import { sessionIdentity } from "../../lib/session-identity";
import {
  readNextApplicationSession,
  readNextJsonObject,
} from "./operator-next";

const authenticated = {
  user: {
    id: "synthetic-acceptance",
    name: "Synthetic acceptance",
    email: "acceptance@example.test",
    image: null,
  },
  expires: "2099-11-03T02:38:00.000Z",
  role: "HEAD",
  tutorId: null,
  sessionVersion: 12,
  historyAccessRevision: 34,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

describe("genuine Next session response contract", () => {
  it("preserves authenticated identity, generations and additive Auth.js fields", async () => {
    const value = {
      ...authenticated,
      additiveSessionField: "synthetic-display-only",
      user: { ...authenticated.user, additiveUserField: true },
    };
    const session = await readNextApplicationSession(json(value));
    expect(session).toEqual(value);
    expect(sessionIdentity(session)).toBe(
      JSON.stringify([authenticated.user.id, "HEAD", null, 12, 34]),
    );
  });

  it("recognizes missing-session null without granting an authenticated identity", async () => {
    const session = await readNextApplicationSession(json(null));
    expect(session).toBeNull();
    expect(session?.user.id).not.toBe(authenticated.user.id);
    expect(sessionIdentity(session)).toBe("anonymous");
  });

  it.each(["invalid-signing-key", "revoked-session-generation"])(
    "recognizes the actual null plus expired-cookie wire shape for %s",
    async () => {
      // recoverInvalidSession strips rejected cookies before the Auth.js API;
      // Auth.js also returns null when its jwt callback rejects a generation.
      const response = json(null);
      response.headers.append(
        "Set-Cookie",
        "authjs.session-token=; Path=/; Max-Age=0; HttpOnly",
      );
      expect(await readNextApplicationSession(response)).toBeNull();
    },
  );

  it.each(
    [
      {},
      [],
      false,
      0,
      "signed out",
      { user: null },
      { error: "synthetic-private-response" },
      { ...authenticated, user: {} },
      { ...authenticated, user: { id: "" } },
      { ...authenticated, user: { id: 1 } },
      { ...authenticated, user: { ...authenticated.user, name: 1 } },
      { ...authenticated, role: "UNKNOWN" },
      { ...authenticated, tutorId: {} },
      { ...authenticated, expires: "not-a-date" },
      { ...authenticated, sessionVersion: "12" },
      { ...authenticated, sessionVersion: -1 },
      { ...authenticated, historyAccessRevision: null },
      { ...authenticated, historyAccessRevision: 1.5 },
    ].map((value) => ({ value })),
  )(
    "rejects malformed session shapes rather than counting a denial: %j",
    async ({ value }) => {
      await expect(readNextApplicationSession(json(value))).rejects.toThrow(
        "NEXT_ACCEPTANCE_INVALID_RESPONSE",
      );
    },
  );

  it.each([201, 400, 401, 403, 429, 500])(
    "rejects status %s even if its JSON body is null",
    async (status) => {
      await expect(
        readNextApplicationSession(json(null, status)),
      ).rejects.toThrow("NEXT_ACCEPTANCE_SESSION_ROUTE_FAILED");
    },
  );

  it("rejects incorrect content type and malformed JSON with stable private-free diagnostics", async () => {
    await expect(
      readNextApplicationSession(
        new Response("null", {
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ).rejects.toThrow("NEXT_ACCEPTANCE_INVALID_RESPONSE");
    const privateMarker = "synthetic-secret-not-for-diagnostics";
    try {
      await readNextApplicationSession(
        new Response(`{"user":"${privateMarker}`, {
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect.unreachable("Malformed JSON must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("NEXT_ACCEPTANCE_INVALID_RESPONSE");
      expect(String(error)).not.toContain(privateMarker);
    }
  });

  it("cancels an oversized streamed response before buffering the complete body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readNextApplicationSession(
        new Response(stream, {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).rejects.toThrow("NEXT_ACCEPTANCE_RESPONSE_TOO_LARGE");
    expect(cancelled).toBe(true);
  });

  it("rejects invalid UTF-8 and masks stream failure details", async () => {
    await expect(
      readNextApplicationSession(
        new Response(new Uint8Array([0xff]), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).rejects.toThrow("NEXT_ACCEPTANCE_INVALID_RESPONSE");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("synthetic-private-stream-error"));
      },
    });
    await expect(
      readNextApplicationSession(
        new Response(stream, {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).rejects.toThrow("NEXT_ACCEPTANCE_INVALID_RESPONSE");
  });
});

describe("non-session Next JSON responses", () => {
  it("retains object responses for CSRF and RPC", async () => {
    const csrf = { csrfToken: "synthetic-proof" };
    expect(await readNextJsonObject(json(csrf))).toEqual(csrf);
    const rpc = { result: { data: { json: { allowed: true } } } };
    expect(await readNextJsonObject(json(rpc))).toEqual(rpc);
  });

  it.each([null, [], true, "object required"].map((value) => ({ value })))(
    "does not generalize signed-out handling to generic JSON objects: %j",
    async ({ value }) => {
      await expect(readNextJsonObject(json(value))).rejects.toThrow(
        "NEXT_ACCEPTANCE_INVALID_RESPONSE",
      );
    },
  );
});
