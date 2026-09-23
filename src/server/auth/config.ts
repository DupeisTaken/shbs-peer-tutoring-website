import { type DefaultSession, type NextAuthConfig } from "next-auth";
import { type DefaultJWT } from "next-auth/jwt";

/**
 * App roles. Keep the shared configuration independent of the Prisma client.
 * The Next 16 Node proxy checks credential generations before using these callbacks.
 * Must match the `Role` enum in schema.prisma.
 */
export type Role =
  "STUDENT" | "VIEWER" | "CREW" | "TUTOR" | "COORDINATOR" | "ADMIN" | "HEAD";

/**
 * Module augmentation: attach resolved `role` + `tutorId` (and user id) to the session so the
 * server can authorize without extra lookups.
 */
declare module "next-auth" {
  interface User {
    /** Version read with the password/OTP evidence, never copied from a client request. */
    sessionVersion?: number;
  }
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
    role: Role;
    tutorId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    /** Missing on pre-migration sessions, which must sign in again. */
    sessionVersion?: number;
    role: Role;
    tutorId: string | null;
  }
}

/**
 * Provider-independent base Auth.js config.
 *
 * Contains the proxy session configuration: the JWT session strategy, custom sign-in page,
 * and pure callbacks (`authorized`, `session`). The Credentials provider (whose `authorize`
 * touches the database to verify passwords) and the DB-backed `jwt` callback are added in
 * `index.ts`, which runs on the Node runtime only.
 *
 * The proxy does not need the Credentials provider to decode cookies, so it stays empty here.
 * Both the Node proxy and the full auth callbacks separately verify live session generations.
 *
 * @see https://authjs.dev/getting-started/providers/credentials
 */
export const authConfig = {
  providers: [],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    /** Used by the middleware: the landing, sign-in, and public tutee signup pages are
     *  public; everything else requires sign-in. */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const PUBLIC = [
        "/",
        "/signin",
        "/signup",
        "/signup/account",
        "/tutor-signup",
        "/crew-signup",
        "/viewer-signup",
        "/forgot-password",
        "/reset-password",
        "/register",
      ];
      // Public landing-section detail pages (/p/<slug>) — the page itself gates unpublished ones.
      if (PUBLIC.includes(pathname) || pathname.startsWith("/p/")) return true;
      return !!auth?.user;
    },
    /** Expose role + tutorId (decoded from the JWT) on the session. Pure — no DB access. */
    session({ session, token }) {
      session.user.id = token.sub ?? session.user.id;
      session.role = token.role;
      session.tutorId = token.tutorId;
      return session;
    },
  },
} satisfies NextAuthConfig;
