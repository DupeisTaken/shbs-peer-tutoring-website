import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    // Keys the session JWT and the HMAC that hashes every emailed OTP / registration
    // email-code (see src/server/auth/registration.ts `secret()`). A weak or missing value
    // makes those hashes forgeable, so production startup fails rather than running without it.
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(32, "AUTH_SECRET must be at least 32 characters in production")
        : z.string().optional(),
    // Optional: comma-separated emails granted ADMIN on sign-in (bootstrap, no DB editing).
    AUTH_BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),
    // NOTE: email-based 2FA (future) will add an email-provider config here once a
    // provider is chosen — see src/server/email/sender.ts.
    // Opt-in: inject an artificial 100–500ms delay into every tRPC call in dev (the T3
    // starter default) to surface request waterfalls. Off by default so local dev is snappy.
    TRPC_DEV_DELAY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Transactional email via Aliyun Direct Mail (SMTP). Email is "configured" when EMAIL_FROM
    // and SMTP_PASSWORD are both set; otherwise the app falls back to logging mail in dev.
    // See src/server/email/sender.ts and the email setup notes in README-DEPLOY.md.
    SMTP_HOST: z.string().default("smtpdm.aliyun.com"),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    // SMTP login. For Aliyun the username IS the sender address; leave unset to use EMAIL_FROM.
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    // Verified Aliyun sender address (发信地址), e.g. "noreply@mail.example.edu".
    EMAIL_FROM: z.string().email().optional(),
    // Optional display name on the From header (defaults to the app title).
    EMAIL_FROM_NAME: z.string().optional(),
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
    // Optional program identity labels (white-labeling). Empty = fall back in src/lib/branding.ts.
    // Organization / school name (letterhead, emails, footer); distinct from the app title.
    NEXT_PUBLIC_ORG_NAME: z.string().default(""),
    // Public support/contact address shown in footers + help text.
    NEXT_PUBLIC_SUPPORT_EMAIL: z.string().default(""),
    // Display label for the program season/year, e.g. "2025–26" (headings + reports).
    NEXT_PUBLIC_PROGRAM_TERM_LABEL: z.string().default(""),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_BOOTSTRAP_ADMIN_EMAILS: process.env.AUTH_BOOTSTRAP_ADMIN_EMAILS,
    TRPC_DEV_DELAY: process.env.TRPC_DEV_DELAY,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_TITLE: process.env.NEXT_PUBLIC_APP_TITLE,
    NEXT_PUBLIC_TEAM_TITLE: process.env.NEXT_PUBLIC_TEAM_TITLE,
    NEXT_PUBLIC_ORG_NAME: process.env.NEXT_PUBLIC_ORG_NAME,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_PROGRAM_TERM_LABEL: process.env.NEXT_PUBLIC_PROGRAM_TERM_LABEL,
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
