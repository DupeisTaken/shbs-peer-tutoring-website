import { returnDestination } from "~/lib/return-destination";

/** Mail must never depend on a request Host header or silently point production at localhost. */
export function emailOrigin(): string {
  const configured = process.env.AUTH_URL?.trim();
  const production = process.env.NODE_ENV === "production";
  if (!configured && production)
    throw new Error("Configure a public HTTPS AUTH_URL for email links.");
  const url = new URL(
    configured?.length ? configured : "http://localhost:3000",
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/+$/, "") ||
    url.search ||
    url.hash ||
    (production &&
      (url.protocol !== "https:" ||
        /^(localhost|127\.|\[?::1\]?|0\.0\.0\.0$)/i.test(url.hostname)))
  ) {
    throw new Error(
      "Configure a public HTTPS AUTH_URL origin for email links.",
    );
  }
  return url.origin;
}

export function emailUrl(path: string): string {
  // Encoding the full destination inside the sign-in URL preserves fragments too:
  // URL fragments never reach Proxy on an ordinary direct page navigation.
  return `${emailOrigin()}/signin?callbackUrl=${encodeURIComponent(returnDestination(path))}`;
}

/** Older outbox rows lack a destination. Current route guards remain authoritative
 * for content access; role changes use a neutral home fallback for staff-only links. */
export function notificationDestination(
  category: string,
  event: string,
  destination: string | null,
  role: string,
): string {
  if (category === "messages") return "/messages";
  if (event !== "program_update") return "/my-account";
  const path = returnDestination(destination);
  if (
    path.startsWith("/admin") &&
    !["HEAD", "ADMIN", "COORDINATOR"].includes(role)
  )
    return "/";
  return path;
}
