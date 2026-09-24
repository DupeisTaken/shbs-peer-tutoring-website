import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  activeTutorProcedure,
  adminOnlyProcedure,
  createTRPCRouter,
  tutorProcedure,
} from "~/server/api/trpc";
import { inTransaction, lockEntity } from "~/server/transactions";
import { lockCatalogue, eligibleSubjectIds } from "~/server/qualifications";
import {
  qualificationOptions,
  decideQualificationApplication,
} from "~/server/qualification-applications";
import { expectedUpdatedAt } from "~/server/concurrency";
import { notifyUsers } from "~/server/notifications/create";
import { qualificationSnapshot } from "~/lib/qualification-applications";
import { courseChoices } from "~/server/course-choices";

export const qualificationApplicationRouter = createTRPCRouter({
  mine: tutorProcedure.query(async ({ ctx }) => {
    const tutorId = ctx.session.tutorId;
    const [requests, options, eligible] = await Promise.all([
      ctx.db.tutorApplication.findMany({
        where: { requestedTutorId: tutorId, type: { not: "INITIAL" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          interviewAt: true,
          decidedAt: true,
          decisionComment: true,
          qualificationReason: true,
          qualificationSnapshot: true,
          requestedSubject: { select: { id: true, name: true } },
        },
      }),
      qualificationOptions(ctx.db, tutorId),
      eligibleSubjectIds(ctx.db, tutorId),
    ]);
    const approved = (
      await courseChoices(ctx.db, { id: { in: eligible } })
    ).map(({ id, name }) => ({ id, name }));
    const pending = new Set(
      requests
        .filter(
          (request) =>
            request.status === "PENDING" || request.status === "INTERVIEW",
        )
        .map((request) => request.requestedSubject?.id),
    );
    return {
      approved,
      options: options.filter((subject) => !pending.has(subject.id)),
      requests: requests.map((request) => ({
        ...request,
        qualificationSnapshot: qualificationSnapshot(
          request.qualificationSnapshot,
        ),
      })),
    };
  }),

  submit: activeTutorProcedure
    .input(
      z
        .object({
          subjectId: z.string().min(1),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, async (tx) => {
        const tutorId = ctx.session.tutorId;
        // Match catalogue/approval locking; one tutor cannot race two open requests for a variant.
        await lockCatalogue(tx);
        await lockEntity(tx, `qualification-request:${tutorId}`);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: ctx.session.user.id },
          include: { tutor: true },
        });
        if (
          user.tutorId !== tutorId ||
          user.tutorAccessRevoked ||
          user.tutor?.status !== "ACTIVE"
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "An active tutor account is required.",
          });
        if (
          await tx.tutorApplication.count({
            where: {
              requestedTutorId: tutorId,
              requestedSubjectId: input.subjectId,
              status: { in: ["PENDING", "INTERVIEW"] },
            },
          })
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "You already have an open request for this subject and level.",
          });
        const option = (await qualificationOptions(tx, tutorId)).find(
          (subject) => subject.id === input.subjectId,
        );
        if (!option)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose a new subject or a higher offered level that is not already approved.",
          });
        const request = await tx.tutorApplication.create({
          data: {
            type: option.type,
            requestedTutorId: tutorId,
            requestedSubjectId: input.subjectId,
            qualificationReason: input.reason,
            name: user.name ?? user.tutor.englishName,
            email: user.email,
            status: "PENDING",
            contactVerified: !!user.emailVerifiedAt,
            subjectIntents: { create: { subjectId: input.subjectId } },
          },
          select: { id: true },
        });
        const reviewers = await tx.user.findMany({
          where: { role: { in: ["ADMIN", "HEAD"] }, suspendedAt: null },
          select: { id: true },
        });
        await notifyUsers(
          reviewers.map((reviewer) => reviewer.id),
          {
            title: "Additional qualification request",
            body: `${user.tutor.englishName}: ${option.name}`,
            link: `/admin/applications#application-${request.id}`,
          },
          tx,
        );
        return request;
      }),
    ),

  // This changes subject approval, never membership, so Admin and Head execute directly.
  // adminOnlyProcedure rejects coordinators before any proposal can be queued.
  decide: adminOnlyProcedure
    .input(
      z.object({
        id: z.string().min(1),
        accept: z.boolean(),
        comment: z.string().trim().min(1).max(500),
        expectedUpdatedAt,
      }),
    )
    .mutation(({ ctx, input }) =>
      inTransaction(ctx.db, (tx) =>
        decideQualificationApplication(
          tx,
          {
            id: ctx.session.user.id,
            role: ctx.session.role,
            tutorId: ctx.session.tutorId,
          },
          input,
        ),
      ),
    ),
});
