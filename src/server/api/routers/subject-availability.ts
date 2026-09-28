import { z } from "zod";
import {
  createTRPCRouter,
  adminProcedure,
  activeTutorProcedure,
  tutorProcedure,
} from "~/server/api/trpc";
import { subjectOrderBy } from "~/lib/course-catalogue";
import { recordSubjectWillingness } from "~/server/subject-willingness";
import { tutorSubjectRows } from "~/lib/subject-availability";

const willingnessInput = z.object({
  subjectId: z.string().min(1),
  willing: z.boolean(),
});

/** Staff subject records are usable even when the optional interview module is off. */
export const subjectAvailabilityRouter = createTRPCRouter({
  options: adminProcedure.query(async ({ ctx }) => {
    const [
      tutors,
      subjects,
      qualifications,
      grants,
      willingness,
      pendingRequests,
    ] = await Promise.all([
      ctx.db.tutor.findMany({
        select: {
          id: true,
          englishName: true,
          status: true,
          user: { select: { tutorAccessRevoked: true } },
        },
        orderBy: [{ englishName: "asc" }, { id: "asc" }],
      }),
      ctx.db.subject.findMany({
        select: {
          id: true,
          name: true,
          active: true,
          groupId: true,
          group: { select: { name: true } },
          level: { select: { name: true, active: true } },
        },
        orderBy: [...subjectOrderBy],
      }),
      ctx.db.tutorQualification.findMany(),
      // Stored provenance is authoritative; never recalculate from today's level ranks.
      ctx.db.qualificationGrant.findMany({
        where: { qualification: { status: "APPROVED" } },
      }),
      ctx.db.tutorSubjectWillingness.findMany(),
      ctx.db.tutorApplication.findMany({
        where: {
          type: { not: "INITIAL" },
          status: { in: ["PENDING", "INTERVIEW"] },
        },
        select: { requestedTutorId: true, requestedSubjectId: true },
      }),
    ]);
    return {
      tutors,
      subjects,
      qualifications,
      grants,
      willingness,
      pendingRequests,
    };
  }),
  setWillingness: adminProcedure
    .input(willingnessInput.extend({ tutorId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      recordSubjectWillingness(ctx.db, input, ctx.session.user.id),
    ),
  mine: tutorProcedure.query(({ ctx }) =>
    ctx.db.tutorSubjectWillingness.findMany({
      where: { tutorId: ctx.session.tutorId },
      orderBy: { subjectId: "asc" },
    }),
  ),
  // Load the catalogue only when the editor opens. Every private record is self-scoped.
  mySubjects: tutorProcedure.query(async ({ ctx }) => {
    const tutorId = ctx.session.tutorId;
    const [tutor, subjects, qualifications, grants, willingness] =
      await Promise.all([
        ctx.db.tutor.findUnique({
          where: { id: tutorId },
          select: { status: true },
        }),
        ctx.db.subject.findMany({
          select: {
            id: true,
            name: true,
            active: true,
            groupId: true,
            group: { select: { name: true } },
            level: { select: { name: true, active: true } },
          },
          orderBy: [...subjectOrderBy],
        }),
        ctx.db.tutorQualification.findMany({ where: { tutorId } }),
        ctx.db.qualificationGrant.findMany({
          where: { tutorId, qualification: { status: "APPROVED" } },
        }),
        ctx.db.tutorSubjectWillingness.findMany({ where: { tutorId } }),
      ]);
    return {
      canEdit: tutor?.status === "ACTIVE",
      rows: tutorSubjectRows(
        tutorId,
        subjects,
        qualifications,
        grants,
        willingness,
      ),
    };
  }),
  // tutorId is derived from the fresh authorized session, never accepted from the caller.
  setMine: activeTutorProcedure
    .input(willingnessInput)
    .mutation(({ ctx, input }) =>
      recordSubjectWillingness(
        ctx.db,
        { ...input, tutorId: ctx.session.tutorId },
        ctx.session.user.id,
      ),
    ),
});
