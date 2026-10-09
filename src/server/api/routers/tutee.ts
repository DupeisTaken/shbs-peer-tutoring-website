import { continueInEmailedInvitation } from "~/server/auth/legacy-invitation";
import { captchaGrantInput } from "~/lib/captcha";
import { withProtectedSignup } from "~/server/captcha";
import { withSignupAdmission } from "~/server/signup-admission";
import { getRecruitment } from "~/server/program/recruitment";
import { getSignupSettings } from "~/server/program/signup-fields";
import { courseChoices } from "~/server/course-choices";
import { issueSurveyAccountInvitation } from "~/server/auth/account-invitations";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import { localizedPolicy } from "~/server/policy";
import { publicSignupPolicy } from "~/server/policy-acceptance";
import {
  surveyInput,
  surveyToken,
  submitSurvey,
  resendSurvey,
  inspectSurvey,
  pendingSurveys,
} from "~/server/student-survey";

/**
 * Public-facing tutee signup. Anyone (no login) can submit the form; the record is
 * created with status PENDING for an admin to review and assign to a tutor. Subject
 * choices and available time slots are drawn from the admin-managed catalogs.
 */
// A school may share one public IP; keep the network burst allowance generous.
// The separate per-email limiter still constrains repeated requests and email delivery.
export const tuteeRouter = createTRPCRouter({
  // Keep the previous endpoint name without retaining its unverified-account bypass.
  requestSignup: publicProcedure
    .input(surveyInput.extend({ captchaGrant: captchaGrantInput }))
    .mutation(({ ctx, input }) => {
      return withProtectedSignup(
        ctx.db,
        ctx.headers,
        "tutee.submit",
        input.email,
        input.captchaGrant,
        () => submitSurvey(ctx.db, surveyInput.parse(input)),
      );
    }),
  surveyPolicy: publicProcedure
    .input(z.object({ locale: z.string() }))
    .query(async ({ ctx, input }) => {
      return withSignupAdmission(ctx.db, ctx.headers, "read", undefined, () =>
        publicSignupPolicy(ctx.db, "tutee-policy", input.locale),
      );
    }),
  submitSurvey: publicProcedure
    .input(surveyInput.extend({ captchaGrant: captchaGrantInput }))
    .mutation(({ ctx, input }) => {
      return withProtectedSignup(
        ctx.db,
        ctx.headers,
        "tutee.submit",
        input.email,
        input.captchaGrant,
        () => submitSurvey(ctx.db, surveyInput.parse(input)),
      );
    }),
  resendSurvey: publicProcedure
    .input(
      z.object({
        captchaGrant: captchaGrantInput,
        email: z
          .string()
          .trim()
          .email()
          .transform((v) => v.toLowerCase()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withProtectedSignup(
        ctx.db,
        ctx.headers,
        "tutee.resend",
        input.email,
        input.captchaGrant,
        async () => ({ emailSent: await resendSurvey(ctx.db, input.email) }),
      );
    }),
  inspectSurvey: publicProcedure
    .input(z.object({ token: surveyToken }))
    .query(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "complete", input.token, () =>
        inspectSurvey(ctx.db, input.token),
      ),
    ),
  confirmSurvey: publicProcedure
    .input(
      z.object({
        token: surveyToken,
        password: z.string().min(8).max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.token,
        async () => {
          await issueSurveyAccountInvitation(ctx.db, input.token);
          return continueInEmailedInvitation();
        },
      );
    }),
  pendingSurveys: adminProcedure.query(({ ctx }) => pendingSurveys(ctx.db)),

  /** Options needed to render the public signup form: active subjects + active time slots. */
  signupOptions: publicProcedure.query(async ({ ctx }) =>
    withSignupAdmission(ctx.db, ctx.headers, "read", undefined, async () => {
      const [subjects, slots, settings, recruitment] = await Promise.all([
        courseChoices(ctx.db, { active: true }),
        ctx.db.timeSlot.findMany({
          where: { active: true },
          orderBy: [{ dayOfWeek: "asc" }, { startMin: "asc" }],
          select: {
            id: true,
            label: true,
            dayOfWeek: true,
            startMin: true,
            endMin: true,
          },
        }),
        getSignupSettings(ctx.db),
        getRecruitment(ctx.db, "tutee"),
      ]);
      return {
        subjects: subjects.map(({ id, name }) => ({ id, name })),
        slots,
        fields: settings.tutee,
        recruitment,
      };
    }),
  ),

  /**
   * The tutee policy/handbook (admin-editable) shown in the signup agreement modal, in the
   * requested UI locale. Falls back to the English version when that language isn't translated.
   */
  policy: publicProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "read", undefined, () =>
        localizedPolicy(ctx.db, "tutee-policy", input?.locale),
      ),
    ),
});
