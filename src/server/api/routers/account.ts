import { notificationInAppEvent } from "~/lib/notification-details";
import { optionalPersonNameFields } from "~/lib/person-name";
import { accountHistoryIds } from "~/server/account-history";
import { currentAcademicInput, academicSummary } from "~/lib/academics";
import { confirmCurrentAccountAcademics } from "~/server/academics";
import { membershipSchema } from "~/lib/account-membership";
import { queueProposal } from "~/server/approvals";
import { updateAccountProfile } from "~/server/account-profile";
import {
  requestSecondaryEmail,
  confirmSecondaryEmail,
  manageSecondaryEmail,
  associatedAccountEmails,
} from "~/server/auth/account-emails";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { verifyPasswordConfirmation } from "~/server/auth/password-confirmation";
import { changeVerifiedPassword } from "~/server/auth/session-version";
import { ensureUserUsername } from "~/server/auth/username";
import { issueStepUpCode, verifyStepUpCode } from "~/server/auth/step-up";
import { getFeatures } from "~/server/program/features";
import { maskEmail } from "~/server/auth/mask";
import { notifyAdmins } from "~/server/notifications/create";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import { eligibleReviewRecipient } from "~/server/email/notification-policy";
import { notificationCategories, effectiveNotificationPreference, informationCategories, type NotificationCategory } from "~/lib/notification-categories";
import {
  requestEmailChange,
  confirmEmailChange,
} from "~/server/auth/email-change";

/**
 * Self-service account router — the signed-in user's own login (any role). Used by the admin/
 * coordinator account page (and available to viewers, who may still manage their own password).
 * Kept separate from the tutor router so an account without a linked tutor can use it.
 */
export const accountRouter = createTRPCRouter({
  notificationPreferences: protectedProcedure.query(async ({ ctx }) => {
    const [user, program] = await Promise.all([
      ctx.db.user.findUniqueOrThrow({ where: { id: ctx.session.user.id }, include: { notificationPreferences: true } }),
      ctx.db.programSettings.findUnique({ where: { id: "program" }, select: { emailNotificationsEnabled: true } }),
    ]);
    const emailEnabled = program?.emailNotificationsEnabled ?? false;
    const canReceiveReviewRequests = eligibleReviewRecipient(user);
    return {
      categories: notificationCategories.map((category) => ({
        ...effectiveNotificationPreference(user, category, user.notificationPreferences),
        badgeAvailable: category !== "reminders",
        emailEditable: emailEnabled && (category !== "reviews" || canReceiveReviewRequests),
      })),
      emailEnabled, canReceiveReviewRequests, emailSecondaryRecipients: user.emailSecondaryRecipients,
      deliveryAvailable: isEmailDeliveryAvailable("PROGRAM"),
    };
  }),
  setNotificationPreferences: protectedProcedure.input(z.object({
    categories: z.array(z.object({ category: z.enum(notificationCategories), badgeEnabled: z.boolean(), emailEnabled: z.boolean() }))
      .max(notificationCategories.length).refine((rows) => new Set(rows.map((row) => row.category)).size === rows.length, "Each category can be submitted once."),
    emailSecondaryRecipients: z.boolean().optional(),
  })).mutation(async ({ ctx, input }) => ctx.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('email-notifications-setting', 0))`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.session.user.id }, include: { notificationPreferences: true } });
    const settings = await tx.programSettings.findUnique({ where: { id: "program" } });
    for (const row of input.categories) {
      const current = effectiveNotificationPreference(user, row.category, user.notificationPreferences);
      if (row.category === "reminders" && row.badgeEnabled !== current.badgeEnabled)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upcoming reminders are email-only." });
      if (row.emailEnabled && row.emailEnabled !== current.emailEnabled &&
        (!settings?.emailNotificationsEnabled || (row.category === "reviews" && !eligibleReviewRecipient(user))))
        throw new TRPCError({ code: "FORBIDDEN", message: "Email cannot be enabled for this category with your current access and program settings." });
      await tx.notificationPreference.upsert({
        where: { userId_category: { userId: user.id, category: row.category } },
        create: { userId: user.id, ...row }, update: { badgeEnabled: row.badgeEnabled, emailEnabled: row.emailEnabled },
      });
    }
    if (input.emailSecondaryRecipients !== undefined) {
      if (input.emailSecondaryRecipients && !user.emailSecondaryRecipients && !settings?.emailNotificationsEnabled)
        throw new TRPCError({ code: "FORBIDDEN", message: "Email notifications are disabled by the program administrator." });
      await tx.user.update({ where: { id: user.id }, data: { emailSecondaryRecipients: input.emailSecondaryRecipients } });
    }
    const disabled = input.categories.filter((row) => !row.emailEnabled).map((row) => row.category);
    if (disabled.length) await tx.emailDelivery.updateMany({
      where: { userId: user.id, status: "PENDING", preferenceTopic: { in: disabled } },
      data: { status: "SKIPPED", completedAt: new Date(), leaseUntil: null },
    });
    return { ok: true };
  })),
  updateAcademics: protectedProcedure
    .input(currentAcademicInput)
    .mutation(({ ctx, input }) =>
      confirmCurrentAccountAcademics(ctx.db, ctx.session.user.id, input, {
        actorId: ctx.session.user.id,
        source: "SELF_SERVICE",
      }),
    ),
  academicHistory: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.academicConfirmation.findMany({
      where: {
        userId: { in: await accountHistoryIds(ctx.db, ctx.session.user.id) },
      },
      orderBy: { confirmedAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        gradeLevel: true,
        rawGrade: true,
        schoolYear: true,
        confirmedAt: true,
        source: true,
        reason: true,
      },
    }),
  ),
  // Self-service participation requests never grant management rank. The trusted origin is
  // server-owned so a direct management mutation cannot impersonate this narrower workflow.
  requestMemberships: protectedProcedure
    .input(membershipSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await queueProposal(
        ctx.session,
        "admin.setMemberships",
        { userId: ctx.session.user.id, membership: input },
        { participantSelfService: true },
      );
      return { id: request.id, state: request.state };
    }),
  emailSettings: protectedProcedure.query(async ({ ctx }) => {
    const [user, program, emails] = await Promise.all([
      ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: {
          email: true,
          emailSecurity: true,
          emailMessages: true,
          emailInfo: true,
          emailReviewRequests: true,
          emailEventReminders: true,
          role: true,
          suspendedAt: true,
          mergedIntoId: true,
          emailSecondaryRecipients: true,
        },
      }),
      ctx.db.programSettings.findUnique({
        where: { id: "program" },
        select: {
          emailNotificationsEnabled: true,
          secondaryEmailBindingEnabled: true,
        },
      }),
      associatedAccountEmails(ctx.db, ctx.session.user.id),
    ]);
    return {
      ...user,
      canReceiveReviewRequests: eligibleReviewRecipient(user),
      emails,
      enabled: program?.emailNotificationsEnabled ?? false,
      secondaryEmailBindingEnabled:
        program?.secondaryEmailBindingEnabled ?? true,
      deliveryAvailable: isEmailDeliveryAvailable("SECURITY"),
    };
  }),
  setEmailPreferences: protectedProcedure
    .input(
      z.object({
        // Accepted from older clients only; security alerts cannot be opted out of.
        emailSecurity: z.boolean().optional(),
        emailMessages: z.boolean(),
        emailInfo: z.boolean(),
        emailReviewRequests: z.boolean().optional(),
        emailEventReminders: z.boolean().optional(),
        emailSecondaryRecipients: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        // Serialize with the administrator's gate so a concurrent disable cannot accept preferences.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('email-notifications-setting', 0))`;
        const program = await tx.programSettings.findUnique({
          where: { id: "program" },
        });
        if (!program?.emailNotificationsEnabled)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Email notifications are disabled by the program administrator.",
          });
        const current = await tx.user.findUniqueOrThrow({ where: { id: ctx.session.user.id } });
        if (input.emailReviewRequests && !current.emailReviewRequests) {
          if (!eligibleReviewRecipient(current))
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Only active Admin or Head reviewers can enable review-request emails.",
            });
        }
        await tx.user.update({
          where: { id: ctx.session.user.id },
          data: {
            emailMessages: input.emailMessages,
            emailInfo: input.emailInfo,
            ...(input.emailReviewRequests !== undefined
              ? { emailReviewRequests: input.emailReviewRequests }
              : {}),
            ...(input.emailEventReminders !== undefined
              ? { emailEventReminders: input.emailEventReminders }
              : {}),
            emailSecondaryRecipients: input.emailSecondaryRecipients,
          },
        });
        // Old clients submit broad switches on every save. Propagate only a real
        // switch change so unchanged fields cannot erase category-specific choices.
        const changedTopics: { category: NotificationCategory; enabled: boolean }[] = [];
        if (input.emailMessages !== current.emailMessages) changedTopics.push({ category: "messages", enabled: input.emailMessages });
        if (input.emailInfo !== current.emailInfo) changedTopics.push(...informationCategories.map((category) => ({ category, enabled: input.emailInfo })));
        if (input.emailReviewRequests !== undefined && input.emailReviewRequests !== current.emailReviewRequests) changedTopics.push({ category: "reviews", enabled: input.emailReviewRequests });
        if (input.emailEventReminders !== undefined && input.emailEventReminders !== current.emailEventReminders) changedTopics.push({ category: "reminders", enabled: input.emailEventReminders });
        for (const topic of changedTopics) await tx.notificationPreference.upsert({
          where: { userId_category: { userId: current.id, category: topic.category } },
          create: { userId: current.id, category: topic.category, emailEnabled: topic.enabled }, update: { emailEnabled: topic.enabled },
        });
        // Opting out cancels existing copies too; a later opt-in must not replay them.
        const stoppedCategories = [
          ...(input.emailMessages === false && current.emailMessages ? ["messages"] : []),
          ...(input.emailInfo === false && current.emailInfo ? ["info", "information"] : []),
          ...(input.emailReviewRequests === false && current.emailReviewRequests ? ["review"] : []),
          ...(input.emailEventReminders === false && current.emailEventReminders ? ["reminder"] : []),
        ];
        const stoppedTopics = changedTopics.filter((topic) => !topic.enabled).map((topic) => topic.category);
        if (stoppedCategories.length || stoppedTopics.length)
          await tx.emailDelivery.updateMany({
            where: {
              userId: ctx.session.user.id,
              status: "PENDING",
              OR: [
                { preferenceTopic: { in: stoppedTopics } },
                { preferenceTopic: null, category: { in: stoppedCategories } },
              ],
            },
            data: {
              status: "SKIPPED",
              completedAt: new Date(),
              leaseUntil: null,
            },
          });
        return { ok: true };
      });
    }),
  requestSecondaryEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(254),
        currentPassword: z.string().min(1).max(1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requestSecondaryEmail(
        ctx.session.user.id,
        input.email,
        input.currentPassword,
      );
      return { ok: true };
    }),
  confirmSecondaryEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(254),
        code: z.string().trim().min(1).max(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !(await confirmSecondaryEmail(
          ctx.session.user.id,
          input.email,
          input.code,
        ))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The code is incorrect or expired.",
        });
      return { ok: true };
    }),
  manageSecondaryEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(254),
        currentPassword: z.string().min(1).max(1024),
        action: z.enum(["primary", "remove"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await manageSecondaryEmail(
        ctx.session.user.id,
        input.email,
        input.currentPassword,
        input.action,
      );
      return { ok: true };
    }),
  requestEmailChange: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        currentPassword: z.string().min(1).max(1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requestEmailChange(
        ctx.session.user.id,
        input.email,
        input.currentPassword,
      );
      return { ok: true };
    }),
  confirmEmailChange: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(30) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await confirmEmailChange(ctx.session.user.id, input.code)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The code is incorrect or expired.",
        });
      return { ok: true };
    }),
  /** The caller's own login identity (name, username, email, role, tutor link). */
  me: protectedProcedure.query(async ({ ctx }) => {
    // Uphold the username invariant for accounts that predate the field.
    await ensureUserUsername(ctx.session.user.id);
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: {
        name: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        legacyName: true,
        alternativeNames: true,
        profileVersion: true,
        academicProfile: true,
        id: true,
        tutorId: true,
        tutorAccessRevoked: true,
        email: true,
        username: true,
        role: true,
        twoFactorEnabled: true,
        // The translator route's layout uses this capability to decide whether to render the editor.
        canTranslate: true,
        tuteeMember: true,
        crewStatus: true,
        tutor: { select: { id: true, status: true } },
      },
    });
    const term = await ctx.db.term.findFirst({
      where: { active: true },
      select: { schoolYear: true },
    });
    const { academicProfile, ...identity } = user;
    return {
      ...identity,
      academic: academicSummary(academicProfile, term?.schoolYear),
      currentSchoolYear: term?.schoolYear ?? null,
    };
  }),

  /** The caller's suspension state + their latest appeal — drives the /suspended screen. */
  suspension: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { suspendedAt: true, suspendedReason: true },
    });
    const appeal = await ctx.db.accountAppeal.findFirst({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, state: true, message: true, createdAt: true },
    });
    return {
      suspended: !!user.suspendedAt,
      reason: user.suspendedReason,
      appeal,
    };
  }),

  /** Submit an appeal for reinstatement (suspended accounts only; one pending at a time). */
  submitAppeal: protectedProcedure
    .input(
      z.object({ message: z.string().trim().min(1, "Tell us why.").max(1000) }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { suspendedAt: true, name: true },
      });
      if (!user.suspendedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Your account is not suspended.",
        });
      }
      const open = await ctx.db.accountAppeal.findFirst({
        where: { userId: ctx.session.user.id, state: "PENDING" },
        select: { id: true },
      });
      if (open) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already have a pending appeal.",
        });
      }
      await ctx.db.accountAppeal.create({
        data: { userId: ctx.session.user.id, message: input.message },
      });
      await notifyAdmins({
        ...notificationInAppEvent("account_appeal_requested", undefined, {
          en: `${user.name ?? "A suspended user"} submitted an account suspension appeal.`,
          zh: `${user.name ?? "一位账户被停用的用户"} 提交了账户停用申诉。`,
        }),
        title: "Account appeal",
        body: `${user.name ?? "A suspended user"} submitted an appeal.`,
        link: "/admin/users",
      });
      return { ok: true };
    }),

  /** Update the caller's display name. */
  updateName: protectedProcedure
    .input(
      z.object({
        ...optionalPersonNameFields,
        name: z.string().trim().max(200),
        alternativeNames: z.string().trim().max(200).nullable().optional(),
        expectedProfileVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateAccountProfile(ctx.db, ctx.session.user.id, input);
      return { ok: true };
    }),

  /**
   * Enable or disable login email 2FA for the caller. Requiring the current password prevents a
   * stolen session from silently weakening or strengthening authentication. Enabling also checks
   * both the program flag and real delivery availability; disabling remains possible during an
   * email outage so an administrator can recover an affected account.
   */
  setTwoFactorEnabled: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        currentPassword: z.string().min(1).max(1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (
        !verifyPasswordConfirmation(
          ctx.session.user.id,
          input.currentPassword,
          user.passwordHash,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect.",
        });
      }

      if (input.enabled) {
        const { EMAIL_2FA } = await getFeatures(ctx.db);
        if (!EMAIL_2FA) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Email two-factor authentication is disabled for this program.",
          });
        }
        if (!isEmailDeliveryAvailable("SECURITY")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Email delivery is unavailable. Contact the program team.",
          });
        }
      }

      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { twoFactorEnabled: input.enabled },
      });
      return { ok: true, enabled: input.enabled };
    }),

  /**
   * Step 1 of a password change: verify the current password, then email a one-time verification
   * code (step-up 2FA). Returns the masked address it was sent to. The code is required in
   * `changePassword`. Fails closed for a passwordless account (finish setup first).
   */
  requestPasswordChangeCode: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (
        !verifyPasswordConfirmation(
          ctx.session.user.id,
          input.currentPassword,
          user.passwordHash,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect.",
        });
      }
      const { EMAIL_2FA } = await getFeatures(ctx.db);
      if (!EMAIL_2FA) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Email two-factor authentication is disabled for this program.",
        });
      }
      if (!isEmailDeliveryAvailable("SECURITY")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email delivery is unavailable. Contact the program team.",
        });
      }
      const { email } = await issueStepUpCode(
        ctx.session.user.id,
        "PASSWORD_CHANGE",
      );
      return { sent: true, email: maskEmail(email) };
    }),

  /**
   * Step 2: change the password. Requires the current password AND the emailed verification code
   * (issued by `requestPasswordChangeCode`). The code is single-use and expiring.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(1024),
        newPassword: z.string().min(8, "Use at least 8 characters.").max(1024),
        code: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (
        !verifyPasswordConfirmation(
          ctx.session.user.id,
          input.currentPassword,
          user.passwordHash,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect.",
        });
      }
      // The program flag gates the emailed step-up code. With the feature off, a verified current
      // password is sufficient; with it on, a delivery outage fails closed below.
      const { EMAIL_2FA } = await getFeatures(ctx.db);
      if (EMAIL_2FA) {
        if (!isEmailDeliveryAvailable("SECURITY")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Email delivery is unavailable. Contact the program team.",
          });
        }
        if (!input.code) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Request a verification code first.",
          });
        }
        const verified = await verifyStepUpCode(
          ctx.session.user.id,
          "PASSWORD_CHANGE",
          input.code,
        );
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
      }
      await changeVerifiedPassword(
        ctx.db,
        ctx.session.user.id,
        user.passwordHash,
        input.newPassword,
      );
      return { ok: true };
    }),
});
