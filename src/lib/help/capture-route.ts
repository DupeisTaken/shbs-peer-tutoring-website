import { tuteeViews } from "~/app/student/views";

const accountPages = new Set([
  "/my-account",
  "/settings",
  "/admin/account",
  "/student",
]);
const accountAnchors = new Set([
  "academic-details",
  "account-password",
  "account-twofactor",
  "associated-emails",
  "notification-preferences",
]);
const tutorAnchors = new Set([
  "sessions",
  "tutor-pairings",
  "tutor-preferences",
  "tutor-history",
]);

function unsafe(): never {
  // Do not include the submitted URL: it may contain a private capability.
  throw new Error(
    "Unsafe published capture route; record only its canonical page and approved view/anchor",
  );
}

function decode(value: string) {
  for (let round = 0; round < 5; round++) {
    let next: string;
    try {
      next = decodeURIComponent(value);
    } catch {
      return unsafe();
    }
    if (next === value) return next;
    value = next;
  }
  return unsafe();
}

/** Published routes are provenance labels, not reusable links or arbitrary URL
 * storage. Reject encoded/noncanonical spellings instead of sanitizing a secret
 * into a new string while the original remains in an export or HTML payload. */
export function validatePublishedCaptureRoute(route: string) {
  if (
    typeof route !== "string" ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.length > 2048 ||
    [...route].some(
      (character) =>
        character.codePointAt(0)! <= 0x20 ||
        character === "\\" ||
        character.codePointAt(0) === 0x7f,
    )
  )
    return unsafe();
  let url: URL;
  try {
    url = new URL(route, "https://help.invalid");
  } catch {
    return unsafe();
  }
  if (url.origin !== "https://help.invalid" || url.username || url.password)
    return unsafe();
  const pathname = decode(url.pathname);
  if (pathname === "/api" || pathname.startsWith("/api/")) return unsafe();
  if (pathname.startsWith("/reports/service-hours/")) {
    if (
      !/^\/reports\/service-hours\/\[private-link\](?:\/csv)?$/.test(pathname)
    )
      return unsafe();
  } else if (
    pathname !== "/" &&
    !/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(pathname)
  )
    return unsafe();
  for (const page of [
    "/request-appeal",
    "/reset-password",
    "/register",
    "/register-account",
    "/history/claim",
    "/unsubscribe",
    "/onboarding/email",
  ])
    if (pathname.startsWith(`${page}/`)) return unsafe();

  const query = [...url.searchParams].map(
    ([key, value]) => [decode(key), decode(value)] as const,
  );
  if (query.length > 1) return unsafe();
  let search = "";
  if (query.length) {
    const [key, value] = query[0]!;
    if (key !== "view") return unsafe();
    const permitted =
      pathname === "/student"
        ? (tuteeViews as readonly string[]).includes(value)
        : pathname === "/localization"
          ? ["strings", "review"].includes(value)
          : /^\/help\/[a-z0-9-]+\/screenshots\/[1-9]\d*$/.test(pathname) &&
            /^[1-9]\d{0,2}$/.test(value);
    if (!permitted) return unsafe();
    search = `?view=${value}`;
  }

  const fragment = decode(url.hash.slice(1));
  if (fragment) {
    const permitted =
      (accountPages.has(pathname) && accountAnchors.has(fragment)) ||
      (["/dashboard", "/schedule"].includes(pathname) &&
        tutorAnchors.has(fragment)) ||
      (pathname === "/admin/applications" &&
        fragment === "interview-records") ||
      (/^\/help\/[a-z0-9-]+$/.test(pathname) &&
        (fragment === "walkthrough" || /^step-[1-9]\d{0,2}$/.test(fragment)));
    if (!permitted) return unsafe();
  }
  const canonical = pathname + search + (fragment ? `#${fragment}` : "");
  if (route !== canonical) return unsafe();
  return canonical;
}
