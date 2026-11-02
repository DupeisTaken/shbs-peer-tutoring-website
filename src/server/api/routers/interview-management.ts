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
import { tutorDirectoryHref } from "~/lib/tutor-directory-link";
import { assertFeatureEnabled } from "~/server/program/features";
import { staleConflict } from "~/server/concurrency";
import {
  interviewCompletionInput,
  interviewHourRows,
  sameInterviewCompletionEvidence,
  writeInterviewCompletion,
} from "~/server/interview-hours";

export const interviewManagementRouter = createTRPCRouter({
  options: adminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(0).default(0),
          search: z.string().trim().max(100).default(""),
          completion: z.enum(["OPEN", "COMPLETED", "ALL"]).default("OPEN"),
          status: z
            .enum([
              "",
              "PENDING",
              "INTERVIEW",
              "ACCEPTED",
              "REJECTED",
              "RECALLED",
            ])
            .default(""),
          sort: z
            .enum([
              "COMPLETED_DESC",
              "COMPLETED_ASC",
              "CREATED_DESC",
              "CREATED_ASC",
              "NAME_ASC",
              "NAME_DESC",
            ])
            .default("CREATED_DESC"),
          applicationId: z.string().min(1).optional(),
        })
        .default({
          page: 0,
          search: "",
          completion: "OPEN",
          status: "",
          sort: "CREATED_DESC",
        }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = 20;
      const where: Prisma.TutorApplicationWhereInput = {
        ...(input.applicationId ? { id: input.applicationId } : {}),
        // Include waiting applicants so staff can reach panel setup from this queue.
        AND: [
          // Status intersects the completion scope; it must not overwrite OPEN's recalled exclusion.
          ...(input.status ? [{ status: input.status }] : []),
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
              // A direct subject approval resolves the interview request. Its
              // decision note remains history, not unfinished interview service.
              // Retain genuine interview evidence, including legacy follow-up.
              NOT: {
                type: { not: "INITIAL" },
                status: "ACCEPTED",
                interviewers: { none: {} },
                interviewAt: null,
                votes: { none: {} },
                decidedByTutorId: null,
              },
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
      // Order the entire matching queue before pagination. Null completion dates
      // stay last in either direction, and IDs settle imported timestamp/name ties.
      const orderBy: Prisma.TutorApplicationOrderByWithRelationInput[] =
        input.sort === "COMPLETED_DESC" || input.sort === "COMPLETED_ASC"
          ? [
              {
                interviewCompletedAt: {
                  sort: input.sort === "COMPLETED_DESC" ? "desc" : "asc",
                  nulls: "last",
                },
              },
              { createdAt: "desc" },
              { id: "desc" },
            ]
          : input.sort === "NAME_ASC" || input.sort === "NAME_DESC"
            ? [
                { name: input.sort === "NAME_ASC" ? "asc" : "desc" },
                { createdAt: "desc" },
                { id: "desc" },
              ]
            : [
                { createdAt: input.sort === "CREATED_ASC" ? "asc" : "desc" },
                { id: "desc" },
              ];
      const [applications, total] = await Promise.all([
        ctx.db.tutorApplication.findMany({
          where,
          // Imported/batched applications may share timestamps; offset pages need a total order.
          orderBy,
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
              // A stale explicit link must not silently select another person.
              // Legacy codes recover identity only when all bindings agree.
              const codeTutorIds = new Set(
                ownCodes.flatMap((code) =>
                  code.tutorId ? [code.tutorId] : [],
                ),
              );
              const setupTutorId =
                promotedTutorId ??
                (codeTutorIds.size === 1 ? [...codeTutorIds][0] : null);
              const tutor = linkedTutors.find((row) => row.id === setupTutorId);
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
                            href: tutorDirectoryHref(tutor.id),
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
                                  ? tutorDirectoryHref(tutor.id)
                                  : `/admin/registration-codes#registration-code-${code.id}`,
                            }
                          : {
                              state: "followUp" as const,
                              href: tutor ? tutorDirectoryHref(tutor.id) : null,
                            };
              return {
                ...application,
                isInvalid: !!invalidatedAt,
                registration,
                // An old proposal remains review history after a direct decision;
                // it cannot make the committed outcome look pending again.
                pendingDecision:
                  ["PENDING", "INTERVIEW"].includes(application.status) &&
                  pending("tutor.decideInterview"),
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
        // Correcting recorded service must not require replacing its historical
        // panel (which would also erase votes and reverse accepted admission).
        // Only this completed-evidence path relaxes today's chair-role rule.
        await validatePanel(
          tx,
          input.applicationId,
          before.interviewers.map((p) => p.tutorId),
          chair?.tutorId ?? "",
          {
            chairEligibility: before.interviewCompletedAt
              ? "recorded"
              : "current",
          },
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
        // The same source-owned write is used by immediate chair approval.
        await writeInterviewCompletion(
          tx,
          input.applicationId,
          before,
          input,
          credits,
        );
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
