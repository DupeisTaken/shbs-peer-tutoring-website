import NextAuth from "next-auth";

import { authConfig } from "~/server/auth/config";

// Edge-safe Auth.js instance (base config only — no Prisma adapter). The `authorized`
// callback in `authConfig` blocks unauthenticated requests; the landing page is public.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Run on everything except Next internals, static assets, and API routes
  // (tRPC and the Auth.js endpoints enforce their own authorization server-side).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
