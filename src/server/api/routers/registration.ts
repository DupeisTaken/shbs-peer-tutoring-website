import { continueInEmailedInvitation } from "~/server/auth/legacy-invitation";
import { optionalPersonNameFields } from "~/lib/person-name";
import { preferredLatinNameSchema } from "~/lib/username";
import { isSchoolYear } from "~/lib/period";
/**
 * Public self-registration flow (no auth). A prospective tutor turns a five-character registration code
 * (issued + handed out by an admin/coordinator) into a fully-verified account at /register:
 *   check       -> validate the code, return any prefill / email binding
 *   sendEmailCode -> email a five-character code to the chosen address
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
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import {
  codePrefill,
  registrationCompletionProof,
  confirmEmailCode,
  resolveUsableCode,
  setEmailVerification,
} from "~/server/auth/registration";
import { normalizeRegCode } from "~/server/auth/code";
import { deliverAccountInvitation } from "~/server/auth/account-invitations";
import { inTransaction } from "~/server/transactions";
import { lockUsernameNamespace } from "~/server/auth/username";

/** The admin-issued security key: normalized (uppercase, separators stripped) to 5 alphanumerics.
 *  Validity (existence/expiry/use) is checked by lookup, so a wrong-but-well-formed code yields a
 *  friendly "not valid" rather than a raw schema error. */
const codeInput = z
  .string()
  .transform(normalizeRegCode)
  .pipe(z.string().regex(/^[0-9A-Z]{5}$/));
/** The emailed email-verification OTP uses the same 5-char Steam format (see docs/contributing.md). */
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
  check: publicProcedure
    .input(z.object({ code: codeInput }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:code:${input.code}`, 10);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);
      const prefill = await codePrefill(resolved.row);
      return {
        kind: resolved.row.kind,
        boundEmail: prefill.boundEmail,
        legacyName: prefill.legacyName,
        firstName: prefill.firstName,
        lastName: prefill.lastName,
        preferredName: prefill.preferredName,
        alternativeNames: prefill.alternativeNames,
        gradeLevel: prefill.gradeLevel,
        gradeSchoolYear: prefill.gradeSchoolYear,
        emailVerified: !!resolved.row.emailVerifiedAt,
        pendingEmail: resolved.row.pendingEmail,
      };
    }),

  /** Stage email verification and email a five-character code to the chosen address. */
  sendEmailCode: publicProcedure
    .input(z.object({ code: codeInput, email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!isEmailDeliveryAvailable("SECURITY")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Email verification is temporarily unavailable. Contact the program team.",
        });
      }
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:email:${input.code}`, 6);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);

      return inTransaction(ctx.db, async (tx) => {
        await lockUsernameNamespace(tx);
        const staged = await setEmailVerification(
          resolved.row,
          input.email,
          tx,
        );
        if (!staged.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This code is tied to a different email address.",
          });
        }
        const refreshed = await tx.registrationCode.findUniqueOrThrow({
          where: { id: resolved.row.id },
        });
        const invitation = await deliverAccountInvitation(tx, {
          kind: refreshed.kind,
          email: input.email,
          code: staged.emailCode,
          sourceKey: `staff:${refreshed.id}:${refreshed.emailCodeHash}`,
          source: {
            type: "staff",
            id: refreshed.id,
            challenge: refreshed.emailCodeHash!,
          },
        });
        return { ok: true, ...invitation };
      });
    }),

  /** Compatibility verifier for outstanding staff invitation mail. */
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
      return { ok: true, completionProof: confirmed.completionProof };
    }),

  /** Exchange old browser proof for the shared invitation; no credential write here. */
  complete: publicProcedure
    .input(
      z.object({
        code: codeInput,
        completionProof: z.string().regex(/^[a-f0-9]{64}$/),
        ...optionalPersonNameFields,
        firstName: optionalPersonNameFields.firstName.unwrap(),
        lastName: optionalPersonNameFields.lastName.unwrap(),
        preferredLatinName: preferredLatinNameSchema,
        alternativeNames: z.string().trim().max(200).optional(),
        gradeLevel: z.number().int().min(1).max(12).nullable().optional(),
        gradeSchoolYear: z.string().refine(isSchoolYear).nullable().optional(),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers);
      enforceRateLimit(`reg:ip:${ip}`, 30);
      enforceRateLimit(`reg:complete:${input.code}`, 10);

      const resolved = await resolveUsableCode(input.code);
      if (!resolved.ok) codeError(resolved.error);

      const row = resolved.row;
      if (
        !row.emailVerifiedAt ||
        !row.emailCodeHash ||
        !row.pendingEmail ||
        input.completionProof !==
          registrationCompletionProof(
            "invitation",
            row.id,
            row.emailCodeHash,
            row.emailVerifiedAt,
          )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verify your email before finishing.",
        });
      // Cached pre-deployment clients exchange their valid proof for the shared invitation.
      // This adapter never creates credentials or attaches participation on the old endpoint.
      await deliverAccountInvitation(ctx.db, {
        kind: row.kind,
        email: row.pendingEmail,
        sourceKey: "staff:" + row.id + ":" + row.emailCodeHash,
        source: { type: "staff", id: row.id, challenge: row.emailCodeHash },
      });
      return continueInEmailedInvitation();
    }),
});
