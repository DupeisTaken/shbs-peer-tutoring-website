/** Session-only presentation choices. Never pass forms, records, evidence or tokens. */
export type ViewValue =
  string | number | boolean | null | readonly (string | number)[];
export type ViewState = ViewValue | Readonly<Record<string, ViewValue>>;
export const VIEW_STATE_PREFIX = "shbs:view:v1:";
const MAX_ENTRIES = 100;
const MAX_BYTES = 4096;

/** Bound the full entry, including route criteria embedded in its encoded key.
 * Reject huge live text cheaply before allocating a UTF-8 encoding buffer. */
function withinStorageBudget(key: string, raw = "") {
  if (key.length + raw.length > MAX_BYTES) return false;
  const encoder = new TextEncoder();
  return (
    encoder.encode(key).byteLength + encoder.encode(raw).byteLength <= MAX_BYTES
  );
}

export function viewStateKey(
  identity: string,
  path: string,
  id: string,
  scope: string,
) {
  return VIEW_STATE_PREFIX + JSON.stringify([identity, path, id, scope]);
}

function scalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.length <= 160) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
export function isViewState(value: unknown): value is ViewState {
  if (scalar(value)) return true;
  if (Array.isArray(value)) return value.length <= 40 && value.every(scalar);
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 20 &&
    entries.every(
      ([key, item]) =>
        key.length <= 80 &&
        (scalar(item) ||
          (Array.isArray(item) && item.length <= 40 && item.every(scalar))),
    )
  );
}

/** Storage is optional: restrictive browsers and a full quota must not break navigation. */
export function readViewState(storage: Storage, key: string): unknown {
  try {
    if (!withinStorageBudget(key)) {
      removeViewState(storage, key);
      return undefined;
    }
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    if (!withinStorageBudget(key, raw)) {
      removeViewState(storage, key);
      return undefined;
    }
    const value: unknown = JSON.parse(raw);
    return isViewState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
export function writeViewState(
  storage: Storage,
  key: string,
  value: ViewState,
) {
  try {
    if (!withinStorageBudget(key) || !isViewState(value)) {
      removeViewState(storage, key);
      return;
    }
    const raw = JSON.stringify(value);
    if (!withinStorageBudget(key, raw)) {
      removeViewState(storage, key);
      return;
    }
    const keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    ).filter((item): item is string => !!item?.startsWith(VIEW_STATE_PREFIX));
    storage.setItem(key, raw);
    // Capacity pruning follows a successful write. A quota failure may remove
    // this entry's stale value, but must not evict an unrelated remembered view.
    if (!keys.includes(key) && keys.length >= MAX_ENTRIES)
      for (const old of keys.slice(0, keys.length - MAX_ENTRIES + 1))
        removeViewState(storage, old);
  } catch {
    // A newer live choice must never fall back to the older saved criteria.
    // This is best-effort too: fully blocked storage still leaves live state usable.
    removeViewState(storage, key);
  }
}
export function removeViewState(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}

export function clearOtherViewIdentities(storage: Storage, identity: string) {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    );
    for (const key of keys) {
      if (!key?.startsWith(VIEW_STATE_PREFIX)) continue;
      try {
        const scope: unknown = JSON.parse(key.slice(VIEW_STATE_PREFIX.length));
        if (!Array.isArray(scope) || scope[0] !== identity)
          storage.removeItem(key);
      } catch {
        storage.removeItem(key);
      }
    }
  } catch {
    /* Identity boundaries still isolate in-memory state. */
  }
}

/** A feature allowlist should still validate restored values against its current choices. */
export function viewEnum<const T extends string>(choices: readonly T[]) {
  return (value: unknown): T | undefined =>
    typeof value === "string" && choices.includes(value as T)
      ? (value as T)
      : undefined;
}

export const viewPage = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 100_000
    ? value
    : undefined;
export const viewSearch = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** IDs and URL choices remain bounded independently of unrestricted live searches. */
export const viewIdentifier = (value: unknown): string | undefined =>
  typeof value === "string" && value.length <= 160 ? value : undefined;

/** Compose a feature's explicit field allowlist; never copy unknown stored fields. */
export function viewFields<T extends Record<string, ViewValue>>(fields: {
  [K in keyof T]: (value: unknown) => T[K] | undefined;
}) {
  return (value: unknown): T | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const source = value as Record<string, unknown>;
    const result: Record<string, ViewValue> = {};
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      const parsed = fields[key](source[key]);
      if (parsed === undefined) return;
      result[key] = parsed;
    }
    return result as T;
  };
}

/** Transport failures retain a view; only an authoritative access failure clears it. */
export const viewAccessDenied = (
  error: { data?: { code?: string } | null } | null | undefined,
) => error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";
