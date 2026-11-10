import { z } from "zod";
import { planningTimeInput } from "~/lib/session-planning";
import {
  createTRPCRouter,
  protectedProcedure,
  activeTutorProcedure,
} from "../trpc";
import {
  readSessionAgenda,
  readSessionAgendaHistory,
  suggestSessionTime,
  proposeSession,
  respondSession,
  requestSeparateSession,
  formalizeSeparateSessions,
  previewSessionLocation,
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
  previewLocation: protectedProcedure
    .input(
      planningTimeInput.extend({
        mode: z.enum(["propose", "suggest", "alternative"]),
        cohortId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        scope: z.enum(["ONE", "ALL"]),
        tuteeId: z.string().optional(),
        kind: z.enum(["RESCHEDULE", "EXTRA"]),
        pausedOnly: z.boolean().optional(),
        requestId: z.string().optional(),
        requestVersion: z.number().int().positive().optional(),
        offerId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      previewSessionLocation(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
  history: protectedProcedure
    .input(
      z.object({
        role: z.enum(["tutor", "tutee"]),
        view: z.enum(["history", "all"]).optional(),
        cursor: z
          .object({ startsAt: z.date(), id: z.string().min(1) })
          .optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      readSessionAgendaHistory(
        ctx.db,
        { id: ctx.session.user.id, tutorId: ctx.session.tutorId },
        input,
      ),
    ),
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
        pausedOnly: z.boolean().optional(),
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
