import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import { localizedPolicy } from "~/server/policy";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  surveyInput,
  surveyToken,
  submitSurvey,
  resendSurvey,
  inspectSurvey,
  confirmSurvey,
  surveyLimit,
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
    .input(surveyInput)
    .mutation(({ ctx, input }) => {
      surveyLimit(`ip:${ctx.headers.get("x-forwarded-for") ?? "local"}`, 1000);
      return submitSurvey(ctx.db, input);
    }),
  surveyPolicy: publicProcedure
    .input(z.object({ locale: z.string() }))
    .query(async ({ ctx, input }) => {
      const policy = await currentPolicy(ctx.db, "tutee-policy");
      const document =
        policy.documents.find((d) => d.locale === input.locale) ??
        policy.documents.find((d) => d.locale === "en")!;
      return { ...document, revision: policy.revision };
    }),
  submitSurvey: publicProcedure
    .input(surveyInput)
    .mutation(({ ctx, input }) => {
      surveyLimit(`ip:${ctx.headers.get("x-forwarded-for") ?? "local"}`, 1000);
      return submitSurvey(ctx.db, input);
    }),
  resendSurvey: publicProcedure
    .input(
      z.object({
        email: z
          .string()
          .trim()
          .email()
          .transform((v) => v.toLowerCase()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      surveyLimit(`ip:${ctx.headers.get("x-forwarded-for") ?? "local"}`, 1000);
      return { emailSent: await resendSurvey(ctx.db, input.email) };
    }),
  inspectSurvey: publicProcedure
    .input(z.object({ token: surveyToken }))
    .query(({ ctx, input }) => inspectSurvey(ctx.db, input.token)),
  confirmSurvey: publicProcedure
    .input(
      z.object({
        token: surveyToken,
        password: z.string().min(8).max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      surveyLimit(
        `confirm:${ctx.headers.get("x-forwarded-for") ?? "local"}`,
        1000,
      );
      return confirmSurvey(ctx.db, input.token, input.password);
    }),
  pendingSurveys: adminProcedure.query(({ ctx }) => pendingSurveys(ctx.db)),

  /** Options needed to render the public signup form: active subjects + active time slots. */
  signupOptions: publicProcedure.query(async ({ ctx }) => {
    const [subjects, slots] = await Promise.all([
      ctx.db.subject.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
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
    ]);
    return { subjects, slots };
  }),

  /**
   * The tutee policy/handbook (admin-editable) shown in the signup agreement modal, in the
   * requested UI locale. Falls back to the English version when that language isn't translated.
   */
  policy: publicProcedure
    .input(z.object({ locale: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      localizedPolicy(ctx.db, "tutee-policy", input?.locale),
    ),
});
