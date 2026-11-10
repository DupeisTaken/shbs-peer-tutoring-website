import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createTranslationIntentClient,
  parseTranslationIntentReceipt,
  TRANSLATION_INTENT_STORAGE_KEY,
  type TranslationIntentMetadata,
} from "./translation-intent-client";

const metadata: TranslationIntentMetadata = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  actorId: "synthetic-author",
  operation: "localization.setString",
  mode: "DRAFT",
};
const stopped = {
  status: "STOPPED",
  version: 1,
  intentId: metadata.id,
  stoppedAt: new Date("2026-11-09"),
};
const accepted = {
  status: "ACCEPTED",
  version: 1,
  intentId: metadata.id,
  operation: metadata.operation,
  mode: "DRAFT",
  outcome: "DRAFT_SUBMITTED",
  draftId: "synthetic-draft",
  cleared: false,
  acceptedAt: new Date("2026-11-09"),
  replayed: true,
};
function fixture(raw?: string) {
  const values = new Map<string, string>(
    raw === undefined ? [] : [[TRANSLATION_INTENT_STORAGE_KEY, raw]],
  );
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return {
    values,
    storage,
    client: createTranslationIntentClient(() => storage),
  };
}

describe("translation intent metadata store", () => {
  it("persists exactly four validated metadata fields and no payload, hash, result or unrelated storage", () => {
    const { client, values, storage } = fixture();
    values.set("unrelated", "keep");
    client.admit(metadata);
    const records = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(values.get(TRANSLATION_INTENT_STORAGE_KEY)!));
    expect(records).toEqual([metadata]);
    expect(Object.keys(records[0]!).sort()).toEqual([
      "actorId",
      "id",
      "mode",
      "operation",
    ]);
    expect(
      storage.setItem.mock.calls.every(
        ([key]) => key === TRANSLATION_INTENT_STORAGE_KEY,
      ),
    ).toBe(true);
    expect(values.get("unrelated")).toBe("keep");
    expect(() =>
      client.admit(
        Object.assign({}, metadata, {
          id: "123e4567-e89b-42d3-a456-426614174001",
          body: "PRIVATE-TEXT",
          inputHash: "PRIVATE-HASH",
        }),
      ),
    ).toThrow();
    expect(values.get(TRANSLATION_INTENT_STORAGE_KEY)).not.toContain("PRIVATE");
  });
  it("restores unresolved metadata without inventing input or retry callbacks", async () => {
    const { client } = fixture(JSON.stringify([metadata]));
    client.hydrate();
    expect(client.getSnapshot()).toMatchObject({
      ready: true,
      storageError: false,
      entries: [
        { metadata, status: "UNKNOWN", canRetry: false, canRefresh: false },
      ],
    });
    await client.retry(metadata);
    client.resolve(metadata, accepted);
    await client.deliver(metadata);
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "ACCEPTED",
      canRetry: false,
    });
  });
  it.each([
    "{broken",
    JSON.stringify([{ ...metadata, body: "PRIVATE" }]),
    JSON.stringify([metadata, metadata]),
  ])(
    "fails closed on invalid persisted metadata without deleting it: %s",
    (raw) => {
      const { client, values } = fixture(raw);
      client.hydrate();
      expect(client.getSnapshot().storageError).toBe(true);
      expect(() => client.admit(metadata)).toThrow();
      expect(values.get(TRANSLATION_INTENT_STORAGE_KEY)).toBe(raw);
    },
  );
  it("does not admit work when storage throws or silently drops a write", () => {
    const throwing = createTranslationIntentClient(() => {
      throw new Error("unavailable");
    });
    expect(() => throwing.admit(metadata)).toThrow();
    expect(throwing.getSnapshot().storageError).toBe(true);
    const dropping = createTranslationIntentClient(() => ({
      getItem: () => null,
      setItem: () => undefined,
    }));
    expect(() => dropping.admit(metadata)).toThrow();
    expect(dropping.getSnapshot().entries).toHaveLength(0);
  });
  it("globally fences unresolved requests per original actor, including NOT_RECORDED", () => {
    const { client } = fixture();
    client.admit(metadata);
    client.resolve(metadata, {
      status: "NOT_RECORDED",
      version: 1,
      intentId: metadata.id,
    });
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      absent: true,
    });
    expect(() => client.dismiss(metadata)).toThrow();
    expect(() =>
      client.admit({ ...metadata, id: "123e4567-e89b-42d3-a456-426614174001" }),
    ).toThrow();
    expect(() =>
      client.admit({ ...metadata, actorId: "another-actor" }),
    ).not.toThrow();
  });
  it("absorbs stale absence and stop/read races after the first terminal result", () => {
    const { client } = fixture();
    client.admit(metadata);
    client.resolve(metadata, stopped);
    expect(
      client.resolve(metadata, {
        status: "NOT_RECORDED",
        version: 1,
        intentId: metadata.id,
      }),
    ).toEqual(stopped);
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "STOPPED",
      absent: false,
    });
    const second = fixture();
    second.client.admit(metadata);
    second.client.resolve(metadata, accepted);
    expect(second.client.resolve(metadata, stopped)).toEqual(accepted);
    second.client.dismiss(metadata);
    expect(
      second.client.resolve(metadata, {
        status: "NOT_RECORDED",
        version: 1,
        intentId: metadata.id,
      }),
    ).toEqual(accepted);
    expect(second.client.getSnapshot().entries).toHaveLength(0);
    expect(() => second.client.admit(metadata)).toThrow();
  });
  it("removes retry callbacks on owner cleanup while retaining durable metadata", async () => {
    const { client, values } = fixture();
    client.admit(metadata);
    const retry = vi.fn();
    const detach = client.register(metadata, {
      canRetry: () => true,
      retry,
      canRefresh: () => true,
      accept: vi.fn(),
      stop: vi.fn(),
      refresh: vi.fn(),
    });
    detach();
    await client.retry(metadata);
    expect(retry).not.toHaveBeenCalled();
    expect(client.getSnapshot().entries[0]).toMatchObject({
      status: "UNKNOWN",
      canRetry: false,
    });
    expect(JSON.parse(values.get(TRANSLATION_INTENT_STORAGE_KEY)!)).toEqual([
      metadata,
    ]);
  });
  it.each([
    null,
    undefined,
    { ...accepted, version: 2 },
    { ...accepted, intentId: "other" },
    { ...accepted, operation: "home.setContent" },
    { ...accepted, mode: "PUBLISH" },
    { ...accepted, cleared: true },
  ])(
    "rejects malformed or differently bound receipt evidence: %j",
    (result) => {
      expect(() => parseTranslationIntentReceipt(metadata, result)).toThrow();
      const { client } = fixture();
      client.admit(metadata);
      expect(() => client.resolve(metadata, result)).toThrow();
      expect(client.getSnapshot().entries[0]?.status).toBe("PENDING");
    },
  );
  it.each([
    "home.setNewsTranslation",
    "home.setSectionTranslation",
    "home.setPageTitle",
  ] as const)("accepts only null clear metadata for %s", (operation) => {
    const binding = { ...metadata, operation };
    const result = { ...accepted, operation, cleared: null };
    expect(parseTranslationIntentReceipt(binding, result)).toMatchObject({
      status: "ACCEPTED",
      cleared: null,
    });
    expect(() =>
      parseTranslationIntentReceipt(binding, { ...result, cleared: false }),
    ).toThrow();
  });
  it.each(["localization.setString", "home.setContent"] as const)(
    "preserves explicit publication clear flags for %s",
    (operation) => {
      const binding = { ...metadata, operation, mode: "PUBLISH" as const };
      const result = {
        ...accepted,
        operation,
        mode: "PUBLISH",
        outcome: "PUBLISHED",
        draftId: null,
        cleared: true,
      };
      expect(parseTranslationIntentReceipt(binding, result)).toMatchObject({
        status: "ACCEPTED",
        cleared: true,
      });
      expect(() =>
        parseTranslationIntentReceipt(binding, { ...result, cleared: null }),
      ).toThrow();
    },
  );
});

it("ignores late authority denials and delivery after a historical terminal receipt is dismissed", async () => {
  const { client } = fixture();
  client.admit(metadata);
  const denyAuthority = vi.fn();
  client.register(metadata, {
    canRetry: () => false,
    retry: vi.fn(),
    canRefresh: () => false,
    accept: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    denyAuthority,
  });
  client.resolve(metadata, stopped);
  expect(() => client.denyAuthority(metadata)).not.toThrow();
  client.dismiss(metadata);
  expect(() => client.denyAuthority(metadata)).not.toThrow();
  await expect(client.deliver(metadata)).resolves.toBeUndefined();
  expect(denyAuthority).not.toHaveBeenCalled();
  expect(client.getSnapshot().entries).toHaveLength(0);
});
