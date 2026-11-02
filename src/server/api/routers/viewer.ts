import { isEmailCodeFormat } from "~/lib/registration-code";
import { continueInEmailedInvitation } from "~/server/auth/legacy-invitation";
import { optionalPersonNameFields } from "~/lib/person-name";
import { captchaGrantInput } from "~/lib/captcha";
import { withProtectedSignup } from "~/server/captcha";
/**
 * Public mailbox verification issues a distinct typed invitation. New accounts receive
 * read-only Viewer access; existing recipients retain their memberships and sign in.
 * Availability and request admission remain source-owned.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { withSignupAdmission, signupMetric } from "~/server/signup-admission";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { getFeatures } from "~/server/program/features";
import { normalizeEmailCode } from "~/server/auth/code";
import {
  VIEWER_CODE_TTL_MINUTES,
  startViewerSignup,
  verifyViewerCode,
} from "~/server/auth/viewer-signup";
import type { db as dbClient } from "~/server/db";
import { inTransaction } from "~/server/transactions";
import { issueViewerAccountInvitation } from "~/server/auth/account-invitations";

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
  /** Stage a signup + email a four-digit verification code. */
  start: publicProcedure
    .input(
      z.object({
        captchaGrant: captchaGrantInput,
        ...optionalPersonNameFields,
        name: z.string().trim().max(200),
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

          try {
            await inTransaction(ctx.db, async (tx) => {
              const res = await startViewerSignup(input, tx);
              if (!res.ok) throw new Error("Could not stage mailbox challenge");
              await emailSender.send({
                category: "SECURITY",
                signup: true,
                to: input.email.trim().toLowerCase(),
                subject: `${APP_TITLE}: verify Viewer signup / 验证观察员注册`,
                text: `Verify your email to continue signing up for read-only Viewer access. This code does not enroll you as a tutor or tutee.\n验证邮箱后可继续申请只读观察员权限；此验证码不会将您登记为辅导伙伴或学习伙伴。\n\nYour email verification code (4 digits) / 邮箱验证码（4 位数字） is ${res.code}.\n\nIt expires in ${VIEWER_CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.\n验证码将在 ${VIEWER_CODE_TTL_MINUTES} 分钟后失效。如非本人申请，请忽略此邮件。`,
                presentation: {
                  code: res.code,
                  codePurpose: "verification",
                  eyebrow: "EMAIL VERIFICATION",
                },
              });
            });
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            signupMetric("delivery-failed");
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
          .transform(normalizeEmailCode)
          .refine(isEmailCodeFormat),
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
          const invitation = await issueViewerAccountInvitation(
            ctx.db,
            input.email,
            res.completionProof,
            true,
          );
          return {
            ok: true,
            completionProof: res.completionProof,
            ...invitation,
          };
        },
      ),
    ),

  /** Exchange outstanding verification proof for a recipient invitation without writing credentials. */
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

          await issueViewerAccountInvitation(
            ctx.db,
            input.email,
            input.completionProof,
          );
          return continueInEmailedInvitation();
        },
      ),
    ),
});
