import { type DefaultSession, type NextAuthConfig } from "next-auth";
import { type DefaultJWT } from "next-auth/jwt";

/**
 * App roles. Kept as a local union (rather than importing from the Prisma client) so this
 * module stays edge-safe — it is imported by `middleware.ts`, which runs on the Edge runtime
 * where the Prisma client cannot be bundled. Must match the `Role` enum in schema.prisma.
 */
export type Role = "VIEWER" | "CREW" | "TUTOR" | "COORDINATOR" | "ADMIN" | "HEAD";

/**
 * Module augmentation: attach resolved `role` + `tutorId` (and user id) to the session so the
 * server can authorize without extra lookups.
 */
declare module "next-auth" {
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
    role: Role;
    tutorId: string | null;
  }
}

/**
 * Edge-safe base Auth.js config.
 *
 * Contains only what the Edge middleware needs: the JWT session strategy, custom sign-in page,
 * and pure callbacks (`authorized`, `session`). The Credentials provider (whose `authorize`
 * touches the database to verify passwords) and the DB-backed `jwt` callback are added in
 * `index.ts`, which runs on the Node runtime only.
 *
 * The middleware doesn't need the providers array to validate the session cookie, so it's
 * left empty here to keep Prisma and Node-only crypto out of the Edge bundle.
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
        "/tutor-signup",
        "/crew-signup",
        "/viewer-signup",
        "/forgot-password",
        "/reset-password",
        "/register",
      ];
      if (PUBLIC.includes(pathname)) return true;
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
