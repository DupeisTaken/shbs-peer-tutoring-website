import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cache } from "react";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { authConfig } from "./config";
import { clientIpFromRequest, verifySigninPassword } from "./credentials";
import { verifyLoginCode } from "./two-factor";
import { ensureUserUsername } from "./username";

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

const loginCodeSchema = z.object({
  intent: z.literal("login_2fa"),
  userId: z.string().min(1),
  code: z.string().min(1),
});

/**
 * Thrown by `authorize` when credential attempts exceed the rate limit. The `code` is surfaced
 * to the sign-in server action (src/app/signin/actions.ts) so it can show a distinct
 * "too many attempts" message instead of the generic invalid-credentials one.
 */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/** Direct password-only attempts against a 2FA account must not create a session. */
class TwoFactorRequiredSignin extends CredentialsSignin {
  code = "two_factor_required";
}

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
        intent: { label: "Intent", type: "text" },
        userId: { label: "User ID", type: "text" },
        code: { label: "Verification code", type: "text" },
      },
      /**
       * Verify identifier (username OR email) + password against the database. Returns the
       * user on success or `null` on any failure (Auth.js surfaces a generic CredentialsSignin
       * error — we never reveal whether the identifier or the password was wrong).
       */
      async authorize(raw, request) {
        const loginCode = loginCodeSchema.safeParse(raw);
        if (loginCode.success) {
          const user = await db.user.findUnique({
            where: { id: loginCode.data.userId },
            select: { id: true, name: true, email: true, twoFactorEnabled: true },
          });
          if (!user?.twoFactorEnabled) return null;
          const features = await getFeatures(db);
          if (!features.EMAIL_2FA) return null;
          const ok = await verifyLoginCode(user.id, loginCode.data.code);
          return ok ? { id: user.id, name: user.name, email: user.email } : null;
        }

        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const verified = await verifySigninPassword(
          parsed.data.identifier,
          parsed.data.password,
          clientIpFromRequest(request),
        );
        // Verifies the password and applies brute-force guards before any session can be issued.
        if (!verified.ok) {
          if (verified.reason === "rate_limited") throw new RateLimitedSignin();
          return null;
        }
        // A password-only credentials POST cannot bypass a user's enabled second factor.
        const features = await getFeatures(db);
        if (features.EMAIL_2FA && verified.user.twoFactorEnabled) {
          throw new TwoFactorRequiredSignin();
        }

        return { id: verified.user.id, name: verified.user.name, email: verified.user.email };
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

        // Uphold the "every account has a username" invariant — assign one on first sign-in if
        // this login predates the field (mirrors the linked tutor's handle when present).
        await ensureUserUsername(dbUser.id);

        token.sub = dbUser.id;
        token.role = dbUser.role;
        token.tutorId = dbUser.tutorId;
      } else if (token.sub) {
        // Token reuse (no fresh sign-in): keep the linked `tutorId` in sync with the DB so a
        // can-tutor toggle — which links/creates the Tutor (or archives it) on `/admin/users` —
        // takes effect on the next request without forcing a re-login. (Role still updates only
        // at sign-in, per the note above and the admin UI hint.)
        const dbUser = await db.user.findUnique({
          where: { id: token.sub },
          select: { tutorId: true },
        });
        token.tutorId = dbUser?.tutorId ?? null;
      }
      return token;
    },
  },
});

const auth = cache(uncachedAuth);

export { auth, handlers, signIn, signOut };
