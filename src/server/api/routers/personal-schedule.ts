import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isInterviewChairRole } from "~/lib/interview-chair";
import { isOpenInterview } from "~/lib/interview-order";
import {
  canExcusePersonalMeeting,
  personalScheduleWindow,
} from "~/lib/personal-schedule";
import { activeTutorProcedure, createTRPCRouter } from "~/server/api/trpc";
import {
  meetingPeriodContext,
  recordedMeetingPeriod,
} from "~/server/meeting-periods";
import { assertFeatureEnabled } from "~/server/program/features";
import { getProgramTimeZone } from "~/server/program/time-zone";

/** Independent reads keep one unavailable source from hiding the other sources.
 * Summaries deliberately omit the evidence/private fields owned by detail views. */
export const personalScheduleRouter = createTRPCRouter({
  interviews: activeTutorProcedure.query(async ({ ctx }) => {
    await assertFeatureEnabled(ctx.db, "INTERVIEWS");
    const now = new Date();
    const { window, startsAt, endsBefore } = personalScheduleWindow(
      now,
      await getProgramTimeZone(ctx.db),
    );
    const assignments = await ctx.db.interviewAssignment.findMany({
      where: {
        tutorId: ctx.session.tutorId,
        application: {
          invalidatedAt: null,
          OR: [
            { status: { in: ["PENDING", "INTERVIEW"] } },
            {
              status: { in: ["ACCEPTED", "REJECTED"] },
              interviewCompletedAt: null,
            },
          ],
        },
      },
      orderBy: [
        { application: { interviewAt: "asc" } },
        { applicationId: "asc" },
      ],
      select: {
        isHead: true,
        application: {
          select: {
            id: true,
            name: true,
            status: true,
            interviewAt: true,
            interviewCompletedAt: true,
            subjectIntents: { select: { subject: { select: { name: true } } } },
          },
        },
      },
    });
    const rows = assignments.map(({ isHead, application }) => ({
      id: application.id,
      name: application.name,
      subjects: [
        ...new Set(
          application.subjectIntents.map(({ subject }) => subject.name),
        ),
      ],
      interviewAt: application.interviewAt,
      isHead,
      canChair: isHead && isInterviewChairRole(ctx.session.role),
      status: application.status,
      completionState: application.interviewCompletedAt
        ? ("completed" as const)
        : ("pending" as const),
    }));
    return {
      window,
      appointments: rows.flatMap((row) =>
        isOpenInterview(row) &&
        row.interviewAt &&
        row.interviewAt >= startsAt &&
        row.interviewAt < endsBefore
          ? [{ ...row, interviewAt: row.interviewAt }]
          : [],
      ),
      // Completion evidence never closes voting/decision work. Conversely, a
      // terminal decision can still have the source view's completion follow-up.
      tasks: rows.flatMap((row) => {
        const reason = !isOpenInterview(row)
          ? ("completionNeeded" as const)
          : !row.interviewAt
            ? ("unscheduled" as const)
            : row.interviewAt < now
              ? ("pastOpen" as const)
              : null;
        return reason ? [{ ...row, reason }] : [];
      }),
    };
  }),

  meetings: activeTutorProcedure.query(async ({ ctx }) => {
    await assertFeatureEnabled(ctx.db, "MEETINGS");
    const now = new Date();
    const { window, startsAt, endsBefore } = personalScheduleWindow(
      now,
      await getProgramTimeZone(ctx.db),
    );
    const { current } = await meetingPeriodContext(ctx.db);
    const meetings = await ctx.db.tutorMeeting.findMany({
      where: {
        date: { gte: startsAt, lt: endsBefore },
        OR: [
          { attendances: { some: { tutorId: ctx.session.tutorId } } },
          { date: { gte: now } },
          ...(current ? [recordedMeetingPeriod(current.key)] : []),
        ],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        date: true,
        attendances: {
          where: { tutorId: ctx.session.tutorId },
          select: { status: true, excusedAt: true },
        },
      },
    });
    return {
      window,
      appointments: meetings.map(({ attendances, ...meeting }) => ({
        ...meeting,
        status: attendances[0]?.status ?? null,
        excused:
          attendances[0]?.status === "EXCUSED_ABSENT" &&
          attendances[0].excusedAt != null,
        upcoming: meeting.date >= now,
        canExcuse: canExcusePersonalMeeting(meeting.date, now),
      })),
    };
  }),

  /** Resolve by ID only after explicit selection. The same eligibility as
   * tutor.meetingRecords prevents IDs from exposing another tutor's history. */
  meetingDetail: activeTutorProcedure
    .input(z.object({ meetingId: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
      const now = new Date();
      const { current } = await meetingPeriodContext(ctx.db);
      const meeting = await ctx.db.tutorMeeting.findFirst({
        where: {
          id: input.meetingId,
          OR: [
            { attendances: { some: { tutorId: ctx.session.tutorId } } },
            { date: { gte: now } },
            ...(current ? [recordedMeetingPeriod(current.key)] : []),
          ],
        },
        select: {
          id: true,
          title: true,
          date: true,
          attendances: {
            where: { tutorId: ctx.session.tutorId },
            select: { status: true, reason: true, excusedAt: true },
          },
        },
      });
      if (!meeting)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Meeting not found.",
        });
      const own = meeting.attendances[0];
      return {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        status: own?.status ?? null,
        reason: own?.reason ?? null,
        excused: own?.status === "EXCUSED_ABSENT" && own.excusedAt != null,
        upcoming: meeting.date >= now,
        canExcuse: canExcusePersonalMeeting(meeting.date, now),
      };
    }),
});
