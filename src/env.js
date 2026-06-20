import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    // Optional: comma-separated emails granted ADMIN on sign-in (bootstrap, no DB editing).
    AUTH_BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),
    // Shared temporary password for auto-provisioned tutor logins (accepted applicants).
    // They sign in with this once, then must set their own password + email on first login.
    TUTOR_DEFAULT_PASSWORD: z.string().min(1).default("ChangeMe!123"),
    // NOTE: email-based 2FA (future) will add an email-provider config here once a
    // provider is chosen — see src/server/email/sender.ts.
    // Opt-in: inject an artificial 100–500ms delay into every tRPC call in dev (the T3
    // starter default) to surface request waterfalls. Off by default so local dev is snappy.
    TRPC_DEV_DELAY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // Display titles (branding). Override in .env to rebrand without code changes;
    // see src/lib/branding.ts. Public title is used everywhere students see the app;
    // team title brands the tutor/coordinator/admin management area.
    NEXT_PUBLIC_APP_TITLE: z.string().min(1).default("SHBS Peer Tutoring"),
    NEXT_PUBLIC_TEAM_TITLE: z.string().min(1).default("SHBS Peer Tutoring Team"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_BOOTSTRAP_ADMIN_EMAILS: process.env.AUTH_BOOTSTRAP_ADMIN_EMAILS,
    TUTOR_DEFAULT_PASSWORD: process.env.TUTOR_DEFAULT_PASSWORD,
    TRPC_DEV_DELAY: process.env.TRPC_DEV_DELAY,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_TITLE: process.env.NEXT_PUBLIC_APP_TITLE,
    NEXT_PUBLIC_TEAM_TITLE: process.env.NEXT_PUBLIC_TEAM_TITLE,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
