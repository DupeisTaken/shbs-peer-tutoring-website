import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accountMembership, membershipBadges } from "~/lib/account-membership";
import { tutorSubjectGroups } from "~/lib/tutor-details";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";

/** Staff inspection has the same privacy boundary as account policy history.
 * This router is read-only and does not confer membership-edit permissions. */
export const tutorDetailsRouter = createTRPCRouter({
  get: adminProcedure
    .input(z.object({ tutorId: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const tutor = await ctx.db.tutor.findUnique({
        where: { id: input.tutorId },
        select: {
          id: true,
          englishName: true,
          alternativeNames: true,
          username: true,
          email: true,
          gradeLevel: true,
          status: true,
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              role: true,
              tutorId: true,
              tuteeMember: true,
              tutorAccessRevoked: true,
              canTranslate: true,
              crewStatus: true,
            },
          },
        },
      });
      if (!tutor) throw new TRPCError({ code: "NOT_FOUND" });
      // Fetch only this tutor's evidence, independent of the interview feature switch.
      const [subjects, qualifications, grants, willingness] = await Promise.all(
        [
          ctx.db.subject.findMany({
            select: {
              id: true,
              name: true,
              active: true,
              group: { select: { id: true, name: true, rank: true } },
              level: {
                select: { id: true, name: true, rank: true, active: true },
              },
            },
          }),
          ctx.db.tutorQualification.findMany({
            where: { tutorId: input.tutorId },
            select: { subjectId: true, status: true },
          }),
          ctx.db.qualificationGrant.findMany({
            where: { tutorId: input.tutorId },
            select: { sourceSubjectId: true, subjectId: true },
          }),
          ctx.db.tutorSubjectWillingness.findMany({
            where: { tutorId: input.tutorId },
            select: { subjectId: true, willing: true },
          }),
        ],
      );
      return {
        id: tutor.id,
        name: tutor.englishName,
        alternativeNames: tutor.alternativeNames,
        username: tutor.user?.username ?? tutor.username,
        email: tutor.user?.email ?? tutor.email,
        gradeLevel: tutor.gradeLevel,
        status: tutor.status,
        // A historical account link does not imply current tutoring access.
        tutorAccessRevoked: tutor.user?.tutorAccessRevoked ?? false,
        userId: tutor.user?.id ?? null,
        badges: tutor.user
          ? membershipBadges(
              accountMembership({ ...tutor.user, tutorStatus: tutor.status }),
            )
          : [],
        groups: tutorSubjectGroups(
          subjects,
          qualifications,
          grants,
          willingness,
        ),
      };
    }),
});
