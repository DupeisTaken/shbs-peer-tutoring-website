/** Match only this known refusal without importing server code or snapshot schemas. */
export const PUBLISHED_SESSION_DECLINE_MESSAGE =
  "Cannot decline a signup with published dated-session records. Review its participation controls instead.";

/** Both display owners share the exact match; undefined preserves their own fallbacks. */
export function localizedLegacySignupDeclineError(
  message: string | undefined,
  translate: (key: "publishedSessionRecords") => string,
): string | undefined {
  return message === PUBLISHED_SESSION_DECLINE_MESSAGE
    ? translate("publishedSessionRecords")
    : undefined;
}
