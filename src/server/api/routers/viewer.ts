/**
 * Public observer self-registration (read-only VIEWER accounts). The only open account-creation
 * path — gated by email validation + the OBSERVER_SIGNUP feature flag, and rate-limited per IP +
 * per email. See src/server/auth/viewer-signup.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { rateLimit } from "~/server/rate-limit";
import { emailSender } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { getFeatures } from "~/server/program/features";
import { notifyAdmins } from "~/server/notifications/create";
import {
  VIEWER_CODE_TTL_MINUTES,
  startViewerSignup,
  verifyViewerCode,
  completeViewerSignup,
} from "~/server/auth/viewer-signup";
import type { db as dbClient } from "~/server/db";

function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

function enforceRateLimit(key: string, max: number): void {
  const res = rateLimit(key, { max, windowMs: 10 * 60 * 1000 });
  if (!res.ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Please wait a few minutes and try again.",
    });
  }
}

async function assertEnabled(db: typeof dbClient): Promise<void> {
  const features = await getFeatures(db);
  if (!features.OBSERVER_SIGNUP) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Observer registration is currently closed." });
  }
}

export const viewerRouter = createTRPCRouter({
  /** Stage a signup + email a 6-digit verification code. */
  start: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        affiliation: z.string().trim().min(1).max(200),
        email: z.string().trim().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEnabled(ctx.db);
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`viewer:ip:${ip}`, 20);
      enforceRateLimit(`viewer:email:${input.email.toLowerCase()}`, 6);

      const res = await startViewerSignup(input);
      if (!res.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An account already exists for this email. Sign in or reset your password.",
        });
      }
      await emailSender.send({
        to: input.email.trim().toLowerCase(),
        subject: `Your ${APP_TITLE} verification code`,
        text:
          `Your ${APP_TITLE} email verification code is ${res.code}.\n\n` +
          `It expires in ${VIEWER_CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.`,
        html:
          `<p>Your <strong>${APP_TITLE}</strong> email verification code is ` +
          `<strong style="font-size:1.2em;letter-spacing:2px">${res.code}</strong>.</p>` +
          `<p>It expires in ${VIEWER_CODE_TTL_MINUTES} minutes.</p>`,
      });
      return { ok: true };
    }),

  /** Confirm the emailed code. */
  verify: publicProcedure
    .input(z.object({ email: z.string().trim().email(), code: z.string().trim().regex(/^\d{6}$/) }))
    .mutation(async ({ ctx, input }) => {
      await assertEnabled(ctx.db);
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`viewer:ip:${ip}`, 20);
      enforceRateLimit(`viewer:verify:${input.email.toLowerCase()}`, 10);

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
      return { ok: true };
    }),

  /** Finish: set a password, creating the verified VIEWER login. */
  complete: publicProcedure
    .input(z.object({ email: z.string().trim().email(), password: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertEnabled(ctx.db);
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`viewer:ip:${ip}`, 20);
      enforceRateLimit(`viewer:complete:${input.email.toLowerCase()}`, 10);

      const res = await completeViewerSignup(input.email, input.password);
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
        title: "New observer account",
        body: "A new read-only observer registered to follow the program.",
        link: "/admin/users",
      });
      return { ok: true, username: res.username };
    }),
});
