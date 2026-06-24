import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { ensureUserUsername } from "~/server/auth/username";
import { issueStepUpCode, verifyStepUpCode } from "~/server/auth/step-up";
import { maskEmail } from "~/server/auth/mask";

/**
 * Self-service account router — the signed-in user's own login (any role). Used by the admin/
 * coordinator account page (and available to viewers, who may still manage their own password).
 * Kept separate from the tutor router so an account without a linked tutor can use it.
 */
export const accountRouter = createTRPCRouter({
  /** The caller's own login identity (name, username, email, role, tutor link). */
  me: protectedProcedure.query(async ({ ctx }) => {
    // Uphold the username invariant for accounts that predate the field.
    await ensureUserUsername(ctx.session.user.id);
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: {
        name: true,
        email: true,
        username: true,
        role: true,
        tutor: { select: { id: true, status: true } },
      },
    });
    return user;
  }),

  /** Update the caller's display name. */
  updateName: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1, "Enter a name.").max(100) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { name: input.name },
      });
      return { ok: true };
    }),

  /**
   * Step 1 of a password change: verify the current password, then email a one-time verification
   * code (step-up 2FA). Returns the masked address it was sent to. The code is required in
   * `changePassword`. Fails closed for a passwordless account (finish setup first).
   */
  requestPasswordChangeCode: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (!user.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect." });
      }
      const { email } = await issueStepUpCode(ctx.session.user.id, "PASSWORD_CHANGE");
      return { sent: true, email: maskEmail(email) };
    }),

  /**
   * Step 2: change the password. Requires the current password AND the emailed verification code
   * (issued by `requestPasswordChangeCode`). The code is single-use and expiring.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Use at least 8 characters."),
        code: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (!user.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect." });
      }
      const verified = await verifyStepUpCode(ctx.session.user.id, "PASSWORD_CHANGE", input.code);
      if (!verified.ok) {
        const message =
          verified.error === "expired"
            ? "That code has expired. Request a new one."
            : verified.error === "too-many-attempts"
              ? "Too many attempts. Request a new code."
              : verified.error === "no-code"
                ? "Request a verification code first."
                : "That code is incorrect.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { passwordHash: hashPassword(input.newPassword), mustChangePassword: false },
      });
      return { ok: true };
    }),
});
