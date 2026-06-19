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
  email: z.string().email(),
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
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Verify email + password against the database. Returns the user on success or
       * `null` on any failure (Auth.js surfaces a generic CredentialsSignin error — we
       * never reveal whether the email or the password was wrong).
       */
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        const user = await db.user.findUnique({
          where: { email },
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
        const email = user.email ?? token.email ?? null;

        // Link to the domain Tutor record by email (admins set Tutor.email).
        let tutorId: string | null = null;
        if (email) {
          const tutor = await db.tutor.findUnique({
            where: { email: email.toLowerCase() },
            select: { id: true },
          });
          tutorId = tutor?.id ?? null;
        }

        const isBootstrapAdmin = email
          ? bootstrapAdminEmails().includes(email.toLowerCase())
          : false;

        // Persist the linkage/role bump so the admin UI can manage them later.
        const dbUser = await db.user.update({
          where: { id: user.id },
          data: {
            ...(tutorId ? { tutorId } : {}),
            ...(isBootstrapAdmin ? { role: "ADMIN" } : {}),
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
