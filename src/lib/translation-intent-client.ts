import { z } from "zod";
import {
  TRANSLATION_OPERATIONS,
  translationIntentEnvelope,
  type AcceptedTranslationReceipt,
  type TranslationIntentMode,
  type TranslationOperation,
  type TranslationReceiptResult,
} from "./translation-intent";

export const TRANSLATION_INTENT_STORAGE_KEY = "translation-intents:v1";
const metadataSchema = z
  .object({
    id: translationIntentEnvelope.shape.id,
    actorId: z.string().min(1),
    operation: z.enum(TRANSLATION_OPERATIONS),
    mode: z.enum(["DRAFT", "PUBLISH"]),
  })
  .strict();
export type TranslationIntentMetadata = z.output<typeof metadataSchema>;
export type TranslationIntentPhase =
  "PENDING" | "UNKNOWN" | "ACCEPTED" | "STOPPED";
export type TranslationIntentClientError =
  "storage" | "submit" | "read" | "refresh" | "authority";
const authorityProof = z
  .object({
    actorId: z.string().min(1).nullable(),
    mode: z.enum(["DRAFT", "PUBLISH"]),
    canSubmit: z.boolean(),
  })
  .strict();
export type TranslationAuthorityProof = z.output<typeof authorityProof>;
export const parseTranslationAuthorityProof = (value: unknown) =>
  authorityProof.parse(value);
export function isTranslationAuthorityError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data: unknown = error.data;
  return (
    !!data &&
    typeof data === "object" &&
    "code" in data &&
    (data.code === "FORBIDDEN" || data.code === "UNAUTHORIZED")
  );
}
export type TranslationIntentEntry = {
  metadata: TranslationIntentMetadata;
  status: TranslationIntentPhase;
  absent: boolean;
  error: TranslationIntentClientError | null;
  receipt?: Exclude<TranslationReceiptResult, { status: "NOT_RECORDED" }>;
  canRetry: boolean;
  canRefresh: boolean;
  needsAuthority: boolean;
  canRecheck: boolean;
};
export type TranslationIntentSnapshot = {
  ready: boolean;
  storageError: boolean;
  entries: readonly TranslationIntentEntry[];
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export type TranslationIntentOwner = {
  canRetry: () => boolean;
  retry: () => Promise<unknown>;
  canRefresh: () => boolean;
  accept: (receipt: AcceptedTranslationReceipt) => Promise<unknown>;
  stop: (
    receipt: Extract<TranslationReceiptResult, { status: "STOPPED" }>,
  ) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  needsAuthority?: () => boolean;
  canRecheck?: () => boolean;
  recheck?: () => Promise<unknown>;
  denyAuthority?: () => void;
};
const reference = (metadata: TranslationIntentMetadata) =>
  `${metadata.actorId}\0${metadata.id}`;
export const isTranslationIntentUnresolved = (entry: TranslationIntentEntry) =>
  entry.status === "PENDING" || entry.status === "UNKNOWN";

/** Validate metadata responses before treating anything as historical evidence.
 * Missing/null/denied responses are never equivalent to NOT_RECORDED. */
export function parseTranslationIntentReceipt(
  metadata: TranslationIntentMetadata,
  value: unknown,
): TranslationReceiptResult {
  const base = z.object({
    version: z.literal(1),
    intentId: z.literal(metadata.id),
  });
  const result = z
    .discriminatedUnion("status", [
      base.extend({ status: z.literal("NOT_RECORDED") }),
      base.extend({ status: z.literal("STOPPED"), stoppedAt: z.date() }),
      base.extend({
        status: z.literal("ACCEPTED"),
        operation: z.literal(metadata.operation),
        mode: z.literal(metadata.mode),
        outcome: z.literal(
          metadata.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
        ),
        acceptedAt: z.date(),
        draftId: z.string().min(1).nullable(),
        cleared: z.boolean().nullable(),
        replayed: z.boolean(),
      }),
    ])
    .parse(value);
  if (
    result.status === "ACCEPTED" &&
    (metadata.mode === "DRAFT") !== (result.draftId !== null)
  )
    throw new Error("Invalid translation receipt result.");
  if (result.status === "ACCEPTED") {
    const clearable =
      metadata.operation === "localization.setString" ||
      metadata.operation === "home.setContent";
    if (
      clearable
        ? result.cleared === null ||
          (metadata.mode === "DRAFT" && result.cleared)
        : result.cleared !== null
    )
      throw new Error("Invalid translation receipt clear result.");
  }
  return result;
}

/** Metadata only. Exact text/sender callbacks live in the mounted hook, never
 * in this persisted registry. Terminal states absorb stale in-flight reads. */
export function createTranslationIntentClient(storage: () => Storage) {
  const entries = new Map<string, TranslationIntentEntry>();
  const terminals = new Map<
    string,
    Exclude<TranslationReceiptResult, { status: "NOT_RECORDED" }>
  >();
  const owners = new Map<string, TranslationIntentOwner>();
  const listeners = new Set<() => void>();
  let snapshot: TranslationIntentSnapshot = {
    ready: false,
    storageError: false,
    entries: [],
  };
  const publish = (
    change: Partial<
      Pick<TranslationIntentSnapshot, "ready" | "storageError">
    > = {},
  ) => {
    snapshot = {
      ...snapshot,
      ...change,
      entries: [...entries].map(([key, entry]) =>
        Object.freeze({
          ...entry,
          canRetry:
            entry.status === "UNKNOWN" &&
            (owners.get(key)?.canRetry() ?? false),
          canRefresh:
            entry.status === "ACCEPTED" &&
            (owners.get(key)?.canRefresh() ?? false),
          needsAuthority: owners.get(key)?.needsAuthority?.() ?? false,
          canRecheck: owners.get(key)?.canRecheck?.() ?? false,
        }),
      ),
    };
    for (const listener of listeners) listener();
  };
  const persist = (records: readonly TranslationIntentMetadata[]) => {
    // Construct every object explicitly: no body/hash/version/receipt can leak
    // through a spread, even if a caller supplied extra runtime properties.
    const raw = JSON.stringify(
      records.map(({ id, actorId, operation, mode }) => ({
        id,
        actorId,
        operation,
        mode,
      })),
    );
    const target = storage();
    target.setItem(TRANSLATION_INTENT_STORAGE_KEY, raw);
    if (target.getItem(TRANSLATION_INTENT_STORAGE_KEY) !== raw)
      throw new Error("Translation recovery metadata was not persisted.");
  };
  const hydrate = () => {
    if (snapshot.ready && !snapshot.storageError) return;
    try {
      const raw = storage().getItem(TRANSLATION_INTENT_STORAGE_KEY);
      const records = z
        .array(metadataSchema)
        .parse(raw === null ? [] : JSON.parse(raw));
      const identities = new Set<string>();
      for (const record of records) {
        const metadata = Object.freeze(record);
        const key = reference(metadata);
        if (identities.has(key))
          throw new Error("Duplicate recovery identity.");
        identities.add(key);
        const existing = entries.get(key);
        if (
          existing &&
          JSON.stringify(existing.metadata) !== JSON.stringify(metadata)
        )
          throw new Error("Recovery identity changed.");
        if (!existing)
          entries.set(key, {
            metadata,
            status: "UNKNOWN",
            absent: false,
            error: null,
            canRetry: false,
            canRefresh: false,
            needsAuthority: false,
            canRecheck: false,
          });
      }
      // A storage retry cannot erase an unresolved in-memory fence.
      persist([...entries.values()].map((entry) => entry.metadata));
      publish({ ready: true, storageError: false });
    } catch {
      publish({ storageError: true });
    }
  };
  const entryFor = (metadata: TranslationIntentMetadata) => {
    const entry = entries.get(reference(metadata));
    if (!entry)
      throw new Error("Translation recovery metadata is unavailable.");
    return entry;
  };
  const client = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    hydrate,
    touch: () => publish(),
    terminal: (metadata: TranslationIntentMetadata) =>
      terminals.get(reference(metadata)),
    admit(value: TranslationIntentMetadata) {
      hydrate();
      if (!snapshot.ready || snapshot.storageError)
        throw new Error("Translation recovery storage is unavailable.");
      const metadata = Object.freeze(metadataSchema.parse(value));
      if (
        [...entries.values()].some(
          (entry) =>
            entry.metadata.actorId === metadata.actorId &&
            isTranslationIntentUnresolved(entry),
        )
      )
        throw new Error("Resolve the previous translation request first.");
      if (
        entries.has(reference(metadata)) ||
        terminals.has(reference(metadata))
      )
        throw new Error("Translation request identity already exists.");
      try {
        persist(
          [...entries.values()].map((entry) => entry.metadata).concat(metadata),
        );
      } catch (error) {
        publish({ storageError: true });
        throw error;
      }
      entries.set(reference(metadata), {
        metadata,
        status: "PENDING",
        absent: false,
        error: null,
        canRetry: false,
        canRefresh: false,
        needsAuthority: false,
        canRecheck: false,
      });
      publish();
      return metadata;
    },
    register(
      metadata: TranslationIntentMetadata,
      owner: TranslationIntentOwner,
    ) {
      const key = reference(metadata);
      owners.set(key, owner);
      publish();
      return () => {
        if (owners.get(key) !== owner) return;
        owners.delete(key);
        const entry = entries.get(key);
        if (entry?.status === "PENDING")
          entries.set(key, { ...entry, status: "UNKNOWN" });
        publish();
      };
    },
    unknown(
      metadata: TranslationIntentMetadata,
      error: TranslationIntentClientError = "submit",
    ) {
      if (
        !entries.has(reference(metadata)) &&
        terminals.has(reference(metadata))
      )
        return;
      const entry = entryFor(metadata);
      if (isTranslationIntentUnresolved(entry))
        entries.set(reference(metadata), {
          ...entry,
          status: "UNKNOWN",
          error,
        });
      publish();
    },
    error(
      metadata: TranslationIntentMetadata,
      error: TranslationIntentClientError | null,
    ) {
      if (
        !entries.has(reference(metadata)) &&
        terminals.has(reference(metadata))
      )
        return;
      const entry = entryFor(metadata);
      entries.set(reference(metadata), { ...entry, error });
      publish();
    },
    resolve(metadata: TranslationIntentMetadata, value: unknown) {
      const result = parseTranslationIntentReceipt(metadata, value);
      const historical = terminals.get(reference(metadata));
      if (historical) return historical;
      const entry = entryFor(metadata);
      if (!isTranslationIntentUnresolved(entry)) return entry.receipt!;
      if (result.status === "NOT_RECORDED") {
        entries.set(reference(metadata), {
          ...entry,
          status: "UNKNOWN",
          absent: true,
          error: null,
        });
      } else {
        terminals.set(reference(metadata), result);
        entries.set(reference(metadata), {
          ...entry,
          status: result.status,
          receipt: result,
          absent: false,
          error: null,
        });
      }
      publish();
      return result;
    },
    async deliver(metadata: TranslationIntentMetadata) {
      if (
        !entries.has(reference(metadata)) &&
        terminals.has(reference(metadata))
      )
        return;
      const entry = entryFor(metadata);
      const owner = owners.get(reference(metadata));
      // Always settle the owner's pure local receipt first. Its callback owns
      // the separate live authority/lifetime gate before any protected reads.
      if (entry.receipt?.status === "ACCEPTED" && owner)
        await owner.accept(entry.receipt);
      if (entry.receipt?.status === "STOPPED" && owner)
        await owner.stop(entry.receipt);
    },
    async retry(metadata: TranslationIntentMetadata) {
      const entry = entryFor(metadata);
      const owner = owners.get(reference(metadata));
      if (entry.status === "UNKNOWN" && owner?.canRetry()) await owner.retry();
    },
    async refresh(metadata: TranslationIntentMetadata) {
      const entry = entryFor(metadata);
      const owner = owners.get(reference(metadata));
      if (entry.status === "ACCEPTED" && owner?.canRefresh())
        await owner.refresh();
    },
    denyAuthority(metadata: TranslationIntentMetadata) {
      if (terminals.has(reference(metadata))) return;
      if (isTranslationIntentUnresolved(entryFor(metadata)))
        owners.get(reference(metadata))?.denyAuthority?.();
    },
    async recheck(metadata: TranslationIntentMetadata) {
      const owner = owners.get(reference(metadata));
      if (owner?.canRecheck?.()) await owner.recheck?.();
    },
    dismiss(metadata: TranslationIntentMetadata) {
      const entry = entryFor(metadata);
      if (isTranslationIntentUnresolved(entry))
        throw new Error("Stop or resolve this request before dismissing it.");
      try {
        persist(
          [...entries.values()]
            .filter((item) => item !== entry)
            .map((item) => item.metadata),
        );
      } catch (error) {
        publish({ storageError: true });
        throw error;
      }
      entries.delete(reference(metadata));
      owners.delete(reference(metadata));
      publish();
    },
  };
  return client;
}

export const translationIntentClient = createTranslationIntentClient(
  () => window.sessionStorage,
);
export type TranslationIntentClient = ReturnType<
  typeof createTranslationIntentClient
>;
export type { TranslationIntentMode, TranslationOperation };
