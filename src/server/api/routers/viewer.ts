import { captchaGrantInput } from "~/lib/captcha";
import { withProtectedSignup } from "~/server/captcha";
/**
 * Public viewer self-registration (read-only VIEWER accounts). The only open account-creation
 * path — gated by email validation + the VIEWER_SIGNUP feature flag, and rate-limited per IP +
 * per email. See src/server/auth/viewer-signup.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { withSignupAdmission, signupMetric } from "~/server/signup-admission";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { getFeatures } from "~/server/program/features";
import { notifyAdmins } from "~/server/notifications/create";
import { normalizeRegCode } from "~/server/auth/code";
import {
  VIEWER_CODE_TTL_MINUTES,
  startViewerSignup,
  verifyViewerCode,
  completeViewerSignup,
} from "~/server/auth/viewer-signup";
import type { db as dbClient } from "~/server/db";

async function assertEnabled(db: typeof dbClient): Promise<void> {
  const features = await getFeatures(db);
  if (!features.VIEWER_SIGNUP) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Viewer registration is currently closed.",
    });
  }
}

export const viewerRouter = createTRPCRouter({
  /** Stage a signup + email a 6-digit verification code. */
  start: publicProcedure
    .input(
      z.object({
        captchaGrant: captchaGrantInput,
        name: z.string().trim().min(1).max(120),
        affiliation: z.string().trim().min(1).max(200),
        email: z.string().trim().email().max(254),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      withProtectedSignup(
        ctx.db,
        ctx.headers,
        "viewer.start",
        input.email,
        input.captchaGrant,
        async () => {
          await assertEnabled(ctx.db);
          if (!isEmailDeliveryAvailable("SECURITY")) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Email verification is temporarily unavailable. Contact the program team.",
            });
          }

          const previous = await ctx.db.viewerSignup.findUnique({
            where: { email: input.email.trim().toLowerCase() },
          });
          const res = await startViewerSignup(input);
          if (!res.ok) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "An account already exists for this email. Sign in or reset your password.",
            });
          }
          try {
            await emailSender.send({
              category: "SECURITY",
              signup: true,
              to: input.email.trim().toLowerCase(),
              subject: `Your ${APP_TITLE} verification code`,
              text:
                `Your ${APP_TITLE} email verification code is ${res.code}.\n\n` +
                `It expires in ${VIEWER_CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.`,
              presentation: { code: res.code, eyebrow: "EMAIL VERIFICATION" },
            });
          } catch {
            signupMetric("delivery-failed");
            const { hashCode } = await import("~/server/auth/registration");
            // CAS restoration preserves the previous emailed proof when SMTP fails.
            await ctx.db.viewerSignup.updateMany({
              where: {
                email: input.email.trim().toLowerCase(),
                codeHash: hashCode(res.code),
                usedAt: null,
              },
              data: previous
                ? {
                    codeHash: previous.codeHash,
                    codeExpiresAt: previous.codeExpiresAt,
                    verifiedAt: previous.verifiedAt,
                    attempts: previous.attempts,
                    name: previous.name,
                    affiliation: previous.affiliation,
                  }
                : { codeExpiresAt: new Date(0) },
            });
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "SIGNUP_MAIL_FAILED",
            });
          }
          return { ok: true };
        },
      ),
    ),

  /** Confirm the emailed code. */
  verify: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(254),
        code: z
          .string()
          .transform(normalizeRegCode)
          .pipe(z.string().regex(/^[0-9A-Z]{5}$/)),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.email,
        async () => {
          await assertEnabled(ctx.db);

          const res = await verifyViewerCode(input.email, input.code);
          if (!res.ok) {
            const message =
              res.error === "expired"
                ? "That code expired. Start the signup again."
                : res.error === "too-many-attempts"
                  ? "Too many attempts. Start the signup again."
                  : res.error === "not-found"
                    ? "Start the signup first."
                    : "That code is incorrect.";
            throw new TRPCError({ code: "BAD_REQUEST", message });
          }
          return { ok: true, completionProof: res.completionProof };
        },
      ),
    ),

  /** Finish: set a password, creating the verified VIEWER login. */
  complete: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(254),
        password: z.string().min(8).max(200),
        completionProof: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.email,
        async () => {
          await assertEnabled(ctx.db);

          const res = await completeViewerSignup(
            input.email,
            input.password,
            input.completionProof,
          );
          if (!res.ok) {
            const message =
              res.error === "email-unverified"
                ? "Verify your email before finishing."
                : res.error === "email-taken"
                  ? "An account already exists for this email."
                  : "Start the signup again.";
            throw new TRPCError({ code: "BAD_REQUEST", message });
          }
          await notifyAdmins({
            title: "New viewer account",
            body: "A new read-only viewer registered to follow the program.",
            link: "/admin/users",
          });
          return { ok: true };
        },
      ),
    ),
});
