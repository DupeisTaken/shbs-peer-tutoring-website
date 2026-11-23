/**
 * Maps tRPC and transport errors to concise, plain-language localized recovery copy so
 * everyday UI surfaces never expose raw server stack strings or implementation jargon.
 * Feature-specific domain errors (e.g., validation rules or conflict prompts with custom
 * recovery flows) still take precedence when a caller handles them explicitly.
 */
export type ClientErrorLike = {
  message?: string | null;
  data?: { code?: string | null } | null;
} | null | undefined;

const CODE_KEYS = {
  UNAUTHORIZED: "errorRecovery.unauthorized",
  FORBIDDEN: "errorRecovery.forbidden",
  NOT_FOUND: "errorRecovery.notFound",
  CONFLICT: "errorRecovery.conflict",
  TOO_MANY_REQUESTS: "errorRecovery.tooManyRequests",
  TIMEOUT: "errorRecovery.timeout",
  PRECONDITION_FAILED: "errorRecovery.preconditionFailed",
  BAD_REQUEST: "errorRecovery.badRequest",
  INTERNAL_SERVER_ERROR: "errorRecovery.internal",
} as const;

export type KnownErrorCode = keyof typeof CODE_KEYS;

export function errorRecoveryKey(error: ClientErrorLike): string {
  const code = error?.data?.code;
  if (code && code in CODE_KEYS) {
    return CODE_KEYS[code as KnownErrorCode];
  }
  const msg = error?.message ?? "";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "errorRecovery.network";
  }
  return "errorRecovery.generic";
}

export function formatClientError(
  error: ClientErrorLike,
  t: (key: string) => string,
): string {
  return t(errorRecoveryKey(error));
}
