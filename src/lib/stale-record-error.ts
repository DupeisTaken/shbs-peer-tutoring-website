/** Shared wire text; keep this display adapter independent of server-only code. */
export const STALE_RECORD_MESSAGE =
  "This changed since you loaded it — refresh and try again.";

/** Translate only this complete instruction during render. It is shared across
 * operations, so guidance stays generic and unmatched messages retain their fallback. */
export function localizedStaleRecordError(
  message: string | undefined,
  translate: (key: "staleRecord") => string,
): string | undefined {
  return message === STALE_RECORD_MESSAGE
    ? translate("staleRecord")
    : undefined;
}
