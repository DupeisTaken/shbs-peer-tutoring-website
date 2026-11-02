import { z } from "zod";
import { planningTimeInput } from "~/lib/session-planning";
import {
  createTRPCRouter,
  protectedProcedure,
  activeTutorProcedure,
} from "../trpc";
import {
  readSessionAgenda,
  suggestSessionTime,
  proposeSession,
  respondSession,
  requestSeparateSession,
  formalizeSeparateSessions,
} from "~/server/session-planning";
import {
  sessionCalendarStatus,
  rotateSessionCalendarToken,
  revokeSessionCalendarTokens,
} from "~/server/session-planning-calendar";
import { retrySessionNotice } from "~/server/session-planning-delivery";

const versioned = z.object({
  expectedVersion: z.number().int().positive(),
  clientKey: z.string().uuid(),
});
const requestInput = versioned.extend({ requestId: z.string().min(1) });
const timeInput = planningTimeInput.extend({
  cohortId: z.string().min(1),
  ...versioned.shape,
});
export const sessionPlanningRouter = createTRPCRouter({
  calendarStatus: protectedProcedure.query(({ ctx }) =>
    sessionCalendarStatus(ctx.db, ctx.session.user.id),
  ),
  rotateCalendar: protectedProcedure.mutation(({ ctx }) =>
    rotateSessionCalendarToken(ctx.db, ctx.session.user.id),
  ),
  revokeCalendar: protectedProcedure.mutation(({ ctx }) =>
    revokeSessionCalendarTokens(ctx.db, ctx.session.user.id),
  ),
  retryNotice: protectedProcedure
    .input(z.object({ noticeId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      retrySessionNotice(ctx.db, input.noticeId, ctx.session.user.id),
    ),
  agenda: protectedProcedure
    .input(z.object({ role: z.enum(["tutor", "tutee"]) }))
    .query(({ ctx, input }) =>
      readSessionAgenda(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input.role,
      ),
    ),
  suggest: protectedProcedure
    .input(timeInput)
    .mutation(({ ctx, input }) =>
      suggestSessionTime(ctx.db, { id: ctx.session.user.id }, input),
    ),
  propose: activeTutorProcedure
    .input(
      timeInput.extend({
        scope: z.enum(["ONE", "ALL"]),
        tuteeId: z.string().optional(),
        kind: z.enum(["RESCHEDULE", "EXTRA"]),
        suggestionId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      proposeSession(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
  respond: protectedProcedure
    .input(
      requestInput.extend({
        offerId: z.string().min(1),
        decision: z.enum(["ACCEPT", "REJECT"]),
        alternative: planningTimeInput.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      respondSession(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
  requestSplit: protectedProcedure
    .input(requestInput)
    .mutation(({ ctx, input }) =>
      requestSeparateSession(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
  formalizeSplit: activeTutorProcedure
    .input(requestInput)
    .mutation(({ ctx, input }) =>
      formalizeSeparateSessions(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
});
