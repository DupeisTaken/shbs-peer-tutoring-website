import { approveQualification, lockCatalogue } from "~/server/qualifications";
import {
  assertRequestProcessable,
  lockApplicationReview,
} from "~/server/request-invalidity";
import type { Prisma } from "../../../../generated/prisma";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { inTransaction } from "~/server/transactions";
import { validatePanel } from "~/server/interviews";
import { getActivePeriod } from "~/server/period";
import { monthKey } from "~/lib/service-hours";
import { assertFeatureEnabled } from "~/server/program/features";
import { staleConflict } from "~/server/concurrency";
import {
  INTERVIEW_HOURS_REASON,
  interviewCompletionInput,
  interviewHourRows,
  interviewHoursId,
  sameInterviewCompletionEvidence,
} from "~/server/interview-hours";

export const interviewManagementRouter = createTRPCRouter({
  options: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(0).default(0),
          search: z.string().trim().max(100).default(""),
          completion: z.enum(["OPEN", "COMPLETED", "ALL"]).default("OPEN"),
          applicationId: z.string().min(1).optional(),
        })
        .default({ page: 0, search: "", completion: "OPEN" }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = 20;
      const where: Prisma.TutorApplicationWhereInput = {
        ...(input.applicationId ? { id: input.applicationId } : {}),
        // Include waiting applicants so staff can reach panel setup from this queue.
        AND: [
          {
            OR: [
              { interviewers: { some: {} } },
              { status: { in: ["PENDING", "INTERVIEW"] } },
              // Retained evidence still belongs to history after a panelist leaves.
              { interviewCompletedAt: { not: null } },
              { interviewAt: { not: null } },
              { votes: { some: {} } },
              { decidedByTutorId: { not: null } },
              { decisionComment: { not: null } },
            ],
          },
        ],
        ...(input.completion === "OPEN"
          ? {
              interviewCompletedAt: null,
              status: { not: "RECALLED" },
              invalidatedAt: null,
            }
          : input.completion === "COMPLETED"
            ? { interviewCompletedAt: { not: null } }
            : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { email: { contains: input.search, mode: "insensitive" } },
                {
                  interviewers: {
                    some: {
                      tutor: {
                        englishName: {
                          contains: input.search,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                },
                {
                  subjectIntents: {
                    some: {
                      subject: {
                        name: { contains: input.search, mode: "insensitive" },
                      },
                    },
                  },
                },
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
      const [applications, total] = await Promise.all([
        ctx.db.tutorApplication.findMany({
          where,
          // Imported/batched applications may share timestamps; offset pages need a total order.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: pageSize,
          skip: input.page * pageSize,
          select: {
            id: true,
            name: true,
            type: true,
            updatedAt: true,
            decisionComment: true,
            promotedTutorId: true,
            status: true,
            invalidatedAt: true,
            interviewAt: true,
            subjectIntents: {
              select: { subject: { select: { name: true } } },
            },
            interviewCompletedAt: true,
            interviewDurationMin: true,
            interviewers: {
              select: {
                tutorId: true,
                attended: true,
                isHead: true,
                tutor: { select: { englishName: true } },
              },
            },
          },
        }),
        ctx.db.tutorApplication.count({ where }),
      ]);
      const ids = applications.map((application) => application.id);
      // Only metadata is selected here: account credentials and invitation/code secrets
      // stay in their existing authorized management workflows.
      const [codes, linkedTutors, pendingReviews] = await Promise.all([
        ctx.db.registrationCode.findMany({
          where: { applicationId: { in: ids }, kind: "TUTOR" },
          select: {
            id: true,
            applicationId: true,
            tutorId: true,
            usedAt: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        ctx.db.tutor.findMany({
          where: {
            OR: [
              {
                id: {
                  in: applications.flatMap((a) =>
                    a.promotedTutorId ? [a.promotedTutorId] : [],
                  ),
                },
              },
              {
                registrationCodes: {
                  some: { applicationId: { in: ids }, kind: "TUTOR" },
                },
              },
            ],
          },
          select: {
            id: true,
            status: true,
            user: {
              select: {
                emailVerifiedAt: true,
                tutorAccessRevoked: true,
                suspendedAt: true,
                mergedIntoId: true,
              },
            },
          },
        }),
        ctx.db.approvalRequest.findMany({
          where: {
            state: "PENDING",
            operation: {
              in: ["tutor.decideInterview", "interviewManagement.complete"],
            },
            OR: ids.map((id) => ({
              payload: { path: ["json", "applicationId"], equals: id },
            })),
          },
          select: { operation: true, payload: true },
        }),
      ]);
      return {
        applications: {
          rows: applications.map(
            ({ invalidatedAt, promotedTutorId, ...application }) => {
              const pending = (operation: string) =>
                pendingReviews.some(
                  (review) =>
                    review.operation === operation &&
                    review.payload &&
                    typeof review.payload === "object" &&
                    !Array.isArray(review.payload) &&
                    review.payload.json &&
                    typeof review.payload.json === "object" &&
                    !Array.isArray(review.payload.json) &&
                    review.payload.json.applicationId === application.id,
                );
              const ownCodes = codes.filter(
                (code) => code.applicationId === application.id,
              );
              const tutor =
                linkedTutors.find((row) => row.id === promotedTutorId) ??
                linkedTutors.find((row) =>
                  ownCodes.some((code) => code.tutorId === row.id),
                );
              const activeCode = ownCodes.find(
                (code) => !code.usedAt && code.expiresAt > new Date(),
              );
              const code =
                activeCode ??
                ownCodes.find((row) => !!row.usedAt) ??
                ownCodes[0];
              const registered =
                tutor?.status === "ACTIVE" &&
                tutor.user?.emailVerifiedAt &&
                !tutor.user.tutorAccessRevoked &&
                !tutor.user.suspendedAt &&
                !tutor.user.mergedIntoId;
              const registration =
                application.type !== "INITIAL"
                  ? { state: "qualification" as const, href: null }
                  : invalidatedAt ||
                      application.status === "RECALLED" ||
                      application.status === "REJECTED"
                    ? { state: "notEligible" as const, href: null }
                    : application.status !== "ACCEPTED"
                      ? { state: "pendingDecision" as const, href: null }
                      : registered
                        ? {
                            state: "setupAvailable" as const,
                            href: "/admin/users",
                          }
                        : code
                          ? {
                              state: code.usedAt
                                ? ("codeUsed" as const)
                                : activeCode
                                  ? ("codeActive" as const)
                                  : ("codeExpired" as const),
                              href:
                                (code.usedAt || !activeCode) && tutor
                                  ? "/admin/users"
                                  : `/admin/registration-codes#registration-code-${code.id}`,
                            }
                          : {
                              state: "followUp" as const,
                              href: tutor ? "/admin/users" : null,
                            };
              return {
                ...application,
                isInvalid: !!invalidatedAt,
                registration,
                pendingDecision: pending("tutor.decideInterview"),
                pendingCompletion: pending("interviewManagement.complete"),
              };
            },
          ),
          total,
          pageSize,
        },
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
        await lockCatalogue(tx);
        if (input.qualified)
          await approveQualification(
            tx,
            input.tutorId,
            input.subjectId,
            ctx.session.user.id,
          );
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
    .input(interviewCompletionInput)
    .mutation(async ({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        await assertFeatureEnabled(tx, "INTERVIEWS");
        await assertFeatureEnabled(tx, "SERVICE_HOURS");
        await lockApplicationReview(tx, input.applicationId);
        if (input.completedAt > new Date())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Record completion only after the interview.",
          });
        const before = await tx.tutorApplication.findUniqueOrThrow({
          where: { id: input.applicationId },
          include: { interviewers: true },
        });
        assertRequestProcessable(before);
        if (before.status === "RECALLED")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "A recalled request cannot receive interview completion or credit.",
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
        const credits = await interviewHourRows(
          tx,
          input.applicationId,
          before.interviewers.map((p) => p.tutorId),
        );
        // Retrying already-applied evidence is read-only, preserving credit identity and
        // its original period even when the review snapshot has since advanced.
        if (sameInterviewCompletionEvidence(before, credits, input))
          return { ok: true };
        if (
          input.expectedUpdatedAt &&
          input.expectedUpdatedAt.getTime() !== before.updatedAt.getTime()
        )
          staleConflict();
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
          where: { id: { in: credits.map((row) => row.id) } },
        });
        await tx.serviceHourAdjustment.createMany({
          data: input.attendedTutorIds.map((tutorId) => ({
            id: interviewHoursId(input.applicationId, tutorId),
            tutorId,
            month: monthKey(input.completedAt),
            schoolYear: period.schoolYear,
            quarter: period.quarter,
            type: "EXTRA" as const,
            amount: input.durationMin / 60,
            reason: INTERVIEW_HOURS_REASON,
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
