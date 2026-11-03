import { describe, expect, it } from "vitest";
import { sessionIdentity } from "../../lib/session-identity";
import {
  readNextApplicationSession,
  readNextJsonObject,
  nextQueueDifferences,
  type NextQueueSnapshot,
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

describe("private-free restored queue diagnostics", () => {
  const snapshot = (
    deliveries: Record<string, unknown>[],
  ): NextQueueSnapshot => [
    { table: "EmailDelivery", rows: deliveries },
    { table: "SessionNotice", rows: [] },
    { table: "StudentSignupNotice", rows: [] },
    { table: "ScheduledProgramRefresh", rows: [] },
    { table: "MonthlyHoursSchedule", rows: [] },
    { table: "SchoolHoursSchedule", rows: [] },
  ];

  it("compares every restored identity while exposing only counts and changed column names", () => {
    const before = snapshot([
      {
        id: "synthetic-private-removed-id",
        recipient: "private-old@example.test",
        status: "CANCELLED_RECOVERY",
      },
      {
        id: "synthetic-private-changed-id",
        recipient: "private@example.test",
        status: "CANCELLED_RECOVERY",
        context: { password: "synthetic-private-old-context" },
      },
      { id: "synthetic-private-retained-id", status: "SENT" },
    ]);
    const after = snapshot([
      {
        id: "synthetic-private-added-id",
        recipient: "private-new@example.test",
        status: "PENDING",
      },
      {
        id: "synthetic-private-changed-id",
        recipient: "private@example.test",
        status: "SENT",
        context: { password: "synthetic-private-new-context" },
        "synthetic-private-column-name": "synthetic-private-column-value",
      },
      { id: "synthetic-private-retained-id", status: "SENT" },
    ]);
    const differences = nextQueueDifferences(before, after);
    expect(differences[0]).toEqual({
      table: "EmailDelivery",
      before: 3,
      after: 3,
      added: 1,
      removed: 1,
      changed: 1,
      changedFields: ["[other column]", "status"],
    });
    expect(
      differences
        .slice(1)
        .every(
          (table) =>
            table.added === 0 && table.removed === 0 && table.changed === 0,
        ),
    ).toBe(true);
    const diagnostic = JSON.stringify(differences);
    for (const marker of ["synthetic-private", "@example.test", "password"])
      expect(diagnostic).not.toContain(marker);
  });

  it("does not confuse row order or JSON key order with changed work", () => {
    const before = snapshot([
      { id: "a", context: { one: 1, two: 2 } },
      { id: "b", status: "SENT" },
    ]);
    const after = snapshot([
      { status: "SENT", id: "b" },
      { context: { two: 2, one: 1 }, id: "a" },
    ]);
    expect(nextQueueDifferences(before, after)[0]).toEqual({
      table: "EmailDelivery",
      before: 2,
      after: 2,
      added: 0,
      removed: 0,
      changed: 0,
      changedFields: [],
    });
  });

  it("fails closed for missing snapshots or ambiguous identities", () => {
    expect(() => nextQueueDifferences([], snapshot([]))).toThrow(
      "NEXT_ACCEPTANCE_QUEUE_SNAPSHOT_INVALID",
    );
    expect(() =>
      nextQueueDifferences(
        snapshot([{ id: "duplicate" }, { id: "duplicate" }]),
        snapshot([]),
      ),
    ).toThrow("NEXT_ACCEPTANCE_QUEUE_IDENTITY_INVALID");
    expect(() =>
      nextQueueDifferences(snapshot([{ status: "PENDING" }]), snapshot([])),
    ).toThrow("NEXT_ACCEPTANCE_QUEUE_IDENTITY_INVALID");
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
