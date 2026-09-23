import { getToken, type JWT } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import type { NextAuthConfig } from "next-auth";
import { SESSION_RECOVERY_COOKIE } from "~/lib/session-recovery";

const sessionCookie = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

/** Background page/prefetch requests can finish after sign-out. Only full-document
 * GET navigation may renew a cookie; always preserve explicit Auth.js deletions.
 * Sign-in/session/logout API actions do not pass through this page-only filter. */
export function withoutSessionRefreshCookies(
  response: Response,
  request?: NextRequest,
): Response {
  if (
    request?.method === "GET" &&
    request.headers.get("sec-fetch-dest") === "document" &&
    !request.headers.has("next-router-prefetch")
  )
    return response;
  const cookies = response.headers.getSetCookie();
  response.headers.delete("set-cookie");
  for (const cookie of cookies) {
    const name = cookie.slice(0, cookie.indexOf("="));
    const expires = /(?:^|;)\s*expires=([^;]+)/i.exec(cookie)?.[1];
    const clears =
      /(?:^|;)\s*max-age=0(?:;|$)/i.test(cookie) ||
      (expires !== undefined && Date.parse(expires) <= Date.now());
    if (!sessionCookie.test(name) || clears)
      response.headers.append("set-cookie", cookie);
  }
  return response;
}

/** Auth.js can expire a rejected JWT in an HTTP response, but auth() in a Server
 * Component cannot write those cookies. Recover at the HTTP boundary, before the
 * same rejected cookie reaches every layout, page and API context. Verification
 * uses Auth.js itself, including its chunk handling, salt and expiry checks. */
export async function recoverInvalidSession(
  request: NextRequest,
  secret: NextAuthConfig["secret"],
  isCurrent?: (token: JWT) => Promise<boolean>,
): Promise<NextResponse | null> {
  const cookies = request.cookies
    .getAll()
    .filter(({ name }) => sessionCookie.test(name));
  if (!cookies.length) return null;
  // A missing deployment secret is a configuration failure, never an expired login.
  if (!secret?.length)
    throw new Error(
      "Configure a stable AUTH_SECRET before accepting sessions.",
    );

  const invalidNames: string[] = [];
  for (const cookieName of new Set(
    cookies.map(({ name }) => name.replace(/\.\d+$/, "")),
  )) {
    const token = await getToken({
      req: {
        headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }),
      },
      cookieName,
      secret,
    });
    if (!token || (isCurrent && !(await isCurrent(token))))
      invalidNames.push(
        ...cookies
          .filter(
            ({ name }) =>
              name === cookieName || name.startsWith(`${cookieName}.`),
          )
          .map(({ name }) => name),
      );
  }
  if (!invalidNames.length) return null;

  // Preserve unrelated preferences/CSRF cookies and valid sessions of the other
  // cookie namespace. API handlers still perform their normal authentication.
  const headers = new Headers(request.headers);
  const kept = request.cookies
    .getAll()
    .filter(({ name }) => !invalidNames.includes(name));
  headers.set(
    "cookie",
    kept.map(({ name, value }) => `${name}=${value}`).join("; "),
  );
  const reason = request.nextUrl.pathname === "/signin" && request.nextUrl.searchParams.get("reason") === "password-changed"
    ? "password-changed" : "session-expired";
  const response = request.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.next({ request: { headers } })
    : NextResponse.redirect(
        new URL(`/signin?reason=${reason}`, request.url),
      );
  for (const name of invalidNames)
    response.cookies.set(name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
      maxAge: 0,
    });
  response.headers.set("Cache-Control", "private, no-store");
  // An API/prefetch can discover expiry before the next page navigation. Carry
  // the explanation to sign-in even when that page no longer receives the JWT.
  response.cookies.set(SESSION_RECOVERY_COOKIE, "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60,
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
