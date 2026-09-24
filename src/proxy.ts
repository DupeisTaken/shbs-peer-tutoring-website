import NextAuth, { type NextAuthConfig } from "next-auth";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
  type NextMiddleware,
} from "next/server";

import { authConfig } from "~/server/auth/config";
import { db } from "~/server/db";
import { isSessionCurrent } from "~/server/auth/session-version";
import { SESSION_RECOVERY_COOKIE } from "~/lib/session-recovery";
import {
  recoverInvalidSession,
  withoutSessionRefreshCookies,
} from "~/server/auth/session-recovery";

// Next 16 Proxy runs in Node: reject revoked credentials before page rendering and clear
// stale cookies here, where response cookies are writable. The `authorized`
// callback in `authConfig` blocks unauthenticated requests; the landing page is public.
// NextAuth fills its environment defaults on this object. Recovery must verify
// with that exact secret configuration rather than inventing a development key.
const runtimeAuthConfig: NextAuthConfig = { ...authConfig };
const { auth } = NextAuth(runtimeAuthConfig);
// Auth.js supports a direct middleware request at runtime, but its beta types
// omit that call overload. Use the same middleware entry as `export default auth`;
// a callback wrapper would override Auth.js's default unauthenticated redirect.
const authenticatePage = auth as unknown as NextMiddleware;

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const recovery = await recoverInvalidSession(
    request,
    runtimeAuthConfig.secret,
    (token) => isSessionCurrent(db, token),
  );
  if (recovery) return recovery;
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const response = await authenticatePage(request, event);
  if (
    response &&
    request.nextUrl.pathname === "/signin" &&
    request.cookies.has(SESSION_RECOVERY_COOKIE)
  ) {
    // The sign-in render still reads the incoming marker, then the response
    // consumes it so a later voluntary sign-out has no stale recovery notice.
    response.headers.append(
      "set-cookie",
      `${SESSION_RECOVERY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  return response ? withoutSessionRefreshCookies(response, request) : response;
}

export const config = {
  // APIs participate in invalid-cookie cleanup but enforce their own authorization.
  // The file-based tab icon must also load before sign-in. Match its exact path
  // rather than exempting every PNG-looking URL from authentication.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon\\.png$).*)"],
};
