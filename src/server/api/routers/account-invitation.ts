import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { withSignupAdmission } from "~/server/signup-admission";
import {
  invitationProfile,
  verifyAccountInvitation,
  inspectAccountInvitation,
  redeemAccountInvitation,
  deliverAccountInvitation,
  enterDisplayedInvitation,
  emailDisplayedInvitation,
  sendInvitationVerification,
} from "~/server/auth/account-invitations";
import { validSurvey, verifySurveyEmail } from "~/server/student-survey";

const id = z.string().min(1).max(128);
const proof = z.string().regex(/^[a-f0-9]{64}$/);

/** Source-specific entry points issue envelopes; the shared redemption API never accepts
 * an arbitrary kind, user ID, membership or source payload from the browser. */
export const accountInvitationRouter = createTRPCRouter({
  enter: publicProcedure
    .input(
      z.object({ code: z.string().min(1).max(30), proof: proof.optional() }),
    )
    .mutation(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "complete", input.code, () =>
        enterDisplayedInvitation(ctx.db, {
          ...input,
          userId: ctx.session?.user.id,
        }),
      ),
    ),
  email: publicProcedure
    .input(z.object({ invitationId: id, proof }))
    .mutation(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "mail", input.invitationId, () =>
        emailDisplayedInvitation(ctx.db, input),
      ),
    ),
  sendVerification: publicProcedure
    .input(
      z.object({
        invitationId: id,
        code: z.string().min(1).max(30),
        email: z.string().trim().email().max(254),
      }),
    )
    .mutation(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "mail", input.email, () =>
        sendInvitationVerification(ctx.db, input),
      ),
    ),
  verifySurvey: publicProcedure
    .input(
      z.object({
        email: z
          .string()
          .trim()
          .email()
          .transform((v) => v.toLowerCase()),
        code: z.string().min(1).max(30),
      }),
    )
    .mutation(({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.email,
        async () => {
          const survey = await verifySurveyEmail(
            ctx.db,
            input.email,
            input.code,
          );
          return deliverAccountInvitation(ctx.db, {
            display: true,
            kind: "TUTEE",
            email: survey.email,
            sourceKey: `tutee:${survey.id}:${survey.tokenHash}`,
            source: { type: "tutee", tokenHash: survey.tokenHash },
          });
        },
      ),
    ),
  verify: publicProcedure
    .input(
      z.object({
        invitationId: id,
        email: z.string().trim().email().max(254),
        code: z.string().min(1).max(30),
      }),
    )
    .mutation(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "complete", input.email, () =>
        verifyAccountInvitation(ctx.db, input),
      ),
    ),
  inspect: publicProcedure
    .input(z.object({ invitationId: id, proof: proof.optional() }))
    .query(({ ctx, input }) =>
      withSignupAdmission(ctx.db, ctx.headers, "read", input.invitationId, () =>
        inspectAccountInvitation(ctx.db, {
          ...input,
          userId: ctx.session?.user.id,
        }),
      ),
    ),
  complete: publicProcedure
    .input(invitationProfile)
    .mutation(({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "complete",
        input.invitationId,
        () => redeemAccountInvitation(ctx.db, input, ctx.session?.user.id),
      ),
    ),
  fromSurvey: publicProcedure
    .input(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ ctx, input }) =>
      withSignupAdmission(
        ctx.db,
        ctx.headers,
        "mail",
        input.token,
        async () => {
          // Opening/scanning the old link remains read-only. This explicit POST proves access
          // to that emailed link and issues the distinct invitation without consuming intake.
          const survey = await validSurvey(ctx.db, input.token);
          return deliverAccountInvitation(ctx.db, {
            display: true,
            kind: "TUTEE",
            email: survey.email,
            sourceKey: `tutee:${survey.id}:${survey.tokenHash}`,
            source: { type: "tutee", tokenHash: survey.tokenHash },
          });
        },
      ),
    ),
});
