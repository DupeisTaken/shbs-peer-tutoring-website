import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  adminProcedure,
  adminOnlyProcedure,
  headProcedure,
} from "~/server/api/trpc";
import {
  getFeatures,
  FEATURE_KEYS,
  DEFAULT_FEATURES,
} from "~/server/program/features";
import { recordAudit } from "~/server/audit/log";
import { isEmailDeliveryAvailable } from "~/server/email/sender";

import { getProgramTimeZone } from "~/server/program/time-zone";
import { isProgramTimeZone } from "~/lib/program-time";
import { programTimeZoneOptions } from "~/lib/program-time-zone-options";
import { inTransaction, lockEntity } from "~/server/transactions";

import {
  SIGNUP_FIELDS,
  signupFormSchema,
  fieldStateSchema,
} from "~/lib/signup-fields";
import { getSignupSettings } from "~/server/program/signup-fields";
import { profilePolicySchema } from "~/lib/profile-policy";
import { getProfilePolicy } from "~/server/program/profile-policy";

const featureKey = z.enum([
  "CREW",
  "DISCIPLINE",
  "MEETINGS",
  "INTERVIEWS",
  "SERVICE_HOURS",
  "QUARTER_SYSTEM",
  "VIEWER_SIGNUP",
  "EMAIL_2FA",
]);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Preview link must use http:// or https://.",
  });

/**
 * Program configuration: the optional-module feature flags. Effective flags are public (any surface
 * can hide a disabled module); staging changes is HEAD-only and takes effect at the next refresh.
 */
export const programRouter = createTRPCRouter({
  profilePolicy: publicProcedure.query(async ({ ctx }) => ({
    ...(await getProfilePolicy(ctx.db)),
    currentSchoolYear: (await ctx.db.term.findFirst({ where: { active: true }, select: { schoolYear: true } }))?.schoolYear ?? null,
  })),
  profilePolicySettings: adminProcedure.query(async ({ ctx }) => ({
    ...(await getProfilePolicy(ctx.db)),
    canEdit: ctx.session.role === "HEAD" || ctx.session.role === "ADMIN",
  })),
  setProfilePolicy: adminOnlyProcedure
    .input(profilePolicySchema.extend({ expectedPolicy: profilePolicySchema }))
    .mutation(({ ctx, input }) => inTransaction(ctx.db, async (tx) => {
      // Compare the complete policy under one lock so stale admin tabs cannot overwrite it.
      await lockEntity(tx, "program:profile-policy");
      const before = await getProfilePolicy(tx);
      if (JSON.stringify(before) !== JSON.stringify(input.expectedPolicy))
        throw new TRPCError({ code: "CONFLICT", message: "PROFILE_POLICY_CHANGED" });
      const after = { requireLatinNames: input.requireLatinNames, offeredGrades: input.offeredGrades };
      await tx.programSettings.upsert({ where: { id: "program" }, create: { id: "program", ...after }, update: after });
      await tx.auditLog.create({ data: {
        userId: ctx.session.user.id, userName: ctx.session.user.name,
        entity: "ProgramSettings", entityId: "program", operation: "program.setProfilePolicy",
        action: "Changed primary name and grade policy", details: { before, after, existingRecordsPreserved: true },
      } });
      return after;
    })),
  // Read-only management access; the mutation below never queues coordinator proposals.
  signupFieldSettings: adminProcedure.query(async ({ ctx }) => ({
    fields: await getSignupSettings(ctx.db),
    canEdit: ctx.session.role === "HEAD",
    secondaryEmailBindingEnabled:
      (await ctx.db.programSettings.findUnique({ where: { id: "program" } }))
        ?.secondaryEmailBindingEnabled ?? true,
  })),
  setSignupField: headProcedure
    .input(
      z
        .object({
          form: signupFormSchema,
          field: z.string(),
          state: fieldStateSchema,
          expectedState: fieldStateSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const field = SIGNUP_FIELDS[input.form].find(
          (field) => field.key === input.field,
        );
        if (!field || field.locked)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This field is locked or does not exist.",
          });
        await lockEntity(tx, "signup-fields");
        const fields = await getSignupSettings(tx);
        const before = fields[input.form][input.field];
        if (before !== input.expectedState)
          throw new TRPCError({
            code: "CONFLICT",
            message: "The field changed. Reload settings and try again.",
          });
        fields[input.form][input.field] = input.state;
        await tx.programSettings.upsert({
          where: { id: "program" },
          create: { id: "program", signupFields: fields },
          update: { signupFields: fields },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            entity: "ProgramSettings",
            entityId: "program",
            operation: "program.setSignupField",
            action: "Changed signup field",
            details: { ...input, before, existingSubmissionsPreserved: true },
          },
        });
        return { ok: true };
      }),
    ),
  emailNotificationSettings: adminProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.programSettings.findUnique({
      where: { id: "program" },
    });
    const failed = await ctx.db.emailDelivery.count({
      where: { status: "FAILED" },
    });
    return {
      enabled: settings?.emailNotificationsEnabled ?? false,
      secondaryEmailBindingEnabled:
        settings?.secondaryEmailBindingEnabled ?? true,
      canEdit: ["HEAD", "ADMIN"].includes(ctx.session.role),
      deliveryAvailable: isEmailDeliveryAvailable(),
      failed,
    };
  }),
  setEmailNotifications: adminOnlyProcedure
    .input(z.object({ enabled: z.boolean(), expectedEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "email-notifications-setting");
        const settings = await tx.programSettings.findUnique({
          where: { id: "program" },
        });
        if (
          (settings?.emailNotificationsEnabled ?? false) !==
          input.expectedEnabled
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "The setting changed. Reload and try again.",
          });
        if (input.enabled && !isEmailDeliveryAvailable())
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Configure email delivery before enabling notifications.",
          });
        await tx.programSettings.upsert({
          where: { id: "program" },
          create: { id: "program", emailNotificationsEnabled: input.enabled },
          update: { emailNotificationsEnabled: input.enabled },
        });
        // Drop only optional backlog on disable; mandatory security alerts must still be delivered.
        if (!input.enabled)
          await tx.emailDelivery.updateMany({
            where: { status: "PENDING", category: { not: "security" } },
            data: { status: "SKIPPED", completedAt: new Date() },
          });
        return { ok: true };
      }),
    ),
  // Independent immediate availability setting; never a coordinator proposal.
  setSecondaryEmailBinding: adminOnlyProcedure
    .input(z.object({ enabled: z.boolean(), expectedEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "secondary-email-binding-setting");
        const settings = await tx.programSettings.findUnique({
          where: { id: "program" },
        });
        if (
          (settings?.secondaryEmailBindingEnabled ?? true) !==
          input.expectedEnabled
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "The setting changed. Reload and try again.",
          });
        await tx.programSettings.upsert({
          where: { id: "program" },
          create: {
            id: "program",
            secondaryEmailBindingEnabled: input.enabled,
          },
          update: { secondaryEmailBindingEnabled: input.enabled },
        });
        // Disabling preserves owned addresses, pending state and all authentication flows.
        return { ok: true };
      }),
    ),
  timeZoneSettings: adminProcedure.query(async ({ ctx }) => {
    const timeZone = await getProgramTimeZone(ctx.db);
    return {
      timeZone,
      timeZoneOptions: programTimeZoneOptions(timeZone),
      canEdit: ctx.session.role === "HEAD" || ctx.session.role === "ADMIN",
    };
  }),
  // Program configuration requires HEAD/ADMIN directly; coordinators cannot queue this change.
  setTimeZone: adminOnlyProcedure
    .input(
      z.object({
        timeZone: z
          .string()
          .max(100)
          .refine(isProgramTimeZone, "Choose a valid IANA time zone."),
        expectedTimeZone: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program-timezone");
        const previous = await getProgramTimeZone(tx);
        if (previous !== input.expectedTimeZone)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The program time zone changed. Reload and review the latest setting.",
          });
        if (previous === input.timeZone) return { timeZone: previous };
        await tx.programSettings.upsert({
          where: { id: "program" },
          create: { id: "program", timeZone: input.timeZone },
          update: { timeZone: input.timeZone },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            userName: ctx.session.user.name,
            entity: "ProgramSettings",
            entityId: "program",
            operation: "program.setTimeZone",
            action: "Changed program time zone",
            details: {
              before: previous,
              after: input.timeZone,
              weeklyClockTimesPreserved: true,
              storedTimestampsPreserved: true,
            },
          },
        });
        return { timeZone: input.timeZone };
      }),
    ),
  /** Effective on/off for every optional module (missing row = on). Public so the landing page and
   *  public signup forms can hide a disabled module. */
  features: publicProcedure.query(async ({ ctx }) => ({
    ...(await getFeatures(ctx.db)),
    EMAIL_DELIVERY_AVAILABLE: isEmailDeliveryAvailable(),
  })),

  /** Immediate, independent intake settings; serialize with submissions and period refresh. */
  setSignupWindow: adminOnlyProcedure
    .input(
      z
        .object({
          audience: z.enum(["tutor", "tutee"]).default("tutee"),
          expectedTermId: z.string().optional(),
          enabled: z.boolean().optional(),
          opensAt: z.date().nullable(),
          closesAt: z.date().nullable().optional(),
          previewUrl: httpUrl.nullable(),
        })
        .superRefine((value, ctx) => {
          if (
            value.opensAt &&
            value.closesAt &&
            value.closesAt <= value.opensAt
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["closesAt"],
              message: "Closing time must be after opening time.",
            });
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await inTransaction(ctx.db, async (tx) => {
        await lockEntity(tx, "program:period");
        const active = await tx.term.findFirst({
          where: { active: true },
          orderBy: { createdAt: "desc" },
        });
        if (!active)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Create an active program period first.",
          });
        if (input.expectedTermId && active.id !== input.expectedTermId)
          throw new TRPCError({
            code: "CONFLICT",
            message: "The program period changed. Reload before saving.",
          });
        const tutor = input.audience === "tutor";
        const closesAt =
          input.closesAt === undefined
            ? tutor
              ? active.tutorSignupClosesAt
              : active.signupClosesAt
            : input.closesAt;
        if (input.opensAt && closesAt && closesAt <= input.opensAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Closing time must be after opening time.",
          });
        return tx.term.update({
          where: { id: active.id },
          data: tutor
            ? {
                tutorSignupEnabled: input.enabled,
                tutorSignupOpensAt: input.opensAt,
                tutorSignupClosesAt: input.closesAt,
                tutorSignupPreviewUrl: input.previewUrl,
              }
            : {
                signupEnabled: input.enabled,
                signupOpensAt: input.opensAt,
                signupClosesAt: input.closesAt,
                signupPreviewUrl: input.previewUrl,
              },
        });
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Updated ${input.audience} recruitment window`,
        entity: "Term",
        entityId: updated.id,
      });
      return updated;
    }),

  /** Current + staged (pending) state for the Program UI, plus whether the caller may edit (HEAD). */
  featureSettings: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.programFeature.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      canEdit: ctx.session.role === "HEAD",
      features: FEATURE_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          enabled: row?.enabled ?? DEFAULT_FEATURES[key],
          pending: row?.pendingEnabled ?? null,
        };
      }),
    };
  }),

  /** Stage a feature change (HEAD only). It activates at the next program refresh. Setting the
   *  target back to the current effective value clears any pending change. */
  setFeaturePending: headProcedure
    .input(z.object({ key: featureKey, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (
        input.key === "EMAIL_2FA" &&
        input.enabled &&
        !isEmailDeliveryAvailable()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Configure SMTP before enabling email two-factor authentication.",
        });
      }
      const existing = await ctx.db.programFeature.findUnique({
        where: { key: input.key },
        select: { enabled: true },
      });
      const current = existing?.enabled ?? DEFAULT_FEATURES[input.key];
      const pendingEnabled = input.enabled === current ? null : input.enabled;
      await ctx.db.programFeature.upsert({
        where: { key: input.key },
        update: { pendingEnabled, updatedByName: ctx.session.user.name },
        create: {
          key: input.key,
          enabled: current,
          pendingEnabled,
          updatedByName: ctx.session.user.name,
        },
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Staged ${input.key} ${input.enabled ? "on" : "off"} for next refresh`,
        entity: "ProgramFeature",
        entityId: input.key,
      });
      return { ok: true };
    }),
});
