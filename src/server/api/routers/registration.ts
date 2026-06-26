/**
 * Public self-registration flow (no auth). A prospective tutor turns a 6-digit registration code
 * (issued + handed out by an admin/coordinator) into a fully-verified account at /register:
 *   check       -> validate the code, return any prefill / email binding
 *   sendEmailCode -> email a 6-digit code to the chosen address
 *   verifyEmail -> confirm that emailed code
 *   complete    -> set name / grade / password, creating + linking the Tutor and login
 *
 * Every step re-validates the plaintext code and is rate-limited (per IP + per code) on top of the
 * code's own attempt counter. See src/server/auth/registration.ts for the core logic.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { rateLimit } from "~/server/rate-limit";
import { emailSender } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import {
  EMAIL_CODE_TTL_MINUTES,
  codePrefill,
  completeRegistration,
  confirmEmailCode,
  resolveUsableCode,
  setEmailVerification,
} from "~/server/auth/registration";
import { normalizeRegCode } from "~/server/auth/code";

/** The admin-issued security key: normalized (uppercase, separators stripped) to 5 alphanumerics.
 *  Validity (existence/expiry/use) is checked by lookup, so a wrong-but-well-formed code yields a
 *  friendly "not valid" rather than a raw schema error. */
const codeInput = z
  .string()
  .transform(normalizeRegCode)
  .pipe(z.string().regex(/^[0-9A-Z]{5}$/));
/** The emailed email-verification OTP uses the same 5-char Steam format (see CLAUDE.md). */
const emailCodeInput = codeInput;

/** Coarse client IP from proxy headers (best-effort; only used for rate-limit keys). */
function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Throw a friendly TRPCError for a code-resolution failure. */
function codeError(error: string): never {
  const message =
    error === "used"
      ? "This registration code has already been used."
      : error === "expired"
        ? "This registration code has expired. Ask for a new one."
        : error === "too-many-attempts"
          ? "Too many attempts on this code. Ask for a new one."
          : "That registration code isn't valid.";
  throw new TRPCError({ code: "BAD_REQUEST", message });
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

export const registrationRouter = createTRPCRouter({
  /** Validate a code and return any prefill + email binding so the form can start populated. */
  check: publicProcedure.input(z.object({ code: codeInput })).mutation(async ({ ctx, input }) => {
    const ip = clientIp(ctx.headers);
    enforceRateLimit(`reg:ip:${ip}`, 30);
    enforceRateLimit(`reg:code:${input.code}`, 10);

    const resolved = await resolveUsableCode(input.code);
    if (!resolved.ok) codeError(resolved.error);
    const prefill = await codePrefill(resolved.row);
    return {
      kind: resolved.row.kind,
      boundEmail: prefill.boundEmail,
      firstName: prefill.firstName,
      lastName: prefill.lastName,
      alternativeNames: prefill.alternativeNames,
      gradeLevel: prefill.gradeLevel,
      emailVerified: !!resolved.row.emailVerifiedAt,
      pendingEmail: resolved.row.pendingEmail,
    };
  }),

  /** Stage email verification and email a 6-digit code to the chosen address. */
  sendEmailCode: publicProcedure
    .input(z.object({ code: codeInput, email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:email:${input.code}`, 6);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);

      const staged = await setEmailVerification(resolved.row, input.email);
      if (!staged.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This code is tied to a different email address.",
        });
      }
      await emailSender.send({
        to: input.email.trim().toLowerCase(),
        subject: `Your ${APP_TITLE} verification code`,
        text:
          `Your ${APP_TITLE} email verification code is ${staged.emailCode}.\n\n` +
          `It expires in ${EMAIL_CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.`,
        html:
          `<p>Your <strong>${APP_TITLE}</strong> email verification code is ` +
          `<strong style="font-size:1.2em;letter-spacing:2px">${staged.emailCode}</strong>.</p>` +
          `<p>It expires in ${EMAIL_CODE_TTL_MINUTES} minutes.</p>`,
      });
      return { ok: true };
    }),

  /** Confirm the emailed 6-digit code. */
  verifyEmail: publicProcedure
    .input(z.object({ code: codeInput, emailCode: emailCodeInput }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:verify:${input.code}`, 10);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);

      const confirmed = await confirmEmailCode(resolved.row, input.emailCode);
      if (!confirmed.ok) {
        const message =
          confirmed.error === "expired"
            ? "That code expired. Request a new one."
            : confirmed.error === "too-many-attempts"
              ? "Too many attempts. Request a new code."
              : confirmed.error === "no-pending"
                ? "Send yourself a verification code first."
                : "That code is incorrect.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      return { ok: true };
    }),

  /** Finish: set profile + password, creating/linking the Tutor and verified login. */
  complete: publicProcedure
    .input(
      z.object({
        code: codeInput,
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        alternativeNames: z.string().trim().max(200).optional(),
        gradeLevel: z.number().int().min(6).max(12).nullable().optional(),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:complete:${input.code}`, 10);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);

      const done = await completeRegistration(resolved.row, {
        firstName: input.firstName,
        lastName: input.lastName,
        alternativeNames: input.alternativeNames,
        gradeLevel: input.gradeLevel ?? null,
        password: input.password,
      });
      if (!done.ok) {
        const message =
          done.error === "email-unverified"
            ? "Verify your email before finishing."
            : "An account already exists for this email. Use password reset instead.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      return { ok: true, username: done.username };
    }),
});
