/** Only local page destinations may survive authentication or enter email actions.
 * Auth.js supplies absolute callback URLs, accepted only against the configured origin.
 * Reject ambiguous separators/control characters before URL normalization. */
export function returnDestination(value: unknown, origin?: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    /[\\\s\u0000-\u001f]/.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(value)
  )
    return "/";
  try {
    const base = new URL(origin ?? "https://internal.invalid");
    if (!value.startsWith("/") && !origin) return "/";
    if (value.startsWith("//")) return "/";
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password) return "/";
    // Dot-segment normalization can turn a local path into //host. Returning that
    // string would let the redirect consumer reinterpret it as an external URL.
    if (url.pathname.startsWith("//")) return "/";
    if (/^\/(?:api|signin|signout)(?:\/|$)/.test(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
