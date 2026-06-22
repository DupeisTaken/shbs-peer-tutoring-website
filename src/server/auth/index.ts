import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cache } from "react";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { authConfig } from "./config";
import { verifyPassword } from "./password";

function bootstrapAdminEmails(): string[] {
  return (env.AUTH_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const credentialsSchema = z.object({
  // Username or email — resolved against User.email or the linked Tutor.username.
  identifier: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Full (Node-runtime) Auth.js instance: the edge-safe base plus the Credentials provider
 * (email + password) and the DB-backed `jwt` callback that resolves the user's role +
 * tutorId on sign-in.
 */
const {
  auth: uncachedAuth,
  handlers,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "Username or email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Verify identifier (username OR email) + password against the database. Returns the
       * user on success or `null` on any failure (Auth.js surfaces a generic CredentialsSignin
       * error — we never reveal whether the identifier or the password was wrong).
       */
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const identifier = parsed.data.identifier.trim().toLowerCase();
        // Match either the login email or the linked Tutor's username.
        const user = await db.user.findFirst({
          where: {
            OR: [{ email: identifier }, { tutor: { username: identifier } }],
          },
          select: { id: true, name: true, email: true, passwordHash: true },
        });
        if (!user?.passwordHash) return null;
        if (!verifyPassword(parsed.data.password, user.passwordHash)) return null;

        // FUTURE (email-based 2FA): if the user has `twoFactorEnabled`, this is where the
        // flow would branch — issue an emailed code (see src/server/auth/two-factor.ts) and
        // require a second step before completing sign-in. Not implemented yet.

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /**
     * On sign-in (`user` present) we resolve role + tutorId from the database, link the
     * domain Tutor record by matching email, apply the bootstrap-admin grant, and cache the
     * values on the token. Subsequent requests read them straight from the decoded JWT.
     */
    async jwt({ token, user }) {
      if (user?.id) {
        const email = (user.email ?? token.email ?? null)?.toLowerCase() ?? null;

        // Link to the domain Tutor record by email (admins set Tutor.email).
        let tutorId: string | null = null;
        if (email) {
          const tutor = await db.tutor.findUnique({
            where: { email },
            select: { id: true },
          });
          tutorId = tutor?.id ?? null;
        }

        // Bootstrap roles. The FIRST email in AUTH_BOOTSTRAP_ADMIN_EMAILS is the designated HEAD
        // (singleton leader); the rest are ADMIN. Grants only ever ELEVATE — never demote — so a
        // head whose leadership was transferred away (and is now ADMIN) isn't knocked back up, and
        // a transferred head isn't reset to ADMIN. The designated head reclaims HEAD only when no
        // HEAD exists at all (initial setup, or recovery if the head account was deleted).
        const emails = bootstrapAdminEmails();
        const isBootstrapAdmin = email ? emails.includes(email) : false;
        const isDesignatedHead = email ? emails[0] === email : false;

        let roleBump: "HEAD" | "ADMIN" | undefined;
        if (isBootstrapAdmin) {
          const [current, headCount] = await Promise.all([
            db.user.findUnique({ where: { id: user.id }, select: { role: true } }),
            db.user.count({ where: { role: "HEAD" } }),
          ]);
          if (isDesignatedHead && headCount === 0) {
            roleBump = "HEAD";
          } else if (current && current.role !== "HEAD" && current.role !== "ADMIN") {
            roleBump = "ADMIN";
          }
        }

        // Persist the linkage/role bump so the admin UI can manage them later.
        const dbUser = await db.user.update({
          where: { id: user.id },
          data: {
            ...(tutorId ? { tutorId } : {}),
            ...(roleBump ? { role: roleBump } : {}),
          },
          select: { id: true, role: true, tutorId: true },
        });

        token.sub = dbUser.id;
        token.role = dbUser.role;
        token.tutorId = dbUser.tutorId;
      }
      return token;
    },
  },
});

const auth = cache(uncachedAuth);

export { auth, handlers, signIn, signOut };
