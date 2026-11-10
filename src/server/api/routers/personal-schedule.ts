import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "../../../../generated/prisma";

import { isInterviewChairRole } from "~/lib/interview-chair";
import { isOpenInterview } from "~/lib/interview-order";
import {
  canExcusePersonalMeeting,
  personalScheduleWindow,
  personalScheduleReadInput,
  personalSchedulePage,
} from "~/lib/personal-schedule";
import { activeTutorProcedure, createTRPCRouter } from "~/server/api/trpc";
import {
  meetingPeriodContext,
  recordedMeetingPeriod,
} from "~/server/meeting-periods";
import { assertFeatureEnabled, getFeatures } from "~/server/program/features";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { selfMeetingExcuseIds } from "~/server/meeting-excuse";

/** Independent reads keep one unavailable source from hiding the other sources.
 * Summaries deliberately omit the evidence/private fields owned by detail views. */
export const personalScheduleRouter = createTRPCRouter({
  interviews: activeTutorProcedure
    .input(personalScheduleReadInput)
    .query(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "INTERVIEWS");
      const now = new Date();
      const { window, startsAt, endsBefore } = personalScheduleWindow(
        now,
        await getProgramTimeZone(ctx.db),
      );
      const select = {
        isHead: true,
        application: {
          select: {
            id: true,
            name: true,
            status: true,
            interviewAt: true,
            interviewCompletedAt: true,
            createdAt: true,
            votes: {
              where: { tutorId: ctx.session.tutorId },
              select: { tutorId: true },
            },
            subjectIntents: { select: { subject: { select: { name: true } } } },
          },
        },
      } as const;
      const ascending = input.view === "upcoming";
      // Elapsed time and service-hour completion do not close interview work.
      // Retain overdue open events before pagination, including older weeks;
      // only an applied terminal outcome moves a dated interview into History.
      const eventScope: Prisma.TutorApplicationWhereInput =
        input.view === "upcoming"
          ? {
              status: { in: ["PENDING", "INTERVIEW"] },
              OR: [
                { interviewAt: { lt: now } },
                {
                  interviewAt: {
                    gte: now > startsAt ? now : startsAt,
                    lt: endsBefore,
                  },
                },
              ],
            }
          : input.view === "history"
            ? {
                interviewAt: { not: null },
                status: { in: ["ACCEPTED", "REJECTED", "RECALLED"] },
              }
            : { interviewAt: { not: null } };
      const eventCursor: Prisma.TutorApplicationWhereInput = input.cursor
        ? {
            OR: [
              {
                interviewAt: ascending
                  ? { gt: input.cursor.at }
                  : { lt: input.cursor.at },
              },
              {
                interviewAt: input.cursor.at,
                id: ascending
                  ? { gt: input.cursor.id }
                  : { lt: input.cursor.id },
              },
            ],
          }
        : {};
      const taskScope: Prisma.TutorApplicationWhereInput = {
        OR: [
          {
            status: { in: ["PENDING", "INTERVIEW"] },
            OR: [{ interviewAt: null }, { interviewAt: { lt: now } }],
          },
          {
            status: { in: ["ACCEPTED", "REJECTED"] },
            interviewCompletedAt: null,
          },
        ],
      };
      const taskCursor: Prisma.TutorApplicationWhereInput = input.taskCursor
        ? {
            OR: [
              { createdAt: { lt: input.taskCursor.at } },
              {
                createdAt: input.taskCursor.at,
                id: { lt: input.taskCursor.id },
              },
            ],
          }
        : {};
      const [assignments, taskAssignments, features] = await Promise.all([
        ctx.db.interviewAssignment.findMany({
          where: {
            tutorId: ctx.session.tutorId,
            application: {
              invalidatedAt: null,
              AND: [eventScope, eventCursor],
            },
          },
          orderBy: [
            { application: { interviewAt: ascending ? "asc" : "desc" } },
            { applicationId: ascending ? "asc" : "desc" },
          ],
          take: input.limit + 1,
          select,
        }),
        input.includeSummary
          ? ctx.db.interviewAssignment.findMany({
              where: {
                tutorId: ctx.session.tutorId,
                application: {
                  invalidatedAt: null,
                  AND: [taskScope, taskCursor],
                },
              },
              orderBy: [
                { application: { createdAt: "desc" } },
                { applicationId: "desc" },
              ],
              take: input.limit + 1,
              select,
            })
          : Promise.resolve([]),
        input.includeSummary ? getFeatures(ctx.db) : Promise.resolve(null),
      ]);
      const summarize = ({
        isHead,
        application,
      }: Prisma.InterviewAssignmentGetPayload<{ select: typeof select }>) => ({
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
        ownVoteRecorded: application.votes.length > 0,
        sortAt: application.createdAt,
        startsAt: application.interviewAt,
      });
      const events = personalSchedulePage(assignments, input.limit, (row) => ({
        at: row.application.interviewAt!,
        id: row.application.id,
      }));
      const tasks = personalSchedulePage(
        taskAssignments,
        input.limit,
        (row) => ({ at: row.application.createdAt, id: row.application.id }),
      );
      const canChair = isInterviewChairRole(ctx.session.role);
      const canReviewCompletion =
        ["ADMIN", "HEAD", "COORDINATOR"].includes(ctx.session.role) &&
        !!features?.SERVICE_HOURS;
      // This read-only readiness projection mirrors the source's current panel,
      // vote and qualification prerequisites. It takes no writer locks, selects no
      // private vote/comment evidence, and every eventual write rechecks authority.
      // Filtering before LIMIT makes the top three independent of event/task pages.
      const actionable = input.includeSummary
        ? await ctx.db.$queryRaw<
            {
              id: string;
              name: string;
              isHead: boolean;
              canChair: boolean;
              action: "vote" | "schedule" | "decision" | "completion";
              sortAt: Date;
              startsAt: Date | null;
            }[]
          >`
      WITH pending AS (
        SELECT r.payload #>> '{json,applicationId}' AS id,
          bool_or(r.operation = 'tutor.decideInterview') AS decision,
          bool_or(r.operation = 'interviewManagement.complete') AS completion
        FROM "ApprovalRequest" r
          JOIN "InterviewAssignment" p ON p."applicationId" = r.payload #>> '{json,applicationId}' AND p."tutorId" = ${ctx.session.tutorId}
        WHERE r.state = 'PENDING' AND r.operation IN ('tutor.decideInterview', 'interviewManagement.complete')
        GROUP BY r.payload #>> '{json,applicationId}'
      ), owned AS (
        SELECT a.id, a.name, a.status, a.type, a."createdAt" AS "sortAt",
          a."interviewAt" AS "startsAt", a."interviewCompletedAt", ia."isHead",
          (ia."isHead" AND ${canChair}) AS "canChair",
          EXISTS (SELECT 1 FROM "InterviewVote" v WHERE v."applicationId" = a.id AND v."tutorId" = ${ctx.session.tutorId}) AS "ownVoteRecorded",
          (
            (SELECT count(*) FROM "InterviewAssignment" p WHERE p."applicationId" = a.id) >= 3
            AND NOT EXISTS (
              SELECT 1 FROM "InterviewAssignment" p JOIN "Tutor" t ON t.id = p."tutorId"
                LEFT JOIN "User" u ON u."tutorId" = t.id
              WHERE p."applicationId" = a.id AND (t.status <> 'ACTIVE' OR u.id IS NULL OR u."suspendedAt" IS NOT NULL)
            )
            AND EXISTS (
              SELECT 1 FROM "InterviewAssignment" p JOIN "User" u ON u."tutorId" = p."tutorId"
              WHERE p."applicationId" = a.id AND p."isHead" AND u.role IN ('ADMIN', 'HEAD')
            )
            AND EXISTS (
              SELECT 1 FROM "QualificationGrant" g
                JOIN "TutorQualification" q ON q."tutorId" = g."tutorId" AND q."subjectId" = g."sourceSubjectId"
                JOIN "InterviewAssignment" p ON p."tutorId" = g."tutorId" AND p."applicationId" = a.id
                JOIN "ApplicationSubjectIntent" s ON s."subjectId" = g."subjectId" AND s."applicationId" = a.id
              WHERE q.status = 'APPROVED'
            )
          ) AS "panelReady",
          NOT EXISTS (
            SELECT 1 FROM "InterviewAssignment" p WHERE p."applicationId" = a.id AND NOT EXISTS (
              SELECT 1 FROM "InterviewVote" v WHERE v."applicationId" = a.id AND v."tutorId" = p."tutorId"
            )
          ) AS "allVoted",
          COALESCE(pending.decision, false) AS "pendingDecision",
          COALESCE(pending.completion, false) AS "pendingCompletion"
        FROM "TutorApplication" a JOIN "InterviewAssignment" ia ON ia."applicationId" = a.id
          LEFT JOIN pending ON pending.id = a.id
        WHERE ia."tutorId" = ${ctx.session.tutorId} AND a."invalidatedAt" IS NULL AND a.status <> 'RECALLED'
      ), work AS (
        SELECT owned.*, CASE
          WHEN "canChair" AND status IN ('PENDING', 'INTERVIEW') AND "startsAt" IS NULL THEN 'schedule'
          WHEN status = 'INTERVIEW' AND NOT "ownVoteRecorded" THEN 'vote'
          WHEN "canChair" AND type = 'INITIAL' AND status = 'INTERVIEW' AND "panelReady" AND "allVoted" AND NOT "pendingDecision" THEN 'decision'
          WHEN ${canReviewCompletion} AND "interviewCompletedAt" IS NULL AND (status IN ('ACCEPTED', 'REJECTED') OR "startsAt" < ${now}) AND "panelReady" AND NOT "pendingCompletion" THEN 'completion'
          ELSE NULL END AS action
        FROM owned
      )
      SELECT id, name, "isHead", "canChair", action, "sortAt", "startsAt"
      FROM work WHERE action IS NOT NULL ORDER BY "sortAt" DESC, id DESC LIMIT 4
    `
        : [];
      const attention = personalSchedulePage(actionable, 3, (row) => ({
        at: row.sortAt,
        id: row.id,
      }));
      return {
        window,
        appointments: events.items.map((row) => ({
          ...summarize(row),
          interviewAt: row.application.interviewAt!,
          sortAt: row.application.interviewAt!,
          startsAt: row.application.interviewAt!,
        })),
        pageInfo: events.pageInfo,
        // Completion evidence never closes voting/decision work. Conversely, a
        // terminal decision can still have the source view's completion follow-up.
        tasks: tasks.items.flatMap((assignment) => {
          const row = summarize(assignment);
          const reason = !isOpenInterview(row)
            ? ("completionNeeded" as const)
            : !row.interviewAt
              ? ("unscheduled" as const)
              : row.interviewAt < now
                ? ("pastOpen" as const)
                : null;
          return reason ? [{ ...row, reason }] : [];
        }),
        taskPageInfo: tasks.pageInfo,
        actionableTasks: attention.items,
        hasMoreActionableTasks: attention.pageInfo.hasMore,
      };
    }),

  meetings: activeTutorProcedure
    .input(personalScheduleReadInput)
    .query(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "MEETINGS");
      const now = new Date();
      const { window, startsAt, endsBefore } = personalScheduleWindow(
        now,
        await getProgramTimeZone(ctx.db),
      );
      const { current } = await meetingPeriodContext(ctx.db);
      const eligibility: Prisma.TutorMeetingWhereInput = {
        OR: [
          { attendances: { some: { tutorId: ctx.session.tutorId } } },
          { date: { gte: now } },
          ...(current ? [recordedMeetingPeriod(current.key)] : []),
        ],
      };
      const ascending = input.view === "upcoming";
      const cursor: Prisma.TutorMeetingWhereInput = input.cursor
        ? {
            OR: [
              {
                date: ascending
                  ? { gt: input.cursor.at }
                  : { lt: input.cursor.at },
              },
              {
                date: input.cursor.at,
                id: ascending
                  ? { gt: input.cursor.id }
                  : { lt: input.cursor.id },
              },
            ],
          }
        : {};
      const select = {
        id: true,
        title: true,
        date: true,
        attendances: {
          where: { tutorId: ctx.session.tutorId },
          select: { id: true, status: true, excusedAt: true },
        },
      } as const;
      const [meetings, actionable] = await Promise.all([
        ctx.db.tutorMeeting.findMany({
          where: {
            AND: [eligibility, cursor],
            ...(input.view === "upcoming"
              ? {
                  date: {
                    gte: now > startsAt ? now : startsAt,
                    lt: endsBefore,
                  },
                }
              : input.view === "history"
                ? { date: { lt: now } }
                : {}),
          },
          orderBy: [
            { date: ascending ? "asc" : "desc" },
            { id: ascending ? "asc" : "desc" },
          ],
          take: input.limit + 1,
          select,
        }),
        input.includeSummary
          ? ctx.db.tutorMeeting.findMany({
              where: {
                date: {
                  gte: new Date(now.getTime() + 60 * 60_000),
                  lt: endsBefore,
                },
                attendances: { none: { tutorId: ctx.session.tutorId } },
              },
              orderBy: [{ date: "asc" }, { id: "asc" }],
              take: 4,
              select: { id: true, title: true, date: true },
            })
          : Promise.resolve([]),
      ]);
      const events = personalSchedulePage(meetings, input.limit, (row) => ({
        at: row.date,
        id: row.id,
      }));
      const attention = personalSchedulePage(actionable, 3, (row) => ({
        at: row.date,
        id: row.id,
      }));
      const selfExcuses = await selfMeetingExcuseIds(
        ctx.db,
        meetings.flatMap((meeting) => meeting.attendances),
      );
      return {
        window,
        appointments: events.items.map(({ attendances, ...meeting }) => {
          const own = attendances[0];
          const excused = !!own && selfExcuses.has(own.id);
          return {
            ...meeting,
            status: own?.status ?? null,
            excused,
            upcoming: meeting.date >= now,
            canExcuse:
              (!own || excused) && canExcusePersonalMeeting(meeting.date, now),
            startsAt: meeting.date,
            sortAt: meeting.date,
          };
        }),
        pageInfo: events.pageInfo,
        tasks: [],
        taskPageInfo: { hasMore: false, nextCursor: null },
        actionableTasks: attention.items.map(({ date, ...meeting }) => ({
          ...meeting,
          action: "reviewMeeting" as const,
          sortAt: date,
          startsAt: date,
        })),
        hasMoreActionableTasks: attention.pageInfo.hasMore,
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
            select: { id: true, status: true, reason: true, excusedAt: true },
          },
        },
      });
      if (!meeting)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Meeting not found.",
        });
      const own = meeting.attendances[0];
      const selfExcuses = await selfMeetingExcuseIds(ctx.db, meeting.attendances);
      const excused = !!own && selfExcuses.has(own.id);
      return {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        status: own?.status ?? null,
        reason: own?.reason ?? null,
        excused,
        upcoming: meeting.date >= now,
        canExcuse:
          (!own || excused) && canExcusePersonalMeeting(meeting.date, now),
      };
    }),
});
