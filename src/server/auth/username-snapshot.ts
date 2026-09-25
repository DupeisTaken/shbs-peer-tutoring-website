/** Only a failed namespace fence is safe to retry before dispatching an approval callback. */
export class UsernameSnapshotConflict extends Error {
  constructor(cause: unknown) {
    super("Username namespace changed after this transaction's snapshot.", {
      cause,
    });
    this.name = "UsernameSnapshotConflict";
  }
}

/** Prisma adapters expose PostgreSQL serialization errors at different levels. */
export function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    originalCode?: unknown;
    cause?: unknown;
    meta?: unknown;
  };
  return (
    value.code === "P2034" ||
    value.code === "40001" ||
    value.originalCode === "40001" ||
    isSerializationFailure(value.cause) ||
    isSerializationFailure(value.meta) ||
    ("driverAdapterError" in error &&
      isSerializationFailure(error.driverAdapterError))
  );
}

function namespaceConflict(error: unknown): boolean {
  return (
    error instanceof UsernameSnapshotConflict ||
    (!!error &&
      typeof error === "object" &&
      "cause" in error &&
      namespaceConflict(error.cause))
  );
}

/** Call only at an OUTER transaction boundary whose namespace fence precedes side effects.
 * A new transaction gets a fresh snapshot. Other errors (including commit-time serialization)
 * are deliberately not retried: their callbacks may already have performed external work. */
export async function retryUsernameSnapshot<T>(
  transaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction();
    } catch (error) {
      if (attempt >= 2 || !namespaceConflict(error)) throw error;
    }
  }
}
