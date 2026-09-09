import type { Prisma } from "../../../../generated/prisma";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { validatePanel } from "~/server/interviews";
import { getActivePeriod } from "~/server/period";
import { monthKey } from "~/lib/service-hours";
import { assertFeatureEnabled } from "~/server/program/features";

export const interviewManagementRouter = createTRPCRouter({
  options: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(0).default(0),
          search: z.string().trim().max(100).default(""),
          completion: z.enum(["OPEN", "COMPLETED", "ALL"]).default("OPEN"),
        })
        .default({ page: 0, search: "", completion: "OPEN" }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = 20;
      const where: Prisma.TutorApplicationWhereInput = {
        interviewers: { some: {} },
        ...(input.completion === "OPEN"
          ? { interviewCompletedAt: null }
          : input.completion === "COMPLETED"
            ? { interviewCompletedAt: { not: null } }
            : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { email: { contains: input.search, mode: "insensitive" } },
                {
                  preferredContact: {
                    contains: input.search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      };
      const [tutors, subjects, qualifications, applications, total] =
        await Promise.all([
          ctx.db.tutor.findMany({
            where: { status: "ACTIVE" },
            select: { id: true, englishName: true },
            orderBy: { englishName: "asc" },
          }),
          ctx.db.subject.findMany({
            where: { active: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          ctx.db.tutorQualification.findMany(),
          ctx.db.tutorApplication.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: pageSize,
            skip: input.page * pageSize,
            select: {
              id: true,
              name: true,
              interviewCompletedAt: true,
              interviewDurationMin: true,
              interviewers: {
                select: {
                  tutorId: true,
                  attended: true,
                  tutor: { select: { englishName: true } },
                },
              },
            },
          }),
          ctx.db.tutorApplication.count({ where }),
        ]);
      return {
        tutors,
        subjects,
        qualifications,
        applications: { rows: applications, total, pageSize },
      };
    }),
  qualify: adminProcedure
    .input(
      z.object({
        tutorId: z.string(),
        subjectId: z.string(),
        qualified: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await tx.tutor.findUniqueOrThrow({ where: { id: input.tutorId } });
        await tx.subject.findUniqueOrThrow({ where: { id: input.subjectId } });
        if (input.qualified)
          await tx.tutorQualification.upsert({
            where: {
              tutorId_subjectId: {
                tutorId: input.tutorId,
                subjectId: input.subjectId,
              },
            },
            update: { approvedById: ctx.session.user.id },
            create: {
              tutorId: input.tutorId,
              subjectId: input.subjectId,
              approvedById: ctx.session.user.id,
            },
          });
        else
          await tx.tutorQualification.deleteMany({
            where: { tutorId: input.tutorId, subjectId: input.subjectId },
          });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            entity: "TutorQualification",
            entityId: input.tutorId,
            action: `${input.qualified ? "Confirmed" : "Removed"} subject qualification: ${input.subjectId}`,
          },
        });
        return { ok: true };
      }),
    ),
  complete: adminProcedure
    .input(
      z.object({
        applicationId: z.string(),
        durationMin: z.number().int().min(1).max(480),
        completedAt: z.coerce.date(),
        attendedTutorIds: z.array(z.string()).min(1),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await assertFeatureEnabled(tx, "INTERVIEWS");
        await assertFeatureEnabled(tx, "SERVICE_HOURS");
        await lockEntity(tx, `interview:${input.applicationId}`);
        if (input.completedAt > new Date())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Record completion only after the interview.",
          });
        const before = await tx.tutorApplication.findUniqueOrThrow({
          where: { id: input.applicationId },
          include: { interviewers: true },
        });
        const chair = before.interviewers.find((p) => p.isHead);
        await validatePanel(
          tx,
          input.applicationId,
          before.interviewers.map((p) => p.tutorId),
          chair?.tutorId ?? "",
        );
        if (
          new Set(input.attendedTutorIds).size !==
            input.attendedTutorIds.length ||
          input.attendedTutorIds.some(
            (id) => !before.interviewers.some((p) => p.tutorId === id),
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Attendance must name assigned panelists only.",
          });
        // Original period remains stable when staff later correct duration or attendance.
        const period =
          before.interviewSchoolYear && before.interviewQuarter
            ? {
                schoolYear: before.interviewSchoolYear,
                quarter: before.interviewQuarter,
              }
            : await getActivePeriod(tx);
        await tx.tutorApplication.update({
          where: { id: input.applicationId },
          data: {
            interviewCompletedAt: input.completedAt,
            interviewDurationMin: input.durationMin,
            interviewSchoolYear: period.schoolYear,
            interviewQuarter: period.quarter,
          },
        });
        await tx.interviewAssignment.updateMany({
          where: { applicationId: input.applicationId },
          data: { attended: false },
        });
        await tx.interviewAssignment.updateMany({
          where: {
            applicationId: input.applicationId,
            tutorId: { in: input.attendedTutorIds },
          },
          data: { attended: true },
        });
        await tx.serviceHourAdjustment.deleteMany({
          where: { id: { startsWith: `interview_${input.applicationId}_` } },
        });
        await tx.serviceHourAdjustment.createMany({
          data: input.attendedTutorIds.map((tutorId) => ({
            id: `interview_${input.applicationId}_${tutorId}`,
            tutorId,
            month: monthKey(input.completedAt),
            schoolYear: period.schoolYear,
            quarter: period.quarter,
            type: "EXTRA" as const,
            amount: input.durationMin / 60,
            reason: "Completed interview service",
          })),
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.session.user.id,
            entity: "TutorApplication",
            entityId: input.applicationId,
            action: `Recorded interview hours: ${input.reason}`,
            details: JSON.parse(
              JSON.stringify({ before, after: input }),
            ) as Prisma.InputJsonValue,
          },
        });
        return { ok: true };
      }),
    ),
});
